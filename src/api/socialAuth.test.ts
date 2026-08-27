import { beforeEach, describe, expect, it, vi } from 'vitest';

const getConfig = vi.fn<() => Promise<unknown>>();
vi.mock('./index', () => ({ api: { getConfig } }));

const {
  ensureSocialAuthCapability,
  readSocialAuthCapability,
  resetSocialAuthForTests,
  socialAuthSnapshot,
} = await import('./socialAuth');

const OFF = {
  google_sign_in: {
    enabled: false,
    registration: false,
    login: false,
    linking: false,
    web_client_id: null,
  },
  facebook_sign_in: {
    enabled: false,
    registration: false,
    login: false,
    app_id: null,
    redirect_uri: null,
  },
  recovery_email: { enabled: false, completion_route: null },
  password_login: { enabled: true },
} as const;

const BIRTH_READY = {
  supported: true,
  registration_required: false,
  write_once: true,
  adulthood_server_authoritative: true,
} as const;

function config(social: unknown = OFF, birth: unknown = BIRTH_READY) {
  return { features: { social_auth: social, account_birth_date: birth } };
}

function googleEnabled(registration: boolean) {
  return {
    ...OFF,
    google_sign_in: {
      enabled: true,
      registration,
      login: true,
      linking: true,
      web_client_id: 'google-web-client-id',
    },
  };
}

function recoveryEnabled<T extends Record<string, unknown>>(social: T): T {
  return {
    ...social,
    recovery_email: { enabled: true, completion_route: '#/recovery' },
  };
}

beforeEach(() => {
  getConfig.mockReset();
  resetSocialAuthForTests();
});

describe('social auth capability · fail-closed con password preservado', () => {
  it.each([
    ['config inválida', null],
    ['features ausentes', {}],
    ['social ausente', { features: {} }],
    ['social null', config(null)],
    ['social array', config([])],
    ['clave extra', config({ ...OFF, telemetry: true })],
    ['password false', config({ ...OFF, password_login: { enabled: false } })],
    ['booleano serializado', config({
      ...OFF,
      google_sign_in: { ...OFF.google_sign_in, enabled: 'false' },
    })],
  ])('%s apaga superficies nuevas y nunca oculta password', (_name, payload) => {
    const state = readSocialAuthCapability(payload);
    expect(state.google.enabled).toBe(false);
    expect(state.facebook.enabled).toBe(false);
    expect(state.recovery.enabled).toBe(false);
    expect(state.passwordLoginEnabled).toBe(true);
    expect(['absent', 'malformed']).toContain(state.status);
  });

  it('acepta el shape autoritativo all-off', () => {
    expect(readSocialAuthCapability(config())).toMatchObject({
      status: 'authoritative',
      google: { enabled: false, registration: false, login: false },
      facebook: { enabled: false, registration: false, login: false },
      recovery: { enabled: false },
      passwordLoginEnabled: true,
    });
  });

  it('Google login/link pueden seguir ON sin recovery cuando registration está OFF', () => {
    expect(readSocialAuthCapability(config(googleEnabled(false)))).toMatchObject({
      status: 'authoritative',
      google: { enabled: true, registration: false, login: true, linking: true },
      recovery: { enabled: false },
      passwordLoginEnabled: true,
    });
  });

  it.each([
    ['Google', googleEnabled(true)],
    ['Facebook', {
      ...OFF,
      facebook_sign_in: {
        enabled: true,
        registration: true,
        login: true,
        app_id: '1234567890',
        redirect_uri: 'https://app.paymemx.com/',
      },
    }],
  ])('%s registration ON sin recovery invalida todo social', (_provider, social) => {
    const state = readSocialAuthCapability(config(social));
    expect(state).toMatchObject({
      status: 'malformed',
      google: { enabled: false },
      facebook: { enabled: false },
      recovery: { enabled: false },
      passwordLoginEnabled: true,
    });
  });

  it('birth gate sólo cierra registration; no cierra login ni password', () => {
    const social = recoveryEnabled(googleEnabled(true));
    const absent = readSocialAuthCapability(config(social, null));
    expect(absent.status).toBe('authoritative');
    expect(absent.google).toMatchObject({ enabled: true, login: true, registration: false });
    expect(absent.passwordLoginEnabled).toBe(true);

    const ready = readSocialAuthCapability(config(social));
    expect(ready.google.registration).toBe(true);
    expect(ready.socialRegistrationBirthDateReady).toBe(true);
  });
});

describe('loader de capability · caída de red reintentable', () => {
  it('mantiene estado seguro pending y una segunda ensure vuelve a pedir config', async () => {
    getConfig
      .mockRejectedValueOnce(new Error('network_down'))
      .mockResolvedValueOnce(config());

    await ensureSocialAuthCapability();
    expect(socialAuthSnapshot()).toMatchObject({
      status: 'pending',
      google: { enabled: false },
      facebook: { enabled: false },
      recovery: { enabled: false },
      passwordLoginEnabled: true,
    });
    expect(getConfig).toHaveBeenCalledTimes(1);

    await ensureSocialAuthCapability();
    expect(getConfig).toHaveBeenCalledTimes(2);
    expect(socialAuthSnapshot().status).toBe('authoritative');
  });

  it('dos ensure concurrentes comparten una sola request', async () => {
    let release: ((value: unknown) => void) | undefined;
    getConfig.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const first = ensureSocialAuthCapability();
    const second = ensureSocialAuthCapability();
    await vi.waitFor(() => { expect(getConfig).toHaveBeenCalledTimes(1); });
    release?.(config());
    await Promise.all([first, second]);
    expect(socialAuthSnapshot().status).toBe('authoritative');
  });
});
