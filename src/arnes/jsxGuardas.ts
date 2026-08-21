import ts from 'typescript';

/**
 * 🔴 ARNÉS DE ORÁCULOS — NO ES CÓDIGO DE PRODUCCIÓN, y por eso vive acá.
 *
 * `src/arnes/**` está **excluido de `tsconfig.json`** —el programa que corre en
 * el teléfono— e incluido en `tsconfig.test.json`, exactamente por el mismo
 * motivo que los tests: **importa `typescript`, que es devDependency**. Si
 * viviera entre las pantallas, alguien podría importarlo desde producción y
 * meter el compilador entero en el bundle. La exclusión convierte esa
 * posibilidad en un error de compilación.
 *
 * ## Por qué existe
 *
 * Tres vueltas de auditoría sobre el mismo gate, y las tres cayeron por la
 * misma familia: **el oráculo enumeraba una proyección de la población, o
 * afirmaba una presencia donde había que probar una implicación.**
 *
 *   · P34 · el censo buscaba `disabled={…}` ⇒ borrar el prop sacaba la
 *     superficie del censo en vez de denunciarla;
 *   · P36 · el censo miraba que el atributo ESTUVIERA ⇒ `disabled={!guarda}` y
 *     `disabled={guarda && false}` pasaban, y dejan el control **habilitado**
 *     justo cuando tiene que estar cerrado.
 *
 * 🔴 **La lección común: presencia ≠ semántica, y forma ≠ población.** Este
 * módulo existe para no volver a escribirlas a mano cada vez.
 *
 * ## La regla que gobierna TODO lo de acá: fail-closed sobre lo no evaluable
 *
 * Ninguna función de este archivo tiene una lista de «formas malas». Cuando no
 * puede **demostrar** lo que promete, contesta que no pudo — y el oráculo que
 * la usa se pone rojo. Una lista negra sólo conoce los mutantes que ya vimos;
 * lo no demostrado incluye a los que todavía no se le ocurrieron a nadie.
 */

/** Un archivo del árbol, ya parseado. */
export type Arbol = Record<string, ts.SourceFile>;

export function parsear(fuentes: Record<string, string>): Arbol {
  return Object.fromEntries(
    Object.entries(fuentes).map(([ruta, texto]) => [
      ruta,
      ts.createSourceFile(ruta, texto, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX),
    ]),
  );
}

// ══════════════════════════════════════════════════════════════════════════
// ① LA IMPLICACIÓN, DEMOSTRADA — no la presencia del atributo
// ══════════════════════════════════════════════════════════════════════════

/** Los únicos conectivos que este evaluador entiende. Todo lo demás es HOJA. */
function esConectivo(n: ts.Node): boolean {
  if (ts.isParenthesizedExpression(n)) return true;
  if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.ExclamationToken) return true;
  if (ts.isBinaryExpression(n)) {
    return (
      n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      n.operatorToken.kind === ts.SyntaxKind.BarBarToken
    );
  }
  return false;
}

/**
 * Las hojas de la expresión: todo lo que no es `!`, `&&`, `||` o paréntesis.
 *
 * 🔴 Tratar una hoja desconocida como **booleano opaco** es lo que hace sano
 * al método. `cards.length === 0`, `foo()`, `a ?? b` o un ternario entran como
 * átomos y se enumeran en SUS DOS valores; si la implicación no se sostiene con
 * alguno, no está probada. **No hay forma de que una hoja rara pase por sana.**
 */
function hojas(n: ts.Node, sf: ts.SourceFile, acc: Set<string>): void {
  if (n.kind === ts.SyntaxKind.TrueKeyword || n.kind === ts.SyntaxKind.FalseKeyword) return;
  if (esConectivo(n)) {
    n.forEachChild((h) => hojas(h, sf, acc));
    return;
  }
  acc.add(n.getText(sf));
}

