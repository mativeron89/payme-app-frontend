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
      { firstName: 'Ana', lastName: 'Pérez', paymeId: 'payme_ap_x1y2', participantId: null, hasAvatar: false, username: null },
      { firstName: null, lastName: null, paymeId: null, participantId: null, hasAvatar: false, username: null },
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
      { firstName: 'Ana', lastName: 'Pérez', paymeId: 'payme_ap', participantId: 'p-1', hasAvatar: true, username: null },
      { firstName: null, lastName: null, paymeId: null, participantId: 'p-2', hasAvatar: false, username: null },
    ]);
  });

  it('🔴 AF-USERNAME-D104 · v2.139.0 suma `username` (string o null) a CUALQUIERA de las dos formas', () => {
    expect(decodeParticipantes({
      participants: [
        { participant_id: 'p-1', first_name: 'Ana', last_name: 'Pérez', payme_id: 'payme_ap', has_avatar: true, username: 'ana.p' },
        { participant_id: 'p-2', first_name: 'Luis', last_name: 'Cárdenas', payme_id: 'payme_lc', has_avatar: false, username: null },
        { participant_id: 'p-3', first_name: null, last_name: null, payme_id: null, has_avatar: false, username: null },
        { first_name: 'Sol', last_name: 'Ríos', payme_id: 'payme_sr', username: 'sol_rios' },
      ],
    }).map((p) => p.username)).toEqual(['ana.p', null, null, 'sol_rios']);
  });

  it('🔴 AF-USERNAME-D104 · `username` es la ÚNICA clave nueva: con otra de más, o de otro tipo, se rechaza', () => {
    const base = { participant_id: 'p-1', first_name: 'Ana', last_name: 'Pérez', payme_id: 'payme_ap', has_avatar: true };
    for (const malo of [
      { ...base, username: 1 },
      { ...base, username: {} },
      { ...base, username: 'ana.p', email: 'a@b.c' },
      { ...base, usuario: 'ana.p' },
      { first_name: 'Ana', last_name: 'Pérez', username: 'ana.p' },
    ]) {
      expect(() => decodeParticipantes({ participants: [malo] }), JSON.stringify(malo))
        .toThrow('participants_response_malformed');
    }
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
    expect(filaDeParticipante({ firstName: null, lastName: null, paymeId: null, username: null }, true))
      .toEqual({ tipo: 'invitado' });
  });

  it('cuenta eliminada: la forma exacta de la anonimización del dueño', () => {
    expect(filaDeParticipante({ firstName: 'Cuenta', lastName: 'eliminada', paymeId: null, username: null }, true))
      .toEqual({ tipo: 'eliminada' });
  });

  it('un nombre sin identificador NO se vuelve «Cuenta eliminada»', () => {
    expect(filaDeParticipante({ firstName: 'Ana', lastName: 'Pérez', paymeId: null, username: null }, true))
      .toEqual({ tipo: 'persona', nombre: 'Ana Pérez', arroba: null });
    // …ni «Cuenta eliminada» con identificador: sólo la forma completa lo es.
    expect(filaDeParticipante({ firstName: 'Cuenta', lastName: 'eliminada', paymeId: 'payme_x', username: null }, true).tipo)
      .toBe('persona');
  });

  it('🔴 AF-USERNAME-D104 · nombre y, debajo, el @; el `payme_id` no llega a la fila', () => {
    expect(filaDeParticipante({ firstName: 'Ana', lastName: 'Pérez', paymeId: 'payme_ap', username: 'ana.p' }, true))
      .toEqual({ tipo: 'persona', nombre: 'Ana Pérez', arroba: '@ana.p' });
    expect(filaDeParticipante({ firstName: 'Ana', lastName: null, paymeId: 'payme_ap', username: 'ana.p' }, true))
      .toEqual({ tipo: 'persona', nombre: 'Ana', arroba: '@ana.p' });
  });

  it('🔴 AF-USERNAME-D104 · sin @ (null o un dueño anterior), mal formado o apagado: nada, nunca el código', () => {
    const casos: Array<[string | null, boolean]> = [
      [null, true],
      ['Ana Pérez', true],
      ['ab', true],
      ['.ana', true],
      ['ana.p', false],
    ];
    for (const [username, habilitada] of casos) {
      const fila = filaDeParticipante({ firstName: 'Ana', lastName: 'Pérez', paymeId: 'payme_ap', username }, habilitada);
      expect(fila, JSON.stringify([username, habilitada])).toEqual({ tipo: 'persona', nombre: 'Ana Pérez', arroba: null });
      expect(JSON.stringify(fila)).not.toContain('payme_');
    }
  });
});
