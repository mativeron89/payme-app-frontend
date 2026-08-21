import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { parsear, type Arbol } from '../arnes/jsxGuardas';

/**
 * 🔴 L1 · EL PINNING DE SESIÓN DE LOS CAMINOS DE DINERO — la guarda existía y
 * NADA la verificaba.
 *
 * ## Qué invariante es
 *
 * `withPreparedMonetaryRequest` le entrega al callback **la sesión que el
 * journal selló** (`send(actor.session)`), y el riel REAL la reenvía a
 * `httpRequest` como `expectedSession`, donde `isCurrentSession` la exige
 * vigente. En una frase: **una mutación de dinero nunca sale autenticada por
 * una sesión distinta de la que el journal selló.**
 *
 * ## Por qué existe este archivo, y no es una precaución
 *
 * 🔴 **Medido, no supuesto:** le saqué el argumento `session` a los CINCO
 * caminos —`createMesa`, `payMesa`, `topupOxxo`, `topupCard`,
 * `createTransfer`— y **el gate entero quedó verde**: typecheck limpio, 1164
 * unitarios, y el E2E ni lo mira porque el riel mock **ignora ese parámetro en
 * los cinco**. La función estaba probada; el CABLEADO no. Es la misma clase que
 * bloqueó tres veces el censo de la pantalla de pago, encontrada del otro lado
 * del repo.
 *
 * ## ⚠️ EL LÍMITE, declarado y no tapado — dos, y ninguno se puede cerrar acá
 *
 * ① **La ventana que esto protege es ANGOSTA, y decirlo importa más que
 *    ensancharla:** el journal ya bloquea el cruce entre familias
 *    (`monetary_family_reconciliation_required`) ANTES de llamar a `send`. Lo
 *    que agrega el pinning es la ventana **entre esa verificación y el fetch**.
 *    La mutación espera dentro del lock del dinero, pero **el logout usa OTRO
 *    lock** (`payme-session-state`), así que una pestaña que cierra sesión
 *    durante el vuelo es posible. Angosta, real, y ésta es su única guarda.
 *
 * ② **Es acreditación DE FUENTE.** El riel mock no recibe la sesión, así que
 *    ninguna corrida de navegador puede observar esta conducta — y eso se
 *    afirma abajo en vez de dejarse implícito. Un E2E verde **no dice nada**
 *    sobre este invariante, y quien lea este archivo tiene que saberlo.
 */

const FUENTES = import.meta.glob('/src/api/index.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const ARBOL: Arbol = parsear(FUENTES);
const FACHADA = ARBOL['/src/api/index.ts']!;

/** El nodo de un objeto `const <nombre>: Api = { … }`. */
function riel(nombre: string): ts.Node | null {
  let hallado: ts.Node | null = null;
  FACHADA.forEachChild((n) => {
    if (!ts.isVariableStatement(n)) return;
    for (const d of n.declarationList.declarations) {
      if (d.name.getText(FACHADA) === nombre && d.initializer) hallado = d.initializer;
    }
  });
  return hallado;
}

function llamadasA(raiz: ts.Node, fn: string): ts.CallExpression[] {
  const salida: ts.CallExpression[] = [];
  const buscar = (n: ts.Node) => {
    if (ts.isCallExpression(n) && n.expression.getText(FACHADA) === fn) salida.push(n);
    n.forEachChild(buscar);
  };
  buscar(raiz);
  return salida;
}

const linea = (n: ts.Node) => FACHADA.getLineAndCharacterOfPosition(n.getStart(FACHADA)).line + 1;
/** El primer argumento de `withPreparedMonetaryRequest`: qué operación es. */
const operacion = (c: ts.CallExpression) => c.arguments[0]?.getText(FACHADA) ?? '?';

/**
 * La posición del `expectedSession` en cada puerta de red. Fuera de esta tabla
 * **no se sabe** dónde va la sesión, y eso es rojo, no un permiso.
 */
const PUERTAS: Record<string, number | 'sin-sesion'> = {
  httpRequest: 3,
  httpGuestRequest: 'sin-sesion',
};

interface Hallazgo { operacion: string; linea: number; motivo: string }

/**
 * Verifica UN camino monetario. Devuelve los motivos por los que NO se pudo
 * demostrar el pinning — vacío significa demostrado, nunca «no encontré nada».
 */
function verificar(c: ts.CallExpression): string[] {
  const problemas: string[] = [];
  const cb = c.arguments[4];
  if (!cb || (!ts.isArrowFunction(cb) && !ts.isFunctionExpression(cb))) {
    return ['el quinto argumento no es una función: no se puede seguir la sesión'];
  }
  const p = cb.parameters[0];
  if (!p) return ['el callback NO recibe la sesión sellada: `send(actor.session)` se descarta'];
  if (!ts.isIdentifier(p.name)) return ['el parámetro de sesión no es un identificador simple: irresoluble'];
  const sesion = p.name.text;

  // 🔴 La población de llamadas de red se deriva del PREFIJO, no de una lista
  // de las que ya conozco: una puerta nueva `httpLoQueSea` entra igual y, al no
  // estar en PUERTAS, se denuncia en vez de pasar sin mirar.
  const red: ts.CallExpression[] = [];
  const buscar = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const nombre = ts.isIdentifier(n.expression) ? n.expression.text
        : n.expression.getText(FACHADA).replace(/<[\s\S]*$/, '');
      if (/^http/.test(nombre)) red.push(n);
    }
    n.forEachChild(buscar);
  };
  buscar(cb.body);

  if (red.length === 0) problemas.push('el callback no hace ninguna llamada de red reconocible');

  for (const r of red) {
    const nombre = r.expression.getText(FACHADA).replace(/<[\s\S]*$/, '');
    const donde = PUERTAS[nombre];
    if (donde === undefined) {
      problemas.push(`puerta de red desconocida \`${nombre}\` (línea ${linea(r)}): no sé dónde va la sesión`);
      continue;
    }
    if (donde === 'sin-sesion') continue; // riel invitado, durmiente (ver abajo)
    const arg = r.arguments[donde];
    const texto = arg?.getText(FACHADA);
    if (texto !== sesion) {
      problemas.push(
        `\`${nombre}\` (línea ${linea(r)}) recibe \`${texto ?? 'nada'}\` donde va la sesión sellada \`${sesion}\``,
      );
    }
  }
  return problemas;
}

