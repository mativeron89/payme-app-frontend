import { expect, test } from '@playwright/test';
import { ingresar } from './_app';
import {
  completarDivision,
  configurarTicketSinQr,
  estadoN179,
} from './fixtures/ticket-sin-qr';

async function escanearSinQr(page: import('@playwright/test').Page): Promise<void> {
  await ingresar(page);
  await page.getByRole('button', { name: 'Nueva', exact: true }).click();
  await expect(page).toHaveURL(/#\/scan$/);
  await page.getByRole('button', { name: 'Capturar' }).click();
}

test.describe('n179 · ticket real sin QR', () => {
  test('merchant → resolve privado → mesa record-only, sólo después del CTA', async ({ page }, testInfo) => {
    await configurarTicketSinQr(page);
    await escanearSinQr(page);
    await expect(page.getByRole('radio', { name: /Pagar el total/ })).toBeVisible();
    await expect(page.getByLabel('Nombre del restaurante (opcional)')).toHaveCount(0);

    const before = await estadoN179(page);
    expect(before.mesas).toHaveLength(0);
    expect(before.privateRestaurantIds).toHaveLength(1);
    expect(before.privateRestaurantIds[0]).toMatch(/^[0-9a-f-]{36}$/i);
    await expect(page.locator('body')).not.toContainText('TEG010101AB1');

    await completarDivision(page);
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Compartir la mesa' })).toBeVisible();

    const after = await estadoN179(page);
    expect(after.mesas).toHaveLength(1);
    expect(after.mesas[0]?.restaurant.id).toBe(before.privateRestaurantIds[0]);
    await expect(page.getByRole('heading', { name: 'Garantiza la mesa' })).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath('captura-movil-ticket-sin-qr.png'),
      fullPage: true,
    });
  });

  test('V07 · sin merchant permite nombre privado normalizado y lo conserva en compartir, detalle e historial', async ({ page }, testInfo) => {
    await configurarTicketSinQr(page, { ocr: 'no_merchant' });
    await escanearSinQr(page);
    await expect(page.getByRole('radio', { name: /Pagar el total/ })).toBeVisible();
    await expect.poll(async () => (await estadoN179(page)).privateRestaurantIds.length).toBe(1);

    const label = page.getByLabel('Nombre del restaurante (opcional)');
    await expect(label).toBeVisible();
    await label.fill('  Cafe\u0301   del Centro  ');
    await expect(page.getByText('Sólo identifica esta mesa; no crea ni modifica un comercio.')).toBeVisible();
    await completarDivision(page);
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Compartir la mesa' })).toBeVisible();
    await expect(page.getByText(/Café del Centro · Mesa PA-/)).toBeVisible();

    const state = await estadoN179(page);
    expect(state.mesas).toHaveLength(1);
    expect(state.mesas[0]?.restaurant.name).toBe('Café del Centro');
    const code = state.mesas[0]!.code;

    await page.goto(`/#/mesa/${code}`);
    // M04 (`9c78a7b`, v0.184.0): en el detalle el nombre va en la línea
    // `restaurante / código`; el texto exacto solo ya no existe como elemento.
    await expect(page.getByText(new RegExp(`^Café del Centro / ${code}$`))).toBeVisible();
    await page.reload();
    await expect(page.getByText(new RegExp(`^Café del Centro / ${code}$`))).toBeVisible();

    await page.evaluate(async (mesaCode) => {
      const storePath = '/src/api/mock/store.ts';
      const { state: mockState, persist } = await import(/* @vite-ignore */ storePath) as {
        state: { mesas: Array<{ code: string; status: string; guarantee_mode?: boolean; closure_reason?: string | null }> };
        persist: () => void;
      };
      const mesa = mockState.mesas.find((candidate) => candidate.code === mesaCode);
      if (!mesa) throw new Error('mesa V07 ausente');
      mesa.status = 'expired';
      mesa.guarantee_mode = false;
      mesa.closure_reason = 'time';
      persist();
    }, code);
    await page.goto('/#/mesas');
    await expect(page.getByRole('heading', { name: 'Historial' })).toBeVisible();
    await expect(page.getByText('Café del Centro', { exact: true }).first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('v07-nombre-privado-historial.png'), fullPage: true });
  });

  test('respuesta perdida después de crear reusa UUID y conserva count=1', async ({ page }) => {
    await configurarTicketSinQr(page, { lostResponse: true });
    await escanearSinQr(page);
    await expect(page.getByRole('radio', { name: /Pagar el total/ })).toBeVisible();
    await completarDivision(page);

    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText(
      'No pudimos confirmar la apertura. Puede que la mesa ya se haya creado: reintenta esta misma apertura, no armes otra.',
    );
    // Un solo estado conserva las cuatro garantías sin duplicar feedback: el
    // resultado es ambiguo, la mesa puede existir, se reintenta la misma
    // apertura y no se arma otra. Un segundo alert volvería a tapar esta causa.
    await expect(page.getByRole('alert')).toHaveCount(0);
    const lost = await estadoN179(page);
    expect(lost.mesas).toHaveLength(1);
    expect(lost.mesaLedgerKeys).toHaveLength(1);
    expect(lost.mesaLedgerKeys[0]).toMatch(/^mesa:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Compartir la mesa' })).toBeVisible();
    const retry = await estadoN179(page);
    expect(retry.mesas).toHaveLength(1);
    expect(retry.mesas[0]?.id).toBe(lost.mesas[0]?.id);
    expect(retry.mesaLedgerKeys).toEqual(lost.mesaLedgerKeys);
  });

  test('contrato OCR malformado da error visible y conserva carga manual', async ({ page }) => {
    await configurarTicketSinQr(page, { ocr: 'malformed' });
    await escanearSinQr(page);
    await expect(page.getByRole('alert')).toContainText('No pudimos leer el ticket');
    await page.getByRole('button', { name: 'Cargarlo a mano' }).click();
    await page.getByRole('button', { name: 'Ver el ticket' }).click();
    await page.getByRole('textbox', { name: 'Consumo', exact: true }).fill('Tacos al pastor');
    await page.getByRole('textbox', { name: 'Precio por unidad', exact: true }).fill('120');
    await page.getByRole('button', { name: 'Cerrar hoja del ticket' }).click();
    await completarDivision(page);
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Compartir la mesa' })).toBeVisible();
    expect((await estadoN179(page)).mesas).toHaveLength(1);
  });

  /**
   * n81 · el 422 `ticket_image_too_small` del dueño (App Backend v2.133.0). El
   * mock no recibe imagen: el seam `too_small` devuelve exactamente ese 422.
   */
  test('n81 · foto demasiado pequeña: el mensaje claro, «Sacar otra foto» y un solo intento', async ({ page }) => {
    await configurarTicketSinQr(page, { ocr: 'too_small' });
    await escanearSinQr(page);
    const alerta = page.getByRole('alert');
    await expect(alerta).toContainText('La foto es demasiado pequeña para leer el ticket.');
    await expect(alerta).toContainText('Toma otra más cerca, con buena luz y sin recortarla.');
    await expect(alerta.getByRole('button', { name: 'Sacar otra foto' })).toBeVisible();
    // No cae en el genérico: el mensaje es el propio, no «No pudimos leer el ticket».
    await expect(page.getByText('No pudimos leer el ticket')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('payme.app.mock.n179.ocr_attempts.v1'))).toBe('1');
  });

  /**
   * n81 · el rechazo ANTES de subir, cableado: el `<input type="file">` recibe
   * una foto de 5 KB y el piso que publica el dueño (mock: `min_image_bytes`
   * 10240) la frena sin llamar al OCR. Mide el cableado de `onChange` →
   * `rechazoLocalDeImagen` → `useOcrRail`, que el unitario no ve.
   */
  test('n81 · una foto de menos del piso publicado se frena antes de subir', async ({ page }) => {
    await configurarTicketSinQr(page);
    await ingresar(page);
    await page.getByRole('button', { name: 'Nueva', exact: true }).click();
    await expect(page).toHaveURL(/#\/scan$/);
    // Testigo de que la capability ya llegó: el `accept` se ensancha a la lista
    // del modo mock (con HEIC) sólo cuando el rail es autoritativo. Antes de eso
    // no hay piso publicado y la foto se subiría, que es lo correcto.
    const input = page.locator('input[type="file"]');
    await expect(input).toHaveAttribute('accept', /image\/heic/);
    await input.setInputFiles({
      name: 'ticket.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(5 * 1024, 1),
    });
    const alerta = page.getByRole('alert');
    await expect(alerta).toContainText('La foto es demasiado pequeña para leer el ticket.');
    expect(await page.evaluate(() => localStorage.getItem('payme.app.mock.n179.ocr_attempts.v1')), 'se llamó al OCR').toBeNull();
  });

  for (const [mode, message] of [
    ['budget_exhausted', 'Se alcanzó el límite mensual de lectura'],
    ['budget_unavailable', 'El servicio de lectura no está disponible'],
  ] as const) {
    test(`${mode} conserva el ticket, ofrece carga manual y no reintenta`, async ({ page }) => {
      await configurarTicketSinQr(page, { ocr: mode });
      await escanearSinQr(page);
      await expect(page.getByRole('alert')).toContainText(message);
      await expect(page.getByRole('button', { name: 'Reintentar' })).toHaveCount(0);
      expect(await page.evaluate(() => localStorage.getItem('payme.app.mock.n179.ocr_attempts.v1'))).toBe('1');

      await page.getByRole('button', { name: 'Cargarlo a mano' }).click();
      await page.getByRole('button', { name: 'Ver el ticket' }).click();
      await page.getByRole('textbox', { name: 'Consumo', exact: true }).fill('Tacos al pastor');
      await page.getByRole('textbox', { name: 'Precio por unidad', exact: true }).fill('120');
      await page.getByRole('button', { name: 'Cerrar hoja del ticket' }).click();
      await completarDivision(page);
      await page.getByRole('button', { name: 'Continuar', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Compartir la mesa' })).toBeVisible();
      const state = await estadoN179(page);
      expect(state.privateRestaurantIds).toHaveLength(1);
      expect(state.mesas).toHaveLength(1);
      expect(state.mesas[0]?.restaurant.id).toBe(state.privateRestaurantIds[0]);
      expect(await page.evaluate(() => localStorage.getItem('payme.app.mock.n179.ocr_attempts.v1'))).toBe('1');
    });
  }
});
