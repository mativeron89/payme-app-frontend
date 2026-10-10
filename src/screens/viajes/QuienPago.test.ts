import { describe, expect, it } from 'vitest';
import type { MiembroViaje } from '../../api/viajes';
import { traducir } from '../../i18n/idioma';
import {
  ajustarMontos,
  alternarPagador,
  conQuienPago,
  montoEscrito,
  montoParaEscribir,
  opcionesDeQuienPago,
  pagadoresVigentes,
  partesIguales,
  QUIEN_PAGO_INICIAL,
  repartoDeQuienPago,
  type QuienPagoElegido,
} from './QuienPago';

/** D255-6 · D263 · «¿Quién pagó?»: yo por defecto, otro, o varios en partes iguales o con montos ajustados. */
const t = (s: string, ...a: unknown[]) => traducir(s, 'es', ...a);
const miembro = (id: string, first: string, extra: Partial<MiembroViaje> = {}): MiembroViaje => ({
  id, first_name: first, last_name: 'X', username: null, eliminada: false, es_yo: false,
  balance_cents: 0, falta_elegir: 0, has_avatar: false, pagado_cents: 0, ...extra,
});
// Yo no voy primero en la lista del dueño: la opción «Tú» sí.
const MIEMBROS = [miembro('m-luis', 'Luis'), miembro('m-yo', 'Ana', { es_yo: true }), miembro('m-baja', 'Ex', { eliminada: true }),
  miembro('m-sofia', 'Sofía')];
const OPCIONES = opcionesDeQuienPago(MIEMBROS, t);
const con = (...ids: string[]): QuienPagoElegido => ({ marcados: new Set(ids), montos: null });
const ids = (e: QuienPagoElegido) => pagadoresVigentes(e, OPCIONES).map((o) => o.id);
const pedido = { descripcion: 'Taxi', monto_cents: 10001 };

describe('🔴 D263 · las opciones y quiénes quedan marcados', () => {
  it('«Tú» primero y los demás en su orden, sin una cuenta eliminada', () => {
    expect(OPCIONES).toEqual([
      { id: 'm-yo', nombre: 'Tú', es_yo: true }, { id: 'm-luis', nombre: 'Luis X', es_yo: false }, { id: 'm-sofia', nombre: 'Sofía X', es_yo: false },
    ]);
  });

  it('por defecto, sólo yo', () => {
    expect(ids(QUIEN_PAGO_INICIAL)).toEqual(['m-yo']);
  });

  it('los marcados en el orden de la lista, no en el que se marcaron', () => {
    expect(ids(con('m-sofia', 'm-yo'))).toEqual(['m-yo', 'm-sofia']);
  });

  it('quien salió del viaje (o una cuenta eliminada) no cuenta; si no queda nadie, yo', () => {
    expect(ids(con('m-luis', 'm-salio', 'm-baja'))).toEqual(['m-luis']);
    expect(ids(con('m-salio'))).toEqual(['m-yo']);
    expect(ids(con())).toEqual(['m-yo']);
  });

  it('marcar suma, desmarcar saca; el último marcado no se desmarca', () => {
    const dos = alternarPagador(QUIEN_PAGO_INICIAL, 'm-luis', OPCIONES);
    expect(ids(dos)).toEqual(['m-yo', 'm-luis']);
    const luis = alternarPagador(dos, 'm-yo', OPCIONES);
    expect(ids(luis)).toEqual(['m-luis']);
    expect(alternarPagador(luis, 'm-luis', OPCIONES)).toBe(luis);
    expect(alternarPagador(QUIEN_PAGO_INICIAL, 'm-yo', OPCIONES)).toBe(QUIEN_PAGO_INICIAL);
  });

  it('cambiar quiénes pagaron vuelve a partes iguales', () => {
    const ajustado = ajustarMontos(con('m-yo', 'm-luis'), OPCIONES, 10001);
    expect(ajustado.montos).not.toBeNull();
    expect(alternarPagador(ajustado, 'm-sofia', OPCIONES).montos).toBeNull();
  });
});

describe('🔴 D263 · partes iguales, como el dueño: el piso y el centavo de más a los primeros', () => {
  it.each([
    [10001, 3, [3334, 3334, 3333]],
    [10000, 3, [3334, 3333, 3333]],
    [10002, 3, [3334, 3334, 3334]],
    [9000, 2, [4500, 4500]],
    [1, 2, [1, 0]],
    [5, 1, [5]],
  ])('%i entre %i → %j', (total, n, partes) => {
    expect(partesIguales(total, n)).toEqual(partes);
    expect(partesIguales(total, n).reduce((s, x) => s + x, 0)).toBe(total);
  });
});

