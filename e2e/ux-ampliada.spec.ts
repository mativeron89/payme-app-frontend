import { abrirTusConsumos } from './_mesa';
import { sacarFoto } from './_camara';
import { expect, test, type Page } from '@playwright/test';
import { ingresar, irEnLaApp } from './_app';
import { hastaCompartir } from './fixtures/mi-parte-d344';
const TIP = 'La eliges tú para toda la mesa y se reparte según lo que consumió cada quien. Es voluntaria y puedes cambiarla después.';
const FULL = 'Esta mesa tiene muchas solicitudes pendientes. Pídele a quien la abrió que acepte las que tiene.';
const NEUTRO = 'No pudimos sumarte a esta mesa.';
async function foto(page: Page, nombre: string) {
  if (process.env.PAYME_E2E_CAPTURAS) {
    await page.locator('.hdr-user').evaluateAll(xs => xs.forEach(x => { x.textContent = 'Demo'; }));
    await page.screenshot({ path: `${process.env.PAYME_E2E_CAPTURAS}/${nombre}.png`, animations: 'disabled' });
  }
}
test('K18 · explicación y enlace en la hoja nativa', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'share', { configurable: true, value: (data: ShareData) => {
    (window as unknown as { textoCompartido: string }).textoCompartido = data.text ?? ''; return Promise.resolve();
  } }));
  const code = await hastaCompartir(page, { ocr: 'descuento', modo: 'consumo' });
  await expect(page.getByText(TIP, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Compartir…', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { textoCompartido: string }).textoCompartido)).toContain(code);
  await foto(page, '18-compartir-mesa');
});
test('K18 · sin soporte no ofrece Compartir…', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'share', { configurable: true, value: undefined }));
  await hastaCompartir(page, { ocr: 'descuento', modo: 'consumo' });
  await expect(page.getByText(TIP, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Compartir…', exact: true })).toHaveCount(0);
});
test('K19 · Google principal en cuenta de entrada por link', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('payme.app.mock.public_signup.v1', 'true'); });
  await page.goto('/#/mesa/PA-1234?t=ejemplo-link-de-mesa');
  await page.getByRole('button', { name: 'Ya tengo cuenta · Entrar', exact: true }).click();
  const google = page.getByRole('group', { name: 'Continuar con Google', exact: true });
  await expect(google).toBeVisible();
  expect(await google.evaluate(el => Boolean(el.compareDocumentPosition(document.querySelector('input[type=email]')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await expect(page.locator('.ingreso-desde-mesa .ingreso-entrar')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await foto(page, '19-cuenta-desde-link');
});
test('K20 · menú de amigo y solicitud; confirmación propia y foco', async ({ page }) => {
  await ingresar(page); await irEnLaApp(page, '/amigos');
  const amigo = page.getByRole('button', { name: 'Más acciones de Juan López', exact: true });
  await amigo.click(); await page.getByRole('button', { name: 'Bloquear', exact: true }).click();
  const hoja = page.getByRole('dialog', { name: /¿Bloquear a Juan López/ });
  await expect(hoja).toBeVisible();
  await expect(hoja.getByRole('button', { name: 'Cancelar', exact: true })).toBeFocused();
  await foto(page, '20-confirmar-bloqueo');
  await page.keyboard.press('Escape'); await expect(amigo).toBeFocused();
  await page.getByRole('tab', { name: /Solicitudes/ }).click();
  const mas = page.getByRole('button', { name: /^Más acciones de / }).first(); await mas.click();
  await expect(page.getByRole('button', { name: /^Bloquear a / })).toBeVisible();
});
test('K21 · Legal y ayuda conserva enlaces vigentes y correo fijo', async ({ page }) => {
  await ingresar(page); await irEnLaApp(page, '/mas');
  const seccion = page.getByRole('region', { name: 'Legal y ayuda', exact: true });
  await expect(seccion.getByRole('link', { name: 'Aviso de privacidad', exact: true })).toHaveAttribute('href', '/privacy');
  await expect(seccion.getByRole('link', { name: 'Términos de uso', exact: true })).toHaveAttribute('href', '/terminos');
  await expect(seccion.getByRole('link', { name: 'Escríbenos: soporte@paymemx.com', exact: true })).toHaveAttribute('href', 'mailto:soporte@paymemx.com');
  await expect(seccion.getByRole('link', { name: 'Eliminar mi cuenta', exact: true })).toHaveAttribute('href', 'mailto:soporte@paymemx.com?subject=Solicitud%20de%20baja%20de%20cuenta%20PayMe');
  await foto(page, '21-legal-y-ayuda');
});
for (const [status, code] of [[403, 'invitation_link_not_valid'], [409, 'join_request_not_allowed'], [410, 'mesa_not_joinable'], [409, 'join_requests_full']] as const) {
  test(`K23 · link ${status} ${code}: texto y sin reintento`, async ({ page }) => {
    await ingresar(page);
    await page.evaluate(async ({ status: s, code: c }) => {
      const ruta = '/src/api/index.ts'; const { api } = await import(/* @vite-ignore */ ruta) as typeof import('../src/api');
      const errores = '/src/api/http.ts'; const { HttpError } = await import(/* @vite-ignore */ errores) as typeof import('../src/api/http');
      api.acceptInvitationLink = async () => { throw new HttpError(s, { error: c }); };
    }, { status, code });
    await irEnLaApp(page, '/mesa/PA-1234?t=ejemplo-link-de-mesa');
    await expect(page.getByRole('heading', { name: code === 'join_requests_full' ? FULL : NEUTRO, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reintentar', exact: true })).toHaveCount(0);
    if (code === 'join_requests_full') await foto(page, '23-solicitudes-pendientes');
  });
}

test('K20 · el menú del último amigo queda visible fuera de la tarjeta', async ({ page }) => {
  await ingresar(page); await irEnLaApp(page, '/amigos');
  const mas = page.getByRole('button', { name: /^Más acciones de / }).last();
  await mas.scrollIntoViewIfNeeded(); await mas.click();
  const quitar = page.getByRole('button', { name: 'Quitar de amigos', exact: true });
  await expect(quitar).toBeFocused(); await expect(quitar).toBeInViewport();
  await quitar.click(); await expect(page.getByRole('dialog', { name: /¿Quitar a / })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(mas).toBeFocused();
});
test('K22 · apertura sin jerga en el caso correcto', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled'));
  await ingresar(page);
  await page.evaluate(async () => {
    const ruta = '/src/api/index.ts'; const { api } = await import(/* @vite-ignore */ ruta) as typeof import('../src/api');
    const errores = '/src/api/http.ts'; const { HttpError } = await import(/* @vite-ignore */ errores) as typeof import('../src/api/http');
    api.createMesa = async () => { throw new HttpError(400, { error: 'invalid_items' }); };
  });
  await page.getByRole('button', { name: 'Escanear', exact: true }).click(); await sacarFoto(page);
  await page.getByRole('radio', { name: /Por lo que pidió cada uno/ }).click();
  await page.getByRole('button', { name: 'Un comensal más' }).click();
  await page.getByRole('button', { name: 'Un comensal más' }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('No pudimos abrir la mesa. Prueba de nuevo.');
  await foto(page, '22-apertura-error');
});
test('K22 · tarjeta pendiente conserva bloqueo y mensaje de un solo intento', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('payme.app.mock.money_rail.v1', 'sandbox'));
  await ingresar(page); await irEnLaApp(page, '/mesa/PA-2847'); await abrirTusConsumos(page);
  await page.getByRole('button', { name: 'Tagliatelle Bolognese', exact: true }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByRole('radio', { name: '10%', exact: true }).click();
  await page.evaluate(async () => {
    const ruta = '/src/api/index.ts'; const { api } = await import(/* @vite-ignore */ ruta) as typeof import('../src/api');
    const errores = '/src/api/http.ts'; const { HttpError } = await import(/* @vite-ignore */ errores) as typeof import('../src/api/http');
    api.payMesa = async () => { throw new HttpError(409, { error: 'monetary_family_reconciliation_required' }); };
  });
  await page.getByRole('button', { name: 'Pagar $216', exact: true }).click();
  await expect(page.getByText('Estamos confirmando un intento anterior. No se hizo ningún cobro nuevo. Vuelve a intentar en unos minutos.', { exact: true }).first()).toBeVisible();
  await foto(page, '22-tarjeta-intento-anterior');
});
