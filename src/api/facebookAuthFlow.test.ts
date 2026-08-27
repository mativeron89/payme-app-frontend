import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FacebookSocialCapability } from './socialAuth';
import type { FacebookStartResponse } from './types';
import {
  captureSessionStateWitness,
  invalidateSession,
  saveSession,
  type StoredSession,
} from './storage';
import {
  FACEBOOK_FLOW_STORAGE_KEY,
  bootstrapFacebookCallbackCapture,
  captureFacebookCallback,
  completeFacebookCallbackOnce,
  decodeFacebookStartResponse,
  facebookCallbackSnapshot,
  prepareFacebookRedirect,
  resetFacebookFlowForTests,
} from './facebookAuthFlow';

class MemoryStorage {
  values = new Map<string, string>();
  failSet = false;
  failRemove = false;
  noOpSet = false;
  noOpRemove = false;
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (this.failSet) throw new Error('blocked');
    if (!this.noOpSet) this.values.set(key, value);
  }
  removeItem(key: string) {
    if (this.failRemove) throw new Error('blocked');
    if (!this.noOpRemove) this.values.delete(key);
  }
  clear() { this.values.clear(); }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  get length() { return this.values.size; }
}

const memory = new MemoryStorage();
const sessionStateMemory = new MemoryStorage();
let current = new URL('https://app.paymemx.com/#/home');
let historyMode: 'normal' | 'noop' | 'throw' = 'normal';
const replaceState = vi.fn((_state: unknown, _title: string, next?: string | URL | null) => {
  if (historyMode === 'throw') throw new Error('blocked');
  if (historyMode === 'noop' || next == null) return;
  current = new URL(String(next), current.origin);
});

const fakeWindow = {
  get location() {
    return {
      get href() { return current.href; },
      get pathname() { return current.pathname; },
      get search() { return current.search; },
      get hash() { return current.hash; },
    };
  },
  history: { state: null, replaceState },
};

const CAPABILITY: FacebookSocialCapability = {
  enabled: true,
  registration: true,
  login: true,
  appId: '1234567890',
  redirectUri: 'https://app.paymemx.com/',
};

const SESSION: StoredSession = {
  access_token: 'access',
  refresh_token: 'refresh',
  family_id: 'family',
  principal_id: 'user',
  user: { id: 'user', payme_id: 'payme_mx_test', email: 'test@payme.local', first_name: 'Test', last_name: '' },
};

function start(state = 's'.repeat(32), expiresAt = Date.now() + 10 * 60 * 1000): FacebookStartResponse {
  const authorization = new URL('https://www.facebook.com/v99.0/dialog/oauth');
  authorization.searchParams.set('client_id', CAPABILITY.appId!);
  authorization.searchParams.set('redirect_uri', CAPABILITY.redirectUri!);
  authorization.searchParams.set('response_type', 'code');
  authorization.searchParams.set('state', state);
  return { authorization_url: authorization.toString(), expires_at: new Date(expiresAt).toISOString() };
}

function callbackUrl(response: FacebookStartResponse, options: { state?: string; code?: string; extra?: string } = {}) {
  const state = options.state ?? new URL(response.authorization_url).searchParams.get('state')!;
  const params = new URLSearchParams({ keep: 'yes', code: options.code ?? 'facebook-code', state });
  if (options.extra) params.append(options.extra, 'extra');
  current = new URL(`https://app.paymemx.com/?${params.toString()}#/home`);
}

function prepare(
  response: FacebookStartResponse,
  purpose: 'login' | 'register',
  capability: FacebookSocialCapability = CAPABILITY,
): string {
  return prepareFacebookRedirect(response, purpose, capability, captureSessionStateWitness());
}

beforeEach(() => {
  memory.failSet = false;
  memory.failRemove = false;
  memory.noOpSet = false;
  memory.noOpRemove = false;
  memory.values.clear();
  sessionStateMemory.values.clear();
  current = new URL('https://app.paymemx.com/#/home');
  historyMode = 'normal';
  replaceState.mockClear();
  vi.stubGlobal('sessionStorage', memory as unknown as Storage);
  vi.stubGlobal('localStorage', sessionStateMemory as unknown as Storage);
  vi.stubGlobal('window', fakeWindow as unknown as Window & typeof globalThis);
  resetFacebookFlowForTests();
});

afterEach(() => {
  memory.failRemove = false;
  memory.noOpRemove = false;
  resetFacebookFlowForTests();
  vi.unstubAllGlobals();
});

