import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { leerEligieron, leerMiembros } from './miembros';

/**
 * D622 · D628 · AF-4 · el decodificador propio de «los de la mesa»
 * (`contract-mirror/contract/mesa-miembros-v1.json`, App Backend 2.210.0).
 *
 * Falla CERRADO y nunca lanza: una forma que no cumple el contrato cuenta como
 * ausente (`undefined`) y la pantalla queda como hoy («Lo eligió otro», sin «Se
 * sumaron N de M»). `null` es lo que manda el dueño a propósito: invitación sin
 * aceptar o lectura fallida.
 */

const CONTRATO = JSON.parse(readFileSync(resolve(__dirname, '../../contract-mirror/contract/mesa-miembros-v1.json'), 'utf8')) as {
  lectura: { ejemplo: { mesa: { members: unknown; items: Array<Record<string, unknown>> } }; topes: { list: number; picked_by: number } };
};

const ficha = (ordinal: number, initials: string, mine = false) => ({ ordinal, initials, mine });
const miembros = (over: Record<string, unknown> = {}) => ({
  joined_count: 3, expected_count: 4, list: [ficha(0, 'MV', true), ficha(1, 'AM'), ficha(2, 'LP')], list_more: 0, ...over,
});

describe('leerMiembros', () => {
  it('🔴 lee el ejemplo del contrato espejado tal cual', () => {
    expect(leerMiembros({ members: CONTRATO.lectura.ejemplo.mesa.members })).toEqual({
      joinedCount: 3,
      expectedCount: 4,
      fichas: [ficha(0, 'MV', true), ficha(1, 'AM'), ficha(2, 'LP')],
      mas: 0,
    });
  });

  it('sin la clave: undefined (el dueño viejo o sin negociar)', () => {
    expect(leerMiembros({})).toBeUndefined();
    expect(leerMiembros(null)).toBeUndefined();
    expect(leerMiembros('mesa')).toBeUndefined();
  });

  it('🔴 en null (invitación sin aceptar o lectura fallida): null', () => {
    expect(leerMiembros({ members: null })).toBeNull();
  });

  it('expected_count en null (mesa vieja) se conserva en null', () => {
    expect(leerMiembros({ members: miembros({ expected_count: null }) })?.expectedCount).toBeNull();
  });

  it('🔴 una forma rara cuenta como ausente: claves de más o de menos, tipos, topes', () => {
    const raros: unknown[] = [
      miembros({ extra: 1 }),
      (() => { const m: Record<string, unknown> = miembros(); delete m.list_more; return m; })(),
      miembros({ joined_count: 0 }),
      miembros({ joined_count: 2.5 }),
      miembros({ joined_count: '3' }),
      miembros({ expected_count: 0 }),
      miembros({ expected_count: 51 }),
      miembros({ list_more: -1 }),
      miembros({ list: 'MV' }),
      miembros({ list: Array.from({ length: CONTRATO.lectura.topes.list + 1 }, (_, i) => ficha(i, 'A')) }),
      miembros({ list: [ficha(0, 'MV'), ficha(0, 'AM')] }),
      miembros({ list: [ficha(1, 'MV'), ficha(0, 'AM')] }),
      miembros({ joined_count: 2 }),
      miembros({ list: [ficha(0, 'MV', true), ficha(1, 'AM', true)] }),
      [],
    ];
    for (const r of raros) expect(leerMiembros({ members: r }), JSON.stringify(r)).toBeUndefined();
  });

  it('list + list_more tiene que ser joined_count, y list_more > 0 sólo con la lista llena', () => {
    const doce = Array.from({ length: 12 }, (_, i) => ficha(i, 'A', i === 0));
    expect(leerMiembros({ members: miembros({ joined_count: 15, list: doce, list_more: 3 }) })).toEqual({
      joinedCount: 15, expectedCount: 4, fichas: doce, mas: 3,
    });
    expect(leerMiembros({ members: miembros({ joined_count: 15, list: doce, list_more: 2 }) })).toBeUndefined();
    expect(leerMiembros({ members: miembros({ joined_count: 5, list_more: 2 }) })).toBeUndefined();
  });
});

describe('leerEligieron · una ficha', () => {
  const plato = (picked_by: unknown, picked_by_more: unknown = 0) => ({ id: 'a', picked_by, picked_by_more });

  it('🔴 lee el plato del ejemplo del contrato', () => {
    expect(leerEligieron(CONTRATO.lectura.ejemplo.mesa.items[0])).toEqual({ fichas: [ficha(1, 'AM')], mas: 0 });
  });

  it('sin las claves: undefined; las dos en null: null; un plato sin partes tomadas: []', () => {
    expect(leerEligieron({ id: 'a' })).toBeUndefined();
    expect(leerEligieron(plato(null, null))).toBeNull();
    expect(leerEligieron(plato([]))).toEqual({ fichas: [], mas: 0 });
  });

  it('🔴 iniciales: 1 o 2 letras Unicode en NFC, o «?»; nunca un nombre', () => {
    for (const ok of ['M', 'MV', 'ÁÑ', 'ß', 'ΣΩ', '?']) {
      expect(leerEligieron(plato([ficha(0, ok)])), ok).toEqual({ fichas: [ficha(0, ok)], mas: 0 });
    }
    for (const no of ['', 'MVR', 'Matías', 'M.', 'M1', '??', ' M', 'Á', 'MV ', '<b>']) {
      expect(leerEligieron(plato([ficha(0, no)])), JSON.stringify(no)).toBeUndefined();
    }
  });

  it('🔴 una ficha con algo más que ordinal, initials y mine no se lee (nada de user_id ni nombres)', () => {
    expect(leerEligieron(plato([{ ...ficha(0, 'AM'), user_id: 'u1' }]))).toBeUndefined();
    expect(leerEligieron(plato([{ ...ficha(0, 'AM'), first_name: 'Ana' }]))).toBeUndefined();
    expect(leerEligieron(plato([{ ordinal: 0, initials: 'AM' }]))).toBeUndefined();
  });

  it('formas raras: una sola de las dos claves, tope, orden, tipos', () => {
    const raros: unknown[] = [
      { id: 'a', picked_by: [ficha(0, 'AM')] },
      { id: 'a', picked_by_more: 0 },
      plato(null, 0),
      plato([ficha(0, 'AM')], null),
      plato([ficha(0, 'AM')], -1),
      plato(Array.from({ length: CONTRATO.lectura.topes.picked_by + 1 }, (_, i) => ficha(i, 'A'))),
      plato([ficha(2, 'AM'), ficha(1, 'LP')]),
      plato([ficha(-1, 'AM')]),
      plato([ficha(0, 'AM', 'si' as unknown as boolean)]),
      plato([ficha(0, 'AM')], 1),
    ];
    for (const r of raros) expect(leerEligieron(r), JSON.stringify(r)).toBeUndefined();
  });

  it('con 6 fichas, picked_by_more puede sumar más', () => {
    const seis = Array.from({ length: 6 }, (_, i) => ficha(i, 'A'));
    expect(leerEligieron(plato(seis, 2))).toEqual({ fichas: seis, mas: 2 });
  });
});
