import { describe, expect, it } from 'vitest';
import type { Apartado, EntradaDeNotas, Pizarron } from '../../api/viajesNotas';
import { traducir } from '../../i18n/idioma';
import {
  conMiApartado,
  contadorDeItems,
  contadorDeTexto,
  fechaDeCierre,
  leerParametroDeNotas,
  MUCHAS_PERSONAS,
  nombresEnUnaLinea,
  parametroDeApartado,
  reaccionAlError,
  resumenDeEntradas,
  tildadosDeLista,
  vistaDeMuchos,
} from './notasView';

/** D290 · lo puro del pizarrón de notas. */
const t = (texto: string, ...args: unknown[]) => traducir(texto, 'es', ...args);
const en = '2026-10-12T03:00:00.000Z';
const nota = (id: string): EntradaDeNotas => ({ id, tipo: 'nota', texto: 'x', version: 1, creado_en: en, actualizado_en: en });
const lista = (id: string, tildados: boolean[] = [false]): EntradaDeNotas => ({ id, tipo: 'lista', titulo: 'L', version: 1,
  creado_en: en, actualizado_en: en, items: tildados.map((x, k) => ({ id: `${id}-${k}`, texto: `i${k}`, tildado: x })) });
const ap = (id: string, nombre: string, entradas: EntradaDeNotas[] = [], yo = false): Apartado => ({
  miembro_id: id, first_name: nombre, last_name: 'X', username: null, eliminada: false, has_avatar: false, es_yo: yo,
  actualizado_en: entradas.length ? en : null, entradas,
});

describe('los resúmenes', () => {
  it('«1 nota, 1 lista», «2 notas», «3 listas»; sin nada, null', () => {
    expect(resumenDeEntradas([nota('a'), lista('b')], t)).toBe('1 nota, 1 lista');
    expect(resumenDeEntradas([nota('a'), nota('b')], t)).toBe('2 notas');
    expect(resumenDeEntradas([lista('a'), lista('b'), lista('c')], t)).toBe('3 listas');
    expect(resumenDeEntradas([lista('a')], t)).toBe('1 lista');
    expect(resumenDeEntradas([], t)).toBeNull();
  });

  it('«2 de 4»: los tildados de la lista', () => {
    expect(tildadosDeLista({ items: [{ id: 'a', texto: 'a', tildado: true }, { id: 'b', texto: 'b', tildado: false }] }, t)).toBe('1 de 2');
    const l = lista('x', [true, true, false, false]);
    expect(l.tipo === 'lista' && tildadosDeLista(l, t)).toBe('2 de 4');
  });
});

describe('🔴 los contadores (PANTALLA §3): desde el 80 % la píldora, en el tope ya no deja', () => {
  it('la nota: «399 / 500» gris; desde 400, «Te quedan 100»; en 500, «Llegaste a 500»', () => {
    expect(contadorDeTexto(0, 500, t, { siempre: true })).toEqual({ texto: '0 / 500', cerca: false, tope: false });
    expect(contadorDeTexto(399, 500, t, { siempre: true })).toEqual({ texto: '399 / 500', cerca: false, tope: false });
    expect(contadorDeTexto(400, 500, t, { siempre: true })).toEqual({ texto: 'Te quedan 100', cerca: true, tope: false });
    expect(contadorDeTexto(499, 500, t, { siempre: true })).toEqual({ texto: 'Te quedan 1', cerca: true, tope: false });
    expect(contadorDeTexto(500, 500, t, { siempre: true })).toEqual({ texto: 'Llegaste a 500', cerca: true, tope: true });
  });

  it('título e ítem (80): nada antes del 80 % (64); después, «Te quedan» y «Llegaste a 80»', () => {
    expect(contadorDeTexto(63, 80, t, { siempre: false })).toBeNull();
    expect(contadorDeTexto(64, 80, t, { siempre: false })).toEqual({ texto: 'Te quedan 16', cerca: true, tope: false });
    expect(contadorDeTexto(80, 80, t, { siempre: false })).toEqual({ texto: 'Llegaste a 80', cerca: true, tope: true });
  });

  it('los ítems (30): «23 / 30 ítems» gris, desde 24 ámbar, en 30 «Llegaste a 30 ítems»', () => {
    expect(contadorDeItems(23, 30, t)).toEqual({ texto: '23 / 30 ítems', cerca: false, tope: false });
    expect(contadorDeItems(24, 30, t)).toEqual({ texto: '24 / 30 ítems', cerca: true, tope: false });
    expect(contadorDeItems(30, 30, t)).toEqual({ texto: 'Llegaste a 30 ítems', cerca: true, tope: true });
  });
});

