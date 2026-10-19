import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useIdioma } from '../i18n/idioma';
import { navigate, useRoute, type PageId } from '../router';
import { BurbujaGuia } from './BurbujaGuia';
import { ejemploLocal, useEjemplo } from './ejemplo/estadoEjemplo';
import { posicionGuia, SEPARACION_CON_FLECHA, SEPARACION_CON_PUNTA, type Caja, type Posicion } from './posicionGuia';
import { enElRecorrido, pasoDeLaGuia, saliendoVuelveAInicio } from './recorridoGuia';
import './guiaInteractiva.css';

export interface GuiaContenidoProps {
  pagina: PageId;
  /** Cierra la guía y descarta la mesa de ejemplo (la tarjeta Tutorial sigue en Inicio). */
  onCerrar: () => void;
  /** «Terminar guía» (4a): además oculta la tarjeta Tutorial. */
  onTerminar: () => void;
  prioridad: boolean;
}

const visible = (e: HTMLElement) => e.getClientRects().length > 0 && !e.closest('[hidden], [inert]') && getComputedStyle(e).visibility !== 'hidden';
const buscar = (ancla: string) => Array.from(document.querySelectorAll<HTMLElement>(`[data-guia="${ancla}"]`)).find(visible) ?? null;
/**
 * Una ventana encima (banco, otra hoja) esconde la guía hasta que se cierra
 * (ficha, «Colocación» 5). La excepción es la hoja del ticket de 3a, que lleva
 * `data-guia-convive` mientras el ejemplo está ahí y convive con la burbuja.
 */
const hayModal = () => Array.from(document.querySelectorAll<HTMLElement>('[aria-modal="true"], dialog[open]'))
  .some((e) => visible(e) && !e.hasAttribute('data-guia-convive'));
const sinMovimiento = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

interface Medida { objetivo: Caja | null; posicion: Posicion | null; ancho: number; zoom: number; modal: boolean; radio: string }
const inicial: Medida = { objetivo: null, posicion: null, ancho: 0, zoom: 1, modal: false, radio: '0px' };

/** El área segura de arriba (la muesca), medida con una sonda: JS no lee `env()` directo. */
function areaSeguraArriba(): number {
  const sonda = document.createElement('div');
  sonda.style.cssText = 'position:fixed;top:0;left:0;width:0;height:env(safe-area-inset-top,0px);visibility:hidden;pointer-events:none';
  document.body.append(sonda);
  const alto = sonda.getBoundingClientRect().height;
  sonda.remove();
  return alto;
}

/** El anillo toma el radio del control + 4; un círculo sigue siendo un círculo. */
function radioDelAnillo(control: HTMLElement): string {
  const radio = getComputedStyle(control).borderTopLeftRadius;
  if (radio.endsWith('%')) return '50%';
  const px = Number.parseFloat(radio);
  return `${(Number.isFinite(px) ? px : 0) + 4}px`;
}

/**
 * D363 · el motor del tutorial «Tu turno». El paso sale de la fase de la mesa
 * de ejemplo y de la ruta (`recorridoGuia.ts`); el DOM sólo se mide. Sin API,
 * sin clicks sintéticos, sin callbacks de negocio: lo único que hace por su
 * cuenta es volver a Inicio al salir desde la cámara o la mesa de ejemplo, y
 * cerrar la hoja del ticket con Siguiente (3a) moviendo la fase del ejemplo.
 */
