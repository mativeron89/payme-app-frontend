import { describe, expect, it } from 'vitest';
import { decodeParticipantes, filaDeParticipante } from './participantes';

describe('AF-25 · decodeParticipantes · claves exactas', () => {
  it('lee la forma del dueño, y una lista vacía es válida', () => {
    expect(decodeParticipantes({
      participants: [
        { first_name: 'Ana', last_name: 'Pérez', payme_id: 'payme_ap_x1y2' },
        { first_name: null, last_name: null, payme_id: null },
      ],
    })).toEqual([
      // La forma de v2.101.0 no trae foto: sin id de fila y sin avatar.
      { firstName: 'Ana', lastName: 'Pérez', paymeId: 'payme_ap_x1y2', participantId: null, hasAvatar: false },
      { firstName: null, lastName: null, paymeId: null, participantId: null, hasAvatar: false },
    ]);
    expect(decodeParticipantes({ participants: [] })).toEqual([]);
  });

  it('🔴 AF-32 · la forma NUEVA (v2.110.0) también se lee: participant_id y has_avatar', () => {
    expect(decodeParticipantes({
      participants: [
        { participant_id: 'p-1', first_name: 'Ana', last_name: 'Pérez', payme_id: 'payme_ap', has_avatar: true },
        { participant_id: 'p-2', first_name: null, last_name: null, payme_id: null, has_avatar: false },
      ],
    })).toEqual([
      { firstName: 'Ana', lastName: 'Pérez', paymeId: 'payme_ap', participantId: 'p-1', hasAvatar: true },
      { firstName: null, lastName: null, paymeId: null, participantId: 'p-2', hasAvatar: false },
    ]);
  });

  it('🔴 AF-32 · la vieja y la nueva conviven fila a fila; una MEZCLA de las dos no', () => {
    expect(decodeParticipantes({
      participants: [
        { first_name: 'Ana', last_name: 'Pérez', payme_id: 'payme_ap' },
        { participant_id: 'p-2', first_name: 'Luis', last_name: 'Cárdenas', payme_id: 'payme_lc', has_avatar: true },
      ],
    }).map((p) => p.hasAvatar)).toEqual([false, true]);
    for (const medio of [
      { participant_id: 'p-1', first_name: 'Ana', last_name: 'Pérez', payme_id: 'payme_ap' },
      { first_name: 'Ana', last_name: 'Pérez', payme_id: 'payme_ap', has_avatar: true },
      { participant_id: '', first_name: 'Ana', last_name: 'Pérez', payme_id: 'payme_ap', has_avatar: true },
      { participant_id: 'p-1', first_name: 'Ana', last_name: 'Pérez', payme_id: 'payme_ap', has_avatar: 'sí' },
    ]) {
      expect(() => decodeParticipantes({ participants: [medio] }), JSON.stringify(medio))
        .toThrow('participants_response_malformed');
    }
  });

  it('🔴 un campo DE MÁS se rechaza: ni foto, ni monto, ni quién eligió qué se cuelan', () => {
    for (const extra of [{ photo: 'x' }, { amount_cents: 100 }, { items: [] }, { email: 'a@b.c' }]) {
      const fila = { first_name: 'Ana', last_name: 'Pérez', payme_id: 'payme_ap', ...extra };
      expect(() => decodeParticipantes({ participants: [fila] }), JSON.stringify(extra))
        .toThrow('participants_response_malformed');
    }
    expect(() => decodeParticipantes({ participants: [], count: 1 })).toThrow('participants_response_malformed');
  });

  it('un campo de menos, un tipo raro o un sobre ajeno también se rechazan', () => {
    for (const malo of [
      null, [], {}, { participants: {} },
      { participants: [{ first_name: 'Ana', last_name: 'Pérez' }] },
      { participants: [{ first_name: 1, last_name: 'Pérez', payme_id: null }] },
      { participants: [null] },
    ]) {
      expect(() => decodeParticipantes(malo), JSON.stringify(malo)).toThrow('participants_response_malformed');
    }
  });
});

describe('AF-25 · qué se muestra de cada persona', () => {
  it('sin cuenta → Invitado', () => {
    expect(filaDeParticipante({ firstName: null, lastName: null, paymeId: null })).toEqual({ tipo: 'invitado' });
  });

  it('cuenta eliminada: la forma exacta de la anonimización del dueño', () => {
    expect(filaDeParticipante({ firstName: 'Cuenta', lastName: 'eliminada', paymeId: null }))
      .toEqual({ tipo: 'eliminada' });
  });

  it('un nombre sin identificador NO se vuelve «Cuenta eliminada»', () => {
    expect(filaDeParticipante({ firstName: 'Ana', lastName: 'Pérez', paymeId: null }))
      .toEqual({ tipo: 'persona', nombre: 'Ana Pérez', paymeId: null });
    // …ni «Cuenta eliminada» con identificador: sólo la forma completa lo es.
    expect(filaDeParticipante({ firstName: 'Cuenta', lastName: 'eliminada', paymeId: 'payme_x' }).tipo)
      .toBe('persona');
  });

  it('nombre, apellido e identificador', () => {
    expect(filaDeParticipante({ firstName: 'Ana', lastName: 'Pérez', paymeId: 'payme_ap' }))
      .toEqual({ tipo: 'persona', nombre: 'Ana Pérez', paymeId: 'payme_ap' });
    expect(filaDeParticipante({ firstName: 'Ana', lastName: null, paymeId: 'payme_ap' }))
      .toEqual({ tipo: 'persona', nombre: 'Ana', paymeId: 'payme_ap' });
  });
});
