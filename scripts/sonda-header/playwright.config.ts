/**
 * Sonda de geometría del header en DOS motores (Chromium y WebKit de
 * Playwright). No es parte de la suite: vive fuera de `e2e/` a propósito.
 *
 *   npx playwright install webkit            (una vez)
 *   CAP=/ruta/captura.png SONDA_CSS='.hdr-user{transform:translateY(2px) !important}' \
 *     npx playwright test -c scripts/sonda-header/playwright.config.ts
 *
 * Imprime `TINTA[motor] {...}` con el centro de tinta del nombre, el centro
 * del cuadrado azul y el de las mayúsculas de «PayMe» (canvas + línea base),
 * y deja una captura 3x por motor. Sirve para iterar `--hdr-user-nudge` con
 * una captura real de Mati (orden AF-HEADER-WEBKIT-CLAUDE-20260922).
 */
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import base from '../../playwright.config';
// Playwright resuelve el `cwd` del webServer relativo a ESTE archivo: Vite
// tiene que arrancar en la raíz del repo, no en `scripts/sonda-header/`.
const raiz = fileURLToPath(new URL('../../', import.meta.url));
export default defineConfig({
  ...base,
  testDir: '.',
  webServer: { ...(base.webServer as Exclude<typeof base.webServer, undefined | unknown[]>), cwd: raiz },
  reporter: [['list']],
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
});
