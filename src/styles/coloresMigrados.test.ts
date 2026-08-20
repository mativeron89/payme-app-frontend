import { describe, expect, it } from 'vitest';

/**
 * ⭐ LOS COLORES VIEJOS NO VUELVEN · en NINGUNA grafía.
 *
 * ## El defecto que esta guarda existe para cazar, y ya ocurrió
 *
 * `c709880` (2026-08-15) migró `--action` y `--action-2` al navy y cian nuevos y
 * su CHANGELOG declaró **«cambia el color de TODA la app»**. Era falso, y estuvo
 * cuatro días en verde:
 *
 *     --navy: #0f1f3d     usado 40 veces     ← alias preexistente, sin migrar
 *     --teal: #00c2cb     usado 22 veces     ← idem
 *     rgba(15,31,61,…)    28 sombras         ← el MISMO navy, en decimal
 *
 * 🔴 **Ninguna guarda podía verlo.** El espejo de tokens compara sólo los que él
 * declara, y `--navy`/`--teal` no están en el sistema de diseño. Y el barrido
 * manual contó **hex**, así que `rgba(15,31,61,…)` —que es el mismo color
 * escrito en decimal— no apareció en el conteo. Lo destapó una guarda AJENA:
 * Diseño migró las sombras en la fuente y la vigencia del espejo se puso roja.
 *
 * ## Por qué mira VALORES y no nombres
 *
 * Un alias nuevo con el valor viejo se llamaría distinto y pintaría igual. Lo
 * que no puede volver es el COLOR, se llame como se llame — por eso se barren
 * las cuatro grafías en que ese color se puede escribir.
 *
 * ## Por qué se quitan los comentarios antes de barrer
 *
 * El CHANGELOG, los README y varios comentarios **citan** los hex viejos para
 * explicar por qué cambiaron. Eso es registro, no pintura: barrerlo obligaría a
 * borrar la historia para que un test pase. Se barre el código, no la prosa.
 */

const FUENTES = import.meta.glob(
  ['/src/**/*.{ts,tsx,css}', '/landing/**/*.{ts,css,html}', '/index.html'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

/** Este archivo NOMBRA los colores viejos para poder detectarlos. */
const YO = '/src/styles/coloresMigrados.test.ts';

function sinComentarios(texto: string): string {
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(^|[^:'"\\])\/\/[^\n]*/gm, '$1');
}

/** Las cuatro grafías en que cada color viejo se puede escribir. */
const PROHIBIDOS: ReadonlyArray<readonly [string, RegExp]> = [
  ['navy viejo · hex', /#0f1f3d\b/gi],
  ['navy viejo · rgb/rgba', /rgba?\(\s*15\s*,\s*31\s*,\s*61\b/gi],
  ['cian viejo · hex', /#00c2cb\b/gi],
  ['cian viejo · rgb/rgba', /rgba?\(\s*0\s*,\s*194\s*,\s*203\b/gi],
];

function barrer(fuentes: Record<string, string>): string[] {
  const hallazgos: string[] = [];
  for (const [ruta, crudo] of Object.entries(fuentes)) {
    if (ruta === YO) continue;
    const codigo = sinComentarios(crudo);
    for (const [nombre, patron] of PROHIBIDOS) {
      const n = (codigo.match(patron) ?? []).length;
      if (n) hallazgos.push(`${ruta}: ${nombre} ×${n}`);
    }
  }
  return hallazgos.sort();
}

describe('🔴 los colores migrados no vuelven, en ninguna grafía', () => {
  it('el barrido mira archivos de verdad · si no, todo lo de abajo pasa en vacío', () => {
    // Control positivo. Sin esto, un glob roto devolvería {} y la guarda
    // aprobaría en vacío — que es exactamente cómo el defecto sobrevivió antes.
    const rutas = Object.keys(FUENTES);
    expect(rutas.length, 'el glob no encontró fuentes').toBeGreaterThan(100);
    expect(rutas.some((r) => r.endsWith('/global.css')), 'falta el CSS de la app').toBe(true);
    expect(rutas.some((r) => r.endsWith('/landing.css')), 'falta el CSS de la landing').toBe(true);
    expect(rutas).toContain('/index.html');
  });

  it('🔴 ningún archivo vivo pinta el navy ni el cian viejos', () => {
    const hallazgos = barrer(FUENTES);
    expect(
      hallazgos,
      `volvió un color migrado:\n  ${hallazgos.join('\n  ')}\n\n` +
        'Los valores vigentes son #101e3b (navy) y #0fb5c9 (cian). Si necesitás el ' +
        'viejo para explicar la historia, va en un comentario: esta guarda barre ' +
        'código, no prosa.',
    ).toEqual([]);
  });

  it('🔴 MUTANTE · el barrido DETECTA las cuatro grafías, no sólo el hex', () => {
    // El defecto original se escapó porque el conteo miraba hex y el color
    // venía en decimal. Se le dan las cuatro formas y se exige que las vea.
    const muestra = {
      '/falso/a.css': '.x { color: #0F1F3D; }',
      '/falso/b.css': '.x { box-shadow: 0 1px 2px rgba(15, 31, 61, 0.06); }',
      '/falso/c.css': '.x { --teal-nuevo: #00c2cb; }',
      '/falso/d.css': '.x { background: rgba(0,194,203,0.08); }',
    };
    expect(barrer(muestra)).toHaveLength(4);
  });

  it('🔴 SONDA · un color viejo dentro de un COMENTARIO no dispara', () => {
    // Si esto fallara, la guarda obligaría a borrar el registro de por qué el
    // color cambió — y el arreglo sería falsificar la historia.
    expect(barrer({ '/falso/e.css': '/* antes era #0f1f3d, ver CHANGELOG 0.80.2 */' })).toEqual([]);
    expect(barrer({ '/falso/f.tsx': '// rgba(15,31,61,0.1) quedó viejo' })).toEqual([]);
    expect(barrer({ '/falso/g.html': '<!-- theme-color era #0F1F3D -->' })).toEqual([]);
  });

  it('🔴 y NO marca los colores vigentes: si lo hiciera, sería inservible', () => {
    const vigentes = {
      '/falso/h.css': '.x { color: #101e3b; background: #0fb5c9; box-shadow: 0 1px 2px rgba(16,30,59,0.06); }',
    };
    expect(barrer(vigentes)).toEqual([]);
  });
});
