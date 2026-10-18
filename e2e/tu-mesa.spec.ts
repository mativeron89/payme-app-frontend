import { expect, test, type Page } from '@playwright/test';
import { abrirMesaConLink, ingresar } from './_app';
import { abrirQuienes } from './_mesa';

/**
 * AF-UNIRSE-CODIGO · D223 · «Tu mesa», la mesa del titular reorganizada
 * («Todo junto, como el diseño», turno 2 · 2.9–2.11): quiénes están,
 * solicitudes para unirse (sólo si hay), compartir, tus consumos y cerrar mesa.
 * D360-4a · «Quiénes» arranca cerrado y sin la cantidad de personas; D360-7 ·
 * «Tus consumos» arranca abierto; D360-5a y D369 · sin subtítulo. Los casos
 * T01–T19 y los negativos de privacidad de las pruebas de aceptación de Codex
 * (`PRUEBAS_ACEPTACION_UNIRME.md`).
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

  test('🔴 T02 · quiénes: arranca cerrado y sin la cantidad (D360-4a); abierto, «Tú» primero (de la sesión)', async ({ page }) => {
    await tuMesa(page);
    await expect(cabecera(quienes(page))).toHaveAttribute('aria-expanded', 'false');
    // La cabecera es sólo el título: ningún «N personas» ni renglón de resumen.
    await expect(cabecera(quienes(page))).toHaveText('Quiénes están en la mesa');
    await expect(cabecera(quienes(page)).locator('.desplegable-resumen')).toHaveCount(0);
    await abrirQuienes(page);
    await expect(cabecera(quienes(page))).toHaveText('Quiénes están en la mesa');
    const filas = quienes(page).locator('.quien');
    await expect(filas).toHaveCount(3);
    await expect(filas.first()).toContainText('Tú');
    await expect(filas.nth(1)).toContainText('Luis Cárdenas');
    await expect(filas.nth(2)).toContainText('Renata Ortiz');
  });

  test('T02 · una mesa nueva: sólo el titular, sin «1 persona»', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled'));
    await ingresar(page);
    const mesa = await abrirMesaConLink(page, { sinGarantia: true, modo: 'consumo' });
    await page.goto(`/mesa/${mesa.code}`);
    await expect(page.getByRole('heading', { name: 'Tu mesa', exact: true })).toBeVisible();
    await expect(cabecera(quienes(page))).toHaveText('Quiénes están en la mesa');
    await abrirQuienes(page);
    await expect(quienes(page).locator('.quien')).toHaveCount(1);
    await capturar(page, 'tu-mesa-sin-solicitudes-375');
  });

  test('🔴 T03 · sin solicitudes no hay sección (ni «0 pendientes») y quiénes arranca cerrado igual (D360-4a)', async ({ page }) => {
    await tuMesa(page);
    await page.waitForTimeout(400);
    await expect(solicitudes(page)).toHaveCount(0);
    await expect(page.getByText(/0 pendientes/)).toHaveCount(0);
    await expect(cabecera(quienes(page))).toHaveAttribute('aria-expanded', 'false');
  });

  test('🔴 T04 · una: «1 pendiente», nombre y @, Rechazar a la izquierda y Aceptar a la derecha, de 44 px', async ({ page }) => {
    await costura(page, { solicitudes: 1 });
    await tuMesa(page);
    await expect(cabecera(solicitudes(page))).toContainText('1 pendiente');
    await expect(cabecera(solicitudes(page))).toHaveAttribute('aria-expanded', 'true');
    // Quiénes arranca cerrado, con solicitudes o sin ellas (D360-4a).
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
    await abrirQuienes(page);
    await expect(quienes(page).locator('.quien')).toHaveCount(3);
  });

  test('🔴 T07 · aceptar: la solicitud sale y la persona se suma UNA vez, después del 200', async ({ page }) => {
    await costura(page, { solicitudes: 1 });
    await tuMesa(page);
    await solicitudes(page).getByRole('button', { name: 'Aceptar' }).click();
    await expect(solicitudes(page)).toHaveCount(0);
    await abrirQuienes(page);
    await expect(quienes(page).locator('.quien')).toHaveCount(4);
    await expect(quienes(page).locator('.quien').filter({ hasText: 'Ana López' })).toHaveCount(1);
  });

  test('🔴 T08 · rechazar: la solicitud sale y no se suma nadie', async ({ page }) => {
    await costura(page, { solicitudes: 1 });
    await tuMesa(page);
    await solicitudes(page).getByRole('button', { name: 'Rechazar' }).click();
    await expect(solicitudes(page)).toHaveCount(0);
    await abrirQuienes(page);
    await expect(quienes(page).locator('.quien')).toHaveCount(3);
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
    await abrirQuienes(page);
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
      await abrirQuienes(page);
      await expect(quienes(page).locator('.quien')).toHaveCount(3);
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

  test('🔴 T16 · tus consumos: abierto por defecto (D360-7) y sin subtítulo (D360-5a, D369); elegir, cerrar y no se pierde nada', async ({ page }) => {
    await tuMesa(page);
    const tc = cabecera(consumos(page));
    await expect(tc).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.qc-lista')).toBeVisible();
    // La cabecera es sólo el título, en un renglón: no dice nada al elegir.
    await expect(tc).toHaveText('Tus consumos');
    await expect(tc.locator('.desplegable-resumen')).toHaveCount(0);
    const altoCabecera = (await tc.boundingBox())!.height;
    await page.locator('.qc-renglon[data-plato="Tagliatelle Bolognese"] .qc-fila').click();
    // Cuántos elegiste lo dice la barra de abajo (D369).
    await expect(page.locator('.mi-parte-platos')).toHaveText(' · 1 plato');
    await page.locator('.qc-renglon[data-plato="Risotto ai Funghi"] .qc-fila').click();
    await expect(page.locator('.mi-parte-platos')).toHaveText(' · 2 platos');
    await expect(tc).toHaveText('Tus consumos');
    expect((await tc.boundingBox())!.height).toBe(altoCabecera);
    const barra = await page.locator('.mi-parte').textContent();
    await tc.click();
    await expect(page.locator('.qc-lista')).toBeHidden();
    await expect(tc).toHaveText('Tus consumos');
    await expect(page.locator('.mi-parte')).toHaveText(barra!);
    await tc.click();
    await expect(page.locator('.qc-renglon[data-plato="Tagliatelle Bolognese"] .qc-mia')).toBeVisible();
    await capturar(page, 'tu-mesa-consumos-abierto-375');
  });

  test('🔴 «Listo» sin nada elegido abre «Tus consumos» (si se cerró) y lleva a la lista', async ({ page }) => {
    await tuMesa(page);
    // Arranca abierto (D360-7): se cierra para probar que «Listo» lo vuelve a abrir.
    await expect(cabecera(consumos(page))).toHaveAttribute('aria-expanded', 'true');
    await cabecera(consumos(page)).click();
    await expect(cabecera(consumos(page))).toHaveAttribute('aria-expanded', 'false');
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    await expect(page.locator('.toast:not(.toast-hidden)')).toHaveText('Elige lo que consumiste para continuar');
    await expect(cabecera(consumos(page))).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.qc-lista')).toBeInViewport();
  });

  test('D · en partes iguales, la cabecera tampoco dice cuántas partes (D369)', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled'));
    await ingresar(page);
    const mesa = await abrirMesaConLink(page, { sinGarantia: true, modo: 'igual' });
    await page.goto(`/mesa/${mesa.code}`);
    const tc = cabecera(consumos(page));
    // Abierta desde el principio y sin subtítulo (D360-7, D360-5a y D369).
    await expect(tc).toHaveAttribute('aria-expanded', 'true');
    await expect(tc).toHaveText('Tus consumos');
    await page.locator('.qc-renglon .qc-fila').first().click();
    await expect(page.locator('.mi-parte-platos')).toHaveText(' · 1 plato');
    await expect(tc).toHaveText('Tus consumos');
    await expect(tc).not.toContainText('toca para modificar');
  });

  test('🔴 T17 · compartir: «Copiar link» e «Invitar amigos» de siempre en la página, y el código como texto en el engranaje (D360-4b), sin «Copiar código»', async ({ page }) => {
    await tuMesa(page);
    // D360-4b · el código pasó a la hoja del engranaje.
    await expect(page.locator('.screen .mesa-codigo-para-unirse')).toHaveCount(0);
    await page.getByRole('button', { name: 'Configuración de la mesa', exact: true }).click();
    const hoja = page.getByRole('dialog', { name: 'Configuración de la mesa' });
    await expect(hoja.locator('.mesa-codigo-para-unirse')).toHaveText('Código para unirse: PA-2847');
    await hoja.getByRole('button', { name: 'Cerrar', exact: true }).click();
    await expect(hoja).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Configuración de la mesa', exact: true })).toBeFocused();
    await expect(page.getByRole('button', { name: 'Copiar link de invitación' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Invitar amigos de PayMe' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Copiar código/ })).toHaveCount(0);
    // El código no sube a la burbuja (decisión 77).
    await expect(page.locator('.mesa-selection-title')).not.toContainText('PA-2847');
  });

  test('🔴 T19 · las tres tarjetas se abren y cierran con su estado accesible', async ({ page }) => {
    await costura(page, { solicitudes: 1 });
    await tuMesa(page);
    // Las solicitudes YA cargadas. Quiénes arranca cerrado y tus consumos abierto
    // (D360-4a y D360-7).
    await expect(cabecera(solicitudes(page))).toContainText('1 pendiente');
    await expect(cabecera(quienes(page))).toHaveAttribute('aria-expanded', 'false');
    await expect(cabecera(consumos(page))).toHaveAttribute('aria-expanded', 'true');
    for (const region of [quienes(page), solicitudes(page), consumos(page)]) {
      const c = cabecera(region);
      const antes = await c.getAttribute('aria-expanded');
      await c.click();
      await expect(c).toHaveAttribute('aria-expanded', antes === 'true' ? 'false' : 'true');
      const caja = (await c.boundingBox())!;
      expect(caja.height).toBeGreaterThanOrEqual(44);
    }
    // Con el teclado también: el bucle la dejó cerrada, Enter la abre.
    await cabecera(consumos(page)).focus();
    await page.keyboard.press('Enter');
    await expect(cabecera(consumos(page))).toHaveAttribute('aria-expanded', 'true');
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
