/**
 * n79 · censo de TEXTOS VISIBLES QUE NO PASAN POR EL TRADUCTOR (AF-I18N-N79).
 *
 * Método, declarado para que el número sea verificable:
 *
 * - **Universo:** los `.tsx` de `src/`, sin tests ni `src/i18n/`.
 * - **Qué cuenta**, por AST (un string partido en varias líneas no se pierde):
 *   1. `JsxText` con al menos una letra;
 *   2. literales o plantillas en atributos JSX que el usuario LEE
 *      (`ATRIBUTOS_VISIBLES`);
 *   3. literales o plantillas con una letra dentro de `{…}` en JSX, en
 *      cualquier profundidad de la expresión (`cond ? 'a' : 'b'`).
 * - **Qué NO cuenta:**
 *   - lo que ya es argumento de `t(…)`;
 *   - lo que se compara (`===`), se usa como índice o `case`;
 *   - lo que va en `className`, `style`, `key` y otros atributos que nadie lee;
 *   - las palabras-token sin letras (símbolos, números).
 *
 * Cada hallazgo sale con `archivo:línea` y el texto normalizado (espacios
 * colapsados, como los muestra el navegador).
 */
import ts from 'typescript';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(RAIZ, 'src');

export const ATRIBUTOS_VISIBLES = new Set([
  'placeholder', 'alt', 'title', 'aria-label', 'aria-description', 'aria-placeholder',
  'aria-valuetext', 'aria-roledescription', 'label', 'texto', 'etiqueta', 'mensaje',
  'titulo', 'title', 'subtitle', 'subtitulo', 'detail', 'detalle', 'hint', 'ayuda',
]);

const ATRIBUTOS_NUNCA = new Set([
  'className', 'class', 'id', 'key', 'href', 'src', 'type', 'name', 'role', 'style',
  'aria-labelledby', 'aria-describedby', 'aria-controls', 'htmlFor', 'data-testid',
  'viewBox', 'd', 'fill', 'stroke', 'xmlns', 'transform', 'autoComplete', 'inputMode',
  'pattern', 'accept', 'capture', 'lang', 'dir', 'target', 'rel', 'method', 'action',
  'variant', 'size', 'icon', 'name', 'tone', 'kind', 'mode', 'loading', 'decoding',
]);

const LETRA = /[A-Za-zÁÉÍÓÚÑáéíóúñü]/;
const normalizar = (s) => s.replace(/\s+/g, ' ').trim();

function archivosTsx(dir) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) {
      if (n === 'i18n') continue;
      out.push(...archivosTsx(p));
    } else if (n.endsWith('.tsx') && !/\.test\.tsx$/.test(n)) out.push(p);
  }
  return out.sort();
}

/** ¿Está dentro de un argumento de `t(…)`? */
function dentroDeT(n) {
  for (let q = n.parent; q; q = q.parent) {
    if (ts.isCallExpression(q) && ts.isIdentifier(q.expression) && q.expression.text === 't') return true;
    if (ts.isJsxElement(q) || ts.isJsxSelfClosingElement(q) || ts.isJsxFragment(q)) return false;
  }
  return false;
}

/** ¿El código lo usa como dato y no como texto? */
function usoNoEsTexto(n) {
  const p = n.parent;
  if (!p) return false;
  if (ts.isElementAccessExpression(p) && p.argumentExpression === n) return true;
  if (ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
    ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(p.operatorToken.kind)) return true;
  if (ts.isCaseClause(p)) return true;
  // Argumento de una llamada que no es `t` (navigate('home'), cls('x')…): token.
  if (ts.isCallExpression(p) && p.arguments.includes(n)) return true;
  return false;
}

/** El atributo JSX que contiene al nodo, si lo hay (sin cruzar otro elemento). */
function atributoContenedor(n) {
  for (let q = n.parent; q; q = q.parent) {
    if (ts.isJsxAttribute(q)) return q.name.getText();
    if (ts.isJsxElement(q) || ts.isJsxSelfClosingElement(q) || ts.isJsxFragment(q)) return null;
  }
  return null;
}

/** ¿Está en una expresión `{…}` de JSX (hijo o atributo)? */
function enExpresionJsx(n) {
  for (let q = n.parent; q; q = q.parent) {
    if (ts.isJsxExpression(q)) return true;
    if (ts.isJsxElement(q) || ts.isJsxSelfClosingElement(q) || ts.isJsxFragment(q)) return false;
    if (ts.isFunctionLike(q) && !ts.isArrowFunction(q)) return false;
  }
  return false;
}

/** Censa UN archivo. Separado para que la sonda del test pueda darle código sintético. */
export function censarFuente(rel, codigo) {
  const hallazgos = [];
  {
    const sf = ts.createSourceFile(rel, codigo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const agregar = (n, texto, via) => {
      const linea = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
      hallazgos.push({ archivo: rel, linea, texto: normalizar(texto), via });
    };
    const visitar = (n) => {
      if (ts.isJsxText(n)) {
        const t = normalizar(n.getText(sf));
        if (t && LETRA.test(t)) agregar(n, t, 'jsx-texto');
      } else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n)) {
        // De una plantilla cuentan sólo sus partes FIJAS: lo que va en `${…}`
        // es código (o ya es `t(…)`) y se mira por su cuenta.
        const texto = ts.isTemplateExpression(n)
          ? [n.head.text, ...n.templateSpans.map((s) => s.literal.text)].join(' ')
          : n.text;
        const attr = atributoContenedor(n);
        const esAtributoLiteral = ts.isJsxAttribute(n.parent);
        if (LETRA.test(texto) && !dentroDeT(n) && !usoNoEsTexto(n)) {
          if (attr !== null) {
            if (ATRIBUTOS_VISIBLES.has(attr) && !ATRIBUTOS_NUNCA.has(attr)) {
              agregar(n, texto, esAtributoLiteral ? `atributo:${attr}` : `atributo-expr:${attr}`);
            }
          } else if (enExpresionJsx(n)) {
            agregar(n, texto, 'jsx-expresion');
          }
        }
      }
      ts.forEachChild(n, visitar);
    };
    visitar(sf);
  }
  return hallazgos;
}

export function censar() {
  return archivosTsx(SRC).flatMap((f) => censarFuente(relative(RAIZ, f).split('\\').join('/'), readFileSync(f, 'utf8')));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const h = censar();
  console.log(JSON.stringify({ total: h.length, hallazgos: h }, null, 1));
}
