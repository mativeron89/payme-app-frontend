import ts from 'typescript';

export interface EntradaPoliticaScriptLanding {
  readonly artefacto: string;
  readonly codigo: string;
}

export interface FallaPoliticaScriptLanding {
  readonly artefacto: string;
  readonly regla: string;
  readonly mensaje: string;
  readonly linea: number;
  readonly columna: number;
}

type SourceFileConDiagnosticos = ts.SourceFile & {
  readonly parseDiagnostics: readonly ts.Diagnostic[];
};

const GLOBALES_PERMITIDOS = new Set([
  'document',
  'localStorage',
  'Math',
  'Object',
  'window',
]);

const GLOBALES_RECEIVER_PROTEGIDOS = new Set([
  'document',
  'localStorage',
  'Math',
  'Object',
  'window',
]);

const GLOBALES_SIEMPRE_PROHIBIDOS: Readonly<Record<string, string>> = {
  eval: 'codigo-dinamico',
  Function: 'codigo-dinamico',
  require: 'modulos',
  sessionStorage: 'storage',
};

const FUNCIONES_LOCALES_PERMITIDAS = new Set([
  'applyLang',
  'closeMenu',
  'onScroll',
]);

const LECTURAS_COMPUTADAS_PERMITIDAS = new Set([
  'dict',
  'I18N',
]);

function esNombreProtegido(nombre: string): boolean {
  return FUNCIONES_LOCALES_PERMITIDAS.has(nombre) ||
    nombre === 'dict' || nombre === 'I18N' || nombre === 'lang' || nombre === 'key' ||
    GLOBALES_RECEIVER_PROTEGIDOS.has(nombre);
}

/**
 * Allowlist de capacidades que usa hoy el script pequeño de la landing.
 *
 * No intenta demostrar seguridad general de JavaScript. Rechaza cualquier
 * miembro nuevo hasta adjudicarlo y, además, reconoce explícitamente las
 * familias peligrosas que motivaron esta política. Alias o reflexión que no se
 * pueda resolver estáticamente también falla cuando termina en call/escritura
 * computada; una lectura computada local sigue permitida para el diccionario.
 */
const MIEMBROS_PERMITIDOS = new Set([
  'addEventListener',
  'classList',
  'contains',
  'documentElement',
  'forEach',
  'getAttribute',
  'getElementById',
  'getItem',
  'hasOwn',
  'innerHeight',
  'key',
  'min',
  'querySelectorAll',
  'remove',
  'scrollHeight',
  'scrollTop',
  'scrollY',
  'setAttribute',
  'setItem',
  'stopPropagation',
  'style',
  'target',
  'textContent',
  'toggle',
  'transform',
]);

const LLAMADAS_PERMITIDAS = new Set([
  'addEventListener',
  'contains',
  'forEach',
  'getAttribute',
  'getElementById',
  'getItem',
  'hasOwn',
  'min',
  'querySelectorAll',
  'remove',
  'setAttribute',
  'setItem',
  'stopPropagation',
  'toggle',
]);

const ESCRITURAS_PERMITIDAS = new Set(['textContent', 'transform']);
const ATRIBUTOS_PERMITIDOS = new Set(['aria-expanded', 'aria-label', 'lang']);
const EVENTOS_PERMITIDOS = new Set(['click', 'keydown', 'scroll']);
const CLAVE_STORAGE = 'payme-landing-lang';

const RECEPTORES_EXACTOS: Readonly<Record<string, readonly string[]>> = {
  addEventListener: ['document', 'langToggle', 'loginTrigger', 'window'],
  contains: ['loginMenu'],
  forEach: ['i18nNodes'],
  getAttribute: ['document.documentElement', 'el'],
  getElementById: ['document'],
  getItem: ['localStorage'],
  hasOwn: ['Object'],
  min: ['Math'],
  querySelectorAll: ['document'],
  remove: ['loginMenu.classList'],
  setAttribute: ['document.documentElement', 'langToggle', 'loginTrigger'],
  setItem: ['localStorage'],
  stopPropagation: ['e'],
  toggle: ['loginMenu.classList', 'nav.classList'],
};

const MIEMBROS_DOM_HTML = new Set([
  'innerHTML',
  'insertAdjacentHTML',
  'outerHTML',
  'write',
  'writeln',
]);

