/**
 * Parser ESTRUCTURAL del subconjunto de YAML que usan los workflows de este
 * repo — punto 1 del cierre mínimo del dictamen P60 de Codex.
 *
 * ## Por qué existe, después de tres vueltas leyendo líneas
 *
 * `despliegue.test.ts` venía identificando pasos por su FORMA TEXTUAL: primero
 * por la primera clave (`- run:`, `- uses:`…), después por «un `- ` a la
 * sangría de los ítems». Las dos veces el centinela **afirmaba una propiedad
 * mayor que la que recorría**, y las dos veces Codex la refutó con YAML válido:
 *
 * ```yaml
 * steps:
 *   -
 *     run: npx vercel --prod      # el guion solo, en su propio renglón
 *   - uses: actions/checkout@v4
 * ```
 *
 * y un segundo `job` con su propio `steps:`, que el `findIndex` de un único
 * bloque no miraba. **Los dos publicaban sin que el gate los viera: 49/49
 * verde.**
 *
 * ## La decisión de diseño, y es lo único que rompe el ciclo
 *
 * 🔴 **Este parser FALLA CERRADO.** No intenta entender todo YAML —eso es una
 * carrera perdida contra un estándar enorme— sino que **declara el subconjunto
 * que entiende y marca INDECIDIBLE cualquier construcción fuera de él**. Un
 * `indecidible` no se ignora: pone el centinela en rojo.
 *
 * La diferencia con las tres vueltas anteriores es exactamente ésa. Antes, lo
 * que el parser no reconocía **desaparecía**; ahora **se denuncia**. Un lector
 * incompleto que calla es un falso verde; uno que grita es una limitación
 * honesta, y el que agregue esa construcción al workflow se entera en el acto.
 *
 * Es la misma forma que el punto 2 del dictamen pide para las expansiones de
 * shell —«indecidibles salvo contrato expreso»— aplicada al parser entero.
 *
 * ## Qué entiende (el contrato)
 *
 * - mappings `clave: valor` y `clave:` con bloque anidado;
 * - secuencias, con el guion en el mismo renglón (`- x`) **o solo** (`-`);
 * - escalares planos y entrecomillados (`'` y `"`);
 * - escalares de bloque `|`, `|-`, `|+`, `>`, `>-`, `>+`;
 * - comentarios `#` fuera de comillas, y líneas en blanco.
 *
 * ## Qué declara INDECIDIBLE (y por eso pone rojo)
 *
 * - tabs en la indentación (YAML los prohíbe; nadie debería, pero se denuncia);
 * - flow collections `{...}` / `[...]` como valor;
 * - anchors `&`, alias `*`, tags `!!`, claves explícitas `? `;
 * - varios documentos (`---` / `...`);
 * - cualquier renglón que no case con ninguna de las formas de arriba.
 */

/** Un valor del subconjunto: escalar, lista o mapping. */
export type NodoYaml = string | NodoYaml[] | { [clave: string]: NodoYaml };

export interface Documento {
  readonly raiz: NodoYaml;
  /** Construcciones fuera del contrato, con su renglón. Vacío = todo entendido. */
  readonly indecidibles: readonly string[];
}

interface Renglon {
  readonly n: number;
  readonly sangria: number;
  readonly texto: string;
}

/** Quita el comentario `#` que esté FUERA de comillas. */
export function sinComentario(l: string): string {
  let dentro: string | null = null;
  for (let i = 0; i < l.length; i++) {
    const c = l[i]!;
    if (dentro) {
      if (c === dentro) dentro = null;
      continue;
    }
    if (c === '"' || c === "'") {
      dentro = c;
      continue;
    }
    if (c === '#') return l.slice(0, i);
  }
  return l;
}

const CLAVE = /^([A-Za-z_][A-Za-z0-9_.-]*)\s*:(?:\s+(.*))?$/;
const BLOQUE = /^[|>][+-]?$/;

/**
 * Desentrecomilla un escalar. **No interpreta escapes**: si un valor
 * entrecomillado los trae, el llamador lo verá tal cual — y para lo que este
 * centinela mide (comandos de shell), el texto crudo es lo correcto.
 */
function escalar(v: string): string {
  const t = v.trim();
  if (t.length >= 2 && (t[0] === '"' || t[0] === "'") && t[t.length - 1] === t[0]) {
    return t.slice(1, -1);
  }
  return t;
}

