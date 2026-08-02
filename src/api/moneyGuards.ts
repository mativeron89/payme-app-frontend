import { centsToDisplay } from '../utils/money';
import type { CreateMesaRequest, CreateMesaResponse, CreateTransferRequest, CreateTransferResponse, PayMesaRequest, PayMesaResponse, PaymentType, TopupCardResponse, TopupOxxoResponse, TopupStatusResponse } from './types';

/** Respuestas monetarias inválidas son ambiguas: nunca habilitan otro intento. */
export class MalformedMoneyResponseError extends Error {
  constructor() { super('money_response_malformed'); this.name = 'MalformedMoneyResponseError'; }
}
/** La forma es contractual, pero no acredita que corresponda a esta solicitud. */
export class UnboundMoneyResponseError extends MalformedMoneyResponseError {
  constructor() { super(); this.message = 'money_response_unbound'; this.name = 'UnboundMoneyResponseError'; }
}

export interface PayMesaExpectation { grossCents: number; tipCents: number; }
type TopupMethod = 'oxxo' | 'card' | 'spei';
type TopupStatus = 'pending' | 'processing' | 'succeeded' | 'failed' | 'expired' | 'cancelled';
type TransferStatus = 'pending' | 'completed' | 'failed' | 'reversed';
interface TopupExpectation { id?: string; amountCents: number; method: TopupMethod; requireMethod?: boolean; }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MESA_CODE = /^[A-Z]{2}-\d{3,5}$/;
const PAYME_ID = /^payme_[a-z]{2}_[a-z0-9]{4}$/;
const DECIMAL_INTEGER = /^(?:0|[1-9]\d*)$/;
const PAYMENT_TYPES = new Set<PaymentType>(['card', 'apple_pay', 'google_pay', 'wallet']);
const GUARANTEE_METHODS = new Set<'card' | 'wallet'>(['card', 'wallet']);
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

export function createMesaResponse(value: unknown, expected: CreateMesaRequest): CreateMesaResponse {
  const root = record(value); const mesa = record(root?.mesa); const guarantee = record(root?.guarantee);
  if (!mesa || !guarantee || !uuid(mesa.id) || !text(mesa.code) || !MESA_CODE.test(mesa.code) || !text(mesa.expires_at) || !text(mesa.created_at)) fail();
  const total = normalizePositiveCents(mesa.total_cents);
  const division = mesa.division_mode;
  const participants = mesa.expected_participants;
  const mesaStatus = mesa.status;
  if ((division !== 'consumo' && division !== 'igual') || typeof participants !== 'number' || !Number.isSafeInteger(participants) || participants < 1 || participants > 20 || (mesaStatus !== 'open' && mesaStatus !== 'pending_auth')) fail();
  const method = enumValue(guarantee.method, GUARANTEE_METHODS);
  const status = enumValue(guarantee.status, new Set(['open', 'requires_action']));
  if (total !== positiveExpectation(expected.total_cents) || division !== expected.division_mode || participants !== expected.expected_participants || method !== expected.guarantee_method) fail();
  if ((status === 'open' && mesaStatus !== 'open') || (status === 'requires_action' && mesaStatus !== 'pending_auth')) fail();
  const clientSecret = optionalText(guarantee.client_secret);
  if (status === 'requires_action' && !clientSecret) fail();
  const connectedAccount = optionalText(guarantee.connected_account_id);
  return {
    mesa: { id: mesa.id, code: mesa.code, total_cents: total, division_mode: division, expected_participants: participants, status: mesaStatus as CreateMesaResponse['mesa']['status'], expires_at: mesa.expires_at, created_at: mesa.created_at },
    guarantee: { method, status, ...(clientSecret && { client_secret: clientSecret }), ...(connectedAccount && { connected_account_id: connectedAccount }) },
  };
}

export function payMesaResponse(value: unknown, expected: PayMesaRequest, binding: PayMesaExpectation): PayMesaResponse {
  const root = record(value); const attempt = record(root?.attempt);
  if (!attempt || !uuid(attempt.id)) fail();
  const gross = normalizePositiveCents(attempt.gross_amount_cents);
  const tip = normalizeNonNegativeCents(attempt.tip_cents);
  const status = enumValue(attempt.status, PAYMENT_STATUSES);
  if (gross !== positiveExpectation(binding.grossCents) || tip !== normalizeNonNegativeCents(binding.tipCents) || gross < tip) fail();
  const paymentType = optionalEnum(attempt.payment_type, PAYMENT_TYPES);
  // El POST fresco de tarjeta no lo devuelve; si el backend lo envía, debe
  // corroborar el request. Nunca se inventa el campo ausente.
  if (paymentType !== undefined && paymentType !== expected.payment_type) fail();
  const requiresAction = optionalBoolean(attempt.requires_action);
  const clientSecret = optionalText(attempt.client_secret);
  const replaySecret = attempt.stripe_client_secret === null ? null : optionalText(attempt.stripe_client_secret);
  if (requiresAction === true && !clientSecret && !replaySecret) fail();
  const stripeStatus = optionalEnum(attempt.stripe_status, STRIPE_STATUSES);
  const connectedAccount = optionalText(attempt.connected_account_id);
  const descriptor = attempt.statement_descriptor === undefined || attempt.statement_descriptor === null
    ? attempt.statement_descriptor as string | null | undefined
    : optionalText(attempt.statement_descriptor);
  if (root?.idempotent !== undefined && typeof root.idempotent !== 'boolean') fail();
  return {
    ...(root?.idempotent === true && { idempotent: true }),
    attempt: {
      id: attempt.id, gross_amount_cents: gross, tip_cents: tip, status,
      ...(paymentType !== undefined && { payment_type: paymentType }),
      ...(requiresAction !== undefined && { requires_action: requiresAction }),
      ...(clientSecret && { client_secret: clientSecret }),
      ...(replaySecret !== undefined && { stripe_client_secret: replaySecret }),
      ...(stripeStatus !== undefined && { stripe_status: stripeStatus }),
      ...(connectedAccount && { connected_account_id: connectedAccount }),
      ...(descriptor !== undefined && { statement_descriptor: descriptor }),
      gross_display: centsToDisplay(gross),
    },
  };
}

