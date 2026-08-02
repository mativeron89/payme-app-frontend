import { describe, expect, it } from 'vitest';
import { createMesaResponse, payMesaResponse, topupCardResponse, topupOxxoResponse, topupStatusResponse, transferResponse } from './moneyGuards';

describe('guards monetarios runtime', () => {
  const mesaRequest = { restaurant_id: 'r', total_cents: 1000, division_mode: 'igual' as const, expected_participants: 2, guarantee_method: 'card' as const, items: [] };
  const payRequest = { payment_type: 'card' as const, item_ids: ['i'], idempotency_key: 'key' };
  const transferRequest = { amount_cents: 5000, to_payme_id: 'destino', idempotency_key: 'key' };

  it('rechaza 2xx malformado sin declararlo éxito', () => {
    expect(() => createMesaResponse({ ok: true }, mesaRequest)).toThrow('money_response_malformed');
    expect(() => payMesaResponse({ ok: true }, payRequest)).toThrow('money_response_malformed');
    expect(() => topupCardResponse({ ok: true }, 5000)).toThrow('money_response_malformed');
    expect(() => topupOxxoResponse({ ok: true }, 5000)).toThrow('money_response_malformed');
    expect(() => transferResponse({ ok: true }, transferRequest)).toThrow('money_response_malformed');
  });

  it('exige estados/campos mínimos de garantía y cobro', () => {
    expect(() => createMesaResponse({ mesa: { id: 'm', code: 'c', total_cents: 1, status: 'open' }, guarantee: { method: 'card', status: 'pending' } }, mesaRequest)).toThrow();
    expect(() => payMesaResponse({ attempt: { id: 'a', gross_amount_cents: Number.NaN, status: 'succeeded' } }, payRequest)).toThrow();
    expect(() => topupCardResponse({ topup: { id: 't', status: 'succeeded', amount_cents: 1, amount_display: '$1' }, requires_action: 'no' }, 5000)).toThrow();
  });

  it('rechaza 2xx bien formados pero de otra intención', () => {
    const mesa = { mesa: { id: 'm', code: 'c', total_cents: 999, division_mode: 'igual', expected_participants: 2, status: 'open' }, guarantee: { method: 'card', status: 'open' } };
    expect(() => createMesaResponse(mesa, mesaRequest)).toThrow('money_response_malformed');
    const pay = { attempt: { id: 'a', gross_amount_cents: 1000, tip_cents: 0, status: 'succeeded', payment_type: 'wallet' } };
    expect(() => payMesaResponse(pay, payRequest)).toThrow('money_response_malformed');
    const topup = { topup: { id: 't', status: 'succeeded', amount_cents: 7000, amount_display: '$70' }, requires_action: false };
    expect(() => topupCardResponse(topup, 5000)).toThrow('money_response_malformed');
    const transfer = { transfer: { id: 'x', amount_cents: 5000, amount_display: '$50', completed_at: '2026-01-01', to: { payme_id: 'otra', full_name: 'Otra' } } };
    expect(() => transferResponse(transfer, transferRequest)).toThrow('money_response_malformed');
  });

  it('no interpreta un GET topup de otro id o monto como éxito', () => {
    const response = { topup: { id: 'topup-a', status: 'succeeded', amount_cents: 5000, amount_display: '$50' } };
    expect(() => topupStatusResponse(response, { id: 'topup-b', amountCents: 5000 })).toThrow('money_response_malformed');
    expect(() => topupStatusResponse(response, { id: 'topup-a', amountCents: 7000 })).toThrow('money_response_malformed');
    expect(topupStatusResponse(response, { id: 'topup-a', amountCents: 5000 })).toEqual(response);
  });
});
