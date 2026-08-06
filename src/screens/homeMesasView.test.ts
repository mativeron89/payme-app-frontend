import { describe, expect, it } from 'vitest';
import { etiquetaMasMesas, ordenarPorUrgencia } from './homeMesasView';
import type { OpenMesa } from '../api/types';

/**
 * §1.1 (variante B, 2026-08-05): la protagonista es la de vencimiento MÁS
 * PRÓXIMO, no la más nueva. El payload del contrato viene `created_at DESC`,
 * así que "tomar la primera" era un criterio distinto y silenciosamente
 * equivocado — con el seed actual elegía PA-2847 (+29 min) sobre PA-3121
 * (+12 min), la mesa cuyo reloj de garantía corre más rápido.
 */

function mesa(code: string, expiresInMin: number | 'ilegible'): OpenMesa {
  return {
    id: `id-${code}`,
    code,
    full_name: `Mesa ${code} - Prueba`,
    restaurant: { name: 'Prueba', category: 'other' },
    total_cents: 10000,
    paid_amount_cents: 0,
    pct_paid: 0,
    status: 'open',
    expires_at:
      expiresInMin === 'ilegible'
        ? 'no-es-una-fecha'
        : new Date(Date.now() + expiresInMin * 60_000).toISOString(),
  };
}

describe('ordenarPorUrgencia', () => {
  it('la de vencimiento más próximo va primera, venga donde venga en el payload', () => {
    const r = ordenarPorUrgencia([mesa('LEJOS', 29), mesa('CERCA', 12), mesa('MEDIO', 26)]);
    expect(r.map((m) => m.code)).toEqual(['CERCA', 'MEDIO', 'LEJOS']);
  });

  it('empate exacto conserva el orden del payload (created_at DESC del contrato)', () => {
    const cuando = new Date(Date.now() + 10 * 60_000).toISOString();
    const a = { ...mesa('PRIMERA', 10), expires_at: cuando };
    const b = { ...mesa('SEGUNDA', 10), expires_at: cuando };
    expect(ordenarPorUrgencia([a, b]).map((m) => m.code)).toEqual(['PRIMERA', 'SEGUNDA']);
  });

  it('una fecha ilegible no puede reclamar urgencia: va al final, pero NO se descarta', () => {
    const r = ordenarPorUrgencia([mesa('ROTA', 'ilegible'), mesa('SANA', 20)]);
    expect(r.map((m) => m.code)).toEqual(['SANA', 'ROTA']);
    expect(r).toHaveLength(2);
  });

  it('no muta el array de entrada', () => {
    const entrada = [mesa('B', 20), mesa('A', 10)];
    ordenarPorUrgencia(entrada);
    expect(entrada.map((m) => m.code)).toEqual(['B', 'A']);
  });
});

describe('etiquetaMasMesas', () => {
  it('singular cuando hay exactamente una más — el caso con que la fila estrena', () => {
    expect(etiquetaMasMesas(1)).toBe('+1 mesa abierta más');
  });
  it('plural para el resto', () => {
    expect(etiquetaMasMesas(3)).toBe('+3 mesas abiertas más');
  });
});
