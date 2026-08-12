import { describe, expect, it } from 'vitest';

/**
 * ⭐ LOS MUTANTES DE 1A.1, MUDADOS — y por qué tienen que vivir en la FUENTE.
 *
 * La contención del P0 fue reemplazar una inferencia por una prueba. Mientras
 * la inferencia existía, se podía testear su ausencia con una función pura
 * (`veredictoReconciliacion` recibía la lista de mesas y no miraba el nombre).
 * Ahora la lista **ya no se pide**, así que no queda ningún parámetro que
 * mutar: el defecto sólo puede volver escribiéndolo de nuevo en la pantalla.
 *
 * Por eso estas afirmaciones son sobre el CÓDIGO. No son un lujo de estilo:
 * cada una corresponde a un escenario que la orden pidió acreditar y que hoy
 * es imposible por construcción — **imposible por construcción es exactamente
 * lo que hay que fijar, porque no deja rastro cuando se rompe.**
 *
 * - **otro participante**: desde G-28 `/mesas/open` trae también las mesas
 *   donde sos participante, así que la mesa de un amigo en el mismo
 *   restaurante acreditaba la apertura propia.
 * - **otro opener / restaurantes homónimos**: dos sucursales con el mismo
 *   nombre son indistinguibles por nombre.
 * - **`undefined === undefined`**: si el objeto `restaurant` no venía, los dos
 *   `?.` daban `undefined` y la comparación era verdadera. Ni siquiera hacía
 *   falta mala fe ni un dato raro.
 *
 * Los tres desaparecen porque la autoridad pasó a ser
 * `(opener_user_id, idempotency_key)`, que el backend resuelve y este front no
 * puede confundir.
 */

const FUENTE = import.meta.glob('/src/screens/CreateMesaFlow.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function pantalla(): string {
  const texto = FUENTE['/src/screens/CreateMesaFlow.tsx'];
  // Sin esto, un glob que no encuentra nada dejaría pasar TODO en verde.
  expect(texto, 'no se pudo leer CreateMesaFlow.tsx').toBeTruthy();
  return texto!;
}

/** El cuerpo de `checkMesaReconciliation`, para acotar lo que se afirma. */
function reconciliacion(): string {
  const texto = pantalla();
  const desde = texto.indexOf('async function checkMesaReconciliation()');
  expect(desde, 'no se encontró checkMesaReconciliation').toBeGreaterThan(-1);
  // Hasta el cierre de la función: la siguiente declaración de nivel 2.
  const hasta = texto.indexOf('\n  const ticketValid', desde);
  expect(hasta, 'no se encontró el final de la reconciliación').toBeGreaterThan(desde);
  return texto.slice(desde, hasta);
}