function evaluar(n: ts.Node, sf: ts.SourceFile, val: Map<string, boolean>): boolean {
  if (n.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (n.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isParenthesizedExpression(n)) return evaluar(n.expression, sf, val);
  if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.ExclamationToken) {
    return !evaluar(n.operand, sf, val);
  }
  if (ts.isBinaryExpression(n)) {
    if (n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      return evaluar(n.left, sf, val) && evaluar(n.right, sf, val);
    }
    if (n.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
      return evaluar(n.left, sf, val) || evaluar(n.right, sf, val);
    }
  }
  return val.get(n.getText(sf))!;
}

/** Techo del barrido. Con tantas hojas la expresión ya no es una guarda. */
const MAX_HOJAS = 12;

export interface Implicacion {
  /** `true` SÓLO si se demostró. «No pude» y «es falso» NO se confunden. */
  probada: boolean;
  motivo: string;
}

/**
 * ¿La expresión es VERDADERA en toda asignación donde `dado` vale?
 *
 * Se demuestra por exhaución sobre las hojas libres: no es una heurística ni un
 * reconocimiento de formas, es la tabla de verdad completa. Las hojas que el
 * evaluador no entiende participan igual, con sus dos valores.
 */
export function implicaVerdadero(
  expr: ts.Node,
  sf: ts.SourceFile,
  dado: Record<string, boolean>,
): Implicacion {
  const todas = new Set<string>();
  hojas(expr, sf, todas);
  const libres = [...todas].filter((h) => !(h in dado));
  if (libres.length > MAX_HOJAS) {
    return { probada: false, motivo: `demasiadas hojas (${libres.length}): no se puede demostrar` };
  }
  for (let mascara = 0; mascara < 1 << libres.length; mascara++) {
    const val = new Map<string, boolean>(Object.entries(dado));
    libres.forEach((h, i) => val.set(h, (mascara & (1 << i)) !== 0));
    if (!evaluar(expr, sf, val)) {
      const contra = libres.map((h) => `${h}=${val.get(h)}`).join(', ');
      return {
        probada: false,
        motivo: libres.length
          ? `queda FALSA con ${contra} — el control seguiría habilitado`
          : 'es FALSA siempre — el control seguiría habilitado',
      };
    }
  }
  return { probada: true, motivo: 'verdadera en toda asignación' };
}

// ══════════════════════════════════════════════════════════════════════════
// ② LA POBLACIÓN, DERIVADA — y fail-closed cuando no se puede cerrar
// ══════════════════════════════════════════════════════════════════════════

/** Controles del DOM que se deshabilitan por atributo propio del HTML. */
export const CONTROLES_HTML = ['button', 'input', 'select', 'textarea'];

/**
 * Roles ARIA que hacen INTERACTUABLE a un elemento cualquiera. Los de
 * contenedor (`radiogroup`, `alertdialog`, `group`) NO están: agrupan, no se
 * accionan.
 */
export const ROLES_INTERACTIVOS = [
  'button', 'radio', 'checkbox', 'switch', 'link', 'menuitem',
  'menuitemcheckbox', 'menuitemradio', 'option', 'tab', 'slider',
  'textbox', 'combobox', 'spinbutton',
];

/** Handlers que convierten en accionable a un elemento sin rol. */
export const HANDLERS = [
  'onClick', 'onChange', 'onInput', 'onSubmit', 'onKeyDown', 'onKeyUp',
  'onKeyPress', 'onPointerDown', 'onMouseDown', 'onTouchStart',
];

export interface Superficie {
  tag: string;
  linea: number;
  /** El nodo del atributo `disabled` PROPIO, o `null`. */
  guarda: ts.JsxAttribute | null;
  /** Texto de la expresión de la guarda, para los mensajes. */
  guardaTexto: string | null;
  atributos: ts.JsxAttribute[];
  ancestros: ts.JsxOpeningElement[];
  nodo: ts.JsxOpeningElement | ts.JsxSelfClosingElement;
  sf: ts.SourceFile;
}

