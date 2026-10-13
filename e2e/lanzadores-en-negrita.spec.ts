import { expect, test, type Page } from '@playwright/test';
import { ingresar, irEnLaApp, relojFueraDeLasFechasDeLosViajes } from './_app';

/**
 * 0.245.2 · D299. Mati, con una captura de Inicio › Cuenta: «Poner en negrita ver pagos y configuracion». El del
 * engranaje dice «Ver perfil». Los dos son la tarjeta de botones de `Launcher` (`.launch-label`), la misma de
 * Estadísticas, Viajes y Amigos: van en negrita con el peso de las pestañas del encabezado (D283), sin cambiar íconos,
 * tamaños, textos ni acciones.
 */

/** El peso, el tamaño y el texto de cada `.launch-label` a la vista, y el peso de la pestaña activa (D283). */
async function lanzadores(page: Page) {
  return page.evaluate(() => {
    const visibles = [...document.querySelectorAll<HTMLElement>('.launch-label')].filter((x) => x.getBoundingClientRect().width > 0);
    const pestana = document.querySelector('.btab.on');
    return {
      pestana: pestana ? getComputedStyle(pestana).fontWeight : null,
      etiquetas: visibles.map((x) => {
        const cs = getComputedStyle(x);
        const boton = x.closest('button')!.getBoundingClientRect();
        const icono = x.closest('button')!.querySelector('.launch-ico svg')!.getBoundingClientRect();
        return { texto: x.textContent, peso: cs.fontWeight, tamano: cs.fontSize, alto: boton.height, icono: [icono.width, icono.height] };
      }),
      doc: document.documentElement.scrollWidth,
    };
  });
}

function enNegrita(m: Awaited<ReturnType<typeof lanzadores>>, textos: string[], ancho: number): void {
  expect(m.etiquetas.map((e) => e.texto)).toEqual(textos);
  // El peso de las pestañas del encabezado (D283).
  expect(m.pestana).toBe('700');
  for (const e of m.etiquetas) {
    expect(e.peso, e.texto!).toBe('700');
    // Lo que no cambia: el tamaño del texto (14), el alto del botón (al menos 84) y el ícono de 22.
    expect(e.tamano, e.texto!).toBe('14px');
    expect(e.alto, e.texto!).toBeGreaterThanOrEqual(84);
    expect(e.icono, e.texto!).toEqual([22, 22]);
  }
  expect(m.doc).toBeLessThanOrEqual(ancho);
}

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (dir) await page.screenshot({ path: `${dir}/d299-${page.viewportSize()!.width}-${nombre}.png` });
}

for (const ancho of [375, 390] as const) {
  test.describe(`D299 · a ${ancho}`, () => {
    test.use({ viewport: { width: ancho, height: ancho === 375 ? 667 : 844 } });

    test('🔴 Inicio › Cuenta, con los pagos apagados (como hoy): «Ver pagos» y «Ver perfil» en negrita; las acciones, iguales', async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled'));
      await ingresar(page);
      await expect(page.getByRole('button', { name: 'Ver pagos', exact: true })).toBeVisible();
      enNegrita(await lanzadores(page), ['Ver pagos', 'Ver perfil'], ancho);
      await capturar(page, 'cuenta');
      await page.getByRole('button', { name: 'Ver pagos', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Mesas', exact: true, level: 1 })).toBeVisible();
      await irEnLaApp(page, '/home');
      await page.getByRole('button', { name: 'Ver perfil', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Configuración', exact: true })).toBeVisible();
    });

    test('con «Ver tarjetas» a la vista (el mock de siempre), las tres en negrita', async ({ page }) => {
      await ingresar(page);
      // «Ver tarjetas» llega con la config: se espera a que esté, para medir las tres.
      await expect(page.getByRole('button', { name: 'Ver tarjetas', exact: true })).toBeVisible();
      enNegrita(await lanzadores(page), ['Ver tarjetas', 'Ver pagos', 'Ver perfil'], ancho);
    });

    test('la misma tarjeta en Inicio › Estadísticas: «Ver mis estadísticas» en negrita', async ({ page }) => {
      await ingresar(page);
      await page.getByRole('tab', { name: 'Estadísticas', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Ver mis estadísticas', exact: true })).toBeVisible();
      enNegrita(await lanzadores(page), ['Ver mis estadísticas'], ancho);
    });

    test('Inicio › Viajes ya lo estaba (D255): sigue en negrita', async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem('payme.app.mock.viajes.v1', 'encendido'));
      await relojFueraDeLasFechasDeLosViajes(page);
      await ingresar(page);
      await page.getByRole('tab', { name: 'Viajes', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Crear viaje', exact: true })).toBeVisible();
      // D302 · con «Próximos» entre los dos.
      enNegrita(await lanzadores(page), ['Crear viaje', 'Próximos', 'Cerrados'], ancho);
    });

    test('la misma tarjeta en Amigos: «Nuevo amigo» y, en Grupos, «Nuevo grupo»', async ({ page }) => {
      await ingresar(page);
      await irEnLaApp(page, '/amigos');
      await expect(page.getByRole('button', { name: 'Nuevo amigo', exact: true })).toBeVisible();
      enNegrita(await lanzadores(page), ['Nuevo amigo'], ancho);
      await page.getByRole('tab', { name: 'Grupos', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Nuevo grupo', exact: true })).toBeVisible();
      enNegrita(await lanzadores(page), ['Nuevo grupo'], ancho);
    });
  });
}
