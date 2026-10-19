import { expect, test, type Page } from '@playwright/test';
import { ingresar, omitirGuiaEnFixture, relojFueraDeLasFechasDeLosViajes } from './_app';
import { camaraSimulada, camarasAbiertas, sacarFoto } from './_camara';
import { enTuMesaConLaLista } from './_mesa';

/**
 * D363 · D367 · la mesa de ejemplo del tutorial no le pide nada a la red ni escribe nada.
 *
 * «Cero» es la definición de V (respuestas al plan, 4ad77ba9…): de 2a a 4a no hay
 * pedidos de la familia mesa, ticket, invitación, propina, OCR ni pago, y nada se
 * escribe (store del mock, `localStorage`, journal). Las lecturas de siempre de
 * Inicio pueden pasar. Se mide en tres lugares:
 *
 * 1. **La fachada.** Un espía sobre `api` (el MISMO objeto que usan las pantallas)
 *    anota cada llamada con la clase de `CLASIFICACION_DEL_EJEMPLO`: ningún
 *    `cortado`, y los `local` sólo con PA-1224 (los contesta la memoria).
 * 2. **Las escrituras.** El estado del mock y todo `localStorage`, iguales antes y
 *    después.
 * 3. **HTTP.** Ningún pedido a `/api/`.
 *
 * 🔴 **Esto corre contra el mock, no contra el servidor.** En el build real la
 * garantía es estructural: la clasificación de la fachada, las costuras y el
 * rechazo local de PA-1224 (sus unitarios).
 *
 * Hasta que la tarjeta Tutorial exista (commit 4), el ejemplo se prende
 * importando el MISMO módulo que usa la app: Vite sirve una instancia por URL.
 *
 * Y cada punto tiene su control positivo en este mismo archivo: con una mesa de
 * verdad, sin el ejemplo, lo que el ejemplo esconde aparece y lo que corta sale.
 */

interface Llamada { readonly metodo: string; readonly clase: string; readonly codigo: string | null }

async function espiarLaFachada(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const rutaApi = '/src/api/index.ts';
    const rutaClases = '/src/ayuda/ejemplo/apiEjemplo.ts';
    const { api } = await import(/* @vite-ignore */ rutaApi) as { api: Record<string, (...a: unknown[]) => unknown> };
    const { CLASIFICACION_DEL_EJEMPLO } = await import(/* @vite-ignore */ rutaClases) as {
      CLASIFICACION_DEL_EJEMPLO: Record<string, string>;
    };
    const w = window as unknown as { __llamadas: Llamada[] };
    w.__llamadas = [];
    for (const [metodo, clase] of Object.entries(CLASIFICACION_DEL_EJEMPLO)) {
      const original = api[metodo]!;
      api[metodo] = (...args: unknown[]) => {
        w.__llamadas.push({ metodo, clase, codigo: typeof args[0] === 'string' ? args[0] : null });
        return original(...args);
      };
    }
  });
}

const llamadas = (page: Page) => page.evaluate(() => (window as unknown as { __llamadas: Llamada[] }).__llamadas);
const vaciarLlamadas = (page: Page) => page.evaluate(() => { (window as unknown as { __llamadas: Llamada[] }).__llamadas = []; });

/** Lo escrito: el estado del mock en memoria y todo `localStorage`. */
async function escrito(page: Page): Promise<{ store: string; storage: Record<string, string> }> {
  return page.evaluate(async () => {
    const rutaStore = '/src/api/mock/store.ts';
    const { state } = await import(/* @vite-ignore */ rutaStore) as { state: unknown };
    const storage: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i += 1) {
      const clave = localStorage.key(i)!;
      storage[clave] = localStorage.getItem(clave)!;
    }
    return { store: JSON.stringify(state), storage };
  });
}

