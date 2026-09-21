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
        && !Array.from({ length: n }, (_, i) => Number(10000n / BigInt(i + 1)))
          .includes(request.fraction_bps)) {
      throw Object.assign(new Error('fraction_not_allowed_for_original_participants'), { status: 400 });
    }
  }
}
module.exports = { originalParticipants, matchesOriginalParticipants, assertLabelAllowed, displayRestaurantName, validateItemFractions };
