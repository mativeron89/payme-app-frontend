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
 * 🔴 P40-① · ¿la expresión contiene algo que pueda TENER EFECTOS?
 *
 * Si lo tiene, **ni siquiera los identificadores se pueden correlacionar**: en
 * `a || f() || !a`, la llamada del medio puede haber cambiado `a`. Es una
 * respuesta gruesa a propósito — acá no se hace análisis de alias, se falla
 * cerrado.
 */
function tieneEfectos(n: ts.Node): boolean {
  if (
    ts.isCallExpression(n) || ts.isNewExpression(n) || ts.isAwaitExpression(n) ||
    ts.isYieldExpression(n) || ts.isTaggedTemplateExpression(n) ||
    (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) ||
    ts.isPostfixUnaryExpression(n) ||
    (ts.isPrefixUnaryExpression(n) &&
      (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken))
  ) return true;
  let hallado = false;
  n.forEachChild((h) => { if (tieneEfectos(h)) hallado = true; });
  return hallado;
}

/**
 * La CLAVE de una hoja — y acá está el arreglo del P40-①.
 *
 * 🔴 **Antes la clave era el TEXTO, y dos ocurrencias efectuales textualmente
 * iguales se colapsaban en una sola hoja.** Codex lo mató con un mutante que
 * compila: `disabled={Math.random() > 0.5 || !(Math.random() > 0.5)}` quedaba
 * modelado como `x || !x` —una tautología— y el arnés lo declaraba PROBADO,
 * aunque JavaScript evalúa **dos llamadas independientes** y puede dar
 * `false || !true`, dejando el control habilitado.
 *
 * Ahora sólo se correlaciona lo que se puede sostener:
 *   · un **identificador pelado** comparte valor entre ocurrencias — un binding
 *     no cambia entre dos lecturas sincrónicas;
 *   · **cualquier otra cosa** (llamada, acceso que puede ser getter,
 *     comparación, ternario) recibe identidad **POR OCURRENCIA**, así que dos
 *     iguales se enumeran por separado y la tautología desaparece;
 *   · y si en la expresión hay **algo efectual**, **ni los identificadores se
 *     correlacionan**: la llamada del medio puede haberlos cambiado.
 *
 * ⚠️ **Esto sólo puede volver el arnés MÁS estricto, nunca más permisivo:**
 * separar una hoja en dos agrega asignaciones a la tabla de verdad, y agregar
 * asignaciones sólo puede quitar implicaciones probadas.
 */
function claveDeHoja(n: ts.Node, sf: ts.SourceFile, correlacionar: boolean): string {
  if (correlacionar && ts.isIdentifier(n)) return n.text;
  return `${n.getText(sf)}@${n.getStart(sf)}`;
}

/**
 * Las hojas de la expresión: todo lo que no es `!`, `&&`, `||` o paréntesis.
 *
 * 🔴 Tratar una hoja desconocida como **booleano opaco** es lo que hace sano
 * al método. `cards.length === 0`, `foo()`, `a ?? b` o un ternario entran como
 * átomos y se enumeran en SUS DOS valores; si la implicación no se sostiene con
 * alguno, no está probada. **No hay forma de que una hoja rara pase por sana.**
 */
function hojas(n: ts.Node, sf: ts.SourceFile, acc: Set<string>, correlacionar: boolean): void {
  if (n.kind === ts.SyntaxKind.TrueKeyword || n.kind === ts.SyntaxKind.FalseKeyword) return;
  if (esConectivo(n)) {
    n.forEachChild((h) => hojas(h, sf, acc, correlacionar));
    return;
  }
  acc.add(claveDeHoja(n, sf, correlacionar));
}

function evaluar(n: ts.Node, sf: ts.SourceFile, val: Map<string, boolean>, correlacionar: boolean): boolean {
  if (n.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (n.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isParenthesizedExpression(n)) return evaluar(n.expression, sf, val, correlacionar);
  if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.ExclamationToken) {
    return !evaluar(n.operand, sf, val, correlacionar);
  }
  if (ts.isBinaryExpression(n)) {
    if (n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      return evaluar(n.left, sf, val, correlacionar) && evaluar(n.right, sf, val, correlacionar);
    }
    if (n.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
      return evaluar(n.left, sf, val, correlacionar) || evaluar(n.right, sf, val, correlacionar);
    }
  }
  return val.get(claveDeHoja(n, sf, correlacionar))!;
}

