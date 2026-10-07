import { describe, expect, it } from 'vitest';
import {
  CLAVE_SOLICITUD_PENDIENTE,
  codigoDeLasCeldas,
  decodeCancelarSolicitud,
  decodeDecisionDelTitular,
  decodePedirUnirse,
  decodeSolicitudesDeLaMesa,
  decodeSolicitudPropia,
  guardarSolicitud,
  leerSolicitud,
  olvidarSolicitud,
  quienPide,
  venceEn,
  vencio,
} from './joinRequests';

/**
 * D219 · D223 · el contrato `mesa-join-requests/v1` del dueño (App Backend
 * 2.166.0, `contract-mirror/contract/mesa-join-requests-v1.json`): claves
 * EXACTAS en cada respuesta. Los negativos llevan señuelos (datos de la mesa,
 * foto, correo) que NO pueden pasar el decoder: es la privacidad de este lado
 * (P01, P04, P08 de las pruebas de aceptación de Codex).
 */

const ID = 'a1000000-0000-4000-8000-000000000001';
const VENCE = '2026-10-07T21:00:00.000Z';

describe('el código de las celdas (X01)', () => {
  it('«PA-» y cinco números, con el cero inicial', () => {
    expect(codigoDeLasCeldas('12345')).toBe('PA-12345');
    expect(codigoDeLasCeldas('01234')).toBe('PA-01234');
  });

  it('menos de cinco, letras o de más: nada', () => {
    for (const c of ['', '1234', '123456', '12a45', ' 12345']) expect(codigoDeLasCeldas(c)).toBeNull();
  });
});

describe('POST /api/join-requests', () => {
  it('201/200 pendiente: id, status y expires_at, nada más', () => {
    expect(decodePedirUnirse({ id: ID, status: 'pending', expires_at: VENCE })).toEqual({ kind: 'pendiente', id: ID, expiresAt: VENCE });
  });

  it('200 ya adentro: status y mesa_code', () => {
    expect(decodePedirUnirse({ status: 'already_participant', mesa_code: 'PA-12345' })).toEqual({ kind: 'ya_adentro', mesaCode: 'PA-12345' });
  });

  it('🔴 P01 · un pendiente con datos de la mesa (señuelos) se rechaza entero', () => {
    for (const extra of [
      { restaurant: 'Señuelo' },
      { total_cents: 424242 },
      { mesa_code: 'PA-12345' },
      { opener: { first_name: 'Luis' } },
      { participants: [] },
    ]) {
      expect(() => decodePedirUnirse({ id: ID, status: 'pending', expires_at: VENCE, ...extra }), JSON.stringify(extra)).toThrow();
    }
  });

  it('🔴 P08 · formas rotas: sin expires_at, fecha inválida, status desconocido, id vacío', () => {
    for (const raw of [
      { id: ID, status: 'pending' },
      { id: ID, status: 'pending', expires_at: 'mañana' },
      { id: ID, status: 'aceptado', expires_at: VENCE },
      { id: '', status: 'pending', expires_at: VENCE },
      { status: 'already_participant' },
      { status: 'already_participant', mesa_code: 'PA-1', id: ID },
      null,
      [],
      'pending',
    ]) {
      expect(() => decodePedirUnirse(raw), JSON.stringify(raw)).toThrow();
    }
  });
});

describe('GET /api/join-requests/:id', () => {
  it('cada estado con sus claves; mesa_code SÓLO en accepted', () => {
    for (const status of ['pending', 'rejected', 'cancelled', 'expired'] as const) {
      expect(decodeSolicitudPropia({ id: ID, status, expires_at: VENCE }, ID)).toEqual({ id: ID, status, expiresAt: VENCE });
    }
    expect(decodeSolicitudPropia({ id: ID, status: 'accepted', expires_at: VENCE, mesa_code: 'PA-12345' }, ID))
      .toEqual({ id: ID, status: 'accepted', expiresAt: VENCE, mesaCode: 'PA-12345' });
  });

  it('🔴 P08 · mesa_code antes de tiempo, accepted sin mesa_code, o una clave de más: se rechaza', () => {
    expect(() => decodeSolicitudPropia({ id: ID, status: 'pending', expires_at: VENCE, mesa_code: 'PA-12345' }, ID)).toThrow();
    expect(() => decodeSolicitudPropia({ id: ID, status: 'accepted', expires_at: VENCE }, ID)).toThrow();
    expect(() => decodeSolicitudPropia({ id: ID, status: 'rejected', expires_at: VENCE, reason: 'x' }, ID)).toThrow();
    expect(() => decodeSolicitudPropia({ id: ID, status: 'pending', expires_at: VENCE, restaurant: 'Señuelo' }, ID)).toThrow();
  });

  it('🔴 P08 · la respuesta de OTRO pedido no se aplica', () => {
    expect(() => decodeSolicitudPropia({ id: 'otro', status: 'accepted', expires_at: VENCE, mesa_code: 'PA-1' }, ID)).toThrow();
  });
});

