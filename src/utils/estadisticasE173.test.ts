import { describe, expect, it } from 'vitest';
import { colorDeFila, colorEnPaleta, COLORES_ANILLO, GEOMETRIA_2A, GEOMETRIA_E173, porcionesDelAnillo } from './anillo';
import { cocinasTexto, lugaresDistintos, periodoEnFrase } from './textosDeEstadisticas';

/**
 * E173-4 · decisión 173 · las piezas puras de Estadísticas según Claude Design
 * (`PANTALLA-estadisticas.md`). La pantalla la prueba
 * `e2e/estadisticas-anillo.spec.ts`.
 */
const t = (s: string, ...a: unknown[]) => s.replace('{0}', String(a[0]));

describe('E173-4 · el anillo de la especificación', () => {
  it('🔴 r = 74, grosor 20, corte 2 y cuatro colores en orden de monto', () => {
    expect(GEOMETRIA_E173).toEqual({ radio: 74, grosor: 20, corte: 2, colores: ['#0FB5C9', '#101E3B', '#6FD3DE', '#64748B'] });
  });

  it('🔴 con siete cocinas el anillo junta de la cuarta en adelante; las porciones miden su parte menos 2', () => {
    const montos = [400, 300, 200, 50, 30, 15, 5];
    const total = 1000;
    const p = porcionesDelAnillo(montos, GEOMETRIA_E173);
    const c = 2 * Math.PI * 74;
    expect(p.map((x) => x.color)).toEqual(['#0FB5C9', '#101E3B', '#6FD3DE', '#64748B']);
    expect(p[0]!.trazo).toBeCloseTo((400 / total) * c - 2, 6);
    expect(p[3]!.trazo).toBeCloseTo((100 / total) * c - 2, 6);
    expect(p[3]!.desde).toBeCloseTo(-(900 / total) * c, 6);
    for (const x of p) expect(x.trazo + x.hueco).toBeCloseTo(c, 6);
  });

  it('una sola cocina es el anillo entero, sin corte', () => {
    const [unica] = porcionesDelAnillo([500], GEOMETRIA_E173);
    expect(unica).toMatchObject({ color: '#0FB5C9', trazo: 2 * Math.PI * 74, hueco: 0, desde: 0 });
  });

  it('🔴 sin geometría, el anillo de 2c no cambia (las pantallas de detalle no se tocan)', () => {
    expect(porcionesDelAnillo([2, 1])).toEqual(porcionesDelAnillo([2, 1], GEOMETRIA_2A));
    expect(porcionesDelAnillo([2, 1])[0]!.color).toBe(COLORES_ANILLO[0]);
  });

  it('el color de una fila del detalle: de la cuarta en adelante, el cuarto', () => {
    expect([0, 3, 4, 6].map((i) => colorEnPaleta(i, GEOMETRIA_E173.colores))).toEqual(['#0FB5C9', '#64748B', '#64748B', '#64748B']);
    // `colorDeFila` sigue con un solo argumento: `.map(colorDeFila)` le pasa el índice del arreglo.
    expect([4, 5].map(colorDeFila)).toEqual([COLORES_ANILLO[4], COLORES_ANILLO[4]]);
  });
});

describe('E173-4 · los textos', () => {
  it('«20 lugares distintos»; con uno, «1 lugar»', () => {
    expect(lugaresDistintos(20, t)).toBe('20 lugares distintos');
    expect(lugaresDistintos(1, t)).toBe('1 lugar');
  });

  it('el centro del anillo: «cocinas», o «cocina» con una', () => {
    expect(cocinasTexto(4, t)).toBe('cocinas');
    expect(cocinasTexto(1, t)).toBe('cocina');
  });

  it('🔴 el período dentro de una frase: el mes en minúscula en español', () => {
    expect(periodoEnFrase('this_month', 'Octubre', 'es', t)).toBe('octubre');
    expect(periodoEnFrase('last_month', 'Septiembre', 'es', t)).toBe('septiembre');
    expect(periodoEnFrase('this_month', 'October', 'en', t)).toBe('October');
    expect(periodoEnFrase('last_3_months', null, 'es', t)).toBe('los últimos 3 meses');
    expect(periodoEnFrase('this_year', '2026', 'es', t)).toBe('2026');
    expect(periodoEnFrase('this_month', null, 'es', t)).toBe('este mes');
  });
});
