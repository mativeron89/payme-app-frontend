import { describe, expect, it } from 'vitest';
import type { ItemDelTicket, MiembroViaje, TicketDelViaje } from '../../api/viajes';
import { traducir } from '../../i18n/idioma';
import {
  agregarRenglon,
  avisoPrevio,
  borradorDe,
  cambiarRenglon,
  evaluarCorreccion,
  evaluarPagadores,
  leerMontoOCero,
  montosEnPartesIguales,
  montosIniciales,
  nombreNormal,
  pedidoFinal,
  sacarRenglon,
  textoDelProblema,
  type BorradorEscaneado,
  type BorradorGasto,
} from './corregirTicketView';

const t = (s: string, ...a: unknown[]) => traducir(s, 'es', ...a);
const tEn = (s: string, ...a: unknown[]) => traducir(s, 'en', ...a);

const item = (id: string, name: string, price_cents: number, extra: Partial<ItemDelTicket> = {}): ItemDelTicket => ({
  id, name, price_cents, quantity: 1, line_cents: price_cents * (extra.quantity ?? 1), remaining_bps: 10000, my_bps: 0,
  my_amount_cents: 0, ...extra,
});

/** «NATAMBRE»: por consumo, el pescado lo eligió otro, el aguachile yo, la margarita los dos, el guacamole nadie. */
function natambre(extra: Partial<TicketDelViaje> = {}): TicketDelViaje {
  const items = [
    item('i1', 'Pescado a la talla', 52500, { remaining_bps: 0 }),
    item('i2', 'Aguachile', 31000, { remaining_bps: 0, my_bps: 10000, my_amount_cents: 31000 }),
    item('i3', 'Margarita', 14000, { quantity: 4, line_cents: 56000, remaining_bps: 5000, my_bps: 2500, my_amount_cents: 14000 }),
    item('i4', 'Guacamole', 16000),
  ];
  const monto = items.reduce((s, i) => s + i.line_cents, 0);
  return {
    id: 't', lugar: 'NATAMBRE', tipo_lugar: 'restaurante', fecha_ticket: '2026-10-08', hora_ticket: '21:40',
    cargado_en: '2026-10-09T03:40:00.000Z', forma: 'consumo', monto_cents: monto, pagado_por: 'm2', pagaste_tu: false, items,
    personas: [{ miembro_id: 'm1', ya_eligio: true, presente: true }, { miembro_id: 'm2', ya_eligio: true, presente: true }],
    te_toca_cents: 45000, sin_repartir_cents: 16000, puedo_elegir: true, puedo_marcar_presentes: true,
    pagadores: [{ miembro_id: 'm2', monto_cents: monto }], personal: false, servicio_cents: 0, descuentos_cents: 0,
    iva_aparte_cents: 0, total_cents: monto, te_toca_platos_cents: 45000, puedo_corregir: true, ...extra,
  };
}

const MONTO = 52500 + 31000 + 56000 + 16000;

function gasto(extra: Partial<TicketDelViaje> = {}): TicketDelViaje {
  return natambre({ lugar: 'Gasolina', tipo_lugar: 'otro', forma: 'iguales', fecha_ticket: null, hora_ticket: null,
    items: [item('g1', 'Gasolina', 90000, { remaining_bps: 0 })], monto_cents: 90000, total_cents: 90000, pagaste_tu: true,
    pagado_por: 'm1', pagadores: [{ miembro_id: 'm1', monto_cents: 45000 }, { miembro_id: 'm2', monto_cents: 45000 }], ...extra });
}

const miembro = (id: string, first: string, extra: Partial<MiembroViaje> = {}): MiembroViaje => ({
  id, first_name: first, last_name: 'Pérez', username: null, eliminada: false, es_yo: false, balance_cents: 0, falta_elegir: 0,
  has_avatar: false, pagado_cents: 0, ...extra,
});
const MIEMBROS = [miembro('m1', 'Mati', { es_yo: true }), miembro('m2', 'Luis')];

