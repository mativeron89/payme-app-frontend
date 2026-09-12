/**
 * EL GATE DE ORIGEN, EN UN COMANDO.
 *
 * Corre el E2E con el trace encendido y después mide contra qué orígenes habló el
 * navegador. Une las dos mitades, que viven separadas a propósito:
 *
 *   1. `e2e/_reporter-origen.ts`      → CONFIGURACIÓN efectiva resuelta por el runner.
 *   2. `scripts/extraer-origenes.mjs` → TRÁFICO observado en la entrada de red del trace.
 *
 * ## Por qué el trace se enciende acá y no en el config
 *
 * `playwright.config.ts` usa `trace: 'retain-on-failure'`: una corrida verde no deja
 * traza, y sin traza no hay tráfico que medir. Ponerlo en `'on'` para siempre le cobraría
 * el costo a todas las corridas de desarrollo.
 *
 * 🔴 **Y eso tiene una consecuencia que hay que decir, no tapar: este gate es OPT-IN.**
 * `npm run e2e` sigue siendo `playwright test` y NO ejecuta el extractor, así que una
 * corrida verde normal no acredita nada sobre orígenes. Mientras no exista un wiring
 * explícito y autorizado que lo haga gobernar el cierre, **este gate es MANUAL y no es
 * compuerta por defecto**. Está declarado así en la evidencia de la orden; decirlo acá
 * evita que alguien lea «existe el gate» como «el gate corre».
 *
 * ## 🔴 El origen esperado se DERIVA, no se copia
 *
 * El control positivo necesita saber contra qué origen debería haber hablado la corrida.
 * Ese valor se lee del informe del reporter —o sea, de lo que el runner resolvió de
 * verdad— y no se escribe a mano acá ni en `package.json`. Una segunda copia de
 * `http://localhost:5176` se desalinea el día que alguien cambie el puerto, y lo hace en
 * silencio: el gate seguiría verde midiendo contra un origen que ya no es el suyo.
 *
 * ## 🔴 Los argumentos extra se validan fail-closed
 *
 * Se aceptan sólo filtros de selección. Todo lo que pueda **desacoplar la corrida del
 * directorio que después se mide** se rechaza: `--output` cambiaría dónde caen los
 * traces, `--trace` podría apagarlos, `--config` y `--reporter` cambiarían el runner o
 * sacarían el reporter que produce el control positivo. Un gate que mide un directorio
 * distinto del que corrió no mide nada, y la falla sería silenciosa.
 *
 * Uso:  node scripts/gate-origen.mjs [filtros de test | --grep <re> | --project <p>]
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServer } from 'node:net';
import { platform } from 'node:os';

import { censarDirectorio, entrypointLocal, envSaneado, exigirContenida } from './anclar-local.mjs';
import { rutaPublicable } from './redactar.mjs';
import { extraerDeDirectorio, VEREDICTOS } from './extraer-origenes.mjs';

/**
 * 🔴 La raíz se deriva de la UBICACIÓN DE ESTE ARCHIVO, no de `process.cwd()`.
 *
 * Con `cwd` el gate borraba y medía el directorio desde donde alguien lo hubiera invocado:
 * un `cd` equivocado y limpia un `test-results/` ajeno. Este script vive en `<raiz>/scripts/`,
 * así que su propia ruta ES la raíz, y no depende de quién lo llame ni desde dónde.
 *
 * Y no alcanza con derivarla: se COMPRUEBA que sea el repo esperado antes de borrar nada.
 * Un `rm -rf` que confía en una ruta calculada es exactamente cómo se pierde evidencia.
 */
const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));

function validarIdentidadDeRaiz() {
  const pkg = join(RAIZ, 'package.json');
  if (!existsSync(pkg)) return `no hay package.json en ${RAIZ}`;
  let nombre;
  try {
    nombre = JSON.parse(readFileSync(pkg, 'utf8')).name;
  } catch (e) {
    return `package.json ilegible en ${RAIZ}: ${e.message}`;
  }
  if (nombre !== 'payme-app-frontend') return `package.json dice name="${nombre}", esperaba payme-app-frontend`;
  if (!existsSync(join(RAIZ, 'playwright.config.ts'))) return `no hay playwright.config.ts en ${RAIZ}`;
  return null;
}
const SALIDA = join(RAIZ, 'test-results');
const CONFIG_JSON = join(SALIDA, 'origen-config.json');
const TRAFICO_JSON = join(SALIDA, 'origenes-trafico.json');

