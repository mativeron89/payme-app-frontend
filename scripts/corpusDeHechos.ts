/**
 * D268 · S-03 · las ENTRADAS sintéticas de los hechos del dueño. Las usan dos:
 *
 * - `generar-hechos-del-dueno.mjs`, que corre SÓLO EN LOCAL con el repo del
 *   dueño: ejecuta su código sobre estas entradas y guarda las salidas en
 *   `hechos-del-dueno.json`;
 * - las pruebas del front, que corren lo suyo sobre las MISMAS entradas y
 *   comparan contra esas salidas.
 *
 * Son datos inventados para probar —ni de una cuenta, ni de un restaurante, ni
 * secretos— y no hay código del dueño acá: sólo lo que se le pregunta.
 */

export const ITEMS = [
  { name: 'Pizza', category: 'italian', price_cents: 30000, quantity: 1 },
  { name: 'Flan', category: 'dessert', price_cents: 20000, quantity: 1 },
];

/**
 * La identidad de una apertura de mesa (`payloadHash`, `create_mesa`). Cada
 * entrada existe por una razón: o es un caso del flujo real, o es una forma que
 * rompería una réplica descuidada (orden, tipos mezclados, anidamiento,
 * ausencias, unicode, arrays de primitivos).
 */
export const CORPUS_IDENTIDAD: ReadonlyArray<{ readonly nombre: string; readonly payload: unknown }> = [
  { nombre: 'request de apertura completo', payload: {
    restaurant_id: '11111111-1111-4111-8111-111111111111',
    total_cents: 50000,
    division_mode: 'consumo',
    expected_participants: 3,
    guarantee_method: 'card',
    idempotency_key: 'clave-uno',
    stripe_payment_method_id: 'pm_uno',
    save_payment_method: true,
    items: ITEMS,
  } },
  { nombre: 'los mismos ítems al revés', payload: {
    restaurant_id: '11111111-1111-4111-8111-111111111111',
    total_cents: 50000,
    division_mode: 'consumo',
    expected_participants: 3,
    guarantee_method: 'card',
    items: [...ITEMS].reverse(),
  } },
  { nombre: 'claves del objeto en otro orden', payload: {
    items: ITEMS,
    guarantee_method: 'card',
    expected_participants: 3,
    division_mode: 'consumo',
    total_cents: 50000,
    restaurant_id: '11111111-1111-4111-8111-111111111111',
  } },
  { nombre: 'sin ítems', payload: {
    restaurant_id: 'r', total_cents: 1, division_mode: 'igual',
    expected_participants: 2, guarantee_method: 'card', items: [],
  } },
  { nombre: 'una clave del subset ausente', payload: {
    restaurant_id: 'r', total_cents: 1, items: ITEMS,
  } },
  { nombre: 'una clave del subset en undefined', payload: {
    restaurant_id: 'r', total_cents: 1, division_mode: undefined, items: ITEMS,
  } },
  { nombre: 'una clave del subset en null', payload: {
    restaurant_id: 'r', total_cents: 1, division_mode: null, items: ITEMS,
  } },
  { nombre: 'ítems con claves opcionales distintas', payload: {
    restaurant_id: 'r', total_cents: 2, items: [
      { name: 'A', price_cents: 1, quantity: 1 },
      { name: 'B', price_cents: 1, quantity: 1, category: 'other' },
    ],
  } },
  { nombre: 'ítems anidados', payload: {
    restaurant_id: 'r', items: [{ name: 'A', meta: { a: 1, b: [2, 3] } }],
  } },
  { nombre: 'ítems como primitivos (camino sin objetos)', payload: {
    restaurant_id: 'r', items: ['b', 'a', 10, 2],
  } },
  { nombre: 'ítems mezclando primitivos y objetos', payload: {
    restaurant_id: 'r', items: ['b', { name: 'A' }, 1],
  } },
  { nombre: 'ítems con null adentro', payload: {
    restaurant_id: 'r', items: [null, { name: 'A' }],
  } },
  { nombre: 'unicode y comillas', payload: {
    restaurant_id: 'La "Parolaccia" · ñandú 🍕',
    items: [{ name: 'Tiramisú "clásico"', price_cents: 1, quantity: 1 }],
  } },
  { nombre: 'números en los bordes', payload: {
    restaurant_id: 'r', total_cents: Number.MAX_SAFE_INTEGER, expected_participants: 0,
  } },
  { nombre: 'payload vacío', payload: {} },
  { nombre: 'payload nulo', payload: null },
  { nombre: 'sólo claves ajenas al subset', payload: {
    idempotency_key: 'x', stripe_payment_method_id: 'pm_y', save_payment_method: false,
  } },
];

/** El bug de plata que `sortSinPerderInfo` evita: dos fracciones distintas no pueden hashear igual. */
export const FRACCIONES_MITADES = { items: [{ n: 'A', f: 0.5 }, { n: 'B', f: 0.25 }] };

/** Las versiones de hash de `mesa_pay` que se le preguntan al dueño (`null` = ausente). */
export const VERSIONES_MESA_PAY: ReadonlyArray<number | null> = [null, 1, 2, 99];

/**
 * «Qué comes» por ingredientes (`armarIngredientes`). El clasificador real no
 * está en el inventario: éste es un doble fijo, que clasifica por el nombre
 * normalizado como el real.
 */
export const GRUPO_DE_PLATO: Readonly<Record<string, string>> = { arrachera: 'meat', flan: 'dessert', mezcal: 'alcohol', pozole: 'nuevo_grupo' };

export const RESTAURANTES_INGREDIENTES = [
  { id: 'r1', visits: [
    { items: [{ name: 'Arrachera', amount_cents: 30000 }, { name: 'Mezcal', amount_cents: 9000 }] },
    { items: [{ name: ' arrachera ', amount_cents: 30000 }, { name: 'Flan', amount_cents: 7000 }, { name: 'Pan', amount_cents: 2000 }] },
  ] },
  { id: 'r2', visits: [
    { items: [{ name: 'Arrachera', amount_cents: 32000 }, { name: 'Pozole', amount_cents: 15000 }] },
  ] },
];
