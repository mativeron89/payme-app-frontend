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
