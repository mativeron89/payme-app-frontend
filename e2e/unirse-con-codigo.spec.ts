import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

/**
 * AF-UNIRSE-CODIGO · D219 · D223 · «Unirme con código», del lado de quien pide
 * (turno 2 · 2.1–2.8; turno 1 · 7). Las pruebas de aceptación de Codex
 * (`PRUEBAS_ACEPTACION_UNIRME.md`, 6c64408c…) son la lista: cada caso lleva su
 * id (A01…, P01…). El mock contesta según la costura `payme.app.mock.unirse.v1`
 * (`mockApi.ts`); lo que la app pide se cuenta en la fachada (`api.*`).
 *
 * A 375×667, el iPhone SE.
 */
test.use({ viewport: { width: 375, height: 667 } });

interface Ventana {
  __pedidos: string[];
  __consultas: number;
  __cancelaciones: number;
  __mesas: string[];
}

async function costura(page: Page, valor: Record<string, unknown>): Promise<void> {
  await page.addInitScript((v) => localStorage.setItem('payme.app.mock.unirse.v1', JSON.stringify(v)), valor);
}

/** Cuenta los pedidos, consultas y cancelaciones, y las mesas que se piden. */
async function espiar(page: Page, demoraPedirMs = 0): Promise<void> {
  await page.evaluate(async (demora) => {
    const ruta = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ ruta) as { api: Record<string, (...a: unknown[]) => Promise<unknown>> };
    const w = window as unknown as Ventana;
    w.__pedidos = [];
    w.__consultas = 0;
    w.__cancelaciones = 0;
    w.__mesas = [];
    const pedir = api.requestJoin!.bind(api);
    api.requestJoin = async (...a: unknown[]) => {
      w.__pedidos.push(String(a[0]));
      if (demora) await new Promise((r) => setTimeout(r, demora));
      return pedir(...a);
    };
    const consultar = api.getJoinRequest!.bind(api);
    api.getJoinRequest = (...a: unknown[]) => { w.__consultas += 1; return consultar(...a); };
    const cancelar = api.cancelJoinRequest!.bind(api);
    api.cancelJoinRequest = (...a: unknown[]) => { w.__cancelaciones += 1; return cancelar(...a); };
    const mesa = api.getMesa!.bind(api);
    api.getMesa = (...a: unknown[]) => { w.__mesas.push(String(a[0])); return mesa(...a); };
  }, demoraPedirMs);
}

const contar = (page: Page) => page.evaluate(() => {
  const w = window as unknown as Ventana;
  return { pedidos: w.__pedidos, consultas: w.__consultas, cancelaciones: w.__cancelaciones, mesas: w.__mesas };
});

const fila = (page: Page) => page.getByRole('button', { name: 'Unirme con código', exact: true });
const campo = (page: Page) => page.getByLabel('Escribe el código de la mesa');
const solicitar = (page: Page) => page.getByRole('button', { name: 'Solicitar unirme', exact: true });
const espera = (page: Page) => page.locator('.unirse-espera');

async function enMesas(page: Page, demoraPedirMs = 0): Promise<void> {
  await ingresar(page);
  await page.goto('/mesas');
  await expect(page.getByRole('heading', { name: 'Mesas', exact: true })).toBeVisible();
  await espiar(page, demoraPedirMs);
}

async function abrirYEscribir(page: Page, cifras: string): Promise<void> {
  await fila(page).click();
  await campo(page).fill(cifras);
}

/** «Al volver a la app»: la app consulta la espera. */
async function volverALaApp(page: Page): Promise<void> {
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
}

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (dir) await page.screenshot({ path: `${dir}/${nombre}.png` });
}

