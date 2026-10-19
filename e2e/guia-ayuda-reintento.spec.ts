import { expect, test, type Page } from '@playwright/test';
import { entrar, tarjeta } from './_guia';

/**
 * D364 · revisión de V sobre ff5dec7 (a2b729e4…), punto 3 · si la lista de viajes falla, las dos entradas a la guía
 * (la tarjeta Tutorial y Más → Ayuda) no quedan muertas: la fila espera con su línea y, al volver a la ventana o a la
 * pestaña, se vuelve a pedir lo que faltó. Contra el mock, con Viajes encendido y el reloj fuera de las fechas.
 */

interface Ventana { __fallarViajes: boolean; __pedidosDeViajes: number }
const pedidos = (page: Page) => page.evaluate(() => (window as unknown as Ventana).__pedidosDeViajes);

/** `api.getViajes` falla mientras `__fallarViajes` (el mismo objeto que usa la app: Vite sirve una instancia por URL). */
async function viajesQueFallan(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const ruta = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ ruta) as { api: Record<string, (...a: unknown[]) => Promise<unknown>> };
    const w = window as unknown as Ventana;
    w.__fallarViajes = true;
    w.__pedidosDeViajes = 0;
    const original = api.getViajes!;
    api.getViajes = (...args: unknown[]) => {
      w.__pedidosDeViajes += 1;
      return w.__fallarViajes ? Promise.reject(new Error('red caída')) : original(...args);
    };
  });
}

const NOTA = 'Disponible cuando sepamos si hoy estás de viaje';

for (const regreso of ['focus', 'visibilitychange'] as const) {
  test(`con la lista de viajes caída, Ayuda espera con su línea; al volver (${regreso}) se vuelve a pedir y se habilita, y la tarjeta Tutorial vuelve`, async ({ page }) => {
    await entrar(page, { antesDeEntrar: viajesQueFallan });
    await expect.poll(() => pedidos(page)).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Más', exact: true }).click();
    const fila = page.getByRole('button', { name: 'Cómo usar PayMe' });
    await expect(fila).toBeDisabled();
    await expect(page.getByText(NOTA, { exact: true })).toBeVisible();
    const antes = await pedidos(page);

    // La red vuelve, pero nada se pide hasta el regreso (control: la fila sigue esperando y el contador no se mueve).
    await page.evaluate(() => { (window as unknown as Ventana).__fallarViajes = false; });
    await expect(fila).toBeDisabled();
    expect(await pedidos(page)).toBe(antes);

    await page.evaluate((r) => {
      if (r === 'focus') window.dispatchEvent(new Event('focus'));
      else document.dispatchEvent(new Event('visibilitychange'));
    }, regreso);
    await expect(fila).toBeEnabled();
    expect(await pedidos(page)).toBeGreaterThan(antes);
    await expect(page.getByText(NOTA, { exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'Inicio', exact: true }).click();
    await expect(tarjeta(page)).toBeVisible();
  });
}
