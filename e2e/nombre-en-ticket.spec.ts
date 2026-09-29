import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';
import { completarDivision, configurarTicketSinQr, estadoN179 } from './fixtures/ticket-sin-qr';

/**
 * AF-NOMBRE-EN-TICKET · pedido 127 de Mati: «Vamos a sacar la burbuja de nombre
 * del restaurante para que en la pantalla entre en una vista los tres tipos de
 * división y ¿cuántos son en la mesa? y vamos a poner en el ticket un botón de
 * edifición para poder modificar el nombre del restaruante.»
 *
 * - Sale la tarjeta «Nombre del restaurante (opcional)» de «¿Cómo dividen?».
 * - En la hoja del ticket, junto al nombre, un lápiz: aparece con la MISMA
 *   condición que tenía la tarjeta (`restaurantLabelEligible` y sin `frozen`).
 * - Los errores del nombre (validación local y el 409
 *   `restaurant_label_not_allowed` del dueño) van en la hoja, y también en la
 *   pantalla con «Editar en el ticket».
 */

const LAPIZ = 'Editar el nombre del restaurante';
const SIN_IDENTIFICAR = 'Restaurante sin identificar';
const ERROR_409 = 'No podemos usar ese nombre para este restaurante. Déjalo vacío o cámbialo y prueba de nuevo.';

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (dir) await page.screenshot({ path: `${dir}/${nombre}.png` });
}

/** Sin QR y sin comercio leído (`no_merchant`): el caso en que el nombre se puede poner. */
async function hastaComoDividen(page: Page, opciones: Parameters<typeof configurarTicketSinQr>[1] = { ocr: 'no_merchant' }): Promise<void> {
  await configurarTicketSinQr(page, opciones);
  await ingresar(page);
  await page.getByRole('button', { name: 'Nueva', exact: true }).click();
  await page.getByRole('button', { name: 'Capturar' }).click();
  await expect(page.getByRole('radio', { name: /Pagar el total/ })).toBeVisible();
  // Testigo: el comercio privado ya se resolvió (de ahí sale la elegibilidad).
  await expect.poll(async () => (await estadoN179(page)).privateRestaurantIds.length).toBe(1);
}

const hoja = (page: Page) => page.getByRole('dialog', { name: /Ticket ·/ });
const nombreEnHoja = (page: Page) => page.locator('.ticket-sheet .tk-fold-name');
const campoNombre = (page: Page) => hoja(page).getByRole('textbox', { name: 'Nombre del restaurante' });

async function abrirHoja(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Ver el ticket' }).click();
  await expect(hoja(page)).toBeVisible();
}

/**
 * Lo que tiene que entrar sin desplazar: las tres formas y «¿Cuántos son?»,
 * enteras, por encima de la barra de abajo y del círculo de Continuar.
 */
async function medirVista(page: Page) {
  return page.evaluate(() => {
    const barra = document.querySelector('.appbar-block')!.getBoundingClientRect();
    const circulo = document.querySelector('.appbar-fab')!.getBoundingClientRect();
    const limite = Math.min(barra.top, circulo.top);
    const piezas = [
      ...Array.from(document.querySelectorAll('.division-options .div-card')),
      document.querySelector('.division-stepper')!,
    ].map((el) => {
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
    });
    const scroll = document.querySelector('.ticket-flow-scroll') as HTMLElement;
    return {
      limite: Math.round(limite),
      piezas,
      entra: piezas.every((p) => p.top >= 0 && p.bottom <= limite),
      scrollTop: scroll.scrollTop,
      tarjeta: document.querySelectorAll('.restaurant-label-card').length,
    };
  });
}

/**
 * El alto que importa es el VISIBLE en el navegador del teléfono: la captura de
 * Mati (347×592, proporción 0,586) da unos 390×664 en Safari de un iPhone de
 * 6,1" con sus barras. Se mide ahí y en el iPhone SE (375×667), en los tres
 * estados: sin número, con número en «En partes iguales» («c/u») y con número
 * en «Por lo que pidió cada uno» («base de propina · c/u», el rótulo más largo).
 * 390×844 y 430×932 quedan como control.
 */
