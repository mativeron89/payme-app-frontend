import { describe, expect, it } from 'vitest';

/**
 * E173-2 · decisión 173 de Mati · la barra de abajo en la app agregada a inicio.
 *
 * La barra (`.appbar-block`) es `position: absolute; bottom: 0` dentro de
 * `.app`, así que queda donde termina `.app`.
 *
 * 🔴 0.210.5 estiró `.app` y en el iPhone de Mati CORTÓ la barra (captura 7):
 * `fixed` + `src/viewportStandalone.ts` imponían el alto de la pantalla (852 pt)
 * cuando WebKit arrancaba con el viewport achicado en el inset superior
 * (793 pt). Medido en píxeles: la barra empezaba en 762 (852 − 90), pero la app
 * se pinta sólo hasta 793. 0.211.0 vuelve a la regla de 0.210.4, la única medida
 * en el iPhone: `.app` mide el viewport que WebKit informa. A lo sumo queda
 * subida, entera; nunca cortada.
 *
 * Esta guarda vigila el mecanismo; la geometría la mide
 * `e2e/barra-inferior-viewport.spec.ts`, con los insets reales emulados.
 */
const CSS = Object.values(import.meta.glob('/src/styles/global.css', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>)[0]!;

/** Todo el código de `src/`, para buscar quién podría estirar `.app`. */
const FUENTES = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** El cuerpo de la PRIMERA regla con ese selector exacto, sin comentarios. */
function regla(selector: string): string {
  const m = CSS.match(new RegExp(`\\n${selector.replace(/[.\\]/g, '\\$&')}\\s*{([^}]*)}`));
  if (!m) throw new Error(`global.css perdió la regla ${selector}`);
  // Se vigila lo que EJECUTA, no lo que se cuenta: el comentario de la regla
  // nombra `fixed` y la variable a propósito, para explicar por qué ya no están.
  return m[1]!.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * El valor EFECTIVO de una propiedad en la regla: el de su última declaración.
 * Un `toMatch(/height: 100dvh/)` pasaría con otro `height` más abajo, que es el
 * que gana.
 */
function efectivo(cuerpo: string, propiedad: string): string | null {
  const valores = [...cuerpo.matchAll(new RegExp(`(?:^|[;{\\s])${propiedad}:\\s*([^;]+);`, 'g'))]
    .map((m) => m[1]!.trim());
  return valores.length > 0 ? valores[valores.length - 1]! : null;
}

const sinComentarios = (texto: string) => texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('E173-2 · la barra inferior nunca queda fuera de lo visible', () => {
  it('🔴 `.app` mide el viewport que informa el navegador (100dvh), como en 0.210.4', () => {
    const app = regla('.app');
    expect(efectivo(app, 'height')).toBe('100dvh');
    expect(efectivo(app, 'min-height')).toBe('100dvh');
    expect(efectivo(app, 'position')).toBe('relative');
  });

  it('🔴 regresión de 0.210.5: nada impone a `.app` un alto mayor que el viewport', () => {
    expect(sinComentarios(CSS)).not.toContain('--app-alto-standalone');
    expect(sinComentarios(CSS)).not.toContain('.viewport-sonda');
    const ofensores = Object.entries(FUENTES)
      .filter(([ruta]) => !ruta.endsWith('.test.ts') && !ruta.endsWith('.test.tsx'))
      .filter(([, codigo]) => /--app-alto-standalone|ajustarViewportStandalone/.test(sinComentarios(codigo)))
      .map(([ruta]) => ruta);
    expect(ofensores).toEqual([]);
    expect(Object.keys(FUENTES)).not.toContain('/src/viewportStandalone.ts');
  });

  it('captura 6 · el inset de abajo reemplaza los 8 px de la barra, no se suma', () => {
    const barra = regla('.appbar');
    expect(efectivo(barra, 'height')).toBe('calc(56px + max(8px, env(safe-area-inset-bottom)))');
    expect(efectivo(barra, 'padding')).toBe('8px var(--sp-2) max(8px, env(safe-area-inset-bottom))');
  });

  it('🔴 D179 · E179b · en la app de inicio de iOS la cadena html → body → #root → `.app` mide 100lvh', () => {
    // Números REALES del iPhone de Mati al abrir (captura 11): 100dvh 794 pero
    // 100lvh 852, el alto de la pantalla. `100vh` va antes, para el iOS sin lvh.
    const cadena = regla('html.app-de-inicio-ios,\nhtml.app-de-inicio-ios body,\nhtml.app-de-inicio-ios #root');
    expect(efectivo(cadena, 'height')).toBe('100lvh');
    expect(cadena).toMatch(/height:\s*100vh;[\s\S]*height:\s*100lvh;/);
    const app = regla('html.app-de-inicio-ios .app');
    expect(efectivo(app, 'height')).toBe('100lvh');
    expect(efectivo(app, 'min-height')).toBe('100lvh');
  });

  it('🔴 E179b no repite 0.210.5: `.app` sigue en el flujo y ningún eslabón recorta', () => {
    const cadena = regla('html.app-de-inicio-ios,\nhtml.app-de-inicio-ios body,\nhtml.app-de-inicio-ios #root');
    const app = regla('html.app-de-inicio-ios .app');
    for (const cuerpo of [cadena, app]) {
      expect(efectivo(cuerpo, 'position')).toBeNull();
      expect(efectivo(cuerpo, 'top')).toBeNull();
      expect(efectivo(cuerpo, 'bottom')).toBeNull();
    }
    expect(efectivo(cadena, 'overflow')).toBeNull();
    // La regla base de `.app` (Safari y todo lo demás) no cambia.
    expect(efectivo(regla('.app'), 'position')).toBe('relative');
    expect(efectivo(regla('html,\nbody,\n#root'), 'height')).toBe('100%');
    expect(efectivo(regla('html,\nbody,\n#root'), 'overflow')).toBeNull();
  });

  it('la barra sigue anclada al borde inferior de `.app`', () => {
    const barra = regla('.appbar-block');
    expect(efectivo(barra, 'position')).toBe('absolute');
    expect(efectivo(barra, 'bottom')).toBe('0');
  });
});
