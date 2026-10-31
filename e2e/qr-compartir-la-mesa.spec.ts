import { expect, test, type Locator, type Page } from '@playwright/test';
import { abrirMesaConLink, ingresar } from './_app';
import { sacarFoto } from './_camara';
import { contarLaRed, SONDAS_DE_RED, sondearLaRed } from './_guia';
import { abrirConfiguracionDeLaMesa } from './_mesa';

/**
 * D622 · AF-3 · mejora 6 (§7) · el QR de «Compartir la mesa» y de la hoja del
 * engranaje. D630: generador propio. D631: abre el link directo, el MISMO de
 * «Copiar link».
 *
 * Se mide en el mock con los pagos apagados: el QR está donde va (entre el
 * código y los botones), dibuja exactamente la matriz del link copiado con su
 * zona de silencio, no pide nada a la red, y no aparece sin link.
 *
 * 🔴 Esto prueba que el SVG es la matriz del link, no que la cámara lo lea: eso
 * lo cierra la prueba de Mati con el iPhone (D63).
 *
 * Capturas a 390×844 (proyecto `movil`) sólo con `PAYME_E2E_CAPTURAS`.
 */

async function prepararPortapapeles(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const copias: string[] = [];
    Object.defineProperty(window, '__copias', { value: copias });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (texto: string) => { copias.push(texto); } },
    });
    localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled');
  });
}

const copias = (page: Page) => page.evaluate(() => (window as unknown as { __copias: string[] }).__copias);

async function capturar(page: Page, nombre: string, mostrar?: Locator): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (!dir) return;
  if (mostrar) await mostrar.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: `${dir}/${nombre}.png`, animations: 'disabled' });
}

const qrDe = (raiz: Locator, code: string) => raiz.getByRole('img', { name: `QR para unirse a la mesa ${code}`, exact: true });

/**
 * Lee el SVG y lo compara con la matriz del `link` (calculada en la página con el
 * mismo generador): los módulos oscuros del `path`, uno por uno, y que ninguno
 * caiga en la zona de silencio.
 */
async function medirElQr(qr: Locator, link: string) {
  return qr.evaluate(async (svg, texto) => {
    const ruta = '/src/qr/codificarQr.ts';
    const { codificarQr } = await import(/* @vite-ignore */ ruta) as {
      codificarQr: (t: string) => { tamano: number; modulos: boolean[][] } | null;
    };
    const m = codificarQr(texto);
    if (!m) return { error: 'el link no entra' };
    const lado = m.tamano + 8;
    const vb = svg.getAttribute('viewBox');
    const rect = svg.querySelector('rect');
    const paths = svg.querySelectorAll('path');
    const d = paths[0]?.getAttribute('d') ?? '';
    const dibujados = new Set<string>();
    for (const x of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
      for (let i = 0; i < Number(x[3]); i++) dibujados.add(`${Number(x[2])},${Number(x[1]) + i}`);
    }
    const esperados = new Set<string>();
    m.modulos.forEach((fila, r) => fila.forEach((v, c) => { if (v) esperados.add(`${r + 4},${c + 4}`); }));
    const enLaZona = [...dibujados].filter((k) => {
      const [r, c] = k.split(',').map(Number);
      return r < 4 || c < 4 || r >= lado - 4 || c >= lado - 4;
    });
    const caja = svg.getBoundingClientRect();
    return {
      error: null,
      viewBoxOk: vb === `0 0 ${lado} ${lado}`,
      fondo: rect ? `${rect.getAttribute('width')}x${rect.getAttribute('height')} ${rect.getAttribute('fill')}` : null,
      fondoEsperado: `${lado}x${lado} #fff`,
      paths: paths.length,
      iguales: dibujados.size === esperados.size && [...esperados].every((k) => dibujados.has(k)),
      oscuros: dibujados.size,
      enLaZona: enLaZona.length,
      externos: svg.querySelectorAll('image, img, foreignObject, use, [href]').length,
      ancho: Math.round(caja.width),
    };
  }, link);
}

function esElQrDelLink(r: Awaited<ReturnType<typeof medirElQr>>): void {
  expect(r.error).toBeNull();
  expect(r).toMatchObject({ viewBoxOk: true, paths: 1, iguales: true, enLaZona: 0, externos: 0 });
  expect(r.fondo).toBe(r.fondoEsperado);
  expect(r.oscuros).toBeGreaterThan(100);
  // ~150–170 px (§7): a 390 px de ancho.
  expect(r.ancho).toBeGreaterThanOrEqual(150);
  expect(r.ancho).toBeLessThanOrEqual(180);
}

