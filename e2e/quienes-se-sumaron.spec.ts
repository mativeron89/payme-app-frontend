import { expect, test, type Page } from '@playwright/test';
import { ingresar, irEnLaApp } from './_app';

/**
 * AF-25 · n72 · «quiénes se sumaron», sólo para el organizador
 * (`GET /api/mesas/:code/participants`, dueño v2.101.0; decisión de Mati
 * «Publicar ya sin foto; la foto después»).
 *
 * En el seed, PA-2847 la abrió el usuario del mock y PA-4520 no. Costura:
 * `payme.app.mock.participantes.v1` (`error`, `antiguo`, `vacio`, `variedad`).
 */

async function seam(page: Page, valor: string): Promise<void> {
  await page.addInitScript((v) => {
    localStorage.setItem('payme.app.mock.participantes.v1', v);
  }, valor);
}

/**
 * Captura del VIEWPORT, no de la página entera: el scroll vive en un contenedor
 * de la app y `fullPage` lo vuelve a arriba, dejando la sección fuera de cuadro.
 */
async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/${test.info().project.name}-${nombre}.png` });
}

async function pedidosDeFotos(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const path = '/src/api/mock/mockApi.ts';
    const mock = await import(/* @vite-ignore */ path) as { contarPedidosDeFotos(): number };
    return mock.contarPedidosDeFotos();
  });
}

async function pedidos(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const path = '/src/api/mock/mockApi.ts';
    const mock = await import(/* @vite-ignore */ path) as { contarPedidosDeParticipantes(): number };
    return mock.contarPedidosDeParticipantes();
  });
}

const seccion = (page: Page) => page.getByRole('region', { name: 'Quiénes se sumaron' });

test.describe('AF-25 · quiénes se sumaron (n72)', () => {
  test('el organizador ve nombre, apellido e identificador, y nada más', async ({ page }) => {
    await ingresar(page);
    await page.goto('/#/mesa/PA-2847');
    const lista = seccion(page);
    await expect(lista.getByText('Luis Cárdenas', { exact: true })).toBeVisible();
    await expect(lista.getByText('payme_mx_luis', { exact: true })).toBeVisible();
    await expect(lista.getByText('Renata Ortiz', { exact: true })).toBeVisible();
    // AF-32 (aviso 2.5.3): Luis tiene foto y la ve el organizador, como `blob:`
    // en memoria; Renata no tiene, y va con sus iniciales. Sin plata.
    await expect(lista.locator('img')).toHaveCount(1);
    await expect(lista.getByRole('img', { name: 'Foto de Luis Cárdenas' })).toHaveAttribute('src', /^blob:/);
    await expect(lista.locator('.avatar').filter({ hasText: 'RO' })).toBeVisible();
    await expect(lista).not.toContainText('$');
    // El scroll es de la app, no de la página: se trae la sección a la vista.
    // (medido: el contenedor es `.flow-scroll`, 772 de contenido para 585 de alto;
    // `scrollIntoViewIfNeeded` daba por visible una fila tapada por la barra).
    await page.evaluate(() => { document.querySelector('.flow-scroll')?.scrollTo(0, 1e6); });
    await capturar(page, 'quienes-01-lista');
  });

  test('sin cuenta → «Invitado»; cuenta eliminada → «Cuenta eliminada»', async ({ page }) => {
    await seam(page, 'variedad');
    await ingresar(page);
    await page.goto('/#/mesa/PA-2847');
    const lista = seccion(page);
    await expect(lista.getByText('Luis Cárdenas', { exact: true })).toBeVisible();
    await expect(lista.getByText('Invitado', { exact: true })).toBeVisible();
    await expect(lista.getByText('Cuenta eliminada', { exact: true })).toBeVisible();
    // El scroll es de la app, no de la página: se trae la sección a la vista.
    // (medido: el contenedor es `.flow-scroll`, 772 de contenido para 585 de alto;
    // `scrollIntoViewIfNeeded` daba por visible una fila tapada por la barra).
    await page.evaluate(() => { document.querySelector('.flow-scroll')?.scrollTo(0, 1e6); });
    await capturar(page, 'quienes-02-invitado-y-eliminada');
  });

  test('🔴 a quien NO organiza no se le ofrece ni se le pide', async ({ page }) => {
    await ingresar(page);
    await page.goto('/#/mesa/PA-4520');
    // Testigo positivo: la mesa cargó (su lista de consumos está) y soy participante.
    await expect(page.getByRole('button', { name: /^Barco de sushi/ })).toBeVisible();
    await expect(seccion(page)).toHaveCount(0);
    expect(await pedidos(page)).toBe(0);
  });

  test('backend anterior (404): la sección no aparece, y el resto de la mesa sí', async ({ page }) => {
    await seam(page, 'antiguo');
    await ingresar(page);
    await page.goto('/#/mesa/PA-2847');
    await expect(page.getByRole('button', { name: 'Copiar link de invitación' })).toBeVisible();
    await expect.poll(() => pedidos(page)).toBeGreaterThan(0);
    await expect(seccion(page)).toHaveCount(0);
  });

  test('si falla, lo dice con reintento; al reintentar, aparece la lista', async ({ page }) => {
    await seam(page, 'error');
    await ingresar(page);
    await page.goto('/#/mesa/PA-2847');
    const lista = seccion(page);
    await expect(lista.getByText('No pudimos cargar quiénes se sumaron.')).toBeVisible();
    await page.evaluate(() => localStorage.removeItem('payme.app.mock.participantes.v1'));
    await lista.getByRole('button', { name: 'Reintentar' }).click();
    await expect(lista.getByText('Luis Cárdenas', { exact: true })).toBeVisible();
  });

  test('sin nadie todavía: lo dice', async ({ page }) => {
    await seam(page, 'vacio');
    await ingresar(page);
    await page.goto('/#/mesa/PA-2847');
    await expect(seccion(page).getByText('Todavía no se sumó nadie.')).toBeVisible();
  });

  test('AF-32 · fotos e iniciales mezcladas, con invitado y cuenta eliminada como antes', async ({ page }) => {
    await seam(page, 'variedad');
    await ingresar(page);
    await page.goto('/#/mesa/PA-2847');
    const lista = seccion(page);
    await expect(lista.getByRole('img', { name: 'Foto de Luis Cárdenas' })).toBeVisible();
    await expect(lista.locator('.avatar').filter({ hasText: 'RO' })).toBeVisible();
    await expect(lista.getByText('Invitado', { exact: true })).toBeVisible();
    await expect(lista.getByText('Cuenta eliminada', { exact: true })).toBeVisible();
    // Una sola foto pedida: la de quien tiene has_avatar.
    expect(await pedidosDeFotos(page)).toBe(1);
    await page.evaluate(() => { document.querySelector('.flow-scroll')?.scrollTo(0, 1e6); });
    await capturar(page, 'quienes-03-fotos-e-iniciales');
  });

  test('🔴 AF-32 · a quien NO organiza no se le pide ninguna foto', async ({ page }) => {
    await ingresar(page);
    await page.goto('/#/mesa/PA-4520');
    await expect(page.getByRole('button', { name: /^Barco de sushi/ })).toBeVisible();
    expect(await pedidosDeFotos(page)).toBe(0);
  });

  test('AF-32 · backend anterior (forma vieja, sin has_avatar): la lista sigue, con iniciales', async ({ page }) => {
    await seam(page, 'forma_vieja');
    await ingresar(page);
    await page.goto('/#/mesa/PA-2847');
    const lista = seccion(page);
    await expect(lista.getByText('Luis Cárdenas', { exact: true })).toBeVisible();
    await expect(lista.locator('img')).toHaveCount(0);
    await expect(lista.locator('.avatar').filter({ hasText: 'LC' })).toBeVisible();
    expect(await pedidosDeFotos(page)).toBe(0);
  });

  test('AF-32 · si la foto falla: iniciales, sin mensaje y sin volver a pedir', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('payme.app.mock.fotos.v1', 'error'));
    await ingresar(page);
    await page.goto('/#/mesa/PA-2847');
    const lista = seccion(page);
    await expect(lista.locator('.avatar').filter({ hasText: 'LC' })).toBeVisible();
    await expect.poll(() => pedidosDeFotos(page)).toBe(1);
    // 🔴 EXCEPCIÓN DECLARADA a la convención «cero waitForTimeout» (e2e/_app.ts):
    // lo que se afirma es que NO pasa algo —un reintento—, y una ausencia en el
    // tiempo no tiene evento al que esperar. Se espera un rato fijo y se vuelve
    // a contar. La misma garantía, sin reloj, la fija `fotosDeParticipantes.test.ts`.
    await page.waitForTimeout(1500);
    expect(await pedidosDeFotos(page)).toBe(1);
    await expect(lista.locator('img')).toHaveCount(0);
    await expect(page.getByText(/foto/i)).toHaveCount(0);
  });

  test('🔴 AF-32 · al salir de la mesa, el `blob:` de la foto se REVOCA', async ({ page }) => {
    // Espía de `URL.revokeObjectURL` antes de que cargue la app.
    await page.addInitScript(() => {
      const w = window as unknown as { __revocadas: string[] };
      w.__revocadas = [];
      const original = URL.revokeObjectURL.bind(URL);
      URL.revokeObjectURL = (url: string) => { w.__revocadas.push(url); original(url); };
    });
    await ingresar(page);
    await page.goto('/#/mesa/PA-2847');
    const foto = seccion(page).getByRole('img', { name: 'Foto de Luis Cárdenas' });
    await expect(foto).toBeVisible();
    const src = await foto.getAttribute('src');
    expect(src).toMatch(/^blob:/);
    // Sale de la mesa (se desmonta la pantalla, sin recargar la página).
    await irEnLaApp(page, '/home');
    await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __revocadas: string[] }).__revocadas))
      .toContain(src);
  });
});
