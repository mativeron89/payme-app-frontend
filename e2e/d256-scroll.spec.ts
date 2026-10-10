import { expect, test, type Page } from '@playwright/test';
import { ingresar } from './_app';
import { sacarFoto } from './_camara';

/**
 * D256 · Mati, en la app de inicio de iOS, al entrar a un ticket ya cargado:
 * «No se movía nada». No se reprodujo fuera de su iPhone. Esta guarda recorre
 * los caminos por los que se entra a la pantalla del ticket, como app de inicio
 * (`navigator.standalone`, que pone la clase y la cadena de `100lvh`), a 375 px
 * y con un ticket largo, y mide en cada uno:
 *
 * - el contenedor de la lista desborda y es `overflow-y: auto`;
 * - el toque en el centro de la lista cae DENTRO de ese contenedor (ningún velo
 *   encima);
 * - ningún ancestro queda `inert`, con `pointer-events: none` o `touch-action:
 *   none`; no hay `[inert]` ni `body.style.overflow` residual;
 * - un arrastre táctil de verdad (CDP) mueve la lista, y el último renglón se
 *   alcanza y se puede elegir.
 *
 * En CI corre en Chromium (la CI instala sólo Chromium). La misma prueba se
 * corrió en WebKit en local como evidencia; ninguno de los dos es el iPhone.
 */

const CANCUN = 'd1000000-0000-4000-8000-000000000001';
const MARISCOS = 'd2000000-0000-4000-8000-000000000105';
const RENGLONES_DE_MAS = 20;

test.use({ viewport: { width: 375, height: 667 } });

async function comoAppDeInicio(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('payme.app.mock.viajes.v1', 'encendido');
    Object.defineProperty(Navigator.prototype, 'standalone', { configurable: true, get: () => true });
  });
  await ingresar(page);
  await expect(page.locator('html')).toHaveClass(/\bapp-de-inicio-ios\b/);
}

async function ir(page: Page, ruta: string): Promise<void> {
  await page.evaluate((u) => {
    history.pushState(null, '', u);
    dispatchEvent(new PopStateEvent('popstate'));
  }, ruta);
}

/** «Mariscos El Faro» con 20 renglones de más: la lista mide varias pantallas. */
async function alargarMariscos(page: Page): Promise<void> {
  await ir(page, `/viaje/${CANCUN}`);
  await expect(page.getByRole('heading', { name: 'Cancún 2026' })).toBeVisible();
  const items = await page.evaluate(({ ticketId, n }) => {
    const k = 'payme.app.mock.viajes.estado.v1';
    const e = JSON.parse(localStorage.getItem(k) ?? 'null') as
      { viajes: Array<{ tickets: Array<{ id: string; items: Array<Record<string, unknown>> }> }> } | null;
    const t = e?.viajes.flatMap((v) => v.tickets).find((x) => x.id === ticketId);
    if (!e || !t) return -1;
    for (let i = 0; i < n; i++) {
      t.items.push({ id: `d3ffffff-0000-4000-8000-${String(i).padStart(12, '0')}`, nombre: `Plato largo ${i + 1}`, price_cents: 10000 + i * 100, quantity: 1 });
    }
    localStorage.setItem(k, JSON.stringify(e));
    return t.items.length;
  }, { ticketId: MARISCOS, n: RENGLONES_DE_MAS });
  expect(items).toBeGreaterThan(RENGLONES_DE_MAS);
  // El mock lee su estado al cargar la página: se recarga una vez, y desde acá todo es navegación de la app.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Cancún 2026' })).toBeVisible();
}

interface Medicion {
  overflowY: string;
  desborda: boolean;
  centroDentro: boolean;
  enElCentro: string;
  freno: string | null;
  inertes: number;
  bodyOverflow: string;
  velos: number;
}

