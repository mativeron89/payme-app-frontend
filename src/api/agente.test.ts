import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AGENTE_APAGADO, MAX_LUGARES_CERCA, asegurarEstadoDelAgente, confirmarCalificacion, decodeCalificacion, decodeCerca,
  decodeEstadoDelAgente, decodeParaVos, decodePresupuesto, enlaceDeAtribucion, montoDePresupuestoValido, pedirUbicacion,
  redondearUbicacion, reiniciarEstadoDelAgenteParaTests, rutaDeCalificacion,
} from './agente';
import { capacidadOpcional, reiniciarSugerenciasParaTests } from './sugerencias';
import { ultimoVisto } from './ultimoVisto';

/**
 * D554 · el consumidor del contrato `agente-e1-v1` del dueño App Backend 2.208.0. Las formas de acá son las del
 * schema del dueño (`contract/agente-e1-v1.schema.json`): cualquier otra cosa se rechaza, y el rechazo esconde la
 * pieza en la pantalla en vez de inventar un dato.
 */

const PRESUPUESTO = { monto_cents: 420000, origen: 'automatico', promedio_cents: 420000, gastado_cents: 186750, basis: 'consumption' };
const LUGAR = { ref: 'osm:n1', nombre: 'Taquería', cocina: 'mexican', distancia_m: 250, nivel: 'confirmado', estrellas: { promedio: 4.6, cuentas: 7 } };
const ATRIBUCION = { textos: ['OSM'], urls: ['https://www.openstreetmap.org/copyright'] };

afterEach(() => {
  reiniciarEstadoDelAgenteParaTests();
  reiniciarSugerenciasParaTests();
});

describe('D554 · estado del agente', () => {
  it('lee las dos banderas, de claves exactas', () => {
    expect(decodeEstadoDelAgente({ recomendaciones: { enabled: true }, calificaciones: { enabled: false } }))
      .toEqual({ recomendaciones: true, calificaciones: false });
  });

  it.each([
    [{ recomendaciones: { enabled: true } }],
    [{ recomendaciones: { enabled: 'true' }, calificaciones: { enabled: false } }],
    [{ recomendaciones: { enabled: true, extra: 1 }, calificaciones: { enabled: false } }],
    [{ recomendaciones: true, calificaciones: false }],
    [null],
  ])('🔴 otra forma ⇒ error: %j', (v) => {
    expect(() => decodeEstadoDelAgente(v)).toThrow('agente_estado_malformed');
  });

  it('se lee una vez por sesión (single-flight) y alimenta la capacidad de «Recomendaciones»', async () => {
    const leer = vi.fn(async () => ({ recomendaciones: true, calificaciones: false }));
    const [a, b] = await Promise.all([asegurarEstadoDelAgente(leer), asegurarEstadoDelAgente(leer)]);
    expect(a).toEqual(b);
    expect(leer).toHaveBeenCalledTimes(1);
    expect(capacidadOpcional('recomendaciones')).toEqual({ supported: true, enabled: true });
  });

  it('🔴 un error (backend anterior: 404, o red) es todo apagado y SIN fila de permiso', async () => {
    const estado = await asegurarEstadoDelAgente(async () => { throw new Error('404'); });
    expect(estado).toEqual(AGENTE_APAGADO);
    expect(capacidadOpcional('recomendaciones')).toBeNull();
  });

  it('🔴 al cambiar la sesión, la lectura en vuelo de la cuenta anterior se olvida y se vuelve a preguntar', async () => {
    let soltar: (e: { recomendaciones: boolean; calificaciones: boolean }) => void = () => undefined;
    const vieja = vi.fn(() => new Promise<{ recomendaciones: boolean; calificaciones: boolean }>((r) => { soltar = r; }));
    const nueva = vi.fn(async () => ({ recomendaciones: false, calificaciones: false }));
    const enVuelo = asegurarEstadoDelAgente(vieja);
    ultimoVisto.vaciar();
    await asegurarEstadoDelAgente(nueva);
    expect(nueva).toHaveBeenCalledTimes(1);
    soltar({ recomendaciones: true, calificaciones: true });
    await enVuelo;
  });

  it('apagado en el dueño: la capacidad queda anunciada pero apagada (sólo revocar)', async () => {
    await asegurarEstadoDelAgente(async () => ({ recomendaciones: false, calificaciones: false }));
    expect(capacidadOpcional('recomendaciones')).toEqual({ supported: true, enabled: false });
  });
});

