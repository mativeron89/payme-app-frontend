import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import {
  atributo,
  atributoLiteral,
  CONTROLES_HTML,
  elementosJsx,
  expresionDe,
  ATRIBUTOS_ACCIONABLES,
  esHandlerDeInteraccion,
  implicaVerdadero,
  parsear,
  propsDeclarados,
  ROLES_INTERACTIVOS,
  tieneSeamAnidado,
  type Arbol,
  type Superficie,
} from '../arnes/jsxGuardas';

/**
 * 🔴 P36 · CENSO DE LAS SUPERFICIES DE LA PANTALLA DE PAGO — tercera versión, y
 * las dos anteriores fallaron por la MISMA familia con dos caras distintas.
 *
 * ⚠️ **El código productivo nunca estuvo mal.** Las tres vueltas bloquearon la
 * EVIDENCIA, y por eso vale escribir las tres caídas juntas:
 *
 *   · **umbral** (P27) — «más de cinco coincidencias»: con doce superficies,
 *     quitarle la guarda a una dejaba once y seguía verde;
 *   · **proyección** (P34) — el universo se construía buscando `disabled={…}`,
 *     así que **borrar el prop sacaba la superficie del censo** en vez de
 *     denunciarla. El oráculo no veía un incumplimiento: veía un conjunto más
 *     chico, y un conjunto más chico no dispara nada;
 *   · **presencia** (P36) — se validaba que el atributo ESTUVIERA, no lo que
 *     DICE. `disabled={!seleccionBloqueada}` y `disabled={seleccionBloqueada &&
 *     false}` dejan el control **habilitado justo durante la ventana** y
 *     pasaban enteros. La excepción admitía `disabled={!reconciling}`.
 *
 * 🔴 **La lección común, y la única que hace falta recordar: un oráculo tiene
 * que DEMOSTRAR lo que promete.** Contar no es enumerar; enumerar los que ya
 * cumplen no es enumerar la población; y que el atributo exista no es que el
 * control quede cerrado.
 *
 * **Qué hace esta versión, y por qué cada cosa:**
 *   ① la población se DERIVA de lo que la superficie ES —controles del DOM,
 *      componentes que DECLARAN `disabled`, y elementos crudos accionables por
 *      rol o handler—, nunca de los `disabled` ya escritos;
 *   ② de cada superficie se PRUEBA la implicación `seleccionBloqueada ⇒
 *      disabled`, por tabla de verdad completa sobre las hojas libres. No hay
 *      lista de formas malas: **lo que no se puede demostrar, no pasa**;
 *   ③ las excepciones se atan a ATRIBUTOS EXACTOS por AST, nunca a substrings;
 *   ④ todo lo irresoluble —herencia calificada, tipos externos, parámetros sin
 *      anotar— se denuncia por nombre en vez de asumirse inocente.
 *
 * ⚠️ **Sigue siendo acreditación DE FUENTE, y se declara:** `CardField` no monta
 * en la suite mock y varios de estos estados no se alcanzan en el navegador.
 * Verifica el CABLEADO y la SEMÁNTICA de las guardas, no la conducta.
 */

