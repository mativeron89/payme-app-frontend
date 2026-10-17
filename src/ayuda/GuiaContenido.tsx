import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMoneyRail } from '../api/moneyRail';
import { useIdioma } from '../i18n/idioma';
import type { PageId } from '../router';
import { BurbujaGuia, FocoGuia, type Primario, type VistaDeGuia } from './BurbujaGuia';
import { posicionGuia, type Caja } from './posicionGuia';
import {
  capituloDe, ESTADO_INICIAL, pasosPresentes, siguienteEstado, vecino,
  type Capitulo, type ContextoDeGuia, type EstadoDeGuia, type Pagos,
} from './recorridoGuia';
import { escucharSenalesDeGuia, type SenalDeGuia } from './senalesGuia';
import './guiaInteractiva.css';

export interface GuiaContenidoProps {
  pagina: PageId; onCerrar: () => void; prioridad: boolean;
  noMostrar: boolean; onNoMostrar: (valor: boolean) => void;
}

const visible = (e: Element) => e.getClientRects().length > 0 && !e.closest('[hidden], [inert], .guia-capa') && getComputedStyle(e).visibility !== 'hidden';
function buscar(selector: string): HTMLElement | null {
  // Un selector armado con datos (el código de la mesa) jamás debe romper la guía.
  try { return Array.from(document.querySelectorAll<HTMLElement>(selector)).find(visible) ?? null; } catch { return null; }
}
const hayModal = () => Array.from(document.querySelectorAll('[aria-modal="true"], dialog[open]')).some(visible);
const atributo = (nombre: string) => buscar(`[${nombre}]`)?.getAttribute(nombre) ?? null;
/** Controles que no se desplazan con el contenido: nunca quedan «más abajo». */
const FIJOS = '.appbar-block, .vj-pie, .hdr, .camara-controles, .camara-arriba';
const FINALES = new Set(['final-mesa', 'mesa-cerrada', 'final-viaje', 'pagado']);

function leerContexto(pagina: PageId, pagos: Pagos, final: SenalDeGuia | null): ContextoDeGuia {
  const centro = buscar('.appbar-center[data-guia-destino]');
  return {
    pagina, pagos, final,
    etapa: atributo('data-guia-etapa'), rol: atributo('data-guia-rol'), modo: atributo('data-guia-modo'),
    destino: centro?.getAttribute('data-guia-destino') ?? null,
    viajeDeHoy: centro?.getAttribute('data-guia-viaje') ?? null,
    hay: (selector) => buscar(selector) !== null,
  };
}

interface Medida {
  capitulo: Capitulo | null;
  objetivo: Caja | null;
  fuera: 'arriba' | 'abajo' | null;
  left: number; top: number; lado: string;
  espacio: Caja; zoom: number; oculta: boolean;
}
const inicial: Medida = {
  capitulo: null, objetivo: null, fuera: null, left: 12, top: 12, lado: 'sin-control',
  espacio: { left: 12, top: 12, right: 360, bottom: 700 }, zoom: 1, oculta: true,
};

/**
 * El motor de «Tu turno». Sin API, router imperativo ni callbacks de negocio: lee
 * el DOM descriptivo (`data-guia*`), los avisos de guardado de `senalesGuia` y el
 * riel de pagos que la app ya pidió, y decide qué paso mostrar. Nunca toca un
 * control: el único scroll es el que pide «Mostrar».
 */
