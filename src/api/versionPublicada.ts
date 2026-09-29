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
 *
 * AF-CARTEL-VERSION-NUEVA · decisión 125 de Mati («Cartel para actualizar»):
 * con la sesión iniciada NO se recarga sola. Con las mismas revisiones se
 * muestra un cartel y la persona decide (`useVersionNuevaPublicada`,
 * `components/CartelVersionNueva.tsx`).
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

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
 * Las revisiones, UNA sola definición para el ingreso y para el cartel: al
 * montar y al volver a la pestaña (`visibilitychange`, y `pageshow` del
 * bfcache). `alLeer` es el de este render: se consulta al llegar la respuesta.
 */
function useRevisarVersion(habilitada: boolean, alLeer: (publicada: string | null) => void): void {
  const leer = useRef(alLeer);
  useLayoutEffect(() => { leer.current = alLeer; });
  useEffect(() => {
    if (!habilitada) return undefined;
    let vivo = true;
    const revisar = () => {
      void leerVersionPublicada().then((publicada) => {
        if (vivo) leer.current(publicada);
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

/**
 * El ingreso: recarga sola. `sePuedeRecargar` se consulta al llegar la
 * respuesta, no al pedirla: si en ese rato la persona empezó a escribir, no se
 * recarga.
 */
export function useRecargaPorVersionNueva(habilitada: boolean, sePuedeRecargar: () => boolean): void {
  useRevisarVersion(habilitada, (publicada) => {
    if (!sePuedeRecargar()) return;
    recargarSiHayVersionNueva(publicada, VERSION_APP, almacenDeSesion(), () => window.location.reload());
  });
}

/** La publicada si es MÁS NUEVA que `actual`; si no, o sin respuesta, `null`. */
export function versionMasNueva(publicada: string | null, actual: string): string | null {
  return publicada !== null && esMasNueva(publicada, actual) ? publicada : null;
}

export interface RevisionDeVersion {
  /** Revisiones terminadas. Cada una puede volver a mostrar un cartel cerrado. */
  readonly n: number;
  /** La publicada si es más nueva que este bundle; si no, `null`. */
  readonly nueva: string | null;
}

/**
 * 🔴 AF-CARTEL-VERSION-NUEVA · con la sesión iniciada: las mismas revisiones
 * que el ingreso, pero NUNCA recarga. Sólo dice si hay una versión más nueva;
 * recargar es un toque de la persona en el cartel (decisión 125).
 */
export function useVersionNuevaPublicada(habilitada: boolean): RevisionDeVersion {
  const [revision, setRevision] = useState<RevisionDeVersion>({ n: 0, nueva: null });
  useRevisarVersion(habilitada, (publicada) => {
    const nueva = versionMasNueva(publicada, VERSION_APP);
    setRevision((previa) => ({ n: previa.n + 1, nueva }));
  });
  return revision;
}
