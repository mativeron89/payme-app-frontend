import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CLAVE_RECARGA_POR_VERSION,
  RUTA_VERSION_PUBLICADA,
  VERSION_APP,
  decodeVersionPublicada,
  esMasNueva,
  leerVersionPublicada,
  recargarSiHayVersionNueva,
  versionMasNueva,
} from './versionPublicada';

/**
 * AF-VERSION-NUEVA · una pestaña vieja se actualiza sola en el ingreso. Los
 * recorridos por pantalla (recarga una vez en el ingreso, nunca en una mesa,
 * sin bucle) los hace `e2e/version-nueva.spec.ts`.
 */

describe('AF-VERSION-NUEVA · la versión embebida', () => {
  it('es la del package.json, con la forma que se compara', async () => {
    const { readFileSync } = await import('node:fs');
    const paquete = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(VERSION_APP).toBe(paquete.version);
    expect(VERSION_APP).toMatch(/^\d{1,4}\.\d{1,4}\.\d{1,4}$/);
  });
});

describe('AF-VERSION-NUEVA · `/version.json`, fail-closed', () => {
  it.each<[string, unknown, string | null]>([
    ['la forma exacta', { version: '0.202.0' }, '0.202.0'],
    ['una clave de más', { version: '0.202.0', build: 'x' }, null],
    ['sin la clave', {}, null],
    ['no es texto', { version: 202 }, null],
    ['con sufijo', { version: '0.202.0-rc.1' }, null],
    ['con espacios', { version: ' 0.202.0' }, null],
    ['un arreglo', ['0.202.0'], null],
    ['null', null, null],
    ['texto suelto', '0.202.0', null],
  ])('%s', (_nombre, valor, esperado) => {
    expect(decodeVersionPublicada(valor)).toBe(esperado);
  });
});

describe('AF-VERSION-NUEVA · ¿más nueva?', () => {
  it.each<[string, string, boolean]>([
    ['0.202.0', '0.201.0', true],
    ['0.201.1', '0.201.0', true],
    ['1.0.0', '0.999.999', true],
    // Numérico, no alfabético: «10» > «9».
    ['0.201.10', '0.201.9', true],
    ['0.201.0', '0.201.0', false],
    ['0.200.9', '0.201.0', false],
    ['0.9.0', '0.10.0', false],
    ['basura', '0.201.0', false],
    ['0.202.0', 'basura', false],
  ])('%s frente a %s ⇒ %s', (publicada, actual, esperado) => {
    expect(esMasNueva(publicada, actual)).toBe(esperado);
  });
});

