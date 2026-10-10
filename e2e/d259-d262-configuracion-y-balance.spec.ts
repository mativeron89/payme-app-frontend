import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

/**
 * D259 · Mati, en Configuración del viaje: «quitar "les llega una invitscion…" y "el viaje"».
 * D261 · en Balance: «Que no haya tanto espacio entre el volver y las burbujas de consumos y miembros».
 * D262 · en Balance: «Los titulos de las burbujas (consumos y miembros) en negrita, en el listado solo poner el ítem
 * sin la fecha ni quien pagó (eso se ve cuando se ingresa al ítem)».
 */

const CANCUN = 'd1000000-0000-4000-8000-000000000001';

test.use({ viewport: { width: 375, height: 812 } });

async function conViajes(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('payme.app.mock.viajes.v1', 'encendido'));
  await ingresar(page);
}

async function ir(page: Page, ruta: string): Promise<void> {
  await page.evaluate((u) => {
    history.pushState(null, '', u);
    dispatchEvent(new PopStateEvent('popstate'));
  }, ruta);
}

test('🔴 D259 · Configuración, sin «Les llega una invitación…» ni el título «El viaje»; las tres filas siguen', async ({ page }) => {
  await conViajes(page);
  await ir(page, `/viaje/${CANCUN}`);
  await page.getByRole('button', { name: 'Configuración', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Agregar miembros', exact: true })).toBeVisible();
  await expect(page.getByText('Les llega una invitación', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'El viaje', exact: true })).toHaveCount(0);
  await expect(page.getByText('El viaje', { exact: true })).toHaveCount(0);
  // Ningún título en la tarjeta de las tres filas, con este texto o con otro.
  await expect(page.locator('.vjcfg-viaje').getByRole('heading')).toHaveCount(0);
  for (const fila of ['Nombre y fechas', 'Color', 'Foto']) {
    await expect(page.getByRole('button', { name: new RegExp(`^${fila}`) })).toBeVisible();
  }
});

test('🔴 D261 · Balance: las pestañas a 8 px de la fila de «Volver», todavía pegadas a la tarjeta', async ({ page }) => {
  await conViajes(page);
  await ir(page, `/viaje-balance/${CANCUN}`);
  const consumos = page.locator('header.hdr').getByRole('tab', { name: 'Consumos', exact: true });
  await expect(consumos).toHaveAttribute('aria-selected', 'true');
  const m = await page.evaluate(() => {
    const fila = document.querySelector('header.hdr .hdr-back')!.closest('.hdr-row')!.getBoundingClientRect();
    const tabs = document.querySelector('header.hdr .btabs')!.getBoundingClientRect();
    const tab = document.querySelector('header.hdr .btab.on')!.getBoundingClientRect();
    const tarjeta = document.querySelector('.mounted-card')!.getBoundingClientRect();
    return { franja: tabs.top - fila.bottom, union: Math.abs(tarjeta.top - tab.bottom) };
  });
  expect(m.franja).toBeCloseTo(8, 0);
  expect(m.union).toBeLessThanOrEqual(1);
});

test('🔴 D262 · Balance: «Consumos» y «Miembros» en negrita, elegida o no', async ({ page }) => {
  await conViajes(page);
  await ir(page, `/viaje-balance/${CANCUN}`);
  const pesos = () => page.locator('header.hdr .btab').evaluateAll((xs) => xs.map((x) => getComputedStyle(x).fontWeight));
  await expect(page.locator('header.hdr').getByRole('tab', { name: 'Consumos', exact: true })).toBeVisible();
  expect(await pesos()).toEqual(['700', '700']);
  await page.locator('header.hdr').getByRole('tab', { name: 'Miembros', exact: true }).click();
  await expect(page.locator('.mounted-card.seam-right')).toBeVisible();
  expect(await pesos()).toEqual(['700', '700']);
});

test('🔴 D262 · Consumos: cada fila, sólo el ítem y su monto; sin fecha ni «Pagó»; deslizar sigue', async ({ page }) => {
  await conViajes(page);
  await ir(page, `/viaje-balance/${CANCUN}`);
  const fila = (lugar: string) => page.locator('.vjb-consumos > li').filter({ hasText: lugar });
  await expect(fila('Mariscos El Faro')).toBeVisible();
  const textos = await page.locator('.vjb-consumo').allInnerTexts();
  for (const t of textos) {
    expect(t, t).not.toMatch(/Pag(ó|aste)/);
    expect(t, t).not.toMatch(/\b\d{1,2} (ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)\b/);
  }
  await expect(fila('Bar La Ola').locator('.vjb-consumo-monto')).toHaveText('$960');
  await expect(fila('Mariscos El Faro')).toContainText('Falta que elija 1');
  // Deslizar para eliminar sigue donde se puede.
  const c = (await fila('Bar La Ola').boundingBox())!;
  const x = c.x + c.width - 40;
  const y = c.y + c.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let k = 1; k <= 8; k += 1) await page.mouse.move(x - (120 * k) / 8, y);
  await page.mouse.up();
  await expect(fila('Bar La Ola').getByRole('button', { name: 'Eliminar Bar La Ola', exact: true })).toBeInViewport({ ratio: 1 });
  // Al entrar al ítem, la fecha y quién pagó siguen.
  await fila('Mariscos El Faro').click();
  await expect(page.getByText(/8 oct · Pagó Luis Pérez/)).toBeVisible();
});
