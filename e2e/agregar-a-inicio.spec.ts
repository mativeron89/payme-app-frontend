import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';

/**
 * AF-E173-4-E176 · decisión 176 de Mati · la guía «Agregar a inicio».
 *
 * - **Safari de iPhone/iPad:** al entrar, Inicio muestra la guía una vez
 *   (Compartir → «Agregar a inicio»). Se cierra con «Entendido», ✕, Escape o
 *   tocando afuera, y no vuelve. En Configuración queda la fila para abrirla
 *   cuando se quiera.
 * - **Chrome de Android:** sin guía. Si Chrome avisó que se puede instalar
 *   (`beforeinstallprompt`), la fila de Configuración abre su diálogo.
 * - **Ya agregada, o cualquier otro navegador:** nada.
 *
 * El runner es Chromium: el navegador se simula con el `userAgent`, que es lo
 * que la app lee. El `beforeinstallprompt` se despacha a mano con `prompt()` y
 * `userChoice` de prueba.
 */

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD_SAFARI =
  'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

const CLAVE_VISTO = 'payme.app.agregar_a_inicio.v1';

const guia = (page: Page) => page.getByRole('dialog', { name: 'Agrega PayMe a tu inicio' });
const entendido = (page: Page) => guia(page).getByRole('button', { name: 'Entendido', exact: true });
const fila = (page: Page) => page.getByRole('button', { name: 'Agregar a inicio', exact: true });
/** Testigo de que Configuración ya cargó: su fila de idioma. */
const idioma = (page: Page) => page.getByText('Idioma', { exact: true });

async function inicioListo(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Nueva', exact: true })).toBeVisible();
}

async function configuracion(page: Page): Promise<void> {
  await page.goto('/#/mas');
  await expect(idioma(page)).toBeVisible();
}

async function marcarVisto(page: Page): Promise<void> {
  await page.addInitScript((clave) => localStorage.setItem(clave, '1'), CLAVE_VISTO);
}

