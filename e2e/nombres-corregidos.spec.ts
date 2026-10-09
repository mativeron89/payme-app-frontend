import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';
import { sacarFoto } from './_camara';
import { completarDivision, configurarTicketSinQr } from './fixtures/ticket-sin-qr';

/**
 * AF-NOMBRES-CORREGIDOS · D240 punto 15 (Mati: «También corregir palabras») ·
 * App Backend 2.170.0, `names_v1` de `contract/ocr-merchant-v2.json`.
 *
 * El escaneo negocia `names_version=1`: cada plato llega corregido en `name` y
 * con lo que decía el ticket en `original_name`. La app muestra el corregido;
 * dentro de la edición del plato, y sólo si el original es distinto, ofrece
 * «En el ticket decía «X».» + «Usar ese nombre». El recibo firma el corregido:
 * volver al original con otras letras lo cuenta el dueño como edición, igual
 * que tipear. El front no decide el origen.
 *
 * El mock del dueño no corrige (original = nombre); la diferencia se prueba con
 * el seam `payme.app.mock.ocr.nombres.v1 = corregidos` (originales en
 * mayúsculas, con una letra de menos o sin acento).
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
    (window as unknown as { __nombres: Registro }).__nombres = registro;
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

const registro = (page: Page) => page.evaluate(() => (window as unknown as { __nombres: Registro }).__nombres);

async function escanearYEditar(page: Page, corregidos: boolean): Promise<void> {
  if (corregidos) {
    await page.addInitScript(() => localStorage.setItem('payme.app.mock.ocr.nombres.v1', 'corregidos'));
  }
  await configurarTicketSinQr(page, { ocr: 'no_merchant' });
  await ingresar(page);
  await page.getByRole('button', { name: 'Nueva', exact: true }).click();
  await expect(page).toHaveURL(/:\d+\/scan$/);
  await espiar(page);
  await sacarFoto(page);
  await expect(page.getByRole('radio', { name: /Pagar el total/ })).toBeVisible();
  await page.getByRole('button', { name: /Ver el ticket/ }).click();
  await page.getByRole('dialog', { name: /Ticket ·/ }).getByRole('button', { name: 'Modificar ítems', exact: true }).click();
}

const hoja = (page: Page) => page.getByRole('dialog', { name: /Ticket ·/ });

test('los platos se ven con el nombre corregido; lo que decía el ticket no se ve en la lista', async ({ page }) => {
  await escanearYEditar(page, true);
  await expect(hoja(page).getByText('Agua mineral', { exact: true })).toBeVisible();
  await expect(hoja(page).getByText('Agua minral', { exact: true })).toHaveCount(0);
  await expect(hoja(page).getByText('Tiramisú', { exact: true })).toBeVisible();
  // Sin abrir un plato no hay ningún «En el ticket decía»: sin ruido en la lista.
  await expect(hoja(page).getByText(/En el ticket decía/)).toHaveCount(0);
});

test('🔴 «Usar ese nombre» vuelve a lo que decía el ticket, y el alta lo lleva con el mismo recibo', async ({ page }) => {
  await escanearYEditar(page, true);
  await hoja(page).getByRole('button', { name: 'Modificar Agua mineral' }).click();
  const consumo = hoja(page).getByRole('textbox', { name: 'Consumo', exact: true });
  await expect(consumo).toHaveValue('Agua mineral');
  await expect(hoja(page).getByText('En el ticket decía «Agua minral».', { exact: true })).toBeVisible();
  await hoja(page).getByRole('button', { name: 'Usar ese nombre', exact: true }).click();
  await expect(consumo).toHaveValue('Agua minral');
  // Ya dice lo del ticket: el enlace se va.
  await expect(hoja(page).getByRole('button', { name: 'Usar ese nombre', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Cerrar hoja del ticket' }).click();
  await completarDivision(page);
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Compartir la mesa' })).toBeVisible();

  const { recibos, altas } = await registro(page);
  expect(altas).toHaveLength(1);
  const nombres = (altas[0]!.items as Array<{ name: string }>).map((i) => i.name);
  expect(nombres).toContain('Agua minral');
  // Los demás quedan corregidos: el recibo firma el corregido.
  expect(nombres).toContain('Tiramisú');
  expect(nombres).not.toContain('TIRAMISU');
  expect(altas[0]!.ocr_receipt).toBe(recibos[0]);
  // El original no viaja al alta.
  expect(JSON.stringify(altas[0])).not.toContain('original');
});

test('sólo si el original es distinto: un plato sin corrección no ofrece nada', async ({ page }) => {
  await escanearYEditar(page, true);
  await hoja(page).getByRole('button', { name: 'Modificar Vino tinto (copa)' }).click();
  await expect(hoja(page).getByRole('textbox', { name: 'Consumo', exact: true })).toHaveValue('Vino tinto (copa)');
  await expect(hoja(page).getByText(/En el ticket decía/)).toHaveCount(0);
});

test('editar el nombre sigue como hoy; si queda distinto del ticket, el original sigue a mano', async ({ page }) => {
  await escanearYEditar(page, true);
  await hoja(page).getByRole('button', { name: 'Modificar Tiramisú' }).click();
  const consumo = hoja(page).getByRole('textbox', { name: 'Consumo', exact: true });
  await consumo.fill('Tiramisú de la casa');
  await expect(consumo).toHaveValue('Tiramisú de la casa');
  await expect(hoja(page).getByText('En el ticket decía «TIRAMISU».', { exact: true })).toBeVisible();
  // Tipear exactamente lo del ticket también lo apaga.
  await consumo.fill('TIRAMISU');
  await expect(hoja(page).getByRole('button', { name: 'Usar ese nombre', exact: true })).toHaveCount(0);
});

test('🔴 sin corrección (el mock del dueño: original = nombre), nada cambia', async ({ page }) => {
  await escanearYEditar(page, false);
  await hoja(page).getByRole('button', { name: 'Modificar Agua mineral' }).click();
  await expect(hoja(page).getByRole('textbox', { name: 'Consumo', exact: true })).toHaveValue('Agua mineral');
  await expect(hoja(page).getByText(/En el ticket decía/)).toHaveCount(0);
});
