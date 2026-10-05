import { expect, test, type Page } from '@playwright/test';
import { ingresar, irEnLaApp } from './_app';

/**
 * AF-E178 · decisión 178 de Mati sobre la captura 9 (0.212.0): «Aparece pero
 * está muy mal el diseño». Eligió que lo rediseñe App Frontend con el
 * blueprint, y aprueba las capturas antes de publicar.
 *
 * Lo que fija este spec del rediseño:
 * - arriba de todo, la fila de acciones con un resumen («2 sin leer» / «Todo
 *   leído») y la jerarquía: «Marcar leídos» principal (píldora teal) y «Borrar
 *   todas» secundaria (gris);
 * - los avisos en UNA tarjeta con separadores, no una tarjeta por aviso;
 * - el ícono (o la foto de quien invita) en un círculo de 40 px con el punto de
 *   no leído encima, y la papelera centrada en la fila;
 * - el «+» de la barra no tapa el último aviso (ya se cumplía con el padding de
 *   siempre, medido sobre 0.214.0: queda como red de regresión);
 * - a 320 px todo entra en una línea, sin scroll horizontal;
 * - el vacío, con su campana y qué va a aparecer.
 *
 * Los datos imitan la captura de Mati: dos mesas que vencieron o se cerraron,
 * una solicitud aceptada y una invitación de alguien con foto.
 */

const AVISOS = [
  {
    id: 'd178-vencio', type: 'mesa_expired', read_at: null,
    body: 'La mesa PA-60272 en Restaurante sin identificar venció. Lo que cada quien eligió quedó como su consumo.',
    payload: { mesa_code: 'PA-60272' }, minutos: 30,
  },
  {
    id: 'd178-pablo', type: 'friend_added', read_at: null,
    body: 'Pablo aceptó tu solicitud', payload: null, minutos: 60 * 26,
  },
  {
    id: 'd178-sofia', type: 'invitation_received', read_at: '2026-10-04T10:00:00.000Z',
    body: 'Sofía te invitó a una mesa',
    payload: { mesa_code: 'PA-7001', inviter_name: 'Sofía', inviter_payme_id: 'payme_mx_sofi', has_inviter_avatar: true },
    minutos: 60 * 50,
  },
  {
    id: 'd178-cerro', type: 'mesa_expired', read_at: '2026-10-01T10:00:00.000Z',
    body: 'La mesa PA-98275 en Restaurante sin identificar se cerró: ya se eligió todo.',
    payload: { mesa_code: 'PA-98275' }, minutos: 60 * 24 * 5,
  },
];

