import { expect, test, type Page } from '@playwright/test';
import { ingresar, relojFueraDeLasFechasDeLosViajes } from './_app';
import { camaraSimulada, camarasAbiertas, sacarFoto } from './_camara';
import { abrirTusConsumos } from './_mesa';
import {
  abrirDesdeLaTarjeta, burbuja, CLAVE_TARJETA_OCULTA, contarLaRed, entrar, escrito, espiarLaFachada, fase,
  hastaElTicket, hastaLaCamara, hastaTuMesa, llamadas, pathname, SONDAS_DE_RED, sondearLaRed, tarjeta, TEXTO_2D, type Llamada,
} from './_guia';

/**
 * D363 · D367 · la mesa de ejemplo del tutorial no le pide nada a la red ni escribe nada.
 *
 * «Cero» es la definición de V (respuestas al plan, 4ad77ba9…): de 2a a 4a no hay pedidos de la familia mesa,
 * ticket, invitación, propina, OCR ni pago, y nada se escribe. Revisión de V sobre ff5dec7 (a2b729e4…): los
 * recorridos arrancan por la tarjeta y el motor, como la persona, y se mide en cuatro lugares, cada uno con su
 * control positivo (en el mismo caso, salvo donde se dice):
 *
 * 1. **La red.** `page.route('**\/*')` cuenta todo pedido a cualquier origen y ruta, salvo los módulos que sirve Vite
 *    (`contarLaRed`, con la lista de excluidos a la vista). Control: tres sondas (otro origen, mismo origen, un
 *    script) tienen que aparecer, y nada más.
 * 2. **La fachada.** Un espía sobre `api` (el MISMO objeto que usan las pantallas) anota cada llamada con la clase de
 *    `CLASIFICACION_DEL_EJEMPLO`: ningún `cortado`, y los `local` sólo con PA-1224. Control: los locales sí se llamaron.
 * 3. **Las escrituras.** El estado del mock, todo `localStorage` y todo `sessionStorage`, iguales antes y después; la
 *    única diferencia admitida es la tarjeta Tutorial oculta, después de «Terminar guía» (Q1). Controles: esa clave
 *    misma (localStorage) y una sonda (sessionStorage), en el mismo caso; el estado del mock, en el test de la mesa
 *    real.
 * 4. **Lo que se ve.** D429: copiar, WhatsApp y amigos inventados explican; sin link, propina, engranaje ni «Cerrar mesa». Control: el test de la
 *    mesa real, donde todo eso aparece.
 *
 * 🔴 **Esto corre contra el mock, no contra el servidor.** En modo mock la app no hace HTTP a la API: la cuenta de la
 * red vigila lo que se le escape a la fachada (un fetch, una imagen, un script). En el build real la garantía es
 * estructural: la clasificación de la fachada, las costuras y el rechazo local de PA-1224 (sus unitarios).
 */

function sinRedEnLaFachada(lista: readonly Llamada[]): void {
  expect(lista.filter((l) => l.clase === 'cortado'), 'ningún pedido cortado').toEqual([]);
  expect(lista.filter((l) => l.clase === 'local' && l.codigo?.toUpperCase() !== 'PA-1224'), 'locales sólo de PA-1224').toEqual([]);
}

/** Cierra la ventana de la red con las sondas adentro: aparecen las tres y nada más; el motor se cargó y no se contó. */
async function redEnCero(page: Page, red: Awaited<ReturnType<typeof contarLaRed>>, { motor = true } = {}): Promise<void> {
  await sondearLaRed(page);
  const r = await red.cerrar();
  expect(r.contados.sort(), JSON.stringify(r)).toEqual([...SONDAS_DE_RED].sort());
  expect(r.websockets).toEqual([]);
  if (motor) expect(r.excluidos).toContain('/src/ayuda/GuiaContenido.tsx');
}

/** Lo escrito después es lo de antes; con «Terminar guía», más la tarjeta Tutorial oculta (y nada más). */
async function sinEscrituras(page: Page, antes: Awaited<ReturnType<typeof escrito>>, { terminada = false } = {}): Promise<void> {
  if (terminada) await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), CLAVE_TARJETA_OCULTA)).toBe('1');
  // Control del volcado de sessionStorage: una sonda escrita a mano aparece (y se saca antes de comparar).
  await page.evaluate(() => sessionStorage.setItem('__sonda_d363', '1'));
  expect((await escrito(page)).session.__sonda_d363).toBe('1');
  await page.evaluate(() => sessionStorage.removeItem('__sonda_d363'));
  const despues = await escrito(page);
  expect(antes.local[CLAVE_TARJETA_OCULTA]).toBeUndefined();
  const esperado = terminada ? { ...antes.local, [CLAVE_TARJETA_OCULTA]: '1' } : antes.local;
  expect(despues.local).toEqual(esperado);
  expect(despues.session).toEqual(antes.session);
  expect(despues.store).toBe(antes.store);
}

