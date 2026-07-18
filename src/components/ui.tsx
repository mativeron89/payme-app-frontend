import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

/** Piezas chicas compartidas: top bar, toast y avatar con color estable. */

export function TopBar({ title, onBack, right }: { title: string; onBack: () => void; right?: ReactNode }) {
  return (
    <div className="top-bar">
      <button className="back-btn" onClick={onBack} aria-label="Volver">
        ←
      </button>
      <div className="top-title">{title}</div>
      {right}
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
      {msg && (
        <div className="toast" role="status">
          {msg}
        </div>
      )}
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
