import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';
import { completarDivision, configurarTicketSinQr } from './fixtures/ticket-sin-qr';
import { sacarFoto } from './_camara';

/**
 * AF-ORIGEN-POR-PLATO · decisión 141, respuesta 2: «App Backend y App Frontend
 * empiezan a marcar el origen de cada plato. No se ve para el usuario.»
 *
 * App Backend 2.145.0 firma un `receipt` en la respuesta del OCR y lo verifica
 * como `ocr_receipt` en `POST /api/mesas`: el servidor decide, plato por plato,
 * qué salió del ticket, qué se editó y qué se cargó a mano.
 *
 * El AF:
 * - guarda el recibo del ÚLTIMO escaneo, sólo en memoria del flujo;
 * - lo manda en el alta aunque la persona haya editado ítems;
 * - no manda nada si la mesa se cargó a mano, ni el recibo de un ticket anterior.
 *
 * Se espía la fachada en la página (`api.scanTicket` y `api.createMesa`) sin
 * cambiar lo que hacen: el mock real lee y crea la mesa. Las rutas del
 * `import()` van en variables, como en los vecinos: son del servidor de Vite.
 */

interface Registro {
  recibos: Array<string | null>;
  altas: Array<Record<string, unknown>>;
}

async function espiar(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const ruta = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ ruta) as {
      api: Record<string, (...a: unknown[]) => Promise<unknown>>;
    };
    const registro: Registro = { recibos: [], altas: [] };
    (window as unknown as { __origen: Registro }).__origen = registro;
    const escanear = api.scanTicket.bind(api);
    api.scanTicket = async (...args: unknown[]) => {
      const leido = await escanear(...args) as { receipt?: string };
      registro.recibos.push(typeof leido.receipt === 'string' ? leido.receipt : null);
      return leido;
    };
    const crear = api.createMesa.bind(api);
    api.createMesa = async (...args: unknown[]) => {
      registro.altas.push(JSON.parse(JSON.stringify(args[0])) as Record<string, unknown>);
      return crear(...args);
    };
  });
}

const registro = (page: Page) => page.evaluate(
  () => (window as unknown as { __origen: Registro }).__origen,
);

async function hastaLaCamara(page: Page): Promise<void> {
  await ingresar(page);
  await page.getByRole('button', { name: 'Nueva', exact: true }).click();
  await expect(page).toHaveURL(/:\d+\/scan$/);
  await espiar(page);
}

async function escanear(page: Page): Promise<void> {
  await sacarFoto(page);
  await expect(page.getByRole('radio', { name: /Pagar el total/ })).toBeVisible();
}

async function abrirLaMesa(page: Page): Promise<void> {
  await completarDivision(page);
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Compartir la mesa' })).toBeVisible();
}

async function cargarAManoTrasFallar(page: Page): Promise<void> {
  await page.evaluate(() => localStorage.setItem('payme.app.mock.n179.ocr.v1', 'budget_exhausted'));
  await sacarFoto(page);
  await expect(page.getByRole('alert')).toContainText('Se alcanzó el límite mensual de lectura');
  await page.getByRole('button', { name: 'Cargarlo a mano' }).click();
  await page.getByRole('button', { name: 'Ver el ticket' }).click();
  await page.getByRole('textbox', { name: 'Consumo', exact: true }).fill('Tacos al pastor');
  await page.getByRole('textbox', { name: 'Precio por unidad', exact: true }).fill('120');
  await page.getByRole('button', { name: 'Cerrar hoja del ticket' }).click();
}

/** El recibo del mock tiene la forma del dueño: `or1.<cuerpo>.<firma>`. */
const FORMA = /^or1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/;

