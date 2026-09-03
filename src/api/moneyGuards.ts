import { centsToDisplay } from '../utils/money';
import type { CreateMesaRequest, CreateMesaResponse, CreateTransferRequest, CreateTransferResponse, DivisionSlot, PayMesaRequest, PayMesaResponse, PaymentType, TopupCardResponse, TopupOxxoResponse, TopupStatusResponse } from './types';

/** Respuestas monetarias inválidas son ambiguas: nunca habilitan otro intento. */
export class MalformedMoneyResponseError extends Error {
  constructor() { super('money_response_malformed'); this.name = 'MalformedMoneyResponseError'; }
}
/** La forma es contractual, pero no acredita que corresponda a esta solicitud. */
export class UnboundMoneyResponseError extends MalformedMoneyResponseError {
  constructor() { super(); this.message = 'money_response_unbound'; this.name = 'UnboundMoneyResponseError'; }
}

export type PayMesaExpectation =
  | {
      divisionMode: 'consumo';
      tipCents: number;
    }
  | {
      divisionMode: 'igual';
      /** Todos los montos de slot que pertenecen a esta mesa. */
      possibleItemsAmountCents: number[];
      tipCents: number;
    };
export interface TransferExpectation { recipientUserId: string; paymeId: string; }
type TopupMethod = 'oxxo' | 'card' | 'spei';
type TopupStatus = 'pending' | 'processing' | 'succeeded' | 'failed' | 'expired' | 'cancelled';
type TransferStatus = 'pending' | 'completed' | 'failed' | 'reversed';
interface TopupExpectation { id?: string; amountCents: number; method: TopupMethod; requireMethod?: boolean; }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MESA_CODE = /^[A-Z]{2}-\d{3,5}$/;
const PAYME_ID = /^payme_[a-z]{2}_[a-z0-9]{4}$/;
const DECIMAL_INTEGER = /^(?:0|[1-9]\d*)$/;
const PAYMENT_TYPES = new Set<PaymentType>(['card', 'apple_pay', 'google_pay', 'wallet']);
/**
 * 🔴 **C3 · `none` es la mesa SIN garantía, y sólo existe con el dinero apagado.**
 *
 * El dueño la admite únicamente en ese modo —con el riel vivo la rechaza con
 * `409 guarantee_required`— y responde `{method:'none', status:'none'}` con la
 * mesa ya `open`, antes de tocar Stripe.
 *
 * Se agrega acá porque este decoder la declaraba malformada, y el efecto era el
 * peor de los tres posibles: **la mesa se creaba de verdad y el front la trataba
 * como apertura fallida**, mostrando «apertura sin confirmar» sobre una mesa que
 * existía. Fallar habría sido mejor que eso.
 *
 * ⚠️ **Aceptarla no relaja NADA de lo demás**: su combinación es tan cerrada
 * como las otras dos, y las de `card`/`wallet` quedan intactas.
 */
const GUARANTEE_METHODS = new Set<'card' | 'wallet' | 'none'>(['card', 'wallet', 'none']);
const PAYMENT_STATUSES = new Set(['pending', 'requires_action', 'processing', 'authorized', 'succeeded', 'processed', 'failed', 'cancelled', 'cancelling', 'refunded']);
const TOPUP_STATUSES = new Set<TopupStatus>(['pending', 'processing', 'succeeded', 'failed', 'expired', 'cancelled']);
const TRANSFER_STATUSES = new Set<TransferStatus>(['pending', 'completed', 'failed', 'reversed']);
const STRIPE_STATUSES = new Set(['requires_payment_method', 'requires_confirmation', 'requires_action', 'processing', 'requires_capture', 'canceled', 'succeeded']);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function text(value: unknown): value is string { return typeof value === 'string' && value.length > 0; }
function uuid(value: unknown): value is string { return text(value) && UUID.test(value); }
function positiveExpectation(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) fail();
  return value;
}
/**
 * PostgreSQL BIGINT puede llegar como string. Sólo se convierte después de
 * validar la sintaxis decimal canónica y acotar con BigInt al rango seguro.
 */
