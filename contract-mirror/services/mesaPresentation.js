'use strict';

// Sólo procedencia registrada al crear: no inferir N de defaults históricos,
// participantes unidos ni cantidades de productos.
function originalParticipants(mesa) {
  const n = mesa?.metadata?.original_participants;
  return Number.isInteger(n) && n >= 1 && n <= 20 ? n : null;
}
function matchesOriginalParticipants(mesa, original) {
  return !Object.prototype.hasOwnProperty.call(mesa.metadata || {}, 'original_participants')
    || mesa.metadata.original_participants === original;
}
function assertLabelAllowed(restaurant, userId) {
  if (!restaurant || restaurant.created_by_user_id !== userId
      || !restaurant.private_identity_key?.startsWith('unknown:')
      || restaurant.rfc || restaurant.name !== 'Restaurante sin identificar') {
    throw Object.assign(new Error('restaurant_label_not_allowed'), { status: 409 });
  }
}
function displayRestaurantName(mesa, name, status) {
  return status === 'unverified' && typeof mesa?.metadata?.restaurant_label === 'string'
    ? mesa.metadata.restaurant_label : name;
}
// 1/k para k=1..N, en bps truncados: el mismo redondeo que `fraction_denominator`
// en consumo (Decisión 005). Una sola definición para consumo e «igual».
function fraccionesPorParticipantes(n) {
  return Array.from({ length: n }, (_, i) => Number(10000n / BigInt(i + 1)));
}
// Máximo de comensales de POST /mesas (schemas/index.js, expected_participants
// .max(20)). Dominio cerrado de la selección informativa: 1/k para k=1..20 más
// 2/3 y 3/4 históricos. El CHECK de db/migrate_informative_fractions_v2.124.0.sql
// y el enum de contract/informative-selections-v2.schema.json son este mismo
// conjunto (un test los compara).
const MAX_PARTICIPANTES = 20;
const FRACCIONES_INFORMATIVAS = Object.freeze(
  [...fraccionesPorParticipantes(MAX_PARTICIPANTES), 6667, 7500].sort((a, b) => a - b)
);
function validateItemFractions(mesa, requests) {
  const n = originalParticipants(mesa);
  for (const request of requests) {
    if (request.fraction_denominator !== undefined) {
      if (mesa.division_mode !== 'consumo') {
        throw Object.assign(new Error('fraction_denominator_consumo_only'), { status: 400 });
      }
      if (n === null) {
        throw Object.assign(new Error('original_participants_unknown'), { status: 409 });
      }
      if (request.fraction_denominator > n) {
        throw Object.assign(new Error('fraction_denominator_exceeds_original'), { status: 400 });
      }
    }
    // Clientes legacy tampoco pueden eludir N conocido con bps. Conservar
    // la conducta histórica cuando falta procedencia; jamás reescribir claims.
    if (mesa.division_mode === 'consumo' && n !== null
        && !fraccionesPorParticipantes(n).includes(request.fraction_bps)) {
      throw Object.assign(new Error('fraction_not_allowed_for_original_participants'), { status: 400 });
    }
  }
}
/**
 * AB-FRACCIONES-IGUAL (Decisión de Mati e9aa0450…): la selección informativa de
 * «igual» acepta lo mismo que consumo. Con N conocido, sólo 1/k para k ≤ N
 * («Otro» es cualquier k ≤ N); sin N, sólo las fracciones legacy y nunca se
 * inventa N. Lo que la persona ya tenía guardado para ese ítem no se invalida
 * al reenviarlo igual (idempotencia; jamás reescribir historia).
 */
function validateInformativeFractions(mesa, items, legacy, guardadas = new Map()) {
  const n = originalParticipants(mesa);
  const permitidas = n === null ? null : fraccionesPorParticipantes(n);
  for (const { item_id: itemId, declared_fraction_bps: bps } of items) {
    if (guardadas.get(itemId) === bps) continue;
    if (permitidas === null) {
      if (!legacy.includes(bps)) {
        throw Object.assign(new Error('original_participants_unknown'),
          { status: 409, code: 'original_participants_unknown' });
      }
    } else if (!permitidas.includes(bps)) {
      throw Object.assign(new Error('fraction_not_allowed_for_original_participants'),
        { status: 400, code: 'fraction_not_allowed_for_original_participants' });
    }
  }
}
module.exports = { originalParticipants, matchesOriginalParticipants, assertLabelAllowed, displayRestaurantName,
  validateItemFractions, validateInformativeFractions, fraccionesPorParticipantes, FRACCIONES_INFORMATIVAS };