/**
 * 🔴 Banderas del GATE, que no viajan a Playwright.
 *
 * Se extraen antes de validar el resto: si se colaran en el `argv` del runner, Playwright las
 * rechazaría y la falla parecería del candidato y no de la invocación.
 */
const BANDERAS_DEL_GATE = Object.freeze(['--descartar-salida-previa']);

/** Banderas que desacoplarían la corrida de lo que se mide. Lista cerrada, fail-closed. */
const PROHIBIDAS = Object.freeze([
  '--output',
  '--trace',
  '--config',
  '-c',
  '--reporter',
  '--test-results-dir',
  '--pass-with-no-tests',
]);

/**
 * 🔴 DENY DE EGRESS PRE-LAUNCH · ítems 1 y 8.
 *
 * `sandbox-exec` tiene que ser **ANCESTRO** del runner, no envolver una hoja. El árbol real
 * es `runner → Chromium` y `runner → webServer (Vite)`: envolver sólo a Vite dejaría al
 * navegador afuera, que es precisamente quien habla con la red. Por eso el wrapper se
 * antepone al `process.execPath` del runner y lo hereda todo lo que cuelgue de él.
 *
 * ✅ **ACREDITADO POR EJECUCIÓN · perfil sha256 `ddd1a83c79b15ab2253f909e7c7eecf8502647d5b57252c1bf9ab712b18818f2`.**
 *
 * | medición | cuándo | sobre qué | dónde quedó |
 * |---|---|---|---|
 * | el perfil compila; `node` arranca adentro; loopback permitido; IP cruda, nombre (DNS+TLS) e IPv6 externos `EPERM`; **el mismo destino SIN sandbox conecta** | 2026-09-11T17:11–17:12Z | escalones 1–3e | cabecera de `scripts/deny-egress.sb` |
 * | Chromium arranca adentro y el E2E completo corre: **211 passed** | fin `2026-09-11T20:21:39Z` (mtime del log) | `0071671b` | `c26/paso-13-p2.log` |
 * | veredicto del censo de tráfico: `MEDIDO_SOLO_LOOPBACK_CERO_ORIGENES_EXTERNOS`, 22 557 URLs, 5 orígenes, 0 externos | fin `2026-09-11T20:31:43Z` (mtime del log) | `0071671b` | `c26/gate-origen-0071671.log` |
 *
 * 🔴 **DÓNDE VIVEN ESOS TRES ARTEFACTOS, y por qué importa:** en el **corpus CONGELADO** del
 * programa anterior, `~/.codex/runs/payme-app-ops-autonomy-20260910-v2/app-frontend/c26/` —
 * **no** en la evidencia de la orden que escribió este rótulo. Son mediciones **reutilizadas**,
 * lo cual está autorizado («no se repite ejecución sólo para retitular»); lo que no se puede es
 * fecharlas como si se hubieran corrido acá.
 *
 * ⚠️ **La fecha es la del ARTEFACTO, leída de su `mtime` en UTC, y no se deriva de nada.** El
 * `Start at` que imprime Vitest adentro del log viene en hora **local sin zona**: convertirlo
 * sería exactamente el defecto que esta corrección repara. El inicio, cuando hace falta, sale de
 * `gates-fase-w.jsonl` del mismo corpus, que lo registró en UTC directo (`C26-13-P2` inicio
 * `2026-09-11T20:15:00Z`; `C26-GATE-ORIGEN` inicio `2026-09-11T20:29:41Z`).
 *
 * 📌 **Estas dos celdas decían `2026-09-12T00:15–00:21Z` y `00:29–00:35Z`, y eran falsas.** Las
 * escribí corriendo la hora local `-0600` y publicándola como UTC del día siguiente — con los
 * minutos intactos, que es la firma del error. Lo cazó la auditoría independiente de Qwen sobre
 * `e022c874`, y el agravante queda escrito: el sidecar de esas mismas corridas ya tenía los
 * valores correctos en UTC y no los consulté. **Derivé en vez de leer, en el rótulo cuyo objeto
 * era que las fechas se leyeran.**
 *
 * 🔴 **ALCANCE, que es la mitad que se pierde cuando un rótulo se acorta.** Lo medido es
 * egress **TCP**: no se enumeraron protocolos fuera de TCP, y nada de esto prueba que NO
 * exista ningún camino de salida — prueba que los que se probaron están cerrados y que el
 * control del control (3e) descarta que «bloqueado» fuera simplemente «no había red».
 *
 * 📌 **Histórico, con su condición:** hasta el 2026-09-11 este bloque decía
 * `NO_ACREDITADO_POR_EJECUCION` y **era cierto bajo su condición** — la fase P3 prohibía
 * ejecutar—. Lo que lo volvió falso fue que la fase cambió y se ejecutó, no un error de quien
 * lo escribió. Se reemplaza en vez de conservarse porque un rótulo que dice «no se corrió» al
 * lado de una impresión que dice «deny verificado» no es historia: es una contradicción viva
 * en el mismo archivo, y quien la lea no tiene forma de saber cuál de las dos manda.
 *
 * ⚠️ **C2-2 quedó EXPLICADO, no abierto.** Aquel abort de Chromium en `dyld`/`CacheFinder`
 * antes de `main()` venía de un perfil que **restringía archivos** sin el nodo raíz de lectura.
 * Éste no restringe archivos: hereda `(allow default)` y toca sólo la red. Lo que lo cierra no
 * es el argumento sino que el E2E corrió adentro.
 *
 * **Fail-closed en las tres direcciones**: sin `sandbox-exec`, sin perfil, o fuera de Darwin,
 * el gate NO lanza. «No pude contener» jamás puede terminar en «corrí sin contención».
 */
