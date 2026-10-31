import { describe, expect, it } from 'vitest';
import type { MesaDetail, MesaItem } from '../api/types';
import { estadoDeLaMesa } from './estadoDeLaMesaView';

/**
 * D622 · AF-2 · mejora 2 (§2 de la especificación), SIN el conteo de personas:
 * la tarjeta del estado de la mesa, con su frase, los platos sin dueño y un
 * consejo. «Se sumaron N de M» espera el contrato de AB-1 (AF-4): acá no se
 * inventa ningún conteo. Todo sale del agregado de la mesa, sin identidad ni
 * montos por persona (D628–D631).
 */
const t = (s: string, ...a: unknown[]) => s.replace(/\{(\d+)\}/g, (_, i: string) => String(a[Number(i)]));

function item(over: Partial<MesaItem> = {}): MesaItem {
  return {
    id: 'i1', name: 'Plato', category: 'main', price_cents: 10000, quantity: 1, status: 'available',
    remaining_bps: 10000, my_bps: 0, locked_by_me: false, lock_expires_at: null, ...over,
  };
}

/** Una mesa de $840 sin garantía, por consumo, abierta: cuatro platos. */
function mesa(over: Partial<MesaDetail> = {}): MesaDetail {
  return {
    id: 'm1', code: 'PA-1', full_name: 'Mesa PA-1',
    restaurant: { id: 'r1', name: 'Tacos El Güero', category: 'mexican', address: null },
    total_cents: 84000, total_display: '$840.00', paid_amount_cents: 0, tip_amount_cents: 0, tip_base_cents: 0,
    division_mode: 'consumo', expected_participants: 4, original_participants: 4, status: 'open',
    expires_at: '2026-11-01T00:00:00.000Z',
    items: [
      item({ id: 'a', price_cents: 25500 }),
      item({ id: 'b', price_cents: 30000 }),
      item({ id: 'c', price_cents: 18500 }),
      item({ id: 'd', price_cents: 10000 }),
    ],
    active_staff: [], my_role: 'opener', guarantee_mode: false, ...over,
  };
}
const conElegidos = (restantes: Record<string, number>) => mesa().items.map((i) => ({ ...i, remaining_bps: restantes[i.id] ?? i.remaining_bps }));
const ORG = { esOrganizador: true, ejemplo: false };
const OTRO = { esOrganizador: false, ejemplo: false };

