import { centsToDisplay, fractionAmount, splitEqual, sumCents, tipFromBps } from '../../utils/money';
import { createSession, loadSession, saveSession, type StoredSession } from '../storage';
import type {
  AcceptInvitationLinkResponse,
  AppConfig,
  AttachPaymentMethodResponse,
  MeResponse,
  RestaurantResponse,
  BalanceResponse,
  ClabeResponse,
  CreateInvitationResponse,
  CreateMesaRequest,
  CreateMesaResponse,
  CreateSetupIntentResponse,
  CreateTransferRequest,
  CreateTransferResponse,
  FriendRequestCreatedResponse,
  FriendRequestDirection,
  FriendRequestsResponse,
  FriendsResponse,
  GroupDetailResponse,
  GroupsResponse,
  LockItemsResponse,
  MesaCreationOutcome,
  MesaDetailResponse,
  MesaStatus,
  NotificationsResponse,
  OcrResponse,
  OpenMesasResponse,
  PayMesaRequest,
  PayMesaResponse,
  PaymentMethod,
  PaymentMethodsResponse,
  PendingInvitationsResponse,
  StatsResponse,
  TransfersResponse,
  WalletTransactionsResponse,
  HistoryResponse,
  FractionRequest,
} from '../types';
import { MOCK_CONNECTED_ACCOUNTS, MOCK_RESTAURANTS, MOCK_USER } from './seedData';
import {
  availableBalance,
  findMesa,
  markMesaPaid,
  materializeDemoMesa,
  mesaPayable,
  mockId,
  persist,
  pushWalletTx,
  settleIfExpired,
  state,
  toMesaDetail,
  toOpenMesa,
  takenBps,
  type MockClaim,
  type MockIdemEntry,
  type MockIdentity,
  type MockMesa,
  type MockSlot,
} from './store';

/**
 * Adaptador mock (VITE_MOCK=1): replica shapes Y reglas del contrato
 * (garantía A-1, saldo retenido, locks, slots, expiración A-2, errores 4xx
 * como MockApiError con el mismo `error` que devolvería el backend).
 */

const LATENCY_MS = 350;

function validNonNegativeCents(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validPositiveCents(value: unknown): value is number {
  return validNonNegativeCents(value) && value > 0;
}

function validIdempotencyKey(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 8 && value.length <= 100;
}

/**
 * B-06: réplica de la idempotencia del backend. El ledger vive dentro del
 * estado persistido del mock: una recarga restaura mutación y clave juntas.
 *
 * Guarda el HASH del payload junto a la respuesta, como el backend: misma
 * clave + mismo contenido = replay; misma clave + otro contenido =
 * `409 idempotency_conflict`. Sin comparar el contenido, el mock replayaba
 * pagos distintos con la misma clave y tapaba en la demo justo los bugs que
 * el fix tiene que evitar.
 */
function readMockIdempotency(key: string): MockIdemEntry | undefined {
  return state.idempotency[key];
}

function writeMockIdempotency(key: string, entry: MockIdemEntry): void {
  state.idempotency[key] = entry;
}

/** El backend actualiza la fila canónica antes de resolver un replay. */
function invitationReplay(entry: MockIdemEntry): CreateInvitationResponse {
  const response = entry.response as CreateInvitationResponse;
  const expiry = Date.parse(response.invitation?.expires_at ?? '');
  if (response.invitation?.status === 'pending' && Number.isFinite(expiry) && expiry <= Date.now()) {
    return {
      ...response,
      invitation: { ...response.invitation, status: 'expired' },
    };
  }
  return response;
}

function readPendingInvitationAuthority(key: string): MockIdemEntry | undefined {
  const entry = readMockIdempotency(key);
  if (!entry) return undefined;
  const response = entry.response as CreateInvitationResponse;
  const expiry = Date.parse(response.invitation?.expires_at ?? '');
  if (response.invitation?.status !== 'pending' || !Number.isFinite(expiry) || expiry <= Date.now()) {
    delete state.idempotency[key];
    return undefined;
  }
  return entry;
}

/**
 * Mismos subconjuntos de campos que `PAYLOAD_KEYS` del backend. `lock_tokens`
 * queda afuera (estado temporal del lock) y las listas se ordenan, para no
 * inventar conflictos que el backend real no daría.
 */
const MOCK_PAYLOAD_KEYS = {
  mesa_pay: [
    'payment_type',
    'item_ids',
    'items',
    'tip_cents',
    'tip_bps',
    'tip_to_staff_id',
  ],
  create_mesa: [
    'restaurant_id',
    'total_cents',
    'division_mode',
    'expected_participants',
    'guarantee_method',
    'items',
  ],
  transfer: ['amount_cents', 'to_payme_id', 'to_email', 'to_user_id', 'concept'],
  topup_oxxo: ['amount_cents'],
  topup_card: ['amount_cents', 'payment_method_id'],
  invitation: ['type', 'invited_user_id'],
} as const;

const MOCK_UNORDERED_ARRAY_KEYS = new Set(['item_ids', 'slot_ids', 'items']);

/** Misma representación canónica recursiva que utils/idempotency.js del backend. */
function canonicalizeMockPayload(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalizeMockPayload).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalizeMockPayload(object[key])}`)
    .join(',')}}`;
}

function sortUnorderedMockArray(value: unknown[]): unknown[] {
  const hasObjects = value.some((item) => item !== null && typeof item === 'object');
  if (!hasObjects) return [...value].map(String).sort();
  return [...value]
    .map((item) => ({ item, canonical: canonicalizeMockPayload(item) }))
    .sort((a, b) => (a.canonical < b.canonical ? -1 : a.canonical > b.canonical ? 1 : 0))
    .map(({ item }) => item);
}

function mockPayloadHash(payload: unknown, keep: readonly string[]): string {
  const src = (payload ?? {}) as Record<string, unknown>;
  const subset: Record<string, unknown> = {};
  for (const k of keep) {
    if (!Object.prototype.hasOwnProperty.call(src, k) || src[k] === undefined) continue;
    const v = src[k];
    subset[k] = MOCK_UNORDERED_ARRAY_KEYS.has(k) && Array.isArray(v)
      ? sortUnorderedMockArray(v)
      : v;
  }
  // No se necesita SHA-256 en el mock: comparar la forma canónica conserva
  // exactamente la igualdad/conflicto que el backend aplica antes de hashear.
  return canonicalizeMockPayload(subset);
}

export class MockApiError extends Error {
  readonly status: number;
  readonly extra: Record<string, unknown>;

  constructor(status: number, error: string, extra: Record<string, unknown> = {}) {
    super(error);
    this.status = status;
    this.extra = extra;
  }
}

/**
 * Toda respuesta OK del mock pasa por acá, así que es el punto natural para
 * persistir: cualquier mutación queda guardada sin tener que acordarse en
 * cada handler.
 */
function delay<T>(value: T): Promise<T> {
  persist();
  return new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));
}

function fail(status: number, error: string, extra: Record<string, unknown> = {}): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new MockApiError(status, error, extra)), LATENCY_MS),
  );
}

// ─── Config ────────────────────────────────────────────────

/**
 * `GET /api/config` — OLA 5D.
 *
 * El mock **también respeta la capability**, y eso es una decisión, no un
 * detalle: si el mock se saltara `wallet_rail` y el riel quedara apagado por
 * otro camino, el mock estaría *ignorando* la capability en vez de respetarla,
 * y el artefacto de desarrollo enseñaría un producto donde el apagado del riel
 * no depende del backend. Ya pasó en este repo que un mock permisivo le ocultó
 * un defecto vivo a quien verificaba a mano.
 *
 * Los valores replican **exactos** los del emisor
 * (`contract-mirror/routes/config.js:43-46`), y hay un test que lee el espejo
 * como texto y falla si se separan.
 *
 * `stripe_publishable_key: undefined` es fiel: el mock no carga Stripe.js ni
 * depende de credenciales.
 */
export async function mockGetConfig(): Promise<AppConfig> {
  return delay({
    version: 'mock',
    currency: 'mxn',
    stripe_publishable_key: undefined,
    mesa_hold_seconds: 1800,
    payment_hold_seconds: 420,
    invitation_expiry_seconds: 86400,
    item_lock_seconds: 600,
    features: {
      apple_pay: false,
      google_pay: false,
      stp_dispersal: false,
      ocr_real: false,
      wallet_rail: { enabled: false, account_activity: true },
    },
  });
}

// ─── Auth ──────────────────────────────────────────────────

/** "sofi.lopez@mail.com" → "Sofi": el que prueba la demo se ve saludado por su
 *  propio nombre en vez del de la persona de ejemplo. */
