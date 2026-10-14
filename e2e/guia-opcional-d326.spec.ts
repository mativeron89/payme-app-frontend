import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { ingresar, irEnLaApp, relojFueraDeLasFechasDeLosViajes } from './_app';
import { camarasAbiertas } from './_camara';

const VIAJE = 'd1000000-0000-4000-8000-000000000001';
const guia = (page: Page) => page.getByRole('region', { name: 'Cómo usar PayMe', exact: true });

async function captura(page: Page, nombre: string, info: TestInfo) {
  if (process.env.D326_CAPTURES === '1' && (!process.env.D326_CAPTURE_ONLY || process.env.D326_CAPTURE_ONLY === nombre)) await page.screenshot({ path: info.outputPath(`${nombre}.png`), fullPage: true });
}

async function entrar(page: Page) {
  // Sólo fixtures locales; ni la guía ni este recorrido contactan proveedores.
  await page.route('**/*', (r) => {
    const url = new URL(r.request().url());
    return ['127.0.0.1', 'localhost'].includes(url.hostname) || url.protocol === 'data:' ? r.continue() : r.abort();
  });
  await relojFueraDeLasFechasDeLosViajes(page);
  await page.addInitScript(() => {
    localStorage.setItem('payme.app.mock.viajes.v1', 'encendido');
    localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled');
  });
  await ingresar(page);
  await expect(page.getByRole('button', { name: 'Ver guía', exact: true })).toBeVisible();
}

async function datos(page: Page) {
  return page.evaluate(async () => {
    const ruta = '/src/api/mock/store.ts';
    const { state } = await import(/* @vite-ignore */ ruta);
    return JSON.stringify({ mesas: state.mesas, viajes: localStorage.getItem('payme.app.mock.viajes.estado.v1') });
  });
}

test('D326 · oferta voluntaria: el primer gesto abre cámara sin abrir ni cargar la guía', async ({ page }) => {
  const cargados: string[] = [];
  page.on('request', (r) => { if (r.url().includes('/GuiaContenido')) cargados.push(r.url()); });
  await entrar(page);
  await expect(guia(page)).toHaveCount(0);
  expect(cargados).toEqual([]);
  expect(camarasAbiertas(page)).toBe(0);
  await page.getByRole('button', { name: 'Escanear', exact: true }).click();
  await expect.poll(() => camarasAbiertas(page)).toBe(1);
  await expect(page).toHaveURL(/\/scan$/);
  await expect(guia(page)).toHaveCount(0);
  expect(cargados).toEqual([]);
});

