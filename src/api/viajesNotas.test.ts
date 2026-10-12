import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HttpError } from './http';
import { MockApiError } from './mock/mockApi';
import { CONTRATO_VIAJES } from './viajes';
import { decodeEscrituraDeNotas, decodePizarron, errorDeNotas, largoDeNota, LIMITES_DE_NOTAS } from './viajesNotas';

/**
 * 🔴 D290 · el pizarrón de notas contra el contrato del dueño (App Backend 2.183.0): claves exactas, `contract` exacto, las
 * reglas que el dueño promete (el mío primero, `total` y `escribieron`, sólo abierto se escribe) y los errores tipados.
 */
const CONTRATO = JSON.parse(readFileSync(new URL('../../contract-mirror/contract/viajes-v1.json', import.meta.url), 'utf8')) as {
  notas: { limites: Record<string, number>; caracteres: string };
  limites: { notas: Record<string, number> };
  rutas: Record<string, { respuestas: Record<string, Record<string, unknown>> }>;
};

const VIAJE = '0e000000-0000-4000-8000-000000000001';
const persona = (nombre: string) => ({ first_name: nombre, last_name: 'Pérez', username: null, eliminada: false });
const en = '2026-10-12T03:00:00.000Z';
const notaDe = (id: string, texto = 'Hola') => ({ id, tipo: 'nota', texto, version: 1, creado_en: en, actualizado_en: en });
const listaDe = (id: string) => ({ id, tipo: 'lista', titulo: 'Súper', items: [{ id: `${id}-i`, texto: 'Hielo', tildado: true }],
  version: 2, creado_en: en, actualizado_en: en });
const apartado = (miembro: string, yo: boolean, entradas: unknown[] = []) => ({
  miembro_id: miembro, ...persona(miembro), has_avatar: false, es_yo: yo, actualizado_en: entradas.length > 0 ? en : null, entradas,
});
const pizarron = (cambios: Record<string, unknown> = {}) => ({
  viaje_id: VIAJE, nombre: 'Cancún', estado: 'abierto', cerrado_en: null, editable: true, total: 2, escribieron: 1,
  limites: LIMITES_DE_NOTAS, apartados: [apartado('m1', true, [notaDe('n1'), listaDe('n2')]), apartado('m2', false)], ...cambios,
});
const cuerpo = (p: unknown) => ({ contract: CONTRATO_VIAJES, pizarron: p });

