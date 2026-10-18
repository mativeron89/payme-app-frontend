import { expect, test, type Locator, type Page } from '@playwright/test';
import { ingresar } from './_app';
import { sacarFoto } from './_camara';
import { configurarTicketSinQr } from './fixtures/ticket-sin-qr';

/**
 * D360 · los cambios que pidió Mati después de probar la app (0.253.0). Acá van
 * los casos nuevos que no tenían un spec propio donde vivir; lo que cambió en
 * specs existentes se ajustó en cada uno.
 *
 * Capturas a 390×844 (proyecto `movil`) sólo con `PAYME_E2E_CAPTURAS`;
 * `PAYME_E2E_CAPTURAS_SOLO` (nombres separados por coma) toma sólo esas.
 */
async function capturar(page: Page, nombre: string, mostrar?: Locator): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (!dir) return;
  const solo = process.env.PAYME_E2E_CAPTURAS_SOLO?.split(',').map((n) => n.trim()).filter(Boolean);
  if (solo && !solo.includes(nombre)) return;
  if (mostrar) await mostrar.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: `${dir}/${nombre}.png`, animations: 'disabled' });
}

async function hastaComoDividen(page: Page): Promise<void> {
  await configurarTicketSinQr(page, { ocr: 'no_merchant' });
  await ingresar(page);
  await page.getByRole('button', { name: 'Escanear', exact: true }).click();
  await sacarFoto(page);
  await expect(page.getByRole('radio', { name: /Pagar el total/ })).toBeVisible();
}

const ayuda = (page: Page, opcion: string) => page.getByRole('button', { name: `Cómo funciona: ${opcion}`, exact: true });
const explicacion = (page: Page) => page.locator('.ayuda-opcion-burbuja');

// ─── D366 · «¿Cómo dividen?»: los «?», la tarjeta partida y el contador ─────

