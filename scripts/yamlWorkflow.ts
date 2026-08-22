import { load } from 'js-yaml';

/**
 * Lector de workflows sobre **parseo YAML real** (`js-yaml`) — vuelta 13, y la
 * primera que no pelea contra el formato.
 *
 * ## Por qué hay una dependencia acá, y cuál es su límite
 *
 * `js-yaml` entra como **devDependency, EXCLUSIVAMENTE para el instrumento de
 * tests**. Nunca en runtime, nunca en un bundle — hay un test que lo acredita
 * (`bundleSinYaml` en `despliegue.test.ts`) porque una promesa así se rompe sin
 * que nadie se entere. Autorizada por Mati el 2026-08-21, etiqueta literal
 * «Sí, librería real en tests (Recomendada)», y confirmada por él directamente
 * a esta sesión: el `CLAUDE.md` prohíbe dependencias nuevas sin su OK previo.
 *
 * ## Las doce vueltas anteriores, en una línea
 *
 * El lector se escribía a mano y **afirmaba una propiedad mayor que la que
 * recorría**. Codex lo refutó una y otra vez con YAML válido: la primera clave
 * del mapping, el guion solo en su renglón, el segundo `steps:`… La vuelta 12
 * introdujo el fail-closed —declarar el subconjunto y denunciar el resto—, que
 * fue una mejora real, pero **seguía siendo un parser propio**: el P65 lo volvió
 * a refutar por dónde no miraba, no por cómo parseaba.
 *
 * 🔴 **Y ése es el punto: los tres hallazgos del P65 NO eran de parseo.** Eran
 * de modelo — qué población se recorre, qué acredita causalidad, dónde está la
 * frontera de interpolación. Un parser propio mejor no los habría cerrado.
 * Textual del dictamen: *«no recomiendo más búsquedas de substrings»*.
 *
 * Con el parseo resuelto por una librería, este archivo se dedica a lo único
 * que es nuestro: **modelar el workflow como GitHub Actions lo ejecuta**.
 */

/** Un paso de un job, con sus claves tal cual las declara el YAML. */
export interface PasoYaml {
  readonly job: string;
  readonly indice: number;
  readonly claves: { readonly [clave: string]: unknown };
}

/**
 * Un job, adjudicado ENTERO.
 *
 * 🔴 P65 · un job puede no tener `steps` y ejecutar igual: `jobs.<id>.uses`
 * llama a un **reusable workflow**, con sus argumentos y sus `secrets`. El
 * lector anterior hacía `continue` sobre esos jobs, así que un publicador
 * reusable quedaba **fuera del censo** y el focal daba 61/61 verde.
 */
export interface JobYaml {
  readonly nombre: string;
  /** `jobs.<id>.uses` — un reusable workflow. `null` si el job trae `steps`. */
  readonly usa: string | null;
  /** `secrets: inherit` o el mapping de secretos que se le pasa al reusable. */
  readonly secretos: unknown;
  readonly pasos: readonly PasoYaml[];
  /** `needs`, normalizado a lista. Vacío = el job no espera a nadie. */
  readonly necesita: readonly string[];
  /**
   * El `if:` DEL JOB — P71. La condición efectiva de un paso es la suya Y la de
   * su job: Actions no corre el job si la condición del job es falsa, y la
   * corre igual si es `always()`. Mirar sólo `step.if` deja la mitad afuera, y
   * fue por ahí que un publicador con `job.if: always()` pasó verde.
   *
   * 🔴 P73 · ES `unknown`, NO `string | null`, y la diferencia es el hallazgo.
   * Antes se guardaba sólo si `js-yaml` lo entregaba como string: con `if: true`
   * YAML produce un BOOLEANO y el modelo guardaba `null`, o sea **«ausente»**.
   * `null` mezclaba dos cosas que no son lo mismo: *no está* y *está en una
   * forma que no supe adjudicar*. Ahora `undefined` es ausencia y cualquier otro
   * valor es presencia — el consumidor decide, y decide en rojo.
   */
  readonly condicion: unknown;
  /**
   * `strategy` — P73. Una matriz EXPANDE el job en varias ejecuciones, cada una
   * con sus pasos completos. El modelo no la tenía, así que el arnés contaba
   * las LÍNEAS del paso publicador y creía estar contando sus EJECUCIONES: con
   * `matrix: replica: [1,2]`, App y Landing se disparan DOS veces cada una
   * —cuatro hooks— mientras el gate certificaba «exactamente dos».
   */
  readonly estrategia: unknown;
}

export interface Workflow {
  readonly jobs: readonly JobYaml[];
  /** Todo lo que este modelo no puede adjudicar. Un elemento acá es ROJO. */
  readonly problemas: readonly string[];
}

const esMapa = (n: unknown): n is { [k: string]: unknown } =>
  typeof n === 'object' && n !== null && !Array.isArray(n);

/** `needs: a` · `needs: [a, b]` → lista. Cualquier otra forma, indecidible. */
function normalizarNeeds(v: unknown, job: string, problemas: string[]): string[] {
  if (v === undefined) return [];
  if (typeof v === 'string') return [v];
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v as string[];
  problemas.push(`«${job}.needs» no es un nombre ni una lista de nombres`);
  return [];
}

