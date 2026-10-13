import { expect, test, type Locator, type Page } from '@playwright/test';
import { ingresar, irEnLaApp } from './_app';

/**
 * AF-ELIMINAR-AMIGO-DESLIZANDO-20261012 (0.245.1) · D295. Mati: «Cambia el formato de eliminar amigos por el de desplazar
 * a la izquierda y que aparezca el botón de eliminar».
 *
 * En Amigos sale la ✕. Cada amigo va en `FilaDeslizable`, el de Mesas: deslizar a la izquierda deja ver «Eliminar» en
 * rojo (pasada la mitad queda abierta), una sola fila abierta a la vez, y «Eliminar» hace lo que hacía la ✕: la misma
 * confirmación, el mismo aviso y el mismo error. Sin gesto, «Eliminar {nombre}» está en el orden de tabulación y con el
 * foco la fila se abre.
 */

const lista = (page: Page) => page.locator('.social-list .card').filter({ has: page.locator('.friend-row') });
const fila = (page: Page, nombre: string) => page.locator('.amigo-deslizable').filter({ hasText: nombre });
const abiertas = (page: Page) => page.locator('.amigo-deslizable.deslizable--abierta');
const eliminar = (page: Page, nombre: string) => page.getByRole('button', { name: `Eliminar ${nombre}`, exact: true });
const toast = (page: Page) => page.locator('.toast');

async function aAmigos(page: Page): Promise<void> {
  await ingresar(page);
  await irEnLaApp(page, '/amigos');
  await expect(fila(page, 'Juan López')).toBeVisible();
}

/**
 * Arrastra la fila con el puntero (dx < 0: a la izquierda). Primero la centra: a 375 × 667 las de abajo quedan bajo el
 * borde o detrás de la barra, y el arrastre caería en otra cosa.
 */
async function deslizar(page: Page, f: Locator, dx: number): Promise<void> {
  await f.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const caja = (await f.boundingBox())!;
  const y = caja.y + caja.height / 2;
  const x = caja.x + caja.width - 40;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let k = 1; k <= 8; k += 1) await page.mouse.move(x + (dx * k) / 8, y);
  await page.mouse.up();
}

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (dir) await page.screenshot({ path: `${dir}/d295-${page.viewportSize()!.width}-${nombre}.png` });
}