function normalizeTopup(value: unknown, expected: TopupExpectation): { id: string; method: TopupMethod; status: TopupStatus; amount_cents: number; amount_display: string; voucher_reference?: string; stripe_voucher_url?: string | null; voucher_expires_at?: string } {
  const root = record(value); const topup = record(root?.topup);
  if (!topup || !uuid(topup.id)) fail();
  if (expected.id !== undefined && topup.id !== expected.id) fail();
  const amount = normalizePositiveCents(topup.amount_cents);
  if (amount !== positiveExpectation(expected.amountCents)) fail();
  const status = enumValue(topup.status, TOPUP_STATUSES);
  const method = optionalEnum(topup.method, new Set<TopupMethod>(['oxxo', 'card', 'spei']));
  if (expected.requireMethod && method === undefined) fail();
  if (method !== undefined && method !== expected.method) fail();
  const voucherReference = optionalText(topup.voucher_reference);
  const voucherUrl = topup.stripe_voucher_url === undefined || topup.stripe_voucher_url === null
    ? topup.stripe_voucher_url as string | null | undefined
    : optionalText(topup.stripe_voucher_url);
  const voucherExpires = optionalText(topup.voucher_expires_at);
  if (root?.idempotent !== undefined && typeof root.idempotent !== 'boolean') fail();
  return {
    id: topup.id, method: method ?? expected.method, status, amount_cents: amount, amount_display: centsToDisplay(amount),
    ...(voucherReference && { voucher_reference: voucherReference }),
    ...(voucherUrl !== undefined && { stripe_voucher_url: voucherUrl }),
    ...(voucherExpires && { voucher_expires_at: voucherExpires }),
  };
}

export function topupOxxoResponse(value: unknown, expectedAmountCents: number): TopupOxxoResponse {
  const root = record(value);
  const topup = normalizeTopup(value, { amountCents: expectedAmountCents, method: 'oxxo' });
  return { ...(root?.idempotent === true && { idempotent: true }), topup };
}

export function topupCardResponse(value: unknown, expectedAmountCents: number): TopupCardResponse {
  const root = record(value);
  const topup = normalizeTopup(value, { amountCents: expectedAmountCents, method: 'card' });
  const requiresAction = optionalBoolean(root?.requires_action);
  const clientSecret = optionalText(root?.client_secret);
  if (requiresAction === true && !clientSecret) fail();
  return { ...(root?.idempotent === true && { idempotent: true }), topup, ...(requiresAction !== undefined && { requires_action: requiresAction }), ...(clientSecret && { client_secret: clientSecret }) };
}

/** GET /topup/:id debe seguir correspondiendo al intento que se inició. */
export function topupStatusResponse(value: unknown, expected: { id: string; amountCents: number; method: TopupMethod }): TopupStatusResponse {
  return { topup: normalizeTopup(value, { id: expected.id, amountCents: expected.amountCents, method: expected.method, requireMethod: true }) };
}

export function transferResponse(value: unknown, expected: CreateTransferRequest): CreateTransferResponse {
  const root = record(value); const transfer = record(root?.transfer); const to = record(transfer?.to);
  if (!transfer || !uuid(transfer.id)) fail();
  const amount = normalizePositiveCents(transfer.amount_cents);
  if (amount !== positiveExpectation(expected.amount_cents)) fail();
  const status = optionalEnum(transfer.status, TRANSFER_STATUSES);
  if (!to || !text(to.payme_id) || !PAYME_ID.test(to.payme_id) || !text(to.full_name) || !expected.to_payme_id) throw new UnboundMoneyResponseError();
  if (to.payme_id !== expected.to_payme_id) fail();
  const concept = transfer.concept;
  if (concept !== null && !text(concept)) fail();
  if ((expected.concept ?? null) !== concept) fail();
  if (!text(transfer.completed_at)) fail();
  if (root?.idempotent !== undefined && typeof root.idempotent !== 'boolean') fail();
  return {
    ...(root?.idempotent === true && { idempotent: true }),
    transfer: { id: transfer.id, amount_cents: amount, concept, completed_at: transfer.completed_at, amount_display: centsToDisplay(amount), to: { payme_id: to.payme_id, full_name: to.full_name }, ...(status !== undefined && { status }) },
  };
}
