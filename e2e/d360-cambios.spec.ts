import { expect, test, type Locator, type Page } from '@playwright/test';
import { ingresar, irEnLaApp, relojFueraDeLasFechasDeLosViajes } from './_app';
import { sacarFoto } from './_camara';
import { configurarTicketSinQr } from './fixtures/ticket-sin-qr';
import { hastaCompartir, pedidosDePropina, selectorDePropina } from './fixtures/mi-parte-d344';
import { abrirTusConsumos } from './_mesa';

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

    // Escape la cierra y el foco vuelve a su «?».
    await page.keyboard.press('Escape');
    await expect(explicacion(page)).toHaveCount(0);
    await expect(ayuda(page, 'Pagar el total')).toBeFocused();
    await expect(ayuda(page, 'Pagar el total')).toHaveAttribute('aria-expanded', 'false');

    // Abrir otro cierra el anterior: una a la vez. Abierta, una burbuja tapa la
    // opción vecina (es el diseño), así que el otro «?» se abre con el teclado
    // (Enter), que prueba lo mismo sin depender de qué tapa la burbuja.
    await ayuda(page, 'En partes iguales').click();
    await expect(explicacion(page)).toHaveText('Cada uno selecciona sus ítems, pero la cuenta se divide en partes iguales.');
    await ayuda(page, 'Pagar el total').press('Enter');
    await expect(explicacion(page)).toHaveCount(1);
    await expect(explicacion(page)).toHaveText('Sólo algunas personas van a pagar la cuenta, pero todos pueden marcar lo que comieron.');
    await expect(ayuda(page, 'En partes iguales')).toHaveAttribute('aria-expanded', 'false');
    // El foco pasa a la burbuja nueva, también al cambiar de una a otra.
    await expect(explicacion(page)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(explicacion(page)).toHaveCount(0);

    // La ✕ la cierra y el foco vuelve al «?». La primera opción no tiene lugar
    // arriba (lo que se desplaza empieza ahí): su burbuja va abajo, entera, y la
    // ✕ se puede tocar (arriba quedaba recortada y la tapaba la tarjeta del total).
    await ayuda(page, 'Por lo que pidió cada uno').click();
    await expect(explicacion(page)).toHaveText('Cada uno selecciona sus ítems y paga por lo que consumió.');
    await expect(explicacion(page)).toHaveClass(/ayuda-opcion-burbuja--abajo/);
    const [abajo, primera] = await Promise.all([explicacion(page).boundingBox(), consumo.boundingBox()]);
    expect(abajo!.y, 'la explicación va abajo de la primera opción').toBeGreaterThanOrEqual(primera!.y + primera!.height);
    await expect(page.getByRole('button', { name: 'Cerrar la explicación', exact: true })).toBeInViewport({ ratio: 1 });
    await capturar(page, 'd360-12-ayuda-primera-opcion-abajo');
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

  test('🔴 la tarjeta partida y el contador: en las tres formas, sólo − N +, sin monto al lado (D366 · D377)', async ({ page }) => {
    await hastaComoDividen(page);
    // Título solo en su tarjeta; el total con «Ver el ticket», en otra.
    await expect(page.locator('.ticket-title-card')).toHaveText('¿Cómo dividen?');
    await expect(page.locator('.ticket-total-card .ticket-title-amount')).toHaveText('$840');
    await expect(page.locator('.ticket-total-card').getByRole('button', { name: 'Ver el ticket', exact: true })).toBeVisible();
    // D360-2 · sin la leyenda de arriba de las formas. Control positivo: las tres formas, que se pintaban junto con
    // ella, ya están; la ausencia se busca en toda la pantalla.
    await expect(page.getByRole('radiogroup', { name: '¿Cómo dividen?', exact: true }).getByRole('radio')).toHaveCount(3);
    await expect(page.getByText('Revisa el ticket, elige el reparto', { exact: false })).toHaveCount(0);
    // D377 · en las tres formas, − N + solo: ni monto, ni «$—», ni «c/u».
    // Primero el control positivo (el grupo con su «—»), después la ausencia.
    const tarjeta = page.locator('.division-stepper');
    for (const [radio, pregunta] of [
      [/Por lo que pidió cada uno/, '¿Cuántos son en la mesa?'],
      [/En partes iguales/, '¿Cuántos pagan?'],
      [/Pagar el total/, '¿Cuántos pagan?'],
    ] as const) {
      await page.getByRole('radio', { name: radio }).click();
      await expect(page.getByRole('group', { name: pregunta, exact: true }).locator('.val')).toHaveText('—');
      await expect(tarjeta).not.toContainText('$');
      await expect(tarjeta).not.toContainText('c/u');
      await expect(tarjeta).not.toContainText('base de propina');
      if (pregunta === '¿Cuántos son en la mesa?') await capturar(page, 'd360-02-como-dividen-por-consumo');
    }
    // En partes iguales con número (el piso es 2: tres toques dan 4), sigue sin monto.
    await page.getByRole('radio', { name: /En partes iguales/ }).click();
    const mas = page.getByRole('button', { name: 'Un comensal más' });
    for (let i = 0; i < 3; i += 1) await mas.click();
    await expect(page.getByRole('group', { name: '¿Cuántos pagan?', exact: true }).locator('.val')).toHaveText('4');
    await expect(tarjeta).not.toContainText('$');
    await expect(tarjeta).not.toContainText('c/u');
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
    // El piso de partes iguales es 2: tres toques dan 4.
    for (let i = 0; i < 3; i += 1) await mas.click();
    await expect(page.getByRole('group', { name: '¿Cuántos pagan?', exact: true }).locator('.val')).toHaveText('4');
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Compartir la mesa' })).toBeVisible();
    const code = (await page.locator('.share-code-txt').innerText()).trim();
    // La mesa del mock lleva el agua en $0 y el total de $800.
    const mesa = await page.evaluate((c) => {
      const state = JSON.parse(localStorage.getItem('payme_mock_state_v1') ?? '{}');
      const m = (state.mesas ?? []).find((x: { code: string }) => x.code === c);
      return m ? {
        total: m.total_cents,
        agua: m.items.filter((i: { name: string }) => i.name === 'Agua mineral').map((i: { price_cents: number }) => i.price_cents),
        n: m.expected_participants,
        parte: m.slots?.[0]?.amount_cents,
      } : null;
    }, code);
    // D377 · la parte ya no se ve en el contador: la cuenta (800 ÷ 4 = 200) se lee en la mesa.
    expect(mesa).toEqual({ total: 80000, agua: [0], n: 4, parte: 20000 });
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

  /**
   * D389 · un plato de $0 cuenta como elegido para cerrar la mesa (mesa sin garantía, la regla del dueño 2.188.0 y
   * su réplica en el mock). Antes la mesa quedaba en 99 % y no se cerraba sola con el agua sin elegir. Y la hoja
   * «antes de cerrar» (D240-8) tiene que salir: sin la regla en `seleccionCierraLaMesa`, el «Listo» se mandaba directo
   * y el dueño cerraba la mesa sin que se pudiera corregir lo elegido.
   */
  test('🔴 D389 · con el agua en $0 sin elegir, elegir los demás platos avisa con la hoja y cierra la mesa, al 100 %', async ({ page }) => {
    await hastaComoDividen(page);
    await editarPrecio(page, 'Agua mineral', '0');
    await expect(page.locator('.ticket-title-amount')).toHaveText('$800');
    await cerrarElTicket(page);
    await page.getByRole('radio', { name: /Por lo que pidió cada uno/ }).click();
    const mas = page.getByRole('button', { name: 'Un comensal más' });
    for (let i = 0; i < 4; i += 1) await mas.click();
    await expect(page.getByRole('group', { name: '¿Cuántos son en la mesa?', exact: true }).locator('.val')).toHaveText('4');
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Compartir la mesa' })).toBeVisible();
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Tu mesa', exact: true })).toBeVisible();
    // D469 · «Tus consumos» arranca cerrado.
    await abrirTusConsumos(page);
    // Se eligen todos los platos con precio; el agua ($0) queda sin elegir. Control: son los seis con precio.
    const conPrecio = page.locator('.qc-lista .qc-renglon').filter({ hasNotText: 'Agua mineral' });
    await expect(conPrecio).toHaveCount(6);
    for (let i = 0; i < 6; i += 1) await conPrecio.nth(i).getByRole('button').first().click();
    await expect(page.locator('.qc-lista .qc-renglon [data-estado="mio"]')).toHaveCount(6);
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    // La hoja sale ANTES de mandar nada: la mesa sigue en «Tu mesa» y lo elegido se puede revisar.
    const hoja = page.getByRole('dialog', { name: 'Con esto se cierra la mesa' });
    await expect(hoja).toBeVisible();
    await expect(hoja.getByText('Con tu selección ya se eligió todo lo de la mesa.')).toBeVisible();
    await expect(page).toHaveURL(/\/mesa\//);
    await hoja.getByRole('button', { name: 'Guardar y cerrar', exact: true }).click();
    await expect(page.getByText('¡Listo! Ya se eligió todo y la mesa se cerró.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Ver la mesa', exact: true }).click();
    await expect(page.getByRole('progressbar', { name: 'Asignado 100% de la mesa' })).toBeVisible();
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
    // D469 · «Tus consumos» arranca cerrado.
    await abrirTusConsumos(page);
    const nombre = (crudo: string) => page.locator(`.qc-renglon[data-plato="${crudo}"] .qc-nombre`);
    // `data-plato` sigue con lo guardado; lo que se ve, con mayúscula inicial.
    await expect(nombre('100 HUGEL COPA')).toHaveText('100 Hugel copa');
    await expect(nombre('ZIFON NATURAL 900 ML')).toHaveText('Zifon natural 900 ML');
    await expect(nombre('CERVEZA IPA')).toHaveText('Cerveza IPA');
    // El nombre accesible dice lo mismo que se ve.
    await expect(page.getByRole('button', { name: 'Zifon natural 900 ML', exact: true })).toBeVisible();
    // Un nombre mixto queda tal cual.
    await expect(page.locator('.qc-renglon[data-plato="Tiramisú"] .qc-nombre').first()).toHaveText('Tiramisú');
    // D360-5a · sin «¿Compartieron un plato?». Control positivo: es una mesa por consumo, con la lista de platos a la
    // vista, que es donde se pintaba la ayuda.
    await expect(page.locator('.qc-lista .qc-renglon').first()).toBeVisible();
    await expect(page.getByText('¿Compartieron un plato?', { exact: true })).toHaveCount(0);
    await capturar(page, 'd360-06-nombres-en-mayusculas', page.locator('.qc-lista'));
    // D360-6 · al marcar un plato, la tira de porciones aparece debajo, sin taparlo
    // (el Tagliatelle de PA-2847, renombrado acá «100 HUGEL COPA»). Captura para Mati.
    const hugel = page.locator('.qc-renglon[data-plato="100 HUGEL COPA"]');
    await page.getByRole('button', { name: '100 Hugel copa', exact: true }).click();
    await expect(hugel.locator('.qc-porciones')).toBeVisible();
    const [cajaFila, cajaTira] = await Promise.all([hugel.locator('[data-estado="mio"]').boundingBox(), hugel.locator('.qc-porciones').boundingBox()]);
    expect(cajaTira!.y, 'la tira no tapa el renglón').toBeGreaterThanOrEqual(cajaFila!.y + cajaFila!.height - 1);
    await capturar(page, 'd360-11-porcion-debajo', hugel);
    // Lo guardado en el mock sigue en mayúsculas.
    const guardados = await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('payme_mock_state_v1') ?? '{}');
      const mesa = (state.mesas ?? []).find((m: { code: string }) => m.code === 'PA-2847');
      return (mesa?.items ?? []).map((i: { name: string }) => i.name).filter((n: string) => /HUGEL|ZIFON|IPA/.test(n));
    });
    expect(guardados.sort()).toEqual(['100 HUGEL COPA', 'CERVEZA IPA', 'ZIFON NATURAL 900 ML']);
  });
});

