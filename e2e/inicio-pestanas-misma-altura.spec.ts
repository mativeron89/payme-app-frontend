import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ingresar } from './_app';

/**
 * AF-BURBUJA-STATS-CLAUDE-20260925 · pedido de Mati: «que la burbuja de estadísticas tenga el mismo tamaño que la
 * de Cuenta y Asociadas». Antes, «Estadísticas» medía 148 px a 360 y 390 (124 a 430) contra 116 de las otras dos, y
 * el contenido de abajo saltaba al cambiar de pestaña. Se mide la tarjeta montada, que es lo que se ve, y la
 * posición de lo que sigue.
 */
const CAPTURAS = process.env.AF_CAPTURES_DIR;
const PESTANAS = ['Cuenta', 'Estadísticas', 'Asociadas'] as const;

async function medir(page: Page): Promise<{ tarjeta: number; siguiente: number }> {
  return page.evaluate(() => {
    const tarjeta = document.querySelector('.mounted-card');
    const siguiente = tarjeta?.nextElementSibling;
    if (!tarjeta || !siguiente) throw new Error('falta la tarjeta montada o lo que sigue');
    return { tarjeta: tarjeta.getBoundingClientRect().height, siguiente: siguiente.getBoundingClientRect().top };
  });
}

for (const ancho of [360, 390, 430]) {
  test(`🔴 a ${ancho} px las tres pestañas de Inicio miden lo mismo y lo de abajo no se mueve`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: 844 });
    await ingresar(page);
    const medidas: Record<string, { tarjeta: number; siguiente: number }> = {};
    for (const pestana of PESTANAS) {
      await page.getByRole('tab', { name: pestana, exact: true }).click();
      await expect(page.getByRole('tab', { name: pestana, exact: true })).toHaveAttribute('aria-selected', 'true');
      medidas[pestana] = await medir(page);
      if (CAPTURAS && ancho === 390) {
        mkdirSync(CAPTURAS, { recursive: true });
        await page.screenshot({ path: join(CAPTURAS, `inicio-${pestana.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '')}-390.png`) });
      }
    }
    const cuenta = medidas.Cuenta;
    for (const pestana of PESTANAS) {
      expect(Math.abs(medidas[pestana].tarjeta - cuenta.tarjeta), `${pestana} mide ${medidas[pestana].tarjeta} y Cuenta ${cuenta.tarjeta}`).toBeLessThanOrEqual(0.5);
      expect(Math.abs(medidas[pestana].siguiente - cuenta.siguiente), `lo de abajo salta con ${pestana}`).toBeLessThanOrEqual(0.5);
    }
  });
}

test('«Estadísticas» tiene la composición de «Cuenta»: ícono y acción, sin la línea de invitación', async ({ page }) => {
  await ingresar(page);
  await page.getByRole('tab', { name: 'Estadísticas', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Ver mis estadísticas', exact: true })).toBeVisible();
  await expect(page.getByText('¿Quieres ver qué consumes, cuánto y dónde?')).toHaveCount(0);
});
