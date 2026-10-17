import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { irEnLaApp, relojFueraDeLasFechasDeLosViajes } from './_app';
import { camaraSimulada, camarasAbiertas, sacarFoto } from './_camara';

// D341-M2 («Tu turno») reemplaza el catálogo por pantalla de D327; conserva las invariantes de D326/D327/D328.
const VIAJE = 'd1000000-0000-4000-8000-000000000001';
const guia = (page: Page) => page.getByRole('region', { name: 'Guía interactiva', exact: true });
const foco = (page: Page) => page.locator('.guia-foco');
const boton = (page: Page, nombre: string) => guia(page).getByRole('button', { name: nombre, exact: true });
async function captura(page: Page, nombre: string, info: TestInfo) {
  if (process.env.D341_CAPTURES === '1') await page.screenshot({ path: info.outputPath(`${nombre}.png`), fullPage: false });
}
async function posponerAviso(page: Page) {
  const aviso = page.getByRole('complementary', { name: 'Actualización del Aviso de Privacidad', exact: true });
  await expect(aviso).toBeVisible();
  await aviso.getByRole('button', { name: 'Ahora no', exact: true }).click();
}
async function entrar(page: Page, antesDelLogin?: () => Promise<void>, conservarPrioridades = false) {
  await page.route('**/*', (r) => {
    const url = new URL(r.request().url());
    return ['127.0.0.1', 'localhost'].includes(url.hostname) || url.protocol === 'data:' || url.protocol === 'blob:' ? r.continue() : r.abort();
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
}
/** El paso que muestra la burbuja; a diferencia del resaltado, existe aunque el control esté fuera de la vista. */
const pasoActual = (page: Page) => page.locator('.guia-burbuja').getAttribute('data-paso', { timeout: 5_000 }).catch(() => null);
/**
 * Avanza con Siguiente hasta el paso pedido, sin tocar la app. Después de cada toque espera a que el paso
 * cambie: un avance automático (la guía sigue sola en el cuadro siguiente) no debe sumar un toque de más.
 */
async function avanzarHasta(page: Page, objetivo: string, maximo = 8) {
  const burbuja = page.locator('.guia-burbuja');
  for (let i = 0; i < maximo; i++) {
    const actual = await pasoActual(page);
    if (actual === objetivo) break;
    await boton(page, 'Siguiente').click({ timeout: 5_000 });
    if (actual) await expect(burbuja).not.toHaveAttribute('data-paso', actual);
  }
  await expect(burbuja).toHaveAttribute('data-paso', objetivo);
}
async function geometria(page: Page) {
  await expect(foco(page)).toBeVisible();
  await expect(async () => {
  const medida = await page.evaluate(() => {
    const visible = (e: Element) => e.getClientRects().length > 0 && !e.closest('[hidden], [inert], .guia-capa');
    const panel = document.querySelector<HTMLElement>('.guia-burbuja')!;
    const marca = document.querySelector<HTMLElement>('.guia-foco')!;
    const target = Array.from(document.querySelectorAll<HTMLElement>(marca.dataset.ancla!)).find(visible)!;
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
  const casilla = guia(page).locator('label');
  if (await casilla.count()) expect(await casilla.evaluate((e) => e.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  }).toPass({ timeout: 10000 });
}

// Diagnóstico geométrico sin capturas adicionales ni cambios en la app.
test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) return;
  const medidas = await page.evaluate(() => Array.from(document.querySelectorAll('[data-guia], [data-guia-etapa], .guia-burbuja, .guia-foco, .hdr, .appbar-block, .appbar-fab')).map((e) => ({ target: e.getAttribute('data-guia') ?? e.getAttribute('data-guia-etapa'), clase: e.className, rect: e.getBoundingClientRect().toJSON() }))).catch(() => []);
  console.error('D341_GEOMETRIA_FALLO', JSON.stringify(medidas));
  await info.attach('geometria-fallo', { body: JSON.stringify(medidas, null, 2), contentType: 'application/json' });
  // Sólo estado UI de la guía; sin sesión, perfil, storage ni capturas adicionales.
  console.error('D341_ESTADO_GUIA_FALLO', await page.evaluate(() => ({
    idioma: document.documentElement.lang,
    foco: document.querySelector('.guia-foco')?.getAttribute('data-objetivo') ?? null,
    guia: Array.from(document.querySelectorAll('.guia-burbuja')).map((e) => ({
      nombre: e.getAttribute('aria-label'), titulo: e.querySelector('h2')?.textContent, chip: e.querySelector('.guia-chip')?.textContent,
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
  await boton(page, 'Cerrar guía').click();
  await page.getByRole('button', { name: 'Escanear', exact: true }).click();
  await expect.poll(() => camarasAbiertas(page)).toBe(1);
  await expect(page).toHaveURL(/\/scan$/); await expect(guia(page)).toHaveCount(0);
  await irEnLaApp(page, '/home'); await expect(guia(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'Ocultar guía por ahora', exact: true }).click();
  expect(await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('payme.app.guia.optout.')))).toBe(false);
  await page.reload(); await posponerAviso(page); await expect(guia(page)).toBeVisible();
  // Recorrer la bienvenida hasta «Tu turno» y cerrar sin marcar la casilla no suprime el próximo inicio.
  await avanzarHasta(page, 'escanear');
  await boton(page, 'Entendido').click();
  await expect(guia(page).getByRole('button', { name: 'Tu turno: toca Escanear', exact: true })).toBeVisible();
  await boton(page, 'Cerrar guía').click();
  await expect(guia(page)).toHaveCount(0);
  expect(await camarasAbiertas(page)).toBe(1);
  await page.reload(); await posponerAviso(page); await expect(guia(page)).toBeVisible();
});

test('D328 · opt-out explícito reversible, reapertura y engine ausente al próximo inicio', async ({ page }) => {
  await entrar(page);
  const casilla = guia(page).getByRole('checkbox', { name: 'No volver a mostrar', exact: true });
  await casilla.check(); await casilla.uncheck(); await casilla.check();
  await boton(page, 'Cerrar guía').click();
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('payme.app.guia.optout.v2.mock.') && localStorage.getItem(k) === '1'))).toBe(true);
  const modulos: string[] = [];
  page.on('request', (r) => { if (r.url().includes('/GuiaContenido')) modulos.push(r.url()); });
  await page.reload(); await posponerAviso(page);
  await expect(page.getByRole('button', { name: 'Escanear', exact: true })).toBeVisible();
  await expect(guia(page)).toHaveCount(0); expect(modulos).toEqual([]);
  await page.getByRole('button', { name: 'Más', exact: true }).click();
  await page.getByRole('button', { name: 'Cómo usar PayMe', exact: true }).click();
  await expect(casilla).toBeChecked(); await casilla.uncheck();
  await boton(page, 'Cerrar guía').click();
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

test('D341 · bienvenida con mapa, Siguiente/Atrás/Entendido sin negocio y cierre con foco', async ({ page }, info) => {
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
  await boton(page, 'Cerrar guía').click();
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
  await expect(guia(page).getByRole('heading', { name: 'Así se divide la cuenta en PayMe', exact: true })).toBeFocused();
  await expect(foco(page)).toHaveAttribute('data-objetivo', 'apertura');
  // El mapa del recorrido, con la etapa actual marcada y sin «Pagar» mientras los pagos están apagados.
  const mapa = guia(page).getByRole('list', { name: 'Recorrido de la guía' });
  await expect(mapa.getByRole('listitem')).toHaveText(['Foto', '→Dividir', '→Invitar', '→Elegir']);
  await expect(mapa.locator('[aria-current="step"]')).toHaveText('Foto');
  await expect(guia(page)).not.toContainText(/tarjeta|pagos/i);
  await geometria(page); await captura(page, 'bienvenida-390', info);
  await boton(page, 'Siguiente').click();
  await expect(foco(page)).toHaveAttribute('data-objetivo', 'viajes');
  await geometria(page);
  await boton(page, 'Atrás').click();
  await expect(foco(page)).toHaveAttribute('data-objetivo', 'apertura');
  // «Tu turno»: Entendido achica la burbuja a una línea y el resaltado queda sobre Escanear.
  await avanzarHasta(page, 'escanear');
  await expect(boton(page, 'Siguiente')).toHaveCount(0);
  await boton(page, 'Entendido').click();
  const chip = guia(page).getByRole('button', { name: 'Tu turno: toca Escanear', exact: true });
  await expect(chip).toBeFocused();
  await expect(guia(page).getByRole('heading')).toHaveCount(0);
  await expect(foco(page)).toHaveAttribute('data-objetivo', 'escanear');
  await captura(page, 'tu-turno-achicada-390', info);
  await chip.click();
  await expect(guia(page).getByRole('heading', { name: 'Empieza con el ticket', exact: true })).toBeFocused();
  expect(page.url()).toBe(ruta); expect(await datos(page)).toBe(antes); expect(await camarasAbiertas(page)).toBe(0);
  await page.keyboard.press('Escape');
  await expect(guia(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Escanear', exact: true })).toBeFocused();
  await expect(page.locator('[aria-describedby~="guia-explicacion"]')).toHaveCount(0);
  const efectos = await page.evaluate(() => {
    const e = Reflect.get(window, '__d327Efectos') as { llamadas: string[]; observadores: Map<object, string>; ajenos: Map<object, string> };
    return { llamadas: e.llamadas, observadores: e.observadores.size };
  });
  console.info('D341_OBSERVADORES_AL_CERRAR', await page.evaluate(() => {
    const e = Reflect.get(window, '__d327Efectos') as { observadores: Map<object, string>; ajenos: Map<object, string>; instrumentales: Map<object, string> };
    return { guia: [...e.observadores.values()], ajenos: [...e.ajenos.values()], instrumentales: [...e.instrumentales.values()] };
  }));
  expect(efectos).toEqual({ llamadas: [], observadores: 0 });
  // Fuera del recorrido, la guía espera apuntando a Inicio, sin botones para avanzar.
  await page.getByRole('button', { name: 'Más', exact: true }).click();
  await page.getByRole('button', { name: 'Cómo usar PayMe', exact: true }).click();
  await expect(guia(page).getByRole('heading', { name: 'La guía te espera', exact: true })).toBeVisible();
  await expect(foco(page)).toHaveAttribute('data-objetivo', 'espera');
  await expect(boton(page, 'Siguiente')).toHaveCount(0);
  await boton(page, 'Cerrar guía').click();
  await expect(page.getByRole('button', { name: 'Cómo usar PayMe', exact: true })).toBeFocused();
});

test('D341 · restaurante de punta a punta: la guía espera cada paso y el final aparece tras guardar', async ({ page }, info) => {
  test.setTimeout(120_000);
  await entrar(page);
  await page.getByRole('button', { name: 'Escanear', exact: true }).click();
  await expect.poll(() => camarasAbiertas(page)).toBe(1);
  // La foto: el recorte es «tu turno» sobre Usar foto; la guía no lo toca por la persona.
  await sacarFoto(page, undefined, { usar: false });
  await expect(page.getByRole('group', { name: 'Marco del recorte' })).toBeVisible();
  await expect(foco(page)).toHaveAttribute('data-objetivo', 'usar-foto');
  await expect(guia(page).getByRole('list', { name: 'Recorrido de la guía' }).locator('[aria-current="step"]')).toHaveText('Foto');
  await expect(boton(page, 'Entendido')).toBeVisible();
  await page.getByRole('button', { name: 'Usar foto', exact: true }).click();
  // Dividir: una ventana encima oculta la guía y, al cerrarse, vuelve sola en el mismo paso.
  await expect(page.getByRole('radio', { name: /Pagar el total/ })).toBeVisible();
  await expect(foco(page)).toHaveAttribute('data-objetivo', 'revisar');
  await expect(guia(page).getByRole('list', { name: 'Recorrido de la guía' }).locator('[aria-current="step"]')).toHaveText('→Dividir');
  await geometria(page);
  await page.getByRole('button', { name: 'Ver el ticket', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible(); await expect(guia(page)).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(foco(page)).toHaveAttribute('data-objetivo', 'revisar');
  await expect(guia(page).getByRole('button', { name: 'Retomar guía' })).toHaveCount(0);
  await boton(page, 'Siguiente').click();
  await expect(foco(page)).toHaveAttribute('data-objetivo', 'reparto');
  const marcada = await page.locator('[data-guia="reparto"] [role="radio"][aria-checked="true"]').textContent();
  await boton(page, 'Siguiente').click();
  await expect(foco(page)).toHaveAttribute('data-objetivo', 'personas');
  expect(await page.locator('[data-guia="reparto"] [role="radio"][aria-checked="true"]').textContent()).toBe(marcada);
  await expect(page.getByRole('group', { name: '¿Cuántos son en la mesa?' })).toContainText('—');
  const masUno = page.getByRole('button', { name: 'Un comensal más' });
  for (let i = 0; i < 4; i += 1) await masUno.click();
  await boton(page, 'Siguiente').click();
  await expect(foco(page)).toHaveAttribute('data-objetivo', 'continuar');
  await boton(page, 'Entendido').click();
  await expect(guia(page).getByRole('button', { name: 'Tu turno: toca Continuar', exact: true })).toBeVisible();
  // Una ventana encima no le borra el lugar: al cerrarse vuelve achicada en «Tu turno», no al primer paso.
  await page.getByRole('button', { name: 'Ver el ticket', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible(); await expect(guia(page)).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(guia(page).getByRole('button', { name: 'Tu turno: toca Continuar', exact: true })).toBeVisible();
  await expect(page.locator('.guia-burbuja')).toHaveAttribute('data-paso', 'continuar');
  await captura(page, 'restaurante-tu-turno-continuar', info);
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  // Invitar: otro capítulo, desplegado otra vez.
  await expect(page.getByRole('heading', { name: 'Compartir la mesa' })).toBeVisible();
  await expect(foco(page)).toHaveAttribute('data-objetivo', 'compartir');
  await expect(guia(page).getByRole('list', { name: 'Recorrido de la guía' }).locator('[aria-current="step"]')).toHaveText('→Invitar');
  await geometria(page);
  await boton(page, 'Siguiente').click();
  await expect(foco(page)).toHaveAttribute('data-objetivo', 'seguir');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  // Elegir: «Tu mesa» del organizador.
  await expect(page.getByRole('heading', { name: 'Tu mesa' })).toBeVisible();
  await expect(guia(page).getByRole('list', { name: 'Recorrido de la guía' }).locator('[aria-current="step"]')).toHaveText('→Elegir');
  const consumos = page.locator('[data-guia="consumos"]').first();
  if (await consumos.getAttribute('aria-expanded') === 'false') {
    await avanzarHasta(page, 'consumos');
    await boton(page, 'Entendido').click();
    await expect(guia(page).getByRole('button', { name: 'Tu turno: toca Tus consumos', exact: true })).toBeVisible();
    await consumos.click();
    // Al abrir la lista, la guía sigue sola con el primer plato libre, otra vez desplegada.
    await expect(foco(page)).toHaveAttribute('data-objetivo', 'plato');
  } else await avanzarHasta(page, 'plato');
  await expect(guia(page).getByRole('heading', { name: 'Toca lo que comiste', exact: true })).toBeVisible();
  await page.locator('.qc-libre').first().click();
  const porcion = page.locator('[data-guia="porcion"]');
  if (await porcion.count()) {
    await expect(foco(page)).toHaveAttribute('data-objetivo', 'porcion');
    await porcion.getByRole('radio').first().click();
    // Al cerrarse el selector, la guía sigue sola: se espera ese avance antes de tocar Siguiente.
    await expect(page.locator('.guia-burbuja')).not.toHaveAttribute('data-paso', 'porcion');
  }
  // «Cerrar mesa» (mesa sin garantía) queda debajo del pie: la guía avisa y sólo desplaza cuando se pide.
  await avanzarHasta(page, 'mi-parte');
  const lista = page.locator('.mesa-selection-scroll');
  await lista.evaluate((e) => { e.scrollTop = 0; });
  const debajo = await page.locator('[data-guia="cerrar-mesa"]').evaluate((e) =>
    e.getBoundingClientRect().top >= (document.querySelector('.appbar-block')?.getBoundingClientRect().top ?? innerHeight));
  expect(debajo, 'precondición: «Cerrar mesa» debajo de la barra').toBe(true);
  const scrollMesa = await lista.evaluate((e) => e.scrollTop);
  await boton(page, 'Siguiente').click();
  await expect(page.locator('.guia-burbuja')).toHaveAttribute('data-paso', 'cerrar');
  const fueraMesa = guia(page).getByText('Está más abajo', { exact: true });
  await expect(fueraMesa).toBeVisible();
  await expect(foco(page)).toHaveCount(0);
  expect(await lista.evaluate((e) => e.scrollTop), 'la guía no desplaza por su cuenta').toBe(scrollMesa);
  await boton(page, 'Mostrar').click();
  await expect(fueraMesa).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cerrar mesa' })).toBeInViewport();
  await expect(foco(page)).toHaveAttribute('data-objetivo', 'cerrar');
  await avanzarHasta(page, 'listo');
  await boton(page, 'Entendido').click();
  await expect(guia(page).getByRole('button', { name: 'Tu turno: toca Listo', exact: true })).toBeVisible();
  const enMesa = page.url();
  const codigo = decodeURIComponent(enMesa.split('/mesa/')[1] ?? '').split('?')[0]!;
  await page.locator('.appbar-center').click();
  // El final, sólo después del guardado: la tarjeta de ESA mesa en Inicio.
  await expect(page.getByRole('button', { name: 'Escanear', exact: true })).toBeVisible();
  await expect(guia(page).getByRole('heading', { name: 'Así queda tu mesa', exact: true })).toBeVisible();
  await expect(foco(page)).toHaveAttribute('data-objetivo', 'tarjeta');
  await expect(foco(page)).toHaveAttribute('data-ancla', `[data-guia="mesa-abierta"][data-guia-mesa="${codigo}"]`);
  await expect(guia(page).locator('.guia-nota')).toHaveText('¿No quieres ver la guía al entrar? Marca «No volver a mostrar».');
  await captura(page, 'restaurante-final', info);
  expect(await camarasAbiertas(page)).toBe(1);
  await boton(page, 'Terminar guía').click();
  await expect(guia(page)).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('payme.app.guia.optout.')))).toBe(false);
});

test('D341 · viaje, gasto y borrador intactos; el control fuera de la vista se muestra sólo si se pide', async ({ page }) => {
  await entrar(page); await abrir(page);
  await irEnLaApp(page, `/viaje/${VIAJE}`);
  await expect(page.getByRole('heading', { name: 'Cancún 2026', exact: true })).toBeVisible();
  await expect(foco(page)).toHaveAttribute('data-objetivo', 'balance-propio');
  await expect(guia(page).getByRole('list', { name: 'Recorrido de la guía' })).toHaveCount(0);
  await avanzarHasta(page, 'gasto');
  await geometria(page);
  await page.getByRole('button', { name: 'Agregar gasto', exact: true }).click();
  await expect(foco(page)).toHaveAttribute('data-objetivo', 'que');
  await page.getByLabel('Descripción', { exact: true }).fill('Cena sin guardar');
  await page.getByLabel('Monto', { exact: true }).fill('125.50');
  const ruta = page.url(), antes = await datos(page);
  await avanzarHasta(page, 'quien-pago');
  // Con poca altura, «¿Entre quiénes?» queda abajo: aviso y «Mostrar», nunca un scroll por cuenta propia.
  await page.setViewportSize({ width: 390, height: 560 });
  const scroll = page.locator('.vj-scroll');
  await scroll.evaluate((e) => { e.scrollTop = 0; });
  const debajo = await page.locator('[data-guia="entre-quienes"]').evaluate((e) =>
    e.getBoundingClientRect().top >= (document.querySelector('.vj-pie')?.getBoundingClientRect().top ?? innerHeight));
  expect(debajo, 'precondición: «¿Entre quiénes?» debajo del pie').toBe(true);
  const scrollAntes = await scroll.evaluate((e) => e.scrollTop);
  await boton(page, 'Siguiente').click();
  await expect(guia(page).getByRole('heading', { name: '¿Entre quiénes?', exact: true })).toBeVisible();
  const fuera = guia(page).getByText('Está más abajo', { exact: true });
  await expect(fuera).toBeVisible();
  await expect(foco(page)).toHaveCount(0);
  expect(await scroll.evaluate((e) => e.scrollTop), 'la guía no desplaza por su cuenta').toBe(scrollAntes);
  await boton(page, 'Mostrar').click();
  await expect(fuera).toHaveCount(0);
  await expect(foco(page)).toHaveAttribute('data-objetivo', 'entre');
  await boton(page, 'Cerrar guía').click();
  await expect(page.getByLabel('Descripción', { exact: true })).toHaveValue('Cena sin guardar');
  await expect(page.getByLabel('Monto', { exact: true })).toHaveValue('125.50');
  expect(page.url()).toBe(ruta); expect(await datos(page)).toBe(antes);
});

test('D341 · porciones reales: el plato elegido lleva solo a la porción y el cálculo no cambia', async ({ page }) => {
  await entrar(page); await abrir(page);
  await irEnLaApp(page, `/viaje-ticket/${VIAJE}.d2000000-0000-4000-8000-000000000105`);
  await expect(foco(page)).toHaveAttribute('data-objetivo', 'plato');
  await page.getByText('Tacos de pescado (3)', { exact: true }).click();
  const radio = page.getByRole('radio', { name: 'Entero', exact: true });
  await expect(radio).toBeChecked();
  const antes = await datos(page), ruta = page.url();
  await expect(foco(page)).toHaveAttribute('data-objetivo', 'porcion');
  await geometria(page);
  await page.keyboard.press('Escape');
  await expect(radio).toBeChecked(); expect(page.url()).toBe(ruta); expect(await datos(page)).toBe(antes);
  await page.getByRole('button', { name: 'Listo', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/viaje/${VIAJE}$`));
  await expect(page.locator('.vjv-monto-deuda')).toHaveText(/^−\$827/);
});

test('D341 · el final del viaje aparece después de guardar lo elegido', async ({ page }) => {
  await entrar(page); await abrir(page);
  await irEnLaApp(page, `/viaje-ticket/${VIAJE}.d2000000-0000-4000-8000-000000000105`);
  await page.getByText('Tacos de pescado (3)', { exact: true }).click();
  await avanzarHasta(page, 'listo');
  await boton(page, 'Entendido').click();
  await page.getByRole('button', { name: 'Listo', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/viaje/${VIAJE}$`));
  await expect(guia(page).getByRole('heading', { name: 'Así va tu viaje', exact: true })).toBeVisible();
  await expect(guia(page).locator('.guia-nota')).toHaveText('¿No quieres ver la guía al entrar? Marca «No volver a mostrar».');
  await expect(foco(page)).toHaveAttribute('data-objetivo', 'balance');
  await boton(page, 'Terminar guía').click();
  await expect(guia(page)).toHaveCount(0);
});

test('D328 · cierre con acción principal realmente deshabilitada conserva borrador y enfoca Volver', async ({ page }) => {
  await entrar(page);
  await irEnLaApp(page, `/viaje/${VIAJE}`);
  // La burbuja no es modal: sobre el paso del balance puede tapar lo de abajo, así que se avanza al de «Agregar gasto».
  await avanzarHasta(page, 'gasto');
  await page.getByRole('button', { name: 'Agregar gasto', exact: true }).click();
  await page.getByLabel('Descripción', { exact: true }).fill('Borrador sin monto');
  await expect(page.getByRole('button', { name: 'Listo', exact: true })).toBeDisabled();
  const ruta = page.url(), antes = await datos(page);
  await boton(page, 'Cerrar guía').click();
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
  await expect(foco(page)).toHaveCount(0);
});

test('D327 · 375/430/horizontal/reduced-motion/zoom y traducción', async ({ page }, info) => {
  await entrar(page); await page.emulateMedia({ reducedMotion: 'reduce' }); await abrir(page);
  for (const [width, height] of [[375, 812], [430, 932], [844, 390]] as const) {
    await page.setViewportSize({ width, height });
    await geometria(page);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  await expect(guia(page)).toBeVisible();
  expect(await guia(page).evaluate((e) => e.scrollWidth > e.clientWidth + 1)).toBe(false);
  await boton(page, 'Cerrar guía').scrollIntoViewIfNeeded();
  await expect(boton(page, 'Cerrar guía')).toBeInViewport();
  await captura(page, 'guia-zoom200', info);
  await boton(page, 'Cerrar guía').click();
  await page.evaluate(() => { document.documentElement.style.zoom = ''; localStorage.setItem('payme.app.idioma.v1', 'en'); });
  await page.goto('/mas');
  const en = page.getByRole('region', { name: 'Interactive guide', exact: true });
  // Se conserva la autoentrada a /mas: no abrir la guía mediante Ayuda ni modificar gates.
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(en).toBeVisible();
  await expect(en.getByRole('heading', { name: 'The guide is waiting', exact: true })).toBeVisible();
  await expect(en.getByText('This screen isn\'t part of the guide. Tap Home to continue, or open your table or trip.', { exact: true })).toBeVisible();
  await expect(foco(page)).toHaveAttribute('data-objetivo', 'espera');
  await expect(en.getByRole('checkbox', { name: 'Don’t show again', exact: true })).not.toBeChecked();
});