function medir(page: Page): Promise<Medicion> {
  return page.evaluate(() => {
    const s = document.querySelector<HTMLElement>('.app .scroll')!;
    const r = s.getBoundingClientRect();
    // Lo que se ve de la lista: el pie fijo («Te toca» y «Listo») tapa su parte de abajo.
    const pie = document.querySelector('.vj-pie')?.getBoundingClientRect();
    const abajo = pie ? Math.min(r.bottom, pie.top) : r.bottom;
    const arriba = document.elementFromPoint(r.left + r.width / 2, (r.top + abajo) / 2);
    let freno: string | null = null;
    for (let el: Element | null = arriba; el && !freno; el = el.parentElement) {
      const c = getComputedStyle(el);
      if ((el as HTMLElement).inert) freno = `${el.className} inert`;
      else if (c.pointerEvents === 'none') freno = `${el.className} pointer-events:none`;
      else if (c.touchAction === 'none' || c.touchAction === 'pan-x') freno = `${el.className} touch-action:${c.touchAction}`;
    }
    return {
      overflowY: getComputedStyle(s).overflowY,
      desborda: s.scrollHeight > s.clientHeight + 100,
      centroDentro: arriba !== null && s.contains(arriba),
      enElCentro: arriba ? `${arriba.tagName.toLowerCase()}.${String(arriba.className)}` : 'nada',
      freno,
      inertes: document.querySelectorAll('[inert]').length,
      bodyOverflow: document.body.style.overflow,
      velos: document.querySelectorAll('.sheet-overlay').length,
    };
  });
}

/**
 * Un arrastre de dedo de verdad, de abajo hacia arriba, sobre la lista. Es CDP: sólo Chromium. En otro navegador (la
 * corrida local en WebKit) va la rueda en el mismo punto, que mide que la lista desplaza pero no el gesto táctil.
 */
