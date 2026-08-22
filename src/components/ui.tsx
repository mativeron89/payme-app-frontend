import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { useIdioma } from '../i18n/idioma';

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

const ToastContext = createContext<(msg: string) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((m: string) => {
    setMsg(m);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 2400);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {/* Siempre montado (ver .toast-hidden en global.css): una región live que
          se inserta junto con su texto no la anuncian varios lectores. */}
      <div className={msg ? 'toast' : 'toast toast-hidden'} role="status" aria-live="polite">
        {msg}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): (msg: string) => void {
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
