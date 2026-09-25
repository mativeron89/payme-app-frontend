import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * LEGAL-3.0.0 (AF1) · `428 legal_acceptance_required` del dueño (AB2) avisa a
 * la app por el gancho y se propaga igual; ningún otro 4xx lo dispara.
 * Arnés mínimo, el mismo de `http.session.test.ts`: storage en memoria y Web
 * Locks falsos, porque `http.ts` los toca al importarse.
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

const { httpPrivateJsonRequest, httpRequest, setOnLegalAcceptanceRequired, LEGAL_ACCEPTANCE_REQUIRED } = await import('./http');
const { loadSession, saveSession } = await import('./storage');

const user = { id: 'u-1', payme_id: 'u1', email: 'u@example.com', first_name: 'Una', last_name: 'Persona' };
function loggedSession() {
  saveSession({ access_token: 'a1', refresh_token: 'r1', family_id: 'legal-family', principal_id: user.id, user });
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
  vi.unstubAllGlobals();
});

describe('LEGAL-3.0.0 · gancho del 428 legal_acceptance_required', () => {
  it('un 428 con el código exacto avisa una vez y el error se propaga con su status', async () => {
    const gancho = vi.fn();
    setOnLegalAcceptanceRequired(gancho);
    vi.stubGlobal('fetch', vi.fn(async () => response({ error: LEGAL_ACCEPTANCE_REQUIRED }, 428)));
    await expect(httpRequest('GET', '/account/me', undefined, loggedSession()))
      .rejects.toMatchObject({ status: 428, message: 'legal_acceptance_required' });
    expect(gancho).toHaveBeenCalledTimes(1);
    // Y por el camino privado JSON también.
    await expect(httpPrivateJsonRequest('/friends/avatar-notice', loggedSession()))
      .rejects.toMatchObject({ status: 428 });
    expect(gancho).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['428 con otro código', 428, { error: 'precondition_required' }],
    ['428 sin cuerpo JSON', 428, null],
    ['403 con el mismo código', 403, { error: LEGAL_ACCEPTANCE_REQUIRED }],
    ['409 cualquiera', 409, { error: 'conflict' }],
  ])('no avisa ante %s', async (_label, status, body) => {
    const gancho = vi.fn();
    setOnLegalAcceptanceRequired(gancho);
    vi.stubGlobal('fetch', vi.fn(async () => (body === null
      ? new Response('', { status })
      : response(body, status))));
    await expect(httpRequest('GET', '/account/me', undefined, loggedSession())).rejects.toMatchObject({ status });
    expect(gancho).not.toHaveBeenCalled();
    // La sesión sigue viva: un 428 no es un 401.
    expect(loadSession()?.access_token).toBe('a1');
  });

  it('sin gancho registrado el 428 simplemente se propaga', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ error: LEGAL_ACCEPTANCE_REQUIRED }, 428)));
    await expect(httpRequest('GET', '/account/me', undefined, loggedSession())).rejects.toMatchObject({ status: 428 });
    expect(loadSession()?.access_token).toBe('a1');
  });
});