export function normalizeNonNegativeCents(value: unknown): number {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) fail();
    return value;
  }
  if (typeof value !== 'string' || !DECIMAL_INTEGER.test(value)) fail();
  const parsed = BigInt(value);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) fail();
  return Number(parsed);
}
function normalizePositiveCents(value: unknown): number {
  const cents = normalizeNonNegativeCents(value);
  if (cents <= 0) fail();
  return cents;
}
function addCents(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result) || result < 0) fail();
  return result;
}
function enumValue<T extends string>(value: unknown, allowed: Set<T>): T {
  if (typeof value !== 'string' || !allowed.has(value as T)) fail();
  return value as T;
}
function optionalEnum<T extends string>(value: unknown, allowed: Set<T>): T | undefined {
  if (value === undefined) return undefined;
  return enumValue(value, allowed);
}
function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') fail();
  return value;
}
function optionalText(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (!text(value)) fail();
  return value;
}
function fail(): never { throw new MalformedMoneyResponseError(); }

/**
 * En igualdad el backend elige el slot dentro de la transacción: antes del
 * cobro cualquiera de los disponibles es posible; en un replay también lo es
 * un slot ya tomado por este actor. Los slots ajenos nunca acreditan monto.
 */
export function payableEqualSlotAmounts(slots: DivisionSlot[] | undefined): number[] {
  return (slots ?? [])
    .filter((slot) => slot.status === 'available' || slot.claimed_by_me === true)
    .map((slot) => slot.amount_cents);
}

export function createMesaResponse(value: unknown, expected: CreateMesaRequest): CreateMesaResponse {
  const root = record(value); const mesa = record(root?.mesa); const guarantee = record(root?.guarantee);
  if (!mesa || !guarantee || !uuid(mesa.id) || !text(mesa.code) || !MESA_CODE.test(mesa.code) || !text(mesa.expires_at) || !text(mesa.created_at)) fail();
  if (root?.idempotent !== undefined && typeof root.idempotent !== 'boolean') fail();
  const total = normalizePositiveCents(mesa.total_cents);
  const division = mesa.division_mode;
  const participants = mesa.expected_participants;
  const mesaStatus = mesa.status;
  if ((division !== 'consumo' && division !== 'igual') || typeof participants !== 'number' || !Number.isSafeInteger(participants) || participants < 1 || participants > 20 || (mesaStatus !== 'open' && mesaStatus !== 'pending_auth')) fail();
  const method = enumValue(guarantee.method, GUARANTEE_METHODS);
  const status = enumValue(guarantee.status, new Set(['open', 'requires_action', 'none']));
  if (total !== positiveExpectation(expected.total_cents) || division !== expected.division_mode || participants !== expected.expected_participants || method !== expected.guarantee_method) fail();
  if ((status === 'open' && mesaStatus !== 'open')
      || (status === 'requires_action' && mesaStatus !== 'pending_auth')
      // C3 · sin garantía la mesa nace ABIERTA. Sin esta coherencia, `none`
      // habría sido más laxo que sus vecinos: aceptaría cualquier estado.
      || (status === 'none' && mesaStatus !== 'open')) fail();
  const clientSecret = optionalText(guarantee.client_secret);
  if (status === 'requires_action' && !clientSecret) fail();
  const connectedAccount = optionalText(guarantee.connected_account_id);
  // Wallet nunca produce 3DS ni vive en una cuenta Connect. Aceptar ese
  // híbrido mandaría a la UI a confirmar con Stripe una garantía de saldo.
  if (method === 'wallet' && (status !== 'open' || clientSecret !== undefined || connectedAccount !== undefined)) fail();
  /**
   * C3 · `none` y `'none'` van SIEMPRE juntos, en las dos direcciones: ni una
   * garantía `none` con otro estado, ni un `card`/`wallet` con estado `none`.
   *
   * Y sin garantía **no puede venir nada de dinero**: un `client_secret` es un
   * 3DS por confirmar y un `connected_account_id` es un hold en la cuenta del
   * restaurante. Cualquiera de los dos significaría que el dueño hizo algo con
   * dinero, y este camino promete exactamente que no.
   */
  if ((method === 'none') !== (status === 'none')) fail();
  if (method === 'none' && (clientSecret !== undefined || connectedAccount !== undefined)) fail();
  // Una garantía ya abierta no conserva un secreto accionable. Si ambos
  // aparecen juntos, la respuesta es contradictoria y no acredita el hold.
  if (status === 'open' && clientSecret !== undefined) fail();
  return {
    mesa: { id: mesa.id, code: mesa.code, total_cents: total, division_mode: division, expected_participants: participants, status: mesaStatus as CreateMesaResponse['mesa']['status'], expires_at: mesa.expires_at, created_at: mesa.created_at },
    guarantee: { method, status, ...(clientSecret && { client_secret: clientSecret }), ...(connectedAccount && { connected_account_id: connectedAccount }) },
  };
}