test.describe('D219 · D223 · «Unirme con código», quien pide', () => {
  test('🔴 A01 · sólo en Mesas, arriba del historial, sin subtítulo; Inicio no la tiene', async ({ page }) => {
    await ingresar(page);
    await expect(page.getByRole('button', { name: 'Unirme con código' })).toHaveCount(0);
    await page.goto('/mesas');
    await expect(page.getByRole('heading', { name: 'Mesas', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Historial', exact: true })).toHaveCount(0);
    await expect(fila(page)).toBeVisible();
    await expect(fila(page)).toHaveAttribute('aria-expanded', 'false');
    // Arriba del historial: la fila va antes que las mesas cerradas.
    await expect(page.locator('.tus-mesas, .hist-row, .mesa-empty').first()).toBeVisible();
    const orden = await page.evaluate(() => {
      const unirse = document.querySelector('.unirse')!;
      const historial = document.querySelector('.tus-mesas, .hist-row, .mesa-empty')!;
      return unirse.compareDocumentPosition(historial) & Node.DOCUMENT_POSITION_FOLLOWING;
    });
    expect(orden).toBeTruthy();
    await expect(page.locator('.unirse-cabecera')).toHaveText('#Unirme con código');
    await capturar(page, 'unirse-fila-cerrada-375');
  });

  test('🔴 A02 · se abre en el lugar y abrir o cerrar no envía nada', async ({ page }) => {
    await enMesas(page);
    await fila(page).click();
    await expect(fila(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.unirse-flecha')).toHaveClass(/open/);
    await expect(page.getByText('Escribe el código de la mesa')).toBeVisible();
    await expect(page.locator('.unirse-prefijo')).toHaveText('PA-');
    await expect(page.locator('.unirse-celda')).toHaveCount(5);
    await expect(page).toHaveURL(/\/mesas$/);
    await fila(page).click();
    await expect(fila(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(campo(page)).toBeHidden();
    expect((await contar(page)).pedidos).toEqual([]);
    await fila(page).click();
    await capturar(page, 'unirse-desplegable-375');
  });

  test('🔴 A03 · apagado hasta 5 números, teclado numérico, y el cero inicial se conserva', async ({ page }) => {
    await enMesas(page);
    await fila(page).click();
    await expect(campo(page)).toHaveAttribute('inputmode', 'numeric');
    for (const parcial of ['1', '12', '123', '1234']) {
      await campo(page).fill(parcial);
      await expect(solicitar(page)).toBeDisabled();
    }
    await campo(page).fill('');
    await expect(solicitar(page)).toBeDisabled();
    await campo(page).fill('01234');
    await expect(solicitar(page)).toBeEnabled();
    await expect(page.locator('.unirse-celda').first()).toHaveText('0');
    // Escribir el quinto número no envía nada.
    expect((await contar(page)).pedidos).toEqual([]);
    await capturar(page, 'unirse-completo-375');
    await solicitar(page).click();
    await expect(espera(page)).toBeVisible();
    expect((await contar(page)).pedidos).toEqual(['PA-01234']);
  });

  test('pegar el código entero («PA-12345») deja los cinco números', async ({ page }) => {
    await enMesas(page);
    await abrirYEscribir(page, 'PA-12345');
    await expect(page.locator('.unirse-celda')).toHaveText(['1', '2', '3', '4', '5']);
    await expect(solicitar(page)).toBeEnabled();
  });

  test('🔴 A04 · enviando: spinner, el campo fijo y UN solo pedido aunque se toque dos veces', async ({ page }) => {
    await enMesas(page, 600);
    await abrirYEscribir(page, '12345');
    // El botón listo: naranja con texto navy (blanco sobre ese naranja no es AA).
    const colores = await solicitar(page).evaluate((b) => {
      const c = getComputedStyle(b);
      return { fondo: c.backgroundColor, texto: c.color };
    });
    expect(colores).toEqual({ fondo: 'rgb(255, 107, 53)', texto: 'rgb(16, 30, 59)' });
    await solicitar(page).evaluate((b: HTMLButtonElement) => { b.click(); b.click(); });
    await expect(page.getByRole('button', { name: 'Enviando…' })).toBeVisible();
    await expect(campo(page)).toBeDisabled();
    await capturar(page, 'unirse-enviando-375');
    await expect(espera(page)).toBeVisible();
    expect((await contar(page)).pedidos).toEqual(['PA-12345']);
  });

  test('🔴 A05 · la espera: el código escrito, «Esperando respuesta», el vencimiento y Cancelar; nada de la mesa', async ({ page }) => {
    await costura(page, { vence_en_s: 600 });
    await enMesas(page);
    await abrirYEscribir(page, '12345');
    await solicitar(page).click();
    await expect(espera(page)).toBeVisible();
    await expect(espera(page)).toContainText('CódigoPA-12345');
    await expect(espera(page).getByText('Esperando respuesta')).toBeVisible();
    // Desde expires_at (10 minutos), no 15:00 fijo.
    await expect(espera(page).locator('.unirse-vence')).toHaveText(/^Vence en (10:00|09:5\d)$/);
    await expect(espera(page)).toContainText('Listo, le avisamos a quien abrió la mesa. Cuando te acepte, entras directo.');
    await expect(espera(page).getByRole('button', { name: 'Cancelar', exact: true })).toBeVisible();
    // Ningún dato de la mesa: ni importe, ni platos, ni personas en la tarjeta.
    await expect(espera(page)).not.toContainText('$');
    await capturar(page, 'unirse-esperando-375');
    expect((await contar(page)).mesas).toEqual([]);
  });

  test('🔴 A07 · A09 · código equivocado: al instante, celdas en rojo, y se borra al editar', async ({ page }) => {
    await costura(page, { pedir: 'not_found' });
    await enMesas(page);
    await abrirYEscribir(page, '99999');
    await solicitar(page).click();
    const error = page.getByRole('alert').filter({ hasText: 'No encontramos una mesa abierta con ese código. Revísalo.' });
    await expect(error).toBeVisible();
    await expect(page.locator('.unirse-campo')).toHaveClass(/unirse-campo--error/);
    await expect(solicitar(page)).toBeDisabled();
    await expect(campo(page)).toHaveAttribute('aria-invalid', 'true');
    await capturar(page, 'unirse-codigo-equivocado-375');
    // Editar borra el error; el botón vuelve recién con los cinco.
    await campo(page).fill('9999');
    await expect(error).toHaveCount(0);
    await expect(solicitar(page)).toBeDisabled();
    await campo(page).fill('99998');
    await expect(solicitar(page)).toBeEnabled();
    expect((await contar(page)).pedidos).toEqual(['PA-99999']);
  });

  test('A10 · 400 join_code_invalid: el mismo aviso que el código equivocado, sin espera', async ({ page }) => {
    await costura(page, { pedir: 'invalid' });
    await enMesas(page);
    await abrirYEscribir(page, '12345');
    await solicitar(page).click();
    await expect(page.getByText('No encontramos una mesa abierta con ese código. Revísalo.')).toBeVisible();
    await expect(espera(page)).toHaveCount(0);
  });

  test('🔴 A11 · demasiados intentos: el aviso sin hora, y campo y botón bloqueados', async ({ page }) => {
    await costura(page, { pedir: 'rate_limited' });
    await enMesas(page);
    await abrirYEscribir(page, '12345');
    await solicitar(page).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Hiciste muchos intentos. Prueba de nuevo en un rato.' })).toBeVisible();
    await expect(campo(page)).toBeDisabled();
    await expect(solicitar(page)).toBeDisabled();
    await capturar(page, 'unirse-limite-375');
    await page.waitForTimeout(400);
    expect((await contar(page)).pedidos).toHaveLength(1);
  });

  test('🔴 A12 · ya estaba en la mesa: entra directo, sin espera ni aviso de aceptación', async ({ page }) => {
    await costura(page, { pedir: 'already', mesa: 'PA-2847' });
    await enMesas(page);
    await abrirYEscribir(page, '12345');
    await solicitar(page).click();
    await expect(page).toHaveURL(/\/mesa\/PA-2847$/);
    await expect(page.locator('.toast:not(.toast-hidden)')).toHaveCount(0);
  });

  test('🔴 A13 · se recarga la app con la espera: la retoma con el mismo código, sin pedir otra', async ({ page }) => {
    await enMesas(page);
    await abrirYEscribir(page, '12345');
    await solicitar(page).click();
    await expect(espera(page)).toBeVisible();
    await page.reload();
    await espiar(page);
    await expect(fila(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(espera(page)).toContainText('PA-12345');
    await expect(espera(page).locator('.unirse-vence')).toBeVisible();
    expect((await contar(page)).pedidos).toEqual([]);
  });

  test('🔴 A14 · Cancelar: después del 200, el campo vacío', async ({ page }) => {
    await enMesas(page);
    await abrirYEscribir(page, '12345');
    await solicitar(page).click();
    await espera(page).getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(campo(page)).toBeVisible();
    await expect(campo(page)).toHaveValue('');
    expect((await contar(page)).cancelaciones).toBe(1);
    // Ya no se retoma al recargar.
    await page.reload();
    await expect(fila(page)).toHaveAttribute('aria-expanded', 'false');
  });

  test('🔴 A16 · rechazada: «no se pudo», sin motivo; «Escribir otro código» vuelve al campo vacío', async ({ page }) => {
    await costura(page, { estado: 'rejected', tras: 1 });
    await enMesas(page);
    await abrirYEscribir(page, '12345');
    await solicitar(page).click();
    await expect(espera(page)).toBeVisible();
    await volverALaApp(page);
    const noSePudo = page.locator('.unirse-no-se-pudo');
    await expect(noSePudo).toHaveText(/No pudimos unirte a esa mesa\. Pídele a quien la abrió que te comparta el link\./);
    await capturar(page, 'unirse-no-se-pudo-375');
    await noSePudo.getByRole('button', { name: 'Escribir otro código', exact: true }).click();
    await expect(campo(page)).toHaveValue('');
    await expect(solicitar(page)).toBeDisabled();
  });

  test('A17 · vencida: el mismo «no se pudo»', async ({ page }) => {
    await costura(page, { estado: 'expired', tras: 1 });
    await enMesas(page);
    await abrirYEscribir(page, '12345');
    await solicitar(page).click();
    await expect(espera(page)).toBeVisible();
    await volverALaApp(page);
    await expect(page.getByText('No pudimos unirte a esa mesa. Pídele a quien la abrió que te comparta el link.')).toBeVisible();
  });

  test('🔴 A18 · aceptada: entra directo a la mesa, con «Te aceptaron» arriba de la barra', async ({ page }) => {
    await costura(page, { estado: 'accepted', tras: 1, mesa: 'PA-4520' });
    await enMesas(page);
    await abrirYEscribir(page, '12345');
    await solicitar(page).click();
    await expect(espera(page)).toBeVisible();
    // Antes de aceptar no se pidió nada de la mesa.
    expect((await contar(page)).mesas).toEqual([]);
    await volverALaApp(page);
    await expect(page).toHaveURL(/\/mesa\/PA-4520$/);
    const aviso = page.locator('.toast.toast--sobre-barra:not(.toast-hidden)');
    await expect(aviso).toHaveText('Te aceptaron. Ya estás en la mesa.');
    const alto = await aviso.evaluate((el) => window.innerHeight - el.getBoundingClientRect().bottom);
    expect(alto).toBeGreaterThanOrEqual(103);
    expect(alto).toBeLessThanOrEqual(105);
    // Quien entra es participante: la pantalla de siempre.
    await expect(page.getByRole('heading', { name: '¿Qué consumiste?', exact: true })).toBeVisible();
    await capturar(page, 'unirse-aceptado-375');
  });

  test('🔴 A19 · Cancelar pierde contra la aceptación (409): manda el estado, y entra', async ({ page }) => {
    await costura(page, { cancelar: 'not_pending', mesa: 'PA-4520' });
    await enMesas(page);
    await abrirYEscribir(page, '12345');
    await solicitar(page).click();
    await espera(page).getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(page).toHaveURL(/\/mesa\/PA-4520$/);
    await expect(campo(page)).toHaveCount(0);
  });

  test('A17 · Cancelar con 410: «no se pudo»', async ({ page }) => {
    await costura(page, { cancelar: 'expired' });
    await enMesas(page);
    await abrirYEscribir(page, '12345');
    await solicitar(page).click();
    await espera(page).getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(page.locator('.unirse-no-se-pudo')).toBeVisible();
  });

  for (const [id, pedir] of [['A21', 'not_allowed'], ['A22', 'full']] as const) {
    test(`🔴 ${id} · 409 ${pedir}: «no se pudo», sin motivo ni detalle de la mesa`, async ({ page }) => {
      await costura(page, { pedir });
      await enMesas(page);
      await abrirYEscribir(page, '12345');
      await solicitar(page).click();
      await expect(page.locator('.unirse-no-se-pudo')).toHaveText(/No pudimos unirte a esa mesa/);
      await expect(page.getByText('Hiciste muchos intentos')).toHaveCount(0);
      await expect(espera(page)).toHaveCount(0);
    });
  }

  for (const [id, pedir] of [['A23', 'suspended'], ['A24', 'error'], ['P08', 'malformed']] as const) {
    test(`🔴 ${id} · ${pedir}: «No pudimos confirmar el resultado», sin espera ni éxito inventados`, async ({ page }) => {
      await costura(page, { pedir });
      await enMesas(page);
      await abrirYEscribir(page, '12345');
      await solicitar(page).click();
      await expect(page.getByRole('alert').filter({ hasText: 'No pudimos confirmar el resultado. Intenta de nuevo.' })).toBeVisible();
      await expect(espera(page)).toHaveCount(0);
      await expect(solicitar(page)).toBeEnabled();
    });
  }

  test('🔴 P01 · un pendiente con datos de la mesa (señuelos) se rechaza: no aparecen ni se espera', async ({ page }) => {
    await costura(page, { pedir: 'decoy' });
    await enMesas(page);
    await abrirYEscribir(page, '12345');
    await solicitar(page).click();
    await expect(page.getByText('No pudimos confirmar el resultado. Intenta de nuevo.')).toBeVisible();
    await expect(page.getByText('Señuelo del Mock')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('4,242.42');
    await expect(espera(page)).toHaveCount(0);
  });

  test('🔴 P08 · una consulta con una clave de más no aplica nada: la espera sigue y lo dice', async ({ page }) => {
    await costura(page, { estado: 'decoy' });
    await enMesas(page);
    await abrirYEscribir(page, '12345');
    await solicitar(page).click();
    await expect(espera(page)).toBeVisible();
    await volverALaApp(page);
    await expect(espera(page).getByText('No pudimos confirmar el resultado. Intenta de nuevo.')).toBeVisible();
    await expect(espera(page)).toContainText('Esperando respuesta');
    await expect(page.getByText('Señuelo del Mock')).toHaveCount(0);
  });

  test('🔴 P08 · la respuesta de otro pedido (otro id) no entra a ninguna mesa', async ({ page }) => {
    await costura(page, { estado: 'otro_id' });
    await enMesas(page);
    await abrirYEscribir(page, '12345');
    await solicitar(page).click();
    await expect(espera(page)).toBeVisible();
    await volverALaApp(page);
    await expect(espera(page).getByText('No pudimos confirmar el resultado. Intenta de nuevo.')).toBeVisible();
    await expect(page).toHaveURL(/\/mesas$/);
  });
});

test.describe('C · la espera se consulta cada 10 s a la vista, y nunca en segundo plano', () => {
  test('🔴 a la vista: ninguna consulta antes de 10 s, una a los 10 s', async ({ page }) => {
    await page.clock.install();
    await enMesas(page);
    await abrirYEscribir(page, '12345');
    await solicitar(page).click();
    await expect(espera(page)).toBeVisible();
    await page.clock.runFor(9_000);
    expect((await contar(page)).consultas).toBe(0);
    await page.clock.runFor(1_100);
    await expect.poll(async () => (await contar(page)).consultas).toBe(1);
    // El contador baja con el reloj.
    await expect(espera(page).locator('.unirse-vence')).toHaveText(/^Vence en 14:(4\d|5\d)$/);
  });

  test('🔴 en segundo plano no consulta', async ({ page }) => {
    await page.clock.install();
    await enMesas(page);
    await abrirYEscribir(page, '12345');
    await solicitar(page).click();
    await expect(espera(page)).toBeVisible();
    await page.evaluate(() => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }));
    await page.clock.runFor(31_000);
    expect((await contar(page)).consultas).toBe(0);
  });

  test('🔴 en cero, una consulta (el contador no decide nada)', async ({ page }) => {
    await page.clock.install();
    await costura(page, { vence_en_s: 3 });
    await enMesas(page);
    await abrirYEscribir(page, '12345');
    await solicitar(page).click();
    await expect(espera(page)).toBeVisible();
    await page.clock.runFor(4_000);
    await expect.poll(async () => (await contar(page)).consultas).toBeGreaterThanOrEqual(1);
    // Vencida en el mock: «no se pudo».
    await expect(page.locator('.unirse-no-se-pudo')).toBeVisible();
    await expect(espera(page)).toHaveCount(0);
  });
});
