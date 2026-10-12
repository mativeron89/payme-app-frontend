import { describe, expect, it } from 'vitest';

/**
 * 🔴 D299 · Mati: «Poner en negrita ver pagos y configuracion» (Inicio › Cuenta: «Ver pagos» y «Ver perfil»). Los dos
 * son `Launcher` (`.launch-label`), la misma tarjeta de botones de Estadísticas, Viajes y Amigos: la negrita va en la
 * clase, con el peso de las pestañas del encabezado (D283, `.btab`). Se vigila el valor que ejecuta (la última
 * declaración, sin comentarios); el peso computado en el navegador lo mide `e2e/lanzadores-en-negrita.spec.ts`.
 */
const HOJAS = import.meta.glob('/src/**/*.css', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const FUENTES = import.meta.glob('/src/**/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const sinComentarios = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Todas las reglas de todas las hojas: selector y cuerpo. */
function reglas(): Array<{ hoja: string; selector: string; cuerpo: string }> {
  return Object.entries(HOJAS).flatMap(([hoja, css]) =>
    [...sinComentarios(css).matchAll(/(^|\n)([^{}@\n][^{}]*?)\s*{([^{}]*)}/g)].map((m) => ({ hoja, selector: m[2]!.trim(), cuerpo: m[3]! })));
}

function efectivo(cuerpo: string, propiedad: string): string | null {
  const valores = [...cuerpo.matchAll(new RegExp(`(?:^|[;{\\s])${propiedad}:\\s*([^;]+);`, 'g'))].map((m) => m[1]!.trim());
  return valores.length > 0 ? valores[valores.length - 1]! : null;
}

const exacta = (selector: string) => {
  const r = reglas().filter((x) => x.hoja === '/src/styles/global.css' && x.selector === selector);
  expect(r, selector).toHaveLength(1);
  return r[0]!.cuerpo;
};

describe('🔴 D299 · «Ver pagos», «Ver perfil» y toda la tarjeta de botones, en negrita', () => {
  it('la clase `.launch-label` lleva el peso de las pestañas del encabezado (D283)', () => {
    const peso = efectivo(exacta('.launch-label'), 'font-weight');
    expect(peso).toBe('700');
    expect(efectivo(exacta('.btab'), 'font-weight')).toBe(peso);
    expect(efectivo(exacta('.btab.on'), 'font-weight')).toBe(peso);
  });

  it('🔴 ninguna otra regla le baja el peso a un `.launch-label` (Viajes sigue en 700)', () => {
    const conLaClase = reglas().filter((r) => /\.launch-label\b/.test(r.selector) && efectivo(r.cuerpo, 'font-weight') !== null);
    expect(conLaClase.map((r) => `${r.selector} → ${efectivo(r.cuerpo, 'font-weight')}`).sort())
      .toEqual(['.launch-label → 700', '.vj-lanzador .launch-label → 700']);
  });

  it('lo demás de la clase no cambia: la familia, el tamaño, el alto de línea y el color', () => {
    const c = exacta('.launch-label');
    expect([efectivo(c, 'font-family'), efectivo(c, 'font-size'), efectivo(c, 'line-height'), efectivo(c, 'color')])
      .toEqual(['var(--font-display)', 'var(--fs-sm)', 'var(--lh-sm)', 'var(--text)']);
    expect(efectivo(exacta('.launch'), 'min-height')).toBe('84px');
  });

  it('la clase, desde el código: quién pinta un `.launch-label`', () => {
    const conLaClase = Object.entries(FUENTES)
      .filter(([ruta, src]) => !/\.test\.tsx$/.test(ruta) && src.includes('className="launch-label"'))
      .map(([ruta]) => ruta).sort();
    // `Launcher` (Inicio › Cuenta, Inicio › Estadísticas y Amigos) y el lanzador de Inicio › Viajes.
    expect(conLaClase).toEqual(['/src/components/AppHeader.tsx', '/src/screens/viajes/PestanaViajes.tsx']);
    const usanLauncher = Object.entries(FUENTES)
      .filter(([ruta, src]) => !/\.test\.tsx$/.test(ruta) && /<Launcher\b/.test(src))
      .map(([ruta]) => ruta).sort();
    expect(usanLauncher).toEqual(['/src/screens/HomeScreen.tsx', '/src/screens/SocialScreen.tsx']);
  });
});
