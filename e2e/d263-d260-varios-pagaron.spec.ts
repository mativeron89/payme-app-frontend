import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';
import { sacarFoto } from './_camara';

/**
 * AF-VIAJES-VARIOS-PAGARON-Y-ESTADISTICAS-20261010, a 375, con el mock de App
 * Backend 2.177.0 (incluye 2.176.0):
 * - D263 · «¿Quién pagó?» con varios, en la carga manual y en el ticket escaneado, y el ticket que pagaron varios;
 * - D260 · «Ver ticket completo» de una visita de viaje en «Tus restaurantes» abre el ticket del viaje;
 * - D264 · Crear viaje, sin «Les llega una invitación…».
 */
const CANCUN = 'd1000000-0000-4000-8000-000000000001';
const MARISCOS = 'd2000000-0000-4000-8000-000000000105';

async function conViajes(page: Page): Promise<void> {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.addInitScript(() => localStorage.setItem('payme.app.mock.viajes.v1', 'encendido'));
  await ingresar(page);
}

async function ir(page: Page, ruta: string): Promise<void> {
  await page.evaluate((u) => {
    history.pushState(null, '', u);
    dispatchEvent(new PopStateEvent('popstate'));
  }, ruta);
}

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/${test.info().project.name}-${nombre}.png`, fullPage: true });
}

const quienPago = (page: Page) => page.getByRole('group', { name: '¿Quién pagó?', exact: true });
/** Con varios, el nombre accesible de cada casilla suma su parte («Tú $300.01»): se busca por el comienzo. */
const casilla = (page: Page, nombre: string) => quienPago(page).getByRole('checkbox', { name: new RegExp(`^${nombre}( |$)`) });
const centavos = (s: string) => Math.round(Number(s.replace(/[$,]/g, '')) * 100);

async function pagadoEnBalance(page: Page): Promise<Record<string, number>> {
  await ir(page, `/viaje-balance/${CANCUN}`);
  await page.locator('header.hdr').getByRole('tab', { name: 'Miembros', exact: true }).click();
  const fila = (quien: string) => page.locator('.vjb-fila').filter({ hasText: quien }).locator('.vjb-cifra');
  await expect(fila('Tú')).toBeVisible();
  const r: Record<string, number> = {};
  for (const quien of ['Tú', 'Luis Pérez', 'Sofía Ramírez', 'Diego Torres']) r[quien] = centavos(await fila(quien).innerText());
  return r;
}

test.describe('D263 · «¿Quién pagó?» con varios', () => {
  test('🔴 carga manual: tres pagaron, partes iguales con el centavo de más, montos ajustados que no suman y que suman', async ({ page }) => {
    await conViajes(page);
    const antes = await pagadoEnBalance(page);
    await ir(page, `/viaje-gasto/${CANCUN}`);
    await page.getByLabel('Descripción', { exact: true }).fill('Hotel');
    await page.getByLabel('Monto', { exact: true }).fill('900.01');
    // Por defecto, «Tú» y nada más: sin partes ni «Ajustar montos».
    await expect(casilla(page, 'Tú')).toHaveAttribute('aria-checked', 'true');
    await expect(quienPago(page).getByRole('button', { name: 'Ajustar montos' })).toHaveCount(0);
    await casilla(page, 'Sofía Ramírez').click();
    await casilla(page, 'Luis Pérez').click();
    // En el orden de la lista, con el centavo de más al primero.
    await expect(quienPago(page).locator('.vjq-parte')).toHaveText(['$300.01', '$300', '$300']);
    await expect(quienPago(page).getByText('En partes iguales', { exact: true })).toBeVisible();
    await capturar(page, 'd263-01-carga-manual-tres-iguales');

    await quienPago(page).getByRole('button', { name: 'Ajustar montos', exact: true }).click();
    const mio = page.getByLabel('Cuánto pagaste tú', { exact: true });
    const luis = page.getByLabel('Cuánto pagó Luis Pérez', { exact: true });
    const sofia = page.getByLabel('Cuánto pagó Sofía Ramírez', { exact: true });
    await expect(mio).toHaveValue('300.01');
    await expect(luis).toHaveValue('300');
    await expect(sofia).toHaveValue('300');
    const listo = page.getByRole('button', { name: 'Listo', exact: true });
    await expect(listo).toBeEnabled();
    await mio.fill('500');
    // El aviso, junto al botón apagado; arriba, lo que suman.
    await expect(page.locator('.vj-pie').getByText('Los montos tienen que sumar $900.01. Ahora suman $1,100.', { exact: true })).toBeVisible();
    await expect(listo).toBeDisabled();
    await quienPago(page).getByText('Suman $1,100 de $900.01', { exact: true }).scrollIntoViewIfNeeded();
    await capturar(page, 'd263-02-carga-manual-no-suman');
    await luis.fill('100.01');
    await expect(listo).toBeEnabled();
    await expect(page.getByText(/Los montos tienen que sumar/)).toHaveCount(0);
    await expect(quienPago(page).getByText('Suman $900.01 de $900.01', { exact: true })).toBeVisible();
    await capturar(page, 'd263-03-carga-manual-suman');
    await listo.click();
    await expect(page.getByText('Cargaste el gasto.', { exact: true })).toBeVisible();

    // «Lo que pagó» de cada uno sube en lo suyo; Diego, igual.
    const despues = await pagadoEnBalance(page);
    expect(despues).toEqual({
      'Tú': antes['Tú']! + 50000, 'Luis Pérez': antes['Luis Pérez']! + 10001,
      'Sofía Ramírez': antes['Sofía Ramírez']! + 30000, 'Diego Torres': antes['Diego Torres']!,
    });

    // Al entrar al gasto: cuántos pagaron y cuánto cada uno.
    await page.locator('header.hdr').getByRole('tab', { name: 'Consumos', exact: true }).click();
    await page.locator('.vjb-consumo').filter({ hasText: 'Hotel' }).click();
    await expect(page).toHaveURL(new RegExp(`/viaje-ticket/${CANCUN}\\.`));
    await expect(page.locator('.title-card-sub')).toContainText('Pagaron 3 personas');
    const tarjeta = page.getByRole('region', { name: 'Quiénes pagaron', exact: true });
    await expect(tarjeta.locator('li')).toHaveText(['Tú$500', 'Luis Pérez$100.01', 'Sofía Ramírez$300']);
    await capturar(page, 'd263-04-ticket-quienes-pagaron');
  });

  test('🔴 el ticket escaneado: dos pagaron en partes iguales; el último marcado no se desmarca', async ({ page }) => {
    await conViajes(page);
    await ir(page, `/viaje/${CANCUN}`);
    await page.getByRole('button', { name: 'Escanear ticket para Cancún 2026', exact: true }).click();
    await sacarFoto(page);
    await expect(page.getByRole('heading', { name: 'Ticket nuevo' })).toBeVisible();
    const total = centavos((await page.locator('.vjt-cabeza .vjt-monto').innerText()).trim());
    // «Tú» solo no se desmarca.
    await expect(casilla(page, 'Tú')).toHaveAttribute('aria-disabled', 'true');
    // Playwright no toca lo que está `aria-disabled`: el toque se fuerza, y no cambia nada.
    await casilla(page, 'Tú').click({ force: true });
    await expect(casilla(page, 'Tú')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText('El pago completo queda a nombre de quien pagó.', { exact: true })).toBeVisible();
    await casilla(page, 'Diego Torres').click();
    const partes = [Math.ceil(total / 2), Math.floor(total / 2)];
    const pesos = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0 })}`;
    await expect(quienPago(page).locator('.vjq-parte')).toHaveText(partes.map(pesos));
    await expect(page.getByText('El pago completo queda a nombre de quien pagó.', { exact: true })).toHaveCount(0);
    await capturar(page, 'd263-05-ticket-nuevo-dos');
    await page.getByRole('button', { name: 'Compartir con el viaje', exact: true }).click();
    // «Por lo que pidió cada uno»: al ticket, a elegir.
    await expect(page).toHaveURL(new RegExp(`/viaje-ticket/${CANCUN}\\.`));
    await expect(page.locator('.title-card-sub')).toContainText('Pagaron 2 personas');
    await expect(page.getByRole('region', { name: 'Quiénes pagaron', exact: true }).locator('li'))
      .toHaveText([`Tú${pesos(partes[0]!)}`, `Diego Torres${pesos(partes[1]!)}`]);
  });

  test('control · con uno solo, como hoy: la línea «Pagó …» y sin «Quiénes pagaron»', async ({ page }) => {
    await conViajes(page);
    await ir(page, `/viaje-ticket/${CANCUN}.${MARISCOS}`);
    await expect(page.locator('.title-card-sub')).toContainText('Pagó Luis Pérez');
    await expect(page.getByText('Quiénes pagaron', { exact: true })).toHaveCount(0);
  });
});

