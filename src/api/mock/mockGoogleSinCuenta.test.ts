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

describe('AF-17 · google/continue en el riel mock (reglas del dueño v2.92.0)', () => {
  const TOKEN_C = `google-credential-continue-${'c'.repeat(24)}`;
  const TOKEN_D = `google-credential-continue-${'d'.repeat(24)}`;

  async function conCorreoConCuenta() {
    const mock = await cargar();
    localStorage.setItem('payme.app.mock.google_sin_cuenta.v1', 'true');
    localStorage.setItem('payme.app.mock.google_correo_con_cuenta.v1', 'true');
    return mock;
  }

  async function intentoDeVinculo(mock: Awaited<ReturnType<typeof cargar>>, token: string): Promise<string> {
    try {
      await mock.mockGoogleContinue({ id_token: token, accepted_notice_version: mock.MOCK_AVISO_VERSION });
    } catch (err) {
      const e = err as { status: number; message: string; extra: Record<string, unknown> };
      expect({ status: e.status, code: e.message }).toEqual({ status: 409, code: 'link_required' });
      return e.extra.link_intent as string;
    }
    throw new Error('se esperaba link_required');
  }

  it('🔴 una versión de aviso fuera de la forma del dueño es validation_error', async () => {
    const mock = await cargar();
    expect(await rechazo(mock.mockGoogleContinue({ id_token: TOKEN_C, accepted_notice_version: '0.0.0-demo-local' })))
      .toEqual({ status: 400, code: 'validation_error' });
  });

  it('el token de continue queda consumido para cualquier propósito', async () => {
    const mock = await cargar();
    await mock.mockGoogleContinue({ id_token: TOKEN_C, accepted_notice_version: mock.MOCK_AVISO_VERSION });
    expect(await rechazo(mock.mockGoogleContinue({ id_token: TOKEN_C, accepted_notice_version: mock.MOCK_AVISO_VERSION })))
      .toEqual({ status: 401, code: 'social_auth_failed' });
  });

  it('link: contraseña incorrecta ⇒ 403 con el intento vivo; la correcta ⇒ conecta, y el intento no se reusa', async () => {
    const mock = await conCorreoConCuenta();
    const intento = await intentoDeVinculo(mock, TOKEN_C);
    expect(await rechazo(mock.mockGoogleContinueLink({ link_intent: intento, password: 'mal'.repeat(3) })))
      .toEqual({ status: 403, code: 'reauthentication_failed' });
    await expect(mock.mockGoogleContinueLink({ link_intent: intento, password: mock.MOCK_CLAVE_DEMO_VINCULAR }))
      .resolves.toEqual({ created: false });
    expect(await rechazo(mock.mockGoogleContinueLink({ link_intent: intento, password: mock.MOCK_CLAVE_DEMO_VINCULAR })))
      .toEqual({ status: 401, code: 'social_auth_failed' });
  });

  it('🔴 link: al quinto error el intento se quema', async () => {
    const mock = await conCorreoConCuenta();
    const intento = await intentoDeVinculo(mock, TOKEN_C);
    for (let i = 0; i < 5; i += 1) {
      expect((await rechazo(mock.mockGoogleContinueLink({ link_intent: intento, password: `incorrecta${i}x` })))?.status)
        .toBe(403);
    }
    expect(await rechazo(mock.mockGoogleContinueLink({ link_intent: intento, password: mock.MOCK_CLAVE_DEMO_VINCULAR })))
      .toEqual({ status: 401, code: 'social_auth_failed' });
  });

  it('🔴 link: el intento vence a los 10 minutos', async () => {
    const mock = await conCorreoConCuenta();
    const ahora = Date.now();
    const reloj = vi.spyOn(Date, 'now').mockReturnValue(ahora);
    const intento = await intentoDeVinculo(mock, TOKEN_D);
    reloj.mockReturnValue(ahora + 10 * 60 * 1000 - 1);
    expect((await rechazo(mock.mockGoogleContinueLink({ link_intent: intento, password: 'mal'.repeat(3) })))?.status)
      .toBe(403);
    reloj.mockReturnValue(ahora + 10 * 60 * 1000);
    expect(await rechazo(mock.mockGoogleContinueLink({ link_intent: intento, password: mock.MOCK_CLAVE_DEMO_VINCULAR })))
      .toEqual({ status: 401, code: 'social_auth_failed' });
    reloj.mockRestore();
  });
});
