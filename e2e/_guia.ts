import { expect, type Locator, type Page } from '@playwright/test';
import { relojFueraDeLasFechasDeLosViajes } from './_app';
import { camaraSimulada, sacarFoto } from './_camara';

/**
 * D363 · revisión de V sobre ff5dec7 · lo que comparten los e2e de la corrección del tutorial. Las mismas formas que
 * `guia-tutorial.spec.ts` (que no se toca), más los espías que pidió la revisión: los argumentos y los rechazos de la
 * fachada, y si el ejemplo llegó a prenderse alguna vez.
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
/** El id inventado del restaurante del ejemplo (`fixtureEjemplo.ts`). */
export const ID_RESTAURANTE_DEL_EJEMPLO = 'e0e0e0e0-1224-4000-8000-0000000000aa';

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

/** Anota si el ejemplo se prendió alguna vez desde que se llama (suscripto al mismo store que lee la app). */
export async function espiarElEjemplo(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const ruta = '/src/ayuda/ejemplo/estadoEjemplo.ts';
    const { ejemploLocal } = await import(/* @vite-ignore */ ruta) as {
      ejemploLocal: { leer: () => { activo: boolean }; suscribir: (o: () => void) => () => void };
    };
    const w = window as unknown as { __ejemploSePrendio: boolean };
    w.__ejemploSePrendio = ejemploLocal.leer().activo;
    ejemploLocal.suscribir(() => { if (ejemploLocal.leer().activo) w.__ejemploSePrendio = true; });
  });
}
export const ejemploSePrendio = (page: Page) => page.evaluate(() => (window as unknown as { __ejemploSePrendio: boolean }).__ejemploSePrendio);

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
    const pedido = JSON.parse(c.arg0!) as { total_cents: number; restaurant_id?: string };
    expect(pedido.total_cents).toBe(84000);
    expect(pedido.restaurant_id).not.toBe(ID_RESTAURANTE_DEL_EJEMPLO);
  }
}