describe('POST /api/join-requests/:id/cancel', () => {
  it('{id, status: cancelled} del mismo id', () => {
    expect(() => decodeCancelarSolicitud({ id: ID, status: 'cancelled' }, ID)).not.toThrow();
  });

  it('otro id, otro estado o una clave de más: se rechaza', () => {
    expect(() => decodeCancelarSolicitud({ id: 'otro', status: 'cancelled' }, ID)).toThrow();
    expect(() => decodeCancelarSolicitud({ id: ID, status: 'accepted' }, ID)).toThrow();
    expect(() => decodeCancelarSolicitud({ id: ID, status: 'cancelled', expires_at: VENCE }, ID)).toThrow();
  });
});

describe('GET /api/mesas/:code/join-requests (el titular)', () => {
  const fila = (id: string, requester: Record<string, unknown>) => ({ id, requester, created_at: VENCE, expires_at: VENCE });

  it('nombre, apellido y @ (o null), en el orden del dueño', () => {
    const r = decodeSolicitudesDeLaMesa({
      join_requests: [
        fila('a', { first_name: 'Ana', last_name: 'López', username: 'ana.lopez' }),
        fila('b', { first_name: 'Sofía', last_name: 'Torres', username: null }),
      ],
    });
    expect(r.map((s) => s.id)).toEqual(['a', 'b']);
    expect(r[1]!.requester).toEqual({ firstName: 'Sofía', lastName: 'Torres', username: null });
  });

  it('una lista vacía es vacía', () => {
    expect(decodeSolicitudesDeLaMesa({ join_requests: [] })).toEqual([]);
  });

  it('🔴 P04 · foto, correo, teléfono o ids dentro de requester: se rechaza la lista entera', () => {
    for (const extra of [{ avatar_url: 'x' }, { email: 'x' }, { phone: 'x' }, { id: 'x' }, { payme_id: 'x' }]) {
      expect(() => decodeSolicitudesDeLaMesa({
        join_requests: [fila('a', { first_name: 'Ana', last_name: 'López', username: null, ...extra })],
      }), JSON.stringify(extra)).toThrow();
    }
  });

  it('claves de más en la fila o en la respuesta, ids repetidos, tipos raros: se rechaza', () => {
    expect(() => decodeSolicitudesDeLaMesa({ join_requests: [], total: 1 })).toThrow();
    expect(() => decodeSolicitudesDeLaMesa({
      join_requests: [{ ...fila('a', { first_name: 'A', last_name: 'B', username: null }), status: 'pending' }],
    })).toThrow();
    expect(() => decodeSolicitudesDeLaMesa({
      join_requests: [fila('a', { first_name: 'A', last_name: 'B', username: null }), fila('a', { first_name: 'C', last_name: 'D', username: null })],
    })).toThrow();
    expect(() => decodeSolicitudesDeLaMesa({
      join_requests: [fila('a', { first_name: 7, last_name: 'B', username: null })],
    })).toThrow();
  });
});

describe('aceptar y rechazar', () => {
  it('{id, status} del mismo id y con el estado pedido', () => {
    expect(() => decodeDecisionDelTitular({ id: ID, status: 'accepted' }, ID, 'accepted')).not.toThrow();
    expect(() => decodeDecisionDelTitular({ id: ID, status: 'rejected' }, ID, 'rejected')).not.toThrow();
  });

  it('otro id, el estado contrario o claves de más: se rechaza', () => {
    expect(() => decodeDecisionDelTitular({ id: 'otro', status: 'accepted' }, ID, 'accepted')).toThrow();
    expect(() => decodeDecisionDelTitular({ id: ID, status: 'rejected' }, ID, 'accepted')).toThrow();
    expect(() => decodeDecisionDelTitular({ id: ID, status: 'accepted', participant: {} }, ID, 'accepted')).toThrow();
  });
});