export function payMesaResponse(value: unknown, expected: PayMesaRequest, binding: PayMesaExpectation): PayMesaResponse {
  const root = record(value); const attempt = record(root?.attempt);
  if (!attempt || !uuid(attempt.id)) fail();
  const gross = normalizePositiveCents(attempt.gross_amount_cents);
  if (attempt.tip_cents === undefined && attempt.tip_amount_cents === undefined) fail();
  const tipFromPublicAlias = attempt.tip_cents === undefined ? undefined : normalizeNonNegativeCents(attempt.tip_cents);
  const tipFromDbAlias = attempt.tip_amount_cents === undefined ? undefined : normalizeNonNegativeCents(attempt.tip_amount_cents);
  if (tipFromPublicAlias !== undefined && tipFromDbAlias !== undefined && tipFromPublicAlias !== tipFromDbAlias) fail();
  const tip = tipFromPublicAlias ?? tipFromDbAlias!;
  const status = enumValue(attempt.status, PAYMENT_STATUSES);
  if (tip !== normalizeNonNegativeCents(binding.tipCents) || gross < tip) fail();
  let normalizedItems: PayMesaResponse['attempt']['items'];
  if (binding.divisionMode === 'consumo') {
    if (expected.items && expected.item_ids) fail();
    const requestItems = expected.items ?? (expected.item_ids ?? []).map((item_id) => ({ item_id, fraction_bps: 10000 }));
    if (!Array.isArray(attempt.items) || attempt.items.length !== requestItems.length || attempt.items.length === 0) fail();
    const requested = new Map<string, number>();
    for (const item of requestItems) {
      if (!uuid(item.item_id) || !Number.isSafeInteger(item.fraction_bps) || item.fraction_bps <= 0 || item.fraction_bps > 10000 || requested.has(item.item_id)) fail();
      requested.set(item.item_id, item.fraction_bps);
    }
    const seen = new Set<string>();
    let itemsAmount = 0;
    normalizedItems = attempt.items.map((raw) => {
      const item = record(raw);
      if (!item || !uuid(item.item_id) || seen.has(item.item_id)) fail();
      const requestedBps = requested.get(item.item_id);
      if (requestedBps === undefined || !Number.isSafeInteger(item.fraction_bps) || typeof item.fraction_bps !== 'number') fail();
      // El backend puede absorber hasta 99 bps residuales al completar tercios.
      if (item.fraction_bps < requestedBps || item.fraction_bps > Math.min(10000, requestedBps + 99)) fail();
      const amount = normalizeNonNegativeCents(item.amount_cents);
      seen.add(item.item_id);
      itemsAmount = addCents(itemsAmount, amount);
      return { item_id: item.item_id, fraction_bps: item.fraction_bps, amount_cents: amount };
    }).sort((a, b) => a.item_id.localeCompare(b.item_id));
    if (seen.size !== requested.size || gross !== addCents(itemsAmount, tip)) fail();
  } else {
    if (attempt.items !== undefined) fail();
    const possible = new Set(binding.possibleItemsAmountCents.map((amount) => normalizeNonNegativeCents(amount)));
    if (possible.size === 0 || !possible.has(gross - tip)) fail();
    if (gross !== addCents(gross - tip, tip)) fail();
  }
  const paymentType = optionalEnum(attempt.payment_type, PAYMENT_TYPES);
  const isReplay = root?.idempotent === true;
  const requiresAction = optionalBoolean(attempt.requires_action);
  const clientSecret = attempt.client_secret === null ? null : optionalText(attempt.client_secret);
  const replaySecret = attempt.stripe_client_secret === null ? null : optionalText(attempt.stripe_client_secret);
  if (requiresAction === true && !clientSecret && !replaySecret) fail();
  const stripeStatus = optionalEnum(attempt.stripe_status, STRIPE_STATUSES);
  const connectedAccount = attempt.connected_account_id === null ? null : optionalText(attempt.connected_account_id);
  const descriptor = attempt.statement_descriptor === undefined || attempt.statement_descriptor === null
    ? attempt.statement_descriptor as string | null | undefined
    : optionalText(attempt.statement_descriptor);
  if (root?.idempotent !== undefined && typeof root.idempotent !== 'boolean') fail();
  // La omisión del tipo sólo es contractual en el fresh Stripe, cuya firma
  // completa acredita que no estamos aceptando un shape de wallet sin tipo.
  const hasClientSecret = Object.prototype.hasOwnProperty.call(attempt, 'client_secret');
  const hasReplaySecret = Object.prototype.hasOwnProperty.call(attempt, 'stripe_client_secret');
  if (expected.payment_type === 'wallet') {
    if (paymentType !== 'wallet') fail();
  } else if (paymentType === undefined) {
    if (isReplay || !clientSecret || stripeStatus === undefined || requiresAction === undefined) fail();
  } else if (paymentType !== expected.payment_type) fail();
  if (expected.payment_type !== 'wallet') {
    // Fresh contractual: client_secret + stripe_status + requires_action.
    // Replay contractual: payment_type y al menos el campo de secreto
    // (string o null). Un objeto mínimo con `payment_type:'card'` no alcanza
    // para distinguirlo de un shape wallet adulterado.
    if (isReplay) {
      if (!hasClientSecret && !hasReplaySecret) fail();
    } else if (!hasClientSecret || typeof clientSecret !== 'string' || stripeStatus === undefined || requiresAction === undefined) {
      fail();
    }
  }
  if (requiresAction !== undefined && requiresAction !== (status === 'requires_action')) fail();
  if (stripeStatus === 'requires_action' && status !== 'requires_action') fail();
  if (status === 'requires_action' && stripeStatus !== undefined && stripeStatus !== 'requires_action') fail();
  if (stripeStatus !== undefined) {
    const mappedStatus = stripeStatus === 'succeeded' ? 'succeeded'
      : stripeStatus === 'processing' ? 'processing'
        : stripeStatus === 'requires_action' || stripeStatus === 'requires_confirmation' ? 'requires_action'
          : stripeStatus === 'requires_payment_method' ? 'failed'
            : stripeStatus === 'requires_capture' ? 'authorized'
              : stripeStatus === 'canceled' ? 'cancelled'
                : 'pending';
    const progressedSuccess = mappedStatus === 'succeeded' && (status === 'processed' || status === 'refunded');
    if (status !== mappedStatus && !progressedSuccess) fail();
  }
  // El replay unificado del backend serializa null/false también para wallet.
  // Se toleran esos neutros pero nunca un secreto, acción o cuenta efectivos;
  // y se eliminan del DTO normalizado que consume la UI.
  if (expected.payment_type === 'wallet' && (
    requiresAction === true || typeof clientSecret === 'string' || typeof replaySecret === 'string' ||
    stripeStatus !== undefined || typeof connectedAccount === 'string' || typeof descriptor === 'string'
  )) fail();
  const exposeStripeFields = expected.payment_type !== 'wallet';
  return {
    ...(root?.idempotent === true && { idempotent: true }),
    attempt: {
      id: attempt.id, gross_amount_cents: gross, tip_cents: tip, status,
      ...(paymentType !== undefined && { payment_type: paymentType }),
      ...(exposeStripeFields && requiresAction !== undefined && { requires_action: requiresAction }),
      ...(exposeStripeFields && clientSecret && { client_secret: clientSecret }),
      ...(exposeStripeFields && replaySecret !== undefined && { stripe_client_secret: replaySecret }),
      ...(exposeStripeFields && stripeStatus !== undefined && { stripe_status: stripeStatus }),
      ...(exposeStripeFields && connectedAccount && { connected_account_id: connectedAccount }),
      ...(exposeStripeFields && descriptor !== undefined && { statement_descriptor: descriptor }),
      ...(normalizedItems && { items: normalizedItems }),
      gross_display: centsToDisplay(gross),
    },
  };
}

