import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { irEnLaApp, relojFueraDeLasFechasDeLosViajes } from './_app';
import { camaraSimulada, camarasAbiertas, sacarFoto } from './_camara';

// D327 reemplaza explícitamente la guía plana D326; conserva sus invariantes de aislamiento.
const VIAJE = 'd1000000-0000-4000-8000-000000000001';
const guia = (page: Page) => page.getByRole('region', { name: 'Guía interactiva', exact: true });
async function captura(page: Page, nombre: string, info: TestInfo) {
  if (process.env.D327_CAPTURES === '1') await page.screenshot({ path: info.outputPath(`${nombre}.png`), fullPage: true });
}
async function posponerAviso(page: Page) {
  const aviso = page.getByRole('complementary', { name: 'Actualización del Aviso de Privacidad', exact: true });
  await expect(aviso).toBeVisible();
  await aviso.getByRole('button', { name: 'Ahora no', exact: true }).click();
}
async function entrar(page: Page, antesDelLogin?: () => Promise<void>, conservarPrioridades = false) {
  await page.route('**/*', (r) => {
    const url = new URL(r.request().url());
    return ['127.0.0.1', 'localhost'].includes(url.hostname) || url.protocol === 'data:' ? r.continue() : r.abort();
  });
  await relojFueraDeLasFechasDeLosViajes(page);
  await page.addInitScript(() => {
    localStorage.setItem('payme.app.mock.viajes.v1', 'encendido');
    localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled');
  });
  await camaraSimulada(page); await page.goto('/');
  if (!conservarPrioridades) await page.evaluate(async () => {
    const ruta = '/src/api/mock/store.ts';
    const { state, persist } = await import(/* @vite-ignore */ ruta);
    state.pendingInvitations = []; persist();
  });
  await antesDelLogin?.();
  await page.getByLabel('Email', { exact: true }).fill('mati@payme.mx');
  await page.getByLabel('Contraseña', { exact: true }).fill('demo-e2e');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Escanear', exact: true })).toBeVisible();
  if (!conservarPrioridades) { await posponerAviso(page); await expect(guia(page)).toBeVisible(); }
}
async function datos(page: Page) {
  return page.evaluate(async () => {
    const ruta = '/src/api/mock/store.ts';
    const { state } = await import(/* @vite-ignore */ ruta);
    return JSON.stringify({ mesas: state.mesas, viajes: localStorage.getItem('payme.app.mock.viajes.estado.v1') });
  });
}
async function abrir(page: Page) {
  if (!await guia(page).isVisible()) await page.getByRole('button', { name: 'Ver guía', exact: true }).click();
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
      viewport: { width: window.innerWidth, height: window.innerHeight }, panel: b.toJSON(), target: r.toJSON(),
      visible: b.left >= 0 && b.right <= window.innerWidth && b.top >= 0 && b.bottom <= barra,
      objetivoLibre: puntos(target), botones: Array.from(panel.querySelectorAll('button')).map((e) => ({ nombre: e.getAttribute('aria-label') ?? e.textContent, rect: e.getBoundingClientRect().toJSON(), alto: e.getBoundingClientRect().height, libre: puntos(e) })) };
  });
  const detalle = JSON.stringify(medida);
  expect(medida.noSolapa, detalle).toBe(true); expect(medida.visible, detalle).toBe(true); expect(medida.objetivoLibre, detalle).toBe(true);
  for (const b of medida.botones) { expect(b.alto, detalle).toBeGreaterThanOrEqual(44); expect(b.libre, detalle).toBe(true); }
  expect(await guia(page).locator('label').evaluate((e) => e.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  }).toPass({ timeout: 10000 });
}

