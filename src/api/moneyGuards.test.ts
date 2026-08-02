import { describe, expect, it } from 'vitest';
import { createMesaResponse, payMesaResponse, topupCardResponse, topupOxxoResponse, transferResponse } from './moneyGuards';

describe('guards monetarios runtime', () => {
  it('rechaza 2xx malformado sin declararlo éxito', () => {
    for (const guard of [createMesaResponse, payMesaResponse, topupCardResponse, topupOxxoResponse, transferResponse]) {
      expect(() => guard({ ok: true })).toThrow('money_response_malformed');
    }
  });

  it('exige estados/campos mínimos de garantía y cobro', () => {
    expect(() => createMesaResponse({ mesa: { id: 'm', code: 'c', total_cents: 1, status: 'open' }, guarantee: { method: 'card', status: 'pending' } })).toThrow();
    expect(() => payMesaResponse({ attempt: { id: 'a', gross_amount_cents: Number.NaN, status: 'succeeded' } })).toThrow();
    expect(() => topupCardResponse({ topup: { id: 't', status: 'succeeded', amount_cents: 1, amount_display: '$1' }, requires_action: 'no' })).toThrow();
  });
});
