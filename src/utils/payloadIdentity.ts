/**
 * IDENTIDAD ECONÓMICA DE UN REQUEST — réplica EXACTA de
 * `payme-app-backend/utils/idempotency.js` (espejado en
 * `contract-mirror/utils/idempotency.js`, contenido `87a9a74`, v2.70.0).
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
   * G-37 · identidad económica vigente de un pago nuevo (hash_version >= 2).
   * La fuente de pago se sella durablemente fuera del hash; los intentos
   * históricos v1 conservan `mesa_pay_legacy` del lado del dueño.
   */
  mesa_pay: [
    'payment_type',
    'item_ids',
    'items',
    'tip_cents',
    'tip_bps',
    'tip_to_staff_id',
  ],
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

/** Selector publicado por el dueño para `payment_attempts.idempotency_hash_version`. */
export const IDEMPOTENCY_IDENTITY_CONTRACT = {
  mesa_pay: {
    selector_field: 'payment_attempts.idempotency_hash_version',
    legacy_default_if_missing: 1,
    default_for_new: 2,
    keysets: {
      legacy_before_version: 2,
      legacy: 'mesa_pay_legacy',
      current_from_version: 2,
      current: 'mesa_pay',
    },
  },
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
 * G-37 cerrado owner-first: el dueño publicó selector y vectores canónicos.
 * Los intentos NUEVOS del front se sellan como v2 y por eso usan `mesa_pay`;
 * los journals locales viejos siguen distinguidos por `fpv` y las filas v1
 * históricas siguen seleccionando `mesa_pay_legacy` dentro del backend.
 */
export function economicKeysFor(operation: string): readonly string[] | null {
  if (operation === 'create_mesa') return PAYLOAD_KEYS.create_mesa;
  if (operation.startsWith('mesa_pay:')) return PAYLOAD_KEYS.mesa_pay;
  return null;
}
