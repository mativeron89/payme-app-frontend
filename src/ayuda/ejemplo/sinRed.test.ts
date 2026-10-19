import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * D363 · D367 · guardarraíl de fuente del ejemplo: 100 % local, sin red ni
 * almacenamiento (plan técnico §4.2).
 *
 * Dos reglas, las dos leídas del árbol de sintaxis (un comentario que nombra
 * `localStorage` no cuenta; un `globalThis['fetch']` sí):
 *
 * 1. Ningún archivo de `src/ayuda/ejemplo/` nombra una vía de red o de
 *    almacenamiento.
 * 2. Siguiendo los imports **de valor** (los `import type` se borran al
 *    compilar), desde el ejemplo no se llega a `api/http.ts` (la red),
 *    `api/index.ts` (la fachada, que la usa) ni a nada de `api/mock/` (que
 *    persiste y no viaja en el build real).
 */

const AQUI = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(AQUI, '../..');
const PROHIBIDOS = new Set([
  'fetch', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource',
  'localStorage', 'sessionStorage', 'indexedDB',
]);

function nombresProhibidos(texto: string, archivo = 'fuente.ts'): string[] {
  const fuente = ts.createSourceFile(archivo, texto, ts.ScriptTarget.Latest, true);
  const hallados: string[] = [];
  const visitar = (nodo: ts.Node) => {
    if ((ts.isIdentifier(nodo) || ts.isPrivateIdentifier(nodo)) && PROHIBIDOS.has(nodo.text)) hallados.push(nodo.text);
    if (ts.isStringLiteralLike(nodo) && PROHIBIDOS.has(nodo.text)) hallados.push(nodo.text);
    ts.forEachChild(nodo, visitar);
  };
  visitar(fuente);
  return hallados;
}

/** Los módulos que un archivo importa como valor (también `export … from`). */
function importsDeValor(archivo: string): string[] {
  const fuente = ts.createSourceFile(archivo, readFileSync(archivo, 'utf8'), ts.ScriptTarget.Latest, true);
  const especificadores: string[] = [];
  for (const sentencia of fuente.statements) {
    if (ts.isImportDeclaration(sentencia)) {
      if (sentencia.importClause?.isTypeOnly) continue;
      especificadores.push((sentencia.moduleSpecifier as ts.StringLiteral).text);
    } else if (ts.isExportDeclaration(sentencia) && sentencia.moduleSpecifier && !sentencia.isTypeOnly) {
      especificadores.push((sentencia.moduleSpecifier as ts.StringLiteral).text);
    }
  }
  const dinamicos: string[] = [];
  const visitar = (nodo: ts.Node) => {
    if (ts.isCallExpression(nodo) && nodo.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = nodo.arguments[0];
      dinamicos.push(arg && ts.isStringLiteralLike(arg) ? arg.text : '<import() no literal>');
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(fuente);
  return [...especificadores, ...dinamicos];
}

function resolverRelativo(desde: string, especificador: string): string | null {
  if (!especificador.startsWith('.')) return null;
  const base = resolve(dirname(desde), especificador);
  for (const candidato of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx'), base]) {
    if (existsSync(candidato) && candidato.match(/\.tsx?$/)) return candidato;
  }
  throw new Error(`no se pudo resolver ${especificador} desde ${relative(SRC, desde)}`);
}

/** Todo lo que se carga, como valor, desde estos archivos. */
function clausura(desde: readonly string[]): Set<string> {
  const vistos = new Set<string>();
  const pendientes = [...desde];
  while (pendientes.length > 0) {
    const archivo = pendientes.pop()!;
    if (vistos.has(archivo)) continue;
    vistos.add(archivo);
    for (const especificador of importsDeValor(archivo)) {
      if (especificador === '<import() no literal>') throw new Error(`import() no literal en ${relative(SRC, archivo)}`);
      const destino = resolverRelativo(archivo, especificador);
      if (destino) pendientes.push(destino);
    }
  }
  return vistos;
}

function prohibidoAlcanzar(archivo: string): boolean {
  const r = relative(SRC, archivo).split('\\').join('/');
  return r === 'api/http.ts' || r === 'api/index.ts' || r.startsWith('api/mock/');
}

const DEL_EJEMPLO = readdirSync(AQUI)
  .filter((nombre) => /\.tsx?$/.test(nombre) && !/\.test\.tsx?$/.test(nombre))
  .map((nombre) => join(AQUI, nombre));

describe('D363 · el ejemplo no sale a la red ni guarda nada', () => {
  it('hay archivos del ejemplo que revisar (si no, la guarda pasaría vacía)', () => {
    expect(DEL_EJEMPLO.map((a) => relative(AQUI, a)).sort()).toEqual(
      ['apiEjemplo.ts', 'estadoEjemplo.ts', 'fixtureEjemplo.ts', 'mesaDeEjemplo.ts', 'rutaDelEjemplo.ts'],
    );
  });

  it('ningún archivo del ejemplo nombra una vía de red o de almacenamiento', () => {
    for (const archivo of DEL_EJEMPLO) {
      expect(nombresProhibidos(readFileSync(archivo, 'utf8'), archivo), relative(SRC, archivo)).toEqual([]);
    }
  });

  it('control: la regla ve el código y no los comentarios', () => {
    expect(nombresProhibidos('// localStorage y fetch en un comentario\nconst x = 1;')).toEqual([]);
    expect(nombresProhibidos('void fetch("/api");')).toEqual(['fetch']);
    expect(nombresProhibidos('window.localStorage.getItem("k");')).toEqual(['localStorage']);
    expect(nombresProhibidos('(globalThis as any)["sessionStorage"];')).toEqual(['sessionStorage']);
    expect(nombresProhibidos('navigator.sendBeacon("/x");')).toEqual(['sendBeacon']);
  });

  it('desde el ejemplo no se llega, por imports de valor, a la red, la fachada ni el mock', () => {
    const alcanzados = [...clausura(DEL_EJEMPLO)].filter(prohibidoAlcanzar).map((a) => relative(SRC, a));
    expect(alcanzados).toEqual([]);
  });

  it('control: desde la fachada sí se llega a la red y al mock (el recorrido encuentra lo que busca)', () => {
    const alcanzados = [...clausura([join(SRC, 'api/index.ts')])].map((a) => relative(SRC, a).split('\\').join('/'));
    expect(alcanzados).toContain('api/http.ts');
    expect(alcanzados.some((a) => a.startsWith('api/mock/'))).toBe(true);
  });
});
