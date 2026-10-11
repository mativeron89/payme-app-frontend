/**
 * D276-1 · la cámara de Nueva va al viaje si hoy cae dentro de sus fechas: qué viajes cubren hoy, y la memoria por
 * cuenta (C-07, T-01) de la que la barra lo lee ANTES del toque.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViajeEnLista } from './viajes';

const cuenta = vi.hoisted(() => ({ dueno: 'A' as string | null }));

// La memoria es de la cuenta de la sesión: acá la cuenta la fija el test, con el mismo `UltimoVisto` de producción.
vi.mock('./ultimoVisto', async (importOriginal) => {
  const real = await importOriginal<typeof import('./ultimoVisto')>();
  return { ...real, ultimoVisto: new real.UltimoVisto(() => cuenta.dueno) };
});

const { ultimoVisto, olvidarLoDeViajes } = await import('./ultimoVisto');
const {
  hoyLocal, olvidarViajesAbiertosRecordados, recordarViajesAbiertos, suscribirViajesAbiertos, viajesAbiertosRecordados,
  viajesDeHoy,
} = await import('./viajesDeHoy');

const viaje = (id: string, desde: string | null, hasta: string | null, estado: ViajeEnLista['estado'] = 'abierto') => ({
  id, nombre: `Viaje ${id}`, estado, fecha_desde: desde, fecha_hasta: hasta,
});

/** Lo que trae la lista de abiertos (con montos y todo lo demás, que la memoria NO guarda). */
const enLista = (v: ReturnType<typeof viaje>): ViajeEnLista => ({
  ...v, color: null, has_photo: false, miembros: 4, mi_balance_cents: -54200, gasto_del_grupo_cents: 666000,
} as unknown as ViajeEnLista);

beforeEach(() => {
  cuenta.dueno = 'A';
  olvidarViajesAbiertosRecordados();
});

describe('D276-1 · qué viajes cubren hoy', () => {
  const cancun = viaje('cancun', '2026-10-05', '2026-10-11');

  it('🔴 adentro de las fechas, y también el primer y el último día (inclusive)', () => {
    for (const hoy of ['2026-10-05', '2026-10-08', '2026-10-11']) expect(viajesDeHoy([cancun], hoy), hoy).toEqual([cancun]);
  });

  it('🔴 el día antes y el día después, no', () => {
    expect(viajesDeHoy([cancun], '2026-10-04')).toEqual([]);
    expect(viajesDeHoy([cancun], '2026-10-12')).toEqual([]);
  });

  it('🔴 un viaje sin las DOS fechas no cuenta', () => {
    expect(viajesDeHoy([viaje('a', null, '2026-10-11')], '2026-10-08')).toEqual([]);
    expect(viajesDeHoy([viaje('b', '2026-10-05', null)], '2026-10-08')).toEqual([]);
    expect(viajesDeHoy([viaje('c', null, null)], '2026-10-08')).toEqual([]);
  });

  it('🔴 esperando pagos o cerrado no cuentan, aunque las fechas cubran hoy', () => {
    expect(viajesDeHoy([viaje('e', '2026-10-05', '2026-10-11', 'esperando_pagos')], '2026-10-08')).toEqual([]);
    expect(viajesDeHoy([viaje('f', '2026-10-05', '2026-10-11', 'cerrado')], '2026-10-08')).toEqual([]);
  });

  it('dos que cubren hoy: los dos, en el orden de la lista', () => {
    const otro = viaje('otro', '2026-10-08', '2026-10-09');
    expect(viajesDeHoy([otro, cancun, viaje('x', '2026-11-01', '2026-11-03')], '2026-10-08')).toEqual([otro, cancun]);
  });

  it('la fecha de hoy es la LOCAL del teléfono, `YYYY-MM-DD` con ceros', () => {
    expect(hoyLocal(new Date(2026, 9, 5, 0, 30))).toBe('2026-10-05');
    expect(hoyLocal(new Date(2026, 0, 9, 23, 59))).toBe('2026-01-09');
  });
});

describe('D276-1 · la memoria de los abiertos, por cuenta (C-07) y con el turno de T-01', () => {
  it('guarda sólo lo que decide (id, nombre, estado y fechas), nunca montos', () => {
    recordarViajesAbiertos(ultimoVisto.turno(), [enLista(viaje('cancun', '2026-10-05', '2026-10-11'))]);
    expect(viajesAbiertosRecordados()).toEqual([viaje('cancun', '2026-10-05', '2026-10-11')]);
  });

  it('🔴 lo de una cuenta no lo ve otra', () => {
    recordarViajesAbiertos(ultimoVisto.turno(), [enLista(viaje('cancun', '2026-10-05', '2026-10-11'))]);
    cuenta.dueno = 'B';
    expect(viajesAbiertosRecordados()).toBeNull();
    cuenta.dueno = 'A';
    // Y no vuelve: se borró al leerlo con otra cuenta.
    expect(viajesAbiertosRecordados()).toBeNull();
  });

  it('🔴 una respuesta pedida con la cuenta anterior no se guarda (el turno se saca AL PEDIR)', () => {
    const turnoDeA = ultimoVisto.turno();
    cuenta.dueno = 'B';
    recordarViajesAbiertos(turnoDeA, [enLista(viaje('cancun', '2026-10-05', '2026-10-11'))]);
    expect(viajesAbiertosRecordados()).toBeNull();
  });

  it('🔴 `olvidarLoDeViajes` (crear, aceptar, editar, salir o cerrar) la vacía, y avisa', () => {
    const oyente = vi.fn();
    const soltar = suscribirViajesAbiertos(oyente);
    recordarViajesAbiertos(ultimoVisto.turno(), [enLista(viaje('cancun', '2026-10-05', '2026-10-11'))]);
    expect(oyente).toHaveBeenCalledTimes(1);
    olvidarLoDeViajes();
    expect(viajesAbiertosRecordados()).toBeNull();
    expect(oyente).toHaveBeenCalledTimes(2);
    soltar();
    recordarViajesAbiertos(ultimoVisto.turno(), []);
    expect(oyente).toHaveBeenCalledTimes(2);
  });

  it('sin sesión, nada se lee', () => {
    cuenta.dueno = null;
    recordarViajesAbiertos(ultimoVisto.turno(), [enLista(viaje('cancun', '2026-10-05', '2026-10-11'))]);
    expect(viajesAbiertosRecordados()).toBeNull();
  });
});
