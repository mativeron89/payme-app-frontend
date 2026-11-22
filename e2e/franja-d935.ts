import { expect, type Page } from '@playwright/test';

export async function simularAreaSegura(page: Page) {
  const sesion = await page.context().newCDPSession(page);
  await sesion.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 47 } });
}

export async function medirFranja(page: Page, nombre: string, color: string) {
  // El color sugerido al navegador y los píxeles que la página pinta debajo de la hora.
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', new RegExp('^' + color + '$', 'i'));
  const dir = process.env.PAYME_E2E_CAPTURAS;
  const png = await page.screenshot({ path: dir && dir + '/' + nombre + '.png', animations: 'disabled' });
  const colores = await page.evaluate(async (base64) => {
    const imagen = new Image();
    imagen.src = 'data:image/png;base64,' + base64;
    await imagen.decode();
    const canvas = document.createElement('canvas');
    canvas.width = imagen.width;
    canvas.height = 47;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(imagen, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, 47);
    const encontrados = new Set<string>();
    for (let i = 0; i < data.length; i += 4) {
      encontrados.add('#' + [data[i]!, data[i + 1]!, data[i + 2]!].map(v => v.toString(16).padStart(2, '0')).join(''));
    }
    return [...encontrados];
  }, png.toString('base64'));
  expect(colores, nombre).toEqual([color]);
}
