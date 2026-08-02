import type { CreateMesaRequest, CreateMesaResponse, CreateTransferRequest, CreateTransferResponse, PayMesaRequest, PayMesaResponse, TopupCardResponse, TopupOxxoResponse, TopupStatusResponse } from './types';

/** Respuestas monetarias inválidas son ambiguas: nunca habilitan otro intento. */
export class MalformedMoneyResponseError extends Error {
  constructor() { super('money_response_malformed'); this.name = 'MalformedMoneyResponseError'; }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function text(value: unknown): value is string { return typeof value === 'string' && value.length > 0; }
function cents(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function fail(): never { throw new MalformedMoneyResponseError(); }

export function createMesaResponse(value: unknown, expected: CreateMesaRequest): CreateMesaResponse {
  const root = record(value); const mesa = record(root?.mesa); const guarantee = record(root?.guarantee);
  if (!mesa || !guarantee || !text(mesa.id) || !text(mesa.code) || !cents(mesa.total_cents) || !text(mesa.status) || !text(guarantee.method)) fail();
  if (guarantee.status !== 'open' && guarantee.status !== 'requires_action') fail();
  if (mesa.total_cents !== expected.total_cents || mesa.division_mode !== expected.division_mode || mesa.expected_participants !== expected.expected_participants || guarantee.method !== expected.guarantee_method) fail();
  if ((guarantee.status === 'open' && mesa.status !== 'open') || (guarantee.status === 'requires_action' && mesa.status !== 'pending_auth')) fail();
  if (guarantee.status === 'requires_action' && guarantee.client_secret !== undefined && !text(guarantee.client_secret)) fail();
  if (guarantee.connected_account_id !== undefined && !text(guarantee.connected_account_id)) fail();
  return value as CreateMesaResponse;
}

export function payMesaResponse(value: unknown, expected: PayMesaRequest): PayMesaResponse {
  const root = record(value); const attempt = record(root?.attempt);
  if (!attempt || !text(attempt.id) || !cents(attempt.gross_amount_cents) || !text(attempt.status)) fail();
  if (attempt.tip_cents !== undefined && !cents(attempt.tip_cents)) fail();
  if (attempt.requires_action !== undefined && typeof attempt.requires_action !== 'boolean') fail();
  if (attempt.client_secret !== undefined && !text(attempt.client_secret)) fail();
  if (attempt.stripe_client_secret !== undefined && attempt.stripe_client_secret !== null && !text(attempt.stripe_client_secret)) fail();
  if (attempt.payment_type !== expected.payment_type || (expected.tip_cents !== undefined && attempt.tip_cents !== expected.tip_cents) || attempt.gross_amount_cents < (attempt.tip_cents ?? 0)) fail();
  return value as PayMesaResponse;
}

export function topupOxxoResponse(value: unknown, expectedAmountCents: number): TopupOxxoResponse {
  const root = record(value); const topup = record(root?.topup);
  if (!topup || !text(topup.id) || !text(topup.status) || topup.amount_cents !== expectedAmountCents || !text(topup.amount_display) || !text(topup.voucher_reference) || !text(topup.voucher_expires_at)) fail();
  return value as TopupOxxoResponse;
}

export function topupCardResponse(value: unknown, expectedAmountCents: number): TopupCardResponse {
  const root = record(value); const topup = record(root?.topup);
  if (!topup || !text(topup.id) || !text(topup.status) || topup.amount_cents !== expectedAmountCents || !text(topup.amount_display) || typeof root?.requires_action !== 'boolean') fail();
  if (root.client_secret !== undefined && !text(root.client_secret)) fail();
  if (root.requires_action === true && !text(root.client_secret)) fail();
  return value as TopupCardResponse;
}

/** GET /topup/:id debe seguir correspondiendo al intento que se inició. */
export function topupStatusResponse(value: unknown, expected: { id: string; amountCents: number }): TopupStatusResponse {
  const root = record(value); const topup = record(root?.topup);
  if (!topup || topup.id !== expected.id || topup.amount_cents !== expected.amountCents || !text(topup.status) || !text(topup.amount_display)) fail();
  return value as TopupStatusResponse;
}

export function transferResponse(value: unknown, expected: CreateTransferRequest): CreateTransferResponse {
  const root = record(value); const transfer = record(root?.transfer); const to = record(transfer?.to);
  if (!transfer || !to || !text(transfer.id) || transfer.amount_cents !== expected.amount_cents || !text(transfer.amount_display) || !text(transfer.completed_at) || !text(to.payme_id) || !text(to.full_name) || !expected.to_payme_id || to.payme_id !== expected.to_payme_id) fail();
  if (root?.idempotent !== undefined && typeof root.idempotent !== 'boolean') fail();
  return value as CreateTransferResponse;
}
