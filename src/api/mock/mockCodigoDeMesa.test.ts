import { afterEach, describe, expect, it, vi } from 'vitest';
import { CODIGO_EJEMPLO, esCodigoDeEjemplo } from '../../ayuda/ejemplo/fixtureEjemplo';
import type { CreateMesaRequest } from '../types';
import { codigoDeMesaDelMock, mockCreateMesa } from './mockApi';
import { MOCK_RESTAURANTS } from './seedData';

/**
 * D363 · enmienda 6 de `d363_front` · el mock nunca genera `PA-1224`, el código de la mesa de ejemplo del tutorial
 * (la fachada envuelta y `App.tsx` lo rechazan sin salir a la red).
 */
describe('mock · el código de una mesa nueva nunca es el de la mesa de ejemplo', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('recorre los 8999 valores posibles: todos distintos, PA-1000…PA-9999 y ninguno es PA-1224', () => {
    const codigos = Array.from({ length: 8999 }, (_, k) => codigoDeMesaDelMock(() => (k + 0.5) / 8999));
    expect(new Set(codigos).size).toBe(8999);
    expect(codigos.every((c) => /^PA-\d{4}$/.test(c))).toBe(true);
    expect(codigos.some((c) => esCodigoDeEjemplo(c))).toBe(false);
    // Control positivo: los vecinos del ejemplo sí salen, y los dos bordes también.
    expect(codigos).toContain('PA-1223');
    expect(codigos).toContain('PA-1225');
    expect(codigos).toContain('PA-1000');
    expect(codigos).toContain('PA-9999');
    expect(CODIGO_EJEMPLO).toBe('PA-1224');
  });

  it('la creación del mock lo usa: con el azar que antes daba PA-1224, la mesa sale con PA-1225', async () => {
    // La fórmula de antes, `floor(azar × 9000 + 1000)`, con este azar daba 1224.
    const azar = 224.5 / 8999;
    expect(Math.floor(azar * 9000 + 1000)).toBe(1224);
    vi.spyOn(Math, 'random').mockReturnValue(azar);
    const request: CreateMesaRequest = {
      restaurant_id: MOCK_RESTAURANTS[0].id,
      total_cents: 30000,
      division_mode: 'consumo',
      expected_participants: 3,
      guarantee_method: 'card',
      idempotency_key: `mock-codigo-de-mesa-${'0'.repeat(8)}`,
      items: [{ name: 'Pizza', price_cents: 30000, quantity: 1 }],
    };
    const creada = await mockCreateMesa(request);
    expect(creada.mesa.code).toBe('PA-1225');
  });
});
