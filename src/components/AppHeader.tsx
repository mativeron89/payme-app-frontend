import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/**
 * Cabecera navy de borde curvo y pestañas en burbuja —
 * SISTEMA_DISENO.md §5 bis · A y · B.
 *
 * Son componentes COMPARTIDOS: ninguna pantalla inventa su propio encabezado.
 * Entran sin call sites; cada pantalla los adopta cuando se implementa
 * (paso 3 de la orden visual).
 *
 * Regla conceptual que separa las variantes, y que no es un detalle:
 * **si una pantalla tiene el logo arriba, es de primer nivel.** No puede tener
 * flecha de volver ni dejar activa otra entrada de la barra. El spec lo llama
 * "un error conceptual, no un detalle" — es el error que Mati detectó y que
 * terminó fusionando `s-account` dentro de las pestañas de Inicio.
 */

/** `Pay` en blanco + `Me` en teal — 7.46:1 sobre la banda navy. */
export function PayMeLogo({ size }: { size?: number }) {
  return (
    <span className="hdr-logo" style={size ? { fontSize: size } : undefined}>
      Pay<span className="hdr-logo-me">Me</span>
    </span>
  );
}

interface HeaderBase {
  /** Pestañas en burbuja, si la pantalla las tiene. */
  tabs?: ReactNode;
  /**
   * Banda compacta de la entrada por link (SPEC_APP.md §1.2): menos padding,
   * logo 22px, curva de 26px en vez de 34px. **Es la única pantalla con esta
   * variante** — no aplicarla en ningún otro lado.
   */
  compact?: boolean;
}

/**
 * Variante de PRIMER NIVEL — pantallas de la barra inferior, y Avisos, a la que
 * se llega por la campana.
 * Logo + identidad del usuario + campana.
 */
export function AppHeader({
  userName,
  paymeId,
  unread = 0,
  onBell,
  bellHere = false,
  tabs,
  compact,
}: HeaderBase & {
  /** Nombre COMPLETO (§1.1). Trunca con elipsis; nunca empuja la campana. */
  userName?: string;
  /**
   * `payme_id`, para las pantallas que piden la identidad corta en vez del
   * nombre: §1.8 Avisos. Va en el MISMO slot y con el mismo tratamiento — es la
   * misma ranura de identidad, no una fila nueva.
   */
  paymeId?: string;
  unread?: number;
  onBell?: () => void;
  /**
   * `true` en la pantalla de Avisos: la campana queda en `--brand`, **sin badge
   * y sin ser un botón**, porque ya estás adentro y no hay adónde ir (§1.8).
   *
   * No es una quinta excepción de la lista cerrada de naranjas: ocupa la MISMA
   * ranura sobre la banda navy a la que la tabla de `SISTEMA_DISENO.md` §1 ya
   * le concede `--brand` para el badge de no leídos, y esa ranura ya convive
   * con el círculo de la barra en toda pantalla de primer nivel.
   */
  bellHere?: boolean;
}) {
  const identidad = userName ?? paymeId;
  return (
    <header className={`hdr ${compact ? 'hdr-compact' : ''} ${tabs ? 'hdr-tabbed' : ''}`}>
      <div className="hdr-row">
        <PayMeLogo />
        {identidad && <span className="hdr-user">{identidad}</span>}
        {bellHere ? (
          /* No es `<button>` a propósito: no hace nada. Un botón que no lleva a
             ningún lado es una promesa rota, y encima entra en el orden de
             tabulación. Lleva nombre accesible porque, sin tarjeta de título,
             es lo único que dice de qué pantalla se trata. */
          <span className="hdr-bell hdr-bell-here" role="img" aria-label="Estás en Avisos">
            <Icon name="bell" size={22} />
          </span>
        ) : (
          onBell && (
            <button type="button" className="hdr-bell" onClick={onBell} aria-label="Avisos">
              <Icon name="bell" size={22} />
              {unread > 0 && (
                <span className="hdr-badge" aria-label={`${unread} sin leer`}>
                  {unread}
                </span>
              )}
            </button>
          )
        )}
      </div>
      {tabs}
    </header>
  );
}

/**
 * Variante de SUBPANTALLA — pasos de un flujo, detalles.
 * Flecha de volver + título + contador de paso opcional.
 *
 * `Volver` va con flecha Y texto, no solo ícono (SPEC_APP.md §1.3).
 */
export function AppHeaderBack({
  title,
  onBack,
  step,
  tabs,
  compact,
}: HeaderBase & {
  title?: string;
  onBack: () => void;
  /** Ej.: "Paso 2 de 5". En Mis ítems no hay: no es un paso de flujo lineal. */
  step?: ReactNode;
}) {
  return (
    <header className={`hdr ${compact ? 'hdr-compact' : ''} ${tabs ? 'hdr-tabbed' : ''}`}>
      <div className="hdr-row">
        <button type="button" className="hdr-back" onClick={onBack}>
          <Icon name="arrow-left" size={20} />
          Volver
        </button>
        {title && <span className="hdr-title">{title}</span>}
        {step && <span className="hdr-step">{step}</span>}
      </div>
      {tabs}
    </header>
  );
}

