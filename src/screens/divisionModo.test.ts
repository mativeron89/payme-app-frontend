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

  it('🔴 el piso sale del contrato: el refine exige >= 2 para igual', () => {
    expect(SCHEMAS).toMatch(/division_mode\s*!==\s*'igual'\s*\|\|\s*d\.expected_participants\s*>=\s*2/);
    expect(pisoDe('igual')).toBe(2);
    expect(pisoDe('total')).toBe(2); // hereda el piso porque divide lo mismo
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
      expect(participantesTrasCambio(1, 'igual')).toBeNull();
      expect(participantesTrasCambio(1, 'total')).toBeNull();
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
