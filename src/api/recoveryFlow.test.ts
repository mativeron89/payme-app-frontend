import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bootstrapRecoveryTokenCapture,
  captureRecoveryToken,
  completeRecoveryOnce,
  decodeRecoveryCompleteResponse,
  decodeRecoveryRequestResponse,
  discardRecoveryToken,
  recoveryTokenSnapshot,
  resetRecoveryFlowForTests,
  subscribeRecoveryToken,
} from './recoveryFlow';

const TOKEN_A = 'a'.repeat(32);
const TOKEN_B = 'b'.repeat(32);
const COMPLETE = { completed: true } as const;

type HistoryMode = 'normal' | 'noop' | 'throw';

let current = new URL('https://app.paymemx.com/#/home');
let historyMode: HistoryMode = 'normal';
type WindowListener = (event: Event) => void;
const listeners = new Map<string, WindowListener[]>();
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
  addEventListener(event: string, listener: WindowListener) {
    listeners.set(event, [...(listeners.get(event) ?? []), listener]);
  },
  removeEventListener(event: string, listener: WindowListener) {
    const remaining = (listeners.get(event) ?? []).filter((candidate) => candidate !== listener);
    if (remaining.length > 0) listeners.set(event, remaining);
    else listeners.delete(event);
  },
};

function dispatchWindowEvent(eventName: string): void {
  let stopped = false;
  let thrown: unknown;
  const event = {
    stopImmediatePropagation() { stopped = true; },
  } as unknown as Event;
  for (const listener of [...(listeners.get(eventName) ?? [])]) {
    try {
      listener(event);
    } catch (error) {
      thrown ??= error;
    }
    if (stopped) break;
  }
  if (thrown) throw thrown;
}

function forbiddenStorage() {
  return {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
    key: vi.fn(),
    length: 0,
  } as unknown as Storage;
}

let local: Storage;
let session: Storage;
let indexedOpen: ReturnType<typeof vi.fn>;
let consoleSpies: Array<ReturnType<typeof vi.spyOn>>;

function setUrl(url: string) {
  current = new URL(url);
}

beforeEach(() => {
  current = new URL('https://app.paymemx.com/#/home');
  historyMode = 'normal';
  listeners.clear();
  replaceState.mockClear();
  local = forbiddenStorage();
  session = forbiddenStorage();
  indexedOpen = vi.fn();
  vi.stubGlobal('window', fakeWindow as unknown as Window & typeof globalThis);
  vi.stubGlobal('localStorage', local);
  vi.stubGlobal('sessionStorage', session);
  vi.stubGlobal('indexedDB', { open: indexedOpen });
  consoleSpies = (['log', 'info', 'warn', 'error'] as const)
    .map((method) => vi.spyOn(console, method).mockImplementation(() => undefined));
  resetRecoveryFlowForTests();
});

