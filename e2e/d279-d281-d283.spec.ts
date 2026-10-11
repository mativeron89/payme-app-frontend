import { expect, test, type Page } from '@playwright/test';
import { ingresar, relojFueraDeLasFechasDeLosViajes } from './_app';

/**
 * 0.240.0 · D279 (cerrar sólo quien creó el viaje y la hora de cierre), D281 (Balance › Consumos por lugar) y D283 (las
 * pestañas del encabezado en negrita), a 375, contra el mock con `viaje_version=8`.
 *
 * El reloj queda fijo en el 13/10 (fuera de Cancún, `_app.ts`) y la hora del navegador en la de México, así las líneas
 * «Cierra solo el …» no dependen de dónde corre la prueba.
 */
test.use({ viewport: { width: 375, height: 812 }, timezoneId: 'America/Mexico_City' });

const CANCUN = 'd1000000-0000-4000-8000-000000000001';
const MAZATLAN = 'd1000000-0000-4000-8000-000000000005';

async function conViajes(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('payme.app.mock.viajes.v1', 'encendido'));
  await relojFueraDeLasFechasDeLosViajes(page);
  await ingresar(page);
}

async function ir(page: Page, ruta: string): Promise<void> {
  await page.evaluate((u) => {
    history.pushState(null, '', u);
    dispatchEvent(new PopStateEvent('popstate'));
  }, ruta);
}

async function aConfiguracion(page: Page, viajeId: string, nombre: string): Promise<void> {
  await ir(page, `/viaje/${viajeId}`);
  await expect(page.getByRole('heading', { name: nombre, level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Configuración', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Configuración', level: 1 })).toBeVisible();
}

async function aceptarMazatlan(page: Page): Promise<void> {
  await ir(page, '/avisos');
  await page.getByRole('button', { name: 'Aceptar', exact: true }).click();
  await expect(page.getByText(/· Aceptaste$/)).toBeVisible();
}

const cerrarViaje = (page: Page) => page.getByRole('button', { name: 'Cerrar viaje', exact: true });
const salirDelViaje = (page: Page) => page.getByRole('button', { name: 'Salir del viaje', exact: true });

test.describe('🔴 D279 · «Cerrar viaje» sólo para quien creó el viaje', () => {
  test('quien lo creó ve «Cerrar viaje»; quien no, sólo «Salir del viaje»', async ({ page }) => {
    await conViajes(page);
    await aConfiguracion(page, CANCUN, 'Cancún 2026');
    await expect(cerrarViaje(page)).toBeVisible();
    await expect(salirDelViaje(page)).toBeVisible();
    await aceptarMazatlan(page);
    await aConfiguracion(page, MAZATLAN, 'Mazatlán diciembre');
    await expect(salirDelViaje(page)).toBeVisible();
    await expect(cerrarViaje(page)).toHaveCount(0);
  });

  test('si igual llega el 403 (la pantalla quedó vieja): el aviso, sin pantalla de error, y el botón se va', async ({ page }) => {
    await conViajes(page);
    await aConfiguracion(page, CANCUN, 'Cancún 2026');
    // Mientras se miraba, el viaje pasó a ser de otro (en el mock): el próximo pedido lo sabe; la pantalla, todavía no.
    await page.evaluate(async (vid) => {
      const seam = await import(/* @vite-ignore */ ['/src/api/mock', 'viajesSeam.ts'].join('/')) as { CLAVE_ESTADO_VIAJES_MOCK: string };
      const mock = await import(/* @vite-ignore */ ['/src/api/mock', 'viajes.ts'].join('/')) as { olvidarViajesMockParaTests: () => void };
      const e = JSON.parse(localStorage.getItem(seam.CLAVE_ESTADO_VIAJES_MOCK)!) as { viajes: Array<{ id: string; creado_por: string; miembros: Array<{ user_id: string }> }> };
      const v = e.viajes.find((x) => x.id === vid)!;
      v.creado_por = v.miembros.find((m) => m.user_id !== v.creado_por)!.user_id;
      localStorage.setItem(seam.CLAVE_ESTADO_VIAJES_MOCK, JSON.stringify(e));
      mock.olvidarViajesMockParaTests();
    }, CANCUN);
    await cerrarViaje(page).click();
    const hoja = page.getByRole('dialog');
    await hoja.getByRole('button', { name: 'Cerrar viaje', exact: true }).click();
    await expect(page.getByText('Sólo quien creó el viaje puede cerrarlo.', { exact: true })).toBeVisible();
    await expect(hoja).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Configuración', level: 1 })).toBeVisible();
    await expect(cerrarViaje(page)).toHaveCount(0);
    await expect(salirDelViaje(page)).toBeVisible();
  });
});

