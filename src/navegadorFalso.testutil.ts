import { vi } from 'vitest';

/**
 * n130 · un `window` de prueba que modela la URL ENTERA —path, query y
 * fragmento— para el router con History API.
 *
 * Los stubs anteriores sólo modelaban el hash: con rutas normales, un
 * `replaceState('/home')` que sólo mirara el `#` dejaría la URL «vacía» y la
 * prueba afirmaría sobre un estado que no existe.
 *
 * `inicial` puede ser un fragmento suelto (`#/tarjetas`) o una ruta
 * (`/mesa/PA-1?r=x`). `historialBloqueado` hace que `pushState` y
 * `replaceState` lancen, como un navegador que no deja tocar el historial.
 */
export function navegadorFalso(inicial: string, opciones: { historialBloqueado?: boolean } = {}) {
  // `localhost`: el único host de prueba que la guarda de destinos (releaseGates) admite.
  const base = 'http://localhost';
  let url = new URL(inicial.startsWith('#') ? `${base}/${inicial}` : `${base}${inicial}`);
  const hashWrites: string[] = [];
  const dispatched: string[] = [];
  const aplicar = (u: string) => { url = new URL(u, url.href); };
  const replaceState = vi.fn((_s: unknown, _t: string, u: string) => {
    if (opciones.historialBloqueado) throw new Error('SecurityError');
    aplicar(u);
  });
  const pushState = vi.fn((_s: unknown, _t: string, u: string) => {
    if (opciones.historialBloqueado) throw new Error('SecurityError');
    aplicar(u);
  });
  const locationReplace = vi.fn((u: string) => aplicar(u));
  const locationAssign = vi.fn((u: string) => aplicar(u));
  vi.stubGlobal('HashChangeEvent', class { constructor(public type: string) {} });
  vi.stubGlobal('window', {
    location: {
      get pathname() { return url.pathname; },
      get search() { return url.search; },
      get hash() { return url.hash; },
      set hash(v: string) { hashWrites.push(v); url.hash = v; },
      get href() { return url.href; },
      get origin() { return url.origin; },
      replace: locationReplace,
      assign: locationAssign,
    },
    history: { state: null, replaceState, pushState, back: vi.fn() },
    dispatchEvent: (e: { type: string }) => { dispatched.push(e.type); return true; },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });
  return {
    replaceState,
    pushState,
    locationReplace,
    locationAssign,
    hashWrites,
    dispatched,
    hash: () => url.hash,
    path: () => url.pathname,
    search: () => url.search,
    /** path + query + fragmento, sin origen: lo que se ve en la barra. */
    url: () => `${url.pathname}${url.search}${url.hash}`,
  };
}
