import { expect, test, type Locator, type Page } from '@playwright/test';
import { ingresar } from './_app';

/**
 * D195 · decisión 195 de Mati, sobre la captura 19 (Amigos con el teclado
 * abierto): «La burbuja donde escribo, se le genera un borde celeste que no
 * completa toda la burbuja, quitar el borce celeste».
 *
 * El borde era el `outline` teal de `.social-search:focus-within`: un
 * rectángulo dentro de una `.card` redondeada, curvo arriba y recto abajo. Lo
 * comparten tres buscadores (Amigos, Grupos e Invitar a la mesa). Enfocado, el
 * buscador se ve igual que sin foco: el cursor es lo que cambia. Los campos de
 * formulario y el buscador por @ (otro estilo) conservan su foco.
 */

/** El teal de foco (`--action-2`, #0fb5c9). */
const TEAL = 'rgb(15, 181, 201)';

/** Lo que dibuja un borde: outline, borde y sombra, del campo y de su burbuja. */
async function bordes(campo: Locator): Promise<Record<string, string>> {
  return campo.evaluate((input) => {
    const caja = input.closest('.social-search') ?? input;
    const fuera: Record<string, string> = {};
    for (const [nombre, el] of [['campo', input], ['burbuja', caja]] as const) {
      const s = getComputedStyle(el);
      for (const p of ['outline-style', 'outline-width', 'outline-color', 'border-top-color', 'border-right-color',
        'border-bottom-color', 'border-left-color', 'border-top-width', 'border-bottom-width', 'box-shadow']) {
        fuera[`${nombre} ${p}`] = s.getPropertyValue(p);
      }
    }
    return fuera;
  });
}

/** Sin foco y con foco, el buscador se ve igual, y el teal no aparece en ningún borde. */
async function sinBordeDeFoco(page: Page, campo: Locator): Promise<void> {
  await expect(campo).toBeVisible();
  const antes = await bordes(campo);
  await campo.focus();
  // Control positivo: el foco está en el campo (y el navegador lo considera enfocado).
  await expect(campo).toBeFocused();
  expect(await campo.evaluate((el) => el.closest('.social-search')?.matches(':focus-within') ?? false)).toBe(true);
  const despues = await bordes(campo);
  expect(despues).toEqual(antes);
  for (const [propiedad, valor] of Object.entries(despues)) {
    if (/outline-style/.test(propiedad)) continue;
    expect(`${propiedad}: ${valor}`).not.toContain(TEAL);
  }
  await page.keyboard.type('a');
  await expect(campo).toHaveValue('a');
}

test.describe('D195 · los buscadores de la burbuja, sin borde de foco', () => {
  test('Amigos: «Buscar entre tus amigos»', async ({ page }) => {
    await ingresar(page);
    await page.getByRole('button', { name: 'Amigos', exact: true }).click();
    const campo = page.getByRole('textbox', { name: 'Buscar entre tus amigos', exact: true });
    await sinBordeDeFoco(page, campo);
    const dir = process.env.PAYME_E2E_CAPTURAS;
    if (dir) await page.screenshot({ path: `${dir}/${page.viewportSize()!.width}-amigos-buscador-enfocado.png` });
  });

  test('Grupos: «Buscar entre tus grupos»', async ({ page }) => {
    await ingresar(page);
    await page.getByRole('button', { name: 'Amigos', exact: true }).click();
    await page.getByRole('tab', { name: 'Grupos', exact: true }).click();
    await sinBordeDeFoco(page, page.getByRole('textbox', { name: 'Buscar entre tus grupos', exact: true }));
  });

  test('Invitar a la mesa: «Buscar contactos para invitar»', async ({ page }) => {
    await ingresar(page);
    await page.goto('/#/mesa/PA-2847');
    await page.getByRole('button', { name: 'Invitar amigos de PayMe' }).click();
    await sinBordeDeFoco(page, page.getByRole('textbox', { name: 'Buscar contactos para invitar', exact: true }));
  });

  test('control · los campos del ingreso conservan su foco (formularios, no se tocan)', async ({ page }) => {
    await page.goto('/');
    const email = page.getByLabel('Email', { exact: true });
    await expect(email).toBeVisible();
    const antes = await email.evaluate((el) => getComputedStyle(el).boxShadow + ' · ' + getComputedStyle(el).borderTopColor);
    await email.focus();
    await expect(email).toBeFocused();
    await expect.poll(() => email.evaluate((el) => getComputedStyle(el).boxShadow + ' · ' + getComputedStyle(el).borderTopColor))
      .not.toBe(antes);
  });
});
