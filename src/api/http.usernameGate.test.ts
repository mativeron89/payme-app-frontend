import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * AF-USUARIO-ARROBA · `428 username_required` del dueño (v2.137.0,
 * `contract-mirror/middleware/auth.js`) avisa a la app por su gancho y se
 * propaga igual, como el 428 legal. Los dos ganchos no se cruzan: el legal no
 * dispara el del @ ni al revés. Mismo arnés que `http.legalGate.test.ts`.
 */
class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
const storage = new MemoryStorage();
Object.assign(globalThis, { localStorage: storage });
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { locks: { async request<T>(_n: string, _o: LockOptions, cb: () => Promise<T> | T) { return cb(); } } },
});

const {
  httpPrivateJsonRequest, httpRequest, setOnLegalAcceptanceRequired, setOnUsernameRequired,
  LEGAL_ACCEPTANCE_REQUIRED, USERNAME_REQUIRED,
} = await import('./http');
const { loadSession, saveSession } = await import('./storage');

const user = { id: 'u-1', payme_id: 'u1', email: 'u@example.com', first_name: 'Una', last_name: 'Persona' };
function loggedSession() {
  saveSession({ access_token: 'a1', refresh_token: 'r1', family_id: 'arroba-family', principal_id: user.id, user });
  return loadSession()!;
}
function response(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', Vary: 'Authorization' },
  });
}

afterEach(() => {
  storage.values.clear();
  setOnLegalAcceptanceRequired(null);
  setOnUsernameRequired(null);
  vi.unstubAllGlobals();
});

describe('AF-USUARIO-ARROBA · gancho del 428 username_required', () => {
  it('un 428 con el código exacto avisa una vez y el error se propaga con su status', async () => {
    const gancho = vi.fn();
    setOnUsernameRequired(gancho);
    vi.stubGlobal('fetch', vi.fn(async () => response({ error: USERNAME_REQUIRED }, 428)));
    await expect(httpRequest('GET', '/mesas', undefined, loggedSession()))
      .rejects.toMatchObject({ status: 428, message: 'username_required' });
    expect(gancho).toHaveBeenCalledTimes(1);
    await expect(httpPrivateJsonRequest('/friends/avatar-notice', loggedSession()))
      .rejects.toMatchObject({ status: 428 });
    expect(gancho).toHaveBeenCalledTimes(2);
  });

  it('los dos 428 no se cruzan: el legal no abre la puerta del @, ni el del @ la legal', async () => {
    const legal = vi.fn();
    const arroba = vi.fn();
    setOnLegalAcceptanceRequired(legal);
    setOnUsernameRequired(arroba);
    vi.stubGlobal('fetch', vi.fn(async () => response({ error: LEGAL_ACCEPTANCE_REQUIRED }, 428)));
    await expect(httpRequest('GET', '/mesas', undefined, loggedSession())).rejects.toMatchObject({ status: 428 });
    expect([legal.mock.calls.length, arroba.mock.calls.length]).toEqual([1, 0]);
    vi.stubGlobal('fetch', vi.fn(async () => response({ error: USERNAME_REQUIRED }, 428)));
    await expect(httpRequest('GET', '/mesas', undefined, loggedSession())).rejects.toMatchObject({ status: 428 });
    expect([legal.mock.calls.length, arroba.mock.calls.length]).toEqual([1, 1]);
  });

  it.each([
    ['428 con otro código', 428, { error: 'precondition_required' }],
    ['428 sin cuerpo JSON', 428, null],
    ['403 con el mismo código', 403, { error: USERNAME_REQUIRED }],
    ['409 username_not_available', 409, { error: 'username_not_available' }],
  ])('no avisa ante %s', async (_label, status, body) => {
    const gancho = vi.fn();
    setOnUsernameRequired(gancho);
    vi.stubGlobal('fetch', vi.fn(async () => (body === null
      ? new Response('', { status })
      : response(body, status))));
    await expect(httpRequest('GET', '/mesas', undefined, loggedSession())).rejects.toMatchObject({ status });
    expect(gancho).not.toHaveBeenCalled();
    // La sesión sigue viva: un 428 no es un 401.
    expect(loadSession()?.access_token).toBe('a1');
  });

  it('sin gancho registrado el 428 simplemente se propaga', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ error: USERNAME_REQUIRED }, 428)));
    await expect(httpRequest('GET', '/mesas', undefined, loggedSession())).rejects.toMatchObject({ status: 428 });
    expect(loadSession()?.access_token).toBe('a1');
  });
});
