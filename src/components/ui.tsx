import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useIdioma } from '../i18n/idioma';
import { Icon } from './Icon';

/** Piezas chicas compartidas: top bar, toast y avatar con color estable. */

/** Logo chico para cabezales. `inv` = sobre fondo navy. */
export function TopLogo({ inv = false }: { inv?: boolean }) {
  return (
    <span className={`top-logo ${inv ? 'inv' : ''}`} aria-hidden="true">
      Pay<span className="t">Me</span>
    </span>
  );
}

export function TopBar({
  title,
  onBack,
  right,
  backLabel = 'Volver',
}: {
  title: string;
  onBack?: () => void;
  right?: ReactNode;
  backLabel?: string;
}) {
  const { t } = useIdioma();
  // El cabezal SIEMPRE lleva el logo PayMe (pedido de Mati); el título de la
  // pantalla lo acompaña en gris.
  return (
    <div className="top-bar">
      {onBack && (
        <button className="back-btn" onClick={onBack} aria-label={t(backLabel)}>
          <span aria-hidden="true">←</span>
        </button>
      )}
      <TopLogo />
      <h1
        className="top-title"
        style={{ fontSize: 'var(--fs-legacy-base)', color: 'var(--gray-txt)', fontFamily: 'var(--font-body)', fontWeight: 600 }}
      >
        {title}
      </h1>
      {right}
    </div>
  );
}

/*
 * `SocialTabs` vivía acá y se retiró con §1.9. Eran las pestañas de pastilla
 * gris que navegaban entre `#/amigos` y `#/grupos`: dos rutas, dos pantallas.
 * Ahora la sección social es UNA pantalla y sus tres pestañas son `BubbleTabs`
 * (§5 bis · B), que es el mismo componente que usa Inicio.
 *
 * No queda alias ni reexport: su único consumidor eran esas dos pantallas, que
 * se fueron en el mismo commit.
 */

/** Chip de marca de tarjeta: VISA en texto, Mastercard con sus círculos. */
export function CardBrandChip({ brand }: { brand: string }) {
  const { t } = useIdioma();
  const b = brand.toLowerCase();
  if (b === 'mastercard') {
    return <div className="cc visa mc" aria-hidden="true" />;
  }
  return (
    <div className="cc visa" aria-hidden="true">
      {b === 'visa' ? t('VISA') : brand.toUpperCase().slice(0, 4)}
    </div>
  );
}

/**
 * `sobreLaBarra` (D222 · D223, «Te aceptaron»): el aviso va arriba de la barra
 * de abajo y de su círculo, a 104 px del borde, como el turno 1 · 7 del
 * diseño. Sin la opción, donde estuvo siempre: ningún otro aviso se mueve.
 */
export interface OpcionesDelAviso {
  readonly sobreLaBarra?: boolean;
  /** D387 · sólo el ingreso por link usa el aviso blanco bajo Volver. */
  readonly ingresoAMesa?: boolean;
}

type MostrarAviso = (msg: string, opciones?: OpcionesDelAviso) => void;

