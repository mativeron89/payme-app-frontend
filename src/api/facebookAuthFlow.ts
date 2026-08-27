import type {
  FacebookCompleteRequest,
  FacebookPurpose,
  FacebookStartResponse,
} from './types';
import type { FacebookSocialCapability } from './socialAuth';
import {
  assertSessionStateWitness,
  type SessionStateWitness,
  type StoredSession,
} from './storage';

const STORAGE_VERSION = 1;
const DESTROYED_CUSTODY_SENTINEL = '{"v":1,"status":"destroyed"}';
export const FACEBOOK_FLOW_STORAGE_KEY = import.meta.env.VITE_MOCK === '1'
  ? 'payme.app.mock.facebook_flow.v1'
  : 'payme.app.real.facebook_flow.v1';

interface FacebookCustody {
  readonly v: 1;
  readonly purpose: FacebookPurpose;
  readonly state: string;
  readonly expires_at: string;
  readonly session_state_witness: SessionStateWitness;
}

export type FacebookCallbackCapture =
  | { status: 'absent' | 'invalid' | 'blocked' | 'expired' | 'mismatch' }
  | { status: 'ready'; purpose: FacebookPurpose }
  | { status: 'consumed' };

let callbackCapture: FacebookCallbackCapture = { status: 'absent' };
interface PrivateFacebookCallback {
  readonly generation: number;
  readonly purpose: FacebookPurpose;
  readonly state: string;
  readonly code: string;
  readonly expiresAt: string;
  readonly sessionStateWitness: SessionStateWitness;
}

let privateCallback: PrivateFacebookCallback | null = null;
let generation = 0;
let completionInFlight: { generation: number; promise: Promise<StoredSession> } | null = null;

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

function validState(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 20 && value.length <= 200;
}

function validCode(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 4096;
}

function validSessionStateWitness(value: unknown): value is SessionStateWitness {
  return typeof value === 'string' && value.length > 0 && value.length <= 65_536;
}

function canonicalFutureIso(value: unknown, now = Date.now()): value is string {
  if (typeof value !== 'string' || value.length > 64) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > now && new Date(parsed).toISOString() === value;
}

function canonicalIso(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 64) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function storage(): Storage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function clearCustodyVerified(): boolean {
  const target = storage();
  if (!target) return false;
  try {
    target.removeItem(FACEBOOK_FLOW_STORAGE_KEY);
    if (target.getItem(FACEBOOK_FLOW_STORAGE_KEY) === null) return true;
  } catch {
    // `removeItem` bloqueado no autoriza conservar state crudo: se intenta
    // destruirlo por overwrite con un sentinel fijo que no contiene secreto.
  }
  try {
    target.setItem(FACEBOOK_FLOW_STORAGE_KEY, DESTROYED_CUSTODY_SENTINEL);
    return target.getItem(FACEBOOK_FLOW_STORAGE_KEY) === DESTROYED_CUSTODY_SENTINEL;
  } catch {
    return false;
  }
}

type CustodyInspection =
  | { status: 'absent' | 'invalid' | 'blocked' }
  | { status: 'valid'; value: FacebookCustody };

function inspectCustody(): CustodyInspection {
  let raw: string | null = null;
  try {
    const target = storage();
    if (!target) return { status: 'blocked' };
    raw = target.getItem(FACEBOOK_FLOW_STORAGE_KEY);
  } catch {
    return { status: 'blocked' };
  }
  if (raw === null) return { status: 'absent' };
  try {
    const value: unknown = JSON.parse(raw);
    if (!plainObject(value)
        || !exactKeys(value, ['expires_at', 'purpose', 'session_state_witness', 'state', 'v'])
        || value.v !== STORAGE_VERSION
        || (value.purpose !== 'login' && value.purpose !== 'register')
        || !validState(value.state)
        || !validSessionStateWitness(value.session_state_witness)
        || !canonicalIso(value.expires_at)) throw new Error('shape');
    return { status: 'valid', value: value as unknown as FacebookCustody };
  } catch {
    return { status: 'invalid' };
  }
}

function rememberCustody(value: FacebookCustody): boolean {
  const raw = JSON.stringify(value);
  try {
    const target = storage();
    if (!target) return false;
    target.setItem(FACEBOOK_FLOW_STORAGE_KEY, raw);
    const read = inspectCustody();
    return read.status === 'valid'
      && read.value.purpose === value.purpose
      && read.value.state === value.state
      && read.value.expires_at === value.expires_at
      && read.value.session_state_witness === value.session_state_witness;
  } catch {
    clearCustodyVerified();
    return false;
  }
}