/** Techo del barrido exhaustivo. Sólo se llega acá si la prueba estructural falló. */
const MAX_HOJAS = 12;

/**
 * 🔴 PRUEBA ESTRUCTURAL — un procedimiento de UN SOLO LADO, y por eso es sano.
 *
 * `demuestra` sólo devuelve `true` cuando la expresión es verdadera **con
 * certeza** bajo `dado`; ante la duda contesta `false` y el llamador cae a la
 * tabla de verdad. **Nunca puede aprobar algo falso; a lo sumo no aprueba algo
 * cierto**, y eso es exactamente el lado seguro.
 *
 * Existe porque la tabla sola no alcanza: el `disabled` del CTA tiene 24 hojas
 * —2^24 asignaciones— y quedaba en «demasiadas hojas», o sea SIN acreditar,
 * cuando en realidad su primer término **es** la guarda y alcanza con eso. Una
 * disyunción se prueba con UN disyunto.
 *
 * `refuta` es su dual y hace falta para el `!`: para probar `!X` hay que
 * demostrar que `X` es falsa, no basta con no poder probarla.
 */
function demuestra(n: ts.Node, sf: ts.SourceFile, dado: Record<string, boolean>, corr: boolean): boolean {
  if (n.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (n.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isParenthesizedExpression(n)) return demuestra(n.expression, sf, dado, corr);
  if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.ExclamationToken) {
    return refuta(n.operand, sf, dado, corr);
  }
  if (ts.isBinaryExpression(n)) {
    if (n.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
      return demuestra(n.left, sf, dado, corr) || demuestra(n.right, sf, dado, corr);
    }
    if (n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      return demuestra(n.left, sf, dado, corr) && demuestra(n.right, sf, dado, corr);
    }
  }
  return dado[claveDeHoja(n, sf, corr)] === true;
}