afterEach(() => {
  resetRecoveryFlowForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('recovery · captura fragment-only y cleanup físico', () => {
  it('captura una vez en memoria, limpia antes de complete y no expone el raw', async () => {
    setUrl(`https://app.paymemx.com/?keep=yes#/recovery?token=${TOKEN_A}`);

    const capture = captureRecoveryToken();
    expect(capture).toEqual({ status: 'ready' });
    expect(recoveryTokenSnapshot()).toEqual({ status: 'ready' });
    expect(JSON.stringify(capture)).not.toContain(TOKEN_A);
    expect(current.search).toBe('?keep=yes');
    expect(current.hash).toBe('#/recovery');

    const complete = vi.fn(async (token: string, password: string) => {
      expect(current.href).not.toContain(token);
      expect(token).toBe(TOKEN_A);
      expect(password).toBe('Nueva-clave-123');
      return COMPLETE;
    });
    await expect(completeRecoveryOnce('Nueva-clave-123', complete)).resolves.toEqual(COMPLETE);
    expect(recoveryTokenSnapshot()).toEqual({ status: 'consumed' });
  });

  it.each([
    ['plus percent-encoded', `${'a'.repeat(24)}%2B${'b'.repeat(8)}`, `${'a'.repeat(24)}+${'b'.repeat(8)}`],
    ['UTF-8 percent-encoded', `${'a'.repeat(24)}%C3%A9`, `${'a'.repeat(24)}é`],
  ])('acepta %s y entrega exactamente el raw decodificado', async (_name, encoded, decoded) => {
    setUrl(`https://app.paymemx.com/#/recovery?token=${encoded}`);
    expect(captureRecoveryToken()).toEqual({ status: 'ready' });
    const complete = vi.fn(async (token: string) => {
      expect(token).toBe(decoded);
      return COMPLETE;
    });
    await completeRecoveryOnce('Nueva-clave-123', complete);
  });

  it.each([
    ['percent inválido', `#/recovery?token=${'a'.repeat(24)}%ZZ`, '#/recovery'],
    ['UTF-8 inválido', `#/recovery?token=${'a'.repeat(24)}%FF`, '#/recovery'],
    ['plus crudo', `#/recovery?token=${'a'.repeat(24)}+${'b'.repeat(8)}`, '#/recovery'],
    ['duplicado igual', `#/recovery?token=${TOKEN_A}&token=${TOKEN_A}`, '#/recovery'],
    ['duplicado distinto', `#/recovery?token=${TOKEN_A}&token=${TOKEN_B}`, '#/recovery'],
    ['parámetro extra', `#/recovery?token=${TOKEN_A}&next=home`, '#/recovery'],
    ['clave encoded', `#/recovery?%74oken=${TOKEN_A}`, '#/recovery'],
    ['case distinto', `#/Recovery?token=${TOKEN_A}`, '#/recovery'],
    ['path hijo', `#/recovery/child?token=${TOKEN_A}`, '#/recovery'],
    ['path ajeno', `#/home?token=${TOKEN_A}`, '#/home'],
    ['hash sin slash', `#recovery?token=${TOKEN_A}`, '#/'],
    ['token corto', '#/recovery?token=corto', '#/recovery'],
    ['sin token', '#/recovery?next=home', '#/recovery'],
  ])('%s falla cerrado y elimina la autoridad de la URL', (_name, hash, cleanedHash) => {
    setUrl(`https://app.paymemx.com/${hash}`);
    expect(captureRecoveryToken()).toEqual({ status: 'invalid' });
    expect(current.hash).toBe(cleanedHash);
    expect(current.href).not.toContain(TOKEN_A);
    expect(current.href).not.toContain(TOKEN_B);
  });

  it('retira `?token` HTTP antes de adoptar y conserva parámetros no sensibles', async () => {
    setUrl(`https://app.paymemx.com/?token=${TOKEN_A}&keep=yes#/home`);
    expect(captureRecoveryToken()).toEqual({ status: 'invalid' });
    expect(current.searchParams.has('token')).toBe(false);
    expect(current.searchParams.get('keep')).toBe('yes');

    const complete = vi.fn(async () => COMPLETE);
    await expect(completeRecoveryOnce('Nueva-clave-123', complete))
      .rejects.toThrow('recovery_token_unavailable');
    expect(complete).not.toHaveBeenCalled();
  });

  it('query HTTP + fragmento válido limpia ambos y nunca elige una autoridad', () => {
    setUrl(`https://app.paymemx.com/?token=${TOKEN_A}#/recovery?token=${TOKEN_B}`);
    expect(captureRecoveryToken()).toEqual({ status: 'invalid' });
    expect(current.searchParams.has('token')).toBe(false);
    expect(current.hash).toBe('#/recovery');
  });

  it.each(['noop', 'throw'] as const)('replaceState %s deja el flujo blocked y sin complete', async (mode) => {
    setUrl(`https://app.paymemx.com/#/recovery?token=${TOKEN_A}`);
    historyMode = mode;
    expect(captureRecoveryToken()).toEqual({ status: 'blocked' });
    expect(recoveryTokenSnapshot()).toEqual({ status: 'blocked' });
    const complete = vi.fn(async () => COMPLETE);
    await expect(completeRecoveryOnce('Nueva-clave-123', complete))
      .rejects.toThrow('recovery_token_unavailable');
    expect(complete).not.toHaveBeenCalled();
  });

  it.each(['noop', 'throw'] as const)('query HTTP con replaceState %s queda blocked', (mode) => {
    setUrl(`https://app.paymemx.com/?token=${TOKEN_A}#/home`);
    historyMode = mode;
    expect(captureRecoveryToken()).toEqual({ status: 'blocked' });
    expect(current.searchParams.has('token')).toBe(true);
  });
});

describe('recovery · StrictMode y generaciones', () => {
  it('publica processing/consumed para que un remount observe el mismo intento', async () => {
    const observed: string[] = [];
    const stop = subscribeRecoveryToken(() => { observed.push(recoveryTokenSnapshot().status); });
    setUrl(`https://app.paymemx.com/#/recovery?token=${TOKEN_A}`);
    captureRecoveryToken();
    let release: ((result: typeof COMPLETE) => void) | undefined;
    const pending = completeRecoveryOnce('Nueva-clave-123', () => (
      new Promise<typeof COMPLETE>((resolve) => { release = resolve; })
    ));
    expect(recoveryTokenSnapshot()).toEqual({ status: 'processing' });
    release?.(COMPLETE);
    await pending;
    expect(recoveryTokenSnapshot()).toEqual({ status: 'consumed' });
    expect(observed).toEqual(['ready', 'processing', 'consumed']);
    stop();
  });

  it('un complete fallido queda retryable sin reexponer el token', async () => {
    setUrl(`https://app.paymemx.com/#/recovery?token=${TOKEN_A}`);
    const publicCapture = captureRecoveryToken();
    await expect(completeRecoveryOnce('Nueva-clave-123', async () => {
      throw new Error('network_down');
    })).rejects.toThrow('network_down');
    expect(recoveryTokenSnapshot()).toEqual({ status: 'retryable' });
    expect(JSON.stringify(publicCapture)).not.toContain(TOKEN_A);
    await expect(completeRecoveryOnce('Nueva-clave-123', async () => COMPLETE))
      .resolves.toEqual(COMPLETE);
  });

  it('dos consumidores de una captura comparten una sola promise', async () => {
    setUrl(`https://app.paymemx.com/#/recovery?token=${TOKEN_A}`);
    captureRecoveryToken();
    let release: ((result: typeof COMPLETE) => void) | undefined;
    const complete = vi.fn(() => new Promise<typeof COMPLETE>((resolve) => { release = resolve; }));

    const first = completeRecoveryOnce('Nueva-clave-123', complete);
    const second = completeRecoveryOnce('Nueva-clave-123', complete);
    expect(second).toBe(first);
    expect(complete).toHaveBeenCalledTimes(1);
    release?.(COMPLETE);
    await expect(Promise.all([first, second])).resolves.toEqual([COMPLETE, COMPLETE]);
  });

  it('la resolución tardía de A no consume ni borra la captura B', async () => {
    setUrl(`https://app.paymemx.com/#/recovery?token=${TOKEN_A}`);
    captureRecoveryToken();
    let releaseA: ((result: typeof COMPLETE) => void) | undefined;
    const completeA = vi.fn(() => new Promise<typeof COMPLETE>((resolve) => { releaseA = resolve; }));
    const pendingA = completeRecoveryOnce('Clave-A-123', completeA);

    setUrl(`https://app.paymemx.com/#/recovery?token=${TOKEN_B}`);
    expect(captureRecoveryToken()).toEqual({ status: 'ready' });
    releaseA?.(COMPLETE);
    await pendingA;
    expect(recoveryTokenSnapshot()).toEqual({ status: 'ready' });

    const completeB = vi.fn(async (token: string) => {
      expect(token).toBe(TOKEN_B);
      return COMPLETE;
    });
    await expect(completeRecoveryOnce('Clave-B-123', completeB)).resolves.toEqual(COMPLETE);
    expect(completeB).toHaveBeenCalledTimes(1);
    expect(recoveryTokenSnapshot()).toEqual({ status: 'consumed' });
  });

  it('discard invalida la generación y una promise tardía no revive el flujo', async () => {
    setUrl(`https://app.paymemx.com/#/recovery?token=${TOKEN_A}`);
    captureRecoveryToken();
    let release: ((result: typeof COMPLETE) => void) | undefined;
    const pending = completeRecoveryOnce('Nueva-clave-123', () => (
      new Promise<typeof COMPLETE>((resolve) => { release = resolve; })
    ));
    discardRecoveryToken();
    release?.(COMPLETE);
    await pending;
    expect(recoveryTokenSnapshot()).toEqual({ status: 'absent' });
  });
});

describe('recovery · bootstrap y fronteras de privacidad', () => {
  it.each(['noop', 'throw'] as const)('bootstrap aborta antes de registrar listeners si cleanup %s', (mode) => {
    setUrl(`https://app.paymemx.com/#/recovery?token=${TOKEN_A}`);
    historyMode = mode;
    expect(() => bootstrapRecoveryTokenCapture()).toThrow('recovery_url_cleanup_failed');
    expect(listeners.size).toBe(0);
  });

  it('bootstrap captura antes de React y permite retirar su listener', () => {
    setUrl(`https://app.paymemx.com/#/recovery?token=${TOKEN_A}`);
    const stop = bootstrapRecoveryTokenCapture();
    expect(recoveryTokenSnapshot()).toEqual({ status: 'ready' });
    expect(listeners.has('hashchange')).toBe(true);
    stop();
    expect(listeners.has('hashchange')).toBe(false);

    const main = readFileSync(new URL('../main.tsx', import.meta.url), 'utf8');
    const bootstrap = main.indexOf('bootstrapRecoveryTokenCapture();');
    expect(bootstrap).toBeGreaterThan(-1);
    expect(bootstrap).toBeLessThan(main.indexOf("document.getElementById('root')"));
    expect(bootstrap).toBeLessThan(main.indexOf('createRoot(el).render'));
  });

  it('hashchange blocked corta al router antes de lanzar y deja estado no adoptable', () => {
    const stop = bootstrapRecoveryTokenCapture();
    const router = vi.fn();
    fakeWindow.addEventListener('hashchange', router);
    setUrl(`https://app.paymemx.com/#/recovery?token=${TOKEN_A}`);
    historyMode = 'noop';

    expect(() => dispatchWindowEvent('hashchange')).toThrow('recovery_url_cleanup_failed');
    expect(recoveryTokenSnapshot()).toEqual({ status: 'blocked' });
    expect(router).not.toHaveBeenCalled();
    expect(current.hash).toContain(TOKEN_A);
    stop();
  });

  it('hashchange recovery válido limpia primero y luego deja continuar listeners', () => {
    const stop = bootstrapRecoveryTokenCapture();
    const router = vi.fn(() => {
      expect(current.hash).toBe('#/recovery');
      expect(recoveryTokenSnapshot()).toEqual({ status: 'ready' });
    });
    fakeWindow.addEventListener('hashchange', router);
    setUrl(`https://app.paymemx.com/#/recovery?token=${TOKEN_A}`);

    expect(() => dispatchWindowEvent('hashchange')).not.toThrow();
    expect(router).toHaveBeenCalledTimes(1);
    expect(current.href).not.toContain(TOKEN_A);
    stop();
  });

  it('no usa storage, IndexedDB ni logs y complete no depende de volver a leer capability', async () => {
    setUrl(`https://app.paymemx.com/#/recovery?token=${TOKEN_A}`);
    captureRecoveryToken();
    await completeRecoveryOnce('Nueva-clave-123', async () => COMPLETE);

    for (const storage of [local, session]) {
      expect(storage.getItem).not.toHaveBeenCalled();
      expect(storage.setItem).not.toHaveBeenCalled();
      expect(storage.removeItem).not.toHaveBeenCalled();
    }
    expect(indexedOpen).not.toHaveBeenCalled();
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  });

  it('decodifica sólo respuestas owner exactas', () => {
    expect(decodeRecoveryRequestResponse({ accepted: true })).toEqual({ accepted: true });
    expect(decodeRecoveryCompleteResponse({ completed: true })).toEqual({ completed: true });
    expect(() => decodeRecoveryRequestResponse({ accepted: true, extra: false })).toThrow();
    expect(() => decodeRecoveryCompleteResponse({ completed: false })).toThrow();
  });
});