async function arrastrar(page: Page, dy: number): Promise<void> {
  const caja = (await page.locator('.app .scroll').boundingBox())!;
  // Arrancar arriba del pie fijo: arrastrar sobre el pie no mueve la lista (ni en el iPhone), y una
  // primera versión de esta prueba lo hacía y daba un rojo que no era de la app.
  const pie = await page.locator('.vj-pie').boundingBox();
  const x = Math.round(caja.x + caja.width / 2);
  const y0 = Math.round((pie ? pie.y : caja.y + caja.height) - 20);
  if (page.context().browser()?.browserType().name() !== 'chromium') {
    await page.mouse.move(x, y0);
    await page.mouse.wheel(0, dy);
    return;
  }
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
  const pasos = 12;
  for (let i = 1; i <= pasos; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: Math.round(y0 - (dy * i) / pasos) }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

const scrollTop = (page: Page) => page.locator('.app .scroll').evaluate((s) => s.scrollTop);

/** Lo que tiene que valer en la pantalla del ticket, se llegue como se llegue. */
async function seDesplaza(page: Page, { largo }: { largo: boolean }): Promise<void> {
  const m = await medir(page);
  expect(m, 'sin bloqueos residuales').toMatchObject({ overflowY: 'auto', centroDentro: true, freno: null, inertes: 0, bodyOverflow: '', velos: 0 });
  if (!largo) return;
  expect(m.desborda).toBe(true);
  const antes = await scrollTop(page);
  await arrastrar(page, 300);
  await expect.poll(() => scrollTop(page), { message: 'el arrastre táctil no movió la lista' }).toBeGreaterThan(antes + 100);
  // Al final de la lista, el pie no tapa el último renglón, y se puede elegir.
  await page.locator('.app .scroll').evaluate((s) => { s.scrollTop = s.scrollHeight; });
  const ultimo = page.getByRole('button', { name: `Plato largo ${RENGLONES_DE_MAS}`, exact: true });
  const fila = (await ultimo.boundingBox())!;
  const pie = await page.locator('.vj-pie').boundingBox();
  if (pie) expect(fila.y + fila.height, 'el pie tapa el último renglón').toBeLessThanOrEqual(pie.y);
  await ultimo.click();
  // Elegido: se abre su selector de porción, con «Entero» marcado.
  const porcion = page.getByRole('radiogroup', { name: `Porción de Plato largo ${RENGLONES_DE_MAS}`, exact: true });
  await expect(porcion.getByRole('radio', { name: 'Entero', exact: true })).toHaveAttribute('aria-checked', 'true');
}

test('🔴 D256 · desde Balance › Consumos: el ticket largo se desplaza con el dedo y el último renglón se elige', async ({ page }) => {
  await comoAppDeInicio(page);
  await alargarMariscos(page);
  await page.getByRole('button', { name: 'Ver balance del viaje', exact: true }).click();
  await page.locator('.vjb-consumo').filter({ hasText: 'Mariscos El Faro' }).click();
  await expect(page).toHaveURL(new RegExp(`/viaje-ticket/${CANCUN}\\.${MARISCOS}$`));
  await expect(page.getByRole('button', { name: `Plato largo ${RENGLONES_DE_MAS}`, exact: true })).toBeAttached();
  await seDesplaza(page, { largo: true });
});

test('🔴 D256 · desde el aviso del ticket: lo mismo', async ({ page }) => {
  await comoAppDeInicio(page);
  await alargarMariscos(page);
  await ir(page, '/avisos');
  await page.getByText('Luis Pérez cargó un ticket nuevo en Cancún 2026: Mariscos El Faro.', { exact: false }).click();
  await expect(page).toHaveURL(new RegExp(`/viaje-ticket/${CANCUN}\\.${MARISCOS}$`));
  await expect(page.getByRole('button', { name: `Plato largo ${RENGLONES_DE_MAS}`, exact: true })).toBeAttached();
  await seDesplaza(page, { largo: true });
});

test('🔴 D256 · después del panel de diagnóstico (una hoja): al cerrarlo no queda nada inerte, y el panel leyó la lista', async ({ page }) => {
  await comoAppDeInicio(page);
  await alargarMariscos(page);
  await ir(page, `/viaje-ticket/${CANCUN}.${MARISCOS}`);
  await expect(page.getByRole('button', { name: `Plato largo ${RENGLONES_DE_MAS}`, exact: true })).toBeAttached();
  const logo = page.locator('.hdr-mark-toques .hdr-mark').first();
  for (let i = 0; i < 5; i++) await logo.click();
  const panel = page.getByRole('dialog', { name: 'Diagnóstico de pantalla' });
  await expect(panel).toBeVisible();
  // Medido al abrir, antes de que el panel se pusiera encima.
  await expect(panel.locator('.diag-fila').filter({ hasText: 'al abrir · contenedor que scrollea' }).locator('dd')).toHaveText('div.scroll.vj-scroll');
  await expect(panel.locator('.diag-fila').filter({ hasText: 'al abrir · inert · pointer-events · touch-action' }).locator('dd')).toHaveText('none');
  await expect(panel.locator('.diag-fila').filter({ hasText: 'al abrir · [inert] · hojas abiertas' }).locator('dd')).toHaveText('0 · 0');
  await panel.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await seDesplaza(page, { largo: true });
});

/**
 * El camino de cargar un ticket nuevo (TicketNuevo → `replaceRoute`). «Elegir lo que consumí», cuando el ticket ya lo
 * había cargado otro, entra por el mismo `replaceRoute`; con la cámara del mock no se puede producir: en modo de
 * ejemplo no hay huella, y un segundo escaneo carga otro ticket.
 */
test('🔴 D256 · después de escanear y cargar un ticket nuevo, al entrar a elegir: sin bloqueos', async ({ page }) => {
  await comoAppDeInicio(page);
  await ir(page, `/viaje/${CANCUN}`);
  await page.getByRole('button', { name: 'Escanear ticket para Cancún 2026', exact: true }).click();
  await sacarFoto(page);
  await expect(page).toHaveURL(new RegExp(`/viaje-ticket-nuevo/${CANCUN}$`));
  await page.getByRole('button', { name: 'Compartir con el viaje', exact: true }).click();
  // Por consumo, al cargarlo entra a elegir.
  await expect(page).toHaveURL(new RegExp(`/viaje-ticket/${CANCUN}\\.`));
  await expect(page.locator('.qc-fila').first()).toBeVisible();
  await seDesplaza(page, { largo: false });
});