test.describe('D366 · los «?» de «¿Cómo dividen?»', () => {
  test('🔴 cada forma tiene su «?»: explica sin elegir, una a la vez, y se cierra con el mismo «?», la ✕ o Escape', async ({ page }) => {
    await hastaComoDividen(page);
    // Tres «?», cerrados, hermanos del radio (no adentro).
    for (const opcion of ['Por lo que pidió cada uno', 'En partes iguales', 'Pagar el total']) {
      await expect(ayuda(page, opcion)).toHaveAttribute('aria-expanded', 'false');
    }
    expect(await page.locator('[role="radio"] .ayuda-opcion-boton, [role="radio"] button').count()).toBe(0);
    await expect(explicacion(page)).toHaveCount(0);
    const consumo = page.getByRole('radio', { name: /Por lo que pidió cada uno/ });
    const total = page.getByRole('radio', { name: /Pagar el total/ });
    const elegidaAntes = await consumo.getAttribute('aria-checked');

    // Abre «Pagar el total»: el texto ajustado (D366) y el «?» marcado.
    await ayuda(page, 'Pagar el total').click();
    await expect(ayuda(page, 'Pagar el total')).toHaveAttribute('aria-expanded', 'true');
    await expect(explicacion(page)).toHaveCount(1);
    await expect(explicacion(page)).toHaveText('Sólo algunas personas van a pagar la cuenta, pero todos pueden marcar lo que comieron.');
    await expect(explicacion(page)).toBeFocused();
    // No eligió nada: la opción elegida sigue siendo la de antes.
    await expect(total).toHaveAttribute('aria-checked', 'false');
    await expect(consumo).toHaveAttribute('aria-checked', elegidaAntes!);
    // La burbuja va arriba de su opción, con su punta del lado del «?».
    const [caja, opcionCaja] = await Promise.all([explicacion(page).boundingBox(), total.boundingBox()]);
    expect(caja!.y + caja!.height, 'la explicación va arriba de la opción').toBeLessThanOrEqual(opcionCaja!.y);
    await capturar(page, 'd360-01-ayuda-pagar-el-total');

    // Abrir otro cierra el anterior: una a la vez.
    await ayuda(page, 'En partes iguales').click();
    await expect(explicacion(page)).toHaveCount(1);
    await expect(explicacion(page)).toHaveText('Cada uno selecciona sus ítems, pero la cuenta se divide en partes iguales.');
    await expect(ayuda(page, 'Pagar el total')).toHaveAttribute('aria-expanded', 'false');

    // Escape la cierra y el foco vuelve a su «?».
    await page.keyboard.press('Escape');
    await expect(explicacion(page)).toHaveCount(0);
    await expect(ayuda(page, 'En partes iguales')).toBeFocused();
    await expect(ayuda(page, 'En partes iguales')).toHaveAttribute('aria-expanded', 'false');

    // La ✕ la cierra y el foco vuelve al «?».
    await ayuda(page, 'Por lo que pidió cada uno').click();
    await expect(explicacion(page)).toHaveText('Cada uno selecciona sus ítems y paga por lo que consumió.');
    await page.getByRole('button', { name: 'Cerrar la explicación', exact: true }).click();
    await expect(explicacion(page)).toHaveCount(0);
    await expect(ayuda(page, 'Por lo que pidió cada uno')).toBeFocused();

    // El mismo «?» también la cierra.
    await ayuda(page, 'Por lo que pidió cada uno').click();
    await expect(explicacion(page)).toHaveCount(1);
    await ayuda(page, 'Por lo que pidió cada uno').click();
    await expect(explicacion(page)).toHaveCount(0);
  });

  test('el «?» se toca con 44 px y el círculo mide 22, arriba a la derecha de la opción', async ({ page }) => {
    await hastaComoDividen(page);
    const boton = ayuda(page, 'En partes iguales');
    const opcion = page.getByRole('radio', { name: /En partes iguales/ });
    const [b, signo, o] = await Promise.all([
      boton.boundingBox(), boton.locator('.ayuda-opcion-signo').boundingBox(), opcion.boundingBox(),
    ]);
    expect([Math.round(b!.width), Math.round(b!.height)]).toEqual([44, 44]);
    expect([Math.round(signo!.width), Math.round(signo!.height)]).toEqual([22, 22]);
    // A 8 del borde de arriba y a 20 del derecho de la opción (la ficha).
    expect(Math.round(signo!.y - o!.y)).toBe(8);
    expect(Math.round(o!.x + o!.width - (signo!.x + signo!.width))).toBe(20);
  });

  test('🔴 la tarjeta partida y el contador: por consumo sin «base de propina»; en partes iguales, «$X c/u»', async ({ page }) => {
    await hastaComoDividen(page);
    // Título solo en su tarjeta; el total con «Ver el ticket», en otra.
    await expect(page.locator('.ticket-title-card')).toHaveText('¿Cómo dividen?');
    await expect(page.locator('.ticket-total-card .ticket-title-amount')).toHaveText('$840');
    await expect(page.locator('.ticket-total-card').getByRole('button', { name: 'Ver el ticket', exact: true })).toBeVisible();
    // Por lo que pidió cada uno (la de entrada): − N + solo, ni monto ni «$—».
    await page.getByRole('radio', { name: /Por lo que pidió cada uno/ }).click();
    await expect(page.getByRole('group', { name: '¿Cuántos son en la mesa?' })).toBeVisible();
    await expect(page.locator('.division-stepper .marcador-monto, .division-stepper .split-amt')).toHaveCount(0);
    await expect(page.locator('.division-stepper')).not.toContainText('base de propina');
    await capturar(page, 'd360-02-como-dividen-por-consumo');
    // En partes iguales sigue el monto por persona.
    await page.getByRole('radio', { name: /En partes iguales/ }).click();
    await expect(page.locator('.division-stepper .marcador-monto')).toHaveText('$—');
    const mas = page.getByRole('button', { name: 'Un comensal más' });
    for (let i = 0; i < 4; i += 1) await mas.click();
    // 840 ÷ 4 = 210.
    await expect(page.locator('.division-stepper .split-amt')).toHaveText('$210');
    await expect(page.locator('.division-stepper .split-amt-lbl')).toHaveText('c/u');
    await capturar(page, 'd360-03-como-dividen-partes-iguales');
  });
});

