import { describe, expect, it } from 'vitest';
import {
  acceptInvitationResponse,
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
  /**
   * La ASIMETRÍA que este decoder cierra: `accept-link` exigía `joined===true`
   * desde el cierre del pago sin cuenta, y el accept IN-APP —su puerta
   * hermana— tenía el campo `accepted` tipado y jamás leído. Cualquier 2xx
   * mostraba "Te sumaste a la mesa ✓" y navegaba a una mesa donde el próximo
   * request iba a dar 403 sin explicación. Una de las dos puertas ya sabía
   * hacerlo bien; acá se iguala, no se inventa.
   */
  it('el accept in-app exige accepted === true, como su puerta hermana', () => {
    const valid = { accepted: true };
    expect(acceptInvitationResponse(valid)).toBe(valid);
    for (const malformed of [
      {},
      { accepted: false },
      // Los verdaderos-por-descuido: sin `=== true` estricto, los tres pasan.
      { accepted: 'true' },
      { accepted: 1 },
      { accepted: 'si' },
      null,
      undefined,
      'ok',
      [{ accepted: true }],
    ]) {
      expect(() => acceptInvitationResponse(malformed)).toThrow('contract_response_invalid');
    }
  });

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
    // ORDEN 1A.2: el origen se inyecta en los tests; en la app sale del
    // runtime. Sin orígenes confiables NADA pasa, así que los casos de link
    // declaran el suyo.
    const ORIGEN = ['https://payme.test'];
    const valid = { invitation, link: 'https://payme.test/mesa/ABC?t=token' };
    expect(invitationResponse(valid, 'link', 'ABC', ORIGEN)).toBe(valid);
    expect(() => invitationResponse({ invitation }, 'link', 'ABC', ORIGEN)).toThrow('contract_response_invalid');
    expect(() => invitationResponse(valid, 'link', 'OTRA', ORIGEN)).toThrow('contract_response_invalid');
    expect(() => invitationResponse({ ...valid, link: 'https://payme.test/#/mesa/ABC' }, 'link', 'ABC', ORIGEN)).toThrow('contract_response_invalid');
    expect(() => invitationResponse(valid, 'in_app', 'ABC', ORIGEN)).toThrow('contract_response_invalid');
    expect(() => invitationResponse({ invitation: { ...invitation, invitation_type: 'in_app' } }, 'in_app', 'ABC', ORIGEN)).not.toThrow();
    expect(invitationResponse({ ...valid, invitation: { ...invitation, status: 'expired' } }, 'link', 'ABC', ORIGEN).invitation.status).toBe('expired');
    expect(() => invitationResponse({ ...valid, invitation: { ...invitation, status: 'accepted' } }, 'link', 'ABC', ORIGEN)).toThrow('contract_response_invalid');
  });
});

/**
 * ORDEN 1A.2 · EL ORIGEN DEL LINK. El decoder validaba path y token pero NO el
 * host: `endsWith('/mesa/<code>')` acredita como "el link de MI mesa"
 * cualquier URL que termine así, en cualquier dominio — y ese link es el que
 * la persona pega en WhatsApp, con el token adentro.
 */
describe('el link de invitación se valida contra un ORIGEN confiable', () => {
  const invitacion = {
    id: 'invitation-id',
    invitation_type: 'link' as const,
    status: 'pending',
    expires_at: '2026-08-08T00:00:00.000Z',
    created_at: '2026-08-06T00:00:00.000Z',
  };
  const CONFIABLE = ['https://payme.test'];
  const conLink = (link: string) => ({ invitation: invitacion, link });

  it('el link del propio origen pasa, con path y con hash', () => {
    expect(() => invitationResponse(conLink('https://payme.test/mesa/ABC?t=tok'), 'link', 'ABC', CONFIABLE)).not.toThrow();
    expect(() => invitationResponse(conLink('https://payme.test/#/mesa/ABC?t=tok'), 'link', 'ABC', CONFIABLE)).not.toThrow();
  });

  it('🔴 MUTANTE · un host arbitrario se RECHAZA aunque el path y el token estén bien', () => {
    for (const hostil of [
      'https://evil.example/redir/mesa/ABC?t=tok',
      'https://payme.test.evil.example/mesa/ABC?t=tok',
      'https://payme-test.example/mesa/ABC?t=tok',
      '//evil.example/mesa/ABC?t=tok',
    ]) {
      expect(() => invitationResponse(conLink(hostil), 'link', 'ABC', CONFIABLE), hostil)
        .toThrow('contract_response_invalid');
    }
  });

  it('🔴 protocolo inseguro en un host público → falla cerrada', () => {
    expect(() => invitationResponse(conLink('http://payme.test/mesa/ABC?t=tok'), 'link', 'ABC', ['http://payme.test']))
      .toThrow('contract_response_invalid');
  });

  it('http SÍ vale en local: es el riel de desarrollo y del mock', () => {
    const local = ['http://localhost:5175'];
    expect(() => invitationResponse(conLink('http://localhost:5175/#/mesa/ABC?t=tok'), 'link', 'ABC', local)).not.toThrow();
  });

  it('🔴 sin orígenes acreditables NO pasa nada: ausencia no es permisividad', () => {
    expect(() => invitationResponse(conLink('https://payme.test/mesa/ABC?t=tok'), 'link', 'ABC', []))
      .toThrow('contract_response_invalid');
  });

  it('un link RELATIVO sigue valiendo: es del propio origen por definición', () => {
    expect(() => invitationResponse(conLink('/#/mesa/ABC?t=tok'), 'link', 'ABC', CONFIABLE)).not.toThrow();
  });

  it('el token sigue siendo obligatorio, y el código tiene que ser el pedido', () => {
    expect(() => invitationResponse(conLink('https://payme.test/mesa/ABC'), 'link', 'ABC', CONFIABLE)).toThrow();
    expect(() => invitationResponse(conLink('https://payme.test/mesa/OTRA?t=tok'), 'link', 'ABC', CONFIABLE)).toThrow();
  });
});
