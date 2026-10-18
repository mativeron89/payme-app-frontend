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
const circulo = readFileSync(new URL('../screens/viajes/circuloDelViaje.ts', import.meta.url), 'utf8');
const hoja = readFileSync(new URL('../screens/viajes/HojaParaQueViaje.tsx', import.meta.url), 'utf8');

const llamadas = (fuente: string) => fuente.match(/abrirCamaraNativa\(\)/g)?.length ?? 0;
/** D368 · el menú del teléfono (el `accept` vigente lo lee la cámara en el mismo toque). */
const menus = (fuente: string) => fuente.match(/abrirMenuDeFotos\(\)/g)?.length ?? 0;

describe('D212 · la cámara nativa se abre dentro del toque', () => {
  it('🔴 «Nueva» abre el menú del teléfono (D368) en su propio onClick, antes de navegar y sin esperar nada', () => {
    expect(llamadas(barra)).toBe(0);
    expect(menus(barra)).toBe(1);
    // Entre la apertura y `navigate` sólo puede haber comentarios.
    const sinComentarios = barra.replace(/\/\/[^\n]*/g, '');
    expect(sinComentarios).toMatch(/onClick: \(\) => \{\s*abrirMenuDeFotos\(\);\s*navigate\('scan'\);\s*\}/);
    // Y la barra registra de dónde lee el `accept` el menú: el vigente del dueño.
    expect(sinComentarios).toContain('registrarAcceptDelMenu(acceptVigente);');
  });

  it('🔴 D368 · en un viaje, el «Escanear» de la barra y «¿Para qué viaje?» también abren el menú en el toque', () => {
    const sin = (f: string) => f.replace(/\/\/[^\n]*/g, '');
    expect(llamadas(circulo)).toBe(0);
    expect(menus(circulo)).toBe(1);
    expect(sin(circulo)).toMatch(/onClick: \(\) => \{\s*abrirMenuDeFotos\(\);\s*navigate\('scan', id\);\s*\}/);
    expect(llamadas(hoja)).toBe(0);
    expect(menus(hoja)).toBe(1);
    expect(sin(hoja)).toMatch(/onClick=\{\(\) => \{\s*abrirMenuDeFotos\(\);\s*alElegir\(\);/);
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
    const efectos = [barra, flujo, circulo, hoja].flatMap((fuente) =>
      [...fuente.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\n {2}\}, \[/g)].map((m) => m[1]!));
    // Control: el barrido ve los efectos del flujo, incluido el que RECIBE la foto.
    expect(efectos.length).toBeGreaterThanOrEqual(8);
    expect(efectos.some((cuerpo) => cuerpo.includes('alRecibirFotoDeLaCamara'))).toBe(true);
    for (const cuerpo of efectos) {
      expect(cuerpo).not.toContain('abrirCamaraNativa');
      expect(cuerpo).not.toContain('abrirMenuDeFotos');
      expect(cuerpo).not.toContain('doScan');
    }
    for (const fuente of [barra, flujo, circulo, hoja]) {
      expect(fuente).not.toMatch(/await[^;]*\n?[^;]*abrirCamaraNativa/);
      expect(fuente).not.toMatch(/await[^;]*\n?[^;]*abrirMenuDeFotos/);
    }
  });
});
