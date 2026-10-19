import { describe, expect, it } from 'vitest';
import {
  CLAVE_SALIDA_GOOGLE,
  VIDA_SALIDA_MS,
  hayVueltaDeGoogle,
  leerSalidaAGoogle,
  marcarSalidaAGoogle,
  olvidarSalidaAGoogle,
  revisarSalidaAGoogle,
} from './salidaAGoogle';

/**
 * P02-b · D372 · la marca de que la persona salió a Google. Sólo la hora, 30 minutos, un uso. El recorrido está en
 * `e2e/invitacion-mesa-google-redirect.spec.ts`; que GIS la dispare en el iPhone lo prueba Mati.
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
const SIN_VUELTA = { fase: 'idle', hayVueltaDeAlta: false } as const;

describe('P02-b · la marca de salida a Google', () => {
  it('🔴 guarda SÓLO la hora, y nada más en el almacén', () => {
    const m = memoria();
    marcarSalidaAGoogle(T0, m);
    expect([...m.datos.keys()]).toEqual([CLAVE_SALIDA_GOOGLE]);
    expect(JSON.parse(m.datos.get(CLAVE_SALIDA_GOOGLE)!)).toEqual({ savedAt: T0 });
    expect(leerSalidaAGoogle(T0 + 1, m)).toEqual({ savedAt: T0 });
  });

  it('a los 30 minutos justos vale; un milisegundo después, no, y se borra', () => {
    const m = memoria();
    marcarSalidaAGoogle(T0, m);
    expect(leerSalidaAGoogle(T0 + VIDA_SALIDA_MS, m)).toEqual({ savedAt: T0 });
    expect(leerSalidaAGoogle(T0 + VIDA_SALIDA_MS + 1, m)).toBeNull();
    expect(m.datos.has(CLAVE_SALIDA_GOOGLE)).toBe(false);
  });

  it.each([
    ['del futuro', JSON.stringify({ savedAt: T0 + 1 })],
    ['que no es JSON', '{'],
    ['un arreglo', '[1]'],
    ['vacía', '{}'],
    ['con una clave de más', JSON.stringify({ savedAt: T0, code: 'PA-2847' })],
    ['con la hora como texto', JSON.stringify({ savedAt: String(T0) })],
    ['con una hora infinita', '{"savedAt":1e400}'],
  ])('🔴 una marca %s da null y se borra', (_, crudo) => {
    const m = memoria();
    m.datos.set(CLAVE_SALIDA_GOOGLE, crudo);
    expect(leerSalidaAGoogle(T0, m)).toBeNull();
    expect(m.datos.has(CLAVE_SALIDA_GOOGLE)).toBe(false);
  });

  it('sin almacén, o con uno que tira en todo, no rompe y no avisa', () => {
    const tira = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); }, removeItem: () => { throw new Error('x'); } };
    expect(() => marcarSalidaAGoogle(T0, tira)).not.toThrow();
    expect(() => olvidarSalidaAGoogle(tira)).not.toThrow();
    expect(revisarSalidaAGoogle(SIN_VUELTA, T0, tira)).toBe(false);
    expect(revisarSalidaAGoogle(SIN_VUELTA, T0, null)).toBe(false);
  });
});

describe('P02-b · la revisión: uso único, y nunca con una vuelta de Google', () => {
  it('🔴 sin vuelta y con la marca vigente avisa UNA vez; la segunda, no, y el almacén queda vacío', () => {
    const m = memoria();
    marcarSalidaAGoogle(T0, m);
    expect(revisarSalidaAGoogle(SIN_VUELTA, T0 + 1, m)).toBe(true);
    expect(revisarSalidaAGoogle(SIN_VUELTA, T0 + 2, m)).toBe(false);
    expect(m.datos.size).toBe(0);
  });

  it.each([
    ['en curso', { fase: 'processing', hayVueltaDeAlta: false }],
    ['con error', { fase: 'error', hayVueltaDeAlta: false }],
    ['del alta', { fase: 'idle', hayVueltaDeAlta: true }],
  ] as const)('🔴 con una vuelta %s, Google terminó: no avisa y borra la marca', (_, vuelta) => {
    const m = memoria();
    marcarSalidaAGoogle(T0, m);
    expect(hayVueltaDeGoogle(vuelta)).toBe(true);
    expect(revisarSalidaAGoogle(vuelta, T0 + 1, m)).toBe(false);
    expect(m.datos.has(CLAVE_SALIDA_GOOGLE)).toBe(false);
  });

  it('control positivo: sin vuelta, hayVueltaDeGoogle es falso; sin marca o con la marca vencida, no avisa', () => {
    expect(hayVueltaDeGoogle(SIN_VUELTA)).toBe(false);
    const m = memoria();
    expect(revisarSalidaAGoogle(SIN_VUELTA, T0, m)).toBe(false);
    marcarSalidaAGoogle(T0, m);
    expect(revisarSalidaAGoogle(SIN_VUELTA, T0 + VIDA_SALIDA_MS + 1, m)).toBe(false);
  });
});

describe('P02-b · sin `pagehide` (un F5 en el ingreso también lo dispara y avisaría a quien no salió)', () => {
  const FUENTES = import.meta.glob(['./salidaAGoogle.ts', './googleIdentity.ts', '../screens/LoginScreen.tsx'], {
    query: '?raw', import: 'default', eager: true,
  }) as Record<string, string>;
  const sinComentarios = (src: string) => src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  it('🔴 ninguno de los tres lo escucha; control positivo: los tres archivos están, y la búsqueda ve `pageshow`', () => {
    expect(Object.keys(FUENTES)).toHaveLength(3);
    for (const [ruta, src] of Object.entries(FUENTES)) {
      expect(sinComentarios(src), ruta).not.toMatch(/['"`]pagehide['"`]|onpagehide/);
    }
    expect(sinComentarios(FUENTES['../screens/LoginScreen.tsx']!)).toMatch(/['"`]pageshow['"`]/);
  });
});