test.describe('🔴 D279 · la hora de cierre y cuándo se cierra solo', () => {
  test('crear: sin «Al» no hay hora; con «Al», 23:59 por defecto, se elige y viaja en el pedido', async ({ page }) => {
    await conViajes(page);
    await page.evaluate(async () => {
      const ruta = ['/src/api', 'index.ts'].join('/');
      const modulo = await import(/* @vite-ignore */ ruta) as { api: { crearViaje: (p: unknown) => Promise<unknown> } };
      const original = modulo.api.crearViaje.bind(modulo.api);
      modulo.api.crearViaje = async (p: unknown) => {
        localStorage.setItem('payme.app.e2e.crear-viaje.v1', JSON.stringify(p));
        return original(p);
      };
    });
    await ir(page, '/viaje-nuevo');
    await page.getByLabel('Nombre del viaje').fill('Puebla 2026');
    await page.getByLabel('Del', { exact: true }).fill('2026-10-20');
    await expect(page.getByLabel('Hora de cierre')).toHaveCount(0);
    await page.getByLabel('Al', { exact: true }).fill('2026-10-23');
    const hora = page.getByLabel('Hora de cierre');
    await expect(hora).toHaveValue('23:59');
    // Debajo de «Al», en su columna.
    const [al, campo] = await Promise.all([page.getByLabel('Al', { exact: true }).boundingBox(), hora.boundingBox()]);
    expect(Math.abs(campo!.x - al!.x)).toBeLessThanOrEqual(1);
    expect(campo!.y).toBeGreaterThan(al!.y + al!.height);
    await hora.fill('18:30');
    await page.getByPlaceholder('Busca en Amigos o escribe @usuario').fill('sof');
    await page.getByRole('button', { name: 'Agregar', exact: true }).first().click();
    await page.getByRole('button', { name: 'Crear viaje', exact: true }).click();
    await expect(page).toHaveURL(/\/viaje\/[0-9a-f-]{36}$/);
    const pedido = await page.evaluate(() => JSON.parse(localStorage.getItem('payme.app.e2e.crear-viaje.v1')!) as Record<string, unknown>);
    expect(pedido).toMatchObject({ fecha_desde: '2026-10-20', fecha_hasta: '2026-10-23', hora_cierre: '18:30' });
    // En Configuración, cuándo se cierra solo, en la hora del teléfono.
    await page.getByRole('button', { name: 'Configuración', exact: true }).click();
    await expect(page.getByText('Cierra solo el 23 oct a las 18:30', { exact: true })).toBeVisible();
  });

  test('configurar: quien lo creó cambia la hora y la línea la sigue; sin fecha hasta, ni hora ni línea', async ({ page }) => {
    await conViajes(page);
    await ir(page, '/viaje-nuevo');
    await page.getByLabel('Nombre del viaje').fill('Puebla 2026');
    await page.getByLabel('Al', { exact: true }).fill('2026-10-23');
    await page.getByPlaceholder('Busca en Amigos o escribe @usuario').fill('sof');
    await page.getByRole('button', { name: 'Agregar', exact: true }).first().click();
    await page.getByRole('button', { name: 'Crear viaje', exact: true }).click();
    await expect(page).toHaveURL(/\/viaje\/[0-9a-f-]{36}$/);
    await page.getByRole('button', { name: 'Configuración', exact: true }).click();
    await expect(page.getByText('Cierra solo el 23 oct a las 23:59', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /Nombre y fechas/ }).click();
    await page.getByLabel('Hora de cierre').fill('20:00');
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page.getByText('Guardamos los cambios.', { exact: true })).toBeVisible();
    await expect(page.getByText('Cierra solo el 23 oct a las 20:00', { exact: true })).toBeVisible();
    // Sin fecha hasta: el viaje no se cierra solo.
    await page.getByRole('button', { name: /Nombre y fechas/ }).click();
    await page.getByLabel('Al', { exact: true }).fill('');
    await expect(page.getByLabel('Hora de cierre')).toHaveCount(0);
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page.getByText('Guardamos los cambios.', { exact: true }).last()).toBeVisible();
    await expect(page.getByText(/^Cierra solo el/)).toHaveCount(0);
  });

  test('quien no lo creó y pone una fecha de fin que lo cerraría ya: el 403 se explica y nada cambia', async ({ page }) => {
    await conViajes(page);
    await aceptarMazatlan(page);
    // Tres días después de la «publicación» del mock (el 13/10): un fin el 14/10 ya venció.
    await page.clock.setFixedTime(new Date('2026-10-16T18:00:00Z'));
    await aConfiguracion(page, MAZATLAN, 'Mazatlán diciembre');
    await page.getByRole('button', { name: /Nombre y fechas/ }).click();
    await page.getByLabel('Del', { exact: true }).fill('');
    await page.getByLabel('Al', { exact: true }).fill('2026-10-14');
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page.getByText('Con esa fecha el viaje se cerraría ahora, y eso sólo lo hace quien lo creó.', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Configuración', level: 1 })).toBeVisible();
    await expect(page.getByText('Cierra solo el 22 dic a las 23:59', { exact: true })).toBeVisible();
  });

  test('quien no lo creó ve cuándo se cierra solo, pero no elige la hora', async ({ page }) => {
    await conViajes(page);
    await aceptarMazatlan(page);
    await aConfiguracion(page, MAZATLAN, 'Mazatlán diciembre');
    await expect(page.getByText('Cierra solo el 22 dic a las 23:59', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: /Nombre y fechas/ }).click();
    await expect(page.getByLabel('Al', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Hora de cierre')).toHaveCount(0);
  });
});

test.describe('🔴 D281 · Balance › Consumos: el mismo lugar en una fila que se abre', () => {
  async function gasto(page: Page, descripcion: string, monto: string): Promise<void> {
    await ir(page, `/viaje-gasto/${CANCUN}`);
    await page.getByLabel('Descripción', { exact: true }).fill(descripcion);
    await page.getByLabel('Monto', { exact: true }).fill(monto);
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/viaje/${CANCUN}$`));
  }

  test('«Bar La Ola» tres veces (el ticket y dos gastos escritos distinto): una fila, se abre y cada visita abre su ticket', async ({ page }) => {
    await conViajes(page);
    await gasto(page, 'bar  la ola ', '150');
    // Un minuto después: el más reciente es el bien escrito, y la fila lleva su nombre (el del más reciente).
    await page.clock.setFixedTime(new Date('2026-10-13T18:01:00Z'));
    await gasto(page, 'Bar La Ola', '300');
    await ir(page, `/viaje-balance/${CANCUN}`);
    const lugar = page.locator('button.vjb-lugar');
    await expect(lugar).toHaveCount(1);
    await expect(lugar).toHaveAttribute('aria-expanded', 'false');
    // El más reciente primero: la fila del bar va arriba, con «3 veces» y $960 + $300 + $150.
    await expect(page.locator('.vjb-consumos > li').first()).toContainText('Bar La Ola');
    await expect(lugar).toContainText('3 veces');
    await expect(lugar.locator('.vjb-consumo-monto')).toHaveText('$1,410');
    // Los demás lugares, una vez cada uno, como siempre.
    await expect(page.locator('.vjb-consumos > li > button.vjb-consumo:not(.vjb-lugar)')).toHaveCount(4);
    await expect(page.locator('.vjb-visitas')).toHaveCount(0);
    await lugar.click();
    await expect(lugar).toHaveAttribute('aria-expanded', 'true');
    const visitas = page.getByRole('list', { name: 'Las veces en Bar La Ola' }).locator('.vjb-visita');
    await expect(visitas).toHaveCount(3);
    // En el orden del dueño, el más reciente primero: los dos gastos (13 oct, uno a las 18:01 y otro a las 18:00) y el ticket
    // del 6 oct.
    await expect(visitas.locator('.vjb-consumo-monto')).toHaveText(['$300', '$150', '$960']);
    await expect(visitas.locator('.vjb-visita-fecha').last()).toHaveText('6 oct');
    // Cada visita es un blanco táctil, sangrada hasta el nombre del lugar.
    const [fila, nombre, visita] = await Promise.all([
      lugar.boundingBox(), lugar.locator('.vjb-consumo-lugar').boundingBox(), visitas.first().boundingBox()]);
    expect(Math.abs(visita!.x - nombre!.x)).toBeLessThanOrEqual(1);
    expect(visita!.height).toBeGreaterThanOrEqual(44);
    expect(visita!.y).toBeGreaterThan(fila!.y + fila!.height - 1);
    await visitas.last().click();
    await expect(page).toHaveURL(new RegExp(`/viaje-ticket/${CANCUN}\\.`));
    await expect(page.getByRole('heading', { name: 'Bar La Ola', level: 1 })).toBeVisible();
  });
});

test.describe('🔴 D283 · las pestañas del encabezado en negrita, en todas las pantallas que las tienen', () => {
  const pesos = (page: Page) => page.locator('header.hdr .btab').evaluateAll((xs) => xs.map((x) => getComputedStyle(x).fontWeight));

  test('Inicio, Amigos y Balance: todas las pestañas en 700, la elegida también', async ({ page }) => {
    await conViajes(page);
    await expect.poll(() => pesos(page)).toEqual(['700', '700', '700']);
    await ir(page, '/amigos');
    await expect(page.getByRole('tab', { name: 'Grupos', exact: true })).toBeVisible();
    await expect.poll(() => pesos(page)).toEqual(['700', '700', '700']);
    await page.getByRole('tab', { name: 'Grupos', exact: true }).click();
    await expect.poll(() => pesos(page)).toEqual(['700', '700', '700']);
    await ir(page, `/viaje-balance/${CANCUN}`);
    await expect(page.getByRole('tab', { name: 'Miembros', exact: true })).toBeVisible();
    await expect.poll(() => pesos(page)).toEqual(['700', '700']);
  });
});

test.describe('🔴 D278-2 · D284 · `viaje_version=9`: el servicio y el IVA aparte, del escaneo al ticket y a Balance', () => {
  test('el total impreso en Ticket nuevo, en el ticket guardado (con «Te toca» y su detalle) y en Balance', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('payme.app.mock.n179.ocr.v1', 'servicio_iva'));
    await conViajes(page);
    await ir(page, `/viaje/${CANCUN}`);
    await page.getByRole('button', { name: 'Escanear ticket para Cancún 2026', exact: true }).click();
    const { sacarFoto } = await import('./_camara');
    await sacarFoto(page);
    await expect(page.getByRole('heading', { name: 'Ticket nuevo', level: 1 })).toBeVisible();
    const filas = page.locator('.vjt-ajustes .vjt-ajuste dt');
    await expect(filas).toHaveText(['Platos', 'IVA', 'Cargo por servicio']);
    const montos = await page.locator('.vjt-ajustes .vjt-ajuste dd').allTextContents();
    const centavos = (s: string) => Math.round(Number(s.replace(/[^0-9.]/g, '')) * 100);
    const total = montos.reduce((s, m) => s + centavos(m), 0);
    const tarjeta = page.locator('.vjt-monto--grande').first();
    expect(centavos(await tarjeta.innerText())).toBe(total);
    await page.getByRole('radio', { name: /En partes iguales/ }).click();
    await page.getByRole('button', { name: 'Compartir con el viaje', exact: true }).click();
    // En partes iguales no hay nada que elegir: vuelve al viaje.
    await expect(page).toHaveURL(new RegExp(`/viaje/${CANCUN}$`));
    // En Balance, la visita con el total impreso.
    await ir(page, `/viaje-balance/${CANCUN}`);
    const fila = page.locator('.vjb-consumo').filter({ hasText: 'Tacos El Güero' });
    expect(centavos(await fila.locator('.vjb-consumo-monto').innerText())).toBe(total);
    // El ticket guardado: las mismas filas, el total impreso y «Te toca» con lo de tus platos y tu parte del resto.
    await fila.click();
    await expect(page).toHaveURL(new RegExp(`/viaje-ticket/${CANCUN}\\.`));
    await expect(page.locator('.vjt-totales .vjt-ajustes .vjt-ajuste dt')).toHaveText(['Platos', 'IVA', 'Cargo por servicio']);
    const totalDelTicket = page.locator('.vjt-totales .vjt-total-fila').filter({ hasText: 'Total del ticket' }).locator('.vjt-total-monto');
    expect(centavos(await totalDelTicket.innerText())).toBe(total);
    await expect(page.locator('.vjt-toca-detalle')).toHaveText(/^Tus platos \$[\d,.]+ · Tu parte del resto \$[\d,.]+$/);
  });
});
