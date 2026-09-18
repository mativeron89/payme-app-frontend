import { expect, test, type Page } from '@playwright/test';

/**
 * AF-19 · parte B · la causa del intermitente de `google-continuar`
 * «Crea tu cuenta» (AF-17), establecida y fijada.
 *
 * Un `click` sólo llega al botón si el `mousedown` y el `mouseup` caen en el
 * MISMO elemento. `LoginScreen` remontaba el botón de Google en cada re-render,
 * aunque su autoridad no cambiara: `autoridadDeAlta` devolvía un objeto nuevo
 * por render y el memo dependía además de campos que `login`, `captura` y
 * `continue` no usan. Un re-render entre el down y el up (una capability o un
 * aviso que llegan tarde, o una letra en «Nombre») mandaba el `click` al
 * contenedor, y el toque se perdía sin error. Con Google real es peor: el botón
 * de GIS es un iframe, y cada remonte lo recarga.
 *
 * Medido antes del arreglo (evidencia de la orden, parteB/05): 3/3 toques
 * perdidos con un re-render entre down y up, y 3/3 bien sin él.
 *
 * 🔴 **Y una SEGUNDA causa, la que dejaba el toque en el camino 0.167.0.** El
 * aviso se recargaba al pasar del ingreso a «Crea tu cuenta» aunque ya
 * estuviera cargado. Durante ~300 ms la frase desaparecía y el botón de arriba
 * era `captura`. Medido en parteB/10: la frase aparecía DOS veces en 36 de 40
 * corridas. Con el arreglo (parteB/11), una sola vez en 40 de 40.
 */

async function prepararAlta(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('payme.app.mock.public_signup.v1', 'true');
    localStorage.setItem('payme.app.mock.google_sin_cuenta.v1', 'true');
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Crea tu cuenta', exact: true }).click();
  await expect(page.locator('.ingreso-aviso-google')).toBeVisible();
}

/** Re-render asíncrono que no cambia NADA: la misma config de nuevo al store. */
async function reRenderSinCambios(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const apiPath = '/src/api/index.ts';
    const socialPath = '/src/api/socialAuth.ts';
    const [{ api }, social] = await Promise.all([
      import(/* @vite-ignore */ apiPath), import(/* @vite-ignore */ socialPath),
    ]) as [{ api: { getConfig(): Promise<unknown> } }, { applySocialAuthConfig(c: unknown): unknown }];
    social.applySocialAuthConfig(await api.getConfig());
    await new Promise((r) => setTimeout(r, 50));
  });
}

test('🔴 un re-render entre mousedown y mouseup no se traga el toque en Google', async ({ page }) => {
  await prepararAlta(page);
  const caja = (await page.locator('.social-google-container button').boundingBox())!;
  await page.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2);
  await page.mouse.down();
  await reRenderSinCambios(page);
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
});

test('🔴 escribir en un campo que la autoridad no usa no remonta el botón de Google', async ({ page }) => {
  await prepararAlta(page);
  const remontado = await page.evaluate(async () => {
    const cont = document.querySelector('.social-google-container')!;
    const antes = cont.querySelector('button');
    const nombre = document.querySelector<HTMLInputElement>('input[autocomplete="given-name"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(nombre, 'A');
    nombre.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    return cont.querySelector('button') !== antes;
  });
  expect(remontado, 'el botón de Google se remontó sin que cambiara su autoridad').toBe(false);
});

test('control positivo: cuando la autoridad SÍ cambia, el botón se remonta', async ({ page }) => {
  // Sin este control, los dos tests de arriba pasarían también con un botón que
  // no se remonta NUNCA. Cambio real de autoridad: el dueño deja de publicar
  // `google_continue`, así que el botón de arriba pasa de `continue` a `captura`.
  await prepararAlta(page);
  const remontado = await page.evaluate(async () => {
    const apiPath = '/src/api/index.ts';
    const socialPath = '/src/api/socialAuth.ts';
    const [{ api }, social] = await Promise.all([
      import(/* @vite-ignore */ apiPath), import(/* @vite-ignore */ socialPath),
    ]) as [{ api: { getConfig(): Promise<Record<string, unknown>> } }, { applySocialAuthConfig(c: unknown): unknown }];
    const cfg = await api.getConfig();
    const features = { ...(cfg.features as Record<string, unknown>) };
    delete features.google_continue;
    const antes = document.querySelector('.social-google-container button');
    social.applySocialAuthConfig({ ...cfg, features });
    await new Promise((r) => setTimeout(r, 300));
    return document.querySelector('.social-google-container button') !== antes;
  });
  expect(remontado).toBe(true);
  await expect(page.locator('.ingreso-aviso-google')).toHaveCount(0);
});

test('🔴 pasar del ingreso a «Crea tu cuenta» no recarga el aviso ni apaga el un-toque', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('payme.app.mock.public_signup.v1', 'true');
    localStorage.setItem('payme.app.mock.google_sin_cuenta.v1', 'true');
  });
  await page.goto('/');
  // En el ingreso, el un-toque ya está listo: el aviso está cargado.
  await expect(page.locator('.ingreso-aviso-google')).toBeVisible();
  await page.evaluate(() => {
    const w = window as unknown as { __desapariciones: number };
    w.__desapariciones = 0;
    new MutationObserver(() => {
      if (!document.querySelector('.ingreso-aviso-google')) w.__desapariciones += 1;
    }).observe(document, { subtree: true, childList: true });
  });
  await page.getByRole('button', { name: 'Crea tu cuenta', exact: true }).click();
  await expect(page.getByText('O regístrate con tu correo', { exact: true })).toBeVisible();
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => (window as unknown as { __desapariciones: number }).__desapariciones),
    'la frase del un-toque desapareció al pasar a «Crea tu cuenta»').toBe(0);
  await expect(page.locator('.ingreso-aviso-google')).toBeVisible();
  // 🔴 Y el BOTÓN está, arriba. La frase sola no alcanza: la primera versión de
  // este test pasaba con el contenedor de arriba vacío (la autoridad idéntica
  // en los dos modos no volvía a dibujar el botón en el elemento nuevo).
  await expect(page.locator('.ingreso-alta-google').getByRole('button', { name: 'Continuar con Google', exact: true }))
    .toBeVisible();
});
