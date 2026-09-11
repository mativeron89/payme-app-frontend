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
 * el costo a todas las corridas de desarrollo. La durabilidad no sale de cambiar esa
 * política global: sale de que este gate esté versionado y se invoque por nombre, en vez
 * de depender de que alguien se acuerde de pasar `--trace on` a mano.
 *
 * ## 🔴 El origen esperado se DERIVA, no se copia
 *
 * El control positivo necesita saber contra qué origen debería haber hablado la corrida.
 * Ese valor se lee del informe del reporter —o sea, de lo que el runner resolvió de
 * verdad— y no se escribe a mano acá ni en `package.json`. Una segunda copia de
 * `http://localhost:5176` se desalinea el día que alguien cambie el puerto, y lo hace en
 * silencio: el gate seguiría verde midiendo contra un origen que ya no es el suyo.
 *
 * Uso:  node scripts/gate-origen.mjs [args extra para playwright test]
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { extraerDeDirectorio, VEREDICTOS } from './extraer-origenes.mjs';

const RAIZ = process.cwd();
const SALIDA = join(RAIZ, 'test-results');
const CONFIG_JSON = join(SALIDA, 'origen-config.json');
const TRAFICO_JSON = join(SALIDA, 'origenes-trafico.json');

const extra = process.argv.slice(2);

process.stdout.write('gate-origen · corriendo E2E con trace encendido\n');
const corrida = spawnSync('npx', ['--no-install', 'playwright', 'test', '--trace', 'on', ...extra], {
  stdio: 'inherit',
  env: { ...process.env, PAYME_ORIGEN_OUT: CONFIG_JSON },
});

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

const informe = extraerDeDirectorio(SALIDA, origenEsperado);
writeFileSync(TRAFICO_JSON, `${JSON.stringify(informe, null, 2)}\n`, 'utf8');

process.stdout.write(`gate-origen · veredicto: ${informe.veredicto}\n`);
process.stdout.write(
  `gate-origen · traces ${informe.totales.traces_hallados} · urls ${informe.totales.urls_extraidas} · orígenes ${informe.totales.origenes_distintos} · externos ${informe.totales.origenes_externos}\n`,
);
for (const o of informe.origenes) {
  process.stdout.write(`  ${o.loopback ? 'loopback' : 'EXTERNO '} ${o.origen} x${o.requests}\n`);
}

if (informe.veredicto !== VEREDICTOS.LIMPIO) {
  process.stderr.write(`gate-origen: FALLA · ${informe.veredicto}\n`);
  process.exit(1);
}
process.stdout.write('gate-origen · OK · sólo loopback, cero orígenes externos\n');