const escaneado = (b = borradorDe(natambre(), 'escaneo')) => b as BorradorEscaneado;
const conPrecio = (b: BorradorEscaneado, id: string, precio: string) => cambiarRenglon(b, id, { precio });

describe('🔴 D278-3 · el borrador sale del ticket tal como está', () => {
  it('un escaneado: lugar, tipo, fecha, hora, renglones y ajustes (el 0 de un ajuste, vacío)', () => {
    const b = escaneado(borradorDe(natambre({ servicio_cents: 5000 }), 'escaneo'));
    expect(b).toMatchObject({ tipo: 'escaneado', lugar: 'NATAMBRE', tipo_lugar: 'restaurante', fecha: '2026-10-08', hora: '21:40',
      servicio: '50', descuentos: '', iva: '' });
    expect(b.renglones.map((r) => [r.id, r.name, r.quantity, r.precio])).toEqual([
      ['i1', 'Pescado a la talla', 1, '525'], ['i2', 'Aguachile', 1, '310'], ['i3', 'Margarita', 4, '140'], ['i4', 'Guacamole', 1, '160'],
    ]);
  });

  it('sin lugar, fecha ni hora: campos vacíos; un precio de $0 se escribe «0»', () => {
    const b = escaneado(borradorDe(natambre({ lugar: null, fecha_ticket: null, hora_ticket: null,
      items: [item('i1', 'Cortesía', 0), item('i2', 'Taco', 1250)], monto_cents: 1250, total_cents: 1250,
      pagadores: [{ miembro_id: 'm2', monto_cents: 1250 }] }), 'escaneo'));
    expect(b).toMatchObject({ lugar: '', fecha: '', hora: '' });
    expect(b.renglones.map((r) => r.precio)).toEqual(['0', '12.50']);
  });

  it('un gasto a mano: la descripción y el monto', () => {
    expect(borradorDe(gasto(), 'manual')).toEqual({ tipo: 'gasto', descripcion: 'Gasolina', monto: '900' });
  });

  it('sin cambios no hay nada que mandar', () => {
    for (const [tk, o] of [[natambre(), 'escaneo'], [gasto(), 'manual']] as const) {
      const e = evaluarCorreccion(tk, borradorDe(tk, o));
      expect(e).toMatchObject({ problema: null, cambios: false, total: tk.total_cents, cambiaTotal: false });
      expect(e.pedido).toEqual({});
    }
  });
});