function singleton(params: URLSearchParams, key: string): string | null {
  const values = params.getAll(key);
  return values.length === 1 ? values[0] ?? null : null;
}

/** Valida el shape base antes de que la URL pueda entrar a custodia. */
export function decodeFacebookStartResponse(value: unknown): FacebookStartResponse {
  if (!plainObject(value)
      || !exactKeys(value, ['authorization_url', 'expires_at'])
      || typeof value.authorization_url !== 'string'
      || value.authorization_url.length < 10
      || value.authorization_url.length > 4096
      || !canonicalFutureIso(value.expires_at)) throw new Error('facebook_start_response_malformed');
  return { authorization_url: value.authorization_url, expires_at: value.expires_at };
}

function validAuthorizationUrl(
  raw: string,
  capability: FacebookSocialCapability,
): { url: URL; state: string } | null {
  if (!capability.enabled || !capability.appId || !capability.redirectUri) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.hostname !== 'www.facebook.com'
        || url.username || url.password || url.port || url.hash
        || !/^\/v[0-9]+\.[0-9]+\/dialog\/oauth\/?$/.test(url.pathname)) return null;
    const keys = [...url.searchParams.keys()].sort();
    const expected = ['client_id', 'redirect_uri', 'response_type', 'state'];
    if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) return null;
    const clientId = singleton(url.searchParams, 'client_id');
    const redirectUri = singleton(url.searchParams, 'redirect_uri');
    const responseType = singleton(url.searchParams, 'response_type');
    const state = singleton(url.searchParams, 'state');
    if (clientId !== capability.appId || redirectUri !== capability.redirectUri
        || responseType !== 'code' || !validState(state)) return null;
    return { url, state };
  } catch {
    return null;
  }
}

/** Guarda state/purpose/expiry con round-trip antes de entregar la URL. */
export function prepareFacebookRedirect(
  response: FacebookStartResponse,
  purpose: FacebookPurpose,
  capability: FacebookSocialCapability,
  expectedStateWitness: SessionStateWitness,
): string {
  const purposeEnabled = purpose === 'login' ? capability.login : capability.registration;
  const valid = validAuthorizationUrl(response.authorization_url, capability);
  if (!purposeEnabled || !valid || !canonicalFutureIso(response.expires_at)) {
    clearCustodyVerified();
    throw new Error('facebook_start_response_malformed');
  }
  // El testigo se captura ANTES del request /start. Si una sesión cambió
  // mientras el owner armaba la URL, ni siquiera se inicia el redirect.
  assertSessionStateWitness(expectedStateWitness);
  const record: FacebookCustody = {
    v: STORAGE_VERSION,
    purpose,
    state: valid.state,
    expires_at: response.expires_at,
    session_state_witness: expectedStateWitness,
  };
  if (!rememberCustody(record)) {
    clearCustodyVerified();
    throw new Error('facebook_session_storage_unavailable');
  }
  return valid.url.toString();
}

