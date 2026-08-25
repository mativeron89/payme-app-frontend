import type { ReactNode } from 'react';
import { useIdioma } from '../i18n/idioma';
import { navigate } from '../router';
import { useToast } from './ui';
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

/**
 * Símbolo + wordmark, en ese orden. **Texto de Mati, 2026-08-19:** *«quiero que
 * esté el logo (como en la segunda imagen) y a la derecha "PayMe", tienen que
 * estar ambos»* — no eligió ninguna de las dos capturas que se le mostraron.
 *
 * 🔴 **El símbolo se COMPONE con el wordmark de texto, y NO se usa el lockup
 * del handoff.** Los dos `payme-lockup-*.svg` tipean el wordmark con **Poppins**
 * en un `<text>`, y `A4` ratificó lo contrario —*«Mantener Plus Jakarta Sans +
 * DM Sans»*—. Además `D-FUENTES-1` sacó las tres etiquetas a Google y no
 * vuelven: un lockup así renderizaría la marca en una fallback, **en silencio**.
 * Componer acá deja el símbolo importado y el texto tipeado por la app, con la
 * tipografía vigente.
 *
 * El glifo va inline —como el de WhatsApp en la landing— porque es parte del
 * chrome: un `<img>` agregaría una request para 340 bytes que ya están en el
 * bundle. Variante CYAN: la banda es navy, y es la que el handoff marca para
 * superficie oscura. `aria-hidden` porque el wordmark de al lado ya nombra la
 * marca; dos veces «PayMe» seguidas sería ruido para un lector de pantalla.
 *
 * `Pay` en blanco + `Me` en teal — 7.46:1 sobre la banda navy.
 */
export function PayMeLogo({ size }: { size?: number }) {
  /* El `size` (y el font-size en general) va en `.hdr-mark`, NO en el
     wordmark: el símbolo mide `1.2em` en CSS (regla de composición 283d88d),
     así que escalar el contenedor escala LOS DOS y la proporción no se puede
     romper por ajustar uno solo. El SVG no lleva width/height: los gobierna
     esa misma regla — un atributo acá sería una segunda copia del tamaño. */
  return (
    <span className="hdr-mark" style={size ? { fontSize: size } : undefined}>
      <svg className="hdr-symbol" viewBox="0 0 76 76" aria-hidden="true" focusable="false">
        <rect width="76" height="76" rx="21" fill="#0FB5C9" />
        <path d="M18.5 21 L27.5 21 L36.5 38 L27.5 55 L18.5 55 L27.5 38 Z" fill="#101E3B" />
        <path d="M39.5 21 L48.5 21 L57.5 38 L48.5 55 L39.5 55 L48.5 38 Z" fill="#FFFFFF" />
      </svg>
      <span className="hdr-logo">
        Pay<span className="hdr-logo-me">Me</span>
      </span>
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
  unread = 0,
  onBell,
  bellHere = false,
  tabs,
  compact,
}: HeaderBase & {
  /** Nombre COMPLETO editable de la sesión. Trunca; nunca empuja la campana. */
  userName?: string;
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
  const { t } = useIdioma();
  const identidad = userName?.trim() || undefined;
  const openAvisos = onBell ?? (() => navigate('avisos'));
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
          <span className="hdr-bell hdr-bell-here" role="img" aria-label={t('Estás en Avisos')}>
            <Icon name="bell" size={22} />
          </span>
        ) : identidad ? (
          <button type="button" className="hdr-bell" onClick={openAvisos} aria-label={t('Avisos')}>
            <Icon name="bell" size={22} />
            {unread > 0 && (
              <span className="hdr-badge" aria-label={t('{0} sin leer', unread)}>
                {unread}
              </span>
            )}
          </button>
        ) : null}
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
  userName,
  unread = 0,
  onBell,
  tabs,
  compact,
  bellHere = false,
}: HeaderBase & {
  title?: string;
  onBack: () => void;
  /** Nombre COMPLETO editable de la sesión; sin fallback a `payme_id`. */
  userName?: string;
  unread?: number;
  onBell?: () => void;
  bellHere?: boolean;
}) {
  const { t } = useIdioma();
  const identidad = userName?.trim() || undefined;
  const openAvisos = onBell ?? (() => navigate('avisos'));
  return (
    <header className={`hdr ${compact ? 'hdr-compact' : ''} ${tabs ? 'hdr-tabbed' : ''}`}>
      <div className="hdr-row">
        <PayMeLogo />
        {identidad && <span className="hdr-user">{identidad}</span>}
        {bellHere ? (
          <span className="hdr-bell hdr-bell-here" role="img" aria-label={t('Estás en Avisos')}>
            <Icon name="bell" size={22} />
          </span>
        ) : (
          <button type="button" className="hdr-bell" onClick={openAvisos} aria-label={t('Avisos')}>
            <Icon name="bell" size={22} />
            {unread > 0 && <span className="hdr-badge" aria-label={t('{0} sin leer', unread)}>{unread}</span>}
          </button>
        )}
      </div>
      <div className="hdr-row hdr-row-2">
        <button type="button" className="hdr-back" onClick={onBack}>
          <Icon name="arrow-left" size={20} />
          {t('Volver')}
        </button>
        {title && <span className="hdr-title">{title}</span>}
      </div>
      {tabs}
    </header>
  );
}