describe('🔴 cada campo de un escaneado, y sólo lo que cambió', () => {
  it('el nombre del lugar «NATAMBRE» → «Matambre»: sólo `lugar`', () => {
    const e = evaluarCorreccion(natambre(), { ...escaneado(), lugar: 'Matambre' });
    expect(e).toMatchObject({ problema: null, cambios: true, cambiaTotal: false });
    expect(e.pedido).toEqual({ lugar: 'Matambre' });
  });

  it('el lugar se manda normalizado; vacío es `null`', () => {
    expect(evaluarCorreccion(natambre(), { ...escaneado(), lugar: '  Matambre   Parrilla ' }).pedido).toEqual({ lugar: 'Matambre Parrilla' });
    expect(evaluarCorreccion(natambre(), { ...escaneado(), lugar: '   ' }).pedido).toEqual({ lugar: null });
    expect(evaluarCorreccion(natambre({ lugar: null }), { ...escaneado(borradorDe(natambre({ lugar: null }), 'escaneo')), lugar: '' }).cambios)
      .toBe(false);
  });

  it('el tipo, la fecha y la hora; sin fecha, la hora se va con ella', () => {
    expect(evaluarCorreccion(natambre(), { ...escaneado(), tipo_lugar: 'bar' }).pedido).toEqual({ tipo_lugar: 'bar' });
    expect(evaluarCorreccion(natambre(), { ...escaneado(), fecha: '2026-10-09' }).pedido).toEqual({ fecha_ticket: '2026-10-09' });
    expect(evaluarCorreccion(natambre(), { ...escaneado(), hora: '22:15' }).pedido).toEqual({ hora_ticket: '22:15' });
    expect(evaluarCorreccion(natambre(), { ...escaneado(), hora: '' }).pedido).toEqual({ hora_ticket: null });
    expect(evaluarCorreccion(natambre(), { ...escaneado(), fecha: '' }).pedido).toEqual({ fecha_ticket: null, hora_ticket: null });
    // Sin fecha guardada y con una hora escrita: la hora no viaja sola.
    const sinFecha = natambre({ fecha_ticket: null, hora_ticket: null });
    expect(evaluarCorreccion(sinFecha, { ...escaneado(borradorDe(sinFecha, 'escaneo')), hora: '22:15' }).cambios).toBe(false);
  });

  it('un precio: la lista COMPLETA de renglones, con su id, y el total nuevo', () => {
    const e = evaluarCorreccion(natambre(), conPrecio(escaneado(), 'i1', '495'));
    expect(e).toMatchObject({ problema: null, cambios: true, total: MONTO - 3000, cambiaTotal: true });
    expect(e.pedido).toEqual({ items: [
      { id: 'i1', name: 'Pescado a la talla', price_cents: 49500, quantity: 1 },
      { id: 'i2', name: 'Aguachile', price_cents: 31000, quantity: 1 },
      { id: 'i3', name: 'Margarita', price_cents: 14000, quantity: 4 },
      { id: 'i4', name: 'Guacamole', price_cents: 16000, quantity: 1 },
    ] });
  });

  it('el nombre de un renglón, la cantidad, agregar y sacar', () => {
    expect(evaluarCorreccion(natambre(), cambiarRenglon(escaneado(), 'i4', { name: 'Guacamole grande' })).pedido)
      .toMatchObject({ items: expect.arrayContaining([{ id: 'i4', name: 'Guacamole grande', price_cents: 16000, quantity: 1 }]) });
    const cant = evaluarCorreccion(natambre(), cambiarRenglon(escaneado(), 'i3', { quantity: 3 }));
    expect(cant.total).toBe(MONTO - 14000);
    const otro = cambiarRenglon(agregarRenglon(escaneado(), 'nuevo-1'), 'nuevo-1', { name: 'Postre', precio: '90' });
    const agregado = evaluarCorreccion(natambre(), otro);
    expect(agregado.total).toBe(MONTO + 9000);
    expect((agregado.pedido as { items: unknown[] }).items.at(-1)).toEqual({ name: 'Postre', price_cents: 9000, quantity: 1 });
    const sacado = evaluarCorreccion(natambre(), sacarRenglon(escaneado(), 'i4'));
    expect((sacado.pedido as { items: Array<{ id?: string }> }).items.map((i) => i.id)).toEqual(['i1', 'i2', 'i3']);
    expect(sacado.total).toBe(MONTO - 16000);
  });

  it('un renglón nuevo empieza vacío, con cantidad 1; no se saca el último ni se pasa de 100', () => {
    const b = agregarRenglon(escaneado(), 'n');
    expect(b.renglones.at(-1)).toEqual({ clave: 'n', id: null, name: '', quantity: 1, precio: '' });
    let uno = escaneado();
    for (const r of escaneado().renglones.slice(1)) uno = sacarRenglon(uno, r.clave);
    expect(sacarRenglon(uno, 'i1')).toBe(uno);
    let cien = escaneado();
    for (let k = cien.renglones.length; k < 100; k++) cien = agregarRenglon(cien, `n${k}`);
    expect(cien.renglones).toHaveLength(100);
    expect(agregarRenglon(cien, 'otro')).toBe(cien);
  });

  it('la cantidad va de 1 a 32767', () => {
    expect(cambiarRenglon(escaneado(), 'i1', { quantity: 0 }).renglones[0]!.quantity).toBe(1);
    expect(cambiarRenglon(escaneado(), 'i1', { quantity: 40000 }).renglones[0]!.quantity).toBe(32767);
  });

  it('el nombre de un renglón sin tocar viaja tal como lo publicó el dueño; uno tocado, normalizado', () => {
    expect(nombreNormal('  Taco   de  pescado ')).toBe('Taco de pescado');
    const e = evaluarCorreccion(natambre(), cambiarRenglon(escaneado(), 'i4', { name: ' Guacamole  ' }));
    expect(e.cambios).toBe(false);
  });

  it('el reorden de dos renglones iguales también: sólo cambian los ids de lugar', () => {
    const dosIguales = natambre({ items: [item('a', 'Taco', 1000), item('b', 'Taco', 1000)], monto_cents: 2000, total_cents: 2000,
      pagadores: [{ miembro_id: 'm2', monto_cents: 2000 }] });
    const b = escaneado(borradorDe(dosIguales, 'escaneo'));
    const e = evaluarCorreccion(dosIguales, { ...b, renglones: [...b.renglones].reverse() });
    expect(e.cambios).toBe(true);
    expect((e.pedido as { items: Array<{ id?: string }> }).items.map((i) => i.id)).toEqual(['b', 'a']);
  });

  it('el reorden también es un cambio de la lista (el dueño guarda el orden)', () => {
    const b = escaneado();
    const e = evaluarCorreccion(natambre(), { ...b, renglones: [...b.renglones].reverse() });
    expect(e.cambios).toBe(true);
    expect(e.total).toBe(MONTO);
  });

  it('el servicio, los descuentos y el IVA aparte; vacío es 0', () => {
    const e = evaluarCorreccion(natambre(), { ...escaneado(), servicio: '50', descuentos: '20', iva: '16,50' });
    expect(e.pedido).toEqual({ servicio_cents: 5000, descuentos_cents: 2000, iva_aparte_cents: 1650 });
    expect(e.total).toBe(MONTO + 5000 - 2000 + 1650);
    expect(e.cuenta).toEqual({ monto_cents: MONTO, servicio_cents: 5000, descuentos_cents: 2000, iva_aparte_cents: 1650 });
    const conServicio = natambre({ servicio_cents: 5000, total_cents: MONTO + 5000, pagadores: [{ miembro_id: 'm2', monto_cents: MONTO + 5000 }] });
    expect(evaluarCorreccion(conServicio, { ...escaneado(borradorDe(conServicio, 'escaneo')), servicio: '' }).pedido).toEqual({ servicio_cents: 0 });
  });
});

