import { useEffect, useSyncExternalStore } from 'react';
import type { AppConfig, SocialSessionResponse } from './types';

export type SocialAuthStatus = 'pending' | 'authoritative' | 'absent' | 'malformed';

export interface GoogleSocialCapability {
  readonly enabled: boolean;
  readonly registration: boolean;
  readonly login: boolean;
  readonly linking: boolean;
  readonly webClientId: string | null;
}

export interface FacebookSocialCapability {
  readonly enabled: boolean;
  readonly registration: boolean;
  readonly login: boolean;
  readonly appId: string | null;
  readonly redirectUri: string | null;
}

export interface RecoverySocialCapability {
  readonly enabled: boolean;
  readonly completionRoute: '#/recovery' | null;
}

export interface SocialAuthState {
  readonly status: SocialAuthStatus;
  readonly google: GoogleSocialCapability;
  readonly facebook: FacebookSocialCapability;
  readonly recovery: RecoverySocialCapability;
  /** Nunca falla a false: un backend viejo debe conservar el ingreso existente. */
  readonly passwordLoginEnabled: true;
  /** El slice no captura birth_date; sólo false autoritativo permite alta social. */
  readonly socialRegistrationBirthDateReady: boolean;
  /**
   * C2b · ¿el dueño abrió el alta sin invitación? **Fail-closed a `false`.**
   *
   * Se decodifica del bloque HERMANO `features.signup`, no de `social_auth`, y
   * por eso su ausencia no degrada a Google ni al login: un backend anterior a
   * C2b simplemente no manda la clave. El contrato lo fija con esas palabras
   * (`contract-mirror/contract/social-auth-v1.json` → `signup_gate.capability_publicada`):
   * `absent_means` y `unknown_or_malformed_means` = **alta CERRADA**, o sea
   * «pedir invitación», nunca «apagar el resto».
   *
   * 🔴 **Y la dirección del fail-closed acá es una sola.** En este módulo hay
   * campos que fallan hacia «no ocultar» —`passwordLoginEnabled`, porque apagar
   * un ingreso que ya existe es una regresión—. Éste es al revés: abrir el alta
   * por un contrato que no se entendió crearía cuentas sin la autoridad que el
   * dueño exige. Ante cualquier duda, cerrada.
   *
   * ⚠️ **No se infiere probando el alta y leyendo el 403**, que es justo el
   * oráculo que la antienumeración evita; el contrato lo dice explícito en
   * `signup_gate.capability_publicada.por_que`.
   */
  readonly publicRegistration: boolean;
}

const GOOGLE_OFF: GoogleSocialCapability = {
  enabled: false,
  registration: false,
  login: false,
  linking: false,
  webClientId: null,
};

const FACEBOOK_OFF: FacebookSocialCapability = {
  enabled: false,
  registration: false,
  login: false,
  appId: null,
  redirectUri: null,
};

const RECOVERY_OFF: RecoverySocialCapability = { enabled: false, completionRoute: null };

function closed(status: SocialAuthStatus): SocialAuthState {
  return {
    status,
    google: GOOGLE_OFF,
    facebook: FACEBOOK_OFF,
    recovery: RECOVERY_OFF,
    passwordLoginEnabled: true,
    socialRegistrationBirthDateReady: false,
    publicRegistration: false,
  };
}

const PENDING = closed('pending');

function plainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum;
}

function validRedirectUri(value: unknown): value is string {
  if (!boundedString(value, 2048)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname === 'app.paymemx.com'
      && !url.username
      && !url.password
      && !url.port
      && !url.search
      && !url.hash;
  } catch {
    return false;
  }
}

const GOOGLE_KEYS = ['enabled', 'registration', 'login', 'linking', 'web_client_id'] as const;
const FACEBOOK_KEYS = ['enabled', 'registration', 'login', 'app_id', 'redirect_uri'] as const;
const RECOVERY_KEYS = ['enabled', 'completion_route'] as const;
const PASSWORD_KEYS = ['enabled'] as const;
const SOCIAL_KEYS = ['facebook_sign_in', 'google_sign_in', 'password_login', 'recovery_email'] as const;
const BIRTH_KEYS = [
  'adulthood_server_authoritative',
  'registration_required',
  'supported',
  'write_once',
] as const;

