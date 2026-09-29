import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import sonda from './sonda-header/playwright.config';

/**
 * AF-CORRECCIONES-AUDITORIA · AF-02 de la auditoría Codex (decisión 120).
 *
 * La sonda del encabezado hereda el `webServer` de la config base. Cuando la
 * base pasó de UN servidor a una lista de tres (n186, `a79d8e1`), la sonda
 * siguió esparciendo el valor como si fuera un objeto: quedaba `{0,1,2,cwd}` sin
 * `command`, y Playwright cortaba con «config.webServer.command cannot be empty»
 * antes de abrir el navegador. Un cast lo tapaba en el typecheck y `--list` no
 * arranca servidores, así que nada lo veía.
 *
 * Esto mira el valor que Playwright recibe, no el tipo.
 */
const raiz = fileURLToPath(new URL('../', import.meta.url));

describe('AF-02 · la sonda del encabezado arranca el servidor mock', () => {
  const servidores = sonda.webServer === undefined ? []
    : Array.isArray(sonda.webServer) ? sonda.webServer : [sonda.webServer];

  it('hay al menos un servidor', () => {
    expect(servidores.length).toBeGreaterThan(0);
  });

  it('cada servidor tiene comando, la url del mock y arranca en la raíz del repo', () => {
    for (const s of servidores) {
      expect(typeof s.command === 'string' && s.command.trim().length > 0, 'command vacío').toBe(true);
      expect(s.url).toBe('http://localhost:5176');
      expect(s.cwd).toBe(raiz);
      // Nunca adoptar un servidor ajeno en el puerto (P2-02).
      expect(s.reuseExistingServer).toBe(false);
    }
  });
});
