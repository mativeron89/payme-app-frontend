import { describe, expect, it } from 'vitest';

/**
 * D255 · los ajustes de Mati del 10/10 que son CSS. Se vigila el valor que
 * ejecuta (la última declaración de la regla, sin comentarios), no lo que se
 * cuenta. La geometría la mide `e2e/d255-ajustes.spec.ts`.
 */
const HOJAS = import.meta.glob(['/src/styles/global.css', '/src/screens/viajes/inicio.css', '/src/screens/viajes/viaje.css'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const sinComentarios = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** El cuerpo de la regla con ese selector exacto (empieza la línea), en esa hoja. */
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

const GLOBAL = '/src/styles/global.css';
const INICIO = '/src/screens/viajes/inicio.css';
const VIAJE = '/src/screens/viajes/viaje.css';

describe('🔴 D255 · los ajustes de CSS', () => {
  it('2 · Abiertos/Cerrados: en negrita; lo elegido sin borde propio, con el radio de la tarjeta y el anillo por dentro', () => {
    expect(efectivo(regla(INICIO, '.vj-lanzador .launch-label'), 'font-weight')).toBe('700');
    const par = regla(INICIO, '.vj-lanzadores');
    expect(efectivo(par, 'border-radius')).toBe('inherit');
    expect(efectivo(par, 'overflow')).toBe('hidden');
    expect(efectivo(regla(INICIO, '.vj-lanzador:first-child'), 'border-bottom-left-radius')).toBe('inherit');
    expect(efectivo(regla(INICIO, '.vj-lanzador:last-child'), 'border-bottom-right-radius')).toBe('inherit');
    const elegido = regla(INICIO, '.vj-lanzador--elegido');
    expect(efectivo(elegido, 'background')).toBe('var(--teal-l)');
    expect(efectivo(elegido, 'box-shadow')).toBe('inset 0 0 0 2px var(--action-2)');
    // Lo que rompía el recuadro y dejaba el espacio: un borde y un radio propios.
    expect(sinComentarios(HOJAS[INICIO]!)).not.toMatch(/\.vj-lanzador\s*\{[^}]*border\s*:/);
    expect(sinComentarios(HOJAS[INICIO]!)).not.toMatch(/\.vj-lanzador--elegido\s*\{[^}]*border-color/);
  });

  it('3 · Balance: con «Volver» y pestañas, la banda crece y la primera fila no se achica', () => {
    expect(efectivo(regla(GLOBAL, '.hdr-tabbed.hdr-con-volver'), 'height')).toBe('calc(214px + env(safe-area-inset-top))');
    expect(efectivo(regla(GLOBAL, '.hdr-tabbed.hdr-con-volver > .hdr-row:first-child'), 'min-height')).toBe('var(--tap-min)');
    expect(efectivo(regla(GLOBAL, '.btabs.btabs-2'), 'grid-template-columns')).toBe('repeat(2, minmax(0, 1fr))');
  });

  it('🔴 5 · en TODA pantalla con pestañas en la cabecera, el scroll no rebota (no pantalla por pantalla)', () => {
    expect(efectivo(regla(GLOBAL, '.hdr-tabbed ~ .scroll'), 'overscroll-behavior-y')).toBe('none');
  });

  it('7 · el viaje: monto sin el margen de arriba, pie al fondo con el aire del círculo y «Cerrar viaje» rojo clarito', () => {
    expect(efectivo(regla(VIAJE, '.vjv-scroll-abierto .vjv-monto'), 'margin')).toBe('0 0 var(--sp-1)');
    expect(efectivo(regla(VIAJE, '.vjv-pie-abierto'), 'margin-top')).toBe('auto');
    expect(efectivo(regla(VIAJE, '.has-appbar .scroll.vjv-scroll-abierto'), 'padding-bottom'))
      .toBe('calc(56px + var(--appbar-pie) + 26px + var(--sp-3))');
    const cerrar = regla(VIAJE, '.vjv-cerrar');
    expect(efectivo(cerrar, 'background')).toBe('var(--red-l)');
    expect(efectivo(cerrar, 'color')).toBe('var(--danger)');
  });
});
