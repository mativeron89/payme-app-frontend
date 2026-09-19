import { describe, expect, it } from 'vitest';
import { decodeMesaCerrada, resultadoDeCerrar } from './cerrarMesa';
import { cerroSinCobros, motivoDelCierre } from '../screens/MesaScreen';
import { sePuedeCerrar } from '../screens/MesaDetailView';

describe('AF-34 · POST /close', () => {
  it('lee el 200 del dueño con claves exactas', () => {
    expect(decodeMesaCerrada({ mesa_status: 'expired', closure_reason: 'closed_by_organizer' }))
      .toEqual({ mesaStatus: 'expired', closureReason: 'closed_by_organizer' });
    for (const malo of [{}, { mesa_status: 'expired' }, { mesa_status: 'open', closure_reason: 'closed_by_organizer' },
      { mesa_status: 'expired', closure_reason: 'closed_by_organizer', extra: 1 }]) {
      expect(() => decodeMesaCerrada(malo)).toThrow('close_response_malformed');
    }
  });

  it('cada respuesta tiene su acción', () => {
    expect(resultadoDeCerrar(409, 'mesa_not_active')).toEqual({ accion: 'recargar', aviso: 'ya_cerrada' });
    expect(resultadoDeCerrar(403, 'not_mesa_organizer')).toEqual({ accion: 'retirar', aviso: null });
    expect(resultadoDeCerrar(409, 'close_not_applicable')).toEqual({ accion: 'retirar', aviso: 'no_disponible' });
    expect(resultadoDeCerrar(404, 'not_found')).toEqual({ accion: 'retirar', aviso: 'no_disponible' });
    expect(resultadoDeCerrar(500, 'internal_error')).toEqual({ accion: 'reintentar' });
    expect(resultadoDeCerrar(null, 'unknown')).toEqual({ accion: 'reintentar' });
  });
});

describe('AF-34 · quién ve «Cerrar mesa»', () => {
  const MESA = { my_role: 'opener' as const, guarantee_mode: false, status: 'open' as const };
  it('el organizador de una mesa sin garantía activa', () => {
    expect(sePuedeCerrar(MESA)).toBe(true);
    // `partially_paid` NO: el dueño sólo cierra `open` (responde «ya estaba cerrada»).
    expect(sePuedeCerrar({ ...MESA, status: 'partially_paid' })).toBe(false);
  });
  it('🔴 nunca quien no organiza, ni con garantía, ni cerrada', () => {
    expect(sePuedeCerrar({ ...MESA, my_role: 'participant' })).toBe(false);
    expect(sePuedeCerrar({ ...MESA, my_role: null })).toBe(false);
    expect(sePuedeCerrar({ ...MESA, guarantee_mode: true })).toBe(false);
    expect(sePuedeCerrar({ ...MESA, guarantee_mode: undefined })).toBe(false);
    expect(sePuedeCerrar({ ...MESA, status: 'expired' })).toBe(false);
  });
});

describe('AF-34 · la mesa cerrada por el organizador', () => {
  it('🔴 cuenta como cierre SIN cobros: nunca «Tu garantía cubrió»', () => {
    expect(cerroSinCobros({ closure_reason: 'closed_by_organizer' })).toBe(true);
    expect(cerroSinCobros({ closure_reason: 'algo_nuevo' })).toBe(false);
  });
  it('su motivo en palabras, según quién mira', () => {
    const t = (s: string) => s;
    expect(motivoDelCierre('closed_by_organizer', true, t)).toBe('La cerraste tú.');
    expect(motivoDelCierre('closed_by_organizer', false, t)).toBe('La cerró quien la organizó.');
    expect(motivoDelCierre('time', false, t)).toBe('Venció el tiempo de la mesa.');
    expect(motivoDelCierre('algo_nuevo', false, t)).toBeNull();
  });
});