function refuta(n: ts.Node, sf: ts.SourceFile, dado: Record<string, boolean>, corr: boolean): boolean {
  if (n.kind === ts.SyntaxKind.TrueKeyword) return false;
  if (n.kind === ts.SyntaxKind.FalseKeyword) return true;
  if (ts.isParenthesizedExpression(n)) return refuta(n.expression, sf, dado, corr);
  if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.ExclamationToken) {
    return demuestra(n.operand, sf, dado, corr);
  }
  if (ts.isBinaryExpression(n)) {
    if (n.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
      return refuta(n.left, sf, dado, corr) && refuta(n.right, sf, dado, corr);
    }
    if (n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      return refuta(n.left, sf, dado, corr) || refuta(n.right, sf, dado, corr);
    }
  }
  return dado[claveDeHoja(n, sf, corr)] === false;
}

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
  // 🔴 Con algo efectual adentro, NADA se correlaciona: es la forma gruesa y
  // fail-closed de contestar «no puedo sostener que dos lecturas den lo mismo».
  const correlacionar = !tieneEfectos(expr);
  // Primero la prueba estructural: barata, de un solo lado, y la única que
  // puede acreditar expresiones grandes como el `disabled` del CTA.
  if (demuestra(expr, sf, dado, correlacionar)) {
    return { probada: true, motivo: 'demostrada por estructura' };
  }
  const todas = new Set<string>();
  hojas(expr, sf, todas, correlacionar);
  const libres = [...todas].filter((h) => !(h in dado));
  if (libres.length > MAX_HOJAS) {
    return { probada: false, motivo: `demasiadas hojas (${libres.length}): no se puede demostrar` };
  }
  for (let mascara = 0; mascara < 1 << libres.length; mascara++) {
    const val = new Map<string, boolean>(Object.entries(dado));
    libres.forEach((h, i) => val.set(h, (mascara & (1 << i)) !== 0));
    if (!evaluar(expr, sf, val, correlacionar)) {
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
 * 🔴 P40-② · LOS HANDLERS QUE **NO** SON INTERACCIÓN — y es la única lista de
 * este archivo, escrita al revés a propósito.
 *
 * La versión anterior enumeraba **los handlers que sí** (`onClick`,
 * `onChange`, …) y por eso `onDoubleClick`, `onActivate` y cualquier `on*`
 * futuro quedaban afuera del censo: **una lista de lo permitido falla abierta**.
 * Acá se enumera lo EXCLUIDO, así que **un handler nuevo entra como
 * interacción por defecto** y hay que sacarlo a mano si no lo es.
 *
 * Los cuatro que están son ciclo de vida del navegador —animación, transición,
 * carga— y ninguno lo dispara una persona tocando la pantalla.
 */
export const HANDLERS_NO_INTERACTIVOS = [
  'onAnimationStart', 'onAnimationEnd', 'onAnimationIteration', 'onTransitionEnd',
  'onLoad', 'onError',
];

const esHandler = (nombre: string) => /^on[A-Z]/.test(nombre);
export const esHandlerDeInteraccion = (nombre: string) =>
  esHandler(nombre) && !HANDLERS_NO_INTERACTIVOS.includes(nombre);

/**
 * Atributos que vuelven accionable a CUALQUIER etiqueta, sin importar cuál sea.
 * `href` mete a `<a>` sin necesidad de nombrarlo; `tabIndex` y
 * `contentEditable` meten a los que reciben foco o edición.
 */
export const ATRIBUTOS_ACCIONABLES = ['href', 'tabIndex', 'contentEditable', 'disabled'];

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
  /** 🔴 Un spread puede aportar `role`, un handler o la guarda: NO es decidible. */
  tieneSpread: boolean;
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
    const tieneSpread = el.attributes.properties.some(ts.isJsxSpreadAttribute);
    const guarda = atributos.find((a) => a.name.getText(sf) === 'disabled') ?? null;
    salida.push({
      tag: el.tagName.getText(sf),
      linea: sf.getLineAndCharacterOfPosition(el.getStart(sf)).line + 1,
      guarda,
      guardaTexto: guarda ? (guarda.initializer ? guarda.initializer.getText(sf) : 'true') : null,
      atributos,
      tieneSpread,
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
 * 🔴 P45-M16 · EL CUERPO RENDERIZADO de un componente, para poder RECORRERLO.
 *
 * Codex mostró que un custom **autocontenido** —cero props, cero spread, cero
 * `disabled`, con un `<button onClick>` adentro— quedaba `inerte` y **el censo
 * ni miraba su cuerpo**. Su frase, que es la que corrige el error de fondo:
 * **«una función sin parámetro produce una lista conocida y VACÍA de props, NO
 * un resultado indecidible»**. Yo estaba tratando «no declara props» como «no
 * tiene superficie», y son cosas distintas.
 *
 * Devuelve `null` cuando el componente **no se puede seguir** —vive en otro
 * paquete, es un alias, no se encuentra—. Ese `null` es fail-closed para el
 * llamador: **es lo que evita tener que censar el universo** (una librería
 * externa no se recorre; se declara que no se pudo y se decide a mano).
 */
export function cuerpoDelComponente(
  nombre: string,
  arbol: Arbol,
): { nodo: ts.Node; sf: ts.SourceFile } | null {
  for (const fuente of Object.values(arbol)) {
    let hallado: { nodo: ts.Node; sf: ts.SourceFile } | null = null;
    fuente.forEachChild((n) => {
      if (hallado) return;
      if (ts.isFunctionDeclaration(n) && n.name?.text === nombre && n.body) {
        hallado = { nodo: n.body, sf: fuente };
      } else if (ts.isClassDeclaration(n) && n.name?.text === nombre) {
        // 🔴 El cuerpo de un componente de clase es su `render()`, no la clase
        // entera: mirar la clase mete `getDerivedStateFromError` y los demás
        // métodos, que no son lo que se renderiza.
        const render = n.members.find(
          (m) => ts.isMethodDeclaration(m) && m.name.getText(fuente) === 'render',
        ) as ts.MethodDeclaration | undefined;
        hallado = render?.body ? { nodo: render.body, sf: fuente } : null;
      } else if (ts.isVariableStatement(n)) {
        for (const d of n.declarationList.declarations) {
          if (d.name.getText(fuente) !== nombre || !d.initializer) continue;
          if (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)) {
            hallado = { nodo: d.initializer.body, sf: fuente };
          }
        }
      }
    });
    if (hallado) return hallado;
  }
  return null;
}

/**
 * 🔴 P50-01 · LOS RETORNOS DE UN CUERPO, clasificados — y por qué hace falta.
 *
 * El censo bajaba al JSX escrito **léxicamente** en el cuerpo de un componente.
 * Codex mostró el nivel siguiente: un helper que **devuelve** el botón y un
 * componente que **sólo lo llama**. Nada de eso es JSX léxico del componente, y
 * el censo lo daba por vacío.
 *
 * ⚠️ **Es la misma clase del M16, un nivel indirecto** — la capa que yo misma
 * había anunciado que iba a aparecer. La forma de cerrarla no es agregar «y
 * también seguir llamadas»: es **decidir qué se acepta como retorno probado** y
 * **fallar cerrado con todo lo demás**.
 *
 * Se aceptan, y cada uno por su razón:
 *   · **JSX** — ya se recorrió léxicamente;
 *   · **`null`/`undefined`/literal** — no hay superficie;
 *   · **condicional o lógico** — se clasifica cada rama;
 *   · **llamada a una función local resoluble** — se SIGUE su cuerpo;
 *   · **algo de los props** (`props.x`, `this.props.x`) — es JSX del LLAMADOR,
 *     y se recorre donde está escrito, que es el sitio de la llamada.
 *
 * Todo lo demás —una variable, una llamada que no se puede resolver, un acceso
 * a otra cosa— **es indecidible**. No es que sea peligroso: es que **no se puede
 * demostrar que no lo sea**, y ésa es la única respuesta honesta.
 */
export type Retorno =
  | { tipo: 'ok' }
  | { tipo: 'seguir'; nombre: string }
  | { tipo: 'indecidible'; texto: string };

export function clasificarRetorno(
  expr: ts.Expression | undefined,
  sf: ts.SourceFile,
  nombresDeProps: string[],
): Retorno[] {
  if (!expr) return [{ tipo: 'ok' }];
  if (ts.isParenthesizedExpression(expr)) return clasificarRetorno(expr.expression, sf, nombresDeProps);
  if (ts.isJsxElement(expr) || ts.isJsxSelfClosingElement(expr) || ts.isJsxFragment(expr)) return [{ tipo: 'ok' }];
  if (
    expr.kind === ts.SyntaxKind.NullKeyword ||
    ts.isStringLiteral(expr) || ts.isNumericLiteral(expr) ||
    (ts.isIdentifier(expr) && expr.text === 'undefined')
  ) return [{ tipo: 'ok' }];
  if (ts.isConditionalExpression(expr)) {
    return [...clasificarRetorno(expr.whenTrue, sf, nombresDeProps), ...clasificarRetorno(expr.whenFalse, sf, nombresDeProps)];
  }
  if (ts.isBinaryExpression(expr) &&
      (expr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
       expr.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
       expr.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) {
    return [...clasificarRetorno(expr.left, sf, nombresDeProps), ...clasificarRetorno(expr.right, sf, nombresDeProps)];
  }
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression)) {
    return [{ tipo: 'seguir', nombre: expr.expression.text }];
  }
  // `this.props.x` o `props.x`: JSX que escribió el llamador y que se recorre
  // en el sitio de la llamada. No es un agujero, es otro lugar.
  if (ts.isPropertyAccessExpression(expr)) {
    const raiz = expr.expression.getText(sf);
    if (/^this\.props$/.test(raiz) || nombresDeProps.includes(raiz)) return [{ tipo: 'ok' }];
  }
  return [{ tipo: 'indecidible', texto: expr.getText(sf).replace(/\s+/g, ' ').slice(0, 60) }];
}

/**
 * Las EXPRESIONES QUE UN CUERPO DEVUELVE — y ojo con el nombre: no son «los
 * `return`», y confundir las dos cosas fue el defecto.
 *
 * 🔴 **P53-01 · un arrow con cuerpo-EXPRESIÓN no tiene `ReturnStatement`.**
 * `const crearCta = () => <button…/>` devuelve, pero no hay `return` que
 * encontrar. La versión anterior buscaba sentencias, así que ese cuerpo salía
 * **vacío**: ni JSX que recorrer ni retorno que declarar indecidible. **Se
 * perdía en silencio**, que es la peor forma de las tres.
 *
 * ⚠️ Es la misma lección de siempre en un envase nuevo: **buscar la FORMA
 * SINTÁCTICA (`return`) en vez de la COSA (lo que el cuerpo devuelve)**. Un
 * retorno implícito es un retorno.
 *
 * 🔴 **No entra en funciones anidadas**, y el primer intento sí lo hacía: dio
 * por indecidibles el `return { failed: true }` de un `getDerivedStateFromError`
 * y el `return () => {…}` de la limpieza de un `useEffect`. **Ninguno es lo que
 * el componente renderiza.** Contarlos habría obligado a aflojar la regla para
 * compensar, que es cómo un fail-closed se vuelve ruido y después permiso.
 */
export function retornosDe(cuerpo: ts.Node): ts.Expression[] {
  // Cuerpo-expresión: el cuerpo ES el retorno. No hay sentencia que buscar.
  if (!ts.isBlock(cuerpo)) {
    return ts.isExpression(cuerpo) ? [cuerpo] : [];
  }
  const salida: ts.Expression[] = [];
  const recorrer = (n: ts.Node) => {
    if (
      ts.isArrowFunction(n) || ts.isFunctionExpression(n) ||
      ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)
    ) return;
    if (ts.isReturnStatement(n)) { if (n.expression) salida.push(n.expression); return; }
    n.forEachChild(recorrer);
  };
  cuerpo.statements.forEach(recorrer);
  return salida;
}

/**
 * 🔴 P40-② · ¿alguno de los props lleva el seam de apagado ANIDADO?
 *
 * `AppBottomBar` no declara `disabled` arriba: lo lleva dentro de `center`, y
 * por eso el censo anterior lo daba por inerte **al CTA de la pantalla de
 * pago**. Codex lo nombró como «frontera interactiva omitida». Esto lo detecta
 * **derivándolo del tipo**, no nombrándolo: cualquier componente cuyo tipo de
 * props tenga un miembro-objeto con `disabled` adentro entra a la población.
 */
export function tieneSeamAnidado(nombre: string, arbol: Arbol): boolean {
  for (const fuente of Object.values(arbol)) {
    let hallado = false;
    const mirarTipo = (tipo: ts.TypeNode | undefined) => {
      if (!tipo) return;
      const miembros = ts.isTypeLiteralNode(tipo) ? tipo.members : null;
      if (!miembros) return;
      for (const m of miembros) {
        const t = (m as ts.PropertySignature).type;
        if (t && ts.isTypeLiteralNode(t) && t.members.some((x) => x.name?.getText(fuente) === 'disabled')) {
          hallado = true;
        }
      }
    };
    fuente.forEachChild((n) => {
      if (ts.isInterfaceDeclaration(n) && n.name.text === `${nombre}Props`) {
        for (const m of n.members) {
          const t = (m as ts.PropertySignature).type;
          if (t && ts.isTypeLiteralNode(t) && t.members.some((x) => x.name?.getText(fuente) === 'disabled')) {
            hallado = true;
          }
        }
      }
      if (ts.isFunctionDeclaration(n) && n.name?.text === nombre) mirarTipo(n.parameters[0]?.type);
    });
    if (hallado) return true;
  }
  return false;
}

/**
 * Los props que DECLARA un componente, buscándolo por nombre en todo el árbol.
 *
 * `undefined` = no se encontró la declaración · `null` = se encontró y no se
 * pudo resolver. Las dos son fail-closed para el llamador; se distinguen para
 * que el mensaje diga cuál es.
 *
 * ⚠️ **Residual conocido (P3 del P40, declarado y NO cerrado):** ante dos
 * componentes HOMÓNIMOS en archivos distintos, esto toma el primero que
 * encuentra en vez de resolver el símbolo del call site. Hoy no hay homónimos
 * en el árbol y por eso no cambia ningún resultado; se anota acá porque el que
 * lo lea buscando garantías tiene que ver el límite donde vive la función.
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
