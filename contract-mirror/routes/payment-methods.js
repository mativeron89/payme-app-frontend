/**
 * routes/payment-methods.js — Tarjetas guardadas
 *
 * Fixes:
 *   - F2: endpoint POST /setup-intent para que el frontend cree SetupIntent
 *     y use Stripe Elements para agregar tarjetas nuevas sin cobrar.
 *   - Lifecycle durable: attach/detach y money paths compiten por el mismo
 *     fence; un fallo local se reconcilia por retry y nunca detachea a ciegas.
 */
'use strict';

const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const {
  attachPaymentMethod, setupIntent, uuidIdParam,
  validateBody, validateParams,
} = require('../schemas');
const stripeService = require('../services/stripe');
const cardEligibility = require('../services/cardEligibility');
const paymentMethodLifecycle = require('../services/paymentMethodLifecycle');
const { ensureStripeCustomer } = require('../services/savedCards');
const logger = require('../utils/logger');
const { createHash, randomUUID } = require('crypto');

const router = express.Router();
router.use(requireAuth);

function publicPaymentMethod(row) {
  return {
    id: row.id, stripe_payment_method_id: row.stripe_payment_method_id,
    brand: row.brand, bank_name: row.bank_name, type: row.type,
    last_four: row.last_four, exp_month: row.exp_month, exp_year: row.exp_year,
    is_default: row.is_default,
    display: `${row.bank_name || row.brand} · ${row.type === 'credit' ? 'Crédito' : 'Débito'} · •••• ${row.last_four}`,
  };
}

