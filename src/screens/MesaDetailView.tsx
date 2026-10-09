import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useIdioma } from '../i18n/idioma';
import { AppBottomBar } from '../components/AppBottomBar';
import { AppHeaderFlow } from '../components/AppHeader';
import { Icon } from '../components/Icon';
import { useHojaModal } from '../components/useHojaModal';
import { Avatar, useToast } from '../components/ui';
import { InviteFriends } from '../components/InviteFriends';
import { Desplegable, SolicitudesParaUnirse } from '../components/TuMesa';
import type { SolicitudParaElTitular } from '../api/joinRequests';
import type { MesaDetail, MesaItem } from '../api/types';
import { denominatorBps, originalParticipants } from '../api/mesaPresentation';
import { filaDeParticipante, type Participante } from '../api/participantes';
import { useUsernameCapability } from '../api/username';
import { countdownTo, formatMXN } from '../utils/format';
import {
  availableSlotsOf,
  bpsLabel,
  bpsValido,
  confirmedConsumptionProgress,
  countdownIsUrgent,
  fractionPreview,
  informativoPublicado,
  limiteInformativo,
  nothingLeftFor,
  progresoConBorrador,
  restanteInformativo,
} from './mesaItemsView';
import { etiquetaPorcion, porcionesDisponibles, textoPlatos } from './queConsumisteView';
import {
  elegidosAlGuardar,
  elegidosRegistrados,
  lineasElegidas,
  seleccionCierraLaMesa,
} from './antesDeCerrar';

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

/** D219 · D223 · las solicitudes para unirse, como las ve el titular. */
export type SolicitudesDeUnirse =
  | { readonly estado: 'oculto' }
  | { readonly estado: 'cargando' }
  | { readonly estado: 'error' }
  | { readonly estado: 'lista'; readonly lista: readonly SolicitudParaElTitular[] };

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
   * n224 · ese pago sin confirmar NO se puede reenviar desde esta sesión
   * (`requiresReconciliation`, `freezeMachine.ts`): sólo queda reconciliarlo.
   * Antes el detalle no lo sabía y ofrecía «Reintentar ese pago», cuyo desenlace
   * inmediato era el bloqueo de la vista de pago. Con esto el detalle no promete
   * un reintento: el botón lleva a la misma vista, pero a revisar si se cobró.
   */
  frozenRequiresReconciliation: boolean;
  /**
   * CORTE DEL VIERNES (`releaseGates.ts`) · con el corte activo la pantalla
   * TERMINA acá: el círculo «Listo» no lleva al pago y no hay reintento de un pago
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
  /**
   * Decisión 79 · la selección informativa YA GUARDADA de esta cuenta (no el
   * borrador). Hace falta para saber cuánto puede declarar: el restante del
   * dueño ya la incluye.
   */
  informativasGuardadas: ReadonlyMap<string, number>;
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
   * D219 · D223 · las solicitudes para unirse (sólo el titular, con la mesa
   * abierta; `oculto` para los demás). La red y las decisiones las hace
   * `MesaScreen`; acá se dibujan y se avisan las intenciones.
   */
  solicitudes: SolicitudesDeUnirse;
  /** Los ids con una decisión en vuelo: su fila queda ocupada. */
  decidiendo: ReadonlySet<string>;
  onDecidirSolicitud: (id: string, accion: 'aceptar' | 'rechazar') => void;
  onReintentarSolicitudes: () => void;
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
 * al montar, después de una acción propia, con el botón manual y —desde F-1
 * (decisión 79)— cada 10 s y al volver a la app. Sigue sin ser en vivo, así
 * que prometer "todavía no pagó" como hecho instantáneo no sería cierto (§1.5).
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
 * Decisión 79 · la etiqueta de un plato en «igual». Mismos textos que consumo:
 * «Lo eligió otro» cuando no queda nada para esta cuenta, y «Queda {porción}»
 * mientras falte. Nunca dice quién eligió ni cuántos (el dueño no lo publica).
 */
