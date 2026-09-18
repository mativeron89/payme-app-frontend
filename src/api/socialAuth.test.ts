import { beforeEach, describe, expect, it, vi } from 'vitest';

const getConfig = vi.fn<() => Promise<unknown>>();
vi.mock('./index', () => ({ api: { getConfig } }));

const {
  decodeGoogleLinkResponse,
  decodeLinkedProvidersResponse,
  ensureSocialAuthCapability,
  readSocialAuthCapability,
  decodeGoogleContinueResponse,
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

/**
 * C2b · alta pública. `GET /api/config` publica `features.signup` como bloque
 * HERMANO de `social_auth`, con dos claves exactas (`contract-mirror/routes/config.js:142-149`).
 *
 * 🔴 **Se decodifica aparte y NO degrada al resto del social, a propósito.** Un
 * backend anterior a C2b no manda `signup`; fundirlo con `social_auth` haría que
 * su ausencia apagara Google y el login, que es una regresión y no lo que el
 * contrato pide. `signup_gate.capability_publicada` dice exactamente qué
 * significa cada caso: `absent_means` y `unknown_or_malformed_means` = **alta
 * CERRADA**, o sea «pedir invitación», no «apagar todo».
 *
 * Y la dirección del fail-closed acá es una sola: **cerrada**. Abrir el alta por
 * un contrato que no se entendió sería crear cuentas sin la autoridad que el
 * dueño exige.
 */
describe('C2b · capability de alta pública · fail-closed a CERRADA, sin degradar el resto', () => {
  function conSignup(signup: unknown) {
    return { features: { social_auth: OFF, account_birth_date: BIRTH_READY, signup } };
  }

  it('la forma exacta del dueño con true habilita el alta pública', () => {
    const estado = readSocialAuthCapability(conSignup({ supported: true, public_registration: true }));
    expect(estado.status).toBe('authoritative');
    expect(estado.publicRegistration).toBe(true);
  });

  it('con public_registration false queda cerrada', () => {
    expect(readSocialAuthCapability(conSignup({ supported: true, public_registration: false })).publicRegistration).toBe(false);
  });

  it('AUSENTE = backend anterior a C2b = cerrada, y el resto del social NO se degrada', () => {
    // `googleEnabled(false)` = login y linking ON, registration OFF: el shape
    // válido sin recovery que el bloque de arriba ya acredita.
    const sinSignup = readSocialAuthCapability(config(googleEnabled(false)));
    expect(sinSignup.publicRegistration).toBe(false);
    // La prueba de que no degrada: el bloque social sigue siendo autoritativo.
    expect(sinSignup.status).toBe('authoritative');
    expect(sinSignup.google.enabled).toBe(true);
  });

  it('una clave de más deja el alta cerrada y tampoco degrada el resto', () => {
    const extra = readSocialAuthCapability({
      features: {
        social_auth: googleEnabled(false),
        account_birth_date: BIRTH_READY,
        signup: { supported: true, public_registration: true, enabled_for_restaurant: true },
      },
    });
    expect(extra.publicRegistration).toBe(false);
    expect(extra.google.enabled).toBe(true);
  });

  it('un booleano que llega como string no abre el alta', () => {
    expect(readSocialAuthCapability(conSignup({ supported: true, public_registration: 'true' })).publicRegistration).toBe(false);
  });

  it('supported false cierra el alta aunque public_registration venga true', () => {
    expect(readSocialAuthCapability(conSignup({ supported: false, public_registration: true })).publicRegistration).toBe(false);
  });

  it('el estado cerrado inicial y el malformado global también dejan el alta cerrada', () => {
    expect(socialAuthSnapshot().publicRegistration).toBe(false);
    expect(readSocialAuthCapability(null).publicRegistration).toBe(false);
  });
});

/**
 * La decisión que este bloque FIJA, porque no es obvia: si `social_auth` viene
 * inválido, el alta pública queda cerrada aunque `signup` esté impecable.
 *
 * Es coherente con el módulo, que ya distingue dos direcciones: `password_login`
 * se conserva ante cualquier basura —apagar un ingreso existente es regresión—
 * y toda superficie NUEVA se apaga. El alta sin invitación es superficie nueva.
 */
describe('C2b · un config que no se entiende no abre el alta, y sí conserva el login', () => {
  it('social_auth malformado cierra el alta pública aunque signup sea válido', () => {
    const estado = readSocialAuthCapability({
      features: {
        social_auth: { google_sign_in: 'basura' },
        account_birth_date: BIRTH_READY,
        signup: { supported: true, public_registration: true },
      },
    });
    expect(estado.status).toBe('malformed');
    expect(estado.publicRegistration).toBe(false);
    expect(estado.passwordLoginEnabled).toBe(true);
  });
});

/**
 * AF-09 · los dos decoders de v2.91.0. Cada caso de rechazo es una forma que el
 * contrato NO declara; si pasara, la pantalla afirmaría algo que el dueño no dijo.
 */
describe('decodeLinkedProvidersResponse · GET /api/account/me/linked-providers', () => {
  it('acepta la forma del contrato: vacío, uno y los dos, ordenados', () => {
    expect(decodeLinkedProvidersResponse({ linked_providers: [] })).toEqual([]);
    expect(decodeLinkedProvidersResponse({ linked_providers: ['google'] })).toEqual(['google']);
    expect(decodeLinkedProvidersResponse({ linked_providers: ['facebook', 'google'] }))
      .toEqual(['facebook', 'google']);
  });

  it('🔴 rechaza toda forma que el contrato no declara', () => {
    const malas: unknown[] = [
      null,
      [],
      'google',
      {},
      { linked_providers: 'google' },
      { linked_providers: ['google'], extra: true },          // clave de más
      { linked_providers: ['apple'] },                        // fuera del vocabulario CERRADO
      { linked_providers: ['google', 'facebook'] },           // desordenado
      { linked_providers: ['google', 'google'] },             // repetido
      { linked_providers: [1] },
      { linked_providers: ['Google'] },                       // el vocabulario es exacto
    ];
    for (const mala of malas) {
      expect(() => decodeLinkedProvidersResponse(mala), JSON.stringify(mala))
        .toThrow('linked_providers_response_malformed');
    }
  });
});

describe('decodeGoogleLinkResponse · POST /api/auth/google/link', () => {
  it('devuelve si ya estaba vinculada, en los dos caminos del 200', () => {
    expect(decodeGoogleLinkResponse({ linked: true, provider: 'google', already_linked: false }))
      .toEqual({ alreadyLinked: false });
    expect(decodeGoogleLinkResponse({ linked: true, provider: 'google', already_linked: true }))
      .toEqual({ alreadyLinked: true });
  });

  it('🔴 un 200 que no es una vinculación de Google no se toma como una', () => {
    const malas: unknown[] = [
      { linked: false, provider: 'google', already_linked: false },
      { linked: true, provider: 'facebook', already_linked: false },
      { linked: true, provider: 'google' },                                 // backend anterior a v2.91.0
      { linked: true, provider: 'google', already_linked: 'no' },
      { linked: true, provider: 'google', already_linked: false, user: {} },
      null,
    ];
    for (const mala of malas) {
      expect(() => decodeGoogleLinkResponse(mala), JSON.stringify(mala))
        .toThrow('google_link_response_malformed');
    }
  });
});

describe('AF-17 · features.google_continue y la respuesta de continue', () => {
  const baseConfig = () => ({
    features: {
      social_auth: {
        google_sign_in: { enabled: true, registration: true, login: true, linking: true, web_client_id: 'cid-123' },
        facebook_sign_in: { enabled: false, registration: false, login: false, app_id: null, redirect_uri: null },
        recovery_email: { enabled: true, completion_route: '#/recovery' },
        password_login: { enabled: true },
      },
    } as Record<string, unknown>,
  });

  it('forma exacta del dueño ⇒ supported con su one_tap_signup', () => {
    const config = baseConfig();
    config.features.google_continue = { supported: true, one_tap_signup: true };
    expect(readSocialAuthCapability(config).googleContinue).toEqual({ supported: true, oneTapSignup: true });
    config.features.google_continue = { supported: true, one_tap_signup: false };
    expect(readSocialAuthCapability(config).googleContinue).toEqual({ supported: true, oneTapSignup: false });
  });

  it('🔴 ausente, con una clave de más o mal tipada ⇒ apagada, y el login con Google NO se apaga', () => {
    for (const raro of [undefined, {}, { supported: true }, { supported: 'true', one_tap_signup: true },
      { supported: true, one_tap_signup: true, extra: 1 }, { supported: false, one_tap_signup: true }]) {
      const config = baseConfig();
      if (raro !== undefined) config.features.google_continue = raro;
      const estado = readSocialAuthCapability(config);
      expect(estado.googleContinue).toEqual({ supported: false, oneTapSignup: false });
      expect(estado.status).toBe('authoritative');
      expect(estado.google.login).toBe(true);
    }
  });

  it('sin login con Google del dueño, continue no existe aunque se publique', () => {
    const config = baseConfig();
    (config.features.social_auth as { google_sign_in: Record<string, unknown> }).google_sign_in = {
      enabled: false, registration: false, login: false, linking: false, web_client_id: null,
    };
    config.features.google_continue = { supported: true, one_tap_signup: true };
    expect(readSocialAuthCapability(config).googleContinue.supported).toBe(false);
  });

  const sesion = {
    access_token: 'a'.repeat(30),
    refresh_token: 'r'.repeat(30),
    expires_in: 900,
    user: { id: 'u1', payme_id: 'p1', email: 'x@y.mx', first_name: 'Ana', last_name: 'Demo' },
  };

  it('continue: la sesión MÁS created, y nada más', () => {
    expect(decodeGoogleContinueResponse({ ...sesion, created: true }, 'continue').created).toBe(true);
    expect(decodeGoogleContinueResponse({ ...sesion, created: false }, 'continue').session.user.first_name).toBe('Ana');
    for (const malo of [sesion, { ...sesion, created: 'true' }, { ...sesion, created: false, linked: true },
      { ...sesion, created: false, otra: 1 }]) {
      expect(() => decodeGoogleContinueResponse(malo, 'continue')).toThrow();
    }
  });

  it('link: la sesión MÁS created:false y linked:true, y nada más', () => {
    expect(decodeGoogleContinueResponse({ ...sesion, created: false, linked: true }, 'link').created).toBe(false);
    for (const malo of [{ ...sesion, created: false }, { ...sesion, created: true, linked: true },
      { ...sesion, created: false, linked: false }]) {
      expect(() => decodeGoogleContinueResponse(malo, 'link')).toThrow();
    }
  });
});