/**
 * Variante de FLUJO — la tercera, que introduce SPEC_APP.md §1.3 y que no es
 * ninguna de las dos de §5 bis · A. Dos filas dentro de la misma banda navy:
 *
 *     Pay Me                              payme_mx_mati
 *     ← Volver                                Paso 2 de 5
 *
 * Fila 1: logo en dos tonos + **ID del usuario** a la derecha. Sin campana —
 * en medio de armar una mesa, un aviso lleva afuera del flujo.
 * Fila 2: Volver (flecha Y texto, no sólo ícono) y el contador de paso.
 *
 * El spec la deja pendiente de confirmar como estándar de todos los pasos, y
 * manda aplicar el mismo criterio hasta que se diga lo contrario.
 */
export function AppHeaderFlow({
  paymeId,
  onBack,
  backLabel = 'Volver',
  backIcon = 'arrow-left',
  step,
  action,
  compact,
}: HeaderBase & {
  /** `payme_id` de la sesión. Si falta, la fila 1 va sólo con el logo. */
  paymeId?: string;
  onBack: () => void;
  /**
   * Qué dice y qué ícono lleva el control de la fila 2. Por defecto retrocede.
   *
   * Existen porque **§1.7 Compartir no retrocede**: cuando esa pantalla se
   * muestra la mesa ya existe y la garantía ya está autorizada, así que volver
   * a División abriría una segunda mesa con un segundo hold (B-06). Su control
   * va a la mesa, y un control que dice "Volver" y no retrocede **es una
   * etiqueta que miente**. Por eso el nombre y el glifo son de quien lo usa, y
   * la flecha de retroceso se puede sacar.
   *
   * No se agrega un segundo botón a la pantalla: es el MISMO control, con
   * destino corregido y nombre honesto.
   */
  backLabel?: string;
  backIcon?: IconName;
  /** Ej.: "Paso 3 de 5". */
  step?: ReactNode;
  /**
   * Reemplaza al contador de paso cuando la pantalla NO es un paso de un flujo
   * lineal. Mis ítems (§1.5) usa esta misma cabecera pero pone acá el ícono de
   * link: es la pantalla a la que el usuario vuelve una y otra vez mientras la
   * mesa sigue abierta, y decirle "Paso 4 de 5" sería mentirle sobre dónde está.
   */
  action?: ReactNode;
}) {
  return (
    <header className={`hdr hdr-flow ${compact ? 'hdr-compact' : ''}`}>
      <div className="hdr-row">
        <PayMeLogo />
        {paymeId && <span className="hdr-id">{paymeId}</span>}
      </div>
      <div className="hdr-row hdr-row-2">
        <button type="button" className="hdr-back" onClick={onBack}>
          <Icon name={backIcon} size={20} />
          {backLabel}
        </button>
        {step && <span className="hdr-step">{step}</span>}
        {action}
      </div>
    </header>
  );
}

export interface BubbleTab {
  id: string;
  label: string;
  /** Conteo tipo el de Solicitudes: círculo --brand con el número en navy. */
  badge?: number;
}

/**
 * §5 bis · B — Pestañas en burbuja.
 *
 * La activa es una burbuja blanca ENGANCHADA a la tarjeta de contenido: forman
 * una sola pieza continua del mismo color. La tarjeta lleva la esquina superior
 * izquierda cuadrada solo cuando la activa es la primera; si está al medio o al
 * final, va con las cuatro redondeadas y el enganche se da por contacto.
 *
 * Las INACTIVAS son texto plano al 72% de blanco sobre el navy, **sin ningún
 * fondo**. Se probó un fondo blanco al 16% para que "pareciera burbuja" y casi
 * no se veía: es un bug corregido, y aplica en toda la app (SPEC_APP.md §1.9).
 */
export function BubbleTabs({
  tabs,
  active,
  onSelect,
}: {
  tabs: BubbleTab[];
  active: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="btabs" role="tablist">
      {tabs.map((t) => {
        const on = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on}
            className={`btab ${on ? 'on' : ''}`}
            onClick={() => onSelect(t.id)}
          >
            {t.label}
            {t.badge != null && t.badge > 0 && <span className="btab-badge">{t.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Un acceso de pestaña. **No lleva fondo propio** (§5 bis · B): la pestaña y su
 * contenido son una sola burbuja blanca continua, y los accesos se separan con
 * una línea de `--border`. Un fondo de otro color rompe la lectura de pieza
 * única. El ícono va en `--link`.
 *
 * Vivía dentro de `HomeScreen`, que fue quien lo estrenó. Subió acá cuando la
 * sección social necesitó el mismo tile: es la pieza que acompaña a
 * `BubbleTabs` y `MountedCard`, y las tres son de §5 bis · B. Copiarlo habría
 * dejado dos tiles que se ven igual hasta que uno cambie.
 */
export function Launcher({
  icon,
  label,
  onClick,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="launch" onClick={onClick}>
      <span className="launch-ico" aria-hidden="true">
        <Icon name={icon} size={22} />
      </span>
      <span className="launch-label">{label}</span>
    </button>
  );
}

/**
 * La tarjeta blanca montada sobre la banda. Sube 24px, con --sp-4 de margen
 * lateral, y el navy asoma a los costados.
 *
 * `flush` = la pestaña activa es la PRIMERA, así que la esquina superior
 * izquierda va cuadrada para que burbuja y tarjeta lean como una sola pieza.
 */
export function MountedCard({
  children,
  flush = false,
  className = '',
}: {
  children: ReactNode;
  flush?: boolean;
  className?: string;
}) {
  return <div className={`mounted-card ${flush ? 'flush' : ''} ${className}`}>{children}</div>;
}