test.describe('AF-ORIGEN-POR-PLATO · el alta lleva el recibo del último escaneo', () => {
  test('🔴 escanear y abrir: el alta lleva `ocr_receipt`, el mismo del escaneo', async ({ page }) => {
    await configurarTicketSinQr(page, { ocr: 'no_merchant' });
    await hastaLaCamara(page);
    await escanear(page);
    await abrirLaMesa(page);

    const { recibos, altas } = await registro(page);
    expect(recibos).toHaveLength(1);
    expect(recibos[0]).toMatch(FORMA);
    expect(altas).toHaveLength(1);
    expect(altas[0]!.ocr_receipt).toBe(recibos[0]);
    // Nunca un origen por plato del cliente: lo decide el servidor.
    expect(Object.keys(altas[0]!)).not.toContain('item_origins');
    expect(JSON.stringify(altas[0]!.items)).not.toContain('origin');
  });

  test('🔴 con un ítem editado, el alta lleva igual el recibo', async ({ page }) => {
    await configurarTicketSinQr(page, { ocr: 'no_merchant' });
    await hastaLaCamara(page);
    await escanear(page);
    await page.getByRole('button', { name: /Ver el ticket/ }).click();
    const hoja = page.getByRole('dialog', { name: /Ticket ·/ });
    await hoja.getByRole('button', { name: 'Modificar ítems', exact: true }).click();
    await hoja.getByRole('button', { name: 'Modificar Tagliatelle Bolognese' }).click();
    await hoja.getByRole('textbox', { name: 'Consumo', exact: true }).fill('Tagliatelle al ragú');
    await page.getByRole('button', { name: 'Cerrar hoja del ticket' }).click();
    await abrirLaMesa(page);

    const { recibos, altas } = await registro(page);
    expect(recibos[0]).toMatch(FORMA);
    expect(altas).toHaveLength(1);
    expect(JSON.stringify(altas[0]!.items)).toContain('Tagliatelle al ragú');
    expect(altas[0]!.ocr_receipt).toBe(recibos[0]);
  });

  test('🔴 un escaneo nuevo reemplaza el recibo: va el del segundo ticket', async ({ page }) => {
    await configurarTicketSinQr(page, { ocr: 'no_merchant' });
    await hastaLaCamara(page);
    await escanear(page);
    await page.getByRole('button', { name: 'Volver', exact: true }).click();
    // D212 · «Volver» deja «Escanea el ticket»; la cámara la abre «Sacar foto».
    await page.getByRole('button', { name: 'Sacar foto', exact: true }).click();
    await escanear(page);
    await abrirLaMesa(page);

    const { recibos, altas } = await registro(page);
    expect(recibos).toHaveLength(2);
    expect(recibos[0]).toMatch(FORMA);
    expect(recibos[1]).toMatch(FORMA);
    expect(recibos[1]).not.toBe(recibos[0]);
    expect(altas[0]!.ocr_receipt).toBe(recibos[1]);
  });

  test('cargado a mano, sin escanear: el alta no lleva `ocr_receipt`', async ({ page }) => {
    await configurarTicketSinQr(page, { ocr: 'budget_exhausted' });
    await hastaLaCamara(page);
    await cargarAManoTrasFallar(page);
    await abrirLaMesa(page);

    const { recibos, altas } = await registro(page);
    expect(recibos).toEqual([]);
    expect(altas).toHaveLength(1);
    expect(Object.keys(altas[0]!)).not.toContain('ocr_receipt');
  });

  test('escanear, volver a la cámara y cargar a mano: no viaja el recibo del ticket anterior', async ({ page }) => {
    await configurarTicketSinQr(page, { ocr: 'no_merchant' });
    await hastaLaCamara(page);
    await escanear(page);
    await page.getByRole('button', { name: 'Volver', exact: true }).click();
    await page.getByRole('button', { name: 'Sacar foto', exact: true }).click();
    await cargarAManoTrasFallar(page);
    await abrirLaMesa(page);

    const { recibos, altas } = await registro(page);
    expect(recibos).toHaveLength(1);
    expect(altas).toHaveLength(1);
    expect(Object.keys(altas[0]!)).not.toContain('ocr_receipt');
  });
});
