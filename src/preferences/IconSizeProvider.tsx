import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { defaultIconState, loadIconSize, saveIconSize, type IconPreferenceState, type IconSize, type IconStorage } from './iconPreference';
import './iconSizes.css';

function browserStorage(): IconStorage | null {
  try { return window.localStorage; } catch { return null; }
}
interface IconSizeContext extends IconPreferenceState {
  readonly apply: (size: IconSize) => IconPreferenceState;
}
const Context = createContext<IconSizeContext | null>(null);

/** Monta sólo en el grafo privado de App; también alcanza sus portales. */
export function IconSizeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(() => loadIconSize(browserStorage()));
  const apply = useCallback((size: IconSize) => {
    const next = saveIconSize(size, browserStorage());
    setState(next);
    return next;
  }, []);
  useLayoutEffect(() => {
    const root = document.documentElement;
    const previous = root.getAttribute('data-iconos');
    root.setAttribute('data-iconos', state.size);
    return () => {
      if (previous === null) root.removeAttribute('data-iconos');
      else root.setAttribute('data-iconos', previous);
    };
  }, [state.size]);
  const value = useMemo(() => ({ ...state, apply }), [state, apply]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useIconSize(): IconSizeContext {
  return useContext(Context) ?? { ...defaultIconState(), apply: (size) => saveIconSize(size, null) };
}
