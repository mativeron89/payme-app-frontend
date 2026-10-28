import { expect, test, type Locator, type Page } from '@playwright/test';
import { ingresar, irEnLaApp, omitirGuiaEnFixture, relojFueraDeLasFechasDeLosViajes } from './_app';
import { camaraSimulada, FOTO_DE_CAMARA, sacarFoto } from './_camara';

/**
 * D484 · D486 · varias fotos de un ticket largo, en el mock con la capacidad
 * `payme.app.mock.ocr_pages.v1 = encendido` (el bloque `features.ocr_pages` del
 * dueño 2.196.0: hasta 4 fotos y 24 MiB entre todas).
 *
 * - El escaneo: D547 · las fotos de la cámara pasan primero por la pantalla al
 *   volver («Sacar otra» y el ✓) y después por el recuadro, una por una
 *   («Siguiente foto»); la tira numerada, «Leer ticket (N fotos)», el tope de 4,
 *   una parte rechazada que se repite en su lugar y el aviso de que las fotos se
 *   superponían. Lo propio de la pantalla al volver está en
 *   `fotos-al-volver-d547.spec.ts`.
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

/**
 * La capacidad de varias fotos llega con la config, que el mock carga con su demora: en el teléfono la cámara tarda
 * segundos y siempre llega antes, pero acá la foto «se saca» al instante. Sin esperarla, la foto llega sin la
 * capacidad y va directo al recuadro (lo de siempre).
 */
async function esperarCapacidad(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(async () => {
    const ruta = '/src/api/ocrPaginas.ts';
    const m = await import(/* @vite-ignore */ ruta) as { capacidadOcrPaginas: () => unknown };
    return m.capacidadOcrPaginas() !== null;
  }), { message: 'la capacidad de varias fotos no llegó' }).toBe(true);
}

/** La foto llega al marco (sin tocar «Usar foto»): sin la capacidad, o repitiendo una parte. */
async function fotoAlMarco(page: Page): Promise<void> {
  await sacarFoto(page, undefined, { usar: false });
  await expect(marco(page)).toBeVisible();
}

const alVolver = (page: Page) => page.locator('.fotos-al-volver');

/**
 * D547 · `n` fotos con la cámara: la primera con la cámara que ya está abierta y las demás con «Sacar otra» de la
 * pantalla al volver. Después, el ✓: la primera al recuadro.
 */
async function fotosAlRecuadro(page: Page, n: number): Promise<void> {
  await esperarCapacidad(page);
  for (let i = 1; i <= n; i++) {
    if (i > 1) await alVolver(page).getByRole('button', { name: /^(Sacar otra|Take another)$/ }).click();
    await sacarFoto(page, FOTO_DE_CAMARA, { usar: false });
    await expect(alVolver(page).getByRole('list').getByRole('listitem')).toHaveCount(i);
  }
  await alVolver(page).getByRole('button', { name: /^(Listo, ajustar el recuadro|Done, adjust the frame)$/ }).click();
  await expect(marco(page)).toBeVisible();
}

