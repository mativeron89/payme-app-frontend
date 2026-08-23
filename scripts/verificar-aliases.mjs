#!/usr/bin/env node
/**
 * GATE DEL ALIAS Y SU HERRAMIENTA · lo que el comando EJECUTA, no lo que dice.
 *
 * ## Por qué existe (dictamen P88, 11ª vuelta)
 *
 * El arnés de `despliegue.test.ts` adjudica los **tokens del workflow**: que el
 * paso diga `npm test`, `npm run typecheck`, `npm run build`. Codex mostró que
 * eso **no acredita nada sobre lo que esos comandos ejecutan**:
 *
 *   · `scripts.test: "true"` → `npm test` sale 0 sin lanzar Vitest;
 *   · excluir `scripts/**` de la config → `npm test` verde recolectando 84
 *     archivos en vez de 96, **sin un solo test de `scripts/`**;
 *   · aliases no-op de typecheck/build → exit 0 sin `tsc` ni Vite.
 *
 * 🔴 **La clase: un centinela que adjudica el TEXTO `npm test` no acredita que
 * `npm test` ejecute Vitest sobre la población real.** El texto sí se ejecuta;
 * lo que ejecuta es reemplazable sin tocar el texto.
 *
 * ## Por qué es un ejecutable propio y no un test
 *
 * Porque un test que corre **bajo** `npm test` no puede detectar que `npm test`
 * sea un no-op: si lo es, el test no corre y su silencio se lee como verde. Es
 * el problema de arranque, y la única salida es una guarda **que no dependa del
 * alias que valida**. Este script se invoca con `node` directo desde el
 * workflow, igual que `verificar-mirror.mjs`.
 *
 * ## La población NO es una lista escrita a mano
 *
 * Los archivos de test se **derivan del filesystem** y se comparan contra lo que
 * el runner declara recolectar. Una exclusión nueva aparece como falta, sin que
 * nadie haya tenido que anticiparla: si la lista fuera escrita a mano, vigilaría
 * su propia copia en vez del universo real.
 *
 * ## Los modos
 *
 *   --aliases     (default) El CONJUNTO COMPLETO de `scripts` es exactamente el
 *                 adjudicado —así no puede existir un `pretest`—, no hay config
 *                 versionada que cambie el ejecutor, y la colección declarada de
 *                 Vitest y Playwright cubre todo lo que existe en disco.
 *   --corrida     Corre DESPUÉS de la suite: lee el reporte que Vitest escribió y
 *                 acredita QUÉ SE EJECUTÓ, no qué se iba a ejecutar.
 *   --invalidar   BORRA el resultado de una herramienta antes de correrla, para
 *                 que su reaparición sea la acreditación. Reemplaza al sello por
 *                 `mtime`, que era manipulable con un `touch`.
 *   --artefacto   Corre DESPUÉS del build: `dist` existe y tiene sustancia — y
 *                 como se borró antes, existir significa que ESTE build lo
 *                 escribió, sin depender de ninguna fecha.
 *
 * ## 🔴 Por qué hay modos «antes» y modos «después» (P90)
 *
 * Mirar el mundo antes de que la herramienta corra es un TOCTOU por
 * construcción: entre la aprobación y el uso pueden pasar hooks de npm, un
 * cambio de config u otro paso del workflow. La allowlist del conjunto de
 * scripts cierra la vía conocida; **los modos `--corrida` y `--artefacto`
 * cierran la clase**, porque no preguntan qué VA A pasar sino qué PASÓ.
 */
import { readFileSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
/**
 * La raíz es fija salvo que un test la redirija. **Esa variable no es una puerta
 * abierta en CI:** el arnés exige `env` EXACTAMENTE vacío para el paso que
 * invoca este script (rol `aliases` en `ENV_POR_ROL`), así que plantarla en el
 * workflow pone el gate rojo antes de que llegue a ejecutarse.
 */
const RAIZ = process.env.PAYME_RAIZ_VERIFICACION ?? join(AQUI, '..');

/**
 * 🔴 ALLOWLIST POSITIVA, valores EXACTOS.
 *
 * Un alias que no esté acá es rojo, se llame como se llame. Es la misma forma
 * que costó ocho vueltas adoptar para el `env` de los pasos: declarar lo bueno
 * en vez de enumerar lo malo. Cambiar uno de estos strings es una decisión
 * consciente que queda en el diff, que es exactamente lo que se busca.
 */
const ALIAS_ADJUDICADOS = Object.freeze({
  dev: 'vite',
  test: 'vitest run --reporter=default --reporter=json --outputFile=.vitest-corrida.json',
  typecheck:
    'tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.test.json && ' +
    'tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.e2e.json',
  build: 'tsc --noEmit -p tsconfig.json && vite build',
  'build:landing': 'vite build --config vite.landing.config.ts',
  preview: 'vite preview',
  e2e: 'playwright test',
});

/**
 * Config versionada que cambiaría el ejecutor de los scripts npm.
 *
 * 🔴 LA FRONTERA SE DECIDE ACÁ Y ES «NO EXISTE» (condición 3 del P88). Un
 * `.npmrc` con `script-shell` reemplaza el intérprete de TODO script npm, así
 * que `npm test` podría no ejecutar Vitest sin que cambie una letra del alias.
 * Se rechaza el archivo entero en vez de enumerar sus claves malas: si algún día
 * hace falta uno, se adjudica a mano y se escribe por qué.
 */
const CONFIG_PROHIBIDA = ['.npmrc'];

/**
 * 🔴 P90 · LAS EXTENSIONES SE DECLARAN ANCHAS, NO SE ESCRIBEN UNA A UNA.
 *
 * Acá había `/\.test\.ts$/`, y `src/walletRouteGuard.test.tsx` **existe y
 * Vitest lo recolecta**: el gate comparaba con igualdad exacta contra una
 * población INCOMPLETA y prometía «todos los archivos en disco». Excluir los
 * `tsx` de la config dejaba el gate en 0 mientras `npm test` bajaba de 1313 a
 * 1253 tests.
 *
 * ⚠️ **El defecto no fue olvidarse del `tsx`: fue escribir la extensión a mano.**
 * La forma que cierra es un patrón ANCHO —cualquier extensión de código con
 * `.test.` adentro—: si algo así existe y el runner no lo recolecta, es rojo. Un
 * universo más ancho que el real falla del lado seguro; uno más angosto miente.
 */
export const ES_TEST = /\.test\.[cm]?[jt]sx?$/;

/** Fuentes que un proyecto de TypeScript debería compilar, con sus variantes. */
export const ES_FUENTE_TS = /\.[cm]?tsx?$/;

const fallas = [];
const fallar = (m) => fallas.push(m);

/**
 * 🔴 LA LÓGICA SE EXPORTA PURA para que sus regresiones sean baratas.
 *
 * Sin esto, cada caso adversarial tendría que levantar un árbol entero con
 * `node_modules` para invocar el ejecutable, y **un test caro es un test que
 * alguien termina salteando**. Las dos funciones de abajo son las que deciden;
 * el ejecutable las orquesta y se prueba una vez, sano, de punta a punta.
 */
export function fallasDeAliases(scripts, existeConfig, entorno = {}) {
  const out = [];
  for (const [nombre, esperado] of Object.entries(ALIAS_ADJUDICADOS)) {
    const hallado = scripts?.[nombre];
    if (hallado !== esperado) {
      out.push(`el alias «${nombre}» no es el adjudicado — hallado: ${hallado ?? '(ausente)'}`);
    }
  }
  /**
   * 🔴 P90 · EL CONJUNTO COMPLETO, NO SÓLO LOS NOMBRES ESPERADOS — la raíz del
   * TOCTOU.
   *
   * Antes esto recorría **las cuatro claves que esperaba** y no miraba el resto,
   * así que un script NUEVO entraba sin adjudicar. Y npm ejecuta hooks de ciclo
   * de vida **entre la aprobación del gate y la herramienta**: un `pretest` que
   * reescribe la config deja `npm test` en 0 con 84 archivos y 1084 tests, sin
   * los 13 de `scripts/`; un `prebuild` con `build.write=false` transforma 110
   * módulos, sale 0 y **no escribe nada**.
   *
   * 🔴 **Chequear y después dejar que el mundo cambie antes de usarlo es un
   * TOCTOU, y no se cierra enumerando `pre*`/`post*`:** se cierra declarando el
   * conjunto ENTERO de scripts. Cualquier clave que no esté arriba es roja, se
   * llame como se llame — un `pretest` no puede existir sin venir acá primero.
   */
  const declarados = new Set(Object.keys(ALIAS_ADJUDICADOS));
  for (const nombre of Object.keys(scripts ?? {})) {
    if (!declarados.has(nombre)) {
      out.push(
        `el script «${nombre}» NO está adjudicado — npm corre los hooks de ciclo de vida ` +
          'entre este gate y la herramienta, así que puede cambiar lo que la herramienta ve',
      );
    }
  }
  for (const archivo of CONFIG_PROHIBIDA) {
    if (existeConfig(archivo)) {
      out.push(`${archivo} existe y puede cambiar el ejecutor de TODO script npm`);
    }
  }
  for (const v of ['npm_config_script_shell', 'NODE_OPTIONS', 'BASH_ENV']) {
    if (entorno[v]) out.push(`la variable ${v} está definida y puede volver no-op a los gates`);
  }
  return out;
}

/**
 * 🔴 P94 · INVALIDACIÓN EFECTIVA PREVIA — la ausencia es la prueba.
 *
 * Antes esto era un SELLO: se escribía un archivo antes de la herramienta y se
 * exigía que el resultado tuviera `mtime` posterior. Tapaba el exploit conocido
 * —un reporte viejo pasando por verde— **y su instrumento era manipulable**:
 *
 * ```
 * sellar → (NO se corre el build) → touch dist/* → gate
 * ── artefacto OK: «lo escribió ESTA ejecución»      exit 0   ← falso
 * ```
 *
 * 🔴 **`mtime` lo mueve cualquiera que controle el filesystem, así que arreglé
 * «no midas con un instrumento que el atacante mueve» con OTRO instrumento que
 * el atacante mueve.** Verificamos que el fix tapaba el exploit; no preguntamos
 * de qué dependía la evidencia NUEVA. Son dos preguntas y la segunda es la que
 * decide.
 *
 * La salida no fue afinar el sello sino cambiarlo: **se BORRA el resultado antes
 * de correr la herramienta, y su existencia después es la prueba.** No depende
 * de ninguna fecha, no hay nada que falsificar con un `touch`, y el arnés queda
 * más chico. Codex lo llama «invalidación efectiva previa».
 *
 * ⚠️ **Destructivo en local, a propósito y documentado:** correr el gate borra
 * tu `dist` y tu reporte. Los dos están gitignored y se reconstruyen con un
 * rebuild — es el precio de que la ausencia signifique algo.
 */
const INVALIDABLES = Object.freeze({
  corrida: '.vitest-corrida.json',
  build: 'dist',
});

/** Los archivos que existen en disco y el runner NO recolecta. */
export function faltantesDeColeccion(enDisco, recolectados) {
  if (enDisco.length === 0) return ['__VACIO__'];
  const set = new Set(recolectados);
  return enDisco.filter((f) => !set.has(f));
}

/**
 * 🔴 LOS PROYECTOS DE TYPESCRIPT, encontrado al ENUMERAR LA CLASE.
 *
 * Ningún dictamen lo nombró. El alias `typecheck` puede ser exactamente el
 * adjudicado y aun así no verificar casi nada, porque **lo que `tsc` compila lo
 * decide el `tsconfig`, no el comando**:
 *
 *   · `include: []`        → exit **2**. Falla cerrado, no es vector.
 *   · `include: ['src/main.tsx']` → exit **0** compilando **1** archivo de 78.
 *
 * El segundo es un falso verde medido en este repo. La invariante que lo cierra
 * no es una lista escrita a mano: **la unión de los proyectos tiene que cubrir
 * todo el TypeScript que existe en disco.** Un archivo nuevo que nadie incluyó
 * aparece como falta sin que haya que anticiparlo.
 */
export function fuentesSinProyecto(enDisco, cubiertos) {
  if (enDisco.length === 0) return ['__VACIO__'];
  const set = new Set(cubiertos);
  return enDisco.filter((f) => !set.has(f));
}

/**
 * 🔴 P94 · LA RAÍZ TAMBIÉN ES UNIVERSO — y quedaba afuera de los dos censos.
 *
 * Los censos recorrían `src/`, `scripts/`, `e2e/` y `landing/`. Un `.mts` en la
 * RAÍZ con un error de tipo real (`const n: number = 'texto'`) dejaba **el
 * typecheck en 0 y el gate en 0**: la extensión ancha cubría el nombre, pero
 * ningún recorrido pasaba por ahí.
 *
 * Se lista PLANO y no recursivo a propósito: recursivo desde la raíz barrería
 * `dist/`, `coverage/` y todo lo generado, y un universo lleno de artefactos
 * daría rojos que no son defectos.
 */
function buscarEnRaiz(re) {
  return readdirSync(RAIZ, { withFileTypes: true })
    .filter((e) => e.isFile() && !e.name.startsWith('.') && re.test(e.name))
    .map((e) => e.name);
}

/** Archivos bajo `dir` que matcheen `re`, recursivo, ignorando `node_modules`. */
function buscar(dir, re, acc = []) {
  // Un directorio ausente NO explota con un stack: devuelve vacío, y el control
  // de no-vacuidad de cada acreditación lo convierte en rojo con su motivo. Un
  // gate que muere por ENOENT no dice qué faltaba.
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) buscar(p, re, acc);
    else if (re.test(e.name)) acc.push(relative(RAIZ, p));
  }
  return acc;
}

