import { expect, test, type Locator, type Page } from '@playwright/test';
import { ingresar, irEnLaApp, omitirGuiaEnFixture, relojFueraDeLasFechasDeLosViajes } from './_app';
import { camaraSimulada, FOTO_DE_CAMARA, sacarFoto } from './_camara';

/**
 * D484 · D486 · varias fotos de un ticket largo, en el mock con la capacidad
 * `payme.app.mock.ocr_pages.v1 = encendido` (el bloque `features.ocr_pages` del
 * dueño 2.196.0: hasta 4 fotos y 24 MiB entre todas).
 *
 * - El escaneo: «Agregar otra parte», la tira numerada con ✕, «Leer ticket (N
 *   fotos)», el tope de 4, una parte rechazada que se repite en su lugar y el
 *   aviso de que las fotos se superponían.
 * - Viajes (M4): la misma pantalla, hasta «Ticket nuevo».
 * - 🔴 El visor (M5, «Deslizando de costado»): en un ticket de varias partes,
 *   deslizar pasa de parte y se frena en los bordes; pasar de ticket va por las
 *   flechas de la franja. Y la marca «3 fotos» en la fila de Mesas.
 * - Sin la capacidad, la pantalla de siempre.
 *
 * Capturas para Mati (390 y 1280, ES y EN) sólo con `PAYME_E2E_CAPTURAS`.
 */

const PAGINAS = 'payme.app.mock.ocr_pages.v1';
const LECTURA = 'payme.app.mock.ocr_pages.lectura.v1';
const FOTO = 'payme.app.mock.ticket_image.v1';
const CANCUN = 'd1000000-0000-4000-8000-000000000001';

