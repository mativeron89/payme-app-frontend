import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * AF-16 · el mock reproduce el ingreso con Google de una identidad SIN cuenta,
 * y el consumo del `id_token` que hace el dueño.
 *
 * Por qué importa el consumo: el dueño escribe el digest del token también en
 * un ingreso FALLIDO (`consumeCredential`, `UNIQUE (provider, credential_hash)`
 * para cualquier propósito), así que reusarlo en el alta es
 * `registration_not_available`. Si el mock aceptara el reuso, un consumidor que
 * se saltara el segundo toque quedaría verde en el riel y roto en producción.
 */

const TOKEN_INGRESO = `google-credential-ingreso-${'a'.repeat(24)}`;
const TOKEN_ALTA = `google-credential-alta-${'b'.repeat(24)}`;

let values: Map<string, string>;

function installStorage() {
  values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  });
}

function installLocks() {
  let tail = Promise.resolve();
  const locks = {
    async request<T>(_name: string, _options: LockOptions, action: () => Promise<T> | T): Promise<T> {
      const previous = tail;
      let release: (() => void) | undefined;
      tail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try { return await action(); } finally { release?.(); }
    },
  };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks } });
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.stubEnv('VITE_MOCK', '1');
  installStorage();
  installLocks();
  vi.stubGlobal('setTimeout', ((callback: () => void) => { queueMicrotask(callback); return 0; }) as unknown as typeof setTimeout);
});

async function cargar() {
  const mock = await import('./mockApi');
  mock.setAltaPublicaMock(true);
  return mock;
}

const ALTA = { first_name: 'Nora', last_name: 'Nueva', email: 'nora@ejemplo.mx' };

async function rechazo(promesa: Promise<unknown>): Promise<{ status: number; code: string } | null> {
  try {
    await promesa;
    return null;
  } catch (err) {
    const e = err as { status: number; message: string };
    return { status: e.status, code: e.message };
  }
}

describe('AF-16 · Google sin cuenta en el riel mock', () => {
  it('control positivo: por defecto la identidad TIENE cuenta y el ingreso entra', async () => {
    const mock = await cargar();
    expect(mock.googleSinCuentaMock()).toBe(false);
    await expect(mock.mockGoogleLogin(TOKEN_INGRESO)).resolves.toBeTruthy();
  });

  it('🔴 sin cuenta ⇒ el ingreso es el 401 opaco del dueño', async () => {
    const mock = await cargar();
    mock.setGoogleSinCuentaMock(true);
    expect(await rechazo(mock.mockGoogleLogin(TOKEN_INGRESO)))
      .toEqual({ status: 401, code: 'social_auth_failed' });
  });

  it('🔴 el token de un ingreso FALLIDO queda consumido: reusarlo en el alta es registration_not_available', async () => {
    const mock = await cargar();
    mock.setGoogleSinCuentaMock(true);
    await rechazo(mock.mockGoogleLogin(TOKEN_INGRESO));
    expect(await rechazo(mock.mockGoogleRegister({ id_token: TOKEN_INGRESO, ...ALTA })))
      .toEqual({ status: 403, code: 'registration_not_available' });
  });

  it('con un token NUEVO el alta sale, y después la identidad entra directo', async () => {
    const mock = await cargar();
    mock.setGoogleSinCuentaMock(true);
    await rechazo(mock.mockGoogleLogin(TOKEN_INGRESO));
    await expect(mock.mockGoogleRegister({ id_token: TOKEN_ALTA, ...ALTA })).resolves.toBeTruthy();
    expect(mock.googleSinCuentaMock()).toBe(false);
  });

  it('🔴 tampoco se reusa un token de alta, ni en el ingreso', async () => {
    const mock = await cargar();
    await mock.mockGoogleRegister({ id_token: TOKEN_ALTA, ...ALTA });
    expect(await rechazo(mock.mockGoogleLogin(TOKEN_ALTA)))
      .toEqual({ status: 401, code: 'social_auth_failed' });
  });
});