const FUENTES = import.meta.glob(
  ['/src/**/*.ts', '/src/**/*.tsx', '!/src/**/*.test.ts', '!/src/**/*.test.tsx'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

const ARBOL: Arbol = parsear(FUENTES);
const PANTALLA = ARBOL['/src/screens/MesaScreen.tsx']!;

/** El predicado unificado que TODA superficie de pago tiene que respetar. */
const GUARDA = 'seleccionBloqueada';

type Clase = 'accionable' | 'seam-anidado' | 'interactivo-sin-seam' | 'inerte';

interface Censo {
  /** Deben PROBAR la implicación. */
  accionables: Superficie[];
  /** Llevan el seam en otro lado o no lo tienen: exigen excepción nombrada. */
  fronteras: { s: Superficie; clase: Clase }[];
  /** No se puede decidir qué son: rojo, con el motivo. */
  indecidibles: string[];
}

const ROL_INTERACTIVO = (s: Superficie) => {
  const rol = atributoLiteral(s, 'role');
  return !!rol && ROLES_INTERACTIVOS.includes(rol);
};
const TIENE_HANDLER = (s: Superficie) =>
  s.atributos.some((a) => esHandlerDeInteraccion(a.name.getText(s.sf)));
const TIENE_ATRIBUTO_ACCIONABLE = (s: Superficie) =>
  s.atributos.some((a) => ATRIBUTOS_ACCIONABLES.includes(a.name.getText(s.sf)));

/**
 * 🔴 P40-② · LA REGLA SE INVIRTIÓ, y ése es el arreglo entero.
 *
 * Las tres versiones anteriores preguntaban **«¿está en mi lista de cosas
 * interactivas?»**, y por eso sobrevivían `<a href>`, `onDoubleClick`, un spread
 * que aporta `role`, y un componente con `onActivate`. **Una lista de lo
 * incluido falla ABIERTA:** lo que no está, no se mira.
 *
 * Ahora se pregunta al revés: **¿se puede DEMOSTRAR que este elemento es
 * inerte?** Si no, entra. Y lo que no se puede decidir —un spread que podría
 * aportar interacción o la guarda misma, un componente cuyos props no resuelven—
 * **no se supone inocente: se denuncia**.
 */
/**
 * ⚠️ **EL LÍMITE DE CUALQUIER CENSO DE JSX, espejado acá porque es acá donde se
 * decide** — estaba dicho en el test y no en la función, que es donde lo busca
 * el que quiera saber hasta dónde llega esta clasificación.
 *
 * 🔴 **Un componente que no declara NINGÚN prop y renderiza un botón adentro es
 * invisible para esto, y no hay forma de arreglarlo desde el JSX del llamador.**
 * `<MiBoton />` sin props no ofrece nada que mirar: ni handler, ni rol, ni
 * `disabled`, ni un tipo que consultar. El control existe, se puede tocar, y
 * **quedaría clasificado INERTE con toda razón aparente**.
 *
 * Lo que hoy lo contiene, y conviene decirlo para no exagerar el agujero: si
 * ese componente vive en el árbol, **su propio subárbol tiene el `<button>`**, y
 * el censo se puede correr sobre él —como ya se hace con `TipSelector`—. Lo que
 * no existe es el paso automático: **hay que acordarse de censarlo**, y eso es
 * exactamente la clase de mantenimiento a mano que este archivo viene evitando.
 *
 * **Condición de disparo:** si aparece en la vista de pago un componente propio
 * sin props que encapsule un control, este censo lo va a dar por inerte. La
 * salida no es una lista de componentes «a revisar» —volveríamos al defecto que
 * costó cuatro vueltas— sino censar los subárboles derivándolos: los componentes
 * locales que la región usa, no los que alguien anote.
 */
function clasificar(s: Superficie): { clase: Clase; motivo?: string } {
  // Un spread puede traer `role`, un handler o el propio `disabled`. No hay
  // forma de saberlo leyendo esto, así que no se decide: se denuncia.
  if (s.tieneSpread) return { clase: 'inerte', motivo: 'lleva un spread: podría aportar interacción o la guarda' };

  if (/^[A-Z]/.test(s.tag)) {
    const props = propsDeclarados(s.tag, ARBOL);
    if (props === undefined) return { clase: 'inerte', motivo: 'no se encontró su declaración' };
    if (props === null) return { clase: 'inerte', motivo: 'sus props no se pudieron resolver (¿herencia calificada o tipo externo?)' };
    if (props.includes('disabled') || TIENE_ATRIBUTO_ACCIONABLE(s)) return { clase: 'accionable' };
    if (tieneSeamAnidado(s.tag, ARBOL)) return { clase: 'seam-anidado' };
    // 🔴 El CALL SITE también es evidencia, y omitirlo dejaba vivo un mutante:
    // un componente que recibe `onActivate` sin declararlo —porque renderiza un
    // botón adentro, o porque el prop se agregó y el tipo no— quedaba INERTE
    // mirando sólo sus props declarados. Se mira la unión de las dos fuentes.
    if (props.some((n) => esHandlerDeInteraccion(n)) || TIENE_HANDLER(s) || ROL_INTERACTIVO(s)) {
      return { clase: 'interactivo-sin-seam' };
    }
    return { clase: 'inerte' };
  }

  if (CONTROLES_HTML.includes(s.tag)) return { clase: 'accionable' };
  if (TIENE_ATRIBUTO_ACCIONABLE(s) || ROL_INTERACTIVO(s) || TIENE_HANDLER(s)) return { clase: 'accionable' };
  return { clase: 'inerte' };
}

function censar(raiz: ts.Node): Censo {
  const accionables: Superficie[] = [];
  const fronteras: { s: Superficie; clase: Clase }[] = [];
  const indecidibles: string[] = [];
  for (const s of elementosJsx(raiz, PANTALLA)) {
    const r = clasificar(s);
    if (r.motivo) { indecidibles.push(`${s.tag}@${s.linea}: ${r.motivo}`); continue; }
    if (r.clase === 'accionable') accionables.push(s);
    else if (r.clase !== 'inerte') fronteras.push({ s, clase: r.clase });
  }
  return { accionables, fronteras, indecidibles };
}

function bloqueDeLaVistaDePago(): ts.Node | null {
  let hallado: ts.Node | null = null;
  const buscar = (n: ts.Node) => {
    if (ts.isIfStatement(n) && n.expression.getText(PANTALLA) === "view === 'pay'") hallado = n;
    n.forEachChild(buscar);
  };
  buscar(PANTALLA);
  return hallado;
}

function funcionDeLaPantalla(nombre: string): ts.Node | null {
  let hallado: ts.Node | null = null;
  const buscar = (n: ts.Node) => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === nombre) hallado = n;
    n.forEachChild(buscar);
  };
  buscar(PANTALLA);
  return hallado;
}