/** La fase del ejemplo (la que va a leer la guía). */
const fase = (page: Page) => page.evaluate(async () => {
  const ruta = '/src/ayuda/ejemplo/estadoEjemplo.ts';
  const { ejemploLocal } = await import(/* @vite-ignore */ ruta) as { ejemploLocal: { leer: () => { fase: string } } };
  return ejemploLocal.leer().fase;
});

async function empezarElEjemplo(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const ruta = '/src/ayuda/ejemplo/estadoEjemplo.ts';
    const { ejemploLocal } = await import(/* @vite-ignore */ ruta) as { ejemploLocal: { empezar: () => void } };
    ejemploLocal.empezar();
  });
}

/** Cuenta los pedidos HTTP a `/api/` desde que se llama. */
function contarPedidosALaApi(page: Page): () => number {
  let pedidos = 0;
  page.on('request', (r) => { if (new URL(r.url()).pathname.startsWith('/api/')) pedidos += 1; });
  return () => pedidos;
}

async function preparar(page: Page): Promise<void> {
  await relojFueraDeLasFechasDeLosViajes(page);
  // Sin garantía (los pagos apagados de hoy), como la mesa de ejemplo: el control positivo usa la misma forma.
  await page.addInitScript(() => localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled'));
  await ingresar(page);
  await espiarLaFachada(page);
}

/** 2a → 2b → 3a: Escanear, la foto (no se lee) y la hoja del ticket abierta por estado. */
async function hastaElTicketDeEjemplo(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Escanear', exact: true }).click();
  await sacarFoto(page, undefined, { usar: false });
  const hoja = page.getByRole('dialog', { name: /Ticket/ });
  await expect(hoja).toBeVisible();
  await expect(hoja.getByText('Restaurante Ejemplo', { exact: true })).toBeVisible();
  for (const plato of ['Tagliatelle Bolognese', 'Risotto ai Funghi', 'Pizza Margherita']) {
    await expect(hoja.getByText(plato, { exact: true })).toBeVisible();
  }
  await expect(page.locator('.ticket-title-amount')).toHaveText('$600');
  // Sin recorte (la foto no se decodifica) y sin editar el ticket (D367).
  await expect(page.getByRole('group', { name: 'Marco del recorte' })).toHaveCount(0);
  await expect(hoja.getByRole('button', { name: 'Modificar ítems' })).toHaveCount(0);
  expect(await fase(page)).toBe('ticket');
  await page.getByRole('button', { name: 'Cerrar hoja del ticket' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => fase(page)).toBe('dividir');
}

/** 2d · Compartir sin link, sin invitar y sin propina; la mesa es PA-1224. */
async function compartirDelEjemplo(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Compartir la mesa' })).toBeVisible();
  await expect(page.locator('.share-code-txt')).toHaveText('PA-1224');
  expect(await fase(page)).toBe('compartir');
  for (const nombre of ['Copiar link', 'Reintentar el mismo link']) {
    await expect(page.getByRole('button', { name: nombre })).toHaveCount(0);
  }
  // El panel de invitar amigos (InviteFriends) no se monta.
  await expect(page.getByRole('tablist', { name: 'Elegir a quién invitar' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'WhatsApp' })).toHaveCount(0);
  await expect(page.getByText('No pudimos generar el link')).toHaveCount(0);
  await expect(page.getByText(/propina/i)).toHaveCount(0);
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
}

/** 2e · «Tu mesa» del titular, sin engranaje, sin solicitudes y sin «Cerrar mesa». */
async function tuMesaDelEjemplo(page: Page): Promise<void> {
  await enTuMesaConLaLista(page);
  await expect(page).toHaveURL(/\/mesa\/PA-1224$/);
  await expect.poll(() => fase(page)).toBe('mesa');
  await expect(page.getByRole('button', { name: 'Configuración de la mesa' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cerrar mesa' })).toHaveCount(0);
  await expect(page.getByText('Solicitudes para unirse')).toHaveCount(0);
  await expect(page.getByText(/propina/i)).toHaveCount(0);
}

function sinRedEnLaFachada(lista: readonly Llamada[]): void {
  expect(lista.filter((l) => l.clase === 'cortado'), 'ningún pedido cortado').toEqual([]);
  expect(lista.filter((l) => l.clase === 'local' && l.codigo?.toUpperCase() !== 'PA-1224'), 'locales sólo de PA-1224').toEqual([]);
}

test.describe('D363 · el ejemplo no sale a la red ni escribe', () => {
  test('🔴 por lo que pidió cada uno: de Escanear a Inicio, cero pedidos, cero escrituras y el «Listo» no cierra', async ({ page }) => {
    await preparar(page);
    const pedidos = contarPedidosALaApi(page);
    const antes = await escrito(page);
    await vaciarLlamadas(page);
    await empezarElEjemplo(page);

    await hastaElTicketDeEjemplo(page);
    await page.getByRole('radio', { name: /Por lo que pidió cada uno/ }).click();
    await page.getByRole('button', { name: 'Un comensal más' }).click();
    await expect(page.getByRole('group', { name: '¿Cuántos son en la mesa?', exact: true }).locator('.val')).toHaveText('1');
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await compartirDelEjemplo(page);
    await tuMesaDelEjemplo(page);

    // Los tres platos: sin la bandera, esto abriría «Con esto se cierra la mesa» (control abajo).
    const renglones = page.locator('.qc-lista .qc-renglon');
    await expect(renglones).toHaveCount(3);
    for (let i = 0; i < 3; i += 1) await renglones.nth(i).getByRole('button').first().click();
    await expect(page.locator('.qc-lista .qc-renglon [data-estado="mio"]')).toHaveCount(3);
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    await expect.poll(() => page.evaluate(() => location.pathname)).toBe('/home');
    await expect(page.getByRole('dialog', { name: 'Con esto se cierra la mesa' })).toHaveCount(0);
    expect(await fase(page)).toBe('listo');

    const lista = await llamadas(page);
    sinRedEnLaFachada(lista);
    // Control: el camino local sí se recorrió (si no, lo de arriba no diría nada).
    expect(lista.some((l) => l.metodo === 'getMesa' && l.codigo === 'PA-1224')).toBe(true);
    expect(lista.some((l) => l.metodo === 'lockItems' && l.codigo === 'PA-1224')).toBe(true);
    expect(lista.some((l) => l.metodo === 'getMesaParticipants' && l.codigo === 'PA-1224')).toBe(true);
    expect(camarasAbiertas(page)).toBeGreaterThan(0);
    expect(await escrito(page)).toEqual(antes);
    expect(pedidos()).toBe(0);
  });

  test('🔴 en partes iguales: la selección informativa se guarda en memoria y nada sale', async ({ page }) => {
    await preparar(page);
    const pedidos = contarPedidosALaApi(page);
    const antes = await escrito(page);
    await vaciarLlamadas(page);
    await empezarElEjemplo(page);

    await hastaElTicketDeEjemplo(page);
    // Volver desde ¿Cómo dividen? es volver a Escanear: la fase también vuelve, y otra foto trae el mismo ticket.
    await page.getByRole('button', { name: 'Volver', exact: true }).click();
    await expect.poll(() => fase(page)).toBe('foto');
    await page.getByRole('button', { name: 'Sacar foto', exact: true }).click();
    await sacarFoto(page, undefined, { usar: false });
    await page.getByRole('button', { name: 'Cerrar hoja del ticket' }).click();
    await expect.poll(() => fase(page)).toBe('dividir');
    await page.getByRole('radio', { name: /En partes iguales/ }).click();
    await page.getByRole('button', { name: 'Un comensal más' }).click();
    await expect(page.getByRole('group', { name: /¿Cuántos pagan\?/ })).toContainText('2');
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await compartirDelEjemplo(page);
    await tuMesaDelEjemplo(page);

    await page.getByRole('button', { name: /^Tagliatelle Bolognese(,|$)/ }).click();
    await page.getByRole('radio', { name: '½', exact: true }).click();
    await page.getByRole('button', { name: 'Listo', exact: true }).click();
    await expect.poll(() => page.evaluate(() => location.pathname)).toBe('/home');

    const lista = await llamadas(page);
    sinRedEnLaFachada(lista);
    expect(lista.some((l) => l.metodo === 'getInformativeSelection' && l.codigo === 'PA-1224')).toBe(true);
    expect(lista.some((l) => l.metodo === 'replaceInformativeSelection' && l.codigo === 'PA-1224')).toBe(true);
    // Lo guardado quedó en la memoria del ejemplo, no en el mock.
    const guardado = await page.evaluate(async () => {
      const ruta = '/src/ayuda/ejemplo/estadoEjemplo.ts';
      const { ejemploLocal } = await import(/* @vite-ignore */ ruta) as {
        ejemploLocal: { leer: () => { fase: string; seleccion: Map<string, number> } };
      };
      const estado = ejemploLocal.leer();
      return { fase: estado.fase, seleccion: [...estado.seleccion.values()] };
    });
    expect(guardado).toEqual({ fase: 'listo', seleccion: [5000] });
    expect(await escrito(page)).toEqual(antes);
    expect(pedidos()).toBe(0);
  });

  test('sin el ejemplo, /mesa/PA-1224 vuelve a Inicio y no se pide la mesa', async ({ page }) => {
    await preparar(page);
    const antes = await escrito(page);
    await vaciarLlamadas(page);
    await page.evaluate(() => {
      history.pushState(null, '', '/mesa/PA-1224');
      window.dispatchEvent(new Event('popstate'));
    });
    await expect.poll(() => page.evaluate(() => location.pathname)).toBe('/home');
    await expect(page.getByRole('button', { name: 'Escanear', exact: true })).toBeVisible();
    const lista = await llamadas(page);
    expect(lista.filter((l) => l.codigo?.toUpperCase() === 'PA-1224')).toEqual([]);
    expect(await escrito(page)).toEqual(antes);
  });

  test('con el QR de un restaurante: sin el ejemplo se lee el restaurante; con el ejemplo, no', async ({ page }) => {
    await relojFueraDeLasFechasDeLosViajes(page);
    await page.addInitScript(() => localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled'));
    // Como `ingresar`, pero entrando por el QR del primer restaurante del mock.
    await omitirGuiaEnFixture(page);
    await camaraSimulada(page);
    await page.goto('/?r=b0000000-0000-4000-8000-000000000001');
    await page.getByLabel('Email', { exact: true }).fill('mati@payme.mx');
    await page.getByLabel('Contraseña', { exact: true }).fill('demo-e2e');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Escanear', exact: true })).toBeVisible();
    await espiarLaFachada(page);
    // Control: sin el ejemplo, la cámara con QR pide el restaurante.
    await page.getByRole('button', { name: 'Escanear', exact: true }).click();
    await expect.poll(async () => (await llamadas(page)).some((l) => l.metodo === 'getRestaurant')).toBe(true);
    await page.getByRole('button', { name: 'Volver', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Escanear', exact: true })).toBeVisible();
    await vaciarLlamadas(page);
    await empezarElEjemplo(page);
    await hastaElTicketDeEjemplo(page);
    sinRedEnLaFachada(await llamadas(page));
  });

  test('control positivo · con una mesa de verdad, lo que el ejemplo esconde aparece y lo que corta sale', async ({ page }) => {
    await preparar(page);
    await vaciarLlamadas(page);
    await page.getByRole('button', { name: 'Escanear', exact: true }).click();
    await sacarFoto(page);
    // La foto sí se lee: el recorte apareció y se llamó al OCR.
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

    await enTuMesaConLaLista(page);
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
  });
});