const SANDBOX_EXEC = '/usr/bin/sandbox-exec';
const PERFIL_DENY = join(RAIZ, 'scripts', 'deny-egress.sb');

/** Lo único que se permite: seleccionar QUÉ tests corren, nunca CÓMO ni DÓNDE. */
const PERMITIDAS_CON_VALOR = Object.freeze(['--grep', '-g', '--grep-invert', '--project', '--workers', '--repeat-each']);
const PERMITIDAS_SOLAS = Object.freeze(['--headed', '--fully-parallel']);

function validarArgs(args) {
  const problemas = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (!a.startsWith('-')) continue; // patrón de archivo/test: se permite
    const nombre = a.includes('=') ? a.slice(0, a.indexOf('=')) : a;
    if (PROHIBIDAS.includes(nombre)) {
      problemas.push(`«${nombre}» está prohibida: desacoplaría la corrida del directorio que este gate mide`);
      continue;
    }
    if (PERMITIDAS_CON_VALOR.includes(nombre)) {
      if (a.includes('=')) {
        if (a.slice(a.indexOf('=') + 1) === '') problemas.push(`«${nombre}=» viene sin valor`);
        continue;
      }
      const valor = args[i + 1];
      // 🔴 Dos formas de colar una opción: dejarla sin valor —y que consuma el siguiente
      // argumento como si lo fuera— o pasar como «valor» algo que empieza con «-», que el
      // runner volvería a leer como opción. Las dos se rechazan.
      if (valor === undefined) {
        problemas.push(`«${nombre}» viene sin valor`);
        continue;
      }
      if (valor.startsWith('-')) {
        problemas.push(`«${nombre}» recibe «${valor}», que empieza con «-»: seria una opcion camuflada de valor`);
        continue;
      }
      i += 1; // consume su valor
      continue;
    }
    if (PERMITIDAS_SOLAS.includes(nombre)) continue;
    problemas.push(`«${nombre}» no está en la lista de opciones permitidas (fail-closed: lo no declarado se rechaza)`);
  }
  return problemas;
}

