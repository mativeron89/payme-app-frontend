import { describe, expect, it } from 'vitest';
import {
  PALETA_DE_FICHAS, colorDeFicha, contraste, fichasALaVista, otrosEligieron, personasDeLaMesa, quienEligioDelPlato,
  textoDeQuienEligio,
} from './quienEligioView';

/**
 * D622 · mejora 3 (§3 de la especificación) · D628 · D639 · quién eligió cada
 * plato, con iniciales. Sólo lo de la mesa: nunca el nombre ni montos.
 */
const t = (s: string, ...a: unknown[]) => s.replace(/\{(\d+)\}/g, (_, i: string) => String(a[Number(i)]));
const f = (ordinal: number, initials: string, mine = false) => ({ ordinal, initials, mine });

describe('textoDeQuienEligio', () => {
  it('🔴 una, dos, tres y seis personas', () => {
    expect(textoDeQuienEligio({ fichas: [f(1, 'AM')], mas: 0 }, t)).toBe('Lo eligió AM');
    expect(textoDeQuienEligio({ fichas: [f(1, 'AM'), f(2, 'LP')], mas: 0 }, t)).toBe('Lo eligieron AM y LP');
    expect(textoDeQuienEligio({ fichas: [f(1, 'AM'), f(2, 'LP'), f(3, 'JR')], mas: 0 }, t)).toBe('Lo eligieron AM, LP y 1 más');
    const seis = [f(1, 'AM'), f(2, 'LP'), f(3, 'JR'), f(4, 'SF'), f(5, 'MR'), f(6, 'L')];
    expect(textoDeQuienEligio({ fichas: seis, mas: 0 }, t)).toBe('Lo eligieron AM, LP y 4 más');
    expect(textoDeQuienEligio({ fichas: seis, mas: 3 }, t)).toBe('Lo eligieron AM, LP y 7 más');
  });

  it('🔴 quien mira se nombra «tú», nunca con sus iniciales', () => {
    expect(textoDeQuienEligio({ fichas: [f(0, 'MV', true), f(1, 'AM')], mas: 0 }, t)).toBe('Lo eligieron tú y AM');
    expect(textoDeQuienEligio({ fichas: [f(1, 'AM'), f(2, 'MV', true)], mas: 0 }, t)).toBe('Lo eligieron AM y tú');
  });

  it('en EN, «you» al principio va con mayúscula', async () => {
    const { traducir } = await import('../i18n/idioma');
    const en = (es: string, ...a: unknown[]) => traducir(es, 'en', ...a);
    expect(textoDeQuienEligio({ fichas: [f(0, 'MV', true), f(1, 'AM')], mas: 0 }, en)).toBe('You and AM picked it');
    expect(textoDeQuienEligio({ fichas: [f(1, 'AM'), f(2, 'MV', true)], mas: 0 }, en)).toBe('AM and you picked it');
    expect(textoDeQuienEligio({ fichas: [f(1, 'AM'), f(2, 'LP'), f(3, 'JR')], mas: 0 }, en)).toBe('AM, LP and 1 more picked it');
  });

  it('una cuenta eliminada o sin cuenta va con «?», como la manda el dueño', () => {
    expect(textoDeQuienEligio({ fichas: [f(3, '?')], mas: 0 }, t)).toBe('Lo eligió ?');
  });

  it('sin nadie, sin texto', () => {
    expect(textoDeQuienEligio({ fichas: [], mas: 0 }, t)).toBeNull();
  });
});

describe('otrosEligieron · cuándo hay fichas en el plato', () => {
  it('🔴 sólo si alguien que no es quien mira tiene una parte', () => {
    expect(otrosEligieron({ fichas: [f(1, 'AM')], mas: 0 })).toBe(true);
    expect(otrosEligieron({ fichas: [f(0, 'MV', true)], mas: 0 })).toBe(false);
    expect(otrosEligieron({ fichas: [], mas: 0 })).toBe(false);
    expect(otrosEligieron(null)).toBe(false);
    expect(otrosEligieron(undefined)).toBe(false);
  });
});

describe('fichasALaVista', () => {
  it('🔴 hasta 3 y «+N» con el resto (los que no entraron y los que el dueño no mandó)', () => {
    const cuatro = [f(1, 'AM'), f(2, 'LP'), f(3, 'JR'), f(4, 'SF')];
    expect(fichasALaVista({ fichas: cuatro, mas: 0 }, 3)).toEqual({ visibles: cuatro.slice(0, 3), resto: 1 });
    expect(fichasALaVista({ fichas: cuatro, mas: 5 }, 3)).toEqual({ visibles: cuatro.slice(0, 3), resto: 6 });
    expect(fichasALaVista({ fichas: cuatro.slice(0, 2), mas: 0 }, 3)).toEqual({ visibles: cuatro.slice(0, 2), resto: 0 });
  });
});