const ToastContext = createContext<MostrarAviso>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useIdioma();
  const [msg, setMsg] = useState<string | null>(null);
  const [sobreLaBarra, setSobreLaBarra] = useState(false);
  const [ingresoAMesa, setIngresoAMesa] = useState(false);
  const [saliendo, setSaliendo] = useState(false);
  const [arriba, setArriba] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const salida = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gesto = useRef<{ id: number; x: number; y: number } | null>(null);
  const omitirClick = useRef(false);
  const cancelarTimers = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (salida.current) clearTimeout(salida.current);
    timer.current = null;
    salida.current = null;
  }, []);
  useEffect(() => cancelarTimers, [cancelarTimers]);
  const cerrarIngreso = useCallback(() => {
    cancelarTimers();
    gesto.current = null;
    setSaliendo(true);
    salida.current = setTimeout(() => {
      setMsg(null);
      setSaliendo(false);
    }, 120);
  }, [cancelarTimers]);
  const show = useCallback((m: string, opciones?: OpcionesDelAviso) => {
    cancelarTimers();
    gesto.current = null;
    omitirClick.current = false;
    setSaliendo(false);
    setMsg(m);
    setSobreLaBarra(opciones?.sobreLaBarra === true);
    setIngresoAMesa(opciones?.ingresoAMesa === true);
    timer.current = setTimeout(opciones?.ingresoAMesa ? cerrarIngreso : () => setMsg(null), opciones?.ingresoAMesa ? 3000 : 2400);
  }, [cancelarTimers, cerrarIngreso]);
  useLayoutEffect(() => {
    if (!msg || !ingresoAMesa) return;
    // Tras el commit del detalle: el GET puede haber reemplazado la cabecera
    // de carga. La safe-area ya está en su geometría; no se suma otra vez.
    const fila = document.querySelector('.hdr-flow .hdr-row-2') ?? document.querySelector('.screen .top-bar');
    const medir = () => setArriba(fila ? fila.getBoundingClientRect().bottom + 12 : null);
    medir();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(medir);
    if (fila) {
      // El inset aumenta padding y alto a la vez: el content-box puede ser
      // idéntico mientras Volver se desplaza. Observar la caja exterior.
      observer?.observe(fila, { box: 'border-box' });
      const cabecera = fila.closest('.hdr-flow');
      if (cabecera) observer?.observe(cabecera, { box: 'border-box' });
    }
    window.addEventListener('resize', medir);
    window.addEventListener('scroll', medir, { capture: true, passive: true });
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', medir);
      window.removeEventListener('scroll', medir, true);
    };
  }, [msg, ingresoAMesa]);
  const clases = ['toast', msg ? '' : 'toast-hidden', sobreLaBarra ? 'toast--sobre-barra' : '', ingresoAMesa ? 'toast--ingreso-mesa' : '', saliendo ? 'toast--saliendo' : ''].filter(Boolean).join(' ');
  return (
    <ToastContext.Provider value={show}>
      {children}
      {/* Siempre montado (ver .toast-hidden en global.css): una región live que
          se inserta junto con su texto no la anuncian varios lectores. */}
      <div className={clases} role="status" aria-live="polite" style={ingresoAMesa ? { top: arriba ?? 0, visibility: msg && arriba !== null ? undefined : 'hidden' } : undefined}>
        {ingresoAMesa && msg ? (
          <button
            type="button"
            className="toast-ingreso-contenido"
            aria-label={`${msg}. ${t('Cerrar')}`}
            onPointerDown={(e) => {
              omitirClick.current = false;
              gesto.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerCancel={() => { gesto.current = null; }}
            onPointerUp={(e) => {
              const inicio = gesto.current;
              gesto.current = null;
              if (!inicio || inicio.id !== e.pointerId) return;
              const dx = e.clientX - inicio.x;
              const dy = e.clientY - inicio.y;
              omitirClick.current = Math.abs(dx) > 12 || Math.abs(dy) > 12;
              if (dy <= -24 && Math.abs(dy) > Math.abs(dx)) cerrarIngreso();
            }}
            onClick={() => {
              if (!omitirClick.current) cerrarIngreso();
              omitirClick.current = false;
            }}
          >
            <span className="toast-ingreso-icono" aria-hidden="true"><Icon name="check" size={20} /></span>
            <span>{msg}</span>
          </button>
        ) : msg}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): MostrarAviso {
  return useContext(ToastContext);
}

/**
 * 🔴 SEIS COLORES SIN TOKEN, y ninguna guarda los mira. No salen de la paleta
 * de marca ni figuran en `SISTEMA_DISENO.md`: entran por un hash del nombre,
 * así que qué color pinta cada persona no lo decidió nadie.
 *
 * Esto vuelve FALSA, mientras se usen en Compartir, la afirmación de §5 bis · F
 * de que `--channel-whatsapp` es *"el único color de las pantallas de compartir
 * que no sale de la paleta de marca"*. La variante `marca` de abajo es la que
 * cierra ese hueco — pero sólo donde se la use.
 */
const AVATAR_COLORS = ['#7c3aed', '#0891b2', '#ea580c', '#059669', '#be185d', '#4f46e5'];

/**
 * `variant`:
 *  - `color` (default) — el hash histórico. Lo usan Amigos, Grupos, Transferir
 *    y Perfil, que están FUERA de AF-DISENO-01 y no se tocan sin orden.
 *  - `marca` — monograma navy sobre `--teal-l`, **sin color por persona**
 *    (reconciliación 2026-08-21, cambio 10). Hoy sólo Compartir.
 *
 * ⚠️ Que convivan dos estilos NO es el estado deseable: es el alcance de la
 * orden. Unificar los ocho usos es decisión de Diseño, no de esta sesión —
 * declarado al Bibliotecario junto con el censo.
 */
export function Avatar({
  name,
  size = 42,
  variant = 'color',
}: {
  name: string;
  size?: number;
  variant?: 'color' | 'marca';
}) {
  const initials = name
    .split(' ')
    .map((p) => p.charAt(0))
    .slice(0, 2)
    .join('')
    .toUpperCase();
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  const color = AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
  return (
    <div
      className={`avatar ${variant === 'marca' ? 'avatar-marca' : ''}`}
      style={{
        // En `marca` el fondo lo pone la clase, con tokens. Pasarlo por `style`
        // ganaría siempre y dejaría el token sin efecto.
        ...(variant === 'marca' ? null : { background: color }),
        width: size,
        height: size,
        fontSize: size * 0.36,
      }}
      aria-hidden="true"
    >
      {initials}
    </div>
  );
}