const argv = process.argv.slice(2);
const descartarSalidaPrevia = argv.includes('--descartar-salida-previa');
const extra = argv.filter((a) => !BANDERAS_DEL_GATE.includes(a));
const problemas = validarArgs(extra);
if (problemas.length > 0) {
  for (const p of problemas) process.stderr.write(`gate-origen: ${p}\n`);
  process.stderr.write(`gate-origen: permitidas — ${[...PERMITIDAS_CON_VALOR, ...PERMITIDAS_SOLAS].join(' ')} y patrones de test\n`);
  process.exit(2);
}

/**
 * 🔴 Playwright se resuelve LOCAL y se ejecuta con este mismo Node, nunca por `npx`.
 *
 * `npx` sale a buscar la herramienta y el PATH decide cuál corre. Este repo ya pagó esa
 * cuenta: `npx tsc` desde una raíz sin dependencias **descarga y ejecuta un paquete
 * okupa llamado `tsc`** que no es el compilador —está documentado en
 * `scripts/aliasesLib.mjs`—. Un gate cuya herramienta la elige el entorno no es un gate.
 *
 * Mismo mecanismo que el precedente del repo (`entrypointLocal`): ruta dentro de
 * `node_modules` del worktree y `existsSync`. Si no está, se falla cerrado: «no encontré
 * el runner» nunca puede terminar en «no vi orígenes externos».
 */
let CLI_PLAYWRIGHT;
let VERSION_PLAYWRIGHT;
try {
  // 🔴 Ya no alcanza con `join` + `existsSync`: el anclaje resuelve por `realpath`, comprueba
  // que el resultado siga DENTRO del worktree, y exige que la version instalada sea
  // exactamente la del lock. Un `node_modules` que derivo del lock mide otro codigo.
  const anclado = entrypointLocal({
    raiz: RAIZ,
    desde: import.meta.url,
    paquete: '@playwright/test',
    subruta: 'cli.js',
  });
  CLI_PLAYWRIGHT = anclado.ruta;
  VERSION_PLAYWRIGHT = anclado.version;
} catch (e) {
  process.stderr.write(`gate-origen: no pude anclar el CLI local de Playwright — ${e.message}\n`);
  process.exit(5);
}

/**
 * 🔴 LA LIMPIEZA VA ACÁ, DESPUÉS DE TODAS LAS PRECONDICIONES, Y NO ANTES.
 *
 * Antes era lo primero que hacía el script, y eso costó evidencia real: una prueba de
 * fail-closed —esconder el CLI local para comprobar que el gate aborta sin lanzar nada—
 * entró por la limpieza, **borró 211 traces de una corrida ya hecha**, y recién después
 * salió por el `exit 5`. El control funcionó; el efecto colateral no estaba previsto.
 *
 * La regla que sale de ahí: un gate que puede fallar cerrado **no destruye nada hasta haber
 * pasado todas sus validaciones**. Limpiar es lo último antes de lanzar, nunca lo primero.
 */
const problemaDeRaiz = validarIdentidadDeRaiz();
if (problemaDeRaiz !== null) {
  process.stderr.write(`gate-origen: la raiz derivada no es el repo esperado — ${problemaDeRaiz}. No borro nada.\n`);
  process.exit(6);
}
/**
 * 🔴 PREFLIGHT COMPLETO, Y ANTES DE TOCAR NADA · ítem 7.
 *
 * Antes de esto el gate anclaba el CLI y validaba la raíz, y **después borraba**: si la
 * config no estaba, si Vite no resolvía o si el 5176 estaba ocupado, la limpieza ya se había
 * llevado la corrida anterior y recién entonces se descubría que no se podía correr. Destruir
 * primero y averiguar después es la forma general de INC-08, no su instancia.
 *
 * Todo lo que pueda impedir la corrida se comprueba acá. Nada destructivo pasa antes.
 *
 * ⚠️ Límite declarado: «la config parsea» se comprueba sólo por EXISTENCIA. Parsear
 * `playwright.config.ts` exige el transform del runner, o sea ejecutar; comprobarlo de
 * verdad es de la unidad que pueda correr. No lo presento como más de lo que es.
 */
const PUERTO_DEL_MOCK = 5176;

async function puertoLibre(puerto) {
  return new Promise((resolver) => {
    const s = createServer();
    s.once('error', () => resolver(false));
    s.once('listening', () => s.close(() => resolver(true)));
    s.listen(puerto, '127.0.0.1');
  });
}

