/**
 * Fence durable del ciclo de vida de un PaymentMethod.
 *
 * Stripe nunca se llama dentro de estas transacciones. El lock asesorado sólo
 * decide qué estado durable gana:
 *   - uso nuevo: la mesa/attempt sella el source antes de cualquier I/O remoto;
 *   - attach/detach: `payment_methods.status` deja `attaching`/`detaching`.
 *
 * Una mutación no puede empezar mientras un source todavía sea necesario para
 * clonar o bindear su PaymentIntent. Una operación de dinero tampoco puede
 * sellar un PM que ya entró en mutación.
 */
'use strict';

function lifecycleError(code, status = 409) {
  return Object.assign(new Error(code), { code, status });
}

async function lockPaymentMethod(client, stripePaymentMethodId) {
  if (typeof stripePaymentMethodId !== 'string'
      || stripePaymentMethodId.trim().length === 0) {
    throw lifecycleError('payment_method_lifecycle_invalid', 503);
  }
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
    [stripePaymentMethodId]
  );
}

async function activeUseFence(client, stripePaymentMethodId) {
  const { rows: [row] } = await client.query(
    `SELECT kind, entity_id FROM (
       SELECT 'guarantee'::text AS kind, m.id AS entity_id, m.created_at
         FROM mesas m
        WHERE m.auth_source_payment_method_id=$1
          AND m.guarantee_mode=true
          AND m.status='pending_auth'
          AND m.auth_payment_intent_id IS NULL
          AND (m.auth_stripe_account_id IS NULL
               OR m.auth_charge_payment_method_id IS NULL)
       UNION ALL
       SELECT 'payment'::text, pa.id, pa.created_at
         FROM payment_attempts pa
        WHERE pa.stripe_source_payment_method_id=$1
          AND pa.operation_type='mesa_pay'
          AND pa.payment_type='card'
          AND pa.status NOT IN ('processed','refunded','failed','cancelled')
          AND pa.stripe_payment_intent_id IS NULL
          AND (pa.stripe_account_id IS NULL
               OR pa.stripe_charge_payment_method_id IS NULL)
     ) fences
     ORDER BY created_at, entity_id
     LIMIT 1`,
    [stripePaymentMethodId]
  );
  return row || null;
}

async function assertNoActiveUseAfterLock(client, stripePaymentMethodId) {
  const fence = await activeUseFence(client, stripePaymentMethodId);
  if (fence) {
    const error = lifecycleError('payment_method_in_use');
    error.details = { kind: fence.kind, entity_id: fence.entity_id };
    throw error;
  }
}

async function assertLifecycleMutationCanStart(client, stripePaymentMethodId) {
  await lockPaymentMethod(client, stripePaymentMethodId);
  await assertNoActiveUseAfterLock(client, stripePaymentMethodId);
}

async function assertPaymentMethodUseCanSeal(client, {
  stripePaymentMethodId,
  userId = null,
  savedPaymentMethodId = null,
}) {
  await lockPaymentMethod(client, stripePaymentMethodId);
  const { rows: [row] } = await client.query(
    `SELECT id,user_id,stripe_payment_method_id,status
       FROM payment_methods
      WHERE stripe_payment_method_id=$1
      FOR UPDATE`,
    [stripePaymentMethodId]
  );

  if (savedPaymentMethodId) {
    if (!row) throw lifecycleError('payment_method_not_found', 404);
    if (row.id !== savedPaymentMethodId || row.user_id !== userId) {
      throw lifecycleError('payment_method_owned_by_another_user');
    }
    if (row.status !== 'active') {
      throw lifecycleError('payment_method_lifecycle_conflict');
    }
    return row;
  }

  // Un pm_ crudo sólo puede sellarse como typed mientras no exista ninguna
  // autoridad local sobre él. `attaching` también cuenta: esa fila es el lease
  // durable que evita que un POST concurrente cambie ownership tras validar.
  if (row) throw lifecycleError('payment_method_requires_saved_reference');
  return null;
}

module.exports = {
  activeUseFence,
  assertLifecycleMutationCanStart,
  assertNoActiveUseAfterLock,
  assertPaymentMethodUseCanSeal,
  lifecycleError,
  lockPaymentMethod,
};
