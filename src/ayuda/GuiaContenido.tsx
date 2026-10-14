import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../components/Icon';
import { useIdioma } from '../i18n/idioma';
import type { PageId } from '../router';
import { posicionGuia, type Caja, type Posicion } from './posicionGuia';
import './guiaInteractiva.css';

export interface GuiaContenidoProps { pagina: PageId; onCerrar: () => void }
interface Paso { id: string; titulo: string; texto: string }
type T = (s: string, ...args: unknown[]) => string;
function catalogo(pagina: PageId, t: T): Paso[] {
  const p = (id: string, titulo: string, texto: string): Paso => ({ id, titulo, texto });
  const camara = p('camara', t('Escanear'), t('Toca la cámara para fotografiar un ticket y revisar sus datos.'));
  const reparto = p('reparto', t('Decide cómo dividir'), t('Divide por consumo, en partes iguales o por el total.'));
  const porcion = p('porcion', t('Elige tu porción'), t('Marca la porción que consumiste cuando compartas un plato.'));
  const parte = p('mi-parte', t('Revisa tu parte'), t('Este es el importe de tu selección según el reparto. Revisa lo elegido antes de confirmarlo.'));
  const pago = p('quien-pago', t('¿Quién pagó?'), t('Marca quién pagó este gasto. Puedes indicar varias personas y ajustar los montos con los controles de la pantalla.'));
  if (pagina === 'home') return [camara,
    p('tab-viajes', t('Viajes'), t('Aquí encuentras tus viajes. Toca la pestaña y abre uno para conocer sus controles.')),
    p('nav-mesas', t('Mesas'), t('Abre una mesa en la que participas. La guía se adapta a los controles disponibles para tu rol.'))];
  if (pagina === 'mas') return [p('nav-home', t('Empieza en Inicio'), t('Toca Inicio para recorrer restaurantes o viajes. La guía permanece abierta y puedes cerrarla cuando quieras.'))];
  if (pagina === 'scan') return [
    p('foto', t('Sacar foto'), t('Toca este botón para abrir la cámara. Puedes usar también la galería de esta pantalla.')),
    p('revisar-ticket', t('Escanea y revisa'), t('Abre el ticket para revisar platos, cantidades y total antes de continuar.')),
    reparto, p('personas', t('Cuántas personas'), t('Indica cuántas personas son con los botones − y +. El número lo eliges tú.')),
    p('continuar', t('Continuar'), t('Cuando hayas revisado el ticket y el reparto, este control continúa el flujo de la mesa.'))];
  if (pagina === 'mesa') return [p('consumos', t('Tus consumos'), t('Abre tus consumos y toca los platos que te corresponden. Cada persona confirma su propia selección.')),
    porcion, parte, p('invitar', t('Invita a la mesa'), t('Como organizador, puedes invitar a tus amigos desde este control.')),
    p('continuar', t('Confirma tu selección'), t('Revisa los platos y las porciones que elegiste. Toca Listo para confirmar tu selección.'))];
  if (pagina === 'viaje') return [camara, p('agregar-gasto', t('Agregar gasto'), t('Registra un gasto sin foto. Tú escribes la descripción, el monto y quién pagó.')),
    p('mi-balance', t('Tu balance'), t('Es lo pagado menos lo consumido. Puede cambiar mientras agregan gastos o eligen consumos.')),
    p('balance', t('Consulta el balance'), t('Abre el balance para revisar consumos y cuánto pagó cada miembro del viaje.'))];
  if (pagina === 'viaje-gasto') return [p('descripcion-gasto', t('Descripción'), t('Escribe qué gasto quieres registrar. Puedes seguir editando con la guía abierta.')),
    p('monto-gasto', t('Monto'), t('Escribe el total del gasto que quieres compartir.')), pago,
    p('guardar-gasto', t('Revisa antes de guardar'), t('Revisa la descripción, el total y quién pagó. Toca Listo para registrar el gasto.'))];
  if (pagina === 'viaje-ticket-nuevo') return [pago, reparto];
  if (pagina === 'viaje-ticket') return [p('elegir-consumo', t('Elige lo tuyo'), t('Toca un plato disponible para elegirlo. Si lo compartieron, después podrás indicar tu porción.')),
    porcion, parte, p('listo-consumos', t('Confirma tu selección'), t('Revisa los platos y las porciones que elegiste. Toca Listo para confirmar tu selección.'))];
  if (pagina === 'viaje-balance') return [p('tab-consumos', t('Consumos'), t('Aquí están los consumos del viaje. Abre uno para revisar su ticket y reparto.')),
    p('tab-miembros', t('Miembros'), t('Esta pestaña muestra cuánto pagó cada persona, no cuánto le corresponde consumir.'))];
  return [];
}
const visible = (e: HTMLElement) => e.getClientRects().length > 0 && !e.closest('[hidden], [inert]') && getComputedStyle(e).visibility !== 'hidden';
const buscar = (id: string) => Array.from(document.querySelectorAll<HTMLElement>(`[data-guia="${id}"]`)).find(visible) ?? null;
const hayModal = () => Array.from(document.querySelectorAll<HTMLElement>('[aria-modal="true"], dialog[open]')).some(visible);
interface Medida { objetivo: Caja | null; posicion: Posicion | null; espacio: Caja; zoom: number; modal: boolean }
const inicial: Medida = { objetivo: null, posicion: null, espacio: { left: 12, top: 12, right: 360, bottom: 700 }, zoom: 1, modal: false };