/**
 * 🔴 EL EJECUTABLE CONSUME LA MISMA FUNCIÓN QUE LOS TESTS — no una copia.
 *
 * Es la lección del P85 aplicada de entrada: si el `main` reimplementara la
 * adjudicación, los tests probarían la función y el gate correría el atajo, y
 * desconectar uno dejaría al otro verde.
 */
function adjudicarAliases() {
  const pkg = JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8'));
  for (const f of fallasDeAliases(
    pkg.scripts ?? {},
    (archivo) => existsSync(join(RAIZ, archivo)),
    process.env,
  )) {
    fallar(f);
  }
}

/**
 * Colección REAL de un runner contra la población que existe en disco.
 *
 * ⚠️ El control positivo es parte del mecanismo: si el glob no encontrara
 * archivos, el `every` de abajo pasaría en vacío y esto certificaría una
 * población inexistente.
 */
function acreditarColeccion(etiqueta, enDisco, listar) {
  if (enDisco.length === 0) {
    fallar(`${etiqueta}: no se encontró NINGÚN archivo en disco — se mediría en vacío`);
    return;
  }
  let recolectados;
  try {
    recolectados = listar();
  } catch (e) {
    fallar(`${etiqueta}: no se pudo listar la colección — ${e.message.split('\n')[0]}`);
    return;
  }
  /**
   * 🔴 PERTENENCIA EXACTA A UN `Set`, no `includes` sobre un texto. Un path que
   * fuera PREFIJO de otro pasaría como recolectado — la misma clase que el gate
   * del espejo ya había pagado con `grep -F`, y que el censo pagó comparando
   * comandos por prefijo de cadena en vez de por token.
   */
  const ausentes = faltantesDeColeccion(enDisco, recolectados);
  if (ausentes.length > 0) {
    fallar(
      `${etiqueta}: ${ausentes.length} de ${enDisco.length} archivos EXISTEN en disco pero el ` +
        `runner NO los recolecta — el verde no cubriría lo que dice cubrir:\n     ` +
        ausentes.slice(0, 8).join('\n     '),
    );
  }
}

