import { describe, expect, it } from 'vitest';
import {
  CLAVE_MODO_MESA,
  CLAVE_RETORNO_MESA,
  VIDA_RETORNO_MS,
  leerModoDeMesa,
  leerRetornoAMesa,
  modoRecordadoParaMesa,
  olvidarRetornoAMesa,
  recordarModoDeMesa,
  recordarRetornoAMesa,
  tomarRetornoAMesa,
} from './retornoTrasIngreso';
import { CLAVE_SALIDA_GOOGLE, marcarSalidaAGoogle } from './salidaAGoogle';

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

describe('P02-a · D372 · el modo de la invitación (alta o ingreso), en su propio registro', () => {
  it('🔴 se guarda como {code, modo, savedAt}; el retorno sigue con sus dos claves; los dos se leen', () => {
    const m = memoria();
    recordarRetornoAMesa('PA-2847', T0, m);
    recordarModoDeMesa('PA-2847', 'register', T0, m);
    expect(JSON.parse(m.datos.get(CLAVE_MODO_MESA)!)).toEqual({ code: 'PA-2847', modo: 'register', savedAt: T0 });
    expect(Object.keys(JSON.parse(m.datos.get(CLAVE_RETORNO_MESA)!)).sort()).toEqual(['code', 'savedAt']);
    expect(leerRetornoAMesa(T0 + 1, m)).toEqual({ code: 'PA-2847', savedAt: T0 });
    expect(modoRecordadoParaMesa('PA-2847', T0 + 1, m)).toBe('register');
  });

  it('el modo de OTRA mesa no se usa, y no se borra', () => {
    const m = memoria();
    recordarModoDeMesa('PA-1111', 'login', T0, m);
    expect(modoRecordadoParaMesa('PA-2847', T0 + 1, m)).toBeNull();
    expect(m.datos.has(CLAVE_MODO_MESA)).toBe(true);
  });

  it('un código raro o un modo que no es alta ni ingreso no se anotan', () => {
    const m = memoria();
    recordarModoDeMesa('PA 2847', 'login', T0, m);
    recordarModoDeMesa('PA-2847', 'otro' as never, T0, m);
    expect(m.datos.has(CLAVE_MODO_MESA)).toBe(false);
  });

  it.each([
    ['vencido', JSON.stringify({ code: 'PA-2847', modo: 'login', savedAt: T0 - VIDA_RETORNO_MS - 1 })],
    ['del futuro', JSON.stringify({ code: 'PA-2847', modo: 'login', savedAt: T0 + 1 })],
    ['con una clave de más', JSON.stringify({ code: 'PA-2847', modo: 'login', savedAt: T0, token: 'x' })],
    ['sin modo', JSON.stringify({ code: 'PA-2847', savedAt: T0 })],
    ['con otro modo', JSON.stringify({ code: 'PA-2847', modo: 'admin', savedAt: T0 })],
    ['que no es JSON', '{'],
  ])('🔴 un modo %s da null y se borra SÓLO el modo (el retorno queda)', (_, crudo) => {
    const m = memoria();
    recordarRetornoAMesa('PA-2847', T0, m);
    m.datos.set(CLAVE_MODO_MESA, crudo);
    expect(leerModoDeMesa(T0, m)).toBeNull();
    expect(m.datos.has(CLAVE_MODO_MESA)).toBe(false);
    expect(m.datos.has(CLAVE_RETORNO_MESA)).toBe(true);
  });

  it('control positivo: a los 30 minutos justos todavía vale', () => {
    const m = memoria();
    recordarModoDeMesa('PA-2847', 'login', T0, m);
    expect(leerModoDeMesa(T0 + VIDA_RETORNO_MS, m)).toEqual({ code: 'PA-2847', modo: 'login', savedAt: T0 });
  });

  it('🔴 olvidar la vuelta borra el retorno, el modo y la salida a Google (P02-b), y deja lo ajeno', () => {
    const m = memoria();
    recordarRetornoAMesa('PA-2847', T0, m);
    recordarModoDeMesa('PA-2847', 'register', T0, m);
    marcarSalidaAGoogle(T0, m);
    m.datos.set('ajena', '1');
    expect(m.datos.has(CLAVE_SALIDA_GOOGLE)).toBe(true);
    olvidarRetornoAMesa(m);
    expect([...m.datos.keys()]).toEqual(['ajena']);
  });

  it('tomar el retorno (al entrar) también se lleva el modo', () => {
    const m = memoria();
    recordarRetornoAMesa('PA-2847', T0, m);
    recordarModoDeMesa('PA-2847', 'register', T0, m);
    tomarRetornoAMesa(T0 + 1, m);
    expect(m.datos.has(CLAVE_MODO_MESA)).toBe(false);
  });

  it('si borrar el retorno falla, el modo y la salida se borran igual (cada borrado en su intento)', () => {
    const m = memoria();
    recordarModoDeMesa('PA-2847', 'login', T0, m);
    marcarSalidaAGoogle(T0, m);
    const quisquilloso = { ...m, removeItem: (k: string) => { if (k === CLAVE_RETORNO_MESA) throw new Error('no'); m.datos.delete(k); } };
    olvidarRetornoAMesa(quisquilloso);
    expect(m.datos.has(CLAVE_MODO_MESA)).toBe(false);
    expect(m.datos.has(CLAVE_SALIDA_GOOGLE)).toBe(false);
  });

  it('un retorno inválido se borra al leerse, sin llevarse el modo (es otro registro, con su propia validez)', () => {
    const m = memoria();
    recordarModoDeMesa('PA-2847', 'login', T0, m);
    m.datos.set(CLAVE_RETORNO_MESA, '{');
    expect(leerRetornoAMesa(T0, m)).toBeNull();
    expect(m.datos.has(CLAVE_RETORNO_MESA)).toBe(false);
    expect(m.datos.has(CLAVE_MODO_MESA)).toBe(true);
  });
});
