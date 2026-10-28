import { describe, expect, it } from 'vitest';
import { filasDudosas, MAXIMO_DE_FILAS_DUDOSAS, sumasQueCierran, type FilaParaValidar } from './filasDudosas';

/** D509 · la validación de números: marcar, nunca corregir. */

const fila = (precioCents: number | null, cantidad = 1): FilaParaValidar => ({ precioCents, cantidad });
const marcas = (filas: FilaParaValidar[], impreso: number | null, extra: Partial<Parameters<typeof filasDudosas>[0]> = {}) =>
  Object.fromEntries(filasDudosas({ filas, impreso, totales: null, ajustes: null, ...extra }));

describe('D509 · filas dudosas', () => {
  it('🔴 si la cuenta cierra no se marca nada (incluido, IVA agregado, servicio y descuento)', () => {
    expect(marcas([fila(10000), fila(5000)], 15000)).toEqual({});
    // IVA agregado: los platos suman el subtotal.
    expect(marcas([fila(10000)], 11600, { totales: { subtotal_cents: 10000, tax_cents: 1600 } })).toEqual({});
    // Servicio aparte y descuento.
    expect(marcas([fila(10000)], 10500, { ajustes: [{ kind: 'service_charge', amount_cents: 1000 }, { kind: 'discount', amount_cents: 500 }] }))
      .toEqual({});
  });

  /**
   * O2 (auditoría PR105) · una cuenta que cierra no marca nada, aunque alguna fila «explicaría» la otra suma posible.
   * Sin el retorno temprano (medido con él quitado), la fila que vale justo el IVA salía como «repetida» o «cantidad».
   */
  const totalesConIva = { subtotal_cents: 10000, tax_cents: 1600 };
  it('🔴 O2 · cierra con el IVA agregado (los platos suman el subtotal): ninguna fila se marca', () => {
    // 8400 + 1600 = 10000 y el impreso es 11600. Sin el retorno temprano, la de 1600 salía «cantidad».
    expect(marcas([fila(8400), fila(1600)], 11600, { totales: totalesConIva })).toEqual({});
  });

  it('🔴 O2 · cierra con el IVA incluido y una fila vale justo el IVA: no es «repetida»', () => {
    // 10000 + 1600 = 11600, el impreso. Sin el retorno temprano, la de 1600 salía «repetida».
    expect(marcas([fila(10000), fila(1600)], 11600, { totales: totalesConIva })).toEqual({});
  });

  it('🔴 un renglón leído dos veces: la línea vale justo lo que sobra → «repetida»', () => {
    // Tacos 12000, Agua 4000 y otra vez Agua 4000 contra un impreso de 16000: cualquiera de las dos aguas.
    expect(marcas([fila(12000), fila(4000), fila(4000)], 16000)).toEqual({ 1: 'repetida', 2: 'repetida' });
    // Un renglón distinto que vale lo que sobra.
    expect(marcas([fila(12000), fila(4000), fila(3000)], 16000)).toEqual({ 2: 'repetida' });
  });

  it('🔴 la cantidad mal leída: cambiándola cierra → «cantidad»', () => {
    // Cerveza 4500 × 3 leída, eran 2: sobran 4500... pero la línea entera no es lo que sobra.
    expect(marcas([fila(20000), fila(4500, 3)], 29000)).toEqual({ 1: 'cantidad' });
    // Falta una unidad: 2 leídas, eran 3.
    expect(marcas([fila(20000), fila(4500, 2)], 33500)).toEqual({ 1: 'cantidad' });
  });

  it('🔴 un dígito de más o de menos en el precio → «precio»', () => {
    // 1850 leído como 18500.
    expect(marcas([fila(20000), fila(18500)], 21850)).toEqual({ 1: 'precio' });
    // 9500 leído como 950.
    expect(marcas([fila(20000), fila(950)], 29500)).toEqual({ 1: 'precio' });
  });

  it('🔴 una línea que vale más que todo el ticket → «imposible»', () => {
    expect(marcas([fila(1000), fila(500000)], 2000)).toMatchObject({ 1: 'imposible' });
  });

  it('nada se corrige: la función sólo devuelve índices y motivos', () => {
    const filas = [fila(12000), fila(4000), fila(4000)];
    const copia = JSON.stringify(filas);
    filasDudosas({ filas, impreso: 16000, totales: null, ajustes: null });
    expect(JSON.stringify(filas)).toBe(copia);
  });

  it('sin total impreso, con filas incompletas o sin filas: nada que marcar', () => {
    expect(marcas([fila(1000), fila(1000)], null)).toEqual({});
    expect(marcas([fila(1000), fila(null)], 5000)).toEqual({});
    expect(marcas([], 5000)).toEqual({});
  });

  it('🔴 si la diferencia la explican muchas filas, no se marca ninguna (el aviso del total alcanza)', () => {
    const iguales = Array.from({ length: MAXIMO_DE_FILAS_DUDOSAS + 1 }, () => fila(2000));
    // Sobran 2000 y cualquiera de las cuatro podría ser la repetida.
    expect(marcas(iguales, 2000 * MAXIMO_DE_FILAS_DUDOSAS)).toEqual({});
  });

  it('las sumas que cierran: incluido y, con IVA, también agregado', () => {
    expect(sumasQueCierran(11600, { subtotal_cents: 10000, tax_cents: 1600 }, null)).toEqual([11600, 10000]);
    expect(sumasQueCierran(10000, null, [{ kind: 'discount', amount_cents: 500 }])).toEqual([10500]);
  });
});
