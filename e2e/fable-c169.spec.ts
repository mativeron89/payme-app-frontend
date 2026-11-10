import { expect, test, type Page } from '@playwright/test';
import type { Api } from '../src/api';
import { ingresar } from './_app';
import { sacarFoto } from './_camara';
import { abrirTusConsumos } from './_mesa';
import { completarDivision, configurarTicketSinQr, estadoN179 } from './fixtures/ticket-sin-qr';

const compartir = (page: Page) => page.getByRole('heading', { name: 'Compartir la mesa' });
const continuar = (page: Page) => page.getByRole('button', { name: 'Continuar', exact: true });

async function escanear(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Escanear', exact: true }).click();
  await sacarFoto(page);
  await expect(page.getByRole('radio', { name: /Pagar el total/ })).toBeVisible();
}

async function perderPrimeraAperturaAntesDeEnviar(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const ruta = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ ruta) as { api: Api };
    const original = api.createMesa.bind(api);
    api.createMesa = async () => {
      api.createMesa = original;
      throw new TypeError('Respuesta perdida antes de enviar');
    };
  });
}

test('AF2-P2 · la lectura de la mesa con sesión se puede reintentar', async ({ page }) => {
  await ingresar(page);
  await page.evaluate(async () => {
    const ruta = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ ruta) as { api: Api };
    const original = api.getMesa.bind(api);
    let lecturaDisponible = false;
    document.addEventListener('c169-lectura-disponible', () => { lecturaDisponible = true; }, { once: true });
    api.getMesa = async (...args) => {
      if (args[0] === 'PA-2847' && !lecturaDisponible) throw new TypeError('Lectura de mesa interrumpida');
      return original(...args);
    };
  });

  await page.goto('/#/mesa/PA-2847');
  await expect(page.getByText(/No encontramos esta mesa/)).toBeVisible();
  const captura = process.env.PAYME_E2E_CAPTURAS;
  if (captura) await page.screenshot({ path: `${captura}/AF2-P2.png` });
  await page.evaluate(() => document.dispatchEvent(new Event('c169-lectura-disponible')));
  await page.getByRole('button', { name: 'Reintentar', exact: true }).click({ timeout: 3000 });
  await expect(page.getByRole('heading', { name: 'Tu mesa', exact: true })).toBeVisible();
});