async function captura(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/${nombre}.png` });
}

test.describe('en Safari de iPhone', () => {
  test.use({ userAgent: IPHONE_SAFARI });

  test('al entrar, Inicio muestra la guía; «Entendido» la cierra y no vuelve', async ({ page }) => {
    await ingresar(page);
    await expect(guia(page)).toBeVisible();
    await expect(guia(page).getByText('Abre PayMe desde tu pantalla de inicio, como una app.')).toBeVisible();
    await expect(guia(page).getByRole('listitem')).toHaveText(['1Toca Compartir', '2Elige «Agregar a inicio»']);
    await expect(entendido(page)).toBeFocused();
    // El naranja, sólo en la acción (--orange #ff6b35).
    await expect(entendido(page)).toHaveCSS('background-color', 'rgb(255, 107, 53)');
    // En el iPhone, Compartir está en la barra de abajo de Safari.
    await expect(guia(page).locator('.guia-inicio-flecha.abajo')).toBeVisible();
    await expect(page.locator('.guia-inicio-flecha.arriba')).toHaveCount(0);
    await captura(page, 'guia-390-iphone');

    await entendido(page).click();
    await expect(guia(page)).toHaveCount(0);
    expect(await page.evaluate((clave) => localStorage.getItem(clave), CLAVE_VISTO)).toBe('1');

    await page.reload();
    await inicioListo(page);
    await expect(guia(page)).toHaveCount(0);
  });

  test('Escape la cierra y queda vista', async ({ page }) => {
    await ingresar(page);
    await expect(entendido(page)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(guia(page)).toHaveCount(0);
    await page.reload();
    await inicioListo(page);
    await expect(guia(page)).toHaveCount(0);
  });

  test('✕ la cierra', async ({ page }) => {
    await ingresar(page);
    await guia(page).getByRole('button', { name: 'Cerrar', exact: true }).click();
    await expect(guia(page)).toHaveCount(0);
  });

  test('tocar afuera la cierra; tocar adentro no', async ({ page }) => {
    await ingresar(page);
    await guia(page).getByText('Toca Compartir').click();
    await expect(guia(page)).toBeVisible();
    await page.mouse.click(195, 40);
    await expect(guia(page)).toHaveCount(0);
  });

  test('desde Configuración: la fila abre la guía y, al cerrarla, el foco vuelve a la fila', async ({ page }) => {
    await marcarVisto(page);
    await ingresar(page);
    await expect(guia(page)).toHaveCount(0);
    await configuracion(page);
    await fila(page).click();
    await expect(guia(page)).toBeVisible();
    await expect(entendido(page)).toBeFocused();
    await entendido(page).click();
    await expect(guia(page)).toHaveCount(0);
    await expect(fila(page)).toBeFocused();
  });

  test('ya agregada a inicio (standalone): ni guía ni fila', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'standalone', { configurable: true, get: () => true });
    });
    await ingresar(page);
    await expect(guia(page)).toHaveCount(0);
    await configuracion(page);
    await expect(fila(page)).toHaveCount(0);
  });

  test('con el almacenamiento bloqueado se muestra una vez por sesión', async ({ page }) => {
    await page.addInitScript((clave) => {
      const leer = Storage.prototype.getItem;
      const escribir = Storage.prototype.setItem;
      Storage.prototype.getItem = function (k: string) {
        if (k === clave) throw new DOMException('bloqueado', 'SecurityError');
        return leer.call(this, k);
      };
      Storage.prototype.setItem = function (k: string, v: string) {
        if (k === clave) throw new DOMException('bloqueado', 'QuotaExceededError');
        escribir.call(this, k, v);
      };
    }, CLAVE_VISTO);
    await ingresar(page);
    await entendido(page).click();
    await expect(guia(page)).toHaveCount(0);

    // Misma sesión: Configuración y de vuelta a Inicio, sin recargar.
    await page.getByRole('button', { name: 'Más', exact: true }).click();
    await expect(idioma(page)).toBeVisible();
    await page.getByRole('button', { name: 'Inicio', exact: true }).click();
    await inicioListo(page);
    await expect(guia(page)).toHaveCount(0);

    // Al recargar no hay dónde recordarlo: vuelve a salir.
    await page.reload();
    await expect(guia(page)).toBeVisible();
  });

  test('sin sesión no hay guía', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
    await expect(guia(page)).toHaveCount(0);
  });
});

test.describe('en Safari de iPad', () => {
  test.use({ userAgent: IPAD_SAFARI });

  test('la flecha apunta arriba, donde está Compartir', async ({ page }) => {
    await ingresar(page);
    await expect(guia(page)).toBeVisible();
    await expect(page.locator('.guia-inicio-flecha.arriba')).toBeVisible();
    await expect(guia(page).locator('.guia-inicio-flecha.abajo')).toHaveCount(0);
  });
});

test.describe('en Chrome de Android', () => {
  test.use({ userAgent: ANDROID_CHROME });

  test('sin guía; la fila aparece cuando Chrome avisa que se puede instalar y abre su diálogo', async ({ page }) => {
    await marcarSinPrompts(page);
    await ingresar(page);
    await expect(guia(page)).toHaveCount(0);
    await configuracion(page);
    await expect(fila(page)).toHaveCount(0);

    const prevenido = await page.evaluate(() => {
      const evento = new Event('beforeinstallprompt', { cancelable: true });
      Object.assign(evento, {
        prompt: () => {
          (window as unknown as { __prompts: number }).__prompts += 1;
          return Promise.resolve();
        },
        userChoice: Promise.resolve({ outcome: 'dismissed' }),
      });
      window.dispatchEvent(evento);
      return evento.defaultPrevented;
    });
    expect(prevenido).toBe(true);

    await fila(page).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __prompts: number }).__prompts)).toBe(1);
    await expect(guia(page)).toHaveCount(0);
    // El aviso de Chrome sirve una vez: la fila se va.
    await expect(fila(page)).toHaveCount(0);
  });
});

async function marcarSinPrompts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __prompts: number }).__prompts = 0;
  });
}

test('en la computadora (Chrome sin aviso de instalación): ni guía ni fila', async ({ page }) => {
  await ingresar(page);
  await inicioListo(page);
  await expect(guia(page)).toHaveCount(0);
  await configuracion(page);
  await expect(fila(page)).toHaveCount(0);
});

// Corren siempre (la guarda del corte no admite skips permanentes); la captura
// sólo se guarda con PAYME_E2E_CAPTURAS.
test.describe('capturas para Mati', () => {
  test.use({ userAgent: IPHONE_SAFARI });

  test('la guía a 320 px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await ingresar(page);
    await expect(guia(page)).toBeVisible();
    await captura(page, 'guia-320-iphone');
  });

  test('la fila en Configuración a 390 px', async ({ page }) => {
    await marcarVisto(page);
    await ingresar(page);
    await configuracion(page);
    await fila(page).scrollIntoViewIfNeeded();
    await expect(fila(page)).toBeVisible();
    await captura(page, 'configuracion-fila-390');
  });
});
