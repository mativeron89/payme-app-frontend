import { describe, expect, it } from 'vitest';
import ts from 'typescript';

/**
 * 🔴 P34 · CENSO DE LAS SUPERFICIES DE LA PANTALLA DE PAGO — y por qué la
 * versión anterior de este censo estaba MAL, que es lo que hay que leer.
 *
 * ⚠️ **El código productivo NO cambia en este commit.** Codex reauditó `d43db12`
 * y no encontró defecto funcional: el bloqueo fue de EVIDENCIA. El censo que
 * vivía en `cardFieldVentana.test.ts` **no detectaba la regresión que decía
 * detectar**, y lo probó con cuatro sondas que quedaron las cuatro verdes:
 * borrarle el `disabled` al botón de mesero, al checkbox de guardar tarjeta y
 * al selector de propina, y agregar una superficie interactiva nueva sin
 * guarda.
 *
 * 🔴 **LA CAUSA, que es la clase madre y no un descuido puntual: el censo
 * construía su universo buscando `disabled={…}`.** O sea que enumeraba una
 * PROYECCIÓN de la población, no la población. Cuando el mutante borra el prop,
 * la superficie **desaparece del censo** en vez de aparecer como falta — el
 * oráculo no ve un incumplimiento, ve un conjunto más chico. Y el control
 * positivo era `todos.length > 8`: de doce a once seguía verde.
 *
 * Se sumaban tres agravantes, cada uno suficiente solo:
 *   · el recorte de la región terminaba en un COMENTARIO (`// ─── Detalle`) que
 *     el propio helper borraba antes de buscarlo, así que llegaba hasta EOF;
 *   · las anclas «por identidad» miraban ±900 caracteres alrededor y **aceptaban
 *     la guarda de un vecino**;
 *   · el E2E no observa mesero, checkbox ni píldoras: corre en mock y esos
 *     estados no se alcanzan.
 *
 * **Cómo se arregla, punto por punto:**
 *   ① la población se DERIVA de las superficies interactuables —los controles
 *      del DOM más los componentes que DECLARAN un prop `disabled` en su propio
 *      tipo de props—, nunca de los `disabled` ya escritos en el llamador. Un
 *      prop borrado deja la superficie EN el censo, sin guarda, y eso es rojo;
 *   ② cada guarda se lee del ATRIBUTO PROPIO del elemento, por AST. No hay
 *      ventanas de caracteres: un vecino no puede prestar su guarda;
 *   ③ las excepciones se nombran POR IDENTIDAD —por su handler— y cada una
 *      tiene que casar con EXACTAMENTE UN elemento: una excepción que dejó de
 *      corresponder pone el test rojo en vez de seguir tapando;
 *   ④ el control positivo es de PRESENCIA y por identidad: cada superficie
 *      nombrada tiene que estar en la población. No hay umbrales de conteo.
 *
 * ⚠️ **Sigue siendo acreditación DE FUENTE**, y se declara igual que antes: el
 * campo de Stripe no monta en la suite mock y varios de estos estados no se
 * alcanzan en el navegador. Esto verifica el CABLEADO, no la conducta.
 */

