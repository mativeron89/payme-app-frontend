import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useCapacidadFotoDelTicket, type FotoDelTicket } from '../api/fotoDelTicket';
import { useFotoDelTicket, type OrigenDeFoto } from '../api/fotosDeTickets';
import type { StoredSession } from '../api/storage';
import { useIdioma } from '../i18n/idioma';
import { Icon } from './Icon';
import { useHojaModal } from './useHojaModal';

/**
 * D466 · E · el visor del ticket, a pantalla completa (Mati: «Vamos por AE»).
 *
 * Diseño E de `foto-del-ticket.html` (D464): el ticket con zoom (pellizcar o
 * tocar dos veces), deslizar al anterior o al siguiente del mes, y abajo el
 * resumen con «Ver consumos» y «Cerrar». Si la foto completa ya no está
 * (`full: false`, la opción de 90 días de D465), se ve la miniatura con el
 * aviso «La foto completa se borró a los 90 días».
 *
 * - Diálogo modal (`useHojaModal`): el foco entra en «Cerrar», Tab no sale,
 *   Escape cierra y el resto de la app queda inerte. Las flechas pasan de
 *   ticket; `+` y `-` acercan y alejan. El foco vuelve a quien lo abrió.
 * - Las fotos, sólo en memoria (`useFotoDelTicket`). Mientras llega la
 *   completa se ve la miniatura.
 * - Sin dependencias nuevas: el zoom son eventos de puntero.
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
  onVerConsumos: ((ticket: TicketDelVisor) => void) | null;
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
  const estado = url
    ? 'lista'
    : miniatura.estado === 'error' || (!completaVencida && completa.estado === 'error')
      ? 'error'
      : miniatura.estado === 'sin_foto' && completaVencida
        ? 'sin_foto'
        : 'cargando';

  // ─── El zoom y el gesto ──────────────────────────────────────────────────
  const punteros = useRef(new Map<number, { x: number; y: number }>());
  const inicio = useRef<{ distancia: number; escala: number; x: number; y: number; vista: Vista } | null>(null);
  const ultimoToque = useRef<{ t: number; x: number; y: number } | null>(null);

  const alBajar = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Las flechas y «Reintentar» son botones: capturar su puntero se comería el clic.
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
      if (Math.hypot(dx, dy) < 10) {
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
    else if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      setVista((v) => ({ ...v, escala: acotar(v.escala + 0.5, 1, ESCALA_MAXIMA) }));
    } else if (e.key === '-') {
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

  return createPortal(
    <div className="visor-ticket" ref={hoja} role="dialog" aria-modal="true" aria-labelledby="visor-ticket-titulo" onKeyDown={alTeclado}>
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
        aria-describedby="visor-ticket-ayuda"
      >
        {url ? (
          <img
            className="visor-ticket-foto"
            src={url}
            alt={t('Foto del ticket de {0}', ticket.titulo)}
            // Cuál se ve: la completa, o la miniatura (mientras llega la completa, o si venció).
            data-tamano={!completaVencida && completa.url ? 'full' : 'thumb'}
            draggable={false}
            style={{ transform: `translate(${vista.x + arrastre}px, ${vista.y}px) scale(${vista.escala})` }}
          />
        ) : estado === 'cargando' ? (
          <div className="visor-ticket-estado" role="status">{t('Cargando la foto…')}</div>
        ) : estado === 'sin_foto' ? (
          <div className="visor-ticket-estado" role="status">{t('Esta foto ya no está disponible.')}</div>
        ) : (
          <div className="visor-ticket-estado" role="alert">
            <p>{t('No pudimos cargar la foto.')}</p>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => { miniatura.reintentar(); completa.reintentar(); }}
            >
              {t('Reintentar')}
            </button>
          </div>
        )}
        {total > 1 && indice > 0 && (
          <button type="button" className="visor-ticket-flecha visor-ticket-flecha--antes" aria-label={t('Ticket anterior')} onClick={() => ir(-1)}>
            <Icon name="chevron-left" size={24} />
          </button>
        )}
        {total > 1 && indice < total - 1 && (
          <button type="button" className="visor-ticket-flecha visor-ticket-flecha--despues" aria-label={t('Ticket siguiente')} onClick={() => ir(1)}>
            <Icon name="chevron-right" size={24} />
          </button>
        )}
      </div>

      {total > 1 && (
        <div className="visor-ticket-puntos" aria-hidden="true">
          {tickets.map((x, i) => <span key={x.clave} className={i === indice ? 'on' : ''} />)}
        </div>
      )}

      <div className="visor-ticket-pie">
        {avisoVencida && <p className="visor-ticket-aviso" role="note">{avisoVencida}</p>}
        <div className="visor-ticket-resumen">
          <b>{ticket.monto ? `${ticket.titulo} · ${ticket.monto}` : ticket.titulo}</b>
          {ticket.detalle.map((linea, i) => <small key={i}>{linea}</small>)}
          <small id="visor-ticket-ayuda">{t('Pellizca o toca dos veces para hacer zoom.')}</small>
        </div>
        <div className="visor-ticket-acciones">
          {onVerConsumos && (
            <button type="button" className="visor-ticket-boton" onClick={() => onVerConsumos(ticket)}>
              {t('Ver consumos')}
            </button>
          )}
          <button type="button" className="visor-ticket-boton" onClick={onCerrar}>{t('Cerrar')}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
