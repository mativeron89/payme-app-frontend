import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { navigate } from '../router';

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
  // El cabezal SIEMPRE lleva el logo PayMe (pedido de Mati); el título de la
  // pantalla lo acompaña en gris.
  return (
    <div className="top-bar">
      {onBack && (
        <button className="back-btn" onClick={onBack} aria-label={backLabel}>
          <span aria-hidden="true">←</span>
        </button>
      )}
      <TopLogo />
      <h1
        className="top-title"
        style={{ fontSize: 'var(--fs-base)', color: 'var(--gray-txt)', fontFamily: 'var(--font-body)', fontWeight: 600 }}
      >
        {title}
      </h1>
      {right}
    </div>
  );
}

/**
 * Tabs de la sección social (T-F1, feedback del hermano): Amigos y Grupos
 * son UNA sección de la nav; estas tabs navegan entre las dos páginas (los
 * deep links y los backs siguen funcionando porque cada tab es una ruta).
 */
export function SocialTabs({ active }: { active: 'amigos' | 'grupos' }) {
  return (
    <div className="tabs" style={{ margin: '0 0 12px' }}>
      <button
        className={`tab ${active === 'amigos' ? 'on' : ''}`}
        aria-current={active === 'amigos' ? 'page' : undefined}
        onClick={() => navigate('amigos')}
      >
        Amigos
      </button>
      <button
        className={`tab ${active === 'grupos' ? 'on' : ''}`}
        aria-current={active === 'grupos' ? 'page' : undefined}
        onClick={() => navigate('grupos')}
      >
        Grupos
      </button>
    </div>
  );
}

/** Chip de marca de tarjeta: VISA en texto, Mastercard con sus círculos. */
export function CardBrandChip({ brand }: { brand: string }) {
  const b = brand.toLowerCase();
  if (b === 'mastercard') {
    return <div className="cc visa mc" aria-hidden="true" />;
  }
  return (
    <div className="cc visa" aria-hidden="true">
      {b === 'visa' ? 'VISA' : brand.toUpperCase().slice(0, 4)}
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

const AVATAR_COLORS = ['#7c3aed', '#0891b2', '#ea580c', '#059669', '#be185d', '#4f46e5'];

export function Avatar({ name, size = 42 }: { name: string; size?: number }) {
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
      className="avatar"
      style={{ background: color, width: size, height: size, fontSize: size * 0.36 }}
      aria-hidden="true"
    >
      {initials}
    </div>
  );
}
