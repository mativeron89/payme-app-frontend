import { describe, expect, it } from 'vitest';
import type { HistoryEntry } from '../api/types';
import { agruparPorMes } from './pagosView';

const pago = (id: string, date: string): HistoryEntry => ({
  id,
  amount_cents: 12345,
  date,
  mesa_code: `PA-${id}`,
  restaurant: 'La Parolaccia',
  category: 'italian',
});

describe('agruparPorMes', () => {
  it('junta los pagos del mismo mes en un solo grupo', () => {
    const g = agruparPorMes([
      pago('1', '2026-08-20T18:00:00.000Z'),
      pago('2', '2026-08-03T18:00:00.000Z'),
      pago('3', '2026-07-28T18:00:00.000Z'),
    ]);
    expect(g.map((x) => x.entries.length)).toEqual([2, 1]);
    expect(g[0]!.entries.map((e) => e.id)).toEqual(['1', '2']);
  });

  /**
   * El orden que manda es el del emisor (`ORDER BY created_at DESC`). Si el
   * agrupado reordenara por su cuenta, el historial dejaría de ser una línea de
   * tiempo — y nadie lo notaría hasta tener dos meses cargados.
   */
  it('conserva el orden en que vienen los meses', () => {
    const g = agruparPorMes([
      pago('1', '2026-08-20T18:00:00.000Z'),
      pago('2', '2026-07-20T18:00:00.000Z'),
      pago('3', '2026-06-20T18:00:00.000Z'),
    ]);
    expect(g.map((x) => x.key)).toEqual(['2026-08', '2026-07', '2026-06']);
  });

  it('no mezcla el mismo mes de años distintos', () => {
    const g = agruparPorMes([
      pago('1', '2026-08-10T18:00:00.000Z'),
      pago('2', '2025-08-10T18:00:00.000Z'),
    ]);
    expect(g.map((x) => x.key)).toEqual(['2026-08', '2025-08']);
    expect(g).toHaveLength(2);
  });

  /**
   * Un pago con fecha ilegible NO se pierde. Es plata que salió de la cuenta de
   * alguien: descartarlo lo convertiría en un "vacío" que no es vacío. Va en su
   * propio grupo y AL FINAL — arriba de todo parecería lo más reciente.
   */
  it('no descarta un pago con fecha ilegible y lo manda al final', () => {
    const g = agruparPorMes([
      pago('roto', 'no-es-una-fecha'),
      pago('1', '2026-08-10T18:00:00.000Z'),
    ]);
    expect(g).toHaveLength(2);
    expect(g[g.length - 1]!.key).toBe('sin-fecha');
    expect(g.flatMap((x) => x.entries).map((e) => e.id).sort()).toEqual(['1', 'roto']);
  });

  it('sin pagos no inventa ningún grupo', () => {
    expect(agruparPorMes([])).toEqual([]);
  });

  it('rotula el mes en español, sin mayúscula propia — la pone el CSS', () => {
    const g = agruparPorMes([pago('1', '2026-08-10T18:00:00.000Z')]);
    expect(g[0]!.label).toContain('agosto');
    expect(g[0]!.label).toContain('2026');
  });
});