/** 2d · D429 muestra acciones explicativas y amigos inventados; sin link ni propina. */
async function compartirDelEjemplo(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Compartir la mesa' })).toBeVisible();
  await expect(page.locator('.share-code-txt')).toHaveText('PA-1224');
  expect(await fase(page)).toBe('compartir');
  await expect(page.getByRole('button', { name: 'Copiar link', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'WhatsApp', exact: true })).toBeEnabled();
  const amigos = page.getByRole('region', { name: 'Amigos de ejemplo' });
  await expect(amigos.getByRole('button')).toHaveCount(3);
  for (const nombre of ['Lucía Sol', 'Diego Luna', 'Ana Ríos']) {
    await expect(amigos.getByRole('button', { name: `Invitar a ${nombre}`, exact: true })).toBeEnabled();
  }
  await expect(page.getByRole('button', { name: 'Reintentar el mismo link' })).toHaveCount(0);
  await expect(page.getByRole('tablist', { name: 'Elegir a quién invitar' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'WhatsApp' })).toHaveCount(0);
  await expect(page.getByText('No pudimos generar el link')).toHaveCount(0);
  await expect(page.getByText(/propina/i)).toHaveCount(0);
  // D622 · AF-3 · la guía no dibuja el QR del link (§7): ni escaneable ni de adorno.
  await expect(page.locator('.codigo-qr')).toHaveCount(0);
  await expect(page.getByRole('img', { name: /^QR para unirse/ })).toHaveCount(0);
}

