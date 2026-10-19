import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { navigate, type PageId } from '../router';
import { useIdioma } from '../i18n/idioma';
import {
  abrirLaGuia, cargarElMotor, cierraPorLaRuta, debeEmpezar, guiaEspera, GUIA_CERRADA, salirVuelveAInicio, type Apertura,
} from './controlDeLaGuia';
import type { GuiaContenidoProps } from './GuiaContenido';
import { ejemploLocal, useEjemplo } from './ejemplo/estadoEjemplo';
import { useEnFechasDeViajeSinPedir } from './inicioGuia';
import { almacenDeGuia, noVolverAMostrar, tarjetaTutorialOculta } from './preferenciaGuia';
import type { IdDePaso } from './recorridoGuia';

/**
 * D363 · D364 · la guía, sólo cuando se la pide. Ya no arranca sola al entrar
 * ni al sumarse por un link (D364 deja sin efecto D328 y la recomendación 2 de
 * D343): la abren la tarjeta Tutorial de Inicio y Más → Ayuda.
 *
 * Revisión de V sobre ff5dec7 · el ejemplo arranca cuando se ve la primera
 * burbuja, no al abrir (`controlDeLaGuia.ts`): si el motor no carga, el ejemplo
 * nunca se prende y nada puede terminar en una mesa real con sus platos.
 */
interface ContextoDeLaGuia {
  /** Abre la guía. La tarjeta Tutorial vuelve a estar a la vista si se deja a medias (Q1). Abierta, no hace nada. */
  abrir: (origen: HTMLElement | null) => void;
  /** Salir (la ✕, «otro momento», Escape): cierra, descarta la mesa de ejemplo (D367) y, si hace falta, vuelve a Inicio. */
  salir: () => void;
  /** «Terminar guía» (4a): sale y además oculta la tarjeta Tutorial (Q1). */
  terminar: () => void;
  /** La ✕ roja de la tarjeta Tutorial (Q1). */
  ocultarTarjeta: () => void;
  abierta: boolean;
  /** D328 · el «No volver a mostrar» de antes. `null` mientras se lee; sólo se LEE (D364). */
  noVolverAMostrar: boolean | null;
  /** Q1 · la tarjeta Tutorial oculta. `null` mientras se lee. */
  tarjetaOculta: boolean | null;
}
const Contexto = createContext<ContextoDeLaGuia | null>(null);
export const useGuia = () => useContext(Contexto);

/** El botón que abre la guía desde la tarjeta Tutorial (el primero de la tarjeta; el segundo es la ✕ roja). */
const ABRIR_DE_LA_TARJETA = '[data-guia="tarjeta-tutorial"] button';