describe('D554 · R-13 a · presupuesto', () => {
  it('automático: el monto es el promedio', () => {
    expect(decodePresupuesto(PRESUPUESTO)).toEqual({
      montoCents: 420000, origen: 'automatico', promedioCents: 420000, gastadoCents: 186750, basis: 'consumption',
    });
  });

  it('editado y sin historial', () => {
    expect(decodePresupuesto({ ...PRESUPUESTO, monto_cents: 300000, origen: 'editado' }).origen).toBe('editado');
    expect(decodePresupuesto({ monto_cents: null, origen: null, promedio_cents: null, gastado_cents: 0, basis: 'payments' }).montoCents)
      .toBeNull();
  });

  it.each([
    ['automático con otro monto', { ...PRESUPUESTO, monto_cents: 1 }],
    ['editado sin monto', { ...PRESUPUESTO, origen: 'editado', monto_cents: null }],
    ['sin origen con monto', { ...PRESUPUESTO, origen: null }],
    ['centavos con decimales', { ...PRESUPUESTO, gastado_cents: 10.5 }],
    ['gastado negativo', { ...PRESUPUESTO, gastado_cents: -1 }],
    ['basis desconocido', { ...PRESUPUESTO, basis: 'wallet' }],
    ['clave de más', { ...PRESUPUESTO, tope: 1 }],
  ])('🔴 %s ⇒ error', (_n, v) => {
    expect(() => decodePresupuesto(v)).toThrow('agente_presupuesto_malformed');
  });

  it('el monto que acepta el PUT: centavos enteros de 100 a 100.000.000', () => {
    expect(montoDePresupuestoValido(100)).toBe(true);
    expect(montoDePresupuestoValido(100_000_000)).toBe(true);
    expect(montoDePresupuestoValido(99)).toBe(false);
    expect(montoDePresupuestoValido(100_000_001)).toBe(false);
    expect(montoDePresupuestoValido(150.5)).toBe(false);
  });
});

describe('D554 · «para vos»', () => {
  it('franja, es tu hora, hasta 3 platos con 3 visitas o más y el presupuesto', () => {
    const r = decodeParaVos({ franja_habitual: 'cena', es_tu_hora: true, platos: [{ nombre: 'Tacos', visitas: 3 }], presupuesto: PRESUPUESTO });
    expect(r.franjaHabitual).toBe('cena');
    expect(r.platos).toEqual([{ nombre: 'Tacos', visitas: 3 }]);
  });

  it.each([
    ['franja desconocida', { franja_habitual: 'brunch' }],
    ['un plato con 2 visitas', { platos: [{ nombre: 'Tacos', visitas: 2 }] }],
    ['cuatro platos', { platos: Array.from({ length: 4 }, () => ({ nombre: 'Tacos', visitas: 3 })) }],
    ['un plato sin nombre', { platos: [{ nombre: ' ', visitas: 3 }] }],
  ])('🔴 %s ⇒ error', (_n, cambio) => {
    expect(() => decodeParaVos({ franja_habitual: null, es_tu_hora: false, platos: [], presupuesto: PRESUPUESTO, ...cambio }))
      .toThrow('agente_para_vos_malformed');
  });
});

describe('D554 · «cerca» (R-4 a, R-6 a, R-7 a)', () => {
  const cerca = (lugares: unknown[], extra: Record<string, unknown> = {}) => ({
    radio_m: 1000, platos: [{ nombre: 'Tacos', visitas: 3, lugares }], atribucion: ATRIBUCION, ...extra,
  });

  it('lee lo que el dueño publica de cada local, y nada más', () => {
    const r = decodeCerca(cerca([LUGAR, { ...LUGAR, ref: 'osm:n2', nivel: 'probable', cocina: null, estrellas: null }]));
    expect(r.platos[0]!.lugares).toEqual([
      { ref: 'osm:n1', nombre: 'Taquería', cocina: 'mexican', distanciaM: 250, nivel: 'confirmado', estrellas: { promedio: 4.6, cuentas: 7 } },
      { ref: 'osm:n2', nombre: 'Taquería', cocina: null, distanciaM: 250, nivel: 'probable', estrellas: null },
    ]);
  });

  it.each([
    ['🔴 una dirección', { ...LUGAR, direccion: 'Av. Siempre Viva 742' }],
    ['🔴 coordenadas', { ...LUGAR, lat: 19.43, lon: -99.13 }],
    ['distancia no múltiplo de 50', { ...LUGAR, distancia_m: 260 }],
    ['distancia menor a 50', { ...LUGAR, distancia_m: 0 }],
    ['nivel desconocido', { ...LUGAR, nivel: 'seguro' }],
    ['estrellas con menos de 3 cuentas', { ...LUGAR, estrellas: { promedio: 5, cuentas: 2 } }],
    ['estrellas fuera de 1–5', { ...LUGAR, estrellas: { promedio: 5.5, cuentas: 3 } }],
  ])('%s ⇒ error', (_n, lugar) => {
    expect(() => decodeCerca(cerca([lugar]))).toThrow('agente_cerca_malformed');
  });

  it('🔴 más de 10 lugares en total (x-tope) ⇒ error', () => {
    const cinco = Array.from({ length: 5 }, (_, i) => ({ ...LUGAR, ref: `r${i}` }));
    const platos = [0, 1, 2].map((i) => ({ nombre: `P${i}`, visitas: 3, lugares: i < 2 ? cinco : [LUGAR] }));
    expect(MAX_LUGARES_CERCA).toBe(10);
    expect(() => decodeCerca({ radio_m: 1000, platos, atribucion: ATRIBUCION })).toThrow('agente_cerca_malformed');
  });

  it('radio sólo 1000 o 3000, y la atribución siempre', () => {
    expect(() => decodeCerca(cerca([], { radio_m: 500 }))).toThrow();
    expect(() => decodeCerca({ radio_m: 1000, platos: [] })).toThrow();
  });

  it('sólo un enlace https llega a un href', () => {
    expect(enlaceDeAtribucion('https://overturemaps.org')).toBe('https://overturemaps.org');
    expect(enlaceDeAtribucion('http://www.apache.org/licenses/LICENSE-2.0')).toBeNull();
    expect(enlaceDeAtribucion('javascript:alert(1)')).toBeNull();
    expect(enlaceDeAtribucion(undefined)).toBeNull();
  });
});