// Diagnóstico geométrico sin capturas adicionales ni cambios en la app.
test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) return;
  const medidas = await page.evaluate(() => Array.from(document.querySelectorAll('[data-guia], .guia-burbuja, .guia-nota, .hdr, .appbar-block, .appbar-fab')).map((e) => ({ target: e.getAttribute('data-guia'), clase: e.className, rect: e.getBoundingClientRect().toJSON() }))).catch(() => []);
  console.error('D328_GEOMETRIA_FALLO', JSON.stringify(medidas));
  await info.attach('geometria-fallo', { body: JSON.stringify(medidas, null, 2), contentType: 'application/json' });
  // Sólo estado UI de la guía; sin sesión, perfil, storage ni capturas adicionales.
  console.error('D328_ESTADO_GUIA_FALLO', await page.evaluate(() => ({
    idioma: document.documentElement.lang,
    guia: Array.from(document.querySelectorAll('.guia-burbuja')).map((e) => ({
      nombre: e.getAttribute('aria-label'), titulo: e.querySelector('h2')?.textContent,
      lado: e.getAttribute('data-lado'), oculta: !!e.closest('[hidden], [inert]'),
      botones: Array.from(e.querySelectorAll('button')).map((b) => b.getAttribute('aria-label') ?? b.textContent),
    })),
    modalesVisibles: Array.from(document.querySelectorAll('[aria-modal="true"], dialog[open]'))
      .filter((e) => e.getClientRects().length > 0 && !e.closest('[hidden], [inert]') && getComputedStyle(e).visibility !== 'hidden').length,
  })).catch(() => ({ documentoNoDisponible: true })));
});

test('D328 · inicio sin consentimiento heredado, cierre temporal y cámara nativa', async ({ page }) => {
  await entrar(page, () => page.evaluate(async () => {
    const ruta = '/src/api/mock/store.ts'; const { state } = await import(/* @vite-ignore */ ruta);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`auth:${state.user.id}`));
    const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(`payme.app.guia.v1.mock.${hash}`, '1');
  }));
  await expect(guia(page).getByRole('checkbox', { name: 'No volver a mostrar', exact: true })).not.toBeChecked();
  expect(await camarasAbiertas(page)).toBe(0);
  await guia(page).getByRole('button', { name: 'Cerrar guía' }).click();
  await page.getByRole('button', { name: 'Escanear', exact: true }).click();
  await expect.poll(() => camarasAbiertas(page)).toBe(1);
  await expect(page).toHaveURL(/\/scan$/); await expect(guia(page)).toHaveCount(0);
  await irEnLaApp(page, '/home'); await expect(guia(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Ocultar guía por ahora', exact: true }).click();
  expect(await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('payme.app.guia.optout.')))).toBe(false);
  await page.reload(); await posponerAviso(page); await expect(guia(page)).toBeVisible();
  await guia(page).getByRole('button', { name: 'Siguiente', exact: true }).click();
  await guia(page).getByRole('button', { name: 'Siguiente', exact: true }).click();
  await guia(page).getByRole('button', { name: 'Terminar guía', exact: true }).click();
  await expect(guia(page)).toHaveCount(0);
  await page.reload(); await posponerAviso(page); await expect(guia(page)).toBeVisible();
});

test('D328 · opt-out explícito reversible, reapertura y engine ausente al próximo inicio', async ({ page }) => {
  await entrar(page);
  const casilla = guia(page).getByRole('checkbox', { name: 'No volver a mostrar', exact: true });
  await casilla.check(); await casilla.uncheck(); await casilla.check();
  await guia(page).getByRole('button', { name: 'Cerrar guía' }).click();
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('payme.app.guia.optout.v2.mock.') && localStorage.getItem(k) === '1'))).toBe(true);
  const modulos: string[] = [];
  page.on('request', (r) => { if (r.url().includes('/GuiaContenido')) modulos.push(r.url()); });
  await page.reload(); await posponerAviso(page);
  await expect(page.getByRole('button', { name: 'Escanear', exact: true })).toBeVisible();
  await expect(guia(page)).toHaveCount(0); expect(modulos).toEqual([]);
  await page.getByRole('button', { name: 'Más', exact: true }).click();
  await page.getByRole('button', { name: 'Cómo usar PayMe', exact: true }).click();
  await expect(casilla).toBeChecked(); await casilla.uncheck();
  await guia(page).getByRole('button', { name: 'Cerrar guía' }).click();
  await page.getByRole('button', { name: 'Inicio', exact: true }).click();
  await expect(guia(page)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('payme.app.guia.optout.')))).toBe(false);
  await page.reload(); await posponerAviso(page); await expect(guia(page)).toBeVisible();
  await expect(casilla).not.toBeChecked();
});