/** D547 · «Siguiente foto»: la del recuadro va a la tira y la que sigue llega al marco. */
async function siguienteFoto(page: Page, enLaTira: number): Promise<void> {
  await page.getByRole('button', { name: /^(Siguiente foto|Next photo)$/ }).click();
  await expect(tira(page).getByRole('listitem')).toHaveCount(enLaTira);
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
    await fotosAlRecuadro(page, 2);
    // D547 · en el recuadro de la tanda no van «Sacar otra» ni «Agregar otra parte»: las fotos ya se sacaron.
    await expect(agregar(page)).toHaveCount(0);
    await expect(page.getByText('Parte 1: ajusta el marco para dejar sólo esa parte', { exact: true })).toBeVisible();
    await siguienteFoto(page, 1);
    await expect(tira(page).getByRole('listitem').first()).toContainText('Parte 1');
    await expect(page.getByText('Parte 2: ajusta el marco para dejar sólo esa parte', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Leer ticket (2 fotos)', exact: true }).click();
    await expect(ticketListo(page)).toBeVisible({ timeout: 20_000 });
    const [lectura] = await lecturas(page);
    expect(lectura!.partes).toBe(2);
    expect(lectura!.tipos).toEqual(['image/jpeg', 'image/jpeg']);
    for (const b of lectura!.bytes) expect(b).toBeLessThanOrEqual(3_000_000);
  });

  test('D547 · mientras se recorren las fotos de la tanda, ✕ de la tira no se puede tocar', async ({ page }) => {
    await fotosAlRecuadro(page, 3);
    await siguienteFoto(page, 1);
    await siguienteFoto(page, 2);
    await expect(page.getByRole('button', { name: 'Quitar la parte 2', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Leer ticket (3 fotos)', exact: true })).toBeVisible();
  });

  test('🔴 el tope del dueño: con la cuarta, «Sacar otra» deshabilitado con su línea, y se leen las cuatro', async ({ page }) => {
    await esperarCapacidad(page);
    for (let i = 1; i <= 4; i++) {
      if (i > 1) await alVolver(page).getByRole('button', { name: 'Sacar otra', exact: true }).click();
      await sacarFoto(page, FOTO_DE_CAMARA, { usar: false });
    }
    await expect(alVolver(page).getByRole('button', { name: 'Sacar otra', exact: true })).toBeDisabled();
    await expect(alVolver(page).getByText('Ya tienes 4 fotos, el máximo por ticket.', { exact: true })).toBeVisible();
    await alVolver(page).getByRole('button', { name: 'Listo, ajustar el recuadro', exact: true }).click();
    await expect(marco(page)).toBeVisible();
    for (const n of [1, 2, 3]) await siguienteFoto(page, n);
    await page.getByRole('button', { name: 'Leer ticket (4 fotos)', exact: true }).click();
    await expect(ticketListo(page)).toBeVisible({ timeout: 20_000 });
    expect((await lecturas(page))[0]!.partes).toBe(4);
  });

  test('🔴 una parte rechazada (`page_index`): se marca, «Repetir la parte 2» la reemplaza en su lugar y se vuelve a leer', async ({ page }) => {
    await page.evaluate((k) => localStorage.setItem(k, 'parte_invalida'), LECTURA);
    await fotosAlRecuadro(page, 2);
    await siguienteFoto(page, 1);
    await page.getByRole('button', { name: 'Leer ticket (2 fotos)', exact: true }).click();
    const aviso = page.getByRole('alert').filter({ hasText: 'No pudimos leer la parte 2' });
    await expect(aviso).toBeVisible({ timeout: 20_000 });
    await expect(tira(page).getByRole('listitem').nth(1)).toHaveClass(/camara-parte--error/);
    await expect(tira(page).getByRole('listitem').nth(0)).not.toHaveClass(/camara-parte--error/);
    // El aviso genérico de foto chica no se repite.
    await expect(page.getByText('La foto es demasiado pequeña para leer el ticket.', { exact: true })).toHaveCount(0);
    await page.evaluate((k) => localStorage.removeItem(k), LECTURA);
    await aviso.getByRole('button', { name: 'Repetir la parte 2', exact: true }).click();
    // D547 · la foto que repite una parte va directo al recuadro, en su lugar: sin la pantalla al volver.
    await fotoAlMarco(page);
    await expect(alVolver(page)).toHaveCount(0);
    await expect(agregar(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Leer ticket (2 fotos)', exact: true }).click();
    await expect(ticketListo(page)).toBeVisible({ timeout: 20_000 });
    expect((await lecturas(page)).map((l) => l.partes)).toEqual([2, 2]);
  });

  test('`pages_overlap_uncertain`: no cuadra con el total y se avisa que las fotos se superponían', async ({ page }) => {
    await page.evaluate((k) => localStorage.setItem(k, 'solape_incierto'), LECTURA);
    await fotosAlRecuadro(page, 2);
    await siguienteFoto(page, 1);
    await page.getByRole('button', { name: 'Leer ticket (2 fotos)', exact: true }).click();
    await expect(ticketListo(page)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Las fotos se superponían: revisa que ningún plato quede repetido.', { exact: true })).toBeVisible();
    await expect(page.getByText(/Checa que el total coincida con el total del ticket: /)).toBeVisible();
    // D509 · la validación de números: el renglón leído dos veces vale justo lo que sobra, y las dos copias quedan
    // marcadas para revisar. No se corrige nada sola: siguen las dos.
    const dudosas = page.locator('.tk-row[data-duda="repetida"]');
    await expect(dudosas).toHaveCount(2);
    for (const fila of await dudosas.all()) {
      await expect(fila).toContainText('Vino tinto (copa)');
      await expect(fila.getByRole('img', { name: '¿Está repetido? Revísalo con el ticket.', exact: true })).toBeVisible();
    }
    await expect(page.locator('.tk-row[data-duda]')).toHaveCount(2);
    await capturar(page, 'd509-filas-dudosas');
  });

  test('D547 · la cámara se cancela en «Sacar otra»: queda la pantalla con la foto que había y se lee con una', async ({ page }) => {
    await esperarCapacidad(page);
    await sacarFoto(page, FOTO_DE_CAMARA, { usar: false });
    // Se abre la cámara y la persona la cierra sin sacar foto: nunca llega nada.
    await alVolver(page).getByRole('button', { name: 'Sacar otra', exact: true }).click();
    await expect(alVolver(page).getByRole('list').getByRole('listitem')).toHaveCount(1);
    await alVolver(page).getByRole('button', { name: 'Listo, ajustar el recuadro', exact: true }).click();
    await expect(marco(page)).toBeVisible();
    await page.getByRole('button', { name: 'Usar foto', exact: true }).click();
    await expect(ticketListo(page)).toBeVisible({ timeout: 20_000 });
    expect((await lecturas(page))[0]!.partes).toBe(1);
  });

  test('con la capacidad, la galería sigue igual: su foto va directo al marco, con «Agregar otra parte»', async ({ page }) => {
    await esperarCapacidad(page);
    await page.locator('.screen.camara input[type="file"]').setInputFiles(FOTO_DE_CAMARA);
    await expect(marco(page)).toBeVisible();
    await expect(alVolver(page)).toHaveCount(0);
    await expect(agregar(page)).toHaveText('Agregar otra parte');
    await expect(page.getByRole('button', { name: 'Elegir otra', exact: true })).toBeVisible();
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
    await fotosAlRecuadro(page, 2);
    await siguienteFoto(page, 1);
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
      await expect(page.locator('.tu-mesa').filter({ hasText: 'Tacos El Güero' }).locator('.miniatura-ticket-partes'))
        .toHaveText(es ? '2 fotos' : '2 photos');
      // Una sola parte (la del seed, sin foto): sin marca.
      await expect(page.locator('.tu-mesa').filter({ hasText: 'La Parolaccia' }).locator('.miniatura-ticket-partes')).toHaveCount(0);
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

      // Pasar de ticket va por la flecha de la franja: el otro ticket tiene sus propias partes, desde la primera.
      await visor.getByRole('button', { name: es ? 'Ticket anterior' : 'Previous receipt', exact: true }).click();
      await expect(titulo).not.toHaveText(tituloAntes!);
      await expect(parte).toHaveText(es ? 'Parte 1 de 2' : 'Part 1 of 2');
      // Y al volver, la primera parte.
      await visor.getByRole('button', { name: es ? 'Ticket siguiente' : 'Next receipt', exact: true }).click();
      await expect(parte).toHaveText(de(1));
    });

    test(`🔴 en la última parte de un ticket que NO es el último, deslizar no salta al ticket siguiente (${idioma})`, async ({ page }) => {
      const es = idioma === 'es';
      // Tacos El Güero (2 partes) va antes que Café Tacuba en el visor: hay un ticket siguiente al que se podría saltar.
      await page.locator('.tu-mesa').filter({ hasText: 'Tacos El Güero' }).locator('button.fila-ticket-foto').click();
      const visor = page.getByRole('dialog');
      const titulo = visor.locator('#visor-ticket-titulo');
      const parte = visor.locator('.visor-ticket-partes-texto');
      const escenario = visor.locator('.visor-ticket-escenario');
      const siguiente = visor.getByRole('button', { name: es ? 'Ticket siguiente' : 'Next receipt', exact: true });
      // Control: este ticket tiene uno siguiente.
      await expect(siguiente).toBeVisible();
      await expect(parte).toHaveText(es ? 'Parte 1 de 2' : 'Part 1 of 2');
      await imagenCargada(visor.locator('img.visor-ticket-foto'));
      const tituloAntes = (await titulo.textContent())!;
      await deslizar(page, escenario, 'izquierda');
      await expect(parte).toHaveText(es ? 'Parte 2 de 2' : 'Part 2 of 2');
      await imagenCargada(visor.locator('img.visor-ticket-foto'));
      // En la última parte, dos deslizamientos más: se queda en la última parte del MISMO ticket.
      await deslizar(page, escenario, 'izquierda');
      await deslizar(page, escenario, 'izquierda');
      await expect(parte).toHaveText(es ? 'Parte 2 de 2' : 'Part 2 of 2');
      await expect(titulo).toHaveText(tituloAntes);
      await expect(siguiente).toBeVisible();
      await expect(visor.locator('img.visor-ticket-foto')).toHaveAttribute('data-parte', '1');
      // Control positivo: la flecha sí pasa al ticket siguiente.
      await siguiente.click();
      await expect(titulo).not.toHaveText(tituloAntes);
      await expect(parte).toHaveText(es ? 'Parte 1 de 3' : 'Part 1 of 3');
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
        await fotosAlRecuadro(page, 3);
        await capturar(page, `${idioma}-marco-parte-1`);
        for (const n of [1, 2]) await siguienteFoto(page, n);
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