test('AF2-P3 · el comprobante permanece visible al releer la mesa y refleja el total actualizado', async ({ page }) => {
  await ingresar(page);
  await page.goto('/#/mesa/PA-2847');
  await abrirTusConsumos(page);
  await page.getByRole('button', { name: 'Tagliatelle Bolognese' }).click();
  await page.getByRole('button', { name: 'Listo', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pagar mi parte' })).toBeVisible();
  await page.evaluate(async () => {
    const ruta = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ ruta) as { api: Api };
    const getMesa = api.getMesa.bind(api);
    const payMesa = api.payMesa.bind(api);
    let pagoConfirmado = false;
    const lectura = new Promise<void>((resolve) => {
      document.addEventListener('c169-mesa-actualizada', () => resolve(), { once: true });
    });
    api.payMesa = async (...args) => {
      const respuesta = await payMesa(...args);
      pagoConfirmado = true;
      return respuesta;
    };
    api.getMesa = async (...args) => {
      const respuesta = await getMesa(...args);
      if (!pagoConfirmado) return respuesta;
      await lectura;
      return { ...respuesta, mesa: { ...respuesta.mesa, paid_amount_cents: respuesta.mesa.total_cents } };
    };
  });
  await page.getByRole('radio', { name: '0%', exact: true }).click();
  await page.getByRole('button', { name: 'Pagar', exact: true }).click();
  const recibo = page.getByRole('heading', { name: '¡Listo!', exact: true });
  await expect(recibo).toBeVisible();
  await expect(page.getByText('La mesa sigue abierta para los demás.')).toBeVisible();
  await page.evaluate(() => document.dispatchEvent(new Event('c169-mesa-actualizada')));
  await expect(page.getByText('La mesa quedó completa.')).toBeVisible();
  await expect(recibo).toBeVisible();
});

test('AF2-P4 · después de recargar y reconciliar, se reenvía sin pedir tarjeta y se abre una mesa', async ({ page }) => {
  await configurarTicketSinQr(page);
  await ingresar(page);
  await perderPrimeraAperturaAntesDeEnviar(page);
  await escanear(page);
  await completarDivision(page);
  await continuar(page).click();
  await expect(page.getByRole('status')).toContainText('No pudimos confirmar la apertura.');
  expect((await estadoN179(page)).mesas).toHaveLength(0);

  await page.reload();
  await page.getByRole('button', { name: 'Revisar cómo quedó esa apertura' }).click();
  await expect(page.getByRole('status')).toContainText('No encontramos ninguna mesa creada con este intento.');
  await page.getByRole('button', { name: 'Sacar foto', exact: true }).click();
  await sacarFoto(page);
  await completarDivision(page);
  await continuar(page).click();
  await expect(compartir(page)).toBeVisible();
  expect((await estadoN179(page)).mesas).toHaveLength(1);
});

test('AF2-P5 · el precio acepta coma decimal y rechaza tres decimales', async ({ page }) => {
  await configurarTicketSinQr(page, { ocr: 'malformed' });
  await ingresar(page);
  await page.getByRole('button', { name: 'Escanear', exact: true }).click();
  await sacarFoto(page);
  await page.getByRole('button', { name: 'Cargarlo a mano' }).click();
  await completarDivision(page);
  await page.getByRole('button', { name: 'Ver el ticket' }).click();
  await page.getByRole('textbox', { name: 'Consumo', exact: true }).fill('Tacos al pastor');
  const precio = page.getByRole('textbox', { name: 'Precio por unidad', exact: true });
  await precio.pressSequentially('1,250');
  await expect(precio).toHaveValue('1.250');
  await page.getByRole('button', { name: 'Cerrar hoja del ticket' }).click();
  await continuar(page).click();
  await expect(precio).toBeVisible();
  expect((await estadoN179(page)).mesas).toHaveLength(0);

  await precio.fill('');
  await precio.pressSequentially('12,50');
  await expect(precio).toHaveValue('12.50');
  await page.getByRole('button', { name: 'Cerrar hoja del ticket' }).click();
  await expect(page.getByText('$12.50', { exact: true }).first()).toBeVisible();
  await continuar(page).click();
  await expect(compartir(page)).toBeVisible();
});

test('AF2-P6 · cambiar la división de una apertura incierta avisa y conserva el intento', async ({ page }) => {
  await configurarTicketSinQr(page);
  await ingresar(page);
  await perderPrimeraAperturaAntesDeEnviar(page);
  await escanear(page);
  await completarDivision(page);
  await continuar(page).click();
  await expect(page.getByRole('status')).toContainText('No pudimos confirmar la apertura.');

  await page.getByRole('button', { name: 'Un comensal más' }).click();
  await continuar(page).click();
  await expect(page.getByText('Tienes una apertura sin confirmar. Reinténtala tal cual antes de cambiar el ticket.')).toBeVisible();
  expect((await estadoN179(page)).mesas).toHaveLength(0);
  await page.getByRole('button', { name: 'Un comensal menos' }).click();
  await continuar(page).click();
  await expect(compartir(page)).toBeVisible();
  expect((await estadoN179(page)).mesas).toHaveLength(1);
});

test('AF2-P7 · volver y escanear otro ticket descarta el Continuar pendiente', async ({ page }) => {
  await configurarTicketSinQr(page);
  await ingresar(page);
  await page.evaluate(async () => {
    const ruta = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ ruta) as { api: Api };
    const original = api.resolveRestaurant.bind(api);
    api.resolveRestaurant = async (...args) => {
      api.resolveRestaurant = original;
      await new Promise<void>((resolve) => {
        document.addEventListener('c169-resolver-restaurante', () => resolve(), { once: true });
      });
      return original(...args);
    };
  });
  await escanear(page);
  await completarDivision(page);
  await continuar(page).click();
  await expect(page.getByRole('button', { name: 'Continuando…', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Volver', exact: true }).click();
  await page.getByRole('button', { name: 'Sacar foto', exact: true }).click();
  await sacarFoto(page);
  await expect(page.getByRole('radio', { name: /Pagar el total/ })).toBeVisible();

  await page.evaluate(() => document.dispatchEvent(new Event('c169-resolver-restaurante')));
  await expect(continuar(page)).toBeEnabled();
  expect((await estadoN179(page)).mesas).toHaveLength(0);
  await expect(page.getByRole('group', { name: /¿Cuántos pagan\?/ })).toContainText('4');
  await continuar(page).click();
  await expect(compartir(page)).toBeVisible();
  expect((await estadoN179(page)).mesas).toHaveLength(1);
});