async function lockKey(client, key, namespace = 0) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, $2))`, [String(key), namespace]);
}

// Orden total para evitar ciclos entre POST, PATCH y DELETE:
// user advisory (namespace 1) -> payment-method advisory (namespace 0) ->
// SELECT ... FOR UPDATE. Stripe siempre queda fuera de la transacción.
async function lockPaymentMethodMutation(client, userId, paymentMethodId) {
  await lockKey(client, userId, 1);
  await paymentMethodLifecycle.lockPaymentMethod(client, paymentMethodId);
}

async function lockStoredPaymentMethodMutation(client, userId, localPaymentMethodId) {
  await lockKey(client, userId, 1);
  const { rows: [identity] } = await client.query(
    `SELECT stripe_payment_method_id FROM payment_methods
      WHERE id=$1 AND user_id=$2`,
    [localPaymentMethodId, userId]
  );
  if (!identity) return null;
  await paymentMethodLifecycle.lockPaymentMethod(
    client, identity.stripe_payment_method_id
  );
  return identity.stripe_payment_method_id;
}

function attachIdempotencyKey(userId, paymentMethodId) {
  return `payme_attach_${createHash('sha256').update(`${userId}:${paymentMethodId}`).digest('hex')}`;
}

function setupIntentIdempotencyKey(userId, customerId, requestKey) {
  if (!requestKey) return undefined;
  return `payme_setup_${createHash('sha256')
    .update(`${userId}:${customerId}:${requestKey}`)
    .digest('hex')}`;
}

function codedError(code, status) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  return error;
}

async function confirmRemoteOwner(customerId, paymentMethodId) {
  let remote;
  try {
    remote = await stripeService.retrievePaymentMethod(paymentMethodId);
  } catch (_) {
    // Los códigos del SDK/proxy no forman parte de nuestro contrato HTTP. Un
    // timeout o error de transporte deja el attach en estado desconocido.
    throw codedError('payment_method_attach_unresolved', 502);
  }
  if (!remote?.customer) throw codedError('payment_method_remote_not_attached', 409);
  if (cardEligibility.remoteId(remote.customer) !== customerId) {
    throw codedError('payment_method_remote_owner_conflict', 409);
  }
  return remote;
}

function assertRemoteCardIdentity(remote, expectedPaymentMethodId) {
  if (cardEligibility.remoteId(remote) !== expectedPaymentMethodId) {
    throw codedError('payment_method_attach_unresolved', 502);
  }
  if (remote.type == null) {
    throw codedError('payment_method_attach_unresolved', 502);
  }
  if (remote.type !== 'card') {
    throw codedError('payment_method_type_not_supported', 422);
  }
}

function snapshotFromPaymentMethodRow(row) {
  if (Number(row?.card_policy_version) !== 1) return null;
  return {
    policyVersion: Number(row.card_policy_version),
    brand: row.card_verified_brand,
    funding: row.card_verified_funding,
    walletType: null,
    verifiedAt: row.card_verified_at,
  };
}

function remoteCardData(remote, expectedPaymentMethodId, {
  expectedCustomerId,
  ownership,
  expectedSnapshot = null,
} = {}) {
  assertRemoteCardIdentity(remote, expectedPaymentMethodId);
  const card = remote.card;
  const issuer = card?.issuer;
  const billingName = remote.billing_details?.name;
  const bankName = issuer || billingName || null;
  const validOptionalString = (value, max) => value == null
    || (typeof value === 'string' && value.length <= max);
  const validOptionalInteger = (value, min, max) => value == null
    || (Number.isInteger(value) && value >= min && value <= max);

  let eligibility;
  try {
    eligibility = cardEligibility.assertEligibleCard(remote, {
      expectedPaymentMethodId,
      expectedCustomerId,
      ownership,
      expectedSnapshot,
      reconciliationCode: 'payment_method_attach_unresolved',
    });
  } catch (err) {
    if (err.code === 'payment_method_card_not_supported') throw err;
    if (err.code === 'payment_method_owner_conflict') {
      throw codedError('payment_method_remote_owner_conflict', 409);
    }
    throw codedError('payment_method_attach_unresolved', 502);
  }
  if (!card
      || typeof card.last4 !== 'string'
      || !/^\d{4}$/.test(card.last4)
      || !validOptionalInteger(card.exp_month, 1, 12)
      || !validOptionalInteger(card.exp_year, 1, 32767)
      || !validOptionalString(bankName, 100)) {
    throw codedError('payment_method_card_data_invalid', 422);
  }
  return {
    brand: eligibility.brand,
    type: eligibility.funding,
    policyVersion: eligibility.policyVersion,
    verifiedAt: eligibility.verifiedAt,
    bankName,
    lastFour: card.last4,
    expMonth: card.exp_month ?? null,
    expYear: card.exp_year ?? null,
  };
}

async function confirmRemoteCardIdentity(customerId, paymentMethodId) {
  const remote = await confirmRemoteOwner(customerId, paymentMethodId);
  assertRemoteCardIdentity(remote, paymentMethodId);
  return remote;
}

async function confirmRemoteCard(customerId, paymentMethodId) {
  const remote = await confirmRemoteCardIdentity(customerId, paymentMethodId);
  return {
    remote,
    cardData: remoteCardData(remote, paymentMethodId, {
      expectedCustomerId: customerId,
      ownership: 'saved',
    }),
  };
}

async function inspectRemoteCardBeforeAttach(customerId, paymentMethodId) {
  let remote;
  try {
    remote = await stripeService.retrievePaymentMethod(paymentMethodId);
  } catch (_) {
    throw codedError('payment_method_attach_unresolved', 502);
  }
  return {
    remote,
    cardData: remoteCardData(remote, paymentMethodId, {
      expectedCustomerId: customerId,
      ownership: 'typed_user',
    }),
  };
}

async function refreshLockedActivePaymentMethod(client, {
  row,
  userId,
  customerId,
  paymentMethodId,
  remote,
  setAsDefault,
}) {
  if (!row || row.user_id !== userId || row.status !== 'active') {
    throw codedError(
      row?.user_id && row.user_id !== userId
        ? 'payment_method_owned_by_another_user'
        : 'payment_method_not_attachable',
      409
    );
  }
  const cardData = remoteCardData(remote, paymentMethodId, {
    expectedCustomerId: customerId,
    ownership: 'saved',
    expectedSnapshot: snapshotFromPaymentMethodRow(row),
  });
  if (Number(row.card_policy_version) === 0) {
    await client.query(
      `UPDATE payment_methods
          SET card_policy_version=$2, card_verified_brand=$3,
              card_verified_funding=$4, card_verified_at=$5
        WHERE id=$1 AND card_policy_version=0`,
      [row.id, cardData.policyVersion, cardData.brand,
       cardData.type, cardData.verifiedAt]
    );
  }
  if (setAsDefault) {
    await client.query(
      `UPDATE payment_methods SET is_default=false
        WHERE user_id=$1 AND status='active' AND id<>$2`,
      [userId, row.id]
    );
    await client.query(
      `UPDATE payment_methods SET is_default=true
        WHERE id=$1 AND user_id=$2 AND status='active'`,
      [row.id, userId]
    );
  }
  const { rows: [current] } = await client.query(
    `SELECT id, user_id, stripe_payment_method_id, brand, bank_name, type,
            last_four, exp_month, exp_year, is_default, status,
            card_policy_version, card_verified_brand,
            card_verified_funding, card_verified_at
       FROM payment_methods
      WHERE id=$1 AND user_id=$2 AND status='active'`,
    [row.id, userId]
  );
  if (!current) throw codedError('payment_method_not_attachable', 409);
  return current;
}

async function convergeActivePaymentMethod({
  userId, customerId, paymentMethodId, remote, setAsDefault,
}) {
  return pool.tx(async (client) => {
    await lockPaymentMethodMutation(client, userId, paymentMethodId);
    const { rows: [row] } = await client.query(
      `SELECT id, user_id, stripe_payment_method_id, brand, bank_name, type,
              last_four, exp_month, exp_year, is_default, status,
              card_policy_version, card_verified_brand,
              card_verified_funding, card_verified_at
         FROM payment_methods
        WHERE stripe_payment_method_id=$1 FOR UPDATE`,
      [paymentMethodId]
    );
    return refreshLockedActivePaymentMethod(client, {
      row, userId, customerId, paymentMethodId, remote, setAsDefault,
    });
  });
}

async function reservePaymentMethodAttach({
  userId, customerId, paymentMethodId, inspected,
}) {
  return pool.tx(async (client) => {
    await lockPaymentMethodMutation(client, userId, paymentMethodId);
    await paymentMethodLifecycle.assertNoActiveUseAfterLock(client, paymentMethodId);
    const { rows: [row] } = await client.query(
      `SELECT id,user_id,stripe_payment_method_id,brand,bank_name,type,
              last_four,exp_month,exp_year,is_default,status,
              card_policy_version,card_verified_brand,
              card_verified_funding,card_verified_at
         FROM payment_methods
        WHERE stripe_payment_method_id=$1 FOR UPDATE`,
      [paymentMethodId]
    );
    if (row) {
      if (row.user_id !== userId) {
        throw codedError('payment_method_owned_by_another_user', 409);
      }
      if (row.status === 'active') return { state: 'active', row };
      if (row.status !== 'attaching') {
        throw codedError('payment_method_not_attachable', 409);
      }
      remoteCardData(inspected.remote, paymentMethodId, {
        expectedCustomerId: customerId,
        ownership: 'typed_user',
        expectedSnapshot: snapshotFromPaymentMethodRow(row),
      });
      return { state: 'owner', row };
    }

    const card = inspected.cardData;
    const { rows: [reserved] } = await client.query(
      `INSERT INTO payment_methods
         (user_id,stripe_payment_method_id,brand,bank_name,type,last_four,
          exp_month,exp_year,is_default,status,card_policy_version,
          card_verified_brand,card_verified_funding,card_verified_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false,'attaching',$9,$10,$11,$12)
       RETURNING id,user_id,stripe_payment_method_id,brand,bank_name,type,
                 last_four,exp_month,exp_year,is_default,status,
                 card_policy_version,card_verified_brand,
                 card_verified_funding,card_verified_at`,
      [userId, paymentMethodId, card.brand, card.bankName, card.type,
       card.lastFour, card.expMonth, card.expYear, card.policyVersion,
       card.brand, card.type, card.verifiedAt]
    );
    return { state: 'owner', row: reserved };
  });
}

async function finalizePaymentMethodAttach({
  userId, customerId, paymentMethodId, remote, setAsDefault,
}) {
  return pool.tx(async (client) => {
    await lockPaymentMethodMutation(client, userId, paymentMethodId);
    const { rows: [row] } = await client.query(
      `SELECT id,user_id,stripe_payment_method_id,brand,bank_name,type,
              last_four,exp_month,exp_year,is_default,status,
              card_policy_version,card_verified_brand,
              card_verified_funding,card_verified_at
         FROM payment_methods
        WHERE stripe_payment_method_id=$1 FOR UPDATE`,
      [paymentMethodId]
    );
    if (row?.status === 'active') {
      return {
        method: await refreshLockedActivePaymentMethod(client, {
          row, userId, customerId, paymentMethodId, remote, setAsDefault,
        }),
        replay: true,
      };
    }
    if (!row || row.user_id !== userId || row.status !== 'attaching') {
      throw codedError(row?.user_id && row.user_id !== userId
        ? 'payment_method_owned_by_another_user'
        : 'payment_method_not_attachable', 409);
    }
    remoteCardData(remote, paymentMethodId, {
      expectedCustomerId: customerId,
      ownership: 'saved',
      expectedSnapshot: snapshotFromPaymentMethodRow(row),
    });
    if (setAsDefault) {
      await client.query(
        `UPDATE payment_methods SET is_default=false
          WHERE user_id=$1 AND status='active'`,
        [userId]
      );
    }
    const { rows: [method] } = await client.query(
      `UPDATE payment_methods
          SET status='active',is_default=$3
        WHERE id=$1 AND user_id=$2 AND status='attaching'
      RETURNING id,user_id,stripe_payment_method_id,brand,bank_name,type,
                last_four,exp_month,exp_year,is_default,status,
                card_policy_version,card_verified_brand,
                card_verified_funding,card_verified_at`,
      [row.id, userId, !!setAsDefault]
    );
    if (!method) throw codedError('payment_method_persistence_pending', 503);
    return { method, replay: false };
  });
}

async function setDefault(client, userId, paymentMethodId) {
  const stripePaymentMethodId = await lockStoredPaymentMethodMutation(
    client, userId, paymentMethodId
  );
  if (!stripePaymentMethodId) {
    throw codedError('payment_method_not_found', 404);
  }
  const { rowCount } = await client.query(
    `SELECT 1 FROM payment_methods WHERE id=$1 AND user_id=$2 AND status='active' FOR UPDATE`,
    [paymentMethodId, userId]
  );
  if (rowCount !== 1) { const e = new Error('payment_method_not_found'); e.status = 404; e.code = 'payment_method_not_found'; throw e; }
  await client.query(`UPDATE payment_methods SET is_default=false WHERE user_id=$1 AND status='active'`, [userId]);
  const updated = await client.query(`UPDATE payment_methods SET is_default=true WHERE id=$1 AND user_id=$2 AND status='active'`,
    [paymentMethodId, userId]);
  if (updated.rowCount !== 1) { const e = new Error('payment_method_not_found'); e.status = 404; e.code = 'payment_method_not_found'; throw e; }
}

async function reactivateAfterDetachFailure(userId, paymentMethodId, leaseId) {
  return pool.tx(async (client) => {
    await lockStoredPaymentMethodMutation(client, userId, paymentMethodId);
    // `is_default` se conserva mientras está detaching (el índice parcial no
    // lo cuenta). Si otro PATCH eligió una activa, esta restauración no intenta
    // crear un segundo default.
    const restored = await client.query(
      `UPDATE payment_methods p SET status='active',
          is_default = CASE WHEN EXISTS (
            SELECT 1 FROM payment_methods a
             WHERE a.user_id=p.user_id AND a.status='active' AND a.is_default
          ) THEN false ELSE p.is_default END
        , detach_lease_id=NULL, detach_lease_expires_at=NULL
        WHERE p.id=$1 AND p.user_id=$2 AND p.status='detaching' AND p.detach_lease_id=$3`,
      [paymentMethodId, userId, leaseId]
    );
    if (restored.rowCount === 1) return 'restored';
    const { rows: [current] } = await client.query(
      `SELECT status FROM payment_methods WHERE id=$1 AND user_id=$2`, [paymentMethodId, userId]
    );
    return current?.status === 'removed' ? 'removed' : 'unresolved';
  });
}

async function finalizeRemoved(userId, paymentMethodId, leaseId) {
  return pool.tx(async (client) => {
    await lockStoredPaymentMethodMutation(client, userId, paymentMethodId);
    const { rows: [current] } = await client.query(
      `SELECT status FROM payment_methods WHERE id=$1 AND user_id=$2 FOR UPDATE`, [paymentMethodId, userId]
    );
    if (current?.status === 'removed') return 'removed';
    if (current?.status !== 'detaching') return 'unresolved';
    const changed = await client.query(
      `UPDATE payment_methods SET status='removed', is_default=false
        , detach_lease_id=NULL, detach_lease_expires_at=NULL
        WHERE id=$1 AND user_id=$2 AND status='detaching' AND detach_lease_id=$3`, [paymentMethodId, userId, leaseId]
    );
    return changed.rowCount === 1 ? 'removed' : 'unresolved';
  });
}

async function releaseDetachLease(userId, paymentMethodId, leaseId) {
  await pool.tx(async (client) => {
    await lockStoredPaymentMethodMutation(client, userId, paymentMethodId);
    await client.query(
      `UPDATE payment_methods SET detach_lease_expires_at=NOW()
        WHERE id=$1 AND user_id=$2 AND status='detaching' AND detach_lease_id=$3`,
      [paymentMethodId, userId, leaseId]
    );
  });
}

async function waitForDetachOutcome(userId, paymentMethodId) {
  // Otro request posee el lease. Nunca duplicamos I/O a Stripe; esperamos sólo
  // un intervalo pequeño y leemos el estado durable para dar una respuesta
  // honesta/reintentable al cliente. No emitimos 202: el contrato actual de
  // DELETE sólo reconoce éxito cuando `removed:true` está confirmado.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { rows: [row] } = await pool.query(
      `SELECT status FROM payment_methods WHERE id=$1 AND user_id=$2`, [paymentMethodId, userId]
    );
    if (!row || row.status !== 'detaching') return row?.status || 'missing';
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return 'detaching';
}

// ─── POST /setup-intent ───────────────────────────────────
router.post('/setup-intent', validateBody(setupIntent), async (req, res, _next) => {
  let intent;
  try {
    req.user.stripe_customer_id = await ensureStripeCustomer(req.user);
    const idempotencyKey = setupIntentIdempotencyKey(
      req.user.id,
      req.user.stripe_customer_id,
      req.body.idempotency_key
    );
    intent = idempotencyKey
      ? await stripeService.createSetupIntent(req.user.stripe_customer_id, idempotencyKey)
      : await stripeService.createSetupIntent(req.user.stripe_customer_id);
  } catch (err) {
    logger.warn('setup_intent_unresolved', {
      user_id: req.user.id,
      error: err.message,
    });
    return res.status(502).json({ error: 'setup_intent_unresolved', retryable: true });
  }
  res.json(intent);
});

// ─── GET / ────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, stripe_payment_method_id, brand, bank_name, type, last_four,
              exp_month, exp_year, is_default, status, created_at
         FROM payment_methods
        WHERE user_id = $1 AND status = 'active'
        ORDER BY is_default DESC, created_at DESC`, [req.user.id]
    );
    res.json({
      payment_methods: rows.map(publicPaymentMethod),
    });
  } catch (err) { next(err); }
});