// ─── D360 · P04 · D371 · un plato en $0, y un precio vacío ───────────────────

/** Abre la hoja del ticket (si hace falta), edita el precio de un plato y termina la edición («Listo»). */
async function editarPrecio(page: Page, plato: string, precio: string): Promise<void> {
  const hoja = page.getByRole('dialog');
  if ((await hoja.count()) === 0) await page.getByRole('button', { name: 'Ver el ticket', exact: true }).click();
  await page.getByRole('button', { name: 'Modificar ítems' }).click();
  await page.getByRole('button', { name: `Modificar ${plato}`, exact: true }).click();
  await page.getByRole('textbox', { name: 'Precio por unidad', exact: true }).fill(precio);
  await hoja.getByRole('button', { name: 'Listo', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Precio por unidad', exact: true })).toHaveCount(0);
}

const precioDeLaFila = (page: Page, plato: string) => page.locator('.tk-row').filter({ hasText: plato }).locator('.tk-price');

async function cerrarElTicket(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Cerrar hoja del ticket' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test.describe('P04 · D371 · el plato en $0', () => {
  test('🔴 un plato en «0» es un plato de $0: el total es la suma del resto y la mesa se abre con él', async ({ page }) => {
    await hastaComoDividen(page);
    await expect(page.locator('.ticket-title-amount')).toHaveText('$840');
    await editarPrecio(page, 'Agua mineral', '0');
    // La fila dice $0 y el total baja lo del agua: 840 − 40 = 800.
    await expect(precioDeLaFila(page, 'Agua mineral')).toHaveText('$0');
    await expect(page.locator('.ticket-title-amount')).toHaveText('$800');
    await capturar(page, 'd360-04-plato-en-cero');
    await cerrarElTicket(page);
    await page.getByRole('radio', { name: /En partes iguales/ }).click();
    const mas = page.getByRole('button', { name: 'Un comensal más' });
    for (let i = 0; i < 4; i += 1) await mas.click();
    // 800 ÷ 4 = 200.
    await expect(page.locator('.division-stepper .split-amt')).toHaveText('$200');
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Compartir la mesa' })).toBeVisible();
    const code = (await page.locator('.share-code-txt').innerText()).trim();
    // La mesa del mock lleva el agua en $0 y el total de $800.
    const mesa = await page.evaluate((c) => {
      const state = JSON.parse(localStorage.getItem('payme_mock_state_v1') ?? '{}');
      const m = (state.mesas ?? []).find((x: { code: string }) => x.code === c);
      return m ? { total: m.total_cents, agua: m.items.filter((i: { name: string }) => i.name === 'Agua mineral').map((i: { price_cents: number }) => i.price_cents) } : null;
    }, code);
    expect(mesa).toEqual({ total: 80000, agua: [0] });
  });

  test('🔴 un precio vacío no es $0: el total dice «—» y no se puede seguir hasta completarlo', async ({ page }) => {
    await hastaComoDividen(page);
    await editarPrecio(page, 'Agua mineral', '');
    // La fila incompleta dice «—», y el total también: nunca «$0».
    await expect(precioDeLaFila(page, 'Agua mineral')).toHaveText('—');
    await expect(page.locator('.ticket-title-amount')).toHaveText('—');
    await capturar(page, 'd360-05-precio-vacio');
    // Completo otra vez, vuelve el total.
    await editarPrecio(page, 'Agua mineral', '40');
    await expect(page.locator('.ticket-title-amount')).toHaveText('$840');
  });

  test('el ticket entero en $0 sigue sin poder abrirse (lo exige el dueño)', async ({ page }) => {
    await hastaComoDividen(page);
    for (const plato of ['Tagliatelle Bolognese', 'Risotto ai Funghi', 'Pizza Margherita', 'Tiramisú', 'Agua mineral', 'Vino tinto (copa)']) {
      await editarPrecio(page, plato, '0');
    }
    await expect(page.locator('.ticket-title-amount')).toHaveText('$0');
    await cerrarElTicket(page);
    await page.getByRole('radio', { name: /En partes iguales/ }).click();
    const mas = page.getByRole('button', { name: 'Un comensal más' });
    for (let i = 0; i < 4; i += 1) await mas.click();
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Compartir la mesa' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '¿Cómo dividen?' })).toBeVisible();
  });
});

// ─── D360-5b · D370 · los nombres que vienen todo en mayúsculas ──────────────

/** Le pone nombres en mayúsculas a tres platos de PA-2847 (del titular en el mock) y recarga. */
async function platosEnMayusculas(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const ruta = '/src/api/mock/store.ts';
    const store = await import(/* @vite-ignore */ ruta) as {
      state: { mesas: Array<{ code: string; items: Array<{ name: string }> }> };
      persist: () => void;
    };
    const mesa = store.state.mesas.find((m) => m.code === 'PA-2847');
    if (!mesa) throw new Error('PA-2847 ausente');
    const nuevos: Record<string, string> = {
      'Tagliatelle Bolognese': '100 HUGEL COPA',
      'Risotto ai Funghi': 'ZIFON NATURAL 900 ML',
      'Pizza Margherita': 'CERVEZA IPA',
    };
    for (const item of mesa.items) if (nuevos[item.name]) item.name = nuevos[item.name]!;
    store.persist();
    await new Promise<void>((r) => queueMicrotask(r));
  });
  await page.reload();
}

