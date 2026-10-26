import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MutableRefObject, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useCapacidadFotoDelTicket, type FotoDelTicket } from '../api/fotoDelTicket';
import { useFotoDelTicket, type EstadoDeFoto, type OrigenDeFoto } from '../api/fotosDeTickets';
import type { StoredSession } from '../api/storage';
import { useIdioma } from '../i18n/idioma';
import { Icon, type IconName } from './Icon';
import { useHojaModal } from './useHojaModal';

/**
 * D466 · E · el visor del ticket, a pantalla completa (Mati: «Vamos por AE»).
 * D481 · con el paquete de Claude Design (1c–1h, 1k; Mati aceptó las ocho
 * recomendaciones):
 *
 * - **Nada encima del papel**, tampoco con zoom: las flechas van en una franja
 *   de 60 px entre la foto y el pie, a los lados de los puntos. La que no
 *   corresponde deja su lugar vacío y los puntos no se mueven.
 * - **La pista de zoom es una píldora** abajo del escenario: se va a los 4 s o
 *   al primer zoom, y después del primer zoom no vuelve (un booleano en el
 *   teléfono, P5; nunca la foto). La descripción accesible sigue.
 * - **Vencida (1d):** la miniatura a su tamaño, nunca agrandada, sin zoom ni
 *   pista, y el aviso de los 90 días debajo de la foto, sólo cuando se ve.
 * - **Cargando (1e):** un esqueleto 4:3. **Error (1f):** «No pudimos cargar la
 *   foto.» y Reintentar. En ninguno de los dos va el aviso de los 90 días.
 * - **«Ver consumos» (1h)** lo resuelve quien abre el visor: en Mesas, la hoja
 *   del detalle digital se abre ENCIMA (`TicketDigitalDialog encima`) y su ✕
 *   vuelve a la foto; en Viajes, cierra el visor.
 *
 * Se conserva: diálogo modal (`useHojaModal`, el foco entra en «Cerrar», Tab
 * no sale, Escape cierra, la app queda inerte), las flechas del teclado, `+` y
 * `-`, las fotos sólo en memoria (`useFotoDelTicket`) y el foco de vuelta a
 * quien lo abrió. Sin dependencias nuevas: el zoom son eventos de puntero.
 */

export interface TicketDelVisor {
  readonly clave: string;
  readonly origen: OrigenDeFoto;
  readonly foto: FotoDelTicket;
  readonly titulo: string;
  /** Lo que va al lado del título (el monto), o `null`. */
  readonly monto: string | null;
  /** Las líneas de abajo: la fecha, el estado, lo elegido. */
  readonly detalle: readonly string[];
}

const ESCALA_MAXIMA = 4;
const ESCALA_DOBLE_TOQUE = 2.5;
const UMBRAL_DESLIZAR = 60;
const DOBLE_TOQUE_MS = 300;
/** D481 · 1c · lo que dura la píldora de zoom a la vista. */
export const PISTA_DE_ZOOM_MS = 4000;

/**
 * D481 · P5 · «ya hizo zoom», guardado en el teléfono: un `1` y nada más. Nunca
 * la foto, la URL ni la mesa. Si el almacenamiento no está (navegación privada),
 * la píldora sale como la primera vez.
 */
export const CLAVE_YA_HIZO_ZOOM = 'payme.app.visor.ya_hizo_zoom.v1';

export function yaHizoZoom(): boolean {
  try { return localStorage.getItem(CLAVE_YA_HIZO_ZOOM) === '1'; } catch { return false; }
}

export function recordarQueHizoZoom(): void {
  try { localStorage.setItem(CLAVE_YA_HIZO_ZOOM, '1'); } catch { /* sin almacenamiento: la próxima vez vuelve la píldora */ }
}

interface Vista {
  readonly escala: number;
  readonly x: number;
  readonly y: number;
}

const SIN_ZOOM: Vista = { escala: 1, x: 0, y: 0 };