describe('estadoDeLaMesa · las líneas', () => {
  it('🔴 nadie eligió: «Todavía no eligió nadie», sin la línea de platos', () => {
    expect(estadoDeLaMesa(mesa(), OTRO, t)).toEqual({
      titular: 'Todavía no eligió nadie',
      platos: null,
      consejo: 'Cuando se elija todo, la mesa se cierra sola.',
    });
  });

  it('🔴 en curso: cuánto falta de cuánto, y cuántos platos sin dueño', () => {
    expect(estadoDeLaMesa(mesa({ items: conElegidos({ a: 0 }) }), ORG, t)).toEqual({
      titular: 'Falta elegir $585 de $840',
      platos: 'Quedan 3 platos sin dueño.',
      consejo: 'Antes de cerrar la mesa, revisa que todos hayan elegido lo suyo.',
    });
  });

  it('singular: «Queda 1 plato sin dueño.»', () => {
    const r = estadoDeLaMesa(mesa({ items: conElegidos({ a: 0, b: 0, c: 0 }) }), ORG, t);
    expect(r?.titular).toBe('Falta elegir $100 de $840');
    expect(r?.platos).toBe('Queda 1 plato sin dueño.');
  });

  it('🔴 a medias: se nombra aparte, sólo si hay', () => {
    expect(estadoDeLaMesa(mesa({ items: conElegidos({ a: 0, b: 5000 }) }), ORG, t)?.platos)
      .toBe('Quedan 2 platos sin dueño y 1 a medias.');
    expect(estadoDeLaMesa(mesa({ items: conElegidos({ a: 0, b: 0, c: 5000 }) }), ORG, t)?.platos)
      .toBe('Queda 1 plato sin dueño y 1 a medias.');
    expect(estadoDeLaMesa(mesa({ items: conElegidos({ a: 5000, b: 5000 }) }), ORG, t)?.platos)
      .toBe('Quedan 2 platos sin dueño y 2 a medias.');
    expect(estadoDeLaMesa(mesa({ items: conElegidos({ a: 5000, b: 5000, c: 0 }) }), ORG, t)?.platos)
      .toBe('Queda 1 plato sin dueño y 2 a medias.');
  });

  it('🔴 todos con dueño pero alguno a medias: dice cuántos quedan a medias, nunca «0 sin dueño» (m3 de E06, AF-3)', () => {
    const r = estadoDeLaMesa(mesa({ items: conElegidos({ a: 0, b: 0, c: 0, d: 5000 }) }), ORG, t);
    expect(r?.titular).toBe('Falta elegir $50 de $840');
    expect(r?.platos).toBe('Queda 1 plato a medias.');
    expect(estadoDeLaMesa(mesa({ items: conElegidos({ a: 0, b: 0, c: 5000, d: 5000 }) }), ORG, t)?.platos)
      .toBe('Quedan 2 platos a medias.');
    expect(r?.platos).not.toMatch(/sin dueño/);
  });

  it('🔴 el consejo: el organizador revisa antes de cerrar; el resto sabe que se cierra sola', () => {
    const m = mesa({ items: conElegidos({ a: 0 }) });
    expect(estadoDeLaMesa(m, ORG, t)?.consejo).toBe('Antes de cerrar la mesa, revisa que todos hayan elegido lo suyo.');
    expect(estadoDeLaMesa(m, OTRO, t)?.consejo).toBe('Cuando se elija todo, la mesa se cierra sola.');
  });

  it('🔴 nunca nombra a nadie ni dice cuántos se sumaron (eso espera AB-1)', () => {
    const r = estadoDeLaMesa(mesa({ items: conElegidos({ a: 0 }) }), ORG, t)!;
    expect(Object.keys(r).sort()).toEqual(['consejo', 'platos', 'titular']);
    expect(JSON.stringify(r)).not.toMatch(/sumaron|de 4/);
  });
});

describe('estadoDeLaMesa · cuándo no hay tarjeta', () => {
  it('🔴 la mesa de ejemplo de la guía (D367): la guía no promete', () => {
    expect(estadoDeLaMesa(mesa(), { esOrganizador: true, ejemplo: true }, t)).toBeNull();
  });

  it('🔴 en partes iguales no (queda fuera de esta entrega)', () => {
    expect(estadoDeLaMesa(mesa({ division_mode: 'igual' }), ORG, t)).toBeNull();
  });

  it.each(['pending_auth', 'expired', 'fully_paid', 'cancelled'] as const)('mesa %s: sin tarjeta', (status) => {
    expect(estadoDeLaMesa(mesa({ status }), ORG, t)).toBeNull();
  });

  it('partially_paid sigue abierta: con tarjeta', () => {
    expect(estadoDeLaMesa(mesa({ status: 'partially_paid' }), ORG, t)).not.toBeNull();
  });

  it('🔴 con garantía no (la mesa no se cierra sola por selección)', () => {
    expect(estadoDeLaMesa(mesa({ guarantee_mode: true }), ORG, t)).toBeNull();
    expect(estadoDeLaMesa(mesa({ guarantee_mode: undefined }), ORG, t)).toBeNull();
  });

  it('🔴 un reparto que no se puede calcular: sin tarjeta (falla cerrado)', () => {
    expect(estadoDeLaMesa(mesa({ items: conElegidos({ a: 10001 }) }), ORG, t)).toBeNull();
    expect(estadoDeLaMesa(mesa({ total_cents: -1 }), ORG, t)).toBeNull();
  });

  it('los platos no suman el total de la mesa: sin tarjeta (no se afirma «falta»)', () => {
    expect(estadoDeLaMesa(mesa({ total_cents: 90000 }), ORG, t)).toBeNull();
  });

  it('todo elegido: sin tarjeta (la mesa se está cerrando sola)', () => {
    expect(estadoDeLaMesa(mesa({ items: conElegidos({ a: 0, b: 0, c: 0, d: 0 }) }), ORG, t)).toBeNull();
  });
});