// ── El árbol, sin los tests: la resolución de componentes mira código que
//    corre, no oráculos. ────────────────────────────────────────────────────
const FUENTES = import.meta.glob(['/src/**/*.ts', '/src/**/*.tsx', '!/src/**/*.test.ts', '!/src/**/*.test.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const ARBOL: Record<string, ts.SourceFile> = Object.fromEntries(
  Object.entries(FUENTES).map(([ruta, texto]) => [
    ruta,
    ts.createSourceFile(ruta, texto, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX),
  ]),
);

const PANTALLA = ARBOL['/src/screens/MesaScreen.tsx']!;

/** Controles del DOM que se deshabilitan por atributo propio del HTML. */
const CONTROLES_HTML = ['button', 'input', 'select', 'textarea'];

/**
 * Los miembros de PRIMER NIVEL de un tipo de props.
 *
 * De primer nivel a propósito: `AppBottomBar` tiene un `disabled` ANIDADO
 * dentro de `center`, y no es un prop `disabled` del componente — su CTA se
 * acredita aparte (P23-AF-04). Un `includes('disabled')` sobre el texto lo
 * habría metido en la población por la razón equivocada.
 *
 * Devuelve `null` cuando NO puede resolver: eso es una población que no se
 * puede cerrar, y el test la denuncia en vez de asumir que no hay `disabled`.
 */
function miembrosDeTipo(
  tipo: ts.TypeNode | undefined,
  sf: ts.SourceFile,
  visto = new Set<string>(),
): string[] | null {
  if (!tipo) return [];
  if (ts.isTypeLiteralNode(tipo)) return tipo.members.map((m) => m.name?.getText(sf) ?? '');
  if (ts.isIntersectionTypeNode(tipo)) {
    const partes = tipo.types.map((t) => miembrosDeTipo(t, sf, visto));
    return partes.some((p) => p === null) ? null : (partes as string[][]).flat();
  }
  if (ts.isTypeReferenceNode(tipo)) {
    const nombre = tipo.typeName.getText(sf);
    if (visto.has(nombre)) return [];
    visto.add(nombre);
    for (const fuente of Object.values(ARBOL)) {
      let hallado: string[] | null | undefined;
      fuente.forEachChild((n) => {
        if (hallado !== undefined) return;
        if (ts.isInterfaceDeclaration(n) && n.name.text === nombre) {
          let miembros = n.members.map((m) => m.name?.getText(fuente) ?? '');
          for (const clausula of n.heritageClauses ?? []) {
            for (const padre of clausula.types) {
              if (!ts.isIdentifier(padre.expression)) continue;
              const heredados = miembrosDeTipo(
                ts.factory.createTypeReferenceNode(padre.expression.text),
                fuente,
                visto,
              );
              if (heredados) miembros = miembros.concat(heredados);
            }
          }
          hallado = miembros;
        }
        if (ts.isTypeAliasDeclaration(n) && n.name.text === nombre) {
          hallado = miembrosDeTipo(n.type, fuente, visto);
        }
      });
      if (hallado !== undefined) return hallado;
    }
    return null;
  }
  return null;
}

/** Los props que DECLARA un componente, buscándolo por nombre en todo el árbol. */
function propsDeclarados(nombre: string): string[] | null | undefined {
  for (const fuente of Object.values(ARBOL)) {
    let resultado: string[] | null | undefined;
    fuente.forEachChild((n) => {
      if (resultado !== undefined) return;
      if (ts.isFunctionDeclaration(n) && n.name?.text === nombre) {
        resultado = miembrosDeTipo(n.parameters[0]?.type, fuente);
      } else if (ts.isVariableStatement(n)) {
        for (const d of n.declarationList.declarations) {
          if (
            d.name.getText(fuente) === nombre &&
            d.initializer &&
            (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))
          ) {
            resultado = miembrosDeTipo(d.initializer.parameters[0]?.type, fuente);
          }
        }
      } else if (ts.isClassDeclaration(n) && n.name?.text === nombre) {
        resultado = miembrosDeTipo(n.heritageClauses?.[0]?.types?.[0]?.typeArguments?.[0], fuente);
      }
    });
    if (resultado !== undefined) return resultado;
  }
  return undefined;
}

interface Superficie {
  tag: string;
  linea: number;
  /** El valor del atributo `disabled` PROPIO del elemento, o `null` si no lo lleva. */
  guarda: string | null;
  /** Texto de los atributos, para identificar por handler. */
  atributos: string;
  /** Tags de los elementos JSX que lo contienen, y sus atributos. */
  ancestros: { tag: string; atributos: string }[];
}

/** Todo elemento JSX de un subárbol, con su cadena de ancestros JSX. */
function elementosJsx(raiz: ts.Node, sf: ts.SourceFile): Superficie[] {
  const salida: Superficie[] = [];
  const pila: { tag: string; atributos: string }[] = [];

  const atributosDe = (el: ts.JsxOpeningElement | ts.JsxSelfClosingElement) =>
    el.attributes.properties.map((p) => p.getText(sf)).join(' ');

  const registrar = (el: ts.JsxOpeningElement | ts.JsxSelfClosingElement) => {
    const propio = el.attributes.properties
      .filter(ts.isJsxAttribute)
      .find((a) => a.name.getText(sf) === 'disabled');
    salida.push({
      tag: el.tagName.getText(sf),
      linea: sf.getLineAndCharacterOfPosition(el.getStart(sf)).line + 1,
      guarda: propio ? (propio.initializer?.getText(sf) ?? 'true') : null,
      atributos: atributosDe(el),
      ancestros: [...pila],
    });
  };

  const recorrer = (n: ts.Node) => {
    if (ts.isJsxSelfClosingElement(n)) {
      registrar(n);
      n.forEachChild(recorrer);
      return;
    }
    if (ts.isJsxElement(n)) {
      registrar(n.openingElement);
      pila.push({ tag: n.openingElement.tagName.getText(sf), atributos: atributosDe(n.openingElement) });
      n.children.forEach(recorrer);
      // Los atributos del elemento abierto también contienen JSX (props como
      // `fallback={<div/>}`): se recorren fuera de la pila propia.
      pila.pop();
      n.openingElement.attributes.forEachChild(recorrer);
      return;
    }
    n.forEachChild(recorrer);
  };

  recorrer(raiz);
  return salida;
}

