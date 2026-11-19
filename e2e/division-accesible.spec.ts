import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';
import { sacarFoto } from './_camara';
import { hastaCompartir, pedidosDePropina } from './fixtures/mi-parte-d344';

async function capture(page: Page, name: string) {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (!dir) return;
  await page.locator('.hdr-user').evaluateAll(els => els.forEach(el => { el.textContent = 'Demo'; }));
  await page.screenshot({ path: `${dir}/${name}.png`, animations: 'disabled' });
}

async function dividir(page: Page, lang: 'es' | 'en', desactivado: boolean) {
  await page.addInitScript((modo) => localStorage.setItem('payme.app.mock.money_rail.v1', modo),
    desactivado ? 'disabled' : 'enabled');
  await ingresar(page);
  if (lang === 'en') {
    await page.evaluate(() => localStorage.setItem('payme.app.idioma.v1', 'en'));
    await page.reload();
  }
  await page.locator('.appbar-center').click();
  await sacarFoto(page, undefined, { usar: false });
  await page.getByRole('button', { name: lang === 'en' ? 'Use photo' : 'Usar foto', exact: true }).click();
  await expect(page.getByRole('radiogroup', { name: lang === 'en' ? 'How are you splitting?' : '¿Cómo dividen?' })).toBeVisible();
}

for (const lang of ['es', 'en'] as const) {
  test(`U2 · letra al 200% y 320×640 permiten tocar todos los radios (${lang})`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await dividir(page, lang, true);
    const total = page.locator('.ticket-total-card');
    const posicionNormal = (await total.boundingBox())!.y;
    await page.locator('.division-stepper').scrollIntoViewIfNeeded();
    expect((await total.boundingBox())!.y).toBeCloseTo(posicionNormal, 0);

    // Duplica cada tamaño de texto computado, incluidos los tokens en px.
    await page.locator('.af-diseno-flow').evaluate(raiz => {
      const hojas = [...raiz.querySelectorAll<HTMLElement>('h1, button, .div-title, .div-sub, .ticket-title-amount, .tk-fold-lbl, .ticket-title-iva')];
      const tamanos = hojas.map(h => parseFloat(getComputedStyle(h).fontSize));
      hojas.forEach((h, i) => { h.style.fontSize = `${2 * tamanos[i]!}px`; });
    });
    await expect(page.locator('.ticket-flow-body')).toHaveClass(/ticket-flow-body--desplazable/);
    const radios = page.locator('.division-options').getByRole('radio');
    await expect(radios).toHaveCount(3);
    for (const radio of await radios.all()) {
      await radio.click();
      await expect(radio).toBeChecked();
    }
    await expect.poll(async () => (await total.boundingBox())!.y).toBeLessThan(posicionNormal);
    const continuar = page.getByRole('button', { name: lang === 'en' ? 'Continue' : 'Continuar', exact: true });
    await expect(continuar).toBeInViewport();
    const mas = page.getByRole('button', { name: lang === 'en' ? 'One more diner' : 'Un comensal más' });
    await mas.click();
    await mas.click();
    await continuar.click({ trial: true });
  });

  for (const sinCobro of [true, false]) {
    test(`U6/U7 · nombre y ayuda de la división (${lang}, cobro ${sinCobro ? 'apagado' : 'activo'})`, async ({ page }) => {
      await dividir(page, lang, sinCobro);
      await expect(page.getByRole('radio', { name: lang === 'en' ? /^Everyone their own/ : /^Cada uno lo suyo/ })).toBeVisible();
      await page.locator('.div-opcion').first().getByRole('button').click();
      const esperado = lang === 'en'
        ? (sinCobro ? 'Everyone marks what they had.' : 'Everyone picks their items and pays for what they had.')
        : (sinCobro ? 'Cada uno marca lo que consumió.' : 'Cada uno selecciona sus ítems y paga por lo que consumió.');
      await expect(page.getByText(esperado, { exact: true })).toBeVisible();
      if (lang === 'es' && sinCobro) await capture(page, 'division-ayuda');
    });
  }
}

test('U14 · el buscador muestra el anillo de teclado dentro de la burbuja', async ({ page }) => {
  await hastaCompartir(page, { ocr: 'descuento', modo: 'igual' });
  const campo = page.getByRole('textbox', { name: 'Buscar contactos para invitar' });
  const burbuja = campo.locator('..');
  await campo.tap();
  await expect(burbuja).toHaveCSS('outline-style', 'none');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(campo).toBeFocused();
  expect(await campo.evaluate(el => el.matches(':focus-visible'))).toBe(true);
  await expect(burbuja).toHaveCSS('outline-color', 'rgb(16, 30, 59)');
  await expect(burbuja).toHaveCSS('outline-style', 'solid');
  await expect(burbuja).toHaveCSS('outline-offset', '-2px');
  await capture(page, 'invitar-foco');
});

test('U15 · flechas sólo mueven el foco, Enter y Espacio guardan una vez', async ({ page }) => {
  await hastaCompartir(page, { ocr: 'descuento', modo: 'igual' });
  const grupo = page.getByRole('group', { name: 'Propina de la mesa' });
  const cero = grupo.getByRole('button', { name: '0%', exact: true });
  const cinco = grupo.getByRole('button', { name: '5%', exact: true });
  const diez = grupo.getByRole('button', { name: '10%', exact: true });
  await cero.focus();
  await page.keyboard.press('ArrowRight');
  await expect(cinco).toBeFocused();
  await expect(cinco).toHaveAttribute('aria-pressed', 'false');
  expect(await pedidosDePropina(page)).toBe(0);
  await page.keyboard.press('Enter');
  await expect.poll(() => pedidosDePropina(page)).toBe(1);
  await expect(cinco).not.toHaveAttribute('aria-disabled', 'true');
  await expect(cinco).toBeFocused();
  await expect(cinco).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(diez).toBeFocused();
  expect(await pedidosDePropina(page)).toBe(1);
  await page.keyboard.press('Space');
  await expect.poll(() => pedidosDePropina(page)).toBe(2);
  await expect(diez).toHaveAttribute('aria-pressed', 'true');
  await capture(page, 'propina-teclado');
});
