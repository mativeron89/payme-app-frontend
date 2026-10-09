import { describe, expect, it } from 'vitest';
import type { Friend } from '../../api/types';
import type { ResultadoArroba } from '../../api/username';
import {
  arrobaCorta,
  candidatoDeAmigo,
  candidatoDeArroba,
  coincide,
  consultaDe,
  contenidoDelPedido,
  fechasInvertidas,
  filaDe,
  llaveParaElPedido,
  MAX_AGREGADOS,
  mensajeAlCrear,
  miembrosDelPedido,
  puedeCrear,
  seccionesDeBusqueda,
  type Candidato,
} from './crearViajeView';

/** Un `t` de prueba: el español literal con los `{n}` sustituidos (como `traducir` en `es`). */
const t = (s: string, ...a: unknown[]) => s.replace(/\{(\d+)\}/g, (_, i: string) => String(a[Number(i)]));

function amigo(id: string, first: string, last: string, username: string | null = null): Friend {
  return { id, payme_id: `payme_mx_${id}`, first_name: first, last_name: last, full_name: `${first} ${last}`, username };
}
const sofia = amigo('11111111-1111-4111-8111-111111111111', 'Sofía', 'Fernández', 'sofi.fernandez');
const juan = amigo('22222222-2222-4222-8222-222222222222', 'Juan', 'López', 'juan.lopez');
const leo = amigo('33333333-3333-4333-8333-333333333333', 'Leo', 'Paz', null);
const AMIGOS = [sofia, juan, leo];

const arroba = (username: string, first: string, last: string): ResultadoArroba => ({ username, first_name: first, last_name: last, has_avatar: false });

describe('AF-VIAJES · 1e · la consulta del buscador', () => {
  it('se pliega (sin acentos ni mayúsculas) y se prepara como @', () => {
    const q = consultaDe('  @Diego ');
    expect(q).toEqual({ texto: '@Diego', plegado: '@diego', plegadoSinArroba: 'diego', arroba: 'diego', consultable: true });
    expect(consultaDe('Sofía').plegado).toBe('sofia');
  });

  it('por @ sólo desde 3 caracteres del alfabeto del @ (la regla de BuscarPorArroba)', () => {
    expect(consultaDe('@ma').consultable).toBe(false);
    expect(consultaDe('@mar').consultable).toBe(true);
    expect(consultaDe('mar').consultable).toBe(true);
    expect(consultaDe('Juan López').consultable).toBe(false);
    expect(arrobaCorta(consultaDe('@ma'))).toBe(true);
    expect(arrobaCorta(consultaDe('ma')), 'sin «@» es una búsqueda por nombre').toBe(false);
    expect(arrobaCorta(consultaDe('@mar'))).toBe(false);
  });

  it('un amigo coincide por nombre sin acentos o por su @ (sólo con el @ encendido)', () => {
    const c = candidatoDeAmigo(sofia);
    expect(coincide(c, consultaDe('sofia'), true)).toBe(true);
    expect(coincide(c, consultaDe('FERN'), false)).toBe(true);
    expect(coincide(c, consultaDe('@sofi'), false), 'el nombre también cuenta con la «@» adelante').toBe(true);
    expect(coincide(c, consultaDe('@sofi.f'), true)).toBe(true);
    expect(coincide(c, consultaDe('@sofi.f'), false), 'apagado, el @ no se mira').toBe(false);
    expect(coincide(c, consultaDe('juan'), true)).toBe(false);
    expect(coincide(c, consultaDe(''), true)).toBe(false);
  });
});

