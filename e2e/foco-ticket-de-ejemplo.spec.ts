import { expect, test } from '@playwright/test';
import { entrar, botonTutorial, burbuja, espiarLaFachada, llamadas, TEXTO_2A, TEXTO_2B, TEXTO_3A } from './_guia';
import { sacarFoto } from './_camara';

for (const width of [320, 390]) {
  test(`el Ticket de ejemplo recibe foco visible con teclado a ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 });
    await entrar(page);
    await espiarLaFachada(page);
    const tutorial = botonTutorial(page);
    await tutorial.press('Enter');
    await expect(burbuja(page, TEXTO_2A)).toBeVisible();
    await page.getByRole('button', { name: 'Escanear', exact: true }).press('Enter');
    await expect(burbuja(page, TEXTO_2B)).toBeVisible();
    await page.getByRole('button', { name: 'Sacar foto', exact: true }).press('Enter');
    await sacarFoto(page, undefined, { usar: false });
    const ticket = burbuja(page, TEXTO_3A);
    await expect(ticket).toBeInViewport();
    await expect(ticket).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).toBeInViewport();
    await page.keyboard.press('Escape');
    await expect(ticket).toHaveCount(0);
    await expect(tutorial).toBeFocused();
    expect((await llamadas(page)).filter(({ metodo, codigo }) =>
      ['scanTicket', 'createMesa', 'createInvitation'].includes(metodo) || (metodo === 'getMesa' && codigo === 'PA-1224'),
    )).toEqual([]);
  });
}