/** El nodo del `if (view === 'pay')`, ubicado por AST y no por un comentario. */
function bloqueDeLaVistaDePago(): ts.Node | null {
  let hallado: ts.Node | null = null;
  const buscar = (n: ts.Node) => {
    if (ts.isIfStatement(n) && n.expression.getText(PANTALLA) === "view === 'pay'") hallado = n;
    n.forEachChild(buscar);
  };
  buscar(PANTALLA);
  return hallado;
}

/** El cuerpo de una función declarada por nombre en la pantalla. */
function funcionDeLaPantalla(nombre: string): ts.Node | null {
  let hallado: ts.Node | null = null;
  const buscar = (n: ts.Node) => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === nombre) hallado = n;
    n.forEachChild(buscar);
  };
  buscar(PANTALLA);
  return hallado;
}

/**
 * La población: superficies INTERACTUABLES del subárbol.
 *
 * 🔴 Derivada de lo que la superficie ES, no de lo que ya tiene escrito. Un
 * `<button>` sigue siendo un botón después de que le borren el `disabled`.
 */
function poblacion(raiz: ts.Node): { superficies: Superficie[]; sinResolver: string[] } {
  const todos = elementosJsx(raiz, PANTALLA);
  const superficies: Superficie[] = [];
  const sinResolver: string[] = [];
  for (const s of todos) {
    if (CONTROLES_HTML.includes(s.tag)) {
      superficies.push(s);
      continue;
    }
    if (!/^[A-Z]/.test(s.tag)) continue;
    const props = propsDeclarados(s.tag);
    if (props === undefined || props === null) {
      sinResolver.push(`${s.tag} (línea ${s.linea})`);
      continue;
    }
    if (props.includes('disabled')) superficies.push(s);
  }
  return { superficies, sinResolver };
}

const enAlertDialog = (s: Superficie) =>
  s.ancestros.some((a) => a.atributos.includes('role="alertdialog"'));

