import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import type { PageId } from '../router';
import { useIdioma } from '../i18n/idioma';
import type { GuiaContenidoProps } from './GuiaContenido';
import { almacenDeGuia, preferenciaGuia } from './preferenciaGuia';
import { entradasGuia, objetivoDeInicio, puedeIniciarGuia } from './inicioGuia';

const Contexto = createContext<{
  abrir: (origen: HTMLElement) => void; omitir: () => void; abierta: boolean; oferta: boolean;
  prioridad: (id: string, bloqueada: boolean | null) => void;
} | null>(null);
export const useGuia = () => useContext(Contexto);
/** Señal UI de consultas ya existentes; no añade consultas ni altera su resultado. */
export function usePrioridadGuia(id: string, bloqueada: boolean) {
  const informar = useGuia()?.prioridad;
  useEffect(() => {
    informar?.(id, bloqueada);
    return () => informar?.(id, null);
  }, [informar, id, bloqueada]);
}
const visible = (e: Element) => e.getClientRects().length > 0 && !e.closest('[hidden], [inert]') && getComputedStyle(e).visibility !== 'hidden';

/** Montado después de las puertas existentes; la key del shell aísla cuenta/familia. */
export function GuiaProvider({ children, pagina, principal, entrada, habilitada }: {
  children: ReactNode; pagina: PageId; principal: string; entrada: string; habilitada: boolean;
}) {
  const { t } = useIdioma();
  const [abierta, setAbierta] = useState(false);
  const [ofertaOculta, setOfertaOculta] = useState(false);
  const [usada, setUsada] = useState(() => entradasGuia.usada(entrada));
  const [noMostrar, setNoMostrar] = useState<boolean | null>(null);
  const [prioridades, setPrioridades] = useState<Record<string, boolean>>({});
  const [Motor, setMotor] = useState<ComponentType<GuiaContenidoProps> | null>(null);
  const [fallo, setFallo] = useState(false);
  const origen = useRef<HTMLElement | null>(null);
  const vigente = useRef(false);
  useEffect(() => { vigente.current = true; return () => { vigente.current = false; }; }, []);
  useEffect(() => {
    let actual = true;
    void preferenciaGuia.noMostrar(principal, almacenDeGuia()).then((valor) => { if (actual) setNoMostrar(valor); });
    return () => { actual = false; };
  }, [principal]);
  const consumir = useCallback(() => { entradasGuia.consumir(entrada); setUsada(true); }, [entrada]);
  const abrir = useCallback((boton: HTMLElement | null) => {
    consumir(); origen.current = boton; setAbierta(true); setFallo(false);
    void import('./GuiaContenido').then((m) => {
      if (vigente.current) setMotor(() => m.GuiaContenido);
    }).catch(() => { if (vigente.current) setFallo(true); });
  }, [consumir]);
  const cerrar = useCallback(() => {
    consumir(); setAbierta(false);
    const destino = origen.current?.isConnected && !origen.current.matches(':disabled') ? origen.current
      : document.querySelector<HTMLElement>('.appbar-center:not(:disabled)')
        ?? document.querySelector<HTMLElement>('.hdr-back:not(:disabled)')
        ?? document.querySelector<HTMLElement>('.appbar-item:not(:disabled)');
    destino?.focus({ preventScroll: true });
  }, [consumir]);
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
  useEffect(() => {
    if (usada || noMostrar !== false || !habilitada || prioridadPendiente) return;
    const selector = objetivoDeInicio(pagina);
    if (!selector) return;
    let observador: MutationObserver | null = null;
    const intentar = () => {
      const modal = Array.from(document.querySelectorAll('[aria-modal="true"], dialog[open]')).some(visible);
      const objetivo = Array.from(document.querySelectorAll(selector)).some(visible);
      if (!puedeIniciarGuia({ usada: entradasGuia.usada(entrada), noMostrar, habilitada, prioridad: modal, objetivo })) return;
      observador?.disconnect(); abrir(null);
    };
    observador = new MutationObserver(intentar);
    observador.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'open', 'class', 'aria-modal', 'data-guia'] });
    intentar();
    return () => observador?.disconnect();
  }, [usada, noMostrar, habilitada, prioridadPendiente, pagina, entrada, abrir]);
  const cambiarPreferencia = useCallback((valor: boolean) => {
    setNoMostrar(valor); void preferenciaGuia.elegir(principal, valor, almacenDeGuia());
  }, [principal]);
  const omitir = useCallback(() => { setOfertaOculta(true); cerrar(); }, [cerrar]);
  const contexto = useMemo(() => ({ abrir, omitir, abierta, oferta: !abierta && !ofertaOculta && noMostrar === false, prioridad }), [abrir, omitir, abierta, ofertaOculta, noMostrar, prioridad]);
  return <Contexto.Provider value={contexto}>
    {children}
    {abierta && (Motor && noMostrar !== null ? <Motor pagina={pagina} onCerrar={cerrar} noMostrar={noMostrar === true} onNoMostrar={cambiarPreferencia} prioridad={prioridadPendiente} /> : (
      <aside className="guia-carga" aria-label={t('Guía interactiva')} hidden={prioridadPendiente}>
        <p role="status">{fallo ? t('No pudimos abrir la guía. Puedes seguir usando PayMe.') : t('Cargando…')}</p>
        <button type="button" onClick={cerrar}>{t('Cerrar guía')}</button>
      </aside>
    ))}
  </Contexto.Provider>;
}
