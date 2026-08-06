/**
 * utils/stateMachine.js — FSM v2.10
 *
 * Cambios vs v2.4:
 *   - (FINDING B, PASE3) TRANSITIONS.mesa EXTENDIDO con los estados del flujo de
 *     garantía + liquidación + dispersión: pending_auth, settling, settled,
 *     dispersing, completed, auth_failed. El cambio es ADITIVO (solo agrega
 *     estados/targets), nunca quita transiciones previas → no puede introducir
 *     un throw que antes no existía.
 *
 * Settlement registra las transiciones de liquidación. Cuando el cambio de
 * estado y su auditoría comparten transacción, un fallo del INSERT debe abortar
 * ambos; los callers que declaran una transición observacional fuera de la
 * operación de dominio son responsables de aislarla explícitamente.
 *
 * Cambios v2.4 (se mantienen):
 *   - payment_attempt agrega: requires_action, processing, cancelling
 *   - cancelling es estado intermedio del timer (v2.4 #7)
 *   - processed solo se entra desde succeeded (v2.4 #3)
 */
'use strict';

const pool = require('../db/pool');
const logger = require('./logger');

const TRANSITIONS = {
  mesa: {
    // pending_auth: mesa creada con garantía; hold en pre-autorización (v2.8).
    //   amount_capturable_updated → open ; payment_failed → auth_failed
    // `settling` es la cuarentena fail-closed cuando Stripe informa que el PI
    // legítimo fue capturado/cancelado fuera de nuestra saga (p. ej. por una
    // cuenta Standard). No autoriza refund ni cierre automático.
    pending_auth:    ['open', 'auth_failed', 'settling', 'cancelled'],
    open:            ['partially_paid', 'fully_paid', 'expired', 'settling', 'cancelled'],
    partially_paid:  ['fully_paid', 'expired', 'settling', 'cancelled'],
    fully_paid:      ['settling', 'dispersed'],
    expired:         ['settling', 'cancelled'],
    // settling/settled/dispersing/completed: liquidación + dispersión con garantía (v2.8/v2.9)
    settling:        ['settled'],
    // Cuando Stripe Connect ya liquidó el 100% en la cuenta del restaurante
    // no existe dispersión SPEI: el cierre salta legítimamente a completed.
    settled:         ['dispersing', 'completed'],
    dispersing:      ['completed', 'settled'],   // settled = re-intento de dispersión
    completed:       [],
    auth_failed:     [],
    cancelled:       [],
    dispersed:       [],   // legacy: flujo viejo sin garantía (terminal)
  },
  payment_attempt: {
    // pending: creado local, antes/durante llamada a Stripe
    pending:         ['requires_action', 'processing', 'authorized', 'succeeded',
                      'failed', 'cancelled', 'cancelling'],
    // requires_action: Stripe pide 3DS (frontend confirma con client_secret)
    requires_action: ['processing', 'succeeded', 'failed', 'cancelled', 'cancelling'],
    // processing: Stripe procesando (PI processing). Ej: OXXO mientras espera pago en tienda.
    processing:      ['succeeded', 'failed', 'cancelled', 'cancelling'],
    // authorized: manual capture (no usado en v2.4 — se mantiene por compat con v2.3)
    authorized:      ['processing', 'succeeded', 'failed', 'cancelled', 'cancelling'],
    // succeeded: Stripe confirmó cobro. paymentProcessor SOLO actúa desde acá.
    succeeded:       ['processed', 'refunded'],
    // processed: side-effects aplicados. Terminal salvo refund.
    processed:       ['refunded'],
    // cancelling: timer marcó para cancelar antes de llamar Stripe (lock intermedio)
    // Stripe puede confirmar mientras el worker intenta cancelar; el webhook
    // o el binder sincrónico deben poder registrar que el cobro ganó la carrera.
    cancelling:      ['cancelled', 'failed', 'succeeded'],
    // Stripe puede entregar éxito después de un fallo/cancelación local. El
    // rescate es excepcional pero monetariamente obligatorio y queda auditado.
    failed:          ['succeeded'],
    cancelled:       ['succeeded'],
    refunded:        [],
  },
  mesa_item: {
    available: ['locked'],
    locked:    ['paid', 'released'],
    paid:      [],
    released:  ['locked'],
  },
  dispersal: {
    pending:       ['processing', 'failed', 'manual_review'],
    processing:    ['sent', 'failed', 'retrying'],
    sent:          ['confirmed', 'failed', 'manual_review'],
    retrying:      ['processing', 'failed', 'manual_review'],
    confirmed:     [],
    failed:        ['retrying', 'manual_review'],
    manual_review: ['processing', 'failed'],
  },
  webhook_event: {
    processing: ['processed', 'failed'],
    processed:  [],
    failed:     ['processing'],   // retry
  },
};