const MIEMBROS_RED_RUNTIME = new Set([
  'register',
  'sendBeacon',
  'serviceWorker',
]);

const GLOBALES_RED_RUNTIME = new Set([
  'EventSource',
  'fetch',
  'importScripts',
  'navigator',
  'SharedWorker',
  'WebSocket',
  'Worker',
  'XMLHttpRequest',
]);

const MIEMBROS_NAVEGACION = new Set([
  'action',
  'assign',
  'href',
  'location',
  'open',
  'replace',
  'src',
]);

function diagnosticosDeParseo(source: ts.SourceFile): readonly ts.Diagnostic[] {
  return (source as SourceFileConDiagnosticos).parseDiagnostics;
}

function posicion(source: ts.SourceFile, node: ts.Node): { linea: number; columna: number } {
  const inicio = node.getStart(source, false);
  const { line, character } = source.getLineAndCharacterOfPosition(inicio);
  return { linea: line + 1, columna: character + 1 };
}

function nombresDeBinding(nombre: ts.BindingName, destino: Set<string>): void {
  if (ts.isIdentifier(nombre)) {
    destino.add(nombre.text);
    return;
  }
  for (const elemento of nombre.elements) {
    if (ts.isOmittedExpression(elemento)) continue;
    nombresDeBinding(elemento.name, destino);
  }
}

function nombresDeclarados(source: ts.SourceFile): Set<string> {
  const nombres = new Set<string>();
  const visitar = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) nombresDeBinding(node.name, nombres);
    if (ts.isFunctionDeclaration(node) && node.name) nombres.add(node.name.text);
    if (ts.isFunctionExpression(node) && node.name) nombres.add(node.name.text);
    if (ts.isParameter(node)) nombresDeBinding(node.name, nombres);
    if (ts.isCatchClause(node) && node.variableDeclaration) {
      nombresDeBinding(node.variableDeclaration.name, nombres);
    }
    ts.forEachChild(node, visitar);
  };
  visitar(source);
  return nombres;
}

function esVariableTopLevel(node: ts.VariableDeclaration): boolean {
  return ts.isVariableDeclarationList(node.parent) &&
    ts.isVariableStatement(node.parent.parent) &&
    ts.isSourceFile(node.parent.parent.parent);
}

function funcionContenedora(node: ts.Node): ts.FunctionDeclaration | null {
  let actual: ts.Node | undefined = node.parent;
  while (actual) {
    if (ts.isFunctionDeclaration(actual)) return actual;
    actual = actual.parent;
  }
  return null;
}

function esOrigenDict(node: ts.VariableDeclaration): boolean {
  const init = node.initializer;
  const contenedora = funcionContenedora(node);
  return !!init && ts.isElementAccessExpression(init) &&
    ts.isIdentifier(init.expression) && init.expression.text === 'I18N' &&
    !!init.argumentExpression && ts.isIdentifier(init.argumentExpression) &&
    init.argumentExpression.text === 'lang' &&
    contenedora?.name?.text === 'applyLang';
}

function esString(node: ts.Expression | undefined, valor: string): boolean {
  return !!node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
    node.text === valor;
}

function esOrigenLang(node: ts.VariableDeclaration): boolean {
  const init = node.initializer;
  const contenedora = funcionContenedora(node);
  if (!init || !ts.isConditionalExpression(init) || contenedora?.name?.text !== 'applyLang') {
    return false;
  }
  const condicion = init.condition;
  return ts.isBinaryExpression(condicion) &&
    condicion.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
    ts.isIdentifier(condicion.left) && condicion.left.text === 'requestedLang' &&
    esString(condicion.right, 'en') && esString(init.whenTrue, 'en') &&
    esString(init.whenFalse, 'es');
}

function esOrigenKey(node: ts.VariableDeclaration): boolean {
  const init = node.initializer;
  const contenedora = funcionContenedora(node);
  if (!init || !ts.isCallExpression(init) || contenedora?.name?.text !== 'applyLang' ||
      !ts.isPropertyAccessExpression(init.expression) ||
      init.expression.name.text !== 'getAttribute' ||
      !ts.isIdentifier(init.expression.expression) || init.expression.expression.text !== 'el') {
    return false;
  }
  return init.arguments.length === 1 && esString(init.arguments[0], 'data-i18n');
}