test.describe('AF-NOMBRE-EN-TICKET · «¿Cómo dividen?» en una sola vista', () => {
  for (const [ancho, alto] of [[390, 664], [375, 667], [390, 844], [430, 932]] as const) {
    test(`🔴 a ${ancho}×${alto}: las tres formas y «¿Cuántos son?» completo, sin desplazar, en los tres estados`, async ({ page }) => {
      await page.setViewportSize({ width: ancho, height: alto });
      await hastaComoDividen(page);
      await expect(page.getByLabel('Nombre del restaurante (opcional)')).toHaveCount(0);

      const sinNumero = await medirVista(page);
      expect(sinNumero.tarjeta, JSON.stringify(sinNumero)).toBe(0);
      expect(sinNumero.scrollTop).toBe(0);
      expect(sinNumero.entra, `sin número · ${JSON.stringify(sinNumero)}`).toBe(true);
      await capturar(page, `como-dividen-${ancho}x${alto}-sin-numero`);

      await completarDivision(page);
      await expect(page.locator('.split-amt')).toBeVisible();
      const igual = await medirVista(page);
      expect(igual.scrollTop).toBe(0);
      expect(igual.entra, `iguales con número · ${JSON.stringify(igual)}`).toBe(true);
      await capturar(page, `como-dividen-${ancho}x${alto}-con-numero`);

      await page.getByRole('radio', { name: /Por lo que pidió cada uno/ }).click();
      await expect(page.locator('.split-amt-lbl')).toHaveText('base de propina · c/u');
      const consumo = await medirVista(page);
      expect(consumo.scrollTop).toBe(0);
      expect(consumo.entra, `consumo con número · ${JSON.stringify(consumo)}`).toBe(true);
      console.log(`VISTA ${ancho}x${alto}`, JSON.stringify({ sinNumero, igual, consumo }));
    });
  }
});

test.describe('AF-NOMBRE-EN-TICKET · el lápiz en la hoja del ticket', () => {
  test('🔴 editar, guardar (Guardar y Enter), cancelar (Cancelar y Esc) y vaciar', async ({ page }) => {
    await hastaComoDividen(page);
    await abrirHoja(page);
    await expect(nombreEnHoja(page)).toHaveText(SIN_IDENTIFICAR);
    await capturar(page, 'hoja-con-lapiz');

    // Guardar con el botón.
    await hoja(page).getByRole('button', { name: LAPIZ }).click();
    await expect(campoNombre(page)).toBeFocused();
    await expect(campoNombre(page)).toHaveAttribute('maxlength', '400');
    await expect(campoNombre(page)).toHaveAttribute('placeholder', SIN_IDENTIFICAR);
    await campoNombre(page).fill('Café del Centro');
    await capturar(page, 'hoja-editando');
    await hoja(page).getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(nombreEnHoja(page)).toHaveText('Café del Centro');
    await expect(campoNombre(page)).toHaveCount(0);

    // Cancelar con el botón: no cambia.
    await hoja(page).getByRole('button', { name: LAPIZ }).click();
    await expect(campoNombre(page)).toHaveValue('Café del Centro');
    await campoNombre(page).fill('Otro nombre');
    await hoja(page).getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(nombreEnHoja(page)).toHaveText('Café del Centro');

    // Esc cancela; Enter guarda.
    await hoja(page).getByRole('button', { name: LAPIZ }).click();
    await campoNombre(page).fill('Con Esc no queda');
    await campoNombre(page).press('Escape');
    await expect(campoNombre(page)).toHaveCount(0);
    await expect(nombreEnHoja(page)).toHaveText('Café del Centro');
    await expect(hoja(page), 'Esc en el campo cancela la edición, no cierra la hoja').toBeVisible();
    await hoja(page).getByRole('button', { name: LAPIZ }).click();
    await campoNombre(page).fill('La Parolaccia');
    await campoNombre(page).press('Enter');
    await expect(nombreEnHoja(page)).toHaveText('La Parolaccia');

    // Vaciar: vuelve a «Restaurante sin identificar».
    await hoja(page).getByRole('button', { name: LAPIZ }).click();
    await campoNombre(page).fill('');
    await hoja(page).getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(nombreEnHoja(page)).toHaveText(SIN_IDENTIFICAR);
  });

  test('🔴 la validación va en la hoja, junto al campo, y no deja guardar', async ({ page }) => {
    await hastaComoDividen(page);
    await abrirHoja(page);
    await hoja(page).getByRole('button', { name: LAPIZ }).click();
    await campoNombre(page).fill('x'.repeat(201));
    await expect(hoja(page).getByText('Usa un nombre de hasta 200 caracteres.', { exact: true })).toBeVisible();
    await expect(hoja(page).getByRole('button', { name: 'Guardar', exact: true })).toBeDisabled();
  });

  test('🔴 la mesa se crea con el nombre editado en el ticket', async ({ page }) => {
    await hastaComoDividen(page);
    await abrirHoja(page);
    await hoja(page).getByRole('button', { name: LAPIZ }).click();
    await campoNombre(page).fill('  Café   del Centro  ');
    await campoNombre(page).press('Enter');
    await hoja(page).getByRole('button', { name: 'Cerrar hoja del ticket' }).click();
    await completarDivision(page);
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Compartir la mesa' })).toBeVisible();
    await expect(page.getByText(/Café del Centro · Mesa PA-/)).toBeVisible();
    const state = await estadoN179(page);
    expect(state.mesas).toHaveLength(1);
    expect(state.mesas[0]?.restaurant.name).toBe('Café del Centro');
  });

  test('control · con el comercio leído por el OCR no hay lápiz', async ({ page }) => {
    await configurarTicketSinQr(page);
    await ingresar(page);
    await page.getByRole('button', { name: 'Nueva', exact: true }).click();
    await page.getByRole('button', { name: 'Capturar' }).click();
    await expect(page.getByRole('radio', { name: /Pagar el total/ })).toBeVisible();
    await abrirHoja(page);
    // Testigo: la hoja ya muestra el comercio leído.
    await expect(nombreEnHoja(page)).not.toHaveText(SIN_IDENTIFICAR);
    await expect(nombreEnHoja(page)).not.toHaveText('');
    await expect(hoja(page).getByRole('button', { name: LAPIZ })).toHaveCount(0);
  });

  test('control · con una apertura sin confirmar (frozen) no hay lápiz', async ({ page }) => {
    await hastaComoDividen(page, { ocr: 'no_merchant', lostResponse: true });
    await abrirHoja(page);
    await expect(hoja(page).getByRole('button', { name: LAPIZ })).toBeVisible();
    await hoja(page).getByRole('button', { name: 'Cerrar hoja del ticket' }).click();
    await completarDivision(page);
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText(
      'No pudimos confirmar la apertura. Puede que la mesa ya se haya creado: reintenta esta misma apertura, no armes otra.',
    );
    await abrirHoja(page);
    await expect(nombreEnHoja(page)).toBeVisible();
    await expect(hoja(page).getByRole('button', { name: LAPIZ })).toHaveCount(0);
  });
});

