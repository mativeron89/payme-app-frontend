import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * D268 · S-02 · el mock del dueño 2.178.0: el código del redirect atado al
 * challenge del `state` (`entrar:`/`crear:`). Con verifier, sólo los códigos
 * atados a su challenge; sin él, sólo los sueltos.
 */
function storage(extra: Record<string, string> = {}) {
  const values = new Map<string, string>([
    ['payme.app.mock.latencia.v1', '0'],
    ['payme.app.mock.google_redirect.v1', 'true'],
    ['payme.app.mock.google_redirect_signup.v1', 'true'],
    ...Object.entries(extra),
  ]);
  const almacen = {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => { values.set(k, v); },
    removeItem: (k: string) => { values.delete(k); },
    clear: () => values.clear(),
    key: (i: number) => [...values.keys()][i] ?? null,
    get length() { return values.size; },
  };
  vi.stubGlobal('localStorage', almacen);
  vi.stubGlobal('sessionStorage', almacen);
  // La sesión social del canje se persiste bajo el Web Lock de sesión, y sin él
  // falla cerrada (`session_lock_unavailable`). El Node del CI (20) no trae
  // `navigator`: el lock se instala acá, en serie, como en `mockGoogleSinCuenta`.
  let cola = Promise.resolve();
  vi.stubGlobal('navigator', {
    locks: {
      async request<T>(_nombre: string, _opciones: unknown, accion: () => Promise<T> | T): Promise<T> {
        const anterior = cola;
        let soltar: (() => void) | undefined;
        cola = new Promise<void>((resolve) => { soltar = resolve; });
        await anterior;
        try { return await accion(); } finally { soltar?.(); }
      },
    },
  });
  return values;
}

const credencial = () => `mock-google-credential-${crypto.randomUUID()}`;

async function par() {
  const { nuevoVerifier, challengeDe } = await import('../googleRedirectInicio');
  const verifier = nuevoVerifier();
  return { verifier, challenge: await challengeDe(verifier) };
}

async function rechazo(p: Promise<unknown>) {
  try { await p; } catch (e) { return { status: (e as { status: number }).status, error: (e as Error).message }; }
  throw new Error('se esperaba un rechazo');
}

const codigoDe = (fragmento: string) => /^google_(?:redirect|signup)=([A-Za-z0-9_-]+)$/.exec(fragmento)![1]!;

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('🔴 D268 · «Entrar»: el canje atado al challenge', () => {
  it('con `entrar:<challenge>`: sólo canjea quien tiene el verifier', async () => {
    storage();
    const m = await import('./mockApi');
    const { verifier, challenge } = await par();
    const codigo = codigoDe(await m.mockGoogleRedirectLoginUri(credencial(), `entrar:${challenge}`));
    // Sin verifier, o con otro: el 401 opaco, y el código sigue vivo para su dueño.
    expect(await rechazo(m.mockGoogleRedirectRedeem(codigo))).toEqual({ status: 401, error: 'social_auth_failed' });
    expect(await rechazo(m.mockGoogleRedirectRedeem(codigo, (await par()).verifier))).toEqual({ status: 401, error: 'social_auth_failed' });
    expect(await rechazo(m.mockGoogleRedirectRedeem(codigo, 'corto'))).toEqual({ status: 401, error: 'social_auth_failed' });
    expect(await rechazo(m.mockGoogleRedirectRedeem(codigo, 'x'.repeat(257)))).toMatchObject({ status: 400 });
    expect(await rechazo(m.mockGoogleRedirectRedeem(codigo, 7 as unknown as string))).toMatchObject({ status: 400 });
    await expect(m.mockGoogleRedirectRedeem(codigo, verifier)).resolves.toBeTruthy();
    // Un solo uso.
    expect(await rechazo(m.mockGoogleRedirectRedeem(codigo, verifier))).toEqual({ status: 401, error: 'social_auth_failed' });
  });

  it('sin state (un dueño anterior, o un código ajeno): suelto; con verifier no se encuentra', async () => {
    storage();
    const m = await import('./mockApi');
    const codigo = codigoDe(await m.mockGoogleRedirectLoginUri(credencial()));
    expect(await rechazo(m.mockGoogleRedirectRedeem(codigo, (await par()).verifier))).toEqual({ status: 401, error: 'social_auth_failed' });
    await expect(m.mockGoogleRedirectRedeem(codigo)).resolves.toBeTruthy();
  });

  it('la capacidad: se publica por defecto y la costura la apaga', async () => {
    storage();
    const m = await import('./mockApi');
    expect((await m.mockGetConfig()).features.google_redirect_binding).toEqual({ supported: true });
    vi.resetModules();
    storage({ 'payme.app.mock.google_redirect_binding.v1': 'apagado' });
    const m2 = await import('./mockApi');
    expect('google_redirect_binding' in (await m2.mockGetConfig()).features).toBe(false);
  });
});

describe('🔴 D268 · «Crea tu cuenta»: `crear:<challenge>`', () => {
  it('con el verifier equivocado, o sin él: 401, sin gastar el código; con el suyo, entra', async () => {
    // Una cuenta que ya existe: el canje bueno termina en sesión (`created: false`), sin depender del alta pública.
    storage();
    const m = await import('./mockApi');
    const { verifier, challenge } = await par();
    const codigo = codigoDe(await m.mockGoogleRedirectSignupLoginUri(credencial(), `crear:${challenge}`));
    const pedido = { code: codigo, accepted_notice_version: m.MOCK_AVISO_VERSION };
    expect(await rechazo(m.mockGoogleRedirectSignup(pedido))).toEqual({ status: 401, error: 'social_auth_failed' });
    expect(await rechazo(m.mockGoogleRedirectSignup({ ...pedido, verifier: (await par()).verifier })))
      .toEqual({ status: 401, error: 'social_auth_failed' });
    await expect(m.mockGoogleRedirectSignup({ ...pedido, verifier })).resolves.toMatchObject({ created: false });
  });

  it('con `alta:<id>` (sin binding): suelto, como antes', async () => {
    storage();
    const m = await import('./mockApi');
    const codigo = codigoDe(await m.mockGoogleRedirectSignupLoginUri(credencial(), `alta:${crypto.randomUUID()}`));
    expect(await rechazo(m.mockGoogleRedirectSignup({ code: codigo, accepted_notice_version: m.MOCK_AVISO_VERSION, verifier: (await par()).verifier })))
      .toEqual({ status: 401, error: 'social_auth_failed' });
  });
});
