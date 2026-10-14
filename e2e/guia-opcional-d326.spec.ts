import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { ingresar, irEnLaApp, relojFueraDeLasFechasDeLosViajes } from './_app';
import { camarasAbiertas, sacarFoto } from './_camara';

// D327 reemplaza explícitamente la guía plana D326; conserva sus invariantes de aislamiento.
const VIAJE = 'd1000000-0000-4000-8000-000000000001';
const guia = (page: Page) => page.getByRole('region', { name: 'Guía interactiva', exact: true });
async function captura(page: Page, nombre: string, info: TestInfo) {
  if (process.env.D327_CAPTURES === '1') await page.screenshot({ path: info.outputPath(`${nombre}.png`), fullPage: true });
}
async function entrar(page: Page) {
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
async function abrir(page: Page) {
  await page.getByRole('button', { name: 'Ver guía', exact: true }).click();
  await expect(guia(page)).toBeVisible();
  await expect(page.locator('.guia-foco')).toBeVisible();
}
async function geometria(page: Page) {
  await expect(page.locator('.guia-foco')).toBeVisible();
  await expect(async () => {
  const medida = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('.guia-burbuja')!;
    const foco = document.querySelector<HTMLElement>('.guia-foco')!;
    const target = document.querySelector<HTMLElement>(`[data-guia="${foco.dataset.objetivo}"]`)!;
    const b = panel.getBoundingClientRect(), r = target.getBoundingClientRect();
    const puntos = (e: Element) => {
      const q = e.getBoundingClientRect(), x = (q.left + q.right) / 2, y = (q.top + q.bottom) / 2;
      return [[x, y], [x, q.top + 3], [x, q.bottom - 3], [q.left + 3, y], [q.right - 3, y]].every(([a, c]) => {
        const hit = document.elementFromPoint(a!, c!); return hit === e || (hit !== null && e.contains(hit));
      });
    };
    const barra = Math.min(window.innerHeight, ...Array.from(document.querySelectorAll('.appbar-block, .appbar-fab, .vj-pie')).map((e) => e.getBoundingClientRect().top));
    return { noSolapa: b.bottom <= r.top || b.top >= r.bottom || b.right <= r.left || b.left >= r.right,
      visible: b.left >= 0 && b.right <= window.innerWidth && b.top >= 0 && b.bottom <= barra,
      objetivoLibre: puntos(target), botones: Array.from(panel.querySelectorAll('button')).map((e) => ({ alto: e.getBoundingClientRect().height, libre: puntos(e) })) };
  });
  expect(medida.noSolapa).toBe(true); expect(medida.visible).toBe(true); expect(medida.objetivoLibre).toBe(true);
  for (const b of medida.botones) { expect(b.alto).toBeGreaterThanOrEqual(44); expect(b.libre).toBe(true); }
  }).toPass({ timeout: 10000 });
}

// Diagnóstico geométrico sin capturas adicionales ni cambios en la app.
test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) return;
  const medidas = await page.evaluate(() => Array.from(document.querySelectorAll('[data-guia], .guia-burbuja, .guia-nota, .hdr, .appbar-block, .appbar-fab')).map((e) => ({ target: e.getAttribute('data-guia'), clase: e.className, rect: e.getBoundingClientRect().toJSON() }))).catch(() => []);
  await info.attach('geometria-fallo', { body: JSON.stringify(medidas, null, 2), contentType: 'application/json' });
});

test('D327 · voluntaria y lazy: primer gesto de cámara intacto', async ({ page }) => {
  const modulos: string[] = [];
  page.on('request', (r) => { if (r.url().includes('/GuiaContenido')) modulos.push(r.url()); });
  await entrar(page);
  await expect(guia(page)).toHaveCount(0); expect(modulos).toEqual([]);
  expect(await page.locator('.scroll').first().evaluate((e) => e.scrollTop)).toBe(0);
  await page.getByRole('button', { name: 'Escanear', exact: true }).click();
  await expect.poll(() => camarasAbiertas(page)).toBe(1);
  await expect(page).toHaveURL(/\/scan$/);
  await expect(guia(page)).toHaveCount(0); expect(modulos).toEqual([]);
});