const ticketListo = (page: Page) => page.getByRole('radiogroup', { name: '¿Cómo dividen?' });
const tira = (page: Page) => page.getByRole('list', { name: /^(Partes del ticket|Parts of the receipt)$/ });
const agregar = (page: Page) => page.locator('button.camara-agregar-parte');
const marco = (page: Page) => page.getByRole('group', { name: /^(Marco del recorte|Crop frame)$/ });

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/d486-${page.viewportSize()!.width}-${nombre}.png`, animations: 'disabled' });
}

async function seams(page: Page, valores: Record<string, string>): Promise<void> {
  await page.addInitScript((v) => {
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
    for (const [k, x] of Object.entries(v)) localStorage.setItem(k, x);
  }, valores);
}

/** Guarda las fotos que la fachada recibe para leer (una o la lista de partes). */
async function espiarOcr(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const ruta = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ ruta) as { api: Record<string, (...a: unknown[]) => Promise<unknown>> };
    const w = window as unknown as { __lecturas: Array<{ partes: number; bytes: number[]; tipos: string[] }> };
    w.__lecturas = [];
    const original = api.scanTicket!.bind(api);
    api.scanTicket = (...args: unknown[]) => {
      const fotos = Array.isArray(args[0]) ? args[0] as Blob[] : [args[0] as Blob];
      w.__lecturas.push({ partes: fotos.length, bytes: fotos.map((f) => f.size), tipos: fotos.map((f) => f.type) });
      return original(...args);
    };
  });
}

const lecturas = (page: Page) => page.evaluate(
  () => (window as unknown as { __lecturas: Array<{ partes: number; bytes: number[]; tipos: string[] }> }).__lecturas,
);

async function abrirEscaneo(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Escanear', exact: true }).click();
  await expect(page).toHaveURL(/:\d+\/scan$/);
}

/** La foto llega al marco (sin tocar «Usar foto»). */
async function fotoAlMarco(page: Page): Promise<void> {
  await sacarFoto(page, undefined, { usar: false });
  await expect(marco(page)).toBeVisible();
}

/**
 * «Agregar otra parte»: la del marco va a la tira y, en el mismo toque, se abre el selector para la siguiente, que llega
 * al marco. Es la cámara si la del marco vino de la cámara, o la galería si vino del menú del teléfono (D368: el
 * «Escanear» de la barra), así que se toma el selector que se abra.
 */
async function otraParte(page: Page, enLaTira: number): Promise<void> {
  const [selector] = await Promise.all([page.waitForEvent('filechooser'), agregar(page).click()]);
  await expect(tira(page).getByRole('listitem')).toHaveCount(enLaTira);
  await selector.setFiles(FOTO_DE_CAMARA);
  await expect(marco(page)).toBeVisible();
}

test.describe('D484 · sin la capacidad', () => {
  test('🔴 la pantalla de siempre: «Usar foto» y ninguna parte', async ({ page }) => {
    await relojFueraDeLasFechasDeLosViajes(page);
    await ingresar(page);
    await abrirEscaneo(page);
    await fotoAlMarco(page);
    await expect(agregar(page)).toHaveCount(0);
    await expect(tira(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Usar foto', exact: true })).toBeVisible();
  });
});

test.describe('D484 · D486 · el escaneo de un ticket largo', () => {
  test.beforeEach(async ({ page }) => {
    await seams(page, { [PAGINAS]: 'encendido' });
    await relojFueraDeLasFechasDeLosViajes(page);
    await ingresar(page);
    await espiarOcr(page);
    await abrirEscaneo(page);
  });

  test('🔴 dos partes: la tira, «Leer ticket (2 fotos)» y la lectura con las dos, de hasta 3 MB, en JPEG', async ({ page }) => {
    await fotoAlMarco(page);
    await expect(agregar(page)).toHaveText('Agregar otra parte');
    await otraParte(page, 1);
    await expect(tira(page).getByRole('listitem').first()).toContainText('Parte 1');
    await expect(page.getByText('Parte 2: ajusta el marco para dejar sólo esa parte', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Leer ticket (2 fotos)', exact: true }).click();
    await expect(ticketListo(page)).toBeVisible({ timeout: 20_000 });
    const [lectura] = await lecturas(page);
    expect(lectura!.partes).toBe(2);
    expect(lectura!.tipos).toEqual(['image/jpeg', 'image/jpeg']);
    for (const b of lectura!.bytes) expect(b).toBeLessThanOrEqual(3_000_000);
  });

  test('quitar una parte con ✕: las demás siguen en su orden', async ({ page }) => {
    await fotoAlMarco(page);
    await otraParte(page, 1);
    await otraParte(page, 2);
    await page.getByRole('button', { name: 'Quitar la parte 2', exact: true }).click();
    await expect(tira(page).getByRole('listitem')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Leer ticket (2 fotos)', exact: true })).toBeVisible();
  });

  test('🔴 el tope del dueño: con la cuarta en el marco, «Hasta 4 fotos» deshabilitado y se leen las cuatro', async ({ page }) => {
    await fotoAlMarco(page);
    await otraParte(page, 1);
    await otraParte(page, 2);
    await otraParte(page, 3);
    await expect(agregar(page)).toBeDisabled();
    await expect(agregar(page)).toHaveText('Hasta 4 fotos');
    await page.getByRole('button', { name: 'Leer ticket (4 fotos)', exact: true }).click();
    await expect(ticketListo(page)).toBeVisible({ timeout: 20_000 });
    expect((await lecturas(page))[0]!.partes).toBe(4);
  });

  test('🔴 una parte rechazada (`page_index`): se marca, «Repetir la parte 2» la reemplaza en su lugar y se vuelve a leer', async ({ page }) => {
    await page.evaluate((k) => localStorage.setItem(k, 'parte_invalida'), LECTURA);
    await fotoAlMarco(page);
    await otraParte(page, 1);
    await page.getByRole('button', { name: 'Leer ticket (2 fotos)', exact: true }).click();
    const aviso = page.getByRole('alert').filter({ hasText: 'No pudimos leer la parte 2' });
    await expect(aviso).toBeVisible({ timeout: 20_000 });
    await expect(tira(page).getByRole('listitem').nth(1)).toHaveClass(/camara-parte--error/);
    await expect(tira(page).getByRole('listitem').nth(0)).not.toHaveClass(/camara-parte--error/);
    // El aviso genérico de foto chica no se repite.
    await expect(page.getByText('La foto es demasiado pequeña para leer el ticket.', { exact: true })).toHaveCount(0);
    await page.evaluate((k) => localStorage.removeItem(k), LECTURA);
    await aviso.getByRole('button', { name: 'Repetir la parte 2', exact: true }).click();
    await fotoAlMarco(page);
    await expect(agregar(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Leer ticket (2 fotos)', exact: true }).click();
    await expect(ticketListo(page)).toBeVisible({ timeout: 20_000 });
    expect((await lecturas(page)).map((l) => l.partes)).toEqual([2, 2]);
  });

  test('`pages_overlap_uncertain`: no cuadra con el total y se avisa que las fotos se superponían', async ({ page }) => {
    await page.evaluate((k) => localStorage.setItem(k, 'solape_incierto'), LECTURA);
    await fotoAlMarco(page);
    await otraParte(page, 1);
    await page.getByRole('button', { name: 'Leer ticket (2 fotos)', exact: true }).click();
    await expect(ticketListo(page)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Las fotos se superponían: revisa que ningún plato quede repetido.', { exact: true })).toBeVisible();
    await expect(page.getByText(/Checa que el total coincida con el total del ticket: /)).toBeVisible();
  });

  test('sin foto en el marco (la cámara se canceló), se leen las partes que hay', async ({ page }) => {
    await fotoAlMarco(page);
    await agregar(page).click();
    await expect(tira(page).getByRole('listitem')).toHaveCount(1);
    await expect(page.getByText('Saca la parte siguiente. Deja que se repitan una o dos líneas.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Leer ticket (1 foto)', exact: true }).click();
    await expect(ticketListo(page)).toBeVisible({ timeout: 20_000 });
    expect((await lecturas(page))[0]!.partes).toBe(1);
  });
});

test.describe('D486 · M4 · también en Viajes', () => {
  test.use({ timezoneId: 'America/Mexico_City' });

  test('🔴 dos partes de un ticket del viaje llegan a «Ticket nuevo»', async ({ page }) => {
    await omitirGuiaEnFixture(page);
    await seams(page, { [PAGINAS]: 'encendido', 'payme.app.mock.viajes.v1': 'encendido' });
    // Dentro de las fechas de Cancún 2026: «Escanear» va al viaje.
    await page.clock.setFixedTime(new Date('2026-10-10T14:00:00-06:00'));
    await camaraSimulada(page);
    await page.goto('/');
    await page.getByLabel('Email', { exact: true }).fill('mati@payme.mx');
    await page.getByLabel('Contraseña', { exact: true }).fill('demo-e2e');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    const alViaje = page.getByRole('button', { name: 'Escanear ticket para Cancún 2026', exact: true });
    await expect(alViaje).toBeVisible();
    await espiarOcr(page);
    await alViaje.click();
    await expect(page).toHaveURL(new RegExp(`/scan/${CANCUN}$`));
    await fotoAlMarco(page);
    await otraParte(page, 1);
    await page.getByRole('button', { name: 'Leer ticket (2 fotos)', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Ticket nuevo', level: 1 })).toBeVisible({ timeout: 20_000 });
    expect((await lecturas(page))[0]!.partes).toBe(2);
  });
});

/** Desliza de costado sobre el escenario del visor, como un dedo (eventos de puntero). */
async function deslizar(page: Page, escenario: Locator, hacia: 'izquierda' | 'derecha'): Promise<void> {
  const caja = (await escenario.boundingBox())!;
  const y = caja.y + caja.height / 2;
  const desde = hacia === 'izquierda' ? caja.x + caja.width * 0.8 : caja.x + caja.width * 0.2;
  const hasta = hacia === 'izquierda' ? caja.x + caja.width * 0.2 : caja.x + caja.width * 0.8;
  await page.mouse.move(desde, y);
  await page.mouse.down();
  await page.mouse.move((desde + hasta) / 2, y, { steps: 4 });
  await page.mouse.move(hasta, y, { steps: 4 });
  await page.mouse.up();
}

async function imagenCargada(img: Locator): Promise<void> {
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0)).toBe(true);
}

for (const idioma of ['es', 'en'] as const) {
  test.describe(`D486 · M5 · el visor con partes (${idioma})`, () => {
    test.beforeEach(async ({ page }) => {
      await seams(page, { [PAGINAS]: 'encendido', [FOTO]: 'encendido', 'payme.app.mock.mis_mesas.v1': 'sin_cobro' });
      await relojFueraDeLasFechasDeLosViajes(page);
      await ingresar(page);
      if (idioma === 'en') {
        await page.evaluate(() => localStorage.setItem('payme.app.idioma.v1', 'en'));
        await page.reload();
        await expect(page.getByRole('button', { name: 'Scan', exact: true })).toBeVisible();
      }
      await irEnLaApp(page, '/mesas');
      await expect(page.locator('.tu-mesa').first()).toBeVisible();
    });

    test(`🔴 la marca «3 fotos»; deslizar pasa de parte y se frena en los bordes; las flechas pasan de ticket (${idioma})`, async ({ page }) => {
      const es = idioma === 'es';
      const fila = page.locator('.tu-mesa').filter({ hasText: 'Café Tacuba' });
      await expect(fila.locator('.miniatura-ticket-partes')).toHaveText(es ? '3 fotos' : '3 photos');
      // Una sola parte: sin marca.
      await expect(page.locator('.tu-mesa').filter({ hasText: 'Tacos El Güero' }).locator('.miniatura-ticket-partes')).toHaveCount(0);
      await capturar(page, `${idioma}-fila-tres-fotos`);
      await fila.locator('button.fila-ticket-foto').click();
      const visor = page.getByRole('dialog');
      const titulo = visor.locator('#visor-ticket-titulo');
      const parte = visor.locator('.visor-ticket-partes-texto');
      const escenario = visor.locator('.visor-ticket-escenario');
      const de = (n: number) => (es ? `Parte ${n} de 3` : `Part ${n} of 3`);
      await expect(parte).toHaveText(de(1));
      await imagenCargada(visor.locator('img.visor-ticket-foto'));
      const tituloAntes = await titulo.textContent();
      await capturar(page, `${idioma}-visor-parte-1`);

      // Al principio, deslizar hacia atrás NO pasa al ticket anterior: se frena en la primera parte.
      await deslizar(page, escenario, 'derecha');
      await expect(parte).toHaveText(de(1));
      await expect(titulo).toHaveText(tituloAntes!);

      await deslizar(page, escenario, 'izquierda');
      await expect(parte).toHaveText(de(2));
      await expect(visor.locator('img.visor-ticket-foto')).toHaveAttribute('data-parte', '1');
      await imagenCargada(visor.locator('img.visor-ticket-foto'));
      await capturar(page, `${idioma}-visor-parte-2`);
      await deslizar(page, escenario, 'izquierda');
      await expect(parte).toHaveText(de(3));
      // En la última parte, deslizar tampoco salta de ticket.
      await deslizar(page, escenario, 'izquierda');
      await expect(parte).toHaveText(de(3));
      await expect(titulo).toHaveText(tituloAntes!);

      // Los botones de las partes, para quien no desliza.
      await visor.getByRole('button', { name: es ? 'Parte anterior' : 'Previous part', exact: true }).click();
      await expect(parte).toHaveText(de(2));

      // Pasar de ticket va por la flecha de la franja: el otro ticket tiene una sola foto y no muestra partes.
      await visor.getByRole('button', { name: es ? 'Ticket anterior' : 'Previous receipt', exact: true }).click();
      await expect(titulo).not.toHaveText(tituloAntes!);
      await expect(visor.locator('.visor-ticket-partes')).toHaveCount(0);
      // Y al volver, la primera parte.
      await visor.getByRole('button', { name: es ? 'Ticket siguiente' : 'Next receipt', exact: true }).click();
      await expect(parte).toHaveText(de(1));
    });
  });
}

/**
 * El recorrido entero a 390 y 1280, en ES y en EN: marco, tira de tres partes, parte rechazada y visor con partes.
 * Corre siempre (también vale como prueba de esos anchos); las capturas para Mati salen sólo con `PAYME_E2E_CAPTURAS`.
 */
for (const ancho of [390, 1280] as const) {
  for (const idioma of ['es', 'en'] as const) {
    test.describe(`D486 · el recorrido · ${ancho} · ${idioma}`, () => {
      test.use({ viewport: { width: ancho, height: ancho === 390 ? 844 : 900 } });

      test(`marco, tira, parte rechazada y visor (${ancho}, ${idioma})`, async ({ page }) => {
        await seams(page, { [PAGINAS]: 'encendido', [FOTO]: 'encendido', 'payme.app.mock.mis_mesas.v1': 'sin_cobro' });
        await relojFueraDeLasFechasDeLosViajes(page);
        await ingresar(page);
        const es = idioma === 'es';
        if (!es) {
          await page.evaluate(() => localStorage.setItem('payme.app.idioma.v1', 'en'));
          await page.reload();
          await expect(page.getByRole('button', { name: 'Scan', exact: true })).toBeVisible();
        }
        await page.getByRole('button', { name: es ? 'Escanear' : 'Scan', exact: true }).click();
        await fotoAlMarco(page);
        await capturar(page, `${idioma}-marco-agregar-parte`);
        for (const n of [1, 2]) await otraParte(page, n);
        await capturar(page, `${idioma}-tira-tres-partes`);
        await page.evaluate((k) => localStorage.setItem(k, 'parte_invalida'), LECTURA);
        await page.locator('button.camara-usar').click();
        await expect(page.locator('.camara-parte--error')).toBeVisible({ timeout: 20_000 });
        await capturar(page, `${idioma}-parte-rechazada`);
        await page.evaluate((k) => localStorage.removeItem(k), LECTURA);
        await irEnLaApp(page, '/mesas');
        await page.locator('.tu-mesa').filter({ hasText: 'Café Tacuba' }).locator('button.fila-ticket-foto').click();
        await imagenCargada(page.getByRole('dialog').locator('img.visor-ticket-foto'));
        await capturar(page, `${idioma}-visor-con-partes`);
      });
    });
  }
}