describe('🔴 P05 · quién pide, sin «null» ni paréntesis vacíos', () => {
  it('nombre y @', () => {
    expect(quienPide({ firstName: 'Ana', lastName: 'López', username: 'ana.lopez' })).toEqual({ nombre: 'Ana López', arroba: 'ana.lopez' });
  });

  it('sin @, sin @; sin apellido, sólo el nombre', () => {
    expect(quienPide({ firstName: 'Sofía', lastName: 'Torres', username: null })).toEqual({ nombre: 'Sofía Torres', arroba: null });
    expect(quienPide({ firstName: 'Sofía', lastName: null, username: '  ' })).toEqual({ nombre: 'Sofía', arroba: null });
  });

  it('sin nombre ni apellido: nombre null (la pantalla dice «Alguien»)', () => {
    expect(quienPide({ firstName: null, lastName: '  ', username: null })).toEqual({ nombre: null, arroba: null });
  });
});

describe('X03 · «Vence en mm:ss», orientativo y nunca negativo', () => {
  const base = Date.parse(VENCE);
  it('cuenta hacia atrás desde expires_at', () => {
    expect(venceEn(VENCE, base - 900_000)).toBe('15:00');
    expect(venceEn(VENCE, base - 61_000)).toBe('01:01');
    expect(venceEn(VENCE, base - 999)).toBe('00:00');
  });

  it('pasado el vencimiento queda en 00:00, y `vencio` lo dice', () => {
    expect(venceEn(VENCE, base + 5_000)).toBe('00:00');
    expect(vencio(VENCE, base)).toBe(true);
    expect(vencio(VENCE, base - 1)).toBe(false);
    expect(vencio('roto', base)).toBe(true);
  });
});

/** Un `localStorage` de mentira, con un modo que tira en todo. */
function almacen(tira = false) {
  const m = new Map<string, string>();
  const f = <T,>(fn: () => T): T => { if (tira) throw new Error('bloqueado'); return fn(); };
  return {
    getItem: (k: string) => f(() => m.get(k) ?? null),
    setItem: (k: string, v: string) => f(() => { m.set(k, v); }),
    removeItem: (k: string) => f(() => { m.delete(k); }),
    m,
  };
}

describe('X06 · lo guardado: id, código y cuenta, nada de la mesa', () => {
  const guardada = { cuenta: 'cuenta-1', id: ID, codigo: 'PA-01234' };

  it('se guarda y se lee con la misma cuenta', () => {
    const a = almacen();
    guardarSolicitud(guardada, a);
    expect(JSON.parse(a.m.get(CLAVE_SOLICITUD_PENDIENTE)!)).toEqual(guardada);
    expect(leerSolicitud('cuenta-1', a)).toEqual(guardada);
  });

  it('🔴 P09 · con otra cuenta no se usa, y se borra', () => {
    const a = almacen();
    guardarSolicitud(guardada, a);
    expect(leerSolicitud('cuenta-2', a)).toBeNull();
    expect(a.m.has(CLAVE_SOLICITUD_PENDIENTE)).toBe(false);
  });

  it('basura o claves de más: se descarta', () => {
    for (const raw of ['{', '[]', JSON.stringify({ ...guardada, restaurante: 'x' }), JSON.stringify({ ...guardada, codigo: 'PA-1' })]) {
      const a = almacen();
      a.m.set(CLAVE_SOLICITUD_PENDIENTE, raw);
      expect(leerSolicitud('cuenta-1', a), raw).toBeNull();
    }
  });

  it('un almacenamiento que tira no rompe nada', () => {
    const a = almacen(true);
    expect(() => guardarSolicitud(guardada, a)).not.toThrow();
    expect(leerSolicitud('cuenta-1', a)).toBeNull();
    expect(() => olvidarSolicitud(a)).not.toThrow();
  });
});
