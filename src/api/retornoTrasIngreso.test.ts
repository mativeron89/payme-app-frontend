import { describe, expect, it } from 'vitest';
import {
  CLAVE_RETORNO_MESA,
  VIDA_RETORNO_MS,
  leerRetornoAMesa,
  olvidarRetornoAMesa,
  recordarRetornoAMesa,
  tomarRetornoAMesa,
} from './retornoTrasIngreso';

/**
 * AF-INVITACION-TRAS-GOOGLE · la marca de a qué mesa volver después de entrar
 * con Google en la misma pestaña. Sin token ni dato personal, 30 minutos, un
 * uso. El recorrido está en `e2e/invitacion-mesa-google-redirect.spec.ts`.
 */

function memoria() {
  const datos = new Map<string, string>();
  return {
    datos,
    getItem: (k: string) => datos.get(k) ?? null,
    setItem: (k: string, v: string) => { datos.set(k, v); },
    removeItem: (k: string) => { datos.delete(k); },
  };
}

const T0 = 1_780_000_000_000;

describe('retornoTrasIngreso · la marca', () => {
  it('guarda SÓLO el código y la hora, y se lee igual', () => {
    const m = memoria();
    recordarRetornoAMesa('PA-2847', T0, m);
    expect(JSON.parse(m.datos.get(CLAVE_RETORNO_MESA)!)).toEqual({ code: 'PA-2847', savedAt: T0 });
    expect(leerRetornoAMesa(T0 + 1_000, m)).toEqual({ code: 'PA-2847', savedAt: T0 });
  });

  it('un código con forma rara no se anota', () => {
    const m = memoria();
    recordarRetornoAMesa('', T0, m);
    recordarRetornoAMesa('PA 2847', T0, m);
    recordarRetornoAMesa('x'.repeat(65), T0, m);
    expect(m.datos.size).toBe(0);
  });

  it('vence a los 30 minutos: vencida devuelve null y se BORRA', () => {
    const m = memoria();
    recordarRetornoAMesa('PA-2847', T0, m);
    expect(leerRetornoAMesa(T0 + VIDA_RETORNO_MS, m)).not.toBeNull();
    expect(leerRetornoAMesa(T0 + VIDA_RETORNO_MS + 1, m)).toBeNull();
    expect(m.datos.has(CLAVE_RETORNO_MESA)).toBe(false);
  });

  it('una hora en el futuro tampoco vale', () => {
    const m = memoria();
    recordarRetornoAMesa('PA-2847', T0 + 60_000, m);
    expect(leerRetornoAMesa(T0, m)).toBeNull();
    expect(m.datos.has(CLAVE_RETORNO_MESA)).toBe(false);
  });

  it.each<[string, string]>([
    ['JSON roto', '{'],
    ['un arreglo', '["PA-2847"]'],
    ['con un token de más', JSON.stringify({ code: 'PA-2847', savedAt: T0, token: 'secreto' })],
    ['sin hora', JSON.stringify({ code: 'PA-2847' })],
    ['hora que no es número', JSON.stringify({ code: 'PA-2847', savedAt: '1' })],
    ['código raro', JSON.stringify({ code: 'PA 2847', savedAt: T0 })],
  ])('forma inválida (%s): null y se BORRA', (_nombre, crudo) => {
    const m = memoria();
    m.setItem(CLAVE_RETORNO_MESA, crudo);
    expect(leerRetornoAMesa(T0 + 1_000, m)).toBeNull();
    expect(m.datos.has(CLAVE_RETORNO_MESA)).toBe(false);
  });

  it('uso único: tomarla la devuelve una vez y la borra', () => {
    const m = memoria();
    recordarRetornoAMesa('PA-2847', T0, m);
    expect(tomarRetornoAMesa(T0 + 1_000, m)).toEqual({ code: 'PA-2847', savedAt: T0 });
    expect(tomarRetornoAMesa(T0 + 2_000, m)).toBeNull();
    expect(m.datos.size).toBe(0);
  });

  it('tomar una vencida también la borra', () => {
    const m = memoria();
    recordarRetornoAMesa('PA-2847', T0, m);
    expect(tomarRetornoAMesa(T0 + VIDA_RETORNO_MS + 1, m)).toBeNull();
    expect(m.datos.size).toBe(0);
  });

  it('olvidar la borra; sin storage, nada rompe', () => {
    const m = memoria();
    recordarRetornoAMesa('PA-2847', T0, m);
    olvidarRetornoAMesa(m);
    expect(m.datos.size).toBe(0);
    expect(() => { recordarRetornoAMesa('PA-2847', T0, null); olvidarRetornoAMesa(null); }).not.toThrow();
    expect(leerRetornoAMesa(T0, null)).toBeNull();
  });
});
