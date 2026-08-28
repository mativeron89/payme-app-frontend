import { useEffect, useSyncExternalStore } from 'react';
import { api } from './index';

export type NativeWalletProvider = 'apple' | 'google';
export type NativeWalletCapabilityStatus =
  | 'pending'
  | 'authoritative'
  | 'absent'
  | 'malformed'
  | 'principal_scoped';
export type NativeWalletDiscovery =
  | { readonly status: 'pending' | 'absent' | 'malformed' | 'error'; readonly supported: false }
  | { readonly status: 'authoritative'; readonly supported: boolean };

export interface NativeWalletProviderState {
  readonly capabilityEnabled: boolean;
  readonly capabilityStatus: NativeWalletCapabilityStatus;
  readonly discovery: NativeWalletDiscovery;
  readonly available: boolean;
  readonly offendingKeys: readonly string[];
}

export interface NativeWalletsState {
  readonly apple: NativeWalletProviderState;
  readonly google: NativeWalletProviderState;
}

const DARK_DISCOVERY: NativeWalletDiscovery = { status: 'pending', supported: false };
const PRINCIPAL_SCOPED = /(?:^|_)(?:user|account|role|restaurant|branch|sucursal|principal|customer|merchant|tenant|per|for)(?:_|$)/i;
const PROVIDER_RELATED = {
  apple: /(?:^|_)(?:apple_pay|applepay)(?:_|$)/i,
  google: /(?:^|_)(?:google_pay|googlepay|gpay)(?:_|$)/i,
} as const;
const PRIMARY_KEY = { apple: 'apple_pay', google: 'google_pay' } as const;

function normalizeFeatureKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function plainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Composición pura: capability y discovery son autoridades independientes. */
export function nativeWalletAvailable(
  capabilityEnabled: boolean,
  discovery: NativeWalletDiscovery,
): boolean {
  return capabilityEnabled === true
    && discovery.status === 'authoritative'
    && discovery.supported === true;
}

function providerState(
  provider: NativeWalletProvider,
  features: Record<string, unknown>,
  discovery: NativeWalletDiscovery = DARK_DISCOVERY,
): NativeWalletProviderState {
  const primary = PRIMARY_KEY[provider];
  const relatedAliases = Object.keys(features)
    .filter((key) => {
      const normalized = normalizeFeatureKey(key);
      return key !== primary && PROVIDER_RELATED[provider].test(normalized);
    })
    .sort();
  if (relatedAliases.length > 0) {
    return {
      capabilityEnabled: false,
      capabilityStatus: relatedAliases.some((key) => PRINCIPAL_SCOPED.test(normalizeFeatureKey(key)))
        ? 'principal_scoped'
        : 'malformed',
      discovery,
      available: false,
      offendingKeys: relatedAliases,
    };
  }
  if (!(primary in features)) {
    return {
      capabilityEnabled: false,
      capabilityStatus: 'absent',
      discovery,
      available: false,
      offendingKeys: [],
    };
  }
  const raw = features[primary];
  if (typeof raw !== 'boolean') {
    return {
      capabilityEnabled: false,
      capabilityStatus: 'malformed',
      discovery,
      available: false,
      offendingKeys: [],
    };
  }
  return {
    capabilityEnabled: raw,
    capabilityStatus: 'authoritative',
    discovery,
    available: nativeWalletAvailable(raw, discovery),
    offendingKeys: [],
  };
}

function closed(status: Exclude<NativeWalletCapabilityStatus, 'authoritative'>): NativeWalletsState {
  const value = (provider: NativeWalletProvider): NativeWalletProviderState => ({
    capabilityEnabled: false,
    capabilityStatus: status,
    discovery: DARK_DISCOVERY,
    available: false,
    offendingKeys: provider === 'apple' ? [] : [],
  });
  return { apple: value('apple'), google: value('google') };
}

/** Lee sólo los dos flags propios; no cierra el keyset global de features. */
export function readNativeWallets(config: unknown): NativeWalletsState {
  if (!plainObject(config) || !plainObject(config.features)) return closed('malformed');
  return {
    apple: providerState('apple', config.features),
    google: providerState('google', config.features),
  };
}

const PENDING = closed('pending');
let state: NativeWalletsState = PENDING;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

export function nativeWalletsSnapshot(): NativeWalletsState {
  return state;
}

export function subscribeNativeWallets(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function publish(next: NativeWalletsState): NativeWalletsState {
  state = next;
  for (const listener of [...listeners]) listener();
  return next;
}

export function applyNativeWalletsConfig(config: unknown): NativeWalletsState {
  const next = readNativeWallets(config);
  for (const provider of ['apple', 'google'] as const) {
    if (next[provider].capabilityStatus === 'principal_scoped') {
      console.error(
        `[payme] STOP · capability ${provider} de wallet nativa tiene alias por principal: `
          + next[provider].offendingKeys.join(', '),
      );
    }
  }
  return publish(next);
}

export function resetNativeWalletsForTests(): void {
  state = PENDING;
  inFlight = null;
  for (const listener of [...listeners]) listener();
}

/** Red fallida conserva el estado dark y deja libre un retry posterior. */
export function ensureNativeWalletCapabilities(): Promise<void> {
  if (state.apple.capabilityStatus !== 'pending'
      || state.google.capabilityStatus !== 'pending') return Promise.resolve();
  if (!inFlight) {
    inFlight = api.getConfig()
      .then((config) => { applyNativeWalletsConfig(config); })
      .catch(() => { state = PENDING; })
      .finally(() => { inFlight = null; });
  }
  return inFlight;
}

export function useNativeWallets(): NativeWalletsState {
  useEffect(() => { void ensureNativeWalletCapabilities(); }, []);
  return useSyncExternalStore(
    subscribeNativeWallets,
    nativeWalletsSnapshot,
    nativeWalletsSnapshot,
  );
}
