import { expect, test, type Page } from '@playwright/test';
import { abrirMesaConLink, ingresar } from './_app';

/**
 * AF-UNIRSE-CODIGO · D223 · «Tu mesa», la mesa del titular reorganizada
 * («Todo junto, como el diseño», turno 2 · 2.9–2.11): quiénes están,
 * solicitudes para unirse (sólo si hay), compartir, tus consumos (cerrado por
 * defecto) y cerrar mesa. Los casos T01–T19 y los negativos de privacidad de
 * las pruebas de aceptación de Codex (`PRUEBAS_ACEPTACION_UNIRME.md`).
 *
 * PA-2847 es del titular en el mock (La Parolaccia, cada uno lo suyo) y ya
 * tiene dos personas sumadas; PA-4520 es de otro organizador. Las solicitudes
 * las siembra la costura `payme.app.mock.unirse.v1` (`solicitudes`).
 */
test.use({ viewport: { width: 375, height: 667 } });

async function costura(page: Page, valor: Record<string, unknown>): Promise<void> {
  await page.addInitScript((v) => localStorage.setItem('payme.app.mock.unirse.v1', JSON.stringify(v)), valor);
}

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (dir) await page.screenshot({ path: `${dir}/${nombre}.png` });
}

async function tuMesa(page: Page, code = 'PA-2847'): Promise<void> {
  await ingresar(page);
  await page.goto(`/mesa/${code}`);
  await expect(page.getByRole('heading', { name: 'Tu mesa', exact: true })).toBeVisible();
}

const quienes = (page: Page) => page.getByRole('region', { name: 'Quiénes están en la mesa' });
const solicitudes = (page: Page) => page.getByRole('region', { name: 'Solicitudes para unirse' });
const consumos = (page: Page) => page.getByRole('region', { name: 'Tus consumos' });
const cabecera = (region: ReturnType<typeof quienes>) => region.locator('.desplegable-cabecera');

