import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_REGION, defaultRegionState, loadRegion, resetRegion, saveRegion,
  readDeviceTimeZone, refreshAutomaticRegion,
  type RegionPreference, type RegionState, type RegionStorage } from './regionPreference';
import { REGION_COUNTRIES } from './regionCatalog';
import { supportsTimeZone } from '../utils/personalDates';

/** Se llama lazy al montar/por acción; las rutas públicas nunca montan App. */
function browserStorage(): RegionStorage | null {
  try { return window.localStorage; } catch { return null; }
}

interface RegionContextValue extends RegionState {
  readonly deviceZone: string | null;
  readonly refreshDevice: () => void;
  readonly supportedZones: ReadonlySet<string>;
  readonly apply: (preference: RegionPreference) => RegionState;
  readonly reset: () => RegionState;
}
const RegionContext = createContext<RegionContextValue | null>(null);

export function RegionProvider({ children }: { children: ReactNode }) {
  const [deviceZone, setDeviceZone] = useState(readDeviceTimeZone);
  const [state, setState] = useState(() => loadRegion(browserStorage(), supportsTimeZone, () => deviceZone));
  const [supportedZones] = useState(() => new Set(
    REGION_COUNTRIES.flatMap((c) => c.zones).filter(supportsTimeZone),
  ));
  const apply = useCallback((preference: RegionPreference) => {
    const next = saveRegion(preference, browserStorage(), supportsTimeZone, () => deviceZone, state.presentationZone);
    setState(next);
    return next;
  }, [deviceZone, state.presentationZone]);
  const refreshDevice = useCallback(() => {
    const detected = readDeviceTimeZone();
    setDeviceZone(detected);
    setState((previous) => refreshAutomaticRegion(previous, () => detected));
  }, []);
  useEffect(() => {
    const visible = () => { if (document.visibilityState === 'visible') refreshDevice(); };
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('pageshow', refreshDevice);
    return () => {
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('pageshow', refreshDevice);
    };
  }, [refreshDevice]);
  const reset = useCallback(() => {
    const next = resetRegion(browserStorage(), supportsTimeZone, () => deviceZone);
    setState(next);
    return next;
  }, [deviceZone]);
  const value = useMemo(() => ({ ...state, deviceZone, refreshDevice, supportedZones, apply, reset }),
    [state, deviceZone, refreshDevice, supportedZones, apply, reset]);
  return <RegionContext.Provider value={value}>{children}</RegionContext.Provider>;
}

/** Árbol parcial sin proveedor: fallback, sin leer/persistir ni vincular sesión. */
export function useRegion(): RegionContextValue {
  const context = useContext(RegionContext);
  return context ?? {
    ...defaultRegionState(),
    deviceZone: null,
    refreshDevice: () => undefined,
    supportedZones: new Set([DEFAULT_REGION.timeZone]),
    apply: () => ({ ...defaultRegionState('not-saved'), persistence: 'temporary' }),
    reset: () => defaultRegionState('not-reset'),
  };
}
