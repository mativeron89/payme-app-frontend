import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import {
  atributo,
  atributoLiteral,
  CONTROLES_HTML,
  elementosJsx,
  expresionDe,
  HANDLERS,
  implicaVerdadero,
  parsear,
  propsDeclarados,
  ROLES_INTERACTIVOS,
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

interface Censo {
  superficies: Superficie[];
  irresolubles: string[];
  crudas: Superficie[];
}

function esCruda(s: Superficie): boolean {
  const rol = atributoLiteral(s, 'role');
  if (rol && ROLES_INTERACTIVOS.includes(rol)) return true;
  return HANDLERS.some((h) => atributo(s, h) !== null);
}

/**
 * La población: superficies INTERACTUABLES del subárbol.
 *
 * 🔴 Derivada de lo que la superficie ES. Un `<button>` sigue siendo un botón
 * después de que le borren el `disabled`, y un `<div role="button" onClick>`
 * es accionable aunque el atributo `disabled` ni siquiera le aplique.
 */
function censar(raiz: ts.Node): Censo {
  const todos = elementosJsx(raiz, PANTALLA);
  const superficies: Superficie[] = [];
  const irresolubles: string[] = [];
  const crudas: Superficie[] = [];
  for (const s of todos) {
    if (CONTROLES_HTML.includes(s.tag)) { superficies.push(s); continue; }
    if (/^[A-Z]/.test(s.tag)) {
      const props = propsDeclarados(s.tag, ARBOL);
      if (props === undefined) { irresolubles.push(`${s.tag}@${s.linea}: no se encontró su declaración`); continue; }
      if (props === null) { irresolubles.push(`${s.tag}@${s.linea}: sus props no se pudieron resolver (¿herencia calificada o tipo externo?)`); continue; }
      if (props.includes('disabled')) superficies.push(s);
      continue;
    }
    // Elemento crudo: no es control del DOM ni componente. Si es accionable,
    // se CLASIFICA — no se ignora.
    if (esCruda(s)) crudas.push(s);
  }
  return { superficies, irresolubles, crudas };
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

describe('🔴 P36 · censo semántico de la pantalla de pago', () => {
  const bloque = bloqueDeLaVistaDePago();

  it('🔴 la región se ubica por AST, y no llega al final del archivo', () => {
    expect(bloque, "no se encontró el bloque `if (view === 'pay')`").not.toBeNull();
    const fin = PANTALLA.getLineAndCharacterOfPosition(bloque!.getEnd()).line + 1;
    const total = PANTALLA.getLineAndCharacterOfPosition(PANTALLA.getEnd()).line + 1;
    expect(fin, 'la región llega al final del archivo: se está censando de más').toBeLessThan(total - 10);
  });

  it('🔴 la población se puede CERRAR: nada quedó sin resolver', () => {
    const { irresolubles } = censar(bloque!);
    expect(
      irresolubles,
      `el censo NO puede afirmar nada sobre estos: ${irresolubles.join(' · ')}`,
    ).toEqual([]);
  });

  /**
   * 🔴 Los elementos CRUDOS accionables (un `<div role="button" onClick>`) no
   * llevan `disabled` —el atributo no les aplica— y por eso el censo anterior
   * ni los miraba. **No mirarlos es suponerlos inocentes:** un control así
   * queda vivo durante la ventana y nadie lo denuncia.
   *
   * No se los obliga a tener `disabled`: se los obliga a EXISTIR EN LA LISTA.
   * Hoy la lista está vacía, y por eso el oráculo es simple; el día que alguien
   * agregue uno, esto lo nombra y hay que decidir qué se hace con él.
   */
  it('🔴 no hay superficies CRUDAS accionables sin clasificar', () => {
    const { crudas } = censar(bloque!);
    const nombres = crudas.map((s) => `${s.tag}@${s.linea}`);
    expect(
      nombres,
      `elementos accionables que no son controles ni componentes: ${nombres.join(' · ')}. ` +
        'Un `disabled` no les aplica, así que la ventana NO los cierra: hay que decidir cómo se apagan.',
    ).toEqual([]);
  });

  it('🔴 TODA superficie PRUEBA que se cierra durante la ventana', () => {
    const { superficies } = censar(bloque!);

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
    const { superficies } = censar(bloque!);
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
    const { superficies, irresolubles, crudas } = censar(selector!);
    expect(irresolubles).toEqual([]);
    expect(crudas.map((s) => `${s.tag}@${s.linea}`)).toEqual([]);

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