// ─── POST / (reserva durable → attach Stripe → promoción local) ─
router.post('/', validateBody(attachPaymentMethod), async (req, res, next) => {
  try {
    const { stripe_payment_method_id, set_as_default } = req.body;
    if (!req.user.stripe_customer_id) {
      return res.status(400).json({ error: 'no_stripe_customer' });
    }

    // El mismo pm_ ya activo para este usuario es un replay seguro; no volver a
    // adjuntarlo ni correr el riesgo de desadjuntar una tarjeta válida después.
    const { rows: existingRows } = await pool.query(
      `SELECT id, user_id, stripe_payment_method_id, brand, bank_name, type, last_four, exp_month, exp_year, is_default, status
         FROM payment_methods WHERE stripe_payment_method_id = $1`,
      [stripe_payment_method_id]
    );
    const existing = existingRows[0];
    if (existing?.status === 'active') {
      if (existing.user_id !== req.user.id) return res.status(409).json({ error: 'payment_method_owned_by_another_user' });
      // No devolvemos un espejo activo si Stripe ya no confirma que pertenece
      // al customer del usuario. Esto también cubre un replay de una respuesta
      // de attach cacheada cuando el PM fue detached entre intentos.
      // Una fila histórica nunca se declara elegible por su espejo local. El
      // replay la promueve únicamente tras verificar la evidencia remota.
      const confirmedExisting = await confirmRemoteCard(
        req.user.stripe_customer_id,
        stripe_payment_method_id
      );
      const converged = await convergeActivePaymentMethod({
        userId: req.user.id,
        customerId: req.user.stripe_customer_id,
        paymentMethodId: stripe_payment_method_id,
        remote: confirmedExisting.remote,
        setAsDefault: !!set_as_default,
      });
      return res.status(200).json({
        payment_method: publicPaymentMethod(converged), idempotent: true,
      });
    }
    if (existing && existing.user_id !== req.user.id) {
      return res.status(409).json({ error: 'payment_method_owned_by_another_user' });
    }
    if (existing && existing.status !== 'attaching') {
      return res.status(409).json({ error: 'payment_method_not_attachable' });
    }

    // Validar el objeto, ownership y metadata ANTES de cualquier attach. Un PM
    // inequívocamente no soportado no debe quedar adjunto/orphan en Stripe.
    const inspected = await inspectRemoteCardBeforeAttach(
      req.user.stripe_customer_id,
      stripe_payment_method_id
    );

    // El estado `attaching` es el lease durable. Se materializa bajo el mismo
    // advisory lock que usan pagos/garantías al sellar su source; desde este
    // COMMIT hasta la convergencia remota ningún flujo puede reclasificar el
    // pm_ como typed. No se sostiene una tx durante Stripe.
    let reservation;
    try {
      reservation = await reservePaymentMethodAttach({
        userId: req.user.id,
        customerId: req.user.stripe_customer_id,
        paymentMethodId: stripe_payment_method_id,
        inspected,
      });
    } catch (dbErr) {
      if (dbErr.status && dbErr.code) throw dbErr;
      // Todavia no se llamo a Stripe. Un fallo local desconocido no es un 500
      // ni autoriza continuar sin fence: el cliente puede reintentar y la
      // lectura durable decidira si la reserva llego a commitear.
      logger.error('payment_method_reservation_pending', {
        user_id: req.user.id,
        stripe_pm: stripe_payment_method_id,
        error: dbErr.message,
      });
      throw codedError('payment_method_persistence_pending', 503);
    }
    if (reservation.state === 'active') {
      const confirmedExisting = await confirmRemoteCard(
        req.user.stripe_customer_id,
        stripe_payment_method_id
      );
      const converged = await convergeActivePaymentMethod({
        userId: req.user.id,
        customerId: req.user.stripe_customer_id,
        paymentMethodId: stripe_payment_method_id,
        remote: confirmedExisting.remote,
        setAsDefault: !!set_as_default,
      });
      return res.status(200).json({
        payment_method: publicPaymentMethod(converged), idempotent: true,
      });
    }

    // PASO 1: attach a Stripe
    let pm;
    try {
      pm = await stripeService.attachPaymentMethod(req.user.stripe_customer_id, stripe_payment_method_id,
        attachIdempotencyKey(req.user.id, stripe_payment_method_id));
    } catch (_attachErr) {
      // Timeout/5xx ambiguo: solo convergemos si Stripe confirma ownership por
      // el customer esperado; jamás adjudicamos un pm_ por metadata del cliente.
      try {
        pm = (await confirmRemoteCard(
          req.user.stripe_customer_id,
          stripe_payment_method_id
        )).remote;
      } catch (reconcileErr) {
        if (reconcileErr.code === 'payment_method_remote_not_attached') {
          logger.warn('payment_method_attach_unresolved', {
            user_id: req.user.id, stripe_pm: stripe_payment_method_id,
          });
          throw codedError('payment_method_attach_unresolved', 502);
        }
        if (reconcileErr.status && reconcileErr.code) throw reconcileErr;
        logger.warn('payment_method_attach_unresolved', { user_id: req.user.id, stripe_pm: stripe_payment_method_id });
        throw codedError('payment_method_attach_unresolved', 502);
      }
    }
    // Stripe puede devolver el resultado cacheado para la misma idempotency
    // key aunque el PM ya no esté adjunto. La lectura actual es la única fuente
    // válida antes de crear un espejo `active`.
    const confirmed = await confirmRemoteCard(
      req.user.stripe_customer_id,
      stripe_payment_method_id
    );
    pm = confirmed.remote;
    const { brand, lastFour } = confirmed.cardData;

    // PASO 2: promover el lease durable `attaching` a `active`. El marcador
    // ya existía antes de Stripe; un fallo DB deja un retry convergente, nunca
    // un PM remoto adjunto sin autoridad local ni habilita un detach compensador.
    let result;
    try {
      result = await finalizePaymentMethodAttach({
        userId: req.user.id,
        customerId: req.user.stripe_customer_id,
        paymentMethodId: pm.id,
        remote: confirmed.remote,
        setAsDefault: !!set_as_default,
      });
    } catch (dbErr) {
      if (dbErr.status && dbErr.code) throw dbErr;
      logger.error('payment_method_db_persistence_pending', {
        user_id: req.user.id, stripe_pm: pm.id, error: dbErr.message,
      });
      throw codedError('payment_method_persistence_pending', 503);
    }

    logger.audit('payment_method_attached', {
      user_id: req.user.id, brand, last_four: lastFour,
    });
    res.status(result.replay ? 200 : 201).json({ payment_method: publicPaymentMethod(result.method), ...(result.replay && { idempotent: true }) });
  } catch (err) {
    if (err.status && err.code) return res.status(err.status).json({ error: err.code });
    next(err);
  }
});

