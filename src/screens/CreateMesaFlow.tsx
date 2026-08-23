import type { StripeCardElement } from '@stripe/stripe-js';
import { useOcrRail } from '../api/ocrRail';
import {
  type ModoUI,
  modoContrato,
  participantesTrasCambio,
  pisoDe,
  reparteElTotal,
} from './divisionModo';
import { useIdioma } from '../i18n/idioma';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, IS_MOCK, MAX_TICKET_IMAGE_BYTES, QR_RESTAURANT_ID, newIdempotencyKey } from '../api';
import { useWalletRail } from '../api/walletRail';
import { extractApiError } from '../api/errors';
import { canUseCardRail, useMoneyRail } from '../api/moneyRail';
import {
  acquireMonetaryIntent,
  clearUnconfirmed,
  completeMonetaryIntent,
  markUnconfirmed,
  prepareMonetaryRequest,
  readEconomicFingerprint,
  readMonetaryReference,
  rememberMonetaryReference,
  readUnconfirmed,
  reconcileMonetaryIntent,
  recallPaymentMethod,
  rememberPaymentMethod,
  scopeForActor,
  shouldRotateOnError,
  useMoneyActor,
  type MonetaryIntentHandle,
  type UnconfirmedAttempt,
} from '../api/idempotency';
import { isDefinitiveMutationError, isServiceUnavailable } from '../api/mutationRetry';
import {
  decisionReconciliacion,
  decisionSinRespuesta,
  type DecisionReconciliacion,
} from './reconciliacionMesaView';
import { GUARDAR_TARJETA_DEFAULT } from './saveCardView';
import { SIN_TARJETA_ELEGIDA } from './tarjetaElegida';
import { decideOcrScan } from './ocrScanView';

import { MOCK_RESTAURANTS } from '../api/mock/seedData';
import { createCardPaymentMethod } from '../api/stripe';
import type { CreateMesaResponse, PaymentMethod, Restaurant } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { AppBottomBar, AppBottomCta } from '../components/AppBottomBar';
import { AppHeaderFlow } from '../components/AppHeader';
import {
  CARD_RAIL_UNAVAILABLE_COPY,
  CardField,
  CardRailUnavailable,
  type CardFieldState,
} from '../components/CardField';
import { Icon } from '../components/Icon';
import { InviteFriends } from '../components/InviteFriends';
import { CardBrandChip, useToast } from '../components/ui';
import { navigate } from '../router';
import { formatMXN } from '../utils/format';
import { centsToString, splitEqual, stringToCents, sumCents } from '../utils/money';
import { createInFlightMutex } from '../utils/inFlight';
import { writeClipboardText } from '../utils/clipboard';

/**
 * Wizard del organizador (T2): scan → ticket → división → GARANTÍA (A-1,
 * pantalla que la maqueta no tenía) → compartir. La mesa recién existe
 * cuando la garantía queda autorizada: sin garantía no hay mesa (D1).
 */

type Step = 'scan' | 'ticket' | 'garantia' | 'threeds' | 'share';
type LinkState = 'idle' | 'loading' | 'ready' | 'error';

/**
 * D5: fila EDITABLE del ticket. El precio vive como string en pesos mientras
 * se tipea; a centavos enteros recién al calcular (sin floats).
 */
interface EditItem {
  name: string;
  priceStr: string;
  quantity: number;
  category?: string;
  confidence?: number;
  /** Señal del owner: se conserva incluso después de editar; no se finge certeza. */
  lowConfidence?: true;
}

function priceCentsOf(it: EditItem): number {
  try {
    return stringToCents(it.priceStr || '0');
  } catch {
    return 0;
  }
}

function lineTotalCents(it: EditItem): number | null {
  const price = priceCentsOf(it);
  if (price <= 0 || !Number.isSafeInteger(it.quantity) || it.quantity < 1) return null;
  const total = BigInt(price) * BigInt(it.quantity);
  return total <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(total) : null;
}