/** ¿Esta superficie prueba que se cierra cuando la ventana se abre? */
function pruebaLaGuarda(s: Superficie, guarda: string): { ok: boolean; motivo: string } {
  if (!s.guarda) return { ok: false, motivo: 'SIN atributo `disabled`' };
  const init = s.guarda.initializer;
  // `<button disabled>` sin valor es `true` constante: cierra siempre.
  if (!init) return { ok: true, motivo: 'atributo booleano sin valor' };
  if (!ts.isJsxExpression(init) || !init.expression) {
    return { ok: false, motivo: `valor no evaluable: ${init.getText(s.sf)}` };
  }
  const r = implicaVerdadero(init.expression, s.sf, { [guarda]: true });
  return { ok: r.probada, motivo: r.motivo };
}

const enAlertDialog = (s: Superficie) =>
  s.ancestros.some((a) => {
    const rol = a.attributes.properties
      .filter(ts.isJsxAttribute)
      .find((x) => x.name.getText(PANTALLA) === 'role');
    return !!rol?.initializer && ts.isStringLiteral(rol.initializer) && rol.initializer.text === 'alertdialog';
  });

/**
 * 🔴 EL CASO DISCRIMINANTE — el que separa la regla INVERTIDA de una lista
 * engordada, que es lo único que prueba que el arreglo fue el grande.
 *
 * Los mutantes que Codex nombró (`<a href>`, `onDoubleClick`) los atraparía
 * también un censo con las listas más largas: alcanzaba con agregar `a` y
 * `onDoubleClick`. **No discriminan.** Los de acá sí, porque **ninguna lista
 * escrita hoy los puede contener**:
 *
 *   · un handler que NO EXISTE — `onActivar`, inventado en este test. Una lista
 *     de handlers permitidos nunca lo va a tener, por definición; la regla
 *     invertida lo toma porque **todo `on*` es interacción salvo los seis de
 *     ciclo de vida**;
 *   · un `spread`, que **no se puede clasificar en ninguna dirección**: podría
 *     aportar el `role`, el handler o la guarda misma. Una lista no tiene dónde
 *     ponerlo; sólo el fail-closed lo denuncia.
 *
 * ⭐ Y con su control negativo: un `<div>` decorativo tiene que seguir siendo
 * inerte. Sin eso, «todo es accionable» pasaría este test y sería inservible.
 */
function elementoSuelto(jsx: string): Superficie {
  const sf = ts.createSourceFile('d.tsx', `const _ = ${jsx};`, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);
  // 🔴 Las DOS veces `sf`: la primera es la raíz a recorrer y la segunda es el
  // archivo contra el que se leen los textos. Pasar `PANTALLA` en la segunda
  // —mi primer intento— devuelve basura: los nodos son de OTRO archivo y
  // `getText()` los recorta contra posiciones ajenas. El síntoma fue un
  // `onActivar` clasificado como inerte, o sea el test aprobando el defecto.
  const [uno] = elementosJsx(sf, sf);
  expect(uno, `no se parseó ${jsx}`).toBeTruthy();
  return uno!;
}