interface NormalizedTopup {
  id: string;
  method?: TopupMethod;
  status: TopupStatus;
  amount_cents: number;
  amount_display: string;
  voucher_reference?: string;
  stripe_voucher_url?: string | null;
  voucher_expires_at?: string;
}

function normalizeTopup(value: unknown, expected: TopupExpectation): NormalizedTopup {
  const root = record(value); const topup = record(root?.topup);
  if (!topup || !uuid(topup.id)) fail();
  if (expected.id !== undefined && topup.id !== expected.id) fail();
  const amount = normalizePositiveCents(topup.amount_cents);
  if (amount !== positiveExpectation(expected.amountCents)) fail();
  const status = enumValue(topup.status, TOPUP_STATUSES);
  const method = optionalEnum(topup.method, new Set<TopupMethod>(['oxxo', 'card', 'spei']));
  if (expected.requireMethod && method === undefined) fail();
  if (method !== undefined && method !== expected.method) fail();
  const voucherReference = topup.voucher_reference === null ? undefined : optionalText(topup.voucher_reference);
  const voucherUrl = topup.stripe_voucher_url === undefined || topup.stripe_voucher_url === null
    ? topup.stripe_voucher_url as string | null | undefined
    : optionalText(topup.stripe_voucher_url);
  const voucherExpires = topup.voucher_expires_at === null ? undefined : optionalText(topup.voucher_expires_at);
  if (root?.idempotent !== undefined && typeof root.idempotent !== 'boolean') fail();
  return {
    id: topup.id, ...(method !== undefined && { method }), status, amount_cents: amount, amount_display: centsToDisplay(amount),
    ...(voucherReference && { voucher_reference: voucherReference }),
    ...(voucherUrl !== undefined && { stripe_voucher_url: voucherUrl }),
    ...(voucherExpires && { voucher_expires_at: voucherExpires }),
  };
}

