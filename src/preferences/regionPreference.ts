import { REGION_COUNTRIES, type CountryCode } from './regionCatalog';
import { supportsTimeZone } from '../utils/personalDates';

export const REGION_KEY = 'payme.app.region.v1';
export interface RegionPreference {
  readonly country: CountryCode;
  readonly timeZone: string;
}
export const DEFAULT_REGION: RegionPreference = Object.freeze({ country: 'MX', timeZone: 'America/Mexico_City' });
export type ZoneSupport = (zone: string) => boolean;
export type RegionNotice = 'corrupt' | 'unsupported' | 'storage-unavailable' | 'not-saved' | 'not-reset' | null;
export interface RegionState {
  readonly preference: RegionPreference;
  /** null: sólo ISO neutral. UTC fallback nunca se persiste como MX/UTC. */
  readonly presentationZone: string | null;
  readonly notice: RegionNotice;
  readonly persistence: 'default' | 'saved' | 'temporary';
}
export interface RegionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function parseRegion(value: unknown): RegionPreference | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== 2 || keys[0] !== 'country' || keys[1] !== 'timeZone') return null;
  const country = REGION_COUNTRIES.find((c) => c.code === record.country);
  if (!country || typeof record.timeZone !== 'string' || !country.zones.includes(record.timeZone)) return null;
  return { country: country.code, timeZone: record.timeZone };
}

export function defaultRegionState(
  notice: RegionNotice = null,
  support: ZoneSupport = supportsTimeZone,
): RegionState {
  const mexico = support(DEFAULT_REGION.timeZone);
  const zone = mexico ? DEFAULT_REGION.timeZone : support('UTC') ? 'UTC' : null;
  return { preference: DEFAULT_REGION, presentationZone: zone,
    notice: notice ?? (mexico ? null : 'unsupported'), persistence: 'default' };
}

/** Storage siempre inyectado: cero lectura global al evaluar/importar módulo. */
export function loadRegion(storage: RegionStorage | null, support: ZoneSupport = supportsTimeZone): RegionState {
  if (!storage) return defaultRegionState('storage-unavailable', support);
  let raw: string | null;
  try { raw = storage.getItem(REGION_KEY); } catch { return defaultRegionState('storage-unavailable', support); }
  if (raw === null) return defaultRegionState(null, support);
  let preference: RegionPreference | null;
  try { preference = parseRegion(JSON.parse(raw)); } catch { return defaultRegionState('corrupt', support); }
  if (!preference) return defaultRegionState('corrupt', support);
  if (!support(preference.timeZone)) return defaultRegionState('unsupported', support);
  return { preference, presentationZone: preference.timeZone, notice: null, persistence: 'saved' };
}

/** Sólo Aplicar explícito. Un roundtrip fallido no se disfraza de guardado. */
export function saveRegion(
  value: unknown,
  storage: RegionStorage | null,
  support: ZoneSupport = supportsTimeZone,
): RegionState {
  const preference = parseRegion(value);
  if (!preference) return defaultRegionState('corrupt', support);
  if (!support(preference.timeZone)) return defaultRegionState('unsupported', support);
  const temporary: RegionState = { preference, presentationZone: preference.timeZone, notice: 'not-saved', persistence: 'temporary' };
  if (!storage) return temporary;
  const raw = JSON.stringify(preference);
  try {
    storage.setItem(REGION_KEY, raw);
    if (storage.getItem(REGION_KEY) !== raw) return temporary;
  } catch { return temporary; }
  return { preference, presentationZone: preference.timeZone, notice: null, persistence: 'saved' };
}

/** No clear(), sesión, claves ajenas ni autosobrescritura al leer un corrupto. */
export function resetRegion(storage: RegionStorage | null, support: ZoneSupport = supportsTimeZone): RegionState {
  if (!storage) return defaultRegionState('not-reset', support);
  try {
    storage.removeItem(REGION_KEY);
    if (storage.getItem(REGION_KEY) !== null) return defaultRegionState('not-reset', support);
  } catch { return defaultRegionState('not-reset', support); }
  return defaultRegionState(null, support);
}
