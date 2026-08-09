import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 🔴 NINGÚN SERVIDOR DE DESARROLLO COMPARTE PUERTO CON EL DE E2E.
 *
 * Este test nace de un defecto real, y el síntoma es lo que lo hace valer la
 * pena: `.claude/launch.json` le daba a la landing el **mismo puerto** que
 * `playwright.config.ts` usa para su `webServer` del modo mock.
 *
 * Como el `webServer` tiene `reuseExistingServer`, playwright **no levanta
 * nada** si encuentra el puerto ocupado: se conecta a lo que haya. Con la
 * preview de la landing corriendo, los 20 specs de la app apuntaron a una
 * página con un título y dos botones, y se quedaron esperando elementos que
 * ahí no existen **hasta agotar el timeout**.
 *
 * Lo caro no es el error, es el diagnóstico: no hay ningún mensaje que diga
 * "puerto equivocado". Hay veinte tests que tardan y fallan por timeout, que
 * es exactamente lo que parece una suite lenta o una máquina cargada. Costó
 * diez minutos de reloj y casi se lee como un problema de rendimiento.
 *
 * La colisión la introduje al crear la entrada de la landing (CARRIL 1A): el
 * puerto de playwright ya existía. Se mueve la landing, no playwright.
 */

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..');

interface Config {
  readonly configurations: ReadonlyArray<{ name: string; port: number }>;
}

function puertosDeLaunch(): Array<{ name: string; port: number }> {
  const json = JSON.parse(readFileSync(join(RAIZ, '.claude/launch.json'), 'utf8')) as Config;
  return json.configurations.map((c) => ({ name: c.name, port: c.port }));
}

/** El puerto que playwright espera para su `webServer`, leído de su config. */
function puertoDeE2E(): number {
  const cfg = readFileSync(join(RAIZ, 'playwright.config.ts'), 'utf8');
  const url = cfg.match(/url:\s*['"]http:\/\/localhost:(\d+)['"]/)?.[1];
  expect(url, 'no se pudo leer el puerto del webServer de playwright').toBeDefined();
  return Number(url);
}

describe('los puertos de desarrollo no se pisan', () => {
  it('🔴 la config de playwright declara un puerto legible', () => {
    // Sonda: si el formato de la config cambiara, las afirmaciones de abajo
    // compararían contra `NaN` y pasarían en vacío.
    const puerto = puertoDeE2E();
    expect(Number.isInteger(puerto), `puerto de e2e ilegible: ${puerto}`).toBe(true);
    expect(puerto).toBeGreaterThan(1024);
  });

  it('🔴 ninguna entrada de `launch.json` usa el puerto del `webServer` de e2e', () => {
    const e2e = puertoDeE2E();
    const chocan = puertosDeLaunch().filter((c) => c.port === e2e);
    expect(
      chocan.map((c) => `${c.name}:${c.port}`),
      `con reuseExistingServer, playwright se conectaría a este server en vez de levantar el mock`,
    ).toEqual([]);
  });

  it('🔴 y las entradas de `launch.json` tampoco se pisan entre sí', () => {
    const puertos = puertosDeLaunch();
    const vistos = new Map<number, string>();
    const duplicados: string[] = [];
    for (const { name, port } of puertos) {
      const previo = vistos.get(port);
      if (previo) duplicados.push(`${port}: ${previo} y ${name}`);
      else vistos.set(port, name);
    }
    expect(duplicados, `puertos duplicados: ${duplicados.join(' · ')}`).toEqual([]);
    // Que el parser haya visto algo: sin esto, un `launch.json` vacío pasaría.
    expect(puertos.length, 'no se leyó ninguna configuración').toBeGreaterThan(1);
  });

  it('🔴 el argumento `--port` coincide con el campo `port` de cada entrada', () => {
    // Si divergen, el server arranca en uno y la herramienta abre el otro: la
    // preview queda en blanco y parece que el build falló.
    const json = JSON.parse(readFileSync(join(RAIZ, '.claude/launch.json'), 'utf8')) as {
      configurations: Array<{ name: string; port: number; runtimeArgs?: string[] }>;
    };
    const desvios: string[] = [];
    for (const c of json.configurations) {
      const i = c.runtimeArgs?.indexOf('--port') ?? -1;
      if (i === -1) continue; // no todas lo declaran: `npm run dev` usa el default
      const declarado = Number(c.runtimeArgs![i + 1]);
      if (declarado !== c.port) desvios.push(`${c.name}: --port ${declarado} pero port ${c.port}`);
    }
    expect(desvios, desvios.join(' · ')).toEqual([]);
  });
});
