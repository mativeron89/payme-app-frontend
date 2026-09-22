import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useIdioma } from '../i18n/idioma';
import { AppBottomBar } from '../components/AppBottomBar';
import { AppHeaderFlow } from '../components/AppHeader';
import { Icon } from '../components/Icon';
import { Avatar, useToast } from '../components/ui';
import { InviteFriends } from '../components/InviteFriends';
import type { MesaDetail, MesaItem } from '../api/types';
import {
  availableDefaultDenominators,
  denominatorBps,
  originalParticipants,
} from '../api/mesaPresentation';
import { filaDeParticipante, type Participante } from '../api/participantes';
import { countdownTo, formatMXN } from '../utils/format';
import {
  FRACTIONS,
  availableSlotsOf,
  bpsLabel,
  bpsValido,
  confirmedConsumptionProgress,
  countdownIsUrgent,
  fractionPreview,
  nothingLeftFor,
} from './mesaItemsView';

/**
 * Mis ítems — `s-myitems`, SPEC_APP.md §1.5.
 *
 * **Es la pantalla que gobierna a cualquier participante autenticado de la
 * mesa**: organizador y, desde el rediseño de §1.2, también quien entró por
 * link. No existe más una vista reducida de "invitado".
 *
 * ## Por qué vive en su propio archivo
 *
 * `MesaScreen.tsx` mezclaba esto —prioridad 1, rediseñable— con el pago, el
 * procesando, la confirmación y la expiración, que son prioridad 3 y no se
 * tocan hasta que se resuelvan los bloqueos card-only. Rediseñar con las dos
 * juntas es cómo un cambio visual termina rozando dinero.
 *
 * ## Qué NO está acá, y es a propósito
 *
 * **No tiene estado propio y no llama a la red.** La selección, el journal
 * monetario, los locks y la identidad siguen siendo de `MesaScreen`: son lo que
 * decide si alguien paga dos veces. Acá entran valores ya calculados y salen
 * intenciones.
 *
 * `isGuest` baja como prop en vez de derivarse acá. Además de ser lo correcto
 * —es identidad, no presentación—, `pagoSinCuenta.test.ts` fija que la
 * superficie de invitado siga viva EN `MesaScreen.tsx`.
 */

/** AF-25 · n72 · el estado de «quiénes se sumaron», decidido por `MesaScreen`. */
export type QuienesSeSumaron =
  | { readonly estado: 'oculto' }
  | { readonly estado: 'cargando' }
  | { readonly estado: 'error' }
  | { readonly estado: 'lista'; readonly lista: readonly Participante[] };

export interface MesaDetailViewProps {
  mesa: MesaDetail;
  code: string;
  /** Nombre completo editable de la sesión, para la fila 1 de la cabecera. */
  userName?: string;
  /** Siempre `false` desde el cierre del pago sin cuenta — ver `MesaScreen`. */
  isGuest: boolean;
  guestHeader: ReactNode;
  selected: Map<string, number>;
  selectedDenominators: Map<string, number>;
  /** Ya calculado por el dueño del estado: acá no se recalcula plata. */
  itemsAmount: number;
  mySlotsTaken: number;
  /** Hay un pago sin confirmar: se avisa y se ofrece volver a ÉL, no a otro. */
  frozenScope: string | null;
  /**
   * CORTE DEL VIERNES (`releaseGates.ts`) · con el corte activo la pantalla
   * TERMINA acá: no hay `Continuar` hacia el pago ni reintento de un pago
   * congelado. El aviso del pago congelado se conserva, sin su botón y con un
   * texto que no promete una acción que la app no ofrece.
   */
  pagosCortados: boolean;
  /**
   * 🔴 **D-R8 · el corte DECLARADO por el dueño, que no es lo mismo que
   * `pagosCortados`.**
   *
   * `pagosCortados` es fail-closed: también es `true` mientras el riel está
   * `pending`, o sea antes de que el backend conteste. Este otro sólo es `true`
   * cuando el dueño **declaró** que no hay pagos.
   *
   * La diferencia importa por dos razones. Una de producto: prometer «los pagos
   * llegan pronto» mientras no sabemos si están vivos sería inventar una
   * promesa. Y una de verificación, que era un hueco medido: `pending` y
   * `authoritative + disabled` producían señales IDÉNTICAS en toda la UI, así
   * que ningún recorrido podía distinguir «no llegó el config» de «llegó y dice
   * que no hay pagos» — y por eso una aserción de ausencia pasaba trivialmente.
   * Este aviso es la primera superficie que sólo existe con el estado
   * autoritativo: es el **testigo positivo** de esta capability.
   */
  corteDeclarado: boolean;
  /** Selección v2 cerrada: se muestra lo propio pero no se permite editar. */
  informativeReadOnly: boolean;
  /**
   * C3/AF-34 · la mesa cerró SIN COBROS (`cerroSinCobros`). Antes de Listo v2 lo
   * decía la pantalla «Cierre completado»; con la selección cerrada visible
   * (R1, `903b6a8`) esa pantalla ya no se alcanza, y el testigo de honestidad
   * ratificado tiene que seguir diciéndolo acá. No afirma ningún movimiento de
   * dinero: lo niega.
   */
  informativeClosedWithoutCharges: boolean;
  /**
   * P1 · lo que se ve coincide con lo guardado y no hubo edición después: la
   * vista deja una nota fija y el círculo pasa a «Guardado», deshabilitado,
   * hasta que la persona toque algo. Es la única señal de éxito: el toast de
   * 2,4 s se leía como «no pasa nada».
   */
  informativeSaved: boolean;
  /** Bloquea filas/fracciones durante lectura, escritura y recarga. */
  informativeEditingBlocked: boolean;
  informativeLoading: boolean;
  /** Capability/ruta v2 ausente: nunca se presenta como guardada. */
  informativeUnsupported: boolean;
  /** GET propio falló: se recupera antes de permitir cualquier reemplazo. */
  informativeLoadError: boolean;
  onRetryInformative: () => void;
  busy: boolean;
  inviteOpen: boolean;
  onToggleItem: (id: string) => void;
  /** AF-25 · n80 · soltar un consumo propio no pagado. La red la hace `MesaScreen`. */
  onReleaseItem: (id: string) => void;
  /** AF-25 · el ítem que se está soltando, o `null`: apaga el botón mientras viaja. */
  soltando: string | null;
  /** AF-25 · `false` tras un 404 de ruta (backend anterior a v2.100.0). */
  soltarDisponible: boolean;
  /**
   * AF-25 · n72 · quiénes se sumaron. `oculto` para quien no organiza y para un
   * backend anterior (404): la sección no aparece. La red la hace `MesaScreen`.
   */
  quienesSeSumaron: QuienesSeSumaron;
  onReintentarQuienes: () => void;
  /**
   * AF-32 · la foto (`blob:`) de una fila, o `null` ⇒ iniciales. La pide y la
   * libera `MesaScreen`; acá sólo se dibuja.
   */
  fotoDe: (participantId: string | null) => string | null;
  /**
   * AF-34 · n98 · cerrar la mesa. `null` ⇒ el botón no está (retirado tras un
   * 403, un 409 `close_not_applicable` o un 404). La red la hace `MesaScreen`.
   */
  onCerrarMesa: (() => Promise<void>) | null;
  cerrando: boolean;
  onSetFraction: (id: string, bps: number) => void;
  onSetDenominator: (id: string, denominator: number) => void;
  onGoToPay: () => void;
  onRetryFrozenPay: () => void;
  onOpenInvite: () => void;
  onCopyInvitationLink: () => void;
  onBack: () => void;
}

