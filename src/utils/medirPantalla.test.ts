import { describe, expect, it } from 'vitest';
import { numero, registrarToque, textoDelDiagnostico, TOQUES_PARA_ABRIR, VENTANA_TOQUES_MS } from './medirPantalla';

/**
 * E173-2 · el diagnóstico de pantalla. La medición se prueba en el navegador
 * (`e2e/diagnostico-pantalla.spec.ts`, con los insets reales emulados); acá, la
 * regla de los 5 toques y que el panel no pueda sacar nada del teléfono.
 */
describe('E173-2 · 5 toques en el logo', () => {
  const tocar = (tiempos: number[]) => {
    let toques: number[] = [];
    const aperturas: number[] = [];
    for (const t of tiempos) {
      const r = registrarToque(toques, t);
      toques = r.toques;
      if (r.abrir) aperturas.push(t);
    }
    return aperturas;
  };

  it('🔴 5 toques dentro de 3 s abren; 4 no', () => {
    expect(TOQUES_PARA_ABRIR).toBe(5);
    expect(VENTANA_TOQUES_MS).toBe(3_000);
    expect(tocar([0, 200, 400, 600, 800])).toEqual([800]);
    expect(tocar([0, 200, 400, 600])).toEqual([]);
  });

  it('toques más viejos que 3 s no cuentan', () => {
    expect(tocar([0, 1000, 2000, 3000, 3500])).toEqual([]);
    expect(tocar([0, 1000, 2000, 3000, 3500, 3600])).toEqual([3600]);
  });

  it('al abrir, la cuenta vuelve a cero: hacen falta otros 5', () => {
    expect(tocar([0, 100, 200, 300, 400, 500, 600, 700, 800])).toEqual([400]);
    expect(tocar([0, 100, 200, 300, 400, 500, 600, 700, 800, 900])).toEqual([400, 900]);
  });
});

describe('E173-2 · formato', () => {
  it('números con hasta dos decimales; sin número, —', () => {
    expect(numero(793)).toBe('793');
    expect(numero(792.666)).toBe('792.67');
    expect(numero(Number.NaN)).toBe('—');
    expect(numero(undefined)).toBe('—');
  });

  it('el texto para copiar es una fila por línea', () => {
    expect(textoDelDiagnostico([['a', '1'], ['b', '2']])).toBe('a: 1\nb: 2');
  });
});

describe('🔴 E173-2 · el diagnóstico sólo lee', () => {
  const FUENTES = import.meta.glob(['./medirPantalla.ts', '../components/DiagnosticoPantalla.tsx'], {
    query: '?raw', import: 'default', eager: true,
  }) as Record<string, string>;
  const codigo = Object.values(FUENTES).map((s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''));

  it('sin red, sin almacenamiento y sin la sesión ni datos personales', () => {
    expect(codigo).toHaveLength(2);
    for (const c of codigo) {
      for (const prohibido of [
        'fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource',
        'localStorage', 'sessionStorage', 'indexedDB', 'caches.',
        "from '../api'", "from '../api/index'", '/storage', 'useAuth', 'session', 'email', 'payme_id',
      ]) {
        expect(c, prohibido).not.toContain(prohibido);
      }
    }
  });
});