function adjudicarPoblacion() {
  const unitarios = [
    ...buscar(join(RAIZ, 'src'), ES_TEST),
    ...buscar(join(RAIZ, 'scripts'), ES_TEST),
    ...buscar(join(RAIZ, 'landing'), ES_TEST),
    ...buscarEnRaiz(ES_TEST),
  ];
  acreditarColeccion('Vitest', unitarios, () =>
    execFileSync('npx', ['vitest', 'list', '--filesOnly'], {
      cwd: RAIZ,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 32 * 1024 * 1024,
    })
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean),
  );

  const e2e = buscar(join(RAIZ, 'e2e'), /\.spec\.ts$/);
  /**
   * Playwright reporta sus archivos **relativos a `testDir`**, no a la raíz. Se
   * reconstruye con el `rootDir` que el propio runner declara, en vez de asumir
   * el prefijo: si alguien mueve `testDir`, esto sigue midiendo bien.
   */
  acreditarColeccion('Playwright', e2e, () => {
    const json = JSON.parse(
      execFileSync('npx', ['playwright', 'test', '--list', '--reporter=json'], {
        cwd: RAIZ,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 64 * 1024 * 1024,
      }),
    );
    const root = json.config.rootDir;
    return (json.suites ?? []).map((s) => relative(RAIZ, join(root, s.file)));
  });
}

