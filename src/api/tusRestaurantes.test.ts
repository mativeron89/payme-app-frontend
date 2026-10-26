import { describe, expect, it } from 'vitest';
import { decodeTusRestaurantes, rutaDeTusRestaurantes, visitasDelMes } from './tusRestaurantes';

const VISITA = {
  code: 'PA-12345',
  created_at: '2026-09-12T21:30:00.000Z',
  division_mode: 'consumo',
  amount_cents: 9167,
  items: [{ name: 'Plato 0', fraction_bps: 3333, amount_cents: 1167 }],
  // D260 · con `stats_version=2`: una mesa, `null`.
  viaje_id: null as string | null,
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
    expect(r.restaurants[0].visits[0].items[0]).toEqual({ name: 'Plato 0', fractionBps: 3333, amountCents: 1167, quantity: null });
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

describe('🔴 D260 · `stats_version=2`: el viaje de cada visita (App Backend 2.176.0)', () => {
  const VIAJE = 'd1000000-0000-4000-8000-000000000001';
  const TICKET = 'd2000000-0000-4000-8000-000000000105';


  it('una mesa: `null`; un ticket de viaje: el id del viaje, y `code` es el del ticket', () => {
    const r = decodeTusRestaurantes(conCambio((b) => {
      b.restaurants[0].visits[1] = { ...b.restaurants[0].visits[1]!, code: TICKET, viaje_id: VIAJE };
      return b;
    }));
    expect(r.restaurants[0].visits[0]!.viajeId).toBeNull();
    expect(r.restaurants[0].visits[1]).toMatchObject({ code: TICKET, viajeId: VIAJE });
  });

  it('🔴 sin `viaje_id` (la forma de antes) o con otro tipo: no se acepta', () => {
    for (const malo of [
      conCambio((b) => { delete (b.restaurants[0].visits[0] as Record<string, unknown>).viaje_id; return b; }),
      conCambio((b) => { (b.restaurants[0].visits[0] as Record<string, unknown>).viaje_id = ''; return b; }),
      conCambio((b) => { (b.restaurants[0].visits[0] as Record<string, unknown>).viaje_id = 7; return b; }),
      conCambio((b) => { (b.restaurants[0].visits[0] as Record<string, unknown>).viaje_id = { id: VIAJE }; return b; }),
    ]) {
      expect(() => decodeTusRestaurantes(malo)).toThrow('stats_restaurants_response_malformed');
    }
  });
});

describe('🔴 D479/D482 · AF-2 · `stats_version=3`: la cantidad de la línea (App Backend 2.195.0)', () => {
  const conCantidad = (q: unknown, q2: unknown = q) => conCambio((b) => {
    (b.restaurants[0].visits[0].items[0] as Record<string, unknown>).quantity = q;
    b.restaurants[0].visits[1]!.items = [{ name: 'Agua mineral', fraction_bps: 10000, amount_cents: 5000, quantity: q2 } as never];
    return b;
  });

  it('la app lo pide siempre (la 3 incluye el `viaje_id` de la 2), con el período o sin él', () => {
    expect(rutaDeTusRestaurantes()).toBe('/account/stats/restaurants?stats_version=3');
    expect(rutaDeTusRestaurantes('last_month')).toBe('/account/stats/restaurants?period=last_month&stats_version=3');
  });

  it('negociada: lee `quantity` de cada ítem, entero ≥ 1 o `null` (ticket de viaje)', () => {
    const r = decodeTusRestaurantes(conCantidad(2, null), { negociado: true });
    expect(r.restaurants[0].visits[0].items[0]).toEqual({ name: 'Plato 0', fractionBps: 3333, amountCents: 1167, quantity: 2 });
    expect(r.restaurants[0].visits[1].items[0]!.quantity).toBeNull();
  });

  it('un dueño anterior contesta la 2: negociada igual se acepta, con `quantity` en `null`', () => {
    const r = decodeTusRestaurantes(BUENO, { negociado: true });
    expect(r.restaurants[0].visits[0].items[0]!.quantity).toBeNull();
  });

  it('🔴 sin negociar, un ítem con `quantity` se rechaza: no lo pidió nadie', () => {
    expect(() => decodeTusRestaurantes(conCantidad(2))).toThrow('stats_restaurants_response_malformed');
  });

  it('🔴 negociada: una respuesta mezclada o una cantidad fuera del contrato se rechaza', () => {
    for (const malo of [
      // el primer ítem la trae y otro no
      conCambio((b) => {
        (b.restaurants[0].visits[0].items[0] as Record<string, unknown>).quantity = 1;
        b.restaurants[0].visits[1]!.items = [{ name: 'Agua', fraction_bps: 10000, amount_cents: 5000 } as never];
        return b;
      }),
      // el primer ítem no la trae y otro sí
      conCambio((b) => {
        b.restaurants[0].visits[1]!.items = [{ name: 'Agua', fraction_bps: 10000, amount_cents: 5000, quantity: 1 } as never];
        return b;
      }),
      conCantidad(0),
      conCantidad(1.5),
      conCantidad('2'),
      conCantidad(-1),
    ]) {
      expect(() => decodeTusRestaurantes(malo, { negociado: true }), JSON.stringify(malo).slice(0, 60)).toThrow('stats_restaurants_response_malformed');
    }
  });
});
