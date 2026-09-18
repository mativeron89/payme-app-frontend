import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * AF-20 · C-03 · guarda de CLASE sobre las interpolaciones de path de la
 * fachada (`docs/COSTURAS_CONOCIDAS.md`).
 *
 * La instancia que motivó la costura —`getFriendRequests(direction)` sin
 * `encodeURIComponent`— ya no existe: `87c03ca` la partió en dos métodos con
 * URL literal. La costura pedía cerrar la CLASE, no parchar la instancia: cada
 * `${…}` dentro de un template que arma un path o un query string (empieza con
 * `/` o con `?`) tiene que
 * escapar con `encodeURIComponent`, o estar en la lista de abajo con su
 * motivo. Quien copie una línea para un parámetro nuevo sin escapar se entera
 * acá.
 */

const DIR = new URL('.', import.meta.url).pathname;

/** Archivos de la fachada: `src/api/*.ts`, sin tests ni el riel mock. */
function archivosDeLaFachada(): string[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.d.ts'))
    .map((f) => join(DIR, f));
}

interface Interpolacion { readonly archivo: string; readonly linea: number; readonly expr: string }

/**
 * Recorre el fuente y devuelve cada `${expr}` de nivel superior de los
 * template literals cuyo texto empieza con `/` o con `?` (path o query string:
 * los dos van a la URL; la primera versión miraba sólo `/` y un mutante que
 * dejaba de codificar `?payload_hash=` lo cazaba sólo otro test). Salta comentarios y strings
 * comunes; dentro de una expresión cuenta llaves y respeta templates anidados.
 */
export function interpolacionesDeRuta(src: string, archivo = '<fuente>'): Interpolacion[] {
  const salida: Interpolacion[] = [];
  let i = 0;
  const lineaDe = (pos: number) => src.slice(0, pos).split('\n').length;
  const saltarString = (q: string) => { i += 1; while (i < src.length && src[i] !== q) { if (src[i] === '\\') i += 1; i += 1; } i += 1; };
  // Lee un template desde el backtick en `i`; si `registrar`, anota sus `${}`.
  const leerTemplate = (registrar: boolean) => {
    const esRuta = src[i + 1] === '/' || src[i + 1] === '?';
    i += 1;
    while (i < src.length && src[i] !== '`') {
      if (src[i] === '\\') { i += 2; continue; }
      if (src[i] === '$' && src[i + 1] === '{') {
        const inicio = i + 2;
        i += 2;
        let prof = 1;
        while (i < src.length && prof > 0) {
          const c = src[i];
          if (c === '`') { leerTemplate(false); continue; }
          if (c === "'" || c === '"') { saltarString(c); continue; }
          if (c === '{') prof += 1;
          if (c === '}') prof -= 1;
          if (prof > 0) i += 1;
        }
        if (registrar && esRuta) salida.push({ archivo, linea: lineaDe(inicio), expr: src.slice(inicio, i).trim() });
        i += 1;
        continue;
      }
      i += 1;
    }
    i += 1;
  };
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i += 1; continue; }
    if (c === '/' && src[i + 1] === '*') { const fin = src.indexOf('*/', i + 2); i = fin < 0 ? src.length : fin + 2; continue; }
    if (c === "'" || c === '"') { saltarString(c); continue; }
    if (c === '`') { leerTemplate(true); continue; }
    i += 1;
  }
  return salida;
}

/**
 * Interpolaciones que NO pasan por `encodeURIComponent` y están bien, cada una
 * con su motivo. Se comparan por archivo + expresión EXACTA: una variante
 * nueva no hereda la excepción.
 */
const YA_CODIFICADAS: ReadonlyArray<{ archivo: string; expr: string; motivo: string }> = [
  {
    archivo: 'index.ts',
    expr: "s ? `?${s}` : ''",
    motivo: '`s` es `URLSearchParams#toString()`, que ya codifica (getHistory).',
  },
  {
    archivo: 'index.ts',
    expr: 'query',
    motivo: '`query` se arma con `encodeURIComponent(payloadHash)` en la línea anterior (getMesaCreation).',
  },
  {
    archivo: 'recoveryFlow.ts',
    expr: 'query',
    motivo: 'no es un request: es la URL del navegador al retirar el token de recuperación, y `query` es `URLSearchParams#toString()`, que ya codifica. Apareció al ampliar la guarda a los query strings.',
  },
];

describe('C-03 · toda interpolación de path de la fachada escapa', () => {
  const todas = archivosDeLaFachada().flatMap((f) => interpolacionesDeRuta(readFileSync(f, 'utf8'), f.slice(DIR.length)));

  it('la sonda distingue: marca un `${id}` crudo y acepta uno escapado', () => {
    const crudo = interpolacionesDeRuta('get(`/friends/${id}/block`); // `/x/${no}`');
    expect(crudo.map((x) => x.expr)).toEqual(['id']);
    const anidado = interpolacionesDeRuta("h(`/a${s ? `?${s}` : ''}`); f('`/b/${x}`');");
    expect(anidado.map((x) => x.expr)).toEqual(["s ? `?${s}` : ''"]);
    const query = interpolacionesDeRuta('const q = `?payload_hash=${hash}`;');
    expect(query.map((x) => x.expr)).toEqual(['hash']);
  });

  it('el censo encontró la población real (si no, lo de abajo pasaría en vacío)', () => {
    expect(todas.length).toBeGreaterThanOrEqual(30);
  });

  it('🔴 ninguna interpolación de path queda sin escapar', () => {
    const crudas = todas.filter((x) => !x.expr.startsWith('encodeURIComponent(')
      && !YA_CODIFICADAS.some((y) => y.archivo === x.archivo && y.expr === x.expr));
    expect(crudas.map((x) => `${x.archivo}:${x.linea} → \${${x.expr}}`)).toEqual([]);
  });

  it('las excepciones siguen existiendo tal cual (una excepción huérfana es una puerta abierta)', () => {
    for (const y of YA_CODIFICADAS) {
      expect(todas.some((x) => x.archivo === y.archivo && x.expr === y.expr), `${y.archivo} · ${y.expr}`).toBe(true);
    }
    const index = readFileSync(join(DIR, 'index.ts'), 'utf8');
    expect(index).toContain('const query = payloadHash ? `?payload_hash=${encodeURIComponent(payloadHash)}` : \'\';');
    expect(index).toContain('const s = qs.toString();');
    const recovery = readFileSync(join(DIR, 'recoveryFlow.ts'), 'utf8');
    expect(recovery).toContain('const query = params.toString();');
  });
});
