import { expect, type Locator, type Page } from '@playwright/test';

/** Comprueba el ancho disponible y el área de toque en las seis combinaciones de la orden. */
export async function medirTextoAmpliado(page: Page, elemento: Locator, boton: boolean): Promise<void> {
  const original = await elemento.evaluate(el => ({
    estilo: el.getAttribute('style'),
    fuente: parseFloat(getComputedStyle(el).fontSize),
  }));
  for (const ancho of [320, 375, 390]) {
    await page.setViewportSize({ width: ancho, height: 844 });
    for (const escala of [1.5, 2]) {
      const caja = await elemento.evaluate((el, fuente) => {
        const control = el as HTMLElement;
        control.style.fontSize = fuente + 'px';
        control.style.lineHeight = '1.4';
        const rect = control.getBoundingClientRect();
        return { x: rect.x, derecha: rect.right, alto: rect.height, exceso: control.scrollWidth - control.clientWidth };
      }, original.fuente * escala);
      expect(caja.x).toBeGreaterThanOrEqual(0);
      expect(caja.derecha).toBeLessThanOrEqual(ancho + 1);
      expect(caja.exceso).toBeLessThanOrEqual(1);
      if (boton) expect(caja.alto).toBeGreaterThanOrEqual(44);
    }
  }
  await elemento.evaluate((el, estilo) => {
    if (estilo === null) el.removeAttribute('style');
    else el.setAttribute('style', estilo);
  }, original.estilo);
}