/** Sin API, router imperativo ni callbacks de negocio. Sólo DOM descriptivo y estado efímero del tutorial. */
export function GuiaContenido({ pagina, onCerrar }: GuiaContenidoProps) {
  const { t } = useIdioma();
  const pasos = catalogo(pagina, t);
  const [disponibles, setDisponibles] = useState<string[]>([]);
  const [elegido, setElegido] = useState<string | null>(null);
  const [pausada, setPausada] = useState(false);
  const [medida, setMedida] = useState<Medida>(inicial);
  const panel = useRef<HTMLElement>(null);
  const titulo = useRef<HTMLHeadingElement>(null);
  const raiz = useRef<HTMLDivElement>(null);
  const focoInicial = useRef(false);
  const indices = pasos.filter((p) => disponibles.includes(p.id));
  const indice = Math.max(0, indices.findIndex((p) => p.id === elegido));
  const paso = indices[indice];
  const clave = paso?.id ?? '';
  const listaIds = pasos.map((p) => p.id).join(',');

  useEffect(() => { setElegido(null); }, [pagina]);
  useLayoutEffect(() => {
    let raf = 0;
    const medir = () => {
      raf = 0;
      const ids = listaIds.split(',').filter((id) => id && buscar(id));
      setDisponibles((prev) => prev.join(',') === ids.join(',') ? prev : ids);
      const modal = hayModal();
      if (modal) setPausada(true);
      const objetivo = clave ? buscar(clave) : null;
      const zoom = Number.parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
      const vw = window.visualViewport;
      const izquierda = vw?.offsetLeft ?? 0, arriba = vw?.offsetTop ?? 0;
      const ancho = vw?.width ?? window.innerWidth, alto = vw?.height ?? window.innerHeight;
      const screen = document.querySelector('.screen');
      const techo = Math.max(arriba, screen?.querySelector('.hdr')?.getBoundingClientRect().bottom ?? arriba);
      const pies = Array.from(document.querySelectorAll<HTMLElement>('.appbar-block, .appbar-fab, .vj-pie')).filter(visible);
      const piso = Math.min(arriba + alto, ...pies.map((p) => p.getBoundingClientRect().top));
      const espacio = { left: izquierda + 12, top: techo + 8, right: izquierda + ancho - 12, bottom: Math.max(techo + 80, piso - 12) };
      const cajaControl = objetivo?.getBoundingClientRect();
      const circulo = objetivo?.querySelector('.appbar-fab')?.getBoundingClientRect();
      const caja = cajaControl && circulo ? { left: Math.min(cajaControl.left, circulo.left), right: Math.max(cajaControl.right, circulo.right), top: Math.min(cajaControl.top, circulo.top), bottom: Math.max(cajaControl.bottom, circulo.bottom) } : cajaControl;
      const rect = caja && caja.right > izquierda && caja.left < izquierda + ancho && caja.bottom > arriba && caja.top < arriba + alto
        ? { left: caja.left, top: caja.top, right: caja.right, bottom: caja.bottom } : null;
      const burbuja = panel.current?.getBoundingClientRect();
      // El aviso aparece sólo en pausa: no debe agrandar la medida que decide si podemos retomarla.
      const nota = panel.current?.querySelector<HTMLElement>('.guia-nota');
      const extra = nota ? nota.getBoundingClientRect().height + (Number.parseFloat(getComputedStyle(nota).marginBottom) || 0) * zoom : 0;
      const posicion = rect && burbuja ? posicionGuia(rect, espacio, burbuja.width, burbuja.height - extra) : null;
      const next = { objetivo: rect, posicion, espacio, zoom, modal };
      setMedida((prev) => JSON.stringify(prev) === JSON.stringify(next) ? prev : next);
    };
    const pedir = () => { if (!raf) raf = requestAnimationFrame(medir); };
    const mutation = new MutationObserver((records) => {
      if (records.some((r) => !raiz.current?.contains(r.target))) pedir();
    });
    mutation.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'open', 'class', 'style', 'aria-modal', 'data-guia'] });
    const resize = new ResizeObserver(pedir);
    if (panel.current) resize.observe(panel.current);
    const objetivo = clave ? buscar(clave) : null;
    if (objetivo) resize.observe(objetivo);
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
  }, [clave, listaIds, pausada]);
  useEffect(() => {
    if (!focoInicial.current && !medida.modal) { titulo.current?.focus({ preventScroll: true }); focoInicial.current = true; }
  }, [medida.modal]);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !hayModal()) { e.stopPropagation(); onCerrar(); }
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onCerrar]);
  useEffect(() => {
    if (!clave || pausada || medida.modal || !medida.posicion) return;
    const objetivo = buscar(clave);
    if (!objetivo) return;
    const antes = objetivo.getAttribute('aria-describedby');
    objetivo.setAttribute('aria-describedby', `${antes ? `${antes} ` : ''}guia-explicacion`);
    return () => { if (antes === null) objetivo.removeAttribute('aria-describedby'); else objetivo.setAttribute('aria-describedby', antes); };
  }, [clave, pausada, medida.modal, medida.posicion]);

  function ir(p: Paso | undefined) {
    if (!p) return;
    setElegido(p.id);
    const objetivo = buscar(p.id);
    // Sólo al pedir otro paso; jamás al login ni al navegar por la app.
    objetivo?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
  }
  const { espacio, zoom } = medida;
  const activa = !pausada && !!paso && !!medida.posicion && !!medida.objetivo;
  const posicion = activa ? medida.posicion : null;
  const left = posicion?.left ?? espacio.left;
  const top = posicion?.top ?? espacio.top;
  const maxWidth = Math.max(120, (espacio.right - espacio.left) / zoom);
  const maxHeight = Math.max(80, (espacio.bottom - espacio.top) / zoom);
  const target = activa ? medida.objetivo : null;
  return createPortal(<div ref={raiz} className="guia-capa" hidden={medida.modal}>
    {target && <div className="guia-foco" aria-hidden="true" data-objetivo={clave} style={{ left: (target.left - 4) / zoom, top: (target.top - 4) / zoom, width: (target.right - target.left + 8) / zoom, height: (target.bottom - target.top + 8) / zoom }} />}
    <section ref={panel} className="guia-burbuja" role="region" aria-label={t('Guía interactiva')} data-lado={posicion?.lado ?? 'pausa'}
      style={{ left: left / zoom, top: top / zoom, width: Math.min(window.innerWidth > 600 ? 560 : 328, maxWidth), maxHeight }}>
      <div className="guia-cabeza">
        <span className="guia-progreso">{paso ? t('{0} de {1} · en esta pantalla', indice + 1, indices.length) : t('Guía en pausa')}</span>
        <button type="button" className="guia-cerrar" onClick={onCerrar} aria-label={t('Cerrar guía')}><Icon name="x" size={18} /></button>
      </div>
      <div aria-live="polite" aria-atomic="true">
        <h2 ref={titulo} tabIndex={-1}>{pausada ? t('Continúa cuando quieras') : paso?.titulo ?? t('Abre una mesa o un viaje')}</h2>
        <p id="guia-explicacion">{pausada ? t('La guía se pausó para dejarte usar la pantalla. Retómala cuando estés listo.')
          : paso?.texto ?? t('Esta pantalla no tiene pasos disponibles. Sigue usando la app; la guía acompaña los controles de restaurantes y viajes.')}</p>
      </div>
      {!pausada && paso && !activa && <p className="guia-nota">{t('Desplaza la pantalla para ver el control. También puedes pasar al siguiente paso o cerrar la guía.')}</p>}
      <div className="guia-acciones">
        {pausada ? <button type="button" className="guia-siguiente" onClick={() => setPausada(false)}>{t('Retomar guía')}</button> : <>
          <button type="button" disabled={indice === 0} onClick={() => ir(indices[indice - 1])}>{t('Atrás')}</button>
          {paso && <button type="button" className="guia-siguiente" onClick={() => indice < indices.length - 1 ? ir(indices[indice + 1]) : onCerrar()}>{indice < indices.length - 1 ? t('Siguiente') : t('Terminar guía')}</button>}
        </>}
      </div>
    </section>
  </div>, document.body);
}
