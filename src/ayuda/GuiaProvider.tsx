import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import type { PageId } from '../router';
import { useIdioma } from '../i18n/idioma';
import type { GuiaContenidoProps } from './GuiaContenido';

const Contexto = createContext<{ abrir: (origen: HTMLElement) => void; abierta: boolean } | null>(null);
export const useGuia = () => useContext(Contexto);

/** Montado únicamente después de las puertas existentes. La key del shell aísla cuenta/familia. */
export function GuiaProvider({ children, pagina }: { children: ReactNode; pagina: PageId }) {
  const { t } = useIdioma();
  const [abierta, setAbierta] = useState(false);
  const [Motor, setMotor] = useState<ComponentType<GuiaContenidoProps> | null>(null);
  const [fallo, setFallo] = useState(false);
  const origen = useRef<HTMLElement | null>(null);
  const vigente = useRef(false);
  useEffect(() => { vigente.current = true; return () => { vigente.current = false; }; }, []);
  const abrir = useCallback((boton: HTMLElement) => {
    origen.current = boton;
    setAbierta(true);
    setFallo(false);
    void import('./GuiaContenido').then((m) => {
      if (vigente.current) setMotor(() => m.GuiaContenido);
    }).catch(() => { if (vigente.current) setFallo(true); });
  }, []);
  const cerrar = useCallback(() => {
    setAbierta(false);
    // No click ni navegación: sólo devuelve el foco a un control que aún exista.
    const destino = origen.current?.isConnected ? origen.current : document.querySelector<HTMLElement>('.appbar-center');
    destino?.focus({ preventScroll: true });
  }, []);
  const contexto = useMemo(() => ({ abrir, abierta }), [abrir, abierta]);
  return <Contexto.Provider value={contexto}>
    {children}
    {abierta && (Motor ? <Motor pagina={pagina} onCerrar={cerrar} /> : (
      <aside className="guia-carga" aria-label={t('Guía interactiva')}>
        <p role="status">{fallo ? t('No pudimos abrir la guía. Puedes seguir usando PayMe.') : t('Cargando…')}</p>
        <button type="button" onClick={cerrar}>{t('Cerrar guía')}</button>
      </aside>
    ))}
  </Contexto.Provider>;
}