describe('start Facebook · URL y custodia cerradas', () => {
  it('acepta sólo el shape exacto y guarda state/purpose/expiry con round-trip', () => {
    const response = decodeFacebookStartResponse(start());
    expect(prepare(response, 'register')).toBe(response.authorization_url);
    expect(JSON.parse(memory.getItem(FACEBOOK_FLOW_STORAGE_KEY)!)).toMatchObject({
      v: 1,
      purpose: 'register',
      state: 's'.repeat(32),
      expires_at: response.expires_at,
    });
    expect(JSON.parse(memory.getItem(FACEBOOK_FLOW_STORAGE_KEY)!).session_state_witness)
      .toBe(captureSessionStateWitness());
  });

  it.each([
    ['host ajeno', (response: FacebookStartResponse) => response.authorization_url.replace('www.facebook.com', 'evil.example')],
    ['http', (response: FacebookStartResponse) => response.authorization_url.replace('https:', 'http:')],
    ['path ajeno', (response: FacebookStartResponse) => response.authorization_url.replace('/dialog/oauth', '/login')],
    ['param extra', (response: FacebookStartResponse) => `${response.authorization_url}&scope=email`],
    ['state duplicado', (response: FacebookStartResponse) => `${response.authorization_url}&state=${'x'.repeat(32)}`],
    ['client id distinto', (response: FacebookStartResponse) => response.authorization_url.replace('1234567890', '9999999999')],
  ])('rechaza %s antes de navegar', (_name, mutate) => {
    const response = start();
    response.authorization_url = mutate(response);
    expect(() => prepare(response, 'login'))
      .toThrow('facebook_start_response_malformed');
  });

  it.each(['throw', 'noop'] as const)('storage %s impide entregar authorization_url', (mode) => {
    if (mode === 'throw') memory.failSet = true;
    else memory.noOpSet = true;
    expect(() => prepare(start(), 'login'))
      .toThrow('facebook_session_storage_unavailable');
  });

  it.each([
    ['login', { ...CAPABILITY, login: false }, 'register'],
    ['register', { ...CAPABILITY, registration: false }, 'login'],
  ] as const)('capability de %s OFF bloquea sólo esa acción', (blocked, capability, allowed) => {
    const response = start();
    expect(() => prepare(response, blocked, capability))
      .toThrow('facebook_start_response_malformed');
    expect(prepare(response, allowed, capability)).toBe(response.authorization_url);
  });
});