describe('🔴 los montos, con el lector compartido (F-03), y los topes', () => {
  it('`leerMontoOCero`: el vacío y el cero valen; lo demás es `leerMonto`', () => {
    expect(leerMontoOCero('')).toEqual({ tipo: 'vacio' });
    for (const cero of ['0', '$0', '0.00', '0,0', ' 0 ']) expect(leerMontoOCero(cero), cero).toEqual({ tipo: 'ok', cents: 0 });
    expect(leerMontoOCero('12,50')).toEqual({ tipo: 'ok', cents: 1250 });
    expect(leerMontoOCero('1.250')).toEqual({ tipo: 'ambiguo' });
    expect(leerMontoOCero('00.1')).toEqual({ tipo: 'ok', cents: 10 });
    expect(leerMontoOCero('abc')).toEqual({ tipo: 'invalido' });
  });

  it('un precio de $0 vale (cortesía); vacío, no', () => {
    expect(evaluarCorreccion(natambre(), conPrecio(escaneado(), 'i4', '0')).total).toBe(MONTO - 16000);
    expect(evaluarCorreccion(natambre(), conPrecio(escaneado(), 'i4', '')).problema).toBe('monto_invalido');
  });

  it('cada problema, con su texto', () => {
    const casos: Array<[BorradorEscaneado, string]> = [
      [cambiarRenglon(escaneado(), 'i1', { name: '   ' }), 'renglon_sin_nombre'],
      [conPrecio(escaneado(), 'i1', 'abc'), 'monto_invalido'],
      [conPrecio(escaneado(), 'i1', '1.250'), 'monto_ambiguo'],
      [{ ...escaneado(), servicio: '1.250' }, 'monto_ambiguo'],
      [{ ...escaneado(), iva: 'x' }, 'monto_invalido'],
      [{ ...escaneado(), descuentos: '1655' }, 'total_fuera_de_rango'],
      [conPrecio(escaneado(), 'i1', '1000000.01'), 'total_fuera_de_rango'],
      [{ ...escaneado(), servicio: '999999' }, 'total_fuera_de_rango'],
    ];
    for (const [b, p] of casos) {
      const e = evaluarCorreccion(natambre(), b);
      expect(e.problema, p).toBe(p);
      expect(e.pedido, p).toBeNull();
    }
    // Todos los renglones en $0: los platos tienen que sumar más que 0.
    let ceros = escaneado();
    for (const r of ceros.renglones) ceros = conPrecio(ceros, r.clave, '0');
    expect(evaluarCorreccion(natambre(), { ...ceros, servicio: '10' }).problema).toBe('total_fuera_de_rango');
    expect(textoDelProblema('renglon_sin_nombre', t)).toBe('Cada renglón necesita un nombre.');
    expect(textoDelProblema('monto_invalido', t)).toBe('Revisa los montos: escribe sólo números, como 120 o 120.50.');
    expect(textoDelProblema('monto_ambiguo', t)).toBe('No sabemos si es con decimales o con miles. Escríbelo sin separador de miles: 1250 o 12.50.');
    expect(textoDelProblema('total_fuera_de_rango', t)).toBe('El total tiene que ser mayor que $0 y de hasta $1,000,000.');
    expect(textoDelProblema('descripcion_vacia', t)).toBe('Escribe una descripción.');
    for (const p of ['renglon_sin_nombre', 'monto_invalido', 'monto_ambiguo', 'total_fuera_de_rango', 'descripcion_vacia'] as const) {
      expect(textoDelProblema(p, tEn), p).not.toBe(textoDelProblema(p, t));
    }
  });

  it('los renglones tienen su propio tope: más de $1,000,000 no vale aunque un descuento deje el total adentro', () => {
    const b = cambiarRenglon(conPrecio(escaneado(), 'i1', '600000'), 'i1', { quantity: 2 });
    expect(evaluarCorreccion(natambre(), { ...b, descuentos: '300000' }).problema).toBe('total_fuera_de_rango');
    // Con la suma de los renglones justo en $1,000,000 y el mismo descuento, vale.
    let justo = conPrecio(escaneado(), 'i1', '500000');
    for (const id of ['i2', 'i3', 'i4']) justo = sacarRenglon(justo, id);
    justo = cambiarRenglon(justo, 'i1', { quantity: 2 });
    expect(evaluarCorreccion(natambre(), { ...justo, descuentos: '300000' }).problema).toBeNull();
  });

  it('el tope es justo $1,000,000: el total de $1,000,000 vale', () => {
    const uno = natambre({ items: [item('i1', 'Banquete', 100_000_000)], monto_cents: 100_000_000, total_cents: 100_000_000,
      pagadores: [{ miembro_id: 'm2', monto_cents: 100_000_000 }] });
    expect(evaluarCorreccion(uno, { ...escaneado(borradorDe(uno, 'escaneo')), lugar: 'Fiesta' }).problema).toBeNull();
    expect(evaluarCorreccion(uno, { ...escaneado(borradorDe(uno, 'escaneo')), servicio: '0.01' }).problema).toBe('total_fuera_de_rango');
  });
});