function tagIgual(
  state: RowState,
  restante: number | null,
  t: (s: string, ...a: unknown[]) => string,
): string | null {
  if (state === 'tomado') return t('Lo eligió otro');
  if (restante !== null && restante > 0 && restante < 10000) return t('Queda {0}', bpsLabel(restante));
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
 * AF-34 · D240 punto 8 · la hoja ANTES de que la mesa se cierre: dice qué pasa,
 * muestra lo que elegiste y ofrece revisarlo, porque después ya no se puede
 * modificar. La usan «Cerrar mesa» y el «Listo» que completa la mesa. Va por
 * portal con `.sheet-overlay`. El foco entra en «Revisar», la salida segura
 * (D202); el ✕, Escape y el velo salen sin revisar. El botón de confirmar se
 * apaga mientras viaja.
 */
function HojaAntesDeCerrar({
  titulo,
  renglones,
  mios,
  sinGuardar,
  confirmar,
  cerrando,
  onRevisar,
  onSalir,
  onConfirmar,
}: {
  titulo: string;
  renglones: readonly string[];
  mios: readonly { key: string; texto: string }[];
  sinGuardar: boolean;
  confirmar: string;
  cerrando: boolean;
  onRevisar: () => void;
  onSalir: () => void;
  onConfirmar: () => void;
}) {
  const { t } = useIdioma();
  const hoja = useRef<HTMLDivElement | null>(null);
  const revisar = useRef<HTMLButtonElement | null>(null);
  useHojaModal(hoja, revisar, onSalir);
  // Con muchos platos, los botones no se pierden debajo: hasta 4 y «y N más».
  const visibles = mios.slice(0, 4);
  const resto = mios.length - visibles.length;
  return createPortal(
    <div className="sheet-overlay" onClick={onSalir}>
      <div
        ref={hoja}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-head">
          <span className="sheet-title">{titulo}</span>
          <button type="button" className="sheet-close" aria-label={t('Cerrar')} onClick={onSalir}>✕</button>
        </div>
        <p className="cerrar-mesa-aviso">{t('Revisa lo que elegiste: después de cerrar ya no se puede modificar.')}</p>
        <div className="cerrar-mesa-mios">
          <p className="cerrar-mesa-mios-titulo">{t('Lo que elegiste')}</p>
          {mios.length === 0 ? (
            <p className="cerrar-mesa-nada">{t('Todavía no elegiste nada.')}</p>
          ) : (
            <ul>
              {visibles.map((m) => <li key={m.key}>{m.texto}</li>)}
              {resto > 0 && <li className="cerrar-mesa-resto">{t('y {0} más', resto)}</li>}
            </ul>
          )}
        </div>
        {sinGuardar && (
          <p className="note note-amber cerrar-mesa-sin-guardar">
            {t('Marcaste consumos sin tocar «Listo»: si cierras ahora, no quedan registrados.')}
          </p>
        )}
        <ul className="cerrar-mesa-lista">
          {renglones.map((r) => <li key={r}>{r}</li>)}
        </ul>
        <div className="cerrar-mesa-acciones">
          <button ref={revisar} type="button" className="btn btn-ghost" onClick={onRevisar}>{t('Revisar')}</button>
          <button type="button" className="btn btn-navy" onClick={onConfirmar} disabled={cerrando}>
            {cerrando ? t('Cerrando…') : confirmar}
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
  itemsAmount,
  mySlotsTaken,
  frozenScope,
  frozenRequiresReconciliation,
  pagosCortados,
  corteDeclarado,
  informativeReadOnly,
  informativeClosedWithoutCharges,
  informativeSaved,
  informativeEditingBlocked,
  informativasGuardadas,
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
  solicitudes,
  decidiendo,
  onDecidirSolicitud,
  onReintentarSolicitudes,
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
  /** AF-USERNAME-D104 · «Quiénes se sumaron» muestra el @, nunca el `payme_id`. */
  const { enabled: arrobaHabilitada } = useUsernameCapability();
  const toast = useToast();
  /** El par «scroll + pulso» de §1.4/§1.5 bis, acá para la lista de consumos. */
  const [itemsPulse, setItemsPulse] = useState(false);
  /**
   * AF-34 · D240 punto 8 · la hoja antes del cierre (distinta de la de D-R20):
   * `cerrar` la abre «Cerrar mesa»; `seleccion`, el «Listo» que completa la mesa.
   */
  const [hojaCierre, setHojaCierre] = useState<null | 'cerrar' | 'seleccion'>(null);
  const botonCerrarMesa = useRef<HTMLButtonElement | null>(null);
  const pantallaRef = useRef<HTMLDivElement | null>(null);
  const itemsRef = useRef<HTMLDivElement | null>(null);
  /**
   * D223 · «Tu mesa» es la del TITULAR. Quien no lo es ve la pantalla de
   * siempre, con «¿Qué consumiste?» y la lista abierta.
   */
  const esTitular = !isGuest && mesa.my_role === 'opener';
  /** «Tus consumos» arranca cerrado (turno 2 · 2.9). */
  const [consumosAbierto, setConsumosAbierto] = useState(false);
  /**
   * Qué arranca abierto (turno 2 · 2.10 y 2.11): con solicitudes, ellas
   * abiertas y quiénes cerrado; sin solicitudes, quiénes abierto. Se decide con
   * la PRIMERA lista que llega; después manda lo que toque la persona (`null` =
   * todavía no tocó). Una solicitud que llega más tarde no cambia nada.
   */
  const [quienesAbierto, setQuienesAbierto] = useState<boolean | null>(null);
  const [solicitudesAbierto, setSolicitudesAbierto] = useState<boolean | null>(null);
  const [habiaSolicitudesAlEntrar, setHabiaSolicitudesAlEntrar] = useState<boolean | null>(null);
  useEffect(() => {
    if (habiaSolicitudesAlEntrar !== null) return;
    // Sólo con una respuesta: `oculto` es también el estado ANTES de pedir, y
    // decidir con él dejaba quiénes abierto aunque llegaran solicitudes.
    if (solicitudes.estado === 'lista') setHabiaSolicitudesAlEntrar(solicitudes.lista.length > 0);
    else if (solicitudes.estado === 'error') setHabiaSolicitudesAlEntrar(false);
  }, [solicitudes, habiaSolicitudesAlEntrar]);
  const quienesAbiertoEfectivo = quienesAbierto ?? habiaSolicitudesAlEntrar !== true;
  const solicitudesAbiertoEfectivo = solicitudesAbierto ?? true;
  const cd = countdownTo(mesa.expires_at);
  const urgente = countdownIsUrgent(cd);
  const esConsumo = mesa.division_mode === 'consumo';
  const original = originalParticipants(mesa.original_participants);
  /** AF-QUE-CONSUMISTE · el renglón propio que muestra el selector, o ninguno. */
  const [abierto, setAbierto] = useState<string | null>(null);
  /**
   * Regla 3 del diseño · marcar un plato lo toma con la mayor porción que cabe
   * (la decide `MesaScreen`) y, si hay más de una, abre el selector en el mismo
   * renglón; con una sola opción se marca directo (regla 4).
   */
  const tomarPlato = (id: string, cuantasOpciones: number): void => {
    onToggleItem(id);
    setAbierto(cuantasOpciones > 1 ? id : null);
  };
  /**
   * Con el N de la mesa y los pagos apagados, la porción viaja como denominador
   * (AB-FRACCIONES-IGUAL); si no, como bps. Las cuatro porciones son de las dos
   * listas: 10000, 5000, 3333 y 2500.
   */
  const selectorNatural = pagosCortados && original !== null;
  const elegirPorcion = (id: string, denominator: number): void => {
    if (selectorNatural) onSetDenominator(id, denominator);
    else onSetFraction(id, denominatorBps(denominator));
    setAbierto(null);
  };
  // Decisión 79 · en «igual» con el dato del dueño (v2.134.0), la barra dice lo
  // ELEGIDO igual que en consumo, contando desde `informative_remaining_bps`.
  // Sin el dato rige lo de antes: lo pagado.
  //
  // AF-BARRA-EN-VIVO · decisión 107, punto 3 · y suma el borrador propio antes de
  // «Listo» (`progresoConBorrador`). En «igual», sólo con la selección guardada
  // ya leída: sin ella no se sabe qué reemplaza el borrador, y la barra dice lo
  // registrado.
  const guardadaLeida = !informativeLoading && !informativeUnsupported && !informativeLoadError
    && !informativeReadOnly;
  const repartoCalculado = useMemo(() => (!corteDeclarado
    ? null
    : esConsumo
      ? progresoConBorrador(mesa, (item) => item.remaining_bps, () => 0, selected)
      : !informativoPublicado(mesa)
        ? null
        : guardadaLeida
          ? progresoConBorrador(
              mesa,
              (item) => item.informative_remaining_bps,
              (item) => informativasGuardadas.get(item.id) ?? 0,
              selected,
            )
          : confirmedConsumptionProgress(mesa, (item) => item.informative_remaining_bps)),
  [corteDeclarado, esConsumo, guardadaLeida, informativasGuardadas, mesa, selected]);
  // Mientras «Listo» viaja, la barra se queda como estaba: un refresco que llegue
  // en ese rato ya trae lo registrado, y sumado al borrador lo contaría dos veces.
  const repartoPrevio = useRef(repartoCalculado);
  useLayoutEffect(() => { if (!busy) repartoPrevio.current = repartoCalculado; });
  const reparto = busy ? repartoPrevio.current : repartoCalculado;
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
   *
   * n224 · con el pago que sólo se puede RECONCILIAR tampoco se promete un
   * reintento. Texto: decisión 10 de Mati, literal («Aprobar el texto»,
   * `DECISION_MATI_DECISIONES_7_A_14_20260923.md`), que además oculta «Reintentar»
   * mientras el pago esté en revisión. El botón que queda no reintenta: dice
   * «Revisar si se cobró», que es lo que la vista de pago ofrece en ese estado
   * (N-07). No se quita porque es el único camino a esa salida: sin él la
   * revisión nunca «se resuelve» y el pago quedaría bloqueado.
   */
  const soloReconciliar = frozenRequiresReconciliation && !pagosCortados;
  const avisoPagoCongelado = frozenScope && (
    <div className="note note-orange" role="status" style={{ marginBottom: 12 }}>
      <b>{t('Tienes un pago sin confirmar.')}</b>{' '}
      {soloReconciliar
        ? t('Este pago quedó pendiente de revisión. Cuando se resuelva, vas a poder reintentar.')
        : pagosCortados
          ? t('Puede que ya se haya cobrado. Puedes revisarlo en Mis pagos.')
          : t('Puede que ya se haya cobrado. Reinténtalo tal cual antes de cambiar tu selección.')}
      {!pagosCortados && (
        <button
          className="btn btn-ghost btn-sm btn-fit"
          style={{ marginTop: 8 }}
          onClick={onRetryFrozenPay}
        >
          {soloReconciliar ? t('Revisar si se cobró') : t('Reintentar ese pago')}
        </button>
      )}
    </div>
  );

  /**
   * Fila superior de la barra. Lo dinámico vive acá y no en el nav item, que
   * dice "Listo" siempre (decisión 90; antes "Continuar" hacia el pago): un nav
   * item que cambia de texto según el estado es un nav item inestable (§1.5).
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
          {/* Regla 8 del diseño · «Mi parte · N platos» y el monto. N cuenta los
              platos de la selección, que son los que suma el monto. */}
          <span className="mi-parte-lbl">
            {mySlotsTaken > 0 && !esConsumo ? t('Otra parte') : t('Mi parte')}
            <span className="mi-parte-platos"> · {textoPlatos(selected.size, t)}</span>
          </span>
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
  // Decisión 32 · en consumo, «registrado» vive en el dueño (`my_bps`): con algo
  // registrado y nada nuevo, «Listo» vuelve a Inicio en vez de quedarse mudo.
  const tengoRegistrado = esConsumo && mesa.items.some((i) => i.my_bps > 0 && i.status !== 'paid');
  // Frena explicando, no apagado (§5 bis · E): toast + scroll + pulso, las
  // tres. Compartido por «Continuar» y «Listo»: nunca se avanza sin elegir.
  const frenarSinEleccion = (): void => {
    toast(t('Elige lo que consumiste para continuar'));
    llevarALaLista(false);
  };
  /**
   * Scroll + pulso hasta la lista. D223 · en «Tu mesa» la lista vive dentro de
   * «Tus consumos», que puede estar cerrado: se abre ANTES de bajar, si no el
   * aviso lleva a una tarjeta cerrada que no dice qué falta. D240 punto 8 · desde
   * «Revisar» además deja el foco en la lista (la hoja se acaba de ir).
   */
  const llevarALaLista = (enfocar: boolean): void => {
    const ir = () => {
      itemsRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      if (enfocar) itemsRef.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    };
    if (esTitular && !consumosAbierto) {
      setConsumosAbierto(true);
      requestAnimationFrame(ir);
    } else if (enfocar) {
      requestAnimationFrame(ir);
    } else {
      ir();
    }
    setItemsPulse(true);
  };
  /**
   * D240 punto 8 · ¿este «Listo» cierra la mesa? Sólo sin garantía y abierta,
   * con algo nuevo que guardar y con lo que el dueño publica de cada plato: en
   * consumo el borrador se suma; en «igual», con la selección guardada ya leída,
   * la reemplaza.
   */
  const listoCierraLaMesa = mesa.guarantee_mode === false && mesa.status === 'open' && (esConsumo
    ? seleccionCierraLaMesa(mesa, (item) => item.remaining_bps, () => 0, selected)
    : guardadaLeida && !informativeSaved && informativoPublicado(mesa)
      && seleccionCierraLaMesa(
        mesa,
        (item) => item.informative_remaining_bps,
        (item) => informativasGuardadas.get(item.id) ?? 0,
        selected,
      ));
  /** Vuelve el foco al círculo «Listo» (el de esta pantalla). */
  const enfocarListo = (): void => {
    requestAnimationFrame(() => pantallaRef.current?.querySelector<HTMLButtonElement>('.appbar-center')?.focus());
  };
  /**
   * D223 · D (aprobado) · el encabezado de «Tus consumos»: cuántos elegiste, no
   * cuánto (el monto vive en la burbuja y en la barra). En partes iguales lo
   * elegido son partes.
   */
  const resumenDeConsumos = selected.size === 0
    ? t('Toca para elegir')
    : esConsumo
      ? (selected.size === 1 ? t('1 elegido · toca para modificar') : t('{0} elegidos · toca para modificar', selected.size))
      : (selected.size === 1 ? t('1 parte · toca para modificar') : t('{0} partes · toca para modificar', selected.size));
  const continuarDeshabilitado = busy || (!esConsumo && availableSlots === 0);

  /**
   * La lista de «¿Qué consumiste?» (y la nota de «Ya pagaste»). Quien no es
   * titular la ve como siempre; en «Tu mesa» (D223) va dentro de «Tus consumos».
   */
  const listaDeConsumos = (
    <>
      {/* AF-QUE-CONSUMISTE · decisión 90 de Mati · la lista de «¿Qué
          consumiste?» del diseño de Claude Design
          (`PANTALLA-que-consumiste.md`, sha256 fabae11b…). Reemplaza el bloque
          «¿Cuánto tomas tú?» que se abría debajo del plato y la lista con borde
          punteado, «Elegiste ½» y X roja:
          - regla 1: todos los renglones miden lo mismo; elegir, cambiar la
            porción o soltar nunca mueve la lista;
          - regla 2: lo propio queda en su lugar, en teal, con la píldora de
            porción y tu parte;
          - regla 3: la píldora abre el selector EN el mismo renglón;
          - reglas 5 y 6: «Queda ½» y «Lo eligió otro», sin nombre;
          - regla 7: se suelta tocando el círculo o «Soltar», sin X roja.
          El estado (selección, límites de D79, bloqueos) sigue siendo de
          `MesaScreen`: acá sólo se dibuja y se avisan intenciones. */}
      <div
        ref={itemsRef}
        className={`card qc-lista${itemsPulse ? ' tk-fold--pulse' : ''}`}
        style={{ marginBottom: 14 }}
        onAnimationEnd={() => setItemsPulse(false)}
      >
        {mesa.items.map((i) => <div key={i.id} className="qc-renglon" data-plato={i.name}>{(() => {
          const fullPrice = i.price_cents * i.quantity;
          const nombreAria = i.quantity > 1 ? t('{0} por {1}', i.name, i.quantity) : i.name;
          // D240 puntos 3 y 16 · la cantidad va ANTES del nombre («2 × Tiramisú»),
          // como en el ticket y en Mesas, y en su propio elemento: la elipsis
          // corta el nombre, nunca la cantidad.
          const titulo = (clase: string) => (
            <span className="qc-titulo">
              {i.quantity > 1 && <span className="qc-cant">{i.quantity} ×</span>}
              <span className={clase}>{i.name}</span>
            </span>
          );
          // En igualdad la selección sólo declara consumo y no reclama el
          // ítem. Decisión 79 · en «igual» el dueño v2.134.0 publica cuánto
          // queda del plato (de TODOS, sin nombres): esta cuenta puede declarar
          // eso más lo propio guardado; `null` = sin dato, no se limita.
          const restanteIgual = esConsumo ? null : restanteInformativo(i);
          const limiteIgual = esConsumo ? null : limiteInformativo(i, informativasGuardadas);
          const state = esConsumo
            ? rowStateOf(i, selected)
            : selected.has(i.id)
              ? 'seleccionado'
              : limiteIgual === 0 ? 'tomado' : 'disponible';
          const sel = state === 'seleccionado';
          // 1A.3 · 'indeterminado' bloquea igual que 'tomado'.
          const bloqueado = state === 'tomado' || state === 'pagado' || state === 'indeterminado';
          const registrado = !sel && esMioElegido(i, esConsumo);
          const soltableRegistrado = registrado && soltarDisponible && !frozenScope && sePuedeSoltar(i, mesa, esConsumo);
          const editBloqueado = !esConsumo && informativeEditingBlocked;
          // Regla 4 · las porciones que caben en la mesa y en lo que queda.
          const restanteParaPorcion = esConsumo ? i.remaining_bps : (limiteIgual ?? 10000);
          const opciones = porcionesDisponibles(original, restanteParaPorcion);
          const tag = esConsumo ? rowTag(state, i, t) : tagIgual(state, restanteIgual, t);
          const queda = !sel && !registrado && !bloqueado && (esConsumo
            ? state === 'parcial'
            : restanteIgual !== null && restanteIgual > 0 && restanteIgual < 10000);

          if (sel || registrado) {
            const bps = sel ? (selected.get(i.id) ?? 10000) : i.my_bps;
            const etiqueta = etiquetaPorcion(bps, t);
            // Regla 2 del diseño · «píldora de porción + tu parte en pesos». En
            // consumo la última porción la ajusta el dueño (`fractionPreview`).
            // 🔴 En «igual» NO hay pesos por plato: la porción es una declaración
            // y lo que se paga es el casillero fijo («Mi parte» abajo). Mostrar
            // «$97.50» junto a ½ plato inventaría un precio que nadie cobra
            // (regla vigente desde 6d32f2e, que la pantalla nueva no deroga).
            const parte = !esConsumo
              ? null
              : sel
                ? fractionPreview(fullPrice, bps, i.remaining_bps)
                : fractionPreview(fullPrice, bps, 10000);
            // Con la edición bloqueada (D79: leyendo, guardando, sólo lectura)
            // el renglón propio no ofrece nada: ni selector, ni píldora que
            // abra, ni círculo que suelte. Se ve lo elegido y nada más.
            if (sel && abierto === i.id && !editBloqueado) {
              return (
                <div key={i.id} className="qc-fila qc-mia qc-mia--abierta" data-estado="mio">
                  <div className="qc-selector" role="radiogroup" aria-label={t('Porción de {0}', nombreAria)}>
                    {opciones.map((d) => {
                      const elegida = bps === denominatorBps(d);
                      return (
                        <button
                          key={d}
                          type="button"
                          role="radio"
                          aria-checked={elegida}
                          className={`qc-opcion${elegida ? ' on' : ''}`}
                          onClick={() => elegirPorcion(i.id, d)}
                        >
                          {etiquetaPorcion(denominatorBps(d), t)}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    className="qc-soltar"
                    onClick={() => { setAbierto(null); onToggleItem(i.id); }}
                  >
                    {t('Soltar')}
                  </button>
                </div>
              );
            }
            return (
              <div
                key={i.id}
                className="qc-fila qc-mia"
                data-estado={sel ? 'mio' : 'registrado'}
                role="group"
                aria-label={registrado ? `${nombreAria}${t(', {0}', etiquetaDeLoMio(i, t))}` : nombreAria}
              >
                {sel && !editBloqueado ? (
                  <button
                    type="button"
                    className="qc-circulo qc-circulo--marcado"
                    aria-label={t('Soltar {0}', i.name)}
                    onClick={() => { setAbierto(null); onToggleItem(i.id); }}
                  >
                    <Icon name="check" size={14} />
                  </button>
                ) : soltableRegistrado ? (
                  <button
                    type="button"
                    className="qc-circulo qc-circulo--marcado"
                    aria-label={soltando === i.id ? t('Soltando…') : t('Soltar {0}', i.name)}
                    aria-busy={soltando === i.id || undefined}
                    disabled={soltando !== null}
                    onClick={() => onReleaseItem(i.id)}
                  >
                    <Icon name={soltando === i.id ? 'clock' : 'check'} size={14} />
                  </button>
                ) : (
                  <span className="qc-circulo qc-circulo--marcado" aria-hidden="true">
                    <Icon name="check" size={14} />
                  </span>
                )}
                {/* AF-29 · si parte de lo mío ya está PAGADO, el renglón lo dice
                    con palabras en una segunda línea («Pagaste ½ · elegiste ½
                    más»), como «Lo eligió otro»: confundir elegido con pagado es
                    confundir plata. Sin pago, la píldora ya dice la porción. */}
                {registrado && bpsValido(i.my_paid_bps) && i.my_paid_bps > 0 ? (
                  <span className="qc-cuerpo">
                    {titulo('qc-nombre qc-nombre--mio')}
                    <span className="qc-etiqueta">{etiquetaDeLoMio(i, t)}</span>
                  </span>
                ) : titulo('qc-nombre qc-nombre--mio')}
                {sel && opciones.length > 1 && !editBloqueado ? (
                  <button
                    type="button"
                    className="qc-pildora"
                    aria-label={t('Cambiar la porción de {0}: {1}', nombreAria, etiqueta)}
                    aria-expanded={false}
                    onClick={() => setAbierto(i.id)}
                  >
                    {etiqueta}
                    <Icon name="chevron-down" size={12} />
                  </button>
                ) : (
                  <span className="qc-pildora qc-pildora--fija">{etiqueta}</span>
                )}
                {parte !== null && <span className="qc-parte">{formatMXN(parte)}</span>}
              </div>
            );
          }

          if (bloqueado) {
            return (
              <div key={i.id} className="qc-fila qc-otro" data-estado={state} aria-label={`${nombreAria}${tag ? t(', {0}', tag) : ''}`}>
                <span className="qc-candado" aria-hidden="true"><Icon name="lock" size={12} /></span>
                <span className="qc-cuerpo">
                  {titulo('qc-nombre qc-nombre--otro')}
                  {tag && <span className="qc-etiqueta">{tag}</span>}
                </span>
                <span className="qc-precio qc-precio--otro">{formatMXN(fullPrice)}</span>
              </div>
            );
          }

          return (
            <button
              key={i.id}
              type="button"
              className="qc-fila qc-libre"
              data-estado={queda ? 'queda' : 'libre'}
              disabled={editBloqueado}
              aria-pressed={false}
              aria-label={`${nombreAria}${tag ? t(', {0}', tag) : ''}`}
              onClick={() => tomarPlato(i.id, opciones.length)}
            >
              <span className="qc-circulo" aria-hidden="true" />
              {titulo('qc-nombre')}
              {queda && tag && <span className="qc-pildora qc-pildora--queda">{tag}</span>}
              <span className="qc-precio">{formatMXN(fullPrice)}</span>
            </button>
          );
        })()}</div>)}
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
    </>
  );

  return (
    <div ref={pantallaRef} className="screen has-appbar">
      <AppHeaderFlow userName={userName} onBack={onBack} bellBlocked={busy || !!frozenScope} />
      <div className="title-card mesa-selection-title">
        {/* D223-4 · «Tu mesa» para el titular; para los demás, como siempre. */}
        <h1 className="title-card-title">{esTitular ? t('Tu mesa') : t('¿Qué consumiste?')}</h1>
        <div className="title-card-sub mesa-selection-context">
          {/* Decisión 77 de Mati: sin el ID de la mesa —nadie tiene dos
              abiertas— y en UNA línea, restaurante · modalidad. */}
          <span className="mesa-selection-context-main">{mesa.restaurant.name}</span>
          <span aria-hidden="true">·</span>
          <strong>{divisionLabel}</strong>
        </div>
        {/* Regla 8 · la barra de avance y el reloj van dentro de la burbuja
            del título, fija al scroll. */}
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
            {/* Decisión 77 de Mati: igual que el Inicio, sólo «monto / total
                (porcentaje)», sin «asignados» ni «por asignar». */}
            {/* Regla 8 · «$X / $840.00 (N%)»: lo elegido fuerte, el resto tenue. */}
            {repartoConocido ? (
              <><b>{formatMXN(repartoConocido.assignedCents)}</b><span className="mi-meta-resto"> / {formatMXN(mesa.total_cents)} ({pct}%)</span></>
            ) : reparto ? (
              t('No pudimos calcular el reparto confirmado')
            ) : (
              <><b>{formatMXN(mesa.paid_amount_cents)}</b><span className="mi-meta-resto"> / {formatMXN(mesa.total_cents)} ({pct}%)</span></>
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
        {esTitular ? (
          <>
            {/* D223 · «Tu mesa» (turno 2 · 2.9–2.11), en este orden: quiénes
                están, solicitudes (sólo si hay), compartir, tus consumos
                (cerrado por defecto) y cerrar mesa. Cambia la DISPOSICIÓN: cómo
                se elige, se suelta, se divide y se paga es lo de siempre. */}
            {quienesSeSumaron.estado !== 'oculto' && (
              <Desplegable
                className="quienes"
                titulo={t('Quiénes están en la mesa')}
                resumen={quienesSeSumaron.estado === 'lista'
                  ? (quienesSeSumaron.lista.length + 1 === 1
                    ? t('1 persona')
                    : t('{0} personas', quienesSeSumaron.lista.length + 1))
                  : ''}
                abierto={quienesAbiertoEfectivo}
                onToggle={() => setQuienesAbierto(!quienesAbiertoEfectivo)}
              >
                {/* La fila del titular sale de la sesión: el dueño no lo incluye
                    en la lista (`routes/mesas.js`, «p.user_id <> $2»). Después,
                    los demás en el orden de llegada del dueño. */}
                <ul className="quienes-lista">
                  <li className="quien quien--titular">
                    <Avatar name={userName ?? t('Tú')} />
                    <span className="quien-texto">
                      <span className="quien-nombre">{userName ?? t('Tú')}</span>
                      {userName && <span className="quien-id">{t('Tú')}</span>}
                    </span>
                  </li>
                  {quienesSeSumaron.estado === 'lista' && quienesSeSumaron.lista.map((p, idx) => {
                    const fila = filaDeParticipante(p, arrobaHabilitada);
                    return (
                      // Sin id estable en el contrato: el orden de llegada es el del dueño.
                      <li key={idx} className="quien">
                        {fila.tipo === 'persona' ? (
                          (() => {
                            // AF-32 · foto si el dueño la dio y llegó; si no, iniciales.
                            const foto = fotoDe(p.participantId);
                            const quien = fila.nombre ?? fila.arroba ?? '';
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
                            // AF-USERNAME-D104 · decisión 104: debajo del nombre, el @.
                            // Hasta 0.198.1 iba el `payme_id`, y EN LUGAR del nombre
                            // si faltaba; ahora sin nombre va el @, y sin los dos,
                            // «Sin nombre». El código nunca.
                            <>
                              <span className="quien-nombre">{fila.nombre ?? fila.arroba ?? t('Sin nombre')}</span>
                              {fila.nombre !== null && fila.arroba !== null && (
                                <span className="quien-id">{fila.arroba}</span>
                              )}
                            </>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                {quienesSeSumaron.estado === 'cargando' ? (
                  <p className="quienes-vacio" aria-busy="true">{t('Cargando quiénes se sumaron…')}</p>
                ) : quienesSeSumaron.estado === 'error' ? (
                  <div className="quienes-vacio" role="alert">
                    {t('No pudimos cargar quiénes se sumaron.')}{' '}
                    <button type="button" className="btn btn-ghost btn-sm btn-fit" onClick={onReintentarQuienes}>
                      {t('Reintentar')}
                    </button>
                  </div>
                ) : quienesSeSumaron.estado === 'lista' && quienesSeSumaron.lista.length === 0 ? (
                  <p className="quienes-vacio">{t('Todavía no se sumó nadie.')}</p>
                ) : null}
              </Desplegable>
            )}
            {solicitudes.estado === 'error' && (
              <div className="note note-amber solicitudes-error" role="alert">
                {t('No pudimos cargar las solicitudes.')}{' '}
                <button type="button" className="btn btn-ghost btn-sm btn-fit" onClick={onReintentarSolicitudes}>
                  {t('Reintentar')}
                </button>
              </div>
            )}
            {solicitudes.estado === 'lista' && solicitudes.lista.length > 0 && (
              <Desplegable
                className="solicitudes"
                titulo={t('Solicitudes para unirse')}
                resumen={solicitudes.lista.length === 1
                  ? t('1 pendiente')
                  : t('{0} pendientes', solicitudes.lista.length)}
                abierto={solicitudesAbiertoEfectivo}
                onToggle={() => setSolicitudesAbierto(!solicitudesAbiertoEfectivo)}
              >
                <SolicitudesParaUnirse lista={solicitudes.lista} decidiendo={decidiendo} onDecidir={onDecidirSolicitud} />
              </Desplegable>
            )}
            {/* T-F1: el organizador puede invitar amigos in-app también acá —
                la pantalla de compartir post-crear se ve UNA sola vez.
                D223 · arriba, el código como TEXTO, para dictarlo (sin botón de
                copiar el código: para compartir están «Copiar link» e «Invitar
                amigos», que siguen igual). */}
            {(mesa.status === 'open' || mesa.status === 'partially_paid') && (
              <div className="mesa-secondary-actions">
                <p className="mesa-codigo-para-unirse">
                  {t('Código para unirse:')} <strong>{code}</strong>
                </p>
                {/* AF-36 · colores elegidos por Mati: invitar en turquesa lleno, copiar
                    con borde turquesa.
                    D181 · «en la misma fila las burbujas de copiar link e invitar amigos
                    (que entren bien por temas de tamaño)»: mitad y mitad. A 320 px cada
                    mitad mide ~140 px, y el texto completo no entra ni a 390: se ve
                    corto, y el nombre accesible sigue siendo el completo (lo contiene). */}
                <div className="mesa-acciones-fila">
                  <button
                    className="btn btn-borde-turquesa btn-sm"
                    onClick={onCopyInvitationLink}
                    aria-label={t('Copiar link de invitación')}
                  >
                    <Icon name="link" size={16} className="ico-inline" /> {t('Copiar link')}
                  </button>
                  {!inviteOpen && (
                    <button
                      className="btn btn-turquesa btn-sm"
                      onClick={onOpenInvite}
                      aria-label={t('Invitar amigos de PayMe')}
                    >
                      <Icon name="users" size={16} className="ico-inline" /> {t('Invitar amigos')}
                    </button>
                  )}
                </div>
                {inviteOpen && <InviteFriends code={code} />}
              </div>
            )}
            <Desplegable
              className="tus-consumos"
              titulo={t('Tus consumos')}
              resumen={resumenDeConsumos}
              abierto={consumosAbierto}
              onToggle={() => setConsumosAbierto((a) => !a)}
            >
              {listaDeConsumos}
            </Desplegable>
            {/* AF-34 · n98 · sólo la mesa SIN garantía (el dueño responde 409
                `close_not_applicable` a las otras). D223 · al final, centrado,
                en tinte de error. */}
            {onCerrarMesa && sePuedeCerrar(mesa) && (
              <div className="mesa-cerrar">
                {/* D181 · «abajo centrado la de cerrar mesa, ésta tiene que tener
                    un rojo clarito». Rojo claro de fondo y rojo oscuro de texto
                    (AA), el candado. */}
                <button
                  ref={botonCerrarMesa}
                  type="button"
                  className="btn btn-cerrar-mesa btn-sm btn-fit"
                  onClick={() => setHojaCierre('cerrar')}
                  disabled={cerrando}
                >
                  <Icon name="lock" size={16} className="ico-inline" /> {t('Cerrar mesa')}
                </button>
              </div>
            )}
          </>
        ) : listaDeConsumos}
      </div>
      {hojaCierre === 'cerrar' && onCerrarMesa && (
        <HojaAntesDeCerrar
          titulo={t('¿Cerrar la mesa?')}
          renglones={[
            t('La mesa se cierra para todos.'),
            t('Lo que cada quien eligió queda como su consumo.'),
            t('No se puede reabrir: para seguir, abre una mesa nueva.'),
          ]}
          mios={lineasElegidas(elegidosRegistrados(mesa, esConsumo, informativasGuardadas))}
          sinGuardar={esConsumo ? selected.size > 0 : guardadaLeida && !informativeSaved}
          confirmar={t('Sí, cerrar la mesa')}
          cerrando={cerrando}
          onRevisar={() => { setHojaCierre(null); llevarALaLista(true); }}
          onSalir={() => {
            setHojaCierre(null);
            // El foco vuelve al botón que abrió la hoja (un clic en Safari no lo enfoca).
            requestAnimationFrame(() => botonCerrarMesa.current?.focus());
          }}
          // La hoja queda abierta con «Cerrando…» apagado hasta que el dueño
          // contesta: un segundo toque cae en el botón apagado, no en lo que
          // hay debajo. Si se cerró, la pantalla pasa al cierre.
          onConfirmar={() => { void onCerrarMesa().finally(() => setHojaCierre(null)); }}
        />
      )}
      {hojaCierre === 'seleccion' && (
        <HojaAntesDeCerrar
          titulo={t('Con esto se cierra la mesa')}
          renglones={[
            t('Con tu selección ya se eligió todo lo de la mesa.'),
            t('Al guardar, la mesa se cierra para todos.'),
          ]}
          mios={lineasElegidas(elegidosAlGuardar(mesa, esConsumo, selected))}
          sinGuardar={false}
          confirmar={t('Guardar y cerrar')}
          cerrando={busy}
          onRevisar={() => { setHojaCierre(null); llevarALaLista(true); }}
          onSalir={() => { setHojaCierre(null); enfocarListo(); }}
          // El guardado sigue su camino de siempre: el dueño cierra la mesa en el
          // mismo pedido y la pantalla pasa a «La mesa se cerró» (F-2).
          onConfirmar={() => { setHojaCierre(null); onGoToPay(); }}
        />
      )}
      {/* Con pagos apagados, Listo es el único acto explícito de persistencia.
          No cobra; con el guardado OK vuelve a Inicio (decisión 32) y si falla
          se queda mostrando el error; cerrado/lectura/error lo deshabilitan
          hasta que el estado propio sea conocido. */}
      <AppBottomBar
        active={null}
        above={miParte}
        center={pagosCortados ? {
          // P1 · con lo guardado a la vista el círculo lo dice; la primera
          // edición lo devuelve a «Listo». Decisión 32 · «Guardado» sigue
          // tocable: lleva a Inicio sin volver a enviar lo mismo.
          label: !esConsumo && informativeSaved ? t('Guardado') : t('Listo'),
          // Diseño de Claude Design: el círculo central lleva la flecha.
          icon: 'arrow-right',
          /**
           * D-R8 · con el corte el círculo **registra la selección** y termina
           * el recorrido; antes salía sin registrar nada, y el aviso que la
           * persona lee —«tu selección queda registrada»— habría sido falso.
           * Incluso vacío se envía como reemplazo deliberado, pero sólo después
           * de una lectura acreditada. Marcar el último ítem continúa siendo
           * local y nunca envía por sí mismo.
           */
          onClick: () => {
            // Decisión 32 · sin nada elegido ni registrado, la misma guarda
            // que el círculo hacia el pago; nunca un retorno silencioso.
            if (faltaElegirConsumos && !tengoRegistrado) { frenarSinEleccion(); return; }
            // D240 punto 8 · si este guardado cierra la mesa, primero avisa.
            if (listoCierraLaMesa) { setHojaCierre('seleccion'); return; }
            onGoToPay();
          },
          disabled: busy || (!esConsumo && informativeEditingBlocked),
        } : {
          // Decisión 90 de Mati, definición 1: el círculo dice «Listo» también
          // cuando sigue al pago.
          label: t('Listo'),
          icon: 'arrow-right',
          onClick: () => {
            if (faltaElegirConsumos) { frenarSinEleccion(); return; }
            onGoToPay();
          },
          disabled: continuarDeshabilitado,
        }}
      />
    </div>
  );
}
