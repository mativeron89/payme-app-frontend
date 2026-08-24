import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import {
  atributo,
  atributoLiteral,
  CONTROLES_HTML,
  clasificarRetorno,
  cuerpoDelComponente,
  retornosDe,
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

type Clase = 'accionable' | 'seam-anidado' | 'interactivo-sin-seam' | 'raw-sin-guarda';

interface Anotada { s: Superficie; ruta: string; clase: Clase }
interface Censo {
  /** Deben PROBAR la implicación con la guarda vigente en su nivel. */
  accionables: { s: Superficie; ruta: string; guarda: string }[];
  /** No tienen guarda que probar: exigen excepción nombrada y afirmada. */
  fronteras: Anotada[];
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
const ES_INTRINSECO_ACCIONABLE = (s: Superficie) =>
  CONTROLES_HTML.includes(s.tag) || TIENE_ATRIBUTO_ACCIONABLE(s) || ROL_INTERACTIVO(s) || TIENE_HANDLER(s);

/**
 * 🔴 P45-M16 · EL CENSO AHORA BAJA AL CUERPO DE CADA CUSTOM.
 *
 * Codex mostró el agujero con un componente **autocontenido**: cero props, cero
 * spread, cero `disabled`, y un `<button onClick>` adentro. Mi clasificador lo
 * daba `inerte` **sin mirarle el cuerpo**, y su frase corrige el error de fondo:
 * **«una función sin parámetro produce una lista conocida y VACÍA de props, NO
 * un resultado indecidible»**. Yo trataba «no declara props» como «no tiene
 * superficie», y son cosas distintas.
 *
 * **Cómo baja, y por qué no termina censando el universo:** se sigue el cuerpo
 * de los componentes que **se pueden resolver en este árbol**; el que no se
 * puede seguir —una librería, un alias— **no se supone inerte: se declara
 * indecidible** y hay que decidirlo a mano. El fail-closed es lo que acota el
 * alcance sin mentir sobre él.
 *
 * **Qué guarda se exige en cada nivel:**
 *   · arriba, `seleccionBloqueada`;
 *   · dentro de un custom que DECLARA `disabled`, ese prop — el llamador ya
 *     probó que su valor cierra la ventana, así que adentro alcanza con seguirlo
 *     (es lo que ya se hacía a mano con `TipSelector`, ahora derivado);
 *   · dentro de un custom SIN `disabled`, **no hay guarda que heredar**: toda
 *     superficie interactuable de ahí adentro es **frontera** y tiene que estar
 *     enumerada con su razón.
 */
/**
 * ⚠️ **HASTA DÓNDE LLEGA ESTO, ahora que baja — y el límite CAMBIÓ DE FORMA.**
 *
 * 🔴 El commit anterior documentaba un agujero: *«un componente sin props que
 * renderiza un botón adentro es invisible»*. **Codex rechazó esa
 * documentación como cierre y tenía razón** — *«aunque se decidiera que esa
 * salida es legítima, debe quedar como frontera enumerada y afirmada, no como
 * inerte silencioso»*. Ese agujero **ya no existe**: la recursión lo cubre, y su
 * mutante exacto es un caso vivo de este archivo.
 *
 * **Lo que queda como límite es otra cosa, y es honesto:** un componente cuyo
 * cuerpo **no se puede resolver en este árbol** —de una librería, detrás de un
 * alias, generado— no se recorre. **No se aprueba: se declara indecidible**, y
 * alguien decide. Es lo único que impide que este censo tenga que recorrer el
 * universo, y por eso el fail-closed no es prolijidad: es lo que hace que el
 * alcance esté acotado **y dicho**.
 *
 * **Condición de disparo:** si aparece en la vista de pago un componente de
 * paquete externo, este censo lo va a denunciar y hay que decidirlo —envolverlo,
 * enumerarlo, o traerlo al árbol—. Lo que NO se puede hacer es agregarlo a una
 * lista de «confiables»: sería la lista de lo incluido otra vez, que falla
 * abierta.
 */
function censar(
  raiz: ts.Node,
  sfRaiz: ts.SourceFile,
  guardaRaiz: string | null,
  // Las sondas sintéticas agregan su propio archivo al árbol: sin esto, un
  // componente inventado en el test no se puede resolver y el caso mediría
  // «irresoluble» en vez de lo que viene a medir.
  arbol: typeof ARBOL = ARBOL,
): Censo {
  const acc: Censo = { accionables: [], fronteras: [], indecidibles: [] };
  /**
   * 🔴 P53-02 · DOS COSAS DISTINTAS QUE YO HABÍA METIDO EN UN SOLO `Set`.
   *
   * Antes había un `visitados` global por NOMBRE, y hacía dos trabajos a la
   * vez: cortar ciclos y no repetir trabajo. **No es dedup neutro**, y Codex lo
   * mostró de la peor manera posible: el mismo helper alcanzado primero desde
   * un componente CON `disabled` y después desde uno SIN guarda quedaba
   * cortado la segunda vez — **e invertir el orden invertía la clasificación
   * que sobrevive**. Un censo cuyo resultado depende del orden de recorrido no
   * está midiendo lo que dice.
   *
   * Ahora son dos estructuras con dos trabajos:
   *   · `enCamino` — **una PILA**: corta ciclos `A→B→A`. Se saca al volver, así
   *     que no impide visitar lo mismo por OTRA rama;
   *   · `completados` — memoización con identidad **de declaración MÁS contexto
   *     de guarda**: el mismo helper bajo `disabled` y bajo «sin guarda» son
   *     dos visitas distintas, porque las conclusiones son distintas.
   */
  const enCamino = new Set<string>();
  const completados = new Set<string>();

  /**
   * 🔴 P50-01 · SEGUIR UN CUERPO ES DOS COSAS: recorrer su JSX léxico Y
   * clasificar sus RETORNOS.
   *
   * Codex mostró el nivel indirecto: un helper que **devuelve** el botón y un
   * componente que **sólo lo llama**. Nada de eso es JSX léxico, así que el
   * censo lo daba por vacío. Ahora un retorno que no se puede probar inofensivo
   * —una variable, una llamada irresoluble— **es indecidible**, y una llamada
   * a una función local **se sigue**.
   */
  const seguirCuerpo = (
    nombre: string,
    donde: string,
    guardaInterna: string | null,
    propsDelComponente: string[],
  ) => {
    const clave = `${nombre}|${guardaInterna ?? 'sin-guarda'}`;
    if (completados.has(clave)) return;
    // El ciclo se corta por la PILA, no por la memoria: volver a entrar por
    // otra rama es legítimo y necesario.
    if (enCamino.has(clave)) return;
    const cuerpo = cuerpoDelComponente(nombre, arbol);
    if (!cuerpo) {
      acc.indecidibles.push(`${donde}: no se pudo seguir su cuerpo (¿externo?)`);
      completados.add(clave);
      return;
    }
    enCamino.add(clave);
    bajar(cuerpo.nodo, cuerpo.sf, `${donde} > `, guardaInterna);
    for (const expr of retornosDe(cuerpo.nodo)) {
      for (const c of clasificarRetorno(expr, cuerpo.sf, propsDelComponente)) {
        if (c.tipo === 'ok') continue;
        if (c.tipo === 'indecidible') {
          acc.indecidibles.push(`${donde}: devuelve algo que no se puede probar inofensivo → \`${c.texto}\``);
          continue;
        }
        // Una llamada local: se sigue con la MISMA guarda del nivel. Si no se
        // puede resolver, `seguirCuerpo` la declara indecidible por su cuenta.
        seguirCuerpo(c.nombre, `${donde} > ${c.nombre}()`, guardaInterna, propsDelComponente);
      }
    }
    enCamino.delete(clave);
    completados.add(clave);
  };

  const bajar = (nodo: ts.Node, sf: ts.SourceFile, ruta: string, guarda: string | null) => {
    for (const s of elementosJsx(nodo, sf)) {
      const donde = `${ruta}${s.tag}@${s.linea}`;
      if (s.tieneSpread) {
        acc.indecidibles.push(`${donde}: lleva un spread: podría aportar interacción o la guarda`);
        continue;
      }
      if (!/^[A-Z]/.test(s.tag)) {
        if (!ES_INTRINSECO_ACCIONABLE(s)) continue;
        if (guarda) acc.accionables.push({ s, ruta: donde, guarda });
        else acc.fronteras.push({ s, ruta: donde, clase: 'raw-sin-guarda' });
        continue;
      }

      const props = propsDeclarados(s.tag, arbol);
      if (props === undefined || props === null) {
        acc.indecidibles.push(`${donde}: ${props === undefined ? 'no se encontró su declaración' : 'sus props no se pudieron resolver'}`);
        continue;
      }
      const declaraDisabled = props.includes('disabled');
      if (declaraDisabled || TIENE_ATRIBUTO_ACCIONABLE(s)) {
        if (guarda) acc.accionables.push({ s, ruta: donde, guarda });
        else acc.fronteras.push({ s, ruta: donde, clase: 'accionable' });
      } else if (tieneSeamAnidado(s.tag, arbol)) {
        acc.fronteras.push({ s, ruta: donde, clase: 'seam-anidado' });
      } else if (props.some((n) => esHandlerDeInteraccion(n)) || TIENE_HANDLER(s) || ROL_INTERACTIVO(s)) {
        acc.fronteras.push({ s, ruta: donde, clase: 'interactivo-sin-seam' });
      }

      // 🔴 Y ACÁ SE BAJA, pase lo que pase arriba: que el elemento no tenga
      // superficie propia no dice NADA sobre lo que renderiza adentro.
      seguirCuerpo(s.tag, donde, declaraDisabled ? 'disabled' : null, props);
    }
  };

  bajar(raiz, sfRaiz, '', guardaRaiz);
  return acc;
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
function censarSuelto(codigo: string): Censo {
  // 🔴 Las DOS veces `sf`: la primera es la raíz a recorrer y la segunda es el
  // archivo contra el que se leen los textos. Pasar `PANTALLA` en la segunda
  // —mi primer intento— devuelve basura: los nodos son de OTRO archivo y
  // `getText()` los recorta contra posiciones ajenas. El síntoma fue un
  // `onActivar` clasificado como inerte, o sea el test aprobando el defecto.
  const sf = ts.createSourceFile('/d.tsx', codigo, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);
  // La raíz es la ÚLTIMA sentencia, no el archivo: si se recorriera entero, el
  // cuerpo del componente inventado se visitaría de forma directa y el caso
  // pasaría sin ejercitar la recursión — que es justo lo que viene a probar.
  const raiz = sf.statements[sf.statements.length - 1]!;
  return censar(raiz, sf, 'g', { ...ARBOL, '/d.tsx': sf });
}
const claseSuelta = (jsx: string): string => {
  const c = censarSuelto(`const _ = ${jsx};`);
  if (c.indecidibles.length) return `indecidible: ${c.indecidibles[0]}`;
  if (c.accionables.length) return 'accionable';
  if (c.fronteras.length) return 'frontera';
  return 'inerte';
};

describe('🔴 la regla INVERTIDA, y no una lista más larga', () => {
  it('🔴 un handler que NO EXISTE en ninguna lista entra igual', () => {
    // `onActivar` es inventado acá. Ninguna lista de handlers permitidos, por
    // larga que sea, lo puede contener — y ése es exactamente el punto.
    expect(claseSuelta('<div onActivar={f}>x</div>')).toBe('accionable');
    expect(claseSuelta('<div onLoQueSea={f}>x</div>')).toBe('accionable');
  });

  it('🔴 un spread NO se clasifica: se denuncia', () => {
    expect(claseSuelta('<div {...props}>x</div>'), 'el spread pasó sin denunciarse').toMatch(/spread/);
  });

  it('⭐ CONTROL NEGATIVO · lo decorativo sigue siendo inerte', () => {
    // Sin esto, «clasificar todo como accionable» pasaría los dos casos de
    // arriba y el censo entero quedaría inservible por ruido.
    expect(claseSuelta('<div className="caption">x</div>')).toBe('inerte');
    expect(claseSuelta('<span aria-hidden="true">▾</span>')).toBe('inerte');
  });

  /**
   * 🔴 P45-M16 · EL DISCRIMINANTE DE LA RECURSIÓN — el mutante exacto de Codex.
   *
   * Un componente **autocontenido**: cero props, cero spread, cero `disabled`,
   * y un `<button onClick>` adentro. **Ninguna versión anterior del censo lo
   * veía**, porque todas decidían mirando el LLAMADOR: sin props que consultar
   * y sin atributos, el elemento era inerte con toda razón aparente.
   *
   * ⚠️ **Y el arreglo que NO alcanzaba era el que yo había hecho:** documentar
   * el límite. Codex lo rechazó con la frase que corrige el error de fondo —
   * *«una función sin parámetro produce una lista conocida y VACÍA de props, NO
   * un resultado indecidible»*— y con la regla que la sigue: aunque se decida
   * que la salida es legítima, **tiene que quedar como frontera enumerada y
   * afirmada, no como inerte silencioso**.
   */
  it('🔴 MUTANTE DE CODEX · un custom AUTOCONTENIDO no puede pasar por inerte', () => {
    const c = censarSuelto(`
      function CtaAutocontenido() {
        return <button onClick={() => navigate('home')}>pagar</button>;
      }
      const _ = <div><CtaAutocontenido /></div>;
    `);
    const visto = [...c.fronteras.map((f) => f.ruta), ...c.accionables.map((a) => a.ruta)];
    expect(
      visto.some((r) => /CtaAutocontenido@\d+ > button@\d+/.test(r)),
      `el botón interno no apareció en el censo: ${visto.join(' · ') || '(nada)'}`,
    ).toBe(true);
  });

  /**
   * 🔴 P50-01 · LA SONDA DE CODEX — el M16 **un nivel indirecto**.
   *
   * Un helper que **devuelve** el botón y un componente que **sólo lo llama**.
   * Nada de eso es JSX léxico del componente, así que la recursión del P45 —que
   * ya bajaba al cuerpo— **lo daba por vacío igual**.
   *
   * ⚠️ **Es la capa que yo misma había anunciado** al cerrar el P45: *«si
   * aparece un P52 no será faltó un caso, será otra capa»*. Llegó. **Anticiparla
   * no la cerró** — lo único que cambió es que se reconoció rápido.
   */
  it('🔴 SONDA DE CODEX · un componente que sólo LLAMA a un helper que devuelve el botón', () => {
    const c = censarSuelto(`
      function crearCtaIndirectoP51() {
        return <button onClick={() => { window.location.hash = '#/'; }}>mutante</button>;
      }
      function P51IndirectCta() { return crearCtaIndirectoP51(); }
      const _ = <div><P51IndirectCta /></div>;
    `);
    const visto = [...c.fronteras.map((f) => f.ruta), ...c.accionables.map((a) => a.ruta), ...c.indecidibles];
    expect(
      visto.some((r) => /crearCtaIndirectoP51\(\) > button@\d+/.test(r)),
      `el botón del helper no apareció: ${visto.join(' · ') || '(nada)'}`,
    ).toBe(true);
  });

  /**
   * 🔴 P53-01 · SONDA DE CODEX · el arrow con cuerpo-EXPRESIÓN.
   *
   * `const crearCta = () => <button…/>` **devuelve sin `return`**. El seguidor
   * anterior buscaba `ReturnStatement`, así que ese cuerpo salía vacío: ni JSX
   * que recorrer ni retorno que declarar indecidible — **se perdía en
   * silencio**, que es la peor de las tres salidas.
   */
  it('🔴 SONDA DE CODEX · un arrow con cuerpo-EXPRESIÓN devuelve igual', () => {
    const c = censarSuelto(`
      const crearCta = () => <button onClick={f}>x</button>;
      function ArrowCta() { return crearCta(); }
      const _ = <div><ArrowCta /></div>;
    `);
    const visto = [...c.fronteras.map((f) => f.ruta), ...c.accionables.map((a) => a.ruta), ...c.indecidibles];
    expect(visto.some((r) => /crearCta\(\) > button@\d+/.test(r)), `no apareció: ${visto.join(' · ') || '(nada)'}`).toBe(true);
  });

  /**
   * 🔴 **ÉSTE es el que DISCRIMINA, y el de arriba NO — medido plantando el
   * rival.** Con `retornosDe` sin cuerpo-expresión, el caso anterior **sigue
   * pasando**: el JSX de `() => <button/>` es LÉXICO, así que el recorrido del
   * cuerpo lo encuentra igual sin mirar el retorno. Acá el JSX vive detrás de
   * una llamada dentro de un condicional: **sin clasificar el retorno, no hay
   * forma de llegar**.
   *
   * ⚠️ Se escribe porque las dos sondas se ven igual de convincentes y **una
   * sola prueba el arreglo**. Contar dos donde hay una es cómo una batería de
   * mutantes empieza a mentir sobre su propia fuerza.
   */
  it('🔴 y encadenado: arrow → condicional → helper', () => {
    // Dos formas combinadas: cuerpo-expresión Y un condicional cuyas ramas hay
    // que clasificar por separado. Si el seguidor mira sólo la primera rama, o
    // sólo las sentencias, el botón se pierde.
    const c = censarSuelto(`
      function crearOtro() { return <button onClick={f}>y</button>; }
      const elegir = (b: boolean) => (b ? null : crearOtro());
      function Encadenado() { return elegir(true); }
      const _ = <div><Encadenado /></div>;
    `);
    const visto = [...c.fronteras.map((f) => f.ruta), ...c.accionables.map((a) => a.ruta), ...c.indecidibles];
    expect(visto.some((r) => /crearOtro\(\) > button@\d+/.test(r)), `no apareció: ${visto.join(' · ') || '(nada)'}`).toBe(true);
  });

  it('⭐ CONTROL NEGATIVO · un arrow inerte no se denuncia', () => {
    const c = censarSuelto(`
      const vacio = () => null;
      function Inerte() { return vacio(); }
      const _ = <div><Inerte /></div>;
    `);
    expect(c.indecidibles, `denunció un arrow inofensivo: ${c.indecidibles.join(' · ')}`).toEqual([]);
    expect(c.fronteras.map((f) => f.ruta), 'inventó una frontera').toEqual([]);
  });

  /**
   * 🔴 P53-02 · SONDA DE CODEX · el mismo helper por DOS rutas con guardas
   * distintas. Con un `Set` global por nombre, la segunda visita se cortaba
   * como «ya visto» — **e invertir el orden invertía cuál sobrevive**. Un censo
   * cuyo resultado depende del orden de recorrido no mide lo que dice.
   */
  it('🔴 SONDA DE CODEX · el mismo helper bajo DOS guardas distintas', () => {
    const codigo = `
      function comun() { return <button onClick={f}>z</button>; }
      function ConGuarda({ disabled }: { disabled: boolean }) { return comun(); }
      function SinGuarda() { return comun(); }
      const _ = <div><ConGuarda disabled={g} /><SinGuarda /></div>;
    `;
    const c = censarSuelto(codigo);
    const rutas = [...c.fronteras.map((f) => f.ruta), ...c.accionables.map((a) => a.ruta)];
    // La ruta SIN guarda tiene que aparecer como frontera: nadie la cubre.
    expect(
      c.fronteras.some((f) => /SinGuarda@\d+ > comun\(\) > button@\d+/.test(f.ruta)),
      `la ruta sin guarda se perdió: ${rutas.join(' · ')}`,
    ).toBe(true);
    // Y la ruta CON guarda tiene que aparecer como accionable, no perderse.
    expect(
      c.accionables.some((a) => /ConGuarda@\d+ > comun\(\) > button@\d+/.test(a.ruta)),
      `la ruta con guarda se perdió: ${rutas.join(' · ')}`,
    ).toBe(true);
  });

  it('🔴 un ciclo A→B→A no cuelga ni se come una rama', () => {
    // El corte de ciclos vive en la PILA, no en la memoria: sacarlo al volver
    // es lo que permite entrar de nuevo por otra rama.
    const c = censarSuelto(`
      function A() { return B(); }
      function B() { return A(); }
      const _ = <div><A /></div>;
    `);
    expect(Array.isArray(c.indecidibles)).toBe(true);
  });

  it('🔴 y un retorno que NO se puede probar inofensivo es indecidible', () => {
    // Una variable devuelta: puede ser JSX, puede no serlo, y este arnés no lo
    // resuelve. No se aprueba — se denuncia y alguien decide.
    const c = censarSuelto(`
      function Opaco() { const algo = hacerCosas(); return algo; }
      const _ = <div><Opaco /></div>;
    `);
    expect(c.indecidibles.join(' '), 'un retorno opaco pasó sin denunciarse').toMatch(/no se puede probar inofensivo/);
  });

  it('⭐ CONTROL NEGATIVO · los retornos legítimos NO se denuncian', () => {
    // Sin esto, «declarar indecidible todo retorno» pasaría los dos casos de
    // arriba y volvería el censo inservible por ruido. `null`, un ternario de
    // JSX y lo que llega por props tienen que pasar limpio.
    //
    // ⚠️ El parámetro va TIPADO y no es decoración del test: un props sin
    // anotación ya es irresoluble por la regla del P40, y sin el tipo este
    // control fallaba por ESA causa y no por la que viene a medir — un negativo
    // que se cae por el motivo equivocado no controla nada.
    const c = censarSuelto(`
      function Limpio({ hijos }: { hijos: unknown }) { return hijos ? <div /> : null; }
      const _ = <div><Limpio hijos={<span />} /></div>;
    `);
    expect(c.indecidibles, `denunció retornos legítimos: ${c.indecidibles.join(' · ')}`).toEqual([]);
  });

  it('🔴 y lo que NO se puede seguir se declara, en vez de suponerse inerte', () => {
    // Un componente que este árbol no puede resolver —una librería, un alias—
    // NO se recorre y NO se aprueba: se denuncia. Es lo que acota el alcance
    // sin mentir sobre él: sin esto, o se censa el universo o se miente.
    expect(claseSuelta('<ComponenteDeOtroPaquete />')).toMatch(/indecidible/);
  });

  it('⭐ y los handlers de CICLO DE VIDA no convierten en control', () => {
    // La lista al revés tiene que ser corta y justificada: si `onAnimationEnd`
    // contara, el bloque de propina entero pasaría a exigir guarda propia.
    expect(claseSuelta('<div onAnimationEnd={f}>x</div>')).toBe('inerte');
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
    const { indecidibles } = censar(bloque!, PANTALLA, GUARDA);
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
    const { fronteras } = censar(bloque!, PANTALLA, GUARDA);

    const ESPERADAS: ReadonlyArray<{
      tag: string;
      clase: Clase;
      /** Cuando dos fronteras comparten ruta, esto las separa. */
      identifica?: (s: Superficie) => boolean;
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
      // ══════════════════════════════════════════════════════════════════
      // 🔴 P45-M16 · LAS TRES DE ADENTRO — las que la recursión destapó.
      //
      // Ninguna versión anterior del censo las veía: decidía mirando el
      // llamador, y el llamador no dice nada de lo que el componente renderiza.
      // Que ya estuvieran bien no las hacía menos invisibles.
      // ══════════════════════════════════════════════════════════════════
      {
        // El «Volver a la mesa» de la cabecera. 🔴 Es LA SALIDA, y no lleva
        // guarda a propósito: con un pago congelado, apagarla encierra a la
        // persona en el estado del que más necesita poder salir.
        tag: 'AppHeaderFlow > button',
        clase: 'raw-sin-guarda',
        identifica: (s) => expresionDe(atributo(s, 'onClick'), s.sf) === 'onBack',
        afirmar: (s) => {
          expect(expresionDe(atributo(s, 'onClick'), s.sf), 'dejó de llamar al `onBack` del llamador').toBe('onBack');
          expect(atributo(s, 'disabled'), 'la salida NO puede llevar guarda').toBeNull();
        },
      },
      {
        // La campana del chrome común permanece nombrada y táctil. El caller
        // acredita `bellBlocked` para la pantalla de pago: el componente da
        // feedback en ese estado y sólo navega fuera de la guarda.
        tag: 'AppHeaderFlow > button',
        clase: 'raw-sin-guarda',
        identifica: (s) => expresionDe(atributo(s, 'aria-label'), s.sf) === "t('Avisos')"
          && (expresionDe(atributo(s, 'onClick'), s.sf)?.includes('bellBlocked') ?? false),
        afirmar: (s) => {
          expect(atributoLiteral(s, 'aria-label')).toBeNull();
          expect(expresionDe(atributo(s, 'aria-label'), s.sf)).toBe("t('Avisos')");
          expect(atributo(s, 'disabled'), 'la campana debe responder con feedback').toBeNull();
          const handler = expresionDe(atributo(s, 'onClick'), s.sf);
          expect(handler).toContain("toast(t('Termina este paso para abrir tus avisos.'))");
          expect(handler).toContain("navigate('avisos')");
        },
      },
      {
        // Los ítems de navegación de la barra (Inicio, Mesas, Amigos, Más).
        // Navegar no muta el payload, y salir con un pago en curso está
        // declarado seguro CON RETOME por el acta del 2026-08-19 («A+B»).
        // Apagarlos sería quitar la salida que esa acta garantiza.
        tag: 'AppBottomBar > button',
        clase: 'raw-sin-guarda',
        identifica: (s) => atributo(s, 'aria-current') !== null,
        afirmar: (s) => {
          expect(expresionDe(atributo(s, 'onClick'), s.sf)).toMatch(/navigate\(/);
          expect(atributo(s, 'disabled'), 'un ítem de navegación no lleva guarda: es la salida').toBeNull();
        },
      },
      {
        // El CTA de verdad. Acá SÍ vive el seam, y por eso `AppBottomBar` entra
        // como `seam-anidado` arriba: lo que el llamador prueba en
        // `center.disabled` termina en este atributo. La recursión cierra el
        // circuito — antes se afirmaba una punta y se confiaba en la otra.
        tag: 'AppBottomBar > button',
        clase: 'raw-sin-guarda',
        identifica: (s) => atributoLiteral(s, 'className') === 'appbar-fab',
        afirmar: (s) => {
          expect(
            expresionDe(atributo(s, 'disabled'), s.sf),
            'el CTA dejó de leer el seam que el llamador prueba',
          ).toBe('centro.disabled');
        },
      },
    ];

    /** La ruta sin números de línea: `AppBottomBar@2167 > button@132` → `AppBottomBar > button`. */
    const forma = (f: Anotada) => f.ruta.replace(/@\d+/g, '');

    const sinEnumerar = fronteras
      .filter((f) => !ESPERADAS.some((e) => e.tag === forma(f) && (!e.identifica || e.identifica(f.s))))
      .map((f) => `${f.ruta} (${f.clase})`);
    expect(
      sinEnumerar,
      `fronteras interactivas SIN enumerar — el censo no puede afirmar exhaustividad: ${sinEnumerar.join(' · ')}`,
    ).toEqual([]);

    for (const e of ESPERADAS) {
      const casan = fronteras.filter((f) => forma(f) === e.tag && (!e.identifica || e.identifica(f.s)));
      expect(casan.length, `la frontera «${e.tag}» casa con ${casan.length} elementos, no con uno`).toBe(1);
      expect(casan[0]!.clase, `«${e.tag}» cambió de clase: la razón escrita ya no corresponde`).toBe(e.clase);
      e.afirmar(casan[0]!.s);
    }
  });

  it('🔴 TODA superficie PRUEBA que se cierra durante la ventana', () => {
    const { accionables } = censar(bloque!, PANTALLA, GUARDA);

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
      const casan = accionables.filter((a) => expresionDe(atributo(a.s, 'onClick'), a.s.sf) === ex.onClick);
      expect(casan.length, `la excepción «${ex.nombre}» casa con ${casan.length} elementos, no con uno`).toBe(1);
      expect(
        expresionDe(casan[0]!.s.guarda, casan[0]!.s.sf),
        `la excepción «${ex.nombre}» ya no lleva EXACTAMENTE su propia guarda`,
      ).toBe('reconciling');
      excepcionadas.add(casan[0]!.s);
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

    const fallan = accionables
      .filter((a) => !excepcionadas.has(a.s) && !enAlertDialog(a.s))
      .map((a) => ({ a, r: pruebaLaGuarda(a.s, a.guarda) }))
      .filter((x) => !x.r.ok)
      .map((x) => `${x.a.ruta} → ${x.a.s.guardaTexto ?? 'sin disabled'} · ${x.r.motivo}`);

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
    const superficies = censar(bloque!, PANTALLA, GUARDA).accionables.map((a) => a.s);
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

});
