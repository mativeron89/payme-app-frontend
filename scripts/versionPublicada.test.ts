import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * AF-VERSION-NUEVA · la versión embebida y `/version.json` salen del MISMO
 * `package.json`. Si una de las dos se desviara, una pestaña recién cargada se
 * creería vieja y recargaría sola (una vez: la marca por pestaña lo corta), o
 * una vieja no se enteraría nunca.
 */

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const { version: PAQUETE } = JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8')) as { version: string };

interface PluginVersion {
  name: string;
  configureServer: (server: { middlewares: { use: (ruta: string, fn: Middleware) => void } }) => void;
  generateBundle: (this: { emitFile: (a: { type: string; fileName: string; source: string }) => void }) => void;
}
type Middleware = (req: unknown, res: { setHeader: (k: string, v: string) => void; end: (c: string) => void }) => void;

async function cargar() {
  const { default: config } = await import('../vite.config');
  const plugins = (config as { plugins: unknown[] }).plugins.flat() as Array<{ name?: string }>;
  const p = plugins.find((x) => x?.name === 'payme-version-publicada');
  expect(p, 'vite.config.ts no declara el plugin de la versión publicada').toBeDefined();
  return { plugin: p as unknown as PluginVersion, define: (config as { define: Record<string, string> }).define };
}

describe('AF-VERSION-NUEVA · la versión, embebida y publicada', () => {
  it('🔴 embebida: `__APP_VERSION__` es la del package.json', async () => {
    const { define } = await cargar();
    expect(define['__APP_VERSION__']).toBe(JSON.stringify(PAQUETE));
  });

  it('🔴 el build emite exactamente `version.json` con `{ "version": <package.json> }`', async () => {
    const { plugin } = await cargar();
    const emitidos: Array<{ type: string; fileName: string; source: string }> = [];
    plugin.generateBundle.call({ emitFile: (a) => { emitidos.push(a); } });
    expect(emitidos.map((a) => [a.type, a.fileName])).toEqual([['asset', 'version.json']]);
    expect(JSON.parse(emitidos[0]!.source)).toEqual({ version: PAQUETE });
  });

  it('el servidor de desarrollo la sirve igual, JSON y sin caché', async () => {
    const { plugin } = await cargar();
    const rutas: Array<[string, Middleware]> = [];
    plugin.configureServer({ middlewares: { use: (ruta, fn) => { rutas.push([ruta, fn]); } } });
    expect(rutas.map(([r]) => r)).toEqual(['/version.json']);
    const cabeceras: Record<string, string> = {};
    let cuerpo = '';
    rutas[0]![1]({}, { setHeader: (k, v) => { cabeceras[k.toLowerCase()] = v; }, end: (c) => { cuerpo = c; } });
    expect(cabeceras).toEqual({ 'content-type': 'application/json', 'cache-control': 'no-store' });
    expect(JSON.parse(cuerpo)).toEqual({ version: PAQUETE });
  });
});
