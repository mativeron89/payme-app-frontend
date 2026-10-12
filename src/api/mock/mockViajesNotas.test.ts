import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 🔴 D290 · el mock del pizarrón de notas (App Backend 2.183.0, `services/viajesNotas.js`): quién ve y quién escribe, los
 * límites, el viaje cerrado, la concurrencia (la `version` y la clave de idempotencia), «nuevo» y quien sale. Pasa por
 * los decodificadores de la app, como en la pantalla.
 */

const CLAVE_ESTADO = 'payme.app.mock.viajes.estado.v1';
const VF = { version: 11 } as const;
const LUIS = 'c1000000-0000-4000-8000-000000000001';
const SOFIA = 'c1000000-0000-4000-8000-000000000002';

function storage(extra: Record<string, string> = {}) {
  const values = new Map<string, string>([
    ['payme.app.mock.latencia.v1', '0'],
    ['payme.app.mock.viajes.v1', 'encendido'],
    ...Object.entries(extra),
  ]);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  });
  return values;
}

async function rechazo(p: Promise<unknown>) {
  try {
    await p;
  } catch (err) {
    const e = err as { status: number; message: string; extra: Record<string, unknown> };
    return { status: e.status, error: e.message, extra: e.extra };
  }
  throw new Error('se esperaba un rechazo');
}

async function pizarron(values: Map<string, string>) {
  const m = await import('./viajes');
  const d = await import('../viajesNotas');
  const v = await import('../viajes');
  const { state } = await import('./store');
  const id: string = m.VIAJES_SEMILLA.cancun;
  const yo = state.user.id;
  const leer = async (viaje: string = id) => d.decodePizarron(await m.mockNotasDeViaje(viaje), viaje);
  const resumen = async (viaje: string = id) => v.decodeDetalleViaje(await m.mockDetalleViaje(viaje, VF)).notas;
  const crear = async (body: unknown, viaje: string = id) => d.decodeEscrituraDeNotas(await m.mockCrearNota(viaje, body), true, 'crear');
  const editar = async (nid: string, body: unknown) => d.decodeEscrituraDeNotas(await m.mockEditarNota(id, nid, body), false, 'editar').apartado;
  const borrar = async (nid: string, version: number) =>
    d.decodeEscrituraDeNotas(await m.mockBorrarNota(id, nid, { version: String(version) }), false, 'borrar').apartado;
  const tildar = async (nid: string, iid: string, tildado: boolean) =>
    d.decodeEscrituraDeNotas(await m.mockTildarItemDeNota(id, nid, iid, { tildado }), false, 'tildar').apartado;
  const ordenar = async (ids: string[]) => d.decodeEscrituraDeNotas(await m.mockOrdenarNotas(id, { ids }), false, 'ordenar').apartado;
  /** Escribe como otra persona del viaje (el mock decide quién soy por la cuenta del store). */
  const como = async <T>(userId: string, fn: () => Promise<T>): Promise<T> => {
    const antes = state.user;
    state.user = { ...antes, id: userId };
    try {
      return await fn();
    } finally {
      state.user = antes;
    }
  };
  const crudo = () => JSON.parse(values.get(CLAVE_ESTADO)!) as { viajes: Array<{ id: string; estado: string; miembros: Array<{ user_id: string; estado: string }> }> };
  const guardarCrudo = (e: unknown) => {
    values.set(CLAVE_ESTADO, JSON.stringify(e));
    m.olvidarViajesMockParaTests();
  };
  return { m, d, id, yo, leer, resumen, crear, editar, borrar, tildar, ordenar, como, crudo, guardarCrudo };
}

const nota = (texto: string, clave = `clave-${texto.length}-${texto.slice(0, 8)}`) => ({ idempotency_key: clave.padEnd(8, 'x'), tipo: 'nota', texto });
const lista = (titulo: string, items: string[], clave = `lista-${titulo}`) =>
  ({ idempotency_key: clave.padEnd(8, 'x'), tipo: 'lista', titulo, items: items.map((texto) => ({ texto })) });