// ─── D360 · P09 · en Mesas, toda mesa terminada muestra su detalle ───────────
// D481 · desde la 0.262.0 el detalle ya no se despliega en la fila: toda la fila abre la pantalla del ticket (3b), con lo
// elegido y «Ver detalle digital» (antes «Ver ticket completo»). Lo que P09 pide —ver los consumos de toda mesa que no
// es de viaje, también «En partes iguales» y sin nada elegido— se conserva ahí.

test.describe('D360 · P09 · el detalle de las mesas que no son de viaje', () => {
  test('🔴 la mesa «En partes iguales» y la que no tiene nada elegido abren su pantalla del ticket, con «Ver detalle digital»', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('payme.app.mock.mis_mesas.v1', 'sin_cobro'));
    await ingresar(page);
    await page.goto('/#/mesas');
    const tusMesas = page.getByRole('region', { name: 'Tus mesas' });
    const tacuba = tusMesas.locator('.tu-mesa').filter({ hasText: 'Café Tacuba' });
    await expect(tacuba).toContainText('$180');
    const filas = await tusMesas.locator('.tu-mesa').count();

    // «En partes iguales»: la fila no se despliega, abre la pantalla del ticket.
    const fila = tacuba.locator('button.fila-ticket');
    await expect(fila).not.toHaveAttribute('aria-expanded', /.*/);
    await fila.click();
    await expect(page.getByRole('heading', { level: 1, name: 'Café Tacuba' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Lo que elegiste' })).toContainText('Elegiste 1 parte · $180');
    const ver = page.getByRole('button', { name: 'Ver detalle digital', exact: true });
    await expect(ver).toBeVisible();
    await capturar(page, 'd360-07-mesas-detalle-igual');

    // El detalle digital, con lo que el dueño publica de esa mesa.
    await ver.click();
    const ticket = page.getByRole('dialog');
    await expect(ticket).toContainText('Chilaquiles');
    await expect(ticket).toContainText('Café de olla');
    await capturar(page, 'd360-08-ticket-completo');
    await ticket.getByRole('button', { name: 'Cerrar', exact: true }).click();
    await expect(ticket).toHaveCount(0);
    await expect(ver).toBeFocused();
    await page.getByRole('button', { name: 'Volver', exact: true }).click();
    // Abrirlo no agregó ni repitió mesas en la lista.
    await expect(tusMesas.locator('.tu-mesa')).toHaveCount(filas);

    // La mesa ya pagada del seed (PA-1099, La Parolaccia), sin nada elegido: «No elegiste ítems», «—» y el botón.
    const pagada = tusMesas.locator('.tu-mesa').filter({ hasText: 'La Parolaccia' });
    await expect(pagada.locator('.fila-ticket-monto--sin')).toHaveText('—');
    await pagada.locator('button.fila-ticket').click();
    await expect(page.getByRole('region', { name: 'Lo que elegiste' })).toContainText('No elegiste ítems');
    await expect(page.getByRole('button', { name: 'Ver detalle digital', exact: true })).toBeVisible();
  });
});

// ─── D536 · al tocar «Escanear», la cámara de una (sale el menú de D368) ──────

test.describe('D536 · el «Escanear» de la barra abre la cámara directo', () => {
  test('🔴 con `capture` e image/*; la foto llega como de la cámara («Sacar otra»); el carrete sigue en «Elegir de la galería», sin `capture`', async ({ page }) => {
    await ingresar(page);
    const [camara] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: 'Escanear', exact: true }).click(),
    ]);
    // Mati, D535: «no abre la camara de una». La entrada nativa, con `capture`: ni el menú del teléfono ni el accept
    // estricto del dueño.
    expect(await camara.element().getAttribute('capture')).toBe('environment');
    expect(await camara.element().getAttribute('accept')).toBe('image/*');
    expect(await camara.element().getAttribute('data-camara')).toBe('nativa');
    await expect(page.getByRole('heading', { name: 'Escanea el ticket', exact: true })).toBeVisible();
    // La foto viene de la cámara: el marco ofrece «Sacar otra», no «Elegir otra».
    await sacarFoto(page, undefined, { usar: false });
    await expect(page.getByRole('group', { name: 'Marco del recorte' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sacar otra', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Elegir otra', exact: true })).toHaveCount(0);
  });

  test('🔴 si se cancela la cámara, el carrete es «Elegir de la galería» de la pantalla de abajo (sin `capture`)', async ({ page }) => {
    await ingresar(page);
    await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: 'Escanear', exact: true }).click(),
    ]);
    await expect(page.getByRole('heading', { name: 'Escanea el ticket', exact: true })).toBeVisible();
    const [galeria] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: 'Elegir de la galería o Drive', exact: true }).click(),
    ]);
    expect(await galeria.element().getAttribute('capture')).toBeNull();
    expect(await galeria.element().getAttribute('data-camara')).toBeNull();
  });
});