describe('callback Facebook · cleanup, binding y raw privado', () => {
  it('limpia URL/storage antes de ready y el snapshot público no contiene raws', async () => {
    const response = start();
    prepare(response, 'login');
    callbackUrl(response);

    const capture = captureFacebookCallback();
    expect(capture).toEqual({ status: 'ready', purpose: 'login' });
    expect(facebookCallbackSnapshot()).toEqual({ status: 'ready', purpose: 'login' });
    expect(JSON.stringify(capture)).not.toContain('facebook-code');
    expect(JSON.stringify(capture)).not.toContain('s'.repeat(32));
    expect(memory.getItem(FACEBOOK_FLOW_STORAGE_KEY)).toBeNull();
    expect(current.searchParams.get('keep')).toBe('yes');
    expect(current.searchParams.has('code')).toBe(false);
    expect(current.searchParams.has('state')).toBe(false);
    expect(current.hash).toBe('#/home');

    const complete = vi.fn(async (purpose, body) => {
      expect(memory.getItem(FACEBOOK_FLOW_STORAGE_KEY)).toBeNull();
      expect(current.searchParams.has('code')).toBe(false);
      expect(current.searchParams.has('state')).toBe(false);
      expect(purpose).toBe('login');
      expect(body).toEqual({ state: 's'.repeat(32), code: 'facebook-code' });
      return SESSION;
    });
    await expect(completeFacebookCallbackOnce(complete)).resolves.toBe(SESSION);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['state mismatch', (response: FacebookStartResponse) => callbackUrl(response, { state: 'm'.repeat(32) }), 'mismatch'],
    ['code duplicado', (response: FacebookStartResponse) => {
      callbackUrl(response);
      current.searchParams.append('code', 'second');
    }, 'invalid'],
    ['state duplicado', (response: FacebookStartResponse) => {
      callbackUrl(response);
      current.searchParams.append('state', 'second-state-value-00000');
    }, 'invalid'],
  ])('%s limpia y nunca completa', async (_name, arrange, expectedStatus) => {
    const response = start();
    prepare(response, 'login');
    arrange(response);
    expect(captureFacebookCallback().status).toBe(expectedStatus);
    const complete = vi.fn(async () => SESSION);
    await expect(completeFacebookCallbackOnce(complete)).rejects.toThrow('facebook_callback_invalid');
    expect(complete).not.toHaveBeenCalled();
    expect(memory.getItem(FACEBOOK_FLOW_STORAGE_KEY)).toBeNull();
    expect(current.searchParams.has('code')).toBe(false);
    expect(current.searchParams.has('state')).toBe(false);
  });

  it('expiry se evalúa al callback y consume custodia sin red', async () => {
    const now = Date.now();
    const response = start('e'.repeat(32), now + 1_000);
    prepare(response, 'register');
    callbackUrl(response);
    expect(captureFacebookCallback(now + 2_000).status).toBe('expired');
    const complete = vi.fn(async () => SESSION);
    await expect(completeFacebookCallbackOnce(complete, now + 2_000)).rejects.toThrow();
    expect(complete).not.toHaveBeenCalled();
  });

  it.each(['noop', 'throw'] as const)('replaceState %s impide ready y complete', async (mode) => {
    const response = start();
    prepare(response, 'login');
    callbackUrl(response);
    historyMode = mode;
    expect(captureFacebookCallback().status).toBe('blocked');
    const complete = vi.fn(async () => SESSION);
    await expect(completeFacebookCallbackOnce(complete)).rejects.toThrow();
    expect(complete).not.toHaveBeenCalled();
  });

  it.each(['noop', 'throw'] as const)('removeItem %s destruye raw por overwrite verificado', async (mode) => {
    const response = start();
    prepare(response, 'login');
    callbackUrl(response);
    if (mode === 'noop') memory.noOpRemove = true;
    else memory.failRemove = true;
    expect(captureFacebookCallback()).toEqual({ status: 'ready', purpose: 'login' });
    const residual = memory.getItem(FACEBOOK_FLOW_STORAGE_KEY);
    expect(residual).not.toBeNull();
    expect(residual).not.toContain('s'.repeat(32));
    expect(residual).not.toContain('facebook-code');
    const complete = vi.fn(async () => SESSION);
    await expect(completeFacebookCallbackOnce(complete)).resolves.toBe(SESSION);
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('remove y overwrite no verificables dejan blocked y cero complete', async () => {
    const response = start();
    prepare(response, 'login');
    callbackUrl(response);
    memory.noOpRemove = true;
    memory.noOpSet = true;

    const capture = captureFacebookCallback();
    expect(capture).toEqual({ status: 'blocked' });
    expect(JSON.stringify(capture)).not.toContain('s'.repeat(32));
    expect(JSON.stringify(capture)).not.toContain('facebook-code');
    const complete = vi.fn(async () => SESSION);
    await expect(completeFacebookCallbackOnce(complete)).rejects.toThrow('facebook_callback_invalid');
    expect(complete).not.toHaveBeenCalled();
  });

  it('un login nuevo durante el redirect invalida el callback antes de red', async () => {
    const response = start('g'.repeat(32));
    prepare(response, 'login');
    saveSession(SESSION);
    callbackUrl(response);
    expect(captureFacebookCallback()).toEqual({ status: 'ready', purpose: 'login' });

    const complete = vi.fn(async () => SESSION);
    await expect(completeFacebookCallbackOnce(complete)).rejects.toThrow('session_state_changed');
    expect(complete).not.toHaveBeenCalled();
  });

  it('detecta el ABA sin sesión → B → sin sesión durante el redirect', async () => {
    const response = start('q'.repeat(32));
    prepare(response, 'login');
    saveSession(SESSION);
    invalidateSession(SESSION);
    callbackUrl(response);
    expect(captureFacebookCallback()).toEqual({ status: 'ready', purpose: 'login' });

    const complete = vi.fn(async () => SESSION);
    await expect(completeFacebookCallbackOnce(complete)).rejects.toThrow('session_state_changed');
    expect(complete).not.toHaveBeenCalled();
  });

  it('si la sesión cambia durante /start no entrega authorization_url', () => {
    const witnessBeforeStart = captureSessionStateWitness();
    saveSession(SESSION);
    expect(() => prepareFacebookRedirect(start(), 'login', CAPABILITY, witnessBeforeStart))
      .toThrow('session_state_changed');
    expect(memory.getItem(FACEBOOK_FLOW_STORAGE_KEY)).toBeNull();
  });
});

describe('custodia Facebook sin callback', () => {
  it('preserva una intención pendiente válida hasta que vuelva Meta', () => {
    const response = start('p'.repeat(32));
    prepare(response, 'login');

    expect(captureFacebookCallback()).toEqual({ status: 'absent' });
    expect(JSON.parse(memory.getItem(FACEBOOK_FLOW_STORAGE_KEY)!)).toMatchObject({
      purpose: 'login',
      state: 'p'.repeat(32),
    });
  });

  it('scrubbea intención expirada aun sin code/state en URL', () => {
    const now = Date.now();
    const response = start('e'.repeat(32), now + 1_000);
    prepare(response, 'register');

    expect(captureFacebookCallback(now + 2_000)).toEqual({ status: 'expired' });
    expect(memory.getItem(FACEBOOK_FLOW_STORAGE_KEY)).toBeNull();
  });

  it('scrubbea custodia inválida y no publica su raw', () => {
    const rawState = 'r'.repeat(32);
    memory.setItem(FACEBOOK_FLOW_STORAGE_KEY, JSON.stringify({
      v: 1,
      purpose: 'login',
      state: rawState,
      expires_at: 'no-es-fecha',
    }));

    const capture = captureFacebookCallback();
    expect(capture).toEqual({ status: 'invalid' });
    expect(JSON.stringify(capture)).not.toContain(rawState);
    expect(memory.getItem(FACEBOOK_FLOW_STORAGE_KEY)).toBeNull();
  });

  it('si tampoco puede destruir residuo inválido queda blocked', async () => {
    const rawState = 'z'.repeat(32);
    memory.setItem(FACEBOOK_FLOW_STORAGE_KEY, JSON.stringify({
      v: 0,
      purpose: 'login',
      state: rawState,
      expires_at: new Date(Date.now() + 10_000).toISOString(),
    }));
    memory.noOpRemove = true;
    memory.noOpSet = true;

    const capture = captureFacebookCallback();
    expect(capture).toEqual({ status: 'blocked' });
    expect(JSON.stringify(capture)).not.toContain(rawState);
    const complete = vi.fn(async () => SESSION);
    await expect(completeFacebookCallbackOnce(complete)).rejects.toThrow('facebook_callback_invalid');
    expect(complete).not.toHaveBeenCalled();
  });
});

describe('bootstrap Facebook pre-React', () => {
  it.each(['url', 'storage'] as const)('callback con cleanup %s bloqueado aborta', (blocked) => {
    const response = start();
    prepare(response, 'login');
    callbackUrl(response);
    if (blocked === 'url') historyMode = 'noop';
    else {
      memory.failRemove = true;
      memory.failSet = true;
    }

    expect(() => bootstrapFacebookCallbackCapture()).toThrow('facebook_callback_cleanup_failed');
    expect(facebookCallbackSnapshot()).toEqual({ status: 'blocked' });
  });

  it('storage bloqueado sin callback no derriba la app password', () => {
    vi.stubGlobal('sessionStorage', undefined);
    expect(() => bootstrapFacebookCallbackCapture()).not.toThrow();
    expect(facebookCallbackSnapshot()).toEqual({ status: 'blocked' });
  });

  it('main captura Facebook antes de crear React root', () => {
    const main = readFileSync(new URL('../main.tsx', import.meta.url), 'utf8');
    const facebook = main.indexOf('bootstrapFacebookCallbackCapture();');
    expect(facebook).toBeGreaterThan(-1);
    expect(facebook).toBeLessThan(main.indexOf('createRoot(el).render'));
  });
});

describe('callback Facebook · StrictMode y generaciones', () => {
  it('dos consumidores de la misma captura comparten una sola promise', async () => {
    const response = start();
    prepare(response, 'login');
    callbackUrl(response);
    captureFacebookCallback();
    let release: ((session: StoredSession) => void) | undefined;
    const complete = vi.fn(() => new Promise<StoredSession>((resolve) => { release = resolve; }));
    const first = completeFacebookCallbackOnce(complete);
    const second = completeFacebookCallbackOnce(complete);
    expect(second).toBe(first);
    expect(complete).toHaveBeenCalledTimes(1);
    release?.(SESSION);
    await expect(Promise.all([first, second])).resolves.toEqual([SESSION, SESSION]);
  });

  it('una captura B no queda ligada ni es consumida por la promise tardía de A', async () => {
    const firstResponse = start('a'.repeat(32));
    prepare(firstResponse, 'login');
    callbackUrl(firstResponse, { code: 'code-a' });
    captureFacebookCallback();
    let releaseA: ((session: StoredSession) => void) | undefined;
    const completeA = vi.fn(() => new Promise<StoredSession>((resolve) => { releaseA = resolve; }));
    const pendingA = completeFacebookCallbackOnce(completeA);

    const secondResponse = start('b'.repeat(32));
    prepare(secondResponse, 'register');
    callbackUrl(secondResponse, { code: 'code-b' });
    expect(captureFacebookCallback()).toEqual({ status: 'ready', purpose: 'register' });
    const completeB = vi.fn(async (purpose, body) => {
      expect(purpose).toBe('register');
      expect(body).toEqual({ state: 'b'.repeat(32), code: 'code-b' });
      return SESSION;
    });
    await expect(completeFacebookCallbackOnce(completeB)).resolves.toBe(SESSION);
    expect(completeB).toHaveBeenCalledTimes(1);

    releaseA?.(SESSION);
    await pendingA;
    expect(facebookCallbackSnapshot()).toEqual({ status: 'consumed' });
    expect(completeA).toHaveBeenCalledTimes(1);
  });
});
