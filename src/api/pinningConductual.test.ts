import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * 🔴 P40-③ · EL ESLABÓN QUE EL PINNING NO PROBABA — y por qué un test de
 * fuente no alcanzaba acá.
 *
 * `pinningDeSesion.test.ts` demuestra que los cinco caminos de `src/api/index.ts`
 * le pasan a `httpRequest` la sesión que reciben. **Pero no mira de dónde sale
 * ese valor.** Codex mostró el mutante exacto, en la primitiva:
 *
 * ```diff
 * - try { return await send(actor.session); }
 * + try { return await send(loadSession() ?? undefined); }
 * ```
 *
 * y **conserva typecheck y los 35 tests oficiales**: los oráculos de fuente
 * miran el call site, no el origen del dato. Con el mutante, la mutación sale
 * autenticada por **la sesión que esté vigente al momento del fetch**, no por
 * la que el journal selló.
 *
 * ## Por qué acá SÍ hay conducta que observar, y en la pantalla no
 *
 * Este es el reverso del límite declarado en `tarjetaElegida.test.ts`: allá el
 * caso no se alcanza porque falta el campo de Stripe. **Acá la primitiva es
 * pura lógica sobre `localStorage`, locks y `crypto`, así que el escenario se
 * puede montar entero** — y por eso la ausencia de este test era una omisión,
 * no un límite.
 *
 * ## Cómo se abre la ventana, de forma determinista y no por suerte
 *
 * `withPreparedMonetaryRequest` resuelve el actor **primero** y recién después
 * calcula identidades y sellos, que pasan por `crypto.subtle.digest`. Se
 * demora/intercepta ese digest para cambiar la sesión de A a B **entre las dos
 * cosas**, sin tocar una línea de producción. Es el mismo seam que el E2E ya usa
 * para forzar la ventana del journal.
 *
 * ⚠️ **Este escenario es REAL y no de laboratorio:** el logout vive en OTRO lock
 * (`payme-session-state`), así que una pestaña que cierra sesión mientras un
 * pago está en vuelo produce exactamente esto.
 */

class MemoryStorage {
  values = new Map<string, string>();
  /** Se dispara con el valor de cada escritura: es el seam del escenario. */
  alEscribir: ((key: string, value: string) => void) | null = null;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); this.alEscribir?.(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
}

const local = new MemoryStorage();
const sesion = new MemoryStorage();
let lockTail: Promise<void> = Promise.resolve();
const locks = {
  async request<T>(_name: string, _options: unknown, callback: () => Promise<T>): Promise<T> {
    const previous = lockTail;
    let release: (() => void) | undefined;
    lockTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await callback(); } finally { release?.(); }
  },
};

Object.assign(globalThis, { localStorage: local, sessionStorage: sesion });
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks } });

const storage = await import('./storage');
const money = await import('./idempotency');
const http = await import('./http');

function entrar(id: string) {
  storage.saveSession({
    access_token: `${id}-access`,
    refresh_token: `${id}-refresh`,
    user: { id, payme_id: id, email: `${id}@x`, first_name: id, last_name: id },
    principal_id: id,
    family_id: `${id}-family`,
  });
}

/** Deja el journal listo para enviar, tal como lo haría la pantalla. */
async function preparado(id: string) {
  entrar(id);
  const actor = await money.resolveMoneyActor();
  const scope = money.scopeForActor(actor, 'pay:mesa-1|card');
  const handle = await money.acquireMonetaryIntent(scope, 'mesa_pay:mesa-1');
  const payload = { idempotency_key: handle.key, payment_method_id: 'pm_saved', item_ids: ['item-1'] };
  await money.prepareMonetaryRequest(scope, 'mesa_pay:mesa-1', handle, payload);
  return { handle, payload };
}

