import { expect, type Locator, type Page } from '@playwright/test';

/** Posterga sólo los frames programados durante el cierre para fijar el orden de foco de la carrera. */
export async function cerrarAntesDelFrame(page: Page, cerrar: Locator, hoja: Locator, otroControl: Locator) {
  await cerrar.evaluate((boton: HTMLButtonElement) => {
    const original = window.requestAnimationFrame;
    const pendientes: FrameRequestCallback[] = [];
    window.requestAnimationFrame = (callback) => pendientes.push(callback);
    try {
      boton.click();
    } finally {
      window.requestAnimationFrame = original;
    }
    document.addEventListener('prueba-ejecutar-frame-de-cierre', () => {
      for (const callback of pendientes) callback(performance.now());
    }, { once: true });
  });
  await expect(hoja).toHaveCount(0);
  await otroControl.focus();
  await expect(otroControl).toBeFocused();
  await page.evaluate(() => document.dispatchEvent(new Event('prueba-ejecutar-frame-de-cierre')));
  await expect(otroControl).toBeFocused();
}