/** `a` va antes que `b` en el documento. */
async function vaAntes(a: Locator, b: Locator): Promise<boolean> {
  const hb = await b.elementHandle();
  return a.evaluate((x, y) => !!y && (x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0, hb);
}

test.describe('D622 · AF-3 · el QR de la mesa', () => {
  test('🔴 «Compartir la mesa»: entre el código y los botones, es el link copiado, con su zona de silencio y sin red', async ({ page }) => {
    await prepararPortapapeles(page);
    await ingresar(page);
    const mesa = await abrirMesaConLink(page, { sinGarantia: true });
    const tarjeta = page.locator('.share-card');
    const qr = qrDe(tarjeta, mesa.code);
    await expect(qr).toBeVisible();
    await expect(tarjeta.getByText('Que lo escaneen con la cámara.', { exact: true })).toBeVisible();
    await capturar(page, 'movil-qr-compartir-la-mesa', qr);
    // El nombre accesible no lleva el link ni su credencial.
    expect(await qr.getAttribute('aria-label')).not.toContain('?t=');
    expect(await vaAntes(tarjeta.locator('.share-code'), qr)).toBe(true);
    expect(await vaAntes(qr, tarjeta.locator('.share-actions'))).toBe(true);

    // Dibujar el QR no pide nada a la red: se cuenta desde que ya está en pantalla, releyéndolo entero.
    const red = await contarLaRed(page);
    await page.getByRole('button', { name: 'Copiar link', exact: true }).click();
    await expect(page.getByText('Link de invitación copiado ✓', { exact: true })).toBeVisible();
    const [copiado] = await copias(page);
    expect(copiado).toBe(mesa.link);
    esElQrDelLink(await medirElQr(qr, copiado!));
    await sondearLaRed(page);
    const r = await red.cerrar();
    expect(r.contados.sort(), JSON.stringify(r)).toEqual([...SONDAS_DE_RED].sort());
  });

  test('🔴 la hoja del engranaje: el mismo QR, entre el código y los botones, sin red y con «Copiar link» del mismo link', async ({ page }) => {
    await prepararPortapapeles(page);
    await ingresar(page);
    const mesa = await abrirMesaConLink(page, { sinGarantia: true });
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Tu mesa', exact: true })).toBeVisible();
    // El mock no hace HTTP: abrir la hoja y pedir el link no sale a la red.
    const red = await contarLaRed(page);
    await abrirConfiguracionDeLaMesa(page);
    const hoja = page.getByRole('dialog', { name: 'Configuración de la mesa' });
    const qr = qrDe(hoja, mesa.code);
    await expect(qr).toBeVisible();
    await expect(hoja.getByText('Que lo escaneen con la cámara.', { exact: true })).toBeVisible();
    await capturar(page, 'movil-qr-hoja-del-engranaje');
    expect(await vaAntes(hoja.locator('.mesa-codigo-para-unirse'), qr)).toBe(true);
    expect(await vaAntes(qr, hoja.getByRole('button', { name: 'Copiar link de invitación', exact: true }))).toBe(true);
    await hoja.getByRole('button', { name: 'Copiar link de invitación', exact: true }).click();
    await expect(page.getByText('Link de invitación copiado ✓', { exact: true })).toBeVisible();
    const lista = await copias(page);
    // D631 · el QR codifica lo que copia «Copiar link», que es el link del paso «Compartir la mesa».
    expect(lista.at(-1)).toBe(mesa.link);
    esElQrDelLink(await medirElQr(qr, lista.at(-1)!));
    await sondearLaRed(page);
    const r = await red.cerrar();
    expect(r.contados.sort(), JSON.stringify(r)).toEqual([...SONDAS_DE_RED].sort());
  });

  test('🔴 sin link no hay QR: mientras se genera, con error, y en la hoja si el link no llega', async ({ page }) => {
    await prepararPortapapeles(page);
    await ingresar(page);
    // El link no llega nunca (en vuelo), como la fachada de verdad con la red colgada.
    const colgar = () => page.evaluate(async () => {
      const ruta = '/src/api/index.ts';
      const { api } = await import(/* @vite-ignore */ ruta) as { api: Record<string, unknown> };
      const w = window as unknown as { __crearInvitacion?: unknown };
      w.__crearInvitacion ??= api.createInvitation;
      api.createInvitation = () => new Promise(() => undefined);
    });
    const fallar = () => page.evaluate(async () => {
      const ruta = '/src/api/index.ts';
      const { api } = await import(/* @vite-ignore */ ruta) as { api: Record<string, unknown> };
      api.createInvitation = () => Promise.reject(Object.assign(new Error('mock'), { status: 500, code: 'internal' }));
    });
    const restaurar = () => page.evaluate(async () => {
      const ruta = '/src/api/index.ts';
      const { api } = await import(/* @vite-ignore */ ruta) as { api: Record<string, unknown> };
      api.createInvitation = (window as unknown as { __crearInvitacion: unknown }).__crearInvitacion;
    });
    await colgar();
    await page.getByRole('button', { name: 'Escanear', exact: true }).click();
    // El mismo recorrido de `abrirMesaConLink`, hasta «Compartir la mesa», sin leer el link (no llega).
    await sacarFoto(page);
    await expect(page.getByRole('radio', { name: /Pagar el total/ })).toBeVisible();
    await page.getByRole('radio', { name: /En partes iguales/ }).click();
    const masUno = page.getByRole('button', { name: 'Un comensal más' });
    await masUno.click();
    await masUno.click();
    await masUno.click();
    await page.getByRole('button', { name: 'Continuar' }).click();
    await expect(page.getByRole('heading', { name: 'Compartir la mesa' })).toBeVisible();
    await expect(page.getByText('Generando el link…', { exact: true })).toBeVisible();
    const code = (await page.locator('.share-code-txt').textContent())!.trim();
    await expect(page.getByRole('img', { name: /^QR para unirse/ })).toHaveCount(0);
    await expect(page.locator('.codigo-qr')).toHaveCount(0);

    // Con error: tampoco. Se sigue dentro de la app (sin recargar: la fachada cambiada vive en esta página).
    await fallar();
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Tu mesa', exact: true })).toBeVisible();
    await abrirConfiguracionDeLaMesa(page);
    const hoja = page.getByRole('dialog', { name: 'Configuración de la mesa' });
    await expect(hoja.locator('.mesa-codigo-para-unirse')).toBeVisible();
    await expect(hoja.getByRole('button', { name: 'Copiar link de invitación', exact: true })).toBeVisible();
    await expect(page.locator('.codigo-qr')).toHaveCount(0);
    await page.keyboard.press('Escape');

    // Control positivo en el mismo caso: con la fachada de siempre, la hoja sí lo muestra.
    await restaurar();
    await abrirConfiguracionDeLaMesa(page);
    await expect(qrDe(page.getByRole('dialog', { name: 'Configuración de la mesa' }), code)).toBeVisible();
  });
});