function acotar(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function VisorDelTicket({
  session,
  tickets,
  indiceInicial,
  titulo,
  onCerrar,
  onVerConsumos,
  returnFocusRef,
}: {
  session: StoredSession | null;
  tickets: readonly TicketDelVisor[];
  indiceInicial: number;
  /** El encabezado: «Ticket 1 de 4 · octubre de 2026» o, con uno solo, «Foto del ticket». */
  titulo: (indice: number, total: number) => string;
  onCerrar: () => void;
  /** «Ver consumos»: con el botón, para que la hoja que se abra encima le devuelva el foco. */
  onVerConsumos: ((ticket: TicketDelVisor, boton: HTMLButtonElement) => void) | null;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const { t } = useIdioma();
  const capacidad = useCapacidadFotoDelTicket();
  const [indice, setIndice] = useState(() => acotar(indiceInicial, 0, Math.max(0, tickets.length - 1)));
  const ticket = tickets[acotar(indice, 0, Math.max(0, tickets.length - 1))];
  const hoja = useRef<HTMLDivElement | null>(null);
  const cerrar = useRef<HTMLButtonElement | null>(null);
  useHojaModal(hoja, cerrar, onCerrar);

  // El foco vuelve a quien lo abrió (la miniatura), como el detalle digital.
  useEffect(() => {
    const disparador = returnFocusRef?.current ?? null;
    return () => {
      if (disparador && disparador.isConnected) disparador.focus();
    };
  }, [returnFocusRef]);

  const [vista, setVista] = useState<Vista>(SIN_ZOOM);
  const [arrastre, setArrastre] = useState(0);
  const total = tickets.length;
  const ir = useCallback((paso: -1 | 1) => {
    setIndice((i) => acotar(i + paso, 0, total - 1));
    setVista(SIN_ZOOM);
    setArrastre(0);
  }, [total]);

  // Las fotos: la completa si existe; la miniatura siempre (es lo que se ve mientras tanto y si la completa venció).
  const miniatura = useFotoDelTicket(session, ticket?.origen ?? null, 'thumb');
  const completa = useFotoDelTicket(session, ticket?.foto.full ? ticket.origen : null, 'full');
  const completaVencida = !!ticket && (!ticket.foto.full || completa.estado === 'sin_foto');
  const url = (completaVencida ? null : completa.url) ?? miniatura.url;
  const estado: EstadoDeFoto = url
    ? 'lista'
    : miniatura.estado === 'error' || (!completaVencida && completa.estado === 'error')
      ? 'error'
      : miniatura.estado === 'sin_foto' && completaVencida
        ? 'sin_foto'
        : 'cargando';
  /** 1d · la vencida no se acerca: se ve a su tamaño. */
  const conZoom = estado === 'lista' && !completaVencida;

  // ─── D481 · la píldora de zoom (P5) ──────────────────────────────────────
  const [zoomHecho, setZoomHecho] = useState(yaHizoZoom);
  const [pistaVencio, setPistaVencio] = useState(false);
  // Los 4 s cuentan desde que hay una foto que se puede acercar a la vista (no desde que abre: la foto puede tardar).
  const pistaEnMarcha = conZoom && !zoomHecho && !pistaVencio;
  useEffect(() => {
    if (!pistaEnMarcha) return undefined;
    const reloj = window.setTimeout(() => setPistaVencio(true), PISTA_DE_ZOOM_MS);
    return () => window.clearTimeout(reloj);
  }, [pistaEnMarcha]);
  useEffect(() => {
    if (vista.escala > 1 && !zoomHecho) {
      setZoomHecho(true);
      recordarQueHizoZoom();
    }
  }, [vista.escala, zoomHecho]);
  const pistaVisible = pistaEnMarcha;

  // ─── El zoom y el gesto ──────────────────────────────────────────────────
  const punteros = useRef(new Map<number, { x: number; y: number }>());
  const inicio = useRef<{ distancia: number; escala: number; x: number; y: number; vista: Vista } | null>(null);
  const ultimoToque = useRef<{ t: number; x: number; y: number } | null>(null);

  const alBajar = (e: ReactPointerEvent<HTMLDivElement>) => {
    // «Reintentar» es un botón: capturar su puntero se comería el clic.
    if (e.target instanceof Element && e.target.closest('button')) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    punteros.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = [...punteros.current.values()];
    if (p.length === 2) {
      inicio.current = {
        distancia: Math.hypot(p[0]!.x - p[1]!.x, p[0]!.y - p[1]!.y) || 1,
        escala: vista.escala, x: 0, y: 0, vista,
      };
    } else if (p.length === 1) {
      inicio.current = { distancia: 0, escala: vista.escala, x: e.clientX, y: e.clientY, vista };
    }
  };

  const alMover = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!punteros.current.has(e.pointerId)) return;
    punteros.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = [...punteros.current.values()];
    const desde = inicio.current;
    if (!desde) return;
    if (p.length >= 2 && desde.distancia > 0) {
      if (!conZoom) return;
      const d = Math.hypot(p[0]!.x - p[1]!.x, p[0]!.y - p[1]!.y);
      const escala = acotar(desde.escala * (d / desde.distancia), 1, ESCALA_MAXIMA);
      setVista(escala === 1 ? SIN_ZOOM : { ...desde.vista, escala });
      return;
    }
    if (p.length === 1) {
      const dx = e.clientX - desde.x;
      const dy = e.clientY - desde.y;
      if (desde.vista.escala > 1) setVista({ ...desde.vista, x: desde.vista.x + dx, y: desde.vista.y + dy });
      else if (total > 1) setArrastre(dx);
    }
  };

  const alSoltar = (e: ReactPointerEvent<HTMLDivElement>) => {
    const habia = punteros.current.size;
    punteros.current.delete(e.pointerId);
    const desde = inicio.current;
    if (habia === 1 && desde && desde.distancia === 0) {
      const dx = e.clientX - desde.x;
      const dy = e.clientY - desde.y;
      if (desde.vista.escala === 1 && Math.abs(dx) > UMBRAL_DESLIZAR && Math.abs(dx) > Math.abs(dy)) {
        ir(dx < 0 ? 1 : -1);
        ultimoToque.current = null;
        inicio.current = null;
        return;
      }
      // Un toque quieto: ¿el segundo de un doble toque?
      if (Math.hypot(dx, dy) < 10 && conZoom) {
        const ahora = e.timeStamp;
        const previo = ultimoToque.current;
        if (previo && ahora - previo.t < DOBLE_TOQUE_MS && Math.hypot(e.clientX - previo.x, e.clientY - previo.y) < 30) {
          setVista((v) => (v.escala > 1 ? SIN_ZOOM : { escala: ESCALA_DOBLE_TOQUE, x: 0, y: 0 }));
          ultimoToque.current = null;
        } else {
          ultimoToque.current = { t: ahora, x: e.clientX, y: e.clientY };
        }
      }
    }
    setArrastre(0);
    if (punteros.current.size === 0) inicio.current = null;
    else {
      const [resto] = [...punteros.current.values()];
      inicio.current = resto ? { distancia: 0, escala: vista.escala, x: resto.x, y: resto.y, vista } : null;
    }
  };

  const alTeclado = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft' && total > 1) { e.preventDefault(); ir(-1); }
    else if (e.key === 'ArrowRight' && total > 1) { e.preventDefault(); ir(1); }
    else if ((e.key === '+' || e.key === '=') && conZoom) {
      e.preventDefault();
      setVista((v) => ({ ...v, escala: acotar(v.escala + 0.5, 1, ESCALA_MAXIMA) }));
    } else if (e.key === '-' && conZoom) {
      e.preventDefault();
      setVista((v) => (v.escala - 0.5 <= 1 ? SIN_ZOOM : { ...v, escala: v.escala - 0.5 }));
    }
  };

  if (!ticket) return null;
  const dias = capacidad?.diasDeLaCompleta ?? null;
  const avisoVencida = completaVencida
    ? (capacidad?.modo === 'full_retained'
      ? (dias !== null ? t('La foto completa se borró a los {0} días.', dias) : t('La foto completa ya se borró.'))
      : t('De este ticket sólo se guardó una foto chica.'))
    : null;

  const foto = url ? (
    <img
      className={completaVencida ? 'visor-ticket-foto visor-ticket-foto--vencida' : 'visor-ticket-foto'}
      src={url}
      alt={t('Foto del ticket de {0}', ticket.titulo)}
      // Cuál se ve: la completa, o la miniatura (mientras llega la completa, o si venció).
      data-tamano={!completaVencida && completa.url ? 'full' : 'thumb'}
      draggable={false}
      style={{ transform: `translate(${vista.x + arrastre}px, ${vista.y}px) scale(${vista.escala})` }}
    />
  ) : null;

  return createPortal(
    <div className="visor-ticket" ref={hoja} role="dialog" aria-modal="true" aria-labelledby="visor-ticket-titulo" onKeyDown={alTeclado}>
      <div className="visor-ticket-columna">
        <div className="visor-ticket-cabecera">
          <button
            ref={cerrar}
            type="button"
            className="visor-ticket-x"
            aria-label={t('Cerrar')}
            onClick={onCerrar}
          >
            <Icon name="x-circle" size={24} />
          </button>
          <h2 id="visor-ticket-titulo" className="visor-ticket-titulo">{titulo(indice, total)}</h2>
        </div>

        <div
          className="visor-ticket-escenario"
          onPointerDown={alBajar}
          onPointerMove={alMover}
          onPointerUp={alSoltar}
          onPointerCancel={alSoltar}
          aria-describedby={conZoom ? 'visor-ticket-ayuda' : undefined}
        >
          {estado === 'lista' && completaVencida ? (
            // 1d · la miniatura a su tamaño y, pegado debajo, el aviso: sólo cuando la foto se ve.
            <div className="visor-ticket-vencida">
              {foto}
              {avisoVencida && <p className="visor-ticket-aviso" role="note">{avisoVencida}</p>}
            </div>
          ) : estado === 'lista' ? foto : estado === 'cargando' ? (
            <div className="visor-ticket-esqueleto" role="status">
              <span className="visor-ticket-esqueleto-papel" aria-hidden="true" />
              <p>{t('Cargando la foto…')}</p>
            </div>
          ) : estado === 'sin_foto' ? (
            <div className="visor-ticket-estado" role="status">{t('Esta foto ya no está disponible.')}</div>
          ) : (
            <div className="visor-ticket-estado" role="alert">
              <p>{t('No pudimos cargar la foto.')}</p>
              <button
                type="button"
                className="visor-ticket-reintentar"
                onClick={() => { miniatura.reintentar(); completa.reintentar(); }}
              >
                {t('Reintentar')}
              </button>
            </div>
          )}
          {/* La descripción accesible sigue aunque la píldora se vaya. */}
          {conZoom && <span id="visor-ticket-ayuda" className="visor-ticket-oculto">{t('Pellizca o toca dos veces para hacer zoom.')}</span>}
          {pistaVisible && (
            <div className="visor-ticket-pista" aria-hidden="true">
              <Icon name="search" size={14} />
              <span>{t('Pellizca o toca dos veces para hacer zoom.')}</span>
            </div>
          )}
        </div>

        {total > 1 && (
          <div className="visor-ticket-franja">
            {indice > 0 ? (
              <button type="button" className="visor-ticket-flecha visor-ticket-flecha--antes" aria-label={t('Ticket anterior')} onClick={() => ir(-1)}>
                <Icon name="chevron-left" size={22} />
              </button>
            ) : <span className="visor-ticket-flecha-hueco" aria-hidden="true" />}
            <div className="visor-ticket-puntos" aria-hidden="true">
              {tickets.map((x, i) => <span key={x.clave} className={i === indice ? 'on' : ''} />)}
            </div>
            {indice < total - 1 ? (
              <button type="button" className="visor-ticket-flecha visor-ticket-flecha--despues" aria-label={t('Ticket siguiente')} onClick={() => ir(1)}>
                <Icon name="chevron-right" size={22} />
              </button>
            ) : <span className="visor-ticket-flecha-hueco" aria-hidden="true" />}
          </div>
        )}

        <div className="visor-ticket-pie">
          <div className="visor-ticket-resumen">
            <b>{ticket.monto ? `${ticket.titulo} · ${ticket.monto}` : ticket.titulo}</b>
            {ticket.detalle.map((linea, i) => <small key={i}>{linea}</small>)}
          </div>
          <div className="visor-ticket-acciones">
            {onVerConsumos && (
              <button type="button" className="visor-ticket-boton" onClick={(e) => onVerConsumos(ticket, e.currentTarget)}>
                {t('Ver consumos')}
              </button>
            )}
            <button type="button" className="visor-ticket-boton" onClick={onCerrar}>{t('Cerrar')}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * D481 · 2a · 2d · la miniatura del ticket dentro de su recuadro de 40 × 52
 * (radio 8, borde, `object-fit: cover` desde arriba). Recuadro = hay foto:
 * lista, la foto; cargando, el recuadro vacío (con pulso, salvo movimiento
 * reducido); error, el ícono adentro. Es sólo lo que se ve: el botón lo pone
 * quien la usa.
 */
export function MiniaturaDelTicket({ url, estado, icono }: {
  url: string | null;
  estado: EstadoDeFoto;
  icono: IconName;
}) {
  return (
    <span className={`miniatura-ticket${estado === 'cargando' && !url ? ' miniatura-ticket--cargando' : ''}`} aria-hidden="true">
      {url ? <img src={url} alt="" draggable={false} /> : estado === 'error' ? <Icon name={icono} size={18} /> : null}
    </span>
  );
}

/**
 * D481 · 2a · el botón de la miniatura en una fila de lista: 44 × 52, aparte de
 * la fila (que lleva a la pantalla del ticket), con su nombre propio también
 * mientras carga. Abre el visor y no le pasa el toque a la fila.
 */
export function BotonDeMiniatura({ nombre, url, estado, icono, onAbrir }: {
  /** El nombre del lugar: «Ver la foto del ticket de {0}» / «Cargando la foto del ticket de {0}». */
  nombre: string;
  url: string | null;
  estado: EstadoDeFoto;
  icono: IconName;
  onAbrir: (boton: HTMLButtonElement) => void;
}) {
  const { t } = useIdioma();
  const cargando = estado === 'cargando' && !url;
  return (
    <button
      type="button"
      className="fila-ticket-foto"
      aria-haspopup="dialog"
      aria-busy={cargando || undefined}
      aria-label={cargando ? t('Cargando la foto del ticket de {0}', nombre) : t('Ver la foto del ticket de {0}', nombre)}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onAbrir(e.currentTarget); }}
    >
      <MiniaturaDelTicket url={url} estado={estado} icono={icono} />
    </button>
  );
}