describe('AF-VIAJES · 1e · las tres secciones', () => {
  const base = { amigos: AMIGOS, resultados: [] as ResultadoArroba[], agregados: [] as Candidato[], arrobaHabilitada: true, miUsername: null };

  it('sin texto, ninguna', () => {
    expect(seccionesDeBusqueda({ ...base, consulta: consultaDe('   ') })).toEqual({ amigos: [], otros: [], yaAgregados: [] });
  });

  it('«En tus amigos» son los amigos que coinciden; «Otros usuarios» lo que trajo el @', () => {
    const s = seccionesDeBusqueda({ ...base, consulta: consultaDe('e'), resultados: [arroba('elena', 'Elena', 'Gómez')] });
    expect(s.amigos.map((c) => c.first_name)).toEqual(['Sofía', 'Juan', 'Leo']);
    expect(s.otros.map((c) => c.clave)).toEqual(['@elena']);
    expect(s.yaAgregados).toEqual([]);
  });

  it('🔴 un amigo que trajo la búsqueda por @ va en amigos (por su id), no en «Otros»', () => {
    const s = seccionesDeBusqueda({ ...base, consulta: consultaDe('@juan'), resultados: [arroba('juan.lopez', 'Juan', 'López'), arroba('juanito', 'Juan', 'Pérez')] });
    expect(s.amigos.map((c) => c.clave)).toEqual([`u:${juan.id}`]);
    expect(s.otros.map((c) => c.clave)).toEqual(['@juanito']);
  });

  it('🔴 los ya agregados salen de amigos y de «Otros» y quedan en «Ya agregaste»', () => {
    const agregados = [candidatoDeAmigo(juan), candidatoDeArroba(arroba('juanito', 'Juan', 'Pérez'))];
    const s = seccionesDeBusqueda({ ...base, agregados, consulta: consultaDe('juan'), resultados: [arroba('juanito', 'Juan', 'Pérez'), arroba('juana', 'Juana', 'Ríos')] });
    expect(s.amigos).toEqual([]);
    expect(s.otros.map((c) => c.clave)).toEqual(['@juana']);
    expect(s.yaAgregados.map((c) => c.clave)).toEqual([`u:${juan.id}`, '@juanito']);
  });

  it('«Ya agregaste» sólo trae a los que coinciden', () => {
    const agregados = [candidatoDeAmigo(juan), candidatoDeAmigo(leo)];
    expect(seccionesDeBusqueda({ ...base, agregados, consulta: consultaDe('leo') }).yaAgregados.map((c) => c.first_name)).toEqual(['Leo']);
  });

  it('la búsqueda por @ no me ofrece a mí', () => {
    const s = seccionesDeBusqueda({ ...base, miUsername: 'mativeron', consulta: consultaDe('@mati'), resultados: [arroba('mativeron', 'Matías', 'Verón'), arroba('matilde', 'Matilde', 'Sosa')] });
    expect(s.otros.map((c) => c.clave)).toEqual(['@matilde']);
  });
});

