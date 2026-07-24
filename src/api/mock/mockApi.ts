import { centsToDisplay, fractionAmount, splitEqual, tipFromBps } from '../../utils/money';
import { saveSession, type StoredSession } from '../storage';
import type {
  MeResponse,
  BalanceResponse,
  ClabeResponse,
  CreateInvitationResponse,
  CreateMesaRequest,
  CreateMesaResponse,
  CreateTransferRequest,
  CreateTransferResponse,
  Friend,
  FriendsResponse,
  GroupDetailResponse,
  GroupsResponse,
  LockItemsResponse,
  MesaDetailResponse,
  NotificationsResponse,
  OcrResponse,
  OpenMesasResponse,
  PayMesaRequest,
  PayMesaResponse,
  PaymentMethodsResponse,
  PendingInvitationsResponse,
  StatsResponse,
  TopupCardResponse,
  TopupOxxoResponse,
  TransfersResponse,
  WalletTransactionsResponse,
  HistoryResponse,
  FractionRequest,
} from '../types';
import { MOCK_RESTAURANTS, MOCK_USER } from './seedData';
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
  type MockIdentity,
  type MockMesa,
} from './store';

/**
 * Adaptador mock (VITE_MOCK=1): replica shapes Y reglas del contrato
 * (garantía A-1, saldo retenido, locks, slots, expiración A-2, errores 4xx
 * como MockApiError con el mismo `error` que devolvería el backend).
 */

const LATENCY_MS = 350;

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
  const session: StoredSession = {
    access_token: 'mock-access-token',
    refresh_token: 'mock-refresh-token',
    user,
  };
  saveSession(session);
  return delay(session);
}

/** GET /account/me (G-02, v2.20): el user vigente de la demo. */
export async function mockGetMe(): Promise<MeResponse> {
  return delay({ user: state.user });
}

export async function mockRegister(data: {
  email: string;
  first_name: string;
  last_name: string;
}): Promise<StoredSession> {
  state.user = { ...MOCK_USER, ...data };
  const session: StoredSession = {
    access_token: 'mock-access-token',
    refresh_token: 'mock-refresh-token',
    user: state.user,
  };
  saveSession(session);
  return delay(session);
}

export async function mockLogout(): Promise<void> {
  return delay(undefined);
}

// ─── Cuenta ────────────────────────────────────────────────

export async function mockBalance(): Promise<BalanceResponse> {
  return delay({
    balance_cents: state.balance_cents,
    balance_display: centsToDisplay(state.balance_cents),
    clabe: state.clabe,
    currency: 'mxn',
  });
}

export async function mockWalletTransactions(): Promise<WalletTransactionsResponse> {
  return delay({ transactions: [...state.walletTx], limit: 30, offset: 0 });
}

/** GET /account/history: pagos propios en mesas, más reciente primero. */
export async function mockHistory(): Promise<HistoryResponse> {
  const sorted = [...state.history].sort((a, b) => b.date.localeCompare(a.date));
  return delay({ history: sorted, limit: 20, offset: 0 });
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
      .filter((m) => m.openedByUser && (m.status === 'open' || m.status === 'partially_paid'))
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
  const sum = req.items.reduce((s, i) => s + i.price_cents * i.quantity, 0);
  if (sum !== req.total_cents) {
    return fail(400, 'total_mismatch', { expected: sum, received: req.total_cents });
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
    return delay({
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
    });
  }

  // card: el mock siempre pide 3DS para que la demo muestre requires_action.
  // D4: el "guardar tarjeta" queda PENDIENTE hasta que el 3DS confirme — si
  // guardáramos acá, cada reintento cancelado acumularía tarjetas fantasma
  // (el backend real también guarda recién en el webhook del hold).
  pending3ds = mesa;
  pending3dsSave =
    req.save_payment_method && req.stripe_payment_method_id ? req.stripe_payment_method_id : null;
  return delay({
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
    guarantee: { method: 'card', status: 'requires_action', client_secret: 'mock_3ds_secret' },
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
        itemsAmount += amount;
      }
    } catch (e) {
      if (e instanceof MockApiError) return fail(e.status, e.message, e.extra);
      throw e;
    }
  } else {
    const slot = mesa.slots?.find((s) => s.status === 'available');
    if (!slot) return fail(409, 'no_slots_available');
    slot.status = 'paid';
    slot.claimedBy = identity;
    itemsAmount = slot.amount_cents;
  }

  const gross = itemsAmount + tipCents;

  if (req.payment_type === 'wallet') {
    const available = availableBalance();
    if (available < gross) {
      // liberar el slot recién tomado si no alcanza
      if (mesa.division_mode === 'igual') {
        const slot = mesa.slots?.find((s) => s.claimedBy === identity && s.status === 'paid');
        if (slot) {
          slot.status = 'available';
          slot.claimedBy = null;
        }
      }
      return fail(402, 'insufficient_funds', { available, required: gross });
    }
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
      restaurant: mesa.restaurant.name,
      category: mesa.restaurant.category,
    });
  }

  // D4: guardar la tarjeta nueva si lo pidieron (solo usuarios con cuenta).
  if (req.save_payment_method && req.stripe_payment_method_id && identity !== 'guest') {
    saveMockCard(req.stripe_payment_method_id);
  }

  return delay({
    attempt: {
      id: mockId('f'),
      gross_amount_cents: gross,
      tip_cents: tipCents,
      ...(pricedItems.length > 0 && { items: pricedItems }),
      gross_display: centsToDisplay(gross),
      status: req.payment_type === 'wallet' ? 'processed' : 'succeeded',
      payment_type: req.payment_type,
      requires_action: false,
    },
  });
}

