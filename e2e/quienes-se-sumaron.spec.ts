import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

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
    // Sin foto y sin plata: la sección no tiene imágenes ni montos.
    await expect(lista.locator('img')).toHaveCount(0);
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
});