// ─── D360-4b · el engranaje de «Tu mesa» ────────────────────────────────────

test.describe('D360-4b · el engranaje de «Tu mesa»: el código y la propina', () => {
  test('🔴 el organizador ve el engranaje arriba a la derecha (D469); abre la hoja con el código y la propina, y se cierra con Escape o la ✕', async ({ page }) => {
    const code = await hastaCompartir(page, { ocr: 'descuento', modo: 'consumo' });
    await selectorDePropina(page).getByRole('radio', { name: '10%', exact: true }).click();
    await expect.poll(() => pedidosDePropina(page)).toBe(1);
    await expect(selectorDePropina(page).getByRole('status')).toHaveCount(0);
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Tu mesa', exact: true })).toBeVisible();

    const engranaje = page.getByRole('button', { name: 'Configuración de la mesa', exact: true });
    const hoja = page.getByRole('dialog', { name: 'Configuración de la mesa' });
    // D469 · el engranaje va en la tarjeta de título, arriba a la derecha (antes era el cuadro de la izquierda).
    await expect(page.locator('.title-card').getByRole('button', { name: 'Configuración de la mesa', exact: true })).toBeVisible();
    await expect(engranaje).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(engranaje).toHaveAttribute('aria-expanded', 'false');
    const [caja, titulo, tarjeta] = await Promise.all([
      engranaje.boundingBox(),
      page.getByRole('heading', { name: 'Tu mesa', exact: true }).boundingBox(),
      page.locator('.mesa-selection-title').boundingBox(),
    ]);
    expect(caja!.x + caja!.width / 2, 'el engranaje va a la derecha').toBeGreaterThan(tarjeta!.x + tarjeta!.width * 0.75);
    expect(caja!.y + caja!.height / 2, 'arriba: a la altura del título').toBeLessThan(titulo!.y + titulo!.height);
    expect(Math.min(caja!.width, caja!.height), 'se toca con 44 px').toBeGreaterThanOrEqual(44);
    // En la página: ni la línea de la propina (D469 la quitó: «es duplicar
    // información»; D380 la había puesto a la vista), ni el código, ni «Copiar
    // link» ni «Invitar amigos» (D379, «Pasarlos al engranaje»), ni el selector.
    await expect(page.getByText('Propina de la mesa: 10 %', { exact: true })).toHaveCount(0);
    await expect(page.locator('.screen .mesa-codigo-para-unirse')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Copiar link de invitación' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Invitar amigos de PayMe' })).toHaveCount(0);
    await expect(selectorDePropina(page)).toHaveCount(0);
    await expect(hoja).toHaveCount(0);
    await capturar(page, 'd360-09-tu-mesa-engranaje');

    // Abre la hoja: el código, como texto; «Copiar link» e «Invitar amigos» en una
    // fila, mitad y mitad (D181), con el ancla de la guía; y el mismo selector con
    // lo guardado.
    await engranaje.click();
    await expect(hoja).toBeVisible();
    await expect(engranaje).toHaveAttribute('aria-expanded', 'true');
    await expect(hoja.locator('.mesa-codigo-para-unirse')).toHaveText(`Código para unirse: ${code}`);
    const copiar = hoja.getByRole('button', { name: 'Copiar link de invitación', exact: true });
    const invitar = hoja.getByRole('button', { name: 'Invitar amigos de PayMe', exact: true });
    await expect(copiar).toHaveText('Copiar link');
    await expect(invitar).toHaveText('Invitar amigos');
    await expect(invitar).toHaveAttribute('data-guia', 'invitar');
    const [cajaCopiar, cajaInvitar] = await Promise.all([copiar.boundingBox(), invitar.boundingBox()]);
    expect(Math.round(cajaCopiar!.y), 'en la misma fila').toBe(Math.round(cajaInvitar!.y));
    expect(Math.abs(cajaCopiar!.width - cajaInvitar!.width), 'mitad y mitad').toBeLessThanOrEqual(1);
    await expect(hoja.getByRole('region', { name: 'Propina de la mesa' })
      .getByRole('radio', { name: '10%', exact: true })).toHaveAttribute('aria-checked', 'true');
    await expect(hoja.getByRole('button', { name: 'Cerrar', exact: true })).toBeFocused();
    await capturar(page, 'd360-10-hoja-de-la-mesa');
    // Con propina, 12 entre la fila de compartir y la propina.
    const aireConPropina = await hoja.evaluate((el) => {
      const fila = el.querySelector('.mesa-secondary-actions')!;
      return el.querySelector('.propina-mesa')!.getBoundingClientRect().top - fila.getBoundingClientRect().bottom;
    });
    expect(Math.abs(aireConPropina - 12), 'entre compartir y la propina, 12').toBeLessThanOrEqual(1);

    // Cambiarla desde la hoja la guarda; Escape cierra y el foco vuelve al engranaje.
    await hoja.getByRole('radio', { name: '15%', exact: true }).click();
    await expect.poll(() => pedidosDePropina(page)).toBe(2);
    await expect(hoja.getByRole('status')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(hoja).toHaveCount(0);
    await expect(engranaje).toBeFocused();
    await expect(engranaje).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByText('Propina de la mesa: 15 %', { exact: true })).toHaveCount(0);
    await engranaje.click();
    await expect(hoja.getByRole('region', { name: 'Propina de la mesa' })
      .getByRole('radio', { name: '15%', exact: true })).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    await expect(hoja).toHaveCount(0);

    // La ✕ también la cierra, con el foco de vuelta en el engranaje.
    await engranaje.click();
    await hoja.getByRole('button', { name: 'Cerrar', exact: true }).click();
    await expect(hoja).toHaveCount(0);
    await expect(engranaje).toBeFocused();
  });
});

