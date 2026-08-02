import type { CreateMesaResponse, CreateTransferResponse, PayMesaResponse, TopupCardResponse, TopupOxxoResponse } from './types';

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

export function createMesaResponse(value: unknown): CreateMesaResponse {
  const root = record(value); const mesa = record(root?.mesa); const guarantee = record(root?.guarantee);
  if (!mesa || !guarantee || !text(mesa.id) || !text(mesa.code) || !cents(mesa.total_cents) || !text(mesa.status) || !text(guarantee.method)) fail();
  if (guarantee.status !== 'open' && guarantee.status !== 'requires_action') fail();
  if (guarantee.status === 'requires_action' && guarantee.client_secret !== undefined && !text(guarantee.client_secret)) fail();
  if (guarantee.connected_account_id !== undefined && !text(guarantee.connected_account_id)) fail();
  return value as CreateMesaResponse;
}

export function payMesaResponse(value: unknown): PayMesaResponse {
  const root = record(value); const attempt = record(root?.attempt);
  if (!attempt || !text(attempt.id) || !cents(attempt.gross_amount_cents) || !text(attempt.status)) fail();
  if (attempt.tip_cents !== undefined && !cents(attempt.tip_cents)) fail();
  if (attempt.requires_action !== undefined && typeof attempt.requires_action !== 'boolean') fail();
  if (attempt.client_secret !== undefined && !text(attempt.client_secret)) fail();
  if (attempt.stripe_client_secret !== undefined && attempt.stripe_client_secret !== null && !text(attempt.stripe_client_secret)) fail();
  return value as PayMesaResponse;
}

export function topupOxxoResponse(value: unknown): TopupOxxoResponse {
  const root = record(value); const topup = record(root?.topup);
  if (!topup || !text(topup.id) || !text(topup.status) || !cents(topup.amount_cents) || !text(topup.amount_display) || !text(topup.voucher_reference) || !text(topup.voucher_expires_at)) fail();
  return value as TopupOxxoResponse;
}

export function topupCardResponse(value: unknown): TopupCardResponse {
  const root = record(value); const topup = record(root?.topup);
  if (!topup || !text(topup.id) || !text(topup.status) || !cents(topup.amount_cents) || !text(topup.amount_display) || typeof root?.requires_action !== 'boolean') fail();
  if (root.client_secret !== undefined && !text(root.client_secret)) fail();
  return value as TopupCardResponse;
}

export function transferResponse(value: unknown): CreateTransferResponse {
  const root = record(value); const transfer = record(root?.transfer); const to = record(transfer?.to);
  if (!transfer || !to || !text(transfer.id) || !cents(transfer.amount_cents) || !text(transfer.amount_display) || !text(transfer.completed_at) || !text(to.payme_id) || !text(to.full_name)) fail();
  if (root?.idempotent !== undefined && typeof root.idempotent !== 'boolean') fail();
  return value as CreateTransferResponse;
}
