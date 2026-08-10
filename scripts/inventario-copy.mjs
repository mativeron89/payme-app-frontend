/**
 * Inventario de strings de UI por AST, no por grep.
 *
 * 🔴 EL MOTIVO DEL AST: un string que el formateador partió en tres líneas es
 * invisible para un grep de una línea. Un parser no lo puede perder: para el
 * AST el salto de línea no existe. Dashboard Frontend lo comprobó en carne
 * propia con su `PATCH` partido.
 *
 * Clasifica en tres bloques con confianza distinta, porque mezclarlos sería
 * darle a Diseño una lista donde no puede saber qué traducir:
 *
 *   A · JSX visible      texto entre tags + atributos que el usuario LEE
 *   B · copy en .ts      strings con forma de frase en vistas/view-models
 *   C · datos del mock   se ven en pantalla, pero son DATOS, no copy
 */
import ts from 'typescript';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(RAIZ, 'src');

/** Atributos cuyo valor el usuario LEE. `title` incluido: se muestra al hover. */
const ATRIBUTOS_VISIBLES = new Set([
  'placeholder', 'alt', 'title', 'aria-label', 'aria-description', 'aria-placeholder',
  'aria-valuetext', 'aria-roledescription', 'label', 'texto', 'etiqueta', 'mensaje',
]);

/** Atributos que NUNCA son copy, aunque su valor parezca una frase. */
const ATRIBUTOS_NUNCA = new Set([
  'className', 'class', 'id', 'key', 'href', 'src', 'type', 'name', 'role',
  'style', 'aria-labelledby', 'aria-describedby', 'aria-controls', 'htmlFor',
  'data-testid', 'viewBox', 'd', 'fill', 'stroke', 'xmlns', 'transform',
]);

function archivos(dir) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...archivos(p));
    else if (/\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n)) out.push(p);
  }
  return out;
}