function decodeGoogle(raw: unknown): Omit<GoogleSocialCapability, 'registration'> & { ownerRegistration: boolean } | null {
  if (!plainObject(raw) || !exactKeys(raw, GOOGLE_KEYS)
      || typeof raw.enabled !== 'boolean'
      || typeof raw.registration !== 'boolean'
      || typeof raw.login !== 'boolean'
      || typeof raw.linking !== 'boolean') return null;
  if (raw.enabled === false) {
    return raw.registration === false && raw.login === false && raw.linking === false
      && raw.web_client_id === null
      ? { ...GOOGLE_OFF, ownerRegistration: false }
      : null;
  }
  if (raw.login !== true || raw.linking !== true
      || typeof raw.web_client_id !== 'string'
      || !/^[A-Za-z0-9._:-]{3,200}$/.test(raw.web_client_id)) return null;
  return {
    enabled: true,
    login: true,
    linking: true,
    webClientId: raw.web_client_id,
    ownerRegistration: raw.registration,
  };
}

function decodeFacebook(raw: unknown): Omit<FacebookSocialCapability, 'registration'> & { ownerRegistration: boolean } | null {
  if (!plainObject(raw) || !exactKeys(raw, FACEBOOK_KEYS)
      || typeof raw.enabled !== 'boolean'
      || typeof raw.registration !== 'boolean'
      || typeof raw.login !== 'boolean') return null;
  if (raw.enabled === false) {
    return raw.registration === false && raw.login === false
      && raw.app_id === null && raw.redirect_uri === null
      ? { ...FACEBOOK_OFF, ownerRegistration: false }
      : null;
  }
  if (raw.registration !== true || raw.login !== true
      || typeof raw.app_id !== 'string' || !/^[0-9]{5,32}$/.test(raw.app_id)
      || !validRedirectUri(raw.redirect_uri)) return null;
  return {
    enabled: true,
    login: true,
    appId: raw.app_id,
    redirectUri: raw.redirect_uri,
    ownerRegistration: true,
  };
}

function decodeRecovery(raw: unknown): RecoverySocialCapability | null {
  if (!plainObject(raw) || !exactKeys(raw, RECOVERY_KEYS) || typeof raw.enabled !== 'boolean') return null;
  if (raw.enabled === false) return raw.completion_route === null ? RECOVERY_OFF : null;
  return raw.completion_route === '#/recovery'
    ? { enabled: true, completionRoute: '#/recovery' }
    : null;
}

/** Las DOS claves exactas que publica el dueño. Cerrado como sus vecinos. */
const SIGNUP_KEYS = ['public_registration', 'supported'] as const;

/**
 * `features.signup` → ¿alta sin invitación? Una clave de más, un tipo que no es
 * booleano o `supported !== true` dejan el alta CERRADA. `supported` se exige
 * explícito y no por presencia, igual que en `account_birth_date`.
 */
function decodeSignup(raw: unknown): boolean {
  if (!plainObject(raw) || !exactKeys(raw, SIGNUP_KEYS)) return false;
  return raw.supported === true && raw.public_registration === true;
}

function birthDateAllowsSocialRegistration(raw: unknown): boolean {
  return plainObject(raw)
    && exactKeys(raw, BIRTH_KEYS)
    && raw.supported === true
    && raw.registration_required === false
    && raw.write_once === true
    && raw.adulthood_server_authoritative === true;
}

