import { REGION_COUNTRIES, type CountryCode } from './regionCatalog';
import { supportsTimeZone } from '../utils/personalDates';

export const REGION_KEY = 'payme.app.region.v1';
export interface RegionPreference {
  readonly country: CountryCode;
  /** Manual: selección fija. Automático: sólo fallback manual, nunca la zona detectada. */
  readonly timeZone: string;
  readonly mode?: 'automatic';
}
export const DEFAULT_REGION: RegionPreference = Object.freeze({ country: 'MX', timeZone: 'America/Mexico_City' });
export const DEFAULT_AUTOMATIC_REGION: RegionPreference = Object.freeze({ ...DEFAULT_REGION, mode: 'automatic' });
export type ZoneSupport = (zone: string) => boolean;
export type DeviceZoneReader = () => unknown;
export type RegionNotice = 'corrupt' | 'unsupported' | 'device-unavailable' | 'storage-unavailable' | 'not-saved' | 'not-reset' | null;
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

/** D171: sólo Intl del runtime. Sin GPS, red, storage ni lectura al importar. */
export function readDeviceTimeZone(): string | null {
  try {
    return validatedDeviceZone(new Intl.DateTimeFormat().resolvedOptions().timeZone, supportsTimeZone);
  } catch { return null; }
}

function validatedDeviceZone(zone: unknown, support: ZoneSupport): string | null {
  try {
    return typeof zone === 'string' && /^[A-Za-z][A-Za-z0-9_+./-]{0,127}$/.test(zone) && support(zone) ? zone : null;
  } catch { return null; }
}

function resolveZone(preference: RegionPreference, support: ZoneSupport, readDevice: DeviceZoneReader,
  previousZone: string | null = null): { presentationZone: string | null; notice: RegionNotice } {
  if (preference.mode === 'automatic') {
    let detected: string | null = null;
    try { detected = validatedDeviceZone(readDevice(), support); } catch { /* fallback estable */ }
    if (detected) return { presentationZone: detected, notice: null };
  } else if (validatedDeviceZone(preference.timeZone, support)) {
    return { presentationZone: preference.timeZone, notice: null };
  }
  const fallback = [previousZone, preference.timeZone, DEFAULT_REGION.timeZone, 'UTC']
    .map((zone) => validatedDeviceZone(zone, support)).find((zone) => zone !== null) ?? null;
  return { presentationZone: fallback,
    notice: preference.mode === 'automatic' && fallback !== null ? 'device-unavailable' : 'unsupported' };
}

export function parseRegion(value: unknown): RegionPreference | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const country = REGION_COUNTRIES.find((c) => c.code === record.country);
  if (!country || typeof record.timeZone !== 'string') return null;
  if (keys.length === 3 && keys.join(',') === 'country,mode,timeZone' && record.mode === 'automatic'
      && /^[A-Za-z][A-Za-z0-9_+./-]{0,127}$/.test(record.timeZone)) {
    return { country: country.code, timeZone: record.timeZone, mode: 'automatic' };
  }
  if (keys.length !== 2 || keys.join(',') !== 'country,timeZone' || !country.zones.includes(record.timeZone)) return null;
  return { country: country.code, timeZone: record.timeZone };
}

export function defaultRegionState(
  notice: RegionNotice = null,
  support: ZoneSupport = supportsTimeZone,
  readDevice: DeviceZoneReader = readDeviceTimeZone,
): RegionState {
  const resolved = resolveZone(DEFAULT_AUTOMATIC_REGION, support, readDevice);
  return { preference: DEFAULT_AUTOMATIC_REGION, ...resolved,
    notice: notice ?? resolved.notice, persistence: 'default' };
}

/** Storage siempre inyectado: cero lectura global al evaluar/importar módulo. */
export function loadRegion(storage: RegionStorage | null, support: ZoneSupport = supportsTimeZone,
  readDevice: DeviceZoneReader = readDeviceTimeZone): RegionState {
  if (!storage) return defaultRegionState('storage-unavailable', support, readDevice);
  let raw: string | null;
  try { raw = storage.getItem(REGION_KEY); } catch { return defaultRegionState('storage-unavailable', support, readDevice); }
  if (raw === null) return defaultRegionState(null, support, readDevice);
  let preference: RegionPreference | null;
  try { preference = parseRegion(JSON.parse(raw)); } catch { return defaultRegionState('corrupt', support, readDevice); }
  if (!preference) return defaultRegionState('corrupt', support, readDevice);
  return { preference, ...resolveZone(preference, support, readDevice), persistence: 'saved' };
}

/** Sólo Aplicar explícito. Un roundtrip fallido no se disfraza de guardado. */
export function saveRegion(
  value: unknown,
  storage: RegionStorage | null,
  support: ZoneSupport = supportsTimeZone,
  readDevice: DeviceZoneReader = readDeviceTimeZone,
  previousZone: string | null = null,
): RegionState {
  const preference = parseRegion(value);
  if (!preference) return defaultRegionState('corrupt', support, readDevice);
  const resolved = resolveZone(preference, support, readDevice, previousZone);
  if (preference.mode !== 'automatic' && resolved.notice !== null) return defaultRegionState('unsupported', support, readDevice);
  const temporary: RegionState = { preference, ...resolved, notice: 'not-saved', persistence: 'temporary' };
  if (!storage) return temporary;
  const raw = JSON.stringify(preference);
  try {
    storage.setItem(REGION_KEY, raw);
    if (storage.getItem(REGION_KEY) !== raw) return temporary;
  } catch { return temporary; }
  return { preference, ...resolved, persistence: 'saved' };
}

/** Foreground/apertura: ni relee storage ni persiste la nueva zona del teléfono. */
export function refreshAutomaticRegion(state: RegionState, readDevice: DeviceZoneReader = readDeviceTimeZone,
  support: ZoneSupport = supportsTimeZone): RegionState {
  if (state.preference.mode !== 'automatic') return state;
  const resolved = resolveZone(state.preference, support, readDevice, state.presentationZone);
  const notice = state.notice === null || state.notice === 'device-unavailable' || state.notice === 'unsupported'
    ? resolved.notice : state.notice;
  return resolved.presentationZone === state.presentationZone && notice === state.notice ? state
    : { ...state, presentationZone: resolved.presentationZone, notice };
}

/** No clear(), sesión, claves ajenas ni autosobrescritura al leer un corrupto. */
export function resetRegion(storage: RegionStorage | null, support: ZoneSupport = supportsTimeZone,
  readDevice: DeviceZoneReader = readDeviceTimeZone): RegionState {
  if (!storage) return defaultRegionState('not-reset', support, readDevice);
  try {
    storage.removeItem(REGION_KEY);
    if (storage.getItem(REGION_KEY) !== null) return defaultRegionState('not-reset', support, readDevice);
  } catch { return defaultRegionState('not-reset', support, readDevice); }
  return defaultRegionState(null, support, readDevice);
}
