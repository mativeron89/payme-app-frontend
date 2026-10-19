import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import type { PageId } from '../router';
import { useIdioma } from '../i18n/idioma';
import type { GuiaContenidoProps } from './GuiaContenido';
import { ejemploLocal } from './ejemplo/estadoEjemplo';
import { almacenDeGuia, noVolverAMostrar, tarjetaTutorialOculta } from './preferenciaGuia';

/**
 * D363 · D364 · la guía, sólo cuando se la pide. Ya no arranca sola al entrar
 * ni al sumarse por un link (D364 deja sin efecto D328 y la recomendación 2 de
 * D343): la abren la tarjeta Tutorial de Inicio y Más → Ayuda.
 */
interface ContextoDeLaGuia {
  /** Abre la guía con una mesa de ejemplo nueva (D363). La tarjeta Tutorial vuelve a estar a la vista si se deja a medias (Q1). */
  abrir: (origen: HTMLElement | null) => void;
  /** Cierra la guía y descarta la mesa de ejemplo (D367). */
  cerrar: () => void;
  /** «Terminar guía» (4a): cierra, descarta la mesa de ejemplo y oculta la tarjeta Tutorial (Q1). */
  terminar: () => void;
  /** La ✕ roja de la tarjeta Tutorial (Q1). */
  ocultarTarjeta: () => void;
  abierta: boolean;
  /** D328 · el «No volver a mostrar» de antes. `null` mientras se lee; sólo se LEE (D364). */
  noVolverAMostrar: boolean | null;
  /** Q1 · la tarjeta Tutorial oculta. `null` mientras se lee. */
  tarjetaOculta: boolean | null;
  prioridad: (id: string, bloqueada: boolean | null) => void;
}
const Contexto = createContext<ContextoDeLaGuia | null>(null);
export const useGuia = () => useContext(Contexto);
/** Señal UI de consultas ya existentes; no añade consultas ni altera su resultado. */
export function usePrioridadGuia(id: string, bloqueada: boolean) {
  const informar = useGuia()?.prioridad;
  useEffect(() => {
    informar?.(id, bloqueada);
    return () => informar?.(id, null);
  }, [informar, id, bloqueada]);
}

/** Montado después de las puertas existentes; la key del shell aísla cuenta/familia. */
export function GuiaProvider({ children, pagina, principal, habilitada }: {
  children: ReactNode; pagina: PageId; principal: string; habilitada: boolean;
}) {
  const { t } = useIdioma();
  const [abierta, setAbierta] = useState(false);
  const [noMostrar, setNoMostrar] = useState<boolean | null>(null);
  const [oculta, setOculta] = useState<boolean | null>(null);
  const [prioridades, setPrioridades] = useState<Record<string, boolean>>({});
  const [Motor, setMotor] = useState<ComponentType<GuiaContenidoProps> | null>(null);
  const [fallo, setFallo] = useState(false);
  const origen = useRef<HTMLElement | null>(null);
  const vigente = useRef(false);
  useEffect(() => { vigente.current = true; return () => { vigente.current = false; }; }, []);
  // Cambiar de cuenta o de familia remonta el provider: la mesa de ejemplo de la anterior se borra (D367).
  useEffect(() => () => ejemploLocal.descartar(), []);
  useEffect(() => {
    let actual = true;
    void noVolverAMostrar.leer(principal, almacenDeGuia()).then((valor) => { if (actual) setNoMostrar(valor); });
    void tarjetaTutorialOculta.leer(principal, almacenDeGuia()).then((valor) => { if (actual) setOculta(valor); });
    return () => { actual = false; };
  }, [principal]);
  const fijarTarjetaOculta = useCallback((valor: boolean) => {
    setOculta(valor);
    void tarjetaTutorialOculta.fijar(principal, valor, almacenDeGuia());
  }, [principal]);
  const abrir = useCallback((boton: HTMLElement | null) => {
    origen.current = boton;
    fijarTarjetaOculta(false);
    ejemploLocal.empezar();
    setAbierta(true); setFallo(false);
    void import('./GuiaContenido').then((m) => {
      if (vigente.current) setMotor(() => m.GuiaContenido);
    }).catch(() => { if (vigente.current) setFallo(true); });
  }, [fijarTarjetaOculta]);
  const cerrar = useCallback(() => {
    setAbierta(false);
    ejemploLocal.descartar();
    const destino = origen.current?.isConnected && !origen.current.matches(':disabled') ? origen.current
      : document.querySelector<HTMLElement>('.appbar-center:not(:disabled)')
        ?? document.querySelector<HTMLElement>('.hdr-back:not(:disabled)')
        ?? document.querySelector<HTMLElement>('.appbar-item:not(:disabled)');
    destino?.focus({ preventScroll: true });
  }, []);
  const terminar = useCallback(() => { fijarTarjetaOculta(true); cerrar(); }, [fijarTarjetaOculta, cerrar]);
  const ocultarTarjeta = useCallback(() => fijarTarjetaOculta(true), [fijarTarjetaOculta]);
  const prioridad = useCallback((id: string, bloqueada: boolean | null) => {
    setPrioridades((antes) => {
      if (antes[id] === bloqueada || (bloqueada === null && !(id in antes))) return antes;
      const despues = { ...antes };
      if (bloqueada === null) delete despues[id]; else despues[id] = bloqueada;
      return despues;
    });
  }, []);
  // Inicio no se adelanta a las consultas de invitaciones ni al aviso de privacidad.
  const prioridadPendiente = !habilitada || (pagina === 'home'
    && (prioridades.invitaciones !== false || prioridades.foto !== false));
  const contexto = useMemo(() => ({
    abrir, cerrar, terminar, ocultarTarjeta, abierta, noVolverAMostrar: noMostrar, tarjetaOculta: oculta, prioridad,
  }), [abrir, cerrar, terminar, ocultarTarjeta, abierta, noMostrar, oculta, prioridad]);
  return <Contexto.Provider value={contexto}>
    {children}
    {abierta && (Motor ? <Motor pagina={pagina} onCerrar={cerrar} onTerminar={terminar} prioridad={prioridadPendiente} /> : (
      <aside className="guia-carga" aria-label={t('Guía interactiva')} hidden={prioridadPendiente}>
        <p role="status">{fallo ? t('No pudimos abrir la guía. Puedes seguir usando PayMe.') : t('Cargando…')}</p>
        <button type="button" onClick={cerrar}>{t('Cerrar guía')}</button>
      </aside>
    ))}
  </Contexto.Provider>;
}
