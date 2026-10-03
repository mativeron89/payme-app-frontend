import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_REGION, defaultRegionState, loadRegion, resetRegion, saveRegion,
  type RegionPreference, type RegionState, type RegionStorage } from './regionPreference';
import { REGION_COUNTRIES } from './regionCatalog';
import { supportsTimeZone } from '../utils/personalDates';

/** Se llama lazy al montar/por acción; las rutas públicas nunca montan App. */
function browserStorage(): RegionStorage | null {
  try { return window.localStorage; } catch { return null; }
}

interface RegionContextValue extends RegionState {
  readonly supportedZones: ReadonlySet<string>;
  readonly apply: (preference: RegionPreference) => RegionState;
  readonly reset: () => RegionState;
}
const RegionContext = createContext<RegionContextValue | null>(null);

export function RegionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(() => loadRegion(browserStorage()));
  const [supportedZones] = useState(() => new Set(
    REGION_COUNTRIES.flatMap((c) => c.zones).filter(supportsTimeZone),
  ));
  const apply = useCallback((preference: RegionPreference) => {
    const next = saveRegion(preference, browserStorage());
    setState(next);
    return next;
  }, []);
  const reset = useCallback(() => {
    const next = resetRegion(browserStorage());
    setState(next);
    return next;
  }, []);
  const value = useMemo(() => ({ ...state, supportedZones, apply, reset }), [state, supportedZones, apply, reset]);
  return <RegionContext.Provider value={value}>{children}</RegionContext.Provider>;
}

/** Árbol parcial sin proveedor: fallback, sin leer/persistir ni vincular sesión. */
export function useRegion(): RegionContextValue {
  const context = useContext(RegionContext);
  return context ?? {
    ...defaultRegionState(),
    supportedZones: new Set([DEFAULT_REGION.timeZone]),
    apply: () => ({ ...defaultRegionState('not-saved'), persistence: 'temporary' }),
    reset: () => defaultRegionState('not-reset'),
  };
}
