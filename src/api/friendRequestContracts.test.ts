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

describe('G-25 · POST /friends dual-compatible y no-oracular', () => {
  it('acepta el recibo opaco nuevo', () => {
    expect(friendRequestCreatedResponse({ requested: true, request_id: RECEIPT_ID }))
      .toEqual({ requested: true, request_id: RECEIPT_ID });
  });

  it('acepta temporalmente la respuesta vieja sin inventar un id', () => {
    expect(friendRequestCreatedResponse({ requested: true })).toEqual({ requested: true });
  });

  it.each([
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

  it('tolera el DTO anterior pero elimina toda identidad antes de devolverlo', () => {
    const decoded = friendRequestsResponse({
      direction: 'outgoing',
      requests: [{ id: RECEIPT_ID, user: PERSON, requested_at: REQUESTED_AT }],
    }, 'outgoing');

    expect(Object.keys(decoded.requests[0]!).sort()).toEqual(['id', 'requested_at']);
    expect(JSON.stringify(decoded)).not.toContain(PERSON_ID);
    expect(JSON.stringify(decoded)).not.toContain(PERSON.payme_id);
    expect(JSON.stringify(decoded)).not.toContain(PERSON.full_name);
    expect(decoded.requests[0]!.id).toBe(RECEIPT_ID);
    expect(decoded.requests[0]!.id).not.toBe(PERSON_ID);
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