describe('🔴 un gasto a mano: descripción y monto', () => {
  it('lo que cambió, y sólo eso', () => {
    const b = borradorDe(gasto(), 'manual') as BorradorGasto;
    expect(evaluarCorreccion(gasto(), { ...b, descripcion: 'Gasolina y peaje' }).pedido).toEqual({ descripcion: 'Gasolina y peaje' });
    const e = evaluarCorreccion(gasto(), { ...b, monto: '950' });
    expect(e.pedido).toEqual({ monto_cents: 95000 });
    expect(e).toMatchObject({ total: 95000, cambiaTotal: true, cuenta: null });
  });

  it('sus problemas: sin descripción, monto vacío, cero, ambiguo o pasado del tope', () => {
    const b = borradorDe(gasto(), 'manual') as BorradorGasto;
    expect(evaluarCorreccion(gasto(), { ...b, descripcion: '  ' }).problema).toBe('descripcion_vacia');
    expect(evaluarCorreccion(gasto(), { ...b, monto: '' }).problema).toBe('monto_invalido');
    expect(evaluarCorreccion(gasto(), { ...b, monto: '0' }).problema).toBe('monto_invalido');
    expect(evaluarCorreccion(gasto(), { ...b, monto: '1.250' }).problema).toBe('monto_ambiguo');
    expect(evaluarCorreccion(gasto(), { ...b, monto: '1000000.01' }).problema).toBe('total_fuera_de_rango');
  });
});