async function preflight() {
  const problemas = [];

  if (platform() !== 'darwin') {
    problemas.push(
      `este gate local exige Darwin para el deny de egress con sandbox-exec, y corre en «${platform()}». ` +
        'El CI de Ubuntu usa su propio camino y no pasa por acá.',
    );
  }
  if (!existsSync(SANDBOX_EXEC)) problemas.push(`no existe ${SANDBOX_EXEC}: sin contención no se lanza`);
  if (!existsSync(PERFIL_DENY)) {
    problemas.push(`no existe el perfil ${rutaPublicable(PERFIL_DENY, RAIZ).publicado}: sin contención no se lanza`);
  }
  // 🔴 `playwright.config.ts` NO se comprueba acá: ya lo hace `validarIdentidadDeRaiz`, que
  // corre antes y sale con 6. Un test lo mostró al correr —esperaba 10 y recibió 6— y el
  // arreglo correcto es sacar la comprobación duplicada, no alinear el número: una rama
  // inalcanzable es código que nadie prueba y que alguien va a leer como si corriera.

  try {
    entrypointLocal({ raiz: RAIZ, desde: import.meta.url, paquete: 'vite', subruta: join('bin', 'vite.js') });
  } catch (e) {
    problemas.push(`Vite no ancla: ${e.message}`);
  }
  if (!(await puertoLibre(PUERTO_DEL_MOCK))) {
    problemas.push(
      `el puerto ${PUERTO_DEL_MOCK} está ocupado. Con --strictPort el runner fallaría, y adoptar un servidor ajeno ` +
        'sería medir contra código que no es el de este árbol.',
    );
  }
  return problemas;
}

/**
 * 🔴 CONTAINMENT ANTES DE BORRAR. `SALIDA` se deriva de `RAIZ`, pero derivar no es comprobar:
 * un symlink o un `..` en el medio y el `rmSync` recursivo sale del arbol. Se ancla con
 * `path.relative` sobre rutas reales, nunca comparando cadenas.
 */
try {
  exigirContenida(RAIZ, SALIDA, 'el directorio de salida test-results');
} catch (e) {
  process.stderr.write(`gate-origen: ${e.message}\n`);
  process.exit(8);
}

/**
 * 🔴 Y EL CENSO. INC-08 se llevo 211 traces de una corrida ya hecha porque la limpieza corria
 * antes de las validaciones. Aquello se arreglo moviendo el `rmSync` al final — pero el orden
 * solo no cierra la clase: aun en el lugar correcto, seguia borrando **sin mirar**.
 *
 * Lo que la cierra es no destruir lo que nadie inventario. Si hay artefactos de una corrida
 * previa, el gate se detiene y los lista; seguir exige que el operador lo diga explicito con
 * `--descartar-salida-previa`. Es la diferencia entre «limpio antes de medir» y «destruyo
 * evidencia que alguien podia necesitar».
 */
const problemasDePreflight = await preflight();
if (problemasDePreflight.length > 0) {
  for (const x of problemasDePreflight) process.stderr.write(`gate-origen: preflight — ${x}\n`);
  process.stderr.write('gate-origen: no borro nada ni lanzo nada. Preflight primero, destruir despues.\n');
  process.exit(10);
}

const censo = censarDirectorio(SALIDA);
if (censo.existe && censo.cantidad > 0 && !descartarSalidaPrevia) {
  process.stderr.write(
    `gate-origen: ${rutaPublicable(SALIDA, RAIZ).publicado} tiene ${censo.cantidad} archivo(s) de una corrida previa ` +
      `(${censo.bytes} B) y nadie los inventario. NO los borro.\n`,
  );
  for (const a of censo.archivos) process.stderr.write(`  ${a.symlink ? 'symlink' : String(a.bytes).padStart(9)} ${a.rel}\n`);
  if (censo.truncado) process.stderr.write(`  … y ${censo.cantidad - censo.archivos.length} mas\n`);
  process.stderr.write('gate-origen: preservalos, o volve a correr con --descartar-salida-previa para decir explicito que se pueden perder.\n');
  process.exit(9);
}
if (censo.existe && censo.cantidad > 0) {
  process.stdout.write(`gate-origen · descartando ${censo.cantidad} archivo(s) previos por --descartar-salida-previa\n`);
}