test.describe('D360-5b · D370 · mayúscula inicial al mostrar', () => {
  test('🔴 en «Tu mesa»: «100 Hugel copa», «Zifon natural 900 ML», «Cerveza IPA»; lo guardado no cambia', async ({ page }) => {
    await ingresar(page);
    await page.goto('/mesa/PA-2847');
    await expect(page.getByRole('heading', { name: 'Tu mesa', exact: true })).toBeVisible();
    await platosEnMayusculas(page);
    await expect(page.getByRole('heading', { name: 'Tu mesa', exact: true })).toBeVisible();
    const nombre = (crudo: string) => page.locator(`.qc-renglon[data-plato="${crudo}"] .qc-nombre`);
    // `data-plato` sigue con lo guardado; lo que se ve, con mayúscula inicial.
    await expect(nombre('100 HUGEL COPA')).toHaveText('100 Hugel copa');
    await expect(nombre('ZIFON NATURAL 900 ML')).toHaveText('Zifon natural 900 ML');
    await expect(nombre('CERVEZA IPA')).toHaveText('Cerveza IPA');
    // El nombre accesible dice lo mismo que se ve.
    await expect(page.getByRole('button', { name: 'Zifon natural 900 ML', exact: true })).toBeVisible();
    // Un nombre mixto queda tal cual.
    await expect(page.locator('.qc-renglon[data-plato="Tiramisú"] .qc-nombre').first()).toHaveText('Tiramisú');
    await capturar(page, 'd360-06-nombres-en-mayusculas', page.locator('.qc-lista'));
    // Lo guardado en el mock sigue en mayúsculas.
    const guardados = await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('payme_mock_state_v1') ?? '{}');
      const mesa = (state.mesas ?? []).find((m: { code: string }) => m.code === 'PA-2847');
      return (mesa?.items ?? []).map((i: { name: string }) => i.name).filter((n: string) => /HUGEL|ZIFON|IPA/.test(n));
    });
    expect(guardados.sort()).toEqual(['100 HUGEL COPA', 'CERVEZA IPA', 'ZIFON NATURAL 900 ML']);
  });
});
