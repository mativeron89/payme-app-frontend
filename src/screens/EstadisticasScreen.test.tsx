import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ConsumoDelMes } from '../api/consumoDelMes';
import { colorDeCocina } from '../utils/coloresDeEstadisticas';
import { MOSTRAR_POR_TIPO_DE_COCINA, TarjetaPorCocina } from './EstadisticasScreen';

/**
 * 🔴 D492 · Mati: «Por tipo de cocina» ponía todo en «Otros» (captura: 21 visitas, 10 restaurantes, 100 % Otros). La
 * tarjeta se oculta detrás de una bandera apagada hasta que la clasificación funcione y él la pruebe (D63). Sin red: se
 * renderiza la tarjeta sola con un mes de dos cocinas.
 */
const MES: ConsumoDelMes = {
  basis: 'consumption',
  totalCents: 100000,
  visits: 3,
  avgPerVisitCents: 33333,
  categories: [
    { category: 'italiana', amountCents: 60000, visits: 2 },
    { category: 'mexicana', amountCents: 40000, visits: 1 },
  ],
};

describe('D492 · «Por tipo de cocina» bajo una bandera apagada', () => {
  it('🔴 la bandera está apagada', () => {
    expect(MOSTRAR_POR_TIPO_DE_COCINA).toBe(false);
  });

  it('🔴 con la bandera apagada (por defecto) la tarjeta no se pinta, aunque el mes traiga cocinas', () => {
    expect(renderToStaticMarkup(<TarjetaPorCocina consumo={MES} />)).toBe('');
  });

  it('con la bandera encendida la tarjeta vuelve: título, una fila por cocina y sus porcentajes', () => {
    const html = renderToStaticMarkup(<TarjetaPorCocina consumo={MES} mostrar />);
    expect(html).toContain('Por tipo de cocina');
    expect(html.match(/<li /g)).toHaveLength(2);
    expect(html).toContain('60%');
    expect(html).toContain('40%');
    // El color de cada cocina sigue saliendo de su color fijo (el mismo de Tus restaurantes).
    for (const c of MES.categories) expect(html).toContain(`background:${colorDeCocina(c.category)}`);
  });

  it('encendida y sin cocinas sigue sin pintarse (el vacío lo dice el resumen)', () => {
    expect(renderToStaticMarkup(<TarjetaPorCocina consumo={{ ...MES, totalCents: 0, visits: 0, avgPerVisitCents: 0, categories: [] }} mostrar />)).toBe('');
  });
});
