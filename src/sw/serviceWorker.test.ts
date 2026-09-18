import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { MARCADOR_VERSION, construirServiceWorker } from './artefacto';
import { OPCIONES_REGISTRO, registrarServiceWorker, type EntornoRegistro } from './registrar';

/**
 * APP-PWA-B2 · el service worker se prueba COMO SE EMITE.
 *
 * No se reimplementa su lógica en TypeScript para testearla aparte: se toma la
 * plantilla real, se la pasa por `construirServiceWorker` —la misma función que
 * usa el build— y el resultado corre en un contexto aislado de Node con `self`,
 * `caches` y `fetch` falsos. Lo que se prueba es lo que se sirve.
 */

const PLANTILLA = readFileSync(new URL('./serviceWorker.js', import.meta.url), 'utf8');
const ORIGEN = 'https://app.paymemx.com';
const VERSION = '9.9.9';

interface RespuestaFalsa {
  readonly status: number;
  readonly type: string;
  readonly headers: Headers;
  readonly cuerpo: string;
  clone(): RespuestaFalsa;
}

function respuesta(cuerpo: string, opciones: { status?: number; type?: string; tipo?: string } = {}): RespuestaFalsa {
  const r: RespuestaFalsa = {
    status: opciones.status ?? 200,
    type: opciones.type ?? 'basic',
    headers: new Headers({ 'content-type': opciones.tipo ?? 'application/javascript' }),
    cuerpo,
    clone: () => r,
  };
  return r;
}

interface PedidoFalso { readonly url: string; readonly method: string; readonly mode: string }
const pedido = (url: string, method = 'GET', mode = 'no-cors'): PedidoFalso => ({ url, method, mode });

class CacheFalsa {
  readonly guardadas = new Map<string, RespuestaFalsa>();
  async match(p: PedidoFalso) { return this.guardadas.get(p.url); }
  async put(p: PedidoFalso, r: RespuestaFalsa) { this.guardadas.set(p.url, r); }
}

function montar(fuente: string, cachesPrevias: string[] = []) {
  const oyentes = new Map<string, (evento: unknown) => void>();
  const almacen = new Map<string, CacheFalsa>(cachesPrevias.map((n) => [n, new CacheFalsa()]));
  const cacheStorage = {
    async open(nombre: string) {
      if (!almacen.has(nombre)) almacen.set(nombre, new CacheFalsa());
      return almacen.get(nombre)!;
    },
    async keys() { return [...almacen.keys()]; },
    async delete(nombre: string) { return almacen.delete(nombre); },
  };
  const fetchFalso = vi.fn(async (_p: PedidoFalso) => respuesta('// del servidor'));
  const self = {
    location: { origin: ORIGEN },
    addEventListener: (tipo: string, fn: (evento: unknown) => void) => { oyentes.set(tipo, fn); },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn(async () => undefined) },
    registration: { unregister: vi.fn(async () => true) },
  };
  runInNewContext(fuente, { self, caches: cacheStorage, fetch: fetchFalso, URL, Promise });

  function buscar(p: PedidoFalso) {
    let respuestaDada: Promise<RespuestaFalsa> | undefined;
    const esperas: Promise<unknown>[] = [];
    oyentes.get('fetch')!({
      request: p,
      respondWith: (x: Promise<RespuestaFalsa>) => { respuestaDada = x; },
      waitUntil: (x: Promise<unknown>) => { esperas.push(x); },
    });
    return {
      interceptado: respuestaDada !== undefined,
      respuesta: async () => { const r = await respuestaDada!; await Promise.all(esperas); return r; },
    };
  }

  async function activar() {
    const esperas: Promise<unknown>[] = [];
    oyentes.get('activate')!({ waitUntil: (x: Promise<unknown>) => { esperas.push(x); } });
    await Promise.all(esperas);
  }

  return { oyentes, almacen, fetchFalso, self, buscar, activar };
}

const SW = construirServiceWorker(PLANTILLA, VERSION);
const CACHE_ACTUAL = `payme-estaticos-${VERSION}`;

