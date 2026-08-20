/**
 * Splash de carga en navegador real — las dos ramas de «B sólo cuando tarda».
 *
 * La lógica de tiempos ya está cubierta pura en `src/splash.test.ts`; acá se
 * prueba lo que sin navegador no se puede: que el elemento de verdad
 * aparece cuando la carga tarda, y de verdad sale del árbol cuando no.
 *
 * La carga lenta se FUERZA demorando la respuesta del módulo de entrada
 * (`main.tsx`) por ruta interceptada: es la única manera de que localhost
 * tarde — servido desde la misma máquina, el caso lento no ocurre solo.
 */
import { test, expect } from '@playwright/test';
import { ingresar } from './_app';

test('carga rápida: la app abre directo y el splash no queda en el árbol', async ({ page }) => {
  await ingresar(page);
  // No alcanza con "no visible": el retiro lo SACA del DOM. Un splash
  // invisible pero presente sería un fixed z-index 9999 esperando volver.
  await expect(page.locator('#splash')).toHaveCount(0);
});

test('carga lenta: el splash asoma mientras tarda y se retira al montar', async ({ page }) => {
  await page.route('**/src/main.tsx', async (ruta) => {
    // Bien pasado el retardo de aparición (300ms), lejos del timeout global.
    await new Promise((listo) => setTimeout(listo, 1_200));
    await ruta.continue();
  });

  await page.goto('/');

  // Mientras el módulo no llegó, lo único pintado es el splash: navy con el
  // lockup adentro. `toBeVisible` acá afirma que ASOMÓ, que es la rama que
  // la carga rápida no puede probar.
  await expect(page.locator('#splash svg')).toBeVisible();

  // Llegó el módulo → monta la app → el splash cumple su mínimo y se va.
  await expect(page.getByPlaceholder('Email')).toBeVisible();
  await expect(page.locator('#splash')).toHaveCount(0);
});