describe('con muchas personas (PANTALLA §4)', () => {
  it('desde 6; el mío aparte, «Con notas» en el orden del dueño y «Sin notas todavía»', () => {
    expect(MUCHAS_PERSONAS).toBe(6);
    const v = vistaDeMuchos([ap('m1', 'Yo', [], true), ap('m2', 'Marta', [nota('a')]), ap('m3', 'Diego'), ap('m4', 'Luis', [lista('b')])]);
    expect(v.mio?.miembro_id).toBe('m1');
    expect(v.conNotas.map((a) => a.first_name)).toEqual(['Marta', 'Luis']);
    expect(v.sinNotas.map((a) => a.first_name)).toEqual(['Diego']);
  });

  it('los nombres en una línea: «Pablo, Rosa y Toño»; una cuenta eliminada, como tal', () => {
    expect(nombresEnUnaLinea([ap('a', 'Pablo'), ap('b', 'Rosa'), ap('c', 'Toño')], t)).toBe('Pablo, Rosa y Toño');
    expect(nombresEnUnaLinea([ap('a', 'Pablo')], t)).toBe('Pablo');
    expect(nombresEnUnaLinea([{ ...ap('a', 'Pablo'), eliminada: true, first_name: null }, ap('b', 'Rosa')], t)).toBe('Cuenta eliminada y Rosa');
  });
});

describe('la fecha de cierre, en hora de México (UTC−6)', () => {
  it('«18 ago»; a las 03:00 UTC todavía es el día anterior; sin fecha, null', () => {
    expect(fechaDeCierre('2026-08-18T15:00:00.000Z', 'es')).toBe('18 ago');
    expect(fechaDeCierre('2026-08-19T03:00:00.000Z', 'es')).toBe('18 ago');
    expect(fechaDeCierre('2026-08-19T06:00:00.000Z', 'es')).toBe('19 ago');
    expect(fechaDeCierre('2026-08-18T15:00:00.000Z', 'en')).toBe('Aug 18');
    expect(fechaDeCierre(null, 'es')).toBeNull();
    expect(fechaDeCierre('ayer', 'es')).toBeNull();
  });
});

describe('el parámetro de la ruta', () => {
  it('`<viaje>` o `<viaje>.<miembro>`; cualquier otra forma, null', () => {
    expect(parametroDeApartado('v', 'm')).toBe('v.m');
    expect(leerParametroDeNotas('v')).toEqual({ viajeId: 'v', miembroId: null });
    expect(leerParametroDeNotas('v.m')).toEqual({ viajeId: 'v', miembroId: 'm' });
    for (const malo of [null, '', '.m', 'v.', 'v.m.x']) expect(leerParametroDeNotas(malo), String(malo)).toBeNull();
  });
});