export function leerWorkflow(texto: string): Workflow {
  const problemas: string[] = [];
  let doc: unknown;
  try {
    doc = load(texto);
  } catch (e) {
    return { jobs: [], problemas: [`el YAML no parsea: ${(e as Error).message}`] };
  }
  if (!esMapa(doc)) return { jobs: [], problemas: ['la raíz del workflow no es un mapping'] };

  const jobsRaw = doc['jobs'];
  if (!esMapa(jobsRaw)) return { jobs: [], problemas: ['el workflow no declara `jobs` como mapping'] };

  const jobs: JobYaml[] = [];
  for (const [nombre, job] of Object.entries(jobsRaw)) {
    if (!esMapa(job)) {
      problemas.push(`el job «${nombre}» no es un mapping`);
      continue;
    }
    const necesita = normalizarNeeds(job['needs'], nombre, problemas);
    const steps = job['steps'];
    const usa = job['uses'];

    if (steps === undefined) {
      // 🔴 FAIL-CLOSED, punto 1 del P65. Un job sin `steps` NO se saltea: o
      // declara `uses` —y entonces se adjudica ese reusable como cualquier otro
      // camino ejecutable— o no hay contrato que lo explique y es rojo.
      if (typeof usa === 'string') {
        jobs.push({
          nombre,
          usa,
          secretos: job['secrets'],
          pasos: [],
          necesita,
          condicion: job['if'],
          estrategia: job['strategy'],
        });
      } else {
        problemas.push(
          `el job «${nombre}» no tiene \`steps\` ni \`uses\`: no se puede adjudicar qué ejecuta`,
        );
      }
      continue;
    }
    if (!Array.isArray(steps)) {
      problemas.push(`«${nombre}.steps» no es una lista`);
      continue;
    }
    const pasos: PasoYaml[] = [];
    steps.forEach((paso, indice) => {
      if (!esMapa(paso)) {
        problemas.push(`«${nombre}.steps[${indice}]» no es un mapping`);
        return;
      }
      pasos.push({ job: nombre, indice, claves: paso });
    });
    jobs.push({
      nombre,
      usa: null,
      secretos: job['secrets'],
      pasos,
      necesita,
      condicion: job['if'],
      estrategia: job['strategy'],
    });
  }
  return { jobs, problemas };
}

/**
 * ¿`job` espera a `anterior` antes de correr? — punto 2 del P65.
 *
 * 🔴 **EL ORDEN DEL DOCUMENTO NO ES CAUSALIDAD, y ésta es la corrección de
 * modelo más importante del lote.** El instrumento anterior aplanaba los jobs en
 * el orden del mapping y tomaba «todo lo anterior» como si fueran gates
 * previos. En GitHub Actions **dos jobs sin `needs` corren en paralelo**: mover
 * el publicador a un segundo job posterior lo dejaba corriendo sin esperar a
 * test, build ni Playwright, y el focal daba 61/61 verde.
 *
 * Un `if: success()` dentro del segundo job **no crea la arista**: evalúa el
 * estado de sus propias dependencias, y sin `needs` no tiene ninguna.
 *
 * Se recorre el DAG en profundidad, así que la dependencia vale **transitiva**
 * (`c needs b`, `b needs a` ⇒ `c` espera a `a`). Los ciclos se cortan con el
 * conjunto de visitados: un workflow con ciclo no arranca en Actions, pero acá
 * no puede colgar el test.
 */
export function esperaA(jobs: readonly JobYaml[], job: string, anterior: string): boolean {
  const porNombre = new Map(jobs.map((j) => [j.nombre, j]));
  const vistos = new Set<string>();
  const pendientes = [...(porNombre.get(job)?.necesita ?? [])];
  while (pendientes.length) {
    const actual = pendientes.pop()!;
    if (actual === anterior) return true;
    if (vistos.has(actual)) continue;
    vistos.add(actual);
    pendientes.push(...(porNombre.get(actual)?.necesita ?? []));
  }
  return false;
}

/**
 * Los pasos que corren **con garantía** antes de `paso` — punto 2 del P65.
 *
 * Son dos poblaciones y ninguna es «los de más arriba en el archivo»:
 *
 *   ① los del MISMO job con índice menor — Actions ejecuta los pasos de un job
 *      en orden, ésa sí es una garantía del modelo;
 *   ② todos los pasos de los jobs de los que el job de `paso` depende
 *      transitivamente por `needs`.
 *
 * Un job hermano sin arista **no entra**, aunque esté escrito antes: corre en
 * paralelo y puede terminar después.
 */
export function pasosGarantizadosAntesDe(
  jobs: readonly JobYaml[],
  paso: PasoYaml,
): PasoYaml[] {
  const mismos = jobs.find((j) => j.nombre === paso.job)?.pasos ?? [];
  const previosDelMismoJob = mismos.filter((p) => p.indice < paso.indice);
  const deJobsQueEspera = jobs
    .filter((j) => j.nombre !== paso.job && esperaA(jobs, paso.job, j.nombre))
    .flatMap((j) => [...j.pasos]);
  return [...deJobsQueEspera, ...previosDelMismoJob];
}

/** Todos los pasos de todos los jobs, en el orden en que los declara el YAML. */
export function pasosDeWorkflow(texto: string): {
  pasos: PasoYaml[];
  indecidibles: string[];
} {
  const { jobs, problemas } = leerWorkflow(texto);
  return { pasos: jobs.flatMap((j) => [...j.pasos]), indecidibles: [...problemas] };
}
