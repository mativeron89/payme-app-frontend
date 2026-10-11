import { expect, test, type Page } from '@playwright/test';
import { ingresar, relojFueraDeLasFechasDeLosViajes } from './_app';

/**
 * 0.241.0 · D278-3 y D282-2 · corregir un ticket ya cargado, a 375, contra el mock con `viaje_version=10`.
 *
 * El caso de la orden: el ticket de Mariscos El Faro (lo pagó Luis; eligieron Luis, Sofía y yo; Diego falta) queda
 * como «NATAMBRE» y cargado por mí, editando el estado del mock dentro de esta prueba (las semillas no se tocan: las usan
 * otras pruebas). El reloj queda fijo en el 13/10, fuera de Cancún (`_app.ts`).
 */
test.use({ viewport: { width: 375, height: 812 }, timezoneId: 'America/Mexico_City' });

const CANCUN = 'd1000000-0000-4000-8000-000000000001';
const MARISCOS = 'd2000000-0000-4000-8000-000000000105';
const ESTADO = 'payme.app.mock.viajes.estado.v1';
const SEAM = 'payme.app.mock.viajes.corregir.v1';

async function ir(page: Page, ruta: string): Promise<void> {
  await page.evaluate((u) => {
    history.pushState(null, '', u);
    dispatchEvent(new PopStateEvent('popstate'));
  }, ruta);
}

async function conViajes(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('payme.app.mock.viajes.v1', 'encendido'));
  await relojFueraDeLasFechasDeLosViajes(page);
  await ingresar(page);
  await ir(page, `/viaje/${CANCUN}`);
  await expect(page.getByRole('heading', { name: 'Cancún 2026', level: 1 })).toBeVisible();
}

/** Mariscos El Faro como «NATAMBRE», cargado por mí, y la pantalla del ticket abierta. */
async function natambre(page: Page): Promise<void> {
  await conViajes(page);
  await page.evaluate(([k, v, t]) => {
    const e = JSON.parse(localStorage.getItem(k)!);
    const viaje = e.viajes.find((x: { id: string }) => x.id === v);
    const tk = viaje.tickets.find((x: { id: string }) => x.id === t);
    tk.lugar = 'NATAMBRE';
    tk.cargado_por = viaje.creado_por;
    localStorage.setItem(k, JSON.stringify(e));
  }, [ESTADO, CANCUN, MARISCOS]);
  await page.reload();
  await abrirTicket(page, MARISCOS, 'NATAMBRE');
}

async function abrirTicket(page: Page, ticketId: string, lugar: string): Promise<void> {
  await ir(page, `/viaje-ticket/${CANCUN}.${ticketId}`);
  await expect(page.getByRole('heading', { name: lugar, level: 1 })).toBeVisible();
}

const corregirTicket = (page: Page) => page.getByRole('button', { name: 'Corregir ticket', exact: true });
const guardar = (page: Page) => page.getByRole('button', { name: 'Guardar', exact: true });
const chips = (page: Page) => page.locator('.vjt-chips--eleccion li');

async function aCorregir(page: Page, titulo = 'Corregir ticket'): Promise<void> {
  await page.getByRole('button', { name: titulo, exact: true }).click();
  await expect(page.getByRole('heading', { name: titulo, level: 1 })).toBeVisible();
}

/** Los renglones de un ticket en el estado del mock, por nombre. */
async function renglonesEnElMock(page: Page, ticketId: string): Promise<string[]> {
  return page.evaluate(([k, v, t]) => {
    const e = JSON.parse(localStorage.getItem(k)!);
    const tk = e.viajes.find((x: { id: string }) => x.id === v).tickets.find((x: { id: string }) => x.id === t);
    return tk.items.map((i: { nombre: string }) => i.nombre);
  }, [ESTADO, CANCUN, ticketId]);
}

