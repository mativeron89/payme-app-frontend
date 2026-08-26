import { describe, expect, it } from 'vitest';
import { incomingRowView, outgoingRowView } from './friendRequestsView';
import type { IncomingFriendRequest, OutgoingFriendRequest } from '../api/types';

/**
 * El oráculo que 3C vino a cerrar y la pantalla reabría.
 *
 * `POST /friends` no dice si la cuenta existe. Pero el backend sólo inserta la
 * fila cuando el destino existe, y `GET /friends/requests` proyecta nombre y
 * apellido — así que pintar las SALIENTES devolvía, medio segundo después, lo
 * que el POST se había negado a decir, con PII de alguien que no consintió.
 *
 * Estos tests fijan la asimetría. Si alguien vuelve a filtrar identidad hacia
 * la vista saliente, se ponen en rojo y dicen por qué.
 */

const PERSONA = {
  id: 'user-abc',
  payme_id: 'payme_mx_vale',
  first_name: 'Valentina',
  last_name: 'Ríos',
  full_name: 'Valentina Ríos',
  added_at: '',
};

const SOLICITUD_ENTRANTE: IncomingFriendRequest = {
  id: 'req-1',
  user: PERSONA,
  requested_at: '2026-08-03T12:00:00.000Z',
};

const RECIBO_SALIENTE: OutgoingFriendRequest = {
  id: 'receipt-1',
  requested_at: '2026-08-03T12:00:00.000Z',
};

describe('solicitud SALIENTE · no puede llevar identidad del destinatario', () => {
  /**
   * Compara el JUEGO COMPLETO de claves, no una lista de prohibidas: así
   * también falla si alguien agrega un campo de identidad que nadie previó
   * (`avatarUrl`, `initials`, `email`…). Una lista negra sólo atrapa lo que ya
   * se nos ocurrió.
   */
  it('expone exactamente {requestId, requestedAt} y nada más', () => {
    expect(Object.keys(outgoingRowView(RECIBO_SALIENTE)).sort()).toEqual(['requestId', 'requestedAt']);
  });

  it('ningún dato de la persona sobrevive a la proyección', () => {
    const serializado = JSON.stringify(outgoingRowView(RECIBO_SALIENTE));
    for (const dato of [
      PERSONA.id, PERSONA.payme_id, PERSONA.first_name, PERSONA.last_name, PERSONA.full_name,
    ]) {
      expect(serializado).not.toContain(dato);
    }
  });

  it('conserva el id de la SOLICITUD, que es lo único que hace falta para cancelar', () => {
    // Cancelar viaja con el id de la solicitud; el de la persona nunca se
    // necesitó. Por eso ocultar identidad no rompe ninguna acción.
    expect(outgoingRowView(RECIBO_SALIENTE).requestId).toBe('receipt-1');
    expect(outgoingRowView(RECIBO_SALIENTE).requestId).not.toBe(PERSONA.id);
  });
});

describe('solicitud ENTRANTE · sí lleva identidad, y es deliberado', () => {
  /**
   * No es una inconsistencia: quien manda la solicitud elige darse a conocer,
   * y sin nombre el destinatario no puede decidir si aceptar. Lo que no se
   * muestra es a quien todavía no hizo nada.
   */
  it('conserva nombre y payme_id para poder decidir', () => {
    const v = incomingRowView(SOLICITUD_ENTRANTE);
    expect(v.fullName).toBe('Valentina Ríos');
    expect(v.paymeId).toBe('payme_mx_vale');
  });

  it('separa el id de la SOLICITUD del id de la PERSONA', () => {
    // Confundirlos es el bug que en el backend hacía que aceptar diera 404
    // siempre; acá bloquear al usuario equivocado sería peor.
    const v = incomingRowView(SOLICITUD_ENTRANTE);
    expect(v.requestId).toBe('req-1');
    expect(v.userId).toBe('user-abc');
  });
});
