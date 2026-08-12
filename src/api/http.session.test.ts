import { afterEach, describe, expect, it, vi } from 'vitest';

class MemoryStorage {
  values = new Map<string, string>();
  failSet = false;
  failRemove = false;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (this.failSet) throw new Error('blocked');
    this.values.set(key, value);
  }
  removeItem(key: string) {
    if (this.failRemove) throw new Error('blocked');
    this.values.delete(key);
  }
}

const storage = new MemoryStorage();
Object.assign(globalThis, { localStorage: storage });
let lockTail: Promise<void> = Promise.resolve();
const lockNames: string[] = [];
const locks = {
  async request<T>(name: string, _options: LockOptions, callback: () => Promise<T> | T): Promise<T> {
    lockNames.push(name);
    const previous = lockTail;
    let release: (() => void) | undefined;
    lockTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await callback();
    } finally {
      release?.();
    }
  },
};
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks } });

const { httpGuestRequest, httpLogin, httpLogout, httpRegister, httpRequest } = await import('./http');
const { loadSession, saveSession } = await import('./storage');
const { mockLogin, mockRegister } = await import('./mock/mockApi');

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const user = { id: 'u-1', payme_id: 'u1', email: 'u@example.com', first_name: 'Una', last_name: 'Persona' };

afterEach(() => {
  storage.values.clear();
  storage.failSet = false;
  storage.failRemove = false;
  lockTail = Promise.resolve();
  lockNames.length = 0;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks } });
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

  it('logout intenta el borrado físico aunque falle el tombstone durable', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if ((init?.body as string | undefined)?.includes('password')) {
        return response({ access_token: 'a-fis', refresh_token: 'r-fis', expires_in: 900, user });
      }
      return response({ ok: true });
    }));
    await httpLogin(user.email, 'password');
    storage.failSet = true;

    await expect(httpLogout()).rejects.toThrow('session_storage_unavailable');
    expect(
      storage.values.has('payme_app_session'),
      'logout abortó antes de intentar quitar el bearer físico',
    ).toBe(false);
  });

  it('si storage no puede invalidarse, espera que el servidor revoque antes de declarar logout', async () => {
    let releaseLogout: (() => void) | undefined;
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      if ((init?.body as string | undefined)?.includes('password')) {
        return Promise.resolve(response({ access_token: 'a-residual', refresh_token: 'r-residual', expires_in: 900, user }));
      }
      return new Promise<Response>((resolve) => {
        releaseLogout = () => resolve(response({ ok: true }));
      });
    }));
    await httpLogin(user.email, 'password');
    storage.failSet = true;
    storage.failRemove = true;

    let settled = false;
    const outcome = httpLogout().then(
      () => { settled = true; return 'revoked'; },
      (error: unknown) => { settled = true; return error; },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled, 'logout descartó la única invalidación durable disponible').toBe(false);

    releaseLogout?.();
    await expect(outcome).resolves.toBe('revoked');
    expect(
      storage.values.has('payme_app_session'),
      'la prueba debe ejercer el fallback remoto con el bearer físico todavía presente',
    ).toBe(true);
  });

  it('si fallan storage y revocación remota, el logout informa que no pudo cerrar durablemente', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      if ((init?.body as string | undefined)?.includes('password')) {
        return Promise.resolve(response({ access_token: 'a-sin-salida', refresh_token: 'r-sin-salida', expires_in: 900, user }));
      }
      return Promise.reject(new Error('network_down'));
    }));
    await httpLogin(user.email, 'password');
    storage.failSet = true;
    storage.failRemove = true;

    await expect(httpLogout()).rejects.toThrow('session_storage_unavailable');
    expect(storage.values.has('payme_app_session')).toBe(true);
  });

  it('logout invalida un refresh en vuelo y el par tardío no revive la familia', async () => {
    let releaseRefresh: (() => void) | undefined;
    let refreshStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { refreshStarted = resolve; });
    let protectedCalls = 0;
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? init.body : '';
      if (body.includes('password')) {
        return Promise.resolve(response({ access_token: 'access-a', refresh_token: 'refresh-a', expires_in: 900, user }));
      }
      if (body.includes('refresh_token')) {
        refreshStarted?.();
        return new Promise<Response>((resolve) => {
          releaseRefresh = () => resolve(response({ access_token: 'access-rotated', refresh_token: 'refresh-rotated', expires_in: 900 }));
        });
      }
      if (init?.method === 'POST') return Promise.resolve(response({ ok: true }));
      protectedCalls += 1;
      return Promise.resolve(protectedCalls === 1 ? response({ error: 'expired' }, 401) : response({ ok: true }));
    }));

    await httpLogin(user.email, 'password');
    const request = httpRequest('GET', '/account/me');
    await started;
    const logout = httpLogout();
    expect(loadSession()).toBeNull();
    releaseRefresh?.();
    await expect(request).rejects.toMatchObject({ status: 401 });
    await expect(logout).resolves.toBeUndefined();
    expect(loadSession()).toBeNull();
    expect([...storage.values.values()].join('')).not.toContain('access-rotated');
    expect(new Set(lockNames)).toEqual(new Set(['payme-session-state']));
  });

  it('la limpieza tardía de logout A preserva una familia B que ya apareció', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if ((init?.body as string | undefined)?.includes('password')) {
        return response({ access_token: 'access-a', refresh_token: 'refresh-a', expires_in: 900, user });
      }
      return response({ ok: true });
    }));
    await httpLogin(user.email, 'password');

    let releaseBlock: (() => void) | undefined;
    let enteredBlock: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => { enteredBlock = resolve; });
    const blocker = locks.request('payme-session-state', { mode: 'exclusive' } as LockOptions, async () => {
      enteredBlock?.();
      await new Promise<void>((resolve) => { releaseBlock = resolve; });
    });
    await entered;
    const logout = httpLogout();
    const userB = { ...user, id: 'u-2', payme_id: 'u2', email: 'b@example.com' };
    storage.setItem('payme_app_session', JSON.stringify({
      access_token: 'access-b',
      refresh_token: 'refresh-b',
      family_id: 'family-b',
      principal_id: userB.id,
      user: userB,
    }));

    releaseBlock?.();
    await blocker;
    await logout;
    expect(loadSession()).toMatchObject({ family_id: 'family-b', principal_id: userB.id });
  });

  it('sin Web Locks el tombstone mantiene logout fail-closed y permite un relogin explícito', async () => {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
    const userB = { ...user, id: 'u-2', payme_id: 'u2', email: 'b@example.com' };
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) as { email?: string } : {};
      if (body.email) {
        const selected = body.email === userB.email ? userB : user;
        return response({ access_token: `access-${selected.id}`, refresh_token: `refresh-${selected.id}`, expires_in: 900, user: selected });
      }
      return response({ ok: true });
    }));

    await httpLogin(user.email, 'password');
    await httpLogout();
    expect(loadSession()).toBeNull();
    expect(
      storage.values.has('payme_app_session'),
      'sin Web Locks el logout quedó sólo lógico y conservó el bearer físico',
    ).toBe(false);
    await httpLogin(userB.email, 'password');
    expect(loadSession()).toMatchObject({ principal_id: userB.id, user: { email: userB.email } });
  });

  it('un flujo de dos requests reutiliza la familia con los tokens rotados por el primero', async () => {
    saveSession({
      access_token: 'access-old',
      refresh_token: 'refresh-old',
      family_id: 'family-card-setup',
      principal_id: user.id,
      user,
    });
    let setupCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/auth/refresh')) {
        return response({ access_token: 'access-new', refresh_token: 'refresh-new', expires_in: 900 });
      }
      const authorization = (init?.headers as Record<string, string> | undefined)?.Authorization;
      if (url.endsWith('/payment-methods/setup-intent')) {
        setupCalls += 1;
        return setupCalls === 1
          ? response({ error: 'expired' }, 401)
          : response({ setup_intent_id: 'seti_1', client_secret: 'seti_1_secret' });
      }
      expect(authorization).toBe('Bearer access-new');
      return response({ ok: true });
    }));

    const origin = loadSession();
    expect(origin).not.toBeNull();
    await expect(httpRequest('POST', '/payment-methods/setup-intent', {}, origin!))
      .resolves.toMatchObject({ setup_intent_id: 'seti_1' });
    const rotated = loadSession();
    expect(rotated).toMatchObject({
      family_id: origin!.family_id,
      principal_id: origin!.principal_id,
      access_token: 'access-new',
      refresh_token: 'refresh-new',
    });
    await expect(httpRequest('POST', '/payment-methods', {}, rotated!))
      .resolves.toEqual({ ok: true });
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
    saveSession({ access_token: 'access', refresh_token: 'refresh', family_id: 'family', principal_id: user.id, user });
    vi.useFakeTimers();
    vi.stubGlobal('fetch', stalledBodyFetch());
    const pending = request();
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;
    vi.useRealTimers();
  });
});
