import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ConsumoDelMes } from '../api/consumoDelMes';
import { traducir } from '../i18n/idioma';
import { colorDeCocina, COLORES_DE_COCINA } from '../utils/coloresDeEstadisticas';
import { nombreDeCocina } from '../utils/textosDeEstadisticas';
import { mostrarPorTipoDeCocina, TarjetaPorCocina } from './EstadisticasScreen';

/**
 * 🔴 D492/D494 M3 · «Por tipo de cocina» vuelve sola cuando al menos el 70 % de las visitas del período tiene cocina
 * reconocida (distinta de `other`), con la regla del dueño (`contract/cocinas-v1.json`, App Backend 2.198.0). Sin red:
 * se renderiza la tarjeta sola.
 */
function mes(categorias: ReadonlyArray<readonly [string, number, number]>): ConsumoDelMes {
  const totalCents = categorias.reduce((s, [, monto]) => s + monto, 0);
  const visits = categorias.reduce((s, [, , v]) => s + v, 0);
  return {
    basis: 'consumption',
    totalCents,
    visits,
    avgPerVisitCents: visits > 0 ? Math.round(totalCents / visits) : 0,
    categories: categorias.map(([category, amountCents, v]) => ({ category, amountCents, visits: v })),
  };
}

const tarjeta = (c: ConsumoDelMes) => renderToStaticMarkup(<TarjetaPorCocina consumo={c} />);

describe('D494 M3 · «Por tipo de cocina» con 70 % de visitas reconocidas', () => {
  it('🔴 69 % reconocidas: no se muestra, sin ningún texto', () => {
    // 69 de 100 visitas con cocina, 31 en Otros.
    const c = mes([['italian', 69000, 69], ['other', 31000, 31]]);
    expect(mostrarPorTipoDeCocina(c)).toBe(false);
    expect(tarjeta(c)).toBe('');
  });

  it('🔴 70 % reconocidas: se muestra, con una fila por cocina y la atribución de OpenStreetMap', () => {
    const c = mes([['italian', 40000, 40], ['spanish', 30000, 30], ['other', 30000, 30]]);
    expect(mostrarPorTipoDeCocina(c)).toBe(true);
    const html = tarjeta(c);
    expect(html).toContain('Por tipo de cocina');
    expect(html.match(/<li /g)).toHaveLength(3);
    expect(html).toContain('Española');
    expect(html).toContain('Cocinas: datos © colaboradores de OpenStreetMap (ODbL)');
    for (const cat of c.categories) expect(html).toContain(`background:${colorDeCocina(cat.category)}`);
  });

  it('🔴 el borde exacto con enteros: 7 de 10 muestra, 69,9 % (699 de 1000) no', () => {
    expect(mostrarPorTipoDeCocina(mes([['mexican', 7000, 7], ['other', 3000, 3]]))).toBe(true);
    expect(mostrarPorTipoDeCocina(mes([['mexican', 69900, 699], ['other', 30100, 301]]))).toBe(false);
    expect(mostrarPorTipoDeCocina(mes([['mexican', 70000, 700], ['other', 30000, 300]]))).toBe(true);
  });

  it('sin `other`, todo reconocido: se muestra; todo en `other`: no', () => {
    expect(mostrarPorTipoDeCocina(mes([['cafe', 5000, 2], ['seafood', 9000, 1]]))).toBe(true);
    const todoOtros = mes([['other', 120000, 21]]);
    expect(mostrarPorTipoDeCocina(todoOtros)).toBe(false);
    expect(tarjeta(todoOtros)).toBe('');
  });

  it('🔴 un mes sin datos no se muestra (ausencia no es cero)', () => {
    const vacio = mes([]);
    expect(vacio.visits).toBe(0);
    expect(mostrarPorTipoDeCocina(vacio)).toBe(false);
    expect(tarjeta(vacio)).toBe('');
  });

  it('🔴 una cocina que el front no conoce cuenta como reconocida (no es `other`), se rotula «Otra cocina» y toma el color de Otros', () => {
    const c = mes([['thai', 50000, 8], ['other', 10000, 2]]);
    expect(mostrarPorTipoDeCocina(c)).toBe(true);
    const html = tarjeta(c);
    expect(html).toContain('Otra cocina');
    expect(html).toContain(`background:${COLORES_DE_COCINA.other}`);
  });
});

describe('D496 · las seis cocinas nuevas de App Backend 2.198.0', () => {
  const NUEVAS = [
    ['spanish', 'Española', 'Spanish'],
    // «Argentina» es también el país (preferencias de región): el diccionario se indexa por el texto en español, así
    // que en EN la cocina queda «Argentina», no «Argentinian».
    ['argentinian', 'Argentina', 'Argentina'],
    ['peruvian', 'Peruana', 'Peruvian'],
    ['chinese', 'China', 'Chinese'],
    ['american', 'Americana', 'American'],
    ['seafood', 'Mariscos', 'Seafood'],
  ] as const;

  it('🔴 cada una con su texto ES y EN', () => {
    for (const [clave, es, en] of NUEVAS) {
      expect(nombreDeCocina(clave, (s) => traducir(s, 'es')), clave).toBe(es);
      expect(nombreDeCocina(clave, (s) => traducir(s, 'en')), clave).toBe(en);
    }
  });

  it('cada una con su color propio: ninguno repetido entre cocinas, y ninguna con el de Otros', () => {
    for (const [clave] of NUEVAS) expect(colorDeCocina(clave), clave).not.toBe(COLORES_DE_COCINA.other);
    const colores = Object.values(COLORES_DE_COCINA);
    expect(new Set(colores).size).toBe(colores.length);
  });

  it('la atribución de OpenStreetMap también en EN', () => {
    expect(traducir('Cocinas: datos © colaboradores de OpenStreetMap (ODbL)', 'en')).toBe('Cuisines: data © OpenStreetMap contributors (ODbL)');
  });
});