rmSync(SALIDA, { recursive: true, force: true });
if (existsSync(SALIDA)) {
  process.stderr.write(`gate-origen: no pude limpiar ${SALIDA}; no mido sobre restos ajenos\n`);
  process.exit(3);
}

/**
 * 🔴 ENTORNO SANEADO. El gate afirma contra que hablo la corrida; una variable heredada puede
 * inyectar codigo en el proceso (`NODE_OPTIONS`, `BASH_ENV`, el transform de Playwright) o
 * redirigir su trafico (los proxies). Se retiran y se DECLARA cuales estaban.
 */
const saneado = envSaneado(process.env);
if (saneado.retiradas.length > 0) {
  process.stdout.write(`gate-origen · entorno saneado, retiradas: ${saneado.retiradas.join(' ')}\n`);
}
if (saneado.declaradas_presentes.length > 0) {
  process.stdout.write(
    `gate-origen · presentes y NO retiradas (limitacion declarada, ver anclar-local.mjs): ${saneado.declaradas_presentes.join(' ')}\n`,
  );
}

// Lo exacto con lo que se corrio, para que la evidencia no dependa de reconstruirlo despues.
process.stdout.write(`gate-origen · node ${process.version} · @playwright/test ${VERSION_PLAYWRIGHT}\n`);
// La raiz NO se imprime cruda: una ruta absoluta publica usuario, disco y proyecto. Se dice
// si el cwd coincide con la raiz, que es lo unico que el auditor necesita saber.
process.stdout.write(`gate-origen · cwd === raiz: ${process.cwd() === RAIZ}\n`);

/**
 * 🔴 EL PERFIL SE PASA POR VALOR (`-p`), NO POR RUTA (`-f`).
 *
 * Con `-f <ruta>`, entre que el gate comprueba que el perfil existe y que `sandbox-exec` lo
 * abre hay una ventana: son **dos aperturas distintas del mismo path**, y nada garantiza que
 * entre una y otra sea el mismo archivo. Un gate que valida una cosa y lanza con otra no está
 * validando nada — es el TOCTOU de siempre, en el punto exacto donde más caro sale.
 *
 * Acá los bytes se leen UNA vez, se hashean **esos** bytes, y se pasan **esos** bytes. Lo
 * hasheado y lo consumido son el mismo objeto, no dos lecturas que se parecen.
 *
 * La idea es de APP Backend, relayeada como observación técnica; la adopto porque cierra una
 * ventana real, no por simetría entre carriles.
 */
let PERFIL_TEXTO;
let PERFIL_SHA;
try {
  const bytes = readFileSync(PERFIL_DENY);
  PERFIL_TEXTO = bytes.toString('utf8');
  PERFIL_SHA = createHash('sha256').update(bytes).digest('hex');
} catch (e) {
  process.stderr.write(`gate-origen: no pude leer el perfil de deny — ${e.message}. Sin contención no se lanza.\n`);
  process.exit(11);
}
if (PERFIL_TEXTO.trim() === '') {
  process.stderr.write('gate-origen: el perfil de deny está vacío. Un perfil vacío no contiene nada.\n');
  process.exit(11);
}

process.stdout.write(`gate-origen · deny de egress: ${SANDBOX_EXEC} -p <perfil por valor> sha256 ${PERFIL_SHA}\n`);
process.stdout.write(
  'gate-origen · deny verificado 2026-09-11: loopback permitido; IP cruda, nombre e IPv6 externos EPERM; ' +
    'el mismo destino SIN sandbox conecta. No se enumeraron protocolos fuera de TCP.\n',
);
process.stdout.write('gate-origen · corriendo E2E con trace encendido\n');

