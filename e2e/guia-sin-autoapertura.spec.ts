import { expect, test, type Page } from '@playwright/test';
import { abrirMesaConLink } from './_app';
import {
  abrirDesdeLaTarjeta, ejemploSePrendio, entrar, espiarElEjemplo, geometria, hastaLaCamara, pathname, posponerElAvisoDeFotos, tarjeta,
} from './_guia';

/**
 * D364 · revisión de V sobre ff5dec7 (a2b729e4…) · la guía no se abre sola: ni al entrar con una cuenta sin el
 * «No volver a mostrar» de antes, ni al entrar por el link de una mesa. Lo vigila un MutationObserver instalado antes
 * de que cargue cada documento: anota si la capa de la guía (o su aviso de carga) apareció ALGUNA VEZ. Cada caso tiene
 * su control positivo en el mismo documento: tocar Tutorial sí la abre (si el vigía estuviera roto, el control lo
 * mostraría).
 *
 * Y la geometría de la ficha a 430 × 932 y en horizontal (844 × 390) para 2a y 2b. 3a, 2d y 2e en horizontal quedan
 * sin acreditar (aprobado por V): no se midieron.
 */

async function vigilarLaCapa(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __capaVista: boolean };
    w.__capaVista = false;
    const mirar = () => { if (document.querySelector('.guia-capa, .guia-carga')) w.__capaVista = true; };
    new MutationObserver(mirar).observe(document, { subtree: true, childList: true, attributes: true });
  });
}
const capaVista = (page: Page) => page.evaluate(() => (window as unknown as { __capaVista: boolean }).__capaVista);

test.describe('D364 · la guía no se abre sola', () => {
  test('al entrar con una cuenta sin «No volver a mostrar»: la tarjeta a la vista y la guía cerrada, también al volver a Inicio', async ({ page }) => {
    await vigilarLaCapa(page);
    await entrar(page);
    await espiarElEjemplo(page);
    // La tarjeta visible prueba que las marcas se leyeron y que la cuenta no tiene el opt-out.
    await expect(tarjeta(page)).toBeVisible();
    await page.getByRole('button', { name: 'Más', exact: true }).click();
    await expect.poll(() => pathname(page)).toBe('/mas');
    await page.getByRole('button', { name: 'Inicio', exact: true }).click();
    await expect(tarjeta(page)).toBeVisible();
    expect(await capaVista(page)).toBe(false);
    expect(await ejemploSePrendio(page)).toBe(false);
    // Control positivo, en el mismo documento: la capa y el ejemplo.
    await abrirDesdeLaTarjeta(page);
    expect(await capaVista(page)).toBe(true);
    await expect.poll(() => ejemploSePrendio(page)).toBe(true);
  });

  test('al entrar en frío por el link de una mesa (sin sesión, y se vuelve a entrar desde el link): la guía cerrada', async ({ page }) => {
    await entrar(page);
    const mesa = await abrirMesaConLink(page, { sinGarantia: true });
    // Sin el @ (costura del mock, `payme.app.mock.username.v1`): la puerta del @ no tapa la app de la cuenta nueva.
    await page.evaluate(() => {
      localStorage.setItem('payme.app.mock.username.v1', 'false');
      localStorage.removeItem('payme_app_session__mock');
    });
    await vigilarLaCapa(page);
    await page.goto('about:blank');
    await page.goto(`/#/mesa/${mesa.code}?t=${mesa.token}`);
    await expect(page.getByText('Te invitaron a una mesa', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Ya tengo cuenta · Entrar', exact: true }).click();
    // En el mock cualquier email entra a la misma cuenta: lo que se prueba es la entrada por el link, no una cuenta nueva.
    await page.getByLabel('Email', { exact: true }).fill('invitada-d364@payme.test');
    await page.getByLabel(/^Contraseña$/).fill('sintetico-d364');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page.getByRole('heading', { name: /^(Tu mesa|¿Qué consumiste\?)$/ })).toBeVisible();
    await expect.poll(() => pathname(page)).toBe(`/mesa/${mesa.code}`);
    await espiarElEjemplo(page);
    expect(await capaVista(page)).toBe(false);

    expect(await ejemploSePrendio(page)).toBe(false);
    // Control positivo, en el mismo documento: en Inicio, tocar Tutorial la abre. Costura: la pantalla de bienvenida
    // no tiene barra, así que se llega a Inicio con history.pushState. Con el aviso de fotos pendiente la tarjeta espera
    // (enmienda 10): por eso, abajo, se lo responde.
    await page.evaluate(() => {
      history.pushState(null, '', '/home');
      window.dispatchEvent(new Event('popstate'));
    });
    await expect(page.getByRole('button', { name: 'Escanear', exact: true })).toBeVisible();
    // El `goto` del link recargó: el «Ahora no» del aviso de fotos, que vive en memoria, se perdió, y con el aviso
    // pendiente la tarjeta espera (enmienda 10). Se responde, como haría la persona.
    await posponerElAvisoDeFotos(page);
    await abrirDesdeLaTarjeta(page);
    expect(await capaVista(page)).toBe(true);
    await expect.poll(() => ejemploSePrendio(page)).toBe(true);
  });
});

test.describe('D363 · la geometría a 430 × 932 y en horizontal', () => {
  for (const tamano of [{ width: 430, height: 932 }, { width: 844, height: 390 }]) {
    test(`a ${tamano.width} × ${tamano.height} entran la burbuja de apertura (2a) y la de la cámara (2b)`, async ({ page }) => {
      await page.setViewportSize(tamano);
      await entrar(page);
      await abrirDesdeLaTarjeta(page);
      await geometria(page, 'camara');
      await hastaLaCamara(page);
      await geometria(page, 'foto');
    });
  }
});