test.describe('🔴 D278-3 · quién ve «Corregir»', () => {
  test('quien lo cargó o pagó, sí; quien no, no', async ({ page }) => {
    await conViajes(page);
    // Mariscos y Fonda Doña Mary los cargó y pagó Luis.
    await abrirTicket(page, MARISCOS, 'Mariscos El Faro');
    await expect(page.getByText('Total del ticket $2,200', { exact: true })).toBeVisible();
    await expect(corregirTicket(page)).toHaveCount(0);
    // Bar La Ola lo pagué yo.
    await ir(page, `/viaje-balance/${CANCUN}`);
    await page.locator('.vjb-consumo').filter({ hasText: 'Bar La Ola' }).click();
    await expect(page.getByRole('heading', { name: 'Bar La Ola', level: 1 })).toBeVisible();
    await expect(corregirTicket(page)).toBeVisible();
  });
});

test.describe('🔴 D282-2 · «NATAMBRE» → «Matambre», sin borrar elecciones', () => {
  test('el nombre del lugar se corrige; nadie vuelve a elegir; Balance lo muestra', async ({ page }) => {
    await natambre(page);
    const eligieron = await chips(page).allInnerTexts();
    expect(eligieron).toContain('Diego · falta elegir');
    await corregirTicket(page).scrollIntoViewIfNeeded();
    await aCorregir(page);
    // Sin cambios, «Guardar» espera.
    await expect(guardar(page)).toBeDisabled();
    await page.getByLabel('Nombre del lugar', { exact: true }).fill('Matambre');
    await expect(page.getByText(/volver a elegir/)).toHaveCount(0);
    await guardar(page).click();
    await expect(page.getByText('Corregiste el ticket.', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Matambre', level: 1 })).toBeVisible();
    await expect(chips(page)).toHaveText(eligieron);
    await expect(page.getByText('Total del ticket $2,200', { exact: true })).toBeVisible();

    // Guardar otra vez lo mismo: no hay nada que mandar.
    await aCorregir(page);
    await expect(page.getByLabel('Nombre del lugar', { exact: true })).toHaveValue('Matambre');
    await expect(guardar(page)).toBeDisabled();
    await page.getByRole('button', { name: 'Volver', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Matambre', level: 1 })).toBeVisible();

    await ir(page, `/viaje-balance/${CANCUN}`);
    await expect(page.locator('.vjb-consumo').filter({ hasText: 'Matambre' })).toBeVisible();
    await expect(page.getByText('NATAMBRE')).toHaveCount(0);
  });

  test('«Volver» sale de la corrección sin guardar', async ({ page }) => {
    await natambre(page);
    await aCorregir(page);
    await page.getByLabel('Nombre del lugar', { exact: true }).fill('Otro nombre');
    await page.getByRole('button', { name: 'Volver', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'NATAMBRE', level: 1 })).toBeVisible();
    await aCorregir(page);
    await expect(page.getByLabel('Nombre del lugar', { exact: true })).toHaveValue('NATAMBRE');
  });
});

test.describe('🔴 D278-3 · un precio que sí borra elecciones', () => {
  test('el aviso previo, el total nuevo, y Luis vuelve a «falta elegir»', async ({ page }) => {
    await natambre(page);
    await expect(chips(page).filter({ hasText: 'Luis' })).toHaveText(['Luis']);
    // Antes: el pescado lo eligió Luis entero.
    const pescado = page.locator('.qc-renglon').filter({ hasText: 'Pescado a la talla' });
    await expect(pescado).toContainText('Lo eligió otro');
    await aCorregir(page);
    const precio = page.getByLabel('Precio de Pescado a la talla', { exact: true });
    await expect(precio).toHaveValue('525');
    await precio.fill('495');
    const pie = page.locator('.vj-pie');
    await expect(pie.getByText('Cambiaste el precio de Pescado a la talla: quienes lo eligieron van a tener que volver a elegir.', { exact: true }))
      .toBeVisible();
    await expect(page.getByText('Antes $2,200', { exact: true })).toBeVisible();
    await expect(page.locator('.vjt-totales .vjt-total-monto')).toHaveText('$2,170');
    await expect(guardar(page)).toBeEnabled();
    await guardar(page).click();
    await expect(page.getByText('Corregiste el ticket.', { exact: true })).toBeVisible();
    await expect(chips(page).filter({ hasText: 'Luis' })).toHaveText(['Luis · falta elegir']);
    await expect(chips(page).filter({ hasText: 'Sofía' })).toHaveText(['Sofía']);
    // Después: su elección se borró y el pescado quedó libre, con el precio nuevo.
    await expect(pescado).not.toContainText('Lo eligió otro');
    await expect(pescado.getByRole('button', { name: 'Pescado a la talla', exact: true })).toBeVisible();
    await expect(pescado).toContainText('$495');
    await expect(page.getByText('Total del ticket $2,170', { exact: true })).toBeVisible();
    await ir(page, `/viaje-balance/${CANCUN}`);
    await expect(page.locator('.vjb-consumo').filter({ hasText: 'NATAMBRE' })).toContainText('$2,170');
  });

  test('cambiar una cantidad, agregar y sacar renglones; un doble toque guarda una sola vez', async ({ page }) => {
    await natambre(page);
    await aCorregir(page);
    await page.getByRole('button', { name: 'Sacar Agua mineral', exact: true }).click();
    await page.getByRole('button', { name: 'Uno menos de Margarita', exact: true }).click();
    await page.getByRole('button', { name: 'Agregar renglón', exact: true }).click();
    await page.getByLabel('Nombre del renglón nuevo', { exact: true }).fill('Postre');
    await page.getByLabel('Precio de Postre', { exact: true }).fill('90');
    await expect(page.locator('.vj-pie')).toContainText('Cambiaste 2 renglones que ya se eligieron (Margarita y Agua mineral)');
    await expect(page.locator('.vj-pie')).toContainText('Tú también.');
    await guardar(page).dblclick();
    await expect(page.getByText('Corregiste el ticket.', { exact: true }).first()).toBeVisible();
    const nombres = await renglonesEnElMock(page, MARISCOS);
    expect(nombres.filter((n) => n === 'Postre')).toHaveLength(1);
    expect(nombres).not.toContain('Agua mineral');
    await expect(chips(page).filter({ hasText: 'Sofía' })).toHaveText(['Sofía · falta elegir']);
  });
});

test.describe('🔴 D278-3 · la pantalla a 375', () => {
  test('los botones de cada renglón miden 44 × 44, y un renglón de $1,000,000 entra sin desbordar', async ({ page }) => {
    await natambre(page);
    await aCorregir(page);
    for (const nombre of ['Uno menos de Margarita', 'Uno más de Margarita', 'Sacar Margarita']) {
      const caja = (await page.getByRole('button', { name: nombre, exact: true }).boundingBox())!;
      expect(caja.width, nombre).toBeGreaterThanOrEqual(44);
      expect(caja.height, nombre).toBeGreaterThanOrEqual(44);
    }
    const precio = page.getByLabel('Precio de Ceviche de camarón', { exact: true });
    await precio.fill('1000000');
    const fila = page.locator('.vjr-renglon').filter({ has: precio }).locator('.vjr-fila');
    await expect(fila.locator('.vjr-linea')).toHaveText('$1,000,000');
    const desborde = await fila.evaluate((f) => f.scrollWidth - f.clientWidth);
    expect(desborde).toBeLessThanOrEqual(0);
    const linea = (await fila.locator('.vjr-linea').boundingBox())!;
    const tarjeta = (await page.locator('.vjr-renglon').filter({ has: precio }).boundingBox())!;
    expect(linea.x + linea.width).toBeLessThanOrEqual(tarjeta.x + tarjeta.width + 0.5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
});

test.describe('🔴 D278-3 · un gasto a mano con dos pagadores', () => {
  test('otro monto pide los montos de cada uno; «Partes iguales» los reparte y se guarda', async ({ page }) => {
    await conViajes(page);
    await ir(page, `/viaje-gasto/${CANCUN}`);
    await page.getByLabel('Descripción', { exact: true }).fill('Gasolina');
    await page.getByLabel('Monto', { exact: true }).fill('900');
    await page.getByRole('group', { name: '¿Quién pagó?', exact: true }).getByRole('checkbox', { name: /^Luis Pérez( |$)/ }).click();
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    await expect(page.getByText('Cargaste el gasto.', { exact: true })).toBeVisible();
    await ir(page, `/viaje-balance/${CANCUN}`);
    await page.locator('.vjb-consumo').filter({ hasText: 'Gasolina' }).click();
    await expect(page.getByRole('heading', { name: 'Gasolina', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'Corregir gasto', exact: true }).scrollIntoViewIfNeeded();
    await aCorregir(page, 'Corregir gasto');
    await expect(page.getByLabel('Nombre del lugar', { exact: true })).toHaveCount(0);
    await page.getByLabel('Monto', { exact: true }).fill('950');
    const mio = page.getByLabel('Cuánto pagaste tú', { exact: true });
    const luis = page.getByLabel('Cuánto pagó Luis Pérez', { exact: true });
    await expect(mio).toHaveValue('450');
    await expect(luis).toHaveValue('450');
    await expect(page.getByText('Suman $900 de $950', { exact: true })).toBeVisible();
    await expect(page.locator('.vj-pie').getByText('Los montos tienen que sumar $950. Ahora suman $900.', { exact: true })).toBeVisible();
    await expect(guardar(page)).toBeDisabled();
    await page.getByRole('button', { name: 'Partes iguales', exact: true }).click();
    await expect(mio).toHaveValue('475');
    await expect(luis).toHaveValue('475');
    await expect(guardar(page)).toBeEnabled();
    await guardar(page).click();
    await expect(page.getByText('Corregiste el gasto.', { exact: true })).toBeVisible();
    await expect(page.locator('.vjt-pagadores')).toContainText('$475');
    await expect(page.locator('.vjt-totales .vjt-total-fila').filter({ hasText: 'Total del ticket' })).toContainText('$950');
  });
});

test.describe('🔴 D278-3 · los errores, explicados', () => {
  async function conSeam(page: Page, seam: string): Promise<void> {
    await natambre(page);
    await aCorregir(page);
    await page.getByLabel('Nombre del lugar', { exact: true }).fill('Matambre');
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [SEAM, seam]);
    await guardar(page).click();
  }

  test('404: el ticket ya no está; vuelve al viaje, sin pantalla de error', async ({ page }) => {
    await conSeam(page, 'ya_no_estaba');
    await expect(page.getByText('Este ticket ya no está en el viaje.', { exact: true })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/viaje/${CANCUN}$`));
    await expect(page.getByText('No pudimos cargar')).toHaveCount(0);
  });

  test('409: el viaje se cerró', async ({ page }) => {
    await conSeam(page, 'cerrado');
    await expect(page.getByText('Este viaje ya se cerró.', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Corregir ticket', level: 1 })).toHaveCount(0);
  });

  test('403: ya no puede corregirlo', async ({ page }) => {
    await conSeam(page, 'prohibido');
    await expect(page.getByText('Sólo quien cargó o pagó este ticket puede corregirlo.', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Corregir ticket', level: 1 })).toHaveCount(0);
  });

  test('409: el tope del viaje; se queda corrigiendo', async ({ page }) => {
    await conSeam(page, 'tope_del_viaje');
    await expect(page.getByText('Con este cambio el viaje pasaría su tope de gastos. Revisa los montos.', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Corregir ticket', level: 1 })).toBeVisible();
    await expect(page.getByLabel('Nombre del lugar', { exact: true })).toHaveValue('Matambre');
  });

  test('422: los pagadores no suman el total del dueño', async ({ page }) => {
    await conSeam(page, 'cambio_el_total');
    await expect(page.getByText('El total cambió: escribe cuánto pagó cada uno.', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Corregir ticket', level: 1 })).toBeVisible();
  });
});