/** Decodifica toda la capability como conjunto cerrado y conserva password. */
export function readSocialAuthCapability(config: unknown): SocialAuthState {
  if (!plainObject(config)) return closed('malformed');
  const features = (config as Partial<AppConfig>).features;
  if (!plainObject(features)) return closed('malformed');
  const raw = features.social_auth;
  if (raw === undefined) return closed('absent');
  if (!plainObject(raw) || !exactKeys(raw, SOCIAL_KEYS)) return closed('malformed');

  const google = decodeGoogle(raw.google_sign_in);
  const facebook = decodeFacebook(raw.facebook_sign_in);
  const recovery = decodeRecovery(raw.recovery_email);
  const password = raw.password_login;
  if (!google || !facebook || !recovery
      || !plainObject(password) || !exactKeys(password, PASSWORD_KEYS)
      || password.enabled !== true) return closed('malformed');
  // El owner exige recovery operativo antes de emitir una alta social. Una
  // contradicción no se degrada a "sólo login": invalida el bloque completo.
  if ((google.ownerRegistration || facebook.ownerRegistration) && !recovery.enabled) {
    return closed('malformed');
  }

  const birthReady = birthDateAllowsSocialRegistration(features.account_birth_date);
  return {
    status: 'authoritative',
    google: {
      enabled: google.enabled,
      registration: google.ownerRegistration && birthReady,
      login: google.login,
      linking: google.linking,
      webClientId: google.webClientId,
    },
    facebook: {
      enabled: facebook.enabled,
      registration: facebook.ownerRegistration && birthReady,
      login: facebook.login,
      appId: facebook.appId,
      redirectUri: facebook.redirectUri,
    },
    recovery,
    passwordLoginEnabled: true,
    socialRegistrationBirthDateReady: birthReady,
    publicRegistration: decodeSignup(features.signup),
  };
}

/** Valida el 2xx social antes de crear cualquier sesión o tocar storage. */
export function decodeSocialSessionResponse(value: unknown): SocialSessionResponse {
  if (!plainObject(value)
      || !exactKeys(value, ['access_token', 'expires_in', 'refresh_token', 'user'])
      || !boundedString(value.access_token, 65_536)
      || !boundedString(value.refresh_token, 65_536)
      || !Number.isSafeInteger(value.expires_in)
      || (value.expires_in as number) <= 0
      || !plainObject(value.user)
      || !exactKeys(value.user, ['email', 'first_name', 'id', 'last_name', 'payme_id'])) {
    throw new Error('social_session_response_malformed');
  }
  const user = value.user;
  if (!boundedString(user.id, 200)
      || !boundedString(user.payme_id, 200)
      || !boundedString(user.email, 320)
      || !boundedString(user.first_name, 100)
      || typeof user.last_name !== 'string'
      || user.last_name.length > 100) throw new Error('social_session_response_malformed');
  return {
    access_token: value.access_token,
    refresh_token: value.refresh_token,
    expires_in: value.expires_in as number,
    user: {
      id: user.id,
      payme_id: user.payme_id,
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
    },
  };
}

let state: SocialAuthState = PENDING;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

export function socialAuthSnapshot(): SocialAuthState {
  return state;
}

export function subscribeSocialAuth(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function applySocialAuthConfig(config: unknown): SocialAuthState {
  state = readSocialAuthCapability(config);
  for (const listener of [...listeners]) listener();
  return state;
}

export function resetSocialAuthForTests(): void {
  state = PENDING;
  inFlight = null;
  for (const listener of [...listeners]) listener();
}

export function ensureSocialAuthCapability(): Promise<void> {
  if (state.status !== 'pending') return Promise.resolve();
  if (!inFlight) {
    inFlight = import('./index')
      .then(({ api }) => api.getConfig())
      .then((config) => { applySocialAuthConfig(config); })
      .catch(() => {
        // `pending` ya es fail-closed, pero sigue siendo reintentable. Marcar
        // `malformed` confundiría una caída de red con un contrato inválido y
        // envenenaría el store para toda la carga.
        state = PENDING;
        for (const listener of [...listeners]) listener();
      })
      .finally(() => { inFlight = null; });
  }
  return inFlight;
}

export function useSocialAuthCapability(): SocialAuthState {
  useEffect(() => { void ensureSocialAuthCapability(); }, []);
  return useSyncExternalStore(subscribeSocialAuth, socialAuthSnapshot, socialAuthSnapshot);
}
