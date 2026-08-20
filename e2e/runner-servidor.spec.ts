/**
 * P2-02 · el runner tiene que correr contra ESTE árbol, no contra cualquiera.
 *
 * Codex reprodujo que `reuseExistingServer` hacía que Playwright adoptara el
 * servidor de otro árbol de trabajo y la corrida saliera **verde igual**. Un
 * verde así no prueba nada del commit auditado, y no deja rastro: no hay rojo
 * que mirar, hay una evidencia que no vale.
 *
 * El arreglo primario es de configuración (`reuseExistingServer: false` +
 * `--strictPort`). Este spec es la guarda que lo acredita **desde afuera de la
 * config**: compara el sentinela que sirve la app contra el `git rev-parse` de
 * este repo. Si alguien reactiva la reutilización y adopta un servidor ajeno,
 * esto se pone rojo nombrando los dos árboles.
 */
import { execSync } from 'node:child_process';
import { test, expect } from '@playwright/test';

function arbolLocal(): string {
  const head = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  const sucio = execSync('git status --porcelain', { encoding: 'utf8' }).trim() !== '';
  return `${head}${sucio ? '+sucio' : ''}`;
}

test('🔴 la app servida es la de ESTE árbol, no la de otro', async ({ page }) => {
  await page.goto('/');
  const servido = await page.evaluate(
    () => (window as unknown as { __ARBOL_SERVIDO__?: string }).__ARBOL_SERVIDO__,
  );

  // Que el sentinela exista es parte de la prueba: si no llegara, el resto
  // compararía `undefined` contra `undefined` y pasaría en vacío.
  expect(servido, 'la app servida no publica el sentinela: ¿es otro build?').toBeTruthy();
  expect(servido).not.toBe('desconocido');
  expect(
    servido,
    'el servidor NO es de este árbol: la corrida no prueba nada sobre este commit',
  ).toBe(arbolLocal());
});

/**
 * La otra mitad, y la que Codex pidió explícitamente: que el runner **RECHACE**
 * un servidor ajeno en vez de adoptarlo. No se puede probar desde adentro de
 * una corrida ya arrancada, así que se verifica la CONFIGURACIÓN que lo
 * produce — y se verifica que sea incondicional, que era justo el defecto:
 * `!process.env.CI` dejaba la reutilización viva en local, que es donde se
 * corren los gates antes de pedir un push.
 */
test('🔴 la config no reutiliza servidores, y no depende del entorno', async () => {
  const cfg = execSync('cat playwright.config.ts', { encoding: 'utf8' });
  expect(cfg).toMatch(/reuseExistingServer:\s*false\s*,/);
  expect(cfg).not.toMatch(/reuseExistingServer:\s*!process\.env/);
  // `--strictPort` es lo que convierte "puerto ocupado" en un fallo de arranque
  // en vez de un salto silencioso a otro puerto.
  expect(cfg).toContain('--strictPort');
});
