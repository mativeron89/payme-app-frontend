import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';

const cuerpo = (kind: string) => readFileSync(new URL(`../test-fixtures/legal-d457/${kind}.txt`, import.meta.url), 'utf8').trim();
const legal = (kind: string) => {
  const body = cuerpo(kind);
  return { kind, version: '3.1.0', hash: createHash('sha256').update(body).digest('hex'), effective_from: '2026-10-23T00:00:00.000Z', body };
};

for (const [path, kind] of [['/privacy', 'aviso_privacidad'], ['/terminos', 'terminos_uso']] as const) {
  test(`D456 · ${path} conserva todos los bytes visibles y enlaces del texto público`, async ({ page }) => {
    const documento = legal(kind);
    const pedidos: Array<{ auth: string | undefined; method: string }> = [];
    await page.route(`**/api/legal/${kind}`, async (route) => {
      pedidos.push({ auth: route.request().headers()['authorization'], method: route.request().method() });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ legal_text: documento }) });
    });
    await page.goto(path);
    const texto = page.locator('.pub-cuerpo');
    await expect(texto).toBeVisible();
    expect(await texto.textContent()).toBe(documento.body);
    const links = await texto.getByRole('link').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('href')));
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((href) => ['mailto:soporte@paymemx.com', 'https://app.paymemx.com/privacy', 'https://app.paymemx.com/terminos'].includes(href ?? ''))).toBe(true);
    expect(pedidos).toEqual([{ auth: undefined, method: 'GET' }]);
  });
}

test('D456 · alta ofrece Simplificado, Integral y la frase literal, con dos casillas vacías', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('payme.app.mock.legal_3_0_0.v1', 'on');
    localStorage.setItem('payme.app.mock.public_signup.v1', 'true');
  });
  await page.goto('/');
  await page.evaluate(async (documentos) => {
    const ruta = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ ruta) as { api: Record<string, (...args: unknown[]) => Promise<unknown>> };
    api.getPrivacyNotice = async () => ({ legal_text: documentos.aviso_privacidad });
    api.getLegalText = async (kind) => ({ legal_text: documentos[kind as keyof typeof documentos] });
  }, { aviso_privacidad: legal('aviso_privacidad'), aviso_privacidad_simplificado: legal('aviso_privacidad_simplificado'), terminos_uso: legal('terminos_uso') });
  await page.getByRole('button', { name: 'Crea tu cuenta', exact: true }).click();
  const frase = cuerpo('alta').split('\n\n')[4]!;
  await expect(page.getByText(frase, { exact: true })).toBeVisible();
  const boxes = page.getByRole('checkbox');
  await expect(boxes).toHaveCount(2);
  for (const box of await boxes.all()) await expect(box).not.toBeChecked();
  await page.getByText('Aviso de Privacidad Simplificado', { exact: true }).click();
  const simplificado = page.locator('details.legal-notice pre');
  await expect(simplificado).toBeVisible();
  expect(await simplificado.textContent()).toBe(cuerpo('aviso_privacidad_simplificado'));
  await expect(page.getByRole('link', { name: 'Aviso de Privacidad Integral', exact: true })).toHaveAttribute('href', '/privacy');
  await expect(page.getByRole('link', { name: 'Términos de Uso', exact: true })).toHaveAttribute('href', '/terminos');
  await expect(page.getByRole('switch')).toHaveCount(0);
});