/**
 * 🔴 DÓNDE SE ABRE LA VENTANA, y el primer intento estuvo MAL: vale escribirlo.
 *
 * Probé cambiando la sesión durante el `digest` y el escenario **no llegaba al
 * callback**: `identities()` lee la familia DESPUÉS de su primer digest, así
 * que la mutación moría antes con `monetary_family_reconciliation_required`.
 * **Eso es conducta correcta de producción** —un relogin a otra familia
 * bloquea la mutación, y ésa es la guarda gruesa que ya existía— pero no es la
 * ventana que este test viene a cubrir.
 *
 * La ventana real es **más adentro**: entre la verificación del journal y el
 * `send`, dentro del mismo lock. El único seam que hay ahí es la escritura del
 * estado `sending`, así que el cambio de sesión se engancha a ESA escritura.
 * Es la misma ventana que la sonda de Codex abría reteniendo el lock; acá se
 * abre desde el storage, que es lo que este arnés ya controla.
 */
function prepararCambioDeSesion(rawOtro: string, claveSesion: string) {
  local.alEscribir = (_k, value) => {
    if (!value.includes('"state":"sending"')) return;
    local.alEscribir = null;
    // Directo al mapa: `saveSession` volvería a entrar por este mismo seam.
    local.values.set(claveSesion, rawOtro);
  };
}

/** La clave y el contenido crudos de una sesión, sin dejarla vigente. */
function sesionCruda(id: string): { clave: string; raw: string } {
  const antes = new Set(local.values.keys());
  entrar(id);
  const clave = [...local.values.keys()].find((k) => !antes.has(k) || k.includes('session'))!;
  const raw = local.values.get(clave)!;
  local.values.clear();
  return { clave, raw };
}

afterEach(() => {
  local.values.clear();
  local.alEscribir = null;
  sesion.values.clear();
  lockTail = Promise.resolve();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('🔴 P40-③ · la mutación viaja con la sesión que el journal selló', () => {
  it('🔴 el callback recibe A, la red NO se inicia, y con B vigente corta 401', async () => {
    const b = sesionCruda('b');
    const { handle, payload } = await preparado('a');

    const fetchs: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { headers?: Record<string, string> }) => {
      fetchs.push(init?.headers?.Authorization ?? 'sin-bearer');
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    }));

    let recibida: string | undefined;
    let error: unknown;
    prepararCambioDeSesion(b.raw, b.clave);
    try {
      await money.withPreparedMonetaryRequest(
        'mesa_pay:mesa-1',
        handle,
        payload,
        undefined,
        async (sesion) => {
          recibida = sesion?.access_token;
          // La cadena completa, no una imitación: la sesión que llega se le
          // entrega a la MISMA puerta que usa la fachada.
          return http.httpRequest('POST', '/mesas/x/pay', payload, sesion);
        },
      );
    } catch (e) { error = e; }

    // ① el callback recibió la sesión SELLADA, no la vigente
    expect(recibida, 'el callback recibió la sesión vigente en vez de la sellada').toBe('a-access');
    // ② y la red NO se inició: la puerta corta antes del fetch
    expect(fetchs, `salió a la red con: ${fetchs.join(' · ')}`).toEqual([]);
    // ③ el corte es un 401 explícito, no un silencio
    expect(error).toBeInstanceOf(http.HttpError);
    expect((error as InstanceType<typeof http.HttpError>).status).toBe(401);
  });

  /**
   * ⭐ CONTROL POSITIVO — sin esto, el caso de arriba pasaría también si la red
   * NUNCA se iniciara por cualquier otro motivo (un stub mal puesto, una ruta
   * que ni se arma). Acá la sesión NO cambia: la misma cadena tiene que llegar
   * al fetch, y con el Bearer de A.
   */
  it('⭐ sin cambio de sesión, la MISMA cadena llega al fetch con el Bearer de A', async () => {
    const { handle, payload } = await preparado('a');
    const fetchs: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { headers?: Record<string, string> }) => {
      fetchs.push(init?.headers?.Authorization ?? 'sin-bearer');
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    }));

    await money.withPreparedMonetaryRequest(
      'mesa_pay:mesa-1', handle, payload, undefined,
      async (sesion) => http.httpRequest('POST', '/mesas/x/pay', payload, sesion),
    );

    expect(fetchs, 'la cadena no llegó a la red: el caso negativo no probaría nada').toEqual(['Bearer a-access']);
  });
});