test('🔴 D260 · «Tus restaurantes»: la visita de un viaje abre su ticket, y Atrás vuelve', async ({ page }) => {
  await conViajes(page);
  await page.goto('/#/estadisticas');
  await page.getByRole('button', { name: /^Tus restaurantes/ }).click();
  await expect(page).toHaveURL(/:\d+\/restaurantes$/);
  const mariscos = page.getByRole('region', { name: 'Mariscos El Faro', exact: true });
  await mariscos.getByRole('button', { name: /^Mariscos El Faro/ }).click();
  await mariscos.locator('.rest-visita-fila').click();
  await expect(mariscos.getByText('Aguachile', { exact: true })).toBeVisible();
  await capturar(page, 'd260-01-visita-de-viaje');
  await mariscos.getByRole('button', { name: 'Ver ticket completo', exact: true }).click();
  // El ticket del viaje, no el recibo de una mesa.
  await expect(page).toHaveURL(new RegExp(`/viaje-ticket/${CANCUN}\\.${MARISCOS}$`));
  await expect(page.getByRole('heading', { name: 'Mariscos El Faro', level: 1 })).toBeVisible();
  await expect(page.getByText('Este detalle ya no está disponible.', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await capturar(page, 'd260-02-ticket-del-viaje');
  await page.getByRole('button', { name: 'Volver', exact: true }).click();
  await expect(page).toHaveURL(/:\d+\/restaurantes$/);
});

test('🔴 D264 · Crear viaje, sin «Les llega una invitación…»', async ({ page }) => {
  await conViajes(page);
  await ir(page, '/viaje-nuevo');
  await expect(page.getByRole('heading', { name: 'Crear viaje', level: 1 })).toBeVisible();
  await expect(page.getByPlaceholder('Busca en Amigos o escribe @usuario')).toBeVisible();
  await expect(page.getByText('Les llega una invitación', { exact: false })).toHaveCount(0);
  await capturar(page, 'd264-01-crear-viaje');
});
