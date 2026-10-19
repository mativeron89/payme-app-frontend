import { createHash } from 'node:crypto';
import { expect, type Locator, type Page } from '@playwright/test';
import { MOCK_USER } from '../src/api/mock/seedData';
import { RESTAURANTE_DE_EJEMPLO } from '../src/ayuda/ejemplo/fixtureEjemplo';
import { relojFueraDeLasFechasDeLosViajes } from './_app';
import { camaraSimulada, sacarFoto } from './_camara';

/**
 * D363 · revisión de V sobre ff5dec7 · lo que comparten los e2e de la corrección del tutorial. Las mismas formas que
 * `guia-tutorial.spec.ts`, más los espías que pidió la revisión: los argumentos y los rechazos de la fachada, y si el
 * ejemplo llegó a prenderse alguna vez.
 */

export interface OpcionesDeEntrada {
  /** Deja la invitación pendiente del seed en Inicio (por defecto se vacía). */
  readonly conservarInvitacion?: boolean;
  /** Deja el aviso de fotos sin posponer (por defecto se pospone, como hace la persona). */
  readonly dejarElAvisoDeFotos?: boolean;
  /** Corre antes de tocar «Entrar», con la app ya cargada (p. ej. reemplazar un método de la fachada). */
  readonly antesDeEntrar?: (page: Page) => Promise<void>;
}

export async function entrar(page: Page, o: OpcionesDeEntrada = {}): Promise<void> {
  await relojFueraDeLasFechasDeLosViajes(page);
  await page.addInitScript(() => {
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
    localStorage.setItem('payme.app.mock.viajes.v1', 'encendido');
    localStorage.setItem('payme.app.mock.money_rail.v1', 'disabled');
  });
  await camaraSimulada(page);
  await page.goto('/');
  if (!o.conservarInvitacion) {
    await page.evaluate(async () => {
      const ruta = '/src/api/mock/store.ts';
      const { state, persist } = await import(/* @vite-ignore */ ruta) as { state: { pendingInvitations: unknown[] }; persist: () => void };
      state.pendingInvitations = []; persist();
    });
  }
  if (o.antesDeEntrar) await o.antesDeEntrar(page);
  await page.getByLabel('Email', { exact: true }).fill('mati@payme.mx');
  // Expresiones regulares y no texto entre comillas: la auditoría de secretos lee «'clave' : 'valor'» como un valor.
  await page.getByLabel(/^Contraseña$/).fill('demo-e2e');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Escanear/ }).first()).toBeVisible();
  if (!o.dejarElAvisoDeFotos) await posponerElAvisoDeFotos(page);
}

export async function posponerElAvisoDeFotos(page: Page): Promise<void> {
  const aviso = page.getByRole('complementary', { name: 'Actualización del Aviso de Privacidad', exact: true });
  await expect(aviso).toBeVisible();
  await aviso.getByRole('button', { name: 'Ahora no', exact: true }).click();
  await expect(aviso).toHaveCount(0);
}

export const tarjeta = (page: Page) => page.locator('[data-guia="tarjeta-tutorial"]');
export const botonTutorial = (page: Page) => tarjeta(page).getByRole('button', { name: 'Tutorial', exact: true });
export const burbuja = (page: Page, nombre: string | RegExp) => page.getByRole('dialog', { name: nombre });
export const capaVisible = (page: Page) => page.locator('.guia-capa[data-activa]');
export const TEXTO_2A = '¿Cómo divido la cuenta?';
export const TEXTO_2B = 'Saca o elige una foto: te mostraremos un ticket de ejemplo.';
export const TEXTO_3A = 'Este es el ticket de ejemplo.';
/** El id inventado del restaurante del ejemplo, leído de la fuente (`fixtureEjemplo.ts`): si cambia, el e2e lo sigue. */
export const ID_RESTAURANTE_DEL_EJEMPLO = RESTAURANTE_DE_EJEMPLO.id;

/** La fase del ejemplo, o 'apagado'. */
export const fase = (page: Page) => page.evaluate(async () => {
  const ruta = '/src/ayuda/ejemplo/estadoEjemplo.ts';
  const { ejemploLocal } = await import(/* @vite-ignore */ ruta) as { ejemploLocal: { leer: () => { activo: boolean; fase: string } } };
  const e = ejemploLocal.leer();
  return e.activo ? e.fase : 'apagado';
});

export const pathname = (page: Page) => page.evaluate(() => location.pathname);