/** ¿Tiene forma de frase que una persona lee, y no de clave/identificador? */
function pareceFrase(s) {
  const t = s.trim();
  if (t.length < 3) return false;
  if (!/[a-záéíóúñü]/i.test(t)) return false;               // sin letras, no es copy
  if (/^[a-z][a-zA-Z0-9]*$/.test(t)) return false;          // camelCase suelto
  if (/^[a-z0-9]+([._-][a-z0-9]+)+$/i.test(t)) return false; // key.con.puntos, kebab-case
  if (/^[A-Z][A-Z0-9_]+$/.test(t)) return false;            // CONSTANTE
  if (/^[#./]/.test(t)) return false;                        // rutas, hashes, selectores
  if (/^https?:/.test(t)) return false;
  if (/^\d+(\.\d+)*$/.test(t)) return false;
  // La marca de una frase: espacio, o acento/ñ/signo de apertura…
  if (/\s/.test(t) || /[áéíóúñ¿¡]/i.test(t)) return true;
  // …o UNA PALABRA CAPITALIZADA. `Cancelar`, `Volver`, `Principal` son copy;
  // los valores de enum de este repo son minúscula (`card`, `open`, `pending`).
  return /^[A-ZÁÉÍÓÚÑ][a-záéíóúñü]{2,}$/.test(t);
}


/** Comandos de path SVG: `M3 10.5 12 3l9 7.5` tiene letras y espacios y NO es copy. */
function esPathSvg(s) {
  const t = s.trim();
  if (t.length < 6) return false;
  return /^[MmZzLlHhVvCcSsQqTtAa][\s\d.,-]/.test(t) && /[\d]/.test(t)
    && (t.match(/[A-Za-z]/g) || []).length / t.length < 0.35;
}

/** Propiedades cuyo valor NUNCA es copy, aunque parezca frase. */
const PROP_NO_COPY = new Set([
  'className', 'clase', 'cls', 'id', 'key', 'testId', 'icon', 'icono', 'path', 'd',
  'href', 'src', 'ruta', 'route', 'page', 'tipo', 'type', 'variant', 'estado', 'status',
  // Estilo: `background: 'var(--gray-l, #eceff3)'` tiene coma y espacio y no es copy.
  'background', 'backgroundColor', 'color', 'border', 'borderColor', 'boxShadow',
  'font', 'fontFamily', 'gridTemplateColumns', 'transition', 'transform', 'filter',
]);

/** Valores CSS: `var(--x, #fff)`, `1px solid #ddd`, `12px 8px`. */
function esValorCss(s) {
  const t = s.trim();
  return /^var\(/.test(t)
    || /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\()/i.test(t)
    || /^[\d.]+(px|rem|em|%|vh|vw|fr|s|ms)\b/.test(t)
    || /\b(solid|dashed|ease|linear|inset)\b/.test(t);
}

/** Llamadas cuyo string mira un DESARROLLADOR, no un usuario. */
const LLAMADA_DEV = new Set([
  'Error', 'TypeError', 'RangeError', 'invariant', 'assert',
  'console.log', 'console.warn', 'console.error', 'console.info', 'console.debug',
]);

/** De quién es este string: propiedad que lo contiene, variable, y llamada. */
function contexto(n, sf) {
  let prop = null, variable = null, llamada = null, funcion = null, q = n.parent;
  for (let i = 0; q && i < 10; i += 1, q = q.parent) {
    if (!prop && ts.isPropertyAssignment(q)) prop = q.name.getText(sf).replace(/['\"]/g, '');
    if (!variable && ts.isVariableDeclaration(q)) variable = q.name.getText(sf);
    if (!llamada && (ts.isCallExpression(q) || ts.isNewExpression(q))) {
      llamada = q.expression.getText(sf);
    }
    if (!funcion && (ts.isFunctionDeclaration(q) || ts.isMethodDeclaration(q)) && q.name) {
      funcion = q.name.getText(sf);
    }
  }
  return { prop, variable, llamada, funcion };
}

const A = [], B = [], C = [], D = [];

// El `<title>` vive fuera de `src/` y es lo primero que una persona lee: el
// nombre de la pestaña. Ninguna lente de código lo mira.
{
  const html = readFileSync(join(RAIZ, 'index.html'), 'utf8');
  const m = html.match(/<title>([^<]+)<\/title>/);
  if (m) A.push({ archivo: 'index.html', linea: html.slice(0, m.index).split('\n').length, texto: m[1].trim(), via: '<title>' });
  for (const mm of html.matchAll(/<meta[^>]+name="(description|apple-mobile-web-app-title)"[^>]+content="([^"]+)"/g)) {
    A.push({ archivo: 'index.html', linea: 0, texto: mm[2], via: `meta ${mm[1]}` });
  }
}

for (const abs of archivos(SRC)) {
  const rel = relative(RAIZ, abs);
  const texto = readFileSync(abs, 'utf8');
  const sf = ts.createSourceFile(abs, texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const linea = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const esMock = /\/api\/mock\//.test(rel) || /mockSeed|mockData/i.test(rel);

  const visitar = (n) => {
    // ── A.1 · texto entre tags. El AST lo entrega entero aunque esté partido.
    if (ts.isJsxText(n)) {
      // 🔴 SIN HEURÍSTICA. Si hay texto entre tags, el usuario lo ve — punto.
      // Mi primera versión le exigía «parecer frase» y perdió `Inicio`, `Mesas`,
      // `Volver`, `Cancelar`, `Entrar`: TODA etiqueta de una palabra sin acento.
      // Son los strings más frecuentes de una app, y quedaron invisibles porque
      // el discriminador pedía un espacio o un acento.
      const v = n.text.replace(/\s+/g, ' ').trim();
      if (v && /[A-Za-zÁÉÍÓÚáéíóúñÑ]/.test(v)) A.push({ archivo: rel, linea: linea(n), texto: v, via: 'JSX text' });
      return;
    }

    // ── A.2 · atributos que el usuario lee
    if (ts.isJsxAttribute(n) && n.initializer) {
      const nombre = n.name.getText(sf);
      if (!ATRIBUTOS_NUNCA.has(nombre)) {
        let v = null;
        if (ts.isStringLiteral(n.initializer)) v = n.initializer.text;
        else if (ts.isJsxExpression(n.initializer) && n.initializer.expression) {
          const e = n.initializer.expression;
          if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) v = e.text;
        }
        if (v && (ATRIBUTOS_VISIBLES.has(nombre) || pareceFrase(v))) {
          A.push({ archivo: rel, linea: linea(n), texto: v, via: `attr ${nombre}` });
        }
      }
    }

    // ── A.3 · `{'texto'}` y plantillas DENTRO de JSX
    if (ts.isJsxExpression(n) && n.expression && n.parent && ts.isJsxElement(n.parent)) {
      const e = n.expression;
      if ((ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) && pareceFrase(e.text)) {
        A.push({ archivo: rel, linea: linea(n), texto: e.text, via: 'JSX expr' });
      }
    }

    // ── B/C/D · strings fuera de JSX, clasificados por CONTEXTO del AST.
    //
    // 🔴 Por contexto y no por forma del string. Mi primera versión clasificaba
    // por aspecto y metió 161 paths de SVG de `Icon.tsx` como si fueran copy
    // —tienen letras y espacios—, más `badge badge-orange`, que es una clase.
    // El AST sabe DÓNDE vive cada string; la forma sólo sabe cómo se ve.
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      const p = n.parent;
      const enJsxAttr = p && ts.isJsxAttribute(p);
      const esImport = p && (ts.isImportDeclaration(p) || ts.isExportDeclaration(p));
      const esNombreProp = p && ts.isPropertyAssignment(p) && p.name === n;
      const ctxPre = (!enJsxAttr && !esImport && !esNombreProp) ? contexto(n, sf) : null;
      // Una palabra suelta en minúscula (`entero`) no «parece frase», y sin
      // embargo es la etiqueta que el comensal lee. Lo salva el CONTEXTO: vive
      // dentro de `bpsLabel`. La forma no alcanzaba; el nombre de quien la
      // devuelve, sí.
      const porContexto = ctxPre
        && /label|etiqueta|texto|copy|titulo|title|leyenda/i.test(`${ctxPre.variable ?? ''} ${ctxPre.funcion ?? ''} ${ctxPre.prop ?? ''}`)
        && /^[a-záéíóúñü][a-záéíóúñü ]{2,}$/i.test(n.text.trim());
      if (!enJsxAttr && !esImport && !esNombreProp && (pareceFrase(n.text) || porContexto)) {
        const ctx = ctxPre;
        const fila = { archivo: rel, linea: linea(n), texto: n.text, via: 'literal', ctx };
        if (esPathSvg(n.text) || esValorCss(n.text)) { /* geometría o CSS, no copy */ }
        else if (PROP_NO_COPY.has(ctx.prop)) { /* className, id, icono… */ }
        else if (ctx.llamada && LLAMADA_DEV.has(ctx.llamada)) D.push(fila);
        else if (esMock) C.push(fila);
        else B.push(fila);
      }
    }

    // ── plantillas con interpolación: se reconstruyen con {…} donde va el hueco
    if (ts.isTemplateExpression(n)) {
      let s = n.head.text;
      for (const sp of n.templateSpans) s += `{${sp.expression.getText(sf).slice(0, 28)}}` + sp.literal.text;
      if (pareceFrase(s.replace(/\{[^}]*\}/g, 'X'))) {
        // 🔴 Las plantillas pasan por el MISMO filtro de contexto que los
        // literales. Antes lo salteaban entero, y por eso un `console.error`
        // partido en dos líneas con `+` entró como copy de usuario. El AST lo
        // había encontrado bien —era justo el caso multilínea—; lo que falló
        // fue clasificarlo.
        const ctx = contexto(n, sf);
        const dentroJsx = (() => { let q = n.parent; while (q) { if (ts.isJsxElement(q) || ts.isJsxAttribute(q)) return true; q = q.parent; } return false; })();
        const limpio = s.replace(/\s+/g, ' ').trim();
        const fila = { archivo: rel, linea: linea(n), texto: limpio, via: 'template', ctx };
        if (esValorCss(limpio) || PROP_NO_COPY.has(ctx.prop)) { /* no es copy */ }
        else if (ctx.llamada && LLAMADA_DEV.has(ctx.llamada)) D.push(fila);
        else if (dentroJsx) A.push(fila);
        else if (esMock) C.push(fila);
        else B.push(fila);
      }
    }

    ts.forEachChild(n, visitar);
  };
  visitar(sf);
}

const dedup = (xs) => {
  const m = new Map();
  for (const x of xs) m.set(`${x.archivo}:${x.linea}:${x.texto}`, x);
  return [...m.values()];
};
const a = dedup(A), b = dedup(B), c = dedup(C), dd = dedup(D);
console.log(JSON.stringify({
  A_jsx_visible: a, B_copy_en_ts: b, C_datos_del_mock: c, D_mensajes_de_dev: dd,
  conteo: { A: a.length, B: b.length, C: c.length, D: dd.length, unicos: new Set([...a, ...b].map((x) => x.texto)).size },
}, null, 1));
