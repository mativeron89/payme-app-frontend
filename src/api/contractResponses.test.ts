import { describe, expect, it } from 'vitest';
import {
  acceptInvitationResponse,
  attachPaymentMethodResponse,
  invitationResponse,
  mesaCreationResponse,
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

/**
 * ORDEN 2A · `GET /mesas/creations/:idempotency_key`, decodificado fail-closed.
 *
 * De esta respuesta depende si se libera el journal de una apertura CON
 * GARANTÍA, así que un 2xx incompleto no es un resultado a medias: es un
 * error, y el caller conserva el freeze.
 */
describe('mesaCreationResponse', () => {
  const ok = {
    found: true,
    outcome: 'open',
    retry_with_same_idempotency_key: false,
    mesa: {
      id: 'uuid',
      code: 'PA-2847',
      total_cents: '84000',
      division_mode: 'consumo',
      expected_participants: 4,
      status: 'open',
      expires_at: new Date().toISOString(),
    },
    guarantee: { method: 'card', authorized: true },
  };

  it('el 200 completo decodifica, y `total_cents` STRING sale como ENTERO', () => {
    const r = mesaCreationResponse(ok);
    expect(r.outcome).toBe('open');
    expect(r.mesa).toEqual({ code: 'PA-2847', status: 'open', totalCents: 84000 });
    expect(r.guarantee).toEqual({ method: 'card', authorized: true });
    expect(r.retryWithSameKey).toBe(false);
  });

  it('🔴 MUTANTE · un `outcome` que el contrato no declara NO se interpreta', () => {
    // No saber no es saber que no: un backend con un estado nuevo tiene que
    // dejar el intento como está, no caer en la rama más parecida.
    for (const outcome of ['abierta', 'OPEN', '', 'requires-action', 42, null]) {
      expect(() => mesaCreationResponse({ ...ok, outcome }), String(outcome))
        .toThrow('contract_response_invalid');
    }
  });

  it('🔴 MUTANTE · los booleanos se exigen por TIPO: "false" es verdadero en JS', () => {
    expect(() => mesaCreationResponse({ ...ok, found: 'true' })).toThrow();
    expect(() => mesaCreationResponse({ ...ok, retry_with_same_idempotency_key: 'false' })).toThrow();
    expect(() => mesaCreationResponse({ ...ok, retry_with_same_idempotency_key: 1 })).toThrow();
  });

  it('🔴 MUTANTE · un cuerpo que se contradice a sí mismo no acredita nada', () => {
    // `not_found` con `found: true`, o al revés.
    expect(() => mesaCreationResponse({ ...ok, outcome: 'not_found' })).toThrow();
    expect(() => mesaCreationResponse({
      found: false, outcome: 'open', retry_with_same_idempotency_key: false, mesa: ok.mesa,
    })).toThrow();
  });

  it('🔴 MUTANTE · con `found: true` el CÓDIGO es obligatorio: es toda la prueba', () => {
    expect(() => mesaCreationResponse({ ...ok, mesa: { ...ok.mesa, code: '' } })).toThrow();
    expect(() => mesaCreationResponse({ ...ok, mesa: { ...ok.mesa, code: null } })).toThrow();
    expect(() => mesaCreationResponse({ ...ok, mesa: undefined })).toThrow();
  });

  it('🔴 un `status` fuera de la máquina de estados no pasa', () => {
    expect(() => mesaCreationResponse({ ...ok, mesa: { ...ok.mesa, status: 'abierta' } })).toThrow();
  });

  it('🔴 un `total_cents` que no es un entero seguro no pasa', () => {
    for (const total of ['84000.5', '-1', 'ochenta', '', null, 1.5, NaN, '9007199254740993']) {
      expect(() => mesaCreationResponse({ ...ok, mesa: { ...ok.mesa, total_cents: total } }), String(total))
        .toThrow();
    }
  });

  it('acepta también el entero: el dueño podría normalizarlo y no debe trabar a nadie', () => {
    expect(mesaCreationResponse({ ...ok, mesa: { ...ok.mesa, total_cents: 84000 } }).mesa?.totalCents).toBe(84000);
  });

  it('el 404 `not_found` es una RESPUESTA del contrato, no una falla', () => {
    const r = mesaCreationResponse({
      found: false, outcome: 'not_found', retry_with_same_idempotency_key: true,
    });
    expect(r.outcome).toBe('not_found');
    expect(r.retryWithSameKey).toBe(true);
    expect(r.mesa).toBeNull();
  });

  it('el 409 `payload_hash_conflict` llega SIN datos de mesa, a propósito', () => {
    const r = mesaCreationResponse({
      found: true, outcome: 'payload_hash_conflict', retry_with_same_idempotency_key: false,
    });
    expect(r.mesa).toBeNull();
    expect(r.guarantee).toBeNull();
  });

  it('`guarantee` se lee blando: informa el copy y no gobierna ninguna transición', () => {
    expect(mesaCreationResponse({ ...ok, guarantee: undefined }).guarantee).toBeNull();
    expect(mesaCreationResponse({ ...ok, guarantee: { method: 7, authorized: 'si' } }).guarantee)
      .toEqual({ method: null, authorized: false });
  });

  it('un cuerpo que no es objeto no es una respuesta', () => {
    for (const raro of [null, undefined, 'ok', 42, []]) {
      expect(() => mesaCreationResponse(raro)).toThrow('contract_response_invalid');
    }
  });
});