export interface Llamada {
  readonly metodo: string;
  readonly clase: string;
  readonly codigo: string | null;
  /** El primer argumento en JSON, para mirar qué se pidió. */
  readonly arg0: string | null;
  /** El nombre del error si la promesa se rechazó (p. ej. `PedidoCortadoPorElEjemplo`). */
  rechazo: string | null;
}

/**
 * Un espía sobre `api` (el MISMO objeto que usan las pantallas: Vite sirve una instancia por URL). Anota cada llamada
 * con su clase, su primer argumento y, si se rechaza, el nombre del error; la promesa que devuelve es la misma.
 */
export async function espiarLaFachada(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const rutaApi = '/src/api/index.ts';
    const rutaClases = '/src/ayuda/ejemplo/apiEjemplo.ts';
    const { api } = await import(/* @vite-ignore */ rutaApi) as { api: Record<string, (...a: unknown[]) => unknown> };
    const { CLASIFICACION_DEL_EJEMPLO } = await import(/* @vite-ignore */ rutaClases) as { CLASIFICACION_DEL_EJEMPLO: Record<string, string> };
    const w = window as unknown as { __llamadas: Llamada[] };
    w.__llamadas = [];
    for (const [metodo, clase] of Object.entries(CLASIFICACION_DEL_EJEMPLO)) {
      const original = api[metodo]!;
      api[metodo] = (...args: unknown[]) => {
        let arg0: string | null = null;
        try { arg0 = JSON.stringify(args[0]) ?? null; } catch { arg0 = null; }
        const registro: Llamada = { metodo, clase, codigo: typeof args[0] === 'string' ? args[0] : null, arg0, rechazo: null };
        w.__llamadas.push(registro);
        const r = original(...args);
        if (r && typeof (r as Promise<unknown>).then === 'function') {
          (r as Promise<unknown>).then(undefined, (e: unknown) => { registro.rechazo = (e as { name?: string })?.name ?? String(e); });
        }
        return r;
      };
    }
  });
}

export const llamadas = (page: Page) => page.evaluate(() => (window as unknown as { __llamadas: Llamada[] }).__llamadas);

/**
 * Anota, desde que se llama, si el ejemplo se prendió alguna vez y cuántas veces arrancó (de apagado a encendido) y
 * se descartó (de encendido a apagado). Suscripto al mismo store que lee la app.
 */
export async function espiarElEjemplo(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const ruta = '/src/ayuda/ejemplo/estadoEjemplo.ts';
    const { ejemploLocal } = await import(/* @vite-ignore */ ruta) as {
      ejemploLocal: { leer: () => { activo: boolean }; suscribir: (o: () => void) => () => void };
    };
    const w = window as unknown as { __ejemplo: { sePrendio: boolean; arranques: number; descartes: number } };
    let antes = ejemploLocal.leer().activo;
    w.__ejemplo = { sePrendio: antes, arranques: 0, descartes: 0 };
    ejemploLocal.suscribir(() => {
      const ahora = ejemploLocal.leer().activo;
      if (ahora) w.__ejemplo.sePrendio = true;
      if (!antes && ahora) w.__ejemplo.arranques += 1;
      if (antes && !ahora) w.__ejemplo.descartes += 1;
      antes = ahora;
    });
  });
}
type EspiaDelEjemplo = { sePrendio: boolean; arranques: number; descartes: number };
export const ejemploSePrendio = (page: Page) => page.evaluate(() => (window as unknown as { __ejemplo: EspiaDelEjemplo }).__ejemplo.sePrendio);
export const transicionesDelEjemplo = (page: Page) => page.evaluate(() => {
  const e = (window as unknown as { __ejemplo: EspiaDelEjemplo }).__ejemplo;
  return { arranques: e.arranques, descartes: e.descartes };
});

/** 2f → 2a. */
export async function abrirDesdeLaTarjeta(page: Page): Promise<Locator> {
  await expect(tarjeta(page)).toBeVisible();
  await botonTutorial(page).click();
  const b = burbuja(page, TEXTO_2A);
  await expect(b).toBeVisible();
  return b;
}
/** 2a → 2b. */
export async function hastaLaCamara(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Escanear', exact: true }).click();
  await expect(burbuja(page, TEXTO_2B)).toBeVisible();
}
/** 2b → 3a. */
export async function hastaElTicket(page: Page): Promise<void> {
  await sacarFoto(page, undefined, { usar: false });
  await expect(burbuja(page, TEXTO_3A)).toBeVisible();
}

/**
 * El flujo real desde «Escanea el ticket»: una foto que sí se lee (el OCR del mock, $840), «Por lo que pidió cada
 * uno», un comensal más y «Continuar» hasta Compartir (con los pagos apagados no hay garantía).
 */
