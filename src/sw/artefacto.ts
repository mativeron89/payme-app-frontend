/**
 * APP-PWA-B2 · de la plantilla `serviceWorker.js` al `/sw.js` que se sirve.
 *
 * La versión del caché SALE del `package.json`, no se escribe a mano: una
 * segunda copia de la versión es una copia que se desincroniza sin avisar —el
 * `package-lock.json` quedó cuatro versiones atrás exactamente así—. Esta
 * función es la ÚNICA que hace la transformación, y la usan el build
 * (`vite.config.ts`) y los tests, así que lo probado es lo emitido.
 */

export const MARCADOR_VERSION = '__PAYME_SW_VERSION__';

const SEMVER = /^\d+\.\d+\.\d+$/;

export function construirServiceWorker(plantilla: string, version: string): string {
  if (!SEMVER.test(version)) {
    throw new Error(`service worker: versión inválida «${version}»; se espera X.Y.Z`);
  }
  const apariciones = plantilla.split(MARCADOR_VERSION).length - 1;
  // Exactamente UNA: cero significa que la plantilla cambió y el caché dejaría
  // de versionarse; dos o más, que alguien la nombró en otro lado y el reemplazo
  // tocaría algo que no es la versión.
  if (apariciones !== 1) {
    throw new Error(`service worker: la plantilla nombra el marcador de versión ${apariciones} veces; debe ser 1`);
  }
  return plantilla.replace(MARCADOR_VERSION, version);
}
