import { describe, expect, it } from 'vitest';
import {
  aplicarConfigOcultar,
  decodeCapacidadOcultar,
  decodeMesaOcultada,
  decodePagoOcultado,
  reiniciarOcultarParaTests,
  resultadoDeOcultar,
  sePuedeOcultar,
} from './ocultar';

/**
 * AF-BORRAR-MESAS · D238/D239 · App Backend v2.169.0
 * (`contract-mirror/contract/ocultamientos-v1.json`). La capacidad se lee
 * cerrada: cualquier cosa que no sea exactamente la forma del dueño, encendida,
 * deja la app sin gesto.
 */

const ESTADOS = ['fully_paid', 'expired', 'settling', 'settled', 'dispersing', 'completed', 'auth_failed', 'cancelled', 'dispersed'];
const config = (hide: unknown) => ({ features: { hide_from_app: hide } });
const encendida = { supported: true, enabled: true, hideable_mesa_statuses: ESTADOS };

describe('la capacidad `features.hide_from_app`', () => {
  it('la forma del dueño, encendida: hay gesto, sólo en los estados que publica', () => {
    const c = decodeCapacidadOcultar(config(encendida));
    expect(c.habilitada).toBe(true);
    for (const s of ESTADOS) expect(sePuedeOcultar(c, s), s).toBe(true);
    for (const s of ['open', 'pending_auth', 'partially_paid', 'otro', undefined, null]) {
      expect(sePuedeOcultar(c, s), String(s)).toBe(false);
    }
  });

  it('cualquier otra cosa apaga el gesto', () => {
    const casos: unknown[] = [
      undefined,
      null,
      {},
      { ...encendida, enabled: false },
      { ...encendida, supported: false },
      { ...encendida, enabled: 'true' },
      { ...encendida, extra: true },
      { supported: true, enabled: true },
      { ...encendida, hideable_mesa_statuses: [] },
      { ...encendida, hideable_mesa_statuses: 'fully_paid' },
      { ...encendida, hideable_mesa_statuses: ['fully_paid', 7] },
      { ...encendida, hideable_mesa_statuses: ['Fully Paid'] },
    ];
    for (const c of casos) {
      const d = decodeCapacidadOcultar(config(c));
      expect(d.habilitada, JSON.stringify(c)).toBe(false);
      expect(sePuedeOcultar(d, 'fully_paid'), JSON.stringify(c)).toBe(false);
    }
    expect(decodeCapacidadOcultar({}).habilitada).toBe(false);
    expect(decodeCapacidadOcultar(null).habilitada).toBe(false);
  });

  it('el store toma cada config que llega: se enciende y se vuelve a apagar', () => {
    reiniciarOcultarParaTests();
    expect(aplicarConfigOcultar(config(encendida)).habilitada).toBe(true);
    expect(aplicarConfigOcultar(config(undefined)).habilitada).toBe(false);
    reiniciarOcultarParaTests();
  });
});

describe('las respuestas (claves exactas)', () => {
  it('mesa: PUT y DELETE', () => {
    expect(decodeMesaOcultada({ mesa_code: 'PA-1', hidden: true, include_history: true }, { code: 'PA-1', hidden: true }))
      .toEqual({ mesaCode: 'PA-1', hidden: true, includeHistory: true });
    expect(decodeMesaOcultada({ mesa_code: 'PA-1', hidden: false, include_history: false }, { code: 'PA-1', hidden: false }).hidden)
      .toBe(false);
    for (const raw of [
      { mesa_code: 'PA-2', hidden: true, include_history: true },
      { mesa_code: 'PA-1', hidden: false, include_history: false },
      { mesa_code: 'PA-1', hidden: true },
      { mesa_code: 'PA-1', hidden: true, include_history: 'no' },
      { mesa_code: 'PA-1', hidden: true, include_history: true, extra: 1 },
      null,
    ]) {
      expect(() => decodeMesaOcultada(raw, { code: 'PA-1', hidden: true }), JSON.stringify(raw)).toThrow('hide_mesa_response_malformed');
    }
    // Deshacer nunca deja `include_history` en true.
    expect(() => decodeMesaOcultada({ mesa_code: 'PA-1', hidden: false, include_history: true }, { code: 'PA-1', hidden: false }))
      .toThrow('hide_mesa_response_malformed');
  });

  it('pago: PUT y DELETE', () => {
    expect(decodePagoOcultado({ id: 'p1', hidden: true }, { id: 'p1', hidden: true })).toEqual({ id: 'p1', hidden: true });
    for (const raw of [{ id: 'p2', hidden: true }, { id: 'p1', hidden: false }, { id: 'p1' }, { id: 'p1', hidden: true, x: 1 }]) {
      expect(() => decodePagoOcultado(raw, { id: 'p1', hidden: true }), JSON.stringify(raw)).toThrow('hide_movement_response_malformed');
    }
  });
});

describe('qué dice la pantalla cuando el dueño no oculta', () => {
  it('409 de los dos códigos: en curso; 404: ya no está; otro: reintentar', () => {
    expect(resultadoDeOcultar(409, 'mesa_not_finished')).toBe('en_curso');
    expect(resultadoDeOcultar(409, 'movement_not_hideable')).toBe('en_curso');
    expect(resultadoDeOcultar(409, 'otro_conflicto')).toBe('reintentar');
    expect(resultadoDeOcultar(404, 'mesa_not_found')).toBe('no_esta');
    expect(resultadoDeOcultar(404, 'movement_not_found')).toBe('no_esta');
    expect(resultadoDeOcultar(500, 'internal_error')).toBe('reintentar');
    expect(resultadoDeOcultar(null, 'unknown')).toBe('reintentar');
  });
});
