/**
 * AF-VERSION-NUEVA · que una pestaña vieja se actualice sola en el ingreso.
 *
 * El 400 de Mati del 27/09 corrió, casi seguro, en una pestaña con JS viejo: el
 * teléfono la tenía abierta desde antes de publicar y el arreglo no le llega a
 * JS que ya está cargado (CIERRE de AF-ALTA-POPUP-D106).
 *
 * - La versión que corre va EMBEBIDA en el build (`__APP_VERSION__`, del
 *   `package.json`, por `vite.config.ts`).
 * - La publicada es `/version.json`, que emite el mismo build. En Vercel va con
 *   `Cache-Control: no-store` (`vercel.ts`), y además se pide con
 *   `cache: 'no-store'`. El service worker no la toca: sólo cachea
 *   `/assets/*-<hash>` y los íconos.
 * - Si la publicada es MÁS NUEVA, la pantalla que llama recarga UNA vez por
 *   versión publicada en esta pestaña. La marca vive en `sessionStorage`: si
 *   después de recargar sigue viniendo el JS viejo (un CDN a medio propagar),
 *   no hay una segunda recarga. Sin `sessionStorage` no hay guarda contra el
 *   bucle, así que tampoco hay recarga.
 * - Sin respuesta, o con una respuesta rara, no hace nada.
 *
 * Qué pantallas pueden recargar lo decide quien llama: hoy, sólo el ingreso
 * montado desde `App` (ver `useRecargaPorVersionNueva`).
 */

import { useEffect, useLayoutEffect, useRef } from 'react';

declare const __APP_VERSION__: string;

/** La versión de ESTE bundle. */
export const VERSION_APP: string = __APP_VERSION__;

export const RUTA_VERSION_PUBLICADA = '/version.json';

/** Marca por pestaña: la versión publicada por la que ya se recargó. */
export const CLAVE_RECARGA_POR_VERSION = 'payme.app.recarga_por_version.v1';

const DEADLINE_MS = 5_000;
const FORMA = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/;

/** `{ "version": "x.y.z" }` y nada más; cualquier otra forma es `null`. */
export function decodeVersionPublicada(valor: unknown): string | null {
  if (typeof valor !== 'object' || valor === null || Array.isArray(valor)) return null;
  const claves = Object.keys(valor);
  if (claves.length !== 1 || claves[0] !== 'version') return null;
  const version = (valor as { version: unknown }).version;
  return typeof version === 'string' && FORMA.test(version) ? version : null;
}

/** ¿`publicada` es estrictamente posterior a `actual`? Con una forma rara, no. */
export function esMasNueva(publicada: string, actual: string): boolean {
  const p = FORMA.exec(publicada);
  const a = FORMA.exec(actual);
  if (!p || !a) return false;
  for (let i = 1; i <= 3; i += 1) {
    const dp = Number(p[i]);
    const da = Number(a[i]);
    if (dp !== da) return dp > da;
  }
  return false;
}

/** Lee `/version.json`. Cualquier falla —red, estado, tipo, forma, tiempo— es `null`. */
export async function leerVersionPublicada(): Promise<string | null> {
  const corte = new AbortController();
  const reloj = setTimeout(() => corte.abort(), DEADLINE_MS);
  try {
    const res = await fetch(RUTA_VERSION_PUBLICADA, {
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      headers: { accept: 'application/json' },
      signal: corte.signal,
    });
    const tipo = (res.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
    if (res.status !== 200 || tipo !== 'application/json') return null;
    return decodeVersionPublicada(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(reloj);
  }
}

/**
 * Recarga si `publicada` es más nueva que `actual` y todavía no se recargó por
 * ella en esta pestaña. La marca se escribe y se relee ANTES de recargar: si el
 * storage no la guarda, no hay recarga (sin marca, la próxima carga volvería a
 * recargar). Devuelve si recargó.
 */
export function recargarSiHayVersionNueva(
  publicada: string | null,
  actual: string,
  almacen: Pick<Storage, 'getItem' | 'setItem'> | null,
  recargar: () => void,
): boolean {
  if (publicada === null || !esMasNueva(publicada, actual) || almacen === null) return false;
  try {
    if (almacen.getItem(CLAVE_RECARGA_POR_VERSION) === publicada) return false;
    almacen.setItem(CLAVE_RECARGA_POR_VERSION, publicada);
    if (almacen.getItem(CLAVE_RECARGA_POR_VERSION) !== publicada) return false;
  } catch {
    return false;
  }
  recargar();
  return true;
}

export function almacenDeSesion(): Storage | null {
  try { return window.sessionStorage; } catch { return null; }
}

/**
 * Revisa al montar y al volver a la pestaña (`visibilitychange`, y `pageshow`
 * del bfcache). `sePuedeRecargar` se consulta al llegar la respuesta, no al
 * pedirla: si en ese rato la persona empezó a escribir, no se recarga.
 */
export function useRecargaPorVersionNueva(habilitada: boolean, sePuedeRecargar: () => boolean): void {
  const seguro = useRef(sePuedeRecargar);
  useLayoutEffect(() => { seguro.current = sePuedeRecargar; });
  useEffect(() => {
    if (!habilitada) return undefined;
    let vivo = true;
    const revisar = () => {
      void leerVersionPublicada().then((publicada) => {
        if (!vivo || !seguro.current()) return;
        recargarSiHayVersionNueva(publicada, VERSION_APP, almacenDeSesion(), () => window.location.reload());
      });
    };
    revisar();
    const alVolver = () => { if (document.visibilityState === 'visible') revisar(); };
    const alMostrar = (evento: PageTransitionEvent) => { if (evento.persisted) revisar(); };
    document.addEventListener('visibilitychange', alVolver);
    window.addEventListener('pageshow', alMostrar);
    return () => {
      vivo = false;
      document.removeEventListener('visibilitychange', alVolver);
      window.removeEventListener('pageshow', alMostrar);
    };
  }, [habilitada]);
}