describe('AF-VIAJES · 1d · el pedido', () => {
  it('🔴 un amigo va por su id; cualquier otro, por su @ sin «@». Nunca un correo', () => {
    const m = miembrosDelPedido([candidatoDeAmigo(sofia), candidatoDeArroba(arroba('mariana', 'Mariana', 'Díaz'))]);
    expect(m).toEqual([{ user_id: sofia.id }, { username: 'mariana' }]);
    expect(JSON.stringify(m)).not.toMatch(/@|email|payme_mx/);
  });

  it('fechas vacías van como null y el nombre sin espacios al borde', () => {
    expect(contenidoDelPedido('  Cancún 2026 ', '', '', [candidatoDeAmigo(leo)])).toEqual({
      nombre: 'Cancún 2026', fecha_desde: null, fecha_hasta: null, miembros: [{ user_id: leo.id }],
    });
    expect(contenidoDelPedido('X', '2026-10-05', '2026-10-11', []).fecha_hasta).toBe('2026-10-11');
  });

  it('«Al» no puede ser antes de «Del» (una sola fecha vale)', () => {
    expect(fechasInvertidas('2026-10-11', '2026-10-05')).toBe(true);
    expect(fechasInvertidas('2026-10-05', '2026-10-05')).toBe(false);
    expect(fechasInvertidas('2026-10-05', '')).toBe(false);
    expect(fechasInvertidas('', '2026-10-05')).toBe(false);
  });

  it('el botón: nombre con texto, al menos un miembro, fechas en orden y sin estar enviando', () => {
    const ok = { nombre: 'Cancún', agregados: [candidatoDeAmigo(leo)], desde: '', hasta: '', enviando: false };
    expect(puedeCrear(ok)).toBe(true);
    expect(puedeCrear({ ...ok, nombre: '   ' })).toBe(false);
    expect(puedeCrear({ ...ok, agregados: [] })).toBe(false);
    expect(puedeCrear({ ...ok, desde: '2026-10-11', hasta: '2026-10-05' })).toBe(false);
    expect(puedeCrear({ ...ok, enviando: true })).toBe(false);
    const muchos = Array.from({ length: MAX_AGREGADOS + 1 }, (_, i) => candidatoDeArroba(arroba(`persona${i}`, 'P', `${i}`)));
    expect(MAX_AGREGADOS).toBe(19);
    expect(puedeCrear({ ...ok, agregados: muchos.slice(0, MAX_AGREGADOS) })).toBe(true);
    expect(puedeCrear({ ...ok, agregados: muchos }), 'yo + 20 no entra').toBe(false);
  });

  it('🔴 la llave: la MISMA para reintentar el mismo pedido, NUEVA si el pedido cambió', () => {
    let n = 0;
    const nueva = () => `llave-${++n}-xxxxxxxx`;
    const a = contenidoDelPedido('Cancún', '', '', [candidatoDeAmigo(leo)]);
    const primera = llaveParaElPedido(null, a, nueva);
    expect(primera.clave).toBe('llave-1-xxxxxxxx');
    expect(llaveParaElPedido(primera, contenidoDelPedido(' Cancún ', '', '', [candidatoDeAmigo(leo)]), nueva)).toBe(primera);
    const otra = llaveParaElPedido(primera, contenidoDelPedido('Cancún', '', '', [candidatoDeAmigo(leo), candidatoDeAmigo(juan)]), nueva);
    expect(otra.clave).toBe('llave-2-xxxxxxxx');
    expect(llaveParaElPedido(otra, contenidoDelPedido('Cancún', '2026-10-05', '', [candidatoDeAmigo(leo), candidatoDeAmigo(juan)]), nueva).clave)
      .toBe('llave-3-xxxxxxxx');
  });
});

describe('AF-VIAJES · 1d · lo que dice cuando no se creó', () => {
  it('cada error del dueño con su frase', () => {
    expect(mensajeAlCrear({ tipo: 'miembro_no_encontrado', username: 'mariana' }, t)).toBe('No encontramos a @mariana. Revísalo.');
    expect(mensajeAlCrear({ tipo: 'miembro_no_encontrado', username: null }, t)).toBe('No encontramos a esa persona. Revísalo.');
    expect(mensajeAlCrear({ tipo: 'limite_miembros' }, t)).toBe('Un viaje admite hasta 20 personas.');
    expect(mensajeAlCrear({ tipo: 'demasiadas_invitaciones' }, t)).toBe('Muchas invitaciones seguidas. Prueba en unos minutos.');
    expect(mensajeAlCrear({ tipo: 'reintentar' }, t)).toBe('No pudimos guardarlo. Prueba de nuevo.');
  });
});

describe('AF-VIAJES · la fila de una persona', () => {
  it('nombre, iniciales y su @ (apagado, sin @)', () => {
    expect(filaDe(candidatoDeAmigo(sofia), true)).toEqual({ clave: `u:${sofia.id}`, nombre: 'Sofía Fernández', iniciales: 'SF', arroba: '@sofi.fernandez' });
    expect(filaDe(candidatoDeAmigo(sofia), false).arroba).toBeNull();
    expect(filaDe(candidatoDeAmigo(leo), true).arroba).toBeNull();
    expect(filaDe(candidatoDeArroba(arroba('mariana', 'Mariana', 'Díaz')), false).arroba, 'lo que mostró la búsqueda ya es un @').toBe('@mariana');
  });
});