describe('la reconciliación no puede volver a acreditar por parecido', () => {
  it('🔴 el nombre del restaurante NO se compara en ninguna parte de la pantalla', () => {
    // La forma exacta que tenía el defecto y cualquier variante de igualdad
    // sobre `.name`. Se afirma sobre el archivo entero, no sólo sobre la
    // función: reintroducirlo en un helper de al lado sería el mismo bug.
    expect(pantalla()).not.toMatch(/\.name\s*={2,3}/);
  });

  it('🔴 la reconciliación NO consulta el listado de mesas abiertas', () => {
    // `/mesas/open` no acredita en ninguna de las dos direcciones: ni por
    // presencia (trae mesas ajenas) ni por ausencia (no lista pending_auth,
    // que es justo el caso reconciliado).
    expect(reconciliacion()).not.toContain('getOpenMesas');
  });

  it('la reconciliación consulta POR LA CLAVE del intento congelado', () => {
    const cuerpo = reconciliacion();
    expect(cuerpo).toContain('api.getMesaCreation(frozen.handle.key, sello ?? undefined)');
  });

  it('🔴 MUTANTE · el `payload_hash` sale del JOURNAL, no se recalcula', () => {
    // Recalcularlo desde el formulario sería mentir sobre lo que se mandó:
    // tras un reload los ítems ni existen, y un `pm_` nuevo daría otro valor.
    // El sello se congela antes del primer envío y se lee tal cual.
    const cuerpo = reconciliacion();
    expect(cuerpo).toContain("readEconomicFingerprint(frozen.scope, 'create_mesa')");
    expect(cuerpo, 'el hash no puede recalcularse en la reconciliación')
      .not.toContain('payloadHash(');
  });

  it('🔴 el journal sólo se termina cuando la decisión lo autoriza', () => {
    const cuerpo = reconciliacion();
    // Una sola llamada, y detrás del flag de la vista pura. Si alguien la
    // saca del `if`, este test cae.
    expect(cuerpo.match(/reconcileMonetaryIntent/g) ?? []).toHaveLength(1);
    expect(cuerpo).toMatch(/if\s*\(resultado\.liberaJournal\)\s*\{\s*\n\s*await reconcileMonetaryIntent/);
  });
});

describe('el reenvío nunca puede rotar la clave', () => {
  it('🔴 MUTANTE · el intento del reenvío sale del handle congelado, no de uno nuevo', () => {
    // `acquireMonetaryIntent` abre generación nueva = clave nueva = segunda
    // garantía por el total. Sólo puede llamarse cuando NO hay nada congelado,
    // y la forma `frozen?.handle ?? await acquire…` lo garantiza.
    expect(pantalla()).toContain('let intent: MonetaryIntentHandle | null = frozen?.handle ?? null;');
    expect(pantalla()).toContain('intent = intent ?? await acquireMonetaryIntent(mesaScope, \'create_mesa\');');
  });

  it('🔴 MUTANTE · el desbloqueo del envío exige la autorización del contrato', () => {
    expect(pantalla()).toContain('if (frozenRequiresReconciliation && !replayHabilitado) {');
  });

  it('🔴 MUTANTE · la autorización se ata a la generación exacta, no a un booleano', () => {
    const texto = pantalla();
    expect(texto).toContain('replayAutorizado.key === frozen.handle.key');
    expect(texto).toContain('replayAutorizado.generation === frozen.handle.generation');
  });
});

/**
 * ⭐ ORDEN 1-B · LA UI NO PUEDE ATRIBUIRLE LA GARANTÍA A UNA TARJETA QUE NADIE
 * ELIGIÓ.
 *
 * El defecto que encontró Codex, y por qué se nos pasó a los dos: yo argumenté
 * que `is_default` no viaja en el request y por lo tanto **no puede cambiar la
 * identidad económica**. Es cierto — y era la pregunta equivocada. El caso no
 * era sobre el hash: era sobre **qué tarjeta se le MUESTRA a la persona**.
 * Los dos razonamos sobre el hash y ninguno miró la pantalla.
 *
 * El mecanismo: `loadCards()` autoselecciona la DEFAULT; tras una recarga
 * sobre una apertura congelada, si la garantía se hizo con una guardada
 * NO-default, la pantalla muestra la default como seleccionada — y los botones
 * están deshabilitados, así que la persona tampoco puede corregirlo.
 *
 * 🔴 Y hay un caso donde NO es sólo visual: si el diagnóstico da `not_found`,
 * el reenvío CREA por primera vez y la fuente que se manda ES la que respalda
 * la garantía. Autoseleccionar la default ahí la vuelve real.
 */
describe('la garantía congelada no se le atribuye a la default', () => {
  it('🔴 MUTANTE · `loadCards` NO autoselecciona con un intento congelado', () => {
    expect(pantalla()).toContain(
      'if (def && cardStateRef.current.empty && !sinAutoseleccionRef.current) setCardChoice(def.id);',
    );
  });

  it('🔴 MUTANTE · descubrir el intento congelado LIMPIA la selección', () => {
    // Cubre la carrera al revés: si `loadCards` llegó primero y ya había
    // autoseleccionado, el efecto que descubre el congelado lo deshace.
    const texto = pantalla();
    expect(texto).toContain('sinAutoseleccionRef.current = true;');
    expect(texto).toContain('setCardChoice(SIN_TARJETA_ELEGIDA);');
  });

  it('🔴 MUTANTE · sin elección explícita el envío se corta', () => {
    // La guarda dura, no sólo el `disabled` del botón: el silencio no puede
    // resolverse con la default.
    expect(pantalla()).toContain(
      "if (method === 'card' && cardChoice === SIN_TARJETA_ELEGIDA) {",
    );
  });

  it('🔴 el sentinela NO es `new` ni un uuid: los dos afirman algo', () => {
    expect(pantalla()).toContain("const SIN_TARJETA_ELEGIDA = '';");
  });

  it('la selección de TARJETA vuelve a estar viva cuando el reenvío está autorizado', () => {
    // Si el diagnóstico dijo `not_found`, la persona TIENE que poder elegir:
    // esa fuente es la que va a respaldar la garantía. Son dos radios —las
    // guardadas y "usar otra"— y los dos tienen que aflojar.
    const texto = pantalla();
    expect(texto).toContain('canUseCardRail(moneyRail, !!frozen)');
    expect((texto.match(/disabled=\{!cardRailAvailable \|\| \(!!frozen && !replayHabilitado\)\}/g) ?? [])).toHaveLength(2);
  });

  it('🔴 pero el radio de SALDO sigue duro: cambiar de riel SÍ cambia la identidad', () => {
    // `guarantee_method` está en `PAYLOAD_KEYS.create_mesa`, así que pasar de
    // tarjeta a saldo es otra intención económica — y además el riel saldo
    // está apagado. Su `disabled={!!frozen}` NO se aflojó, y eso es
    // deliberado: el mutante sería "aflojé todos los radios de una".
    const texto = pantalla();
    const wallet = texto.indexOf("method === 'wallet' ? 'sel' : ''");
    expect(wallet, 'no se encontró el radio de saldo').toBeGreaterThan(-1);
    expect(texto.slice(wallet, wallet + 300)).toContain('disabled={!!frozen}');
  });

  it('🔴 y la pantalla DICE que no sabe, en vez de mostrar una cualquiera', () => {
    expect(pantalla()).toContain('No podemos mostrarte con qué tarjeta se garantizó esta mesa.');
  });
});

/**
 * Los comentarios que describían un estado que dejó de ser cierto. Un texto
 * así es una orden latente: alguien lo lee y actúa sobre un límite que ya no
 * existe.
 */
describe('los comentarios vencidos de la ORDEN 2-A quedaron corregidos', () => {
  it('ya no se afirma que el reenvío con tarjeta tipeada corta', () => {
    // Decía: "va a cortar con `monetary_payload_ambiguous`". Con la identidad
    // económica alineada eso ES FALSO.
    const texto = pantalla();
    expect(texto).not.toContain('va a cortar con `monetary_payload_ambiguous`');
    expect(texto).toContain('CORREGIDO EN LA ORDEN 2-A');
  });

  it('ya no se afirma que un pm_ nuevo daría 409 en bucle', () => {
    // El backend EXCLUYE la fuente del hash a propósito: ese 409 no ocurre.
    expect(pantalla()).not.toContain('daría 409 idempotency_conflict en bucle');
  });
});
