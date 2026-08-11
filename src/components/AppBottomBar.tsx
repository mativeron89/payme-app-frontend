import { Icon, type IconName } from './Icon';
import { useIdioma } from '../i18n/idioma';
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
 * 🔴 LOS `label` DE ACÁ ESTÁN EN ESPAÑOL A PROPÓSITO, y se traducen AL
 * RENDERIZAR (`t(it.label)` más abajo).
 *
 * Son constantes de MÓDULO: no hay hook del que sacar `t` en este ámbito.
 * Envolverlas acá no compila. **Y es la clase exacta que dejó la navegación
 * entera de Dashboard Frontend en español con 753 tests en verde** — el
 * envoltorio automático no ve las constantes de módulo, así que nadie se
 * enteró hasta que alguien miró la pantalla.
 */
const LEFT: SideItem[] = [
  { slot: 'home', label: 'Inicio', icon: 'home', page: 'home' },
  { slot: 'mesas', label: 'Mesas', icon: 'receipt', page: 'mesas' },
];

/**
 * `Más` **ya no apunta a `perfil` "provisoriamente"**: apunta a `mas`, que es
 * una ruta y una pantalla de verdad desde §1.9.
 *
 * Y `Más` **ES** Perfil, no la contiene (resuelto por Diseño el 2026-08-05): un
 * menú de una sola fila útil agrega fricción sin agregar nada, y "configuración"
 * no tiene ni spec ni pantalla ni contrato detrás — una fila que no lleva a
 * ningún lado es el tratamiento que el spec ya le negó al QR de Compartir y a
 * Cuentas Asociadas.
 */
const RIGHT_DESTINO_MAS = 'mas' as const;

const RIGHT: SideItem[] = [
  { slot: 'amigos', label: 'Amigos', icon: 'users', page: 'amigos' },
  { slot: 'mas', label: 'Más', icon: 'grid-dots', page: RIGHT_DESTINO_MAS },
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
  const { t } = useIdioma();
  const centro = center ?? {
    label: t('Nueva'),
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
        <span className="appbar-label">{t(it.label)}</span>
      </button>
    );
  };

  return (
    <div className="appbar-block">
      {above && <div className="appbar-above">{above}</div>}
      <nav className="appbar" aria-label={t('Navegación principal')}>
        {LEFT.map(item)}
        <div className="appbar-center">
          <button
            type="button"
            className="appbar-fab"
            onClick={centro.onClick}
            disabled={centro.disabled}
            aria-label={t(centro.label)}
          >
            <Icon name={centro.icon} size={24} />
          </button>
          <span className="appbar-label">{t(centro.label)}</span>
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
 * El glifo va en BLANCO sobre `--brand` desde la enmienda del 2026-08-08
 * (antes navy, 5.77:1): son 2.84:1, por debajo del 3:1 que pide un ícono de
 * control, y es decisión de Mati con el número a la vista. El nombre accesible
 * lo lleva el `aria-label`, que es lo único que tiene: sin etiqueta visible,
 * un botón sin nombre sería un círculo mudo para quien no ve la pantalla.
 *
 * 🔴 CORRECCIÓN de lo que decía acá antes. El texto anterior presentaba el
 * `aria-label` como si compensara el contraste bajo: *"es lo único que no
 * depende de distinguir el glifo"*. **Eso es engañoso y lo escribí yo.**
 *
 * Un `aria-label` sirve a quien usa lector de pantalla. **No hace nada por
 * quien MIRA la pantalla y no distingue el glifo**, que es exactamente la
 * persona a la que afecta un contraste de 2.84:1. Son dos poblaciones
 * distintas y la etiqueta sólo alcanza a una.
 *
 * El riesgo del contraste queda ACEPTADO y sin mitigar. Escribirlo como si
 * estuviera mitigado es peor que el riesgo, porque cierra la discusión.
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
