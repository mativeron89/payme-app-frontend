import { describe, expect, it } from 'vitest';
import type { InvitacionAViaje } from '../../api/viajes';
import { traducir } from '../../i18n/idioma';
import {
  TIPOS_AVISO_VIAJE,
  destinoDeAvisoDeViaje,
  esAvisoDeViaje,
  estadoDeInvitacionAViaje,
  hayInvitacionAViaje,
  invitacionesPorViaje,
  lineaDeInvitacionAViaje,
  llevaRevisar,
  negritaDeInvitacionAViaje,
  viajeDelAviso,
  type EstadoInvitacionAViaje,
} from './avisosDeViaje';
import type { AppNotification } from '../../api/types';

const V = 'd1000000-0000-4000-8000-000000000005';
const TK = 'd2000000-0000-4000-8000-000000000105';
const es = (s: string, ...a: unknown[]) => traducir(s, 'es', ...a);
const en = (s: string, ...a: unknown[]) => traducir(s, 'en', ...a);

const INV: InvitacionAViaje = {
  viaje_id: V,
  nombre: 'Mazatlán diciembre',
  fecha_desde: '2026-12-18',
  fecha_hasta: '2026-12-22',
  personas: 3,
  invitado_en: '2026-10-09T11:55:00.000Z',
  invitado_por: { first_name: 'Sofía', last_name: 'Ramírez', username: 'sofia.ramirez', eliminada: false },
};
const PENDIENTE: EstadoInvitacionAViaje = { tipo: 'pendiente', invitacion: INV };
const NO_PENDIENTE: EstadoInvitacionAViaje = { tipo: 'no_pendiente' };
const SIN_SABER: EstadoInvitacionAViaje = { tipo: 'sin_saber' };

const aviso = (type: string, payload: Record<string, unknown> | null = { viaje_id: V }) => ({ type, payload });

describe('AF-VIAJES · avisos de viaje · destino', () => {
  it('cada tipo lleva a su pantalla (con Viajes encendido)', () => {
    const d = (type: string, payload?: Record<string, unknown>) => destinoDeAvisoDeViaje(aviso(type, payload), true, NO_PENDIENTE);
    expect(d('viaje_invitation_rejected')).toEqual({ page: 'viaje', param: V });
    expect(d('viaje_ticket_added', { viaje_id: V, ticket_id: TK })).toEqual({ page: 'viaje-ticket', param: `${V}.${TK}` });
    expect(d('viaje_closed')).toEqual({ page: 'viaje', param: V });
    expect(d('viaje_transfer_marked', { viaje_id: V, transferencia_id: 'tr-1' })).toEqual({ page: 'viaje', param: V });
    expect(d('viaje_transfer_not_received', { viaje_id: V, transferencia_id: 'tr-1' })).toEqual({ page: 'viaje', param: V });
    expect(d('viaje_finished')).toEqual({ page: 'viaje-cerrado', param: V });
  });

  it('🔴 sin Viajes, ninguno navega: la fila queda quieta', () => {
    for (const type of TIPOS_AVISO_VIAJE) {
      expect(destinoDeAvisoDeViaje(aviso(type, { viaje_id: V, ticket_id: TK }), false, NO_PENDIENTE), type).toBeNull();
    }
  });

  it('🔴 la invitación: pendiente o sin saber no navega; aceptada ahora o respondida antes, al viaje; rechazada ahora, no', () => {
    const inv = aviso('viaje_invitation_received');
    expect(destinoDeAvisoDeViaje(inv, true, PENDIENTE)).toBeNull();
    expect(destinoDeAvisoDeViaje(inv, true, SIN_SABER)).toBeNull();
    expect(destinoDeAvisoDeViaje(inv, true, NO_PENDIENTE)).toEqual({ page: 'viaje', param: V });
    expect(destinoDeAvisoDeViaje(inv, true, { tipo: 'respondida', respuesta: 'aceptada', invitacion: INV }))
      .toEqual({ page: 'viaje', param: V });
    expect(destinoDeAvisoDeViaje(inv, true, { tipo: 'respondida', respuesta: 'rechazada', invitacion: INV })).toBeNull();
  });

  it('sin viaje_id válido, tipo desconocido o tipo de mesa: no navega', () => {
    expect(destinoDeAvisoDeViaje(aviso('viaje_closed', null), true, NO_PENDIENTE)).toBeNull();
    expect(destinoDeAvisoDeViaje(aviso('viaje_closed', { viaje_id: 42 }), true, NO_PENDIENTE)).toBeNull();
    expect(destinoDeAvisoDeViaje(aviso('viaje_closed', { viaje_id: 'a.b' }), true, NO_PENDIENTE)).toBeNull();
    expect(destinoDeAvisoDeViaje(aviso('viaje_closed', { viaje_id: '../x' }), true, NO_PENDIENTE)).toBeNull();
    expect(destinoDeAvisoDeViaje(aviso('viaje_algo_nuevo'), true, NO_PENDIENTE)).toBeNull();
    expect(destinoDeAvisoDeViaje(aviso('mesa_expired', { viaje_id: V, mesa_code: 'PA-1' }), true, NO_PENDIENTE)).toBeNull();
  });

  it('un ticket nuevo sin ticket_id válido lleva al viaje', () => {
    expect(destinoDeAvisoDeViaje(aviso('viaje_ticket_added', { viaje_id: V }), true, NO_PENDIENTE)).toEqual({ page: 'viaje', param: V });
    expect(destinoDeAvisoDeViaje(aviso('viaje_ticket_added', { viaje_id: V, ticket_id: 'x.y' }), true, NO_PENDIENTE))
      .toEqual({ page: 'viaje', param: V });
  });

  it('«Revisar» sólo en «marcó que te pagó» y sólo si navega', () => {
    expect(llevaRevisar('viaje_transfer_marked', { page: 'viaje', param: V })).toBe(true);
    expect(llevaRevisar('viaje_transfer_marked', null)).toBe(false);
    expect(llevaRevisar('viaje_transfer_not_received', { page: 'viaje', param: V })).toBe(false);
    expect(llevaRevisar('viaje_closed', { page: 'viaje', param: V })).toBe(false);
  });

  it('esAvisoDeViaje por prefijo; las mesas no lo son', () => {
    for (const type of TIPOS_AVISO_VIAJE) expect(esAvisoDeViaje(type), type).toBe(true);
    expect(esAvisoDeViaje('viaje_algo_nuevo')).toBe(true);
    for (const type of ['invitation_received', 'mesa_expired', 'join_request_received', 'transfer_received']) {
      expect(esAvisoDeViaje(type), type).toBe(false);
    }
  });
});

