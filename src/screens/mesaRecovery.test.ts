import { describe, expect, it } from 'vitest';
import type { InformativeSelectionResponse, MesaDetail, MesaItem } from '../api/types';
import { consumoConfirmado, lecturaCompatible, mismoBorrador, rechazoDefinitivoSeleccion } from './mesaRecovery';

const plato: MesaItem = {
  id: 'a', name: 'Plato A', category: 'other', price_cents: 10000, quantity: 1,
  status: 'locked', remaining_bps: 0, my_bps: 10000, my_releasable_bps: 10000,
  locked_by_me: true, lock_expires_at: null,
};
const mesa: MesaDetail = {
  id: 'mesa', code: 'PA-423', full_name: 'Mesa inventada',
  restaurant: { id: 'restaurante', name: 'Ejemplo', category: 'other', address: null },
  total_cents: 10000, total_display: '$100', paid_amount_cents: 0, tip_amount_cents: 0,
  tip_base_cents: 5000, division_mode: 'igual', expected_participants: 2, original_participants: 2,
  status: 'open', expires_at: '2099-01-01T00:00:00Z', guarantee_mode: false, closure_reason: null,
  items: [plato], active_staff: [], my_role: 'participant',
};
const propia: InformativeSelectionResponse = {
  contract: 'payme.app.informative-selections/v2',
  mesa: { code: mesa.code, division_mode: 'igual', status: 'open', mutable: true, closure_reason: null },
  selection: { source: 'informative', items: [{ item_id: 'a', declared_fraction_bps: 10000 }], updated_at: null },
  coverage: { all_items_selected: false },
};

describe('n423 · evidencia de recuperación', () => {
  it('requiere el par mesa/propia correspondiente, sin mezclar código ni estado', () => {
    expect(lecturaCompatible(mesa, propia)).toBe(true);
    expect(lecturaCompatible(mesa, { ...propia, mesa: { ...propia.mesa, code: 'PA-otra' } })).toBe(false);
    expect(lecturaCompatible(mesa, { ...propia, mesa: { ...propia.mesa, status: 'expired' } })).toBe(false);
    expect(lecturaCompatible(mesa, { ...propia, mesa: { ...propia.mesa, closure_reason: 'all_items_selected' } })).toBe(false);
    expect(lecturaCompatible(mesa, { ...propia, selection: { ...propia.selection,
      items: [{ item_id: 'inexistente', declared_fraction_bps: 10000 }] } })).toBe(false);
  });

  it('compara mapas por contenido, incluyendo el borrador vacío deliberado', () => {
    expect(mismoBorrador(new Map(), new Map())).toBe(true);
    expect(mismoBorrador(new Map([['a', 5000]]), new Map())).toBe(false);
    expect(mismoBorrador(new Map([['a', 5000], ['b', 10000]]), new Map([['b', 10000], ['a', 5000]]))).toBe(true);
  });

  it('lock incierto sólo queda confirmado con TODOS los propios liberables exactos', () => {
    const intento = new Map([['a', 10000]]);
    expect(consumoConfirmado(mesa, intento)).toBe(true);
    expect(consumoConfirmado(mesa, new Map())).toBe(false);
    expect(consumoConfirmado(mesa, new Map([...intento, ['b', 10000]]))).toBe(false);
    for (const valor of [undefined, null, '10000', 5000, 10001]) {
      expect(consumoConfirmado({ ...mesa, items: [{ ...plato, my_releasable_bps: valor }] }, intento)).toBe(false);
    }
    // Un tercio absorbido no es prueba exacta: queda inconcluso, sin redondear.
    expect(consumoConfirmado({ ...mesa, items: [{ ...plato, my_releasable_bps: 3334 }] }, new Map([['a', 3333]]))).toBe(false);
  });

  it('un código conocido en 5xx no prueba rechazo, ni un 409 desconocido', () => {
    expect(rechazoDefinitivoSeleccion('informative_selection_read_only', 409)).toBe(true);
    expect(rechazoDefinitivoSeleccion('fraction_not_available', 409)).toBe(true);
    expect(rechazoDefinitivoSeleccion('validation_error', 400)).toBe(true);
    for (const status of [null, 408, 425, 429, 500, 503]) {
      expect(rechazoDefinitivoSeleccion('informative_selection_read_only', status)).toBe(false);
    }
    expect(rechazoDefinitivoSeleccion('desconocido', 409)).toBe(false);
  });
});