/**
 * Una lista flow de ESCALARES SIMPLES: `[main]`, `[a, b]`. Devuelve `null` si
 * no es eso.
 *
 * 🔴 Se acepta esta forma y NO la general, y el corte no es arbitrario: el
 * `ci.yml` real usa `branches: [main]`, así que rechazar todo flow dejaba el
 * gate inusable —y un gate que no se puede correr se termina aflojando—. Lo que
 * sigue INDECIDIBLE es el flow que puede esconder estructura:
 * `steps: [{ run: npx vercel --prod }]` mete un mapping adentro, que es
 * exactamente la forma con la que alguien colaría un paso sin que el censo lo
 * vea. Por eso se cortan las llaves y el anidamiento, no los corchetes.
 */
function flowDeEscalares(t: string): string[] | null {
  if (!t.startsWith('[') || !t.endsWith(']')) return null;
  const dentro = t.slice(1, -1);
  if (/[[\]{}]/.test(dentro)) return null; // anidado o con mapping: no
  if (!dentro.trim()) return [];
  return dentro.split(',').map((x) => escalar(x));
}

/** ¿El valor inline cae fuera del contrato? Devuelve el motivo, o `null`. */
function inlineIndecidible(v: string): string | null {
  const t = v.trim();
  if (!t) return null;
  if (t.startsWith('&') || t.startsWith('*')) return 'anchor o alias';
  if (t.startsWith('!')) return 'tag';
  if (t.startsWith('{')) return 'flow collection';
  if (t.startsWith('[')) return flowDeEscalares(t) ? null : 'flow collection';
  return null;
}

export function parsearYaml(texto: string): Documento {
  const indecidibles: string[] = [];
  const renglones: Renglon[] = [];

  texto.split('\n').forEach((cruda, i) => {
    const n = i + 1;
    if (/^\s*$/.test(cruda)) return;
    const sinCom = sinComentario(cruda);
    if (!sinCom.trim()) return;
    const sangriaTexto = sinCom.slice(0, sinCom.search(/\S/));
    if (sangriaTexto.includes('\t')) {
      indecidibles.push(`renglón ${n}: tab en la indentación`);
      return;
    }
    const t = sinCom.trim();
    if (t === '---' || t === '...') {
      indecidibles.push(`renglón ${n}: separador de documento (${t})`);
      return;
    }
    if (t.startsWith('? ')) {
      indecidibles.push(`renglón ${n}: clave explícita`);
      return;
    }
    renglones.push({ n, sangria: sangriaTexto.length, texto: t });
  });

  let i = 0;

  /** Lee el escalar de bloque que sigue, por indentación. */
  function leerBloque(sangriaPadre: number): string {
    const partes: string[] = [];
    while (i < renglones.length && renglones[i]!.sangria > sangriaPadre) {
      partes.push(renglones[i]!.texto);
      i += 1;
    }
    return partes.join('\n');
  }

  function leerNodo(sangria: number): NodoYaml {
    if (i >= renglones.length) return '';
    const primero = renglones[i]!;

    // ── SECUENCIA ──────────────────────────────────────────────────────────
    if (primero.texto === '-' || primero.texto.startsWith('- ')) {
      const lista: NodoYaml[] = [];
      while (i < renglones.length && renglones[i]!.sangria === sangria) {
        const r = renglones[i]!;
        if (r.texto !== '-' && !r.texto.startsWith('- ')) break;

        // 🔴 EL GUION SOLO EN SU RENGLÓN — el contraejemplo del P60. El ítem
        // vive entero en las líneas MÁS INDENTADAS que siguen; no hay nada que
        // leer en este renglón. Antes esta forma no abría ítem y el paso
        // desaparecía del censo.
        if (r.texto === '-') {
          i += 1;
          const hijoSangria = i < renglones.length ? renglones[i]!.sangria : sangria + 1;
          if (hijoSangria <= sangria) {
            lista.push('');
            continue;
          }
          lista.push(leerNodo(hijoSangria));
          continue;
        }

        // `- resto`: el resto es el PRIMER renglón del ítem, y las líneas que
        // siguen con más sangría pertenecen al mismo ítem. Se reescribe el
        // guion como espacios para que el ítem quede alineado consigo mismo.
        const resto = r.texto.slice(2);
        const sangriaItem = r.sangria + 2;
        const motivo = inlineIndecidible(resto);
        if (motivo) {
          indecidibles.push(`renglón ${r.n}: ${motivo}`);
          i += 1;
          continue;
        }
        renglones[i] = { n: r.n, sangria: sangriaItem, texto: resto };
        lista.push(leerNodo(sangriaItem));
      }
      return lista;
    }

    // ── MAPPING ────────────────────────────────────────────────────────────
    const m = CLAVE.exec(primero.texto);
    if (m) {
      const mapa: { [clave: string]: NodoYaml } = {};
      while (i < renglones.length && renglones[i]!.sangria === sangria) {
        const r = renglones[i]!;
        const mm = CLAVE.exec(r.texto);
        if (!mm) {
          if (r.texto === '-' || r.texto.startsWith('- ')) break;
          indecidibles.push(`renglón ${r.n}: no es «clave: valor» ni ítem de lista → ${r.texto}`);
          i += 1;
          continue;
        }
        const clave = mm[1]!;
        const valor = mm[2] ?? '';
        i += 1;

        if (BLOQUE.test(valor.trim())) {
          mapa[clave] = leerBloque(r.sangria);
          continue;
        }
        if (valor.trim()) {
          const motivo = inlineIndecidible(valor);
          if (motivo) {
            indecidibles.push(`renglón ${r.n}: ${motivo} en «${clave}»`);
            continue;
          }
          const lista = flowDeEscalares(valor.trim());
          mapa[clave] = lista ?? escalar(valor);
          continue;
        }
        // Sin valor inline: o hay bloque anidado, o es vacío.
        if (i < renglones.length && renglones[i]!.sangria > r.sangria) {
          mapa[clave] = leerNodo(renglones[i]!.sangria);
        } else {
          mapa[clave] = '';
        }
      }
      return mapa;
    }

    indecidibles.push(`renglón ${primero.n}: forma no contemplada → ${primero.texto}`);
    i += 1;
    return '';
  }

  const raiz = renglones.length ? leerNodo(renglones[0]!.sangria) : {};
  // Lo que quede sin consumir es estructura que este parser no supo recorrer.
  while (i < renglones.length) {
    indecidibles.push(`renglón ${renglones[i]!.n}: quedó fuera del recorrido`);
    i += 1;
  }
  return { raiz, indecidibles };
}

