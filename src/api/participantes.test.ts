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
      { firstName: 'Ana', lastName: 'Pérez', paymeId: 'payme_ap_x1y2' },
      { firstName: null, lastName: null, paymeId: null },
    ]);
    expect(decodeParticipantes({ participants: [] })).toEqual([]);
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
