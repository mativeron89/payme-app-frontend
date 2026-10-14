import { expect, test, type Page } from '@playwright/test';
import { ingresar, irEnLaApp, relojFueraDeLasFechasDeLosViajes } from './_app';

/**
 * 0.245.1 · D297. Mati, con las capturas del viaje Holbox y de su burbuja en Inicio: «en el viaje, cambia la burbuja de
 * configuración y ponele el ícono de configuración a la burbuja con el formato que está en la segunda imagen como
 * + gasto, la línea de separación y el símbolo de configuración». Eligió «Sólo el engranaje (Recomendada)».
 *
 * Con el viaje abierto, la tarjeta de título suma a la derecha el cuadrado con el engranaje, separado por una línea
 * vertical, como «+ Gasto» en la burbuja de Inicio (D291). Tocarlo abre la Configuración. La fila «Configuración» sale.
 * Esperando pagos no había fila: tampoco hay engranaje.
 */
const CANCUN = 'd1000000-0000-4000-8000-000000000001';
const MONTERREY = 'd1000000-0000-4000-8000-000000000002';
const ESTADO = 'payme.app.mock.viajes.estado.v1';

async function conViajes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('payme.app.mock.viajes.v1', 'encendido');
    localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled');
  });
  await relojFueraDeLasFechasDeLosViajes(page);
  await ingresar(page);
}

async function alViaje(page: Page, id: string, nombre: string): Promise<void> {
  await irEnLaApp(page, `/viaje/${id}`);
  await expect(page.getByRole('heading', { name: nombre, level: 1 })).toBeVisible();
}

const engranaje = (page: Page) => page.getByRole('button', { name: 'Configuración del viaje', exact: true });

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (dir) await page.screenshot({ path: `${dir}/d297-${page.viewportSize()!.width}-${nombre}.png` });
}

/** La tarjeta, el divisor y el cuadrado, medidos. */
async function medir(page: Page) {
  return page.locator('.title-card').evaluate((card) => {
    const r = (el: Element) => el.getBoundingClientRect();
    const cs = getComputedStyle(card);
    const div = card.querySelector('.vjv-titulo-divisor')!;
    const btn = card.querySelector('.vjv-titulo-engranaje')!;
    const titulo = card.querySelector('.title-card-title')!;
    const cuadro = card.querySelector('.title-card-cuadro')!;
    return {
      card: r(card).toJSON() as DOMRect, padding: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft], minAlto: cs.minHeight,
      divisor: { ...(r(div).toJSON() as DOMRect), color: getComputedStyle(div).backgroundColor },
      boton: r(btn).toJSON() as DOMRect, texto: btn.textContent, svg: btn.querySelectorAll('svg').length,
      titulo: r(titulo).toJSON() as DOMRect, cuadroX: r(cuadro).left, doc: document.documentElement.scrollWidth,
    };
  });
}

for (const ancho of [375, 390] as const) {
  test.describe(`D297 · a ${ancho}`, () => {
    test.use({ viewport: { width: ancho, height: ancho === 375 ? 667 : 844 } });

    test('🔴 abierto: el engranaje a la derecha de la tarjeta, con la línea, a todo el alto, como «+ Gasto»', async ({ page }) => {
      await conViajes(page);
      await alViaje(page, CANCUN, 'Cancún 2026');
      await expect(engranaje(page)).toBeVisible();
      const m = await medir(page);
      // La caja de la tarjeta (D285) no cambia: padding 16/18, alto mínimo 83 y el cuadro del viaje a 19 del borde.
      expect(m.padding).toEqual(['16px', '18px', '16px', '18px']);
      expect(m.minAlto).toBe('83px');
      expect(m.cuadroX - m.card.left).toBeCloseTo(19, 0);
      // El cuadrado: 76 de ancho, a todo el alto por dentro del borde de 1 px, pegado a la derecha; sólo el ícono.
      expect(m.boton.width).toBe(76);
      expect(m.boton.top).toBeCloseTo(m.card.top + 1, 0);
      expect(m.boton.bottom).toBeCloseTo(m.card.bottom - 1, 0);
      expect(m.boton.right).toBeCloseTo(m.card.right - 1, 0);
      expect(m.boton.height).toBeGreaterThanOrEqual(44);
      expect([m.texto, m.svg]).toEqual(['', 1]);
      // La línea: 1 px en --border (#E2E8F0), a todo el alto, pegada al cuadrado.
      expect(m.divisor.width).toBe(1);
      expect(m.divisor.color).toBe('rgb(227, 233, 240)');
      expect(m.divisor.top).toBeCloseTo(m.boton.top, 0);
      expect(m.divisor.bottom).toBeCloseTo(m.boton.bottom, 0);
      expect(m.divisor.right).toBeCloseTo(m.boton.left, 0);
      expect(m.titulo.right).toBeLessThanOrEqual(m.divisor.left);
      expect(m.doc).toBeLessThanOrEqual(ancho);
      await capturar(page, 'engranaje');
    });

    test('🔴 tocarlo abre la Configuración del viaje; la fila «Configuración» ya no está', async ({ page }) => {
      await conViajes(page);
      await alViaje(page, CANCUN, 'Cancún 2026');
      await expect(page.locator('.vjv-configuracion')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Configuración', exact: true })).toHaveCount(0);
      await engranaje(page).click();
      await expect(page.getByRole('heading', { name: 'Configuración', level: 1 })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Cerrar viaje', exact: true })).toBeVisible();
    });

    test('por teclado: el engranaje se alcanza y abre la Configuración', async ({ page }) => {
      await conViajes(page);
      await alViaje(page, CANCUN, 'Cancún 2026');
      await engranaje(page).focus();
      await expect(engranaje(page)).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('heading', { name: 'Configuración', level: 1 })).toBeVisible();
    });

    test('esperando pagos no había fila: tampoco hay engranaje', async ({ page }) => {
      await conViajes(page);
      await alViaje(page, MONTERREY, 'Monterrey fin de semana');
      await expect(page.locator('.vjv-titulo-engranaje')).toHaveCount(0);
      await expect(page.locator('.vjv-titulo-divisor')).toHaveCount(0);
      await expect(engranaje(page)).toHaveCount(0);
    });

    test('con un nombre largo, el título no se mete debajo del engranaje', async ({ page }) => {
      await conViajes(page);
      await page.goto('/privacy');
      await expect(page.getByRole('heading', { name: 'Aviso de privacidad' })).toBeVisible();
      await page.evaluate(({ k, id }) => {
        const e = JSON.parse(localStorage.getItem(k)!);
        e.viajes.find((v: { id: string }) => v.id === id).nombre = 'Fin de año en la playa con toda la familia';
        localStorage.setItem(k, JSON.stringify(e));
      }, { k: ESTADO, id: CANCUN });
      await page.goto('/home');
      await expect(page.getByRole('button', { name: 'Escanear', exact: true })).toBeVisible();
      await alViaje(page, CANCUN, 'Fin de año en la playa con toda la familia');
      const m = await medir(page);
      expect(m.titulo.right).toBeLessThanOrEqual(m.divisor.left);
      expect(m.boton.width).toBe(76);
      expect(m.doc).toBeLessThanOrEqual(ancho);
      await capturar(page, 'nombre-largo');
    });
  });
}