describe('🔴 mock · D290 · el pizarrón de notas (App Backend 2.183.0)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('la semilla: el mío primero; después el último que escribió; al final los que no escribieron; limites del contrato', async () => {
    const c = await pizarron(storage());
    const p = await c.leer();
    expect(p.apartados.map((a) => [a.first_name, a.es_yo, a.entradas.length])).toEqual([
      [p.apartados[0]!.first_name, true, 0], ['Luis', false, 1], ['Sofía', false, 1], ['Diego', false, 0],
    ]);
    expect({ total: p.total, escribieron: p.escribieron, editable: p.editable, estado: p.estado }).toEqual({ total: 4, escribieron: 2, editable: true, estado: 'abierto' });
    expect(p.limites).toEqual({ entradas_por_miembro: 20, caracteres_nota: 500, items_por_lista: 30, caracteres_item: 80, caracteres_titulo: 80 });
    // Luis y Sofía tienen foto en el mock (n164); Diego no.
    expect(p.apartados.map((a) => a.has_avatar)).toEqual([false, true, true, false]);
  });

  it('quien no es miembro activo: el 404 de n325 (invitado a Mazatlán, el pizarrón no existe)', async () => {
    const c = await pizarron(storage());
    expect(await rechazo(c.leer(c.m.VIAJES_SEMILLA.mazatlan))).toMatchObject({ status: 404, error: 'viaje_not_found' });
    expect(await rechazo(c.crear(nota('Hola'), c.m.VIAJES_SEMILLA.mazatlan))).toMatchObject({ status: 404, error: 'viaje_not_found' });
  });

  it('crear: al final de mi apartado; el reintento con la misma clave es la MISMA entrada; con otro pedido, 409', async () => {
    const c = await pizarron(storage());
    const a = await c.crear(nota('Llevo la bocina', 'clave-uno-1'));
    const b = await c.crear(lista('Para llevar', ['Gorra', 'Efectivo'], 'clave-dos-2'));
    expect(b.apartado.entradas.map((e) => e.id)).toEqual([a.entrada_id, b.entrada_id]);
    const otra = await c.crear(nota('Llevo la bocina', 'clave-uno-1'));
    expect(otra.entrada_id).toBe(a.entrada_id);
    expect(otra.apartado.entradas).toHaveLength(2);
    expect(await rechazo(c.crear(nota('Otra cosa', 'clave-uno-1')))).toMatchObject({ status: 409, error: 'idempotency_key_conflict' });
    const l = b.apartado.entradas[1]!;
    expect(l).toMatchObject({ tipo: 'lista', titulo: 'Para llevar', version: 1 });
    expect(l.tipo === 'lista' && l.items.map((i) => [i.texto, i.tildado])).toEqual([['Gorra', false], ['Efectivo', false]]);
  });

  it('la normalización del dueño: la nota recorta extremos y pasa \\r\\n a \\n; título e ítem, una línea con espacios colapsados', async () => {
    const c = await pizarron(storage());
    const n = await c.crear(nota('  Uno\r\nDos\t  '));
    expect(n.apartado.entradas[0]).toMatchObject({ texto: 'Uno\nDos' });
    const l = await c.crear(lista('  Súper   del\nlunes ', ['  Hielo   picado ']));
    expect(l.apartado.entradas[1]).toMatchObject({ titulo: 'Súper del lunes', items: [{ texto: 'Hielo picado' }] });
  });

  it('🔴 los límites con sus mensajes: 500 por nota, 80 por título e ítem, de 1 a 30 ítems, sin controles; 20 por persona', async () => {
    const c = await pizarron(storage());
    const mensaje = async (body: unknown) => ((await rechazo(c.crear(body))).extra.issues as Array<{ message: string }>)[0]!.message;
    expect(await mensaje(nota('a'.repeat(501)))).toBe('texto_max_500');
    expect(await mensaje(nota('   '))).toBe('texto_vacio');
    expect(await mensaje(nota('a\u0007b'))).toBe('texto_control');
    expect(await mensaje(lista('t'.repeat(81), ['x']))).toBe('titulo_max_80');
    expect(await mensaje(lista('T', ['i'.repeat(81)]))).toBe('item_max_80');
    expect(await mensaje(lista('T', []))).toBe('items_min_1');
    expect(await mensaje(lista('T', Array.from({ length: 31 }, (_, k) => `i${k}`)))).toBe('items_max_30');
    expect(await mensaje({ idempotency_key: 'clave-123', tipo: 'foto' })).toBe('tipo_invalido');
    // En el tope, sí: 500 caracteres (`.length` de JS: un emoji cuenta 2) y 30 ítems de 80.
    await c.crear(nota('😀'.repeat(250)));
    await c.crear(lista('t'.repeat(80), Array.from({ length: 30 }, (_, k) => `${k}`.padEnd(80, 'x'))));
    for (let k = 2; k < 20; k += 1) await c.crear(nota(`Nota ${k}`, `clave-tope-${k}`));
    expect(await rechazo(c.crear(nota('La 21', 'clave-tope-21')))).toMatchObject({ status: 409, error: 'viaje_notas_limit', extra: { limit: 20 } });
    // El reintento de una que ya está no choca con el tope.
    expect((await c.crear(nota('Nota 2', 'clave-tope-2'))).apartado.entradas).toHaveLength(20);
  });

  it('🔴 cada uno escribe lo suyo: lo de otro es 403 `viaje_nota_not_yours` (editar, borrar y tildar)', async () => {
    const c = await pizarron(storage());
    const p = await c.leer();
    const deLuis = p.apartados.find((a) => a.first_name === 'Luis')!.entradas[0]!;
    const deSofia = p.apartados.find((a) => a.first_name === 'Sofía')!.entradas[0]!;
    expect(await rechazo(c.editar(deLuis.id, { version: 1, texto: 'x' }))).toMatchObject({ status: 403, error: 'viaje_nota_not_yours' });
    expect(await rechazo(c.borrar(deLuis.id, 1))).toMatchObject({ status: 403, error: 'viaje_nota_not_yours' });
    const item = deSofia.tipo === 'lista' ? deSofia.items[0]!.id : '';
    expect(await rechazo(c.tildar(deSofia.id, item, false))).toMatchObject({ status: 403, error: 'viaje_nota_not_yours' });
    // Una nota que no es de este viaje: 404 de la nota.
    expect(await rechazo(c.editar('d9000000-0000-4000-8000-000000009999', { version: 1, texto: 'x' })))
      .toMatchObject({ status: 404, error: 'viaje_nota_not_found' });
  });

  it('🔴 editar y borrar llevan la `version` que vi: si cambió, 409 con MI apartado actual; sin cambios, 200 sin subirla', async () => {
    const c = await pizarron(storage());
    const n = (await c.crear(nota('Primera'))).apartado.entradas[0]!;
    const mio = await c.editar(n.id, { version: 1, texto: 'Segunda' });
    expect(mio.entradas[0]).toMatchObject({ texto: 'Segunda', version: 2 });
    const r = await rechazo(c.editar(n.id, { version: 1, texto: 'Tercera' }));
    expect(r).toMatchObject({ status: 409, error: 'viaje_nota_version_conflict' });
    const ap = c.d.decodeEscrituraDeNotas({ contract: 'payme.app.viajes/v1', apartado: r.extra.apartado }, false, 'conflicto').apartado;
    expect(ap.entradas[0]).toMatchObject({ texto: 'Segunda', version: 2 });
    expect((await c.editar(n.id, { version: 2, texto: 'Segunda' })).entradas[0]).toMatchObject({ version: 2 });
    expect(await rechazo(c.borrar(n.id, 1))).toMatchObject({ status: 409, error: 'viaje_nota_version_conflict' });
    expect((await c.borrar(n.id, 2)).entradas).toEqual([]);
    expect(await rechazo(c.borrar(n.id, 2))).toMatchObject({ status: 404, error: 'viaje_nota_not_found' });
  });

  it('editar una lista: la lista COMPLETA; con id conserva su tilde, sin id es nuevo, el que no viene se saca; un id ajeno, 422', async () => {
    const c = await pizarron(storage());
    const l = (await c.crear(lista('Para llevar', ['Protector', 'Gorra', 'Efectivo']))).apartado.entradas[0]!;
    if (l.tipo !== 'lista') throw new Error('lista');
    const [protector, gorra] = l.items;
    await c.tildar(l.id, gorra!.id, true);
    const otra = (await c.leer()).apartados[0]!.entradas[0]!;
    const ap = await c.editar(l.id, { version: otra.version, items: [{ id: gorra!.id, texto: 'Gorra azul' }, { id: protector!.id, texto: 'Protector' }, { texto: 'Toalla' }] });
    const nueva = ap.entradas[0]!;
    expect(nueva.tipo === 'lista' && nueva.items.map((i) => [i.texto, i.tildado])).toEqual([['Gorra azul', true], ['Protector', false], ['Toalla', false]]);
    expect(await rechazo(c.editar(l.id, { version: nueva.version, items: [{ id: 'd9000000-0000-4000-8000-000000008888', texto: 'x' }] })))
      .toMatchObject({ status: 422, error: 'viaje_nota_item_unknown', extra: { item_id: 'd9000000-0000-4000-8000-000000008888' } });
    expect((await rechazo(c.editar(l.id, { version: nueva.version }))).extra.issues).toEqual([{ path: '', message: 'nada_para_editar' }]);
  });

  it('🔴 tildar es un estado: dos veces, un solo efecto; no sube la versión ni es «nuevo» para los demás', async () => {
    const c = await pizarron(storage());
    const l = (await c.crear(lista('Súper', ['Hielo']))).apartado.entradas[0]!;
    if (l.tipo !== 'lista') throw new Error('lista');
    await c.como(LUIS, () => c.leer());
    await c.tildar(l.id, l.items[0]!.id, true);
    const ap = await c.tildar(l.id, l.items[0]!.id, true);
    expect(ap.entradas[0]).toMatchObject({ version: 1, items: [{ tildado: true }] });
    expect(await rechazo(c.tildar(l.id, 'd9000000-0000-4000-8000-000000007777', true))).toMatchObject({ status: 404, error: 'viaje_nota_item_not_found' });
    // Luis ya había visitado el pizarrón después de mi lista: tildar no la vuelve «nueva».
    expect((await c.como(LUIS, () => c.resumen())).nuevo).toBe(false);
  });

  it('🔴 «nuevo»: otro autor crea o edita después de mi última visita; abrir el pizarrón lo apaga, también cerrado', async () => {
    const c = await pizarron(storage());
    // Sin visita: lo de Luis y Sofía es nuevo.
    expect(await c.resumen()).toEqual({ escribieron: 2, total: 4, nuevo: true });
    await c.leer();
    expect((await c.resumen()).nuevo).toBe(false);
    // Lo mío no es nuevo para mí.
    await c.crear(nota('Mía'));
    expect(await c.resumen()).toEqual({ escribieron: 3, total: 4, nuevo: false });
    // Sofía escribe después de mi visita: nuevo. (El reloj del mock avanza: la escritura es posterior.)
    await new Promise((r) => setTimeout(r, 5));
    await c.como(SOFIA, () => c.crear(lista('Súper del martes', ['Pan'])));
    expect((await c.resumen()).nuevo).toBe(true);
    await c.leer();
    expect((await c.resumen()).nuevo).toBe(false);
    // Borrar no es «nuevo».
    await new Promise((r) => setTimeout(r, 5));
    const deSofia = (await c.como(SOFIA, () => c.leer())).apartados[0]!.entradas;
    await c.como(SOFIA, () => c.borrar(deSofia.at(-1)!.id, 1));
    expect((await c.resumen()).nuevo).toBe(false);
  });

  it('🔴 con la 11 el detalle trae `notas`; con la 10, no (y la lista de viajes nunca)', async () => {
    const c = await pizarron(storage());
    const crudo11 = await c.m.mockDetalleViaje(c.id, { version: 11 }) as { viaje: Record<string, unknown> };
    const crudo10 = await c.m.mockDetalleViaje(c.id, { version: 10 }) as { viaje: Record<string, unknown> };
    expect(crudo11.viaje.notas).toEqual({ escribieron: 2, total: 4, nuevo: true });
    expect('notas' in crudo10.viaje).toBe(false);
    const lista11 = await c.m.mockListarViajes('abiertos', { version: 11 }) as { viajes: Array<Record<string, unknown>> };
    expect(lista11.viajes.every((v) => !('notas' in v))).toBe(true);
  });

  it('🔴 cerrado y esperando pagos: todo para leer (409 `viaje_not_open` con el estado), y abrirlo marca la visita', async () => {
    const c = await pizarron(storage());
    const oaxaca = c.m.VIAJES_SEMILLA.oaxaca;
    const p = await c.leer(oaxaca);
    expect({ estado: p.estado, editable: p.editable, cerrado_en: p.cerrado_en }).toEqual({ estado: 'cerrado', editable: false, cerrado_en: '2026-08-18T15:00:00.000Z' });
    const mia = p.apartados[0]!.entradas[1]!;
    expect(mia).toMatchObject({ tipo: 'lista', titulo: 'Para llevar' });
    expect(await rechazo(c.crear(nota('Tarde'), oaxaca))).toMatchObject({ status: 409, error: 'viaje_not_open', extra: { estado: 'cerrado' } });
    expect(await rechazo(c.m.mockEditarNota(oaxaca, mia.id, { version: 1, titulo: 'x' }))).toMatchObject({ status: 409, error: 'viaje_not_open' });
    const item = mia.tipo === 'lista' ? mia.items[2]!.id : '';
    expect(await rechazo(c.m.mockTildarItemDeNota(oaxaca, mia.id, item, { tildado: true }))).toMatchObject({ status: 409, error: 'viaje_not_open' });
    const v = (await import('../viajes')).decodeDetalleViaje(await c.m.mockDetalleViaje(oaxaca, VF));
    expect(v.notas).toEqual({ escribieron: 2, total: 5, nuevo: false });
    const monterrey = await c.leer(c.m.VIAJES_SEMILLA.monterrey);
    expect({ estado: monterrey.estado, editable: monterrey.editable }).toEqual({ estado: 'esperando_pagos', editable: false });
  });

  it('🔴 quien sale: sus notas quedan ocultas (ni en el pizarrón, ni en `escribieron`, ni «nuevo»; su nota es 404); vuelven si vuelve', async () => {
    const values = storage();
    const c = await pizarron(values);
    await c.leer();
    const e = c.crudo();
    const v = e.viajes.find((x) => x.id === c.id)!;
    v.miembros.find((x) => x.user_id === LUIS)!.estado = 'salio';
    c.guardarCrudo(e);
    const p = await c.leer();
    expect(p.apartados.map((a) => a.first_name)).not.toContain('Luis');
    expect({ total: p.total, escribieron: p.escribieron }).toEqual({ total: 3, escribieron: 1 });
    const e2 = c.crudo();
    e2.viajes.find((x) => x.id === c.id)!.miembros.find((x) => x.user_id === LUIS)!.estado = 'activo';
    c.guardarCrudo(e2);
    expect((await c.leer()).apartados.find((a) => a.first_name === 'Luis')!.entradas).toHaveLength(1);
  });

  it('ordenar: exactamente todas las mías; si no, 409 con mi apartado', async () => {
    const c = await pizarron(storage());
    const a = (await c.crear(nota('A'))).entrada_id!;
    const b = (await c.crear(nota('B'))).entrada_id!;
    expect((await c.ordenar([b, a])).entradas.map((x) => x.id)).toEqual([b, a]);
    expect(await rechazo(c.ordenar([a]))).toMatchObject({ status: 409, error: 'viaje_notas_order_mismatch' });
  });

  it('los seams, una sola vez: respuesta perdida (y el reintento es la misma), otra pestaña, ya no estaba, se cerró', async () => {
    const values = storage();
    const c = await pizarron(values);
    values.set('payme.app.mock.viajes.notas.v1', 'respuesta_perdida');
    expect(await rechazo(c.crear(nota('Perdida', 'clave-perdida')))).toMatchObject({ status: 500 });
    expect((await c.crear(nota('Perdida', 'clave-perdida'))).apartado.entradas).toHaveLength(1);
    const n = (await c.leer()).apartados[0]!.entradas[0]!;
    values.set('payme.app.mock.viajes.notas.v1', 'otra_pestana');
    const r = await rechazo(c.editar(n.id, { version: 1, texto: 'Mía' }));
    expect(r).toMatchObject({ status: 409, error: 'viaje_nota_version_conflict' });
    expect((r.extra.apartado as { entradas: Array<{ version: number }> }).entradas[0]!.version).toBe(2);
    expect(values.has('payme.app.mock.viajes.notas.v1')).toBe(false);
    values.set('payme.app.mock.viajes.notas.v1', 'ya_no_estaba');
    expect(await rechazo(c.borrar(n.id, 2))).toMatchObject({ status: 404, error: 'viaje_nota_not_found' });
    expect((await c.leer()).apartados[0]!.entradas).toEqual([]);
    values.set('payme.app.mock.viajes.notas.v1', 'se_cerro');
    expect(await rechazo(c.crear(nota('Tarde')))).toMatchObject({ status: 409, error: 'viaje_not_open', extra: { estado: 'esperando_pagos' } });
    expect((await c.leer()).editable).toBe(false);
  });
});