describe('🔴 el aviso previo: por renglón y sin nombres (P1)', () => {
  it('cambiar el nombre del lugar o de un renglón no avisa', () => {
    expect(avisoPrevio(natambre(), { ...escaneado(), lugar: 'Matambre' }, t)).toBeNull();
    expect(avisoPrevio(natambre(), cambiarRenglon(escaneado(), 'i1', { name: 'Pescado zarandeado' }), t)).toBeNull();
  });

  it('un precio con elecciones de otros', () => {
    expect(avisoPrevio(natambre(), conPrecio(escaneado(), 'i1', '495'), t))
      .toBe('Cambiaste el precio de Pescado a la talla: quienes lo eligieron van a tener que volver a elegir.');
  });

  it('una cantidad, o un renglón sacado', () => {
    // La margarita: la eligieron otros y yo.
    expect(avisoPrevio(natambre(), cambiarRenglon(escaneado(), 'i3', { quantity: 3 }), t))
      .toBe('Cambiaste la cantidad de Margarita: quienes lo eligieron van a tener que volver a elegir. Tú también.');
    expect(avisoPrevio(natambre(), sacarRenglon(escaneado(), 'i1'), t))
      .toBe('Sacaste Pescado a la talla: quienes lo eligieron van a tener que volver a elegir.');
  });

  it('lo eligió sólo quien corrige: «Vas a tener que volver a elegir…»', () => {
    expect(avisoPrevio(natambre(), conPrecio(escaneado(), 'i2', '300'), t)).toBe('Vas a tener que volver a elegir Aguachile.');
  });

  it('varios renglones, sin decir quién eligió cuál', () => {
    const b = sacarRenglon(conPrecio(escaneado(), 'i1', '495'), 'i3');
    expect(avisoPrevio(natambre(), b, t))
      .toBe('Cambiaste 2 renglones que ya se eligieron (Pescado a la talla y Margarita): quienes los eligieron van a tener que volver a elegir. Tú también.');
  });

  it('un renglón que nadie eligió, un ticket en partes iguales, un personal o un gasto: sin aviso', () => {
    expect(avisoPrevio(natambre(), conPrecio(escaneado(), 'i4', '170'), t)).toBeNull();
    expect(avisoPrevio(natambre({ forma: 'iguales' }), conPrecio(escaneado(), 'i1', '495'), t)).toBeNull();
    expect(avisoPrevio(natambre({ personal: true }), conPrecio(escaneado(), 'i1', '495'), t)).toBeNull();
    expect(avisoPrevio(gasto(), { ...(borradorDe(gasto(), 'manual') as BorradorGasto), monto: '950' }, t)).toBeNull();
  });

  it('con el diccionario EN', () => {
    expect(avisoPrevio(natambre(), conPrecio(escaneado(), 'i1', '495'), tEn))
      .toBe('You changed the price of Pescado a la talla: whoever chose it will have to choose again.');
  });
});