/** El JsxAttribute de ese nombre, por AST — nunca por substring. */
export function atributo(s: Superficie, nombre: string): ts.JsxAttribute | null {
  return s.atributos.find((a) => a.name.getText(s.sf) === nombre) ?? null;
}

/** El texto de la expresión de un atributo, o `null` si no lo tiene. */
export function expresionDe(a: ts.JsxAttribute | null, sf: ts.SourceFile): string | null {
  if (!a?.initializer) return null;
  if (!ts.isJsxExpression(a.initializer)) return null;
  return a.initializer.expression?.getText(sf) ?? null;
}

/**
 * 🔴 Exactitud, no substring. `role="alertdialog"` se reconoce por el ATRIBUTO
 * `role` cuyo literal es exactamente `alertdialog` — no porque esa cadena
 * aparezca en algún lado del elemento, que era satisfacible desde un atributo
 * irrelevante (un `aria-label`, un comentario, una clase).
 */
export function atributoLiteral(s: Superficie, nombre: string): string | null {
  const a = atributo(s, nombre);
  if (!a?.initializer) return null;
  if (ts.isStringLiteral(a.initializer)) return a.initializer.text;
  if (ts.isJsxExpression(a.initializer) && a.initializer.expression && ts.isStringLiteral(a.initializer.expression)) {
    return a.initializer.expression.text;
  }
  return null;
}

export function elementosJsx(raiz: ts.Node, sf: ts.SourceFile): Superficie[] {
  const salida: Superficie[] = [];
  const pila: ts.JsxOpeningElement[] = [];

  const registrar = (el: ts.JsxOpeningElement | ts.JsxSelfClosingElement) => {
    const atributos = el.attributes.properties.filter(ts.isJsxAttribute);
    const guarda = atributos.find((a) => a.name.getText(sf) === 'disabled') ?? null;
    salida.push({
      tag: el.tagName.getText(sf),
      linea: sf.getLineAndCharacterOfPosition(el.getStart(sf)).line + 1,
      guarda,
      guardaTexto: guarda ? (guarda.initializer ? guarda.initializer.getText(sf) : 'true') : null,
      atributos,
      ancestros: [...pila],
      nodo: el,
      sf,
    });
  };

  const recorrer = (n: ts.Node) => {
    if (ts.isJsxSelfClosingElement(n)) { registrar(n); n.forEachChild(recorrer); return; }
    if (ts.isJsxElement(n)) {
      registrar(n.openingElement);
      pila.push(n.openingElement);
      n.children.forEach(recorrer);
      pila.pop();
      // Los props del elemento abierto también pueden traer JSX
      // (`fallback={<div/>}`): se recorren FUERA de su propia pila.
      n.openingElement.attributes.forEachChild(recorrer);
      return;
    }
    n.forEachChild(recorrer);
  };
  recorrer(raiz);
  return salida;
}

/**
 * Los miembros de PRIMER NIVEL de un tipo de props.
 *
 * De primer nivel a propósito: un `disabled` ANIDADO dentro de otro objeto no
 * es un prop `disabled` del componente.
 *
 * 🔴 Devuelve `null` cuando NO PUEDE resolver, y eso incluye **la herencia
 * calificada** (`extends React.ButtonHTMLAttributes<…>`). Antes esa rama se
 * SALTEABA en silencio y el componente quedaba con sus miembros propios: un
 * componente que hereda `disabled` de React pasaba censo y typecheck. Ahora la
 * población no se puede cerrar y el oráculo lo denuncia.
 */