describe('AF-VIAJES · la invitación pendiente', () => {
  it('estado: respondida ahora > pendiente > no pendiente; sin lista, sin saber', () => {
    const lista = invitacionesPorViaje([INV]);
    expect(estadoDeInvitacionAViaje(V, lista, new Map())).toEqual(PENDIENTE);
    expect(estadoDeInvitacionAViaje(V, new Map(), new Map())).toEqual(NO_PENDIENTE);
    expect(estadoDeInvitacionAViaje(V, null, new Map())).toEqual(SIN_SABER);
    expect(estadoDeInvitacionAViaje(null, lista, new Map())).toEqual(SIN_SABER);
    expect(estadoDeInvitacionAViaje(V, lista, new Map([[V, 'aceptada' as const]])))
      .toEqual({ tipo: 'respondida', respuesta: 'aceptada', invitacion: INV });
    expect(estadoDeInvitacionAViaje(V, null, new Map([[V, 'rechazada' as const]])))
      .toEqual({ tipo: 'respondida', respuesta: 'rechazada', invitacion: null });
  });

  it('se piden sólo si la bandeja trae una invitación a un viaje', () => {
    const n = (type: string) => ({ type }) as AppNotification;
    expect(hayInvitacionAViaje(null)).toBe(false);
    expect(hayInvitacionAViaje([n('viaje_closed'), n('invitation_received')])).toBe(false);
    expect(hayInvitacionAViaje([n('viaje_closed'), n('viaje_invitation_received')])).toBe(true);
  });

  it('viajeDelAviso lee payload.viaje_id', () => {
    expect(viajeDelAviso({ payload: { viaje_id: V } })).toBe(V);
    expect(viajeDelAviso({ payload: {} })).toBeNull();
    expect(viajeDelAviso({ payload: null })).toBeNull();
  });
});

describe('AF-VIAJES · la línea debajo del texto (1f, 1t)', () => {
  const ahora = new Date('2026-10-09T12:00:00.000Z');
  const creado = '2026-10-09T11:55:00.000Z';
  // Los espacios de adentro de cada tramo son duros (U+00A0): corta sólo en « · ».
  const linea = (estado: EstadoInvitacionAViaje, idioma: 'es' | 'en') =>
    lineaDeInvitacionAViaje(estado, creado, idioma, idioma === 'es' ? es : en, ahora)?.replace(/\u00a0/g, ' ') ?? null;

  it('🔴 corta sólo entre tramos, nunca adentro de «hace 5 min»', () => {
    const crudo = lineaDeInvitacionAViaje(PENDIENTE, creado, 'es', es, ahora)!;
    expect(crudo.split(' · ')).toEqual(['18–22\u00a0dic', '3\u00a0personas', 'hace\u00a05\u00a0min']);
  });

  it('pendiente: fechas · personas · hace', () => {
    expect(linea(PENDIENTE, 'es')).toBe('18–22 dic · 3 personas · hace 5 min');
    expect(linea(PENDIENTE, 'en')).toBe('Dec 18–22 · 3 people · 5 min ago');
  });

  it('sin fechas, sin el tramo; una persona en singular', () => {
    const solo: EstadoInvitacionAViaje = { tipo: 'pendiente', invitacion: { ...INV, fecha_desde: null, fecha_hasta: null, personas: 1 } };
    expect(linea(solo, 'es')).toBe('1 persona · hace 5 min');
  });

  it('respondida ahora: «Aceptaste» / «Rechazaste»; después, la hora sola', () => {
    expect(linea({ tipo: 'respondida', respuesta: 'aceptada', invitacion: INV }, 'es')).toBe('hace 5 min · Aceptaste');
    expect(linea({ tipo: 'respondida', respuesta: 'rechazada', invitacion: null }, 'en')).toBe('5 min ago · You declined');
    expect(linea(NO_PENDIENTE, 'es')).toBeNull();
    expect(linea(SIN_SABER, 'es')).toBeNull();
  });

  it('el nombre de quien invita en negrita sólo si el body empieza con él', () => {
    const body = 'Sofía Ramírez te invitó al viaje Mazatlán diciembre.';
    expect(negritaDeInvitacionAViaje(body, PENDIENTE, es)).toEqual({ nombre: 'Sofía Ramírez', resto: ' te invitó al viaje Mazatlán diciembre.' });
    expect(negritaDeInvitacionAViaje('Alguien te invitó.', PENDIENTE, es)).toBeNull();
    expect(negritaDeInvitacionAViaje(body, NO_PENDIENTE, es)).toBeNull();
    const baja: EstadoInvitacionAViaje = { tipo: 'pendiente', invitacion: { ...INV, invitado_por: { ...INV.invitado_por!, eliminada: true } } };
    expect(negritaDeInvitacionAViaje(body, baja, es)).toBeNull();
  });
});
