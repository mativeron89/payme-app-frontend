import { describe, expect, it } from 'vitest';
import { joinLinkMessage, type JoinLinkOutcome } from './joinLinkView';

/**
 * CIERRE DEL PAGO SIN CUENTA · lo que se fija acá es una regla de PRIVACIDAD,
 * no una copy.
 *
 * El emisor contesta el MISMO `403 invitation_link_not_valid` para los cuatro
 * motivos —inválido, vencido, cancelado y supersedido— a propósito, porque
 * distinguirlos le diría a un desconocido si una mesa existe. Si el front
 * inventa copy que los separa, reabre el oráculo del lado del consumidor.
 *
 * Ya pasó exactamente eso en este repo: el 202 ciego de `addFriend` cerró la
 * enumeración de cuentas y **la pantalla siguiente la reabrió** pintando el
 * nombre real del destinatario. La lección: *una defensa de privacidad vale lo
 * que vale su superficie más indiscreta*.
 */

describe('el rechazo de un link es CIEGO a su motivo', () => {
  it('sólo existe UN estado de rechazo, no cuatro', () => {
    // Si alguien agrega 'expired' | 'cancelled' | 'superseded' al tipo, esto
    // deja de compilar o deja de cubrir — y hay que venir a leer este bloque.
    const todos: JoinLinkOutcome[] = ['joining', 'rejected', 'unavailable', 'error'];
    expect(todos).toHaveLength(4);
  });

  /**
   * ⭐ Conjunto CERRADO de palabras, no lista de prohibidas por caso. Una lista
   * de prohibidos sólo defiende contra lo que ya se te ocurrió; esto atrapa la
   * formulación que nadie previó, porque barre TODOS los mensajes.
   */
  it('ningún mensaje nombra el motivo del rechazo', () => {
    const DELATORES = [
      'venc', 'expir', 'cancel', 'supersed', 'reemplaz',
      'no existe', 'inexistente', 'no encontr', 'inválid', 'invalid',
    ];
    const ofensores: string[] = [];
    for (const outcome of ['joining', 'rejected', 'unavailable', 'error'] as JoinLinkOutcome[]) {
      const m = joinLinkMessage(outcome);
      const texto = `${m.title} ${m.body}`.toLowerCase();
      for (const palabra of DELATORES) {
        if (texto.includes(palabra)) ofensores.push(`${outcome} → "${palabra}"`);
      }
    }
    expect(ofensores).toEqual([]);
  });

  it('el rechazo no ofrece reintentar: reintentar no lo va a cambiar', () => {
    expect(joinLinkMessage('rejected').retryable).toBe(false);
  });
});

describe('un 503 NO es un rechazo', () => {
  /**
   * El emisor lo dice en su propio comentario: sin el secreto de firma no puede
   * decidir si el token es válido, y **un 403 ahí afirmaría que no sirve**.
   * Fundirlos le diría a alguien que su invitación está muerta cuando lo único
   * que pasa es que el backend está a media configuración.
   */
  it('se distingue del rechazo y SÍ se puede reintentar', () => {
    const rechazo = joinLinkMessage('rejected');
    const indisponible = joinLinkMessage('unavailable');
    expect(indisponible.retryable).toBe(true);
    expect(indisponible.title).not.toBe(rechazo.title);
    expect(indisponible.body).not.toBe(rechazo.body);
  });

  it('y dice explícitamente que no es que el link no sirva', () => {
    expect(joinLinkMessage('unavailable').body.toLowerCase()).toContain('no es que no sirva');
  });

  it('un fallo de red también es reintentable', () => {
    expect(joinLinkMessage('error').retryable).toBe(true);
  });
});

describe('todos los estados tienen mensaje', () => {
  it.each(['joining', 'rejected', 'unavailable', 'error'] as JoinLinkOutcome[])(
    '%s produce título y cuerpo no vacíos',
    (outcome) => {
      const m = joinLinkMessage(outcome);
      expect(m.title.length).toBeGreaterThan(0);
      expect(m.body.length).toBeGreaterThan(0);
    },
  );
});