test('D328 · aviso e invitación conservan prioridad y omitir no persiste exclusión', async ({ page }) => {
  await entrar(page, undefined, true);
  await expect(page.getByRole('button', { name: 'Sumarme', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ocultar guía por ahora', exact: true })).toBeVisible();
  await expect(guia(page)).toHaveCount(0);
  await posponerAviso(page); await expect(guia(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Ocultar guía por ahora', exact: true }).click();
  await page.evaluate(async () => {
    const ruta = '/src/api/mock/store.ts'; const { state, persist } = await import(/* @vite-ignore */ ruta);
    state.pendingInvitations = []; persist();
  });
  await page.getByRole('button', { name: 'Más', exact: true }).click();
  await page.getByRole('button', { name: 'Inicio', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sumarme', exact: true })).toHaveCount(0);
  await expect(guia(page)).toHaveCount(0);
  await page.reload(); await posponerAviso(page); await expect(guia(page)).toBeVisible();
});

test('D327 · burbujas reales, Siguiente/Atrás sin negocio y cierre con foco', async ({ page }, info) => {
  // Medir desde antes del login permite esperar el arranque real, sin ignorar APIs ni usar una pausa fija.
  await entrar(page, () => page.evaluate(async () => {
    const ruta = '/src/api/index.ts';
    const { api } = await import(/* @vite-ignore */ ruta);
    const arranque = { llamadas: [] as string[], pendientes: 0, usernameListo: false };
    for (const [nombre, fn] of Object.entries(api)) {
      if (typeof fn !== 'function') continue;
      Reflect.set(api, nombre, (...args: unknown[]) => {
        arranque.llamadas.push(nombre);
        const retorno = fn.apply(api, args);
        if (!retorno || typeof retorno.then !== 'function') return retorno;
        arranque.pendientes++;
        return Promise.resolve(retorno).then((valor) => {
          if (nombre === 'getUsername') arranque.usernameListo = true;
          return valor;
        }).finally(() => { arranque.pendientes--; });
      });
    }
    Reflect.set(window, '__d327Arranque', arranque);
  }));
  await expect.poll(() => page.evaluate(async () => {
    const ruta = '/src/api/viajesDeHoy.ts';
    const { viajesAbiertosRecordados } = await import(/* @vite-ignore */ ruta);
    const a = Reflect.get(window, '__d327Arranque') as { pendientes: number; usernameListo: boolean };
    return a.usernameListo && a.pendientes === 0 && viajesAbiertosRecordados() !== null;
  })).toBe(true);
  await guia(page).getByRole('button', { name: 'Cerrar guía' }).click();
  await expect(guia(page)).toHaveCount(0);
  const ruta = page.url(), antes = await datos(page);
  await page.evaluate(() => {
    const observadores = new Map<object, string>();
    const ajenos = new Map<object, string>();
    const instrumentales = new Map<object, string>();
    const { llamadas } = Reflect.get(window, '__d327Arranque') as { llamadas: string[] };
    llamadas.length = 0;
    for (const nombre of ['MutationObserver', 'ResizeObserver'] as const) {
      const Base = window[nombre];
      Reflect.set(window, nombre, class extends Base {
        observe(...args: Parameters<MutationObserver['observe']> & Parameters<ResizeObserver['observe']>) {
          const target = args[0] as Node;
          const elemento = target instanceof Element ? target : null;
          const traza = new Error().stack ?? '';
          const opciones = args[1] as MutationObserverInit | undefined;
          const detalle = `${nombre}:${target.nodeName}:${JSON.stringify(opciones)}\n${traza}`;
          const frames = traza.split('\n').map((linea) => linea.trim());
          const llamador = frames[2] ?? '', padre = frames[3] ?? '';
          const claves = Object.keys(opciones ?? {}).sort().join(',');
          const soloHijos = claves === 'childList' && opciones?.childList === true;
          const soloAtributos = claves === 'attributes,subtree'
            && opciones?.attributes === true && opciones.subtree === true;
          // Playwright 1.62.1: invocadores DIRECTOS y opciones de sus tres observe(Document).
          // InjectedScript vigila la pérdida de listeners; Streamer vigila listeners/atributos.
          // No basta un nombre en cualquier nivel de la traza. BODY y Document desconocidos cuentan.
          const listenersInyectados = soloHijos
            && /^at InjectedScript\._setupGlobalListenersRemovalDetection \(<anonymous>:\d+:\d+\)$/.test(llamador)
            && /^at new InjectedScript \(<anonymous>:\d+:\d+\)$/.test(padre);
          const listenersSnapshot = soloHijos
            && /^at Streamer\._refreshListenersWhenNeeded \(/.test(llamador)
            && /^at Streamer\._ensureObservingCurrentDocument \(/.test(padre);
          const atributosSnapshot = soloAtributos
            && /^at Streamer\._ensureObservingCurrentDocument \(/.test(llamador)
            && /^at (?:new Streamer|Streamer\.captureSnapshot) \(/.test(padre);
          const instrumental = nombre === 'MutationObserver' && target === document
            && (listenersInyectados || listenersSnapshot || atributosSnapshot);
          if (instrumental && !observadores.has(this)) instrumentales.set(this, detalle);
          else if (nombre === 'MutationObserver' || elemento?.matches('.guia-burbuja, [data-guia]')) {
            instrumentales.delete(this); observadores.set(this, detalle);
          } else ajenos.set(this, `${nombre}:${elemento?.className ?? target.nodeName}`);
          super.observe(...args);
        }
        disconnect() { observadores.delete(this); ajenos.delete(this); instrumentales.delete(this); super.disconnect(); }
      });
    }
    Reflect.set(window, '__d327Efectos', { llamadas, observadores, ajenos, instrumentales });
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
    const e = Reflect.get(window, '__d327Efectos') as { llamadas: string[]; observadores: Map<object, string>; ajenos: Map<object, string> };
    return { llamadas: e.llamadas, observadores: e.observadores.size };
  });
  console.info('D328_OBSERVADORES_AL_CERRAR', await page.evaluate(() => {
    const e = Reflect.get(window, '__d327Efectos') as { observadores: Map<object, string>; ajenos: Map<object, string>; instrumentales: Map<object, string> };
    return { guia: [...e.observadores.values()], ajenos: [...e.ajenos.values()], instrumentales: [...e.instrumentales.values()] };
  }));
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
  // Contrato vigente: falta de personas explica al tocar, no deshabilita el CTA.
  await expect(page.getByRole('button', { name: 'Continuar', exact: true })).toBeEnabled();
  const ruta = page.url();
  await guia(page).getByRole('button', { name: 'Cerrar guía' }).click();
  await expect(page.getByRole('button', { name: 'Continuar', exact: true })).toBeFocused();
  expect(page.url()).toBe(ruta);
});

test('D328 · cierre con acción principal realmente deshabilitada conserva borrador y enfoca Volver', async ({ page }) => {
  await entrar(page);
  await irEnLaApp(page, `/viaje/${VIAJE}`);
  await page.getByRole('button', { name: 'Agregar gasto', exact: true }).click();
  await page.getByLabel('Descripción', { exact: true }).fill('Borrador sin monto');
  await expect(page.getByRole('button', { name: 'Listo', exact: true })).toBeDisabled();
  const ruta = page.url(), antes = await datos(page);
  await guia(page).getByRole('button', { name: 'Cerrar guía' }).click();
  await expect(page.getByRole('button', { name: 'Volver', exact: true })).toBeFocused();
  await expect(page.getByLabel('Descripción', { exact: true })).toHaveValue('Borrador sin monto');
  await expect(page.getByLabel('Monto', { exact: true })).toHaveValue('');
  expect(page.url()).toBe(ruta); expect(await datos(page)).toBe(antes);
});

test('D327 · cuenta/familia/logout, almacenamiento fallido y enlace prioritario', async ({ page }) => {
  await entrar(page);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (k.startsWith('payme.app.guia.')) throw Error('storage sintético denegado'); return original.call(this, k, v); };
  });
  await abrir(page);
  await guia(page).getByRole('checkbox', { name: 'No volver a mostrar', exact: true }).check();
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
  const en = page.getByRole('region', { name: 'Interactive guide', exact: true });
  // Se conserva la autoentrada a /mas: no abrir la guía mediante Ayuda ni modificar gates.
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(en).toBeVisible();
  // Más refresca el perfil y puede revalidar las puertas de la misma sesión.
  // La pausa permitida exige un gesto real para retomar; no equivale al título del paso.
  const tituloEn = en.getByRole('heading');
  await expect(tituloEn).toHaveText(/^(Start at Home|Continue when ready)$/);
  if (await tituloEn.textContent() === 'Continue when ready') {
    await expect(en.getByText('The guide paused to let you use the screen. Resume it when you are ready.', { exact: true })).toBeVisible();
    await en.getByRole('button', { name: 'Resume guide', exact: true }).click();
  }
  await expect(en.getByRole('heading', { name: 'Start at Home' })).toBeVisible();
  await expect(page.locator('.guia-foco')).toHaveAttribute('data-objetivo', 'nav-home');
  await expect(en.getByRole('checkbox', { name: 'Don’t show again', exact: true })).not.toBeChecked();
  await captura(page, 'guide-english', info);
});