export async function mockCreateInvitation(code: string): Promise<CreateInvitationResponse> {
  const mesa = findMesa(code);
  if (!mesa) return fail(404, 'mesa_not_found');
  if (!mesaPayable(mesa)) return fail(409, 'mesa_not_invitable', { status: mesa.status });
  const base = `${window.location.origin}${window.location.pathname}`;
  return delay({
    invitation: {
      id: mockId('f'),
      invitation_type: 'link',
      status: 'pending',
      expires_at: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
      created_at: new Date().toISOString(),
    },
    // rawToken se devuelve UNA sola vez, como el backend (P1 #8).
    link: `${base}#/mesa/${code}?t=mock-guest-${Date.now().toString(36)}`,
  });
}

// ─── Topup (A-3: tres vías) ────────────────────────────────

export async function mockTopupOxxo(amountCents: number): Promise<TopupOxxoResponse> {
  if (amountCents < 5000 || amountCents > 1_000_000) return fail(400, 'validation_error');
  const ref = `93${String(Math.floor(Math.random() * 1e10)).padStart(10, '0')}`;
  return delay({
    topup: {
      id: mockId('f'),
      status: 'processing',
      amount_cents: amountCents,
      amount_display: centsToDisplay(amountCents),
      voucher_reference: ref.replace(/(\d{4})(?=\d)/g, '$1 '),
      stripe_voucher_url: null,
      voucher_expires_at: new Date(Date.now() + 48 * 60 * 60_000).toISOString(),
    },
  });
}

export async function mockTopupCard(
  amountCents: number,
  paymentMethodId: string,
): Promise<TopupCardResponse> {
  if (amountCents < 5000 || amountCents > 1_000_000) return fail(400, 'validation_error');
  if (!state.paymentMethods.some((pm) => pm.id === paymentMethodId)) {
    return fail(404, 'payment_method_not_found');
  }
  state.balance_cents += amountCents;
  pushWalletTx('topup_card', amountCents, 'Carga de saldo vía CARD');
  return delay({
    topup: {
      id: mockId('f'),
      status: 'succeeded',
      amount_cents: amountCents,
      amount_display: centsToDisplay(amountCents),
    },
    requires_action: false,
  });
}

export async function mockGetClabe(): Promise<ClabeResponse> {
  if (!state.clabe) {
    state.clabe = `6461800000${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  }
  return delay({
    clabe: state.clabe,
    banco: 'STP',
    beneficiario: 'PayMe',
    instrucciones: 'Transferí por SPEI a esta CLABE desde tu banco; el saldo se acredita solo.',
  });
}

// ─── Transfers ─────────────────────────────────────────────

export async function mockCreateTransfer(
  req: CreateTransferRequest,
): Promise<CreateTransferResponse> {
  const to = state.friends.find(
    (f) => f.payme_id === req.to_payme_id || f.email === req.to_email || f.id === req.to_user_id,
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
  return delay({
    transfer: {
      id: state.transfers[0].id,
      amount_cents: req.amount_cents,
      concept: req.concept ?? null,
      completed_at: now,
      amount_display: centsToDisplay(req.amount_cents),
      to: { payme_id: to.payme_id, full_name: to.full_name },
    },
  });
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

export async function mockCreateSetupIntent(): Promise<{ client_secret: string }> {
  return delay({ client_secret: 'seti_mock_secret' });
}

/**
 * D4: en el mock no hay Stripe, así que "guardar una tarjeta" fabrica una
 * verosímil con la forma del contrato v2.16 (id uuid + pm_…). La usan el alta
 * de Cuenta (attach) y el save_payment_method de garantía/pago. Idempotente
 * por pm_ (el backend real también deduplica el attach), pero un dupe con
 * set_as_default SÍ actualiza la principal.
 */
export function saveMockCard(stripePaymentMethodId: string, setAsDefault?: boolean): void {
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
    return;
  }
  if (setAsDefault) {
    state.paymentMethods = state.paymentMethods.map((pm) => ({ ...pm, is_default: false }));
  }
  const banks = ['BBVA', 'Banorte', 'HSBC', 'Citibanamex'];
  const bank = banks[state.paymentMethods.length % banks.length];
  const lastFour = String(Math.floor(1000 + Math.random() * 9000));
  state.paymentMethods.push({
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
  });
}

export async function mockAttachPaymentMethod(
  stripePaymentMethodId: string,
  setAsDefault?: boolean,
): Promise<void> {
  saveMockCard(stripePaymentMethodId, setAsDefault);
  return delay(undefined);
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

export async function mockPendingInvitations(): Promise<PendingInvitationsResponse> {
  return delay({ invitations: [...state.pendingInvitations] });
}

export async function mockAcceptInvitation(id: string): Promise<{ accepted: boolean }> {
  const inv = state.pendingInvitations.find((i) => i.id === id);
  if (!inv) return fail(404, 'invitation_not_found');
  state.pendingInvitations = state.pendingInvitations.filter((i) => i.id !== id);
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
  return delay({ friends: [...state.friends] });
}

export async function mockAddFriend(query: { email?: string; payme_id?: string }): Promise<Friend> {
  const handle = (query.email ?? query.payme_id ?? 'nuevo').split('@')[0].replace(/^payme_mx_/, '');
  const first = handle.charAt(0).toUpperCase() + handle.slice(1);
  const friend: Friend = {
    id: mockId('a'),
    payme_id: query.payme_id ?? `payme_mx_${handle.slice(0, 4).padEnd(4, 'x')}`,
    first_name: first,
    last_name: 'Demo',
    full_name: `${first} Demo`,
    email: query.email ?? `${handle}@mail.com`,
    added_at: new Date().toISOString(),
  };
  state.friends.push(friend);
  return delay(friend);
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
