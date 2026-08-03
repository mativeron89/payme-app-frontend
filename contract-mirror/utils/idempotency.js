/**
 * utils/idempotency.js v2.5.2
 *
 * Cambios vs v2.5.1:
 *   - P1 #3: normalización de arrays no ordenados antes de hashear.
 *     `item_ids` y `slot_ids` se ordenan (sort lexicográfico) porque su orden
 *     NO tiene semántica económica. Así, ["A","B"] y ["B","A"] hashean igual.
 *
 * v2.5.1 (se mantiene):
 *   - P0 #3: PAYLOAD_KEYS.mesa_pay NO incluye `lock_tokens`.
 *
 * El hash representa la INTENCIÓN ECONÓMICA del pago.
 */
'use strict';

const { createHash } = require('crypto');

// Arrays cuyo orden NO tiene semántica → se ordenan antes de hashear.
// v2.25 (B-06 §3): se suma `items`. Antes quedaba afuera y reordenar los
// mismos ítems con las mismas fracciones daba hashes distintos → 409 sobre un
// pago económicamente IDÉNTICO. La clave se había agregado en v2.18 para
// detectar FRACCIONES distintas, no ORDEN distinto (y el propio backend ordena
// los ítems internamente antes de procesarlos).
const UNORDERED_ARRAY_KEYS = new Set(['item_ids', 'slot_ids', 'items']);

function pick(obj, keys) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, k) && obj[k] !== undefined) {
      out[k] = obj[k];
    }
  }
  return out;
}

/**
 * Normaliza el subset antes de canonicalizar:
 *   - ordena arrays cuyo key está en UNORDERED_ARRAY_KEYS
 *   - clona para no mutar el input
 */
/**
 * Ordena un array sin semántica de orden, SIN destruir información.
 *
 * ⚠️ El camino de objetos existe por un bug de plata evitado: hacer
 * `[...v].map(String).sort()` sobre objetos los convierte a todos en
 * `"[object Object]"`, así que pagar «½ de A + ¼ de B» hashearía IGUAL que
 * pagar «A y B enteros» — dos intenciones económicas distintas tratadas como
 * la misma, o sea un cobro que se pierde. Se ordena por la forma CANÓNICA de
 * cada elemento (claves ordenadas), que es inyectiva.
 */
function sortSinPerderInfo(arr) {
  const hayObjetos = arr.some((x) => x !== null && typeof x === 'object');
  if (!hayObjetos) return [...arr].map(String).sort();   // primitivos: como siempre
  return [...arr]
    .map((x) => ({ x, k: canonicalize(x) }))
    .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
    .map((p) => p.x);
}

function normalizeForHash(subset) {
  const out = {};
  for (const [k, v] of Object.entries(subset)) {
    if (UNORDERED_ARRAY_KEYS.has(k) && Array.isArray(v)) {
      out[k] = sortSinPerderInfo(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function canonicalize(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  const parts = keys.map(k => JSON.stringify(k) + ':' + canonicalize(value[k]));
  return '{' + parts.join(',') + '}';
}

function payloadHash(payload, { keep } = {}) {
  const subset = keep ? pick(payload, keep) : payload;
  const normalized = normalizeForHash(subset);
  const canonical = canonicalize(normalized);
  return createHash('sha256').update(canonical).digest('hex');
}

function hashesMatch(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

const PAYLOAD_KEYS = {
  mesa_pay: [
    'payment_type',
    'item_ids',         // ordenado antes de hashear (P1 #3)
    'items',            // v2.18 (fracciones): mismo key con otras fracciones → conflicto
    'tip_cents',
    'tip_bps',          // D7 (v2.17): mismo idempotency_key con otro % → conflicto
    'tip_to_staff_id',
    // NO incluir: lock_tokens (estado temporal del lock)
    // NO incluir: fuente de pago. Stripe.js puede materializar otro pm_ al
    // reintentar una respuesta perdida; el attempt sella durablemente la fuente
    // ganadora antes del cargo. Cambiar deliberadamente de fuente exige otra
    // idempotency key una vez reconciliado el intento anterior.
  ],
  mesa_pay_legacy: [
    'payment_method_id', 'stripe_payment_method_id', 'payment_type',
    'item_ids', 'items', 'tip_cents', 'tip_bps', 'tip_to_staff_id',
  ],
  // v2.25 (B-06 §4.1): identidad económica de la MESA.
  // A propósito NO incluye la fuente de pago (`stripe_payment_method_id` /
  // `payment_method_id`): con tarjeta tipeada, Stripe.js devuelve un `pm_`
  // distinto por invocación, así que incluirlo haría que el reintento diera
  // 409 → el front rotaría la clave → segunda mesa con segundo hold, que es
  // EXACTAMENTE el bug que este campo viene a cerrar. Fuente, off_session y
  // save_pm se sellan durablemente en la mesa antes de Stripe; un retry no los
  // recalcula desde el payload nuevo.
  create_mesa: [
    'restaurant_id',
    'total_cents',
    'division_mode',
    'expected_participants',
    'guarantee_method',
    'items',            // ordenado antes de hashear
  ],
  topup_oxxo: ['amount_cents'],
  topup_card: ['amount_cents', 'payment_method_id'],
  transfer: ['amount_cents', 'to_payme_id', 'to_email', 'to_user_id', 'concept'],
};

module.exports = {
  canonicalize,
  normalizeForHash,
  payloadHash,
  hashesMatch,
  pick,
  PAYLOAD_KEYS,
  UNORDERED_ARRAY_KEYS,
};