describe('🔴 la regla INVERTIDA, y no una lista más larga', () => {
  it('🔴 un handler que NO EXISTE en ninguna lista entra igual', () => {
    // `onActivar` es inventado acá. Ninguna lista de handlers permitidos, por
    // larga que sea, lo puede contener — y ése es exactamente el punto.
    expect(clasificar(elementoSuelto('<div onActivar={f}>x</div>')).clase).toBe('accionable');
    expect(clasificar(elementoSuelto('<div onLoQueSea={f}>x</div>')).clase).toBe('accionable');
  });

  it('🔴 un spread NO se clasifica: se denuncia', () => {
    const r = clasificar(elementoSuelto('<div {...props}>x</div>'));
    expect(r.motivo, 'el spread pasó sin denunciarse').toMatch(/spread/);
  });

  it('⭐ CONTROL NEGATIVO · lo decorativo sigue siendo inerte', () => {
    // Sin esto, «clasificar todo como accionable» pasaría los dos casos de
    // arriba y el censo entero quedaría inservible por ruido.
    expect(clasificar(elementoSuelto('<div className="caption">x</div>')).clase).toBe('inerte');
    expect(clasificar(elementoSuelto('<span aria-hidden="true">▾</span>')).clase).toBe('inerte');
  });

  it('⭐ y los handlers de CICLO DE VIDA no convierten en control', () => {
    // La lista al revés tiene que ser corta y justificada: si `onAnimationEnd`
    // contara, el bloque de propina entero pasaría a exigir guarda propia.
    expect(clasificar(elementoSuelto('<div onAnimationEnd={f}>x</div>')).clase).toBe('inerte');
  });
});