/**
 * D481 · 3b · 3d · la fila de la foto dentro de la tarjeta de título de la
 * pantalla del ticket: la miniatura, «Ver la foto del ticket» y la flecha.
 * Abre el visor con ese solo ticket («Foto del ticket»).
 */
export function FilaDeLaFotoDelTicket({ url, estado, onAbrir, botonRef }: {
  url: string | null;
  estado: EstadoDeFoto;
  onAbrir: () => void;
  botonRef: MutableRefObject<HTMLButtonElement | null>;
}) {
  const { t } = useIdioma();
  return (
    <button
      ref={botonRef}
      type="button"
      className="fila-de-la-foto"
      aria-haspopup="dialog"
      aria-busy={(estado === 'cargando' && !url) || undefined}
      onClick={onAbrir}
    >
      <MiniaturaDelTicket url={url} estado={estado} icono="receipt" />
      <span className="fila-de-la-foto-texto">{t('Ver la foto del ticket')}</span>
      <Icon name="chevron-right" size={20} className="fila-de-la-foto-flecha" />
    </button>
  );
}

/**
 * D481 · 2a · 2c · la anatomía de la fila de una lista de tickets: la columna
 * de 44 px (la miniatura o el ícono, centrados), el nombre, el monto y la
 * flecha. Toda la fila es un botón; la miniatura, otro botón encima de la
 * columna (dos botones hermanos: uno no puede ir dentro del otro).
 */
