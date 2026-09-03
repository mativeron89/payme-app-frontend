import { useEffect, useSyncExternalStore } from 'react';
import type { AppConfig } from './types';

export type PrivateFeatureStatus = 'pending' | 'authoritative' | 'absent' | 'malformed' | 'notice_unavailable';

export interface PrivateFeatureState {
  readonly enabled: boolean;
  readonly status: PrivateFeatureStatus;
  readonly noticeVersion: string | null;
}

const PENDING: PrivateFeatureState = { enabled: false, status: 'pending', noticeVersion: null };
// Mati ratificó el 2026-08-25 el aviso 2.3.0 de producto real. La allowlist es
// exclusiva: 2.2.0 queda supersedido y una versión futura no hereda la
// decisión; ambas apagan las superficies hasta ser presentadas explícitamente.
//
// 2026-09-03: se PRESENTA 2.4.1 (etapa pública sin pagos). Se AGREGA, y acá
// agregar no es una preferencia de estilo: es lo único correcto, porque el
// dueño publica HOY versiones DISTINTAS en las dos capabilities que leen esta
// misma allowlist —medido en `9c5a7b14`, contenido `940cc49e`:
//
//     services/profileIdentity.js:33   notice_version: '2.4.1'
//     services/shortfallDetails.js:21  notice_version: '2.3.0'
//
// Reemplazar `'2.3.0'` por `'2.4.1'` apagaría `settlement_shortfall_detail`
// —el detalle de faltante en Avisos y sus dos métodos de fachada— sin que nadie
// lo pidiera. Y conservar 2.3.0 protege además del rollback: si el dueño
// volviera atrás, las superficies no se apagan por un retroceso del emisor.
const PRESENTABLE_NOTICE_VERSIONS = new Set<string>(['2.3.0', '2.4.1']);

/** Seam nominal: sólo Vitest puede declarar presentable `test-only`. */
export const TEST_PRESENTABLE_NOTICES = Symbol('private-feature-test-notice-seam');

function presentableVersions(testSeam?: symbol): ReadonlySet<string> {
  if (testSeam === TEST_PRESENTABLE_NOTICES && import.meta.env.MODE === 'test') {
    return new Set([...PRESENTABLE_NOTICE_VERSIONS, 'test-only']);
  }
  return PRESENTABLE_NOTICE_VERSIONS;
}

function plainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return keys.length === wanted.length && keys.every((key, index) => key === wanted[index]);
}

function boundedString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 100;
}

function nullableBoundedString(value: unknown): boolean {
  return value === null || boundedString(value);
}

function featureFromConfig(config: unknown, key: 'profile_identity' | 'settlement_shortfall_detail'): {
  raw: Record<string, unknown> | null;
  status: Exclude<PrivateFeatureStatus, 'pending'>;
} {
  if (!plainObject(config)) return { raw: null, status: 'malformed' };
  const features = (config as Partial<AppConfig>).features;
  if (!plainObject(features)) return { raw: null, status: 'malformed' };
  const raw = features[key];
  if (raw === undefined) return { raw: null, status: 'absent' };
  return plainObject(raw)
    ? { raw, status: 'authoritative' }
    : { raw: null, status: 'malformed' };
}

const PROFILE_KEYS = [
  'supported',
  'enabled',
  'notice_version',
  'notice_required',
  'activation_blocker',
  'payme_id_mutable',
  'avatar_public_url',
] as const;

/**
 * Decodifica la capability completa y cerrada del dueño. Una clave nueva no se
 * ignora: puede cambiar la semántica y por eso deja la superficie apagada.
 */
export function readProfileIdentityCapability(config: unknown, testSeam?: symbol): PrivateFeatureState {
  const candidate = featureFromConfig(config, 'profile_identity');
  if (!candidate.raw) return { enabled: false, status: candidate.status, noticeVersion: null };
  const raw = candidate.raw;
  const valid = exactKeys(raw, PROFILE_KEYS)
    && typeof raw.supported === 'boolean'
    && typeof raw.enabled === 'boolean'
    && nullableBoundedString(raw.notice_version)
    && raw.notice_required === true
    && nullableBoundedString(raw.activation_blocker)
    && raw.payme_id_mutable === false
    && raw.avatar_public_url === false;
  if (!valid) return { enabled: false, status: 'malformed', noticeVersion: null };
  if (raw.enabled === true
      && (raw.supported !== true || !boundedString(raw.notice_version)
        || raw.activation_blocker !== null)) {
    return { enabled: false, status: 'malformed', noticeVersion: null };
  }
  const noticeVersion = boundedString(raw.notice_version) ? raw.notice_version : null;
  if (raw.supported === true && raw.enabled === true
      && noticeVersion && !presentableVersions(testSeam).has(noticeVersion)) {
    return { enabled: false, status: 'notice_unavailable', noticeVersion };
  }
  return {
    enabled: raw.supported === true && raw.enabled === true,
    status: 'authoritative',
    noticeVersion,
  };
}