describe('🔴 cada error del dueño, explicado (la orden, punto 6)', () => {
  const mio = ap('m1', 'Yo', [nota('n1')], true);

  it('404 del viaje: la pantalla pasa a «no disponible»', () => {
    expect(reaccionAlError({ tipo: 'no_disponible' }, 'editar', 'nota', t)).toEqual({ noDisponible: true, cerrarHoja: true, mensaje: null });
  });

  it('404 de la nota, 403 de otro o suspendida, 409 cerrado: se vuelve a leer, la hoja se cierra y se dice qué pasó', () => {
    expect(reaccionAlError({ tipo: 'nota_no_encontrada' }, 'borrar', 'nota', t)).toEqual({ refrescar: true, cerrarHoja: true, mensaje: 'Ya no estaba' });
    expect(reaccionAlError({ tipo: 'no_es_tuya' }, 'editar', 'lista', t)).toEqual({ refrescar: true, cerrarHoja: true, mensaje: 'Sólo puedes cambiar lo tuyo.' });
    expect(reaccionAlError({ tipo: 'cuenta_suspendida' }, 'crear', 'nota', t)).toEqual({ refrescar: true, cerrarHoja: true, mensaje: 'Tu cuenta está suspendida. Escríbenos.' });
    expect(reaccionAlError({ tipo: 'no_abierto' }, 'tildar', 'lista', t)).toEqual({ refrescar: true, cerrarHoja: true, mensaje: 'El viaje ya no está abierto' });
  });

  it('🔴 409 de versión editando: el apartado se aplica y la hoja SIGUE con lo escrito; borrando, no se borra', () => {
    expect(reaccionAlError({ tipo: 'otra_version', apartado: mio }, 'editar', 'nota', t)).toEqual({ apartado: mio, refrescar: false, cerrarHoja: false,
      mensaje: 'Esta nota cambió en otro lado. Si guardas, reemplazas esa versión.' });
    expect(reaccionAlError({ tipo: 'otra_version', apartado: mio }, 'editar', 'lista', t).mensaje).toBe('Esta lista cambió en otro lado. Si guardas, reemplazas esa versión.');
    expect(reaccionAlError({ tipo: 'otra_version', apartado: mio }, 'borrar', 'nota', t)).toEqual({ apartado: mio, refrescar: false, cerrarHoja: true,
      mensaje: 'Cambió en otro lado. Mira cómo quedó antes de borrarla.' });
    // Sin el apartado (mal formado): se vuelve a leer.
    expect(reaccionAlError({ tipo: 'otra_version', apartado: null }, 'editar', 'nota', t)).toMatchObject({ apartado: null, refrescar: true });
    expect(reaccionAlError({ tipo: 'otro_orden', apartado: mio }, 'editar', 'nota', t)).toMatchObject({ apartado: mio, cerrarHoja: false });
  });

  it('idempotencia, tope y 400: en la hoja, que sigue abierta', () => {
    expect(reaccionAlError({ tipo: 'clave_repetida' }, 'crear', 'nota', t)).toEqual({ nuevaClave: true, cerrarHoja: false, mensaje: 'No pudimos guardarla. Prueba de nuevo.' });
    expect(reaccionAlError({ tipo: 'tope_de_entradas', limite: 20 }, 'crear', 'lista', t)).toEqual({ refrescar: true, cerrarHoja: false,
      mensaje: 'Llegaste al tope de 20 notas y listas. Borra una para sumar otra.' });
    const r400 = (mensajes: string[]) => reaccionAlError({ tipo: 'invalido', mensajes }, 'crear', 'nota', t).mensaje;
    expect(r400(['texto_vacio'])).toBe('Escribe algo para guardar.');
    expect(r400(['texto_max_500'])).toBe('Una nota puede tener hasta 500 caracteres.');
    expect(r400(['texto_control'])).toBe('Hay un carácter que no se puede guardar. Bórralo y prueba de nuevo.');
    expect(r400(['titulo_max_80'])).toBe('El título puede tener hasta 80 caracteres.');
    expect(r400(['item_max_80'])).toBe('Cada ítem puede tener hasta 80 caracteres.');
    expect(r400(['items_min_1'])).toBe('La lista necesita al menos un ítem.');
    expect(r400(['items_max_30'])).toBe('Una lista puede tener hasta 30 ítems.');
    expect(r400(['Required', 'items_max_30'])).toBe('Una lista puede tener hasta 30 ítems.');
    expect(r400(['Required'])).toBe('No pudimos guardarla. Revisa el texto y prueba de nuevo.');
    expect(reaccionAlError({ tipo: 'item_desconocido' }, 'editar', 'lista', t)).toEqual({ refrescar: true, cerrarHoja: true,
      mensaje: 'La lista cambió en otro lado. Vuelve a editarla.' });
  });

  it('sin red: guardar deja la hoja abierta; tildar y borrar lo dicen en un aviso', () => {
    expect(reaccionAlError({ tipo: 'reintentar' }, 'crear', 'nota', t)).toEqual({ cerrarHoja: false, mensaje: 'No pudimos guardarla. Prueba de nuevo.' });
    expect(reaccionAlError({ tipo: 'reintentar' }, 'tildar', 'lista', t)).toEqual({ cerrarHoja: false, mensaje: 'No pudimos tildarlo. Prueba de nuevo.' });
    expect(reaccionAlError({ tipo: 'reintentar' }, 'borrar', 'nota', t)).toEqual({ cerrarHoja: false, mensaje: 'No pudimos borrarla. Prueba de nuevo.' });
  });
});

describe('aplicar mi apartado', () => {
  const p = (apartados: Apartado[]): Pizarron => ({ viaje_id: 'v', nombre: 'V', estado: 'abierto', cerrado_en: null, editable: true,
    total: apartados.length, escribieron: apartados.filter((a) => a.entradas.length).length,
    limites: { entradas_por_miembro: 20, caracteres_nota: 500, items_por_lista: 30, caracteres_item: 80, caracteres_titulo: 80 }, apartados });

  it('reemplaza el mío, conserva los demás y recuenta `escribieron`', () => {
    const antes = p([ap('m1', 'Yo', [], true), ap('m2', 'Luis', [nota('a')])]);
    const despues = conMiApartado(antes, ap('m1', 'Yo', [nota('b')], true));
    expect(despues.apartados.map((a) => a.entradas.length)).toEqual([1, 1]);
    expect(despues.escribieron).toBe(2);
    expect(despues.apartados[1]).toBe(antes.apartados[1]);
    expect(conMiApartado(despues, ap('m1', 'Yo', [], true)).escribieron).toBe(1);
  });

  it('un apartado que no es el mío de este pizarrón no cambia nada', () => {
    const antes = p([ap('m1', 'Yo', [], true)]);
    expect(conMiApartado(antes, ap('m9', 'Otro', [nota('b')], true))).toBe(antes);
  });
});