describe('🔴 D263 · los montos que se escriben', () => {
  it.each([[333334, '3333.34'], [5000, '50'], [5, '0.05'], [10, '0.10'], [123456, '1234.56']])('%i → «%s»', (c, texto) => {
    expect(montoParaEscribir(c)).toBe(texto);
    expect(montoEscrito(texto)).toBe(c);
  });

  it.each(['', '0', '0.00', 'abc', '1.234', '-5', '1.2.3'])('«%s» no es un monto', (texto) => {
    expect(montoEscrito(texto)).toBeNull();
  });

  it('con signo y separador de miles, sí', () => {
    expect(montoEscrito('$1,200.5')).toBe(120050);
  });

  it('«Ajustar montos» empieza con la parte igual de cada uno, en el orden de la lista', () => {
    const e = ajustarMontos(con('m-sofia', 'm-yo', 'm-luis'), OPCIONES, 10001);
    expect([...e.montos!]).toEqual([['m-yo', '33.34'], ['m-luis', '33.34'], ['m-sofia', '33.33']]);
    expect(repartoDeQuienPago(e, OPCIONES, 10001)).toMatchObject({ ajustado: true, suma: 10001, valido: true, partes: [3334, 3334, 3333] });
  });
});

describe('🔴 D263 · el reparto y si se puede mandar', () => {
  it('uno solo: sin partes, siempre se puede', () => {
    expect(repartoDeQuienPago(QUIEN_PAGO_INICIAL, OPCIONES, 10001)).toMatchObject({ partes: [null], ajustado: false, valido: true });
    expect(repartoDeQuienPago(con('m-luis'), OPCIONES, null)).toMatchObject({ partes: [null], valido: true });
  });

  it('varios en partes iguales: la parte de cada uno; sin total todavía, sin partes', () => {
    expect(repartoDeQuienPago(con('m-yo', 'm-luis'), OPCIONES, 10001)).toMatchObject({ partes: [5001, 5000], valido: true });
    expect(repartoDeQuienPago(con('m-yo', 'm-luis'), OPCIONES, null)).toMatchObject({ partes: [null, null], valido: true });
  });

  it('montos que suman el total: se puede', () => {
    const e = { marcados: new Set(['m-yo', 'm-luis']), montos: new Map([['m-yo', '70.01'], ['m-luis', '30']]) };
    expect(repartoDeQuienPago(e, OPCIONES, 10001)).toMatchObject({ partes: [7001, 3000], suma: 10001, valido: true });
  });

  it('montos que no suman, de menos o de más: no se puede, con la suma', () => {
    const de = (a: string, b: string) => ({ marcados: new Set(['m-yo', 'm-luis']), montos: new Map([['m-yo', a], ['m-luis', b]]) });
    expect(repartoDeQuienPago(de('70', '30'), OPCIONES, 10001)).toMatchObject({ suma: 10000, valido: false });
    expect(repartoDeQuienPago(de('70.01', '30.01'), OPCIONES, 10001)).toMatchObject({ suma: 10002, valido: false });
  });

  it('un monto vacío o que no vale: no se puede, sin suma', () => {
    const e = { marcados: new Set(['m-yo', 'm-luis']), montos: new Map([['m-yo', '100.01'], ['m-luis', '']]) };
    expect(repartoDeQuienPago(e, OPCIONES, 10001)).toMatchObject({ partes: [10001, null], suma: null, valido: false });
    const cero = { ...e, montos: new Map([['m-yo', '100.01'], ['m-luis', '0']]) };
    expect(repartoDeQuienPago(cero, OPCIONES, 10001)).toMatchObject({ suma: null, valido: false });
  });

  it('ajustado y sin total (se borró el monto): no se puede', () => {
    const e = ajustarMontos(con('m-yo', 'm-luis'), OPCIONES, 10001);
    expect(repartoDeQuienPago(e, OPCIONES, null).valido).toBe(false);
  });
});

describe('🔴 D255-6 · D263 · lo que se le manda al dueño', () => {
  it('sólo yo: nada', () => {
    const r = conQuienPago(pedido, repartoDeQuienPago(QUIEN_PAGO_INICIAL, OPCIONES, 10001));
    expect(r).toEqual(pedido);
    expect(r).not.toHaveProperty('pagado_por');
    expect(r).not.toHaveProperty('pagadores');
  });

  it('otro: `pagado_por`, sin `pagadores`', () => {
    expect(conQuienPago(pedido, repartoDeQuienPago(con('m-luis'), OPCIONES, 10001))).toEqual({ ...pedido, pagado_por: 'm-luis' });
  });

  it('dos en partes iguales: `pagadores` en el orden de la lista y sin montos (reparte el dueño)', () => {
    expect(conQuienPago(pedido, repartoDeQuienPago(con('m-luis', 'm-yo'), OPCIONES, 10001)))
      .toEqual({ ...pedido, pagadores: [{ miembro_id: 'm-yo' }, { miembro_id: 'm-luis' }] });
  });

  it('tres con montos ajustados: cada uno con lo suyo, sin `pagado_por`', () => {
    const e = { marcados: new Set(['m-yo', 'm-luis', 'm-sofia']), montos: new Map([['m-yo', '50'], ['m-luis', '30'], ['m-sofia', '20.01']]) };
    const r = conQuienPago(pedido, repartoDeQuienPago(e, OPCIONES, 10001));
    expect(r).toEqual({ ...pedido, pagadores: [
      { miembro_id: 'm-yo', monto_cents: 5000 }, { miembro_id: 'm-luis', monto_cents: 3000 }, { miembro_id: 'm-sofia', monto_cents: 2001 },
    ] });
    expect(r).not.toHaveProperty('pagado_por');
  });
});
