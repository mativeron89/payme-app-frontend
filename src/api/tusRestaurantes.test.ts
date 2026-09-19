import { describe, expect, it } from 'vitest';
import { decodeTusRestaurantes, ordenDeCocinas, visitasDelMes } from './tusRestaurantes';

const VISITA = {
  code: 'PA-12345',
  created_at: '2026-09-12T21:30:00.000Z',
  division_mode: 'consumo',
  amount_cents: 9167,
  items: [{ name: 'Plato 0', fraction_bps: 3333, amount_cents: 1167 }],
};

const BUENO = {
  basis: 'consumption',
  month_start: '2026-09-01T00:00:00.000Z',
  total_cents: 15167,
  restaurants: [
    {
      id: 'r-1', name: 'La Parolaccia', category: 'italian', amount_cents: 14167, visits_count: 2,
      visits: [VISITA, { ...VISITA, code: 'PA-2', amount_cents: 5000 }],
    },
    {
      id: 'r-2', name: 'Café Nube', category: 'cafe', amount_cents: 1000, visits_count: 1,
      visits: [{ ...VISITA, code: 'PA-3', division_mode: 'igual', amount_cents: 1000, items: [] }],
    },
  ],
};

const conCambio = (f: (b: typeof BUENO) => unknown) => f(JSON.parse(JSON.stringify(BUENO)));

describe('AF-29 · decodeTusRestaurantes · claves exactas', () => {
  it('lee el ejemplo del handoff del dueño', () => {
    const r = decodeTusRestaurantes(BUENO);
    expect(r.basis).toBe('consumption');
    expect(r.totalCents).toBe(15167);
    expect(r.restaurants[0].visits[0].items[0]).toEqual({ name: 'Plato 0', fractionBps: 3333, amountCents: 1167 });
    expect(r.restaurants[1].visits[0]).toMatchObject({ divisionMode: 'igual', items: [] });
    expect(visitasDelMes(r)).toBe(3);
  });

  it('el mes vacío es válido', () => {
    expect(decodeTusRestaurantes({ ...BUENO, total_cents: 0, restaurants: [] }).restaurants).toEqual([]);
  });

  it('🔴 un campo DE MÁS se rechaza en cualquier nivel: ni otros comensales ni la propina de la mesa', () => {
    for (const malo of [
      conCambio((b) => ({ ...b, extra: 1 })),
      conCambio((b) => { (b.restaurants[0] as Record<string, unknown>).address = 'Roma Norte'; return b; }),
      conCambio((b) => { (b.restaurants[0].visits[0] as Record<string, unknown>).tip_cents = 100; return b; }),
      conCambio((b) => { (b.restaurants[0].visits[0].items[0] as Record<string, unknown>).payer = 'Ana'; return b; }),
    ]) {
      expect(() => decodeTusRestaurantes(malo)).toThrow('stats_restaurants_response_malformed');
    }
  });

  it('🔴 las sumas del dueño se exigen: total = restaurantes, restaurante = visitas, conteo = visitas', () => {
    for (const malo of [
      { ...BUENO, total_cents: 15168 },
      // El total se ajusta junto: así sólo lo caza la suma del RESTAURANTE (mutante C5).
      conCambio((b) => { b.restaurants[0].amount_cents = 14166; b.total_cents = 15166; return b; }),
      conCambio((b) => { b.restaurants[0].visits_count = 3; return b; }),
    ]) {
      expect(() => decodeTusRestaurantes(malo)).toThrow('stats_restaurants_response_malformed');
    }
  });

  it('los platos NO se suman contra la visita: en «payments» la visita incluye la propina', () => {
    const r = decodeTusRestaurantes({ ...BUENO, basis: 'payments' });
    expect(r.restaurants[0].visits[0].amountCents).toBeGreaterThan(r.restaurants[0].visits[0].items[0].amountCents);
  });

  it('basis, modo, fecha o fracción fuera del contrato ⇒ error', () => {
    for (const malo of [
      { ...BUENO, basis: 'spending' },
      { ...BUENO, month_start: 'septiembre' },
      conCambio((b) => { b.restaurants[0].visits[0].division_mode = 'mitad'; return b; }),
      conCambio((b) => { b.restaurants[0].visits[0].created_at = 'ayer'; return b; }),
      conCambio((b) => { b.restaurants[0].visits[0].items[0].fraction_bps = 0; return b; }),
      conCambio((b) => { b.restaurants[0].visits[0].items[0].fraction_bps = 10001; return b; }),
      conCambio((b) => { b.restaurants[1].id = 'r-1'; return b; }),
    ]) {
      expect(() => decodeTusRestaurantes(malo)).toThrow('stats_restaurants_response_malformed');
    }
  });
});

describe('AF-29 · ordenDeCocinas: la misma regla que consumption_month', () => {
  it('monto de mayor a menor, empate por nombre, «other» al final aunque sea el mayor', () => {
    const d = decodeTusRestaurantes({
      basis: 'consumption',
      month_start: '2026-09-01T00:00:00.000Z',
      total_cents: 600,
      restaurants: [
        { id: 'a', name: 'A', category: 'other', amount_cents: 300, visits_count: 1, visits: [{ ...VISITA, amount_cents: 300 }] },
        { id: 'b', name: 'B', category: 'japanese', amount_cents: 100, visits_count: 1, visits: [{ ...VISITA, amount_cents: 100 }] },
        { id: 'c', name: 'C', category: 'cafe', amount_cents: 100, visits_count: 1, visits: [{ ...VISITA, amount_cents: 100 }] },
        { id: 'd', name: 'D', category: 'italian', amount_cents: 100, visits_count: 1, visits: [{ ...VISITA, amount_cents: 100 }] },
      ],
    });
    expect(ordenDeCocinas(d)).toEqual(['cafe', 'italian', 'japanese', 'other']);
  });
});