describe('🔴 D290 · el pizarrón: claves exactas y las reglas del dueño', () => {
  it('las claves son las del contrato (`GET /api/viajes/:id/notas`), y los límites, los suyos', () => {
    const claves = CONTRATO.rutas['GET /api/viajes/:id/notas']!.respuestas['200']!.pizarron as string[];
    expect(Object.keys(pizarron()).sort()).toEqual([...claves].sort());
    expect(LIMITES_DE_NOTAS).toEqual(CONTRATO.notas.limites);
    expect(LIMITES_DE_NOTAS).toEqual(CONTRATO.limites.notas);
    const p = decodePizarron(cuerpo(pizarron()), VIAJE);
    expect(p.apartados.map((a) => [a.miembro_id, a.es_yo, a.entradas.map((e) => e.tipo)])).toEqual([['m1', true, ['nota', 'lista']], ['m2', false, []]]);
  });

  it('falla cerrado: otro contrato, otro viaje, una clave de más o de menos en cualquier nivel', () => {
    expect(() => decodePizarron({ contract: 'otro/v1', pizarron: pizarron() }, VIAJE)).toThrow();
    expect(() => decodePizarron(cuerpo(pizarron()), '0e000000-0000-4000-8000-000000000002')).toThrow();
    expect(() => decodePizarron(cuerpo({ ...pizarron(), saldo: 0 }), VIAJE)).toThrow();
    expect(() => decodePizarron({ ...cuerpo(pizarron()), extra: 1 }, VIAJE)).toThrow();
    const conDeMas = pizarron({ apartados: [{ ...apartado('m1', true), email: 'x@y.z' }, apartado('m2', false)] });
    expect(() => decodePizarron(cuerpo(conDeMas), VIAJE)).toThrow();
    const notaConDeMas = pizarron({ apartados: [apartado('m1', true, [{ ...notaDe('n1'), autor: 'm1' }]), apartado('m2', false)] });
    expect(() => decodePizarron(cuerpo(notaConDeMas), VIAJE)).toThrow();
    const itemConDeMas = pizarron({ apartados: [apartado('m1', true, [{ ...listaDe('n2'), items: [{ id: 'i', texto: 'x', tildado: false, por: 'm2' }] }]), apartado('m2', false)] });
    expect(() => decodePizarron(cuerpo(itemConDeMas), VIAJE)).toThrow();
  });

  it('🔴 el mío primero y una sola vez; `total` son los apartados y `escribieron`, los que tienen algo', () => {
    expect(() => decodePizarron(cuerpo(pizarron({ apartados: [apartado('m2', false), apartado('m1', true, [notaDe('n1')])] })), VIAJE)).toThrow();
    expect(() => decodePizarron(cuerpo(pizarron({ apartados: [apartado('m1', true, [notaDe('n1')]), apartado('m2', true)] })), VIAJE)).toThrow();
    expect(() => decodePizarron(cuerpo(pizarron({ total: 3 })), VIAJE)).toThrow();
    expect(() => decodePizarron(cuerpo(pizarron({ escribieron: 2 })), VIAJE)).toThrow();
    // Sin el mío (una cuenta que dejó de estar): se acepta, sin apartado propio.
    expect(decodePizarron(cuerpo(pizarron({ total: 1, escribieron: 0, apartados: [apartado('m2', false)] })), VIAJE).apartados).toHaveLength(1);
  });

  it('🔴 sólo se escribe con el viaje abierto: `editable` con otro estado no se acepta', () => {
    expect(decodePizarron(cuerpo(pizarron({ estado: 'cerrado', editable: false, cerrado_en: en })), VIAJE).editable).toBe(false);
    expect(() => decodePizarron(cuerpo(pizarron({ estado: 'cerrado', editable: true })), VIAJE)).toThrow();
    expect(() => decodePizarron(cuerpo(pizarron({ estado: 'esperando_pagos', editable: true })), VIAJE)).toThrow();
    expect(() => decodePizarron(cuerpo(pizarron({ estado: 'otro', editable: false })), VIAJE)).toThrow();
  });

  it('cada entrada: texto de 1 a 500; título de 1 a 80; de 1 a 30 ítems de 80, sin ids repetidos; versión ≥ 1', () => {
    const con = (e: unknown) => cuerpo(pizarron({ apartados: [apartado('m1', true, [e]), apartado('m2', false)] }));
    expect(() => decodePizarron(con(notaDe('n', 'a'.repeat(500))), VIAJE)).not.toThrow();
    for (const mala of [
      notaDe('n', ''), notaDe('n', 'a'.repeat(501)), { ...notaDe('n'), version: 0 }, { ...notaDe('n'), tipo: 'foto' },
      { ...listaDe('l'), titulo: 't'.repeat(81) }, { ...listaDe('l'), items: [] },
      { ...listaDe('l'), items: Array.from({ length: 31 }, (_, k) => ({ id: `i${k}`, texto: 'x', tildado: false })) },
      { ...listaDe('l'), items: [{ id: 'i', texto: 'x'.repeat(81), tildado: false }] },
      { ...listaDe('l'), items: [{ id: 'i', texto: 'x', tildado: false }, { id: 'i', texto: 'y', tildado: true }] },
      { ...listaDe('l'), items: [{ id: 'i', texto: 'x', tildado: 'no' }] },
      { ...notaDe('n'), actualizado_en: 'ayer' },
    ]) {
      expect(() => decodePizarron(con(mala), VIAJE), JSON.stringify(mala).slice(0, 80)).toThrow();
    }
  });

  it('`actualizado_en` del apartado: null sin entradas, un instante con entradas; más de 20 entradas, no', () => {
    const sinFecha = { ...apartado('m1', true, [notaDe('n1')]), actualizado_en: null };
    expect(() => decodePizarron(cuerpo(pizarron({ apartados: [sinFecha, apartado('m2', false)] })), VIAJE)).toThrow();
    const conFecha = { ...apartado('m2', false), actualizado_en: en };
    expect(() => decodePizarron(cuerpo(pizarron({ apartados: [apartado('m1', true, [notaDe('n1')]), conFecha] })), VIAJE)).toThrow();
    const veintiuna = Array.from({ length: 21 }, (_, k) => notaDe(`n${k}`));
    expect(() => decodePizarron(cuerpo(pizarron({ apartados: [apartado('m1', true, veintiuna), apartado('m2', false)] })), VIAJE)).toThrow();
  });
});

describe('🔴 D290 · las escrituras devuelven MI apartado', () => {
  const mio = apartado('m1', true, [notaDe('n1')]);

  it('POST: `entrada_id` y el apartado, con la entrada adentro; las demás, sólo el apartado', () => {
    expect(decodeEscrituraDeNotas({ contract: CONTRATO_VIAJES, entrada_id: 'n1', apartado: mio }, true, 'e')).toMatchObject({ entrada_id: 'n1' });
    expect(() => decodeEscrituraDeNotas({ contract: CONTRATO_VIAJES, entrada_id: 'n9', apartado: mio }, true, 'e')).toThrow();
    expect(() => decodeEscrituraDeNotas({ contract: CONTRATO_VIAJES, apartado: mio }, true, 'e')).toThrow();
    expect(decodeEscrituraDeNotas({ contract: CONTRATO_VIAJES, apartado: mio }, false, 'e').entrada_id).toBeNull();
    expect(() => decodeEscrituraDeNotas({ contract: CONTRATO_VIAJES, entrada_id: 'n1', apartado: mio }, false, 'e')).toThrow();
  });

  it('el apartado de otro en una respuesta de escritura no se acepta (nunca se aplica como el mío)', () => {
    expect(() => decodeEscrituraDeNotas({ contract: CONTRATO_VIAJES, apartado: { ...mio, es_yo: false } }, false, 'e')).toThrow();
    expect(() => decodeEscrituraDeNotas({ contract: 'otro/v1', apartado: mio }, false, 'e')).toThrow();
  });
});