// ─── D360-5a · tampoco en el ticket de un viaje ──────────────────────────────

test.describe('D360-5a · sin «¿Compartieron un plato?» en el ticket de un viaje', () => {
  test('🔴 «¿Qué consumiste?» con sus platos y sin la ayuda de porciones', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('payme.app.mock.viajes.v1', 'encendido'));
    await relojFueraDeLasFechasDeLosViajes(page);
    await ingresar(page);
    // «Mariscos El Faro», de Cancún 2026 (mock): un ticket por consumos que todavía se puede elegir.
    await irEnLaApp(page, '/viaje-ticket/d1000000-0000-4000-8000-000000000001.d2000000-0000-4000-8000-000000000105');
    // Control positivo: la tarjeta donde vivía la ayuda, con un plato a la vista.
    const consumos = page.getByRole('region', { name: '¿Qué consumiste?', exact: true });
    await expect(consumos.getByText('Tacos de pescado (3)', { exact: true })).toBeVisible();
    await expect(page.getByText('¿Compartieron un plato?', { exact: true })).toHaveCount(0);
  });
});

// ─── D379 · la memoria de las invitaciones, entre cierres de la hoja ─────────

test.describe('D379 · «Invitar amigos» en la hoja del engranaje conserva lo enviado', () => {
  test('🔴 error ambiguo, cerrar y reabrir: el reintento reusa la key; en curso no se repite al reabrir; «Enviando…» e «Invitado ✓» los pinta la memoria', async ({ page }) => {
    // El reloj de la página se instala antes de cargar y corre normal. Se pausa sólo mientras se mide lo que tiene que
    // pintar la suscripción del panel a la memoria: con el reloj quieto no corren ni el tick de 1 s de MesaScreen ni su
    // refresco de 10 s, que repintan todo y taparían una suscripción rota.
    await page.clock.install();
    await ingresar(page);
    const aviso = page.getByLabel('Actualización del Aviso de Privacidad');
    await aviso.getByRole('button', { name: 'Entendido', exact: true }).click();
    await expect(aviso).toHaveCount(0);
    await page.goto('/#/mesa/PA-2847');
    await expect(page.getByRole('heading', { name: 'Tu mesa', exact: true })).toBeVisible();
    // Se anota la Idempotency-Key de cada invitación. La primera falla sin respuesta (un error ambiguo: no se sabe si
    // llegó), que es el caso en que el reintento tiene que reusarla. La segunda queda en vuelo hasta que el test la
    // resuelve (sin timers: con el reloj quieto, una respuesta con demora no llegaría nunca).
    await page.evaluate(async () => {
      const ruta = '/src/api/index.ts';
      const { api } = await import(/* @vite-ignore */ ruta);
      const claves: string[] = [];
      Reflect.set(window, '__clavesDeInvitar', claves);
      api.inviteFriend = (_code: string, _paymeId: string, key: string) => {
        claves.push(key);
        if (claves.length === 1) return Promise.reject(new Error('red caída'));
        return new Promise((resolve) => {
          Reflect.set(window, '__resolverInvitacion', () => resolve({
            invitation: {
              id: 'e2e-invitacion', invitation_type: 'in_app', status: 'pending',
              expires_at: '2026-10-20T00:00:00.000Z', created_at: '2026-10-18T00:00:00.000Z',
            },
          }));
        });
      };
    });
    const claves = () => page.evaluate(() => [...(Reflect.get(window, '__clavesDeInvitar') as string[])]);
    // `pauseAt` no va hacia atrás, y el reloj sigue corriendo mientras se lee la hora: se pausa un segundo después
    // (dispara una vez lo que vencía en ese segundo, antes de lo que se mide).
    const pausar = async () => {
      const ahora = await page.evaluate(() => Date.now());
      await page.clock.pauseAt(ahora + 1_000);
    };
    const engranaje = page.getByRole('button', { name: 'Configuración de la mesa', exact: true });
    const hoja = page.getByRole('dialog', { name: 'Configuración de la mesa' });
    const abrirPanel = hoja.getByRole('button', { name: 'Invitar amigos de PayMe', exact: true });
    const sofia = hoja.locator('.inv-row').filter({ hasText: 'Sofía Fernández' });
    const boton = (nombre: string) => sofia.getByRole('button', { name: nombre, exact: true });
    const toast = page.locator('.toast');
    const cerrarYReabrir = async () => {
      await page.keyboard.press('Escape');
      await expect(hoja).toHaveCount(0);
      await engranaje.click();
      // Cerrar pliega el panel: al reabrir está «Invitar amigos», sin la lista.
      await expect(abrirPanel).toBeVisible();
      await expect(hoja.locator('.inv-row')).toHaveCount(0);
      await abrirPanel.click();
    };

    await engranaje.click();
    // PA-2847 tiene garantía: su hoja no lleva propina, la fila de compartir es lo último y la hoja termina con su
    // relleno, sin 12 de más (enmienda 15). Control positivo: la fila está y la propina no.
    await expect(abrirPanel).toBeVisible();
    await expect(hoja.getByRole('region', { name: 'Propina de la mesa' })).toHaveCount(0);
    const final = await hoja.evaluate((el) => ({
      aire: el.getBoundingClientRect().bottom - el.querySelector('.mesa-secondary-actions')!.getBoundingClientRect().bottom,
      relleno: parseFloat(getComputedStyle(el).paddingBottom),
    }));
    expect(Math.abs(final.aire - final.relleno), 'debajo de compartir, sólo el relleno de la hoja').toBeLessThanOrEqual(1);
    await capturar(page, 'd360-13-hoja-sin-propina');
    await abrirPanel.click();
    await boton('Invitar').click();
    await expect(toast).toHaveText('No pudimos confirmar la invitación a Sofía. Reintenta la misma: vamos a reutilizarla.');
    expect(await claves()).toHaveLength(1);

    await cerrarYReabrir();
    await expect(boton('Invitar')).toBeEnabled();
    // Con el reloj quieto, el reintento queda en vuelo y «Enviando…» sólo lo puede pintar la suscripción. `force`
    // porque la espera de «estable» de Playwright mira cuadros, y con el reloj quieto no pasan.
    await pausar();
    await boton('Invitar').click({ force: true });
    await expect(boton('Enviando…')).toBeDisabled();
    expect(await claves()).toHaveLength(2);

    // Con la invitación en vuelo se cierra la hoja y se reabre: el panel nuevo lee «Enviando…» de la memoria y no se
    // puede volver a tocar (el reloj corre: la hoja anima al cerrarse).
    await page.clock.resume();
    await cerrarYReabrir();
    await expect(boton('Enviando…')).toBeDisabled();
    await boton('Enviando…').click({ force: true });
    expect(await claves()).toHaveLength(2);

    // Con el reloj quieto otra vez llega la respuesta: «Invitado ✓» lo pinta la suscripción del panel reabierto.
    await pausar();
    await page.evaluate(() => (Reflect.get(window, '__resolverInvitacion') as () => void)());
    await expect(boton('Invitado ✓')).toBeDisabled();
    await expect(toast).toHaveText('Invitación enviada a Sofía ✓');
    const enviadas = await claves();
    expect(enviadas).toHaveLength(2);
    for (const k of enviadas) expect(k.length, 'una Idempotency-Key no vacía').toBeGreaterThan(0);
    expect(enviadas[1], 'el reintento después de reabrir reusa la Idempotency-Key').toBe(enviadas[0]);

    // Otra vez cerrar y reabrir: «Invitado ✓» sigue y no se manda nada más.
    await page.clock.resume();
    await cerrarYReabrir();
    await expect(boton('Invitado ✓')).toBeDisabled();
    expect(await claves()).toHaveLength(2);
  });
});