/** Lo que el navegador pide y el SW tiene que dejar pasar SIN tocar. */
const PASAN_POR_RED: ReadonlyArray<readonly [string, PedidoFalso]> = [
  ['la raíz como navegación', pedido(`${ORIGEN}/`, 'GET', 'navigate')],
  ['index.html pedido directo', pedido(`${ORIGEN}/index.html`)],
  ['una ruta de la app (hash router)', pedido(`${ORIGEN}/#/mas`, 'GET', 'navigate')],
  ['/privacy', pedido(`${ORIGEN}/privacy`, 'GET', 'navigate')],
  ['/facebook-data-deletion/…', pedido(`${ORIGEN}/facebook-data-deletion/AbCdEfGhIjKlMnOpQrSt`, 'GET', 'navigate')],
  ['el manifest', pedido(`${ORIGEN}/manifest.webmanifest`)],
  ['el propio sw.js', pedido(`${ORIGEN}/sw.js`)],
  ['el favicon (no está en la lista)', pedido(`${ORIGEN}/favicon.svg`)],
  ['la licencia de una fuente', pedido(`${ORIGEN}/fonts/OFL-DMSans.txt`)],
  ['la API de PayMe (otro origen)', pedido('https://payme-app-backend-production.up.railway.app/api/config')],
  ['un POST a la API', pedido('https://payme-app-backend-production.up.railway.app/api/auth/login', 'POST', 'cors')],
  ['/api en el mismo origen', pedido(`${ORIGEN}/api/config`)],
  ['Stripe', pedido('https://js.stripe.com/v3/')],
  ['Google Identity Services', pedido('https://accounts.google.com/gsi/client')],
  // 🔴 Tiene FORMA de asset hasheado pero es de otro origen: sin este caso, un
  // SW que no mirara el origen pasaría todos los demás.
  ['un asset con forma de hash, de OTRO origen', pedido('https://cdn.otro.example/assets/index-Dm_b0c4c.js')],
  ['un POST a un path de asset', pedido(`${ORIGEN}/assets/index-Dm_b0c4c.js`, 'POST', 'cors')],
  ['un asset hasheado pedido como navegación', pedido(`${ORIGEN}/assets/index-Dm_b0c4c.js`, 'GET', 'navigate')],
  ['un asset con query string', pedido(`${ORIGEN}/assets/index-Dm_b0c4c.js?v=1`)],
  ['un asset SIN hash', pedido(`${ORIGEN}/assets/index.js`)],
  ['una extensión que no está en la lista', pedido(`${ORIGEN}/assets/datos-Dm_b0c4c.json`)],
];

/** Lo único que se sirve desde cache. Nombres tomados de un build real. */
const CACHEABLES: ReadonlyArray<readonly [string, PedidoFalso]> = [
  ['JS hasheado', pedido(`${ORIGEN}/assets/index-B4mqsBxp.js`)],
  ['JS con guion en el hash', pedido(`${ORIGEN}/assets/App-D-UmwDeP.js`)],
  ['CSS hasheado', pedido(`${ORIGEN}/assets/index-2T9X4jrv.css`)],
  ['fuente hasheada con guion bajo en el hash', pedido(`${ORIGEN}/assets/PlusJakartaSans-variable-BZU_LQer.ttf`)],
  ['ícono de instalación', pedido(`${ORIGEN}/pwa/icon-192.png`)],
  ['ícono maskable', pedido(`${ORIGEN}/pwa/icon-maskable-512.png`)],
];