export async function abrirUnaMesaReal(page: Page): Promise<void> {
  await sacarFoto(page);
  await expect(page.getByRole('radio', { name: /Por lo que pidió cada uno/ })).toBeVisible();
  await expect(page.getByText('Restaurante Ejemplo', { exact: true })).toHaveCount(0);
  await page.getByRole('radio', { name: /Por lo que pidió cada uno/ }).click();
  await page.getByRole('button', { name: 'Un comensal más' }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Compartir la mesa' })).toBeVisible();
}

/** Control positivo de los cortes: hubo al menos un `createMesa`, y ninguno con datos del ejemplo. */
export async function createMesaRealSinDatosDelEjemplo(page: Page): Promise<void> {
  const creadas = (await llamadas(page)).filter((l) => l.metodo === 'createMesa');
  expect(creadas.length, 'control positivo: el flujo real llegó a createMesa').toBeGreaterThanOrEqual(1);
  for (const c of creadas) {
    const pedido = JSON.parse(c.arg0!) as {
      total_cents: number; restaurant_id?: string; division_mode: string; expected_participants: number;
    };
    expect(pedido.total_cents).toBe(84000);
    expect(pedido.restaurant_id).not.toBe(ID_RESTAURANTE_DEL_EJEMPLO);
    // Lo que eligió en el flujo fresco de `abrirUnaMesaReal` (un reinicio a medias dejaría lo del ejemplo).
    expect(pedido.division_mode).toBe('consumo');
    expect(pedido.expected_participants).toBe(1);
  }
}

/** 3a → 2c (Siguiente). */
export async function hastaDividir(page: Page): Promise<void> {
  await burbuja(page, TEXTO_3A).getByRole('button', { name: 'Siguiente', exact: true }).click();
  await expect(page.getByRole('dialog', { name: /Ticket/ })).toHaveCount(0);
  await expect(capaVisible(page)).toHaveCount(0);
  await expect.poll(() => fase(page)).toBe('dividir');
}
export const TEXTO_2D = 'Aquí invitarás a tus amigos a sumarse a la mesa.';
/** 2c → 2d. */
export async function hastaCompartir(page: Page, forma: RegExp = /Por lo que pidió cada uno/, toques = 1): Promise<void> {
  await page.getByRole('radio', { name: forma }).click();
  for (let i = 0; i < toques; i += 1) await page.getByRole('button', { name: 'Un comensal más' }).click();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(burbuja(page, TEXTO_2D)).toBeVisible();
}
/** 2d (1 de 2 → 2 de 2) → 2e. */
export async function hastaTuMesa(page: Page): Promise<void> {
  await burbuja(page, TEXTO_2D).getByRole('button', { name: 'Siguiente', exact: true }).click();
  await expect(burbuja(page, 'Toca Continuar para elegir lo tuyo.')).toBeVisible();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.locator('.qc-lista')).toBeVisible();
}

/**
 * La geometría de la ficha (la misma que `guia-tutorial.spec.ts`): la burbuja entra entera en la ventana, no tapa el
 * control ni su anillo, el control sigue tocable y cada botón tiene 44 de alto. Coordenadas de ventana (P5).
 */
export async function geometria(page: Page, ancla: string): Promise<void> {
  await expect(async () => {
    const m = await page.evaluate((a) => {
      const b = document.querySelector<HTMLElement>('.guia-capa[data-activa] .guia-burbuja')!.getBoundingClientRect();
      const anillo = document.querySelector<HTMLElement>('.guia-capa[data-activa] .guia-anillo')!.getBoundingClientRect();
      const control = Array.from(document.querySelectorAll<HTMLElement>(`[data-guia="${a}"]`)).find((e) => e.getClientRects().length > 0)!;
      const fab = control.querySelector('.appbar-fab') ?? control;
      const r = fab.getBoundingClientRect();
      const tocable = (e: Element) => {
        const q = e.getBoundingClientRect();
        const hit = document.elementFromPoint((q.left + q.right) / 2, (q.top + q.bottom) / 2);
        return hit === e || (hit !== null && e.contains(hit));
      };
      return {
        dentro: b.left >= 0 && b.right <= window.innerWidth && b.top >= 0 && b.bottom <= window.innerHeight,
        noTapa: b.bottom <= anillo.top || b.top >= anillo.bottom,
        anilloRodea: anillo.left <= r.left && anillo.right >= r.right && anillo.top <= r.top && anillo.bottom >= r.bottom,
        controlTocable: tocable(fab),
        botones: Array.from(document.querySelectorAll('.guia-capa[data-activa] .guia-burbuja button')).map((e) => e.getBoundingClientRect().height),
        burbuja: b.toJSON(), anillo: anillo.toJSON(), control: r.toJSON(),
      };
    }, ancla);
    const d = JSON.stringify(m);
    expect(m.dentro, d).toBe(true);
    expect(m.noTapa, d).toBe(true);
    expect(m.anilloRodea, d).toBe(true);
    expect(m.controlTocable, d).toBe(true);
    for (const alto of m.botones) expect(alto, d).toBeGreaterThanOrEqual(44);
  }).toPass({ timeout: 10000 });
}