/**
 * 🔴 P90 · LA CORRIDA QUE DE VERDAD PASÓ — el efecto terminal, no la foto previa.
 *
 * El modo `--aliases` mira el mundo **antes** de que las herramientas corran, y
 * eso es un TOCTOU por construcción: entre la aprobación y el uso pueden pasar
 * hooks de npm, un cambio de config, otro paso del workflow. La allowlist del
 * conjunto de scripts cierra la vía conocida; **esto cierra la clase**, porque no
 * pregunta qué VA A correr sino qué **corrió**.
 *
 * Lee el reporte que la corrida real de Vitest escribió y compara sus archivos
 * contra los que existen en disco. Si algo recortó la población entre medio, el
 * reporte lo dice: no hay forma de recolectar menos y reportar más.
 *
 * ⚠️ Fail-closed en las dos puntas: sin reporte, o con un reporte que no nombre
 * archivos, es ROJO. «No pude medir» nunca es «salió bien».
 */
function acreditarCorrida() {
  const ruta = join(RAIZ, '.vitest-corrida.json');
  if (!existsSync(ruta)) {
    fallar(
      'no existe `.vitest-corrida.json`: la suite no dejó constancia de qué recolectó ' +
        '— sin ese registro, «pasó todo» y «no corrió nada» son indistinguibles',
    );
    return;
  }
  // 🔴 P94 · La frescura ya no se compara: el reporte se BORRA antes de la
  // suite, así que existir es haber sido escrito por esta corrida. El `if` de
  // arriba —que exige su existencia— es toda la guarda, y no depende de fechas.
  let reporte;
  try {
    reporte = JSON.parse(readFileSync(ruta, 'utf8'));
  } catch (e) {
    fallar(`el reporte de la corrida no es JSON legible — ${e.message.split('\n')[0]}`);
    return;
  }
  const corridos = (reporte.testResults ?? [])
    .map((r) => (typeof r.name === 'string' ? relative(RAIZ, r.name) : null))
    .filter((f) => f !== null && !f.startsWith('..'));
  const enDisco = [
    ...buscar(join(RAIZ, 'src'), ES_TEST),
    ...buscar(join(RAIZ, 'scripts'), ES_TEST),
    ...buscar(join(RAIZ, 'landing'), ES_TEST),
    ...buscarEnRaiz(ES_TEST),
  ];
  const ausentes = faltantesDeColeccion(enDisco, corridos);
  if (ausentes[0] === '__VACIO__') {
    fallar('no hay archivos de test en disco: la comprobación de la corrida mediría en vacío');
  } else if (ausentes.length > 0) {
    fallar(
      `la corrida REAL de Vitest no ejecutó ${ausentes.length} de ${enDisco.length} archivos que ` +
        `existen en disco — el verde cubre menos de lo que dice:\n     ` +
        ausentes.slice(0, 8).join('\n     '),
    );
  }
  // Control positivo: un reporte con cero resultados pasaría el filtro de arriba
  // por vacuidad si el disco también estuviera vacío; acá se afirma que corrió.
  if (corridos.length === 0) {
    fallar('el reporte no nombra ningún archivo ejecutado: la suite no corrió');
  }
}

