import { describe, expect, it } from 'vitest';
import { decodeConsumoDelMes } from './consumoDelMes';

const BUENO = {
  basis: 'consumption',
  total_cents: 19000,
  visits: 2,
  avg_per_visit_cents: 9500,
  categories: [
    { category: 'mexican', amount_cents: 10000, visits: 1 },
    { category: 'italian', amount_cents: 9000, visits: 1 },
  ],
};

describe('AF-26 · decodeConsumoDelMes (consumption_month, opcional)', () => {
  it('lee el ejemplo del handoff del dueño, en su orden', () => {
    expect(decodeConsumoDelMes(BUENO)).toEqual({
      basis: 'consumption',
      totalCents: 19000,
      visits: 2,
      avgPerVisitCents: 9500,
      categories: [
        { category: 'mexican', amountCents: 10000, visits: 1 },
        { category: 'italian', amountCents: 9000, visits: 1 },
      ],
    });
  });

  it('las dos bases del dueño se leen, y cada una conserva su rótulo', () => {
    expect(decodeConsumoDelMes({ ...BUENO, basis: 'payments' })?.basis).toBe('payments');
    expect(decodeConsumoDelMes(BUENO)?.basis).toBe('consumption');
  });

  it('ausente (backend anterior a v2.102.0) ⇒ null: la pantalla de siempre', () => {
    expect(decodeConsumoDelMes(undefined)).toBeNull();
    expect(decodeConsumoDelMes(null)).toBeNull();
  });

  it('🔴 `basis` desconocido falla cerrado: el front no adivina «consumo» o «gasto»', () => {
    for (const basis of ['spending', '', null, undefined, 'CONSUMPTION']) {
      expect(decodeConsumoDelMes({ ...BUENO, basis }), String(basis)).toBeNull();
    }
  });

  it('montos o visitas que no son enteros no negativos ⇒ null', () => {
    for (const cambio of [
      { total_cents: 190.5 }, { total_cents: -1 }, { visits: '2' }, { avg_per_visit_cents: null },
      { categories: {} },
      { categories: [{ category: 'mexican', amount_cents: 19000.5, visits: 1 }] },
      { categories: [{ category: 'mexican', amount_cents: 19000, visits: -1 }] },
    ]) {
      expect(decodeConsumoDelMes({ ...BUENO, ...cambio }), JSON.stringify(cambio)).toBeNull();
    }
  });

  it('🔴 categorías que no suman el total ⇒ null: el anillo diría dos cosas distintas', () => {
    expect(decodeConsumoDelMes({ ...BUENO, total_cents: 19001 })).toBeNull();
  });

  it('una categoría repetida, vacía o en 0 ⇒ null (el dueño no las manda)', () => {
    for (const categories of [
      [{ category: 'mexican', amount_cents: 10000, visits: 1 }, { category: 'mexican', amount_cents: 9000, visits: 1 }],
      [{ category: '', amount_cents: 19000, visits: 2 }],
      [{ category: 'mexican', amount_cents: 19000, visits: 2 }, { category: 'italian', amount_cents: 0, visits: 0 }],
    ]) {
      expect(decodeConsumoDelMes({ ...BUENO, categories }), JSON.stringify(categories)).toBeNull();
    }
  });

  it('una cocina que el front no conoce SÍ se acepta: no apaga la pantalla', () => {
    const r = decodeConsumoDelMes({
      ...BUENO,
      categories: [{ category: 'vegan', amount_cents: 19000, visits: 2 }],
    });
    expect(r?.categories).toEqual([{ category: 'vegan', amountCents: 19000, visits: 2 }]);
  });

  it('un mes vacío es válido: total 0 y sin categorías (la pantalla muestra su vacío)', () => {
    expect(decodeConsumoDelMes({ basis: 'consumption', total_cents: 0, visits: 0, avg_per_visit_cents: 0, categories: [] }))
      .toMatchObject({ totalCents: 0, categories: [] });
  });
});