describe('🔴 D290 · los errores del dueño, tipados (la orden, punto 6)', () => {
  const mio = apartado('m1', true, [notaDe('n1')]);
  const http = (status: number, body: Record<string, unknown>) => new HttpError(status, body as ConstructorParameters<typeof HttpError>[1]);

  it('cada código, con su tipo; los 409 de concurrencia traen MI apartado', () => {
    expect(errorDeNotas(http(404, { error: 'viaje_nota_not_found' }))).toEqual({ tipo: 'nota_no_encontrada' });
    expect(errorDeNotas(http(404, { error: 'viaje_nota_item_not_found' }))).toEqual({ tipo: 'nota_no_encontrada' });
    expect(errorDeNotas(http(404, { error: 'viaje_not_found' }))).toEqual({ tipo: 'no_disponible' });
    expect(errorDeNotas(http(403, { error: 'viaje_nota_not_yours' }))).toEqual({ tipo: 'no_es_tuya' });
    expect(errorDeNotas(http(403, { error: 'user_suspended' }))).toEqual({ tipo: 'cuenta_suspendida' });
    expect(errorDeNotas(http(409, { error: 'viaje_not_open', estado: 'cerrado' }))).toEqual({ tipo: 'no_abierto' });
    expect(errorDeNotas(http(409, { error: 'viaje_nota_version_conflict', apartado: mio }))).toMatchObject({ tipo: 'otra_version', apartado: { miembro_id: 'm1' } });
    expect(errorDeNotas(http(409, { error: 'viaje_notas_order_mismatch', apartado: mio }))).toMatchObject({ tipo: 'otro_orden', apartado: { es_yo: true } });
    expect(errorDeNotas(http(409, { error: 'idempotency_key_conflict' }))).toEqual({ tipo: 'clave_repetida' });
    expect(errorDeNotas(http(409, { error: 'viaje_notas_limit', limit: 20 }))).toEqual({ tipo: 'tope_de_entradas', limite: 20 });
    expect(errorDeNotas(http(400, { error: 'validation_error', issues: [{ path: 'texto', message: 'texto_max_500' }, { path: 'x', message: 7 }] })))
      .toEqual({ tipo: 'invalido', mensajes: ['texto_max_500'] });
    expect(errorDeNotas(http(422, { error: 'viaje_nota_item_unknown', item_id: 'i' }))).toEqual({ tipo: 'item_desconocido' });
    expect(errorDeNotas(new Error('red'))).toEqual({ tipo: 'reintentar' });
  });

  it('el mock, igual que el dueño (MockApiError)', () => {
    expect(errorDeNotas(new MockApiError(409, 'viaje_nota_version_conflict', { apartado: mio }))).toMatchObject({ tipo: 'otra_version', apartado: { miembro_id: 'm1' } });
    expect(errorDeNotas(new MockApiError(403, 'user_suspended'))).toEqual({ tipo: 'cuenta_suspendida' });
  });

  it('un 409 de versión con un apartado mal formado, o el de otro: `null` (la pantalla vuelve a leer)', () => {
    expect(errorDeNotas(http(409, { error: 'viaje_nota_version_conflict', apartado: { ...mio, es_yo: false } }))).toEqual({ tipo: 'otra_version', apartado: null });
    expect(errorDeNotas(http(409, { error: 'viaje_nota_version_conflict' }))).toEqual({ tipo: 'otra_version', apartado: null });
    // Un tope sin número: el del contrato.
    expect(errorDeNotas(http(409, { error: 'viaje_notas_limit' }))).toEqual({ tipo: 'tope_de_entradas', limite: 20 });
  });
});

describe('«caracteres» como el dueño: el `.length` de JavaScript', () => {
  it('un emoji cuenta 2 (el contador nunca deja escribir lo que el servidor rechaza)', () => {
    expect(CONTRATO.notas.caracteres).toContain('`.length` de JavaScript');
    expect(largoDeNota('hola')).toBe(4);
    expect(largoDeNota('😀')).toBe(2);
  });
});

describe('🔴 privacidad: el texto de las notas no va a un log ni a almacenamiento', () => {
  it('`viajesNotas.ts` no escribe en consola ni en almacenamiento del navegador', () => {
    const codigo = readFileSync(new URL('./viajesNotas.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(codigo).not.toMatch(/console\.|localStorage|sessionStorage|indexedDB|sendBeacon/);
  });
});
