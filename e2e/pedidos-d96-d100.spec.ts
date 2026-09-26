import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';
import { configurarTicketSinQr } from './fixtures/ticket-sin-qr';

/**
 * AF-NOMBRE-COMPACTO · el paquete de pedidos chicos de Mati del 26/09
 * (decisiones 96 a 100), en una sola orden.
 */

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (dir) await page.screenshot({ path: `${dir}/${test.info().project.name}-${nombre}.png` });
}

const LEYENDA_NOMBRE = 'Sólo identifica esta mesa; no crea ni modifica un comercio.';

/** Sin QR y sin comercio leído (`no_merchant`): es cuando el campo aparece. */
async function hastaComoDividen(page: Page): Promise<void> {
  await configurarTicketSinQr(page, { ocr: 'no_merchant' });
  await ingresar(page);
  await page.getByRole('button', { name: 'Nueva', exact: true }).click();
  await page.getByRole('button', { name: 'Capturar' }).click();
  await expect(page.getByRole('radio', { name: /Pagar el total/ })).toBeVisible();
}

test.describe('D96 · «Nombre del restaurante» compacto y sin leyenda', () => {
  test('sin comercio leído: el campo está, en una fila chica y sin la leyenda', async ({ page }) => {
    await hastaComoDividen(page);
    const campo = page.getByLabel('Nombre del restaurante (opcional)');
    await expect(campo).toBeVisible();
    await expect(page.getByText(LEYENDA_NOMBRE, { exact: true })).toHaveCount(0);
    const m = await page.locator('.restaurant-label-card').evaluate((card) => {
      const titulo = card.querySelector('.restaurant-label-title')!.getBoundingClientRect();
      const input = card.querySelector('input')!.getBoundingClientRect();
      const opcion = document.querySelector('.division-options .div-card')!.getBoundingClientRect();
      const c = card.getBoundingClientRect();
      return {
        alto: c.height,
        // Una fila: el título y el input se solapan en vertical.
        mismaFila: Math.min(titulo.bottom, input.bottom) - Math.max(titulo.top, input.top) > 0,
        // Alineada con las opciones de división: mismos bordes.
        izquierda: Math.abs(c.left - opcion.left),
        derecha: Math.abs(c.right - opcion.right),
      };
    });
    // Medido a 390 px en la base 83634db: 132.7 px (tarjeta con título, input y
    // leyenda en tres filas). Una fila con el input de 44 px de toque queda por
    // debajo de 80.
    expect(m.alto, JSON.stringify(m)).toBeLessThan(80);
    expect(m.mismaFila, JSON.stringify(m)).toBe(true);
    expect(m.izquierda).toBeLessThanOrEqual(1);
    expect(m.derecha).toBeLessThanOrEqual(1);
    await capturar(page, 'd96-nombre-compacto');
  });

  test('el error de validación se sigue mostrando', async ({ page }) => {
    await hastaComoDividen(page);
    await page.getByLabel('Nombre del restaurante (opcional)').fill('x'.repeat(201));
    await expect(page.getByText('Usa un nombre de hasta 200 caracteres.', { exact: true })).toBeVisible();
  });

  test('con el comercio leído por el OCR, el campo no aparece', async ({ page }) => {
    await configurarTicketSinQr(page);
    await ingresar(page);
    await page.getByRole('button', { name: 'Nueva', exact: true }).click();
    await page.getByRole('button', { name: 'Capturar' }).click();
    await expect(page.getByRole('radio', { name: /Pagar el total/ })).toBeVisible();
    await expect(page.getByLabel('Nombre del restaurante (opcional)')).toHaveCount(0);
  });
});

// D97 · el aviso de Google «otra cuenta»: lo fija `google-aviso-otra-cuenta.spec.ts`.