export function miembrosDeTipo(
  tipo: ts.TypeNode | undefined,
  sf: ts.SourceFile,
  arbol: Arbol,
  visto = new Set<string>(),
): string[] | null {
  if (!tipo) return [];
  if (ts.isTypeLiteralNode(tipo)) return tipo.members.map((m) => m.name?.getText(sf) ?? '');
  if (ts.isIntersectionTypeNode(tipo)) {
    const partes = tipo.types.map((t) => miembrosDeTipo(t, sf, arbol, visto));
    return partes.some((p) => p === null) ? null : (partes as string[][]).flat();
  }
  if (ts.isTypeReferenceNode(tipo)) {
    // 🔴 Un nombre CALIFICADO (`React.ButtonHTMLAttributes`) no se resuelve en
    // este árbol: es de otro paquete. No se saltea — se declara irresoluble.
    if (!ts.isIdentifier(tipo.typeName)) return null;
    const nombre = tipo.typeName.text;
    if (visto.has(nombre)) return [];
    visto.add(nombre);
    for (const fuente of Object.values(arbol)) {
      let hallado: string[] | null | undefined;
      fuente.forEachChild((n) => {
        if (hallado !== undefined) return;
        if (ts.isInterfaceDeclaration(n) && n.name.text === nombre) {
          let miembros: string[] | null = n.members.map((m) => m.name?.getText(fuente) ?? '');
          for (const clausula of n.heritageClauses ?? []) {
            for (const padre of clausula.types) {
              // Igual que arriba: si el padre no es un identificador simple de
              // este árbol, la herencia NO se puede seguir y el resultado es
              // irresoluble. Saltearla era el hueco.
              const heredados = ts.isIdentifier(padre.expression)
                ? miembrosDeTipo(
                    ts.factory.createTypeReferenceNode(padre.expression.text),
                    fuente,
                    arbol,
                    visto,
                  )
                : null;
              miembros = heredados === null || miembros === null ? null : miembros.concat(heredados);
            }
          }
          hallado = miembros;
        }
        if (ts.isTypeAliasDeclaration(n) && n.name.text === nombre) {
          hallado = miembrosDeTipo(n.type, fuente, arbol, visto);
        }
      });
      if (hallado !== undefined) return hallado;
    }
    return null;
  }
  return null;
}

/**
 * Los props que DECLARA un componente, buscándolo por nombre en todo el árbol.
 *
 * `undefined` = no se encontró la declaración · `null` = se encontró y no se
 * pudo resolver. Las dos son fail-closed para el llamador; se distinguen para
 * que el mensaje diga cuál es.
 */
export function propsDeclarados(nombre: string, arbol: Arbol): string[] | null | undefined {
  for (const fuente of Object.values(arbol)) {
    let resultado: string[] | null | undefined;
    fuente.forEachChild((n) => {
      if (resultado !== undefined) return;
      if (ts.isFunctionDeclaration(n) && n.name?.text === nombre) {
        resultado = deParametro(n.parameters[0], fuente, arbol);
      } else if (ts.isVariableStatement(n)) {
        for (const d of n.declarationList.declarations) {
          if (
            d.name.getText(fuente) === nombre &&
            d.initializer &&
            (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))
          ) {
            resultado = deParametro(d.initializer.parameters[0], fuente, arbol);
          }
        }
      } else if (ts.isClassDeclaration(n) && n.name?.text === nombre) {
        resultado = miembrosDeTipo(n.heritageClauses?.[0]?.types?.[0]?.typeArguments?.[0], fuente, arbol);
      }
    });
    if (resultado !== undefined) return resultado;
  }
  return undefined;
}

/**
 * 🔴 Un parámetro SIN anotación de tipo es irresoluble, no «sin props».
 *
 * Es el caso de `const X: React.FC<Props> = ({ disabled }) => …`: el tipo vive
 * en la anotación de la variable, que este arnés no sigue. Contestar `[]` ahí
 * diría «no declara `disabled`» sobre un componente que sí lo declara.
 */
function deParametro(p: ts.ParameterDeclaration | undefined, sf: ts.SourceFile, arbol: Arbol): string[] | null {
  if (!p) return [];
  if (!p.type) return null;
  return miembrosDeTipo(p.type, sf, arbol);
}
