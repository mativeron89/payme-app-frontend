import { describe, expect, it } from 'vitest';
import { joinLinkMessage, joinLinkStage, type JoinLinkOutcome } from './joinLinkView';

const OUTCOMES: JoinLinkOutcome[] = ['joining', 'rejected', 'invalid', 'mesa_cerrada', 'unavailable', 'error'];

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
    // v2.45.0 agregó 'mesa_cerrada' y ESTE bloque se vino a leer: NO es un
    // quinto motivo del 403 — es otro STATUS (410), que sólo llega con token
    // validado como genuino. El rechazo ciego sigue siendo UNO.
    const todos: JoinLinkOutcome[] = ['joining', 'rejected', 'invalid', 'mesa_cerrada', 'unavailable', 'error'];
    expect(todos).toHaveLength(6);
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
    for (const outcome of OUTCOMES) {
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

describe('ORDEN 3A · el 400 es TERMINAL, no un problema de conexión', () => {
  /**
   * Antes el 400 caía en `error`, y `error` ofrece reintentar. Eso **invita a
   * reintentos engañosos**: un link truncado al copiarlo de WhatsApp no se
   * arregla reintentando, y cada reintento le sugiere a la persona que podría
   * estar por funcionar.
   */
  it('no ofrece reintentar', () => {
    expect(joinLinkMessage('invalid').retryable).toBe(false);
  });

  it('no habla de conexión ni de red', () => {
    const m = joinLinkMessage('invalid');
    const texto = `${m.title} ${m.body}`.toLowerCase();
    for (const palabra of ['conexión', 'conexion', 'red', 'internet', 'servidor']) {
      expect(texto).not.toContain(palabra);
    }
  });

  /**
   * Es un rechazo pero NO se funde con `rejected`: acá el defecto está en el
   * link que la persona tiene en la mano y eso SÍ se puede accionar. Y sigue
   * sin revelar nada de la mesa, que es la regla que no se negocia.
   */
  it('se distingue del rechazo ciego y tampoco revela nada de la mesa', () => {
    expect(joinLinkMessage('invalid').title).not.toBe(joinLinkMessage('rejected').title);
    const texto = JSON.stringify(joinLinkMessage('invalid')).toLowerCase();
    for (const palabra of ['mesa no', 'no existe', 'restaurante', 'organizador ya']) {
      expect(texto).not.toContain(palabra);
    }
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

/**
 * SPEC_APP.md §1.2 · qué pantalla se muestra. Lo que se fija acá NO es layout:
 * es que el orden de las ramas conserve la política de privacidad del cierre
 * del pago sin cuenta.
 */
describe('§1.2 · sin sesión no se ve NADA de la mesa', () => {
  it('cualquiera sea el resultado del canje, sin sesión la pantalla es el alta', () => {
    // Incluye los terminales: ni siquiera el motivo del rechazo se le muestra a
    // alguien sin sesión. Si esta rama se moviera debajo del switch de outcome,
    // un 403 pintaría el cartel de rechazo antes del alta.
    for (const outcome of OUTCOMES) {
      expect(joinLinkStage({ hasSession: false, hasJoined: false, outcome })).toBe('signup');
    }
  });

  it('el canje exitoso manda, y es el ÚNICO estado con permiso de nombrar la mesa', () => {
    expect(joinLinkStage({ hasSession: true, hasJoined: true, outcome: 'joining' })).toBe('joined');
  });

  it('ninguna otra etapa es la del canje: el nombre del restaurante no se filtra', () => {
    for (const outcome of OUTCOMES) {
      expect(joinLinkStage({ hasSession: true, hasJoined: false, outcome })).not.toBe('joined');
      expect(joinLinkStage({ hasSession: false, hasJoined: false, outcome })).not.toBe('joined');
    }
  });
});

describe('§1.2 · ninguna pantalla queda sin salida', () => {
  /**
   * Regla dura que se conserva de la versión vieja del spec: el repo ya
   * documenta el bug donde alguien quedaba atrapado en una vista de solo
   * lectura. Terminal → círculo de salida; reintentable → Reintentar.
   */
  it('los terminales van al bloque con círculo de salida', () => {
    expect(joinLinkStage({ hasSession: true, hasJoined: false, outcome: 'rejected' })).toBe('blocked');
    expect(joinLinkStage({ hasSession: true, hasJoined: false, outcome: 'invalid' })).toBe('blocked');
    expect(joinLinkStage({ hasSession: true, hasJoined: false, outcome: 'mesa_cerrada' })).toBe('blocked');
  });

  it('los reintentables ofrecen reintentar, no una salida ciega', () => {
    expect(joinLinkStage({ hasSession: true, hasJoined: false, outcome: 'unavailable' })).toBe('retry');
    expect(joinLinkStage({ hasSession: true, hasJoined: false, outcome: 'error' })).toBe('retry');
  });

  it('la etapa se deriva de `retryable`, no de una segunda tabla que se desincronice', () => {
    for (const outcome of OUTCOMES) {
      if (outcome === 'joining') continue;
      const etapa = joinLinkStage({ hasSession: true, hasJoined: false, outcome });
      expect(etapa).toBe(joinLinkMessage(outcome).retryable ? 'retry' : 'blocked');
    }
  });
});

describe('todos los estados tienen mensaje', () => {
  it.each(OUTCOMES)(
    '%s produce título y cuerpo no vacíos',
    (outcome) => {
      const m = joinLinkMessage(outcome);
      expect(m.title.length).toBeGreaterThan(0);
      expect(m.body.length).toBeGreaterThan(0);
    },
  );
});

describe('§1.2-D · la mesa muerta con token genuino (v2.45.0)', () => {
  /**
   * El 410 NO se funde con el rechazo ciego, a propósito: el 403 protege al
   * desconocido (no acredita que la mesa exista); el 410 sólo llega después
   * de validar el token, así que decir "esta mesa ya cerró" no regala el
   * oráculo que el 403 paga.
   */
  it('tiene copy propia y dice que ES esta mesa — no el link — lo que murió', () => {
    const m = joinLinkMessage('mesa_cerrada');
    expect(m.title).toBe('Esta mesa ya cerró');
    expect(m.body).toBe('Habla con quien te invitó si crees que es un error.');
    expect(m.retryable).toBe(false);
  });

  it('se distingue del rechazo ciego: no comparten ni título ni cuerpo', () => {
    const d = joinLinkMessage('mesa_cerrada');
    const b = joinLinkMessage('rejected');
    expect(d.title).not.toBe(b.title);
    expect(d.body).not.toBe(b.body);
  });

  it('cierra el círculo del recién registrado: la nota de cuenta-lista existe SOLO aquí', () => {
    // Diseño (2026-08-06): la explicación del Inicio vacío vive en la
    // pantalla que sabe qué pasó — Inicio no adivina. Y ninguna otra pantalla
    // la necesita: sus caminos no nacen de un alta hecha para este link.
    expect(joinLinkMessage('mesa_cerrada').nota).toBe(
      'Tu cuenta ya está lista — puedes abrir tu propia mesa cuando quieras.',
    );
    for (const outcome of ['joining', 'rejected', 'invalid', 'unavailable', 'error'] as const) {
      expect(joinLinkMessage(outcome).nota).toBeUndefined();
    }
  });

  it('sin nombrar restaurante: la cautela de A se conserva', () => {
    const m = joinLinkMessage('mesa_cerrada');
    expect(`${m.title} ${m.body} ${m.nota}`).not.toMatch(/Parolaccia|Hanzo|restaurante/i);
  });
});