test.describe('D223 · «Tu mesa» del titular', () => {
  test('🔴 T01 · el título y el orden: quiénes → solicitudes → compartir → tus consumos → cerrar mesa', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled'));
    await costura(page, { solicitudes: 1 });
    await ingresar(page);
    const mesa = await abrirMesaConLink(page, { sinGarantia: true, modo: 'consumo' });
    await page.goto(`/mesa/${mesa.code}`);
    await expect(page.getByRole('heading', { name: 'Tu mesa', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '¿Qué consumiste?', exact: true })).toHaveCount(0);
    await expect(solicitudes(page)).toBeVisible();
    // La burbuja conserva restaurante · modo, la barra y el tiempo.
    await expect(page.locator('.mesa-selection-context')).toContainText('cada uno lo suyo');
    await expect(page.locator('.mi-progress')).toBeVisible();
    await expect(page.locator('.mi-count')).toBeVisible();
    const orden = await page.evaluate(() => {
      const selectores = ['.desplegable.quienes', '.desplegable.solicitudes', '.mesa-secondary-actions', '.desplegable.tus-consumos', '.mesa-cerrar'];
      const els = selectores.map((s) => document.querySelector(s));
      if (els.some((e) => !e)) return selectores.filter((_, i) => !els[i]);
      return els.every((e, i) => i === 0 || (els[i - 1]!.compareDocumentPosition(e!) & Node.DOCUMENT_POSITION_FOLLOWING)) ? 'en orden' : 'desordenado';
    });
    expect(orden).toBe('en orden');
    await expect(page.locator('.mesa-cerrar .btn-cerrar-mesa')).toHaveText(/Cerrar mesa/);
    // «Listo» sigue en el círculo.
    await expect(page.getByRole('button', { name: 'Listo', exact: true })).toBeVisible();
  });

  test('🔴 T02 · quiénes: «Tú» primero (de la sesión) y la cantidad con el titular', async ({ page }) => {
    await tuMesa(page);
    await expect(cabecera(quienes(page))).toHaveAttribute('aria-expanded', 'true');
    await expect(cabecera(quienes(page))).toContainText('3 personas');
    const filas = quienes(page).locator('.quien');
    await expect(filas).toHaveCount(3);
    await expect(filas.first()).toContainText('Tú');
    await expect(filas.nth(1)).toContainText('Luis Cárdenas');
    await expect(filas.nth(2)).toContainText('Renata Ortiz');
  });

  test('T02 · una mesa nueva: sólo el titular, en singular', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled'));
    await ingresar(page);
    const mesa = await abrirMesaConLink(page, { sinGarantia: true, modo: 'consumo' });
    await page.goto(`/mesa/${mesa.code}`);
    await expect(page.getByRole('heading', { name: 'Tu mesa', exact: true })).toBeVisible();
    await expect(cabecera(quienes(page))).toContainText('1 persona');
    await expect(quienes(page).locator('.quien')).toHaveCount(1);
    await capturar(page, 'tu-mesa-sin-solicitudes-375');
  });

  test('🔴 T03 · sin solicitudes no hay sección (ni «0 pendientes») y quiénes arranca abierto', async ({ page }) => {
    await tuMesa(page);
    await page.waitForTimeout(400);
    await expect(solicitudes(page)).toHaveCount(0);
    await expect(page.getByText(/0 pendientes/)).toHaveCount(0);
    await expect(cabecera(quienes(page))).toHaveAttribute('aria-expanded', 'true');
  });

  test('🔴 T04 · una: «1 pendiente», nombre y @, Rechazar a la izquierda y Aceptar a la derecha, de 44 px', async ({ page }) => {
    await costura(page, { solicitudes: 1 });
    await tuMesa(page);
    await expect(cabecera(solicitudes(page))).toContainText('1 pendiente');
    await expect(cabecera(solicitudes(page))).toHaveAttribute('aria-expanded', 'true');
    // Con solicitudes, quiénes arranca cerrado (2.10).
    await expect(cabecera(quienes(page))).toHaveAttribute('aria-expanded', 'false');
    const fila = solicitudes(page).locator('.solicitud');
    await expect(fila).toHaveText(/^Ana López \(@ana\.lopez\) quiere unirseRechazarAceptar$/);
    const [rechazar, aceptar] = await Promise.all([
      fila.getByRole('button', { name: 'Rechazar' }).boundingBox(),
      fila.getByRole('button', { name: 'Aceptar' }).boundingBox(),
    ]);
    expect(rechazar!.x).toBeLessThan(aceptar!.x);
    expect(rechazar!.height).toBeGreaterThanOrEqual(44);
    expect(aceptar!.height).toBeGreaterThanOrEqual(44);
    // Sin vencimiento visible.
    await expect(solicitudes(page)).not.toContainText(/vence|min/i);
    await capturar(page, 'tu-mesa-una-solicitud-375');
  });

  test('🔴 T05 · tres, una sin @: en orden, «Sofía Torres quiere unirse» sin paréntesis vacíos', async ({ page }) => {
    await costura(page, { solicitudes: 3 });
    await tuMesa(page);
    await expect(cabecera(solicitudes(page))).toContainText('3 pendientes');
    await expect(solicitudes(page).locator('.solicitud-texto')).toHaveText([
      'Ana López (@ana.lopez) quiere unirse',
      'Diego Ramírez (@diego.rmz) quiere unirse',
      'Sofía Torres quiere unirse',
    ]);
    await expect(solicitudes(page)).not.toContainText('()');
    await expect(solicitudes(page)).not.toContainText('null');
    await capturar(page, 'tu-mesa-varias-solicitudes-375');
  });

  test('T06 · diez: «10 pendientes» y todas alcanzables', async ({ page }) => {
    await costura(page, { solicitudes: 10 });
    await tuMesa(page);
    await expect(cabecera(solicitudes(page))).toContainText('10 pendientes');
    const filas = solicitudes(page).locator('.solicitud');
    await expect(filas).toHaveCount(10);
    await filas.last().getByRole('button', { name: 'Aceptar' }).scrollIntoViewIfNeeded();
    await expect(filas.last().getByRole('button', { name: 'Aceptar' })).toBeInViewport();
    // Las personas no son las solicitudes.
    await cabecera(quienes(page)).click();
    await expect(cabecera(quienes(page))).toContainText('3 personas');
  });

  test('🔴 T07 · aceptar: la solicitud sale y la persona se suma UNA vez, después del 200', async ({ page }) => {
    await costura(page, { solicitudes: 1 });
    await tuMesa(page);
    await solicitudes(page).getByRole('button', { name: 'Aceptar' }).click();
    await expect(solicitudes(page)).toHaveCount(0);
    await cabecera(quienes(page)).click();
    await expect(cabecera(quienes(page))).toContainText('4 personas');
    await expect(quienes(page).locator('.quien').filter({ hasText: 'Ana López' })).toHaveCount(1);
  });

  test('🔴 T08 · rechazar: la solicitud sale y no se suma nadie', async ({ page }) => {
    await costura(page, { solicitudes: 1 });
    await tuMesa(page);
    await solicitudes(page).getByRole('button', { name: 'Rechazar' }).click();
    await expect(solicitudes(page)).toHaveCount(0);
    await expect(cabecera(quienes(page))).toContainText('3 personas');
  });

  test('🔴 T09 · cada botón actúa sobre SU fila; al vaciarse la lista, la sección se va', async ({ page }) => {
    await costura(page, { solicitudes: 2 });
    await tuMesa(page);
    const diego = solicitudes(page).locator('.solicitud').filter({ hasText: 'Diego Ramírez' });
    await diego.getByRole('button', { name: 'Rechazar' }).click();
    await expect(solicitudes(page).locator('.solicitud')).toHaveCount(1);
    await expect(solicitudes(page).locator('.solicitud')).toContainText('Ana López');
    await solicitudes(page).getByRole('button', { name: 'Aceptar' }).click();
    await expect(solicitudes(page)).toHaveCount(0);
    await cabecera(quienes(page)).click();
    await expect(quienes(page).locator('.quien').filter({ hasText: 'Ana López' })).toHaveCount(1);
    await expect(quienes(page).locator('.quien').filter({ hasText: 'Diego' })).toHaveCount(0);
  });

  for (const [id, decidir, texto] of [
    ['T10', 'expired', 'Esta solicitud ya no está disponible.'],
    ['T11', 'not_pending', 'Esta solicitud ya no está disponible.'],
    ['T13', 'not_joinable', 'Ya no se puede sumar gente a esta mesa.'],
    ['T14', 'error', 'No pudimos confirmar el resultado. Intenta de nuevo.'],
  ] as const) {
    test(`🔴 ${id} · aceptar con ${decidir}: nadie se suma y se dice por qué`, async ({ page }) => {
      await costura(page, { solicitudes: 1, decidir });
      await tuMesa(page);
      await solicitudes(page).getByRole('button', { name: 'Aceptar' }).click();
      await expect(page.locator('.toast:not(.toast-hidden)')).toHaveText(texto);
      await cabecera(quienes(page)).click();
      await expect(cabecera(quienes(page))).toContainText('3 personas');
      await expect(quienes(page).locator('.quien').filter({ hasText: 'Ana López' })).toHaveCount(0);
    });
  }

  test('🔴 T15 · sin acceso (403): no hay sección ni controles', async ({ page }) => {
    await costura(page, { solicitudes: 2, listar: 'forbidden' });
    await tuMesa(page);
    await page.waitForTimeout(400);
    await expect(solicitudes(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Aceptar' })).toHaveCount(0);
  });

  test('T03 · la lista no carga: lo dice, con Reintentar, sin inventar una lista vacía', async ({ page }) => {
    await costura(page, { solicitudes: 1, listar: 'error' });
    await tuMesa(page);
    const error = page.getByRole('alert').filter({ hasText: 'No pudimos cargar las solicitudes.' });
    await expect(error).toBeVisible();
    await expect(error.getByRole('button', { name: 'Reintentar' })).toBeVisible();
    await expect(solicitudes(page)).toHaveCount(0);
  });

  test('🔴 P04 · una solicitud con foto o correo (señuelos) se rechaza entera: no se muestra nada de eso', async ({ page }) => {
    await costura(page, { solicitudes: 2, listar: 'decoy' });
    await tuMesa(page);
    await expect(page.getByText('No pudimos cargar las solicitudes.')).toBeVisible();
    await expect(page.locator('body')).not.toContainText('SENUELO');
    await expect(page.getByText(/quiere unirse/)).toHaveCount(0);
  });

  test('🔴 T16 · tus consumos: cerrado por defecto; abrir, elegir, cerrar y no se pierde nada', async ({ page }) => {
    await tuMesa(page);
    const tc = cabecera(consumos(page));
    await expect(tc).toHaveAttribute('aria-expanded', 'false');
    await expect(tc).toContainText('Toca para elegir');
    await expect(page.locator('.qc-lista')).toBeHidden();
    await tc.click();
    await expect(tc).toHaveAttribute('aria-expanded', 'true');
    await page.locator('.qc-renglon[data-plato="Tagliatelle Bolognese"] .qc-fila').click();
    await expect(tc).toContainText('1 elegido · toca para modificar');
    await page.locator('.qc-renglon[data-plato="Risotto ai Funghi"] .qc-fila').click();
    await expect(tc).toContainText('2 elegidos · toca para modificar');
    const barra = await page.locator('.mi-parte').textContent();
    await tc.click();
    await expect(page.locator('.qc-lista')).toBeHidden();
    await expect(tc).toContainText('2 elegidos · toca para modificar');
    await expect(page.locator('.mi-parte')).toHaveText(barra!);
    await tc.click();
    await expect(page.locator('.qc-renglon[data-plato="Tagliatelle Bolognese"] .qc-mia')).toBeVisible();
    await capturar(page, 'tu-mesa-consumos-abierto-375');
  });

  test('🔴 «Listo» sin nada elegido abre «Tus consumos» y lleva a la lista', async ({ page }) => {
    await tuMesa(page);
    await expect(cabecera(consumos(page))).toHaveAttribute('aria-expanded', 'false');
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    await expect(page.locator('.toast:not(.toast-hidden)')).toHaveText('Elige lo que consumiste para continuar');
    await expect(cabecera(consumos(page))).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.qc-lista')).toBeInViewport();
  });

  test('D · en partes iguales, «[n] partes · toca para modificar»', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled'));
    await ingresar(page);
    const mesa = await abrirMesaConLink(page, { sinGarantia: true, modo: 'igual' });
    await page.goto(`/mesa/${mesa.code}`);
    const tc = cabecera(consumos(page));
    await expect(tc).toContainText('Toca para elegir');
    await tc.click();
    await page.locator('.qc-renglon .qc-fila').first().click();
    await expect(tc).toContainText('1 parte · toca para modificar');
  });

  test('🔴 T17 · compartir: el código como texto, «Copiar link» e «Invitar amigos» de siempre, sin «Copiar código»', async ({ page }) => {
    await tuMesa(page);
    await expect(page.locator('.mesa-codigo-para-unirse')).toHaveText('Código para unirse: PA-2847');
    await expect(page.getByRole('button', { name: 'Copiar link de invitación' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Invitar amigos de PayMe' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Copiar código/ })).toHaveCount(0);
    // El código no sube a la burbuja (decisión 77).
    await expect(page.locator('.mesa-selection-title')).not.toContainText('PA-2847');
  });

  test('🔴 T19 · las tres tarjetas se abren y cierran con su estado accesible', async ({ page }) => {
    await costura(page, { solicitudes: 1 });
    await tuMesa(page);
    // Las solicitudes YA cargadas: con ellas quiénes pasa a cerrado (2.10), y
    // leer el estado antes era leer el de antes de saberlo (CI local de ffe0af5).
    await expect(cabecera(solicitudes(page))).toContainText('1 pendiente');
    await expect(cabecera(quienes(page))).toHaveAttribute('aria-expanded', 'false');
    for (const region of [quienes(page), solicitudes(page), consumos(page)]) {
      const c = cabecera(region);
      const antes = await c.getAttribute('aria-expanded');
      await c.click();
      await expect(c).toHaveAttribute('aria-expanded', antes === 'true' ? 'false' : 'true');
      const caja = (await c.boundingBox())!;
      expect(caja.height).toBeGreaterThanOrEqual(44);
    }
    // Con el teclado también.
    await cabecera(consumos(page)).focus();
    await page.keyboard.press('Enter');
    await expect(cabecera(consumos(page))).toHaveAttribute('aria-expanded', 'false');
  });

  test('🔴 quien no es titular ve la pantalla de siempre: «¿Qué consumiste?», la lista abierta y nada de esto', async ({ page }) => {
    await costura(page, { solicitudes: 3 });
    await ingresar(page);
    await page.goto('/mesa/PA-4520');
    await expect(page.getByRole('heading', { name: '¿Qué consumiste?', exact: true })).toBeVisible();
    await expect(page.locator('.qc-lista')).toBeVisible();
    await expect(page.locator('.desplegable')).toHaveCount(0);
    await expect(page.getByText('Código para unirse:')).toHaveCount(0);
    await expect(page.getByText(/quiere unirse/)).toHaveCount(0);
  });
});
