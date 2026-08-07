/**
 * IDENTIDAD ECONÓMICA DE UN REQUEST — réplica EXACTA de
 * `payme-app-backend/utils/idempotency.js` (espejado en
 * `contract-mirror/utils/idempotency.js`, commit `ea31324`, v2.48.0).
 *
 * ## Por qué este archivo existe
 *
 * El journal monetario de este front sellaba el intento con
 * `sha256(JSON.stringify(request))` — **el request ENTERO**. El dueño hashea
 * un SUBCONJUNTO declarado (`PAYLOAD_KEYS`) y **deja la fuente de pago afuera
 * a propósito**. Sus palabras, en el artefacto de vectores:
 *
 * > *"incluirla haría que un reload con tarjeta tipeada rotara la clave y
 * > abriera una SEGUNDA mesa con un SEGUNDO hold — el bug B-06."*
 *
 * Con el fingerprint grueso, el organizador que perdía la pestaña durante el
 * 3DS con tarjeta tipeada no podía reenviar: Stripe.js materializa otro `pm_`
 * por invocación, el request cambiaba, y `prepareMonetaryRequest` cortaba con
 * `monetary_payload_ambiguous`. Fallaba cerrado —cortaba, no duplicaba— pero
 * **trababa a la persona por una diferencia que no es económica**.
 *
 * ## Qué se replicó y qué NO
 *
 * Se replica el algoritmo completo: `pick` del subset, orden de los arrays sin
 * semántica de orden, canonicalización recursiva con claves ordenadas, y
 * sha256 hexadecimal. **La única diferencia de implementación es el digest**:
 * allá `crypto.createHash`, acá `crypto.subtle` — misma salida, hex en
 * minúsculas.
 *
 * 🔴 **No se replica de memoria y no se acredita contra una tabla:**
 * `scripts/payloadIdentity.mirror.test.ts` corre el JS ESPEJADO del dueño y
 * compara byte a byte contra este archivo sobre un corpus, y
 * `payloadIdentity.vectors.test.ts` acredita la partición contra los 14
 * vectores canónicos. Los dos son necesarios: el artefacto de vectores **no
 * publica el payload base**, así que por sí solo no puede acreditar un hash
 * absoluto — sólo qué cambio conserva la identidad y cuál no.
 */

/**
 * Arrays cuyo orden NO tiene semántica → se ordenan antes de hashear.
 * `items` entró en v2.25 (B-06 §3): reordenar los mismos ítems daba hashes
 * distintos y producía un 409 sobre un pago económicamente IDÉNTICO.
 */
const UNORDERED_ARRAY_KEYS = new Set(['item_ids', 'slot_ids', 'items']);

/**
 * `PAYLOAD_KEYS` del dueño, copiado verbatim. Sólo se replican las
 * operaciones que este front consume por identidad económica; ver el docblock
 * de `economicKeysFor` para las que NO están y por qué.
 */
export const PAYLOAD_KEYS = {
  /**
   * v2.25 (B-06 §4.1) · identidad económica de la MESA. A propósito **NO**
   * incluye la fuente de pago (`stripe_payment_method_id` /
   * `payment_method_id`) ni `save_payment_method`: fuente, off_session y
   * save_pm se sellan durablemente en la mesa antes de Stripe, y un retry no
   * los recalcula desde el payload nuevo.
   */
  create_mesa: [
    'restaurant_id',
    'total_cents',
    'division_mode',
    'expected_participants',
    'guarantee_method',
    'items',
  ],
} as const;

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

/**
 * Representación canónica recursiva: claves ordenadas, sin espacios. Es la
 * misma de `canonicalize()` del dueño, incluido el detalle de que `null` y
 * `undefined` colapsan al literal `'null'`.
 */
export function canonicalizeForHash(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalizeForHash).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalizeForHash(object[key])}`)
    .join(',')}}`;
}

/**
 * Ordena un array sin semántica de orden **SIN destruir información**.
 *
 * ⚠️ El camino de objetos existe por un bug de plata evitado del lado del
 * dueño: `[...v].map(String).sort()` sobre objetos los vuelve a todos
 * `"[object Object]"`, así que pagar «½ de A + ¼ de B» hashearía IGUAL que
 * pagar «A y B enteros» — dos intenciones económicas distintas tratadas como
 * la misma, o sea un cobro que se pierde. Se ordena por la forma canónica de
 * cada elemento, que es inyectiva.
 */
function sortWithoutLosingInfo(value: unknown[]): unknown[] {
  const hasObjects = value.some(isObjectLike);
  if (!hasObjects) return [...value].map(String).sort();
  return [...value]
    .map((item) => ({ item, canonical: canonicalizeForHash(item) }))
    .sort((a, b) => (a.canonical < b.canonical ? -1 : a.canonical > b.canonical ? 1 : 0))
    .map(({ item }) => item);
}

/**
 * El subset normalizado, ya canonicalizado a string. Se expone porque el mock
 * lo usa como detector de conflicto sin pagar un sha256 por request: la forma
 * canónica conserva exactamente la igualdad que el backend aplica ANTES de
 * hashear, y el hash del dueño es `sha256(esta cadena)`.
 */
export function payloadCanonical(payload: unknown, keep: readonly string[]): string {
  const source = (payload ?? {}) as Record<string, unknown>;
  const subset: Record<string, unknown> = {};
  for (const key of keep) {
    if (!Object.prototype.hasOwnProperty.call(source, key) || source[key] === undefined) continue;
    const value = source[key];
    subset[key] = UNORDERED_ARRAY_KEYS.has(key) && Array.isArray(value)
      ? sortWithoutLosingInfo(value)
      : value;
  }
  return canonicalizeForHash(subset);
}

/** sha256 hexadecimal, como `createHash('sha256').digest('hex')` del dueño. */
export async function sha256Hex(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle || typeof TextEncoder === 'undefined') {
    throw new Error('money_crypto_unavailable');
  }
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** `payloadHash(payload, { keep })` del dueño, mismo valor. */
export async function payloadHash(payload: unknown, keep: readonly string[]): Promise<string> {
  return sha256Hex(payloadCanonical(payload, keep));
}

/**
 * Las llaves de una operación del journal, o `null` si esa operación **no
 * tiene identidad económica alineada** y debe seguir con el fingerprint del
 * request entero.
 *
 * 🔴 **Sólo `create_mesa`, y la ausencia del riel de PAGO es deliberada.** El
 * mismo defecto existe en `mesa_pay` —el comentario del dueño lo dice con
 * todas las letras: *"NO incluir: fuente de pago. Stripe.js puede materializar
 * otro pm_ al reintentar una respuesta perdida"*—, pero **el dueño mantiene
 * DOS tablas para ese riel, `mesa_pay` y `mesa_pay_legacy`, y desde acá no se
 * puede saber cuál aplica a un request dado.** Elegir mal produce un hash
 * incorrecto, y un hash incorrecto en este camino **falla cerrado sobre la
 * persona**: exactamente el costo que esta alineación viene a eliminar.
 *
 * Queda registrado como G-37 en `GAPS.md`: para alinear el pago hace falta que
 * el dueño declare cuál tabla aplica y publique sus vectores. Mientras tanto
 * el riel de pago conserva su fingerprint grueso, que es MÁS estricto — traba
 * de más, nunca de menos.
 */
export function economicKeysFor(operation: string): readonly string[] | null {
  return operation === 'create_mesa' ? PAYLOAD_KEYS.create_mesa : null;
}
