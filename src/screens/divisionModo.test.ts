import { describe, expect, it } from 'vitest';
import {
  type ModoUI,
  modoContrato,
  participantesTrasCambio,
  pisoDe,
  reparteElTotal,
  tituloStepper,
} from './divisionModo';

const TODOS: ModoUI[] = ['consumo', 'igual', 'total'];

/**
 * El espejo del contrato es la fuente: la guarda NO repite el enum a mano, lo
 * lee. Si el dueño agrega una tercera forma de verdad, este archivo se pone
 * rojo y alguien tiene que venir a mirarlo — que es exactamente lo que se
 * quiere que pase.
 */
const ESPEJO = import.meta.glob('/contract-mirror/schemas/index.js', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const SCHEMAS = ESPEJO['/contract-mirror/schemas/index.js'];

describe('las tres formas de dividir de §1.3-bis contra las dos del contrato', () => {
  it('🔴 el contrato sigue teniendo DOS modos, y son los que traducimos', () => {
    const m = SCHEMAS.match(/division_mode:\s*z\.enum\(\[([^\]]*)\]\)/);
    expect(m, 'el espejo perdió la declaración de division_mode').not.toBeNull();
    const delContrato = [...m![1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
    expect(delContrato).toEqual(['consumo', 'igual']);
    // Y todo lo que emitimos cae adentro de ese enum: sin valores inventados.
    for (const modo of TODOS) expect(delContrato).toContain(modoContrato(modo));
  });

  it('🔴 «pagar el total» viaja como igual — es la MISMA operación del backend', () => {
    expect(modoContrato('total')).toBe('igual');
    expect(modoContrato('igual')).toBe('igual');
    expect(modoContrato('consumo')).toBe('consumo');
  });

  it('🔴 el contrato ya NO exige >= 2: pide que el campo ESTÉ, no que valga 2', () => {
    // El piso bajó a 1 el 2026-08-19 («Una persona puede»), pero la obligación
    // de declarar el número NO: el refine pasó de comparar a exigir presencia.
    // 🔴 Se mira LA LÍNEA DEL REFINE, no el archivo entero: el comentario del
    // dueño explica el piso viejo citándolo («`expected_participants >= 2`, y
    // ese piso hacía IMPOSIBLE…»), así que un barrido global matchea la
    // explicación y no la regla. Tercera vez esta semana: se veta lo que
    // EJECUTA, nunca lo que se cuenta.
    const refine = SCHEMAS.match(/\}\)\.refine\(d => d\.division_mode[^\n]*/)?.[0] ?? '';
    expect(refine, 'el espejo perdió el refine de division_mode').not.toBe('');
    expect(refine).not.toMatch(/>=\s*2/);
    expect(refine).toMatch(/expected_participants\s*!==\s*undefined/);
    expect(SCHEMAS).toMatch(/expected_participants:\s*safeInt\.min\(1\)/);
  });

  it('🔴 UNA persona puede «Pagar el total» — es lo que Mati ratificó', () => {
    expect(pisoDe('total')).toBe(1);
  });

  /**
   * 🔴 ESTE TEST DEFIENDE UNA DECISIÓN, NO UN LÍMITE TÉCNICO, y va en la
   * dirección CONTRARIA al de arriba a propósito.
   *
   * El contrato admite 1 para `igual`. Quien lo lea y vea `min(1)` va a querer
   * «corregir» esta UI — y estaría deshaciendo a Mati, que el 2026-08-20 dijo
   * textual: *«"En partes iguales" tiene un mínimo de dos»*. El backend no
   * distingue de qué pantalla vino el request, así que **si este piso se
   * afloja, no queda nada que lo sostenga.**
   */
  it('🔴 «En partes iguales» conserva el mínimo 2, aunque el contrato admita 1', () => {
    expect(pisoDe('igual')).toBe(2);
    expect(pisoDe('consumo')).toBe(1);
  });

  it('DOS títulos para TRES formas, no tres', () => {
    expect(tituloStepper('igual')).toBe('¿Cuántos pagan?');
    expect(tituloStepper('total')).toBe('¿Cuántos pagan?');
    expect(tituloStepper('consumo')).toBe('¿Cuántos son en la mesa?');
    expect(new Set(TODOS.map(tituloStepper)).size).toBe(2);
  });

  it('sólo las que reparten el total muestran un importe «c/u»', () => {
    expect(reparteElTotal('igual')).toBe(true);
    expect(reparteElTotal('total')).toBe(true);
    expect(reparteElTotal('consumo')).toBe(false);
  });

  describe('cambiar de forma no corrige el número por su cuenta', () => {
    it('un N que deja de ser válido vuelve a preguntarse, no se ajusta', () => {
      // Sólo «partes iguales» invalida el 1, y por su piso de UI. 🔴 «Pagar el
      // total» YA NO lo invalida: una persona sola es el caso que Mati
      // habilitó, y devolver `null` acá lo volvería a hacer imposible.
      expect(participantesTrasCambio(1, 'igual')).toBeNull();
      expect(participantesTrasCambio(1, 'total')).toBe(1);
    });

    it('un N que sigue siendo válido se conserva', () => {
      expect(participantesTrasCambio(3, 'total')).toBe(3);
      expect(participantesTrasCambio(2, 'igual')).toBe(2);
      expect(participantesTrasCambio(1, 'consumo')).toBe(1);
      // y bajar de una que exige 2 a una que acepta 1 nunca invalida
      expect(participantesTrasCambio(2, 'consumo')).toBe(2);
    });

    it('sin elegir sigue sin elegir: no se inventa un default al cambiar', () => {
      for (const m of TODOS) expect(participantesTrasCambio(null, m)).toBeNull();
    });
  });
});
