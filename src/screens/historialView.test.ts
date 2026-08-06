import { describe, expect, it } from 'vitest';
import type { HistoryEntry, MesaStatus } from '../api/types';
import {
  agruparPorMes,
  agruparPorMesa,
  esMesaAbierta,
  franjaDe,
  mesasCerradas,
} from './historialView';

const pago = (
  id: string,
  over: Partial<HistoryEntry> = {},
): HistoryEntry => ({
  id,
  amount_cents: 10000,
  date: '2026-08-01T20:00:00.000Z',
  mesa_code: 'PA-1000',
  mesa_status: 'completed',
  restaurant: 'La Parolaccia',
  category: 'italian',
  ...over,
});

describe('esMesaAbierta — espeja el filtro de GET /mesas/open', () => {
  /**
   * La lista de "abiertas" NO es criterio propio: es `m.status IN
   * ('open','partially_paid')` de `contract-mirror/routes/mesas.js`. Si este
   * test rompe porque el emisor cambió la lista, el arreglo es espejar, no
   * ajustar el test para que pase.
   */
  it('open y partially_paid son las únicas abiertas', () => {
    const todos: MesaStatus[] = [
      'pending_auth', 'open', 'partially_paid', 'fully_paid', 'expired',
      'settling', 'settled', 'dispersing', 'completed', 'auth_failed', 'cancelled',
    ];
    expect(todos.filter(esMesaAbierta)).toEqual(['open', 'partially_paid']);
  });
});

describe('agruparPorMesa', () => {
  it('suma MIS pagos de la misma mesa — pagar varias partes está ratificado', () => {
    const g = agruparPorMesa([
      pago('1', { amount_cents: 3000 }),
      pago('2', { amount_cents: 4500 }),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0]!.amount_cents).toBe(7500);
  });

  it('ordena las mesas por último pago, más nueva primero', () => {
    const g = agruparPorMesa([
      pago('1', { mesa_code: 'PA-1', date: '2026-08-01T20:00:00.000Z' }),
      pago('2', { mesa_code: 'PA-2', date: '2026-08-03T20:00:00.000Z' }),
    ]);
    expect(g.map((m) => m.mesa_code)).toEqual(['PA-2', 'PA-1']);
  });

  /**
   * El estado se toma del renglón MÁS NUEVO aunque llegue desordenado: si un
   * backend viejo mandara fotos en vez del estado vivo, la más reciente es la
   * menos mentirosa.
   */
  it('el estado de la mesa es el del renglón más nuevo, venga en el orden que venga', () => {
    const g = agruparPorMesa([
      pago('2', { date: '2026-08-03T20:00:00.000Z', mesa_status: 'completed' }),
      pago('1', { date: '2026-08-01T20:00:00.000Z', mesa_status: 'partially_paid' }),
    ]);
    expect(g[0]!.mesa_status).toBe('completed');

    const alReves = agruparPorMesa([
      pago('1', { date: '2026-08-01T20:00:00.000Z', mesa_status: 'partially_paid' }),
      pago('2', { date: '2026-08-03T20:00:00.000Z', mesa_status: 'completed' }),
    ]);
    expect(alReves[0]!.mesa_status).toBe('completed');
  });
});

describe('mesasCerradas — la mesa abierta no se repite acá (§1.10)', () => {
  it('excluye la mesa viva del organizador que ya pagó su parte', () => {
    /* El defecto medido por AF9: pagás tu parte, la mesa sigue viva, y el
       historial la pintaba bajo un encabezado de mes como si hubiera terminado
       — la misma mesa dos veces en pantalla. */
    const g = mesasCerradas([
      pago('1', { mesa_code: 'PA-VIVA', mesa_status: 'partially_paid' }),
      pago('2', { mesa_code: 'PA-CERRADA', mesa_status: 'completed' }),
    ]);
    expect(g.map((m) => m.mesa_code)).toEqual(['PA-CERRADA']);
  });

  it('filtra la MESA agrupada, no el pago suelto', () => {
    /* Dos pagos a la misma mesa viva: si el filtro corriera por renglón antes
       de agrupar, un renglón con foto vieja "cerrada" colaría la mesa entera. */
    const g = mesasCerradas([
      pago('1', { date: '2026-08-01T20:00:00.000Z', mesa_status: 'fully_paid' }),
      pago('2', { date: '2026-08-03T20:00:00.000Z', mesa_status: 'partially_paid' }),
    ]);
    expect(g).toEqual([]);
  });

  it('expirada es cerrada: la garantía ya capturó el faltante (A-2)', () => {
    const g = mesasCerradas([pago('1', { mesa_status: 'expired' })]);
    expect(g).toHaveLength(1);
  });
});

describe('franjaDe — cortes locales decididos por este front', () => {
  /* Fechas SIN zona (`T13:00:00`, sin `Z`): `new Date` las toma como hora
     local, que es exactamente lo que `franjaDe` mide con `getHours()`. Así el
     test no depende del huso de la máquina que lo corre. */
  it('reparte las cuatro franjas: 6–12 · 12–16 · 16–20 · 20–6', () => {
    expect(franjaDe('2026-08-05T06:00:00')).toBe('manana');
    expect(franjaDe('2026-08-05T11:59:00')).toBe('manana');
    expect(franjaDe('2026-08-05T12:00:00')).toBe('mediodia');
    expect(franjaDe('2026-08-05T15:59:00')).toBe('mediodia');
    expect(franjaDe('2026-08-05T16:00:00')).toBe('tarde');
    expect(franjaDe('2026-08-05T19:59:00')).toBe('tarde');
    expect(franjaDe('2026-08-05T20:00:00')).toBe('noche');
    expect(franjaDe('2026-08-05T05:59:00')).toBe('noche');
  });

  it('fecha ilegible: null, nunca una franja inventada', () => {
    expect(franjaDe('no-es-una-fecha')).toBeNull();
  });
});

describe('agruparPorMes', () => {
  const mesa = (code: string, date: string) =>
    agruparPorMesa([pago(code, { mesa_code: code, date })])[0]!;

  it('junta las mesas del mismo mes y conserva el orden de llegada', () => {
    const g = agruparPorMes([
      mesa('PA-1', '2026-08-20T18:00:00.000Z'),
      mesa('PA-2', '2026-08-03T18:00:00.000Z'),
      mesa('PA-3', '2026-07-28T18:00:00.000Z'),
    ]);
    expect(g.map((x) => x.key)).toEqual(['2026-08', '2026-07']);
    expect(g[0]!.mesas.map((m) => m.mesa_code)).toEqual(['PA-1', 'PA-2']);
  });

  it('no mezcla el mismo mes de años distintos', () => {
    const g = agruparPorMes([
      mesa('PA-1', '2026-08-10T18:00:00.000Z'),
      mesa('PA-2', '2025-08-10T18:00:00.000Z'),
    ]);
    expect(g.map((x) => x.key)).toEqual(['2026-08', '2025-08']);
  });

  it('fecha ilegible va al grupo "Sin fecha", no a la basura', () => {
    const g = agruparPorMes([mesa('PA-1', 'no-es-una-fecha')]);
    expect(g).toHaveLength(1);
    expect(g[0]!.key).toBe('sin-fecha');
    expect(g[0]!.label).toBe('Sin fecha');
  });
});