function stripCallbackFromUrl(): boolean {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  if (!params.has('code') && !params.has('state')) return true;
  params.delete('code');
  params.delete('state');
  const next = params.toString();
  try {
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${next ? `?${next}` : ''}${window.location.hash}`,
    );
    const after = new URLSearchParams(window.location.search);
    return !after.has('code') && !after.has('state');
  } catch {
    return false;
  }
}

/** Captura y limpia antes de React; sólo el registro local decide purpose. */
export function captureFacebookCallback(now = Date.now()): FacebookCallbackCapture {
  const currentGeneration = ++generation;
  privateCallback = null;
  if (typeof window === 'undefined') {
    callbackCapture = { status: 'absent' };
    return callbackCapture;
  }
  const params = new URLSearchParams(window.location.search);
  const hasCode = params.has('code');
  const hasState = params.has('state');
  if (!hasCode && !hasState) {
    const custody = inspectCustody();
    if (custody.status === 'absent') {
      callbackCapture = { status: 'absent' };
    } else if (custody.status === 'valid' && Date.parse(custody.value.expires_at) > now) {
      // Intención pendiente: debe sobrevivir hasta que vuelva el redirect.
      callbackCapture = { status: 'absent' };
    } else {
      const cleaned = clearCustodyVerified();
      if (!cleaned) callbackCapture = { status: 'blocked' };
      else if (custody.status === 'valid') callbackCapture = { status: 'expired' };
      else callbackCapture = { status: 'invalid' };
    }
    return callbackCapture;
  }

  const code = singleton(params, 'code');
  const state = singleton(params, 'state');
  const urlClean = stripCallbackFromUrl();
  const custody = inspectCustody();
  const storageClean = clearCustodyVerified();
  if (!urlClean || !storageClean) {
    callbackCapture = { status: 'blocked' };
  } else if (!validCode(code) || !validState(state) || custody.status !== 'valid') {
    callbackCapture = { status: 'invalid' };
  } else if (Date.parse(custody.value.expires_at) <= now) {
    callbackCapture = { status: 'expired' };
  } else if (custody.value.state !== state) {
    callbackCapture = { status: 'mismatch' };
  } else {
    privateCallback = {
      generation: currentGeneration,
      purpose: custody.value.purpose,
      state,
      code,
      expiresAt: custody.value.expires_at,
      sessionStateWitness: custody.value.session_state_witness,
    };
    callbackCapture = { status: 'ready', purpose: custody.value.purpose };
  }
  return callbackCapture;
}

export function facebookCallbackSnapshot(): FacebookCallbackCapture {
  return callbackCapture;
}

/**
 * Bootstrap pre-React. Sólo la presencia de las keys se observa antes de
 * limpiar; nunca se extraen sus valores acá. Storage bloqueado sin callback
 * apaga Facebook, pero no puede derribar el login por contraseña.
 */
export function bootstrapFacebookCallbackCapture(): FacebookCallbackCapture {
  const hadCallback = typeof window !== 'undefined' && (() => {
    const params = new URLSearchParams(window.location.search);
    return params.has('code') || params.has('state');
  })();
  const capture = captureFacebookCallback();
  if (hadCallback && capture.status === 'blocked') {
    throw new Error('facebook_callback_cleanup_failed');
  }
  return capture;
}

/** StrictMode comparte esta promise; ningún segundo effect vuelve a canjear. */
export function completeFacebookCallbackOnce(
  complete: (
    purpose: FacebookPurpose,
    request: FacebookCompleteRequest,
    expectedStateWitness: SessionStateWitness,
  ) => Promise<StoredSession>,
  now = Date.now(),
): Promise<StoredSession | null> {
  const currentGeneration = generation;
  if (completionInFlight?.generation === currentGeneration) {
    return completionInFlight.promise;
  }
  const ready = privateCallback;
  if (callbackCapture.status === 'absent' || callbackCapture.status === 'consumed') {
    return Promise.resolve(null);
  }
  if (callbackCapture.status !== 'ready' || !ready
      || ready.generation !== currentGeneration || Date.parse(ready.expiresAt) <= now) {
    callbackCapture = { status: 'consumed' };
    privateCallback = null;
    return Promise.reject(new Error('facebook_callback_invalid'));
  }
  callbackCapture = { status: 'consumed' };
  privateCallback = null;
  // Primera compuerta antes de red. La segunda vive en la persistencia de la
  // respuesta y usa el mismo testigo, cerrando un cambio durante el canje.
  let promise: Promise<StoredSession>;
  try {
    assertSessionStateWitness(ready.sessionStateWitness);
    promise = complete(
      ready.purpose,
      { state: ready.state, code: ready.code },
      ready.sessionStateWitness,
    );
  } catch (error) {
    promise = Promise.reject(error);
  }
  completionInFlight = { generation: currentGeneration, promise };
  return promise;
}

/** El mock atraviesa la misma captura sin abrir Meta ni dejar raw en la URL. */
export function simulateFacebookCallbackForMock(response: FacebookStartResponse): void {
  if (import.meta.env.VITE_MOCK !== '1' || typeof window === 'undefined') {
    throw new Error('facebook_mock_callback_forbidden');
  }
  const source = new URL(response.authorization_url);
  const state = singleton(source.searchParams, 'state');
  if (!validState(state)) throw new Error('facebook_start_response_malformed');
  const current = new URL(window.location.href);
  current.searchParams.set('code', `mock-code-${crypto.randomUUID()}`);
  current.searchParams.set('state', state);
  window.history.replaceState(window.history.state, '', `${current.pathname}${current.search}${current.hash}`);
  captureFacebookCallback();
}

export function resetFacebookFlowForTests(): void {
  clearCustodyVerified();
  callbackCapture = { status: 'absent' };
  privateCallback = null;
  generation = 0;
  completionInFlight = null;
}
