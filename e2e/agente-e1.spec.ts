import { expect, test, type Page } from '@playwright/test';
import { ingresar, irEnLaApp } from './_app';

/**
 * D550/D553/D554 · el agente gastronómico, E1, publicado APAGADO (App Backend 2.208.0).
 *
 * El mock por defecto es el dueño de hoy: las dos banderas apagadas. Sin la costura no hay fila «Recomendaciones», ni
 * tarjeta en Inicio, ni calificación, ni presupuesto, y la ubicación no se pide nunca. Con
 * `payme.app.mock.agente.v1 = encendido` (el control positivo) cada pieza aparece con sus condiciones.
 *
 * Los permisos del mock viven en la memoria de la página: se cambia de pantalla sin recargar (`irEnLaApp`).
 */

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/${test.info().project.name}-${nombre}.png`, fullPage: true });
}

async function conCosturas(page: Page, costuras: Readonly<Record<string, string>>): Promise<void> {
  await page.addInitScript((c) => {
    for (const [k, v] of Object.entries(c)) localStorage.setItem(`payme.app.mock.${k}.v1`, v);
  }, costuras);
}

/** Cuenta cada pedido de ubicación de la página (la API real del navegador sigue respondiendo). */
async function contarUbicaciones(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { pedidosDeUbicacion: number };
    w.pedidosDeUbicacion = 0;
    const geo = navigator.geolocation;
    if (!geo) return;
    const original = geo.getCurrentPosition.bind(geo);
    geo.getCurrentPosition = (...a: Parameters<Geolocation['getCurrentPosition']>) => {
      w.pedidosDeUbicacion += 1;
      original(...a);
    };
  });
}
const pedidosDeUbicacion = (page: Page) => page.evaluate(() => (window as unknown as { pedidosDeUbicacion: number }).pedidosDeUbicacion);

const filaRecomendaciones = (page: Page) => page.getByRole('switch', { name: 'Recomendaciones', exact: true });
const tarjeta = (page: Page) => page.getByRole('region', { name: 'Lo de siempre, cerca', exact: true });

async function activarRecomendaciones(page: Page): Promise<void> {
  await irEnLaApp(page, '/mas');
  await expect(filaRecomendaciones(page)).not.toBeChecked();
  await filaRecomendaciones(page).click();
  await expect(filaRecomendaciones(page)).toBeChecked();
}

test.describe('D554 · apagado (hoy)', () => {
  test('🔴 sin las banderas: nada del agente se ve y la ubicación no se pide', async ({ page }) => {
    await contarUbicaciones(page);
    await ingresar(page);
    await expect(tarjeta(page)).toHaveCount(0);
    await irEnLaApp(page, '/mas');
    await expect(page.getByRole('heading', { level: 1, name: 'Configuración' })).toBeVisible();
    await expect(page.getByText('Recomendaciones', { exact: true })).toHaveCount(0);
    await irEnLaApp(page, '/estadisticas');
    await expect(page.getByRole('heading', { name: /registrado$/ })).toBeVisible();
    await expect(page.getByText('Tu presupuesto del mes')).toHaveCount(0);
    await irEnLaApp(page, '/mesa/PA-1099');
    await expect(page.getByRole('heading', { level: 1, name: 'Cierre completado' })).toBeVisible();
    await expect(page.getByText('¿Cómo estuvo?')).toHaveCount(0);
    expect(await pedidosDeUbicacion(page)).toBe(0);
  });

  test('con la función encendida pero sin el permiso, Inicio queda como siempre', async ({ page }) => {
    await conCosturas(page, { agente: 'encendido' });
    await contarUbicaciones(page);
    await ingresar(page);
    await irEnLaApp(page, '/mas');
    await expect(filaRecomendaciones(page)).not.toBeChecked();
    await irEnLaApp(page, '/home');
    await expect(page.getByRole('button', { name: 'Escanear', exact: true })).toBeVisible();
    await expect(tarjeta(page)).toHaveCount(0);
    expect(await pedidosDeUbicacion(page)).toBe(0);
  });
});

test.describe('D554 · encendido en el mock (control positivo)', () => {
  test('🔴 con el permiso: la tarjeta, y la ubicación SÓLO al tocar, sin guardarla', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 19.4326081, longitude: -99.1332081 });
    await conCosturas(page, { agente: 'encendido' });
    await contarUbicaciones(page);
    await ingresar(page);
    await capturar(page, 'agente-00-inicio-sin-permiso');
    await activarRecomendaciones(page);
    await capturar(page, 'agente-01-configuracion-recomendaciones');
    await irEnLaApp(page, '/home');
    await expect(tarjeta(page)).toBeVisible();
    await expect(tarjeta(page)).toContainText('Tacos al pastor · Arrachera');
    await expect(tarjeta(page)).toContainText('Usamos tu ubicación sólo en este momento. No la guardamos.');
    // 🔴 Mostrar la tarjeta no pide la ubicación.
    expect(await pedidosDeUbicacion(page)).toBe(0);
    await capturar(page, 'agente-02-inicio-tarjeta');

    await tarjeta(page).getByRole('button', { name: 'Ver lugares cerca', exact: true }).click();
    await expect(tarjeta(page).getByRole('heading', { level: 3, name: 'Tacos al pastor' })).toBeVisible();
    expect(await pedidosDeUbicacion(page)).toBe(1);
    await expect(tarjeta(page)).toContainText('Taquería La Esquina');
    await expect(tarjeta(page)).toContainText('Mexicana · 250 m');
    await expect(tarjeta(page).getByText('Se pide en PayMe').first()).toBeVisible();
    await expect(tarjeta(page).getByText('Probable').first()).toBeVisible();
    await expect(tarjeta(page).getByRole('img', { name: '4.6 estrellas en PayMe, de 7 personas' })).toBeVisible();
    await expect(tarjeta(page)).toContainText('colaboradores de OpenStreetMap');
    await expect(tarjeta(page).getByRole('listitem')).toHaveCount(5);
    await capturar(page, 'agente-03-inicio-lugares-cerca');

    // O3 del PR #109 · «Buscar de nuevo» repite la búsqueda sin recargar: pide la ubicación otra vez y vuelve la lista.
    await tarjeta(page).getByRole('button', { name: 'Buscar de nuevo', exact: true }).click();
    await expect.poll(() => pedidosDeUbicacion(page)).toBe(2);
    await expect(tarjeta(page).getByRole('heading', { level: 3, name: 'Tacos al pastor' })).toBeVisible();
    await expect(tarjeta(page).getByRole('listitem')).toHaveCount(5);
    await expect(tarjeta(page).getByRole('button', { name: 'Buscar de nuevo', exact: true })).toBeVisible();

    // 🔴 Nada de la ubicación quedó en el dispositivo ni en la pantalla.
    const guardado = await page.evaluate(() => JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage }, url: location.href }));
    expect(guardado).not.toMatch(/19\.43|99\.13/);
    await expect(page.locator('body')).not.toContainText(/19\.43|99\.13/);
  });

  test('sin el permiso del navegador: lo dice, sin lugares', async ({ page, context }) => {
    await context.clearPermissions();
    await conCosturas(page, { agente: 'encendido', consentimientos_otorgados: 'recomendaciones' });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: { getCurrentPosition: (_ok: unknown, err: (e: { code: number }) => void) => err({ code: 1 }) },
      });
    });
    await ingresar(page);
    await tarjeta(page).getByRole('button', { name: 'Ver lugares cerca', exact: true }).click();
    await expect(tarjeta(page)).toContainText('Para ver lugares cerca, permite la ubicación en tu navegador.');
    await expect(tarjeta(page).getByRole('listitem')).toHaveCount(0);
  });

  test('a 3 km cuando no hay nada a 1 km, y el vacío dicho', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 19.43, longitude: -99.13 });
    await conCosturas(page, { agente: 'encendido', consentimientos_otorgados: 'recomendaciones', agente_cerca: 'lejos' });
    await ingresar(page);
    await tarjeta(page).getByRole('button', { name: 'Ver lugares cerca', exact: true }).click();
    await expect(tarjeta(page)).toContainText('No había nada a 1 km: te mostramos hasta 3 km.');
    await expect(tarjeta(page)).toContainText('1.8 km');
  });

  test('O3 del PR #95 · el 429 del límite por cuenta tiene su texto, no el error genérico', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 19.43, longitude: -99.13 });
    await conCosturas(page, { agente: 'encendido', consentimientos_otorgados: 'recomendaciones', agente_cerca: 'demasiadas' });
    await ingresar(page);
    await tarjeta(page).getByRole('button', { name: 'Ver lugares cerca', exact: true }).click();
    await expect(tarjeta(page)).toContainText('Hiciste muchas búsquedas seguidas. Prueba en un rato.');
    await expect(tarjeta(page)).not.toContainText('No pudimos buscar lugares.');
    await expect(tarjeta(page).getByRole('listitem')).toHaveCount(0);
    await expect(tarjeta(page).getByRole('button', { name: 'Ver lugares cerca', exact: true })).toBeEnabled();
    await capturar(page, 'agente-07-inicio-demasiadas-busquedas');
  });

  test('«Es tu hora» en la campana lleva a la tarjeta', async ({ page }) => {
    await conCosturas(page, { agente: 'encendido', consentimientos_otorgados: 'recomendaciones' });
    await ingresar(page);
    await page.getByRole('button', { name: /Avisos|Notificaciones/ }).first().click();
    const aviso = page.getByRole('button', { name: /Es tu hora/ });
    await expect(aviso).toBeVisible();
    await expect(aviso).toContainText('Mira lugares cerca para lo de siempre.');
    await capturar(page, 'agente-04-campana-es-tu-hora');
    await aviso.click();
    await expect(page).toHaveURL(/\/home\/cerca$/);
    await expect(page.getByRole('heading', { level: 2, name: 'Lo de siempre, cerca' })).toBeFocused();
  });

  test('🔴 la calificación con un toque en la mesa cerrada: se guarda con la respuesta y se puede cambiar', async ({ page }) => {
    await conCosturas(page, { agente: 'calificaciones' });
    await ingresar(page);
    await irEnLaApp(page, '/mesa/PA-1099');
    const grupo = page.getByRole('radiogroup', { name: '¿Cómo estuvo?' });
    await expect(grupo).toBeVisible();
    await expect(grupo.getByRole('radio')).toHaveCount(5);
    for (const r of await grupo.getByRole('radio').all()) await expect(r).toHaveAttribute('aria-checked', 'false');
    await capturar(page, 'agente-05-mesa-calificar');
    await grupo.getByRole('radio', { name: '4 estrellas', exact: true }).click();
    await expect(grupo.getByRole('radio', { name: '4 estrellas', exact: true })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText('Gracias. Puedes cambiarla cuando quieras.')).toBeVisible();
    await grupo.getByRole('radio', { name: '2 estrellas', exact: true }).click();
    await expect(grupo.getByRole('radio', { name: '2 estrellas', exact: true })).toHaveAttribute('aria-checked', 'true');
    await expect(grupo.getByRole('radio', { name: '4 estrellas', exact: true })).toHaveAttribute('aria-checked', 'false');
    // Sólo la calificación: con recomendaciones apagada, nada de la tarjeta ni del presupuesto.
    await irEnLaApp(page, '/home');
    await expect(tarjeta(page)).toHaveCount(0);
  });

  test('el presupuesto del mes: lo gastado contra tu promedio, editable y de vuelta al promedio', async ({ page }) => {
    await conCosturas(page, { agente: 'encendido' });
    await ingresar(page);
    await irEnLaApp(page, '/estadisticas');
    const panel = page.getByRole('region', { name: 'Tu presupuesto del mes', exact: true });
    await expect(panel).toBeVisible();
    // Lo del mes es la misma cuenta que la burbuja de arriba («Tu gasto registrado» o «Tu consumo registrado»).
    const gastado = (await page.locator('.est-total').innerText()).trim();
    await expect(panel).toContainText(`Llevas ${gastado} de $4,200`);
    await expect(panel).toContainText('Es tu promedio de los últimos 3 meses.');
    await expect(panel.getByRole('progressbar')).toHaveAttribute('aria-valuenow', /^\d+$/);
    await capturar(page, 'agente-06-estadisticas-presupuesto');
    await panel.getByRole('button', { name: 'Cambiar', exact: true }).click();
    const campo = panel.getByRole('textbox', { name: 'Presupuesto del mes, en pesos' });
    await campo.fill('0.5');
    await panel.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(panel).toContainText('Escribe un monto de $1 en adelante.');
    await campo.fill('3,000');
    await panel.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(panel).toContainText(`Llevas ${gastado} de $3,000`);
    await expect(panel).toContainText('Lo pusiste tú.');
    await panel.getByRole('button', { name: 'Volver a mi promedio', exact: true }).click();
    await expect(panel).toContainText('Es tu promedio de los últimos 3 meses.');
  });
});