export function GuiaContenido({ pagina, onCerrar, prioridad, noMostrar, onNoMostrar }: GuiaContenidoProps) {
  const { t } = useIdioma();
  // `App` ya pide la capability: este hook la lee del mismo almacén, sin pedidos nuevos.
  const rail = useMoneyRail();
  const pagos: Pagos = rail.status === 'authoritative' ? (rail.puedeCargarTarjeta ? 'si' : 'no') : 'pendiente';
  const [estado, setEstado] = useState<EstadoDeGuia>(ESTADO_INICIAL);
  const estadoRef = useRef(estado);
  const [final, setFinal] = useState<{ senal: SenalDeGuia; vista: boolean } | null>(null);
  const [medida, setMedida] = useState<Medida>(inicial);
  const panel = useRef<HTMLElement>(null);
  const titulo = useRef<HTMLHeadingElement>(null);
  const chip = useRef<HTMLButtonElement>(null);
  const raiz = useRef<HTMLDivElement>(null);
  const focoInicial = useRef(false);
  const enfocar = useRef<'titulo' | 'chip' | null>(null);
  const paginaVista = useRef(pagina);

  const cambiar = useCallback((e: EstadoDeGuia, foco: 'titulo' | 'chip' | null = null) => {
    estadoRef.current = e; enfocar.current = foco; setEstado(e);
  }, []);

  useEffect(() => escucharSenalesDeGuia((senal) => setFinal({ senal, vista: false })), []);
  // Un final ya mostrado no vuelve: al salir de su pantalla, el recorrido sigue.
  useEffect(() => {
    if (paginaVista.current === pagina) return;
    paginaVista.current = pagina;
    setFinal((f) => (f?.vista ? null : f));
  }, [pagina]);
  useEffect(() => {
    if (FINALES.has(estado.capitulo)) setFinal((f) => (f && !f.vista ? { ...f, vista: true } : f));
  }, [estado.capitulo]);

  const senal = final?.senal ?? null;
  useLayoutEffect(() => {
    let raf = 0;
    const medir = () => {
      raf = 0;
      const oculta = prioridad || hayModal();
      const capitulo = capituloDe(leerContexto(pagina, pagos, senal), t);
      const e = siguienteEstado(capitulo, estadoRef.current);
      if (e !== estadoRef.current) cambiar(e);
      const paso = capitulo.pasos.find((p) => p.id === e.paso) ?? null;
      const objetivo = paso?.ancla ? buscar(paso.ancla) : null;
      const zoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
      const vw = window.visualViewport;
      const izquierda = vw?.offsetLeft ?? 0, arriba = vw?.offsetTop ?? 0;
      const ancho = vw?.width ?? window.innerWidth, alto = vw?.height ?? window.innerHeight;
      const screen = document.querySelector('.screen');
      const techo = Math.max(arriba, screen?.querySelector('.hdr')?.getBoundingClientRect().bottom ?? arriba);
      // El círculo central sobresale de la barra: su borde superior también es piso.
      const pies = Array.from(document.querySelectorAll<HTMLElement>('.appbar-block, .appbar-fab, .vj-pie')).filter(visible);
      const piso = Math.min(arriba + alto, ...pies.map((p) => p.getBoundingClientRect().top));
      const espacio = { left: izquierda + 12, top: techo + 8, right: izquierda + ancho - 12, bottom: Math.max(techo + 80, piso - 12) };
      const control = objetivo?.getBoundingClientRect();
      const circulo = objetivo?.querySelector('.appbar-fab')?.getBoundingClientRect();
      const caja = control && circulo ? { left: Math.min(control.left, circulo.left), right: Math.max(control.right, circulo.right), top: Math.min(control.top, circulo.top), bottom: Math.max(control.bottom, circulo.bottom) } : control;
      // Un control del contenido tapado por la cabecera o por el pie también está «fuera».
      const fijo = !!objetivo?.closest(FIJOS);
      const desde = fijo ? arriba : techo, hasta = fijo ? arriba + alto : piso;
      const fuera = !caja ? null : caja.top >= hasta ? 'abajo' : caja.bottom <= desde ? 'arriba' : null;
      const rect = caja && !fuera ? { left: caja.left, top: caja.top, right: caja.right, bottom: caja.bottom } : null;
      const burbuja = panel.current?.getBoundingClientRect();
      const w = burbuja?.width ?? 0, h = burbuja?.height ?? 0;
      const pos = rect && burbuja ? posicionGuia(rect, espacio, w, h) : null;
      // Sin lugar junto al control, o sin control a la vista: arriba o abajo del espacio libre.
      const abajo = fuera === 'abajo' || (!fuera && (!rect || (rect.top + rect.bottom) / 2 < (espacio.top + espacio.bottom) / 2));
      const left = pos?.left ?? espacio.left;
      const top = pos?.top ?? (abajo ? Math.max(espacio.top, espacio.bottom - h) : espacio.top);
      const lado = pos?.lado ?? (fuera ? `fuera-${fuera}` : rect ? 'sin-lugar' : 'sin-control');
      const next: Medida = { capitulo, objetivo: rect, fuera, left, top, lado, espacio, zoom, oculta };
      setMedida((prev) => JSON.stringify(prev) === JSON.stringify(next) ? prev : next);
    };
    const pedir = () => { if (!raf) raf = requestAnimationFrame(medir); };
    const mutation = new MutationObserver((records) => {
      if (records.some((r) => !raiz.current?.contains(r.target))) pedir();
    });
    mutation.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: [
      'hidden', 'open', 'class', 'style', 'aria-modal', 'aria-expanded', 'aria-label', 'disabled',
      'data-guia', 'data-guia-etapa', 'data-guia-rol', 'data-guia-modo', 'data-guia-destino', 'data-guia-viaje', 'data-guia-mesa',
    ] });
    const resize = new ResizeObserver(pedir);
    if (panel.current) resize.observe(panel.current);
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
  }, [pagina, pagos, senal, prioridad, estado, t, cambiar]);

  const capitulo = medida.capitulo;
  const paso = capitulo?.pasos.find((p) => p.id === estado.paso && p.presente) ?? null;
  const presentes = capitulo ? pasosPresentes(capitulo) : [];
  const numero = paso ? presentes.indexOf(paso) + 1 : 0;
  const ultimo = numero === presentes.length;
  const plegado = estado.plegado && paso?.tipo === 'tu-turno';
  const visibleAhora = !medida.oculta && !!paso;

  useEffect(() => {
    if (!visibleAhora) return;
    if (!focoInicial.current) { focoInicial.current = true; titulo.current?.focus({ preventScroll: true }); return; }
    const destino = enfocar.current === 'chip' ? chip.current : enfocar.current === 'titulo' ? titulo.current : null;
    enfocar.current = null;
    destino?.focus({ preventScroll: true });
  }, [visibleAhora, estado]);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !prioridad && !hayModal()) { e.stopPropagation(); onCerrar(); }
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onCerrar, prioridad]);
  const describe = visibleAhora && !plegado && !!medida.objetivo && paso?.ancla ? paso.ancla : null;
  useEffect(() => {
    if (!describe) return;
    const objetivo = buscar(describe);
    if (!objetivo) return;
    const antes = objetivo.getAttribute('aria-describedby');
    objetivo.setAttribute('aria-describedby', `${antes ? `${antes} ` : ''}guia-explicacion`);
    return () => { if (antes === null) objetivo.removeAttribute('aria-describedby'); else objetivo.setAttribute('aria-describedby', antes); };
  }, [describe, estado.paso]);

  const ir = (sentido: 1 | -1) => {
    if (!capitulo) return;
    const otro = vecino(capitulo, estado.paso, sentido);
    if (otro) cambiar({ capitulo: capitulo.id, paso: otro.id, plegado: false, tocado: true }, 'titulo');
  };
  const primario: Primario | null = !paso || paso.tipo === 'espera' ? null
    : paso.tipo === 'tu-turno' ? 'entendido'
      : paso.tipo === 'final' || ultimo ? 'terminar' : 'siguiente';
  const alPrimario = () => {
    if (primario === 'siguiente') ir(1);
    else if (primario === 'entendido') cambiar({ ...estado, plegado: true, tocado: true }, 'chip');
    else onCerrar();
  };
  const mostrar = () => {
    // Sólo cuando la persona lo pide; jamás al entrar ni al navegar por la app.
    if (paso?.ancla) buscar(paso.ancla)?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
  };

  const { espacio, zoom } = medida;
  const maxWidth = Math.max(120, (espacio.right - espacio.left) / zoom);
  const maxHeight = Math.max(80, (espacio.bottom - espacio.top) / zoom);
  // Provisorio hasta el diseño: en horizontal con poca altura, más ancha para que el texto entre en menos líneas.
  const ancho = Math.min(window.innerWidth <= 600 ? 328 : window.innerHeight <= 480 ? 760 : 560, maxWidth);
  const vista: VistaDeGuia | null = paso && capitulo ? {
    forma: plegado ? 'achicada' : 'completa', paso, etapa: capitulo.etapa, conPagar: pagos === 'si',
    numero, total: presentes.length, fuera: medida.fuera, primario, atras: numero > 1,
  } : null;
  const target = visibleAhora ? medida.objetivo : null;
  return createPortal(<div ref={raiz} className="guia-capa" hidden={!visibleAhora}>
    {target && paso?.ancla && <FocoGuia objetivo={paso.id} ancla={paso.ancla} caja={{ left: (target.left - 4) / zoom, top: (target.top - 4) / zoom, width: (target.right - target.left + 8) / zoom, height: (target.bottom - target.top + 8) / zoom }} />}
    {vista && <BurbujaGuia
      vista={vista} lado={medida.lado} noMostrar={noMostrar} onNoMostrar={onNoMostrar} onCerrar={onCerrar}
      onAtras={() => ir(-1)} onPrimario={alPrimario} onMostrar={mostrar}
      onAbrir={() => cambiar({ ...estado, plegado: false }, 'titulo')}
      panelRef={panel} tituloRef={titulo} chipRef={chip}
      estilo={{ left: medida.left / zoom, top: medida.top / zoom, width: plegado ? undefined : ancho, maxWidth, maxHeight }}
    />}
  </div>, document.body);
}