// ─── Vitalidad de la mesa · gate de admisión (ratificado 2026-08-06) ────────
// Una mesa está VIVA cuando todavía es una mesa operando: se puede estar en
// ella, pedir y pagar. Deja de estarlo al entrar al cierre (settling y
// sucesores), al vencer, o al terminar sin abrirse (auth_failed/cancelled).
// `fully_paid` está VIVA a propósito (decisión B ratificada: pagada entera
// pero aún no cerrada admite gente — si alguien pide algo más, el que entra
// ya está adentro). El gate se define por lo que la mesa ES, no por una lista
// suelta: la clasificación es EXHAUSTIVA sobre TRANSITIONS.mesa y el test
// tests/invitacion-gate-mesa-viva.test.js la verifica — agregar un estado a
// la FSM sin clasificarlo acá rompe el build, y un estado desconocido NO es
// vivo (fail-closed).
const MESA_ESTADOS_VIVOS = Object.freeze(['open', 'partially_paid', 'fully_paid']);
const MESA_ESTADOS_NO_VIVOS = Object.freeze([
  'pending_auth', 'expired', 'settling', 'settled', 'dispersing',
  'completed', 'auth_failed', 'cancelled', 'dispersed',
]);

function mesaViva(status) {
  return MESA_ESTADOS_VIVOS.includes(status);
}

function canTransition(entityType, from, to) {
  const allowed = TRANSITIONS[entityType]?.[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

async function transition({
  client, entityType, entityId,
  fromState, toState, reason,
  triggeredBy = 'system', metadata = {},
}) {
  if (!canTransition(entityType, fromState, toState)) {
    const err = new Error(`Invalid transition for ${entityType}: ${fromState} → ${toState}`);
    err.code = 'invalid_transition'; err.status = 409;
    throw err;
  }
  const db = client || pool;
  await db.query(
    `INSERT INTO state_transitions
       (entity_type, entity_id, from_state, to_state, reason, triggered_by, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    // v2.18.1: reason TRUNCADO a los 200 de la columna. Sin esto, un mensaje de
    // error largo (los de Stripe superan 200 chars) reventaba el INSERT. El
    // truncado evita esa falla conocida; la atomicidad final la decide el
    // caller según ejecute la transición dentro o fuera de su tx de dominio.
    [entityType, entityId, fromState, toState,
     reason ? String(reason).slice(0, 200) : null, triggeredBy, metadata]
  );
  logger.audit('state_transition', {
    entity_type: entityType, entity_id: entityId,
    from: fromState, to: toState, by: triggeredBy,
  });
}

/**
 * Mapea status de Stripe PaymentIntent a status local.
 * Usado en mesas.js y webhooks.js para guardar el estado REAL de Stripe.
 */
function mapStripeStatus(stripeStatus) {
  switch (stripeStatus) {
    case 'succeeded':                return 'succeeded';
    case 'processing':               return 'processing';
    case 'requires_action':
    case 'requires_confirmation':    return 'requires_action';
    case 'requires_payment_method':  return 'failed';
    case 'requires_capture':         return 'authorized';  // legacy manual capture
    case 'canceled':                 return 'cancelled';
    default:                         return 'pending';
  }
}

module.exports = {
  TRANSITIONS, canTransition, transition, mapStripeStatus,
  MESA_ESTADOS_VIVOS, MESA_ESTADOS_NO_VIVOS, mesaViva,
};
