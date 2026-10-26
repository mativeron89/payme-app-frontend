import { expect, test, type Locator, type Page } from '@playwright/test';
import { ingresar, irEnLaApp, relojFueraDeLasFechasDeLosViajes } from './_app';

/**
 * D481 · el paquete de Claude Design de la foto del ticket (D479; Mati aceptó las ocho recomendaciones), en el mock con
 * la capacidad encendida (`payme.app.mock.ticket_image.v1 = encendido`, 90 días + miniatura):
 *
 * - 2a · 2d · la fila de Mesas: miniatura (o ícono), nombre y monto; cargando y con error; la misma altura.
 * - 3b · la pantalla del ticket de una mesa: «Lo que elegiste», el pie «Elegiste» y «Ver detalle digital»; Volver
 *   regresa a la lista en la misma posición.
 * - 1c–1h · 1k · el visor: la franja, la píldora de zoom (P5, se recuerda), la vencida a su tamaño con el aviso debajo,
 *   la carga y el error sin el aviso, y «Ver consumos» ENCIMA del visor (la ✕ vuelve a la foto).
 * - 1i · el aviso del escaneo en su fila. 3d · la fila de la foto en el ticket de un viaje. 7 · 8 · la miniatura en
 *   Balance › Consumos y en las visitas de viaje.
 *
 * Capturas para Mati (390 y 1280, ES y EN) sólo con `PAYME_E2E_CAPTURAS`.
 */

const SEAM = 'payme.app.mock.ticket_image.v1';
const FALLAS = 'payme.app.mock.ticket_image.fallas.v1';
const ZOOM = 'payme.app.visor.ya_hizo_zoom.v1';
const CANCUN = 'd1000000-0000-4000-8000-000000000001';
const MARISCOS = 'd2000000-0000-4000-8000-000000000105';

