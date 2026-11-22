import { expect, test } from '@playwright/test';
import { ingresar, irEnLaApp, relojFueraDeLasFechasDeLosViajes } from './_app';
import { hastaCompartir } from './fixtures/mi-parte-d344';
import { medirFranja, simularAreaSegura } from './franja-d935';

test.beforeEach(async ({ page }) => {
  await simularAreaSegura(page);
  await relojFueraDeLasFechasDeLosViajes(page);
});

test('la franja acompaña Inicio, Escanear, Viajes y Más al navegar', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('payme.app.mock.viajes.v1', 'encendido'));
  await ingresar(page);
  await medirFranja(page, 'inicio', '#101e3b');
  await page.getByRole('button', { name: 'Escanear', exact: true }).click();
  await expect(page.locator('.camara')).toBeVisible();
  await medirFranja(page, 'escanear', '#000000');
  for (const ruta of ['viajes', 'mas']) {
    await irEnLaApp(page, '/' + ruta);
    await expect(page.getByRole('heading', { name: ruta === 'mas' ? 'Configuración' : 'Viajes abiertos', exact: true })).toBeVisible();
    await medirFranja(page, ruta, '#101e3b');
  }
  await page.evaluate(async () => {
    const ruta = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ ruta) as typeof import('../src/api/index');
    api.getMesa = async () => { throw new Error('Mesa de prueba sin conexión'); };
  });
  await irEnLaApp(page, '/mesa/PA-2847');
  await expect(page.getByRole('button', { name: 'Reintentar', exact: true })).toBeVisible();
  await medirFranja(page, 'mesa-error', '#ffffff');
});

test('la franja de Mesa y del desglose Mi parte', async ({ page }) => {
  await hastaCompartir(page, { ocr: 'descuento', modo: 'igual' });
  await page.getByRole('button', { name: /^(Listo|Continuar)$/ }).click();
  await expect(page.getByRole('heading', { name: 'Tu mesa', exact: true })).toBeVisible();
  await medirFranja(page, 'mesa', '#101e3b');
  const parte = page.getByRole('region', { name: 'Tu parte', exact: true });
  await parte.locator('.desplegable-cabecera').click();
  await expect(parte.locator('.mi-parte-desglose-fila').first()).toBeVisible();
  await medirFranja(page, 'mi-parte', '#101e3b');
});