/** Montado después de las puertas existentes; la key del shell aísla cuenta/familia. */
export function GuiaProvider({ children, pagina, param, principal, habilitada }: {
  children: ReactNode; pagina: PageId; param: string | null; principal: string; habilitada: boolean;
}) {
  const { t } = useIdioma();
  const ejemplo = useEjemplo();
  const enFechasDeViaje = useEnFechasDeViajeSinPedir();
  const [apertura, setApertura] = useState<Apertura>(GUIA_CERRADA);
  const [noMostrar, setNoMostrar] = useState<boolean | null>(null);
  const [oculta, setOculta] = useState<boolean | null>(null);
  const [Motor, setMotor] = useState<ComponentType<GuiaContenidoProps> | null>(null);
  const [fallo, setFallo] = useState(false);
  // Las decisiones leen el estado vivo: un toque o un aviso del motor pueden llegar antes del próximo render.
  const aperturaRef = useRef(apertura);
  const rutaRef = useRef({ pagina, param });
  rutaRef.current = { pagina, param };
  const enFechasDeViajeRef = useRef(enFechasDeViaje);
  enFechasDeViajeRef.current = enFechasDeViaje;
  const origen = useRef<HTMLElement | null>(null);
  /** Después de volver a Inicio, el foco va a la tarjeta Tutorial, que queda a la vista. */
  const focoALaTarjeta = useRef(false);
  const vigente = useRef(false);
  useEffect(() => { vigente.current = true; return () => { vigente.current = false; }; }, []);
  // Cambiar de cuenta o de familia remonta el provider: la mesa de ejemplo de la anterior se borra (D367), antes de que
  // las pantallas de la nueva corran sus efectos.
  useLayoutEffect(() => () => ejemploLocal.descartar(), []);
  useEffect(() => {
    let actual = true;
    void noVolverAMostrar.leer(principal, almacenDeGuia()).then((valor) => { if (actual) setNoMostrar(valor); });
    void tarjetaTutorialOculta.leer(principal, almacenDeGuia()).then((valor) => { if (actual) setOculta(valor); });
    return () => { actual = false; };
  }, [principal]);
  const fijarApertura = useCallback((a: Apertura) => { aperturaRef.current = a; setApertura(a); }, []);
  const fijarTarjetaOculta = useCallback((valor: boolean) => {
    setOculta(valor);
    void tarjetaTutorialOculta.fijar(principal, valor, almacenDeGuia());
  }, [principal]);

  const abrir = useCallback((boton: HTMLElement | null) => {
    if (aperturaRef.current.abierta) return;
    origen.current = boton;
    fijarTarjetaOculta(false);
    fijarApertura(abrirLaGuia(aperturaRef.current, rutaRef.current.pagina));
    setFallo(false);
    void cargarElMotor(() => import('./GuiaContenido'), {
      vigente: () => vigente.current,
      alCargar: (m) => setMotor(() => m.GuiaContenido),
      alFallar: () => { ejemploLocal.descartar(); setFallo(true); },
    });
  }, [fijarTarjetaOculta, fijarApertura]);
  /** Por la ruta: cierra y descarta, sin navegar ni mover el foco (la persona eligió adónde ir). */
  const cerrarPorLaRuta = useCallback(() => {
    fijarApertura(GUIA_CERRADA);
    ejemploLocal.descartar();
  }, [fijarApertura]);
  const salir = useCallback(() => {
    const vuelve = salirVuelveAInicio(aperturaRef.current, rutaRef.current);
    fijarApertura(GUIA_CERRADA);
    ejemploLocal.descartar();
    if (vuelve) {
      focoALaTarjeta.current = true;
      navigate('home');
      return;
    }
    const destino = origen.current?.isConnected && !origen.current.matches(':disabled') ? origen.current
      : document.querySelector<HTMLElement>('.appbar-center:not(:disabled)')
        ?? document.querySelector<HTMLElement>('.hdr-back:not(:disabled)')
        ?? document.querySelector<HTMLElement>('.appbar-item:not(:disabled)');
    destino?.focus({ preventScroll: true });
  }, [fijarApertura]);
  const terminar = useCallback(() => { fijarTarjetaOculta(true); salir(); }, [fijarTarjetaOculta, salir]);
  const ocultarTarjeta = useCallback(() => fijarTarjetaOculta(true), [fijarTarjetaOculta]);
  /** El motor avisa cada burbuja que se ve; sólo la primera 2a prende el ejemplo. */
  const primeraBurbuja = useCallback((id: IdDePaso) => {
    if (!debeEmpezar(aperturaRef.current, id, rutaRef.current.pagina, ejemploLocal.leer().activo)) return;
    ejemploLocal.empezar();
    fijarApertura({ ...aperturaRef.current, empezado: true });
  }, [fijarApertura]);

  // Q7 · D365 · irse del recorrido cierra la guía, antes de los efectos de la pantalla nueva: así, lo que esa pantalla
  // pida al montarse ya no pasa por un ejemplo activo (la fachada envuelta lo leería en la llamada).
  const fuera = cierraPorLaRuta(apertura, ejemplo, { pagina, param }, enFechasDeViaje);
  useLayoutEffect(() => {
    if (cierraPorLaRuta(aperturaRef.current, ejemploLocal.leer(), rutaRef.current, enFechasDeViajeRef.current)) cerrarPorLaRuta();
  }, [fuera, cerrarPorLaRuta]);

  // Al volver a Inicio desde el recorrido, el foco va a la tarjeta Tutorial; si todavía no está (se leen sus marcas),
  // se espera unos cuadros y si no aparece, a la barra.
  useEffect(() => {
    if (!focoALaTarjeta.current || pagina !== 'home') return undefined;
    focoALaTarjeta.current = false;
    let cuadros = 0;
    let raf = 0;
    const enfocar = () => {
      const boton = document.querySelector<HTMLElement>(ABRIR_DE_LA_TARJETA)
        ?? (cuadros >= 30 ? document.querySelector<HTMLElement>('.appbar-center:not(:disabled)') : null);
      if (boton) { boton.focus({ preventScroll: true }); return; }
      cuadros += 1;
      raf = requestAnimationFrame(enfocar);
    };
    enfocar();
    return () => cancelAnimationFrame(raf);
  }, [pagina, apertura]);

  const espera = guiaEspera(habilitada);
  const contexto = useMemo(() => ({
    abrir, salir, terminar, ocultarTarjeta, abierta: apertura.abierta, noVolverAMostrar: noMostrar, tarjetaOculta: oculta,
  }), [abrir, salir, terminar, ocultarTarjeta, apertura.abierta, noMostrar, oculta]);
  return <Contexto.Provider value={contexto}>
    {children}
    {apertura.abierta && (Motor ? (
      <Motor pagina={pagina} param={param} empezado={apertura.empezado} onSalir={salir} onTerminar={terminar} onPrimeraBurbuja={primeraBurbuja} espera={espera} />
    ) : (
      <aside className="guia-carga" aria-label={t('Guía interactiva')} hidden={espera}>
        <p role="status">{fallo ? t('No pudimos abrir la guía. Puedes seguir usando PayMe.') : t('Cargando…')}</p>
        <button type="button" onClick={salir}>{t('Cerrar guía')}</button>
      </aside>
    ))}
  </Contexto.Provider>;
}