/**
 * 🔴 EL ARTEFACTO, no el exit code.
 *
 * Un alias de build no-op sale 0 y no deja nada. Se mide lo que quedó en disco:
 * el `index.html` y al menos un bundle con sustancia. Es la misma regla que los
 * controles por marca del arnés — **medir con el instrumento que el ataque
 * manipula es no medir**.
 */
function acreditarArtefacto(dir) {
  /**
   * 🔴 P90 · EL DIRECTORIO ES FIJO, no un argumento libre.
   *
   * Con un `dir` cualquiera, `--artefacto .` salía **0**: encontraba el
   * `index.html` de la raíz y un `.js` ajeno de `contract-mirror`. El gate
   * certificaba «el build dejó artefacto» mirando archivos que no eran del build.
   */
  if (dir !== 'dist') {
    fallar(`el destino «${dir}» no es el adjudicado: sólo se acredita \`dist\``);
    return;
  }
  const base = join(RAIZ, dir);
  /**
   * 🔴 Y LOS BYTES TIENEN QUE SER DE ESTA EJECUCIÓN — antes bastaba con que
   * existieran. Un `dist` viejo, de otro build, pasaba: `prebuild` podía fijar
   * `build.write=false` y Vite transformaba 110 módulos, salía 0 y no escribía
   * nada, mientras el gate aprobaba el artefacto anterior.
   *
   * 🔴 P96 · ESTE PÁRRAFO DESCRIBÍA UN SELLO QUE YA NO EXISTE, y por eso se
   * corrige en vez de borrarse: decía «el sello se escribe ANTES del build y se
   * compara contra las fechas», o sea afirmaba un mecanismo retirado **justo
   * donde alguien iría a verificarlo**. Es la misma clase que la regex de
   * `setup-node` bajo un comentario que prometía versión exacta.
   *
   * Lo vigente: `dist` se BORRA antes del build (`--invalidar build`), así que
   * su existencia después ES la acreditación. Sin fechas, sin nada que un
   * `touch` pueda mover.
   */
  if (!existsSync(base)) {
    fallar(`el build no dejó «${dir}»: el comando salió 0 sin producir artefacto`);
    return;
  }
  const html = join(base, 'index.html');
  if (!existsSync(html)) {
    fallar(`«${dir}» existe pero no tiene index.html`);
    return;
  }

  const bundles = buscar(base, /\.js$/);
  const frescos = bundles.filter((f) => statSync(join(RAIZ, f)).size > 1024);
  if (frescos.length === 0) {
    fallar(
      `«${dir}» no tiene ningún bundle .js con sustancia escrito por ESTA ejecución: ` +
        'el build fue no-op y quedó el artefacto anterior',
    );
  }
}

/**
 * La unión de los proyectos TS cubre todo el TypeScript del repo.
 *
 * Los proyectos se leen del propio alias `typecheck` —no de una lista aparte—,
 * así que sacar un `-p` del alias mueve las dos cosas a la vez y no puede quedar
 * una copia desactualizada vigilando a la otra.
 */