/** 2e · «Tu mesa» del titular, sin engranaje, sin solicitudes y sin «Cerrar mesa». */
async function tuMesaDelEjemplo(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/mesa\/PA-1224$/);
  await expect.poll(() => fase(page)).toBe('mesa');
  await expect(page.getByRole('button', { name: 'Configuración de la mesa' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cerrar mesa' })).toHaveCount(0);
  await expect(page.getByText('Solicitudes para unirse')).toHaveCount(0);
  await expect(page.getByText(/propina/i)).toHaveCount(0);
}

/** 4a · «Terminar guía»: la mesa de ejemplo se va y el ejemplo se apaga. */
async function terminar(page: Page): Promise<void> {
  const a4 = burbuja(page, 'Así queda tu mesa.');
  await expect(a4).toBeVisible();
  await a4.getByRole('button', { name: 'Terminar guía', exact: true }).click();
  await expect(page.locator('[data-guia="mesa-ejemplo"]')).toHaveCount(0);
  expect(await fase(page)).toBe('apagado');
}

test.describe('D363 · el ejemplo no sale a la red ni escribe', () => {
  test('🔴 por lo que pidió cada uno, desde la tarjeta: de 2a a «Terminar guía», cero pedidos, cero escrituras y el «Listo» no cierra', async ({ page }) => {
    await entrar(page);
    await espiarLaFachada(page);
    const antes = await escrito(page);
    const red = await contarLaRed(page);

    await abrirDesdeLaTarjeta(page);
    await hastaLaCamara(page);
    await hastaElTicket(page);
    const hoja = page.getByRole('dialog', { name: /Ticket/ });
    await expect(hoja.getByText('Restaurante Ejemplo', { exact: true })).toBeVisible();
    // T3 · los tres platos del ejemplo en la hoja (como en ff5dec7).
    for (const plato of ['Tagliatelle Bolognese', 'Risotto ai Funghi', 'Pizza Margherita']) {
      await expect(hoja.getByText(plato, { exact: true })).toBeVisible();
    }
    await expect(page.locator('.ticket-title-amount')).toHaveText('$600');
    await expect(page.getByRole('group', { name: 'Marco del recorte' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Modificar ítems' })).toHaveCount(0);
    await burbuja(page, 'Este es el ticket de ejemplo.').getByRole('button', { name: 'Siguiente', exact: true }).click();
    await expect.poll(() => fase(page)).toBe('dividir');
    // T3 · el valor del contador del ejemplo antes de Continuar (como en ff5dec7).
    await page.getByRole('radio', { name: /Por lo que pidió cada uno/ }).click();
    await page.getByRole('button', { name: 'Un comensal más' }).click();
    await expect(page.getByRole('group', { name: '¿Cuántos son en la mesa?', exact: true }).locator('.val')).toHaveText('1');
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(burbuja(page, TEXTO_2D)).toBeVisible();
    await compartirDelEjemplo(page);
    await hastaTuMesa(page);
    await tuMesaDelEjemplo(page);

    // Los tres platos: sin la bandera, esto abriría «Con esto se cierra la mesa» (control positivo abajo).
    const renglones = page.locator('.qc-lista .qc-renglon');
    await expect(renglones).toHaveCount(3);
    for (let i = 0; i < 3; i += 1) await renglones.nth(i).getByRole('button').first().click();
    await expect(page.locator('.qc-lista .qc-renglon [data-estado="mio"]')).toHaveCount(3);
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    await expect.poll(() => pathname(page)).toBe('/home');
    await expect(page.getByRole('dialog', { name: 'Con esto se cierra la mesa' })).toHaveCount(0);
    expect(await fase(page)).toBe('listo');
    await terminar(page);

    await redEnCero(page, red);
    const lista = await llamadas(page);
    sinRedEnLaFachada(lista);
    // Control: el camino local sí se recorrió (si no, lo de arriba no diría nada).
    expect(lista.some((l) => l.metodo === 'getMesa' && l.codigo === 'PA-1224')).toBe(true);
    expect(lista.some((l) => l.metodo === 'lockItems' && l.codigo === 'PA-1224')).toBe(true);
    expect(lista.some((l) => l.metodo === 'getMesaParticipants' && l.codigo === 'PA-1224')).toBe(true);
    expect(camarasAbiertas(page)).toBeGreaterThan(0);
    await sinEscrituras(page, antes, { terminada: true });
  });

  test('🔴 en partes iguales, desde la tarjeta: la selección informativa se guarda en memoria y nada sale', async ({ page }) => {
    await entrar(page);
    await espiarLaFachada(page);
    const antes = await escrito(page);
    const red = await contarLaRed(page);

    await abrirDesdeLaTarjeta(page);
    await hastaLaCamara(page);
    await hastaElTicket(page);
    await burbuja(page, 'Este es el ticket de ejemplo.').getByRole('button', { name: 'Siguiente', exact: true }).click();
    await expect.poll(() => fase(page)).toBe('dividir');
    await page.getByRole('radio', { name: /En partes iguales/ }).click();
    await page.getByRole('button', { name: 'Un comensal más' }).click();
    // T3 · el contador en «igual» (como en ff5dec7).
    await expect(page.getByRole('group', { name: /¿Cuántos pagan\?/ })).toContainText('2');
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(burbuja(page, TEXTO_2D)).toBeVisible();
    await compartirDelEjemplo(page);
    await hastaTuMesa(page);
    await tuMesaDelEjemplo(page);

    await page.getByRole('button', { name: /^Tagliatelle Bolognese(,|$)/ }).click();
    await page.getByRole('radio', { name: '½', exact: true }).click();
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    await expect.poll(() => pathname(page)).toBe('/home');
    const guardado = await page.evaluate(async () => {
      const ruta = '/src/ayuda/ejemplo/estadoEjemplo.ts';
      const { ejemploLocal } = await import(/* @vite-ignore */ ruta) as {
        ejemploLocal: { leer: () => { fase: string; seleccion: Map<string, number> } };
      };
      const estado = ejemploLocal.leer();
      return { fase: estado.fase, seleccion: [...estado.seleccion.values()] };
    });
    expect(guardado).toEqual({ fase: 'listo', seleccion: [5000] });
    await terminar(page);

    await redEnCero(page, red);
    const lista = await llamadas(page);
    sinRedEnLaFachada(lista);
    expect(lista.some((l) => l.metodo === 'getInformativeSelection' && l.codigo === 'PA-1224')).toBe(true);
    expect(lista.some((l) => l.metodo === 'replaceInformativeSelection' && l.codigo === 'PA-1224')).toBe(true);
    await sinEscrituras(page, antes, { terminada: true });
  });

  test('Q7 · «Volver» desde ¿Cómo dividen? descarta la mesa de ejemplo y vuelve a Inicio, sin pedir ni escribir nada', async ({ page }) => {
    await entrar(page);
    await espiarLaFachada(page);
    const antes = await escrito(page);
    const red = await contarLaRed(page);
    await abrirDesdeLaTarjeta(page);
    await hastaLaCamara(page);
    await hastaElTicket(page);
    await page.getByRole('button', { name: 'Cerrar hoja del ticket' }).click();
    await expect.poll(() => fase(page)).toBe('dividir');
    await page.getByRole('button', { name: 'Volver', exact: true }).click();
    await expect.poll(() => pathname(page)).toBe('/home');
    expect(await fase(page)).toBe('apagado');
    await expect(tarjeta(page)).toBeVisible();
    await redEnCero(page, red);
    sinRedEnLaFachada(await llamadas(page));
    await sinEscrituras(page, antes);
  });

  test('sin el ejemplo, /mesa/PA-1224 vuelve a Inicio, no se pide la mesa, no sale nada y no se escribe nada', async ({ page }) => {
    await relojFueraDeLasFechasDeLosViajes(page);
    await ingresar(page);
    await espiarLaFachada(page);
    const antes = await escrito(page);
    // T4 · la red y todo lo escrito, como en ff5dec7.
    const red = await contarLaRed(page);
    await page.evaluate(() => {
      history.pushState(null, '', '/mesa/PA-1224');
      window.dispatchEvent(new Event('popstate'));
    });
    await expect.poll(() => pathname(page)).toBe('/home');
    await expect(page.getByRole('button', { name: 'Escanear', exact: true })).toBeVisible();
    expect((await llamadas(page)).filter((l) => l.codigo?.toUpperCase() === 'PA-1224')).toEqual([]);
    await redEnCero(page, red, { motor: false });
    await sinEscrituras(page, antes);
  });

  test('con el QR de un restaurante: sin el ejemplo se lee el restaurante; con el ejemplo (desde la tarjeta), no', async ({ page }) => {
    await relojFueraDeLasFechasDeLosViajes(page);
    await page.addInitScript(() => {
      if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
      localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled');
    });
    await camaraSimulada(page);
    // Como `entrar`, pero entrando por el QR del primer restaurante del mock.
    await page.goto('/?r=b0000000-0000-4000-8000-000000000001');
    await page.evaluate(async () => {
      const ruta = '/src/api/mock/store.ts';
      const { state, persist } = await import(/* @vite-ignore */ ruta) as { state: { pendingInvitations: unknown[] }; persist: () => void };
      state.pendingInvitations = []; persist();
    });
    await page.getByLabel('Email', { exact: true }).fill('mati@payme.mx');
    await page.getByLabel(/^Contraseña$/).fill('demo-e2e');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Escanear', exact: true })).toBeVisible();
    const aviso = page.getByRole('complementary', { name: 'Actualización del Aviso de Privacidad', exact: true });
    await aviso.getByRole('button', { name: 'Ahora no', exact: true }).click();
    await espiarLaFachada(page);
    // Control: sin el ejemplo, la cámara con QR pide el restaurante.
    await page.getByRole('button', { name: 'Escanear', exact: true }).click();
    await expect.poll(async () => (await llamadas(page)).some((l) => l.metodo === 'getRestaurant')).toBe(true);
    await page.getByRole('button', { name: 'Volver', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Escanear', exact: true })).toBeVisible();
    await page.evaluate(() => { (window as unknown as { __llamadas: unknown[] }).__llamadas = []; });
    await abrirDesdeLaTarjeta(page);
    await hastaLaCamara(page);
    await hastaElTicket(page);
    sinRedEnLaFachada(await llamadas(page));
    expect((await llamadas(page)).some((l) => l.metodo === 'getRestaurant')).toBe(false);
  });

  test('control positivo · con una mesa de verdad, lo que el ejemplo esconde aparece, lo que corta sale y se escribe', async ({ page }) => {
    await relojFueraDeLasFechasDeLosViajes(page);
    await page.addInitScript(() => localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled'));
    await ingresar(page);
    await espiarLaFachada(page);
    const antes = await escrito(page);
    await page.getByRole('button', { name: 'Escanear', exact: true }).click();
    await sacarFoto(page);
    await expect(page.getByRole('radio', { name: /Por lo que pidió cada uno/ })).toBeVisible();
    await page.getByRole('button', { name: 'Ver el ticket', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Modificar ítems' })).toBeVisible();
    await page.getByRole('button', { name: 'Cerrar hoja del ticket' }).click();
    await page.getByRole('radio', { name: /Por lo que pidió cada uno/ }).click();
    await page.getByRole('button', { name: 'Un comensal más' }).click();
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Compartir la mesa' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copiar link' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'WhatsApp' })).toBeVisible();
    await expect(page.getByRole('tablist', { name: 'Elegir a quién invitar' })).toBeVisible();
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();

    // D469 · con una mesa de verdad «Tus consumos» arranca cerrado (en el ejemplo, abierto para el paso de la guía).
    await abrirTusConsumos(page);
    await expect(page.locator('.qc-lista')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Configuración de la mesa' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cerrar mesa' })).toBeVisible();
    const renglones = page.locator('.qc-lista .qc-renglon');
    const total = await renglones.count();
    for (let i = 0; i < total; i += 1) await renglones.nth(i).getByRole('button').first().click();
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    // Punto 2 · sin la bandera, elegir todo abre la hoja antes de cerrar.
    await expect(page.getByRole('dialog', { name: 'Con esto se cierra la mesa' })).toBeVisible();

    const metodos = new Set((await llamadas(page)).map((l) => l.metodo));
    for (const metodo of [
      'scanTicket', 'createMesa', 'createInvitation', 'getMesaJoinRequests', 'getPaymentMethods', 'getMesa', 'getMesaParticipants',
    ]) {
      expect(metodos.has(metodo), metodo).toBe(true);
    }
    // Y el comparador de escrituras sí ve una mesa real: el estado del mock cambió.
    expect((await escrito(page)).store).not.toBe(antes.store);
  });
});
