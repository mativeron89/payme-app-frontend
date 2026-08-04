import type { StripeCardElement } from '@stripe/stripe-js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, IS_MOCK, QR_RESTAURANT_ID, WALLET_RAIL_ENABLED, newIdempotencyKey } from '../api';
import { extractApiError } from '../api/errors';
import {
  acquireMonetaryIntent,
  clearUnconfirmed,
  completeMonetaryIntent,
  markUnconfirmed,
  prepareMonetaryRequest,
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
import { MOCK_RESTAURANTS } from '../api/mock/seedData';
import { createCardPaymentMethod } from '../api/stripe';
import type { CreateMesaResponse, PaymentMethod, Restaurant } from '../api/types';
import { CardField, type CardFieldState } from '../components/CardField';
import { Icon } from '../components/Icon';
import { InviteFriends } from '../components/InviteFriends';
import { CardBrandChip, TopBar, TopLogo, useToast } from '../components/ui';
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

type Step = 'scan' | 'ticket' | 'division' | 'garantia' | 'threeds' | 'share';
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
  const toast = useToast();
  const { actor, error: actorError } = useMoneyActor();
  const [step, setStep] = useState<Step>('scan');
  const [scanning, setScanning] = useState(false);
  const [editItems, setEditItems] = useState<EditItem[]>([]);
  const [scanFailed, setScanFailed] = useState(false);
  const [division, setDivision] = useState<'consumo' | 'igual'>('consumo');
  const [participants, setParticipants] = useState(4);
  const [method, setMethod] = useState<'card' | 'wallet'>('card');
  // D4: tarjetas guardadas. `cardChoice` es el pm_… elegido o 'new' (otra
  // tarjeta); `saveCard` = checkbox "guardar" (ratificado: prendido).
  const [cards, setCards] = useState<PaymentMethod[]>([]);
  const [cardChoice, setCardChoice] = useState<string>('new');
  const [saveCard, setSaveCard] = useState(true);
  /** v2.24 (G-11): se pidió guardar la tarjeta y el riel directo la ignoró. */
  const [saveOmitidoConnect, setSaveOmitidoConnect] = useState(false);
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
      setRestaurantError('No pudimos identificar el restaurante: entrá desde el QR de la mesa.');
      return;
    }
    let alive = true;
    api
      .getRestaurant(restaurantId)
      .then((r) => alive && setRestaurant(r.restaurant))
      .catch(() =>
        alive && setRestaurantError('Este QR no corresponde a un restaurante disponible.'),
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
    if (!mesaScopeBase) return;
    let alive = true;
    void readUnconfirmed(mesaScopeBase, 'create_mesa')
      .then((attempt) => {
        if (!alive) return;
        setFrozen(attempt);
        setPriorAttemptCheckedFor(mesaScopeBase);
        if (attempt?.reconciliationRequired) {
          setError('Hay una apertura de una sesión anterior. No vamos a reenviarla ni abrir otra hasta reconciliarla.');
        }
      })
      .catch(() => {
        if (!alive) return;
        setPriorAttemptCheckFailedFor(mesaScopeBase);
        setPriorAttemptCheckedFor(mesaScopeBase);
        setError('Hay una apertura anterior que no podemos atribuir de forma segura. Esperá la reconciliación antes de abrir otra.');
      });
    return () => { alive = false; };
  }, [mesaScopeBase]);
  const mesaScope = frozen?.scope ?? contentScope;
  const frozenRequiresReconciliation = frozen?.reconciliationRequired === true;
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
   *
   * La evidencia autoritativa es `GET /mesas/open`: si la mesa llegó a crearse,
   * está ahí con su garantía. Sin TTL ni desbloqueo automático.
   */
  const [reconciling, setReconciling] = useState(false);
  const [reconcileVerdict, setReconcileVerdict] = useState<'absent' | null>(null);

  async function checkMesaReconciliation() {
    if (!frozen) return;
    setReconciling(true);
    setError(null);
    try {
      const abiertas = await api.getOpenMesas();
      const propia = abiertas.mesas.find((m) => m.restaurant?.name === restaurant?.name);
      if (propia) {
        await reconcileMonetaryIntent(frozen.scope, 'create_mesa', frozen.handle);
        setFrozen(null);
        setReconcileVerdict(null);
        toast(`Esa mesa ya existe: ${propia.code}`);
        navigate('mesas');
      } else {
        setReconcileVerdict('absent');
      }
    } catch {
      setError('No pudimos consultar tus mesas abiertas. Probá de nuevo en un momento.');
    } finally {
      setReconciling(false);
    }
  }

  async function releaseMesaAfterReconciliation() {
    if (!frozen) return;
    setReconciling(true);
    try {
      await reconcileMonetaryIntent(frozen.scope, 'create_mesa', frozen.handle);
      setFrozen(null);
      setReconcileVerdict(null);
      setError(null);
      toast('Listo: podés abrir la mesa de nuevo');
    } catch {
      setError('No pudimos cerrar ese intento. Sigue bloqueado por seguridad.');
    } finally {
      setReconciling(false);
    }
  }
  const ticketValid =
    editItems.length > 0 &&
    editItems.every((i, index) => i.name.trim().length > 0 && lineTotals[index] !== null) &&
    total > 0;
  const ticketInvalidReason =
    editItems.length === 0
      ? 'Agregá al menos un consumo.'
      : 'Completá nombre y precio (mayor a cero) de cada consumo.';

  function updateItem(idx: number, patch: Partial<EditItem>) {
    setEditItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  function removeItem(idx: number) {
    setEditItems((prev) => prev.filter((_, i) => i !== idx));
  }
  function addItem() {
    setEditItems((prev) => [...prev, { name: '', priceStr: '', quantity: 1 }]);
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

  async function runScan(image?: Blob) {
    setScanning(true);
    setError(null);
    try {
      const r = await api.scanTicket(image);
      setEditItems(
        r.items.map((i) => ({
          name: i.name,
          priceStr: centsToString(i.price_cents),
          quantity: i.quantity,
          ...(i.category && { category: i.category }),
        })),
      );
      setScanFailed(false);
      setStep('ticket');
    } catch {
      setScanFailed(true);
      toast('No pudimos leer el ticket. Probá sacar la foto de nuevo.');
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
      if (def && cardStateRef.current.empty) setCardChoice(def.id);
    } catch {
      setCards([]);
    }
  }

  async function createMesa() {
    if (!ticketValid) return;
    if (!createInFlightRef.current.tryEnter()) return;
    if (!mesaScope || !actor) {
      setError(actorError ? 'No pudimos verificar una identidad segura para esta garantía.' : 'Preparando una identidad segura para esta garantía…');
      createInFlightRef.current.leave();
      return;
    }
    if (!priorAttemptChecked || priorAttemptCheckFailed) {
      setError(priorAttemptCheckFailed
        ? 'No pudimos descartar una apertura anterior. No vamos a tokenizar otra tarjeta ni abrir otra mesa.'
        : 'Estamos verificando que no exista otra apertura. Esperá un momento.');
      createInFlightRef.current.leave();
      return;
    }
    if (frozenRequiresReconciliation) {
      setError('Esta apertura pertenece a una sesión anterior. Está bloqueada hasta reconciliar su resultado; no abrimos otra mesa.');
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
            setError('Cargá los datos de la tarjeta para continuar.');
            setBusy(false);
            return;
          }
          // B-06: en el reintento se reusa el pm_ ya tokenizado. Stripe.js
          // devuelve uno distinto por invocación y el backend lo hashea: sin
          // esto, la clave estable daría 409 idempotency_conflict en bucle.
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
        setError(restaurantError ?? 'Identificando el restaurante… probá de nuevo en un momento.');
        setBusy(false);
        return;
      }

      const request = {
        restaurant_id: restaurant.id,
        total_cents: total,
        division_mode: division,
        expected_participants: division === 'igual' ? participants : Math.max(1, participants),
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
      setCreated(r);
      // v2.24 (Connect): con hold directo el backend IGNORA
      // save_payment_method — la tarjeta no queda en la bóveda de PayMe (G-11).
      // Se ANOTA acá pero se avisa recién en "compartir", que solo se alcanza
      // con la retención ya autorizada: decirlo antes del 3DS sería anunciar
      // una garantía que el banco todavía puede rechazar.
      setSaveOmitidoConnect(savingNewCard && !!r.guarantee.connected_account_id);
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
          setError('La garantía sigue en verificación. No abras otra mesa ni cambies el método todavía.');
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
        setError('La apertura pertenece a una sesión anterior. No la reenviamos ni iniciamos otra hasta reconciliarla.');
      } else if (code === 'guarantee_failed') {
        if (intent) {
          await completeMonetaryIntent(mesaScope, 'create_mesa', intent);
          unfreezeMesa(intent);
        }
        const available = typeof extra.available === 'number' ? extra.available : null;
        setError(
          available !== null
            ? WALLET_RAIL_ENABLED
              ? `Saldo insuficiente para garantizar: tenés ${formatMXN(available)} disponibles y la mesa necesita ${formatMXN(total)}. Cargá saldo o garantizá con tarjeta.`
              : `Saldo insuficiente para garantizar: tenés ${formatMXN(available)} disponibles y la mesa necesita ${formatMXN(total)}. Garantizá con tarjeta.`
            : 'No pudimos autorizar la garantía. Probá con otro método.',
        );
      } else if (code === 'idempotency_key_terminal') {
        // La mesa de ese intento quedó muerta: se arranca una nueva.
        if (intent) {
          await completeMonetaryIntent(mesaScope, 'create_mesa', intent);
          unfreezeMesa(intent);
        }
        setError('Ese intento ya no sirve. Probá de nuevo para abrir la mesa.');
      } else if (code === 'idempotency_conflict') {
        // Hay un intento VIVO con otro contenido. Rotar acá abriría una
        // segunda mesa con un segundo hold por el total.
        if (intent) freezeMesa(mesaScope, intent);
        setError('Tenés una apertura sin confirmar. Reintentala tal cual antes de cambiar el ticket.');
      } else if (definitivo) {
        // 4xx sin código propio: el backend rechazó y no creó nada.
        setError('No pudimos abrir la mesa. Revisá el ticket y probá de nuevo.');
      } else {
        // Ambiguo (5xx, red, timeout): la mesa PUEDE existir ya, con su
        // garantía retenida. Se congela el intento — el reintento cae en el
        // replay del backend y devuelve esa misma mesa en vez de crear otra.
        if (intent) freezeMesa(mesaScope, intent);
        setError('No pudimos confirmar la apertura. Puede que la mesa ya se haya creado: reintentá esta misma apertura, no armes otra.');
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
      setError('No pudimos atribuir esta garantía a una intención segura. Esperá la reconciliación antes de continuar.');
      return;
    }
    if (!confirm3dsInFlightRef.current.tryEnter()) return;
    // El replay de una mesa en `pending_auth` recupera el client_secret con
    // best-effort: si Stripe no respondió, viene vacío. Mandarlo así hacía
    // fallar la confirmación y el mensaje mentía ("el banco no autorizó").
    if (!created.guarantee.client_secret) {
      setError('Estamos recuperando la confirmación de tu banco. Tocá reintentar en unos segundos.');
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
        setError(confirmation.error ?? 'Tu banco pudo haber autorizado la retención; todavía la estamos verificando.');
        return;
      }
      if (confirmation.outcome === 'definitive') {
        await completeMonetaryIntent(mesaScope, 'create_mesa', intent);
        unfreezeMesa(intent);
        setCreated(null);
        setError(confirmation.error ?? 'El banco no autorizó la retención. Probá con otra tarjeta.');
        setStep('garantia');
        return;
      }
      // Garantía autorizada: el intento se cierra acá.
      await completeMonetaryIntent(mesaScope, 'create_mesa', intent);
      unfreezeMesa(intent);
      await makeLink(created.mesa.code);
    } catch {
      // Excepción local inesperada: no hay evidencia de rechazo del banco.
      setError('No pudimos verificar la garantía. Reintentá esta misma confirmación; no abras otra mesa.');
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
        setLinkError('La invitación anterior venció. Tocá de nuevo para generar otra.');
        return;
      }
      if (!inv.link) {
        setLinkState('error');
        setLinkError('La invitación pudo haberse creado, pero no recibimos el link. Reintentá esta misma operación; no generes otra.');
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
          ? 'El servicio no pudo confirmar el link. Reintentá esta misma operación; no generes otra.'
          : definitive
            ? 'No pudimos generar el link. Probá de nuevo.'
            : 'No pudimos confirmar el link. Reintentá la misma operación: vamos a reutilizarla para no crear otra invitación.',
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
      toast('Tenés una apertura sin confirmar: reintentala antes de cambiar la mesa');
      return;
    }
    if (step === 'scan') return navigate('home');
    if (step === 'ticket') return setStep('scan');
    if (step === 'division') return setStep('ticket');
    if (step === 'garantia') return setStep('division');
    // threeds/share: la mesa ya existe (o está autorizándose); no se vuelve.
    return navigate('home');
  }

  // ─── Paso 1: scan ────────────────────────────────────────
  if (step === 'scan') {
    return (
      <div className="screen" style={{ background: 'var(--navy)' }}>
        <div className="top-bar" style={{ background: 'var(--navy)' }}>
          <button
            className="back-btn"
            onClick={back}
            aria-label="Volver"
            style={{ background: 'rgba(255,255,255,0.15)', color: '#fff' }}
          >
            <span aria-hidden="true">←</span>
          </button>
          <TopLogo inv />
          <h1 className="top-title" style={{ color: 'rgba(255,255,255,0.7)', fontSize: 'var(--fs-base)', fontFamily: 'var(--font-body)', fontWeight: 600 }}>
            Escanear ticket
          </h1>
        </div>
        <div className="scroll" style={{ background: 'var(--navy)', padding: '20px 16px' }}>
          <div className="scan-frame">
            <div className="scan-corner tl" />
            <div className="scan-corner tr" />
            <div className="scan-corner bl" />
            <div className="scan-corner br" />
            {scanning && <div className="scan-line" />}
            <div style={{ opacity: 0.3, color: '#fff' }} aria-hidden="true">
              <Icon name="receipt" size={40} />
            </div>
          </div>
          <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.75)', fontSize: 'var(--fs-sm)', margin: '16px 0', fontFamily: 'var(--font-body)' }}>
            Encuadrá el ticket dentro del marco
          </div>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          {/* G-01: un QR roto/suspendido se avisa acá, antes de armar nada. */}
          {restaurantError && <div className="note note-orange">{restaurantError}</div>}
          <div className="note note-amber">
            <b>{IS_MOCK ? 'Modo demo:' : 'Ojo:'}</b>{' '}
            {IS_MOCK
              ? 'todavía no leemos la foto. Usamos un ticket de ejemplo para que puedas probar el resto del flujo.'
              : 'todavía no leemos la foto de verdad — sacala igual y vas a recibir un ticket de ejemplo para continuar.'}
          </div>
          {/* Real: abre la cámara del teléfono. POST /api/ocr es multipart y
              valida los magic bytes, así que necesita una imagen de verdad. */}
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic"
            capture="environment"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void runScan(file);
            }}
          />
          <button
            className="btn btn-teal"
            style={{ marginTop: 14 }}
            onClick={doScan}
            disabled={scanning}
          >
            {scanning ? (
              'Leyendo ticket…'
            ) : (
              <>
                <Icon name="camera" size={16} className="ico-inline" /> Capturar
              </>
            )}
          </button>
          {scanFailed && (
            <div className="note note-orange" style={{ marginTop: 12 }}>
              No pudimos leer la foto. Probá de nuevo con más luz.
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── Paso 2: ticket ──────────────────────────────────────
  if (step === 'ticket') {
    return (
      <div className="screen has-cta">
        <div className="top-bar" style={{ background: 'var(--navy)' }}>
          <button className="back-btn" onClick={back} aria-label="Volver" style={{ background: 'rgba(255,255,255,0.15)', color: '#fff' }}>
            ←
          </button>
          <TopLogo inv />
          <div className="top-title" style={{ color: 'rgba(255,255,255,0.7)', fontSize: 'var(--fs-base)', fontFamily: 'var(--font-body)', fontWeight: 600 }}>
            Ticket de la mesa
          </div>
        </div>
        <div style={{ background: 'var(--navy)', padding: '0 20px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 800, color: '#fff' }}>
              {restaurant?.name ?? 'Restaurante'}
            </div>
            {restaurant?.address && (
              <div style={{ fontSize: 'var(--fs-sm)', color: 'rgba(255,255,255,0.55)', marginTop: 2, fontFamily: 'var(--font-body)' }}>
                <Icon name="pin" size={14} className="ico-inline" /> {restaurant.address}
              </div>
            )}
          </div>
          <div style={{ background: 'var(--teal)', color: 'var(--navy)', padding: '6px 14px', borderRadius: 20, fontWeight: 800, fontSize: 'var(--fs-base)' }}>
            {formatMXN(total)}
          </div>
        </div>
        <div className="scroll">
          <div className="card" style={{ margin: 12 }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--gray-l)' }}>
              <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 700 }}>Detalle</div>
              <div className="caption" style={{ marginTop: 2 }}>
                {editItems.length} consumo{editItems.length === 1 ? '' : 's'} · {formatMXN(total)} ·
                corregí lo que haga falta antes de dividir
              </div>
            </div>
            {/* D5: cada consumo es editable — nombre, precio, cantidad, quitar. */}
            {editItems.map((it, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  gap: 5,
                  alignItems: 'center',
                  padding: '4px 12px',
                  borderBottom: '1px solid var(--gray-l)',
                }}
              >
                <input
                  className="input"
                  style={{ flex: 1, minWidth: 0, padding: '6px 8px', fontSize: 'var(--fs-base)' }}
                  value={it.name}
                  placeholder="Consumo"
                  onChange={(e) => updateItem(idx, { name: e.target.value })}
                  aria-label={`Nombre del consumo ${idx + 1}`}
                />
                <span style={{ fontWeight: 700, fontSize: 'var(--fs-sm)', flex: 'none' }}>$</span>
                <input
                  className="input"
                  style={{ width: 60, padding: '6px 6px', fontSize: 'var(--fs-base)', flex: 'none', textAlign: 'right' }}
                  inputMode="decimal"
                  value={it.priceStr}
                  placeholder="0"
                  onChange={(e) => updateItem(idx, { priceStr: e.target.value.replace(/[^0-9.]/g, '') })}
                  aria-label={`Precio del consumo ${idx + 1}`}
                />
                <button
                  className="back-btn"
                  style={{ width: 22, height: 22, fontSize: 'var(--fs-sm)', flex: 'none' }}
                  onClick={() => updateItem(idx, { quantity: Math.max(1, it.quantity - 1) })}
                  aria-label={`Menos cantidad de ${it.name || `consumo ${idx + 1}`}`}
                >
                  −
                </button>
                <span
                  style={{ minWidth: 14, textAlign: 'center', fontWeight: 700, fontSize: 'var(--fs-sm)', flex: 'none' }}
                >
                  {it.quantity}
                </span>
                <button
                  className="back-btn"
                  style={{ width: 22, height: 22, fontSize: 'var(--fs-sm)', flex: 'none' }}
                  onClick={() => updateItem(idx, { quantity: it.quantity + 1 })}
                  aria-label={`Más cantidad de ${it.name || `consumo ${idx + 1}`}`}
                >
                  ＋
                </button>
                <button
                  className="back-btn"
                  style={{ width: 22, height: 22, fontSize: 'var(--fs-xs)', flex: 'none' }}
                  onClick={() => removeItem(idx)}
                  aria-label={`Quitar ${it.name || `consumo ${idx + 1}`}`}
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              className="btn btn-ghost"
              style={{ margin: '8px 16px 10px', width: 'auto', fontSize: 'var(--fs-sm)', padding: '9px 14px' }}
              onClick={addItem}
            >
              <Icon name="plus" size={16} className="ico-inline" /> Agregar consumo
            </button>
          </div>
        </div>
        {!ticketValid && (
          <div
            className="caption"
            style={{ position: 'fixed', bottom: 78, left: 0, right: 0, textAlign: 'center', zIndex: 20 }}
          >
            {ticketInvalidReason}
          </div>
        )}
        <button className="cta-float" onClick={() => setStep('division')} disabled={!ticketValid}>
          Continuar → dividir
        </button>
      </div>
    );
  }

  // ─── Paso 3: división ────────────────────────────────────
  if (step === 'division') {
    // splitEqual, igual que el backend: la suma de las partes da el total exacto
    // (el primer comensal absorbe los centavos sobrantes).
    const perSlot = participants > 0 ? splitEqual(total, participants)[0] : total;
    return (
      <div className="screen has-cta">
        <TopBar title="Dividir cuenta" onBack={back} />
        <div className="scroll" style={{ padding: '18px 16px' }}>
          <div style={{ padding: '4px 2px 16px' }}>
            <div className="h1" style={{ fontSize: 'var(--fs-2xl)' }}>
              ¿Cómo pagan?
            </div>
          </div>
          <button className={`div-card ${division === 'consumo' ? 'sel' : ''}`} onClick={() => setDivision('consumo')}>
            <div className="div-radio" />
            <div className="div-ico">
              <Icon name="users" size={22} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="div-title">Cada uno lo suyo</div>
              <div className="div-sub">Cada quien elige y paga lo que consumió.</div>
            </div>
          </button>
          <button className={`div-card ${division === 'igual' ? 'sel' : ''}`} onClick={() => setDivision('igual')}>
            <div className="div-radio" />
            <div className="div-ico">÷</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="div-title">Partes iguales</div>
              <div className="div-sub">La cuenta se divide en partes iguales; cada pago toma una.</div>
            </div>
            {division === 'igual' && (
              <div className="pill-amt">
                {formatMXN(perSlot)}
                <br />
                ×parte
              </div>
            )}
          </button>
          {division === 'igual' && (
            <div className="card card-p" style={{ marginBottom: 12 }}>
              <div className="sectlabel">¿Cuántos son?</div>
              <div className="stepper" role="group" aria-label="Cantidad de comensales">
                <button
                  onClick={() => setParticipants(Math.max(2, participants - 1))}
                  aria-label="Un comensal menos"
                >
                  −
                </button>
                <div className="val" aria-live="polite">
                  {participants}
                </div>
                <button
                  onClick={() => setParticipants(Math.min(20, participants + 1))}
                  aria-label="Un comensal más"
                >
                  +
                </button>
              </div>
            </div>
          )}
        </div>
        <button
          className="cta-float"
          onClick={() => {
            void loadCards();
            setStep('garantia');
          }}
        >
          Continuar → garantizar
        </button>
      </div>
    );
  }

  // ─── Paso 4: GARANTÍA (A-1, pantalla nueva) ──────────────
  if (step === 'garantia') {
    return (
      <div className="screen has-cta">
        <TopBar title="Garantizá la mesa" onBack={back} />
        <div className="scroll" style={{ padding: 16 }}>
          <div style={{ background: 'var(--navy)', borderRadius: 16, padding: '18px 20px', marginBottom: 14 }}>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Garantía de la mesa
            </div>
            <div style={{ fontSize: 'var(--fs-3xl)', fontWeight: 800, color: '#fff' }}>{formatMXN(total)}</div>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'rgba(255,255,255,0.45)', marginTop: 4, fontFamily: 'var(--font-body)' }}>
              Se retiene, no se cobra. Si todos pagan, se libera completa.
            </div>
          </div>
          <div className="note note-teal" style={{ marginBottom: 16 }}>
            {/* Connect (v2.24): la retención puede vivir en la cuenta del
                restaurante o en la de PayMe según el restaurante. El texto no
                nombra al dueño de la retención: es verdadero en los dos rieles. */}
            Para abrir la mesa se retiene el total como garantía: el restaurante cobra
            sí o sí. Cuando todos pagan su parte, la retención se libera. Si alguien no
            paga, tu garantía cubre solo ese faltante.
          </div>
          {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
          {/* B-06: apertura sin confirmar. La mesa PUEDE existir ya con su
              garantía retenida: cambiar el método abriría una segunda. */}
          {frozen && (
            <div className="note note-orange" role="status">
              {frozenRequiresReconciliation ? (
                <>
                  <b>Hay una apertura de una sesión anterior.</b> Puede que la garantía ya exista.
                  Está bloqueada hasta reconciliarla; no vamos a reenviarla ni abrir otra mesa.
                  {/* N-07: la salida. Antes este estado dejaba al organizador
                      sin poder abrir NINGUNA mesa en este navegador. */}
                  {reconcileVerdict !== 'absent' ? (
                    <div style={{ marginTop: 10 }}>
                      <button
                        className="btn btn-sm btn-teal btn-fit"
                        onClick={() => void checkMesaReconciliation()}
                        disabled={reconciling}
                      >
                        {reconciling ? 'Consultando…' : 'Revisar si la mesa se creó'}
                      </button>
                    </div>
                  ) : (
                    <div style={{ marginTop: 10 }}>
                      <div>
                        No encontramos ninguna mesa abierta tuya en este restaurante: esa apertura
                        no llegó a crearse. Si continuás, se retiene el total de nuevo.
                      </div>
                      <button
                        className="btn btn-sm btn-teal btn-fit"
                        style={{ marginTop: 8 }}
                        onClick={() => void releaseMesaAfterReconciliation()}
                        disabled={reconciling}
                      >
                        {reconciling ? 'Cerrando…' : 'Entiendo, desbloquear'}
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <><b>Tenés una apertura sin confirmar.</b> Puede que la mesa ya se haya creado con su garantía. Reintentala tal cual: si ya existe, te devolvemos esa misma mesa en vez de retener el total otra vez.</>
              )}
            </div>
          )}
          <div className="sectlabel" id="lbl-garantia">
            ¿Con qué garantizás?
          </div>
          <div role="radiogroup" aria-labelledby="lbl-garantia">
          {/* Sin opción "Tarjeta" padre (redundante — feedback de Mati): las
              tarjetas guardadas SON las opciones. Elegir una = garantizar con
              esa (D4, sin Elements; 3DS igual). */}
          {cards.map((c) => (
              <button
                key={c.id}
                className={`method-card ${method === 'card' && cardChoice === c.id ? 'sel' : ''}`}
                onClick={() => {
                  setMethod('card');
                  setCardChoice(c.id);
                }}
                disabled={!!frozen}
                role="radio"
                aria-checked={method === 'card' && cardChoice === c.id}
              >
                <CardBrandChip brand={c.brand} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 'var(--fs-base)' }}>
                    {c.bank_name ?? c.brand} ···· {c.last_four}
                    {c.is_default && (
                      <span className="caption" style={{ marginLeft: 8 }}>
                        Principal
                      </span>
                    )}
                  </div>
                  <div className="caption">
                    Vence {String(c.exp_month).padStart(2, '0')}/{String(c.exp_year % 100).padStart(2, '0')}
                  </div>
                </div>
                <div className="radio" aria-hidden="true" />
              </button>
            ))}
          {(
            <button
              className={`method-card ${method === 'card' && cardChoice === 'new' ? 'sel' : ''}`}
              onClick={() => {
                setMethod('card');
                setCardChoice('new');
              }}
              disabled={!!frozen}
              role="radio"
              aria-checked={method === 'card' && cardChoice === 'new'}
            >
              <div className="method-icon" style={{ background: 'var(--gray-l)' }} aria-hidden="true">
                <Icon name="plus" size={22} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 'var(--fs-base)' }}>
                  {cards.length > 0 ? 'Usar otra tarjeta' : 'Tarjeta'}
                </div>
                <div className="caption">Retención en la tarjeta (puede pedir confirmación del banco)</div>
              </div>
              <div className="radio" aria-hidden="true" />
            </button>
          )}
          {/* Tarjeta nueva: Elements en real; en mock no se pide número. */}
          {method === 'card' && (cards.length === 0 || cardChoice === 'new') && (
            <div style={{ margin: '4px 0 12px' }}>
              {IS_MOCK ? (
                <div className="caption">La ingresás al confirmar (segura, vía Stripe).</div>
              ) : (
                <>
                  <CardField onReady={setCardEl} onChange={handleCardChange} />
                  {cardState.error && (
                    <div className="caption" style={{ color: 'var(--red)' }} role="alert">
                      {cardState.error}
                    </div>
                  )}
                  <div className="caption">
                    Los datos van directo a Stripe: PayMe nunca ve el número completo.
                  </div>
                </>
              )}
              <label className="caption" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <input
                  type="checkbox"
                  checked={saveCard}
                  onChange={(e) => setSaveCard(e.target.checked)}
                />
                Guardar esta tarjeta para la próxima
              </label>
            </div>
          )}
          {WALLET_RAIL_ENABLED && <button
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
              <div style={{ fontWeight: 700, fontSize: 'var(--fs-base)' }}>Saldo PayMe</div>
              <div className="caption">
                Congela {formatMXN(total)} de tu saldo hasta que la mesa cierre
              </div>
            </div>
            <div className="radio" aria-hidden="true" />
          </button>}
          </div>
        </div>
        <button
          className="cta-float"
          onClick={createMesa}
          disabled={
            busy ||
            !priorAttemptChecked ||
            priorAttemptCheckFailed ||
            frozenRequiresReconciliation ||
            (!frozen &&
              !IS_MOCK &&
              method === 'card' &&
              (cards.length === 0 || cardChoice === 'new') &&
              !cardState.complete)
          }
        >
          {busy ? (
            'Autorizando…'
          ) : frozenRequiresReconciliation ? (
            <>
              <Icon name="lock" size={16} className="ico-inline" /> Reconciliación necesaria
            </>
          ) : frozen ? (
            <>
              <Icon name="lock" size={16} className="ico-inline" /> Reintentar esta apertura
            </>
          ) : (
            <>
              <Icon name="lock" size={16} className="ico-inline" /> Garantizar {formatMXN(total)} y
              abrir mesa
            </>
          )}
        </button>
      </div>
    );
  }

  // ─── Paso 4b: 3DS (requires_action) ──────────────────────
  if (step === 'threeds') {
    return (
      <div className="screen">
        {/* Antes este paso no tenía ninguna salida: la mesa quedaba sin
            garantizar y el usuario atrapado en la pantalla. */}
        <TopBar
          title="Confirmá con tu banco"
          onBack={() => setStep('garantia')}
          backLabel="Volver a elegir la garantía"
        />
        <div className="scroll" style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center', padding: '16px 0' }} role="status" aria-live="polite">
            <div className="spinner" aria-hidden="true" />
            <div className="h2" style={{ marginTop: 18 }}>
              Tu banco pide confirmar
            </div>
            <div className="body-text" style={{ marginTop: 6 }}>
              La retención de {formatMXN(total)} necesita que la confirmes con tu banco.
            </div>
          </div>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          <div className="note note-teal" style={{ marginTop: 12 }}>
            En la versión final, acá se abre la verificación de tu banco.
          </div>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={confirm3ds} disabled={busy}>
            {busy ? 'Confirmando…' : 'Confirmar autorización'}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            style={{ marginTop: 10 }}
            onClick={() => setStep('garantia')}
            disabled={busy}
          >
            Cancelar y elegir otra garantía
          </button>
        </div>
      </div>
    );
  }

  // ─── Paso 5: compartir ───────────────────────────────────
  if (step === 'share' && created) {
    const code = created.mesa.code;
    return (
      <div className="screen has-cta">
        <TopBar title="Invitar a la mesa" onBack={() => navigate('mesa', code)} />
        <div className="scroll" style={{ padding: 16 }}>
          <div style={{ textAlign: 'center', padding: '8px 0 12px' }}>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <Icon name="pasta" size={34} />
            </div>
            <div className="h2" style={{ marginTop: 6 }}>
              Mesa {code}
            </div>
            <span className="badge badge-teal" style={{ marginTop: 6 }}>
              Garantizada ✓
            </span>
          </div>
          <div className="note note-teal" style={{ marginBottom: 14 }}>
            La mesa quedó <b>abierta y garantizada</b> con {method === 'card' ? 'tu tarjeta' : 'tu saldo'}.
            Ahora invitá al resto: cada uno entra con el link y paga su parte.
          </div>
          {/* G-11: se avisa acá (garantía YA autorizada), no antes del 3DS. */}
          {saveOmitidoConnect && (
            <div className="caption" style={{ marginTop: -8, marginBottom: 14 }}>
              En este restaurante la tarjeta no se guarda. Podés guardarla desde{' '}
              <b style={{ color: 'var(--navy)' }}>Cuenta</b>.
            </div>
          )}
          <div className="sectlabel">Link de invitación</div>
          {linkState === 'ready' && link ? (
            <>
              <div style={{ background: 'var(--gray-l)', border: '1.5px dashed var(--teal)', borderRadius: 10, padding: 14, fontFamily: 'monospace', fontSize: 'var(--fs-xs)', color: '#0a7b80', wordBreak: 'break-all', marginBottom: 10 }}>
                {link}
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <button
                  className="btn btn-teal"
                  style={{ fontSize: 'var(--fs-sm)', padding: 13 }}
                  onClick={() => {
                    void writeClipboardText(link).then((copied) =>
                      toast(copied ? 'Link copiado ✓' : 'No se pudo copiar: tu navegador no habilitó el portapapeles'),
                    );
                  }}
                >
                  <Icon name="copy" size={16} className="ico-inline" /> Copiar
                </button>
                <a
                  className="btn"
                  style={{ background: '#25D366', color: '#fff', fontSize: 'var(--fs-sm)', padding: 13, textDecoration: 'none' }}
                  href={`https://wa.me/?text=${encodeURIComponent(`Sumate a la mesa ${code} en PayMe: ${link}`)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Icon name="message" size={16} className="ico-inline" /> WhatsApp
                </a>
              </div>
              <div className="note note-orange">
                Guardá el link: por seguridad se muestra <b>una sola vez</b> (después podés
                generar otro desde la mesa).
              </div>
            </>
          ) : linkState === 'loading' ? (
            <div className="loading">Generando link…</div>
          ) : (
            <div className="note note-orange" role="alert">
              {linkError ?? 'No pudimos generar el link.'}
              <button
                className="btn btn-ghost btn-sm"
                style={{ marginTop: 10 }}
                onClick={() => void makeLink(code)}
              >
                Reintentar el mismo link
              </button>
            </div>
          )}
          {/* Feedback del hermano (2026-07-24): invitar DIRECTO a amigos de la
              app, con buscador y grupos — el link queda para los que no la tienen. */}
          <InviteFriends code={code} />
        </div>
        <button className="cta-float" onClick={() => navigate('mesa', code)}>
          Ir a la mesa → elegir lo mío
        </button>
      </div>
    );
  }

  return null;
}