function adjudicarProyectosTs() {
  const pkg = JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8'));
  const proyectos = [...(pkg.scripts?.typecheck ?? '').matchAll(/-p\s+(\S+)/g)].map((m) => m[1]);
  if (proyectos.length === 0) {
    fallar('el alias `typecheck` no nombra ningún proyecto: se mediría en vacío');
    return;
  }
  const cubiertos = new Set();
  for (const proy of proyectos) {
    /**
     * 🔴 `--listFiles`, NO `showConfig.files`, y la diferencia me mordió.
     *
     * `showConfig` lista las RAÍCES que el `include` resuelve; `--listFiles`
     * lista lo que tsc **procesa**, que incluye lo importado transitivamente.
     * Con el primero, `scripts/yamlWorkflow.ts` figuraba como no cubierto —lo
     * importa su test, así que tsc SÍ lo chequea—. **Era un falso positivo del
     * instrumento, no un hueco del repo**, y de haberle creído habría "arreglado"
     * un tsconfig sano. Verificar el instrumento antes de creerle es la regla.
     */
    let salida;
    try {
      salida = execFileSync('npx', ['tsc', '-p', proy, '--noEmit', '--listFiles'], {
        cwd: RAIZ,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch (e) {
      fallar(`no se pudo resolver «${proy}» — ${e.message.split('\n')[0]}`);
      continue;
    }
    for (const linea of salida.split('\n')) {
      const f = linea.trim();
      if (!f || f.includes('node_modules')) continue;
      const rel = relative(RAIZ, f);
      if (!rel.startsWith('..')) cubiertos.add(rel);
    }
  }
  const enDisco = [
    ...buscar(join(RAIZ, 'src'), ES_FUENTE_TS),
    ...buscar(join(RAIZ, 'scripts'), ES_FUENTE_TS),
    ...buscar(join(RAIZ, 'e2e'), ES_FUENTE_TS),
    ...buscar(join(RAIZ, 'landing'), ES_FUENTE_TS),
    ...buscarEnRaiz(ES_FUENTE_TS),
  ];
  const huerfanos = fuentesSinProyecto(enDisco, [...cubiertos]);
  if (huerfanos[0] === '__VACIO__') {
    fallar('no se encontró TypeScript en disco: el chequeo de proyectos mediría en vacío');
  } else if (huerfanos.length > 0) {
    fallar(
      `${huerfanos.length} de ${enDisco.length} fuentes .ts/.tsx EXISTEN y NINGÚN proyecto de ` +
        `\`typecheck\` las compila — saldría 0 sin verificarlas:\n     ` +
        huerfanos.slice(0, 8).join('\n     '),
    );
  }
}

/** Borra el resultado de una herramienta, para que su reaparición lo acredite. */
function invalidar(cual) {
  const objetivo = INVALIDABLES[cual];
  if (objetivo === undefined) {
    fallar(`«${cual}» no es invalidable: sólo ${Object.keys(INVALIDABLES).join(' y ')}`);
    return;
  }
  rmSync(join(RAIZ, objetivo), { recursive: true, force: true });
}

/**
 * 🔴 P94 · EL CLI SÓLO CORRE COMO SCRIPT, NUNCA AL SER IMPORTADO.
 *
 * Sin este guard, `import { ES_TEST } from './verificar-aliases.mjs'` ejecutaba
 * el gate ENTERO dentro del test —incluido su `process.exit`—. Apareció al hacer
 * que el centinela importe los patrones productivos en vez de copiarlos: el
 * arreglo correcto destapó que el módulo no era importable de verdad.
 */
if (import.meta.url !== pathToFileURL(process.argv[1] ?? '').href) {
  // Importado como módulo: sólo se exponen las funciones puras.
} else {

const modo = process.argv[2] ?? '--aliases';
if (modo === '--aliases') {
  adjudicarAliases();
  adjudicarProyectosTs();
  adjudicarPoblacion();
} else if (modo === '--corrida') {
  acreditarCorrida();
} else if (modo === '--invalidar') {
  invalidar(process.argv[3] ?? '(sin nombre)');
} else if (modo === '--artefacto') {
  acreditarArtefacto(process.argv[3] ?? '(sin destino)');
} else {
  console.error(`modo desconocido: ${modo} (usar --aliases o --artefacto)`);
  process.exit(2);
}

if (fallas.length > 0) {
  console.error('❌ el alias no acredita su herramienta:\n');
  for (const f of fallas) console.error(`  · ${f}`);
  console.error(
    '\n  Un gate que sale 0 sin ejecutar su herramienta deja publicar sobre una ' +
      'verificación que no verificó.',
  );
  process.exit(1);
}
console.log(
  {
    '--aliases':
      '── aliases OK: el conjunto de scripts es el adjudicado y la colección declarada cubre ' +
      'todo lo que existe en disco.',
    '--corrida': '── corrida OK: la suite EJECUTÓ todos los archivos de test que existen en disco.',
    '--invalidar': '── invalidado: el resultado anterior se borró, así que reaparecer lo acredita.',
    '--artefacto': '── artefacto OK: `dist` lo escribió ESTA ejecución, no un build anterior.',
  }[modo],
);

}