describe('D554 · R-4 a · la ubicación del momento', () => {
  it('se redondea a 3 decimales (unos 110 m)', () => {
    expect(redondearUbicacion(19.432608, -99.133209)).toEqual({ lat: 19.433, lon: -99.133 });
    expect(redondearUbicacion(-0.0001, 0.0004)).toEqual({ lat: 0, lon: 0 });
  });

  it('fuera de rango o no finita: no se manda', () => {
    expect(redondearUbicacion(91, 0)).toBeNull();
    expect(redondearUbicacion(0, 181)).toBeNull();
    expect(redondearUbicacion(Number.NaN, 0)).toBeNull();
  });

  it('pide una vez, con baja precisión, y devuelve la redondeada', async () => {
    const getCurrentPosition = vi.fn((
      ok: (p: { coords: { latitude: number; longitude: number } }) => void,
      _error: unknown,
      _opciones: { enableHighAccuracy: boolean },
    ) => {
      ok({ coords: { latitude: 19.4326081, longitude: -99.1332081 } });
    });
    await expect(pedirUbicacion({ getCurrentPosition })).resolves.toEqual({ tipo: 'ok', ubicacion: { lat: 19.433, lon: -99.133 } });
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(getCurrentPosition.mock.calls[0]![2]).toMatchObject({ enableHighAccuracy: false });
  });

  it('negada (código 1), otro error o sin la API', async () => {
    await expect(pedirUbicacion({ getCurrentPosition: (_ok, err) => err({ code: 1 }) })).resolves.toEqual({ tipo: 'negada' });
    await expect(pedirUbicacion({ getCurrentPosition: (_ok, err) => err({ code: 3 }) })).resolves.toEqual({ tipo: 'no_disponible' });
    await expect(pedirUbicacion(undefined)).resolves.toEqual({ tipo: 'no_disponible' });
  });

  it('🔴 la fachada del agente no toca el almacenamiento del dispositivo', () => {
    for (const ruta of ['./agente.ts', '../agente/TarjetaCerca.tsx']) {
      const src = readFileSync(new URL(ruta, import.meta.url), 'utf8');
      // `ultimoVisto` sólo para enterarse del cambio de sesión: nada se guarda ahí.
      expect(src).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie|ultimoVisto\.guardar/);
    }
  });

  it('🔴 la ubicación viaja en el cuerpo: ninguna ruta del agente lleva query', () => {
    const src = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/RUTA_CERCA, \{ lat: u\.lat, lon: u\.lon \}/);
    expect(readFileSync(new URL('./agente.ts', import.meta.url), 'utf8')).not.toMatch(/\/agente\/[^'`]*\?/);
  });
});

describe('D553 · R-8 a · la calificación', () => {
  const C = { estrellas: 4, creada_en: '2026-10-29T01:00:00.000Z', actualizada_en: '2026-10-29T01:00:00.000Z' };

  it('null o la propia, de claves exactas', () => {
    expect(decodeCalificacion({ calificacion: null })).toBeNull();
    expect(decodeCalificacion({ calificacion: C })).toEqual({ estrellas: 4, creadaEn: C.creada_en, actualizadaEn: C.actualizada_en });
  });

  it.each([[{ ...C, estrellas: 6 }], [{ ...C, estrellas: 0 }], [{ ...C, estrellas: 3.5 }], [{ ...C, mesa_id: 'x' }], [{ ...C, creada_en: 'ayer' }]])(
    '🔴 otra forma ⇒ error: %j', (c) => {
      expect(() => decodeCalificacion({ calificacion: c })).toThrow('agente_calificacion_malformed');
    },
  );

  it('el dueño tiene que confirmar las estrellas pedidas', () => {
    expect(confirmarCalificacion({ calificacion: C }, 4).estrellas).toBe(4);
    expect(() => confirmarCalificacion({ calificacion: C }, 5)).toThrow('agente_calificacion_unconfirmed');
    expect(() => confirmarCalificacion({ calificacion: null }, 4)).toThrow('agente_calificacion_unconfirmed');
  });

  it('el código de la mesa se escapa (C-03)', () => {
    expect(rutaDeCalificacion('PA-1099')).toBe('/agente/mesas/PA-1099/calificacion');
    expect(rutaDeCalificacion('a/b?c')).toBe('/agente/mesas/a%2Fb%3Fc/calificacion');
  });
});
