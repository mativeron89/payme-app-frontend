import { expect, test, type Page } from '@playwright/test';

type Control = typeof import('./fixtures/lecturas-pendientes').control;
declare global { interface Window { lecturasDePrueba: Control } }

async function abrir(page: Page, pantalla: 'viaje' | 'inicio') {
  await page.goto('/e2e/fixtures/lecturas-pendientes.html?' + pantalla);
  await page.evaluate(async () => {
    const ruta = '/e2e/fixtures/lecturas-pendientes.tsx';
    window.lecturasDePrueba = (await import(/* @vite-ignore */ ruta)).control;
  });
  await pedidos(page, 1);
}

async function pedidos(page: Page, cantidad: number) {
  await expect.poll(() => page.evaluate(() => window.lecturasDePrueba.cantidad())).toBe(cantidad);
}

async function responder(page: Page, indice: number, resultado: 'correcta' | 'error' | 'cerrado' = 'correcta') {
  await page.evaluate(async ([i, r]) => {
    window.lecturasDePrueba.responder(i, r);
    // Deja terminar las promesas y el render antes de afirmar una ausencia de cambios.
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }, [indice, resultado] as const);
}

test('Viajes conserva el detalle nuevo después de un error anterior', async ({ page }) => {
  await abrir(page, 'viaje');
  await page.getByText('Releer').click();
  await pedidos(page, 2);
  await responder(page, 1);
  await expect(page.locator('output')).toHaveText('Viaje 1');
  await responder(page, 0, 'error');
  await expect(page.locator('output')).toHaveText('Viaje 1');
});

for (const [accion, esperado] of [['Mostrar edición', 'Editado'], ['Marcar ausente', 'no_disponible']]) {
  test('Viajes conserva la actualización directa de ' + accion, async ({ page }) => {
    await abrir(page, 'viaje');
    await page.getByText(accion).click();
    await expect(page.locator('output')).toHaveText(esperado);
    await responder(page, 0);
    await expect(page.locator('output')).toHaveText(esperado);
  });
}

test('Desmontar Viajes descarta el redireccionamiento de una lectura pendiente', async ({ page }) => {
  await abrir(page, 'viaje');
  await page.evaluate(() => window.lecturasDePrueba.desmontar());
  const ruta = page.url();
  await responder(page, 0, 'cerrado');
  await expect(page).toHaveURL(ruta);
});

for (const resultado of ['correcta', 'error'] as const) {
  test('Inicio conserva la invitación nueva tras una respuesta anterior ' + resultado, async ({ page }) => {
    await abrir(page, 'inicio');
    await page.getByText('Releer').click();
    await pedidos(page, 2);
    await responder(page, 1);
    await expect(page.locator('output')).toHaveText('hay inv-1');
    await responder(page, 0, resultado);
    await expect(page.locator('output')).toHaveText('hay inv-1');
  });
}

test('Inicio vuelve a leer al cambiar el contador de avisos', async ({ page }) => {
  await abrir(page, 'inicio');
  await page.getByText('Sumar aviso').click();
  await pedidos(page, 2);
  await responder(page, 1);
  await expect(page.locator('output')).toHaveText('hay inv-1');
  await responder(page, 0);
  await expect(page.locator('output')).toHaveText('hay inv-1');
});

test('Inicio muestra el estado de fallo al fallar la lectura vigente', async ({ page }) => {
  await abrir(page, 'inicio');
  await page.getByText('Releer').click();
  await pedidos(page, 2);
  await responder(page, 1);
  await expect(page.locator('output')).toHaveText('hay inv-1');
  await page.getByText('Releer').click();
  await pedidos(page, 3);
  await responder(page, 2, 'error');
  await responder(page, 0);
  await expect(page.locator('output')).toHaveText('fallo');
});

test('Desmontar Inicio conserva en memoria la última invitación mostrada', async ({ page }) => {
  await abrir(page, 'inicio');
  await page.getByText('Releer').click();
  await pedidos(page, 2);
  await responder(page, 1);
  await expect(page.locator('output')).toHaveText('hay inv-1');
  await page.getByText('Releer').click();
  await pedidos(page, 3);
  await page.evaluate(() => window.lecturasDePrueba.desmontar());
  await responder(page, 2);
  await responder(page, 0);
  expect(await page.evaluate(() => window.lecturasDePrueba.cache())).toEqual(['inv-1']);
});
