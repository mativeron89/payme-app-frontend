import { afterEach, describe, expect, it } from 'vitest';
import {
  confirmaPeriodo,
  consultaPeriodo,
  decodePeriodo,
  elegirPeriodo,
  periodoActual,
  resetPeriodoParaTests,
  rutaConPeriodo,
} from './periodoEstadisticas';

afterEach(() => resetPeriodoParaTests());

describe('AF-31 · período de «Mis estadísticas»', () => {
  const ESTE = { key: 'this_month', start: '2026-09-01T06:00:00.000Z', end: null };

  it('lee el `period` del dueño, con claves exactas', () => {
    expect(decodePeriodo(ESTE)).toEqual(ESTE);
    expect(decodePeriodo({ key: 'last_month', start: '2026-08-01T06:00:00.000Z', end: '2026-09-01T06:00:00.000Z' })?.end)
      .toBe('2026-09-01T06:00:00.000Z');
  });

  it('un `period` raro o ausente es «no lo conoce»', () => {
    for (const malo of [undefined, null, {}, { ...ESTE, key: 'yesterday' }, { ...ESTE, start: 'ayer' },
      { ...ESTE, end: 'mañana' }, { key: 'this_month', start: ESTE.start }, { ...ESTE, extra: 1 }]) {
      expect(decodePeriodo(malo), JSON.stringify(malo)).toBeNull();
    }
  });

  it('🔴 sólo CONFIRMA si la respuesta trae el mismo período que se pidió', () => {
    // Un backend anterior ignora `?period=last_month` y manda el mes en curso:
    // si se le creyera al pedido, se rotularía este mes como «Mes pasado».
    expect(confirmaPeriodo('last_month', undefined)).toBeNull();
    expect(confirmaPeriodo('last_month', ESTE)).toBeNull();
    expect(confirmaPeriodo('this_month', ESTE)).toEqual(ESTE);
  });

  it('la ruta lleva el período escapado, o nada', () => {
    expect(consultaPeriodo('last_3_months')).toBe('?period=last_3_months');
    expect(rutaConPeriodo('/account/stats', 'this_year')).toBe('/account/stats?period=this_year');
    expect(rutaConPeriodo('/account/stats')).toBe('/account/stats');
  });

  it('el elegido se conserva entre pantallas y arranca en «Este mes»', () => {
    expect(periodoActual()).toBe('this_month');
    elegirPeriodo('last_month');
    expect(periodoActual()).toBe('last_month');
  });
});