describe('🔴 los pagadores (P2): con dos o más y otro total, los montos nuevos', () => {
  const dos = (total: number) => evaluarPagadores(gasto(), montosIniciales(gasto()), total, MIEMBROS, t);

  it('arrancan con lo que cada uno tenía antes', () => {
    expect(montosIniciales(gasto())).toEqual(['450', '450']);
  });

  it('con el mismo total, o con un pagador, no se piden', () => {
    expect(dos(90000)).toMatchObject({ pide: false, valido: true, pagadores: null });
    expect(evaluarPagadores(natambre(), montosIniciales(natambre()), MONTO + 100, MIEMBROS, t)).toMatchObject({ pide: false, valido: true });
    expect(evaluarPagadores(gasto(), montosIniciales(gasto()), null, MIEMBROS, t)).toMatchObject({ pide: false, valido: true });
  });

  it('otro total: «Guardar» espera a que sumen, con el aviso de «¿Quién pagó?»', () => {
    expect(dos(95000)).toMatchObject({ pide: true, valido: false, suma: 90000, pagadores: null,
      aviso: 'Los montos tienen que sumar $950. Ahora suman $900.' });
    const ok = evaluarPagadores(gasto(), ['500', '450'], 95000, MIEMBROS, t);
    expect(ok).toMatchObject({ pide: true, valido: true, aviso: null, pagadores: [{ miembro_id: 'm1', monto_cents: 50000 }, { miembro_id: 'm2', monto_cents: 45000 }] });
    expect(evaluarPagadores(gasto(), ['', '450'], 95000, MIEMBROS, t).aviso).toBe('Escribe cuánto pagó cada uno. Tienen que sumar $950.');
    expect(evaluarPagadores(gasto(), ['1.250', '450'], 95000, MIEMBROS, t).aviso)
      .toBe('No sabemos si es con decimales o con miles. Escríbelo sin separador de miles: 1250 o 12.50.');
    expect(evaluarPagadores(gasto(), ['0', '950'], 95000, MIEMBROS, t).valido).toBe(false);
  });

  it('«Partes iguales» reparte el total nuevo como el dueño (el centavo de más al primero)', () => {
    expect(montosEnPartesIguales(95001, 2)).toEqual(['475.01', '475']);
  });

  it('alguien que pagó ya no está en el viaje: el total no se puede cambiar', () => {
    const ido = gasto({ pagadores: [{ miembro_id: 'm1', monto_cents: 45000 }, { miembro_id: null, monto_cents: 45000 }] });
    expect(evaluarPagadores(ido, montosIniciales(ido), 95000, MIEMBROS, t)).toMatchObject({ pide: true, valido: false, pagadores: null,
      aviso: 'Alguien que pagó ya no está en el viaje: el total no se puede cambiar.' });
    const salio = gasto({ pagadores: [{ miembro_id: 'm1', monto_cents: 45000 }, { miembro_id: 'm9', monto_cents: 45000 }] });
    expect(evaluarPagadores(salio, montosIniciales(salio), 95000, MIEMBROS, t).valido).toBe(false);
    const baja = [MIEMBROS[0]!, miembro('m2', 'Luis', { eliminada: true })];
    expect(evaluarPagadores(gasto(), montosIniciales(gasto()), 95000, baja, t).valido).toBe(false);
  });

  it('el pedido final: lo corregido y, si hacen falta, los pagadores', () => {
    const b = { ...(borradorDe(gasto(), 'manual') as BorradorGasto), monto: '950' };
    const e = evaluarCorreccion(gasto(), b);
    const p = evaluarPagadores(gasto(), ['500', '450'], e.total, MIEMBROS, t);
    expect(pedidoFinal(e, p)).toEqual({ monto_cents: 95000, pagadores: [{ miembro_id: 'm1', monto_cents: 50000 }, { miembro_id: 'm2', monto_cents: 45000 }] });
    // Sin poder guardar: nada.
    expect(pedidoFinal(e, evaluarPagadores(gasto(), ['450', '450'], e.total, MIEMBROS, t))).toBeNull();
    expect(pedidoFinal(evaluarCorreccion(gasto(), borradorDe(gasto(), 'manual')), evaluarPagadores(gasto(), ['450', '450'], 90000, MIEMBROS, t))).toBeNull();
    const nat = evaluarCorreccion(natambre(), { ...escaneado(), lugar: 'Matambre' });
    expect(pedidoFinal(nat, evaluarPagadores(natambre(), montosIniciales(natambre()), nat.total, MIEMBROS, t))).toEqual({ lugar: 'Matambre' });
  });
});