export function topupOxxoResponse(value: unknown, expectedAmountCents: number): TopupOxxoResponse {
  const root = record(value);
  const topup = normalizeTopup(value, { amountCents: expectedAmountCents, method: 'oxxo' });
  const isReplay = root?.idempotent === true;
  // Replay se acredita por `method`; fresh por la firma exclusiva del voucher.
  // Nunca inferimos OXXO sólo a partir del endpoint que se invocó.
  if (isReplay) {
    if (topup.method !== 'oxxo') fail();
  } else if (topup.status !== 'processing' || !topup.voucher_reference || !topup.voucher_expires_at) {
    fail();
  }
  if (root?.requires_action !== undefined || root?.client_secret !== undefined) fail();
  // Un replay pending/processing sin voucher no es utilizable. Lanzar acá
  // mantiene el error DENTRO del callback protegido: el journal vuelve a
  // ambiguous y puede reintentar la misma key, nunca queda clavado en sending.
  if ((topup.status === 'pending' || topup.status === 'processing') && (!topup.voucher_reference || !topup.voucher_expires_at)) {
    throw new UnboundMoneyResponseError();
  }
  return { ...(isReplay && { idempotent: true }), topup: { ...topup, method: 'oxxo' } };
}

export function topupCardResponse(value: unknown, expectedAmountCents: number): TopupCardResponse {
  const root = record(value);
  const topup = normalizeTopup(value, { amountCents: expectedAmountCents, method: 'card' });
  const requiresAction = optionalBoolean(root?.requires_action);
  const clientSecret = optionalText(root?.client_secret);
  const isReplay = root?.idempotent === true;
  // Fresh se acredita por el boolean contractual de Stripe; replay por method.
  if (isReplay ? topup.method !== 'card' : requiresAction === undefined) fail();
  if (topup.voucher_reference || topup.voucher_expires_at || typeof topup.stripe_voucher_url === 'string') fail();
  if (requiresAction === true && !clientSecret) fail();
  if (clientSecret && requiresAction !== true) fail();
  if (requiresAction === true && topup.status !== 'processing') fail();
  return {
    ...(isReplay && { idempotent: true }),
    topup: {
      id: topup.id,
      method: 'card',
      status: topup.status,
      amount_cents: topup.amount_cents,
      amount_display: topup.amount_display,
    },
    ...(requiresAction !== undefined && { requires_action: requiresAction }),
    ...(clientSecret && { client_secret: clientSecret }),
  };
}

