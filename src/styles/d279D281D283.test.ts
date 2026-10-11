import { describe, expect, it } from 'vitest';

/**
 * 0.240.0 · lo que es CSS de D279 (la hora de cierre), D281 (las visitas de un lugar) y D283 (la negrita de las
 * pestañas del encabezado). Se vigila el valor que ejecuta (la última declaración de la regla, sin comentarios).
 */
const HOJAS = import.meta.glob('/src/**/*.css', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const FUENTES = import.meta.glob(['/src/**/*.tsx', '!/src/**/*.test.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const sinComentarios = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

function regla(hoja: string, selector: string): string {
  const css = sinComentarios(HOJAS[hoja]!);
  const m = css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.\\~+>()-]/g, '\\$&')}\\s*{([^}]*)}`));
  if (!m) throw new Error(`${hoja} perdió la regla ${selector}`);
  return m[1]!;
}

function efectivo(cuerpo: string, propiedad: string): string | null {
  const valores = [...cuerpo.matchAll(new RegExp(`(?:^|[;{\\s])${propiedad}:\\s*([^;]+);`, 'g'))].map((m) => m[1]!.trim());
  return valores.length > 0 ? valores[valores.length - 1]! : null;
}

/** Todas las reglas de todas las hojas: [hoja, selector, cuerpo]. */
function reglas(): Array<[string, string, string]> {
  return Object.entries(HOJAS).flatMap(([hoja, css]) =>
    [...sinComentarios(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m): [string, string, string] => [hoja, m[1]!.trim(), m[2]!]));
}

const GLOBAL = '/src/styles/global.css';

describe('🔴 D283 · las pestañas del encabezado, en negrita en toda la clase', () => {
  it('`.btab` y la elegida (`.btab.on`) van en 700', () => {
    expect(efectivo(regla(GLOBAL, '.btab'), 'font-weight')).toBe('700');
    expect(efectivo(regla(GLOBAL, '.btab.on'), 'font-weight')).toBe('700');
  });

  it('ninguna regla de ninguna hoja le baja el peso a una pestaña (ni por pantalla ni por estado)', () => {
    const conPeso = reglas().filter(([, sel, cuerpo]) => /\.btab(?![-\w])/.test(sel) && efectivo(cuerpo, 'font-weight') !== null);
    expect(conPeso.length).toBeGreaterThanOrEqual(2);
    for (const [hoja, sel, cuerpo] of conPeso) expect(efectivo(cuerpo, 'font-weight'), `${hoja} ${sel}`).toBe('700');
  });

  it('la negrita no se pide pantalla por pantalla: sin `btabs--negrita` ni la prop `negrita`', () => {
    for (const [hoja, css] of Object.entries(HOJAS)) expect(sinComentarios(css), hoja).not.toContain('btabs--negrita');
    for (const [archivo, fuente] of Object.entries(FUENTES)) {
      expect(fuente, archivo).not.toMatch(/<BubbleTabs[^>]*\bnegrita\b/);
      expect(fuente, archivo).not.toContain('btabs--negrita');
    }
  });

  it('censo: las pestañas del encabezado son `BubbleTabs`, en Inicio, Amigos y Balance (las tres que mide el e2e)', () => {
    const usan = Object.entries(FUENTES).filter(([archivo, f]) => /<BubbleTabs\b/.test(f) && !archivo.endsWith('AppHeader.tsx'))
      .map(([archivo]) => archivo).sort();
    expect(usan).toEqual(['/src/screens/HomeScreen.tsx', '/src/screens/SocialScreen.tsx', '/src/screens/viajes/BalanceScreen.tsx']);
  });
});

describe('🔴 D279 · D281 · la hora de cierre y las visitas de un lugar', () => {
  it('«Hora de cierre» va en la celda de «Al»', () => {
    expect(efectivo(regla('/src/screens/viajes/crear.css', '.vjc-fecha.vjc-hora'), 'grid-column')).toBe('2');
  });

  it('las visitas de un lugar empiezan donde empieza el nombre: el ancho del ícono más su separación', () => {
    const icono = efectivo(regla('/src/screens/viajes/viaje.css', '.vjv-ticket-icono'), 'width');
    const separacion = efectivo(regla('/src/screens/viajes/viaje.css', '.vjb-consumo'), 'gap');
    expect(icono).toMatch(/^\d+px$/);
    expect(efectivo(regla('/src/screens/viajes/viaje.css', '.vjb-visitas'), 'padding')).toBe(`0 0 0 calc(${icono} + ${separacion})`);
  });

  it('la visita es un blanco táctil de al menos 44 px', () => {
    expect(Number.parseInt(efectivo(regla('/src/screens/viajes/viaje.css', '.vjb-visita'), 'min-height')!, 10)).toBeGreaterThanOrEqual(44);
  });
});