describe('colorDeFicha · el color no lleva significado', () => {
  it('🔴 sale del orden de llegada, de una paleta de 8, y no cambia el texto', () => {
    expect(PALETA_DE_FICHAS).toHaveLength(8);
    expect(new Set(PALETA_DE_FICHAS).size).toBe(8);
    for (let o = 0; o < 20; o++) expect(colorDeFicha(o)).toBe(PALETA_DE_FICHAS[o % 8]);
    expect(textoDeQuienEligio({ fichas: [f(1, 'AM')], mas: 0 }, t)).toBe(textoDeQuienEligio({ fichas: [f(9, 'AM')], mas: 0 }, t));
  });

  it('🔴 contraste: las iniciales en blanco sobre cada color, ≥ 4.5:1; el color contra el fondo blanco, ≥ 3:1', () => {
    for (const c of PALETA_DE_FICHAS) {
      expect(contraste('#ffffff', c), c).toBeGreaterThanOrEqual(4.5);
      // Los fondos donde va una ficha: la tarjeta (--surface), el renglón «Lo eligió otro» (--danger-l) y el propio (--teal-l).
      for (const fondo of ['#ffffff', '#fbe7e3', '#e4f7f8']) expect(contraste(c, fondo), `${c} sobre ${fondo}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('contraste conocido: negro sobre blanco es 21', () => {
    expect(contraste('#000000', '#ffffff')).toBeCloseTo(21, 5);
  });
});

describe('personasDeLaMesa · «Se sumaron N de M» (mejora 2)', () => {
  const lista = (n: number) => Array.from({ length: n }, (_, i) => f(i, 'A', i === 0));

  it('🔴 «Se sumaron 3 de 4», con las tres fichas y un «?» por el que falta', () => {
    expect(personasDeLaMesa({ joinedCount: 3, expectedCount: 4, fichas: lista(3), mas: 0 }, t)).toEqual({
      texto: 'Se sumaron 3 de 4', fichas: lista(3), faltan: 1, resto: 0,
    });
  });

  it('sin esperados (mesa vieja): no hay línea; no se inventa un conteo', () => {
    expect(personasDeLaMesa({ joinedCount: 3, expectedCount: null, fichas: lista(3), mas: 0 }, t)).toBeNull();
    expect(personasDeLaMesa(null, t)).toBeNull();
    expect(personasDeLaMesa(undefined, t)).toBeNull();
  });

  it('🔴 máximo 8 círculos entre fichas y «?», y «+N» con el resto', () => {
    expect(personasDeLaMesa({ joinedCount: 3, expectedCount: 20, fichas: lista(3), mas: 0 }, t)).toEqual({
      texto: 'Se sumaron 3 de 20', fichas: lista(3), faltan: 5, resto: 12,
    });
    expect(personasDeLaMesa({ joinedCount: 14, expectedCount: 14, fichas: lista(12), mas: 2 }, t)).toEqual({
      texto: 'Se sumaron 14 de 14', fichas: lista(8), faltan: 0, resto: 6,
    });
  });

  it('más de los esperados: el texto dice lo que hay y no hay «?»', () => {
    expect(personasDeLaMesa({ joinedCount: 5, expectedCount: 4, fichas: lista(5), mas: 0 }, t)).toEqual({
      texto: 'Se sumaron 5 de 4', fichas: lista(5), faltan: 0, resto: 0,
    });
  });
});

describe('quienEligioDelPlato · cuándo un renglón lleva fichas', () => {
  const plato = (over: Record<string, unknown> = {}) => ({ id: 'a', picked_by: [f(1, 'AM')], picked_by_more: 0, ...over });
  const CONSUMO = { esConsumo: true, ejemplo: false };

  it('🔴 por consumo, con otro que eligió: las fichas del dueño', () => {
    expect(quienEligioDelPlato(plato(), CONSUMO)).toEqual({ fichas: [f(1, 'AM')], mas: 0 });
  });

  it('🔴 en partes iguales no hay dueño de un plato (D79): sin fichas', () => {
    expect(quienEligioDelPlato(plato(), { esConsumo: false, ejemplo: false })).toBeNull();
  });

  it('🔴 la mesa de ejemplo de la guía: sin fichas (no usa datos de otros)', () => {
    expect(quienEligioDelPlato(plato(), { esConsumo: true, ejemplo: true })).toBeNull();
  });

  it('🔴 sin el dato, en null (invitación sin aceptar) o mal formado: sin fichas, rige «Lo eligió otro»', () => {
    expect(quienEligioDelPlato({ id: 'a' }, CONSUMO)).toBeNull();
    expect(quienEligioDelPlato(plato({ picked_by: null, picked_by_more: null }), CONSUMO)).toBeNull();
    expect(quienEligioDelPlato(plato({ picked_by: [{ ...f(1, 'AM'), user_id: 'u' }] }), CONSUMO)).toBeNull();
  });

  it('sólo quien mira: sin fichas', () => {
    expect(quienEligioDelPlato(plato({ picked_by: [f(0, 'MV', true)] }), CONSUMO)).toBeNull();
  });
});
