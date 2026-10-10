import { describe, expect, it } from 'vitest';
import type { ViajeEnLista } from '../../api/viajes';
import { traducir } from '../../i18n/idioma';
import {
  agruparPorAnio,
  anchoDeBarra,
  anioDelViaje,
  etiquetaDelViaje,
  lineaDelViaje,
  textoDePersonas,
  tonoDeBalance,
} from './listasView';

const es = (s: string, ...a: unknown[]) => traducir(s, 'es', ...a);
const en = (s: string, ...a: unknown[]) => traducir(s, 'en', ...a);

function viaje(extra: Partial<ViajeEnLista> = {}): ViajeEnLista {
  return {
    id: 'v1', nombre: 'Cancún 2026', fecha_desde: '2026-10-05', fecha_hasta: '2026-10-11', estado: 'abierto',
    personas: 4, mi_balance_cents: -54200, transferencias_pendientes: null, consumiste_cents: null, terminado_en: null,
    color: null, has_photo: false, ...extra,
  };
}

describe('AF-VIAJES · listas · la línea del viaje', () => {
  it('una persona en singular, varias en plural', () => {
    expect(textoDePersonas(1, es)).toBe('1 persona');
    expect(textoDePersonas(4, es)).toBe('4 personas');
    expect(textoDePersonas(4, en)).toBe('4 people');
  });

  it('«5–11 oct · 4 personas»; sin fechas, sólo las personas', () => {
    expect(lineaDelViaje(viaje(), 'es', es)).toBe('5–11 oct · 4 personas');
    expect(lineaDelViaje(viaje(), 'en', en)).toBe('Oct 5–11 · 4 people');
    expect(lineaDelViaje(viaje({ fecha_desde: null, fecha_hasta: null, personas: 1 }), 'es', es)).toBe('1 persona');
    expect(lineaDelViaje(viaje({ fecha_hasta: null }), 'es', es)).toBe('5 oct · 4 personas');
  });
});

describe('AF-VIAJES · listas · el chip de Abiertos', () => {
  it('esperando pagos manda sobre el balance y dice cuántas faltan', () => {
    expect(etiquetaDelViaje(viaje({ estado: 'esperando_pagos', transferencias_pendientes: 2, mi_balance_cents: 30000 })))
      .toEqual({ tipo: 'esperando', faltan: 2 });
  });

  it('abierto: el balance tal como lo publica el dueño', () => {
    expect(etiquetaDelViaje(viaje())).toEqual({ tipo: 'balance', cents: -54200 });
    expect(etiquetaDelViaje(viaje({ mi_balance_cents: 0 }))).toEqual({ tipo: 'balance', cents: 0 });
  });

  it('sin balance publicado (cerrado) no hay chip', () => {
    expect(etiquetaDelViaje(viaje({ estado: 'cerrado', mi_balance_cents: null, consumiste_cents: 100 }))).toEqual({ tipo: 'ninguna' });
  });

  it('el tono sigue al signo: negativo debes, positivo te deben, cero a mano', () => {
    expect(tonoDeBalance(-1)).toBe('debes');
    expect(tonoDeBalance(1)).toBe('te-deben');
    expect(tonoDeBalance(0)).toBe('a-mano');
  });
});

describe('AF-VIAJES · listas · Cerrados por año', () => {
  it('el año sale de fecha_desde y, sin fechas, de terminado_en', () => {
    expect(anioDelViaje({ fecha_desde: '2026-08-14', terminado_en: '2025-01-01T00:00:00.000Z' })).toBe('2026');
    expect(anioDelViaje({ fecha_desde: null, terminado_en: '2025-03-02T10:00:00.000Z' })).toBe('2025');
    expect(anioDelViaje({ fecha_desde: null, terminado_en: null })).toBeNull();
  });

  it('agrupa en el orden en que llegan, sin reordenar', () => {
    const a = viaje({ id: 'a', fecha_desde: '2026-08-14' });
    const b = viaje({ id: 'b', fecha_desde: '2026-07-04' });
    const c = viaje({ id: 'c', fecha_desde: null, fecha_hasta: null, terminado_en: '2025-12-01T00:00:00.000Z' });
    const d = viaje({ id: 'd', fecha_desde: null, fecha_hasta: null, terminado_en: null });
    const grupos = agruparPorAnio([a, b, c, d]);
    expect(grupos.map((g) => [g.anio, g.viajes.map((v) => v.id)])).toEqual([
      ['2026', ['a', 'b']], ['2025', ['c']], [null, ['d']],
    ]);
  });

  it('un año que vuelve a aparecer abre otro grupo: nunca mueve un viaje de lugar', () => {
    const grupos = agruparPorAnio([
      viaje({ id: 'a', fecha_desde: '2026-01-01' }),
      viaje({ id: 'b', fecha_desde: '2025-01-01' }),
      viaje({ id: 'c', fecha_desde: '2026-02-01' }),
    ]);
    expect(grupos.flatMap((g) => g.viajes.map((v) => v.id))).toEqual(['a', 'b', 'c']);
  });

  it('sin viajes, sin grupos', () => {
    expect(agruparPorAnio([])).toEqual([]);
  });
});

describe('AF-VIAJES · detalle cerrado · la barra de «Por tipo de lugar»', () => {
  const porTipo = [
    { tipo_lugar: 'restaurante' as const, monto_cents: 172000 },
    { tipo_lugar: 'bar' as const, monto_cents: 64000 },
    { tipo_lugar: 'super' as const, monto_cents: 50000 },
  ];

  it('es el porcentaje entero de la suma publicada', () => {
    expect(anchoDeBarra(172000, porTipo)).toBe(60);
    expect(anchoDeBarra(64000, porTipo)).toBe(22);
    expect(anchoDeBarra(50000, porTipo)).toBe(17);
  });

  it('nunca negativa, nunca más de 100, y 0 sin montos', () => {
    expect(anchoDeBarra(0, porTipo)).toBe(0);
    expect(anchoDeBarra(100, [])).toBe(0);
    expect(anchoDeBarra(999999, [{ tipo_lugar: 'bar', monto_cents: 1 }])).toBe(100);
  });
});