/** GET /topup/:id debe seguir correspondiendo al intento que se inició. */
export function topupStatusResponse(value: unknown, expected: { id: string; amountCents: number; method: TopupMethod }): TopupStatusResponse {
  const topup = normalizeTopup(value, { id: expected.id, amountCents: expected.amountCents, method: expected.method, requireMethod: true });
  return {
    topup: {
      id: topup.id,
      method: expected.method,
      status: topup.status,
      amount_cents: topup.amount_cents,
      amount_display: topup.amount_display,
    },
  };
}

export function transferResponse(value: unknown, expected: CreateTransferRequest, binding: TransferExpectation): CreateTransferResponse {
  const root = record(value); const transfer = record(root?.transfer); const to = record(transfer?.to);
  if (!transfer || !uuid(transfer.id)) fail();
  if (!uuid(binding.recipientUserId) || !PAYME_ID.test(binding.paymeId) || expected.to_payme_id !== binding.paymeId) fail();
  const amount = normalizePositiveCents(transfer.amount_cents);
  if (amount !== positiveExpectation(expected.amount_cents)) fail();
  const status = optionalEnum(transfer.status, TRANSFER_STATUSES);
  const concept = transfer.concept;
  if (concept !== null && !text(concept)) fail();
  if ((expected.concept ?? null) !== concept) fail();
  if (!text(transfer.completed_at)) fail();
  if (root?.idempotent !== undefined && typeof root.idempotent !== 'boolean') fail();
  if (root?.idempotent === true) {
    if (status !== 'completed' || transfer.to_user_id !== binding.recipientUserId) throw new UnboundMoneyResponseError();
    return {
      idempotent: true,
      transfer: { id: transfer.id, amount_cents: amount, concept, completed_at: transfer.completed_at, amount_display: centsToDisplay(amount), status: 'completed', to_user_id: binding.recipientUserId },
    };
  }
  if (!to || !text(to.payme_id) || !PAYME_ID.test(to.payme_id) || !text(to.full_name)) throw new UnboundMoneyResponseError();
  if (to.payme_id !== binding.paymeId || (status !== undefined && status !== 'completed')) fail();
  if (transfer.to_user_id !== undefined && transfer.to_user_id !== binding.recipientUserId) fail();
  return {
    transfer: { id: transfer.id, amount_cents: amount, concept, completed_at: transfer.completed_at, amount_display: centsToDisplay(amount), to: { payme_id: to.payme_id, full_name: to.full_name }, ...(status === 'completed' && { status }) },
  };
}