export interface PasoYaml {
  readonly job: string;
  readonly indice: number;
  readonly claves: { readonly [clave: string]: NodoYaml };
}

/**
 * TODOS los pasos de TODOS los jobs — punto 1 del cierre mínimo.
 *
 * 🔴 El `findIndex` anterior fijaba **un solo** `steps:`, así que un segundo job
 * con un paso peligroso pasaba verde. Acá los jobs se recorren por la
 * estructura (`jobs` → cada clave → `steps`), no por el primer match textual.
 *
 * Un `steps:` que no sea una lista, o un ítem que no sea un mapping, entra como
 * indecidible: es justo la forma que un atacante —o un despiste— usaría para
 * esconder un paso.
 */
export function pasosDeWorkflow(texto: string): {
  pasos: PasoYaml[];
  indecidibles: string[];
} {
  const { raiz, indecidibles } = parsearYaml(texto);
  const pasos: PasoYaml[] = [];
  const problemas = [...indecidibles];

  const esMapa = (n: NodoYaml): n is { [k: string]: NodoYaml } =>
    typeof n === 'object' && n !== null && !Array.isArray(n);

  if (!esMapa(raiz)) {
    problemas.push('la raíz del workflow no es un mapping');
    return { pasos, indecidibles: problemas };
  }
  const jobs = raiz['jobs'];
  if (jobs === undefined) {
    problemas.push('el workflow no declara `jobs`');
    return { pasos, indecidibles: problemas };
  }
  if (!esMapa(jobs)) {
    problemas.push('`jobs` no es un mapping');
    return { pasos, indecidibles: problemas };
  }

  for (const [nombreJob, job] of Object.entries(jobs)) {
    if (!esMapa(job)) {
      problemas.push(`el job «${nombreJob}» no es un mapping`);
      continue;
    }
    const steps = job['steps'];
    if (steps === undefined) continue; // un job sin pasos es legítimo (reusable workflow)
    if (!Array.isArray(steps)) {
      problemas.push(`«${nombreJob}.steps» no es una lista`);
      continue;
    }
    steps.forEach((paso, indice) => {
      if (!esMapa(paso)) {
        problemas.push(`«${nombreJob}.steps[${indice}]» no es un mapping`);
        return;
      }
      pasos.push({ job: nombreJob, indice, claves: paso });
    });
  }
  return { pasos, indecidibles: problemas };
}