describe('el artefacto: de la plantilla al /sw.js que se sirve', () => {
  it('la versión sale del argumento y el marcador desaparece', () => {
    expect(SW).toContain(`const VERSION = '${VERSION}';`);
    expect(SW).not.toContain(MARCADOR_VERSION);
  });

  it('🔴 la plantilla nombra el marcador UNA vez — si no, el cache dejaría de versionarse', () => {
    expect(PLANTILLA.split(MARCADOR_VERSION).length - 1).toBe(1);
    expect(() => construirServiceWorker(PLANTILLA.replace(MARCADOR_VERSION, 'x'), VERSION)).toThrow(/0 veces/);
    expect(() => construirServiceWorker(`${PLANTILLA}\n// ${MARCADOR_VERSION}`, VERSION)).toThrow(/2 veces/);
  });

  it('🔴 una versión que no es X.Y.Z no llega al artefacto', () => {
    for (const mala of ['', 'latest', '1.2', '1.2.3-beta', "1.2.3'; fetch('x"]) {
      expect(() => construirServiceWorker(PLANTILLA, mala), mala).toThrow(/versión inválida/);
    }
  });

  it('🔴 la plantilla se publica con el kill-switch APAGADO', () => {
    // Retirar el SW es un acto deliberado: cambiar esta línea a `true` en un
    // commit. Si alguien lo hace, este test tiene que cambiar con él.
    expect(PLANTILLA.split('const RETIRAR = false;').length - 1).toBe(1);
  });

  it('🔴 sin precache, sin importScripts, sin hosts y sin nombrar index.html como algo a guardar', () => {
    const codigo = PLANTILLA.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(codigo).not.toMatch(/importScripts/);
    expect(codigo).not.toMatch(/\.addAll\s*\(|\bcache\.add\s*\(/);
    expect(codigo).not.toMatch(/https?:\/\//);
    expect(codigo).not.toMatch(/index\.html/);
    // Control positivo: el barrido mira código de verdad, no un string vacío.
    expect(codigo).toMatch(/respondWith/);
  });
});

describe('fetch · qué pasa por red y qué sale de cache', () => {
  it.each(PASAN_POR_RED)('🔴 pasa SIN tocar: %s', (_nombre, p) => {
    const sw = montar(SW);
    expect(sw.buscar(p).interceptado).toBe(false);
  });

  it.each(CACHEABLES)('cache-first: %s', async (_nombre, p) => {
    const sw = montar(SW);
    const primera = sw.buscar(p);
    expect(primera.interceptado).toBe(true);
    expect((await primera.respuesta()).cuerpo).toBe('// del servidor');
    expect(sw.fetchFalso).toHaveBeenCalledTimes(1);

    // La segunda vez NO va a la red.
    const segunda = await sw.buscar(p).respuesta();
    expect(segunda.cuerpo).toBe('// del servidor');
    expect(sw.fetchFalso).toHaveBeenCalledTimes(1);
    expect(sw.almacen.get(CACHE_ACTUAL)!.guardadas.has(p.url)).toBe(true);
  });

  it('🔴 lo que no es un 200 del mismo origen NO entra al cache', async () => {
    const casos: Array<[string, RespuestaFalsa]> = [
      ['404', respuesta('no está', { status: 404 })],
      ['500', respuesta('se rompió', { status: 500 })],
      ['opaca', respuesta('', { type: 'opaque', status: 0 })],
      // Un servidor que responde a un asset inexistente con la app: sin este
      // chequeo, index.html entraría al cache con nombre de JS.
      ['HTML con 200', respuesta('<!doctype html>', { tipo: 'text/html; charset=utf-8' })],
    ];
    for (const [nombre, r] of casos) {
      const sw = montar(SW);
      sw.fetchFalso.mockResolvedValueOnce(r);
      const p = pedido(`${ORIGEN}/assets/index-B4mqsBxp.js`);
      expect(await sw.buscar(p).respuesta(), nombre).toBe(r);
      expect(sw.almacen.get(CACHE_ACTUAL)?.guardadas.size ?? 0, `se guardó ${nombre}`).toBe(0);
    }
  });
});

describe('ciclo de vida · la versión nueva toma el control y limpia la vieja', () => {
  it('install ⇒ skipWaiting', () => {
    const sw = montar(SW);
    sw.oyentes.get('install')!({});
    expect(sw.self.skipWaiting).toHaveBeenCalledTimes(1);
  });

  it('🔴 activate ⇒ borra los almacenes de PayMe de OTRAS versiones, conserva el actual y los ajenos', async () => {
    const sw = montar(SW, ['payme-estaticos-0.165.3', 'payme-estaticos-0.1.0', CACHE_ACTUAL, 'cache-de-otro']);
    await sw.activar();
    expect([...sw.almacen.keys()].sort()).toEqual([CACHE_ACTUAL, 'cache-de-otro'].sort());
    expect(sw.self.clients.claim).toHaveBeenCalledTimes(1);
    expect(sw.self.registration.unregister).not.toHaveBeenCalled();
  });
});

describe('🔴 kill-switch · RETIRAR = true', () => {
  const RETIRADO = SW.replace('const RETIRAR = false;', 'const RETIRAR = true;');

  it('la variante retirada es de verdad otra (si no, estos tests pasarían en vacío)', () => {
    expect(RETIRADO).not.toBe(SW);
  });

  it('borra TODOS los almacenes de PayMe —incluida la actual—, deja los ajenos y se desregistra', async () => {
    const sw = montar(RETIRADO, ['payme-estaticos-0.165.3', CACHE_ACTUAL, 'cache-de-otro']);
    await sw.activar();
    expect([...sw.almacen.keys()]).toEqual(['cache-de-otro']);
    expect(sw.self.registration.unregister).toHaveBeenCalledTimes(1);
    expect(sw.self.clients.claim).not.toHaveBeenCalled();
  });

  it('deja de interceptar incluso lo que antes cacheaba', () => {
    const sw = montar(RETIRADO);
    for (const [, p] of CACHEABLES) expect(sw.buscar(p).interceptado).toBe(false);
  });
});

describe('registrar · sólo en el build real de producción', () => {
  function entorno(parcial: Partial<EntornoRegistro> = {}) {
    const register = vi.fn(async () => ({}));
    let alCargar: (() => void) | undefined;
    const e: EntornoRegistro = {
      mock: false,
      produccion: true,
      serviceWorker: { register },
      readyState: 'complete',
      alCargar: (hacer) => { alCargar = hacer; },
      ...parcial,
    };
    return { e, register, dispararLoad: () => alCargar?.() };
  }

  it('🔴 en el mock NO se registra', () => {
    const { e, register } = entorno({ mock: true });
    expect(registrarServiceWorker(e)).toBe('omitido_mock');
    expect(register).not.toHaveBeenCalled();
  });

  it('en desarrollo NO se registra', () => {
    const { e, register } = entorno({ produccion: false });
    expect(registrarServiceWorker(e)).toBe('omitido_desarrollo');
    expect(register).not.toHaveBeenCalled();
  });

  it('sin soporte del navegador no hace nada', () => {
    const { e } = entorno({ serviceWorker: undefined });
    expect(registrarServiceWorker(e)).toBe('sin_soporte');
  });

  it('build real, página ya cargada ⇒ /sw.js con alcance raíz y sin cache HTTP', () => {
    const { e, register } = entorno();
    expect(registrarServiceWorker(e)).toBe('registrado');
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/', updateViaCache: 'none' });
    expect(OPCIONES_REGISTRO).toEqual({ scope: '/', updateViaCache: 'none' });
  });

  it('🔴 si la página todavía carga, espera a `load` —y recién ahí registra—', () => {
    const { e, register, dispararLoad } = entorno({ readyState: 'loading' });
    expect(registrarServiceWorker(e)).toBe('esperando_load');
    expect(register).not.toHaveBeenCalled();
    dispararLoad();
    expect(register).toHaveBeenCalledTimes(1);
  });

  it('🔴 un registro que falla NO rompe la app', async () => {
    const register = vi.fn(async () => { throw new Error('SecurityError'); });
    const { e } = entorno({ serviceWorker: { register } });
    expect(() => registrarServiceWorker(e)).not.toThrow();
    // Se deja correr el rechazo: si no estuviera atrapado, vitest lo reporta.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(register).toHaveBeenCalledTimes(1);
  });
});