test.describe('D98 + D99 · Inicio › Cuenta: Pagos lleva a Mesas y Perfil a Configuración', () => {
  test('con los pagos apagados (como en producción): dos accesos del mismo tamaño que el de Estadísticas', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled'));
    await ingresar(page);
    await page.getByRole('tab', { name: 'Cuenta', exact: true }).click();
    const pagos = page.getByRole('button', { name: 'Ver pagos', exact: true });
    const perfil = page.getByRole('button', { name: 'Ver perfil', exact: true });
    await expect(pagos).toBeVisible();
    await expect(perfil).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ver tarjetas', exact: true })).toHaveCount(0);
    await expect(page.locator('.launch-pair.home-tab-panel > *')).toHaveCount(2);
    const [a, b] = await Promise.all([pagos.boundingBox(), perfil.boundingBox()]);
    expect(Math.abs(a!.width - b!.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(a!.height - b!.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(a!.y - b!.y), 'lado a lado').toBeLessThanOrEqual(1);
    await capturar(page, 'd99-cuenta');
    await page.getByRole('tab', { name: 'Estadísticas', exact: true }).click();
    const stats = await page.getByRole('button', { name: 'Ver mis estadísticas', exact: true }).boundingBox();
    expect(Math.abs(stats!.height - a!.height), 'misma composición que Estadísticas').toBeLessThanOrEqual(1);
  });

  test('con las tarjetas habilitadas, «Ver tarjetas» sigue con su condición, junto a los dos', async ({ page }) => {
    await ingresar(page);
    await page.getByRole('tab', { name: 'Cuenta', exact: true }).click();
    for (const acceso of ['Ver tarjetas', 'Ver pagos', 'Ver perfil']) {
      await expect(page.getByRole('button', { name: acceso, exact: true })).toBeVisible();
    }
  });

  test('«Ver pagos» lleva a Mesas', async ({ page }) => {
    await ingresar(page);
    await page.getByRole('tab', { name: 'Cuenta', exact: true }).click();
    await page.getByRole('button', { name: 'Ver pagos', exact: true }).click();
    await expect(page).toHaveURL(/:\d+\/mesas$/);
    await expect(page.getByRole('heading', { name: 'Historial', exact: true })).toBeVisible();
  });

  test('«Ver perfil» lleva a Configuración, la misma pantalla que «Más»', async ({ page }) => {
    await ingresar(page);
    await page.getByRole('tab', { name: 'Cuenta', exact: true }).click();
    await page.getByRole('button', { name: 'Ver perfil', exact: true }).click();
    await expect(page).toHaveURL(/:\d+\/mas$/);
    await expect(page.getByRole('heading', { name: 'Configuración', exact: true })).toBeVisible();
  });
});

test.describe('D100 · Historial: plato, «½» y monto en una sola línea', () => {
  test('el «½» comparte la línea del nombre y del monto, en columna', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('payme.app.mock.mis_mesas.v1', 'sin_cobro'));
    await ingresar(page);
    await page.goto('/mesas');
    const mesa = page.locator('.tu-mesa').filter({ hasText: 'Tacos El Güero' });
    await mesa.getByRole('button').click();
    const detalle = mesa.locator('.hist-detail');
    await expect(detalle).toContainText('Quesadilla');
    const filas = await detalle.locator('.hist-detail-row').evaluateAll((rs) => rs.map((r) => {
      const caja = (sel: string) => {
        const e = r.querySelector(sel);
        if (!e || getComputedStyle(e).display === 'none') return null;
        const b = e.getBoundingClientRect();
        return { top: b.top, bottom: b.bottom, left: b.left, centro: (b.top + b.bottom) / 2 };
      };
      return {
        texto: r.textContent,
        frac: caja('.hist-detail-frac'),
        nombre: caja('.hist-detail-name'),
        monto: caja('.hist-detail-amount'),
      };
    }));
    const quesadilla = filas.find((f) => f.texto?.includes('Quesadilla'))!;
    expect(quesadilla.frac, JSON.stringify(quesadilla)).not.toBeNull();
    // Misma línea: los centros verticales coinciden.
    expect(Math.abs(quesadilla.frac!.centro - quesadilla.nombre!.centro), JSON.stringify(quesadilla)).toBeLessThanOrEqual(2);
    expect(Math.abs(quesadilla.nombre!.centro - quesadilla.monto!.centro), JSON.stringify(quesadilla)).toBeLessThanOrEqual(2);
    // En columna: todos los nombres empiezan en el mismo x (con porción o sin ella).
    const lefts = new Set(filas.map((f) => Math.round(f.nombre!.left)));
    expect(lefts.size, JSON.stringify(filas)).toBe(1);
    await capturar(page, 'd100-historial');
  });

  test('sin ninguna porción en la mesa, la columna no ocupa lugar', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('payme.app.mock.mis_mesas.v1', 'muchas'));
    await ingresar(page);
    await page.goto('/mesas');
    const mesa = page.locator('.tu-mesa').filter({ hasText: 'Mesa de prueba 1' }).first();
    await mesa.getByRole('button').click();
    const fila = mesa.locator('.hist-detail-row').first();
    await expect(fila).toBeVisible();
    const m = await fila.evaluate((r) => {
      const d = r.closest('.hist-detail')!.getBoundingClientRect();
      const n = r.querySelector('.hist-detail-name')!.getBoundingClientRect();
      const pad = parseFloat(getComputedStyle(r.closest('.hist-detail')!).paddingLeft);
      return { desdeElBorde: n.left - d.left - pad - 1 };
    });
    expect(Math.abs(m.desdeElBorde), JSON.stringify(m)).toBeLessThanOrEqual(1);
  });
});