function origenesComputadosAcreditados(source: ts.SourceFile): Set<string> {
  const i18n: ts.VariableDeclaration[] = [];
  const dict: ts.VariableDeclaration[] = [];
  const lang: ts.VariableDeclaration[] = [];
  const key: ts.VariableDeclaration[] = [];
  const visitar = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      if (node.name.text === 'I18N') i18n.push(node);
      if (node.name.text === 'dict') dict.push(node);
      if (node.name.text === 'lang') lang.push(node);
      if (node.name.text === 'key') key.push(node);
    }
    ts.forEachChild(node, visitar);
  };
  visitar(source);
  const acreditados = new Set<string>();
  if (i18n.length === 1 && esVariableTopLevel(i18n[0]!) &&
      !!i18n[0]!.initializer && ts.isObjectLiteralExpression(i18n[0]!.initializer)) {
    try {
      leerLiteral(i18n[0]!.initializer, 'script inline');
      acreditados.add('I18N');
    } catch {
      // Un objeto con getters, spreads o valores ejecutables no acredita datos.
    }
  }
  if (dict.length === 1 && esOrigenDict(dict[0]!)) acreditados.add('dict');
  if (lang.length === 1 && esOrigenLang(lang[0]!)) acreditados.add('lang');
  if (key.length === 1 && esOrigenKey(key[0]!)) acreditados.add('key');
  return acreditados;
}

function funcionesLocalesAcreditadas(source: ts.SourceFile): Set<string> {
  const conteos = new Map<string, number>();
  for (const sentencia of source.statements) {
    if (ts.isFunctionDeclaration(sentencia) && sentencia.name &&
        FUNCIONES_LOCALES_PERMITIDAS.has(sentencia.name.text)) {
      conteos.set(sentencia.name.text, (conteos.get(sentencia.name.text) ?? 0) + 1);
    }
  }
  return new Set([...conteos].filter(([, cantidad]) => cantidad === 1).map(([nombre]) => nombre));
}

function esNombreDeclaracionONombreDePropiedad(node: ts.Identifier): boolean {
  const padre = node.parent;
  if (ts.isVariableDeclaration(padre) && padre.name === node) return true;
  if ((ts.isFunctionDeclaration(padre) || ts.isFunctionExpression(padre)) && padre.name === node) return true;
  if (ts.isParameter(padre) && padre.name === node) return true;
  if (ts.isBindingElement(padre) && (padre.name === node || padre.propertyName === node)) return true;
  if (ts.isPropertyAccessExpression(padre) && padre.name === node) return true;
  if ((ts.isPropertyAssignment(padre) || ts.isMethodDeclaration(padre) || ts.isPropertyDeclaration(padre)) &&
      padre.name === node) return true;
  if (ts.isLabeledStatement(padre) && padre.label === node) return true;
  if ((ts.isBreakStatement(padre) || ts.isContinueStatement(padre)) && padre.label === node) return true;
  return false;
}

function nombreMiembro(node: ts.PropertyAccessExpression | ts.ElementAccessExpression): string | null {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  const argumento = node.argumentExpression;
  if (argumento && (ts.isStringLiteral(argumento) || ts.isNoSubstitutionTemplateLiteral(argumento))) {
    return argumento.text;
  }
  return null;
}

function esObjetivoDeAsignacion(node: ts.Node): boolean {
  const padre = node.parent;
  if (!ts.isBinaryExpression(padre) || padre.left !== node) return false;
  return padre.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    padre.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
}

function nombresObjetivo(node: ts.Node): string[] {
  if (ts.isIdentifier(node)) return [node.text];
  if (ts.isParenthesizedExpression(node)) return nombresObjetivo(node.expression);
  if (ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
    return nombresObjetivo(node.left);
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.flatMap((elemento) => ts.isOmittedExpression(elemento)
      ? []
      : nombresObjetivo(elemento));
  }
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.flatMap((propiedad) => {
      if (ts.isShorthandPropertyAssignment(propiedad)) return [propiedad.name.text];
      if (ts.isPropertyAssignment(propiedad)) return nombresObjetivo(propiedad.initializer);
      if (ts.isSpreadAssignment(propiedad)) return nombresObjetivo(propiedad.expression);
      return [];
    });
  }
  if (ts.isSpreadElement(node)) return nombresObjetivo(node.expression);
  return [];
}