describe('🔴 P34 · censo de superficies de la pantalla de pago', () => {
  const bloque = bloqueDeLaVistaDePago();

  it('🔴 la región se ubica por AST: el recorte anterior llegaba hasta EOF', () => {
    // El censo viejo cortaba en `// ─── Detalle`, un COMENTARIO que su propio
    // helper borraba antes de buscarlo: `indexOf` daba -1 y la región se comía
    // el resto del archivo. Un `if` es un nodo: tiene fin propio.
    expect(bloque, 'no se encontró el bloque `if (view === \'pay\')`').not.toBeNull();
    const fin = PANTALLA.getLineAndCharacterOfPosition(bloque!.getEnd()).line + 1;
    const total = PANTALLA.getLineAndCharacterOfPosition(PANTALLA.getEnd()).line + 1;
    expect(fin, 'la región llega al final del archivo: se está censando de más').toBeLessThan(total - 10);
  });

  it('🔴 toda superficie interactuable resuelve: la población se puede cerrar', () => {
    const { sinResolver } = poblacion(bloque!);
    expect(
      sinResolver,
      `componentes cuyos props no se pudieron resolver — el censo NO puede afirmar que no llevan \`disabled\`: ${sinResolver.join(' · ')}`,
    ).toEqual([]);
  });

  /**
   * 🔴 EL CENSO. La población son los controles del DOM más los componentes que
   * declaran `disabled` en SU PROPIO tipo de props: `TipSelector` y `CardField`.
   * Borrarles el prop en el llamador NO los saca de acá — que es exactamente lo
   * que la versión anterior no lograba.
   */
  it('🔴 NINGUNA superficie interactuable de la vista de pago queda sin el predicado', () => {
    const { superficies } = poblacion(bloque!);

    const EXCEPCIONES: ReadonlyArray<{ nombre: string; identidad: RegExp; guardaEsperada: RegExp }> = [
      // Los dos botones de reconciliación dependen de SU PROPIA operación en
      // vuelo, no de la ventana: son la salida del estado congelado, y taparlos
      // con el predicado los dejaría muertos justo cuando hacen falta.
      // Se nombran por su HANDLER, que es identidad y no forma.
      { nombre: 'reconciliación · consultar', identidad: /checkReconciliation\(\)/, guardaEsperada: /\breconciling\b/ },
      { nombre: 'reconciliación · desbloquear', identidad: /releaseAfterReconciliation\(\)/, guardaEsperada: /\breconciling\b/ },
    ];

    // Cada excepción tiene que corresponder a EXACTAMENTE UN elemento. Una
    // excepción que dejó de aplicar es una puerta abierta que nadie mira.
    const excepcionadas = new Set<Superficie>();
    for (const ex of EXCEPCIONES) {
      const casan = superficies.filter((s) => ex.identidad.test(s.atributos));
      expect(casan.length, `la excepción «${ex.nombre}» casa con ${casan.length} elementos, no con uno`).toBe(1);
      expect(
        casan[0]!.guarda ?? '',
        `la excepción «${ex.nombre}» ya no lleva su propia guarda`,
      ).toMatch(ex.guardaEsperada);
      excepcionadas.add(casan[0]!);
    }

    // Los diálogos de confirmación son la otra excepción, y es DERIVADA: sus
    // controles sólo existen como consecuencia de un intento de pago que la
    // puerta ya dejó pasar. Para que la zona no se agrande sola, los diálogos
    // se nombran por identidad y se exige que sean esos dos y nada más.
    const dialogos = elementosJsx(bloque!, PANTALLA).filter((s) =>
      s.atributos.includes('role="alertdialog"'),
    );
    expect(
      dialogos.map((d) => d.atributos.match(/aria-label=\{t\('([^']+)'\)\}/)?.[1] ?? '?').sort(),
      'cambió el conjunto de diálogos de confirmación: la excepción derivada ya no está acotada',
    ).toEqual(['Confirmar parte adicional', 'Confirmar propina']);

    const faltan = superficies
      .filter((s) => !excepcionadas.has(s) && !enAlertDialog(s))
      .filter((s) => !(s.guarda ?? '').includes('seleccionBloqueada'))
      .map((s) => `${s.tag}@${s.linea} → ${s.guarda === null ? 'SIN disabled' : s.guarda}`);

    expect(faltan, `superficies de pago sin el predicado unificado: ${faltan.join(' · ')}`).toEqual([]);
  });

  /**
   * 🔴 CONTROL POSITIVO — de PRESENCIA y por identidad, no por conteo.
   *
   * El anterior era `todos.length > 8`: con doce superficies, borrar una guarda
   * dejaba once y seguía verde. Éste exige que cada superficie nombrada esté
   * EN LA POBLACIÓN, identificada por su handler — que es lo que el mutante del
   * `disabled` no toca. Si una desaparece del árbol, esto la nombra; si pierde
   * la guarda, sigue en la población y la denuncia el censo de arriba.
   */
  it('🔴 las superficies nombradas están en la población, cada una por su identidad', () => {
    const { superficies } = poblacion(bloque!);
    const IDENTIDADES: ReadonlyArray<readonly [string, RegExp]> = [
      ['mesero', /setStaffId\(/],
      ['guardar esta tarjeta', /setSaveCard\(/],
      ['método tarjeta', /setPayType\('card'\)/],
      ['método saldo', /setPayType\('wallet'\)/],
      ['tarjeta guardada', /setCardChoice\(c\.id\)/],
      ['usar otra tarjeta', /setCardChoice\('new'\)/],
      ['campo de Stripe', /^CardField$/],
      ['selector de propina', /^TipSelector$/],
    ];
    const problemas: string[] = [];
    for (const [nombre, identidad] of IDENTIDADES) {
      const casan = superficies.filter((s) => identidad.test(s.atributos) || identidad.test(s.tag));
      if (casan.length !== 1) problemas.push(`${nombre}: ${casan.length} en la población, se esperaba 1`);
    }
    expect(problemas, problemas.join(' · ')).toEqual([]);
  });

  /**
   * El selector de propina es una función aparte —tiene que serlo, por el error
   * boundary— y sus píldoras viven adentro. Sin este censo, una píldora nueva
   * sin guarda no la ve nadie: el de arriba sólo mira el llamador.
   */
  it('🔴 dentro del selector de propina, ninguna píldora queda sin su prop', () => {
    const selector = funcionDeLaPantalla('TipSelector');
    expect(selector, 'desapareció la función TipSelector').not.toBeNull();
    const { superficies, sinResolver } = poblacion(selector!);
    expect(sinResolver).toEqual([]);

    const IDENTIDADES: ReadonlyArray<readonly [string, RegExp]> = [
      ['píldora de porcentaje', /mode: 'pct'/],
      ['píldora «Otro»', /mode: 'custom'/],
      ['monto propio', /onCustomChange\(/],
    ];
    for (const [nombre, identidad] of IDENTIDADES) {
      expect(
        superficies.filter((s) => identidad.test(s.atributos)).length,
        `${nombre} no está en la población del selector`,
      ).toBe(1);
    }

    const faltan = superficies
      .filter((s) => !/^\{disabled\}$/.test(s.guarda ?? ''))
      .map((s) => `${s.tag}@${s.linea} → ${s.guarda === null ? 'SIN disabled' : s.guarda}`);
    expect(faltan, `superficies del selector sin el prop \`disabled\`: ${faltan.join(' · ')}`).toEqual([]);
  });
});