describe('AF-VERSION-NUEVA · leer `/version.json`', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  function responder(cuerpo: unknown, init: { status?: number; tipo?: string } = {}) {
    const fetchFalso = vi.fn(async () => new Response(
      typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
      { status: init.status ?? 200, headers: { 'content-type': init.tipo ?? 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchFalso);
    return fetchFalso;
  }

  it('control positivo: 200 JSON con la forma exacta ⇒ la versión; `no-store`, sin credenciales, sin seguir redirecciones', async () => {
    const fetchFalso = responder({ version: '0.202.0' }, { tipo: 'application/json; charset=utf-8' });
    await expect(leerVersionPublicada()).resolves.toBe('0.202.0');
    const [url, opciones] = fetchFalso.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(RUTA_VERSION_PUBLICADA);
    expect(opciones).toMatchObject({ method: 'GET', cache: 'no-store', credentials: 'omit', redirect: 'error' });
  });

  it.each<[string, unknown, { status?: number; tipo?: string }]>([
    ['404', { version: '0.202.0' }, { status: 404 }],
    ['500', { version: '0.202.0' }, { status: 500 }],
    // Una SPA que contesta su index.html a cualquier ruta: no es la versión.
    ['HTML con 200', '<!doctype html><html></html>', { tipo: 'text/html' }],
    ['un media type parecido', { version: '0.202.0' }, { tipo: 'application/jsonp' }],
    ['JSON inválido', '{"version":', {}],
    ['forma rara', { version: '0.202.0', extra: 1 }, {}],
  ])('%s ⇒ null', async (_nombre, cuerpo, init) => {
    responder(cuerpo, init);
    await expect(leerVersionPublicada()).resolves.toBeNull();
  });

  it('una caída de red ⇒ null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(leerVersionPublicada()).resolves.toBeNull();
  });

  it('sin respuesta: el plazo corta y da null', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('fetch', vi.fn((_url: string, opciones: RequestInit) => new Promise((_ok, falla) => {
        opciones.signal?.addEventListener('abort', () => falla(new DOMException('abortado', 'AbortError')));
      })));
      const lectura = leerVersionPublicada();
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(lectura).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('AF-VERSION-NUEVA · recargar una vez por versión publicada', () => {
  function almacen(inicial: Record<string, string> = {}) {
    const datos = new Map(Object.entries(inicial));
    return {
      datos,
      getItem: vi.fn((k: string) => datos.get(k) ?? null),
      setItem: vi.fn((k: string, v: string) => { datos.set(k, v); }),
    };
  }

  it('control positivo: más nueva y sin marca ⇒ marca y recarga', () => {
    const a = almacen();
    const recargar = vi.fn();
    expect(recargarSiHayVersionNueva('0.202.0', '0.201.0', a, recargar)).toBe(true);
    expect(recargar).toHaveBeenCalledTimes(1);
    expect(a.datos.get(CLAVE_RECARGA_POR_VERSION)).toBe('0.202.0');
  });

  it('🔴 sin bucle: ya se recargó por ESA versión y el JS sigue viejo ⇒ no recarga otra vez', () => {
    const recargar = vi.fn();
    expect(recargarSiHayVersionNueva('0.202.0', '0.201.0', almacen({ [CLAVE_RECARGA_POR_VERSION]: '0.202.0' }), recargar))
      .toBe(false);
    expect(recargar).not.toHaveBeenCalled();
  });

  it('una versión todavía más nueva ⇒ una recarga más, por ella', () => {
    const a = almacen({ [CLAVE_RECARGA_POR_VERSION]: '0.202.0' });
    const recargar = vi.fn();
    expect(recargarSiHayVersionNueva('0.203.0', '0.201.0', a, recargar)).toBe(true);
    expect(a.datos.get(CLAVE_RECARGA_POR_VERSION)).toBe('0.203.0');
  });

  it.each<[string, string | null, string]>([
    ['la misma versión', '0.201.0', '0.201.0'],
    ['una anterior (vuelta atrás del deploy)', '0.200.1', '0.201.0'],
    ['sin respuesta', null, '0.201.0'],
  ])('%s ⇒ no recarga ni marca', (_nombre, publicada, actual) => {
    const a = almacen();
    const recargar = vi.fn();
    expect(recargarSiHayVersionNueva(publicada, actual, a, recargar)).toBe(false);
    expect(recargar).not.toHaveBeenCalled();
    expect(a.setItem).not.toHaveBeenCalled();
  });

  it('sin sessionStorage no hay guarda contra el bucle ⇒ no recarga', () => {
    const recargar = vi.fn();
    expect(recargarSiHayVersionNueva('0.202.0', '0.201.0', null, recargar)).toBe(false);
    expect(recargar).not.toHaveBeenCalled();
  });

  it('un storage que tira al escribir ⇒ no recarga', () => {
    const a = almacen();
    a.setItem.mockImplementation(() => { throw new DOMException('lleno', 'QuotaExceededError'); });
    const recargar = vi.fn();
    expect(recargarSiHayVersionNueva('0.202.0', '0.201.0', a, recargar)).toBe(false);
    expect(recargar).not.toHaveBeenCalled();
  });

  it('un storage que no guarda la marca ⇒ no recarga (sin marca, recargaría siempre)', () => {
    const recargar = vi.fn();
    const olvidadizo = { getItem: vi.fn(() => null), setItem: vi.fn() };
    expect(recargarSiHayVersionNueva('0.202.0', '0.201.0', olvidadizo, recargar)).toBe(false);
    expect(recargar).not.toHaveBeenCalled();
  });
});

/**
 * AF-CARTEL-VERSION-NUEVA · decisión 125 · con la sesión iniciada no se recarga:
 * `useVersionNuevaPublicada` sólo dice si hay una versión más nueva, con esto.
 */
describe('AF-CARTEL-VERSION-NUEVA · versionMasNueva', () => {
  it('más nueva: la devuelve', () => {
    expect(versionMasNueva('0.208.0', '0.207.1')).toBe('0.208.0');
    expect(versionMasNueva('1.0.0', '0.207.1')).toBe('1.0.0');
  });

  it('la misma, una anterior, sin respuesta o con forma rara: null', () => {
    expect(versionMasNueva('0.207.1', '0.207.1')).toBeNull();
    expect(versionMasNueva('0.207.0', '0.207.1')).toBeNull();
    expect(versionMasNueva(null, '0.207.1')).toBeNull();
    expect(versionMasNueva('0.208.0-rc.1', '0.207.1')).toBeNull();
  });
});