export function GuiaContenido({ pagina, onCerrar, onTerminar, prioridad }: GuiaContenidoProps) {
  const { t } = useIdioma();
  const { param } = useRoute();
  const ejemplo = useEjemplo();
  const [subpaso, setSubpaso] = useState<0 | 1>(0);
  useEffect(() => { setSubpaso(0); }, [ejemplo.fase]);
  const donde = { fase: ejemplo.fase, pagina, param, subpaso, division: ejemplo.division };
  const paso = ejemplo.activo ? pasoDeLaGuia(donde, t) : null;
  const clave = paso ? `${paso.id}:${paso.ancla}` : '';
  const [medida, setMedida] = useState<Medida>(inicial);
  /**
   * Dónde se monta la burbuja: el `body`, o la hoja del ticket en 3a. Se resuelve al medir, después del commit: en
   * el render la hoja todavía puede no estar en el DOM, y la burbuja no aparecería nunca.
   */
  const [destino, setDestino] = useState<HTMLElement | null>(null);
  const burbuja = useRef<HTMLElement>(null);
  const raiz = useRef<HTMLDivElement>(null);

  const salir = useCallback(() => {
    if (saliendoVuelveAInicio({ pagina, param })) navigate('home');
    onCerrar();
  }, [pagina, param, onCerrar]);

  // Q7 · irse del recorrido (otra pestaña, «Volver», una ruta ajena) cierra la guía sin aviso.
  const fueraDelRecorrido = !ejemplo.activo || !enElRecorrido({ fase: ejemplo.fase, pagina, param });
  useEffect(() => { if (fueraDelRecorrido) onCerrar(); }, [fueraDelRecorrido, onCerrar]);

  const siguiente = useCallback(() => {
    if (paso?.id === 'ticket') ejemploLocal.irA('dividir');
    else if (paso?.id === 'invitar') setSubpaso(1);
  }, [paso?.id]);

  useLayoutEffect(() => {
    if (!paso) { setMedida(inicial); setDestino(null); return undefined; }
    let raf = 0;
    let desplazado = false;
    // Antes de empezar a observar: la sonda entra y sale del `body` sin despertar al observador.
    const areaSegura = areaSeguraArriba();
    const medir = () => {
      raf = 0;
      const modal = prioridad || hayModal();
      const control = buscar(paso.ancla);
      const dondeMontar = paso.dentroDeLaHoja ? control : document.body;
      setDestino((prev) => (prev === dondeMontar ? prev : dondeMontar));
      const zoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
      const vw = window.visualViewport;
      const izquierda = vw?.offsetLeft ?? 0, arriba = vw?.offsetTop ?? 0;
      const anchoVentana = vw?.width ?? window.innerWidth, altoVentana = vw?.height ?? window.innerHeight;
      // Ficha, «Colocación» 2: 16 a los lados; 12 del área segura y de la barra (incluido el círculo que sobresale).
      const pies = Array.from(document.querySelectorAll<HTMLElement>('.appbar-block, .appbar-fab')).filter(visible);
      const piso = Math.min(arriba + altoVentana, ...pies.map((p) => p.getBoundingClientRect().top));
      // Los pasos que señalan la barra (2a y 2d) miden contra la ventana: la burbuja va arriba de la barra.
      const contraLaBarra = paso.ancla === 'camara' || paso.ancla === 'continuar';
      const espacio = {
        left: izquierda + 16,
        top: arriba + areaSegura + 12,
        right: izquierda + anchoVentana - 16,
        bottom: contraLaBarra ? arriba + altoVentana - 12 : Math.max(arriba + areaSegura + 92, piso - 12),
      };
      const caja = control?.getBoundingClientRect();
      const circulo = control?.querySelector('.appbar-fab')?.getBoundingClientRect();
      const rect = caja && circulo
        ? { left: circulo.left, right: circulo.right, top: circulo.top, bottom: circulo.bottom }
        : caja ? { left: caja.left, right: caja.right, top: caja.top, bottom: caja.bottom } : null;
      // A la vista = el borde del control del lado de la burbuja. La hoja del ticket (3a) tapa la barra y «Tus
      // consumos» (2e) puede seguir debajo: lo que importa es el borde de arriba, donde va la burbuja.
      const aLaVista = rect !== null && (contraLaBarra || (paso.lado === 'arriba'
        ? rect.top >= espacio.top - 8 && rect.top <= espacio.bottom
        : rect.bottom >= espacio.top && rect.bottom <= espacio.bottom + 8));
      // Ficha, «Colocación» 4: si el control no está en pantalla, primero el scroll (280 ms) y después la burbuja.
      if (control && rect && !aLaVista && !desplazado && !modal) {
        desplazado = true;
        const alto = rect.bottom - rect.top;
        control.scrollIntoView({ block: alto > altoVentana / 2 ? 'nearest' : 'center', inline: 'nearest', behavior: sinMovimiento() ? 'auto' : 'smooth' });
      }
      const ancho = espacio.right - espacio.left;
      const alto = burbuja.current?.scrollHeight ?? 160;
      const separacion = paso.senal === 'flecha' ? SEPARACION_CON_FLECHA : SEPARACION_CON_PUNTA;
      // 2b · la leyenda se ubica a 12 arriba de la galería; la flecha va al costado del disparador.
      const referencia = paso.referencia ? buscar(paso.referencia)?.getBoundingClientRect() : null;
      const posicion = rect && aLaVista
        ? referencia
          ? posicionGuia({ left: referencia.left, top: referencia.top, right: referencia.right, bottom: referencia.bottom }, espacio, ancho, alto, paso.lado, 12)
          : posicionGuia(rect, espacio, ancho, alto, paso.lado, separacion)
        : null;
      const next: Medida = {
        objetivo: rect && aLaVista ? rect : null,
        posicion,
        ancho,
        zoom,
        modal,
        radio: circulo ? '50%' : control ? radioDelAnillo(control) : '0px',
      };
      setMedida((prev) => JSON.stringify(prev) === JSON.stringify(next) ? prev : next);
    };
    const pedir = () => { if (!raf) raf = requestAnimationFrame(medir); };
    const mutation = new MutationObserver((records) => {
      if (records.some((r) => !raiz.current?.contains(r.target) && !burbuja.current?.contains(r.target))) pedir();
    });
    mutation.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'open', 'class', 'style', 'aria-modal', 'data-guia', 'data-guia-convive'] });
    const resize = new ResizeObserver(pedir);
    if (burbuja.current) resize.observe(burbuja.current);
    const control = buscar(paso.ancla);
    if (control) resize.observe(control);
    window.addEventListener('resize', pedir);
    document.addEventListener('scroll', pedir, true);
    window.visualViewport?.addEventListener('resize', pedir);
    window.visualViewport?.addEventListener('scroll', pedir);
    medir();
    return () => {
      cancelAnimationFrame(raf); mutation.disconnect(); resize.disconnect();
      window.removeEventListener('resize', pedir); document.removeEventListener('scroll', pedir, true);
      window.visualViewport?.removeEventListener('resize', pedir); window.visualViewport?.removeEventListener('scroll', pedir);
    };
    // `paso` cambia de identidad en cada render; `clave` es su identidad real.
  }, [clave, prioridad]);

  const activa = !!paso && !medida.modal && !!medida.posicion && !!medida.objetivo;

  // Foco a la burbuja al aparecer cada paso (ficha, «Accesibilidad»).
  useEffect(() => {
    if (activa) burbuja.current?.focus({ preventScroll: true });
  }, [activa, clave]);

  // El control señalado se describe con la burbuja.
  useEffect(() => {
    if (!activa || !paso) return undefined;
    const control = buscar(paso.ancla);
    if (!control) return undefined;
    const antes = control.getAttribute('aria-describedby');
    const id = burbuja.current?.getAttribute('aria-labelledby');
    if (!id) return undefined;
    control.setAttribute('aria-describedby', `${antes ? `${antes} ` : ''}${id}`);
    return () => { if (antes === null) control.removeAttribute('aria-describedby'); else control.setAttribute('aria-describedby', antes); };
  }, [activa, clave]);

  // Escape = ✕ (y en 2a, «otro momento»). En 3a lo atiende la hoja del ticket: primero se cierra ella.
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !activa || !paso || paso.id === 'ticket') return;
      e.stopPropagation();
      if (paso.pie === 'terminar') onTerminar(); else salir();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [activa, paso, salir, onTerminar]);

  if (!paso || !destino || !destino.isConnected) return null;
  // Una sola burbuja por paso: mientras no está a la vista (una ventana encima, el scroll, la medida) se dibuja
  // invisible, para que el motor sepa su alto; `hidden` la dejaría en 0.
  return createPortal(
    <div ref={raiz} className="guia-capa" data-activa={activa ? '' : undefined} aria-hidden={activa ? undefined : true}>
      <BurbujaGuia
        key={clave}
        paso={paso}
        posicion={activa && medida.posicion ? medida.posicion : { left: 0, top: 0, lado: paso.lado, maxAlto: 9999, centro: 24 }}
        objetivo={activa && medida.objetivo ? medida.objetivo : { left: 0, top: 0, right: 0, bottom: 0 }}
        radio={medida.radio}
        zoom={medida.zoom}
        ancho={medida.ancho || window.innerWidth - 32}
        t={t}
        burbujaRef={burbuja}
        onSalir={salir}
        onSiguiente={siguiente}
        onTerminar={onTerminar}
      />
    </div>,
    destino,
  );
}