// 🔴 `sandbox-exec` va PRIMERO: es ancestro del runner y de todo lo que el runner cuelgue
// —Chromium y el webServer incluidos—. Envolver una hoja del arbol dejaria al navegador
// afuera, que es exactamente quien habla con la red.
const corrida = spawnSync(
  SANDBOX_EXEC,
  ['-p', PERFIL_TEXTO, process.execPath, CLI_PLAYWRIGHT, 'test', '--trace', 'on', ...extra],
  {
    stdio: 'inherit',
    // 🔴 `cwd` explicito en RAIZ: sin el, el runner resuelve su config contra el cwd de quien
    // invoco, que puede no ser el arbol que este gate acaba de validar.
    cwd: RAIZ,
    env: { ...saneado.env, PAYME_ORIGEN_OUT: CONFIG_JSON },
  },
);

if (corrida.error) {
  process.stderr.write(`gate-origen: no pude lanzar playwright: ${corrida.error.message}\n`);
  process.exit(2);
}
if (corrida.status !== 0) {
  // Un E2E rojo se reporta como E2E rojo. No se sigue a medir orígenes de una corrida
  // que no terminó: sería medir un universo distinto del que el gate dice cubrir.
  process.stderr.write(`gate-origen: el E2E falló (RC ${corrida.status}); no se mide origen sobre una corrida incompleta\n`);
  process.exit(corrida.status ?? 1);
}

if (!existsSync(CONFIG_JSON)) {
  process.stderr.write(
    `gate-origen: el reporter no dejó ${CONFIG_JSON}. Sin configuración resuelta no hay control positivo, y sin control positivo no se afirma nada.\n`,
  );
  process.exit(3);
}

const config = JSON.parse(readFileSync(CONFIG_JSON, 'utf8'));
const proyectos = config?.config_resuelta?.proyectos ?? [];
const esperados = [...new Set(proyectos.map((p) => p.baseURL_origen).filter((o) => typeof o === 'string' && o !== ''))];

if (esperados.length !== 1) {
  process.stderr.write(
    `gate-origen: esperaba exactamente un origen base resuelto y encontré ${esperados.length} (${JSON.stringify(esperados)}). Con más de uno el control positivo no discrimina.\n`,
  );
  process.exit(4);
}

const origenEsperado = esperados[0];
process.stdout.write(`gate-origen · origen esperado derivado del runner: ${origenEsperado}\n`);

// 🔴 El registro de tests del reporter es lo que permite unir cada traza con el test que la
// produjo, por igualdad exacta del path del attachment. Sin el, el gate no puede afirmar que
// midio TODAS las trazas de TODOS los tests: solo las que encontro en el directorio.
const registroDeTests = Array.isArray(config?.tests) ? config.tests : null;
if (registroDeTests === null) {
  process.stderr.write('gate-origen: el informe del reporter no trae `tests`; sin identidad exacta no se acredita.\n');
  process.exit(7);
}
const informe = await extraerDeDirectorio(SALIDA, origenEsperado, registroDeTests);
writeFileSync(TRAFICO_JSON, `${JSON.stringify(informe, null, 2)}\n`, 'utf8');

const t = informe.totales;
process.stdout.write(`gate-origen · veredicto: ${informe.veredicto}\n`);
process.stdout.write(
  `gate-origen · traces ${t.traces_hallados} (ok ${t.traces_ok} · sin red ${t.traces_sin_red} · ilegibles ${t.traces_con_linea_ilegible} · pareo roto ${t.traces_con_pareo_roto} · con externo ${t.traces_con_origen_externo}) · urls ${t.urls_extraidas} · orígenes ${t.origenes_distintos} · externos ${t.origenes_externos}\n`,
);
for (const o of informe.origenes) {
  process.stdout.write(`  ${o.loopback ? 'loopback' : 'EXTERNO '} ${o.origen} x${o.requests}\n`);
}
for (const z of informe.trazas_sin_red_observable) process.stdout.write(`  SIN RED OBSERVABLE: ${z}\n`);
for (const z of informe.trazas_con_linea_ilegible) process.stdout.write(`  LINEA ILEGIBLE: ${z}\n`);
for (const z of informe.trazas_con_pareo_roto ?? []) process.stdout.write(`  PAREO ORDINAL ROTO: ${z}\n`);

if (informe.veredicto !== VEREDICTOS.LIMPIO) {
  process.stderr.write(`gate-origen: FALLA · ${informe.veredicto}\n`);
  process.exit(1);
}
process.stdout.write('gate-origen · OK · toda traza con red observable y sólo loopback\n');