function NaturalFractionSelector({
  itemId,
  original,
  remainingBps,
  selectedDenominator,
  allowOther,
  onChoose,
}: {
  itemId: string;
  original: number;
  remainingBps: number;
  selectedDenominator: number | null;
  allowOther: boolean;
  onChoose: (denominator: number) => void;
}) {
  const { t } = useIdioma();
  const [editingOther, setEditingOther] = useState(false);
  const [other, setOther] = useState('');
  const [error, setError] = useState<string | null>(null);
  const defaults = availableDefaultDenominators(original, remainingBps);
  const customSelected = selectedDenominator !== null && !defaults.includes(selectedDenominator);

  function applyOther() {
    if (!/^[1-9][0-9]*$/u.test(other)) {
      setError(t('Escribe un número entero positivo.'));
      return;
    }
    const denominator = Number(other);
    if (!Number.isSafeInteger(denominator) || denominator > original) {
      setError(t('El máximo para esta mesa es {0}.', original));
      return;
    }
    if (denominatorBps(denominator) > remainingBps) {
      setError(t('Esa porción ya no está disponible.'));
      return;
    }
    setError(null);
    onChoose(denominator);
    setEditingOther(false);
  }

  return (
    <>
      <div className="seg" role="radiogroup" aria-labelledby={`frac-${itemId}`}>
        {defaults.map((denominator) => (
          <button
            key={denominator}
            type="button"
            className={`seg-btn ${selectedDenominator === denominator ? 'on' : ''}`}
            onClick={() => { setEditingOther(false); setError(null); onChoose(denominator); }}
            role="radio"
            aria-checked={selectedDenominator === denominator}
            aria-label={denominator === 1 ? t('Entero') : `1/${denominator}`}
          >
            {denominator === 1 ? '1' : `1/${denominator}`}
          </button>
        ))}
        {allowOther && (
          <button
            type="button"
            className={`seg-btn ${editingOther || customSelected ? 'on' : ''}`}
            onClick={() => { setEditingOther(true); setOther(customSelected ? String(selectedDenominator) : ''); setError(null); }}
            role="radio"
            aria-checked={editingOther || customSelected}
          >
            {t('Otro')}
          </button>
        )}
      </div>
      {editingOther && (
        <div className="mi-frac-other">
          <label htmlFor={`frac-other-${itemId}`}>{t('¿Entre cuántas personas compartieron este plato?')}</label>
          <div className="mi-frac-other-row">
            <input
              id={`frac-other-${itemId}`}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={2}
              value={other}
              aria-invalid={error ? true : undefined}
              onChange={(event) => setOther(event.target.value)}
            />
            <button type="button" className="btn btn-ghost btn-sm" onClick={applyOther}>{t('Aplicar')}</button>
          </div>
          <div className={error ? 'form-error' : 'caption'} role={error ? 'alert' : undefined}>
            {error ?? t('Número entero entre 1 y {0}.', original)}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Los CINCO estados de una fila. Se nombran, en vez de recalcularse inline en
 * cada rama del JSX, porque de eso depende qué ve alguien sobre un plato que
 * quizá ya pagó: confundir "tomado" con "pagado" es confundir plata.
 */
type RowState = 'disponible' | 'parcial' | 'seleccionado' | 'tomado' | 'pagado' | 'indeterminado';

function rowStateOf(item: MesaItem, selected: Map<string, number>): RowState {
  if (selected.has(item.id)) return 'seleccionado';
  if (item.status === 'paid') return 'pagado';
  // ORDEN 1A.3 · sin un `remaining_bps` válido no se puede afirmar NADA de
  // este ítem: ni que está libre (era lo que pasaba: `undefined <= 0` y
  // `undefined > 0` son los dos `false`, así que caía en 'disponible') ni que
  // lo tomó otro. Queda no seleccionable y lo dice.
  if (!bpsValido(item.remaining_bps)) return 'indeterminado';
  // Bloqueado sólo si NO queda nada y nada es mío.
  if (item.remaining_bps <= 0 && item.my_bps === 0) return 'tomado';
  if (item.remaining_bps > 0 && item.remaining_bps < 10000) return 'parcial';
  return 'disponible';
}

/**
 * El copy del estado. Va SIEMPRE con palabras: el color y el ícono nunca son el
 * único portador de significado.
 *
 * *"Lo eligió otro"* y no *"Lo eligió otro · todavía no pagó"*: la mesa recarga
 * al montar, después de una acción propia o con el botón manual — no hay
 * polling ni WebSocket que traiga en vivo lo que hace otro comensal. Prometer
 * "todavía no pagó" como hecho instantáneo no sería cierto (§1.5).
 */
function rowTag(state: RowState, item: MesaItem, t: (s: string, ...a: unknown[]) => string): string | null {
  if (state === 'pagado') return t('Pagado');
  if (state === 'tomado') return t('Lo eligió otro');
  // No afirma que lo tomó otro —no lo sabemos—: dice que no pudimos leerlo.
  if (state === 'indeterminado') return t('No pudimos leer este ítem');
  if (state === 'parcial') return t('Queda {0}', bpsLabel(item.remaining_bps));
  return null;
}

/**
 * AF-25 · n80 · ¿el ítem es MÍO y lo elegí? Sólo en consumo, y nunca si ya está
 * pagado entero. Da la etiqueta «Lo elegiste», que antes no existía: medido el
 * 2026-09-19, un consumo ya reservado por la persona se veía «disponible» igual
 * que uno libre.
 */
export function esMioElegido(item: MesaItem, esConsumo: boolean): boolean {
  return esConsumo && item.status !== 'paid' && item.my_bps > 0;
}

/**
 * ¿Se OFRECE soltarlo?
 *
 * **AF-29 · con el dato del dueño (v2.103.0, cierra G-40):** si llega
 * `my_releasable_bps` válido, se ofrece si y sólo si es > 0. Es la misma
 * definición que usa la ruta de soltar (`itemClaims.sqlClaimLiberable`), así que
 * vale aunque en la mesa haya pagos de otros (`partially_paid`). Lo pagado y lo
 * que está en medio de un pago nunca entran en ese número.
 *
 * **AF-25 · sin el dato (backend anterior):** la regla provisoria. `my_bps`
 * suma lo reservado Y lo pagado, así que sólo se ofrece con la mesa `open` y
 * SIN NINGÚN pago (`paid_amount_cents === 0`), donde lo mío no puede estar
 * pagado. Un `my_releasable_bps` raro cuenta como ausente: se vuelve a esta.
 */
export function sePuedeSoltar(item: MesaItem, mesa: MesaDetail, esConsumo: boolean): boolean {
  if (!esMioElegido(item, esConsumo)) return false;
  if (bpsValido(item.my_releasable_bps)) {
    return item.my_releasable_bps > 0
      && (mesa.status === 'open' || mesa.status === 'partially_paid');
  }
  return item.locked_by_me
    && mesa.status === 'open'
    && mesa.paid_amount_cents === 0;
}

/**
 * AF-29 · el texto de lo mío. Con `my_paid_bps` > 0 distingue lo pagado de lo
 * elegido; sin el dato, lo de siempre («Lo elegiste» / «Elegiste ½»).
 */
export function etiquetaDeLoMio(item: MesaItem, t: (s: string, ...a: unknown[]) => string): string {
  const pagado = bpsValido(item.my_paid_bps) ? item.my_paid_bps : 0;
  if (pagado > 0) {
    const resto = item.my_bps - pagado;
    return resto > 0
      ? t('Pagaste {0} · elegiste {1} más', bpsLabel(pagado), bpsLabel(resto))
      : t('Ya lo pagaste');
  }
  return item.my_bps >= 10000 ? t('Lo elegiste') : t('Elegiste {0}', bpsLabel(item.my_bps));
}

/**
 * AF-34 · ¿se ofrece «Cerrar mesa»? Organizador, mesa SIN garantía y `open`.
 * Con pagos encendidos el dueño responde 409 `close_not_applicable` y el botón
 * se retira.
 */
export function sePuedeCerrar(mesa: Pick<MesaDetail, 'my_role' | 'guarantee_mode' | 'status'>): boolean {
  // Sólo `open`: el dueño responde 409 `mesa_not_active` a cualquier otro estado
  // (`contract-mirror/routes/mesas.js:1715`), también a `partially_paid`, y el
  // front diría «ya estaba cerrada» de una mesa que no lo estaba. Una mesa sin
  // garantía no tiene pagos, así que `partially_paid` no debería darse: igual no
  // se ofrece.
  return mesa.my_role === 'opener'
    && mesa.guarantee_mode === false
    && mesa.status === 'open';
}

/**
 * AF-34 · la confirmación de «Cerrar mesa»: dice qué pasa antes de pasar. Va por
 * portal con `.sheet-overlay` (la hoja con estilos; la de D-R20 usa clases sin
 * CSS y tiene su pendiente aparte). El botón de confirmar se apaga mientras viaja.
 */
function HojaCerrarMesa({ onConfirmar, onVolver, cerrando }: { onConfirmar: () => void; onVolver: () => void; cerrando: boolean }) {
  const { t } = useIdioma();
  return createPortal(
    <div className="sheet-overlay" onClick={onVolver}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t('¿Cerrar la mesa?')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-head">
          <span className="sheet-title">{t('¿Cerrar la mesa?')}</span>
          <button type="button" className="sheet-close" aria-label={t('Cerrar')} onClick={onVolver}>✕</button>
        </div>
        <ul className="cerrar-mesa-lista">
          <li>{t('La mesa se cierra para todos.')}</li>
          <li>{t('Lo que cada quien eligió queda como su consumo.')}</li>
          <li>{t('No se puede reabrir: para seguir, abre una mesa nueva.')}</li>
        </ul>
        <div className="cerrar-mesa-acciones">
          <button type="button" className="btn btn-ghost" onClick={onVolver}>{t('Volver')}</button>
          <button type="button" className="btn btn-navy" onClick={onConfirmar} disabled={cerrando}>
            {cerrando ? t('Cerrando…') : t('Sí, cerrar la mesa')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function MesaDetailView({
  mesa,
  code,
  userName,
  isGuest,
  guestHeader,
  selected,
  selectedDenominators,
  itemsAmount,
  mySlotsTaken,
  frozenScope,
  pagosCortados,
  corteDeclarado,
  informativeReadOnly,
  informativeClosedWithoutCharges,
  informativeSaved,
  informativeEditingBlocked,
  informativeLoading,
  informativeUnsupported,
  informativeLoadError,
  onRetryInformative,
  busy,
  inviteOpen,
  onToggleItem,
  onReleaseItem,
  soltando,
  soltarDisponible,
  quienesSeSumaron,
  onReintentarQuienes,
  fotoDe,
  onCerrarMesa,
  cerrando,
  onSetFraction,
  onSetDenominator,
  onGoToPay,
  onRetryFrozenPay,
  onOpenInvite,
  onCopyInvitationLink,
  onBack,
}: MesaDetailViewProps) {
  const { t } = useIdioma();
  const toast = useToast();
  /** El par «scroll + pulso» de §1.4/§1.5 bis, acá para la lista de consumos. */
  const [itemsPulse, setItemsPulse] = useState(false);
  /** AF-34 · la hoja de «¿Cerrar la mesa?», distinta de la de D-R20. */
  const [confirmandoCerrarMesa, setConfirmandoCerrarMesa] = useState(false);
  const itemsRef = useRef<HTMLDivElement | null>(null);
  const cd = countdownTo(mesa.expires_at);
  const urgente = countdownIsUrgent(cd);
  const esConsumo = mesa.division_mode === 'consumo';
  const original = originalParticipants(mesa.original_participants);
  const bpsPermitidosPorOriginal = original === null
    ? null
    : new Set(Array.from({ length: original }, (_, index) => denominatorBps(index + 1)));
  const reparto = corteDeclarado && esConsumo ? confirmedConsumptionProgress(mesa) : null;
  const repartoConocido = reparto?.status === 'known' ? reparto : null;
  const pctPagado = mesa.total_cents > 0 ? Math.round((mesa.paid_amount_cents / mesa.total_cents) * 100) : 0;
  const pct = repartoConocido?.visualPercent ?? (reparto ? 0 : pctPagado);
  const availableSlots = availableSlotsOf(mesa);
  const nothingLeft = nothingLeftFor(mesa);
  const divisionLabel = esConsumo
    ? t('cada uno lo suyo')
    : mesa.expected_participants === 1
      ? t('pagar el total')
      : t('partes iguales');

  /**
   * El aviso NO se oculta con el corte: el estado real de la persona es que
   * hay un pago sin confirmar. Lo que se retira es el botón, y con él la
   * promesa de reintentar. `#/pagos` se conserva y es donde puede verificarlo.
   */
  const avisoPagoCongelado = frozenScope && (
    <div className="note note-orange" role="status" style={{ marginBottom: 12 }}>
      <b>{t('Tienes un pago sin confirmar.')}</b>{' '}
      {pagosCortados
        ? t('Puede que ya se haya cobrado. Puedes revisarlo en Mis pagos.')
        : t('Puede que ya se haya cobrado. Reinténtalo tal cual antes de cambiar tu selección.')}
      {!pagosCortados && (
        <button
          className="btn btn-ghost btn-sm btn-fit"
          style={{ marginTop: 8 }}
          onClick={onRetryFrozenPay}
        >
          {t('Reintentar ese pago')}
        </button>
      )}
    </div>
  );

  /**
   * Fila superior de la barra. Lo dinámico vive acá y no en el nav item, que
   * dice "Continuar" siempre: un nav item que cambia de texto según el estado
   * es un nav item inestable (§1.5).
   *
   * **La selección sólo manda en CONSUMO** (auditoría 2026-08-06, H-14). En
   * ese modo el monto SALE de lo elegido, así que sin selección la fila guía
   * ("Elegí lo que consumiste") y Continuar espera. En PARTES IGUALES marcar
   * es información para el restaurante y la propia pantalla lo dice — "no
   * cambia lo que pagás" —, pero el gate viejo exigía seleccionar igual:
   * copy y gate se contradecían, y con una mesa sin ítems el Continuar
   * quedaba apagado PARA SIEMPRE, sin salida al pago. En igual la fila
   * muestra "Mi parte" desde que se entra (el monto es el del casillero
   * libre, como manda la tabla del spec) y Continuar sólo espera a que haya
   * casillero. El contrato acompaña: `payMesa` acepta `item_ids: []`
   * (`schemas/index.js:233`, default []).
   */
  const faltaElegir = esConsumo && selected.size === 0;

  const miParte = faltaElegir ? null : (
    <div className="mi-parte">
      {nothingLeft ? (
        <span>{t('No queda nada por pagar')}</span>
      ) : !esConsumo && availableSlots === 0 ? (
        <span>{t('No quedan partes')}</span>
      ) : (
        <>
          <span>{mySlotsTaken > 0 && !esConsumo ? t('Otra parte') : t('Mi parte')}</span>
          <span className="mi-parte-amt">{formatMXN(itemsAmount)}</span>
        </>
      )}
    </div>
  );

  /**
   * 🔴 §5 bis · E, adjudicado 2026-08-21 — el círculo no se apaga por FALTA DE
   * UN DATO. Acá había tres razones mezcladas en una línea y sólo UNA es de esa
   * clase; se separan porque las otras dos NO se retiran:
   *
   *   busy                  operación EN VUELO   → sigue apagando (AF-04)
   *   availableSlots === 0  no quedan casilleros  → sigue apagando · ver abajo
   *   selected.size === 0   falta elegir ítems    → SE RETIRA, frena explicando
   *
   * ⚠️ `availableSlots === 0` NO es «falta un dato», aunque se le parezca: no
   * hay nada que la persona pueda completar para avanzar — la mesa se llenó.
   * Un círculo tocable que no puede avanzar nunca es el botón muerto que §E
   * quiere evitar, no el que quiere habilitar. Le declaré esta fila al
   * Bibliotecario como «se retira `selected.size===0`, se conserva `busy`»;
   * mirándola de cerca son TRES razones, no dos.
   */
  const faltaElegirConsumos = esConsumo && selected.size === 0;
  const continuarDeshabilitado = busy || (!esConsumo && availableSlots === 0);

  return (
    <div className="screen has-appbar">
      <AppHeaderFlow userName={userName} onBack={onBack} bellBlocked={busy || !!frozenScope} />
      <div className="title-card mesa-selection-title">
        <h1 className="title-card-title">{t('¿Qué consumiste?')}</h1>
        <div className="title-card-sub mesa-selection-context">
          <span className="mesa-selection-context-main">{mesa.restaurant.name} / {code}</span>
          <span aria-hidden="true">·</span>
          <strong>{divisionLabel}</strong>
        </div>
        <div className="title-card-div" />
        <div
          className="mi-progress"
          role="progressbar"
          aria-valuenow={reparto?.status === 'unknown' ? undefined : pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={repartoConocido
            ? t('Asignado {0}% de la mesa', pct)
            : reparto
              ? t('No pudimos calcular el reparto confirmado')
              : t('Pagado {0}% de la mesa', pct)}
        >
          <div className="mi-progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="mi-meta">
          <span className="mi-meta-amt">
            {repartoConocido ? (
              <>
                {t('{0} asignados', formatMXN(repartoConocido.assignedCents))} ·{' '}
                {repartoConocido.differenceCents >= 0
                  ? t('{0} por asignar', formatMXN(repartoConocido.differenceCents))
                  : t('{0} por encima del total', formatMXN(Math.abs(repartoConocido.differenceCents)))}{' '}
                ({pct}%)
              </>
            ) : reparto ? (
              t('No pudimos calcular el reparto confirmado')
            ) : (
              <>{formatMXN(mesa.paid_amount_cents)} {t('de')} {formatMXN(mesa.total_cents)} ({pct}%)</>
            )}
          </span>
          <span className={`mi-count ${urgente ? 'urgent' : ''}`}>
            <Icon name="clock" size={14} /> {cd ?? t('venció')}
          </span>
        </div>
      </div>
      {guestHeader}
      <div className="scroll flow-scroll con-fila-sobre-barra mesa-selection-scroll">
        {avisoPagoCongelado}
        {!esConsumo && informativeReadOnly && (
          <div className="note note-teal" style={{ marginBottom: 12 }}>
            {informativeClosedWithoutCharges && (
              <div><strong>{t('Esta mesa cerró sin cobros')}</strong></div>
            )}
            <div>{t('Esta mesa ya cerró. Lo guardado es sólo de lectura.')}</div>
          </div>
        )}
        {!esConsumo && informativeSaved && (
          <div className="note note-teal" role="status" style={{ marginBottom: 12 }}>
            {t('Tu selección quedó guardada. Si cambias algo, vuelve a tocar «Listo».')}
          </div>
        )}
        {!esConsumo && informativeLoading && !informativeSaved && (
          <div className="note note-teal" role="status" style={{ marginBottom: 12 }}>
            {t('Estamos leyendo tu selección guardada…')}
          </div>
        )}
        {!esConsumo && informativeUnsupported && (
          <div className="note note-amber" style={{ marginBottom: 12 }}>
            {t('Esta versión del servicio no puede guardar la selección informativa. Nada se marcó como guardado.')}
          </div>
        )}
        {!esConsumo && informativeLoadError && (
          <div className="note note-amber" role="alert" style={{ marginBottom: 12 }}>
            {t('No pudimos leer tu selección guardada. No vamos a reemplazarla sin recuperarla primero.')}
            <button type="button" className="btn btn-ghost btn-sm btn-fit" onClick={onRetryInformative}>
              {t('Reintentar lectura')}
            </button>
          </div>
        )}
        {esConsumo && nothingLeft && (
          <div className="note note-amber" style={{ marginBottom: 12 }}>
            {t('Los demás ya tomaron todo lo de esta mesa. No queda nada para que pagues.')}
          </div>
        )}
        <div
          ref={itemsRef}
          className={`card${faltaElegirConsumos ? ' tk-fold--pending' : ''}${itemsPulse ? ' tk-fold--pulse' : ''}`}
          style={{ marginBottom: 14 }}
          onAnimationEnd={() => setItemsPulse(false)}
        >
          {mesa.items.map((i) => {
            const fullPrice = i.price_cents * i.quantity;
            // En igualdad la selección sólo declara consumo y no reclama el
            // ítem: otras tenencias/remaining_bps no deben bloquearla.
            const state = esConsumo
              ? rowStateOf(i, selected)
              : selected.has(i.id) ? 'seleccionado' : 'disponible';
            const sel = state === 'seleccionado';
            // 1A.3 · 'indeterminado' bloquea igual que 'tomado': sin dato
            // válido no se ofrece tomar nada.
            const bloqueado = state === 'tomado' || state === 'pagado' || state === 'indeterminado';
            const mio = !sel && esMioElegido(i, esConsumo);
            const soltable = mio && soltarDisponible && !frozenScope && sePuedeSoltar(i, mesa, esConsumo);
            const tag = mio ? etiquetaDeLoMio(i, t) : rowTag(state, i, t);
            const myBpsSel = selected.get(i.id) ?? 10000;
            const selectedDenominator = selectedDenominators.get(i.id) ?? null;
            const selectorNatural = esConsumo && pagosCortados && original !== null;
            const allowOther = selectorNatural && Array.from(
              { length: Math.max(0, original - 4) },
              (_, index) => index + 5,
            ).some((denominator) => denominatorBps(denominator) <= i.remaining_bps);
            // En partes iguales marcar es informativo y no reserva nada, así
            // que ahí NUNCA se bloquea una fila: el monto no depende de esto.
            const disabled = (esConsumo && bloqueado) || (!esConsumo && informativeEditingBlocked);
            const precio =
              sel && esConsumo && myBpsSel < 10000
                ? fractionPreview(fullPrice, myBpsSel, i.remaining_bps)
                : fullPrice;
            return (
              <div key={i.id} className={`mi-item${soltable ? ' has-release' : ''}`}>
                <button
                  type="button"
                  className={`mi-row ${sel ? 'sel' : ''}${soltable ? ' has-release' : ''}`}
                  onClick={() => !disabled && onToggleItem(i.id)}
                  disabled={disabled}
                  aria-pressed={!esConsumo ? sel : disabled ? undefined : sel}
                  aria-label={`${i.name}${i.quantity > 1 ? ` por ${i.quantity}` : ''}${tag ? t(', {0}', tag) : ''}`}
                >
                  <span
                    className={`mi-check ${sel ? 'on' : ''} ${state === 'pagado' ? 'paid' : ''} ${state === 'tomado' ? 'taken' : ''}`}
                    aria-hidden="true"
                  >
                    {state === 'tomado' ? (
                      <Icon name="lock" size={13} />
                    ) : (
                      <Icon name="check" size={15} />
                    )}
                  </span>
                  <span className="mi-body">
                    <span className={`mi-name ${bloqueado ? 'dim' : ''} ${state === 'pagado' ? 'paid' : ''}`}>
                      {i.name}
                      {i.quantity > 1 ? ` × ${i.quantity}` : ''}
                    </span>
                    {tag && <span className="mi-tag">{tag}</span>}
                  </span>
                  <span className={`mi-price ${bloqueado ? 'dim' : ''}`}>{formatMXN(precio)}</span>
                </button>
                {soltable && (
                  <button
                    type="button"
                    className="mi-soltar"
                    onClick={() => onReleaseItem(i.id)}
                    disabled={soltando !== null}
                    aria-label={soltando === i.id ? t('Soltando…') : t('Soltar {0}', i.name)}
                    aria-busy={soltando === i.id || undefined}
                  >
                    <Icon name={soltando === i.id ? 'clock' : 'x-circle'} size={22} />
                  </button>
                )}
                {/* Selector de porción en LOS DOS MODOS. En consumo expresa
                    tenencia/cobro y se limita por lo restante; en igualdad es
                    sólo `declared_fraction_bps`, sin alterar el casillero. */}
                {sel && (
                  <div className="mi-frac">
                    <div className="mi-frac-lbl" id={`frac-${i.id}`}>
                      {t('¿Cuánto tomas tú?')}
                    </div>
                    {selectorNatural ? (
                      <NaturalFractionSelector
                        itemId={i.id}
                        original={original}
                        remainingBps={i.remaining_bps}
                        selectedDenominator={selectedDenominator}
                        allowOther={allowOther}
                        onChoose={(denominator) => onSetDenominator(i.id, denominator)}
                      />
                    ) : (
                      <div className="seg" role="radiogroup" aria-labelledby={`frac-${i.id}`}>
                        {FRACTIONS.filter((f) => (
                          (!esConsumo || f.bps <= i.remaining_bps)
                          && (!esConsumo || bpsPermitidosPorOriginal === null || bpsPermitidosPorOriginal.has(f.bps))
                        )).map((f) => (
                          <button
                            key={f.bps}
                            type="button"
                            className={`seg-btn ${myBpsSel === f.bps ? 'on' : ''}`}
                            onClick={() => onSetFraction(i.id, f.bps)}
                            disabled={!esConsumo && informativeEditingBlocked}
                            role="radio"
                            aria-checked={myBpsSel === f.bps}
                            aria-label={f.bps >= 10000 ? t('Entero') : bpsLabel(f.bps)}
                          >
                            {f.label}
                          </button>
                        ))}
                      </div>
                    )}
                    {esConsumo && pagosCortados && original === null && (
                      <div className="caption">
                        {t('Esta mesa es anterior y no guardó el número original de personas. Mostramos las porciones disponibles de siempre.')}
                      </div>
                    )}
                    {esConsumo && (
                      <div className="mi-frac-amt" aria-live="polite">
                        {t('Tu parte:')} {formatMXN(fractionPreview(fullPrice, myBpsSel, i.remaining_bps))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {/* v2.25 §4.3 (B-06): `claimed_by_me` es lo único que le permite al
            comensal ver que su parte YA está tomada. Sin esto volvía, veía
            casilleros libres y pagaba de nuevo — llevándose el de otro.
            No se bloquea: pagar más de una parte es legítimo (acta
            2026-07-25), pero tiene que ser una decisión, no un accidente. */}
        {mySlotsTaken > 0 && !esConsumo && (
          <div className="note note-teal" style={{ marginTop: 8 }}>
            <b>{t('Ya pagaste')} {mySlotsTaken === 1 ? t('tu parte') : t('{0} partes', mySlotsTaken)} ✓</b>
            {availableSlots > 0 && ' Si tocas pagar de nuevo, cubres la parte de otro comensal.'}
          </div>
        )}
        {/* AF-25 · n72 · quiénes se sumaron: nombre, apellido e identificador,
            SÓLO para el organizador (la decisión la toma `MesaScreen`, que ni
            pide la lista si no lo sos). Sin foto, sin montos, sin quién eligió
            ni pagó qué: el dueño no lo manda y el decodificador lo rechazaría. */}
        {quienesSeSumaron.estado !== 'oculto' && (
          <section className="quienes" aria-label={t('Quiénes se sumaron')}>
            <h2 className="sectlabel">{t('Quiénes se sumaron')}</h2>
            {quienesSeSumaron.estado === 'cargando' ? (
              <p className="quienes-vacio" aria-busy="true">{t('Cargando quiénes se sumaron…')}</p>
            ) : quienesSeSumaron.estado === 'error' ? (
              <div className="quienes-vacio" role="alert">
                {t('No pudimos cargar quiénes se sumaron.')}{' '}
                <button type="button" className="btn btn-ghost btn-sm btn-fit" onClick={onReintentarQuienes}>
                  {t('Reintentar')}
                </button>
              </div>
            ) : quienesSeSumaron.lista.length === 0 ? (
              <p className="quienes-vacio">{t('Todavía no se sumó nadie.')}</p>
            ) : (
              <ul className="quienes-lista">
                {quienesSeSumaron.lista.map((p, idx) => {
                  const fila = filaDeParticipante(p);
                  return (
                    // Sin id estable en el contrato: el orden de llegada es el del dueño.
                    <li key={idx} className="quien">
                      {fila.tipo === 'persona' ? (
                        (() => {
                          // AF-32 · foto si el dueño la dio y llegó; si no, iniciales.
                          const foto = fotoDe(p.participantId);
                          const quien = fila.nombre ?? fila.paymeId ?? '';
                          return foto ? (
                            <img className="avatar quien-foto" src={foto} alt={t('Foto de {0}', quien)} />
                          ) : (
                            <Avatar name={quien} />
                          );
                        })()
                      ) : (
                        // Invitado y cuenta eliminada: como antes, sin avatar;
                        // el hueco mantiene alineados los nombres.
                        <span className="quien-hueco" aria-hidden="true" />
                      )}
                      <span className="quien-texto">
                        {fila.tipo === 'invitado' ? (
                          <span className="quien-nombre">{t('Invitado')}</span>
                        ) : fila.tipo === 'eliminada' ? (
                          <span className="quien-nombre dim">{t('Cuenta eliminada')}</span>
                        ) : (
                          <>
                            <span className="quien-nombre">{fila.nombre ?? fila.paymeId}</span>
                            {fila.nombre !== null && fila.paymeId !== null && (
                              <span className="quien-id">{fila.paymeId}</span>
                            )}
                          </>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}
        {/* T-F1: el organizador puede invitar amigos in-app también acá —
            la pantalla de compartir post-crear se ve UNA sola vez. */}
        {!isGuest && mesa.my_role === 'opener' && (mesa.status === 'open' || mesa.status === 'partially_paid') && (
          <div className="mesa-secondary-actions">
            {/* AF-36 · colores elegidos por Mati: invitar en turquesa lleno, copiar
                con borde turquesa y cerrar en gris, para que no compita. */}
            <button className="btn btn-borde-turquesa btn-sm btn-fit" onClick={onCopyInvitationLink}>
              <Icon name="link" size={16} className="ico-inline" /> {t('Copiar link de invitación')}
            </button>
            {inviteOpen ? (
              <InviteFriends code={code} />
            ) : (
              <button className="btn btn-turquesa btn-sm btn-fit" onClick={onOpenInvite}>
                <Icon name="users" size={16} className="ico-inline" /> {t('Invitar amigos de PayMe')}
              </button>
            )}
            {/* AF-34 · n98 · sólo la mesa SIN garantía (el dueño responde 409
                `close_not_applicable` a las otras): el organizador ya está
                garantizado por el bloque que la contiene. */}
            {onCerrarMesa && sePuedeCerrar(mesa) && (
              <button
                type="button"
                className="btn btn-neutro btn-sm btn-fit mesa-cerrar"
                onClick={() => setConfirmandoCerrarMesa(true)}
                disabled={cerrando}
              >
                <Icon name="lock" size={16} className="ico-inline" /> {t('Cerrar mesa')}
              </button>
            )}
          </div>
        )}
      </div>
      {confirmandoCerrarMesa && onCerrarMesa && (
        <HojaCerrarMesa
          cerrando={cerrando}
          onVolver={() => setConfirmandoCerrarMesa(false)}
          // La hoja queda abierta con «Cerrando…» apagado hasta que el dueño
          // contesta: un segundo toque cae en el botón apagado, no en lo que
          // hay debajo. Si se cerró, la pantalla pasa al cierre.
          onConfirmar={() => { void onCerrarMesa().finally(() => setConfirmandoCerrarMesa(false)); }}
        />
      )}
      {/* Con pagos apagados, Listo es el único acto explícito de persistencia.
          No navega ni cobra; cerrado/lectura/error lo deshabilitan hasta que el
          estado propio sea conocido. */}
      <AppBottomBar
        active={null}
        above={miParte}
        center={pagosCortados ? {
          // P1 · con lo guardado a la vista el círculo lo dice y no se puede
          // volver a enviar lo mismo; la primera edición lo devuelve a «Listo».
          label: !esConsumo && informativeSaved ? t('Guardado') : t('Listo'),
          icon: 'check',
          /**
           * D-R8 · con el corte el círculo **registra la selección** y termina
           * el recorrido; antes salía sin registrar nada, y el aviso que la
           * persona lee —«tu selección queda registrada»— habría sido falso.
           * Incluso vacío se envía como reemplazo deliberado, pero sólo después
           * de una lectura acreditada. Marcar el último ítem continúa siendo
           * local y nunca envía por sí mismo.
           */
          onClick: () => {
            onGoToPay();
          },
          disabled: busy || (!esConsumo && (informativeEditingBlocked || informativeSaved)),
        } : {
          label: t('Continuar'),
          icon: 'arrow-right',
          onClick: () => {
            // Frena explicando, no apagado (§5 bis · E): toast + scroll + pulso,
            // las tres. `onGoToPay` no se llama: no se avanza sin elegir.
            if (faltaElegirConsumos) {
              toast(t('Elige lo que consumiste para continuar'));
              itemsRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
              setItemsPulse(true);
              return;
            }
            onGoToPay();
          },
          disabled: continuarDeshabilitado,
        }}
      />
    </div>
  );
}