test('D327 · burbujas reales, Siguiente/Atrás sin negocio y cierre con foco', async ({ page }, info) => {
  await entrar(page);
  // La configuración mock habilita Viajes después del primer render; esperar su precarga real antes de contar.
  await expect.poll(() => page.evaluate(async () => {
    const ruta = '/src/api/viajesDeHoy.ts';
    const { viajesAbiertosRecordados } = await import(/* @vite-ignore */ ruta);
    return viajesAbiertosRecordados() !== null;
  })).toBe(true);
  const ruta = page.url(), antes = await datos(page);
  await page.evaluate(async () => {
    const observadores = new Set<object>();
    const llamadas: string[] = [];
    const rutaApi = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ rutaApi);
    for (const [nombre, fn] of Object.entries(api)) {
      if (typeof fn === 'function') Reflect.set(api, nombre, (...args: unknown[]) => { llamadas.push(nombre); return fn.apply(api, args); });
    }
    for (const nombre of ['MutationObserver', 'ResizeObserver'] as const) {
      const Base = window[nombre];
      Reflect.set(window, nombre, class extends Base {
        observe(...args: Parameters<MutationObserver['observe']> & Parameters<ResizeObserver['observe']>) { observadores.add(this); super.observe(...args); }
        disconnect() { observadores.delete(this); super.disconnect(); }
      });
    }
    Reflect.set(window, '__d327Efectos', { llamadas, observadores });
  });
  await abrir(page);
  await expect(guia(page).getByRole('heading', { name: 'Escanear', exact: true })).toBeFocused();
  await geometria(page); await captura(page, 'inicio-camara-390', info);
  await guia(page).getByRole('button', { name: 'Siguiente', exact: true }).click();
  await expect(page.locator('.guia-foco')).toHaveAttribute('data-objetivo', 'tab-viajes');
  await geometria(page); await captura(page, 'inicio-viajes-390', info);
  await guia(page).getByRole('button', { name: 'Atrás', exact: true }).click();
  await expect(page.locator('.guia-foco')).toHaveAttribute('data-objetivo', 'camara');
  expect(page.url()).toBe(ruta); expect(await datos(page)).toBe(antes); expect(await camarasAbiertas(page)).toBe(0);
  await page.keyboard.press('Escape');
  await expect(guia(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Escanear', exact: true })).toBeFocused();
  await expect(page.locator('[aria-describedby~="guia-explicacion"]')).toHaveCount(0);
  const efectos = await page.evaluate(() => {
    const e = Reflect.get(window, '__d327Efectos') as { llamadas: string[]; observadores: Set<object> };
    return { llamadas: e.llamadas, observadores: e.observadores.size };
  });
  expect(efectos).toEqual({ llamadas: [], observadores: 0 });
  await page.getByRole('button', { name: 'Más', exact: true }).click();
  await page.getByRole('button', { name: 'Cómo usar PayMe', exact: true }).click();
  await expect(page.locator('.guia-foco')).toHaveAttribute('data-objetivo', 'nav-home');
  await guia(page).getByRole('button', { name: 'Cerrar guía' }).click();
  await expect(page.getByRole('button', { name: 'Cómo usar PayMe', exact: true })).toBeFocused();
});

test('D327 · viaje, gasto y borrador intactos; balance contextual', async ({ page }, info) => {
  await entrar(page); await abrir(page);
  await irEnLaApp(page, `/viaje/${VIAJE}`);
  await expect(page.getByRole('heading', { name: 'Cancún 2026', exact: true })).toBeVisible();
  await expect(page.locator('.guia-foco')).toHaveAttribute('data-objetivo', 'camara');
  await guia(page).getByRole('button', { name: 'Siguiente', exact: true }).click();
  await expect(page.locator('.guia-foco')).toHaveAttribute('data-objetivo', 'agregar-gasto');
  await geometria(page); await captura(page, 'viaje-agregar-gasto', info);
  await page.getByRole('button', { name: 'Agregar gasto', exact: true }).click();
  await page.getByLabel('Descripción', { exact: true }).fill('Cena sin guardar');
  await page.getByLabel('Monto', { exact: true }).fill('125.50');
  const ruta = page.url(), antes = await datos(page);
  await guia(page).getByRole('button', { name: 'Siguiente', exact: true }).click();
  await guia(page).getByRole('button', { name: 'Siguiente', exact: true }).click();
  await expect(page.locator('.guia-foco')).toHaveAttribute('data-objetivo', 'quien-pago');
  await captura(page, 'gasto-quien-pago', info);
  await guia(page).getByRole('button', { name: 'Cerrar guía' }).click();
  await expect(page.getByLabel('Descripción', { exact: true })).toHaveValue('Cena sin guardar');
  await expect(page.getByLabel('Monto', { exact: true })).toHaveValue('125.50');
  expect(page.url()).toBe(ruta); expect(await datos(page)).toBe(antes);
});

test('D327 · porciones reales conservan selección y cálculo', async ({ page }, info) => {
  await entrar(page); await abrir(page);
  await irEnLaApp(page, `/viaje-ticket/${VIAJE}.d2000000-0000-4000-8000-000000000105`);
  await expect(page.locator('.guia-foco')).toHaveAttribute('data-objetivo', 'elegir-consumo');
  await page.getByText('Tacos de pescado (3)', { exact: true }).click();
  const radio = page.getByRole('radio', { name: 'Entero', exact: true });
  await expect(radio).toBeChecked();
  // Los pasos disponibles cambian con el estado real; avanzar no toca la porción.
  const antes = await datos(page), ruta = page.url();
  for (let i = 0; i < 2 && await page.locator('.guia-foco').getAttribute('data-objetivo') !== 'porcion'; i++) {
    await guia(page).getByRole('button', { name: 'Siguiente', exact: true }).click();
  }
  await expect(page.locator('.guia-foco')).toHaveAttribute('data-objetivo', 'porcion');
  await geometria(page); await captura(page, 'ticket-porcion-real', info);
  await page.keyboard.press('Escape');
  await expect(radio).toBeChecked(); expect(page.url()).toBe(ruta); expect(await datos(page)).toBe(antes);
  await page.getByRole('button', { name: 'Listo', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/viaje/${VIAJE}$`));
  await expect(page.locator('.vjv-monto-deuda')).toHaveText(/^\u2212\$827/);
});

test('D327 · restaurante: ticket, modal prioritario y reparto sin acciones automáticas', async ({ page }, info) => {
  await entrar(page); await abrir(page);
  await page.getByRole('button', { name: 'Escanear', exact: true }).click();
  await expect.poll(() => camarasAbiertas(page)).toBe(1);
  await sacarFoto(page);
  await expect(page.getByRole('radio', { name: /Pagar el total/ })).toBeVisible();
  await expect(page.locator('.guia-foco')).toHaveAttribute('data-objetivo', 'revisar-ticket');
  await geometria(page); await captura(page, 'restaurante-revisar-ticket', info);
  await page.getByRole('button', { name: 'Ver el ticket', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible(); await expect(guia(page)).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(guia(page).getByRole('button', { name: 'Retomar guía' })).toBeVisible();
  await guia(page).getByRole('button', { name: 'Retomar guía' }).click();
  await guia(page).getByRole('button', { name: 'Siguiente', exact: true }).click();
  await expect(page.locator('.guia-foco')).toHaveAttribute('data-objetivo', 'reparto');
  const marcada = await page.getByRole('radio', { checked: true }).getAttribute('aria-checked');
  await captura(page, 'restaurante-reparto', info);
  await guia(page).getByRole('button', { name: 'Siguiente', exact: true }).click();
  await expect(page.locator('.guia-foco')).toHaveAttribute('data-objetivo', 'personas');
  expect(await page.getByRole('radio', { checked: true }).getAttribute('aria-checked')).toBe(marcada);
  await expect(page.getByRole('group', { name: '¿Cuántos son en la mesa?' })).toContainText('—');
});

test('D327 · cuenta/familia/logout, almacenamiento fallido y enlace prioritario', async ({ page }) => {
  await entrar(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (k.startsWith('payme.app.guia.')) throw Error('storage sintético denegado'); return original.call(this, k, v); };
  });
  await abrir(page);
  await irEnLaApp(page, '/#/mesa/PA-9999?t=tok-sintetico-inexistente-d327');
  await expect(page.getByText('Este link ya no funciona')).toBeVisible();
  await expect(guia(page)).toHaveCount(0);
  await irEnLaApp(page, '/mas');
  await page.getByRole('button', { name: 'Cómo usar PayMe', exact: true }).click();
  await page.getByRole('button', { name: 'Inicio', exact: true }).click();
  await page.evaluate(async () => {
    const ruta = '/src/api/storage.ts';
    const { loadSession, saveSession } = await import(/* @vite-ignore */ ruta);
    const s = loadSession(); if (!s?.user) throw Error('sesión sintética ausente');
    const otro = 'a1000000-0000-4000-8000-000000000327';
    saveSession({ ...s, principal_id: otro, family_id: 'familia-d327', user: { ...s.user, id: otro } });
  });
  await expect(guia(page)).toHaveCount(0);
  // No depender de la oferta transitoria: el principal nuevo carece de @usuario y su puerta debe tomar prioridad.
  await expect(page.getByRole('dialog', { name: 'Elige tu @usuario' })).toBeVisible();
  await expect(guia(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  await expect(guia(page)).toHaveCount(0);
  await expect(page.locator('.guia-foco')).toHaveCount(0);
});

test('D327 · 375/430/horizontal/reduced-motion/zoom y traducción', async ({ page }, info) => {
  await entrar(page); await page.emulateMedia({ reducedMotion: 'reduce' }); await abrir(page);
  for (const [width, height] of [[375, 812], [430, 932], [844, 390]] as const) {
    await page.setViewportSize({ width, height });
    await geometria(page); await captura(page, `guia-${width}`, info);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  await expect(guia(page)).toBeVisible();
  expect(await guia(page).evaluate((e) => e.scrollWidth > e.clientWidth + 1)).toBe(false);
  await guia(page).getByRole('button', { name: 'Cerrar guía' }).scrollIntoViewIfNeeded();
  await expect(guia(page).getByRole('button', { name: 'Cerrar guía' })).toBeInViewport();
  await captura(page, 'guia-zoom200', info);
  await guia(page).getByRole('button', { name: 'Cerrar guía' }).click();
  await page.evaluate(() => { document.documentElement.style.zoom = ''; localStorage.setItem('payme.app.idioma.v1', 'en'); });
  await page.goto('/mas');
  await page.getByRole('button', { name: 'How to use PayMe', exact: true }).click();
  const en = page.getByRole('region', { name: 'Interactive guide', exact: true });
  await expect(en.getByRole('heading', { name: 'Start at Home' })).toBeVisible();
  await captura(page, 'guide-english', info);
});