for (const ancho of [375, 390] as const) {
  test.describe(`D295 · a ${ancho}`, () => {
    test.use({ viewport: { width: ancho, height: ancho === 375 ? 667 : 844 } });

    test('🔴 la ✕ ya no existe: ningún botón en la fila del amigo', async ({ page }) => {
      await aAmigos(page);
      const filas = page.locator('.friend-row');
      await expect(filas).toHaveCount(await page.locator('.amigo-deslizable').count());
      expect(await filas.count()).toBeGreaterThan(1);
      await expect(page.locator('.friend-row button')).toHaveCount(0);
      await expect(page.getByRole('button', { name: /^Quitar a / })).toHaveCount(0);
      expect(await lista(page).textContent()).not.toContain('✕');
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(ancho);
      await capturar(page, 'sin-cruz');
    });

    test('🔴 deslizar a la izquierda muestra «Eliminar» en rojo; poco, vuelve; tocar la fila la cierra', async ({ page }) => {
      await aAmigos(page);
      const juan = fila(page, 'Juan López');
      // Menos de la mitad del botón: vuelve.
      await deslizar(page, juan, -30);
      await expect(abiertas(page)).toHaveCount(0);
      await deslizar(page, juan, -120);
      await expect(abiertas(page)).toHaveCount(1);
      await expect(juan).toHaveClass(/deslizable--abierta/);
      const boton = eliminar(page, 'Juan López');
      await expect(boton).toBeVisible();
      await expect(boton).toHaveText('Eliminar');
      const m = await boton.evaluate((b) => {
        const r = b.getBoundingClientRect();
        const danger = getComputedStyle(document.documentElement).getPropertyValue('--danger').trim();
        return { ancho: r.width, alto: r.height, fondo: getComputedStyle(b).backgroundColor, danger, derecha: r.right, vista: window.innerWidth };
      });
      // El rojo de Mesas (`--danger`), y un blanco de toque de al menos 44 × 44.
      expect(m.danger).toBe('#b42318');
      expect(m.fondo).toBe('rgb(180, 70, 47)');
      expect(m.ancho).toBe(96);
      expect(m.alto).toBeGreaterThanOrEqual(44);
      expect(m.derecha).toBeLessThanOrEqual(m.vista);
      await capturar(page, 'deslizada');
      // Tocar la fila abierta la cierra, sin borrar.
      await juan.locator('.friend-row').click();
      await expect(abiertas(page)).toHaveCount(0);
      await expect(juan).toBeVisible();
    });

    test('🔴 una sola fila abierta a la vez', async ({ page }) => {
      await aAmigos(page);
      await deslizar(page, fila(page, 'Juan López'), -120);
      await expect(fila(page, 'Juan López')).toHaveClass(/deslizable--abierta/);
      await deslizar(page, fila(page, 'María Ruiz'), -120);
      await expect(abiertas(page)).toHaveCount(1);
      await expect(fila(page, 'María Ruiz')).toHaveClass(/deslizable--abierta/);
      await expect(fila(page, 'Juan López')).not.toHaveClass(/deslizable--abierta/);
    });

    test('🔴 tocar «Eliminar» hace lo que hacía la ✕: la misma confirmación, quita al amigo y avisa', async ({ page }) => {
      await aAmigos(page);
      await deslizar(page, fila(page, 'Juan López'), -120);
      const pregunta = page.waitForEvent('dialog');
      void eliminar(page, 'Juan López').click();
      const d = await pregunta;
      expect([d.type(), d.message()]).toEqual(['confirm', '¿Quitar a Juan López de tus amigos?']);
      await d.accept();
      await expect(toast(page)).toContainText('Amigo quitado');
      await expect(fila(page, 'Juan López')).toHaveCount(0);
      await expect(fila(page, 'María Ruiz')).toBeVisible();
      await expect(abiertas(page)).toHaveCount(0);
    });

    test('cancelar la confirmación no quita a nadie', async ({ page }) => {
      await aAmigos(page);
      await deslizar(page, fila(page, 'Juan López'), -120);
      page.once('dialog', (d) => { void d.dismiss(); });
      await eliminar(page, 'Juan López').click();
      await expect(abiertas(page)).toHaveCount(0);
      await expect(fila(page, 'Juan López')).toBeVisible();
      // Una recarga confirma que el dueño (el mock) no lo quitó.
      await irEnLaApp(page, '/mesas');
      await irEnLaApp(page, '/amigos');
      await expect(fila(page, 'Juan López')).toBeVisible();
    });

    test('si falla, el mismo error de siempre y el amigo sigue', async ({ page }) => {
      await aAmigos(page);
      await page.evaluate(async () => {
        const idx = '/src/api/index.ts';
        const m = await import(/* @vite-ignore */ idx) as { api: Record<string, (...a: unknown[]) => Promise<unknown>> };
        m.api.removeFriend = async () => { throw new Error('caido'); };
      });
      await deslizar(page, fila(page, 'Juan López'), -120);
      page.once('dialog', (d) => { void d.accept(); });
      await eliminar(page, 'Juan López').click();
      await expect(toast(page)).toContainText('No se pudo quitar de tus amigos');
      await expect(fila(page, 'Juan López')).toBeVisible();
    });

    test('🔴 sin gesto: «Eliminar {nombre}» por teclado abre la fila y elimina', async ({ page }) => {
      await aAmigos(page);
      const boton = eliminar(page, 'Juan López');
      await boton.focus();
      await expect(boton).toBeFocused();
      await expect(fila(page, 'Juan López')).toHaveClass(/deslizable--abierta/);
      await expect(boton).toBeVisible();
      page.once('dialog', (d) => { void d.accept(); });
      await page.keyboard.press('Enter');
      await expect(toast(page)).toContainText('Amigo quitado');
      await expect(fila(page, 'Juan López')).toHaveCount(0);
    });

    test('lo que no cambia: tocar la fila no hace nada, la búsqueda filtra y entre amigos queda la línea', async ({ page }) => {
      await aAmigos(page);
      const url = page.url();
      let dialogos = 0;
      page.on('dialog', (d) => { dialogos += 1; void d.dismiss(); });
      await fila(page, 'Leo Paz').locator('.friend-row').click();
      expect(page.url()).toBe(url);
      expect(dialogos).toBe(0);
      await expect(abiertas(page)).toHaveCount(0);
      // La línea entre amigos: en todos menos el último.
      const lineas = await page.locator('.amigo-deslizable').evaluateAll((xs) => xs.map((x) => getComputedStyle(x).borderBottomWidth));
      expect(lineas.slice(0, -1).every((w) => w === '1px')).toBe(true);
      expect(lineas.at(-1)).toBe('0px');
      await page.getByRole('textbox', { name: 'Buscar entre tus amigos' }).fill('maría');
      await expect(page.locator('.amigo-deslizable')).toHaveCount(1);
      await expect(fila(page, 'María Ruiz')).toBeVisible();
    });
  });
}