export function FilaDeTicket({ icono, nombre, monto, extra, miniatura, onAbrir, etiqueta }: {
  icono: IconName;
  nombre: string;
  /** El monto ya formateado, o `null`: «—» en gris (D481 · 2). */
  monto: string | null;
  /** Lo que va debajo del nombre (las marcas de Balance, la insignia del viaje). */
  extra?: ReactNode;
  /** El botón de la miniatura, si hay foto (o se está cargando). */
  miniatura?: ReactNode;
  onAbrir: () => void;
  /** Un rótulo arriba del monto («Te toca» en las visitas de viaje). */
  etiqueta?: string;
}) {
  const { t } = useIdioma();
  return (
    <div className="fila-ticket-cuerpo">
      <button type="button" className="fila-ticket" onClick={onAbrir}>
        <span className="fila-ticket-columna" aria-hidden="true">
          {miniatura ? null : <Icon name={icono} size={26} />}
        </span>
        <span className="fila-ticket-main">
          <span className="fila-ticket-nombre">{nombre}</span>
          {extra}
        </span>
        <span className="fila-ticket-monto-col">
          {etiqueta && <span className="fila-ticket-rotulo">{etiqueta}</span>}
          {monto !== null ? (
            <span className="fila-ticket-monto">{monto}</span>
          ) : (
            <>
              <span className="fila-ticket-monto fila-ticket-monto--sin" aria-hidden="true">—</span>
              <span className="visor-ticket-oculto">{t('Sin consumos elegidos')}</span>
            </>
          )}
        </span>
        <Icon name="chevron-right" size={20} className="fila-ticket-flecha" />
      </button>
      {miniatura}
    </div>
  );
}
