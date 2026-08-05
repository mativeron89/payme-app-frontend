import { Icon, type IconName } from './Icon';
import { navigate, type PageId } from '../router';

/**
 * Barra inferior de CINCO posiciones — SISTEMA_DISENO.md §5 bis · C.
 *
 *     Inicio · Mesas · [ + ] Nueva · Amigos · Más
 *
 * Fijas para toda la app: ninguna pantalla inventa su propia navegación.
 *
 * **Ya reemplazó a `BottomNav`**, que se retiró en §1.9 · paso 3 cuando la
 * última pantalla la adoptó. Cada pantalla la monta ELLA: `App` no decide qué
 * barra lleva cada una, porque la posición del círculo central cambia según
 * dónde estás y eso `App` no lo sabe.
 *
 * Su hack de layout tiene gemelo y no desapareció: `.has-appbar .action-bar`
 * existe por lo mismo que existía `.has-nav .action-bar` —el `.action-bar` no
 * es fijo y la barra sí—. Lo que sigue vivo del mundo viejo es `.fab` y
 * `.cta-float`, con call sites en Mesas y en los dos flujos de mesa.
 *
 * La posición central es CONFIGURABLE, y eso viene del SPEC, no de comodidad:
 * en Inicio es `+` "Nueva" (SPEC_APP.md §1.1), en Ticket/División/Mis ítems es
 * `→` "Continuar" (§1.3–§1.5) y en Escanear es la cámara y dice "Capturar"
 * (§1.6). Textual del spec: *"El texto del nav item no es fijo en toda la app;
 * lo fijo es el componente y su posición."*
 *
 * Compartir (§1.7) no usa la barra de cinco: lleva la variante reducida de
 * abajo, `AppBottomCta` — un círculo solo con ícono de casa, porque cierra el
 * flujo en vez de avanzarlo.
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

/**
 * **Variante REDUCIDA** — hoy sólo Compartir (SPEC_APP.md §1.7, confirmada en
 * §5 el 2026-08-04: *"Compartir mantiene su variante propia y reducida (círculo
 * con casa, sin las otras cuatro posiciones)"*).
 *
 * Es el mismo bloque, la misma sombra y el mismo círculo que la barra de cinco
 * —por eso vive acá y no en la pantalla—, pero sin las cuatro posiciones y
 * **sin etiqueta**: no es navegación, es el cierre del flujo de armar mesa.
 *
 * El glifo va en navy sobre `--brand`, 5.77:1. El nombre accesible lo lleva el
 * `aria-label`, que es lo único que tiene: sin etiqueta visible, un botón sin
 * nombre sería un círculo mudo para quien no ve la pantalla.
 */
export function AppBottomCta({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: IconName;
  onClick: () => void;
}) {
  return (
    <div className="appbar-block">
      <div className="appbar appbar-solo">
        <div className="appbar-center">
          <button type="button" className="appbar-fab" onClick={onClick} aria-label={label}>
            <Icon name={icon} size={24} />
          </button>
        </div>
      </div>
    </div>
  );
}