/**
 * Variante de FLUJO — la tercera, que introduce SPEC_APP.md §1.3 y que no es
 * ninguna de las dos de §5 bis · A. Dos filas dentro de la misma banda navy:
 *
 *     Pay Me                              Mati Verón
 *     ← Volver
 *
 * Fila 1: lockup + **nombre completo editable** + campana. La campana navega
 * a Avisos por defecto. Sólo cuando el caller acredita un estado monetario inseguro
 * (`bellBlocked`) conserva el toque y responde con feedback accesible sin
 * abandonar el paso.
 * Fila 2: Volver (flecha Y texto, no sólo ícono).
 *
 * El spec la deja pendiente de confirmar como estándar de todos los pasos, y
 * manda aplicar el mismo criterio hasta que se diga lo contrario.
 *
 * 🔴 **EL CONTADOR DE PASO NO EXISTE MÁS, y no es que esta cabecera no lo
 * pase: el prop se RETIRÓ.** SISTEMA_DISENO.md §5 bis · E (2026-08-21) los
 * elimina de toda la app —*"no vale la pena mantenerlo sincronizado a mano
 * cada vez que el flujo se mueve"*, que ya había pasado con la fusión Ticket +
 * División—. Mientras el prop existiera, la próxima pantalla del flujo lo
 * recibía de buena fe y el contador volvía sin que nadie lo decidiera.
 * Si más adelante hace falta señal de avance, §E dice qué es: una barra de
 * progreso SIN números. No este prop de vuelta.
 */
export function AppHeaderFlow({
  userName,
  onBack,
  backLabel = 'Volver',
  backIcon = 'arrow-left',
  action,
  compact,
  bellBlocked = false,
}: HeaderBase & {
  /** Nombre COMPLETO editable. Si falta, la fila 1 va sólo con el logo. */
  userName?: string;
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
  /**
   * Lo que va a la derecha de la fila 2. Nació para REEMPLAZAR al contador en
   * las pantallas que no eran un paso lineal —Mis ítems (§1.5) pone acá el
   * ícono de link—; ahora que el contador no existe en ninguna, es lo único
   * que ocupa ese lugar.
   */
  action?: ReactNode;
  /** Bloquea la salida sólo mientras un estado monetario no puede abandonarse. */
  bellBlocked?: boolean;
}) {
  const { t } = useIdioma();
  const toast = useToast();
  const identidad = userName?.trim() || undefined;
  return (
    <header className={`hdr hdr-flow ${compact ? 'hdr-compact' : ''}`}>
      <div className="hdr-row">
        <PayMeLogo />
        {identidad && <span className="hdr-user">{identidad}</span>}
        <button
          type="button"
          className="hdr-bell"
          onClick={() => {
            if (bellBlocked) toast(t('Termina este paso para abrir tus avisos.'));
            else navigate('avisos');
          }}
          aria-label={t('Avisos')}
        >
          <Icon name="bell" size={22} />
        </button>
      </div>
      <div className="hdr-row hdr-row-2">
        <button type="button" className="hdr-back" onClick={onBack}>
          <Icon name={backIcon} size={20} />
          {t(backLabel)}
        </button>
        {/* El `margin-left: auto` lo tenía el contador y se fue con él, dejando
            el lugar de la derecha sin dueño. `action` lo REEMPLAZA (§1.5), así
            que hereda su posición — si no, cae pegado a «Volver».
            ⚠️ Ese defecto ya existía ANTES de retirar el contador: Mis ítems
            nunca pasó `step`, así que su ícono de link vino pegado desde el
            día uno. Se corrige acá porque es la misma pieza, no porque lo haya
            roto este cambio. */}
        {action && <span className="hdr-action">{action}</span>}
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
 * una sola pieza continua del mismo color. La tarjeta lleva cuadrada la esquina
 * superior que coincide con una pestaña extrema; si la activa está al medio,
 * conserva ambas esquinas redondeadas.
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
  const { t } = useIdioma();
  return (
    <div className="btabs" role="tablist">
      {tabs.map((tab) => {
        const on = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={on}
            className={`btab ${on ? 'on' : ''}`}
            onClick={() => onSelect(tab.id)}
          >
            {tab.label}
            {/* El conteo entra al NOMBRE ACCESIBLE de la pestaña, y tiene que
                entrar: una persona que no ve el círculo naranja igual necesita
                saber que hay algo esperándola. Por eso lleva su propio texto
                —"2 pendientes" y no un "2" suelto— en vez de `aria-hidden`.

                Consecuencia para quien escriba tests: el nombre de una pestaña
                con badge NO es su etiqueta pelada. Buscarla con `exact: true`
                falla en cuanto el contador deja de estar en cero. */}
            {tab.badge != null && tab.badge > 0 && (
              <span className="btab-badge" aria-label={t('{0} pendientes', tab.badge)}>
                {tab.badge}
              </span>
            )}
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
 * `seam` indica qué extremo ocupa la pestaña activa. Esa esquina va cuadrada
 * para que pestaña y tarjeta lean como una sola pieza continua.
 */
export function MountedCard({
  children,
  seam,
  className = '',
}: {
  children: ReactNode;
  seam?: 'left' | 'right';
  className?: string;
}) {
  return <div className={`mounted-card ${seam ? `seam-${seam}` : ''} ${className}`}>{children}</div>;
}