function raizDeMiembro(
  node: ts.PropertyAccessExpression | ts.ElementAccessExpression,
): string | null {
  let actual: ts.Expression = node.expression;
  while (ts.isPropertyAccessExpression(actual) || ts.isElementAccessExpression(actual)) {
    actual = actual.expression;
  }
  return ts.isIdentifier(actual) ? actual.text : null;
}

function raicesMiembroObjetivo(node: ts.Node): string[] {
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    const raiz = raizDeMiembro(node);
    return raiz ? [raiz] : [];
  }
  if (ts.isParenthesizedExpression(node)) return raicesMiembroObjetivo(node.expression);
  if (ts.isBinaryExpression(node)) return raicesMiembroObjetivo(node.left);
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.flatMap((elemento) => ts.isOmittedExpression(elemento)
      ? []
      : raicesMiembroObjetivo(elemento));
  }
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.flatMap((propiedad) => {
      if (ts.isPropertyAssignment(propiedad)) return raicesMiembroObjetivo(propiedad.initializer);
      if (ts.isSpreadAssignment(propiedad)) return raicesMiembroObjetivo(propiedad.expression);
      return [];
    });
  }
  if (ts.isSpreadElement(node)) return raicesMiembroObjetivo(node.expression);
  return [];
}

function stringLiteral(node: ts.Expression | undefined): string | null {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

function esHasOwnDictKey(node: ts.Expression): boolean {
  return ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'Object' &&
    node.expression.name.text === 'hasOwn' && node.arguments.length === 2 &&
    ts.isIdentifier(node.arguments[0]) && node.arguments[0].text === 'dict' &&
    ts.isIdentifier(node.arguments[1]) && node.arguments[1].text === 'key';
}

function lecturaDictDominadaPorHasOwn(node: ts.ElementAccessExpression): boolean {
  let hijo: ts.Node = node;
  let padre: ts.Node | undefined = node.parent;
  while (padre && !ts.isFunctionLike(padre) && !ts.isSourceFile(padre)) {
    if (ts.isIfStatement(padre) && hijo === padre.thenStatement && esHasOwnDictKey(padre.expression)) {
      return true;
    }
    hijo = padre;
    padre = padre.parent;
  }
  return false;
}

function reglaDeMiembro(nombre: string): string {
  if (MIEMBROS_DOM_HTML.has(nombre)) return 'dom-html';
  if (MIEMBROS_RED_RUNTIME.has(nombre)) return 'red-runtime';
  if (MIEMBROS_NAVEGACION.has(nombre)) return 'navegacion-recursos';
  return 'capacidad-no-adjudicada';
}

export function evaluarPoliticaScriptLanding(
  entrada: EntradaPoliticaScriptLanding,
): FallaPoliticaScriptLanding[] {
  const source = ts.createSourceFile(
    entrada.artefacto,
    entrada.codigo,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.JS,
  );
  const diagnosticos = diagnosticosDeParseo(source);
  if (diagnosticos.length > 0) {
    return diagnosticos.map((diagnostico) => {
      const inicio = diagnostico.start ?? 0;
      const { line, character } = source.getLineAndCharacterOfPosition(inicio);
      return {
        artefacto: entrada.artefacto,
        regla: 'parseo-fail-closed',
        mensaje: ts.flattenDiagnosticMessageText(diagnostico.messageText, '\n'),
        linea: line + 1,
        columna: character + 1,
      };
    });
  }

  const declarados = nombresDeclarados(source);
  const origenesComputados = origenesComputadosAcreditados(source);
  const funcionesLocales = funcionesLocalesAcreditadas(source);
  const fallas: FallaPoliticaScriptLanding[] = [];
  const agregar = (node: ts.Node, regla: string, mensaje: string): void => {
    const { linea, columna } = posicion(source, node);
    fallas.push({ artefacto: entrada.artefacto, regla, mensaje, linea, columna });
  };

  const visitar = (node: ts.Node): void => {
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node)) && !ts.isIdentifier(node.name)) {
      agregar(node, 'binding-no-adjudicado', 'destructuring no está permitido en el script inline');
    }
    if (ts.isCatchClause(node) && node.variableDeclaration &&
        !ts.isIdentifier(node.variableDeclaration.name)) {
      agregar(node, 'binding-no-adjudicado', 'destructuring no está permitido en `catch`');
    }
    if (ts.isCatchClause(node) && node.variableDeclaration &&
        ts.isIdentifier(node.variableDeclaration.name) &&
        esNombreProtegido(node.variableDeclaration.name.text)) {
      agregar(node.variableDeclaration.name, 'origen-no-acreditado',
        `${node.variableDeclaration.name.text} no se puede sombrear en catch`);
    }
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node)) && ts.isIdentifier(node.name) &&
        FUNCIONES_LOCALES_PERMITIDAS.has(node.name.text)) {
      agregar(node, 'origen-no-acreditado',
        `${node.name.text} sólo puede ser una función top-level adjudicada`);
    }
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node)) && ts.isIdentifier(node.name) &&
        GLOBALES_RECEIVER_PROTEGIDOS.has(node.name.text)) {
      agregar(node.name, 'origen-no-acreditado',
        `${node.name.text} es un receiver global adjudicado y no se puede sombrear`);
    }
    if (ts.isParameter(node) && ts.isIdentifier(node.name) &&
        ['dict', 'I18N', 'lang', 'key'].includes(node.name.text)) {
      agregar(node, 'origen-no-acreditado', `${node.name.text} no puede entrar como parámetro`);
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) &&
        ['dict', 'I18N', 'lang', 'key'].includes(node.name.text) &&
        !origenesComputados.has(node.name.text)) {
      agregar(node, 'origen-no-acreditado',
        `${node.name.text} no tiene el único origen estructural adjudicado`);
    }
    if (ts.isBinaryExpression(node) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
      const escritos = nombresObjetivo(node.left);
      if (escritos.length > 1 || ts.isObjectLiteralExpression(node.left) ||
          ts.isArrayLiteralExpression(node.left) || ts.isParenthesizedExpression(node.left)) {
        agregar(node.left, 'binding-no-adjudicado', 'destructuring por asignación no está permitido');
      }
      for (const nombre of escritos.filter(esNombreProtegido)) {
        agregar(node.left, 'origen-no-acreditado', `${nombre} no se puede reasignar`);
      }
      for (const raiz of raicesMiembroObjetivo(node.left)
        .filter((nombre) => nombre === 'I18N' || nombre === 'dict')) {
        agregar(node.left, 'origen-no-acreditado', `${raiz} es un árbol de datos inmutable`);
      }
    }
    if (ts.isForOfStatement(node) || ts.isForInStatement(node)) {
      agregar(node, 'control-flow-no-adjudicado', '`for…of/in` no se usa en el script inline');
      for (const nombre of nombresObjetivo(node.initializer).filter(esNombreProtegido)) {
        agregar(node.initializer, 'origen-no-acreditado',
          `${nombre} no se puede reasignar en un bucle`);
      }
      for (const raiz of raicesMiembroObjetivo(node.initializer)
        .filter((nombre) => nombre === 'I18N' || nombre === 'dict')) {
        agregar(node.initializer, 'origen-no-acreditado',
          `${raiz} es un árbol de datos inmutable`);
      }
    }
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
        (node.operator === ts.SyntaxKind.PlusPlusToken ||
          node.operator === ts.SyntaxKind.MinusMinusToken)) {
      if (ts.isIdentifier(node.operand) && esNombreProtegido(node.operand.text)) {
        agregar(node.operand, 'origen-no-acreditado', `${node.operand.text} no se puede modificar`);
      }
      for (const raiz of raicesMiembroObjetivo(node.operand)
        .filter((nombre) => nombre === 'I18N' || nombre === 'dict')) {
        agregar(node.operand, 'origen-no-acreditado', `${raiz} es un árbol de datos inmutable`);
      }
    }
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) ||
        ts.isClassDeclaration(node) || ts.isClassExpression(node)) && node.name &&
        esNombreProtegido(node.name.text)) {
      const esFuncionTopLevelAcreditada = ts.isFunctionDeclaration(node) &&
        ts.isSourceFile(node.parent) && funcionesLocales.has(node.name.text);
      if (!esFuncionTopLevelAcreditada) {
        agregar(node.name, 'origen-no-acreditado',
          `${node.name.text} sombrea una autoridad estructural adjudicada`);
      }
    }
    if (ts.isWithStatement(node)) {
      agregar(node, 'scope-dinamico', '`with` impide resolver el origen de los nombres');
    }
    if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node) ||
        ts.isExportDeclaration(node) || ts.isExportAssignment(node)) {
      agregar(node, 'modulos', 'la landing inline no admite imports ni exports');
    }

    if (ts.isNewExpression(node)) {
      agregar(node, 'red-runtime', '`new` no es una capacidad adjudicada en este script');
    }

    if (ts.isTaggedTemplateExpression(node)) {
      agregar(node, 'capacidad-no-adjudicada', 'los tagged templates no están adjudicados');
    }

    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        agregar(node, 'modulos', `import() dinámico no está permitido`);
      } else if (ts.isIdentifier(node.expression)) {
        if (!funcionesLocales.has(node.expression.text)) {
          agregar(node, 'capacidad-no-adjudicada',
            `función local no adjudicada: ${node.expression.text}`);
        }
      } else if (ts.isPropertyAccessExpression(node.expression)) {
        const nombre = node.expression.name.text;
        if (!LLAMADAS_PERMITIDAS.has(nombre)) {
          agregar(node, reglaDeMiembro(nombre), `llamada no permitida: .${nombre}()`);
        }
        if (nombre === 'setAttribute') {
          const atributo = stringLiteral(node.arguments[0]);
          if (!atributo || !ATRIBUTOS_PERMITIDOS.has(atributo)) {
            agregar(node, 'navegacion-recursos',
              `setAttribute sólo admite ${[...ATRIBUTOS_PERMITIDOS].join(', ')}`);
          }
        }
        if (nombre === 'addEventListener') {
          const evento = stringLiteral(node.arguments[0]);
          if (!evento || !EVENTOS_PERMITIDOS.has(evento)) {
            agregar(node, 'capacidad-no-adjudicada',
              `evento no adjudicado: ${evento ?? '<dinámico>'}`);
          }
        }
        if (nombre === 'getItem' || nombre === 'setItem') {
          const clave = stringLiteral(node.arguments[0]);
          if (clave !== CLAVE_STORAGE) {
            agregar(node, 'storage', `clave de storage no permitida: ${clave ?? '<dinámica>'}`);
          }
        }
        const receptoresExactos = RECEPTORES_EXACTOS[nombre];
        const receptor = node.expression.expression.getText(source);
        if (!receptoresExactos || !receptoresExactos.includes(receptor)) {
          agregar(node, 'origen-no-acreditado',
            `.${nombre} no está adjudicado sobre ${receptor}`);
        }
      } else if (ts.isElementAccessExpression(node.expression)) {
        agregar(node, 'capacidad-no-adjudicada',
          'una llamada computada no permite adjudicar qué capacidad ejecuta');
      } else {
        agregar(node, 'capacidad-no-adjudicada', 'forma de llamada no adjudicada');
      }
    }

    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const nombre = nombreMiembro(node);
      if (nombre !== null && !MIEMBROS_PERMITIDOS.has(nombre)) {
        agregar(node, reglaDeMiembro(nombre), `miembro no permitido: ${nombre}`);
      }
      if (esObjetivoDeAsignacion(node)) {
        const raiz = raizDeMiembro(node);
        if (raiz === 'I18N' || raiz === 'dict') {
          agregar(node, 'origen-no-acreditado', `${raiz} es un árbol de datos inmutable`);
        }
        if (nombre === null) {
          agregar(node, 'navegacion-recursos',
            'una escritura computada no permite acreditar el destino');
        } else if (!ESCRITURAS_PERMITIDAS.has(nombre)) {
          agregar(node, reglaDeMiembro(nombre), `escritura no permitida: ${nombre}`);
        }
      } else if (nombre !== null && LLAMADAS_PERMITIDAS.has(nombre) &&
          !(ts.isCallExpression(node.parent) && node.parent.expression === node)) {
        agregar(node, 'origen-no-acreditado',
          `.${nombre} sólo puede usarse como llamada directa con argumentos inspeccionados`);
      } else if (ts.isElementAccessExpression(node) && nombre === null) {
        const base = ts.isIdentifier(node.expression) ? node.expression.text : null;
        const argumento = node.argumentExpression && ts.isIdentifier(node.argumentExpression)
          ? node.argumentExpression.text
          : null;
        const argumentoEsperado = base === 'I18N' ? 'lang' : base === 'dict' ? 'key' : null;
        if (!base || !LECTURAS_COMPUTADAS_PERMITIDAS.has(base) ||
            !origenesComputados.has(base) || argumento !== argumentoEsperado ||
            !argumento || !origenesComputados.has(argumento)) {
          agregar(node, 'capacidad-no-adjudicada',
            'la lectura computada no pertenece al diccionario adjudicado');
        } else if (base === 'dict' && !lecturaDictDominadaPorHasOwn(node)) {
          agregar(node, 'origen-no-acreditado',
            'dict[key] sólo se puede leer bajo Object.hasOwn(dict, key)');
        }
      }
    }

    if (ts.isIdentifier(node) && !esNombreDeclaracionONombreDePropiedad(node)) {
      const nombre = node.text;
      const reglaProhibida = GLOBALES_SIEMPRE_PROHIBIDOS[nombre];
      if (reglaProhibida) {
        agregar(node, reglaProhibida, `global no permitido: ${nombre}`);
      } else if (GLOBALES_RED_RUNTIME.has(nombre) || nombre === 'location') {
        const regla = GLOBALES_RED_RUNTIME.has(nombre)
          ? 'red-runtime'
          : 'navegacion-recursos';
        agregar(node, regla, `global no permitido: ${nombre}`);
      } else if (!declarados.has(nombre) && !GLOBALES_PERMITIDOS.has(nombre)) {
        agregar(node, 'capacidad-no-adjudicada', `global no permitido: ${nombre}`);
      }
    }

    ts.forEachChild(node, visitar);
  };
  visitar(source);
  return fallas;
}

