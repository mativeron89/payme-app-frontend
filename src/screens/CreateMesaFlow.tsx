import type { StripeCardElement } from '@stripe/stripe-js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, IS_MOCK, MAX_TICKET_IMAGE_BYTES, QR_RESTAURANT_ID, newIdempotencyKey } from '../api';
import { useWalletRail } from '../api/walletRail';
import { extractApiError } from '../api/errors';
import { HttpError } from '../api/http';
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
import { MOCK_RESTAURANTS } from '../api/mock/seedData';
import { createCardPaymentMethod } from '../api/stripe';
import type { CreateMesaResponse, PaymentMethod, Restaurant } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { AppBottomBar, AppBottomCta } from '../components/AppBottomBar';
import { AppHeaderFlow } from '../components/AppHeader';
import { CardField, type CardFieldState } from '../components/CardField';
import { Icon } from '../components/Icon';
import { InviteFriends } from '../components/InviteFriends';
import { CardBrandChip, TopBar, useToast } from '../components/ui';
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
   * §1.6 · qué salió mal en la captura. Era un booleano y no alcanzaba: la foto
   * demasiado grande y el OCR que no pudo leer son estados DISTINTOS, con color
   * distinto y con salidas distintas. Meterlos en el mismo cartel obligaba a
   * elegir un copy que no fuera cierto para uno de los dos.
   */
  const [scanIssue, setScanIssue] = useState<'ocr' | 'too_large' | null>(null);
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
  const [division, setDivision] = useState<'consumo' | 'igual'>('consumo');
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
  // Piso del CONTRATO, no inventado: `schemas/index.js` exige >= 2 en partes
  // iguales (refine sobre division_mode) y >= 1 en el resto.
  const pisoComensales = division === 'igual' ? 2 : 1;
  const [method, setMethod] = useState<'card' | 'wallet'>('card');
  // D4: tarjetas guardadas. `cardChoice` es el pm_… elegido o 'new' (otra
  // tarjeta); `saveCard` = checkbox "guardar" — nace DESMARCADO (Mati,
  // 2026-08-06; el porqué vive en `saveCardView.ts`).
  const [cards, setCards] = useState<PaymentMethod[]>([]);
  const [cardChoice, setCardChoice] = useState<string>('new');
  const [saveCard, setSaveCard] = useState(GUARDAR_TARJETA_DEFAULT);
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
    // El diagnóstico y su autorización de reenvío pertenecen al intento que se
    // estaba mirando: cambiar de principal los invalida a los dos.
    setDecision(null);
    setReplayAutorizado(null);
    if (!mesaScopeBase) return;
    let alive = true;
    void readUnconfirmed(mesaScopeBase, 'create_mesa')
      .then((attempt) => {
        if (!alive) return;
        setFrozen(attempt);
        setPriorAttemptCheckedFor(mesaScopeBase);
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
          toast(`Esa mesa ya existe: ${resultado.navegarA}`);
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
            <b>Hay una apertura de una sesión anterior.</b> Puede que la garantía ya exista.
            {replayHabilitado
              ? ' Ya sabemos cómo quedó: podés reenviarla tal cual desde el botón de abajo.'
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
                {reconciling ? 'Consultando…' : 'Revisar cómo quedó esa apertura'}
              </button>
            </div>
          </>
        ) : (
          <><b>Tenés una apertura sin confirmar.</b> Puede que la mesa ya se haya creado con su garantía. Reintentala tal cual: si ya existe, te devolvemos esa misma mesa en vez de retener el total otra vez.</>
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
      ? 'Agregá al menos un consumo.'
      : 'Completá nombre y precio (mayor a cero) de cada consumo.';
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
      setEditItems(
        r.items.map((i) => ({
          name: i.name,
          priceStr: centsToString(i.price_cents),
          quantity: i.quantity,
          ...(i.category && { category: i.category }),
        })),
      );
      // El total impreso, para contrastarlo (§1.3). Un OCR que no lo pudo leer
      // manda 0: eso no es "el ticket sumaba cero", es "no lo sé" → sin dato,
      // no se compara y la observación queda informativa.
      setScannedTotalCents(r.total_cents > 0 ? r.total_cents : null);
      setScanIssue(null);
      // El OCR puede contestar 200 con CERO ítems (routes/ocr.js devuelve
      // `items: []` ante `provider_error`). Con la lista vacía y la vista normal
      // no habría ni una fila ni el "+ Agregar consumo", que vive en el modo
      // edición: la pantalla quedaría sin salida. Se abre ya en edición.
      setEditingItems(r.items.length === 0);
      setExpandedItem(null);
      setStep('ticket');
    } catch (err) {
      // El techo se mira ANTES de subir, así que acá sólo cae lo que pasó el
      // chequeo local y el backend igual rechazó (413 `image_too_large`, p.ej.
      // un proxy con otro límite). Mismo cartel, misma salida.
      const tooLarge = err instanceof HttpError && (err.status === 413 || err.body?.error === 'image_too_large');
      setScanIssue(tooLarge ? 'too_large' : 'ocr');
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
      if (def && cardStateRef.current.empty) setCardChoice(def.id);
    } catch {
      setCards([]);
    }
  }

  async function createMesa() {
    if (!ticketValid) return;
    // §1.4: sin N elegido no se abre mesa. Este guard NO inventa un default —
    // el gate de División ya lo exige, y si algún camino nuevo llegara acá sin
    // elección, vuelve a División en vez de fabricar un número. Que no exista
    // camino que mande un N que el usuario no eligió es la condición de la
    // orden, y un `?? 4` acá la violaría en silencio.
    if (participants === null) {
      toast('Elegí cuántos son');
      setStep('division');
      return;
    }
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
    // ORDEN 2A · el bloqueo se levanta SÓLO con un diagnóstico del contrato que
    // habilite reenviar, y lo que se habilita es reenviar ESTE intento con SU
    // clave —nunca abrir otro—: `intent` sale de `frozen.handle` unas líneas
    // más abajo y no se rota. Por B-06 eso no puede duplicar: si la mesa ya
    // existe, el backend devuelve ESA; si no, la crea por primera vez.
    //
    // ⚠️ LÍMITE DECLARADO: con tarjeta TIPEADA y tras un reload, el `pm_` ya no
    // está en memoria y Stripe.js devuelve otro por invocación. El backend lo
    // deja fuera del hash a propósito (`PAYLOAD_KEYS.create_mesa`), pero el
    // fingerprint LOCAL cubre el request entero, así que `prepareMonetaryRequest`
    // va a cortar con `monetary_payload_ambiguous`. Es fail-closed —corta, no
    // duplica— y por eso el reenvío sirve hoy con tarjeta guardada.
    if (frozenRequiresReconciliation && !replayHabilitado) {
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
            ? walletRailEnabled
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
        <AppHeaderFlow paymeId={session?.user?.payme_id} onBack={back} step="Paso 1 de 5" />
        <div className="title-card">
          {/* <h1> y no <div>: es el único título de esta pantalla. */}
          <h1 className="title-card-title">Escaneá el ticket</h1>
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
            {scanning ? 'Subiendo la foto…' : 'Encuadrá el ticket dentro del marco'}
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
                  <div className="state-error-title">No pudimos leer el ticket</div>
                  <p className="state-error-body">
                    Probá sacar la foto de nuevo con más luz, o cargá los consumos a mano.
                  </p>
                </div>
              </div>
              {/* Las DOS salidas, al lado. Un OCR que falla no puede terminar
                  el flujo: sin "Cargarlo a mano" la mesa queda sin abrir. */}
              <div className="state-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={doScan}>
                  Reintentar
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={cargarAMano}>
                  Cargarlo a mano
                </button>
              </div>
            </div>
          )}
          {scanIssue === 'too_large' && (
            <div className="state-warn" role="alert">
              <div className="state-error-row">
                <Icon name="warning" size={22} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="state-error-title">La foto pesa más de 8 MB</div>
                  <p className="state-error-body">Probá con menos calidad.</p>
                </div>
              </div>
              <div className="state-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={doScan}>
                  Sacar otra foto
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
          <div className="note note-teal scan-note">
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
          center={{ label: 'Capturar', icon: 'camera', onClick: doScan, disabled: scanning }}
        />
      </div>
    );
  }

  // ─── Paso 2: ticket ──────────────────────────────────────
  /**
   * SPEC_APP.md §1.3, aplicado. Lo que cambia y por qué:
   *
   *  - Cabecera de flujo de dos filas y tarjeta de título `--teal-l`, la misma
   *    que estrenó División. Acá la tarjeta SÍ lleva contenido debajo del
   *    título: total y observación, separados por la misma línea que separa la
   *    lista. Es UNA tarjeta — las dos variantes con pestaña fusionada al
   *    estilo Inicio se probaron y Mati las rechazó.
   *  - La lista deja de ser una grilla de inputs y pasa a texto limpio. Los
   *    controles aparecen recién en modo edición: la vista normal es para leer
   *    el ticket, no para tipearlo.
   *  - El stepper de cantidad pasa de 22×22 a 44×44. Estaba en la MITAD del
   *    mínimo del sistema, en una pantalla que se usa parado y con una mano.
   *  - Desaparece el copy "N consumos · corregí lo que haga falta": el spec
   *    manda no mostrar el conteo, y "corregí lo que haga falta" ya lo dice el
   *    link de modificar.
   *  - CTA: la barra de cinco posiciones con "Continuar", sin ítem activo. El
   *    motivo de invalidez sube a la fila propia de la barra en vez de flotar
   *    sobre el contenido a `bottom: 78px`, que se apoyaba en la altura del
   *    botón viejo. Salir del flujo acá no deja nada a medias: el freeze
   *    monetario empieza en la garantía, dos pasos más adelante.
   */
  if (step === 'ticket') {
    return (
      <div className="screen has-appbar">
        <AppHeaderFlow paymeId={session?.user?.payme_id} onBack={back} step="Paso 2 de 5" />
        <div className="title-card">
          <div className="title-card-title">{restaurant?.name ?? 'Restaurante'}</div>
          {restaurant?.address && (
            <div className="title-card-sub">
              <Icon name="pin" size={14} className="ico-inline" /> {restaurant.address}
            </div>
          )}
          <div className="title-card-div" />
          <div className="title-card-total">
            <span className="title-card-total-lbl">Total</span>
            <span className="title-card-total-amt">{formatMXN(total)}</span>
          </div>
          {/* Informativa mientras cierre; --warning con la diferencia exacta
              cuando no. `aria-live` porque el salto de una a otra pasa mientras
              la persona edita y no vuelve a leer la tarjeta. */}
          <div
            className={`title-card-note ${totalMismatch ? 'warn' : ''}`}
            aria-live="polite"
          >
            <Icon name={totalMismatch ? 'warning' : 'info'} size={16} />
            <span>
              {totalMismatch
                ? `No coincide con el total del ticket (${formatMXN(totalMismatch.printed)}): hay ${formatMXN(Math.abs(totalMismatch.diff))} de ${totalMismatch.diff > 0 ? 'más' : 'menos'}.`
                : 'Chequeá que el total coincida con el total del ticket'}
            </span>
          </div>
        </div>
        <div className="scroll flow-scroll">
          {avisoApertura()}
          <div className="tk-list">
            {editItems.map((it, idx) => {
              const nombre = it.name.trim();
              const etiqueta = nombre || `consumo ${idx + 1}`;
              if (editingItems && expandedItem === idx) {
                return (
                  <div className="tk-edit" key={idx} ref={expandedRowRef}>
                    <label className="tk-edit-field">
                      <span className="tk-edit-lbl">Consumo</span>
                      <input
                        className="tk-edit-input"
                        value={it.name}
                        placeholder="Nombre del consumo"
                        onChange={(e) => updateItem(idx, { name: e.target.value })}
                      />
                    </label>
                    <label className="tk-edit-field">
                      <span className="tk-edit-lbl">Precio por unidad</span>
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
                      <div className="stepper" role="group" aria-label={`Cantidad de ${etiqueta}`}>
                        <button
                          onClick={() => updateItem(idx, { quantity: Math.max(1, it.quantity - 1) })}
                          aria-label={`Una unidad menos de ${etiqueta}`}
                        >
                          −
                        </button>
                        <div className="val" aria-live="polite">
                          {it.quantity}
                        </div>
                        <button
                          onClick={() => updateItem(idx, { quantity: it.quantity + 1 })}
                          aria-label={`Una unidad más de ${etiqueta}`}
                        >
                          +
                        </button>
                      </div>
                      <button className="tk-del" onClick={() => removeItem(idx)}>
                        <Icon name="trash" size={18} /> Eliminar
                      </button>
                    </div>
                  </div>
                );
              }
              return (
                <div className="tk-row" key={idx}>
                  <span className="tk-qty">{it.quantity}</span>
                  <span className={`tk-name ${nombre ? '' : 'tk-sin-nombre'}`}>
                    {nombre || 'Sin nombre'}
                  </span>
                  <span className="tk-price">
                    {lineTotals[idx] === null ? '—' : formatMXN(lineTotals[idx] as number)}
                  </span>
                  {editingItems && (
                    <button
                      className="tk-pencil"
                      onClick={() => setExpandedItem(idx)}
                      aria-label={`Modificar ${etiqueta}`}
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
              {editingItems ? 'Listo' : 'Modificar ítems'}
            </button>
            {editingItems && (
              <button className="tk-edit-link" onClick={addItem}>
                <Icon name="plus" size={18} /> Agregar consumo
              </button>
            )}
          </div>
        </div>
        <AppBottomBar
          active={null}
          above={!ticketValid ? <div className="tk-invalid">{ticketInvalidReason}</div> : undefined}
          center={{
            label: 'Continuar',
            icon: 'arrow-right',
            onClick: () => setStep('division'),
            disabled: !ticketValid,
          }}
        />
      </div>
    );
  }

  // ─── Paso 3: división ────────────────────────────────────
  /**
   * SPEC_APP.md §1.4, aplicado. Lo que cambia y por qué:
   *
   *  - Cabecera de DOS filas (§1.3) en vez de la `TopBar` genérica, y tarjeta
   *    de título `--teal-l` montada sobre la banda, con el título centrado y
   *    **nada debajo** — a diferencia de Ticket, que sí trae total.
   *  - La selección pasó de naranja a teal: dentro de una tarjeta el naranja ya
   *    no marca estado, marca marca. Y no es sólo el borde — el radio se llena.
   *  - El importe por persona sube a `--fs-h1` y se muestra **en vivo** con el
   *    stepper: es la información que la persona está buscando. Antes era una
   *    píldora chica al costado de la tarjeta.
   *  - CTA: la barra de cinco posiciones con "Continuar" en el centro, sin
   *    ítem activo. Deja salir del flujo a mitad de camino, y es intencional.
   *    Acá todavía no hay nada congelado —el freeze empieza en la garantía—,
   *    así que irse no deja ninguna operación monetaria a medias.
   */
  if (step === 'division') {
    // splitEqual, igual que el backend: la suma de las partes da el total exacto
    // (el primer comensal absorbe los centavos sobrantes).
    const perSlot = participants !== null && participants > 0 ? splitEqual(total, participants)[0] : total;
    return (
      <div className="screen has-appbar">
        <AppHeaderFlow paymeId={session?.user?.payme_id} onBack={back} step="Paso 3 de 5" />
        <div className="title-card">
          <div className="title-card-title">¿Cómo dividen?</div>
        </div>
        {/* Mismo cambio que Ticket: el padding inline que había acá pisaba el
            padding-bottom de `.has-appbar .scroll` y dejaba a División sin
            separación con la barra. No se veía porque su contenido es corto. */}
        <div className="scroll flow-scroll">
          {avisoApertura()}
          <button className={`div-card ${division === 'consumo' ? 'sel' : ''}`} onClick={() => setDivision('consumo')}>
            <div className="div-radio" />
            <div className="div-ico">
              <Icon name="users" size={22} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="div-title">Por lo que pidió cada uno</div>
              <div className="div-sub">Cada uno elige sus platos</div>
            </div>
          </button>
          <button
            className={`div-card ${division === 'igual' ? 'sel' : ''}`}
            onClick={() => {
              setDivision('igual');
              // El piso de iguales es 2 (contrato): un 1 elegido en consumo
              // deja de ser válido y se vuelve a preguntar, no se corrige solo.
              if (participants !== null && participants < 2) setParticipants(null);
            }}
          >
            <div className="div-radio" />
            <div className="div-ico">÷</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="div-title">En partes iguales</div>
              <div className="div-sub">El total dividido entre todos</div>
            </div>
          </button>
          {/* §1.4 (2026-08-06): el stepper SIEMPRE — se sacó el `if`, no se
              agregó pantalla. El copy cambia porque el número hace algo
              distinto: en iguales determina el importe; en consumo sólo fija
              la base de propina — la MISMA "cuenta ÷ N" que la persona va a
              ver en §1.5 bis, con la MISMA fórmula del emisor
              (Math.round(total/N), routes/mesas.js:780). Nace SIN ELEGIR con
              el patrón exacto del selector de propina: marco pendiente,
              Continuar nunca se apaga, toast + scroll si tocan sin elegir. */}
          <div
            ref={stepperRef}
            className={`card card-p${participants === null ? ' tip-block tip-block--pending' : ''}${stepperPulse ? ' tip-block--pulse' : ''}`}
            style={{ marginBottom: 12 }}
            onAnimationEnd={() => setStepperPulse(false)}
          >
            <div className="sectlabel tip-block-title">
              {participants === null && <Icon name="warning" size={14} aria-hidden="true" />}
              {division === 'igual' ? '¿Cuántos pagan?' : '¿Cuántos son en la mesa?'}
            </div>
            <div className="stepper" role="group" aria-label="Cantidad de comensales">
              <button
                onClick={() => setParticipants(participants === null ? pisoComensales : Math.max(pisoComensales, participants - 1))}
                aria-label="Un comensal menos"
              >
                −
              </button>
              <div className="val" aria-live="polite">
                {participants ?? '—'}
              </div>
              <button
                onClick={() => setParticipants(participants === null ? pisoComensales : Math.min(20, participants + 1))}
                aria-label="Un comensal más"
              >
                +
              </button>
            </div>
            {/* Sin elegir, sin número: un importe calculado sobre un N que
                nadie eligió es exactamente lo que este stepper mata. */}
            {participants !== null && (
              <>
                <div className="split-amt" aria-live="polite">
                  {division === 'igual'
                    ? formatMXN(perSlot)
                    : formatMXN(Math.round(total / participants))}
                </div>
                <div className="split-amt-lbl">
                  {division === 'igual' ? 'c/u' : 'base de propina · c/u'}
                </div>
              </>
            )}
          </div>
        </div>
        <AppBottomBar
          active={null}
          center={{
            label: 'Continuar',
            icon: 'arrow-right',
            onClick: () => {
              // §1.4: el CTA nunca se apaga — frena explicando, igual que la
              // propina. Un botón muerto sin motivo es el defecto que Ticket
              // ya pagó.
              if (participants === null) {
                toast('Elegí cuántos son');
                stepperRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
                setStepperPulse(true);
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
      <div className="screen has-cta">
        <TopBar title="Garantizá la mesa" onBack={back} />
        <div className="scroll" style={{ padding: 16 }}>
          <div style={{ background: 'var(--navy)', borderRadius: 16, padding: '18px 20px', marginBottom: 14 }}>
            <div style={{ fontSize: 'var(--fs-legacy-xs)', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Garantía de la mesa
            </div>
            <div style={{ fontSize: 'var(--fs-legacy-3xl)', fontWeight: 800, color: '#fff' }}>{formatMXN(total)}</div>
            <div style={{ fontSize: 'var(--fs-legacy-xs)', color: 'rgba(255,255,255,0.45)', marginTop: 4, fontFamily: 'var(--font-body)' }}>
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
          {avisoApertura()}
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
                  <div style={{ fontWeight: 700, fontSize: 'var(--fs-legacy-base)' }}>
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
                <div style={{ fontWeight: 700, fontSize: 'var(--fs-legacy-base)' }}>
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
        </div>
        <button
          className="cta-float"
          onClick={createMesa}
          disabled={
            busy ||
            !priorAttemptChecked ||
            priorAttemptCheckFailed ||
            (frozenRequiresReconciliation && !replayHabilitado) ||
            (!frozen &&
              !IS_MOCK &&
              method === 'card' &&
              (cards.length === 0 || cardChoice === 'new') &&
              !cardState.complete)
          }
        >
          {busy ? (
            'Autorizando…'
          ) : frozenRequiresReconciliation && !replayHabilitado ? (
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
   * una etiqueta que miente*. Pasa a **"Ver mesa"**, con ícono de plato y sin
   * flecha de retroceso.
   *
   * El renombre resuelve además algo que esta pantalla había perdido: al pasar
   * el CTA del pie al círculo con casa, **nada le decía al organizador que
   * todavía le falta elegir lo suyo**. El camino existía —casa → Inicio → la
   * burbuja de la mesa— pero ningún control lo nombraba. Ahora lo nombra, **sin
   * agregar un segundo botón**: es el mismo control.
   *
   * **Se retira "Paso 5 de 5"** por lo mismo. "Ver mesa" no es un paso hacia
   * atrás del asistente sino una salida lateral a la mesa en vivo; contar pasos
   * al lado de un control que no navega el asistente ya no significa nada.
   *
   * El destino se verificó antes de cablear, y no hubo nada que recablear:
   * `navigate('mesa', code)` **ya era** Mis ítems (§1.5) —`#/mesa/:code` monta
   * `MesaScreen`, que es esa pantalla— y acepta el código. Lo único que estaba
   * mal era cómo se llamaba el control.
   */
  if (step === 'share' && created) {
    const code = created.mesa.code;
    const copiarLink = () => {
      if (!link) return;
      void writeClipboardText(link).then((copied) =>
        toast(copied ? 'Link de invitación copiado ✓' : 'No se pudo copiar: tu navegador no habilitó el portapapeles'),
      );
    };
    return (
      <div className="screen has-appbar">
        <AppHeaderFlow
          paymeId={session?.user?.payme_id}
          onBack={() => navigate('mesa', code)}
          backLabel="Ver mesa"
          backIcon="tools-kitchen-2"
        />
        <div className="title-card">
          <h1 className="title-card-title">¡Mesa garantizada!</h1>
          <div className="title-card-sub">Compartí el código para que se sumen</div>
        </div>
        <div className="scroll flow-scroll">
          <div className="share-card">
            {/* Tocar el código copia EL LINK, no el código: el código solo no
                sirve para entrar —las tres rutas de mesa exigen sesión y
                participación desde v2.32.0—, y la credencial es el `?t=`. Por
                eso el aviso dice "link" y no "código". */}
            <button
              type="button"
              className="share-code"
              onClick={copiarLink}
              disabled={!link}
              aria-label={`Copiar el link de invitación de la mesa ${code}`}
            >
              <span className="share-code-txt">{code}</span>
              <Icon name="copy" size={20} />
            </button>
            <a
              className={`btn share-wa ${link ? '' : 'off'}`}
              href={link ? `https://wa.me/?text=${encodeURIComponent(`Sumate a la mesa ${code} en PayMe: ${link}`)}` : undefined}
              target="_blank"
              rel="noreferrer"
              aria-disabled={link ? undefined : true}
            >
              <Icon name="message" size={18} className="ico-inline" /> Compartir por WhatsApp
            </a>
          </div>
          {/* El link se muestra UNA sola vez y en texto: es una credencial, y
              esconderla detrás del portapapeles deja a quien no pudo copiar sin
              nada. La advertencia es de comportamiento real del backend. */}
          {linkState === 'ready' && link && (
            <>
              <p className="share-link">{link}</p>
              <div className="note note-orange">
                Guardá el link: por seguridad se muestra <b>una sola vez</b> (después podés
                generar otro desde la mesa).
              </div>
            </>
          )}
          {linkState === 'loading' && (
            <p className="share-link" aria-busy="true">
              Generando el link…
            </p>
          )}
          {linkState !== 'ready' && linkState !== 'loading' && (
            <div className="state-error" role="alert">
              <div className="state-error-row">
                <Icon name="x-circle" size={22} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="state-error-title">No pudimos generar el link</div>
                  <p className="state-error-body">
                    {linkError ?? 'La mesa está abierta igual: podés invitar desde acá abajo.'}
                  </p>
                </div>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void makeLink(code)}>
                Reintentar el mismo link
              </button>
            </div>
          )}
          <InviteFriends code={code} />
        </div>
        {/* Variante REDUCIDA de la barra: el círculo no significa "avanzar un
            paso", cierra el flujo. Glifo de casa, no flecha. */}
        <AppBottomCta label="Ir a Inicio" icon="home" onClick={() => navigate('home')} />
      </div>
    );
  }

  return null;
}
