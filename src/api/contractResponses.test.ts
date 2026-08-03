import { describe, expect, it } from 'vitest';
import {
  attachPaymentMethodResponse,
  invitationResponse,
  setupIntentResponse,
} from './contractResponses';

const method = {
  id: 'payment-method-id',
  stripe_payment_method_id: 'pm_contract',
  brand: 'visa',
  bank_name: null,
  type: 'credit',
  last_four: '4242',
  exp_month: 8,
  exp_year: 2030,
  is_default: true,
  display: 'Visa · Crédito · •••• 4242',
};

const invitation = {
  id: 'invitation-id',
  invitation_type: 'link' as const,
  status: 'pending',
  expires_at: '2026-08-04T00:00:00.000Z',
  created_at: '2026-08-03T00:00:00.000Z',
};

describe('decoders fail-closed de mutaciones no monetarias', () => {
  it('acepta setup completo y rechaza cualquier 2xx sin ambos identificadores', () => {
    const valid = { setup_intent_id: 'seti_1', client_secret: 'seti_1_secret_1' };
    expect(setupIntentResponse(valid)).toBe(valid);
    for (const malformed of [{}, { setup_intent_id: 'seti_1' }, { client_secret: 'secret' }]) {
      expect(() => setupIntentResponse(malformed)).toThrow('contract_response_invalid');
    }
  });

  it('exige el cuerpo payment_method del attach y valida sus campos usados por UI', () => {
    const valid = { payment_method: method, idempotent: true };
    expect(attachPaymentMethodResponse(valid, 'pm_contract')).toBe(valid);
    for (const malformed of [
      {},
      { payment_method: null },
      { payment_method: { ...method, last_four: '42' } },
      { payment_method: { ...method, stripe_payment_method_id: 'pm_crossed' } },
      { payment_method: { ...method, is_default: 'true' } },
      { payment_method: method, idempotent: 'true' },
    ]) {
      expect(() => attachPaymentMethodResponse(malformed, 'pm_contract')).toThrow('contract_response_invalid');
    }
  });

  it('liga la invitación al tipo pedido y exige link utilizable para type=link', () => {
    const valid = { invitation, link: 'https://payme.test/mesa/ABC?t=token' };
    expect(invitationResponse(valid, 'link', 'ABC')).toBe(valid);
    expect(() => invitationResponse({ invitation }, 'link', 'ABC')).toThrow('contract_response_invalid');
    expect(() => invitationResponse(valid, 'link', 'OTRA')).toThrow('contract_response_invalid');
    expect(() => invitationResponse({ ...valid, link: 'https://payme.test/#/mesa/ABC' }, 'link', 'ABC')).toThrow('contract_response_invalid');
    expect(() => invitationResponse(valid, 'in_app', 'ABC')).toThrow('contract_response_invalid');
    expect(() => invitationResponse({ invitation: { ...invitation, invitation_type: 'in_app' } }, 'in_app', 'ABC')).not.toThrow();
    expect(invitationResponse({ ...valid, invitation: { ...invitation, status: 'expired' } }, 'link', 'ABC').invitation.status).toBe('expired');
    expect(() => invitationResponse({ ...valid, invitation: { ...invitation, status: 'accepted' } }, 'link', 'ABC')).toThrow('contract_response_invalid');
  });
});