router.delete('/:id', validateParams(uuidIdParam), async (req, res, next) => {
  try {
    // Un único lease durable es dueño del I/O remoto. El resto de DELETEs no
    // vuelve a llamar Stripe: espera el estado local y luego converge/reintenta.
    const leaseId = randomUUID();
    const operation = await pool.tx(async (client) => {
      await lockStoredPaymentMethodMutation(client, req.user.id, req.params.id);
      const { rows } = await client.query(
        `SELECT stripe_payment_method_id, status, detach_lease_expires_at FROM payment_methods
          WHERE id = $1 AND user_id = $2 FOR UPDATE`,
        [req.params.id, req.user.id]
      );
      const found = rows[0];
      if (!found) {
        const e = new Error('payment_method_not_found'); e.status = 404; e.code = 'payment_method_not_found'; throw e;
      }
      if (found.status === 'removed') return { state: 'removed', pm: found };
      await paymentMethodLifecycle.assertNoActiveUseAfterLock(
        client, found.stripe_payment_method_id
      );
      if (!['active', 'detaching'].includes(found.status)) {
        const e = new Error('payment_method_delete_conflict'); e.status = 409; e.code = 'payment_method_delete_conflict'; throw e;
      }
      if (found.status === 'active') {
        const changed = await client.query(
          `UPDATE payment_methods SET status='detaching', detach_lease_id=$3,
             detach_lease_expires_at=NOW() + INTERVAL '2 minutes'
            WHERE id=$1 AND user_id=$2 AND status='active'`, [req.params.id, req.user.id, leaseId]
        );
        if (changed.rowCount !== 1) {
          const e = new Error('payment_method_delete_conflict'); e.status = 409; e.code = 'payment_method_delete_conflict'; throw e;
        }
        return { state: 'owner', pm: found };
      }
      const acquired = await client.query(
        `UPDATE payment_methods SET detach_lease_id=$3,
           detach_lease_expires_at=NOW() + INTERVAL '2 minutes'
          WHERE id=$1 AND user_id=$2 AND status='detaching'
            AND (detach_lease_expires_at IS NULL OR detach_lease_expires_at <= NOW())`,
        [req.params.id, req.user.id, leaseId]
      );
      return { state: acquired.rowCount === 1 ? 'owner' : 'waiting', pm: found };
    });
    if (operation.state === 'removed') return res.json({ removed: true });
    if (operation.state === 'waiting') {
      const outcome = await waitForDetachOutcome(req.user.id, req.params.id);
      if (outcome === 'removed') return res.json({ removed: true });
      if (outcome === 'active') return res.status(502).json({ error: 'payment_method_detach_failed' });
      return res.status(503).json({ error: 'payment_method_detach_pending' });
    }
    const pm = operation.pm;

    try { await stripeService.detachPaymentMethod(pm.stripe_payment_method_id); }
    catch (e) {
      // 404/resource_missing puede ser un detach ya confirmado cuya respuesta se
      // perdió. Si Stripe permite leerlo y no tiene customer, también es seguro
      // reconciliar el espejo como removed y hacer el DELETE reintentable.
      let detached = e.code === 'resource_missing' || e.statusCode === 404;
      if (!detached) {
        try { detached = !(await stripeService.retrievePaymentMethod(pm.stripe_payment_method_id)).customer; }
        catch (_) { /* resultado remoto desconocido: no mentir localmente */ }
      }
      if (!detached) {
        let remote;
        try { remote = await stripeService.retrievePaymentMethod(pm.stripe_payment_method_id); }
        catch (_) {
          await releaseDetachLease(req.user.id, req.params.id, leaseId);
          logger.warn('stripe_detach_unresolved', { stripe_pm: pm.stripe_payment_method_id });
          return res.status(502).json({ error: 'payment_method_detach_pending' });
        }
        if (remote?.customer === req.user.stripe_customer_id) {
          const restored = await reactivateAfterDetachFailure(req.user.id, req.params.id, leaseId);
          if (restored === 'removed') return res.json({ removed: true });
          if (restored === 'restored') return res.status(502).json({ error: 'payment_method_detach_failed' });
        }
        await releaseDetachLease(req.user.id, req.params.id, leaseId);
        logger.warn('stripe_detach_ambiguous', { stripe_pm: pm.stripe_payment_method_id });
        return res.status(502).json({ error: 'payment_method_detach_pending' });
      }
    }

    const finalized = await finalizeRemoved(req.user.id, req.params.id, leaseId);
    if (finalized !== 'removed') return res.status(502).json({ error: 'payment_method_detach_pending' });
    res.json({ removed: true });
  } catch (err) {
    if (err.status && err.code) return res.status(err.status).json({ error: err.code });
    next(err);
  }
});

router.patch('/:id/default', validateParams(uuidIdParam), async (req, res, next) => {
  try {
    await pool.tx(async (client) => {
      await setDefault(client, req.user.id, req.params.id);
    });
    res.json({ updated: true });
  } catch (err) {
    if (err.status && err.code) return res.status(err.status).json({ error: err.code });
    next(err);
  }
});

module.exports = router;