/**
 * Revisión de V sobre ff5dec7 · la red, con `page.route('**\/*')`: cuenta TODO pedido a cualquier origen y a cualquier
 * ruta desde que se llama, salvo los módulos que sirve el servidor de Vite (mismo origen, tipo script, bajo /src/,
 * /node_modules/, /@vite/, /@id/, /@fs/ o /@react-refresh) y las fuentes bajo /src/assets/fonts/. Lo excluido se
 * guarda aparte (así se ve que el motor de la guía se cargó y no se contó). Lo de otro origen se aborta. También
 * cuenta los websockets que se abren.
 */
export interface Red { readonly contados: string[]; readonly excluidos: string[]; readonly websockets: string[] }

export async function contarLaRed(page: Page): Promise<{ cerrar: () => Promise<Red> }> {
  const origen = new URL(page.url()).origin;
  const red: Red = { contados: [], excluidos: [], websockets: [] };
  const DE_VITE = /^\/(src|node_modules|@vite|@id|@fs|@react-refresh)(\/|$)/;
  const manejar = async (route: Parameters<Parameters<Page['route']>[1]>[0]) => {
    const req = route.request();
    const url = new URL(req.url());
    const mismo = url.origin === origen;
    const modulo = mismo && req.resourceType() === 'script' && DE_VITE.test(url.pathname);
    const fuente = mismo && req.resourceType() === 'font' && url.pathname.startsWith('/src/assets/fonts/');
    if (modulo || fuente) { red.excluidos.push(url.pathname); return route.continue(); }
    red.contados.push(`${req.method()} ${req.resourceType()} ${url.origin === origen ? '' : url.origin}${url.pathname}`);
    return mismo ? route.continue() : route.abort('blockedbyclient');
  };
  const alAbrir = (ws: { url: () => string }) => { red.websockets.push(ws.url()); };
  await page.route('**/*', manejar);
  page.on('websocket', alAbrir);
  return {
    cerrar: async () => {
      await page.unroute('**/*', manejar);
      page.off('websocket', alAbrir);
      return red;
    },
  };
}

/**
 * Control positivo de `contarLaRed`, dentro de la ventana: un fetch a otro origen, un fetch del mismo origen fuera de
 * la API y un script fuera de las rutas de Vite. Tienen que aparecer los tres, y nada más.
 */
export const SONDAS_DE_RED = ['GET fetch https://sonda.invalid/x', 'GET fetch /api/__sonda', 'GET script /__sonda.js'];
export async function sondearLaRed(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await fetch('https://sonda.invalid/x').catch(() => undefined);
    await fetch('/api/__sonda').catch(() => undefined);
    await new Promise<void>((listo) => {
      const s = document.createElement('script');
      s.src = '/__sonda.js';
      s.onload = () => listo();
      s.onerror = () => listo();
      document.head.append(s);
    });
  });
}

/** Lo escrito: el estado del mock en memoria, todo `localStorage` y todo `sessionStorage`. */
export async function escrito(page: Page): Promise<{ store: string; local: Record<string, string>; session: Record<string, string> }> {
  return page.evaluate(async () => {
    const rutaStore = '/src/api/mock/store.ts';
    const { state } = await import(/* @vite-ignore */ rutaStore) as { state: unknown };
    const volcar = (s: Storage) => {
      const o: Record<string, string> = {};
      for (let i = 0; i < s.length; i += 1) { const k = s.key(i)!; o[k] = s.getItem(k)!; }
      return o;
    };
    return { store: JSON.stringify(state), local: volcar(localStorage), session: volcar(sessionStorage) };
  });
}

/** La clave de la tarjeta Tutorial oculta (Q1) de la cuenta del mock, como la arma `preferenciaGuia.ts`. */
export const CLAVE_TARJETA_OCULTA = `payme.app.guia.tarjeta.v1.mock.${createHash('sha256').update(`auth:${MOCK_USER.id}`).digest('hex')}`;