test.describe('AF-NOMBRE-EN-TICKET · el 409 `restaurant_label_not_allowed`', () => {
  test('🔴 se muestra en la pantalla con «Editar en el ticket» y en la hoja, junto al campo', async ({ page }) => {
    await hastaComoDividen(page);
    await abrirHoja(page);
    await hoja(page).getByRole('button', { name: LAPIZ }).click();
    await campoNombre(page).fill('Nombre no permitido');
    await campoNombre(page).press('Enter');
    await hoja(page).getByRole('button', { name: 'Cerrar hoja del ticket' }).click();
    await completarDivision(page);
    // El dueño lo rechaza UNA vez con su código; después, el mock real.
    await page.evaluate(async () => {
      const apiRuta = '/src/api/index.ts';
      const httpRuta = '/src/api/http.ts';
      const { api } = await import(/* @vite-ignore */ apiRuta) as { api: Record<string, (...a: unknown[]) => Promise<unknown>> };
      const { HttpError } = await import(/* @vite-ignore */ httpRuta) as {
        HttpError: new (status: number, body: { error: string } | null) => Error;
      };
      const original = api.createMesa.bind(api);
      let veces = 0;
      api.createMesa = async (...args: unknown[]) => {
        veces += 1;
        if (veces === 1) throw new HttpError(409, { error: 'restaurant_label_not_allowed' });
        return original(...args);
      };
    });
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();

    // En la pantalla, con la hoja cerrada.
    await expect(hoja(page)).toHaveCount(0);
    const enPantalla = page.locator('.nombre-error-pantalla');
    await expect(enPantalla).toContainText(ERROR_409);
    await capturar(page, 'error-409-pantalla');

    // «Editar en el ticket» abre la hoja EN el campo, con el error al lado.
    await enPantalla.getByRole('button', { name: 'Editar en el ticket' }).click();
    await expect(hoja(page)).toBeVisible();
    await expect(campoNombre(page)).toBeFocused();
    await expect(hoja(page).getByText(ERROR_409, { exact: true })).toBeVisible();
    await capturar(page, 'error-409-hoja');

    // Vaciar y guardar lo resuelve: el error se va y la mesa se crea sin nombre.
    await campoNombre(page).fill('');
    await hoja(page).getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(hoja(page).getByText(ERROR_409, { exact: true })).toHaveCount(0);
    await hoja(page).getByRole('button', { name: 'Cerrar hoja del ticket' }).click();
    await expect(enPantalla).toHaveCount(0);
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Compartir la mesa' })).toBeVisible();
    const state = await estadoN179(page);
    expect(state.mesas).toHaveLength(1);
    expect(state.mesas[0]?.restaurant.name).toBe(SIN_IDENTIFICAR);
  });
});