function nameFromEmail(email: string): string | null {
  const local = email.split('@')[0]?.replace(/[._-]+/g, ' ').trim();
  if (!local) return null;
  const first = local.split(' ')[0];
  if (!first || first.length < 2 || /^\d+$/.test(first)) return null;
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

export async function mockLogin(email: string, _password: string): Promise<StoredSession> {
  const derived = nameFromEmail(email);
  const user = {
    ...MOCK_USER,
    email: email || MOCK_USER.email,
    ...(derived && { first_name: derived, last_name: '' }),
  };
  state.user = user;
  const session = createSession({
    access_token: 'mock-access-token',
    refresh_token: 'mock-refresh-token',
    user,
  });
  saveSession(session);
  return delay(session);
}

/** GET /account/me (G-02, v2.20): el user vigente de la demo. */
export async function mockGetMe(): Promise<MeResponse> {
  return delay({ user: state.user });
}

/** "Sofía" → "payme_mx_sofia": el payme_id de una cuenta nueva sale de SU
 *  nombre, como en el backend real — no del usuario de ejemplo. */
function paymeIdFromName(firstName: string): string {
  const plano = firstName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return `payme_mx_${plano || 'nueva'}`;
}

export async function mockRegister(data: {
  email: string;
  first_name: string;
  last_name: string;
}): Promise<StoredSession> {
  // Una cuenta NUEVA nace como en el backend real: sin métodos de pago y con
  // payme_id propio. Heredar los del seed hacía INEJERCITABLE el camino del
  // pagador primerizo —el primero que recorre un usuario real, porque la
  // garantía exige tarjeta guardada y Apple/Google están apagados— y servía
  // el payme_id de la persona de ejemplo a cualquier registro. El usuario del
  // SEED conserva sus dos tarjetas: entra por mockLogin, que no toca esto.
  state.user = { ...MOCK_USER, ...data, payme_id: paymeIdFromName(data.first_name) };
  state.paymentMethods = [];
  const session = createSession({
    access_token: 'mock-access-token',
    refresh_token: 'mock-refresh-token',
    user: state.user,
  });
  saveSession(session);
  return delay(session);
}

export async function mockLogout(): Promise<void> {
  return delay(undefined);
}

// ─── Cuenta ────────────────────────────────────────────────

export async function mockBalance(): Promise<BalanceResponse> {
  // G-03 (v2.21): retenido + disponible, misma resta que el backend.
  const held = state.held_balance_cents;
  const available = state.balance_cents - held;
  return delay({
    balance_cents: state.balance_cents,
    balance_display: centsToDisplay(state.balance_cents),
    held_balance_cents: held,
    held_balance_display: centsToDisplay(held),
    available_cents: available,
    available_display: centsToDisplay(available),
    clabe: state.clabe,
    currency: 'mxn',
  });
}

/** GET /restaurants/:id (G-01, v2.21): resuelve el uuid del QR de la mesa. */
export async function mockGetRestaurant(id: string): Promise<RestaurantResponse> {
  const r = MOCK_RESTAURANTS.find((x) => x.id === id);
  if (!r) return fail(404, 'restaurant_not_found');
  return delay({ restaurant: { ...r } });
}

export async function mockWalletTransactions(): Promise<WalletTransactionsResponse> {
  return delay({ transactions: [...state.walletTx], limit: 30, offset: 0 });
}

/** GET /account/history: pagos propios, más reciente primero. Replica la
 *  paginación real (limit default 20, máx 100) y los filtros from/to. */
export async function mockHistory(params?: {
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}): Promise<HistoryResponse> {
  const limit = Math.min(params?.limit ?? 20, 100);
  // `offset` espeja `historyQuery` del emisor: entero, mínimo 0, default 0.
  const offset = Math.max(0, Math.trunc(params?.offset ?? 0));
  let sorted = [...state.history].sort((a, b) => b.date.localeCompare(a.date));
  if (params?.from) sorted = sorted.filter((h) => h.date >= params.from!);
  if (params?.to) sorted = sorted.filter((h) => h.date <= params.to!);
  /**
   * `mesa_status` es VIVO, no foto: el emisor lo proyecta con `JOIN mesas` al
   * momento de la consulta (`routes/account.js`). `mockPayMesa` guarda el
   * estado del momento del pago, así que servirlo tal cual mentiría en el caso
   * corriente: pagás tu parte (la entrada nace `partially_paid`), la mesa
   * termina después, y el historial la seguiría mostrando viva — Historial
   * (§1.10) la excluiría para siempre. Se re-lee la mesa al servir; las del
   * seed sin mesa viva conservan su estado guardado.
   */
  const vivas = new Map(state.mesas.map((m) => [m.code, m.status]));
  const proyectado = sorted
    .slice(offset, offset + limit)
    .map((h) => (vivas.has(h.mesa_code) ? { ...h, mesa_status: vivas.get(h.mesa_code)! } : h));
  return delay({ history: proyectado, limit, offset });
}

// ─── v2.18 · Fracciones (réplica de services/itemClaims.js del espejo) ─────

const FRACTION_VALUES = [2500, 3333, 5000, 10000];
const COMPLETING_TOLERANCE_BPS = 100;

/** bps efectivos contra lo que queda; 409 si no entra; absorbe restos <100. */
function effectiveBps(requestedBps: number, remainingBps: number): number {
  if (remainingBps <= 0 || requestedBps > remainingBps) {
    throw new MockApiError(409, 'fraction_not_available', {
      remaining_bps: Math.max(0, remainingBps),
    });
  }
  return remainingBps - requestedBps < COMPLETING_TOLERANCE_BPS ? remainingBps : requestedBps;
}

/** Precio de la fracción; la que COMPLETA ajusta para que el ítem cierre exacto. */
function priceFraction(priceCents: number, effBps: number, otherLive: MockClaim[]): number {
  const otherBps = otherLive.reduce((s, c) => s + c.fraction_bps, 0);
  if (otherBps + effBps >= 10000) {
    const others = otherLive.reduce(
      (s, c) => s + (c.amount_cents != null ? c.amount_cents : fractionAmount(priceCents, c.fraction_bps)),
      0,
    );
    return Math.max(0, priceCents - others);
  }
  return fractionAmount(priceCents, effBps);
}

// ─── Mesas ─────────────────────────────────────────────────

export async function mockOpenMesas(): Promise<OpenMesasResponse> {
  state.mesas.forEach(settleIfExpired);
  return delay({
    mesas: state.mesas
      // G-28, cerrado en el backend v2.42.0: la mesa abierta es de **todos sus
      // participantes**, no sólo de quien la abrió. Filtrar por `openedByUser`
      // era acá el mismo defecto que `opener_user_id` allá — quien se sumaba
      // por un link leía "No tenés mesas abiertas" mientras debía plata, y sin
      // error que lo delatara.
      //
      // `joinedMesaCodes` es en el mock lo que `mesa_participants` con
      // `status = 'active'` es en el contrato: se escribe al canjear el link.
      .filter(
        (m) =>
          (m.openedByUser || state.joinedMesaCodes.includes(m.code)) &&
          (m.status === 'open' || m.status === 'partially_paid'),
      )
      .map(toOpenMesa),
  });
}

export async function mockGetMesa(code: string, identity: MockIdentity): Promise<MesaDetailResponse> {
  // Si el link viene de otro dispositivo, la mesa no existe en ESTE navegador:
  // se materializa con el ticket de ejemplo para que la demo no se corte.
  const mesa = findMesa(code) ?? materializeDemoMesa(code);
  if (!mesa) return fail(404, 'mesa_not_found');
  settleIfExpired(mesa);
  return delay({ mesa: toMesaDetail(mesa, identity) });
}

export async function mockScanTicket(): Promise<OcrResponse> {
  // Mismo ticket que devuelve el mock del backend (routes/ocr.js).
  const items = [
    { name: 'Tagliatelle Bolognese', price_cents: 19500, quantity: 1 },
    { name: 'Risotto ai Funghi', price_cents: 22000, quantity: 1 },
    { name: 'Pizza Margherita', price_cents: 18500, quantity: 1 },
    { name: 'Tiramisú', price_cents: 7000, quantity: 2 },
    { name: 'Agua mineral', price_cents: 4000, quantity: 1 },
    { name: 'Vino tinto (copa)', price_cents: 6000, quantity: 1 },
  ];
  const total = items.reduce((s, i) => s + i.price_cents * i.quantity, 0);
  return new Promise((resolve) =>
    setTimeout(() => resolve({ items, total_cents: total, mock: true }), 1200),
  );
}

/** Garantía 3DS pendiente del mock (mesa creada con card, aún pending_auth). */
let pending3ds: MockMesa | null = null;
/** D4: pm_ de la tarjeta nueva a guardar RECIÉN cuando el 3DS confirme. */
let pending3dsSave: string | null = null;

export async function mockCreateMesa(req: CreateMesaRequest): Promise<CreateMesaResponse> {
  if (!validIdempotencyKey(req.idempotency_key) || !validPositiveCents(req.total_cents) || !Array.isArray(req.items) || req.items.length === 0 ||
      req.items.some((item) => !validNonNegativeCents(item.price_cents) || !Number.isSafeInteger(item.quantity) || item.quantity < 1)) {
    return fail(400, 'validation_error');
  }
  let sum: number;
  try {
    sum = sumCents(...req.items.map((item) => {
      const line = BigInt(item.price_cents) * BigInt(item.quantity);
      if (line > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('line_overflow');
      return Number(line);
    }));
  } catch {
    return fail(400, 'validation_error');
  }
  if (sum !== req.total_cents) {
    return fail(400, 'total_mismatch', { expected: sum, received: req.total_cents });
  }
  // B-06 (v2.25): misma clave → misma mesa, sin abrir una segunda con otra
  // garantía por el total.
  const idemKey = `mesa:${req.idempotency_key}`;
  const idemHash = mockPayloadHash(req, MOCK_PAYLOAD_KEYS.create_mesa);
  const previoMesa = readMockIdempotency(idemKey);
  if (previoMesa) {
    if (previoMesa.hash !== idemHash) return fail(409, 'idempotency_conflict');
    return delay({ ...(previoMesa.response as CreateMesaResponse), idempotent: true });
  }
  const restaurant = MOCK_RESTAURANTS.find((r) => r.id === req.restaurant_id);
  if (!restaurant) return fail(404, 'restaurant_not_found');

  // A-1: hold de garantía. Wallet = congelar saldo (D2); card = hold con 3DS.
  if (req.guarantee_method === 'wallet') {
    const available = availableBalance();
    if (available < req.total_cents) {
      return fail(402, 'guarantee_failed', {
        reason: 'insufficient_balance_for_guarantee',
        available,
        required: req.total_cents,
      });
    }
  }

  const code = `PA-${Math.floor(Math.random() * 9000 + 1000)}`;
  const now = new Date().toISOString();
  const mesa: MockMesa = {
    id: mockId('c'),
    code,
    restaurant: { ...restaurant },
    total_cents: req.total_cents,
    paid_amount_cents: 0,
    tip_amount_cents: 0,
    division_mode: req.division_mode,
    expected_participants: req.expected_participants,
    status: req.guarantee_method === 'card' ? 'pending_auth' : 'open',
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    items: req.items.map((i) => ({
      id: mockId('d'),
      name: i.name,
      category: i.category ?? 'other',
      price_cents: i.price_cents,
      quantity: i.quantity,
      status: 'available',
      lockedBy: null,
      claims: [],
      lock_expires_at: null,
    })),
    slots:
      req.division_mode === 'igual'
        ? // splitEqual (igual que el backend): el primer comensal absorbe los
          // centavos sobrantes, así la suma de las partes da SIEMPRE el total.
          splitEqual(req.total_cents, req.expected_participants).map((amount, idx) => ({
            slot_index: idx,
            amount_cents: amount,
            status: 'available' as const,
            claimedBy: null,
          }))
        : null,
    active_staff: state.mesas[0]?.active_staff ?? [],
    openedByUser: true,
    captured_shortfall_cents: 0,
    guarantee_method: req.guarantee_method,
  };
  state.mesas.unshift(mesa);

  if (req.guarantee_method === 'wallet') {
    state.held_balance_cents += req.total_cents;
    const respuestaWallet: CreateMesaResponse = {
      mesa: {
        id: mesa.id,
        code: mesa.code,
        total_cents: mesa.total_cents,
        division_mode: mesa.division_mode,
        expected_participants: mesa.expected_participants,
        status: 'open',
        expires_at: mesa.expires_at,
        created_at: now,
      },
      guarantee: { method: 'wallet', status: 'open' },
    };
    // B-06: esta rama volvía ANTES de guardar la idempotencia, así que en la
    // demo el reintento de una garantía WALLET retenía el total otra vez.
    writeMockIdempotency(idemKey, { hash: idemHash, response: respuestaWallet });
    return delay(respuestaWallet);
  }

  // card: el mock siempre pide 3DS para que la demo muestre requires_action.
  // D4: el "guardar tarjeta" queda PENDIENTE hasta que el 3DS confirme — si
  // guardáramos acá, cada reintento cancelado acumularía tarjetas fantasma
  // (el backend real también guarda recién en el webhook del hold).
  pending3ds = mesa;
  // El riel del restaurante sigue informándose en la respuesta (Connect).
  const connectedAccountId = MOCK_CONNECTED_ACCOUNTS[req.restaurant_id];
  // G-11 CERRADO (backend v2.46.0): el guardado de la garantía es real
  // TAMBIÉN con hold directo — la condición `!connectedAccountId` que vivía
  // acá modelaba el v2.24 que lo ignoraba. Sigue PENDIENTE hasta el 3DS
  // (comentario de arriba): el camino post-3DS del backend lo cubre el
  // webhook de éxito, y acá lo cubre la confirmación.
  pending3dsSave =
    req.save_payment_method && req.stripe_payment_method_id
      ? req.stripe_payment_method_id
      : null;
  const respuestaMesa: CreateMesaResponse = {
    mesa: {
      id: mesa.id,
      code: mesa.code,
      total_cents: mesa.total_cents,
      division_mode: mesa.division_mode,
      expected_participants: mesa.expected_participants,
      status: 'pending_auth',
      expires_at: mesa.expires_at,
      created_at: now,
    },
    guarantee: {
      method: 'card',
      status: 'requires_action' as const,
      client_secret: 'mock_3ds_secret',
      ...(connectedAccountId && { connected_account_id: connectedAccountId }),
    },
  };
  writeMockIdempotency(idemKey, { hash: idemHash, response: respuestaMesa });
  return delay(respuestaMesa);
}

/** `routes/mesas.js` · `CREACION_ESTADOS_TERMINALES`, espejado exacto. */
const CREACION_ESTADOS_TERMINALES = new Set<MesaStatus>(['auth_failed', 'cancelled', 'expired']);

/** `routes/mesas.js` · `outcomeDeCreacion(status)`, espejado exacto. */
function outcomeDeCreacion(status: MesaStatus): MesaCreationOutcome {
  if (status === 'pending_auth') return 'requires_action';
  if (status === 'open') return 'open';
  if (status === 'partially_paid') return 'partially_paid';
  if (CREACION_ESTADOS_TERMINALES.has(status)) return 'terminal';
  // fully_paid, settling, settled, dispersing, completed: la mesa existe y
  // avanzó más allá de la apertura. La creación NO debe reintentarse.
  return 'replayable';
}

/**
 * `GET /mesas/creations/:idempotency_key` — ORDEN 2A · backend v2.47.0.
 *
 * Espejo del riel real, con sus dos rarezas conservadas porque el mock no
 * puede ser más lindo que el contrato:
 *
 * 1. **`total_cents` sale como STRING.** El real lo manda así (bigint del
 *    driver, mismo helper que el 201 de `POST /mesas`). Un mock que mandara el
 *    entero taparía el día que el decoder deje de aceptar la forma real.
 * 2. **El estado se lee de la mesa VIVA, no de la respuesta guardada.** La
 *    respuesta del idempotency store congeló el estado del momento de crear
 *    (`pending_auth`); el sentido del endpoint es decir en qué quedó, así que
 *    consultarla después del 3DS tiene que dar `open`.
 *
 * La autoridad es la clave, igual que allá: no hay búsqueda por nombre, por
 * restaurante ni por "la más reciente".
 *
 * `payloadHash` es opcional y **este front todavía no lo manda** (ver el
 * porqué en `getMesaCreation` de la fachada). Se implementa igual para que el
 * mock no sea una versión recortada del contrato.
 */
export async function mockGetMesaCreation(
  idempotencyKey: string,
  payloadHash?: string,
): Promise<unknown> {
  if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 1 || idempotencyKey.length > 200) {
    return fail(400, 'idempotency_key_invalid');
  }
  const previo = readMockIdempotency(`mesa:${idempotencyKey}`);
  if (!previo) {
    // El 404 del contrato TRAE cuerpo: no es una falla, es una respuesta.
    return fail(404, 'creation_not_found', {
      found: false,
      outcome: 'not_found',
      retry_with_same_idempotency_key: true,
    });
  }
  if (typeof payloadHash === 'string' && payloadHash.length > 0 && payloadHash !== previo.hash) {
    // Sin datos de la mesa, a propósito: la misma clave con otra intención
    // económica es un error del cliente, no un estado de la creación.
    return fail(409, 'payload_hash_conflict', {
      found: true,
      outcome: 'payload_hash_conflict',
      retry_with_same_idempotency_key: false,
    });
  }
  const code = (previo.response as CreateMesaResponse)?.mesa?.code;
  const mesa = state.mesas.find((m) => m.code === code);
  // Una fila que se evaporó es una inconsistencia del propio mock, no un
  // estado del contrato. Se contesta error genérico —el front conserva el
  // freeze— en vez de inventar un `not_found` que diría lo que no sabemos.
  if (!mesa) return fail(500, 'internal_error');

  const outcome = outcomeDeCreacion(mesa.status);
  return delay({
    found: true,
    outcome,
    retry_with_same_idempotency_key: outcome === 'requires_action',
    ...(payloadHash ? { payload_hash_matches: true } : {}),
    mesa: {
      id: mesa.id,
      code: mesa.code,
      total_cents: String(mesa.total_cents),
      division_mode: mesa.division_mode,
      expected_participants: mesa.expected_participants,
      status: mesa.status,
      expires_at: mesa.expires_at,
    },
    guarantee: {
      method: mesa.guarantee_method,
      authorized: mesa.guarantee_method !== null && mesa.status !== 'pending_auth',
    },
  });
}

/**
 * Confirmación 3DS simulada. En T7 (backend real) esto es
 * stripe.confirmCardPayment(client_secret) + esperar que el webhook abra la
 * mesa (poll de GET /mesas/:code). El mock la abre directo.
 */
export async function mockConfirmGuarantee3ds(code: string): Promise<{ status: 'open' }> {
  const mesa = findMesa(code);
  if (!mesa || mesa !== pending3ds) return fail(404, 'mesa_not_found');
  mesa.status = 'open';
  pending3ds = null;
  // D4: el hold quedó autorizado → recién ahora se guarda la tarjeta nueva.
  if (pending3dsSave) {
    saveMockCard(pending3dsSave);
    pending3dsSave = null;
  }
  return new Promise((resolve) => setTimeout(() => resolve({ status: 'open' }), 1500));
}

export async function mockLockItems(
  code: string,
  requests: FractionRequest[],
  identity: MockIdentity,
): Promise<LockItemsResponse> {
  const mesa = findMesa(code);
  if (!mesa) return fail(404, 'mesa_not_found');
  if (!mesaPayable(mesa)) return fail(409, 'mesa_not_active');
  if (!requests.every((r) => FRACTION_VALUES.includes(r.fraction_bps))) {
    return fail(400, 'validation_error', { message: 'fraction_bps inválido' });
  }
  // Validar y calcular efectivos ANTES de mutar (como la tx del backend).
  const claims: Array<{ item_id: string; fraction_bps: number }> = [];
  try {
    for (const rq of requests) {
      const item = mesa.items.find((i) => i.id === rq.item_id);
      if (!item) return fail(404, 'item_not_found', { item_id: rq.item_id });
      // Re-reclamo: mis locked del ítem se reemplazan (como el backend).
      const others = item.claims.filter((c) => !(c.who === identity && c.status === 'locked'));
      const remaining = 10000 - others.reduce((s, c) => s + c.fraction_bps, 0);
      const eff = effectiveBps(rq.fraction_bps, remaining);
      claims.push({ item_id: rq.item_id, fraction_bps: eff });
    }
  } catch (e) {
    if (e instanceof MockApiError) return fail(e.status, e.message, e.extra);
    throw e;
  }
  const expires = new Date(Date.now() + 10 * 60_000).toISOString();
  for (const c of claims) {
    const item = mesa.items.find((i) => i.id === c.item_id);
    if (!item) continue;
    item.claims = item.claims.filter((cl) => !(cl.who === identity && cl.status === 'locked'));
    item.claims.push({ who: identity, fraction_bps: c.fraction_bps, amount_cents: null, status: 'locked' });
    item.lock_expires_at = expires;
  }
  return delay({
    locked: claims.map((c) => c.item_id),
    claims,
    lock_token: `mock-lock-${Date.now()}`,
    lock_expires_at: expires,
  });
}

export async function mockPayMesa(
  code: string,
  req: PayMesaRequest,
  identity: MockIdentity,
): Promise<PayMesaResponse> {
  if (!validIdempotencyKey(req.idempotency_key) ||
      (req.tip_cents !== undefined && !validNonNegativeCents(req.tip_cents)) ||
      (req.tip_bps !== undefined && (!Number.isSafeInteger(req.tip_bps) || req.tip_bps < 0 || req.tip_bps > 10_000)) ||
      (req.items !== undefined && (!Array.isArray(req.items) || req.items.length === 0 || req.items.some((item) => !FRACTION_VALUES.includes(item.fraction_bps))))) {
    return fail(400, 'validation_error');
  }
  // B-06: misma clave → replay, sin volver a cobrar (igual que el backend).
  const idemKey = `pay:${code}:${req.idempotency_key}`;
  const idemHash = mockPayloadHash(req, MOCK_PAYLOAD_KEYS.mesa_pay);
  const previoPago = readMockIdempotency(idemKey);
  if (previoPago) {
    if (previoPago.hash !== idemHash) return fail(409, 'idempotency_conflict');
    const previous = previoPago.response as PayMesaResponse;
    // Forma del replay unificado coordinado: tip/tipo, detalle de consumo y
    // neutros Stripe. En igualdad `items` permanece ausente por contrato.
    return delay({
      idempotent: true,
      attempt: {
        id: previous.attempt.id,
        status: previous.attempt.status,
        gross_amount_cents: previous.attempt.gross_amount_cents,
        tip_cents: previous.attempt.tip_cents,
        payment_type: previous.attempt.payment_type,
        ...(previous.attempt.items && { items: previous.attempt.items }),
        ...(previous.attempt.payment_type === 'wallet' && previous.attempt.gross_display && {
          gross_display: previous.attempt.gross_display,
        }),
        ...(previous.attempt.payment_type !== 'wallet' && {
          client_secret: previous.attempt.client_secret ?? null,
          requires_action: previous.attempt.status === 'requires_action',
        }),
        ...(previous.attempt.connected_account_id && { connected_account_id: previous.attempt.connected_account_id }),
      },
    });
  }
  const mesa = findMesa(code);
  if (!mesa) return fail(404, 'mesa_not_found');
  settleIfExpired(mesa);
  if (!mesaPayable(mesa)) return fail(409, 'mesa_not_payable', { status: mesa.status });
  if (req.payment_type === 'wallet' && identity === 'guest') {
    return fail(401, 'wallet_requires_auth');
  }
  // D7 (v2.17): tip_bps (el server hace la cuenta sobre total ÷ N) excluyente
  // con tip_cents (monto a mano). Misma regla y mismo redondeo que el backend.
  if (req.tip_bps !== undefined && req.tip_cents) {
    return fail(400, 'validation_error', {
      message: 'tip_bps and tip_cents are mutually exclusive',
    });
  }
  const tipCents =
    req.tip_bps !== undefined
      ? tipFromBps(mesa.total_cents, mesa.expected_participants || 1, req.tip_bps)
      : (req.tip_cents ?? 0);

  let itemsAmount = 0;
  let selectedEqualSlot: MockSlot | null = null;
  // v2.18: recibo de fracciones cobradas (solo consumo).
  const pricedItems: Array<{ item_id: string; fraction_bps: number; amount_cents: number }> = [];
  if (mesa.division_mode === 'consumo') {
    const requests: FractionRequest[] =
      req.items ??
      (req.item_ids ?? []).map((id) => ({ item_id: id, fraction_bps: 10000 }));
    if (requests.length === 0) return fail(400, 'no_items_selected');
    try {
      for (const rq of requests) {
        const item = mesa.items.find((i) => i.id === rq.item_id);
        if (!item) return fail(400, 'invalid_item_ids');
        // Mi claim locked del ítem se consume/reemplaza; los demás quedan.
        const others = item.claims.filter((c) => !(c.who === identity && c.status === 'locked'));
        const remaining = 10000 - others.reduce((sum, c) => sum + c.fraction_bps, 0);
        const eff = effectiveBps(rq.fraction_bps, remaining);
        const amount = priceFraction(item.price_cents * item.quantity, eff, others);
        pricedItems.push({ item_id: rq.item_id, fraction_bps: eff, amount_cents: amount });
        itemsAmount = sumCents(itemsAmount, amount);
      }
    } catch (e) {
      if (e instanceof MockApiError) return fail(e.status, e.message, e.extra);
      throw e;
    }
  } else {
    const slot = mesa.slots?.find((s) => s.status === 'available');
    if (!slot) return fail(409, 'no_slots_available');
    // Seleccionar no es mutar: la parte se confirma recién después de validar
    // el saldo. Así un rechazo jamás necesita adivinar qué slot deshacer.
    selectedEqualSlot = slot;
    itemsAmount = slot.amount_cents;
  }

  let gross: number;
  try {
    gross = sumCents(itemsAmount, tipCents);
  } catch {
    return fail(400, 'validation_error');
  }

  if (req.payment_type === 'wallet') {
    const available = availableBalance();
    if (available < gross) {
      return fail(402, 'insufficient_funds', { available, required: gross });
    }
  }

  if (selectedEqualSlot) {
    selectedEqualSlot.status = 'paid';
    selectedEqualSlot.claimedBy = identity;
  }

  if (req.payment_type === 'wallet') {
    state.balance_cents -= gross;
    pushWalletTx('payment_mesa', -gross, `Pago mesa ${mesa.code}`);
  }

  if (mesa.division_mode === 'consumo') {
    for (const pi of pricedItems) {
      const item = mesa.items.find((i) => i.id === pi.item_id);
      if (!item) continue;
      item.claims = item.claims.filter((c) => !(c.who === identity && c.status === 'locked'));
      item.claims.push({
        who: identity,
        fraction_bps: pi.fraction_bps,
        amount_cents: pi.amount_cents,
        status: 'paid',
      } satisfies MockClaim);
      // v2.18: 'paid' SOLO al 100%.
      if (takenBps(item) >= 10000 && item.claims.every((c) => c.status === 'paid')) {
        item.status = 'paid';
      }
    }
  }
  mesa.tip_amount_cents += tipCents;
  markMesaPaid(mesa, itemsAmount);

  // Pantalla Mesas: cada pago propio suma una entrada al historial.
  if (identity !== 'guest') {
    state.history.push({
      id: mockId('h'),
      amount_cents: gross,
      date: new Date().toISOString(),
      mesa_code: mesa.code,
      mesa_status: mesa.status,
      restaurant: mesa.restaurant.name,
      category: mesa.restaurant.category,
    });
  }

  // v2.24 (Connect): el riel es DIRECTO si el restaurante tiene cuenta
  // conectada Y el pago es con tarjeta (el saldo nunca sale de PayMe).
  const connectedAccountId =
    req.payment_type !== 'wallet' ? MOCK_CONNECTED_ACCOUNTS[mesa.restaurant.id] : undefined;

  // D4 + G-11 CERRADO (backend v2.46.0, 7e45db0): el guardado es REAL también
  // bajo direct charge — attach del pm_ FUENTE al Customer de PayMe tras el
  // éxito del cobro, misma semántica que el vault. La condición
  // `!connectedAccountId` que vivía acá modelaba el v2.24 que ignoraba el
  // guardado en el riel directo; conservarla habría sido el mock mintiendo
  // AL REVÉS que antes. Sigue el contrato: sólo tarjeta ('card' — las wallets
  // nativas son no-op, cardEligibility las rechaza), sólo con cuenta.
  if (
    req.payment_type === 'card' &&
    req.save_payment_method &&
    req.stripe_payment_method_id &&
    identity !== 'guest'
  ) {
    saveMockCard(req.stripe_payment_method_id);
  }

  const respuesta: PayMesaResponse = {
    attempt: {
      id: mockId('f'),
      gross_amount_cents: gross,
      tip_cents: tipCents,
      ...(pricedItems.length > 0 && { items: pricedItems }),
      gross_display: centsToDisplay(gross),
      status: req.payment_type === 'wallet' ? 'processed' : 'succeeded',
      payment_type: req.payment_type,
      ...(req.payment_type !== 'wallet' && {
        client_secret: 'mock_payment_secret',
        stripe_status: 'succeeded',
        requires_action: false,
      }),
      ...(connectedAccountId && { connected_account_id: connectedAccountId }),
      // G-10 (Connect, mock-first): con tarjeta el comercio es el RESTAURANTE.
      // Forma acordada; el contrato real todavía no expone el campo.
      ...(req.payment_type !== 'wallet' && {
        statement_descriptor: mesa.restaurant.name.toUpperCase().slice(0, 22),
      }),
    },
  };
  writeMockIdempotency(idemKey, { hash: idemHash, response: respuesta });
  return delay(respuesta);
}

/** POST /:code/invitations type in_app: invita a un amigo por payme_id. */
export async function mockInviteFriend(
  code: string,
  paymeId: string,
  idempotencyKey: string,
): Promise<CreateInvitationResponse> {
  if (!validIdempotencyKey(idempotencyKey)) {
    return fail(400, 'validation_error');
  }
  const mesa = findMesa(code);
  if (!mesa) return fail(404, 'mesa_not_found');
  if (!mesaPayable(mesa)) return fail(409, 'mesa_not_invitable', { status: mesa.status });
  const invited = state.friends.find((f) => f.payme_id === paymeId);
  if (!invited) {
    return fail(404, 'invited_user_not_found');
  }
  // La autoridad canónica es el uuid resuelto por el backend, no el alias
  // `payme_id` aportado por el cliente.
  const payload = { type: 'in_app', invited_user_id: invited.id };
  const ledgerKey = `invitation:${state.user.id}:${mesa.id}:${idempotencyKey}`;
  const naturalKey = `invitation-natural:${state.user.id}:${mesa.id}:in_app:${invited.id}`;
  const hash = mockPayloadHash(payload, MOCK_PAYLOAD_KEYS.invitation);
  const previous = readMockIdempotency(ledgerKey);
  if (previous) {
    if (previous.hash !== hash) return fail(409, 'idempotency_conflict');
    return delay({ ...invitationReplay(previous), idempotent: true });
  }
  // Igual que invitationAuthority: otra key para el mismo destinatario
  // converge a la única invitación pending natural y queda ligada a ella.
  const natural = readPendingInvitationAuthority(naturalKey);
  if (natural) {
    const response = { ...(natural.response as CreateInvitationResponse), idempotent: true };
    writeMockIdempotency(ledgerKey, { hash, response: natural.response });
    return delay(response);
  }
  const response: CreateInvitationResponse = {
    invitation: {
      id: mockId('f'),
      invitation_type: 'in_app' as const,
      status: 'pending',
      expires_at: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
      created_at: new Date().toISOString(),
    },
  };
  writeMockIdempotency(naturalKey, { hash, response });
  writeMockIdempotency(ledgerKey, { hash, response });
  return delay(response);
}

export async function mockCreateInvitation(
  code: string,
  idempotencyKey: string,
): Promise<CreateInvitationResponse> {
  if (!validIdempotencyKey(idempotencyKey)) {
    return fail(400, 'validation_error');
  }
  const mesa = findMesa(code);
  if (!mesa) return fail(404, 'mesa_not_found');
  if (!mesaPayable(mesa)) return fail(409, 'mesa_not_invitable', { status: mesa.status });
  const base = `${window.location.origin}${window.location.pathname}`;
  const payload = { type: 'link' };
  const ledgerKey = `invitation:${state.user.id}:${mesa.id}:${idempotencyKey}`;
  const naturalKey = `invitation-natural:${state.user.id}:${mesa.id}:link`;
  const hash = mockPayloadHash(payload, MOCK_PAYLOAD_KEYS.invitation);
  const previous = readMockIdempotency(ledgerKey);
  if (previous) {
    if (previous.hash !== hash) return fail(409, 'idempotency_conflict');
    return delay({ ...invitationReplay(previous), idempotent: true });
  }
  const natural = readPendingInvitationAuthority(naturalKey);
  if (natural) {
    const response = { ...(natural.response as CreateInvitationResponse), idempotent: true };
    writeMockIdempotency(ledgerKey, { hash, response: natural.response });
    return delay(response);
  }
  const token = `mock-guest-${Date.now().toString(36)}`;
  const response: CreateInvitationResponse = {
    invitation: {
      id: mockId('f'),
      invitation_type: 'link',
      status: 'pending',
      expires_at: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
      created_at: new Date().toISOString(),
    },
    // El mismo UUID canónico reconstruye el mismo link en cada replay.
    link: `${base}#/mesa/${code}?t=${token}`,
  };
  // El token nombra SU mesa, como en el backend. Sin esto `accept-link` tendría
  // que aceptar cualquier string y el mock enseñaría que todo link sirve.
  state.linkTokens[token] = code;
  writeMockIdempotency(naturalKey, { hash, response });
  writeMockIdempotency(ledgerKey, { hash, response });
  return delay(response);
}

// ─── Topup (A-3: tres vías) ────────────────────────────────

export async function mockTopupOxxo(amountCents: number, idempotencyKey: string): Promise<unknown> {
  if (!validPositiveCents(amountCents) || amountCents < 5000 || amountCents > 1_000_000) return fail(400, 'validation_error');
  const req = { amount_cents: amountCents };
  // App Backend comparte UNIQUE(user_id,idempotency_key) entre ambos rieles.
  const idemKey = `topup:${idempotencyKey}`;
  const idemHash = mockPayloadHash(req, MOCK_PAYLOAD_KEYS.topup_oxxo);
  const previous = readMockIdempotency(idemKey);
  if (previous) {
    if (previous.hash !== idemHash) return fail(409, 'idempotency_conflict');
    return delay(previous.response);
  }
  const ref = `93${String(Math.floor(Math.random() * 1e10)).padStart(10, '0')}`;
  const id = mockId('f');
  const voucherExpires = new Date(Date.now() + 48 * 60 * 60_000).toISOString();
  const voucherReference = ref.replace(/(\d{4})(?=\d)/g, '$1 ');
  const fresh = {
    topup: {
      id,
      status: 'processing',
      amount_cents: amountCents,
      amount_display: centsToDisplay(amountCents),
      voucher_reference: voucherReference,
      stripe_voucher_url: null,
      voucher_expires_at: voucherExpires,
    },
  };
  writeMockIdempotency(idemKey, {
    hash: idemHash,
    response: {
      idempotent: true,
      topup: {
        ...fresh.topup,
        method: 'oxxo',
      },
    },
  });
  return delay(fresh);
}

export async function mockTopupCard(
  amountCents: number,
  paymentMethodId: string,
  idempotencyKey: string,
): Promise<unknown> {
  if (!validPositiveCents(amountCents) || amountCents < 5000 || amountCents > 1_000_000) return fail(400, 'validation_error');
  const req = { amount_cents: amountCents, payment_method_id: paymentMethodId };
  // Mismo namespace que OXXO: cambiar de riel con la misma key es conflicto.
  const idemKey = `topup:${idempotencyKey}`;
  const idemHash = mockPayloadHash(req, MOCK_PAYLOAD_KEYS.topup_card);
  const previous = readMockIdempotency(idemKey);
  if (previous) {
    if (previous.hash !== idemHash) return fail(409, 'idempotency_conflict');
    return delay(previous.response);
  }
  if (!state.paymentMethods.some((pm) => pm.id === paymentMethodId)) {
    return fail(404, 'payment_method_not_found');
  }
  state.balance_cents += amountCents;
  pushWalletTx('topup_card', amountCents, 'Carga de saldo vía CARD');
  const id = mockId('f');
  const fresh = {
    topup: {
      id,
      status: 'succeeded',
      amount_cents: amountCents,
      amount_display: centsToDisplay(amountCents),
    },
    requires_action: false,
  };
  writeMockIdempotency(idemKey, {
    hash: idemHash,
    response: {
      idempotent: true,
      topup: {
        ...fresh.topup,
        method: 'card',
      },
    },
  });
  return delay(fresh);
}

/**
 * OLA 5C (b): el riel saldo está apagado y esta lectura queda DURMIENTE.
 *
 * Además se elimina un defecto propio, independiente del wallet: la versión
 * anterior **acuñaba y persistía** una CLABE dentro de un `GET`. Una lectura que
 * escribe es un defecto por sí mismo, y no vuelve así aunque el riel se
 * reactive dentro de dos años.
 *
 * Falla cerrada en vez de fabricar: si algo llegara acá con el riel apagado, es
 * un camino que no debería existir, y devolver una CLABE inventada sería
 * enseñar un riel inexistente a quien usa el mock para entender el producto.
 */
export async function mockGetClabe(): Promise<ClabeResponse> {
  return fail(404, 'wallet_rail_disabled');
}

// ─── Transfers ─────────────────────────────────────────────

export async function mockCreateTransfer(
  req: CreateTransferRequest,
): Promise<CreateTransferResponse> {
  if (!validPositiveCents(req.amount_cents)) return fail(400, 'validation_error');
  const idemKey = `transfer:${req.idempotency_key}`;
  const idemHash = mockPayloadHash(req, MOCK_PAYLOAD_KEYS.transfer);
  const previous = readMockIdempotency(idemKey);
  if (previous) {
    if (previous.hash !== idemHash) return fail(409, 'idempotency_conflict');
    return delay(previous.response as CreateTransferResponse);
  }
  // C3/C4: `email` ya no viaja en el shape de amigo. El destinatario por correo
  // sigue siendo válido en el contrato de transferencias, pero el mock no puede
  // resolverlo desde su lista: se busca por payme_id o id.
  const to = state.friends.find(
    (f) => f.payme_id === req.to_payme_id || f.id === req.to_user_id,
  );
  if (!to) return fail(404, 'recipient_not_found');
  const available = availableBalance();
  if (available < req.amount_cents) {
    return fail(402, 'insufficient_funds', { available, required: req.amount_cents });
  }
  state.balance_cents -= req.amount_cents;
  pushWalletTx('transfer_out', -req.amount_cents, req.concept ?? `Transferencia a ${to.first_name}`);
  const now = new Date().toISOString();
  state.transfers.unshift({
    id: mockId('f'),
    amount_cents: req.amount_cents,
    amount_display: centsToDisplay(req.amount_cents),
    concept: req.concept ?? null,
    status: 'completed',
    completed_at: now,
    created_at: now,
    direction: 'sent',
    counterparty_payme_id: to.payme_id,
    counterparty_name: to.full_name,
  });
  const fresh: CreateTransferResponse = {
    transfer: {
      id: state.transfers[0].id,
      amount_cents: req.amount_cents,
      concept: req.concept ?? null,
      completed_at: now,
      amount_display: centsToDisplay(req.amount_cents),
      to: { payme_id: to.payme_id, full_name: to.full_name },
    },
  };
  // Replay exacto del espejo: recipient se acredita por UUID estable.
  const replay: CreateTransferResponse = {
    idempotent: true,
    transfer: {
      id: state.transfers[0].id,
      amount_cents: req.amount_cents,
      concept: req.concept ?? null,
      completed_at: now,
      amount_display: centsToDisplay(req.amount_cents),
      status: 'completed',
      to_user_id: to.id,
    },
  };
  writeMockIdempotency(idemKey, { hash: idemHash, response: replay });
  return delay(fresh);
}

export async function mockListTransfers(): Promise<TransfersResponse> {
  return delay({ transfers: [...state.transfers] });
}

// ─── Payment methods ───────────────────────────────────────

export async function mockPaymentMethods(): Promise<PaymentMethodsResponse> {
  return delay({ payment_methods: [...state.paymentMethods] });
}

export async function mockSetDefaultPaymentMethod(id: string): Promise<void> {
  if (!state.paymentMethods.some((pm) => pm.id === id)) return fail(404, 'payment_method_not_found');
  state.paymentMethods = state.paymentMethods.map((pm) => ({ ...pm, is_default: pm.id === id }));
  return delay(undefined);
}

export async function mockRemovePaymentMethod(id: string): Promise<void> {
  if (!state.paymentMethods.some((pm) => pm.id === id)) return fail(404, 'payment_method_not_found');
  state.paymentMethods = state.paymentMethods.filter((pm) => pm.id !== id);
  return delay(undefined);
}

export async function mockCreateSetupIntent(
  idempotencyKey: string,
): Promise<CreateSetupIntentResponse> {
  if (!validIdempotencyKey(idempotencyKey)) {
    return fail(400, 'validation_error');
  }
  const ledgerKey = `setup-intent:${state.user.id}:${idempotencyKey}`;
  const previous = readMockIdempotency(ledgerKey);
  if (previous) return delay(previous.response as CreateSetupIntentResponse);
  const setupIntentId = `seti_mock_${mockId('f')}`;
  const response: CreateSetupIntentResponse = {
    setup_intent_id: setupIntentId,
    client_secret: `${setupIntentId}_secret_mock`,
  };
  writeMockIdempotency(ledgerKey, { hash: '{}', response });
  return delay(response);
}

/**
 * D4: en el mock no hay Stripe, así que "guardar una tarjeta" fabrica una
 * verosímil con la forma del contrato v2.16 (id uuid + pm_…). La usan el alta
 * de Cuenta (attach) y el save_payment_method de garantía/pago. Idempotente
 * por pm_ (el backend real también deduplica el attach), pero un dupe con
 * set_as_default SÍ actualiza la principal.
 */
export function saveMockCard(stripePaymentMethodId: string, setAsDefault?: boolean): PaymentMethod {
  const existing = state.paymentMethods.find(
    (pm) => pm.stripe_payment_method_id === stripePaymentMethodId,
  );
  if (existing) {
    if (setAsDefault) {
      state.paymentMethods = state.paymentMethods.map((pm) => ({
        ...pm,
        is_default: pm.stripe_payment_method_id === stripePaymentMethodId,
      }));
    }
    return state.paymentMethods.find((pm) => pm.id === existing.id)!;
  }
  if (setAsDefault) {
    state.paymentMethods = state.paymentMethods.map((pm) => ({ ...pm, is_default: false }));
  }
  const banks = ['BBVA', 'Banorte', 'HSBC', 'Citibanamex'];
  const bank = banks[state.paymentMethods.length % banks.length];
  const lastFour = String(Math.floor(1000 + Math.random() * 9000));
  const created: PaymentMethod = {
    id: mockId('b'),
    stripe_payment_method_id: stripePaymentMethodId,
    brand: 'visa',
    bank_name: bank,
    type: 'debit',
    last_four: lastFour,
    exp_month: 11,
    exp_year: 2030,
    is_default: !!setAsDefault || state.paymentMethods.length === 0,
    display: `${bank} · Débito · •••• ${lastFour}`,
  };
  state.paymentMethods.push(created);
  return created;
}

export async function mockAttachPaymentMethod(
  stripePaymentMethodId: string,
  setAsDefault?: boolean,
): Promise<AttachPaymentMethodResponse> {
  const existed = state.paymentMethods.some(
    (pm) => pm.stripe_payment_method_id === stripePaymentMethodId,
  );
  const paymentMethod = saveMockCard(stripePaymentMethodId, setAsDefault);
  return delay({ payment_method: paymentMethod, ...(existed && { idempotent: true }) });
}

// ─── Notifications / invitaciones in-app ───────────────────

export async function mockNotifications(): Promise<NotificationsResponse> {
  const unread = state.notifications.filter((n) => !n.read_at).length;
  return delay({ notifications: [...state.notifications], unread_count: unread, limit: 20, offset: 0 });
}

export async function mockUnreadCount(): Promise<{ unread_count: number }> {
  return delay({ unread_count: state.notifications.filter((n) => !n.read_at).length });
}

export async function mockMarkAllNotificationsRead(): Promise<void> {
  const now = new Date().toISOString();
  state.notifications = state.notifications.map((n) => ({ ...n, read_at: n.read_at ?? now }));
  return delay(undefined);
}

/**
 * Espejo de `utils/stateMachine.js · mesaViva()` (v2.45.0): UNA mesa está
 * viva cuando todavía se puede estar en ella. `fully_paid` está viva A
 * PROPÓSITO (decisión B ratificada 2026-08-06: pagada entera pero no cerrada
 * admite gente). Es EL MISMO predicado para las tres puertas — las dos de
 * entrar y el marcador del listado —, igual que en el emisor: una segunda
 * expresión de la regla se desincroniza sola.
 *
 * ⚠️ NO confundir con el filtro de `/mesas/open` (open|partially_paid): son
 * dos conjuntos distintos por contrato — una fully_paid admite gente pero no
 * se lista como "abierta".
 */
function mesaViva(status: MockMesa['status']): boolean {
  return status === 'open' || status === 'partially_paid' || status === 'fully_paid';
}

export async function mockPendingInvitations(): Promise<PendingInvitationsResponse> {
  // Espejo del WHERE del emisor (`routes/invitations.js`): pendiente Y NO
  // VENCIDA. Y desde v2.45.0 el listado MARCA, no filtra: la invitación de
  // mesa muerta sigue viniendo —desaparecerla parecería un bug— con
  // `mesa_joinable: false` computado en vivo con el MISMO `mesaViva()` de las
  // puertas, y el `mesa_status` actual para el copy.
  const ahora = new Date().toISOString();
  state.mesas.forEach(settleIfExpired);
  return delay({
    invitations: state.pendingInvitations
      .filter((i) => i.expires_at > ahora)
      .map((i) => {
        const mesa = findMesa(i.mesa_code);
        const status = mesa ? mesa.status : i.mesa_status;
        return { ...i, mesa_status: status, mesa_joinable: mesaViva(status) };
      }),
  });
}

/**
 * `POST /invitations/accept-link` — CIERRE DEL PAGO SIN CUENTA (v2.32.0).
 *
 * Replica las propiedades del emisor que importan, no su implementación:
 *
 *  - **Ciego a propósito.** Token inexistente, de otra mesa que ya no está, o
 *    basura: todos el MISMO 403 `invitation_link_not_valid`. El emisor no
 *    distingue inválido de vencido de cancelado de supersedido porque hacerlo
 *    le diría a un desconocido si una mesa existe. Un mock que devolviera
 *    404 para "no existe" y 403 para "vencido" **enseñaría el oráculo que el
 *    contrato eliminó** — que es la lección 18 de este ciclo, ya pagada.
 *  - **Idempotente.** Canjear dos veces deja una sola inscripción.
 *  - **No consume el link.** Es MULTIUSO: canjearlo no lo invalida para el
 *    resto de la mesa.
 *  - **Requiere sesión.** Sin ella el adaptador real da 401 y acá también.
 */
export async function mockAcceptInvitationLink(
  token: string,
): Promise<AcceptInvitationLinkResponse> {
  if (typeof token !== 'string' || token.length < 8 || token.length > 200) {
    return fail(400, 'invitation_token_required');
  }
  if (!loadSession()) return fail(401, 'auth_required');
  const code = state.linkTokens[token];
  const mesa = code ? findMesa(code) : null;
  // Un solo 403 para los cuatro motivos. No agregar ramas que los separen.
  if (!code || !mesa) return fail(403, 'invitation_link_not_valid');
  // Gate de admisión (v2.45.0 · decisión C): el MISMO `mesaViva()` que la
  // puerta in-app, DESPUÉS del 403 opaco — el 410 revela el estado de la mesa
  // sólo a quien ya probó tener un token válido.
  settleIfExpired(mesa);
  if (!mesaViva(mesa.status)) {
    return fail(410, 'mesa_not_joinable', { mesa_status: mesa.status });
  }
  // La inscripción es por usuario y el link NO se marca consumido.
  if (!state.joinedMesaCodes.includes(code)) state.joinedMesaCodes.push(code);
  return delay({ joined: true as const, mesa_code: code });
}

export async function mockAcceptInvitation(id: string): Promise<{ accepted: boolean }> {
  const inv = state.pendingInvitations.find((i) => i.id === id);
  if (!inv) return fail(404, 'invitation_not_found');
  // El emisor valida el vencimiento AL ACEPTAR y contesta 410 marcándola
  // 'expired' (`routes/invitations.js:69-74`). El mock aceptaba incondicional:
  // "Te sumaste ✓" a una invitación muerta.
  if (inv.expires_at <= new Date().toISOString()) {
    state.pendingInvitations = state.pendingInvitations.filter((i) => i.id !== id);
    return fail(410, 'invitation_expired');
  }
  // Gate de admisión (v2.45.0): la invitación está viva; ahora la MESA tiene
  // que estarlo. Mismo orden que el emisor (vencimiento primero, mesa
  // después) y mismo detalle: la invitación QUEDA pendiente — la mesa no
  // revive, y consumirla acá sería inventar semántica.
  {
    const mesaInv = findMesa(inv.mesa_code);
    if (mesaInv) settleIfExpired(mesaInv);
    const st = mesaInv ? mesaInv.status : inv.mesa_status;
    if (!mesaViva(st)) {
      return fail(410, 'mesa_not_joinable', { mesa_status: st });
    }
  }
  state.pendingInvitations = state.pendingInvitations.filter((i) => i.id !== id);
  // El emisor INSERTA en mesa_participants al aceptar (routes/invitations.js:102)
  // y `joinedMesaCodes` es su espejo acá. Sin esta línea, aceptar era un no-op
  // de participación: la mesa aceptada JAMÁS aparecía en /mesas/open — el
  // síntoma de G-28, reproducido por el mock en el riel de invitaciones in-app.
  if (!state.joinedMesaCodes.includes(inv.mesa_code)) {
    state.joinedMesaCodes.push(inv.mesa_code);
  }
  state.notifications = state.notifications.map((n) =>
    n.type === 'invitation_received' ? { ...n, read_at: n.read_at ?? new Date().toISOString() } : n,
  );
  return delay({ accepted: true });
}

// ─── Stats (GET /account/stats) ────────────────────────────

export async function mockStats(): Promise<StatsResponse> {
  const spent = 216500;
  const visits = 6;
  const avg = Math.floor(spent / visits);
  return delay({
    month: {
      spent_cents: spent,
      spent_display: centsToDisplay(spent),
      visits,
      avg_per_visit_cents: avg,
      avg_per_visit_display: centsToDisplay(avg),
    },
    top_restaurants: [
      { name: 'La Parolaccia', visits: 3 },
      { name: 'Hanzo Sushi', visits: 2 },
      { name: 'Café Nube', visits: 1 },
    ],
    top_dish: { name: 'Tagliatelle Bolognese', times: 3 },
    favorite_category: 'italian',
  });
}

// ─── Friends / Groups ──────────────────────────────────────

export async function mockFriends(): Promise<FriendsResponse> {
  // C3: el contrato de amigos ya no lleva `email`. Se proyecta explícitamente
  // para que el mock no pueda filtrarlo por descuido.
  return delay({
    friends: state.friends.map(({ email: _email, ...persona }) => persona),
  });
}

/**
 * C1/C2 · una solicitud es una INTENCIÓN, no un vínculo.
 *
 * Responde 202 `{ requested: true }` SIEMPRE: exista o no la persona, sea o no
 * ya tu amigo, te haya bloqueado o no. El mock replica esa ceguera a propósito
 * — si acá devolviera 404 cuando no encuentra a nadie, la demo enseñaría un
 * comportamiento que el backend eliminó justamente por ser un oráculo.
 */
export async function mockAddFriend(query: { email?: string; payme_id?: string }): Promise<FriendRequestCreatedResponse> {
  // El backend BUSCA primero, y si no encuentra a nadie activo no inserta nada
  // (`routes/friends.js:136-151`). El mock hacía lo contrario: inventaba una
  // persona para cualquier texto, así que la solicitud saliente aparecía
  // siempre y la demo no podía mostrar —ni delatar— el comportamiento real.
  const email = query.email?.trim().toLowerCase();
  const destino = [...state.friends, ...state.directory].find(
    (p) => (email !== undefined && p.email.toLowerCase() === email)
      || (query.payme_id !== undefined && p.payme_id === query.payme_id),
  );

  if (destino) {
    const bloqueado = state.blockedUserIds.includes(destino.id);
    const yaEsAmigo = state.friends.some((f) => f.id === destino.id);
    const yaPedida = state.friendRequests.some(
      (r) => r.direction === 'outgoing' && r.person.id === destino.id,
    );
    // Si el otro YA me pidió, pedirle yo equivale a aceptar: el contrato evita
    // así dos pendientes cruzadas que nadie resuelve.
    const reciproca = state.friendRequests.findIndex(
      (r) => r.direction === 'incoming' && r.person.id === destino.id,
    );
    if (!bloqueado && !yaEsAmigo && !yaPedida) {
      if (reciproca !== -1) {
        const [req] = state.friendRequests.splice(reciproca, 1);
        state.friends.push({ ...req.person, added_at: new Date().toISOString() });
      } else {
        state.friendRequests.push({
          id: mockId('f'),
          direction: 'outgoing',
          person: destino,
          requested_at: new Date().toISOString(),
        });
      }
    }
  }
  // Misma respuesta en TODOS los casos: no existe, existe, ya es amigo, ya hay
  // pendiente, o me bloqueó. Es la ceguera que el endpoint tiene a propósito.
  return delay({ requested: true as const });
}

export async function mockFriendRequests(direction: FriendRequestDirection): Promise<FriendRequestsResponse> {
  return delay({
    direction,
    requests: state.friendRequests
      .filter((r) => r.direction === direction)
      .map((r) => ({
        id: r.id,
        // La persona va ANIDADA: `id` es el de la solicitud, no el suyo.
        user: {
          id: r.person.id,
          payme_id: r.person.payme_id,
          first_name: r.person.first_name,
          last_name: r.person.last_name,
          full_name: r.person.full_name,
        },
        requested_at: r.requested_at,
      })),
  });
}

/** Aceptar: sólo una ENTRANTE. Una saliente no es mía para aceptar. */
export async function mockAcceptFriendRequest(requestId: string): Promise<void> {
  const i = state.friendRequests.findIndex((r) => r.id === requestId && r.direction === 'incoming');
  if (i === -1) return fail(404, 'request_not_found');
  const [req] = state.friendRequests.splice(i, 1);
  state.friends.push({ ...req.person, added_at: new Date().toISOString() });
  return delay(undefined);
}

export async function mockRejectFriendRequest(requestId: string): Promise<void> {
  const i = state.friendRequests.findIndex((r) => r.id === requestId && r.direction === 'incoming');
  if (i === -1) return fail(404, 'request_not_found');
  state.friendRequests.splice(i, 1);
  return delay(undefined);
}

/** Cancelar: sólo una PROPIA todavía pendiente. */
export async function mockCancelFriendRequest(requestId: string): Promise<void> {
  const i = state.friendRequests.findIndex((r) => r.id === requestId && r.direction === 'outgoing');
  if (i === -1) return fail(404, 'request_not_found');
  state.friendRequests.splice(i, 1);
  return delay(undefined);
}

/**
 * Bloquear rompe la amistad en ambos sentidos y borra cualquier solicitud viva
 * con esa persona, igual que el backend.
 */
export async function mockBlockUser(userId: string): Promise<void> {
  if (userId === state.user.id) return fail(400, 'cannot_block_self');
  const conocido =
    state.friends.some((f) => f.id === userId) ||
    state.friendRequests.some((r) => r.person.id === userId);
  if (!conocido) return fail(404, 'user_not_found');
  state.friends = state.friends.filter((f) => f.id !== userId);
  state.friendRequests = state.friendRequests.filter((r) => r.person.id !== userId);
  if (!state.blockedUserIds.includes(userId)) state.blockedUserIds.push(userId);
  return delay(undefined);
}

export async function mockUnblockUser(userId: string): Promise<void> {
  if (!state.blockedUserIds.includes(userId)) return fail(404, 'block_not_found');
  state.blockedUserIds = state.blockedUserIds.filter((id) => id !== userId);
  return delay(undefined);
}

export async function mockRemoveFriend(friendId: string): Promise<void> {
  state.friends = state.friends.filter((f) => f.id !== friendId);
  return delay(undefined);
}

export async function mockGroups(): Promise<GroupsResponse> {
  return delay({
    groups: state.groups.map(({ memberIds, ...g }) => ({ ...g, member_count: memberIds.length })),
  });
}

export async function mockGroupDetail(id: string): Promise<GroupDetailResponse> {
  const group = state.groups.find((g) => g.id === id);
  if (!group) return fail(404, 'group_not_found');
  const members = state.friends.filter((f) => group.memberIds.includes(f.id));
  return delay({
    group: { id: group.id, name: group.name, icon: group.icon },
    members: members.map((m) => ({
      id: m.id,
      payme_id: m.payme_id,
      first_name: m.first_name,
      last_name: m.last_name,
      // Grupos SÍ conserva el correo (contract-mirror/routes/groups.js).
      email: m.email,
    })),
  });
}

export async function mockCreateGroup(name: string, icon?: string): Promise<void> {
  state.groups.push({
    id: mockId('a'),
    name,
    icon: icon ?? '👥',
    created_at: new Date().toISOString(),
    member_count: 0,
    memberIds: [],
  });
  return delay(undefined);
}

export async function mockAddGroupMember(groupId: string, friendId: string): Promise<void> {
  const group = state.groups.find((g) => g.id === groupId);
  if (!group) return fail(404, 'group_not_found');
  if (!group.memberIds.includes(friendId)) group.memberIds.push(friendId);
  return delay(undefined);
}

export async function mockRemoveGroupMember(groupId: string, friendId: string): Promise<void> {
  const group = state.groups.find((g) => g.id === groupId);
  if (!group) return fail(404, 'group_not_found');
  group.memberIds = group.memberIds.filter((id) => id !== friendId);
  return delay(undefined);
}

export async function mockDeleteGroup(groupId: string): Promise<void> {
  if (!state.groups.some((g) => g.id === groupId)) return fail(404, 'group_not_found');
  state.groups = state.groups.filter((g) => g.id !== groupId);
  return delay(undefined);
}