test('D326 · descartar persiste, Más reabre, ejemplos no mutan datos y Escape conserva ruta/foco', async ({ page }, info) => {
  await entrar(page);
  await captura(page, 'inicio-oferta-390', info);
  await page.getByRole('button', { name: 'Ocultar guía por ahora' }).click();
  await expect(page.getByRole('button', { name: 'Ver guía', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Escanear', exact: true })).toBeFocused();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Escanear', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ver guía', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Más', exact: true }).click();
  const ruta = page.url();
  const antes = await datos(page);
  await page.getByRole('button', { name: 'Cómo usar PayMe', exact: true }).click();
  await expect(guia(page).getByRole('heading', { name: 'Cómo usar PayMe', exact: true })).toBeFocused();
  await expect(guia(page).getByRole('listitem')).toHaveCount(4);
  await guia(page).getByRole('button', { name: 'Me invitaron', exact: true }).click();
  await expect(guia(page).getByRole('heading', { name: 'Abre la invitación' })).toBeVisible();
  await guia(page).getByRole('button', { name: 'Viajes', exact: true }).click();
  await expect(guia(page).getByText(/Pagaste \$300 y consumiste \$200/)).toBeVisible();
  expect(await datos(page)).toEqual(antes);
  expect(page.url()).toBe(ruta);
  await guia(page).getByRole('button', { name: 'Cerrar guía' }).focus();
  await page.keyboard.press('Escape');
  await expect(guia(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cómo usar PayMe', exact: true })).toBeFocused();
  expect(page.url()).toBe(ruta);
});

test('D326 · cambiar de cuenta con guía abierta remonta la ayuda sin compartir la preferencia', async ({ page }) => {
  await entrar(page);
  await page.getByRole('button', { name: 'Ver guía', exact: true }).click();
  await expect(guia(page).getByRole('listitem')).toHaveCount(4);
  await page.evaluate(async () => {
    const ruta = '/src/api/storage.ts';
    const { loadSession, saveSession } = await import(/* @vite-ignore */ ruta);
    const sesion = loadSession();
    if (!sesion?.user) throw Error('falta la sesión sintética');
    const otro = 'a1000000-0000-4000-8000-000000000326';
    saveSession({ ...sesion, principal_id: otro, family_id: 'familia-sintetica-d326', user: { ...sesion.user, id: otro } });
  });
  await expect(guia(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ver guía', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Escanear', exact: true })).toBeVisible();
});

test('D326 · el link de invitación conserva su destino, sin interceptación de ayuda', async ({ page }) => {
  await entrar(page);
  await page.goto('/#/mesa/PA-9999?t=tok-sintetico-inexistente-d326');
  await expect(page.getByText('Este link ya no funciona')).toBeVisible();
  await expect(guia(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ver guía', exact: true })).toHaveCount(0);
  expect(page.url()).not.toContain('tok-sintetico');
});

test('D326 · guía en 375/430, horizontal y zoom; contenido traducido y controles alcanzables', async ({ page }, info) => {
  await entrar(page);
  await page.getByRole('button', { name: 'Ver guía', exact: true }).click();
  await expect(guia(page).getByRole('listitem')).toHaveCount(4);
  for (const [width, height, zoom] of [[375, 812, 1], [430, 932, 1], [844, 390, 1], [390, 844, 2]] as const) {
    await page.setViewportSize({ width, height });
    await page.evaluate((z) => { document.documentElement.style.zoom = String(z); }, zoom);
    await guia(page).getByRole('button', { name: 'Entendido', exact: true }).scrollIntoViewIfNeeded();
    await expect(guia(page).getByRole('button', { name: 'Entendido', exact: true })).toBeInViewport();
    const desborde = await guia(page).evaluate((e) => e.scrollWidth > e.clientWidth + 1);
    expect(desborde).toBe(false);
    await captura(page, `guia-${width}-${zoom}`, info);
  }
  await page.evaluate(() => { document.documentElement.style.zoom = ''; localStorage.setItem('payme.app.idioma.v1', 'en'); });
  await page.goto('/mas');
  await page.getByRole('button', { name: 'How to use PayMe', exact: true }).click();
  const en = page.getByRole('region', { name: 'How to use PayMe', exact: true });
  await expect(en.getByRole('heading', { name: 'Scan and review' })).toBeVisible();
  await en.getByRole('button', { name: 'Trips', exact: true }).click();
  await expect(en.getByRole('heading', { name: 'Check the balance' })).toBeVisible();
  await captura(page, 'guia-en', info);
});

test('D326 · viaje: ayuda cerrada, balance estable y gasto editable con nuevos nombres', async ({ page }, info) => {
  await entrar(page);
  await irEnLaApp(page, `/viaje/${VIAJE}`);
  await expect(page.getByRole('heading', { name: 'Cancún 2026', exact: true })).toBeVisible();
  const ayuda = page.locator('details').filter({ hasText: '¿Qué significa mi balance?' });
  await expect(ayuda).not.toHaveAttribute('open', '');
  const antes = await datos(page);
  await ayuda.locator('summary').click();
  await expect(ayuda.getByText(/Es lo que pagaste menos/)).toBeVisible();
  expect(await datos(page)).toEqual(antes);
  await captura(page, 'viaje-ayuda', info);
  await ayuda.locator('summary').click();
  await page.getByRole('button', { name: 'Ver balance del viaje', exact: true }).click();
  await expect(page.getByText('Abre un consumo para revisar su ticket y el reparto.')).toBeVisible();
  await captura(page, 'balance', info);
  await irEnLaApp(page, `/viaje/${VIAJE}`);
  await page.getByRole('button', { name: 'Agregar gasto', exact: true }).click();
  await page.getByLabel('Descripción', { exact: true }).fill('Cena de prueba sin guardar');
  await page.getByLabel('Monto', { exact: true }).fill('125.50');
  await expect(page.getByLabel('Descripción', { exact: true })).toHaveValue('Cena de prueba sin guardar');
  await captura(page, 'agregar-gasto', info);
  await expect(page.getByRole('button', { name: 'Ver guía', exact: true })).toHaveCount(0);
  expect(await datos(page)).toEqual(antes);
});

test('D326 · ayuda de porciones conserva la selección y los cálculos del ticket', async ({ page }, info) => {
  await entrar(page);
  await expect(page.getByRole('tab', { name: 'Viajes', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Te invitaron', exact: true })).toBeVisible();
  await expect(page.locator('.friend-avatar-notice')).toBeVisible();
  await captura(page, 'inicio-cargado', info);
  await page.getByRole('button', { name: 'Ver guía', exact: true }).click();
  await expect(guia(page).getByRole('listitem')).toHaveCount(4);
  await guia(page).getByRole('heading', { name: 'Cómo usar PayMe', exact: true }).focus();
  await captura(page, 'guia-cabecera', info);
  await guia(page).getByRole('button', { name: 'Cerrar guía' }).click();
  await irEnLaApp(page, `/viaje-ticket/${VIAJE}.d2000000-0000-4000-8000-000000000105`);
  await page.getByText('Tacos de pescado (3)', { exact: true }).click();
  const ruta = page.url();
  const radio = page.getByRole('radio', { name: 'Entero', exact: true });
  await expect(radio).toBeChecked();
  const antes = await datos(page);
  await page.getByText('¿Compartieron un plato?', { exact: true }).click();
  await expect(page.getByText(/Elige sólo tu porción:/)).toBeVisible();
  await expect(radio).toBeChecked();
  expect(page.url()).toBe(ruta);
  expect(await datos(page)).toEqual(antes);
  await captura(page, 'porciones-ayuda', info);
  await page.getByText('¿Compartieron un plato?', { exact: true }).click();
  await page.getByRole('button', { name: 'Listo', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/viaje/${VIAJE}$`));
  await expect(page.locator('.vjv-monto-deuda')).toHaveText(/^\u2212\$827/);
});

for (const lugar of ['Inicio', 'Más'] as const) {
  for (const movimiento of ['no-preference', 'reduce'] as const) {
    test(`D326 · apertura visible en ${lugar}, movimiento ${movimiento}`, async ({ page }, info) => {
      if (lugar === 'Inicio' && movimiento === 'reduce') await page.setViewportSize({ width: 844, height: 390 });
      await page.emulateMedia({ reducedMotion: movimiento });
      await entrar(page);
      await expect(page.getByRole('region', { name: 'Te invitaron', exact: true })).toBeVisible();
      await expect(page.locator('.friend-avatar-notice')).toBeVisible();
      await expect(page.getByRole('button', { name: /Cancún 2026/ }).first()).toBeVisible();
      // Ofrecer ayuda por primera vez no desplaza el contenido de Inicio.
      expect(await page.locator('.scroll').first().evaluate((e) => e.scrollTop)).toBe(0);
      if (lugar === 'Más') await page.getByRole('button', { name: 'Más', exact: true }).click();
      const ruta = page.url();
      const antes = await datos(page);
      await page.getByRole('button', { name: lugar === 'Inicio' ? 'Ver guía' : 'Cómo usar PayMe', exact: true }).click();
      await expect(guia(page).getByRole('listitem')).toHaveCount(4);
      // Ningún focus/scrollIntoView/click sobre la guía después de abrirla: se mide el primer cuadro útil.
      const medida = await guia(page).evaluate((panel) => {
        const screen = panel.closest('.screen')!;
        const scroll = panel.closest('.scroll')!;
        const techo = Math.max(0, scroll.getBoundingClientRect().top, screen.querySelector('.hdr')!.getBoundingClientRect().bottom);
        const piso = Math.min(window.innerHeight, screen.querySelector('.appbar-block')!.getBoundingClientRect().top, screen.querySelector('.appbar-fab')!.getBoundingClientRect().top);
        const controles = Array.from(panel.querySelectorAll('h2, .guia-cerrar, .guia-recorridos button')).map((e) => {
          const r = e.getBoundingClientRect();
          // Bordes medios y centro: las esquinas redondas no pertenecen al blanco de toque.
          const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
          const puntos = [[cx, r.top + 3], [cx, r.bottom - 3], [r.left + 3, cy], [r.right - 3, cy], [cx, cy]];
          return { nombre: e.textContent || e.getAttribute('aria-label'), top: r.top, bottom: r.bottom, libre: puntos.every(([x, y]) => { const encima = document.elementFromPoint(x!, y!); return encima !== null && (encima === e || e.contains(encima)); }) };
        });
        return { techo, piso, controles };
      });
      await info.attach('apertura-geometria', { body: JSON.stringify(medida, null, 2), contentType: 'application/json' });
      expect(medida.controles).toHaveLength(5);
      for (const c of medida.controles) {
        expect(c.top, `${c.nombre}: encima de cabecera`).toBeGreaterThanOrEqual(medida.techo);
        expect(c.bottom, `${c.nombre}: encima de barra/círculo`).toBeLessThanOrEqual(medida.piso);
        expect(c.libre, `${c.nombre}: sin oclusión`).toBe(true);
      }
      expect(page.url()).toBe(ruta);
      expect(await datos(page)).toBe(antes);
      await expect(guia(page).getByRole('heading', { name: 'Cómo usar PayMe', exact: true })).toBeFocused();
      await captura(page, `apertura-${lugar}-${movimiento}`, info);
    });
  }
}
