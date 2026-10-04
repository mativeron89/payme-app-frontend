import { describe, expect, it } from 'vitest';

/**
 * E173-2 · decisión 173 de Mati, con capturas de su iPhone:
 * - en la app agregada a inicio, «Ni bien abro […] la barra inferior queda
 *   desfasada más arriba, tengo que subir y bajar para que se ajuste»;
 * - en Safari, «la barra inferior no queda correctamente abajo dejando mucho
 *   espacio en blanco».
 *
 * La barra (`.appbar-block`) es `position: absolute; bottom: 0` dentro de
 * `.app`, así que queda donde termina `.app`. Hasta 0.210.4 `.app` medía
 * `height: 100dvh`: la barra quedaba atada a cómo el navegador calcula esa
 * unidad, no al borde de la pantalla. En iOS esa unidad puede no coincidir con
 * el área visible al arrancar la app de inicio (se corrige con el primer
 * scroll), y en Safari con sus barras. Ésa es la hipótesis: el emulador no la
 * reproduce, la prueba en el iPhone la hace Mati.
 *
 * El arreglo ata `.app` al borde del viewport (`position: fixed` con
 * `top`/`bottom` en 0), sin unidades de viewport. Esta guarda vigila ese
 * mecanismo; la geometría la mide `e2e/barra-inferior-viewport.spec.ts`.
 */
const CSS = Object.values(import.meta.glob('/src/styles/global.css', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>)[0]!;

/** El cuerpo de la PRIMERA regla con ese selector exacto, sin comentarios. */
function regla(selector: string): string {
  const m = CSS.match(new RegExp(`\\n${selector.replace(/[.\\]/g, '\\$&')}\\s*{([^}]*)}`));
  if (!m) throw new Error(`global.css perdió la regla ${selector}`);
  // Se vigila lo que EJECUTA, no lo que se cuenta: el comentario de la regla
  // nombra `100dvh` a propósito, para explicar por qué ya no está.
  return m[1]!.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * El valor EFECTIVO de una propiedad en la regla: el de su última declaración.
 * Un `toMatch(/position: fixed/)` pasaría con un `position: relative` más
 * abajo, que es el que gana — y la regla de 0.210.4 terminaba en
 * `position: relative`.
 */
function efectivo(cuerpo: string, propiedad: string): string | null {
  const valores = [...cuerpo.matchAll(new RegExp(`(?:^|[;{\\s])${propiedad}:\\s*([^;]+);`, 'g'))]
    .map((m) => m[1]!.trim());
  return valores.length > 0 ? valores[valores.length - 1]! : null;
}

describe('E173-2 · la barra inferior queda en el borde de la pantalla', () => {
  it('🔴 `.app` se ata al viewport con fixed y top/bottom 0', () => {
    const app = regla('.app');
    expect(efectivo(app, 'position')).toBe('fixed');
    expect(efectivo(app, 'top')).toBe('0');
    expect(efectivo(app, 'bottom')).toBe('0');
  });

  it('🔴 `.app` no toma su alto de una unidad de viewport', () => {
    const app = regla('.app');
    expect(app).not.toMatch(/(?:^|[;\s])(?:min-|max-)?height:\s*[^;]*\b\d+(?:\.\d+)?(?:d|s|l)?vh\b/);
  });

  it('la barra sigue anclada al borde inferior de `.app`', () => {
    const barra = regla('.appbar-block');
    expect(efectivo(barra, 'position')).toBe('absolute');
    expect(efectivo(barra, 'bottom')).toBe('0');
  });
});
