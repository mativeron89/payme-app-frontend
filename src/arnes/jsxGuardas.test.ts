import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { implicaVerdadero, miembrosDeTipo, parsear, propsDeclarados } from './jsxGuardas';

/**
 * 🔴 LA BARRERA REAL — y existe porque la que yo había escrito era falsa.
 *
 * En `tsconfig.json` afirmé que excluir `src/arnes/**` convertía un import
 * desde producción en un error de compilación. **Lo medí y es falso:**
 * `exclude` filtra el descubrimiento por `include`, no lo que entra arrastrado
 * por un `import`. Con la sonda puesta en `src/utils/format.ts`, typecheck salió
 * 0 y el build compiló **con el compilador de TypeScript adentro** — el único
 * síntoma fue que tardó 12 s en vez de 1 s.
 *
 * Así que la barrera es ésta, derivada del árbol y no de una lista escrita a
 * mano: **ningún archivo de producción importa del arnés.**
 */
const PRODUCCION = import.meta.glob(
  ['/src/**/*.ts', '/src/**/*.tsx', '!/src/**/*.test.ts', '!/src/**/*.test.tsx', '!/src/arnes/**'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

describe('🔴 el arnés NO puede viajar en el bundle', () => {
  it('ningún archivo de producción importa de `src/arnes/`', () => {
    // Control positivo: si el glob viniera vacío, esto pasaría sin mirar nada.
    expect(Object.keys(PRODUCCION).length, 'el barrido no vio el árbol de producción')
      .toBeGreaterThan(50);
    const culpables = Object.entries(PRODUCCION)
      .filter(([, texto]) => /from\s+['"][^'"]*\/arnes\//.test(texto))
      .map(([ruta]) => ruta);
    expect(
      culpables,
      `importan el arnés desde producción — el compilador de TypeScript entero entraría al ` +
        `bundle: ${culpables.join(' · ')}`,
    ).toEqual([]);
  });
});

/**
 * 🔴 EL ARNÉS SE PRUEBA A SÍ MISMO, y no es ceremonia.
 *
 * Los tres bloqueos de este gate salieron de oráculos que **nadie había
 * sondeado**: se escribieron, salieron verdes y se firmaron. Un evaluador de
 * implicaciones que devolviera `true` siempre dejaría verde todo el censo que
 * lo usa, y el censo se vería igual de riguroso.
 *
 * Cada caso de acá es o un mutante que Codex plantó, o la contracara que
 * demuestra que el evaluador no aprueba cualquier cosa.
 */
function expr(codigo: string): { nodo: ts.Node; sf: ts.SourceFile } {
  const sf = ts.createSourceFile('e.ts', `const _ = ${codigo};`, ts.ScriptTarget.ESNext, true);
  const decl = (sf.statements[0] as ts.VariableStatement).declarationList.declarations[0]!;
  return { nodo: decl.initializer!, sf };
}
const prueba = (codigo: string, dado: Record<string, boolean> = { g: true }) => {
  const { nodo, sf } = expr(codigo);
  return implicaVerdadero(nodo, sf, dado);
};

describe('🔴 la implicación se DEMUESTRA, no se reconoce por su forma', () => {
  it('la guarda sola: probada', () => {
    expect(prueba('g').probada).toBe(true);
  });

  it('la guarda con un OR: probada — el otro término no puede debilitarla', () => {
    expect(prueba('g || !cardRailAvailable').probada).toBe(true);
    expect(prueba('!cardRailAvailable || g').probada).toBe(true);
  });

  it('🔴 MUTANTE DE CODEX · `!g` NO se prueba: deja el control habilitado', () => {
    const r = prueba('!g');
    expect(r.probada).toBe(false);
    expect(r.motivo).toMatch(/FALSA/);
  });

  it('🔴 MUTANTE DE CODEX · `g && false` NO se prueba: conjunción muerta', () => {
    expect(prueba('g && false').probada).toBe(false);
  });

  it('🔴 el literal `false` no se prueba', () => {
    expect(prueba('false').probada).toBe(false);
  });

  it('🔴 una guarda AJENA no se prueba: se parece pero no cierra la ventana', () => {
    // El caso más engañoso: hay un `disabled`, es una variable de verdad, y
    // sigue sin garantizar nada sobre `g`.
    const r = prueba('otraCosa');
    expect(r.probada).toBe(false);
    expect(r.motivo).toMatch(/otraCosa=false/);
  });

  it('🔴 `g && otra` NO se prueba: el AND puede caerse por el otro lado', () => {
    expect(prueba('g && cardRailAvailable').probada).toBe(false);
  });

  it('🔴 FAIL-CLOSED sobre lo NO EVALUABLE: un ternario no se aprueba solo', () => {
    // No hay lista de formas malas. El ternario entra como hoja opaca y, al
    // poder valer `false`, la implicación no queda demostrada. Un mutante
    // futuro con una forma que nadie previó cae por el mismo camino.
    expect(prueba('frozen ? g : false').probada).toBe(false);
    expect(prueba('g ?? false').probada).toBe(false);
  });

  it('paréntesis y anidamiento no confunden al evaluador', () => {
    expect(prueba('(g) || (a && b)').probada).toBe(true);
    expect(prueba('!(!g)').probada).toBe(true);
    expect(prueba('!(g)').probada).toBe(false);
  });

  it('🔴 con demasiadas hojas contesta que NO PUDO, y no que está bien', () => {
    const muchas = Array.from({ length: 13 }, (_, i) => `x${i}`).join(' || ');
    const r = prueba(muchas);
    expect(r.probada).toBe(false);
    expect(r.motivo).toMatch(/demasiadas hojas/);
  });
});

describe('🔴 la población no se puede cerrar ⇒ se declara, no se supone', () => {
  const arbol = parsear({
    '/a.tsx': `
      interface Propias { onReady: () => void; disabled?: boolean }
      export function Propio({ onReady }: Propias) { return null; }
      interface Heredadas extends React.ButtonHTMLAttributes<HTMLButtonElement> { onReady: () => void }
      export function Heredado({ onReady }: Heredadas) { return null; }
      interface Locales extends Base { onReady: () => void }
      interface Base { disabled?: boolean }
      export function Local({ onReady }: Locales) { return null; }
      export function SinProps() { return null; }
      export const Anotado: React.FC<Propias> = ({ onReady }) => null;
    `,
  });

  it('un tipo local con `disabled` propio se resuelve', () => {
    expect(propsDeclarados('Propio', arbol)).toContain('disabled');
  });

  it('la herencia LOCAL se sigue: hereda `disabled` y se ve', () => {
    expect(propsDeclarados('Local', arbol)).toContain('disabled');
  });

  it('🔴 MUTANTE DE CODEX · la herencia CALIFICADA es IRRESOLUBLE, no «sin disabled»', () => {
    // Antes esta rama se salteaba en silencio y el componente quedaba con sus
    // miembros propios: un `<Heredado>` sin guarda pasaba censo Y typecheck.
    expect(propsDeclarados('Heredado', arbol)).toBeNull();
  });

  it('🔴 un parámetro SIN anotación es irresoluble, no «sin props»', () => {
    // `React.FC<Props>` pone el tipo en la variable, no en el parámetro.
    expect(propsDeclarados('Anotado', arbol)).toBeNull();
  });

  it('un componente sin parámetros sí es «sin props»: eso sí se sabe', () => {
    expect(propsDeclarados('SinProps', arbol)).toEqual([]);
  });

  it('un nombre que no existe se distingue de uno que no se pudo resolver', () => {
    expect(propsDeclarados('NoExiste', arbol)).toBeUndefined();
  });

  it('🔴 una intersección con una parte irresoluble contamina el todo', () => {
    const sf = ts.createSourceFile('t.ts', 'type X = A & React.HTMLAttributes<H>;', ts.ScriptTarget.ESNext, true);
    const alias = sf.statements[0] as ts.TypeAliasDeclaration;
    expect(miembrosDeTipo(alias.type, sf, arbol)).toBeNull();
  });
});
