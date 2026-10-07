import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * D212 · la cámara nativa se abre DENTRO del toque.
 *
 * iOS sólo abre la cámara si el `click()` sobre la entrada ocurre durante el
 * gesto de la persona. Chromium es más permisivo (da unos segundos de margen),
 * así que la suite e2e no puede distinguir «en el toque» de «un rato después»:
 * un `click()` desde un efecto al montar la pantalla pasaría ahí y fallaría en
 * el iPhone. Esta guarda fija la forma: cada `abrirCamaraNativa()` es la primera
 * línea de un manejador de toque, sincrónica, y nunca vive en un efecto.
 */
const barra = readFileSync(new URL('../components/AppBottomBar.tsx', import.meta.url), 'utf8');
const flujo = readFileSync(new URL('../screens/CreateMesaFlow.tsx', import.meta.url), 'utf8');

const llamadas = (fuente: string) => fuente.match(/abrirCamaraNativa\(\)/g)?.length ?? 0;

describe('D212 · la cámara nativa se abre dentro del toque', () => {
  it('🔴 «Nueva» la abre en su propio onClick, antes de navegar y sin esperar nada', () => {
    expect(llamadas(barra)).toBe(1);
    expect(barra).toMatch(/onClick: \(\) => \{\s*abrirCamaraNativa\(\);\s*navigate\('scan'\);\s*\}/);
  });

  it('🔴 en el flujo, sólo `doScan` la abre, y `doScan` sólo se usa como onClick', () => {
    expect(llamadas(flujo)).toBe(1);
    expect(flujo).toMatch(/function doScan\(\) \{\s*abrirCamaraNativa\(\);\s*\}/);
    const usos = flujo.match(/\bdoScan\b/g)?.length ?? 0;
    const comoToque = flujo.match(/onClick=\{doScan\}/g)?.length ?? 0;
    // Uno es la definición; todos los demás, manejadores de toque.
    expect(comoToque).toBeGreaterThan(0);
    expect(usos).toBe(comoToque + 1);
  });

  it('ninguna se llama desde un efecto ni después de un await', () => {
    const efectos = [barra, flujo].flatMap((fuente) =>
      [...fuente.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\n {2}\}, \[/g)].map((m) => m[1]!));
    // Control: el barrido ve los efectos del flujo, incluido el que RECIBE la foto.
    expect(efectos.length).toBeGreaterThanOrEqual(8);
    expect(efectos.some((cuerpo) => cuerpo.includes('alRecibirFotoDeLaCamara'))).toBe(true);
    for (const cuerpo of efectos) {
      expect(cuerpo).not.toContain('abrirCamaraNativa');
      expect(cuerpo).not.toContain('doScan');
    }
    for (const fuente of [barra, flujo]) expect(fuente).not.toMatch(/await[^;]*\n?[^;]*abrirCamaraNativa/);
  });
});
