import { afterEach, describe, expect, it, vi } from 'vitest';

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const storage = new MemoryStorage();
Object.assign(globalThis, { localStorage: storage });

const { httpGuestRequest, httpLogin, httpLogout, httpRegister, httpRequest } = await import('./http');
const { loadSession, saveSession } = await import('./storage');
const { mockLogin, mockRegister } = await import('./mock/mockApi');

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const user = { id: 'u-1', payme_id: 'u1', email: 'u@example.com', first_name: 'Una', last_name: 'Persona' };

afterEach(() => {
  storage.values.clear();
  vi.unstubAllGlobals();
});

describe('sesión real: persistencia antes de uso HTTP', () => {
  it('login real persiste, permite la request inmediata y sobrevive reload', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return response({ access_token: 'access-login', refresh_token: 'refresh-login', expires_in: 900, user });
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer access-login');
      return response({ ok: true });
    });
    vi.stubGlobal('fetch', fetchMock);

    await httpLogin(user.email, 'password');
    expect(loadSession()?.access_token).toBe('access-login');
    await expect(httpRequest('GET', '/account/me')).resolves.toEqual({ ok: true });
    expect(loadSession()?.principal_id).toBe(user.id);
  });

  it('register real persiste antes de devolver y reload ve la misma familia', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ access_token: 'access-register', refresh_token: 'refresh-register', expires_in: 900, user })));

    const created = await httpRegister({ email: user.email, password: 'password', first_name: 'Una', last_name: 'Persona' });
    expect(loadSession()).toMatchObject({ access_token: 'access-register', family_id: created.family_id, principal_id: user.id });
  });

  it('logout borra la sesión antes de esperar una revocación remota lenta', async () => {
    let release: (() => void) | undefined;
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === 'POST' && (init.body as string | undefined)?.includes('password')) {
        return Promise.resolve(response({ access_token: 'access-logout', refresh_token: 'refresh-logout', expires_in: 900, user }));
      }
      return new Promise<Response>((resolve) => { release = () => resolve(response({ ok: true })); });
    }));
    await httpLogin(user.email, 'password');
    await expect(httpLogout()).resolves.toBeUndefined();
    expect(loadSession()).toBeNull();
    release?.();
  });
});

describe('sesión mock: conserva el mismo contrato de storage', () => {
  it('login mock persiste y es restaurable sin depender del camino real', async () => {
    await mockLogin('mock@example.com', 'password');
    expect(loadSession()).toMatchObject({ principal_id: 'a0000000-0000-4000-8000-000000000001', user: { email: 'mock@example.com' } });
  });

  it('register mock persiste y es restaurable sin depender del camino real', async () => {
    await mockRegister({ email: 'new@example.com', first_name: 'Nueva', last_name: 'Cuenta' });
    expect(loadSession()).toMatchObject({ principal_id: 'a0000000-0000-4000-8000-000000000001', user: { email: 'new@example.com' } });
  });
});

describe('timeout cubre headers y body', () => {
  function stalledBodyFetch() {
    return vi.fn(async (_url: string, init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: () => new Promise((_, reject) => {
        (init?.signal as AbortSignal | undefined)?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }),
    } as Response));
  }

  it.each([
    ['auth', async () => httpRequest('GET', '/account/me')],
    ['guest', async () => httpGuestRequest('POST', '/mesas/code/pay', 'guest-token', { idempotency_key: 'key' })],
    ['monetaria', async () => httpRequest('POST', '/transfers', { idempotency_key: 'key' })],
  ])('aborta body colgado de request %s', async (_name, request) => {
    saveSession({ access_token: 'access', refresh_token: 'refresh', family_id: 'family', principal_id: 'u', user });
    vi.useFakeTimers();
    vi.stubGlobal('fetch', stalledBodyFetch());
    const pending = request();
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
    vi.useRealTimers();
  });
});