export function CreateMesaFlow() {
  const { t } = useIdioma();
  const { accept: acceptOcr, mode: ocrMode } = useOcrRail();
  const moneyRail = useMoneyRail();
  // OLA 5D · el método "Saldo PayMe" de la garantía lo habilita el BACKEND.
  const { walletRailEnabled } = useWalletRail();
  const toast = useToast();
  // Sólo para el ID que muestra la cabecera de flujo (SPEC_APP.md §1.3).
  const { session } = useAuth();
  const { actor, error: actorError } = useMoneyActor();
  const [step, setStep] = useState<Step>('scan');
  const [scanning, setScanning] = useState(false);
  const [editItems, setEditItems] = useState<EditItem[]>([]);
  /**
   * §1.6 · qué salió mal en la captura. Son estados distintos porque tamaño,
   * formato, cero ítems y proveedor caído tienen salidas/consejos diferentes;
   * colapsarlos vuelve falsa al menos una explicación.
   */
  const [scanIssue, setScanIssue] = useState<
    'ocr' | 'no_items' | 'provider' | 'image_type' | 'too_large' | null
  >(null);
  /**
   * §1.3 · el total que el OCR leyó del ticket IMPRESO, tal como vino. Existe
   * sólo para poder contrastarlo contra la suma de las filas y avisar la
   * diferencia: antes se descartaba, y por eso la observación "chequeá que el
   * total coincida" no podía detectar nada — el total en pantalla ERA la suma.
   *
   * NUNCA viaja al backend. Lo que se manda en `total_cents` sigue siendo la
   * suma de lo que la persona ve y editó (ver el guardarraíl de D5 más abajo):
   * si mandáramos el del OCR, un ticket mal leído abriría una mesa por un monto
   * que nadie miró, y la garantía retiene ese monto.
   */
  const [scannedTotalCents, setScannedTotalCents] = useState<number | null>(null);
  /** §1.3 · "Modificar ítems": vista normal ↔ modo edición, y qué fila se abrió. */
  const [editingItems, setEditingItems] = useState(false);
  const [expandedItem, setExpandedItem] = useState<number | null>(null);
  const expandedRowRef = useRef<HTMLDivElement | null>(null);
  /**
   * La fila que se abre puede quedar FUERA de la pantalla — pasa siempre al
   * agregar un consumo, porque nace al final de una lista de seis. Abrir un
   * campo que la persona no ve es lo mismo que no abrirlo: se queda mirando la
   * lista sin entender qué pasó. Verificado a 375px, que es donde ocurre.
   */
  useEffect(() => {
    if (expandedItem === null) return;
    expandedRowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [expandedItem]);
  // TRES formas en la UI (§1.3-bis) y DOS en el contrato: la traducción vive
  // entera en `divisionModo.ts`, nunca acá.
  const [division, setDivision] = useState<ModoUI>('consumo');
  // El ticket nace PLEGADO. `totalMismatch` lo fuerza a abrirse, así que este
  // booleano es la intención de la persona, no el estado visible.
  const [ticketAbierto, setTicketAbierto] = useState(false);
  /**
   * §1.4 (spec 2026-08-06): el stepper se pregunta SIEMPRE y nace SIN ELEGIR.
   * Acá vivía `useState(4)` — un 4 que en modo consumo nadie veía ni podía
   * editar, viajaba como `expected_participants` y era lo único que separaba
   * al usuario de una base de propina = la cuenta entera (÷1, el default del
   * contrato). El número correcto no existe: por eso se pregunta, no se
   * inventa. `null` = todavía no eligió, mismo patrón que la propina.
   */
  const [participants, setParticipants] = useState<number | null>(null);
  const [stepperPulse, setStepperPulse] = useState(false);
  const stepperRef = useRef<HTMLDivElement | null>(null);
  /**
   * Lo mismo que el stepper, para el TICKET incompleto — §5 bis · E, adjudicado
   * por Diseño el 2026-08-21 (`diseno@0206d44`): el círculo no se apaga por
   * falta de un dato, y responde con toast + scroll + pulso, LAS TRES JUNTAS.
   */
  const [ticketPulse, setTicketPulse] = useState(false);
  const ticketRef = useRef<HTMLDivElement | null>(null);
  // El detalle se monta después de abrir el acordeón. El scroll tiene que
  // esperar ese commit; leer el ref en el mismo click todavía devuelve null.
  useEffect(() => {
    if (!ticketAbierto || !ticketPulse) return;
    ticketRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [ticketAbierto, ticketPulse]);
  // Piso del CONTRATO, no inventado: `schemas/index.js` exige >= 2 en partes
  // iguales (refine sobre division_mode) y >= 1 en el resto.
  const pisoComensales = pisoDe(division);
  const [method, setMethod] = useState<'card' | 'wallet'>('card');
  // D4: tarjetas guardadas. `cardChoice` es el pm_… elegido o 'new' (otra
  // tarjeta); `saveCard` = checkbox "guardar" — nace DESMARCADO (Mati,
  // 2026-08-06; el porqué vive en `saveCardView.ts`).
  const [cards, setCards] = useState<PaymentMethod[]>([]);
  /**
   * 🔴 ORDEN 1-B · `cardChoice` también puede estar SIN ELEGIR (`''`), y ese
   * estado no existía. Sus dos valores previos —el uuid de una guardada o
   * `'new'`— son los dos una AFIRMACIÓN sobre con qué se garantiza; después de
   * un reload sobre una apertura congelada no tenemos derecho a hacer ninguna.
   * Ver `sinAutoseleccionRef`.
   */
  const [cardChoice, setCardChoice] = useState<string>('new');
  const [saveCard, setSaveCard] = useState(GUARDAR_TARJETA_DEFAULT);
  /**
   * 🔴 ORDEN 1-B · LA UI NO PUEDE ATRIBUIRLE LA GARANTÍA A UNA TARJETA QUE NO
   * ELIGIÓ NADIE.
   *
   * `loadCards()` autoselecciona la tarjeta DEFAULT. Después de recargar sobre
   * una apertura congelada eso produce una MENTIRA VISUAL: si la garantía se
   * hizo con una guardada NO-default, la pantalla muestra la default como
   * seleccionada y los botones están deshabilitados, así que la persona
   * tampoco puede corregirlo.
   *
   * Y en un caso NO es sólo visual: si el diagnóstico dice `not_found` —la
   * creación nunca ocurrió— el reenvío CREA por primera vez, y entonces la
   * fuente que mandamos ES la que respalda la garantía. Autoseleccionar la
   * default ahí garantizaría una mesa con una tarjeta que la persona no eligió.
   *
   * El backend NO publica cuál fue la fuente original (auditado en la orden;
   * G-38), así que no se puede restaurar: lo honesto es no afirmar nada.
   */
  const sinAutoseleccionRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const createInFlightRef = useRef(createInFlightMutex());
  const confirm3dsInFlightRef = useRef(createInFlightMutex());
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreateMesaResponse | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [linkState, setLinkState] = useState<LinkState>('idle');
  const [linkError, setLinkError] = useState<string | null>(null);
  const linkAttemptsRef = useRef<Map<string, string>>(new Map());
  const linkInFlightRef = useRef(createInFlightMutex());
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [cardEl, setCardEl] = useState<StripeCardElement | null>(null);
  const [cardState, setCardState] = useState<CardFieldState>({
    complete: false,
    error: null,
    empty: true,
  });
  // Espejo en ref para que loadCards (async) lea el estado ACTUAL del campo y
  // no pise la selección si el usuario ya empezó a tipear (race de red lenta).
  const cardStateRef = useRef(cardState);
  const handleCardChange = useCallback((s: CardFieldState) => {
    cardStateRef.current = s;
    setCardState(s);
  }, []);

  /**
   * G-01 RESUELTO (backend v2.21): el restaurante se resuelve contra
   * GET /restaurants/:id. El id llega por el QR de la mesa (`?r=<uuid>`) y,
   * como fallback de la demo, por VITE_RESTAURANT_ID. Un 404 = QR viejo o
   * restaurante suspendido: se avisa ANTES de dejar armar la mesa.
   */
  const restaurantId =
    QR_RESTAURANT_ID ??
    (IS_MOCK
      ? MOCK_RESTAURANTS[0].id
      : ((import.meta.env.VITE_RESTAURANT_ID as string | undefined) ?? ''));
  /**
   * B-06: clave estable del intento de ABRIR mesa, derivada del CONTENIDO
   * (restaurante + total + división + garantía). Editar el ticket después de
   * un error ambiguo es otra mesa, no el mismo intento: con un scope fijo
   * daba `409 idempotency_conflict` y quedaba trabado.
   *
   * El total entra porque es lo que se retiene: una garantía por otro monto
   * NUNCA puede replayar la anterior.
   */
  const mesaScopeBase = actor
    ? scopeForActor(actor, `mesa:${restaurantId || 'sin-restaurante'}`)
    : '';
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [restaurantError, setRestaurantError] = useState<string | null>(null);
  useEffect(() => {
    if (!restaurantId) {
      setRestaurantError(t('No pudimos identificar el restaurante: entra desde el QR de la mesa.'));
      return;
    }
    let alive = true;
    api
      .getRestaurant(restaurantId)
      .then((r) => alive && setRestaurant(r.restaurant))
      .catch(() =>
        alive && setRestaurantError(t('Este QR no corresponde a un restaurante disponible.')),
      );
    return () => {
      alive = false;
    };
  }, [restaurantId]);
  // D5: el total SIEMPRE sale de lo que el usuario ve/editó — guardarraíl:
  // si el total está mal, la división está mal.
  const lineTotals = editItems.map(lineTotalCents);
  let total = 0;
  try {
    total = lineTotals.some((line) => line === null)
      ? 0
      : sumCents(...lineTotals as number[]);
  } catch {
    total = 0;
  }
  // Los campos son los MISMOS que el backend hashea en `PAYLOAD_KEYS.create_mesa`.
  // La tarjeta elegida queda AFUERA a propósito, igual que allá: el `pm_` de una
  // tarjeta tipeada cambia en cada invocación de Stripe.js, y meterlo acá haría
  // que cambiar de tarjeta abriera una segunda mesa con un segundo hold.
  const contentScope = actor
    ? scopeForActor(actor, `mesa:${restaurantId || 'sin-restaurante'}|${total}|${division}|${participants}|${method}`)
    : '';
  /**
   * Intento de apertura SIN CONFIRMAR (error ambiguo). La mesa puede existir
   * ya, con su garantía por el TOTAL retenida. Mientras esté congelado no se
   * puede editar nada: abrir otra mesa sería un segundo hold por el total.
   */
  const [frozen, setFrozen] = useState<UnconfirmedAttempt | null>(null);
  const [priorAttemptCheckedFor, setPriorAttemptCheckedFor] = useState('');
  const [priorAttemptCheckFailedFor, setPriorAttemptCheckFailedFor] = useState('');
  const priorAttemptChecked = !!mesaScopeBase && priorAttemptCheckedFor === mesaScopeBase;
  const priorAttemptCheckFailed = priorAttemptCheckFailedFor === mesaScopeBase;
  useEffect(() => {
    setFrozen(null);
    setPriorAttemptCheckedFor('');
    setPriorAttemptCheckFailedFor('');
    // El diagnóstico y su autorización de reenvío pertenecen al intento que se
    // estaba mirando: cambiar de principal los invalida a los dos.
    setDecision(null);
    setReplayAutorizado(null);
    sinAutoseleccionRef.current = false;
    if (!mesaScopeBase) return;
    let alive = true;
    void readUnconfirmed(mesaScopeBase, 'create_mesa')
      .then((attempt) => {
        if (!alive) return;
        setFrozen(attempt);
        setPriorAttemptCheckedFor(mesaScopeBase);
        if (attempt?.reconciliationRequired) {
          // Sin la fuente original no hay nada que restaurar y sí algo que NO
          // afirmar. Se limpia incluso si `loadCards` ya autoseleccionó.
          sinAutoseleccionRef.current = true;
          setCardChoice(SIN_TARJETA_ELEGIDA);
        }
        // ORDEN 2A · acá se seteaba además un `role="alert"` con casi el mismo
        // texto que el panel. Dos motivos para sacarlo: quedaban DOS avisos
        // apilados diciendo lo mismo —y sólo uno con la salida—, y el del
        // alert decía "no vamos a reenviarla" incluso después de que el
        // contrato autorizara el reenvío. Un cartel que no se entera de que la
        // puerta se abrió es peor que no tener cartel.
      })
      .catch(() => {
        if (!alive) return;
        setPriorAttemptCheckFailedFor(mesaScopeBase);
        setPriorAttemptCheckedFor(mesaScopeBase);
        setError(t('Hay una apertura anterior que no podemos atribuir de forma segura. Espera la reconciliación antes de abrir otra.'));
      });
    return () => { alive = false; };
  }, [mesaScopeBase]);
  const mesaScope = frozen?.scope ?? contentScope;
  const frozenRequiresReconciliation = frozen?.reconciliationRequired === true;
  const cardRailAvailable = canUseCardRail(moneyRail, !!frozen);
  function freezeMesa(scope: string, handle: MonetaryIntentHandle) {
    if (!mesaScopeBase) throw new Error('money_actor_unavailable');
    try {
      markUnconfirmed(mesaScopeBase, scope, handle);
      setFrozen({ actor: scope.split('::')[0], scope, handle });
    } catch (error) {
      if (extractApiError(error).code !== 'monetary_family_reconciliation_required') throw error;
      setFrozen({ actor: scope.split('::')[0], scope, handle, reconciliationRequired: true });
    }
  }
  function unfreezeMesa(handle: MonetaryIntentHandle) {
    if (!mesaScopeBase) return;
    clearUnconfirmed(mesaScopeBase, handle);
    setFrozen((current) => current && current.handle.key === handle.key && current.handle.generation === handle.generation ? null : current);
  }

  /**
   * N-07 · SALIDA de la apertura congelada. Era el caso más grave del journal:
   * el área de `create_mesa` es GLOBAL por principal, así que un corte de red
   * abriendo una mesa dejaba al organizador sin poder abrir NINGUNA mesa nunca
   * más en ese navegador — y no existía transición posible.
   */
  const [reconciling, setReconciling] = useState(false);
  const [decision, setDecision] = useState<DecisionReconciliacion | null>(null);
  /**
   * ORDEN 2A · autorización de REENVÍO, y sólo con la MISMA clave. Guarda el
   * handle exacto que el contrato habilitó, no un booleano: si `frozen` cambia
   * de generación, esta autorización deja de aplicar sola en vez de quedar
   * flotando sobre un intento distinto.
   */
  const [replayAutorizado, setReplayAutorizado] = useState<MonetaryIntentHandle | null>(null);
  const replayHabilitado =
    !!frozen && !!replayAutorizado &&
    replayAutorizado.key === frozen.handle.key &&
    replayAutorizado.generation === frozen.handle.generation;

  /**
   * ORDEN 2A · la reconciliación PREGUNTA en vez de inferir.
   *
   * Hasta acá la evidencia era `GET /mesas/open` y no alcanzaba en ninguna de
   * las dos direcciones: por presencia acreditaba mesas ajenas del mismo
   * restaurante, y por ausencia "probaba" que no existía una mesa que ese
   * listado no muestra (`pending_auth` no se lista). Ahora se consulta
   * `GET /mesas/creations/:idempotency_key`, resuelto por
   * `(opener_user_id, idempotency_key)` — la misma unicidad que gobierna la
   * creación. **La clave es `frozen.handle.key`**: la que el journal ya tiene,
   * la que se mandó, la que B-06 respeta.
   *
   * El endpoint es de SOLO LECTURA (el dueño no reusó `mesaReplayResponse`
   * porque ésa reconduce holds contra Stripe), así que consultar las veces que
   * haga falta no mueve un centavo.
   *
   * 🔴 **Cruce con la referencia guardada.** Si el journal guardó el código de
   * la mesa cuando llegó la respuesta, tiene que coincidir con el que contesta
   * el endpoint. Dos fuentes independientes que se contradicen no acreditan
   * nada: el veredicto pasa a NO CONCLUYENTE y el intento sigue congelado.
   */
  async function checkMesaReconciliation() {
    if (!frozen) return;
    setReconciling(true);
    setError(null);
    setDecision(null);
    setReplayAutorizado(null);
    try {
      // ORDEN 2-A · el `payload_hash` sale del JOURNAL: es el sello congelado
      // antes del primer envío. No se recalcula desde el formulario —tras un
      // reload los ítems ni existen— y si el sello es de la versión vieja
      // viene `null` y la consulta va sin hash, que el contrato permite.
      const sello = await readEconomicFingerprint(frozen.scope, 'create_mesa').catch(() => null);
      const lookup = await api.getMesaCreation(frozen.handle.key, sello ?? undefined);
      const referencia = await readMonetaryReference(frozen.scope, 'create_mesa').catch(() => null);
      const resultado = decisionReconciliacion(lookup, referencia?.reference);
      if (resultado.liberaJournal) {
        await reconcileMonetaryIntent(frozen.scope, 'create_mesa', frozen.handle);
        setFrozen(null);
        if (resultado.navegarA) {
          setDecision(null);
          toast(t('Esa mesa ya existe: {0}', resultado.navegarA));
          navigate('mesa', resultado.navegarA);
          return;
        }
      }
      if (resultado.permiteReintento) setReplayAutorizado(frozen.handle);
      setDecision(resultado);
    } catch {
      // Cualquier cosa que no sea una respuesta del contrato —red, 5xx, un
      // cuerpo que no decodifica— es "no sabemos", y no sabemos NO es saber
      // que no: el intento queda como estaba.
      setDecision(decisionSinRespuesta());
    } finally {
      setReconciling(false);
    }
  }

  /**
   * 🔴 EL AVISO Y SU SALIDA VIVEN JUNTOS, EN TODOS LOS PASOS (ORDEN 2A).
   *
   * Defecto encontrado recorriendo el flujo con el e2e nuevo, no leyéndolo:
   * tras la recarga la app vuelve al **paso 1 (Escaneá el ticket)** —los ítems
   * y la división son estado en memoria y no sobreviven— y ahí sólo aparecía
   * el `role="alert"` diciendo *"no vamos a reenviarla ni abrir otra hasta
   * reconciliarla"*. **El botón que reconcilia estaba tres pasos más
   * adelante**, dentro del paso de garantía: había que volver a escanear y a
   * dividir para encontrar la única salida que existe.
   *
   * Un aviso que nombra una acción y no la ofrece donde la nombra es un
   * callejón sin salida con cartel. Por eso el panel es una función y se
   * pinta desde el primer paso: consultar es de solo lectura y ofrecerlo
   * temprano no puede mover un centavo.
   */
  function avisoApertura() {
    if (!frozen) return null;
    return (
      // B-06: apertura sin confirmar. La mesa PUEDE existir ya con su garantía
      // retenida: cambiar el método abriría una segunda.
      <div className="note note-orange" role="status">
        {frozenRequiresReconciliation ? (
          <>
            <b>{t('Hay una apertura de una sesión anterior.')}</b> {t('Puede que la garantía ya exista.')}
            {replayHabilitado
              ? ' Ya sabemos cómo quedó: puedes reenviarla tal cual desde el botón de abajo.'
              : ' Está bloqueada hasta reconciliarla; no vamos a reenviarla ni abrir otra mesa.'}
            {/* N-07: la salida. Antes este estado dejaba al organizador sin
                poder abrir NINGUNA mesa en este navegador.
                ORDEN 2A · el veredicto ya no se infiere de `/mesas/open`
                —que no acredita ni por presencia ni por ausencia— sino que se
                PREGUNTA por la clave de idempotencia. Y sigue pudiendo ser
                "no lo sabemos": ahí la pantalla lo dice sin ofrecer una
                salida que cobre de nuevo. */}
            <div style={{ marginTop: 10 }}>
              {decision?.copy && (
                <div style={{ marginBottom: 8 }}>{decision.copy}</div>
              )}
              <button
                className="btn btn-sm btn-teal btn-fit"
                onClick={() => void checkMesaReconciliation()}
                disabled={reconciling}
              >
                {reconciling ? t('Consultando…') : t('Revisar cómo quedó esa apertura')}
              </button>
            </div>
          </>
        ) : (
          <><b>{t('Tienes una apertura sin confirmar.')}</b> {t('Puede que la mesa ya se haya creado con su garantía. Reinténtala tal cual: si ya existe, te devolvemos esa misma mesa en vez de retener el total otra vez.')}</>
        )}
      </div>
    );
  }

  const ticketValid =
    editItems.length > 0 &&
    editItems.every((i, index) => i.name.trim().length > 0 && lineTotals[index] !== null) &&
    total > 0;
  const ticketInvalidReason =
    editItems.length === 0
      ? t('Agrega al menos un consumo.')
      : t('Completa nombre y precio (mayor a cero) de cada consumo.');
  /**
   * §1.3 · la suma de las filas contra el total IMPRESO que leyó el OCR. Se
   * compara sólo cuando las dos cifras son de fiar: sin total del OCR, o con
   * alguna fila incompleta (que fuerza `total` a 0), una diferencia no
   * significaría nada y el aviso sería ruido.
   *
   * El aviso NO bloquea Continuar. Corregir una fila mal leída es exactamente
   * lo que esta pantalla existe para permitir, y ahí la suma se aparta del
   * impreso a propósito; lo que el spec prohíbe es ajustar en silencio.
   */
  const totalMismatch =
    scannedTotalCents !== null && ticketValid && total !== scannedTotalCents
      ? { printed: scannedTotalCents, diff: total - scannedTotalCents }
      : null;

  function updateItem(idx: number, patch: Partial<EditItem>) {
    setEditItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  function removeItem(idx: number) {
    setEditItems((prev) => prev.filter((_, i) => i !== idx));
    // La fila abierta desaparece, y los índices de abajo se corren: dejar
    // `expandedItem` quieto abriría OTRA fila, o una que ya no existe.
    setExpandedItem((open) => (open === null || open === idx ? null : open > idx ? open - 1 : open));
  }
  function addItem() {
    // Nace vacío y se abre solo: sin esto habría que adivinar que la fila nueva
    // se toca para completarla.
    setEditItems((prev) => {
      setExpandedItem(prev.length);
      return [...prev, { name: '', priceStr: '', quantity: 1 }];
    });
  }

  /**
   * Demo: el mock devuelve el ticket de ejemplo sin foto.
   * Real: `POST /api/ocr` es multipart y valida los magic bytes de la imagen,
   * así que hay que mandar una foto de verdad → se abre la cámara del teléfono.
   */
  function doScan() {
    if (IS_MOCK) {
      void runScan();
      return;
    }
    fileInput.current?.click();
  }

  /**
   * §1.6 · **siempre existe la salida manual**: un OCR que falla no puede
   * terminar el flujo. Se entra al Ticket en modo edición con una fila vacía —
   * exactamente el mismo estado en el que queda un OCR que contestó 200 con
   * cero ítems, así que no estrena camino: reusa el que ya estaba probado.
   */
  function cargarAMano() {
    setScanIssue(null);
    setScannedTotalCents(null);
    // 🔴 P3-01 (Codex, 2026-08-20): el ticket vuelve a nacer PLEGADO en cada
    // llegada a la pantalla. Sin este reset, abrir el acordeón, volver y
    // escanear otro ticket lo mostraba abierto — el estado de un ticket que
    // ya no existe. Es estado de VISTA, no de datos: se reinicia donde se
    // reinician los datos.
    setTicketAbierto(false);
    setEditItems([{ name: '', priceStr: '', quantity: 1 }]);
    setEditingItems(true);
    setExpandedItem(0);
    setStep('ticket');
  }

  async function runScan(image?: Blob) {
    setScanning(true);
    setError(null);
    // El cartel del intento anterior se va cuando este intento EMPIEZA, no
    // cuando se toca el botón: si la persona abre la cámara y la cancela, el
    // motivo por el que falló la vez pasada tiene que seguir en pantalla.
    setScanIssue(null);
    try {
      const r = await api.scanTicket(image);
      const decision = decideOcrScan(r);
      if (decision.kind === 'provider_unavailable') {
        setScannedTotalCents(null);
        setScanIssue('provider');
        return;
      }
      if (decision.kind === 'no_items') {
        setScannedTotalCents(null);
        setScanIssue('no_items');
        return;
      }
      setEditItems(
        decision.response.items.map((i) => ({
          name: i.name,
          priceStr: centsToString(i.price_cents),
          quantity: i.quantity,
          ...(i.category && { category: i.category }),
          ...(i.confidence !== undefined && { confidence: i.confidence }),
          ...(i.low_confidence === true && { lowConfidence: true as const }),
        })),
      );
      // El total impreso, para contrastarlo (§1.3). Ausente significa “no lo
      // sé”; cero PRESENTE sí es un valor contractual y debe producir mismatch.
      setScannedTotalCents(decision.printedTotalCents);
      setScanIssue(null);
      // La baja confianza abre los lápices desde el primer frame. No bloquea
      // continuar: la persona ve la señal y decide qué corregir.
    // 🔴 P3-01 (Codex, 2026-08-20): el ticket vuelve a nacer PLEGADO en cada
    // llegada a la pantalla. Sin este reset, abrir el acordeón, volver y
    // escanear otro ticket lo mostraba abierto — el estado de un ticket que
    // ya no existe. Es estado de VISTA, no de datos: se reinicia donde se
    // reinician los datos.
    setTicketAbierto(false);
      setEditingItems(decision.hasLowConfidence);
      setExpandedItem(null);
      setStep('ticket');
    } catch (err) {
      // El techo se mira ANTES de subir, pero el backend sigue siendo autoridad:
      // clasifica tamaño, formato y multipart; red/timeout/2xx malformado quedan
      // neutrales porque no prueban que haya faltado luz.
      const apiError = extractApiError(err);
      const tooLarge = apiError.status === 413 || apiError.code === 'image_too_large';
      const imageType = apiError.status === 415
        || apiError.code === 'unsupported_image_type_for_provider'
        || apiError.code === 'invalid_image_type'
        || apiError.code === 'invalid_multipart';
      setScanIssue(tooLarge ? 'too_large' : imageType ? 'image_type' : 'ocr');
      // El cartel de §1.6 dice lo mismo con sus dos salidas al lado. El toast
      // encima era el segundo aviso del mismo hecho, y tapaba justo la barra.
    } finally {
      setScanning(false);
    }
  }

  async function loadCards() {
    if (cards.length > 0) return;
    try {
      const r = await api.getPaymentMethods();
      // D4 (v2.16): las guardadas se reusan con su uuid (payment_method_id).
      setCards(r.payment_methods);
      const def = r.payment_methods.find((p) => p.is_default) ?? r.payment_methods[0];
      // Si la respuesta llegó tarde y el usuario YA está tipeando una tarjeta
      // nueva, no le pisamos la selección (destruiría lo tipeado).
      // ORDEN 1-B · y si hay una apertura congelada, no se autoselecciona
      // NADA: la selección sería una afirmación sobre con qué se garantizó.
      // El ref cubre las dos carreras — si `loadCards` llega primero, el
      // efecto que descubre el intento congelado limpia la selección después.
      if (def && cardStateRef.current.empty && !sinAutoseleccionRef.current) setCardChoice(def.id);
    } catch {
      setCards([]);
    }
  }

  async function createMesa() {
    if (!ticketValid) return;
    // §1.4: sin N elegido no se abre mesa. Este guard NO inventa un default —
    // el gate de la pantalla fusionada ya lo exige, y si algún camino nuevo
    // llegara acá sin elección, vuelve a ELLA en vez de fabricar un número.
    // Que no exista camino que mande un N que el usuario no eligió es la
    // condición de la orden, y un `?? 4` acá la violaría en silencio.
    if (participants === null) {
      toast(t('Elige cuántos son'));
      setStep('ticket');
      return;
    }
    if (!createInFlightRef.current.tryEnter()) return;
    if (!mesaScope || !actor) {
      setError(actorError ? t('No pudimos verificar una identidad segura para esta garantía.') : t('Preparando una identidad segura para esta garantía…'));
      createInFlightRef.current.leave();
      return;
    }
    if (!priorAttemptChecked || priorAttemptCheckFailed) {
      setError(priorAttemptCheckFailed
        ? t('No pudimos descartar una apertura anterior. No vamos a tokenizar otra tarjeta ni abrir otra mesa.')
        : t('Estamos verificando que no exista otra apertura. Espera un momento.'));
      createInFlightRef.current.leave();
      return;
    }
    // ORDEN 2A · el bloqueo se levanta SÓLO con un diagnóstico del contrato que
    // habilite reenviar, y lo que se habilita es reenviar ESTE intento con SU
    // clave —nunca abrir otro—: `intent` sale de `frozen.handle` unas líneas
    // más abajo y no se rota. Por B-06 eso no puede duplicar: si la mesa ya
    // existe, el backend devuelve ESA; si no, la crea por primera vez.
    //
    // ✅ CORREGIDO EN LA ORDEN 2-A. Acá decía que con tarjeta TIPEADA el reenvío
    // tras un reload iba a cortar con `monetary_payload_ambiguous`, porque el
    // fingerprint local cubría el request entero mientras el del dueño deja la
    // fuente de pago afuera. **Ya no**: el sello es la identidad económica
    // (`src/utils/payloadIdentity.ts`), así que otro `pm_` no rompe nada. El
    // texto viejo describía un límite que dejó de existir, y un comentario que
    // describe un estado que no es, es una orden latente.
    if (frozenRequiresReconciliation && !replayHabilitado) {
      setError(t('Esta apertura pertenece a una sesión anterior. Está bloqueada hasta reconciliar su resultado; no abrimos otra mesa.'));
      createInFlightRef.current.leave();
      return;
    }
    // ORDEN 1-B · sin elección explícita no se reenvía. El silencio no puede
    // resolverse con la default: si la creación nunca ocurrió, esa default
    // TERMINA respaldando la garantía.
    if (method === 'card' && cardChoice === SIN_TARJETA_ELEGIDA) {
      setError(t('Elige con qué tarjeta reenviar esta apertura.'));
      createInFlightRef.current.leave();
      return;
    }
    if (method === 'card' && !cardRailAvailable) {
      setError(t(CARD_RAIL_UNAVAILABLE_COPY));
      createInFlightRef.current.leave();
      return;
    }
    setBusy(true);
    setError(null);
    let intent: MonetaryIntentHandle | null = frozen?.handle ?? null;
    try {
      intent = intent ?? await acquireMonetaryIntent(mesaScope, 'create_mesa');
      const idempotencyKey = intent.key;
      // Garantía con tarjeta (D4 v2.16): una GUARDADA viaja como
      // `payment_method_id` (uuid, sin Elements); una NUEVA se crea desde el
      // Card Element y viaja como `stripe_payment_method_id` (pm_…), con
      // `save_payment_method` según el checkbox.
      let stripePmId: string | null = null;
      let savedPmId: string | null = null;
      let savingNewCard = false;
      const savedCard = cards.find((c) => c.id === cardChoice) ?? null;
      if (method === 'card') {
        if (savedCard) {
          savedPmId = savedCard.id;
        } else if (IS_MOCK) {
          stripePmId =
            recallPaymentMethod(mesaScope, intent) ?? `pm_mock_nueva_${Date.now().toString(36)}`;
          await rememberPaymentMethod(mesaScope, intent, stripePmId);
          savingNewCard = saveCard;
        } else {
          // v2.16: el backend crea el cliente Stripe lazy en la propia
          // garantía — el bootstrap de setup-intent (v2.14) ya no hace falta.
          if (!cardEl) {
            setError(t('Carga los datos de la tarjeta para continuar.'));
            setBusy(false);
            return;
          }
          // B-06: en el reintento se reusa el pm_ ya tokenizado.
          // ⚠️ EL MOTIVO CAMBIÓ y el comentario decía el viejo: NO es que "el
          // backend lo hashea y daría 409" — `PAYLOAD_KEYS.create_mesa`
          // EXCLUYE la fuente a propósito, justamente para que un pm_ nuevo no
          // rote la clave. Reusarlo sigue valiendo por dos razones reales: no
          // acumular PaymentMethods huérfanos en Stripe por cada reintento, y
          // conservar la fuente que la persona eligió dentro de la sesión.
          const cached = recallPaymentMethod(mesaScope, intent);
          if (cached) {
            stripePmId = cached;
          } else {
            const res = await createCardPaymentMethod(cardEl);
            if ('error' in res) {
              setError(res.error);
              setBusy(false);
              return;
            }
            stripePmId = res.paymentMethodId;
            await rememberPaymentMethod(mesaScope, intent, stripePmId);
          }
          savingNewCard = saveCard;
        }
      }

      if (!restaurant) {
        setError(restaurantError ?? t('Identificando el restaurante… prueba de nuevo en un momento.'));
        setBusy(false);
        return;
      }

      const request = {
        restaurant_id: restaurant.id,
        total_cents: total,
        division_mode: modoContrato(division),
        // El N que la persona ELIGIÓ, en los dos modos. El ternario viejo era
        // inerte (las dos ramas mandaban el mismo default invisible).
        expected_participants: participants,
        guarantee_method: method,
        // B-06 (v2.25): clave estable del intento de ABRIR la mesa. Sin esto,
        // perder la respuesta y reintentar creaba una segunda mesa con una
        // segunda garantía por el total, que termina capturándose sola.
        idempotency_key: idempotencyKey,
        ...(stripePmId && { stripe_payment_method_id: stripePmId }),
        ...(savedPmId && { payment_method_id: savedPmId }),
        ...(savingNewCard && { save_payment_method: true }),
        // Cantidades EXPANDIDAS en unidades: "Tiramisú ×2" viaja como dos
        // ítems de $70 → cada unidad se elige/reserva por separado (pedido de
        // Mati). El total no cambia y el contrato ya lo acepta (quantity 1).
        items: editItems.flatMap((i) =>
          Array.from({ length: i.quantity }, () => ({
            name: i.name.trim(),
            price_cents: priceCentsOf(i),
            quantity: 1,
            ...(i.category && { category: i.category }),
          })),
        ),
      };
      await prepareMonetaryRequest(mesaScope, 'create_mesa', intent, request);
      const r = await api.createMesa(request, intent);
      // ORDEN 1A.1 · la ÚNICA prueba exacta de esta apertura, guardada apenas
      // llega y ANTES del 3DS: si la pestaña muere durante el desafío del
      // banco, la reconciliación tiene el código en vez de tener que
      // adivinarlo por el nombre del restaurante. Best-effort: el journal ya
      // hizo lo suyo y un fallo acá no puede tumbar una mesa creada.
      try {
        await rememberMonetaryReference(mesaScope, 'create_mesa', intent, r.mesa.code);
      } catch { /* sin referencia, la reconciliación dirá "sin evidencia". */ }
      setCreated(r);
      // G-11 CERRADO (backend v2.46.0, 7e45db0): acá se anotaba que el hold
      // directo IGNORABA save_payment_method, para avisarlo en "compartir".
      // El guardado de la garantía es real también en directo (post-3DS lo
      // cubre el webhook del emisor) y el aviso se retiró con su workaround.
      if (r.guarantee.status === 'requires_action') {
        // OJO: acá NO se rota. La mesa existe pero su garantía todavía no está
        // autorizada, y no hay endpoint para re-garantizar: conservar la clave
        // permite reintentar el MISMO 3DS sobre la MISMA mesa (el replay del
        // backend devuelve su client_secret vivo) en vez de abrir otra mesa
        // con otro hold por el total.
        freezeMesa(mesaScope, intent);
        setStep('threeds');
      } else {
        // Un 2xx con una mesa que no quedó abierta no acredita una garantía.
        // La respuesta ya se recibió, pero sin estado contractual de éxito se
        // conserva journal/clave y se obliga a reconciliar la misma operación.
        if (r.guarantee.status !== 'open' || r.mesa.status !== 'open') {
          freezeMesa(mesaScope, intent);
          setError(t('La garantía sigue en verificación. No abras otra mesa ni cambies el método todavía.'));
          return;
        }
        // Mesa abierta y garantía autorizada: el intento se cierra. Sin rotar,
        // la próxima mesa del mismo restaurante y mismo total recibiría el
        // replay de ésta — una mesa vieja, quizá ya cerrada.
        await completeMonetaryIntent(mesaScope, 'create_mesa', intent);
        unfreezeMesa(intent);
        await makeLink(r.mesa.code);
      }
    } catch (err) {
      const { code, extra, status } = extractApiError(err);
      // B-06: se rota solo si el intento MURIÓ. Ante error ambiguo (red,
      // respuesta perdida) la clave se conserva y el reintento cae en el
      // replay del backend, en vez de abrir una segunda mesa con una
      // segunda garantía por el total.
      const definitivo = shouldRotateOnError(code, status);
      if (intent && definitivo) {
        await completeMonetaryIntent(mesaScope, 'create_mesa', intent);
        unfreezeMesa(intent);
      }
      if (code === 'monetary_family_reconciliation_required') {
        setError(t('La apertura pertenece a una sesión anterior. No la reenviamos ni iniciamos otra hasta reconciliarla.'));
      } else if (code === 'guarantee_failed') {
        if (intent) {
          await completeMonetaryIntent(mesaScope, 'create_mesa', intent);
          unfreezeMesa(intent);
        }
        const available = typeof extra.available === 'number' ? extra.available : null;
        setError(
          available !== null
            ? walletRailEnabled
              ? `Saldo insuficiente para garantizar: tienes ${formatMXN(available)} disponibles y la mesa necesita ${formatMXN(total)}. Carga saldo o garantiza con tarjeta.`
              : `Saldo insuficiente para garantizar: tienes ${formatMXN(available)} disponibles y la mesa necesita ${formatMXN(total)}. Garantiza con tarjeta.`
            : t('No pudimos autorizar la garantía. Prueba con otro método.'),
        );
      } else if (code === 'idempotency_key_terminal') {
        // La mesa de ese intento quedó muerta: se arranca una nueva.
        if (intent) {
          await completeMonetaryIntent(mesaScope, 'create_mesa', intent);
          unfreezeMesa(intent);
        }
        setError(t('Ese intento ya no sirve. Prueba de nuevo para abrir la mesa.'));
      } else if (code === 'idempotency_conflict') {
        // Hay un intento VIVO con otro contenido. Rotar acá abriría una
        // segunda mesa con un segundo hold por el total.
        if (intent) freezeMesa(mesaScope, intent);
        setError(t('Tienes una apertura sin confirmar. Reinténtala tal cual antes de cambiar el ticket.'));
      } else if (definitivo) {
        // 4xx sin código propio: el backend rechazó y no creó nada.
        setError(t('No pudimos abrir la mesa. Revisa el ticket y prueba de nuevo.'));
      } else {
        // Ambiguo (5xx, red, timeout): la mesa PUEDE existir ya, con su
        // garantía retenida. Se congela el intento — el reintento cae en el
        // replay del backend y devuelve esa misma mesa en vez de crear otra.
        if (intent) freezeMesa(mesaScope, intent);
        setError(t('No pudimos confirmar la apertura. Puede que la mesa ya se haya creado: reintenta esta misma apertura, no armes otra.'));
      }
    } finally {
      createInFlightRef.current.leave();
      setBusy(false);
    }
  }

  async function confirm3ds() {
    if (!created) return;
    const intent = frozen?.handle;
    if (!intent) {
      setError(t('No pudimos atribuir esta garantía a una intención segura. Espera la reconciliación antes de continuar.'));
      return;
    }
    if (!confirm3dsInFlightRef.current.tryEnter()) return;
    // El replay de una mesa en `pending_auth` recupera el client_secret con
    // best-effort: si Stripe no respondió, viene vacío. Mandarlo así hacía
    // fallar la confirmación y el mensaje mentía ("el banco no autorizó").
    if (!created.guarantee.client_secret) {
      setError(t('Estamos recuperando la confirmación de tu banco. Toca reintentar en unos segundos.'));
      setStep('garantia');
      confirm3dsInFlightRef.current.leave();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // v2.24 (Connect): si el hold vive en la cuenta del restaurante, el 3DS
      // se confirma con Stripe.js apuntando a esa cuenta.
      const confirmation = await api.confirmGuarantee3ds(
        created.mesa.code,
        created.guarantee.client_secret,
        created.guarantee.connected_account_id,
      );
      if (confirmation.outcome === 'ambiguous') {
        setError(confirmation.error ?? t('Tu banco pudo haber autorizado la retención; todavía la estamos verificando.'));
        return;
      }
      if (confirmation.outcome === 'definitive') {
        await completeMonetaryIntent(mesaScope, 'create_mesa', intent);
        unfreezeMesa(intent);
        setCreated(null);
        setError(confirmation.error ?? t('El banco no autorizó la retención. Prueba con otra tarjeta.'));
        setStep('garantia');
        return;
      }
      // Garantía autorizada: el intento se cierra acá.
      await completeMonetaryIntent(mesaScope, 'create_mesa', intent);
      unfreezeMesa(intent);
      await makeLink(created.mesa.code);
    } catch {
      // Excepción local inesperada: no hay evidencia de rechazo del banco.
      setError(t('No pudimos verificar la garantía. Reintenta esta misma confirmación; no abras otra mesa.'));
    } finally {
      confirm3dsInFlightRef.current.leave();
      setBusy(false);
    }
  }

  async function makeLink(code: string) {
    if (!linkInFlightRef.current.tryEnter()) return;
    setStep('share');
    setLinkState('loading');
    setLinkError(null);
    setLink(null);
    try {
      const key = linkAttemptsRef.current.get(code) ?? newIdempotencyKey();
      linkAttemptsRef.current.set(code, key);
      const inv = await api.createInvitation(code, key);
      if (inv.invitation.status === 'expired') {
        linkAttemptsRef.current.delete(code);
        setLinkState('error');
        setLinkError(t('La invitación anterior venció. Toca de nuevo para generar otra.'));
        return;
      }
      if (!inv.link) {
        setLinkState('error');
        setLinkError(t('La invitación pudo haberse creado, pero no recibimos el link. Reintenta esta misma operación; no generes otra.'));
        return;
      }
      linkAttemptsRef.current.delete(code);
      setLink(inv.link);
      setLinkState('ready');
    } catch (err) {
      const failure = extractApiError(err);
      const definitive = isDefinitiveMutationError(failure.code, failure.status);
      if (definitive) linkAttemptsRef.current.delete(code);
      setLinkState('error');
      setLinkError(
        isServiceUnavailable(failure.status)
          ? t('El servicio no pudo confirmar el link. Reintenta esta misma operación; no generes otra.')
          : definitive
            ? t('No pudimos generar el link. Prueba de nuevo.')
            : t('No pudimos confirmar el link. Reintenta la misma operación: vamos a reutilizarla para no crear otra invitación.'),
      );
    } finally {
      linkInFlightRef.current.leave();
    }
  }

  function back() {
    // B-06: con una apertura sin confirmar, volver a editar el ticket cambia
    // el contenido → clave nueva → segunda mesa con un segundo hold por el
    // total. Primero se resuelve ese intento.
    if (frozen && (step === 'garantia' || step === 'threeds')) {
      toast(t('Tienes una apertura sin confirmar: reinténtala antes de cambiar la mesa'));
      return;
    }
    if (step === 'scan') return navigate('home');
    if (step === 'ticket') return setStep('scan');
    if (step === 'garantia') return setStep('ticket');
    // threeds/share: la mesa ya existe (o está autorizándose); no se vuelve.
    return navigate('home');
  }

  // ─── Paso 1: scan ────────────────────────────────────────
  /**
   * SPEC_APP.md §1.6, aplicado. Lo que cambia y por qué:
   *
   *  - **La pantalla deja de ser navy entera.** Se probó así —la idea era
   *    reforzar la metáfora de cámara— y Mati la rechazó: esqueleto estándar,
   *    cabecera navy curva y fondo claro, igual que Ticket y División. El marco
   *    oscuro queda como UNA TARJETA flotante adentro, no como el fondo.
   *  - Cabecera de flujo de dos filas + tarjeta de título `--teal-l`, la misma
   *    de las otras tres pantallas de armar mesa. Se estrena `Paso 1 de 5`, que
   *    faltaba: era el único paso del flujo sin contador.
   *  - CTA: la barra de cinco posiciones, sin ítem activo. El círculo lleva
   *    **cámara y dice "Capturar"** — textual del spec: *"El texto del nav item
   *    no es fijo en toda la app; lo fijo es el componente y su posición."*
   *  - Los cuatro estados quedan separados y con salida propia: lista ·
   *    subiendo · **no se pudo leer** (`--danger`, Reintentar + Cargarlo a
   *    mano) · **foto muy grande** (`--warning`, con el límite en castellano).
   *
   * **El "progreso real" que pide el spec NO se puede implementar, y no se
   * simula.** `scanTicket` arma un `FormData` y lo manda por `httpRequest`, que
   * es `fetch` (`src/api/http.ts:76`): `fetch` no expone evento de progreso de
   * subida. La única API del navegador que lo tiene es `XMLHttpRequest`, y
   * cambiar el riel de red toca el mismo `httpRequest` por el que pasan las
   * rutas de dinero — eso no se hace de paso. Queda **G-29**, y es gap del riel
   * de red de este front, no del contrato. Mientras tanto el estado honesto es
   * "Subiendo la foto…" sin porcentaje: una barra que avanza sin medir nada es
   * peor que no tenerla, porque la persona la cree.
   */
  if (step === 'scan') {
    return (
      <div className="screen has-appbar">
        <AppHeaderFlow paymeId={session?.user?.payme_id} onBack={back} />
        <div className="title-card">
          {/* <h1> y no <div>: es el único título de esta pantalla. */}
          <h1 className="title-card-title">{t('Escanea el ticket')}</h1>
        </div>
        <div className="scroll flow-scroll">
          <div className="scan-frame" aria-busy={scanning || undefined}>
            <div className="scan-corner tl" />
            <div className="scan-corner tr" />
            <div className="scan-corner bl" />
            <div className="scan-corner br" />
            {scanning && <div className="scan-line" />}
            <div className="scan-glyph" aria-hidden="true">
              <Icon name="receipt" size={40} />
            </div>
          </div>
          {/* Un solo renglón para instrucción y estado, con `aria-live`: quien
              no ve la pantalla también necesita enterarse de que arrancó. */}
          <p className="scan-hint" aria-live="polite">
            {scanning ? t('Subiendo la foto…') : t('Encuadra el ticket dentro del marco')}
          </p>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          {/* La apertura congelada avisa DESDE ACÁ, con su salida al lado: es
              el paso al que vuelve la app después de una recarga. */}
          {avisoApertura()}
          {/* G-01: un QR roto/suspendido se avisa acá, antes de armar nada. */}
          {restaurantError && <div className="note note-orange">{restaurantError}</div>}
          {scanIssue === 'ocr' && (
            <div className="state-error" role="alert">
              <div className="state-error-row">
                <Icon name="x-circle" size={22} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="state-error-title">{t('No pudimos leer el ticket')}</div>
                  <p className="state-error-body">{t('Prueba de nuevo más tarde.')}</p>
                </div>
              </div>
              {/* Las DOS salidas, al lado. Un OCR que falla no puede terminar
                  el flujo: sin "Cargarlo a mano" la mesa queda sin abrir. */}
              <div className="state-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={doScan}>
                  {t('Reintentar')}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={cargarAMano}>
                  {t('Cargarlo a mano')}
                </button>
              </div>
            </div>
          )}
          {scanIssue === 'no_items' && (
            <div className="state-error" role="alert">
              <div className="state-error-row">
                <Icon name="x-circle" size={22} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="state-error-title">{t('No pudimos leer el ticket')}</div>
                  <p className="state-error-body">
                    {t('Prueba sacar la foto de nuevo con más luz, o carga los consumos a mano.')}
                  </p>
                </div>
              </div>
              <div className="state-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={doScan}>
                  {t('Reintentar')}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={cargarAMano}>
                  {t('Cargarlo a mano')}
                </button>
              </div>
            </div>
          )}
          {scanIssue === 'provider' && (
            <div className="state-error" role="alert">
              <div className="state-error-row">
                <Icon name="x-circle" size={22} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="state-error-title">{t('No pudimos leer el ticket')}</div>
                  <p className="state-error-body">{t('Prueba de nuevo más tarde.')}</p>
                </div>
              </div>
              <div className="state-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={doScan}>
                  {t('Reintentar')}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={cargarAMano}>
                  {t('Cargarlo a mano')}
                </button>
              </div>
            </div>
          )}
          {scanIssue === 'image_type' && (
            <div className="state-warn" role="alert">
              <div className="state-error-row">
                <Icon name="warning" size={22} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="state-error-title">{t('No pudimos leer el ticket')}</div>
                </div>
              </div>
              {/* Sin el consejo falso de “más luz”: formato/bytes requieren
                  otra imagen o carga manual. La copy nominal de formato queda
                  para Diseño; estas dos salidas ya son exactas. */}
              <div className="state-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={doScan}>
                  {t('Sacar otra foto')}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={cargarAMano}>
                  {t('Cargarlo a mano')}
                </button>
              </div>
            </div>
          )}
          {scanIssue === 'too_large' && (
            <div className="state-warn" role="alert">
              <div className="state-error-row">
                <Icon name="warning" size={22} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="state-error-title">{t('La foto pesa más de 8 MB')}</div>
                  <p className="state-error-body">{t('Prueba con menos calidad.')}</p>
                </div>
              </div>
              <div className="state-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={doScan}>
                  {t('Sacar otra foto')}
                </button>
              </div>
            </div>
          )}
          {/* Este aviso era `note-amber`, y con el cartel de "foto muy grande"
              al lado se leían como UN SOLO bloque amarillo: mismo tinte, mismo
              borde, dos cosas distintas. Encontrado mirando la pantalla, no el
              diff. Pasa a teal —el color informativo del sistema, el mismo de
              la nota de la mesa garantizada— para que en Escanear el amarillo
              signifique exactamente una cosa: algo que la persona tiene que
              resolver ahora. */}
          {(IS_MOCK || ocrMode === 'mock') && (
            <div className="note note-teal scan-note">
              <b>{t('Modo demo:')}</b>{' '}
              {t('todavía no leemos la foto. Usamos un ticket de ejemplo para que puedas probar el resto del flujo.')}
            </div>
          )}
          {/* Real: abre la cámara del teléfono. POST /api/ocr es multipart y
              valida los magic bytes, así que necesita una imagen de verdad. */}
            {/* 🔴 El `accept` sale del DUEÑO del contrato, no de una lista acá.
                Estaba hardcodeado con los cuatro formatos y Textract procesa
                jpeg y png: un HEIC —el default del iPhone— se elegía, se subía
                entero y moría en el proveedor. `readOcrRail` lo construye según
                el modo publicado; el porqué del fallback vive en `api/ocrRail.ts`.

                ⚠️ `accept` es una SUGERENCIA, no un gate: deja de invitarlo, no
                lo impide. Convertir en el servidor es otra orden. */}
          <input
            ref={fileInput}
            type="file"
            accept={acceptOcr}
            capture="environment"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              // El techo se mira ACÁ y no después de subir: con mala señal,
              // mandar 12 MB para que el backend conteste 413 es un minuto
              // perdido en la mesa. El adaptador conserva su guarda igual.
              if (file.size > MAX_TICKET_IMAGE_BYTES) {
                setScanIssue('too_large');
                return;
              }
              void runScan(file);
            }}
          />
        </div>
        <AppBottomBar
          active={null}
          center={{ label: t('Capturar'), icon: 'camera', onClick: doScan, disabled: scanning }}
        />
      </div>
    );
  }

  // ─── Paso 2: TICKET Y DIVISIÓN FUSIONADAS (§1.3-bis) ─────
  /**
   * 🔴 **Una sola pantalla, ratificada por Mati el 2026-08-20** — pregunta
   * literal *"¿Querés avanzar con la fusión Ticket + División en una sola
   * pantalla, con 'Pagar el total' como tercera forma de dividir?"*, etiqueta
   * **"Sí, ratificar y armar el lote"**. Supersede la separación en dos
   * pantallas de §1.3/§1.4.
   *
   * **No reescribe ninguna de las dos: las combina.** La pregunta y las tres
   * formas arriba, con el mismo stepper y las mismas reglas de §1.4; el ticket
   * de §1.3 abajo, íntegro, sólo que **plegado por default**.
   *
   * 🔴 **La tensión que la fusión introduce, y cómo se resuelve.** §1.3 exige
   * que la suma de las filas y el total coincidan EN PANTALLA, y plegar el
   * ticket esconde esa verificación. Por eso el pliegue **no es libre cuando
   * hay conflicto**: si el total no cierra, el ticket se expande solo, la
   * observación pasa a `--warning` con la diferencia exacta, y **no se puede
   * volver a plegar** — un error escondido detrás de un pliegue es peor que
   * el pliegue.
   *
   * El tercer modo NO agrega un título de stepper: son DOS títulos para TRES
   * formas, porque "pagar el total" reparte lo mismo que "partes iguales".
   * Toda esa traducción vive en `divisionModo.ts`, en un solo lugar.
   */
  if (step === 'ticket') {
    // splitEqual, igual que el backend: la suma de las partes da el total
    // exacto (el primer comensal absorbe los centavos sobrantes).
    const perSlot = participants !== null && participants > 0 ? splitEqual(total, participants)[0] : total;
    const ticketVisible = ticketAbierto || !!totalMismatch;
    return (
      <div className="screen has-appbar af-diseno-flow">
        <AppHeaderFlow paymeId={session?.user?.payme_id} onBack={back} />
        {/* «EL TICKET SUBE» — SPEC_APP.md §1.3-bis, refinamiento 2026-08-21.
            El total viaja a la tarjeta de título porque al pie, debajo del
            stepper, había que scrollear para saber QUÉ se está dividiendo.

            No se duplica: el bloque de abajo DEJA de mostrar el monto y pasa a
            ser la barra «Ver el ticket». §5 bis · F lo exige — *un dato, un
            lugar*: ningún monto se repite en dos bloques de la misma pantalla.

            AF-DISENO-02 reúne ubicación, total y acceso al detalle en la pieza
            única que fijan la maqueta y su HTML medido. */}
        <div className="title-card ticket-title-card">
          <h1 className="title-card-title">{t('¿Cómo dividen?')}</h1>
          {restaurant && (
            <div className="title-card-sub ticket-title-place">
              <Icon name="pin" size={13} aria-hidden="true" />
              <span>
                {restaurant.name}
                {restaurant.address ? ` · ${restaurant.address}` : ''}
              </span>
            </div>
          )}
          <div className="ticket-title-amount">{formatMXN(total)}</div>
          <div
            className={`tk-fold ticket-title-fold${!ticketValid ? ' tk-fold--pending' : ''}${ticketPulse ? ' tk-fold--pulse' : ''}`}
            onAnimationEnd={() => setTicketPulse(false)}
          >
            <button
              className="tk-fold-head"
              onClick={() => setTicketAbierto((o) => !o)}
              aria-expanded={ticketVisible}
              disabled={!!totalMismatch}
            >
              <span className="tk-fold-ico-box" aria-hidden="true">
                <Icon name="receipt" size={20} className="tk-fold-ico" />
              </span>
              <span className="tk-fold-txt">
                <span className="tk-fold-lbl">{t('Ver el ticket')}</span>
                <span className="tk-fold-sub">
                  {editItems.length === 1
                    ? t('1 consumo, uno por uno')
                    : t('{0} consumos, uno por uno', editItems.length)}
                </span>
              </span>
              <Icon
                name="chevron-down"
                size={18}
                className={`tk-fold-chev ${ticketVisible ? 'open' : ''}`}
                aria-hidden="true"
              />
            </button>
          </div>
        </div>
        <div className="scroll flow-scroll ticket-flow-scroll">
          {avisoApertura()}
          {/* Las tres formas salen de UNA lista, no de tres bloques copiados:
              con tres copias, agregar un estado visual a una y olvidarse de
              las otras es cuestión de tiempo. */}
          {/* 🔴 P3-02 (Codex): eran `<button>` sin semántica — el elegido sólo
              vivía en la clase `sel`, así que un lector de pantalla no podía
              decir cuál estaba elegido ni que fueran alternativas de una misma
              pregunta. `radiogroup` + `aria-checked` lo dicen. */}
          <div className="division-options" role="radiogroup" aria-label={t('¿Cómo dividen?')}>
          {([
            { modo: 'consumo', ico: <Icon name="users" size={22} />, title: 'Por lo que pidió cada uno', sub: 'Cada uno elige sus platos' },
            { modo: 'igual', ico: '÷', title: 'En partes iguales', sub: 'El total dividido entre todos' },
            // La referencia dibuja una billetera, pero el MVP prohíbe cualquier
            // affordance wallet: acá mandan P1.5 y el riel card-only ratificado.
            { modo: 'total', ico: <Icon name="card" size={22} className="div-total-icon" />, title: 'Pagar el total', sub: 'Uno o varios cubren toda la cuenta' },
          ] as const).map((op) => (
            <button
              key={op.modo}
              className={`div-card ${division === op.modo ? 'sel' : ''}`}
              role="radio"
              aria-checked={division === op.modo}
              onClick={() => {
                setDivision(op.modo);
                // Un N que deja de ser válido se vuelve a preguntar, NO se
                // corrige solo: un número que la app ajusta sin avisar es un
                // número que nadie eligió.
                setParticipants((n) => participantesTrasCambio(n, op.modo));
              }}
            >
              <div className="div-radio" />
              <div className="div-ico">{op.ico}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="div-title">{t(op.title)}</div>
                <div className="div-sub">{t(op.sub)}</div>
              </div>
            </button>
          ))}
          </div>
          {/* §1.4 sin cambios: nace SIN ELEGIR, Continuar nunca se apaga,
              toast + scroll + pulso si tocan sin elegir. */}
          <div
            ref={stepperRef}
            className={`card card-p division-stepper${participants === null ? ' division-stepper--pending' : ''}${stepperPulse ? ' tip-block--pulse' : ''}`}
            style={{ marginBottom: 12 }}
            onAnimationEnd={() => setStepperPulse(false)}
          >
            <div className="sectlabel division-stepper-title">
              {t('¿Cuántos pagan?')}
            </div>
            {/* AF-DISENO-02: el nombre accesible y el rótulo visible usan la
                misma pregunta fija de la maqueta. */}
            <div className="stepper" role="group" aria-label={t('¿Cuántos pagan?')}>
              <button
                onClick={() => setParticipants(participants === null ? pisoComensales : Math.max(pisoComensales, participants - 1))}
                aria-label={t('Un comensal menos')}
              >
                −
              </button>
              <div className="val" aria-live="polite">
                {participants ?? '—'}
              </div>
              <button
                onClick={() => setParticipants(participants === null ? pisoComensales : Math.min(20, participants + 1))}
                aria-label={t('Un comensal más')}
              >
                +
              </button>
            </div>
            {participants !== null && (
              <>
                <div className="split-amt" aria-live="polite">
                  {reparteElTotal(division)
                    ? formatMXN(perSlot)
                    : formatMXN(Math.round(total / participants))}
                </div>
                <div className="split-amt-lbl">
                  {reparteElTotal(division) ? 'c/u' : t('base de propina · c/u')}
                </div>
              </>
            )}
          </div>
          {/* El acceso plegado vive dentro de la tarjeta de título. Al abrirlo,
              el contenido íntegro del ticket sigue en el flujo scrolleable. */}
          {ticketVisible && (
            <div ref={ticketRef} className="card tk-fold tk-fold-detail">
              <div className="tk-fold-body">
                <div className="tk-fold-restaurant">
                  <div className="tk-fold-name">{restaurant?.name ?? t('Restaurante')}</div>
                  {restaurant?.address && (
                    <div className="tk-fold-addr">
                      <Icon name="pin" size={14} className="ico-inline" /> {restaurant.address}
                    </div>
                  )}
                </div>
                <div className={`title-card-note ${totalMismatch ? 'warn' : ''}`} aria-live="polite">
                  <Icon name={totalMismatch ? 'warning' : 'info'} size={16} />
                  <span>
                    {totalMismatch
                      ? <>{t('Checa que el total coincida con el total del ticket')}: {formatMXN(totalMismatch.printed)} · {formatMXN(Math.abs(totalMismatch.diff))} {totalMismatch.diff > 0 ? t('más') : t('menos')}</>
                      : t('Checa que el total coincida con el total del ticket')}
                  </span>
                </div>
              <div className="tk-list">
                {editItems.map((it, idx) => {
                  const nombre = it.name.trim();
                  const etiqueta = nombre || t('consumo {0}', idx + 1);
                  const confidenceWarning = it.lowConfidence ? (
                    <span
                      className="tk-confidence-warning"
                      role="img"
                      aria-label={t('No pudimos leer este ítem')}
                    >
                      ?
                    </span>
                  ) : null;
                  if (editingItems && expandedItem === idx) {
                    return (
                      <div
                        className={`tk-edit ${it.lowConfidence ? 'tk-edit-warning' : ''}`}
                        key={idx}
                        ref={expandedRowRef}
                      >
                        {confidenceWarning}
                        <label className="tk-edit-field">
                          <span className="tk-edit-lbl">{t('Consumo')}</span>
                          <input
                            className="tk-edit-input"
                            value={it.name}
                            placeholder={t('Nombre del consumo')}
                            onChange={(e) => updateItem(idx, { name: e.target.value })}
                          />
                        </label>
                        <label className="tk-edit-field">
                          <span className="tk-edit-lbl">{t('Precio por unidad')}</span>
                          <input
                            className="tk-edit-input amt"
                            inputMode="decimal"
                            value={it.priceStr}
                            placeholder="0"
                            onChange={(e) =>
                              updateItem(idx, { priceStr: e.target.value.replace(/[^0-9.]/g, '') })
                            }
                          />
                        </label>
                        <div className="tk-edit-row">
                          <div className="stepper" role="group" aria-label={t('Cantidad de {0}', etiqueta)}>
                            <button
                              onClick={() => updateItem(idx, { quantity: Math.max(1, it.quantity - 1) })}
                              aria-label={t('Una unidad menos de {0}', etiqueta)}
                            >
                              −
                            </button>
                            <div className="val" aria-live="polite">
                              {it.quantity}
                            </div>
                            <button
                              onClick={() => updateItem(idx, { quantity: it.quantity + 1 })}
                              aria-label={t('Una unidad más de {0}', etiqueta)}
                            >
                              +
                            </button>
                          </div>
                          <button className="tk-del" onClick={() => removeItem(idx)}>
                            <Icon name="trash" size={18} /> {t('Eliminar')}
                          </button>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div className={`tk-row ${it.lowConfidence ? 'tk-row-warning' : ''}`} key={idx}>
                      <span className="tk-qty">{it.quantity}</span>
                      {confidenceWarning}
                      <span className={`tk-name ${nombre ? '' : 'tk-sin-nombre'}`}>
                        {nombre || t('Sin nombre')}
                      </span>
                      <span className="tk-price">
                        {lineTotals[idx] === null ? '—' : formatMXN(lineTotals[idx] as number)}
                      </span>
                      {editingItems && (
                        <button
                          className="tk-pencil"
                          onClick={() => setExpandedItem(idx)}
                          aria-label={t('Modificar {0}', etiqueta)}
                        >
                          <Icon name="pencil" size={20} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="tk-foot">
                <button
                  className="tk-edit-link"
                  onClick={() => {
                    setEditingItems((on) => !on);
                    setExpandedItem(null);
                  }}
                >
                  <Icon name={editingItems ? 'check' : 'pencil'} size={18} />
                  {editingItems ? t('Listo') : t('Modificar ítems')}
                </button>
                {editingItems && (
                  <button className="tk-edit-link" onClick={addItem}>
                    <Icon name="plus" size={18} /> {t('Agregar consumo')}
                  </button>
                )}
                </div>
              </div>
            </div>
          )}
        </div>
        <AppBottomBar
          active={null}
          above={!ticketValid ? <div className="tk-invalid">{ticketInvalidReason}</div> : undefined}
          center={{
            label: t('Continuar'),
            icon: 'arrow-right',
            onClick: () => {
              // El CTA nunca se apaga por el stepper: frena explicando (§1.4).
              if (participants === null) {
                toast(t('Elige cuántos son'));
                stepperRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
                setStepperPulse(true);
                return;
              }
              /**
               * 🔴 EL TICKET INCOMPLETO YA NO APAGA EL CÍRCULO (§5 bis · E,
               * adjudicado 2026-08-21). Faltar consumos ES «falta un dato para
               * avanzar», así que frena explicando, igual que el stepper.
               *
               * ⚠️ SE ABRE EL ACORDEÓN ANTES DE SCROLLEAR, y no es un extra:
               * el ticket nace PLEGADO, así que scrollear sin abrirlo deja a la
               * persona mirando una barra cerrada que no dice cuál consumo está
               * incompleto. Un cartel que nombra el problema y no lleva a
               * resolverlo es peor que no avisar.
               */
              if (!ticketValid) {
                toast(ticketInvalidReason);
                setTicketAbierto(true);
                setTicketPulse(true);
                return;
              }
              void loadCards();
              setStep('garantia');
            },
          }}
        />
      </div>
    );
  }


  // ─── Paso 4: GARANTÍA (A-1, pantalla nueva) ──────────────
  if (step === 'garantia') {
    return (
      <div className="screen has-appbar af-diseno-flow">
        {/* 🔴 FIDELIDAD VISUAL (2026-08-20, `diseno/referencias/
            FIDELIDAD_VISUAL_APP_2026-08-20.md` @ f4fefc0 · defecto 1). Acá
            había un `TopBar` blanco de una fila, que dejaba a Garantía como la
            única pantalla del flujo con otra cabecera. Va la navy de dos filas
            de §1.3, igual que Ticket/División y Mis ítems.
            **`Paso 3 de 4` y no 4 de 5:** la fusión de §1.3-bis dejó el flujo
            en cuatro pasos, y este número tiene que seguirla. */}
        <AppHeaderFlow paymeId={session?.user?.payme_id} onBack={back} />
        <div className="title-card gar-title">
          <h1 className="title-card-title">{t('Garantiza la mesa')}</h1>
          <div className="gar-title-amount">{formatMXN(total)}</div>
        </div>
        <div className="scroll flow-scroll gar-flow-scroll">
          {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
          {avisoApertura()}
          <div className="sectlabel" id="lbl-garantia">
            {t('¿Con qué garantizas?')}
          </div>
          {method === 'card' && !cardRailAvailable && <CardRailUnavailable />}
          {/* 🔴 ORDEN 1-B · EL ESTADO HONESTO CUANDO NO SABEMOS CON QUÉ SE
              GARANTIZÓ. Antes acá no había nada y la lista de abajo mostraba
              la tarjeta DEFAULT seleccionada — una afirmación que nadie hizo.
              El backend guarda la fuente original (`auth_source_payment_method_id`)
              pero NO la publica en ninguna respuesta: ni el 201 de `POST /mesas`
              ni `GET /mesas/creations/:key` traen más que `method` y
              `authorized`. Está anotado como G-38; hasta entonces lo único
              honesto es decir que no lo sabemos. */}
          {frozenRequiresReconciliation && (
            <div className="note" role="status">
              <b>{t('No podemos mostrarte con qué tarjeta se garantizó esta mesa.')}</b>{' '}
              {decision?.veredicto === 'a_medias'
                ? t('La mesa ya existe y su garantía sigue respaldada por la tarjeta original: la que elijas aquí acompaña el reenvío, no la reemplaza.')
                : t('Elige con cuál reenviar.')}
            </div>
          )}
          <div role="radiogroup" aria-labelledby="lbl-garantia">
          {/* Sin opción "Tarjeta" padre (redundante — feedback de Mati): las
              tarjetas guardadas SON las opciones. Elegir una = garantizar con
              esa (D4, sin Elements; 3DS igual). */}
          {cards.map((c) => (
              <button
                key={c.id}
                className={`method-card gar-method-card ${method === 'card' && cardChoice === c.id ? 'sel' : ''}`}
                onClick={() => {
                  setMethod('card');
                  setCardChoice(c.id);
                }}
                // ORDEN 1-B · con el reenvío autorizado la selección VUELVE a
                // estar viva: si el diagnóstico dijo `not_found`, la fuente que
                // se mande es la que va a respaldar la garantía, y tiene que
                // elegirla la persona.
                disabled={!cardRailAvailable || (!!frozen && !replayHabilitado)}
                role="radio"
                aria-checked={method === 'card' && cardChoice === c.id}
              >
                <div className="radio gar-radio" aria-hidden="true" />
                <div className="gar-brand-chip"><CardBrandChip brand={c.brand} /></div>
                <div className="gar-card-copy">
                  <div className="gar-card-name">
                    {c.bank_name ?? c.brand} ···· {c.last_four}
                  </div>
                  <div className="gar-card-meta">
                    {c.is_default && <span className="gar-card-principal">{t('Principal')}</span>}
                    <span>{t('Vence')} {String(c.exp_month).padStart(2, '0')}/{String(c.exp_year % 100).padStart(2, '0')}</span>
                  </div>
                </div>
              </button>
            ))}
          {(
            <button
              className={`method-card gar-other-card ${method === 'card' && cardChoice === 'new' ? 'sel' : ''}`}
              onClick={() => {
                setMethod('card');
                setCardChoice('new');
              }}
              disabled={!cardRailAvailable || (!!frozen && !replayHabilitado)}
              role="radio"
              aria-checked={method === 'card' && cardChoice === 'new'}
            >
              <div className="gar-other-icon" aria-hidden="true">
                <Icon name="plus" size={22} />
              </div>
              <div className="gar-other-copy">
                <div className="gar-other-title">
                  {cards.length > 0 ? t('Usar otra tarjeta') : t('Tarjeta')}
                </div>
                <div className="caption">{t('Puede pedir confirmación del banco')}</div>
              </div>
            </button>
          )}
          {/* Tarjeta nueva: Elements en real; en mock no se pide número. */}
          {method === 'card' && (cards.length === 0 || cardChoice === 'new') && (
            <div style={{ margin: '4px 0 12px' }}>
              {cardRailAvailable ? (
                IS_MOCK ? (
                <div className="caption">{t('La ingresas al confirmar (segura, vía Stripe).')}</div>
                ) : (
                <>
                  <CardField
                    onReady={setCardEl}
                    onChange={handleCardChange}
                    continuation={!!frozen}
                  />
                  {cardState.error && (
                    <div className="caption" style={{ color: 'var(--red)' }} role="alert">
                      {cardState.error}
                    </div>
                  )}
                  <div className="caption">
                    {t('Los datos van directo a Stripe: PayMe nunca ve el número completo.')}
                  </div>
                </>
                )
              ) : null}
              <label className="caption" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <input
                  type="checkbox"
                  checked={saveCard}
                  disabled={!cardRailAvailable}
                  onChange={(e) => setSaveCard(e.target.checked)}
                />
                {t('Guardar esta tarjeta para la próxima')}
              </label>
            </div>
          )}
          {walletRailEnabled && <button
            className={`method-card ${method === 'wallet' ? 'sel' : ''}`}
            onClick={() => setMethod('wallet')}
            disabled={!!frozen}
            role="radio"
            aria-checked={method === 'wallet'}
          >
            <div className="method-icon" style={{ background: 'var(--teal-l)' }} aria-hidden="true">
              <Icon name="wallet" size={22} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 'var(--fs-legacy-base)' }}>Saldo PayMe</div>
              <div className="caption">
                Congela {formatMXN(total)} de tu saldo hasta que la mesa cierre
              </div>
            </div>
            <div className="radio" aria-hidden="true" />
          </button>}
          </div>
          {/* 🔴 Defecto 3 · EL PÁRRAFO VA ACÁ, AL PIE — no arriba. Decisión
              explícita del paquete de diseño, citada literal en
              `FIDELIDAD_VISUAL_APP_2026-08-20.md`: *«la pantalla pide una
              decisión y el párrafo se le adelantaba. Con las tarjetas arriba,
              lo primero que hay que elegir queda primero, después del monto.
              Al pie queda la mecánica, no la tranquilidad.»*

              Connect (v2.24): la retención puede vivir en la cuenta del
              restaurante o en la de PayMe según el restaurante. El texto no
              nombra al dueño de la retención: es verdadero en los dos rieles. */}
          <div className="note note-teal gar-note" style={{ marginTop: 16 }}>
            <Icon name="info" size={16} aria-hidden="true" />
            <span>{t('Para abrir la mesa se retiene el total como garantía: el restaurante cobra sí o sí. Cuando todos pagan su parte, la retención se libera. Si alguien no paga, tu garantía cubre solo ese faltante.')}</span>
          </div>
        </div>
        <AppBottomBar
          active={null}
          center={{
            label: busy
              ? t('Autorizando…')
              : frozenRequiresReconciliation && !replayHabilitado
                ? t('Reconciliación necesaria')
                : frozen
                  ? t('Reintentar esta apertura')
                  : t('Garantizar'),
            icon: 'lock',
            onClick: createMesa,
            disabled:
              busy ||
              !priorAttemptChecked ||
              priorAttemptCheckFailed ||
              (frozenRequiresReconciliation && !replayHabilitado) ||
              (method === 'card' && cardChoice === SIN_TARJETA_ELEGIDA) ||
              (!frozen && method === 'card' && !cardRailAvailable) ||
              (!frozen &&
                !IS_MOCK &&
                method === 'card' &&
                (cards.length === 0 || cardChoice === 'new') &&
                !cardState.complete),
          }}
        />
      </div>
    );
  }

  // ─── Paso 4b: 3DS (requires_action) ──────────────────────
  if (step === 'threeds') {
    return (
      <div className="screen has-appbar af-diseno-flow">
        {/* 🔴 FIDELIDAD VISUAL (2026-08-20 @ 8183295, completada por
            AF-DISENO-02). Los cambios 3 y 6 quedan habilitados sólo en su
            composición visual; la máquina 3DS y sus gates no se alteran.

            Antes este paso no tenía ninguna salida: la mesa quedaba sin
            garantizar y el usuario atrapado en la pantalla. El `backLabel`
            vuelve a la garantía. **Sin contador de paso**, como Compartir:
            3DS no es un paso más del armado, es una interrupción del banco
            dentro de la garantía. */}
        <AppHeaderFlow
          paymeId={session?.user?.payme_id}
          onBack={() => setStep('garantia')}
        />
        {/* Defecto 2: el título y el subtítulo estaban sueltos en el cuerpo;
            van en la tarjeta `--teal-l`, como todo el flujo. */}
        <div className="title-card tds-title">
          <h1 className="title-card-title">{t('Tu banco pide confirmar')}</h1>
          <div className="title-card-sub">
            {t('La retención de')} {formatMXN(total)} {t('necesita que la confirmes con tu banco.')}
          </div>
        </div>
        <div className="scroll flow-scroll tds-flow-scroll">
          {/* AF-DISENO-02 · la maqueta final manda que esta tarjeta explique
              la transición antes de abrir el banco. `aria-busy` diferencia
              el instante en que la confirmación ya está en curso, sin usar la
              composición visual como fuente de verdad monetaria. */}
          <div
            className="tds-espera"
            role={busy ? 'status' : undefined}
            aria-live={busy ? 'polite' : 'off'}
            aria-busy={busy}
          >
            <div className="spinner" aria-hidden="true" />
            <div className="tds-espera-tit">{t('Esperando a tu banco')}</div>
            <div className="tds-espera-sub">
              {t('No cierres la app: la confirmación se abre en un momento.')}
            </div>
          </div>
          {/* 🔴 Defecto 4 · QUÉ TARJETA SE ESTÁ AUTORIZANDO. Sólo se muestra
              cuando de verdad se sabe: con tarjeta tipeada, Stripe Elements no
              publica marca ni últimos cuatro antes de confirmar, y **una fila
              inventada acá diría con qué se está reteniendo plata**. Cuando no
              se sabe, no se dice nada — el hueco honesto. */}
          {(() => {
            const elegida = cards.find((c) => c.id === cardChoice);
            if (!elegida) return null;
            return (
              <div className="tds-card" role="group" aria-label={t('Tarjeta que se autoriza')}>
                <div className="gar-brand-chip"><CardBrandChip brand={elegida.brand} /></div>
                <span className="tds-card-txt">
                  <span className="tds-card-name">{elegida.bank_name ?? elegida.brand} ···· {elegida.last_four}</span>
                  <span className="tds-card-sub">{t('La tarjeta que elegiste para garantizar')}</span>
                </span>
              </div>
            );
          })()}
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          {/* Defecto 5: se retiró el aviso «En la versión final, aquí se abre
              la verificación de tu banco.» — decisión explícita del paquete.
              Se sacó EL TEXTO; no había lógica detrás de él. */}
          {/* 🔴 ⑥ · «Cancelar y elegir otra garantía» baja a LINK y el CTA sube
              a la barra. Eran dos botones del mismo peso para acciones de peso
              muy distinto: una confirma una retención, la otra vuelve atrás.
              Con `busy` no se cancela: hay una autorización en vuelo. */}
          <button
            type="button"
            className="linkbtn tds-cancelar"
            onClick={() => setStep('garantia')}
            disabled={busy}
          >
            {t('Cancelar y elegir otra garantía')}
          </button>
        </div>
        {/* 🔴 LA BARRA DE CINCO EN 3DS · destrabada por el acta «A+B»
            (`[PAYME]_ACTA_2026-08-19_3DS_ABANDONADO_RETOMAR_Y_BARRER.md`).

            **Esto estuvo FRENADO por mí y el motivo era real:** la barra agrega
            cuatro salidas de navegación a la pantalla donde se autoriza una
            retención, y *«qué pasa si la persona sale con un 3DS en curso»*
            era un hueco **explícitamente sin decidir**. Mati lo decidió: salir
            queda **seguro y con retome** — y el retome ya es alcanzable desde
            Inicio (orden A). Sin esa segunda mitad, esta barra seguiría siendo
            una salida a ninguna parte.

            **Lo que NO cambia, y es lo único que importa acá:** `confirm3ds` y
            su `disabled` son los mismos. Cambia dónde vive el botón. */}
        <AppBottomBar
          active={null}
          center={{
            label: busy ? t('Confirmando…') : t('Confirmar'),
            icon: 'check',
            onClick: confirm3ds,
            disabled: busy,
          }}
        />
      </div>
    );
  }

  // ─── Paso 5: compartir ───────────────────────────────────
  /**
   * SPEC_APP.md §1.7, aplicado. Es el momento de triunfo del organizador — la
   * mesa quedó garantizada — y hasta hoy era una `TopBar` genérica con el link
   * suelto en un recuadro punteado.
   *
   *  - Cabecera de flujo de dos filas —**sin contador de paso**, ver abajo— y
   *    tarjeta de título `--teal-l`: *"¡Mesa garantizada!"* + *"Compartí el
   *    código para que se sumen"*. Con eso se cae la nota que repetía lo mismo
   *    en un párrafo — y que además todavía nombraba el saldo como método de
   *    garantía.
   *  - **El código es el protagonista**: mono, grande, y tocarlo copia.
   *  - **"Compartir por WhatsApp"**, no "Compartir link" genérico: es el canal
   *    real. Fondo `#075E54`, el teal oscuro histórico de la marca y **no** el
   *    verde moderno `#25D366` que tenía — blanco sobre ese verde da 1.98:1;
   *    sobre este teal da 7.67:1.
   *  - CTA: **variante reducida de la barra**, sólo el círculo con casa. No es
   *    "avanzar un paso": es el cierre del flujo de armar mesa.
   *
   * **El QR queda AFUERA**, resuelto en el spec el 2026-08-04: no hay generador
   * de QR en el repo y Stripe.js es la única dependencia pre-autorizada. No se
   * deja deshabilitado ni con copy de "próximamente" —mismo tratamiento que
   * Cuentas Asociadas— y un QR decorativo que no decodifique sería peor que no
   * tenerlo. Cuando exista la orden de dependencia, el toggle vuelve tal cual.
   *
   * **La pestaña "Ya se sumaron" también queda afuera (G-30)**, así que el
   * componente de pestañas en burbuja no aplica: una sola sección no es un
   * selector. Invitar va como panel único, sin chrome de tab.
   *
   * **"Volver" NO puede llevar a División, aunque sea el paso anterior.** Acá
   * la mesa YA existe y la garantía YA está autorizada: volver a dividir
   * cambiaría el contenido, o sea la clave, o sea una segunda mesa con un
   * segundo hold por el total — que es exactamente lo que B-06 evita. Lleva a la
   * mesa, que además es donde el organizador tiene que ir a elegir lo suyo.
   *
   * **Y por eso ya no se llama "Volver" (Diseño, 2026-08-04).** El destino era
   * correcto y el nombre no: *un control que dice "Volver" y no retrocede es
   * una etiqueta que miente*.
   *
   * **Se retira "Paso 5 de 5"** por lo mismo: ir a la mesa no es un paso hacia
   * atrás del asistente sino una salida lateral a la mesa en vivo; contar pasos
   * al lado de un control que no navega el asistente ya no significa nada.
   *
   * ─── 🔴 2026-08-13 · el organizador ya no queda expulsado a Inicio ─────────
   *
   * **Los dos destinos se INTERCAMBIARON. Decisión de Mati**, con su motivo:
   * el que escanea crea la mesa, comparte el link y *«el último paso, en vez de
   * ser seleccionar lo que consumió, lo manda al Home para que luego busque la
   * mesa»*. El ciclo tiene que cerrar donde el organizador elige lo suyo.
   *
   * **Nada hubo que recablear: los dos destinos ya existían y funcionaban.**
   * `navigate('mesa', code)` **ya era** Mis ítems (§1.5) —`#/mesa/:code` monta
   * `MesaScreen`— y `navigate('home')` ya era Inicio. **Lo que estaba mal era
   * la JERARQUÍA**: el camino que cierra el ciclo vivía en la flecha y el que
   * expulsa ocupaba el control principal.
   *
   * 🔴 **Y el renombre de 2026-08-04 arregló el NOMBRE sin mover la POSICIÓN.**
   * El comentario de acá arriba celebraba que ya *"lo nombra"* — y era cierto,
   * pero lo nombraba en el control chico mientras el grande seguía expulsando.
   * **Quedó bien nombrado y escondido igual.** Se deja escrito porque es la
   * clase de corrección que se siente completa y no lo está.
   *
   * ⚠️ **La salida a Inicio se conserva —Mati la quiso— pero deja de ser la
   * destacada:** baja al encabezado, que además **sí muestra etiqueta visible**
   * (`AppHeaderFlow` pinta `backLabel`; el círculo del pie es `aria-label` y
   * nada más, por §1.7). Por eso **el subtítulo nombra lo que sigue**: es el
   * único lugar donde quien MIRA la pantalla lee que todavía le falta elegir lo
   * suyo. El círculo no puede decirlo sin romper §1.7, que Mati ratificó.
   *
   * 🔴 **Y sigue vigente el límite de arriba: la flecha NO puede retroceder a
   * División.** Al liberarla de "Ver mesa" lo natural es hacerla "volver", y
   * eso abriría una segunda mesa con un segundo hold por el total (B-06).
   * Por eso lleva a Inicio, que es una salida lateral, y no al paso anterior.
   */
  if (step === 'share' && created) {
    const code = created.mesa.code;
    const copiarLink = () => {
      if (!link) return;
      void writeClipboardText(link).then((copied) =>
        toast(copied ? t('Link de invitación copiado ✓') : t('No se pudo copiar: tu navegador no habilitó el portapapeles')),
      );
    };
    return (
      <div className="screen has-appbar af-diseno-flow">
        <AppHeaderFlow
          paymeId={session?.user?.payme_id}
          onBack={() => navigate('home')}
          backLabel={t('Ir a Inicio')}
          backIcon="home"
        />
        <div className="title-card share-title">
          <h1 className="title-card-title">{t('¡Mesa garantizada!')}</h1>
          {/* Nombra las DOS cosas: compartir y lo que al organizador todavía le
              falta. El círculo del pie no puede decirlo —§1.7 lo dejó sin
              etiqueta visible a propósito—, así que si esto no lo dice, para
              quien mira la pantalla no lo dice nada. */}
          <div className="title-card-sub">{t('Comparte el código y después elige lo que consumiste')}</div>
        </div>
        <div className="scroll flow-scroll share-flow-scroll">
          <div className="share-card">
            {/* La maqueta final separa la credencial de las acciones visuales,
                pero el refinamiento es aditivo: tocar el código y el botón
                «Copiar link» copian la misma credencial completa con `?t=`. */}
            <button
              type="button"
              className="share-code"
              onClick={copiarLink}
              disabled={!link}
              aria-label={t('Copiar el link de invitación de la mesa {0}', code)}
            >
              <span className="share-code-label">{t('Código de la mesa')}</span>
              <span className="share-code-txt">{code}</span>
              <span className="share-code-help">{t('Para dictarlo en la mesa')}</span>
            </button>
            {/* 🔴 A1 · el BOTÓN reemplaza al link impreso (Diseño, ratificado
                2026-08-16, etiqueta «Confirmo sacarlo»). Antes el link viajaba
                también como texto en pantalla; ahora el código táctil y «Copiar
                link» son dos superficies para la misma copia completa, mientras
                el texto visible del código sigue siendo la credencial para dictar.
                ⚠️ El riesgo va aceptado a sabiendas y está en el acta: si el
                portapapeles falla, NO queda de dónde copiar a mano. Por eso el
                código táctil y el botón se apagan sin link en vez de fingir que
                copiaron. */}
            {/* 🔴 FIDELIDAD VISUAL (2026-08-20, defecto 4): WhatsApp va
                PRIMERO. Es el canal por el que la gente manda esto de verdad,
                así que es la acción principal; «Copiar link» es la salida
                secundaria. Estaban al revés. El orden del DOM es también el
                orden del foco por teclado, así que esto no es sólo visual. */}
            <div className="share-actions">
              <a
                className={`btn share-wa ${link ? '' : 'off'}`}
                href={link ? `https://wa.me/?text=${encodeURIComponent(t('Súmate a la mesa {0} en PayMe: {1}', code, link))}` : undefined}
                target="_blank"
                rel="noreferrer"
                aria-disabled={link ? undefined : true}
              >
                <Icon name="message" size={18} className="ico-inline" /> {t('Compartir por WhatsApp')}
              </a>
              <button
                type="button"
                className="btn btn-ghost share-copy"
                onClick={copiarLink}
                disabled={!link}
              >
                <Icon name="copy" size={18} className="ico-inline" /> {t('Copiar link')}
              </button>
            </div>
          </div>
          {/* 🔴 A1 · ACÁ SE IMPRIMÍA EL LINK Y SU AVISO, y se retiraron.
              El comentario viejo defendía lo contrario —«esconderla detrás del
              portapapeles deja a quien no pudo copiar sin nada»— y ese argumento
              NO se refutó: Mati lo eligió igual, con las tres razones del 04/08 a
              la vista. La pregunta se lo dijo textual y respondió «Confirmo
              sacarlo». Queda escrito porque el próximo que lea sólo el diseño no
              va a saber que se está pagando un precio conocido.
              ⚠️ Lo que se retira es el link EN TEXTO, no el estado: «generando» y
              el error siguen, porque un fallo silencioso sería otra cosa. */}
          {linkState === 'loading' && (
            <p className="share-link" aria-busy="true">
              {t('Generando el link…')}
            </p>
          )}
          {linkState !== 'ready' && linkState !== 'loading' && (
            <div className="state-error" role="alert">
              <div className="state-error-row">
                <Icon name="x-circle" size={22} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="state-error-title">{t('No pudimos generar el link')}</div>
                  <p className="state-error-body">
                    {linkError ?? t('La mesa está abierta igual: puedes invitar desde aquí abajo.')}
                  </p>
                </div>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void makeLink(code)}>
                {t('Reintentar el mismo link')}
              </button>
            </div>
          )}
          <InviteFriends code={code} />
        </div>
        {/* Variante REDUCIDA de la barra. Hasta el 2026-08-13 el círculo NO
            llevaba flecha, y el motivo estaba escrito: "no significa avanzar un
            paso, cierra el flujo". **Eso dejó de ser cierto cuando el destino
            pasó a ser Mis ítems**: ahí el organizador sí avanza, a lo único que
            le falta hacer.

            🔴 **Flecha, elegida por Mati mirando la pantalla.** El glifo de
            plato era correcto como sustantivo —adónde vas— y mudo como verbo:
            no decía que hubiera algo por hacer. La flecha se apoya en lo que el
            propio asistente ya enseñó cuatro veces, porque es el MISMO círculo
            que en los pasos 1 a 4 dice "Continuar". **Es lo más parecido a una
            etiqueta que este control puede tener sin romper §1.7**, que lo dejó
            sin texto visible a propósito.

            El nombre accesible sigue siendo "Elegir mis ítems": la flecha
            resuelve a quien MIRA, y el `aria-label` a quien no. */}
        <AppBottomCta
          label={t('Elegir mis ítems')}
          icon="arrow-right"
          onClick={() => navigate('mesa', code)}
        />
      </div>
    );
  }

  return null;
}
