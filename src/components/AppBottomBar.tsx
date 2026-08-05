import { Icon, type IconName } from './Icon';
import { navigate, type PageId } from '../router';

/**
 * Barra inferior de CINCO posiciones — SISTEMA_DISENO.md §5 bis · C.
 *
 *     Inicio · Mesas · [ + ] Nueva · Amigos · Más
 *
 * Fijas para toda la app: ninguna pantalla inventa su propia navegación.
 * Reemplaza al botón flotante — elimina `.fab`, `.cta-float` y el hack
 * `.has-nav .action-bar`, que existían porque la navegación tapaba el botón.
 *
 * NO reemplaza todavía a `BottomNav`: este componente entra sin call sites y
 * cada pantalla lo adopta cuando se implementa (paso 3 de la orden visual).
 * Mientras las dos convivan, `BottomNav` es la vieja y esta es la nueva.
 *
 * La posición central es CONFIGURABLE, y eso viene del SPEC, no de comodidad:
 * en Inicio es `+` "Nueva" (SPEC_APP.md §1.1), en Ticket/División/Mis ítems es
 * `→` "Continuar" (§1.3–§1.5) y en Escanear es la cámara y dice "Capturar"
 * (§1.6). Textual del spec: *"El texto del nav item no es fijo en toda la app;
 * lo fijo es el componente y su posición."*
 *
 * Compartir (§1.7) NO usa este componente: lleva su propia variante reducida,
 * un círculo solo con ícono de casa, porque cierra el flujo en vez de avanzarlo.
 */

/** Ítem activo. `null` = ninguno, que es lo correcto en los pasos de flujo. */
export type BottomBarSlot = 'home' | 'mesas' | 'amigos' | 'mas';

interface SideItem {
  slot: BottomBarSlot;
  label: string;
  icon: IconName;
  page: PageId;
}

/**
 * `Más` apunta a `perfil` porque la pantalla Más todavía no existe y Perfil ES
 * hoy la lista de opciones (nombre, mail, cerrar sesión) que el spec dice que
 * va a vivir adentro de Más, junto con configuración (SPEC_APP.md §1.9).
 * Cuando exista la pantalla Más, este destino cambia acá y en ningún otro lado.
 */
const LEFT: SideItem[] = [
  { slot: 'home', label: 'Inicio', icon: 'home', page: 'home' },
  { slot: 'mesas', label: 'Mesas', icon: 'receipt', page: 'mesas' },
];

const RIGHT: SideItem[] = [
  { slot: 'amigos', label: 'Amigos', icon: 'users', page: 'amigos' },
  { slot: 'mas', label: 'Más', icon: 'grid-dots', page: 'perfil' },
];

export interface AppBottomBarProps {
  /**
   * Qué posición se marca activa. `null` en pasos de flujo: ninguna de las
   * cinco representa "estoy en el Ticket", y marcar una sería mentir sobre
   * dónde está el usuario (SPEC_APP.md §1.3, §1.8).
   */
  active?: BottomBarSlot | null;
  /** Acción del círculo central. Por defecto, abrir una mesa nueva. */
  center?: {
    label: string;
    icon: IconName;
    onClick: () => void;
    /** Deshabilita el círculo sin sacarlo de la barra (ej.: nada seleccionado). */
    disabled?: boolean;
  };
  /**
   * Fila propia ARRIBA de la barra, dentro del mismo bloque. Es donde vive lo
   * dinámico —"Mi parte $30.00"— para que la barra de navegación no cambie de
   * texto según el estado, que sería un nav item inestable (SPEC_APP.md §1.5).
   */
  above?: React.ReactNode;
}

export function AppBottomBar({ active = null, center, above }: AppBottomBarProps) {
  const centro = center ?? {
    label: 'Nueva',
    icon: 'plus' as IconName,
    onClick: () => navigate('scan'),
    disabled: false,
  };

  const item = (it: SideItem) => {
    const on = active === it.slot;
    return (
      <button
        key={it.slot}
        type="button"
        className={`appbar-item ${on ? 'on' : ''}`}
        onClick={() => navigate(it.page)}
        aria-current={on ? 'page' : undefined}
      >
        {/* La rayita del activo es decorativa: el color y el peso ya lo marcan,
            y `aria-current` lo dice de verdad. */}
        {on && <span className="appbar-tick" aria-hidden="true" />}
        <Icon name={it.icon} size={22} />
        <span className="appbar-label">{it.label}</span>
      </button>
    );
  };

  return (
    <div className="appbar-block">
      {above && <div className="appbar-above">{above}</div>}
      <nav className="appbar" aria-label="Navegación principal">
        {LEFT.map(item)}
        <div className="appbar-center">
          <button
            type="button"
            className="appbar-fab"
            onClick={centro.onClick}
            disabled={centro.disabled}
            aria-label={centro.label}
          >
            <Icon name={centro.icon} size={24} />
          </button>
          <span className="appbar-label">{centro.label}</span>
        </div>
        {RIGHT.map(item)}
      </nav>
    </div>
  );
}