async function capturar(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/d481-${page.viewportSize()!.width}-${nombre}.png`, animations: 'disabled' });
}

async function entrar(page: Page, extra: Record<string, string> = {}, idioma: 'es' | 'en' = 'es'): Promise<void> {
  await page.addInitScript(({ seam, extra: e }) => {
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
    localStorage.setItem('payme.app.mock.mis_mesas.v1', 'sin_cobro');
    localStorage.setItem(seam, 'encendido');
    for (const [k, v] of Object.entries(e)) localStorage.setItem(k, v);
  }, { seam: SEAM, extra });
  await relojFueraDeLasFechasDeLosViajes(page);
  await ingresar(page);
  if (idioma === 'en') {
    // El idioma, después de entrar (el formulario de ingreso se busca en español); se lee al arrancar.
    await page.evaluate(() => localStorage.setItem('payme.app.idioma.v1', 'en'));
    await page.reload();
    await expect(page.getByRole('button', { name: 'Scan', exact: true })).toBeVisible();
  }
}

async function aMesas(page: Page): Promise<void> {
  await irEnLaApp(page, '/mesas');
  await expect(page.locator('.tu-mesa').first()).toBeVisible();
}

const filaDe = (page: Page, nombre: string) => page.locator('.tu-mesa').filter({ hasText: nombre });

async function imagenCargada(img: Locator): Promise<void> {
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0)).toBe(true);
}

test.describe('D481 · 2a · 2d · la fila de Mesas', () => {
  test('🔴 nombre y monto, sin fecha ni estado; la flecha a la derecha; la misma altura con foto y sin foto; «—» sin consumos', async ({ page }) => {
    await entrar(page);
    await aMesas(page);
    const guero = filaDe(page, 'Tacos El Güero');
    await imagenCargada(guero.locator('.fila-ticket-foto img'));
    await expect(guero.locator('.fila-ticket-nombre')).toHaveText('Tacos El Güero');
    await expect(guero.locator('.fila-ticket-monto')).toHaveText('$450');
    await expect(guero).not.toContainText('Cerró sin cobro');
    await expect(guero).not.toContainText('Elegiste');
    // Sin foto (la del seed): el ícono en la misma columna, el texto arranca en el mismo x y la fila mide lo mismo.
    const sinFoto = filaDe(page, 'La Parolaccia').first();
    await expect(sinFoto.locator('.fila-ticket-monto--sin')).toHaveText('—');
    const [conCaja, sinCaja] = await Promise.all([guero.locator('button.fila-ticket').boundingBox(), sinFoto.locator('button.fila-ticket').boundingBox()]);
    expect(Math.abs(conCaja!.height - sinCaja!.height)).toBeLessThanOrEqual(1);
    expect(conCaja!.height).toBeGreaterThanOrEqual(76 - 1);
    const [xCon, xSin] = await Promise.all([
      guero.locator('.fila-ticket-nombre').evaluate((e) => e.getBoundingClientRect().left),
      sinFoto.locator('.fila-ticket-nombre').evaluate((e) => e.getBoundingClientRect().left),
    ]);
    expect(Math.abs(xCon - xSin)).toBeLessThanOrEqual(1);
    // La miniatura es su propio blanco de 44 × 52, encima de la columna.
    const foto = (await guero.locator('.fila-ticket-foto').boundingBox())!;
    expect(foto.width).toBeGreaterThanOrEqual(44);
    expect(foto.height).toBeGreaterThanOrEqual(44);
  });

  test('2d · cargando: el recuadro vacío con `aria-busy` y su nombre; error: el ícono adentro, sigue abriendo el visor, que vuelve a pedir', async ({ page }) => {
    await entrar(page, { [FALLAS]: JSON.stringify({ 'PA-7310': { thumb: 'cargando' }, 'PA-6604': { thumb: 'error' } }) });
    await aMesas(page);
    const cargando = page.getByRole('button', { name: 'Cargando la foto del ticket de Tacos El Güero', exact: true });
    await expect(cargando).toHaveAttribute('aria-busy', 'true');
    await expect(cargando.locator('.miniatura-ticket--cargando')).toBeVisible();
    await expect(cargando.locator('img, svg')).toHaveCount(0);
    const error = page.getByRole('button', { name: 'Ver la foto del ticket de Café Tacuba', exact: true });
    await expect(error.locator('.miniatura-ticket svg')).toBeVisible();
    // El error no se anuncia en la lista.
    await expect(page.locator('.tus-mesas [role="alert"]')).toHaveCount(0);
    await error.click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });
});

test.describe('D481 · 3b · la pantalla del ticket de una mesa', () => {
  test('🔴 toda la fila la abre; la miniatura no; Volver regresa a la lista en la misma posición', async ({ page }) => {
    await entrar(page, { 'payme.app.mock.mis_mesas.v1': 'muchas' });
    await aMesas(page);
    const lista = page.locator('.history-scroll');
    await lista.evaluate((el) => { el.scrollTop = 600; });
    const antes = await lista.evaluate((el) => el.scrollTop);
    expect(antes).toBeGreaterThan(300);
    const fila = page.locator('.tu-mesa').filter({ hasText: 'Mesa de prueba 12' });
    await fila.locator('button.fila-ticket').click();
    await expect(page.getByRole('heading', { level: 1, name: 'Mesa de prueba 12' })).toBeVisible();
    await page.getByRole('button', { name: 'Volver', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Mesas' })).toBeVisible();
    expect(Math.abs(await lista.evaluate((el) => el.scrollTop) - antes)).toBeLessThanOrEqual(2);
    await expect(fila.locator('button.fila-ticket')).toBeFocused();
  });

  test('«Lo que elegiste», el pie con «Elegiste» y «Ver detalle digital»; la fila de la foto abre el visor de ese ticket', async ({ page }) => {
    await entrar(page);
    await aMesas(page);
    await filaDe(page, 'Tacos El Güero').locator('button.fila-ticket').click();
    await expect(page.getByRole('heading', { level: 1, name: 'Tacos El Güero' })).toBeVisible();
    const eleccion = page.getByRole('region', { name: 'Lo que elegiste' });
    await expect(eleccion.locator('.eleccion-fila')).toHaveCount(3);
    await expect(eleccion).toContainText('2 × Tacos al pastor');
    await expect(eleccion).toContainText('½');
    await expect(page.locator('.pantalla-ticket-pie')).toContainText('Elegiste$450');
    await expect(page.getByText('Quién eligió')).toHaveCount(0);
    const filaFoto = page.getByRole('button', { name: 'Ver la foto del ticket', exact: true });
    await imagenCargada(filaFoto.locator('img'));
    await filaFoto.click();
    const visor = page.getByRole('dialog', { name: 'Foto del ticket' });
    await expect(visor).toBeVisible();
    await expect(visor.getByRole('button', { name: 'Ticket siguiente' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(filaFoto).toBeFocused();
    // «Ver detalle digital»: el detalle digital de la mesa; al cerrarlo, el foco vuelve al botón.
    const detalle = page.getByRole('button', { name: 'Ver detalle digital', exact: true });
    await detalle.click();
    const hoja = page.getByRole('dialog', { name: 'Detalle digital del ticket' });
    await expect(hoja).toContainText('Detalle registrado en PayMe. No es factura ni comprobante de pago.');
    await hoja.getByRole('button', { name: 'Cerrar', exact: true }).click();
    await expect(detalle).toBeFocused();
  });
});

test.describe('D481 · 1c–1h · el visor', () => {
  test('🔴 nada encima del papel: las flechas en la franja, debajo de la foto; la que no va deja su hueco', async ({ page }) => {
    await entrar(page);
    await aMesas(page);
    await page.getByRole('button', { name: 'Ver la foto del ticket de Café Tacuba', exact: true }).click();
    const visor = page.getByRole('dialog');
    const foto = visor.getByRole('img', { name: 'Foto del ticket de Café Tacuba' });
    await imagenCargada(foto);
    const anterior = visor.getByRole('button', { name: 'Ticket anterior', exact: true });
    const [cajaFoto, cajaFlecha, cajaPuntos] = await Promise.all([foto.boundingBox(), anterior.boundingBox(), visor.locator('.visor-ticket-puntos').boundingBox()]);
    expect(cajaFlecha!.y).toBeGreaterThanOrEqual(cajaFoto!.y + cajaFoto!.height - 1);
    expect(Math.abs((cajaFlecha!.y + cajaFlecha!.height / 2) - (cajaPuntos!.y + cajaPuntos!.height / 2))).toBeLessThanOrEqual(2);
    await expect(visor.getByRole('button', { name: 'Ticket siguiente', exact: true })).toHaveCount(0);
    await anterior.click();
    // Los puntos no se mueven al cambiar de ticket.
    const puntosDespues = (await visor.locator('.visor-ticket-puntos').boundingBox())!;
    expect(Math.abs(puntosDespues.x - cajaPuntos!.x)).toBeLessThanOrEqual(1);
  });

  test('🔴 P5 · la píldora de zoom: se va al primer zoom y, recordado en el teléfono, no vuelve', async ({ page }) => {
    await entrar(page);
    await aMesas(page);
    const miniatura = page.getByRole('button', { name: 'Ver la foto del ticket de Café Tacuba', exact: true });
    await miniatura.click();
    const visor = page.getByRole('dialog');
    await imagenCargada(visor.getByRole('img', { name: 'Foto del ticket de Café Tacuba' }));
    await expect(visor.locator('.visor-ticket-pista')).toHaveText('Pellizca o toca dos veces para hacer zoom.');
    // La descripción accesible sigue aunque la píldora se vaya.
    await expect(visor.locator('.visor-ticket-escenario')).toHaveAttribute('aria-describedby', 'visor-ticket-ayuda');
    await page.keyboard.press('+');
    await expect(visor.locator('.visor-ticket-pista')).toHaveCount(0);
    expect(await page.evaluate((k) => localStorage.getItem(k), ZOOM)).toBe('1');
    await page.keyboard.press('Escape');
    await miniatura.click();
    await imagenCargada(page.getByRole('dialog').getByRole('img', { name: 'Foto del ticket de Café Tacuba' }));
    await expect(page.getByRole('dialog').locator('.visor-ticket-pista')).toHaveCount(0);
    await expect(page.getByRole('dialog').locator('.visor-ticket-escenario')).toHaveAttribute('aria-describedby', 'visor-ticket-ayuda');
  });

  test('🔴 la píldora se va sola a los 4 s', async ({ page }) => {
    await entrar(page);
    await aMesas(page);
    await page.getByRole('button', { name: 'Ver la foto del ticket de Café Tacuba', exact: true }).click();
    const pista = page.getByRole('dialog').locator('.visor-ticket-pista');
    await expect(pista).toBeVisible();
    await expect(pista).toHaveCount(0, { timeout: 6000 });
  });

  test('🔴 1d · la vencida: la miniatura a su tamaño (≤ 320 px), sin zoom ni píldora, y el aviso pegado debajo', async ({ page }) => {
    await entrar(page);
    await aMesas(page);
    await page.getByRole('button', { name: 'Ver la foto del ticket de Tacos El Güero', exact: true }).click();
    const visor = page.getByRole('dialog');
    const foto = visor.getByRole('img', { name: 'Foto del ticket de Tacos El Güero' });
    await imagenCargada(foto);
    const dim = await foto.evaluate((el) => {
      const img = el as HTMLImageElement;
      return { ancho: img.getBoundingClientRect().width, natural: img.naturalWidth };
    });
    expect(dim.ancho).toBeLessThanOrEqual(Math.min(320, dim.natural) + 1);
    const aviso = visor.getByText('La foto completa se borró a los 90 días.', { exact: true });
    await expect(aviso).toBeVisible();
    const [cf, ca] = await Promise.all([foto.boundingBox(), aviso.boundingBox()]);
    expect(ca!.y).toBeGreaterThanOrEqual(cf!.y + cf!.height - 1);
    expect(ca!.y - (cf!.y + cf!.height)).toBeLessThanOrEqual(20);
    await expect(visor.locator('.visor-ticket-pista')).toHaveCount(0);
    await page.keyboard.press('+');
    await expect(foto).toHaveAttribute('style', /scale\(1\)/);
  });

  test('🔴 1e · 1f · cargando (esqueleto) y error (Reintentar): sin el aviso de los 90 días', async ({ page }) => {
    await entrar(page, { [FALLAS]: JSON.stringify({ 'PA-7310': { thumb: 'cargando' }, 'PA-6604': { thumb: 'error', full: 'error' } }) });
    await aMesas(page);
    await page.getByRole('button', { name: 'Cargando la foto del ticket de Tacos El Güero', exact: true }).click();
    const visor = page.getByRole('dialog');
    await expect(visor.getByRole('status')).toContainText('Cargando la foto…');
    await expect(visor.locator('.visor-ticket-esqueleto-papel')).toBeVisible();
    await expect(visor.getByText('La foto completa se borró', { exact: false })).toHaveCount(0);
    // Al siguiente: el error, con Reintentar; las flechas siguen.
    await visor.getByRole('button', { name: 'Ticket siguiente', exact: true }).click();
    await expect(visor.getByRole('alert')).toContainText('No pudimos cargar la foto.');
    const reintentar = visor.getByRole('button', { name: 'Reintentar', exact: true });
    await expect(reintentar).toBeVisible();
    expect((await reintentar.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(visor.getByText('La foto completa se borró', { exact: false })).toHaveCount(0);
    await expect(visor.getByRole('button', { name: 'Ticket anterior', exact: true })).toBeVisible();
  });

  test('🔴 1h · «Ver consumos»: la hoja ENCIMA del visor; Escape cierra sólo la hoja; la ✕ vuelve a la foto', async ({ page }) => {
    await entrar(page);
    await aMesas(page);
    await page.getByRole('button', { name: 'Ver la foto del ticket de Café Tacuba', exact: true }).click();
    const ver = page.getByRole('dialog').getByRole('button', { name: 'Ver consumos', exact: true });
    await ver.click();
    const hoja = page.getByRole('dialog', { name: 'Detalle digital del ticket' });
    await expect(hoja).toContainText('Detalle registrado en PayMe. No es factura ni comprobante de pago.');
    await expect(page.locator('.visor-ticket')).toBeVisible();
    // La hoja tapa al visor (encima) y el foco está en ella.
    expect(await hoja.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const arriba = document.elementFromPoint(r.left + r.width / 2, r.top + 20);
      return !!arriba && el.contains(arriba);
    })).toBe(true);
    await page.keyboard.press('Escape');
    await expect(hoja).toHaveCount(0);
    await expect(page.locator('.visor-ticket')).toBeVisible();
    await expect(ver).toBeFocused();
    await ver.click();
    await page.getByRole('dialog', { name: 'Detalle digital del ticket' }).getByRole('button', { name: 'Cerrar', exact: true }).click();
    await expect(page.locator('.visor-ticket')).toBeVisible();
    await expect(ver).toBeFocused();
  });
});

test.describe('D481 · 1i · 3d · 7 · 8', () => {
  test('1i · el aviso del escaneo en su fila, con el ícono de imagen y el mismo texto', async ({ page }) => {
    await entrar(page);
    await page.getByRole('button', { name: 'Escanear', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Escanea el ticket', exact: true })).toBeVisible();
    const aviso = page.locator('.captura-foto-guardada');
    await expect(aviso).toHaveText('PayMe guarda la foto de este ticket para que la veas después en Mesas.');
    await expect(aviso.locator('svg')).toBeVisible();
    await expect(aviso).not.toHaveClass(/camara-sub/);
  });

  test('3d · el ticket de un viaje: la fila de la foto dentro de la tarjeta de título, separada por una línea', async ({ page }) => {
    await entrar(page, { 'payme.app.mock.viajes.v1': 'encendido' });
    await page.goto(`/viaje-ticket/${CANCUN}.${MARISCOS}`);
    const fila = page.locator('.title-card .pantalla-ticket-foto').getByRole('button', { name: 'Ver la foto del ticket', exact: true });
    await imagenCargada(fila.locator('img'));
    await expect(page.locator('.title-card .pantalla-ticket-foto')).toHaveCSS('border-top-style', 'solid');
    await expect(fila).toHaveCSS('text-decoration-line', 'none');
  });

  test('7 · Balance › Consumos: la miniatura en la columna, el lugar y el total; «Ver consumos» abre el ticket', async ({ page }) => {
    await entrar(page, { 'payme.app.mock.viajes.v1': 'encendido' });
    await irEnLaApp(page, `/viaje-balance/${CANCUN}`);
    const conFoto = page.locator('.vjb-consumo-con-foto').filter({ hasText: 'Mariscos El Faro' });
    const miniatura = conFoto.getByRole('button', { name: 'Ver la foto del ticket de Mariscos El Faro', exact: true });
    await imagenCargada(miniatura.locator('img'));
    // La misma columna del ícono: la fila mide lo mismo que una sin foto.
    await expect(conFoto.locator('.vjb-consumo-monto')).toBeVisible();
    await miniatura.click();
    const visor = page.getByRole('dialog', { name: 'Foto del ticket' });
    await expect(visor).toBeVisible();
    await visor.getByRole('button', { name: 'Ver consumos', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/viaje-ticket/${CANCUN}\\.${MARISCOS}$`));
  });

  test('8 · las visitas de viaje en Mesas: la misma fila, con la miniatura si hay, la insignia y «Te toca»', async ({ page }) => {
    await entrar(page, { 'payme.app.mock.viajes.v1': 'encendido' });
    await aMesas(page);
    const visita = page.locator('.vj-visita').filter({ hasText: 'Mariscos El Faro' });
    await imagenCargada(visita.getByRole('button', { name: 'Ver la foto del ticket de Mariscos El Faro', exact: true }).locator('img'));
    await expect(visita.locator('.vj-visita-viaje')).toContainText('Cancún 2026');
    await expect(visita.locator('.fila-ticket-rotulo')).toHaveText('Te toca');
    await visita.getByRole('button', { name: 'Ver la foto del ticket de Mariscos El Faro', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Foto del ticket' })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Ver consumos', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/viaje-ticket/${CANCUN}\\.${MARISCOS}$`));
  });
});

// ─── Las capturas para Mati: 390 y 1280, en español y en inglés ─────────────
for (const [ancho, alto] of [[390, 844], [1280, 720]] as const) {
  for (const idioma of ['es', 'en'] as const) {
    test.describe(`D481 · capturas a ${ancho} (${idioma})`, () => {
      test.use({ viewport: { width: ancho, height: alto } });
      const ES = idioma === 'es';
      const n = (id: string) => `${idioma}-${id}`;

      test('2a · 3b · 1c (1k) · 1d · 1h', async ({ page }) => {
        await entrar(page, {}, idioma);
        await aMesas(page);
        await imagenCargada(page.locator('.fila-ticket-foto img').first());
        await capturar(page, n('2a-mesas'));
        // 1c (y a 1280, 1k): la foto completa.
        await page.getByRole('button', { name: ES ? 'Ver la foto del ticket de Café Tacuba' : 'See the receipt photo from Café Tacuba', exact: true }).click();
        await imagenCargada(page.getByRole('dialog').locator('img.visor-ticket-foto'));
        await capturar(page, n(ancho === 1280 ? '1k-visor-escritorio' : '1c-visor'));
        // 1h: «Ver consumos» encima.
        await page.getByRole('dialog').getByRole('button', { name: ES ? 'Ver consumos' : 'See items', exact: true }).click();
        await expect(page.locator('.ticket-digital-items li').first()).toBeVisible();
        await capturar(page, n('1h-consumos-encima'));
        await page.keyboard.press('Escape');
        // 1d: la vencida.
        await page.getByRole('dialog').getByRole('button', { name: ES ? 'Ticket anterior' : 'Previous receipt', exact: true }).click();
        await imagenCargada(page.getByRole('dialog').locator('img.visor-ticket-foto'));
        await capturar(page, n('1d-vencida'));
        await page.keyboard.press('Escape');
        // 3b: la pantalla del ticket.
        await page.locator('.tu-mesa').filter({ hasText: 'Tacos El Güero' }).locator('button.fila-ticket').click();
        await imagenCargada(page.locator('.fila-de-la-foto img'));
        await capturar(page, n('3b-pantalla-del-ticket'));
      });

      test('2d · 1e · 1f', async ({ page }) => {
        await entrar(page, { [FALLAS]: JSON.stringify({ 'PA-7310': { thumb: 'cargando' }, 'PA-6604': { thumb: 'error', full: 'error' } }) }, idioma);
        await aMesas(page);
        await expect(page.locator('.miniatura-ticket--cargando')).toBeVisible();
        await capturar(page, n('2d-cargando-y-error'));
        await page.locator('.tu-mesa').filter({ hasText: 'Tacos El Güero' }).locator('.fila-ticket-foto').click();
        await expect(page.locator('.visor-ticket-esqueleto')).toBeVisible();
        await capturar(page, n('1e-cargando'));
        await page.getByRole('dialog').getByRole('button', { name: ES ? 'Ticket siguiente' : 'Next receipt', exact: true }).click();
        await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible();
        await capturar(page, n('1f-error'));
      });

      test('1i · 3d', async ({ page }) => {
        await entrar(page, { 'payme.app.mock.viajes.v1': 'encendido' }, idioma);
        await page.getByRole('button', { name: ES ? 'Escanear' : 'Scan', exact: true }).click();
        await expect(page.locator('.captura-foto-guardada')).toBeVisible();
        await capturar(page, n('1i-escaneo'));
        await page.goto(`/viaje-ticket/${CANCUN}.${MARISCOS}`);
        await imagenCargada(page.locator('.fila-de-la-foto img'));
        await capturar(page, n('3d-ticket-del-viaje'));
      });
    });
  }
}