describe('🔴 L1 · toda mutación de dinero viaja con la sesión que el journal selló', () => {
  const real = riel('realApi');
  const mock = riel('mockApi');

  it('los dos rieles existen: sin esto el censo mediría en vacío', () => {
    expect(real, 'no se encontró `realApi`').not.toBeNull();
    expect(mock, 'no se encontró `mockApi`').not.toBeNull();
  });

  /**
   * 🔴 La población se DERIVA: son todas las llamadas a
   * `withPreparedMonetaryRequest` del riel real. Un SEXTO camino monetario
   * futuro entra solo — no hay lista que alguien tenga que acordarse de
   * actualizar, que es la forma en que estos censos se pudren.
   */
  it('🔴 CADA camino monetario del riel real PRUEBA que reenvía la sesión sellada', () => {
    const caminos = llamadasA(real!, 'withPreparedMonetaryRequest');
    expect(caminos.length, 'no hay caminos monetarios: el oráculo mediría en vacío').toBeGreaterThan(4);

    const fallan: Hallazgo[] = [];
    for (const c of caminos) {
      for (const motivo of verificar(c)) {
        fallan.push({ operacion: operacion(c), linea: linea(c), motivo });
      }
    }
    expect(
      fallan.map((f) => `${f.operacion} @${f.linea} · ${f.motivo}`),
      'caminos que NO prueban el pinning de sesión',
    ).toEqual([]);
  });

  /**
   * Control positivo por IDENTIDAD, no por conteo: cada camino conocido tiene
   * que estar. Si uno desaparece del árbol, el censo de arriba pasaría en un
   * conjunto más chico —exactamente la falla que bloqueó tres veces el censo de
   * la pantalla de pago— y esto lo caza.
   */
  it('🔴 los cinco caminos conocidos están, cada uno por su nombre de operación', () => {
    const nombres = llamadasA(real!, 'withPreparedMonetaryRequest').map(operacion);
    for (const esperado of ["'create_mesa'", '`mesa_pay:${code}`', "'topup_oxxo'", "'topup_card'", "'transfer'"]) {
      expect(nombres.filter((n) => n === esperado).length, `falta el camino ${esperado}`).toBe(1);
    }
  });

  /**
   * 🔴 SE AFIRMA EL LÍMITE, no sólo la guarda.
   *
   * El riel mock **no recibe la sesión** en ninguno de sus caminos, y por eso
   * ninguna corrida de navegador puede observar este invariante. No es un
   * defecto del mock —no hay `httpRequest` que pinchar— pero **sí es la razón
   * por la que un E2E verde no acredita nada de esto**, y prefiero que esa
   * asimetría esté escrita como aserción antes que como comentario: un
   * comentario envejece sin ponerse rojo.
   */
  it('🔴 el riel mock NO recibe la sesión: por eso esto no tiene testigo en navegador', () => {
    const caminos = llamadasA(mock!, 'withPreparedMonetaryRequest');
    expect(caminos.length, 'el mock perdió sus caminos monetarios').toBeGreaterThan(4);
    const conSesion = caminos
      .filter((c) => {
        const cb = c.arguments[4];
        return !!cb && (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) && cb.parameters.length > 0;
      })
      .map((c) => operacion(c));
    expect(
      conSesion,
      'el mock empezó a recibir la sesión: si ahora la usa, este invariante SÍ se puede ' +
        'observar en navegador y corresponde escribirle un E2E en vez de dejar esta nota',
    ).toEqual([]);
  });

  /**
   * El riel de invitado quedó DURMIENTE por el cierre del pago sin cuenta
   * (backend v2.32.0) y no se borra por ratificación. No lleva sesión porque no
   * la tiene: su credencial es el token. **Se nombra acá para que su ausencia de
   * pinning sea una excepción declarada y no un agujero que el censo saltea.**
   */
  it('🔴 la puerta de invitado está declarada como sin-sesión, no salteada', () => {
    expect(PUERTAS.httpGuestRequest).toBe('sin-sesion');
    expect(Object.keys(PUERTAS).sort(), 'apareció una puerta de red nueva sin clasificar')
      .toEqual(['httpGuestRequest', 'httpRequest']);
  });
});