function nombrePropiedadLiteral(nombre: ts.PropertyName): string | null {
  if (ts.isIdentifier(nombre) || ts.isStringLiteral(nombre) || ts.isNumericLiteral(nombre)) {
    return nombre.text;
  }
  return null;
}

function leerLiteral(node: ts.Expression, artefacto: string): unknown {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isObjectLiteralExpression(node)) {
    const salida: Record<string, unknown> = {};
    for (const propiedad of node.properties) {
      if (!ts.isPropertyAssignment(propiedad)) {
        throw new Error(`${artefacto}: el objeto no es un literal pasivo; no se va a ejecutar`);
      }
      const nombre = nombrePropiedadLiteral(propiedad.name);
      if (nombre === null || nombre === '__proto__' || nombre === 'constructor' ||
          nombre === 'prototype' || Object.hasOwn(salida, nombre)) {
        throw new Error(`${artefacto}: clave literal inválida o duplicada; no se va a ejecutar`);
      }
      salida[nombre] = leerLiteral(propiedad.initializer, artefacto);
    }
    return salida;
  }
  throw new Error(`${artefacto}: la constante no es un literal pasivo; no se va a ejecutar`);
}

/**
 * Extrae una constante de objetos/strings desde AST. No usa `eval`, `vm` ni
 * importa el snippet; cualquier expresión ejecutable se rechaza.
 */
export function leerObjetoLiteralConstante(
  codigo: string,
  nombre: string,
  artefacto: string,
): unknown {
  const source = ts.createSourceFile(
    artefacto,
    codigo,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.JS,
  );
  const diagnosticos = diagnosticosDeParseo(source);
  if (diagnosticos.length > 0) {
    throw new Error(`${artefacto}: el script no parsea; no se va a ejecutar`);
  }
  let inicializador: ts.Expression | null = null;
  const visitar = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) &&
        node.name.text === nombre && node.initializer) {
      if (inicializador !== null) {
        throw new Error(`${artefacto}: ${nombre} está declarada más de una vez`);
      }
      inicializador = node.initializer;
    }
    ts.forEachChild(node, visitar);
  };
  visitar(source);
  if (inicializador === null) throw new Error(`${artefacto}: no se encontró la constante ${nombre}`);
  return leerLiteral(inicializador, artefacto);
}