const SHORTFALL_KEYS = [
  'supported',
  'enabled',
  'version',
  'owner_only',
  'includes_tip',
  'notice_version',
  'notice_required',
  'activation_blocker',
] as const;

export function readShortfallDetailCapability(config: unknown, testSeam?: symbol): PrivateFeatureState {
  const candidate = featureFromConfig(config, 'settlement_shortfall_detail');
  if (!candidate.raw) return { enabled: false, status: candidate.status, noticeVersion: null };
  const raw = candidate.raw;
  const valid = exactKeys(raw, SHORTFALL_KEYS)
    && typeof raw.supported === 'boolean'
    && typeof raw.enabled === 'boolean'
    && raw.version === 1
    && raw.owner_only === true
    && raw.includes_tip === false
    && nullableBoundedString(raw.notice_version)
    && raw.notice_required === true
    && nullableBoundedString(raw.activation_blocker);
  if (!valid) return { enabled: false, status: 'malformed', noticeVersion: null };
  if (raw.enabled === true
      && (raw.supported !== true || !boundedString(raw.notice_version)
        || raw.activation_blocker !== null)) {
    return { enabled: false, status: 'malformed', noticeVersion: null };
  }
  const noticeVersion = boundedString(raw.notice_version) ? raw.notice_version : null;
  if (raw.supported === true && raw.enabled === true
      && noticeVersion && !presentableVersions(testSeam).has(noticeVersion)) {
    return { enabled: false, status: 'notice_unavailable', noticeVersion };
  }
  return {
    enabled: raw.supported === true && raw.enabled === true,
    status: 'authoritative',
    noticeVersion,
  };
}

let profileState = PENDING;
let shortfallState = PENDING;
let inFlight: Promise<void> | null = null;
const profileListeners = new Set<() => void>();
const shortfallListeners = new Set<() => void>();

function publish(listeners: Set<() => void>): void {
  for (const listener of [...listeners]) listener();
}

export function applyPrivateFeatureConfig(config: unknown, testSeam?: symbol): void {
  profileState = readProfileIdentityCapability(config, testSeam);
  shortfallState = readShortfallDetailCapability(config, testSeam);
  publish(profileListeners);
  publish(shortfallListeners);
}

function subscribeProfile(listener: () => void): () => void {
  profileListeners.add(listener);
  return () => { profileListeners.delete(listener); };
}

function subscribeShortfall(listener: () => void): () => void {
  shortfallListeners.add(listener);
  return () => { shortfallListeners.delete(listener); };
}

const getProfileState = (): PrivateFeatureState => profileState;
const getShortfallState = (): PrivateFeatureState => shortfallState;

export function resetPrivateFeaturesForTests(): void {
  profileState = PENDING;
  shortfallState = PENDING;
  inFlight = null;
  publish(profileListeners);
  publish(shortfallListeners);
}

export function ensurePrivateFeatureCapabilities(): Promise<void> {
  if (profileState.status !== 'pending' && shortfallState.status !== 'pending') {
    return Promise.resolve();
  }
  if (!inFlight) {
    // Import dinámico: la fachada usa los asserts de este módulo. Evita un
    // ciclo estático sin permitir que una pantalla saltee `api.getConfig()`.
    inFlight = import('./index')
      .then(({ api }) => api.getConfig())
      .then((config) => { applyPrivateFeatureConfig(config); })
      .catch(() => { applyPrivateFeatureConfig(null); })
      .finally(() => { inFlight = null; });
  }
  return inFlight;
}

export function useProfileIdentityCapability(): PrivateFeatureState {
  useEffect(() => { void ensurePrivateFeatureCapabilities(); }, []);
  return useSyncExternalStore(subscribeProfile, getProfileState, getProfileState);
}

export function useShortfallDetailCapability(): PrivateFeatureState {
  useEffect(() => { void ensurePrivateFeatureCapabilities(); }, []);
  return useSyncExternalStore(subscribeShortfall, getShortfallState, getShortfallState);
}

export class PrivateFeatureUnavailableError extends Error {
  constructor(readonly feature: 'profile_identity' | 'settlement_shortfall_detail') {
    super(`${feature}_unavailable`);
    this.name = 'PrivateFeatureUnavailableError';
  }
}

export function assertProfileIdentityEnabled(): void {
  if (!profileState.enabled) throw new PrivateFeatureUnavailableError('profile_identity');
}

export function assertShortfallDetailEnabled(): void {
  if (!shortfallState.enabled) throw new PrivateFeatureUnavailableError('settlement_shortfall_detail');
}
