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

async function estilo(locator: Locator) {
  return locator.evaluate(el => {
    const css = getComputedStyle(el);
    return { fondo: css.backgroundColor, radio: css.borderRadius, alto: el.getBoundingClientRect().height };
  });
}

for (const en of [false, true]) {
  test(`Legal y ayuda conserva en orden los cuatro enlaces y los dos correos (${en ? 'EN' : 'ES'})`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 812 });
    await entrar(page);
    await page.getByRole('button', { name: 'Más', exact: true }).click();
    if (en) await page.getByRole('button', { name: 'EN', exact: true }).click();

    const legal = page.getByRole('region', { name: en ? 'Legal and help' : 'Legal y ayuda', exact: true });
    const nombres = en ? ['Privacy notice', 'Terms of use', 'Support', 'Delete my account']
      : ['Aviso de privacidad', 'Términos de uso', 'Soporte', 'Eliminar mi cuenta'];
    await expect(legal.getByRole('link')).toHaveText(nombres);
    await expect(page.locator('.config-screen a[href^="mailto:"]')).toHaveCount(2);
    const soporte = legal.getByRole('link', { name: nombres[2], exact: true });
    const baja = legal.getByRole('link', { name: nombres[3], exact: true });
    await expect(soporte).toHaveAttribute('href', 'mailto:soporte@paymemx.com');
    await expect(baja).toHaveAttribute('href', 'mailto:soporte@paymemx.com?subject=Solicitud%20de%20baja%20de%20cuenta%20PayMe');
    const aviso = legal.getByRole('link', { name: nombres[0], exact: true });
    for (const propiedad of ['color', 'text-decoration-line']) {
      const valor = await aviso.evaluate((el, prop) => getComputedStyle(el).getPropertyValue(prop), propiedad);
      await expect(soporte).toHaveCSS(propiedad, valor);
      await expect(baja).toHaveCSS(propiedad, valor);
    }
    await baja.click({ trial: true });
    await foto(page, legal, en ? 'legal-y-ayuda-en' : 'legal-y-ayuda');
  });
}

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
    const cuenta = page.getByRole('region', { name: 'Cuenta', exact: true });
    const conectadas = page.getByRole('region', { name: 'Cuentas conectadas', exact: true });
    await expect(conectadas.getByText('No vinculada', { exact: true })).toBeVisible();
    const [a, l, c, g, fila, referencia, etiqueta, otra, flecha, otraFlecha] = await Promise.all([
      ayuda, legal, cuenta, conectadas, tutorial, aviso, tutorial.getByText('Tutorial', { exact: true }),
      aviso.getByText('Aviso de privacidad', { exact: true }), tutorial.locator('svg').last(), aviso.locator('svg').last(),
    ].map(caja));
    const [tarjeta, tarjetaLegal, boton, enlace] = await Promise.all([ayuda, legal, tutorial, aviso].map(estilo));
    expect(tarjeta.fondo).toBe(tarjetaLegal.fondo);
    expect(tarjeta.radio).toBe(tarjetaLegal.radio);
    expect(boton).toEqual(enlace);
    const medidas = { width, ayuda: a, legal: l, cuenta: c, conectadas: g, fila, referencia, etiqueta, otra, flecha,
      otraFlecha, tarjeta, tarjetaLegal, boton, enlace };
    await info.attach('geometria', { body: JSON.stringify(medidas), contentType: 'application/json' });
    expect([a.left, a.right, fila.left, fila.right, etiqueta.left, flecha.right])
      .toEqual([l.left, l.right, referencia.left, referencia.right, otra.left, otraFlecha.right]);
    expect(a.top - l.bottom).toBeGreaterThan(0);
    expect(a.top - l.bottom).toBe(g.top - c.bottom);
    await foto(page, tutorial, 'mas-tutorial');
    await tutorial.click();
    const inicio = burbuja(page, TEXTO_2A);
    await expect(inicio).toBeVisible();
    await foto(page, inicio, 'ayuda-guia');
  });

  test(`La nota del Tutorial queda dentro de la tarjeta a ${width} px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 812 });
    await entrar(page, { dejarElAvisoDeFotos: true });
    await expect(page.getByRole('complementary', { name: 'Actualización del Aviso de Privacidad', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Más', exact: true }).click();
    const ayuda = page.getByRole('region', { name: 'Ayuda', exact: true });
    const tutorial = ayuda.getByRole('button', { name: 'Tutorial', exact: true });
    const texto = 'Primero responde el aviso «Tu foto entre amigos» en Inicio.';
    const nota = ayuda.getByText(texto, { exact: true });
    await expect(nota).toBeVisible();
    await expect(tutorial).toBeDisabled();
    await expect(tutorial).toHaveAccessibleDescription(texto);
    await page.evaluate(() => document.fonts.ready);
    const [tarjeta, parrafo] = await Promise.all([ayuda, nota].map(caja));
    const inicioTexto = await nota.evaluate(el => {
      const contenido = document.createRange();
      contenido.selectNodeContents(el);
      return contenido.getClientRects()[0].left;
    });
    const izquierda = inicioTexto - tarjeta.left;
    const derecha = tarjeta.right - parrafo.right;
    const inferior = tarjeta.bottom - parrafo.bottom;
    const bordeBoton = await tutorial.evaluate(el => getComputedStyle(el).borderBottomWidth);
    await info.attach('nota', { body: JSON.stringify({ width, tarjeta, parrafo, izquierda, derecha, inferior, bordeBoton }), contentType: 'application/json' });
    expect([izquierda, derecha, inferior]).toEqual([16, 16, 12]);
    expect(bordeBoton).toBe('0px');
    await foto(page, ayuda, 'tutorial-con-nota');
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