async function preparar(page: Page, opciones: { avisos?: typeof AVISOS; sinInvitaciones?: boolean } = {}): Promise<void> {
  await ingresar(page);
  await page.evaluate(async ({ avisos, sinInvitaciones }) => {
    const rutaStore = '/src/api/mock/store.ts';
    const rutaApi = '/src/api/index.ts';
    const { state } = await import(/* @vite-ignore */ rutaStore) as {
      state: { notifications: unknown[]; pendingInvitations: unknown[] };
    };
    state.notifications = avisos.map(({ minutos, ...a }) => ({
      ...a, title: null, related_entity_type: null, related_entity_id: null,
      created_at: new Date(Date.now() - minutos * 60_000).toISOString(),
    }));
    if (sinInvitaciones) state.pendingInvitations = [];
    // La foto del mock es un JPEG de 1 px; para ver una foto de verdad se dibuja una.
    const lienzo = new OffscreenCanvas(120, 120);
    const g = lienzo.getContext('2d')!;
    const fondo = g.createLinearGradient(0, 0, 120, 120);
    fondo.addColorStop(0, '#f2b48c');
    fondo.addColorStop(1, '#c97b5a');
    g.fillStyle = fondo;
    g.fillRect(0, 0, 120, 120);
    g.fillStyle = '#5b3a29';
    g.beginPath(); g.arc(60, 48, 30, Math.PI, 0); g.fill();
    g.fillStyle = '#fde3cf';
    g.beginPath(); g.arc(60, 56, 22, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#0fb5c9';
    g.beginPath(); g.ellipse(60, 120, 42, 32, 0, Math.PI, 0); g.fill();
    const foto = await lienzo.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
    const { api } = await import(/* @vite-ignore */ rutaApi) as {
      api: Record<string, (...a: unknown[]) => Promise<{ blob: Blob }>>;
    };
    for (const nombre of ['getInviterAvatar', 'getInvitationInviterAvatar']) {
      const original = api[nombre]!.bind(api);
      api[nombre] = async (...args: unknown[]) => ({ ...(await original(...args)), blob: foto });
    }
  }, { avisos: opciones.avisos ?? AVISOS, sinInvitaciones: opciones.sinInvitaciones ?? false });
  await irEnLaApp(page, '/avisos');
  await expect(page.getByRole('heading', { level: 1, name: 'Notificaciones', exact: true })).toBeVisible();
}

const acciones = (page: Page) => page.locator('.avisos-actions');
const marcar = (page: Page) => page.getByRole('button', { name: 'Marcar leídos', exact: true });
const borrarTodas = (page: Page) => page.getByRole('button', { name: 'Borrar todas', exact: true });
const filas = (page: Page) => page.locator('.aviso-row');

async function captura(page: Page, nombre: string): Promise<void> {
  const dir = process.env.PAYME_E2E_CAPTURAS;
  if (!dir) return;
  await page.screenshot({ path: `${dir}/${nombre}.png` });
}

test.describe('D178 · Notificaciones rediseñadas', () => {
  test('arriba: el resumen y las dos acciones con jerarquía; al marcar, «Todo leído»', async ({ page }) => {
    await preparar(page);
    await expect(acciones(page).locator('.avisos-resumen')).toHaveText('2 sin leer');
    await expect(page.getByRole('img', { name: 'Sin leer' })).toHaveCount(2);
    // Principal: píldora teal (--teal-l / --teal-txt). Secundaria: gris, sin fondo.
    await expect(marcar(page)).toHaveCSS('background-color', 'rgb(228, 251, 252)');
    await expect(marcar(page)).toHaveCSS('color', 'rgb(10, 123, 128)');
    await expect(borrarTodas(page)).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(borrarTodas(page)).toHaveCSS('color', 'rgb(91, 107, 130)');
    for (const boton of [marcar(page), borrarTodas(page)]) {
      expect((await boton.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await captura(page, `${page.viewportSize()!.width}-con-no-leidas`);

    await marcar(page).click();
    await expect(acciones(page).locator('.avisos-resumen')).toHaveText('Todo leído');
    await expect(marcar(page)).toHaveCount(0);
    await expect(borrarTodas(page)).toBeVisible();
    await expect(page.getByRole('img', { name: 'Sin leer' })).toHaveCount(0);
    await captura(page, `${page.viewportSize()!.width}-sin-no-leidas`);
  });

  test('los avisos van en una sola tarjeta con separadores', async ({ page }) => {
    await preparar(page, { sinInvitaciones: true });
    await expect(filas(page)).toHaveCount(AVISOS.length);
    await expect(page.locator('.avisos-lista')).toHaveCount(1);
    await expect(page.locator('.avisos-lista > .aviso-row')).toHaveCount(AVISOS.length);
    await expect(page.locator('.aviso-row.card')).toHaveCount(0);
    await expect(filas(page).nth(1)).toHaveCSS('border-top-width', '1px');
    await expect(filas(page).first()).toHaveCSS('border-top-width', '0px');
  });

  test('el ícono en su círculo con el punto encima, y la papelera centrada en la fila', async ({ page }) => {
    await preparar(page, { sinInvitaciones: true });
    const primera = filas(page).first();
    const m = await primera.evaluate((fila) => {
      const caja = (sel: string) => fila.querySelector(sel)!.getBoundingClientRect();
      const icono = caja('.aviso-icono');
      const punto = caja('.aviso-dot');
      const papelera = caja('.aviso-borrar');
      const fila2 = caja('.aviso-row-top');
      return {
        icono: [icono.width, icono.height],
        puntoArribaDerecha: punto.right >= icono.right - 2 && punto.top <= icono.top + 2,
        papeleraCentro: papelera.top + papelera.height / 2,
        filaCentro: fila2.top + fila2.height / 2,
      };
    });
    expect(m.icono).toEqual([40, 40]);
    expect(m.puntoArribaDerecha).toBe(true);
    expect(Math.abs(m.papeleraCentro - m.filaCentro)).toBeLessThanOrEqual(1);
    // Un aviso leído no muestra punto; el sin leer va en 600 y el leído en 500.
    await expect(filas(page).nth(3).locator('.aviso-dot')).toBeHidden();
    await expect(primera.locator('.aviso-title')).toHaveCSS('font-weight', '600');
    await expect(filas(page).nth(3).locator('.aviso-title')).toHaveCSS('font-weight', '500');
  });

  test('la invitación de alguien con foto: la foto en el círculo, en el aviso y en «Te invitaron»', async ({ page }) => {
    await preparar(page);
    const fila = filas(page).filter({ hasText: 'Sofía te invitó' });
    const foto = fila.locator('.aviso-icono img.aviso-invitador-foto');
    await expect(foto).toBeVisible();
    expect(await foto.evaluate((img: HTMLImageElement) => [img.getBoundingClientRect().width, img.naturalWidth])).toEqual([40, 120]);
    await expect(page.locator('.inv-card img').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Avisos', exact: true })).toBeVisible();
    // Centrada: `scrollIntoViewIfNeeded` da por visible una fila a medias, debajo del «+».
    await fila.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await expect(fila).toBeInViewport({ ratio: 1 });
    await captura(page, `${page.viewportSize()!.width}-invitacion-con-foto`);
  });

  // Ya pasaba sobre 0.214.0 (el padding de `.has-appbar .scroll` alcanza): no es del
  // rediseño, es la red para que la lista nueva no lo rompa.
  test('el «+» de la barra no tapa el último aviso', async ({ page }) => {
    await preparar(page);
    await expect(filas(page)).toHaveCount(AVISOS.length);
    await page.locator('.avisos-scroll').evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect.poll(() => page.locator('.avisos-scroll').evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    const [ultima, mas] = await Promise.all([
      filas(page).last().boundingBox(),
      page.getByRole('button', { name: 'Nueva', exact: true }).boundingBox(),
    ]);
    expect(ultima!.y + ultima!.height).toBeLessThanOrEqual(mas!.y);
  });

  test('«Borrar todas» pide confirmación', async ({ page }) => {
    await preparar(page);
    await borrarTodas(page).click();
    const hoja = page.getByRole('dialog', { name: '¿Borrar todas las notificaciones?' });
    await expect(hoja).toBeVisible();
    await expect(hoja.getByRole('button', { name: 'Volver', exact: true })).toBeFocused();
    await captura(page, `${page.viewportSize()!.width}-confirmar-borrar-todas`);
  });

  test('sin avisos ni invitaciones: el vacío, sin fila de acciones', async ({ page }) => {
    await preparar(page, { avisos: [], sinInvitaciones: true });
    await expect(page.locator('.aviso-empty')).toBeVisible();
    await expect(page.getByText('No tienes avisos.', { exact: true })).toBeVisible();
    await expect(page.getByText('Aquí aparecen tus invitaciones y los avisos de tus mesas.', { exact: true })).toBeVisible();
    await expect(acciones(page)).toHaveCount(0);
    await expect(page.locator('.avisos-lista')).toHaveCount(0);
    await captura(page, `${page.viewportSize()!.width}-vacio`);
  });
});

async function medirFila(page: Page) {
  await expect(acciones(page)).toBeVisible();
  await expect(filas(page)).toHaveCount(AVISOS.length);
  return page.evaluate(() => {
    const caja = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
    const scroll = document.querySelector('.avisos-scroll')!;
    return {
      unaLinea: Math.abs(caja('.avisos-resumen').top + caja('.avisos-resumen').height / 2
        - (caja('.avisos-acciones-botones').top + caja('.avisos-acciones-botones').height / 2)) <= 1,
      botonesEnUnaLinea: caja('.avisos-accion--principal').top === caja('.avisos-accion--secundaria').top,
      // El resumen nunca se parte en dos renglones: si no entra, baja entero.
      // (1,5 renglones de margen: dos renglones miden justo 2 × 20,3 px y la comparación exacta es una moneda.)
      resumenEnUnRenglon: caja('.avisos-resumen').height
        <= 1.5 * parseFloat(getComputedStyle(document.querySelector('.avisos-resumen')!).lineHeight),
      desborde: scroll.scrollWidth - scroll.clientWidth,
    };
  });
}

// Medido: el resumen (64 px), 8 de separación y las acciones (241 px) piden 313 px de
// contenido; con los 16 de cada lado, una línea desde 346 px.
for (const ancho of [390, 375, 360] as const) {
  test(`a ${ancho} px, el resumen y las dos acciones van en una línea`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: 844 });
    await preparar(page);
    const m = await medirFila(page);
    expect(m.unaLinea).toBe(true);
    expect(m.desborde).toBeLessThanOrEqual(0);
  });
}

test.describe('D178 · a 320 px', () => {
  test.use({ viewport: { width: 320, height: 568 } });

  test('el resumen baja a su línea; las dos acciones siguen juntas, sin scroll horizontal', async ({ page }) => {
    await preparar(page);
    const m = await medirFila(page);
    expect(m.botonesEnUnaLinea).toBe(true);
    expect(m.resumenEnUnRenglon).toBe(true);
    expect(m.desborde).toBeLessThanOrEqual(0);
  });

  for (const nombre of ['con no leídas', 'invitación con foto', 'confirmación', 'vacío'] as const) {
    test(`captura a 320 px: ${nombre}`, async ({ page }) => {
      if (nombre === 'vacío') {
        await preparar(page, { avisos: [], sinInvitaciones: true });
        await expect(page.locator('.aviso-empty')).toBeVisible();
        await captura(page, '320-vacio');
        return;
      }
      await preparar(page);
      await expect(filas(page)).toHaveCount(AVISOS.length);
      if (nombre === 'con no leídas') {
        await captura(page, '320-con-no-leidas');
        await marcar(page).click();
        await expect(acciones(page).locator('.avisos-resumen')).toHaveText('Todo leído');
        await captura(page, '320-sin-no-leidas');
      } else if (nombre === 'invitación con foto') {
        const fila = filas(page).filter({ hasText: 'Sofía te invitó' });
        await expect(fila.locator('img.aviso-invitador-foto')).toBeVisible();
        await fila.evaluate((el) => el.scrollIntoView({ block: 'center' }));
        await expect(fila).toBeInViewport({ ratio: 1 });
        await captura(page, '320-invitacion-con-foto');
      } else {
        await borrarTodas(page).click();
        await expect(page.getByRole('dialog', { name: '¿Borrar todas las notificaciones?' })).toBeVisible();
        await captura(page, '320-confirmar-borrar-todas');
      }
    });
  }
});