describe('🔴 P36 · censo semántico de la pantalla de pago', () => {
  const bloque = bloqueDeLaVistaDePago();

  it('🔴 la región se ubica por AST, y no llega al final del archivo', () => {
    expect(bloque, "no se encontró el bloque `if (view === 'pay')`").not.toBeNull();
    const fin = PANTALLA.getLineAndCharacterOfPosition(bloque!.getEnd()).line + 1;
    const total = PANTALLA.getLineAndCharacterOfPosition(PANTALLA.getEnd()).line + 1;
    expect(fin, 'la región llega al final del archivo: se está censando de más').toBeLessThan(total - 10);
  });

  it('🔴 la población se puede CERRAR: nada quedó indecidible', () => {
    // Un spread, un tipo externo o un componente que no resuelve NO se suponen
    // inocentes: el censo dice que no puede decidir, y eso es rojo.
    const { indecidibles } = censar(bloque!);
    expect(
      indecidibles,
      `el censo NO puede afirmar nada sobre estos: ${indecidibles.join(' · ')}`,
    ).toEqual([]);
  });

  /**
   * 🔴 P40-② · LAS FRONTERAS INTERACTIVAS, ENUMERADAS UNA POR UNA.
   *
   * Codex nombró `AppHeaderFlow` y `AppBottomBar` como **omitidas sin
   * enumerar**: no son violaciones vigentes, pero el censo las daba por
   * inertes y **eso volvía falsa su exhaustividad**.
   *
   * Ahora entran solas —derivadas, no nombradas—: una porque declara un handler
   * de interacción sin ningún `disabled`, la otra porque su tipo de props lleva
   * el seam **anidado** dentro de `center`. Y cada una tiene que estar acá, con
   * su razón y con una aserción propia: **una excepción sin aserción es una
   * omisión con mejor letra**.
   */
  it('🔴 cada frontera interactiva está ENUMERADA, con su razón y su aserción', () => {
    const { fronteras } = censar(bloque!);

    const ESPERADAS: ReadonlyArray<{
      tag: string;
      clase: Clase;
      /** Por qué no lleva el predicado, y qué se afirma en su lugar. */
      afirmar: (s: Superficie) => void;
    }> = [
      {
        // La salida de la pantalla. 🔴 NUNCA se apaga, y no es un olvido: con
        // un pago congelado, apagar el «Volver a la mesa» dejaría a la persona
        // encerrada en el estado que menos se puede abandonar.
        tag: 'AppHeaderFlow',
        clase: 'interactivo-sin-seam',
        afirmar: (s) => {
          expect(atributo(s, 'onBack'), 'dejó de ser la salida de la pantalla').not.toBeNull();
          expect(atributo(s, 'disabled'), 'la salida NO puede llevar guarda: encerraría a la persona').toBeNull();
        },
      },
      {
        // El CTA. Su seam vive en `center.disabled` y su predicado es OTRO
        // —`journalPendiente || busy || …`— porque con un pago sin confirmar
        // el botón tiene que seguir vivo para REINTENTARLO. Lo que sí comparte
        // con las demás es cerrar durante la ventana del journal (P23-AF-04),
        // y eso se prueba acá con la misma maquinaria.
        tag: 'AppBottomBar',
        clase: 'seam-anidado',
        afirmar: (s) => {
          const centro = atributo(s, 'center')?.initializer;
          expect(centro && ts.isJsxExpression(centro) && centro.expression, 'desapareció el `center` del CTA').toBeTruthy();
          const obj = (centro as ts.JsxExpression).expression!;
          expect(ts.isObjectLiteralExpression(obj), 'el `center` dejó de ser un objeto literal: no se puede leer su seam').toBe(true);
          const prop = (obj as ts.ObjectLiteralExpression).properties
            .filter(ts.isPropertyAssignment)
            .find((x) => x.name.getText(PANTALLA) === 'disabled');
          expect(prop, 'el CTA se quedó SIN seam de apagado').toBeTruthy();
          const r = implicaVerdadero(prop!.initializer, PANTALLA, { journalPendiente: true });
          expect(r.probada, `el CTA no prueba cerrarse con el journal pendiente: ${r.motivo}`).toBe(true);
        },
      },
      {
        // No es un control: es el error boundary del selector de propina. Su
        // `onFail` no lo dispara una persona, lo dispara React al romperse el
        // subárbol. Apagarlo no significaría nada.
        tag: 'TipSelectorBoundary',
        clase: 'interactivo-sin-seam',
        afirmar: (s) => {
          expect(atributo(s, 'onFail'), 'dejó de ser un boundary').not.toBeNull();
          expect(atributo(s, 'fallback'), 'un boundary sin fallback no protege nada').not.toBeNull();
        },
      },
    ];

    const sinEnumerar = fronteras
      .filter((f) => !ESPERADAS.some((e) => e.tag === f.s.tag))
      .map((f) => `${f.s.tag}@${f.s.linea} (${f.clase})`);
    expect(
      sinEnumerar,
      `fronteras interactivas SIN enumerar — el censo no puede afirmar exhaustividad: ${sinEnumerar.join(' · ')}`,
    ).toEqual([]);

    for (const e of ESPERADAS) {
      const casan = fronteras.filter((f) => f.s.tag === e.tag);
      expect(casan.length, `la frontera «${e.tag}» casa con ${casan.length} elementos, no con uno`).toBe(1);
      expect(casan[0]!.clase, `«${e.tag}» cambió de clase: la razón escrita ya no corresponde`).toBe(e.clase);
      e.afirmar(casan[0]!.s);
    }
  });

  it('🔴 TODA superficie PRUEBA que se cierra durante la ventana', () => {
    const { accionables: superficies } = censar(bloque!);

    /**
     * Las excepciones, por ATRIBUTO EXACTO. Los dos botones de reconciliación
     * dependen de SU PROPIA operación en vuelo, no de la ventana: son la salida
     * del estado congelado y taparlos con el predicado los dejaría muertos justo
     * cuando hacen falta.
     *
     * 🔴 La identidad es el TEXTO EXACTO de su `onClick`, y su guarda tiene que
     * ser EXACTAMENTE el identificador `reconciling` — no una expresión que lo
     * contenga. `disabled={!reconciling}` deja el botón vivo mientras la consulta
     * está en vuelo, que es lo contrario de lo que promete, y el substring lo
     * aceptaba.
     */
    const EXCEPCIONES = [
      { nombre: 'reconciliación · consultar', onClick: '() => void checkReconciliation()' },
      { nombre: 'reconciliación · desbloquear', onClick: '() => void releaseAfterReconciliation()' },
    ] as const;

    const excepcionadas = new Set<Superficie>();
    for (const ex of EXCEPCIONES) {
      const casan = superficies.filter((s) => expresionDe(atributo(s, 'onClick'), s.sf) === ex.onClick);
      expect(casan.length, `la excepción «${ex.nombre}» casa con ${casan.length} elementos, no con uno`).toBe(1);
      expect(
        expresionDe(casan[0]!.guarda, casan[0]!.sf),
        `la excepción «${ex.nombre}» ya no lleva EXACTAMENTE su propia guarda`,
      ).toBe('reconciling');
      excepcionadas.add(casan[0]!);
    }

    // Los diálogos de confirmación son la otra excepción, y es DERIVADA: sus
    // controles sólo existen como consecuencia de un intento de pago que la
    // puerta ya dejó pasar. Para que la zona no se agrande sola, se exige que
    // los `role="alertdialog"` sean exactamente esos dos, por su `aria-label`.
    const dialogos = elementosJsx(bloque!, PANTALLA).filter((s) => atributoLiteral(s, 'role') === 'alertdialog');
    expect(
      dialogos.map((d) => expresionDe(atributo(d, 'aria-label'), d.sf) ?? '?').sort(),
      'cambió el conjunto de diálogos de confirmación: la excepción derivada ya no está acotada',
    ).toEqual(["t('Confirmar parte adicional')", "t('Confirmar propina')"]);

    const fallan = superficies
      .filter((s) => !excepcionadas.has(s) && !enAlertDialog(s))
      .map((s) => ({ s, r: pruebaLaGuarda(s, GUARDA) }))
      .filter((x) => !x.r.ok)
      .map((x) => `${x.s.tag}@${x.s.linea} → ${x.s.guardaTexto ?? 'sin disabled'} · ${x.r.motivo}`);

    expect(
      fallan,
      `superficies que NO prueban cerrarse durante la ventana:\n  ${fallan.join('\n  ')}`,
    ).toEqual([]);
  });

  /**
   * 🔴 CONTROL POSITIVO — de PRESENCIA y por identidad, nunca por conteo.
   *
   * El de la primera versión era `todos.length > 8`: con doce superficies,
   * perder una guarda dejaba once y seguía verde. Éste exige que cada
   * superficie nombrada esté EN LA POBLACIÓN, identificada por su handler —que
   * es lo que el mutante del `disabled` no toca—.
   */
  it('🔴 las superficies nombradas están en la población, cada una por su identidad', () => {
    const { accionables: superficies } = censar(bloque!);
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
      const casan = superficies.filter(
        (s) => identidad.test(s.tag) || s.atributos.some((a) => identidad.test(a.getText(s.sf))),
      );
      if (casan.length !== 1) problemas.push(`${nombre}: ${casan.length} en la población, se esperaba 1`);
    }
    expect(problemas, problemas.join(' · ')).toEqual([]);
  });

  /**
   * El selector de propina es una función aparte —tiene que serlo, por el error
   * boundary— y sus píldoras viven adentro. Sin este censo, una píldora nueva
   * sin guarda no la ve nadie: el de arriba sólo mira el llamador.
   */
  it('🔴 dentro del selector de propina, cada píldora prueba su prop', () => {
    const selector = funcionDeLaPantalla('TipSelector');
    expect(selector, 'desapareció la función TipSelector').not.toBeNull();
    const { accionables: superficies, indecidibles, fronteras } = censar(selector!);
    expect(indecidibles).toEqual([]);
    expect(fronteras.map((f) => `${f.s.tag}@${f.s.linea}`)).toEqual([]);

    const IDENTIDADES: ReadonlyArray<readonly [string, RegExp]> = [
      ['píldora de porcentaje', /mode: 'pct'/],
      ['píldora «Otro»', /mode: 'custom'/],
      ['monto propio', /onCustomChange\(/],
    ];
    for (const [nombre, identidad] of IDENTIDADES) {
      expect(
        superficies.filter((s) => s.atributos.some((a) => identidad.test(a.getText(s.sf)))).length,
        `${nombre} no está en la población del selector`,
      ).toBe(1);
    }

    // Acá el predicado es el PROP `disabled`, que el llamador cablea.
    const fallan = superficies
      .map((s) => ({ s, r: pruebaLaGuarda(s, 'disabled') }))
      .filter((x) => !x.r.ok)
      .map((x) => `${x.s.tag}@${x.s.linea} → ${x.s.guardaTexto ?? 'sin disabled'} · ${x.r.motivo}`);
    expect(fallan, `píldoras que no prueban su prop:\n  ${fallan.join('\n  ')}`).toEqual([]);
  });
});
