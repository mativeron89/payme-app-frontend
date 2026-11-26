import { expect, test, type Locator, type Page } from '@playwright/test';
import { join } from 'node:path';
import { burbuja, entrar, TEXTO_2A } from './_guia';
import { conRecursoRetenido } from './_recursoRetenido';

const correo = 'cuenta.ficticia.con.direccion.muy.larga.para.probar.el.ancho@example.invalid';

async function foto(page: Page, control: Locator, nombre: string) {
  const directorio = process.env.CUENTA_CAPTURAS_DIR;
  if (!directorio || page.viewportSize()?.width !== 320) return;
  await control.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.screenshot({ path: join(directorio, nombre + '.png'), animations: 'disabled' });
}

async function caja(locator: Locator) {
  return locator.evaluate(el => {
    const { left, right, top, bottom } = el.getBoundingClientRect();
    return { left, right, top, bottom };
  });
}

test('Soporte ofrece un único contacto y la baja se solicita desde Cuenta', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 812 });
  await entrar(page);
  await page.getByRole('button', { name: 'Más', exact: true }).click();
  const soporte = page.getByRole('region', { name: 'Soporte', exact: true });
  await expect(soporte).toHaveText('Soporte');
  await expect(soporte.getByRole('link')).toHaveCount(1);
  await expect(soporte.getByRole('link', { name: 'Soporte', exact: true }))
    .toHaveAttribute('href', 'mailto:soporte@paymemx.com');
  await foto(page, soporte, 'mas-soporte');

  const baja = page.getByRole('region', { name: 'Cuenta', exact: true })
    .getByRole('link', { name: 'Eliminar mi cuenta', exact: true });
  await expect(baja).toHaveAttribute('href', 'mailto:soporte@paymemx.com?subject=Solicitud%20de%20baja%20de%20cuenta%20PayMe');
  await baja.click({ trial: true });
  await foto(page, baja, 'cuenta-baja');
});

for (const width of [320, 375, 390]) {
  test(`Tutorial se alinea con las filas de Más y abre la guía a ${width} px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 812 });
    await entrar(page);
    await page.getByRole('button', { name: 'Más', exact: true }).click();
    const ayuda = page.getByRole('region', { name: 'Ayuda', exact: true });
    const tutorial = ayuda.getByRole('button', { name: 'Tutorial', exact: true });
    await expect(tutorial).toBeEnabled();
    await expect(ayuda).toHaveText('Tutorial');
    await page.evaluate(() => document.fonts.ready);
    const legal = page.getByRole('region', { name: 'Legal y ayuda', exact: true });
    const aviso = legal.getByRole('link', { name: 'Aviso de privacidad' });
    const soporte = page.getByRole('region', { name: 'Soporte', exact: true });
    const [a, l, s, fila, referencia, etiqueta, otra, flecha, otraFlecha] = await Promise.all([
      ayuda, legal, soporte, tutorial, aviso, tutorial.getByText('Tutorial', { exact: true }),
      aviso.getByText('Aviso de privacidad', { exact: true }), tutorial.locator('svg').last(), aviso.locator('svg').last(),
    ].map(caja));
    const medidas = { width, ayuda: a, legal: l, soporte: s, fila, referencia, etiqueta, otra, flecha, otraFlecha };
    await info.attach('geometria', { body: JSON.stringify(medidas), contentType: 'application/json' });
    expect([a.left, a.right, fila.left, fila.right, etiqueta.left, flecha.right])
      .toEqual([l.left, l.right, referencia.left, referencia.right, otra.left, otraFlecha.right]);
    expect(a.top - l.bottom).toBeGreaterThan(0);
    expect(a.top - l.bottom).toBe(l.top - s.bottom);
    await foto(page, tutorial, 'mas-tutorial');
    await tutorial.click();
    const inicio = burbuja(page, TEXTO_2A);
    await expect(inicio).toBeVisible();
    await foto(page, inicio, 'ayuda-guia');
  });
}

test('la fila de Google muestra el correo sólo después de confirmar el vínculo', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 812 });
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill(correo);
  await page.getByLabel(/^Contraseña$/).fill('demo-e2e');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  const mas = page.getByRole('button', { name: 'Más', exact: true });
  await expect(mas).toBeVisible();
  // El recurso local mantiene pendiente la lectura del mock hasta verificar la vista de carga.
  await page.evaluate(async () => {
    const ruta = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ ruta) as typeof import('../src/api');
    const original = api.getLinkedProviders;
    api.getLinkedProviders = async (...args) => {
      await fetch('/prueba-proveedores-pendientes');
      return original(...args);
    };
  });
  const google = page.getByRole('region', { name: 'Cuentas conectadas' });
  const direccion = google.getByText(correo, { exact: true });
  await conRecursoRetenido(page, '**/prueba-proveedores-pendientes', async () => {
    await mas.click();
    await expect(google.getByRole('status')).toHaveText('Cargando…');
    await expect(direccion).toHaveCount(0);
  }, ruta => ruta.fulfill({ status: 204 }));
  await expect(google.getByText('No vinculada', { exact: true })).toBeVisible();
  await expect(direccion).toHaveCount(0);
  await foto(page, google, 'google-sin-vincular');
  await google.getByRole('button', { name: 'Vincular Google', exact: true }).click();
  await google.getByRole('button', { name: 'Continuar con Google', exact: true }).click();
  await google.getByLabel(/^Contraseña$/).fill('demo-e2e');
  await google.getByRole('button', { name: 'Vincular', exact: true }).click();
  const estado = google.getByText('Vinculada', { exact: true });
  await expect(estado).toBeVisible();
  await expect(direccion).toBeVisible();
  const [texto, proveedor, seccion] = await Promise.all([direccion, estado, google].map(caja));
  expect(texto.top).toBeGreaterThanOrEqual(proveedor.bottom);
  expect(texto.left).toBe(proveedor.left);
  expect(texto.right).toBeLessThanOrEqual(seccion.right);
  expect(seccion.right).toBeLessThanOrEqual(320);
  expect(await direccion.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await foto(page, google, 'google-vinculada');
});
