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
 *   --aliases     (default) Los `scripts` de `package.json` son EXACTAMENTE los
 *                 adjudicados; no hay config versionada que cambie el ejecutor;
 *                 y la COLECCIÓN real de Vitest y Playwright cubre todos los
 *                 archivos que existen en disco.
 *   --artefacto   Corre DESPUÉS del build: acredita que quedó un artefacto con
 *                 sustancia, no que el comando haya salido 0.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  test: 'vitest run',
  typecheck:
    'tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.test.json && ' +
    'tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.e2e.json',
  build: 'tsc --noEmit -p tsconfig.json && vite build',
  'build:landing': 'vite build --config vite.landing.config.ts',
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

/** Archivos bajo `dir` que matcheen `re`, recursivo, ignorando `node_modules`. */
function buscar(dir, re, acc = []) {
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
    ...buscar(join(RAIZ, 'src'), /\.test\.ts$/),
    ...buscar(join(RAIZ, 'scripts'), /\.test\.ts$/),
    ...buscar(join(RAIZ, 'landing'), /\.test\.ts$/),
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
 * 🔴 EL ARTEFACTO, no el exit code.
 *
 * Un alias de build no-op sale 0 y no deja nada. Se mide lo que quedó en disco:
 * el `index.html` y al menos un bundle con sustancia. Es la misma regla que los
 * controles por marca del arnés — **medir con el instrumento que el ataque
 * manipula es no medir**.
 */
function acreditarArtefacto(dir) {
  const base = join(RAIZ, dir);
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
  const grandes = bundles.filter((f) => statSync(join(RAIZ, f)).size > 1024);
  if (grandes.length === 0) {
    fallar(`«${dir}» no tiene ningún bundle .js con sustancia (>1KB): el build fue no-op`);
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
    ...buscar(join(RAIZ, 'src'), /\.tsx?$/),
    ...buscar(join(RAIZ, 'scripts'), /\.tsx?$/),
    ...buscar(join(RAIZ, 'e2e'), /\.tsx?$/),
    ...buscar(join(RAIZ, 'landing'), /\.tsx?$/),
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

const modo = process.argv[2] ?? '--aliases';
if (modo === '--aliases') {
  adjudicarAliases();
  adjudicarProyectosTs();
  adjudicarPoblacion();
} else if (modo === '--artefacto') {
  acreditarArtefacto(process.argv[3] ?? 'dist');
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
  modo === '--aliases'
    ? '── aliases OK: cada comando del CI ejecuta la herramienta adjudicada, y la colección ' +
        'real cubre todos los archivos en disco.'
    : '── artefacto OK: el build dejó un bundle con sustancia, no sólo un exit 0.',
);
