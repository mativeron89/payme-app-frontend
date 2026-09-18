import { describe, expect, it } from 'vitest';
import {
  friendRequestCancelledResponse,
  friendRequestCreatedResponse,
  friendRequestsResponse,
} from './contractResponses';

const RECEIPT_ID = '11111111-1111-4111-8111-111111111111';
const PERSON_ID = '22222222-2222-4222-8222-222222222222';
const REQUESTED_AT = '2026-08-26T12:34:56.000Z';
const PERSON = {
  id: PERSON_ID,
  payme_id: 'payme_mx_vale',
  first_name: 'Valentina',
  last_name: 'Ríos',
  full_name: 'Valentina Ríos',
};

describe('G-25 · POST /friends sólo el recibo opaco (retiro de compat legacy 2026-09-18)', () => {
  it('acepta el recibo opaco nuevo', () => {
    expect(friendRequestCreatedResponse({ requested: true, request_id: RECEIPT_ID }))
      .toEqual({ requested: true, request_id: RECEIPT_ID });
  });

  /**
   * 🔴 MUTANTE (a) de la orden de retiro: si alguien repone la tolerancia del
   * shape viejo `{requested:true}` sin id, este test tiene que ponerse rojo.
   * Backend en producción desciende de v2.71 (owner-first, E0 PASS
   * 2026-09-18): ya no hay ventana de convivencia que tolerar.
   */
  it('🔴 rechaza la respuesta vieja sin request_id — ya no hay ventana de compat', () => {
    expect(() => friendRequestCreatedResponse({ requested: true }))
      .toThrow('contract_response_invalid:friends');
  });

  it.each([
    { requested: true },
    { requested: true, request_id: 'persona@ejemplo.mx' },
    { requested: true, request_id: PERSON_ID, user: PERSON },
    { requested: false, request_id: RECEIPT_ID },
  ])('rechaza shape que permitiría identidad o semántica no contractual: %o', (body) => {
    expect(() => friendRequestCreatedResponse(body)).toThrow('contract_response_invalid:friends');
  });
});

describe('G-25 · GET outgoing proyecta sólo recibos opacos', () => {
  it('acepta el DTO owner nuevo {id, requested_at}', () => {
    const decoded = friendRequestsResponse({
      direction: 'outgoing',
      requests: [{ id: RECEIPT_ID, requested_at: REQUESTED_AT }],
    }, 'outgoing');

    expect(decoded).toEqual({
      direction: 'outgoing',
      requests: [{ id: RECEIPT_ID, requested_at: REQUESTED_AT }],
    });
  });

  /**
   * 🔴 MUTANTE (b) de la orden de retiro: si alguien vuelve a dejar pasar
   * `user` en un saliente, este test tiene que ponerse rojo. Antes este
   * mismo caso se toleraba y se proyectaba sin identidad; ahora es
   * directamente un error de contrato — el owner en producción (>= v2.71)
   * nunca manda `user` en un saliente, así que verlo es una violación, no un
   * DTO viejo a limpiar.
   */
  it('🔴 rechaza un saliente con `user` — ya no hay DTO legacy que tolerar', () => {
    expect(() => friendRequestsResponse({
      direction: 'outgoing',
      requests: [{ id: RECEIPT_ID, user: PERSON, requested_at: REQUESTED_AT }],
    }, 'outgoing')).toThrow('contract_response_invalid:friends/requests');
  });

  it('falla cerrado si direction no coincide o el recibo no es íntegro', () => {
    expect(() => friendRequestsResponse({
      direction: 'incoming',
      requests: [{ id: RECEIPT_ID, user: PERSON, requested_at: REQUESTED_AT }],
    }, 'outgoing')).toThrow('contract_response_invalid:friends/requests');

    expect(() => friendRequestsResponse({
      direction: 'outgoing',
      requests: [{ id: RECEIPT_ID, requested_at: 'ayer' }],
    }, 'outgoing')).toThrow('contract_response_invalid:friends/requests');
  });
});

describe('G-25 · incoming conserva identidad y acciones', () => {
  it('decodifica el DTO vigente sin mezclar id de persona y solicitud', () => {
    const decoded = friendRequestsResponse({
      direction: 'incoming',
      requests: [{ id: RECEIPT_ID, user: PERSON, requested_at: REQUESTED_AT }],
    }, 'incoming');

    expect(decoded.requests[0]!.id).toBe(RECEIPT_ID);
    expect(decoded.requests[0]!.user.id).toBe(PERSON_ID);
    expect(decoded.requests[0]!.user.full_name).toBe('Valentina Ríos');
  });
});

describe('G-25 · DELETE confirma antes de retirar', () => {
  it('acepta únicamente el 200 contractual exacto', () => {
    expect(friendRequestCancelledResponse({ cancelled: true })).toEqual({ cancelled: true });
    expect(() => friendRequestCancelledResponse({ cancelled: true, user_id: PERSON_ID }))
      .toThrow('contract_response_invalid:friends/requests/:id');
  });
});
