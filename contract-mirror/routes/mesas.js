/**
 * routes/mesas.js v2.5.2
 *
 * Cambios vs v2.5.1:
 *   - P1 #2: guest token hashing en tablas OPERATIVAS.
 *     · payment_attempts.guest_token_hash
 *     · mesa_items.locked_by_guest_token_hash
 *     · mesa_division_slots.claimed_by_guest_token_hash
 *     Para flows NUEVOS de guest: se guarda SOLO el hash (raw = NULL).
 *     Validación/ownership: hash primero, fallback a token crudo (filas legacy).
 *     findExistingAttempt busca por guest_token_hash con fallback a guest_token.
 *
 * v2.5.1 (se mantiene):
 *   - P0 #3: PAYLOAD_KEYS.mesa_pay sin lock_tokens.
 *
 * Invitaciones actuales: autoridad canónica e idempotencia durable; los links
 * v2 son deterministas y firmados, sin token ni hash persistidos.
 */
'use strict';

const express = require('express');
const crypto = require('crypto');
const pool = require('../db/pool');
const {
  requireAuth, guestOrAuth, requireMesaParticipant,
} = require('../middleware/auth');
const schemas = require('../schemas');
const stateMachine = require('../utils/stateMachine');
const stripeService = require('../services/stripe');
const cardEligibility = require('../services/cardEligibility');
const savedCards = require('../services/savedCards');   // D4 (v2.16)
const paymentMethodLifecycle = require('../services/paymentMethodLifecycle');
const itemClaims = require('../services/itemClaims');   // v2.18 (fracciones)
const settlement = require('../services/settlement');
const paymentProcessor = require('../services/paymentProcessor');
const {
  assertPaymentIntentContract,
  loadPaymentAttemptContract,
} = require('../services/paymentIntentContract');
const { centsToDisplay, sumCents, calculateFee, splitEqual, tipFromBps } = require('../utils/money');
const { payloadHash, hashesMatch, PAYLOAD_KEYS } = require('../utils/idempotency');
const { tokenHash } = require('../utils/tokens');
const logger = require('../utils/logger');
const invitationAuthority = require('../services/invitationAuthority');

const router = express.Router();
const { validateBody } = schemas;
const ITEM_LOCK_SECONDS = Number(process.env.ITEM_LOCK_SECONDS) || 600;

function generateMesaCode() {
  // El contrato ya admite 3–5 dígitos. Cinco amplía el espacio global de
  // 9.000 a 90.000 códigos y `randomInt` evita usar Math.random para un token
  // que se comparte. La unicidad real la decide el INSERT, no un SELECT con
  // carrera TOCTOU.
  return `PA-${crypto.randomInt(10_000, 100_000)}`;
}

function generateLockToken() {
  return crypto.randomBytes(18).toString('base64url');
}

// Helper: hash de guest token (o null si no es guest)
function guestHashOf(req) {
  const tok = req.isGuest ? req.guestToken : null;
  return tok ? (req.guestTokenHash || tokenHash(tok)) : null;
}

// v2.23/v2.24 · Connect: el gate de cobro (kill switch + estado de la cuenta)
// vive en services/connect.js — lo comparten el pago de mesa y la garantía.
const connect = require('../services/connect');

function storedPaymentMethodCardSnapshot(row) {
  const snapshot = {
    policyVersion: Number(row?.card_policy_version),
    brand: row?.card_verified_brand,
    funding: row?.card_verified_funding,
    walletType: null,
    verifiedAt: row?.card_verified_at,
  };
  return cardEligibility.isTrustedSnapshot(snapshot) ? snapshot : null;
}

function storedAttemptCardSnapshot(row) {
  const snapshot = {
    policyVersion: Number(row?.card_policy_version),
    brand: row?.card_brand_snapshot,
    funding: row?.card_funding_snapshot,
    walletType: null,
    verifiedAt: row?.card_verified_at,
  };
  return cardEligibility.isTrustedSnapshot(snapshot) ? snapshot : null;
}

function storedMesaCardSnapshot(row) {
  const snapshot = {
    policyVersion: Number(row?.auth_card_policy_version),
    brand: row?.auth_card_brand,
    funding: row?.auth_card_funding,
    walletType: null,
    verifiedAt: row?.auth_card_verified_at,
  };
  return cardEligibility.isTrustedSnapshot(snapshot) ? snapshot : null;
}

// Contrato público de POST /mesas y de su replay idempotente. La fila durable
// contiene IDs de Stripe, ownership, flags y snapshots de elegibilidad que son
// evidencia interna de reconciliación: nunca deben filtrarse por un spread al
// cliente cuando se agregue una columna nueva al INSERT/SELECT.
function publicCreatedMesa(row, status = row?.status) {
  return {
    id: row?.id,
    code: row?.code,
    total_cents: row?.total_cents,
    division_mode: row?.division_mode,
    expected_participants: row?.expected_participants,
    status,
    expires_at: row?.expires_at,
    created_at: row?.created_at,
  };
}

function paymentReconciliationPendingBody(attemptStatus) {
  return {
    error: 'payment_reconciliation_pending',
    ...(attemptStatus && { attempt_status: attemptStatus }),
    retry_with_same_idempotency_key: true,
  };
}

async function promoteSavedCardSnapshot({ row, userId, snapshot }) {
  if (!row?.id || Number(row.card_policy_version) !== 0) return;
  await pool.query(
    `UPDATE payment_methods
        SET card_policy_version=$3, card_verified_brand=$4,
            card_verified_funding=$5, card_verified_at=$6
      WHERE id=$1 AND user_id=$2 AND status='active'
        AND card_policy_version=0`,
    [row.id, userId, snapshot.policyVersion, snapshot.brand,
     snapshot.funding, snapshot.verifiedAt]
  );
}

// ─── POST / (crear mesa) ───────────────────────────────────
router.post('/', requireAuth, validateBody(schemas.createMesa), async (req, res, next) => {
  try {
    const {
      restaurant_id, total_cents, division_mode, expected_participants, items,
      guarantee_method, stripe_payment_method_id,   // v2.11 (parche §1/§2 · garantía)
      payment_method_id, save_payment_method,       // D4 (v2.16): tarjeta guardada
      idempotency_key,                              // B-06 §4.1 (v2.25): opcional
    } = req.body;
    // ── B-06 §4.1 (v2.25): idempotencia de la CREACIÓN ──
    // Sin esto, perder la respuesta después del hold hacía que el reintento
    // creara una SEGUNDA mesa con un SEGUNDO hold por el total — y la mesa
    // fantasma no quedaba colgada: el sweep la liquidaba a los 30 min y la
    // garantía capturaba el total. Doble cobro consumado.
    const mesaHash = idempotency_key
      ? payloadHash(req.body, { keep: PAYLOAD_KEYS.create_mesa })
      : null;
    let mesaPrevia = null;   // mesa existente a la que hay que re-conducir el hold
    if (idempotency_key) {
      const previa = await findExistingMesa(req.user.id, idempotency_key);
      if (previa) {
        if (!hashesMatch(previa.idempotency_payload_hash, mesaHash)) {
          return res.status(409).json({ error: 'idempotency_conflict' });
        }
        // Mesa MUERTA (la garantía falló, se canceló o venció): el request
        // original devolvió 402/error, así que replayarla como 200 haría creer
        // al organizador que tiene mesa. Se responde 409 para que rote la clave
        // y abra una nueva — que es lo que corresponde.
        if (MESA_ESTADOS_MUERTOS.includes(previa.status)) {
          logger.warn('mesa_replay_sobre_estado_muerto', {
            mesa_id: previa.id, status: previa.status, opener: req.user.id,
          });
          return res.status(409).json({
            error: 'idempotency_key_terminal', mesa_status: previa.status,
          });
        }
        // Mesa creada pero SIN PI de garantía: el proceso murió entre el COMMIT
        // y el hold, o después de sellar durablemente el riel `card` pero antes
        // de bindear el resultado de Stripe. Replayarla eternamente dejaría la clave TRABADA y
        // al organizador con una mesa que nunca se puede usar. Se RE-CONDUCE
        // el hold sobre la MISMA mesa — seguro en los dos rieles: en tarjeta la
        // idempotency key de Stripe (`guarantee_${mesaId}`) devuelve el mismo
        // PaymentIntent, y en saldo la reserva es una tx que, si la mesa sigue
        // en pending_auth, nunca llegó a commitear.
        if (previa.status === 'pending_auth' && !previa.auth_payment_intent_id
            && (!previa.auth_method || previa.auth_method === 'card')) {
          logger.warn('mesa_replay_sin_garantia_reconduce', {
            mesa_id: previa.id, opener: req.user.id,
          });
          mesaPrevia = previa;
        } else {
          logger.audit('mesa_create_replay', {
            mesa_id: previa.id, code: previa.code, opener: req.user.id,
          });
          const replay = await mesaReplayResponse(previa);
          return res.status(replay.httpStatus).json(replay.body);
        }
      }
    }

    // La disponibilidad del restaurante decide sólo una creación NUEVA. Un
    // replay exacto puede tener un hold remoto ya creado: aunque el restaurante
    // se haya suspendido, debe reconciliar esa obligación y recuperar el mismo
    // client_secret, no ocultarla detrás de un 404.
    if (!mesaPrevia) {
      const { rowCount: rOk } = await pool.query(
        `SELECT 1 FROM restaurants WHERE id = $1 AND status = 'active'`, [restaurant_id]
      );
      if (rOk === 0) return res.status(404).json({ error: 'restaurant_not_found' });

      // Stripe exige application_fee < monto. Es configuración local y
      // determinista: detectarla antes de leer/crear Customer, mesa o hold
      // evita dejar una `pending_auth` que ningún retry podría reparar.
      if (guarantee_method === 'card') {
        let target;
        try {
          target = await connect.resolveChargeTarget(restaurant_id);
        } catch (error) {
          logger.error('guarantee_target_preflight_failed', {
            restaurant_id, error: error.message,
          });
          return res.status(503).json({
            error: 'connect_charge_target_unavailable',
            retry_with_same_idempotency_key: true,
          });
        }
        if (target) {
          let applicationFee;
          try {
            applicationFee = calculateFee(total_cents, target.feePct);
          } catch (_) {
            applicationFee = NaN;
          }
          if (!Number.isSafeInteger(applicationFee)
              || applicationFee < 0 || applicationFee >= total_cents) {
            logger.error('guarantee_application_fee_preflight_rejected', {
              restaurant_id, amount_cents: total_cents,
            });
            return res.status(422).json({
              error: 'guarantee_configuration_invalid',
              reason: 'application_fee_invalid',
            });
          }
        }
      }
    }

    const { rows: uRows } = await pool.query(
      `SELECT id, stripe_customer_id FROM users WHERE id = $1`, [req.user.id]
    );
    const organizer = uRows[0] || { id: req.user.id };

    // La evidencia remota se resuelve ANTES de crear la mesa. Así un 422 por
    // marca/funding/wallet no deja mesa, hold, outbox ni ningún artefacto. La
    // fuente ganadora se sella en el mismo INSERT de la mesa para que un crash
    // o dos requests concurrentes no puedan recalcularla desde otro body.
    let guaranteePmId = stripe_payment_method_id || null;
    let usedSavedCard = false;
    let guaranteeSavedPaymentMethodId = null;
    let guaranteeCardSnapshot = null;
    const recoveringDurableCard = guarantee_method === 'card'
      && !!mesaPrevia?.auth_source_payment_method_id;
    if (recoveringDurableCard) {
      // El primer intento ya selló source y flags ANTES de Stripe. Un retry no
      // vuelve a consultar la fila viva de payment_methods: pudo ser removida
      // después de un timeout aunque el hold remoto exista bajo la misma key.
      // Tampoco se acepta una fuente nueva del body (el hash deliberadamente la
      // excluye); sólo el snapshot durable puede reconciliar ese PI.
      if (!mesaPrevia.auth_source_payment_method_id
          || !mesaPrevia.auth_stripe_customer_id
          || typeof mesaPrevia.auth_off_session !== 'boolean'
          || typeof mesaPrevia.auth_save_payment_method !== 'boolean'
          || !storedMesaCardSnapshot(mesaPrevia)) {
        return res.status(503).json({
          error: 'guarantee_reconciliation_pending',
          retry_with_same_idempotency_key: true,
        });
      }
      guaranteePmId = mesaPrevia.auth_source_payment_method_id;
      usedSavedCard = mesaPrevia.auth_off_session;
      guaranteeCardSnapshot = storedMesaCardSnapshot(mesaPrevia);
      organizer.stripe_customer_id = mesaPrevia.auth_stripe_customer_id;
    } else if (guarantee_method === 'card') {
      let savedRow = null;
      if (!guaranteePmId && payment_method_id) {
        const { rows: pmRows } = await pool.query(
          `SELECT id,stripe_payment_method_id,card_policy_version,
                  card_verified_brand,card_verified_funding,card_verified_at
             FROM payment_methods
            WHERE id=$1 AND user_id=$2 AND status='active'`,
          [payment_method_id, req.user.id]
        );
        savedRow = pmRows[0] || null;
        guaranteeSavedPaymentMethodId = savedRow?.id || null;
        guaranteePmId = savedRow?.stripe_payment_method_id || null;
        if (!guaranteePmId) {
          return res.status(404).json({ error: 'payment_method_not_found' });
        }
        usedSavedCard = true;
      }
      if (usedSavedCard && !organizer.stripe_customer_id) {
        // Una tarjeta guardada sin Customer durable es inconsistente. Crear un
        // Customer nuevo no acredita ownership y sólo agregaría otro artefacto.
        return res.status(503).json({
          error: 'payment_method_verification_unavailable',
          retry_with_same_idempotency_key: true,
        });
      }
      let verified;
      try {
        verified = await cardEligibility.retrieveEligibleCard({
          paymentMethodId: guaranteePmId,
          expectedCustomerId: organizer.stripe_customer_id,
          ownership: usedSavedCard
            ? 'saved'
            : (organizer.stripe_customer_id ? 'typed_user' : 'typed_guest'),
          expectedSnapshot: storedPaymentMethodCardSnapshot(savedRow),
          reconciliationCode: 'payment_method_verification_unavailable',
        });
      } catch (error) {
        if (error.status === 503) {
          return res.status(503).json({
            error: error.code || 'payment_method_verification_unavailable',
            retry_with_same_idempotency_key: true,
          });
        }
        if (error.status && error.code) {
          return res.status(error.status).json({ error: error.code });
        }
        throw error;
      }
      if (!usedSavedCard && cardEligibility.remoteId(verified.remote.customer)) {
        // Un pm_ crudo ya adjunto exige el flujo durable de /payment-methods.
        // Marcarlo como tipeado perdería esa condición y, en Connect, se
        // intentaría clonar sin Customer: el retry nunca podría converger.
        return res.status(409).json({ error: 'payment_method_requires_saved_reference' });
      }
      guaranteeCardSnapshot = verified.snapshot;
      if (!organizer.stripe_customer_id) {
        // La fuente tipeada ya fue probada como elegible y desadjunta. Sólo
        // ahora se crea/persiste el Customer necesario para el hold.
        try {
          organizer.stripe_customer_id = await savedCards.ensureStripeCustomer(req.user);
        } catch (error) {
          logger.error('guarantee_customer_setup_failed_before_mesa', {
            user_id: req.user.id, error: error.message,
          });
          return res.status(503).json({
            error: 'payment_customer_setup_failed',
            retry_with_same_idempotency_key: true,
          });
        }
      }
      if (savedRow) {
        await promoteSavedCardSnapshot({
          row: savedRow, userId: req.user.id, snapshot: guaranteeCardSnapshot,
        });
      }
    }
    const wantsSaveGuarantee = recoveringDurableCard
      ? mesaPrevia.auth_save_payment_method
      : guarantee_method === 'card' && !!save_payment_method && !usedSavedCard;

    let sum;
    try {
      sum = sumCents(...items.map((item) => itemClaims.lineTotalCents(item.price_cents, item.quantity)));
    } catch (_) {
      return res.status(400).json({ error: 'invalid_line_amount' });
    }
    if (sum !== total_cents) {
      return res.status(400).json({ error: 'total_mismatch', expected: sum, received: total_cents });
    }

    const expiresAt = new Date(Date.now() + (Number(process.env.MESA_HOLD_SECONDS) || 1800) * 1000);

    const insertNewMesa = async () => {
      for (let codeAttempt = 0; codeAttempt < 25; codeAttempt++) {
        const code = generateMesaCode();
        try {
          return await pool.tx(async (client) => {
            if (guarantee_method === 'card') {
              await paymentMethodLifecycle.assertPaymentMethodUseCanSeal(client, {
                stripePaymentMethodId: guaranteePmId,
                userId: req.user.id,
                savedPaymentMethodId: usedSavedCard
                  ? guaranteeSavedPaymentMethodId
                  : null,
              });
            }
            // v2.11 (parche §1 · garantía Modelo B): la mesa nace
            // 'pending_auth' y solo pasa a 'open' cuando el hold quedó autorizado.
            const { rows } = await client.query(
              `INSERT INTO mesas (code, restaurant_id, opener_user_id, total_cents,
                                  division_mode, expected_participants, expires_at, status,
                                  idempotency_key, idempotency_payload_hash,
                                  auth_source_payment_method_id,
                                  auth_stripe_customer_id,auth_off_session,
                                  auth_save_payment_method,
                                  auth_card_policy_version,auth_card_brand,
                                  auth_card_funding,auth_card_verified_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,'pending_auth',$8,$9,
                       $10,$11,$12,$13,$14,$15,$16,$17)
               RETURNING id, code, total_cents, division_mode, expected_participants,
                         status, expires_at, created_at,
                         auth_source_payment_method_id,auth_stripe_customer_id,
                         auth_off_session,auth_save_payment_method,
                         auth_card_policy_version,auth_card_brand,
                         auth_card_funding,auth_card_verified_at`,
              [code, restaurant_id, req.user.id, total_cents, division_mode,
               expected_participants, expiresAt, idempotency_key || null, mesaHash,
               guarantee_method === 'card' ? guaranteePmId : null,
               guarantee_method === 'card' ? organizer.stripe_customer_id : null,
               guarantee_method === 'card' ? usedSavedCard : null,
               guarantee_method === 'card' ? wantsSaveGuarantee : null,
               guarantee_method === 'card' ? guaranteeCardSnapshot.policyVersion : 0,
               guarantee_method === 'card' ? guaranteeCardSnapshot.brand : null,
               guarantee_method === 'card' ? guaranteeCardSnapshot.funding : null,
               guarantee_method === 'card' ? guaranteeCardSnapshot.verifiedAt : null]
            );
            const m = rows[0];
            await client.query(
              `INSERT INTO state_transitions
                 (entity_type, entity_id, from_state, to_state, reason, triggered_by)
               VALUES ('mesa', $1, NULL, 'pending_auth', 'mesa_created_guarantee', 'user')`,
              [m.id]
            );
            for (const it of items) {
              await client.query(
                `INSERT INTO mesa_items (mesa_id, name, category, price_cents, quantity)
                 VALUES ($1,$2,$3,$4,$5)`,
                [m.id, it.name, it.category || 'other', it.price_cents, it.quantity]
              );
            }
            await client.query(
              `INSERT INTO mesa_participants (mesa_id, user_id, role, status)
               VALUES ($1, $2, 'opener', 'active')`,
              [m.id, req.user.id]
            );
            if (division_mode === 'igual') {
              const parts = splitEqual(total_cents, expected_participants);
              for (let i = 0; i < parts.length; i++) {
                await client.query(
                  `INSERT INTO mesa_division_slots (mesa_id, slot_index, amount_cents, status)
                   VALUES ($1, $2, $3, 'available')`,
                  [m.id, i, parts[i]]
                );
              }
            }
            return m;
          });
        } catch (err) {
          if (err.code === '23505' && err.constraint === 'mesas_code_key') {
            logger.warn('mesa_code_collision_retry', { code_attempt: codeAttempt + 1 });
            continue;
          }
          throw err;
        }
      }
      throw Object.assign(new Error('mesa_code_generation_exhausted'), {
        code: 'mesa_code_generation_exhausted', status: 503,
      });
    };

    let mesa;
    try {
      mesa = mesaPrevia || await insertNewMesa();
    } catch (err) {
      if (err.status && typeof err.code === 'string'
          && err.code.startsWith('payment_method_')) {
        return res.status(err.status).json({ error: err.code });
      }
      // Carrera: dos requests con la MISMA clave a la vez. El índice único
      // parcial deja pasar a uno solo; el otro replaya la mesa del ganador en
      // vez de crear la segunda con su segundo hold.
      if (err.code === '23505' && idempotency_key) {
        const ganadora = await findExistingMesa(req.user.id, idempotency_key);
        if (ganadora) {
          if (!hashesMatch(ganadora.idempotency_payload_hash, mesaHash)) {
            return res.status(409).json({ error: 'idempotency_conflict' });
          }
          logger.audit('mesa_create_replay_carrera', {
            mesa_id: ganadora.id, opener: req.user.id,
          });
          if (MESA_ESTADOS_MUERTOS.includes(ganadora.status)) {
            return res.status(409).json({
              error: 'idempotency_key_terminal', mesa_status: ganadora.status,
            });
          }
          // El loser también reconduce el hold. Devolver un replay pending_auth
          // sin PI/client_secret podía ser la única respuesta que veía el
          // cliente y dejarlo trabado aunque el winner muriera antes de Stripe.
          mesa = ganadora;
        } else {
          throw err;
        }
      } else {
        throw err;
      }
    }

    // ── v2.11 (parche §1): hold de garantía FUERA de la tx (nunca Stripe en tx) ──
    // En una carrera idempotente manda el snapshot de la mesa ganadora, no la
    // evidencia que el request perdedor haya observado antes del INSERT.
    if (guarantee_method === 'card') {
      const durableSnapshot = storedMesaCardSnapshot(mesa);
      if (!mesa.auth_source_payment_method_id
          || !mesa.auth_stripe_customer_id
          || typeof mesa.auth_off_session !== 'boolean'
          || typeof mesa.auth_save_payment_method !== 'boolean'
          || !durableSnapshot) {
        return res.status(503).json({
          error: 'guarantee_reconciliation_pending',
          retry_with_same_idempotency_key: true,
        });
      }
      guaranteePmId = mesa.auth_source_payment_method_id;
      organizer.stripe_customer_id = mesa.auth_stripe_customer_id;
      usedSavedCard = mesa.auth_off_session;
      guaranteeCardSnapshot = durableSnapshot;
    }
    const durableWantsSaveGuarantee = guarantee_method === 'card'
      ? mesa.auth_save_payment_method
      : false;

    const hold = await settlement.placeGuaranteeHold({
      mesaId: mesa.id,
      organizer,
      method: guarantee_method,
      stripePaymentMethodId: guaranteePmId,
      amountCents: total_cents,
      offSession: usedSavedCard,     // D4: tarjeta guardada → confirmación off-session
      savePm: durableWantsSaveGuarantee, // D4: guardar la tarjeta tipeada (opt-in)
      sourceCardSnapshot: guaranteeCardSnapshot,
    });

    if (hold.status === 'failed') {
      // la mesa quedó 'auth_failed' (lo marca settlement); D1: no se activa sin garantía
      logger.warn('mesa_guarantee_failed', { mesa_id: mesa.id, reason: hold.reason });
      return res.status(402).json({
        error: 'guarantee_failed',
        reason: hold.reason,
        ...(hold.available !== undefined && { available: hold.available, required: hold.required }),
      });
    }
    if (hold.status === 'reconciliation_pending') {
      logger.error('mesa_guarantee_reconciliation_pending', {
        mesa_id: mesa.id, reason: hold.reason,
      });
      return res.status(503).json({
        error: 'guarantee_reconciliation_pending',
        retry_with_same_idempotency_key: true,
      });
    }

    logger.audit('mesa_created', {
      mesa_id: mesa.id, code: mesa.code, opener: req.user.id,
      guarantee_method, guarantee_status: hold.status,
    });
    res.status(201).json({
      mesa: publicCreatedMesa(
        mesa,
        hold.status === 'open' ? 'open' : 'pending_auth'
      ),
      guarantee: {
        method: guarantee_method,
        status: hold.status,                       // 'open' | 'requires_action' (3DS)
        ...(hold.clientSecret && { client_secret: hold.clientSecret }),
        // v2.24 · si el hold vive en la cuenta del restaurante, el front DEBE
        // inicializar Stripe.js con esta cuenta para confirmar el 3DS.
        ...(hold.connectedAccountId && { connected_account_id: hold.connectedAccountId }),
      },
    });
  } catch (err) { next(err); }
});

router.get('/open', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT m.id, m.code, m.total_cents, m.paid_amount_cents, m.status, m.expires_at,
              r.name AS restaurant_name, r.category
         FROM mesas m JOIN restaurants r ON r.id = m.restaurant_id
        WHERE m.opener_user_id = $1 AND m.status IN ('open','partially_paid')
        ORDER BY m.created_at DESC`, [req.user.id]
    );
    res.json({
      mesas: rows.map(m => ({
        id: m.id, code: m.code,
        full_name: `Mesa ${m.code} - ${m.restaurant_name}`,
        restaurant: { name: m.restaurant_name, category: m.category },
        total_cents: Number(m.total_cents),
        paid_amount_cents: Number(m.paid_amount_cents),
        pct_paid: Number(m.total_cents) > 0
          ? Math.round((Number(m.paid_amount_cents) / Number(m.total_cents)) * 100) : 0,
        status: m.status, expires_at: m.expires_at,
      })),
    });
  } catch (err) { next(err); }
});

router.get('/:code', guestOrAuth, requireMesaParticipant, async (req, res, next) => {
  try {
    const mesa = req.mesa;
    const { rows: items } = await pool.query(
      `SELECT id, name, category, price_cents, quantity, status,
              locked_at, lock_expires_at, locked_by_user_id,
              locked_by_guest_token, locked_by_guest_token_hash
         FROM mesa_items WHERE mesa_id = $1 ORDER BY created_at ASC`, [mesa.id]
    );
    // v2.18 (fracciones): cuánto queda de cada ítem y cuánto tengo yo (vivos =
    // pagados + locked no vencidos). Lectura pura: sin candados.
    const myUserId = req.user?.id || null;
    const myHashF = guestHashOf(req);
    const { rows: claimAgg } = await pool.query(
      `SELECT mesa_item_id,
              COALESCE(SUM(fraction_bps) FILTER (
                WHERE status='paid' OR (status='locked' AND (lock_expires_at IS NULL OR lock_expires_at >= NOW()))
              ), 0)::int AS taken_bps,
              COALESCE(SUM(fraction_bps) FILTER (
                WHERE (status='paid' OR (status='locked' AND (lock_expires_at IS NULL OR lock_expires_at >= NOW())))
                  AND (($2::uuid IS NOT NULL AND locked_by_user_id = $2::uuid)
                       OR ($3::text IS NOT NULL AND locked_by_guest_token_hash = $3::text))
              ), 0)::int AS my_bps
         FROM mesa_item_claims
        WHERE mesa_id = $1
        GROUP BY mesa_item_id`,
      [mesa.id, myUserId, myHashF]
    );
    const claimsByItem = new Map(claimAgg.map((c) => [c.mesa_item_id, c]));
    const { rows: activeStaff } = await pool.query(
      `SELECT id, display_name, role FROM restaurant_staff
        WHERE restaurant_id = $1 AND status = 'active' AND shift_status = 'on'
        ORDER BY display_name ASC`, [mesa.restaurant_id]
    );
    const { rows: rRow } = await pool.query(
      `SELECT name, category, address FROM restaurants WHERE id = $1`, [mesa.restaurant_id]
    );
    const r = rRow[0] || {};

    let slots = null;
    if (mesa.division_mode === 'igual') {
      // ownership del casillero (mismo criterio hash-primero que los ítems)
      const myHashS = guestHashOf(req);
      const myTokenS = req.isGuest ? req.guestToken : null;
      const { rows: sRows } = await pool.query(
        `SELECT slot_index, amount_cents, status,
                claimed_by_user_id, claimed_by_guest_token, claimed_by_guest_token_hash
           FROM mesa_division_slots
          WHERE mesa_id = $1 ORDER BY slot_index ASC`, [mesa.id]
      );
      slots = sRows.map(s => ({
        slot_index: s.slot_index,
        amount_cents: Number(s.amount_cents),
        amount_display: centsToDisplay(Number(s.amount_cents)),
        status: s.status,
        // v2.25 (B-06 §4.3): ¿este casillero es MÍO? Sin esto nadie podía
        // detectar el doble cobro — ni el pagador, ni el organizador, ni
        // soporte — y había asimetría con los ítems, que sí lo dicen (my_bps).
        // Además lo necesita el selector de "pagar varias partes"
        // (acta 2026-07-25). NUNCA se expone quién es el dueño ajeno: solo si
        // soy yo.
        // Solo tiene sentido sobre un casillero TOMADO: un liberado puede
        // conservar rastros del dueño anterior y devolverlo como propio sería
        // mentir (además de invitar a un doble pago).
        claimed_by_me: !['claimed', 'paid'].includes(s.status) ? false
          : req.isGuest
            ? !!((myHashS && s.claimed_by_guest_token_hash === myHashS) ||
                 (myTokenS && s.claimed_by_guest_token === myTokenS))
            : !!(req.user && s.claimed_by_user_id === req.user.id),
      }));
    }

    // v2.5.2 P1 #2: ownership de lock por hash (nuevo) o raw (legacy)
    const myHash = guestHashOf(req);
    const myToken = req.isGuest ? req.guestToken : null;
    const lockedByMe = (i) => {
      if (i.status !== 'locked') return false;
      if (req.isGuest) {
        return (myHash && i.locked_by_guest_token_hash === myHash) ||
               (myToken && i.locked_by_guest_token === myToken);
      }
      return i.locked_by_user_id === req.user.id;
    };

    res.json({
      mesa: {
        id: mesa.id, code: mesa.code,
        full_name: `Mesa ${mesa.code} - ${r.name}`,
        restaurant: { id: mesa.restaurant_id, name: r.name, category: r.category, address: r.address },
        total_cents: Number(mesa.total_cents),
        total_display: centsToDisplay(Number(mesa.total_cents)),
        paid_amount_cents: Number(mesa.paid_amount_cents),
        tip_amount_cents: Number(mesa.tip_amount_cents),
        // D7 (v2.17): base partes-iguales de la propina (total ÷ N declarados),
        // informativo para el picker de % del front. El cobro real usa tipFromBps.
        tip_base_cents: Math.round(Number(mesa.total_cents) / (Number(mesa.expected_participants) || 1)),
        division_mode: mesa.division_mode,
        expected_participants: mesa.expected_participants,
        status: mesa.status, expires_at: mesa.expires_at,
        items: items.map(i => {
          const cl = claimsByItem.get(i.id);
          const takenBps = cl ? Number(cl.taken_bps) : 0;
          const myBps = cl ? Number(cl.my_bps) : 0;
          return {
            id: i.id, name: i.name, category: i.category,
            price_cents: Number(i.price_cents), quantity: i.quantity, status: i.status,
            // v2.18 (fracciones): disponible y mi tenencia (0..10000 bps)
            remaining_bps: Math.max(0, 10000 - takenBps),
            my_bps: myBps,
            locked_by_me: myBps > 0 || lockedByMe(i),   // claims primero; columnas legacy p/ filas viejas
            lock_expires_at: i.lock_expires_at,
          };
        }),
        ...(slots && { division_slots: slots }),
        active_staff: activeStaff,
        my_role: req.mesaRole || (req.isGuest ? 'guest' : null),
      },
    });
  } catch (err) { next(err); }
});

router.post('/:code/items/lock', guestOrAuth, requireMesaParticipant,
  validateBody(schemas.lockItems), async (req, res, next) => {
  try {
    const mesa = req.mesa;
    if (!['open','partially_paid'].includes(mesa.status)) {
      return res.status(409).json({ error: 'mesa_not_active' });
    }
    const lockToken = generateLockToken();
    const lockExpiresAt = new Date(Date.now() + ITEM_LOCK_SECONDS * 1000);
    const userId = req.user?.id || null;
    const guestTokHash = guestHashOf(req);  // v2.5.2 P1 #2

    // v2.18 (fracciones): normalizar — legacy item_ids = fracciones enteras.
    const legacyShape = !!req.body.item_ids;
    const requests = legacyShape
      ? req.body.item_ids.map((id) => ({ item_id: id, fraction_bps: 10000 }))
      : req.body.items;
    const seen = new Set();
    for (const r of requests) {
      if (seen.has(r.item_id)) {
        return res.status(400).json({ error: 'duplicate_item', item_id: r.item_id });
      }
      seen.add(r.item_id);
    }

    const claims = await pool.tx(async (client) => {
      const result = [];
      // orden estable por id: dos locks concurrentes con sets solapados no se
      // cruzan en orden inverso (anti-deadlock)
      const sorted = [...requests].sort((a, b) => a.item_id.localeCompare(b.item_id));
      for (const rq of sorted) {
        const { rows } = await client.query(
          `SELECT id, status, price_cents, quantity FROM mesa_items
            WHERE id = $1 AND mesa_id = $2 FOR UPDATE`,
          [rq.item_id, mesa.id]
        );
        const item = rows[0];
        if (!item) throw Object.assign(new Error('item_not_found'), { status: 404, item_id: rq.item_id });
        try {
          const r = await itemClaims.acquire(client, {
            item, mesaId: mesa.id,
            owner: { userId, guestTokHash },
            requestedBps: rq.fraction_bps,
            lockToken, lockExpiresAt,
            triggeredBy: req.isGuest ? 'guest' : 'user',
          });
          result.push({ item_id: item.id, fraction_bps: r.effBps });
        } catch (e) {
          if (e.status === 409) {
            // shape legacy: el error histórico que el front v0.20 ya maneja
            const msg = legacyShape ? 'item_already_locked' : 'fraction_not_available';
            throw Object.assign(new Error(msg), {
              status: 409, item_id: rq.item_id, remaining_bps: e.remaining_bps,
            });
          }
          throw e;
        }
      }
      return result;
    });

    res.json({
      locked: claims.map((c) => c.item_id),   // compat legacy
      claims,                                  // v2.18: [{item_id, fraction_bps}]
      lock_token: lockToken,
      lock_expires_at: lockExpiresAt,
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({
        error: err.message,
        ...(err.item_id && { item_id: err.item_id }),
        ...(err.remaining_bps !== undefined && { remaining_bps: err.remaining_bps }),
      });
    }
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════
// POST /:code/pay
// PAYLOAD_KEYS.mesa_pay NO incluye lock_tokens (P0 #3 v2.5.1);
// item_ids/slot_ids se ordenan al hashear (P1 #3 v2.5.2 vía idempotency.js).
// guest token hashing en tablas operativas (P1 #2 v2.5.2).
// ═══════════════════════════════════════════════════════════
router.post('/:code/pay', guestOrAuth, requireMesaParticipant,
  validateBody(schemas.payMesa), async (req, res, next) => {
  try {
    const mesa = req.mesa;
    const {
      payment_method_id, stripe_payment_method_id, payment_type,
      save_payment_method,                       // D4 (v2.16)
      tip_bps,                                   // D7 (v2.17)
      items,                                     // v2.18 (fracciones)
      item_ids, lock_tokens, tip_cents, tip_to_staff_id, idempotency_key,
    } = req.body;

    if (payment_type === 'wallet' && req.isGuest) {
      return res.status(401).json({ error: 'wallet_requires_auth' });
    }
    const userId = req.user?.id || null;
    const guestTok = req.isGuest ? req.guestToken : null;
    const guestTokHash = guestHashOf(req);  // v2.5.2 P1 #2

    // hash sin lock_tokens; arrays ordenados (idempotency.js v2.5.2)
    const reqHash = payloadHash(req.body, { keep: PAYLOAD_KEYS.mesa_pay });
    const legacyReqHash = payloadHash(req.body, { keep: PAYLOAD_KEYS.mesa_pay_legacy });

    // El middleware trae un snapshot útil para autorización, pero no alcanza
    // como gate monetario. Serializamos también los replays con el cierre: si
    // settlement ganó el lock, nunca devolvemos un client_secret reactivable.
    const replayGate = await loadAttemptReplayGate({
      user_id: userId, guest_token_hash: guestTokHash, guest_token: guestTok,
      mesa_id: mesa.id, idempotency_key,
    });
    const idemExisting = replayGate.attempt;
    let recoveringUnboundAttempt = null;
    if (idemExisting) {
      if (!attemptHashesMatch(idemExisting, reqHash, legacyReqHash)) {
        logger.warn('idempotency_conflict_mesa_pay', {
          mesa_id: mesa.id, idem_key: idempotency_key,
          existing_hash: idemExisting.idempotency_payload_hash?.slice(0, 12),
          new_hash: reqHash.slice(0, 12),
        });
        return res.status(409).json({
          error: 'idempotency_conflict',
          message: 'Same idempotency_key used with different payload',
        });
      }
      const canReconcileUnbound = payment_type !== 'wallet'
        && !idemExisting.stripe_payment_intent_id
        && ['pending', 'cancelling'].includes(idemExisting.status)
        && (idemExisting.status === 'pending' || idemExisting.stripe_contract_prepared_at);
      if (ATTEMPT_TERMINALES.includes(idemExisting.status) && !canReconcileUnbound) {
        logger.warn('replay_sobre_attempt_terminal', {
          mesa_id: mesa.id, attempt_id: idemExisting.id, status: idemExisting.status,
        });
        return res.status(409).json({
          error: 'idempotency_key_terminal', attempt_status: idemExisting.status,
        });
      }
      if (idemExisting.status === 'requires_action' && !idemExisting.stripe_client_secret) {
        const replay = await reconcileBoundRequiresActionReplay(idemExisting, mesa.id);
        return res.status(replay.httpStatus).json(replay.body);
      }
      const safeAfterClose = ['succeeded', 'processed', 'refunded'].includes(idemExisting.status);
      if (!replayGate.payable && !safeAfterClose && !canReconcileUnbound) {
        return res.status(409).json({
          error: 'mesa_not_payable', status: replayGate.status,
          attempt_status: idemExisting.status,
        });
      }
      if (canReconcileUnbound) recoveringUnboundAttempt = idemExisting;
      else if (idemExisting.status === 'succeeded') {
        const replay = await reconcileSucceededReplay(idemExisting, mesa.id);
        return res.status(replay.httpStatus).json(replay.body);
      } else return res.json(attemptReplayResponse(idemExisting));
    }
    if (!replayGate.payable && !recoveringUnboundAttempt) {
      return res.status(409).json({
        error: 'mesa_not_payable', status: replayGate.status,
      });
    }

    if (payment_type === 'apple_pay' || payment_type === 'google_pay') {
      // Las wallets son requisito ratificado, pero su plan técnico todavía no.
      // Los replays con un PI ya bindeado se resolvieron arriba: no se rompen
      // obligaciones históricas. Una operación nueva no puede re-etiquetar una
      // tarjeta manual como wallet ni crear claims/attempts mientras el plan no
      // esté ratificado. Un attempt unbound previo queda en reconciliación, no
      // se transforma retrospectivamente en un rechazo de producto.
      if (recoveringUnboundAttempt) {
        return res.status(503).json({
          error: 'payment_reconciliation_pending',
          retry_with_same_idempotency_key: true,
        });
      }
      return res.status(422).json({ error: 'payment_method_not_enabled' });
    }

    // La elegibilidad y el ownership remoto se prueban ANTES de reclamar un
    // ítem/casillero o crear el attempt. El source + snapshot ganador se sella
    // luego en el mismo INSERT que esos artefactos. Un replay unbound usa sólo
    // esa evidencia durable y jamás vuelve a decidir desde el body o una fila
    // viva de payment_methods.
    let requestCardEvidence = null;
    if (payment_type === 'card') {
      if (recoveringUnboundAttempt) {
        const durableSnapshot = storedAttemptCardSnapshot(recoveringUnboundAttempt);
        if (!recoveringUnboundAttempt.stripe_source_payment_method_id
            || typeof recoveringUnboundAttempt.stripe_used_saved_card !== 'boolean'
            || typeof recoveringUnboundAttempt.stripe_save_payment_method !== 'boolean'
            || !durableSnapshot) {
          return res.status(503).json({
            error: 'payment_reconciliation_pending',
            retry_with_same_idempotency_key: true,
          });
        }
        requestCardEvidence = {
          paymentMethodId: recoveringUnboundAttempt.stripe_source_payment_method_id,
          savedPaymentMethodId: null,
          customerId: recoveringUnboundAttempt.stripe_customer_id_snapshot || null,
          usedSavedCard: recoveringUnboundAttempt.stripe_used_saved_card,
          wantsSave: recoveringUnboundAttempt.stripe_save_payment_method,
          snapshot: durableSnapshot,
        };
      } else {
        const usedSavedCard = !!payment_method_id;
        const wantsSave = !!save_payment_method && !!userId && !usedSavedCard;
        let customerId = req.user?.stripe_customer_id || null;
        let savedRow = null;
        let sourcePaymentMethodId = stripe_payment_method_id || null;
        if (usedSavedCard) {
          const { rows } = await pool.query(
            `SELECT id,stripe_payment_method_id,card_policy_version,
                    card_verified_brand,card_verified_funding,card_verified_at
               FROM payment_methods
              WHERE id=$1 AND user_id=$2 AND status='active'`,
            [payment_method_id, userId]
          );
          savedRow = rows[0] || null;
          sourcePaymentMethodId = savedRow?.stripe_payment_method_id || null;
          if (!sourcePaymentMethodId) {
            return res.status(404).json({ error: 'payment_method_not_found' });
          }
          if (!customerId) {
            return res.status(503).json({
              error: 'payment_method_verification_unavailable',
              retry_with_same_idempotency_key: true,
            });
          }
        }

        let verified;
        try {
          verified = await cardEligibility.retrieveEligibleCard({
            paymentMethodId: sourcePaymentMethodId,
            expectedCustomerId: customerId,
            ownership: usedSavedCard
              ? 'saved'
              : (customerId ? 'typed_user' : 'typed_guest'),
            expectedSnapshot: storedPaymentMethodCardSnapshot(savedRow),
            reconciliationCode: 'payment_method_verification_unavailable',
          });
        } catch (error) {
          if (error.status === 503) {
            return res.status(503).json({
              error: error.code || 'payment_method_verification_unavailable',
              retry_with_same_idempotency_key: true,
            });
          }
          if (error.status && error.code) {
            return res.status(error.status).json({ error: error.code });
          }
          throw error;
        }
        if (!usedSavedCard && cardEligibility.remoteId(verified.remote.customer)) {
          return res.status(409).json({ error: 'payment_method_requires_saved_reference' });
        }
        if (userId && !customerId) {
          // Primero se probó que el PM tipeado es elegible y está desadjunto;
          // sólo entonces se crea el Customer necesario para sellar ownership.
          try {
            customerId = await savedCards.ensureStripeCustomer(req.user);
          } catch (error) {
            logger.error('payment_customer_setup_failed_before_attempt', {
              user_id: userId, error: error.message,
            });
            return res.status(503).json({
              error: 'payment_customer_setup_failed',
              retry_with_same_idempotency_key: true,
            });
          }
        }
        if (savedRow) {
          await promoteSavedCardSnapshot({
            row: savedRow, userId, snapshot: verified.snapshot,
          });
        }
        requestCardEvidence = {
          paymentMethodId: sourcePaymentMethodId,
          savedPaymentMethodId: savedRow?.id || null,
          customerId,
          usedSavedCard,
          wantsSave,
          snapshot: verified.snapshot,
        };
      }
    }

    // D7 (v2.17): propina por % — base partes-iguales (total ÷ N declarados al
    // abrir), la cuenta la hace el SERVER (half-away-from-zero, un solo paso).
    // Sólo se calcula para una operación NUEVA; un replay usa el monto durable.
    const tipCents = recoveringUnboundAttempt
      ? Number(recoveringUnboundAttempt.tip_amount_cents || 0)
      : tip_bps !== undefined
        ? tipFromBps(Number(mesa.total_cents), Number(mesa.expected_participants) || 1, tip_bps)
        : tip_cents;

    if (!recoveringUnboundAttempt && tip_to_staff_id) {
      const { rowCount: sOk } = await pool.query(
        `SELECT 1 FROM restaurant_staff
          WHERE id = $1 AND restaurant_id = $2 AND status = 'active'`,
        [tip_to_staff_id, mesa.restaurant_id]
      );
      if (sOk === 0) return res.status(400).json({ error: 'staff_not_in_restaurant' });
    }

    let attempt;
    if (recoveringUnboundAttempt) {
      attempt = {
        ...recoveringUnboundAttempt,
        grossAmount: Number(recoveringUnboundAttempt.gross_amount_cents),
        validatedItemsAmount: Number(recoveringUnboundAttempt.items_amount_cents),
        claimedSlotIndex: recoveringUnboundAttempt.division_slot_index,
        pricedClaims: (recoveringUnboundAttempt.items || []).map((item) => ({
          itemId: item.item_id,
          fractionBps: Number(item.fraction_bps),
          amountCents: Number(item.amount_cents),
        })),
      };
    } else try {
      attempt = await pool.tx(async (client) => {
        // Segundo gate deliberado: entre el lookup idempotente y la creación
        // pudo empezar settlement. Mesa primero mantiene el mismo orden de locks
        // que la Fase 1 del cierre y evita attempts nacidos sobre `settling`.
        const { rows: [currentMesa] } = await client.query(
          `SELECT status FROM mesas WHERE id=$1 FOR UPDATE`, [mesa.id]
        );
        if (!currentMesa || !['open', 'partially_paid'].includes(currentMesa.status)) {
          throw Object.assign(new Error('mesa_not_payable'), {
            status: 409, mesaStatus: currentMesa?.status || null,
          });
        }
        if (payment_type === 'card') {
          await paymentMethodLifecycle.assertPaymentMethodUseCanSeal(client, {
            stripePaymentMethodId: requestCardEvidence.paymentMethodId,
            userId,
            savedPaymentMethodId: requestCardEvidence.savedPaymentMethodId,
          });
        }
        let validatedItemsAmount = 0;
        const pricedClaims = [];   // v2.18: [{claimId, itemId, fractionBps, amountCents}]
        let claimedSlotIndex = null;

        if (mesa.division_mode === 'consumo') {
          // v2.18 (fracciones): legacy item_ids = fracciones enteras (10000)
          const legacyShape = !items || items.length === 0;
          const requests = legacyShape
            ? item_ids.map((id) => ({ item_id: id, fraction_bps: 10000 }))
            : items;
          if (requests.length === 0) {
            throw Object.assign(new Error('no_items_selected'), { status: 400 });
          }
          const seen = new Set();
          for (const r of requests) {
            if (seen.has(r.item_id)) {
              throw Object.assign(new Error('duplicate_item'), { status: 400, item_id: r.item_id });
            }
            seen.add(r.item_id);
          }
          // candados por ítem en orden estable (anti-deadlock entre pagos solapados)
          const sorted = [...requests].sort((a, b) => a.item_id.localeCompare(b.item_id));
          const { rows: itemRows } = await client.query(
            `SELECT id, price_cents, quantity, status FROM mesa_items
              WHERE id = ANY($1::uuid[]) AND mesa_id = $2
              ORDER BY id FOR UPDATE`,
            [sorted.map((r) => r.item_id), mesa.id]
          );
          if (itemRows.length !== requests.length) {
            throw Object.assign(new Error('invalid_item_ids'), { status: 400 });
          }
          const byId = new Map(itemRows.map((r) => [r.id, r]));
          const lockExpiresAt = new Date(Date.now() + ITEM_LOCK_SECONDS * 1000);
          for (const rq of sorted) {
            const it = byId.get(rq.item_id);
            if (it.status === 'paid') {
              throw Object.assign(new Error('item_already_paid'), { status: 409, item_id: it.id });
            }
            try {
              // reclama (o re-reclama lo mío) y PRECIA la fracción: nominal, o
              // ajuste exacto si completa el ítem (política del acta v2.18)
              const r = await itemClaims.acquire(client, {
                item: it, mesaId: mesa.id,
                owner: { userId, guestTokHash },
                requestedBps: rq.fraction_bps,
                lockExpiresAt,
                lockTokens: Array.isArray(lock_tokens) ? lock_tokens : [],
                price: true,
                triggeredBy: req.isGuest ? 'guest' : 'user',
              });
              validatedItemsAmount += r.amountCents;
              pricedClaims.push({ claimId: r.claimId, itemId: it.id, fractionBps: r.effBps, amountCents: r.amountCents });
            } catch (e) {
              if (e.status === 409) {
                const msg = legacyShape ? 'item_already_locked' : 'fraction_not_available';
                throw Object.assign(new Error(msg), {
                  status: 409, item_id: rq.item_id, remaining_bps: e.remaining_bps,
                });
              }
              throw e;
            }
          }
        } else {
          const { rows: slotRows } = await client.query(
            `SELECT slot_index, amount_cents FROM mesa_division_slots
              WHERE mesa_id = $1 AND status = 'available'
              ORDER BY slot_index ASC
              LIMIT 1 FOR UPDATE SKIP LOCKED`,
            [mesa.id]
          );
          if (slotRows.length === 0) {
            throw Object.assign(new Error('no_slots_available'), { status: 409 });
          }
          claimedSlotIndex = slotRows[0].slot_index;
          validatedItemsAmount = Number(slotRows[0].amount_cents);
        }

        const grossAmount = sumCents(validatedItemsAmount, tipCents);
        const feeAmount = calculateFee(validatedItemsAmount, Number(mesa.fee_pct ?? 0.02));

        // v2.5.2 P1 #2: payment_attempts guarda guest_token_hash (raw = NULL)
        const { rows: aRows } = await client.query(
          `INSERT INTO payment_attempts
             (mesa_id, user_id, guest_token, guest_token_hash, payment_method_id,
              items_amount_cents, tip_amount_cents, gross_amount_cents,
              fee_amount_cents, net_amount_cents,
              division_slot_index,
              stripe_used_saved_card, stripe_save_payment_method,
              stripe_source_payment_method_id, stripe_customer_id_snapshot,
              card_policy_version,card_brand_snapshot,card_funding_snapshot,
              card_verified_at,
              idempotency_key, idempotency_payload_hash, idempotency_hash_version,
              operation_type, status, payment_type)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
                   $16,$17,$18,$19,$20,$21,2,'mesa_pay','pending',$22)
           RETURNING id, gross_amount_cents, fee_amount_cents, payment_method_id,
                     stripe_source_payment_method_id,stripe_customer_id_snapshot,
                     stripe_used_saved_card,stripe_save_payment_method,
                     card_policy_version,card_brand_snapshot,card_funding_snapshot,
                     card_verified_at,charge_card_verified_at`,
          [mesa.id, userId, null, guestTokHash, payment_method_id || null,
           validatedItemsAmount, tipCents, grossAmount,
           feeAmount, grossAmount - feeAmount,
           claimedSlotIndex,
           payment_type === 'card' ? requestCardEvidence.usedSavedCard : false,
           payment_type === 'card' ? requestCardEvidence.wantsSave : false,
           payment_type === 'card' ? requestCardEvidence.paymentMethodId : null,
           payment_type === 'card' ? requestCardEvidence.customerId : null,
           payment_type === 'card' ? requestCardEvidence.snapshot.policyVersion : 0,
           payment_type === 'card' ? requestCardEvidence.snapshot.brand : null,
           payment_type === 'card' ? requestCardEvidence.snapshot.funding : null,
           payment_type === 'card' ? requestCardEvidence.snapshot.verifiedAt : null,
           idempotency_key, reqHash, payment_type]
        );
        const a = aRows[0];

        if (mesa.division_mode === 'consumo') {
          // v2.18: atar los claims recién preciados al attempt (misma tx) y
          // registrar el detalle cobrado (fracción + monto) para el recibo.
          await itemClaims.bindToAttempt(
            client, pricedClaims.map((c) => c.claimId), a.id,
            new Date(Date.now() + ITEM_LOCK_SECONDS * 1000)
          );
          for (const pc of pricedClaims) {
            await client.query(
              `INSERT INTO payment_attempt_items
                 (payment_attempt_id, mesa_item_id, fraction_bps, amount_cents)
               VALUES ($1, $2, $3, $4)`,
              [a.id, pc.itemId, pc.fractionBps, pc.amountCents]
            );
          }
        } else {
          const claimed = await client.query(
            `UPDATE mesa_division_slots
                SET status='claimed',
                    claimed_by_attempt_id=$2,
                    claimed_by_user_id=$3,
                    claimed_by_guest_token=NULL,
                    claimed_by_guest_token_hash=$4,
                    claimed_at=NOW()
              WHERE mesa_id = $1 AND slot_index = $5 AND status = 'available'
              RETURNING slot_index`,
            [mesa.id, a.id, userId, guestTokHash, claimedSlotIndex]
          );
          if (claimed.rowCount !== 1) {
            throw Object.assign(new Error('slot_claim_conflict'), { status: 409 });
          }

          // B-06 §4.4 — TELEMETRÍA, NO BLOQUEO.
          // El acta 2026-07-25 ("un comensal puede pagar varias partes")
          // RATIFICA que esto es legítimo y que el producto va a ofrecerlo con
          // un selector: el guard "un usuario = un casillero" quedó VETADO.
          // Pero el mismo patrón es también la huella del accidente de B-06
          // (reintento tras respuesta perdida), y hoy el evento es INVISIBLE.
          // Se registra para poder distinguir intención de accidente mirando
          // los datos; la distinción real la hace la idempotencia, no un guard.
          const telemetry = await pool.withSavepoint(client, async () => {
            const { rows: mios } = await client.query(
              `SELECT COUNT(*)::int AS n FROM mesa_division_slots
                WHERE mesa_id = $1 AND status IN ('claimed','paid')
                  AND ($2::uuid IS NOT NULL AND claimed_by_user_id = $2
                       OR $3::varchar IS NOT NULL AND claimed_by_guest_token_hash = $3)`,
              [mesa.id, userId || null, guestTokHash || null]
            );
            return Number(mios[0].n);
          });
          if (telemetry.ok && telemetry.value > 1) {
            logger.warn('comensal_toma_segundo_casillero', {
              mesa_id: mesa.id, attempt_id: a.id,
              user_id: userId || null, es_guest: !userId,
              casilleros_tomados: telemetry.value,
              slot_index: claimedSlotIndex,
              nota: 'legítimo por acta 2026-07-25; también es la huella del reintento de B-06',
            });
          }
          if (!telemetry.ok) {
            // El acta es explícita: SEÑAL, NUNCA BLOQUEO. Esta query vive
            // dentro de la tx del pago y queda aislada por SAVEPOINT.
            logger.warn('telemetria_segundo_casillero_fallo', { error: telemetry.error.message });
          }

          // G-07 (v2.18): en "partes iguales" el front ya declara QUÉ consumió
          // cada uno (item_ids/items) — antes se descartaba. Se persiste como
          // consumo DECLARADO (fraction_bps y amount_cents NULL: se cobró por
          // slot, no por ítem). Nunca toca la tenencia ni los estados: es dato.
          const declared = (items && items.length ? items.map((i) => i.item_id) : item_ids) || [];
          if (declared.length > 0) {
            const { rows: validItems } = await client.query(
              `SELECT id FROM mesa_items WHERE id = ANY($1::uuid[]) AND mesa_id = $2`,
              [declared, mesa.id]
            );
            for (const vi of validItems) {
              await client.query(
                `INSERT INTO payment_attempt_items (payment_attempt_id, mesa_item_id)
                 VALUES ($1, $2)
                 ON CONFLICT (payment_attempt_id, mesa_item_id) DO NOTHING`,
                [a.id, vi.id]
              );
            }
          }
        }

        if (tipCents > 0) {
          await client.query(
            `INSERT INTO tip_distributions (payment_attempt_id, mesa_id, staff_id, amount_cents)
             VALUES ($1, $2, $3, $4)`,
            [a.id, mesa.id, tip_to_staff_id || null, tipCents]
          );
        }
        return { ...a, grossAmount, validatedItemsAmount, claimedSlotIndex, pricedClaims };
      });
    } catch (err) {
      if (err.code === '23505' && isAttemptIdempotencyViolation(err, {
        userId, guestTokHash, guestTok,
      })) {
        const concurrentGate = await loadAttemptReplayGate({
          user_id: userId, guest_token_hash: guestTokHash, guest_token: guestTok,
          mesa_id: mesa.id, idempotency_key,
        });
        const existing = concurrentGate.attempt;
        if (existing) {
          if (!attemptHashesMatch(existing, reqHash, legacyReqHash)) {
            return res.status(409).json({ error: 'idempotency_conflict' });
          }
          if (ATTEMPT_TERMINALES.includes(existing.status)) {
            return res.status(409).json({
              error: 'idempotency_key_terminal', attempt_status: existing.status,
            });
          }
          if (existing.status === 'pending' && !existing.stripe_payment_intent_id) {
            return res.status(503).json({
              error: 'payment_reconciliation_pending', attempt_status: existing.status,
              retry_with_same_idempotency_key: true,
            });
          }
          if (existing.status === 'requires_action' && !existing.stripe_client_secret) {
            const replay = await reconcileBoundRequiresActionReplay(existing, mesa.id);
            return res.status(replay.httpStatus).json(replay.body);
          }
          const safeAfterClose = ['succeeded', 'processed', 'refunded'].includes(existing.status);
          if (!concurrentGate.payable && !safeAfterClose) {
            return res.status(409).json({
              error: 'mesa_not_payable', status: concurrentGate.status,
              attempt_status: existing.status,
            });
          }
          if (existing.status === 'succeeded') {
            const replay = await reconcileSucceededReplay(existing, mesa.id);
            return res.status(replay.httpStatus).json(replay.body);
          }
          return res.json(attemptReplayResponse(existing));
        }
        return res.status(409).json({ error: 'concurrent_conflict' });
      }
      if (err.status) {
        return res.status(err.status).json({
          error: err.message, ...(err.item_id && { item_id: err.item_id }),
          ...(err.mesaStatus && { status: err.mesaStatus }),
          ...(err.remaining_bps !== undefined && { remaining_bps: err.remaining_bps }),
        });
      }
      throw err;
    }

    // v2.18: detalle de fracciones cobradas (recibo) — presente solo en consumo
    const itemsDetail = attempt.pricedClaims && attempt.pricedClaims.length
      ? attempt.pricedClaims.map((c) => ({
          item_id: c.itemId, fraction_bps: c.fractionBps, amount_cents: c.amountCents,
        }))
      : undefined;

    if (payment_type === 'wallet') {
      try {
        await pool.tx(async (client) => {
          // La creación del attempt y el débito son dos fases. Repetimos el
          // gate bajo lock para que settlement no pueda calcular el faltante
          // entre ambas y luego cobrar también la garantía.
          const { rows: [currentMesa] } = await client.query(
            `SELECT status FROM mesas WHERE id=$1 FOR UPDATE`, [mesa.id]
          );
          if (!currentMesa || !['open', 'partially_paid'].includes(currentMesa.status)) {
            throw Object.assign(new Error('mesa_not_payable'), {
              status: 409, mesaStatus: currentMesa?.status || null,
            });
          }
          const { rows: [currentAttempt] } = await client.query(
            `SELECT status FROM payment_attempts WHERE id=$1 FOR UPDATE`, [attempt.id]
          );
          if (!currentAttempt || currentAttempt.status !== 'pending') {
            throw Object.assign(new Error('payment_attempt_not_payable'), {
              status: 409, attemptStatus: currentAttempt?.status || null,
            });
          }
          const { rows: wRows } = await client.query(
            `SELECT id, balance_cents, held_balance_cents FROM wallets WHERE user_id = $1 FOR UPDATE`, [userId]
          );
          const wallet = wRows[0];
          // v2.11 (A5): el saldo RESERVADO como garantía (held_balance_cents) no es
          // gastable. Sin este cálculo, el CHECK chk_wallets_held_balance frenaba
          // el UPDATE con un 500 en vez de un 402, y el usuario veía saldo
          // "disponible" que en realidad estaba congelado.
          const availableBal = wallet
            ? sumCents(wallet.balance_cents, -BigInt(wallet.held_balance_cents || 0))
            : 0;
          if (!wallet || availableBal < attempt.grossAmount) {
            throw Object.assign(new Error('insufficient_funds'), {
              status: 402,
              available: availableBal,
              required: attempt.grossAmount,
            });
          }
          const newBal = sumCents(wallet.balance_cents, -attempt.grossAmount);
          await client.query(`UPDATE wallets SET balance_cents=$1, updated_at=NOW() WHERE id=$2`, [newBal, wallet.id]);
          await client.query(
            `INSERT INTO wallet_transactions
               (wallet_id, user_id, type, amount_cents, balance_after_cents,
                related_entity_type, related_entity_id, description)
             VALUES ($1,$2,'payment_mesa',$3,$4,'mesa',$5,$6)`,
            [wallet.id, userId, -attempt.grossAmount, newBal, mesa.id, `Pago mesa ${mesa.code}`]
          );
          await client.query(`UPDATE payment_attempts SET status='succeeded' WHERE id=$1`, [attempt.id]);
          await stateMachine.transition({
            client, entityType: 'payment_attempt', entityId: attempt.id,
            fromState: 'pending', toState: 'succeeded',
            reason: 'wallet_payment', triggeredBy: 'user',
          });
          const processed = await paymentProcessor.processSuccessfulPayment(
            client, attempt.id, { triggeredBy: 'system' }
          );
          if (!processed.processed && !processed.alreadyProcessed) {
            const processingErr = new Error('wallet_payment_processing_rejected');
            processingErr.code = 'wallet_payment_processing_rejected';
            processingErr.reason = processed.manualReview
              || processed.invalidStatus || 'processing_incomplete';
            throw processingErr;
          }
        });
        return res.status(201).json({
          attempt: {
            id: attempt.id,
            gross_amount_cents: Number(attempt.grossAmount),
            gross_display: centsToDisplay(Number(attempt.grossAmount)),
            tip_cents: Number(tipCents),   // D7: lo computado por el server
            ...(itemsDetail && { items: itemsDetail }),   // v2.18: recibo
            status: 'processed',
            payment_type: 'wallet',
          },
        });
      } catch (err) {
        if (err.code === 'wallet_payment_processing_rejected') {
          logger.error('wallet_payment_processing_rejected', {
            attempt_id: attempt.id, reason: err.reason,
          });
          if (!await releaseAttemptItems(attempt.id, err.reason || err.code)) {
            return res.status(503).json({ error: 'payment_reconciliation_pending' });
          }
          return res.status(503).json({ error: 'wallet_payment_processing_failed' });
        }
        if (err.status === 402) {
          if (!await releaseAttemptItems(attempt.id, 'insufficient_funds')) {
            return res.status(503).json({ error: 'payment_reconciliation_pending' });
          }
          return res.status(402).json({
            error: 'insufficient_funds',
            available: err.available, required: err.required,
          });
        }
        if (err.status === 409) {
          return res.status(409).json({
            error: err.message,
            ...(err.mesaStatus && { status: err.mesaStatus }),
            ...(err.attemptStatus && { attempt_status: err.attemptStatus }),
          });
        }
        throw err;
      }
    }

    const sourceCardSnapshot = storedAttemptCardSnapshot(attempt);
    if (!attempt.stripe_source_payment_method_id
        || typeof attempt.stripe_used_saved_card !== 'boolean'
        || typeof attempt.stripe_save_payment_method !== 'boolean'
        || !sourceCardSnapshot) {
      logger.error('payment_attempt_provider_snapshot_missing', { attempt_id: attempt.id });
      return res.status(503).json({
        error: 'payment_reconciliation_pending',
        retry_with_same_idempotency_key: true,
      });
    }
    const usedSavedCard = attempt.stripe_used_saved_card;
    const wantsSave = attempt.stripe_save_payment_method;
    const requestedWantsSave = !!save_payment_method && !!userId && !payment_method_id;
    if (requestedWantsSave !== wantsSave) {
      logger.warn('payment_attempt_save_flag_ignored_on_replay', {
        attempt_id: attempt.id, durable: wantsSave, requested: requestedWantsSave,
      });
    }

    // Desde acá sólo se usa el source/customer/snapshot que nació con el
    // attempt. Ni un cambio de body, ni borrar una tarjeta guardada, ni mutar el
    // usuario entre retries puede cambiar el contrato monetario.
    const stripePmId = attempt.stripe_source_payment_method_id;
    const customerId = attempt.stripe_customer_id_snapshot || null;

    // ─── v2.23 · Connect: ¿este cobro va a la cuenta del restaurante? ───────
    // Gate por restaurante: null explícito conserva el riel previo; un fallo
    // técnico NO puede cambiar merchant-of-record silenciosamente.
    let connectTarget = null;
    let chargePmId = attempt.stripe_charge_payment_method_id || null;
    let appFeeCents = Number(attempt.application_fee_cents || 0);
    if (attempt.stripe_contract_prepared_at) {
      connectTarget = attempt.stripe_account_id
        ? { accountId: attempt.stripe_account_id }
        : null;
      if (attempt.stripe_source_payment_method_id !== stripePmId) {
        logger.error('payment_attempt_source_method_conflict', { attempt_id: attempt.id });
        return res.status(503).json(paymentReconciliationPendingBody(attempt.status));
      }
    } else {
      try {
        connectTarget = await connect.resolveChargeTarget(mesa.restaurant_id);
      } catch (e) {
        logger.error('connect_target_lookup_failed', { mesa_id: mesa.id, error: e.message });
        if (!await releaseAttemptItems(attempt.id, 'connect_target_unavailable')) {
          return res.status(503).json(paymentReconciliationPendingBody(attempt.status));
        }
        return res.status(503).json({ error: 'connect_charge_target_unavailable' });
      }
    }

    if (connectTarget && !attempt.stripe_contract_prepared_at) {
      // El bruto completo (incluida la propina) queda en la cuenta conectada
      // del restaurante. La application fee contiene ÚNICAMENTE la comisión
      // de PayMe; este riel no acredita ni recupera tip-wallet.
      // `fee_amount_cents` quedó sellado junto con el attempt y es la autoridad
      // económica del cobro. Releer fee_pct acá permitiría que un cambio de
      // política entre creación y redrive alterara el contrato Stripe/D1.
      const comision = sumCents(attempt.fee_amount_cents);
      const propuesta = comision;
      // Stripe exige application_fee < monto del cargo. Esto también preserva
      // el direct charge de propina pura: items=0 implica comisión=0 < bruto.
      if (propuesta >= Number(attempt.grossAmount)) {
        logger.warn('connect_app_fee_would_exceed_amount', {
          mesa_id: mesa.id, attempt_id: attempt.id,
          gross: Number(attempt.grossAmount), proposed_fee: propuesta,
        });
        if (!await releaseAttemptItems(attempt.id, 'connect_application_fee_invalid')) {
          return res.status(503).json(paymentReconciliationPendingBody(attempt.status));
        }
        return res.status(503).json({ error: 'connect_charge_configuration_invalid' });
      } else {
        appFeeCents = propuesta;
      }
    }

    if (!attempt.stripe_contract_prepared_at) {
      try {
        const prepared = await prepareAttemptStripeContract({
          attemptId: attempt.id,
          stripeAccountId: connectTarget?.accountId || null,
          applicationFeeCents: appFeeCents,
          sourcePaymentMethodId: stripePmId,
          sourceCardSnapshot,
          customerId,
          usedSavedCard,
          savePaymentMethod: wantsSave,
        });
        attempt = { ...attempt, ...prepared };
      } catch (err) {
        logger.error('payment_attempt_contract_persistence_failed', {
          attempt_id: attempt.id, error: err.message,
        });
        return res.status(503).json(paymentReconciliationPendingBody(attempt.status));
      }
    }

    if (connectTarget && !chargePmId) {
      try {
        const clon = await stripeService.clonePaymentMethodToAccount({
          payment_method_id: stripePmId,
          // SOLO para tarjetas guardadas: el clonado con `customer` exige que
          // ese pm_ esté adjunto a ESE customer. Una tarjeta recién tipeada no
          // lo está, y mandar el customer igual hacía fallar el clonado y
          // degradaba el pivote a cargo de plataforma sin que nadie se entere.
          customer_id: usedSavedCard ? customerId : null,
          stripe_account: connectTarget.accountId,
          idempotency_key: `clone_pay_${attempt.id}`,
        });
        const cloneId = cardEligibility.remoteId(clon);
        const verifiedClone = await cardEligibility.retrieveEligibleCard({
          paymentMethodId: cloneId,
          stripeAccount: connectTarget.accountId,
          ownership: 'clone',
          expectedSnapshot: sourceCardSnapshot,
          reconciliationCode: 'connect_payment_method_reconciliation_pending',
        });
        const persisted = await persistAttemptChargePaymentMethod(
          attempt.id, cloneId, verifiedClone.snapshot.verifiedAt
        );
        chargePmId = persisted.id;
        attempt.charge_card_verified_at = persisted.verifiedAt;
      } catch (e) {
        // A partir de que el target Connect quedó resuelto, caer al riel de
        // plataforma cambiaría el merchant-of-record y el régimen de refund.
        logger.error('connect_pm_clone_failed', {
          mesa_id: mesa.id, attempt_id: attempt.id,
          account: connectTarget.accountId, error: e.message,
        });
        return res.status(503).json({
          error: 'connect_payment_method_reconciliation_pending',
          retry_with_same_idempotency_key: true,
        });
      }
    } else if (!connectTarget && !chargePmId) {
      chargePmId = stripePmId;
      try {
        const persisted = await persistAttemptChargePaymentMethod(
          attempt.id, chargePmId, sourceCardSnapshot.verifiedAt
        );
        attempt.charge_card_verified_at = persisted.verifiedAt;
      } catch (err) {
        logger.error('payment_attempt_method_persistence_failed', {
          attempt_id: attempt.id, error: err.message,
        });
        return res.status(503).json(paymentReconciliationPendingBody(attempt.status));
      }
    }
    if (!chargePmId || !attempt.charge_card_verified_at) {
      logger.error('payment_attempt_charge_card_verification_missing', {
        attempt_id: attempt.id,
      });
      return res.status(503).json({
        error: 'payment_reconciliation_pending',
        retry_with_same_idempotency_key: true,
      });
    }

    try {
      const stripeIntent = await stripeService.createPaymentIntent({
        amount_cents: attempt.grossAmount,
        customer_id: connectTarget ? undefined : customerId,
        payment_method_id: chargePmId,
        idempotency_key: `pay_${attempt.id}`,
        // v2.23 · direct charge sobre la cuenta conectada del restaurante
        ...(connectTarget && {
          stripe_account: connectTarget.accountId,
          application_fee_cents: appFeeCents,
        }),
        // D4: tarjeta guardada → off_session (Stripe intenta sin fricción; si
        // el emisor exige 3DS, el catch de abajo lo devuelve como
        // requires_action + client_secret, igual que cualquier 3DS).
        off_session: usedSavedCard,
        // D4 + Connect: setup_future_usage sobre un direct charge adjuntaría la
        // tarjeta a la cuenta del RESTAURANTE (y sin customer, Stripe lo
        // rechaza). Guardar tarjeta es de la bóveda de PayMe: en el riel
        // directo no se pide acá. La tarjeta igual se cobra normal.
        ...(wantsSave && !connectTarget && { setup_future_usage: 'off_session' }),
        metadata: {
          mesa_id: mesa.id, mesa_code: mesa.code,
          user_id: userId || 'guest',
          attempt_id: attempt.id,
          // En direct charges la propina permanece en fondos del restaurante;
          // no se promete una acreditación individual por metadata.
          tip_to_staff_id: connectTarget ? '' : (tip_to_staff_id || ''),
          // D4: el webhook 3DS espeja la tarjeta cuando el pago confirma.
          // En el riel directo NO se marca: el pm del intent es el clon, que
          // vive en la cuenta del restaurante y no pertenece a la bóveda.
          ...(wantsSave && !connectTarget && { save_pm: '1' }),
        },
      });

      assertStripePaymentIntentContract(stripeIntent, {
        attemptId: attempt.id,
        mesaId: mesa.id,
        amountCents: Number(attempt.grossAmount),
        stripeAccountId: connectTarget?.accountId || null,
        applicationFeeCents: Number(appFeeCents || 0),
        chargePaymentMethodId: chargePmId,
        customerId: connectTarget ? null : customerId,
        offSession: usedSavedCard,
        setupFutureUsage: wantsSave && !connectTarget ? 'off_session' : null,
      });

      const newStatus = stateMachine.mapStripeStatus(stripeIntent.status);
      let binding;
      try {
        binding = await persistAttemptStripeResult({
          attemptId: attempt.id,
          intentId: stripeIntent.id,
          clientSecret: stripeIntent.client_secret,
          newStatus,
          stripeAccountId: connectTarget ? connectTarget.accountId : null,
          applicationFeeCents: appFeeCents || 0,
        });
      } catch (bindingErr) {
        throw Object.assign(new Error('payment_attempt_binding_persistence_failed'), {
          code: 'payment_attempt_binding_persistence_failed', cause: bindingErr,
        });
      }
      if (binding.terminal) {
        try {
          await finalizeRemoteTerminalStrict(
            attempt.id, binding.terminalStatus, `stripe_${binding.terminalStatus}`
          );
        } catch (failureErr) {
          throw Object.assign(new Error('payment_attempt_terminal_persistence_failed'), {
            code: 'payment_attempt_terminal_persistence_failed', cause: failureErr,
          });
        }
        return res.status(502).json({
          error: 'payment_provider_error', status: binding.terminalStatus,
        });
      }
      if (!binding.accepted) {
        const rejection = await rejectStripeResultDuringSettlement({
          binding, stripeIntent,
          stripeAccountId: connectTarget ? connectTarget.accountId : null,
          mesaId: mesa.id, attemptId: attempt.id,
        });
        return res.status(rejection.httpStatus).json(rejection.body);
      }
      if (binding.status === 'succeeded' || binding.lateSuccess) {
        let processing;
        try {
          processing = await settlement.reconcileSucceededAttempt({
            mesaId: mesa.id, attemptId: attempt.id,
            remoteIntent: stripeIntent,
            stripeAccountId: connectTarget?.accountId || null,
            triggeredBy: 'system',
          });
        } catch (processingErr) {
          throw Object.assign(new Error('payment_attempt_processing_persistence_failed'), {
            code: 'payment_attempt_processing_persistence_failed', cause: processingErr,
          });
        }
        if (!processing.resolved) {
          throw Object.assign(new Error('payment_attempt_processing_pending'), {
            code: 'payment_attempt_processing_pending',
            reason: processing.reason,
          });
        }
        binding.status = processing.status || binding.status;
      }

      // D4: sin 3DS el intent ya confirmó acá → espejar sync (best-effort,
      // mirrorSavedPaymentMethod jamás lanza). El camino 3DS lo cubre el
      // webhook payment_intent.succeeded vía metadata.save_pm.
      // Se espeja stripeIntent.payment_method (lo ADJUNTADO): los alias de
      // test y algunos wallets se materializan en otro pm_ al confirmar.
      // OJO (v2.23): en direct charge el payment_method del intent es el CLON,
      // que vive en la cuenta conectada — espejarlo metería en la bóveda de
      // PayMe un pm_ que no le pertenece. Se espeja el de plataforma.
      if (wantsSave && !connectTarget && stripeIntent.status === 'succeeded') {
        await savedCards.mirrorSavedPaymentMethod(
          userId, stripeIntent.payment_method || stripePmId
        );
      } else if (wantsSave && connectTarget) {
        logger.warn('save_pm_omitido_en_direct_charge', {
          mesa_id: mesa.id, attempt_id: attempt.id, account: connectTarget.accountId,
        });
      }

      logger.audit('payment_attempt_created', {
        mesa_id: mesa.id, attempt_id: attempt.id,
        gross_amount: attempt.grossAmount, payment_type, stripe_status: stripeIntent.status,
      });

      res.status(201).json({
        attempt: {
          id: attempt.id,
          gross_amount_cents: Number(attempt.grossAmount),
          tip_cents: Number(tipCents),   // D7: lo computado por el server
          ...(itemsDetail && { items: itemsDetail }),   // v2.18: recibo
          client_secret: stripeIntent.client_secret,
          status: binding.status,
          stripe_status: stripeIntent.status,
          requires_action: binding.status === 'requires_action',
          payment_type,
          // v2.23 · direct charge: el PI vive en la cuenta del restaurante, así
          // que el front DEBE inicializar Stripe.js con { stripeAccount: … }
          // para confirmar el 3DS. Ausente = cargo de plataforma, como siempre.
          ...(connectTarget && { connected_account_id: connectTarget.accountId }),
        },
      });
    } catch (stripeErr) {
      // D4: off_session con tarjeta guardada — el emisor puede exigir 3DS.
      // Stripe lo reporta como error authentication_required, pero el PI quedó
      // creado en requires_action: devolverlo como cualquier 3DS (el front
      // completa con el client_secret) en vez de un 502 seco.
      const pi = stripeErr.raw?.payment_intent || stripeErr.payment_intent;
      if (stripeErr.code === 'authentication_required' && pi) {
        try {
          assertStripePaymentIntentContract(pi, {
            attemptId: attempt.id,
            mesaId: mesa.id,
            amountCents: Number(attempt.grossAmount),
            stripeAccountId: connectTarget?.accountId || null,
            applicationFeeCents: Number(appFeeCents || 0),
            chargePaymentMethodId: chargePmId,
            customerId: connectTarget ? null : customerId,
            offSession: usedSavedCard,
            setupFutureUsage: wantsSave && !connectTarget ? 'off_session' : null,
            requestContextKnown: true,
          });
        } catch (contractErr) {
          logger.error('payment_intent_sync_contract_mismatch', {
            attempt_id: attempt.id, error: contractErr.message,
          });
          return res.status(503).json(paymentReconciliationPendingBody(attempt.status));
        }
        const newStatus = stateMachine.mapStripeStatus(pi.status);
        let binding;
        try {
          binding = await persistAttemptStripeResult({
            attemptId: attempt.id,
            intentId: pi.id,
            clientSecret: pi.client_secret,
            newStatus,
            stripeAccountId: connectTarget ? connectTarget.accountId : null,
            applicationFeeCents: appFeeCents || 0,
          });
        } catch (bindingErr) {
          logger.error('payment_attempt_binding_failed_after_stripe', {
            mesa_id: mesa.id, attempt_id: attempt.id,
            error: bindingErr.message, code: bindingErr.code,
          });
          return res.status(503).json(paymentReconciliationPendingBody(attempt.status));
        }
        if (!binding.accepted) {
          const rejection = await rejectStripeResultDuringSettlement({
            binding, stripeIntent: pi,
            stripeAccountId: connectTarget ? connectTarget.accountId : null,
            mesaId: mesa.id, attemptId: attempt.id,
          });
          return res.status(rejection.httpStatus).json(rejection.body);
        }
        logger.audit('payment_attempt_requires_auth', {
          mesa_id: mesa.id, attempt_id: attempt.id, stripe_status: pi.status,
        });
        return res.status(201).json({
          attempt: {
            id: attempt.id,
            gross_amount_cents: Number(attempt.grossAmount),
            tip_cents: Number(tipCents),   // D7: lo computado por el server
            ...(itemsDetail && { items: itemsDetail }),   // v2.18: recibo
            client_secret: pi.client_secret,
            status: binding.status,
            stripe_status: pi.status,
            requires_action: binding.status === 'requires_action',
            payment_type,
            ...(connectTarget && { connected_account_id: connectTarget.accountId }),
          },
        });
      }
      if (String(stripeErr.code || '').startsWith('payment_attempt_')) {
        logger.error('payment_attempt_binding_failed_after_stripe', {
          mesa_id: mesa.id, attempt_id: attempt.id,
          error: stripeErr.message, code: stripeErr.code,
          cause: stripeErr.cause?.message || null,
        });
        return res.status(503).json(paymentReconciliationPendingBody(attempt.status));
      }
      if (pi && ['requires_payment_method', 'canceled'].includes(pi.status)) {
        try {
          assertStripePaymentIntentContract(pi, {
            attemptId: attempt.id,
            mesaId: mesa.id,
            amountCents: Number(attempt.grossAmount),
            stripeAccountId: connectTarget?.accountId || null,
            applicationFeeCents: Number(appFeeCents || 0),
            chargePaymentMethodId: chargePmId,
            customerId: connectTarget ? null : customerId,
            offSession: usedSavedCard,
            setupFutureUsage: wantsSave && !connectTarget ? 'off_session' : null,
            requestContextKnown: true,
          });
          const terminalStatus = pi.status === 'canceled' ? 'cancelled' : 'failed';
          const terminalBinding = await persistAttemptStripeResult({
            attemptId: attempt.id,
            intentId: pi.id,
            clientSecret: pi.client_secret,
            newStatus: terminalStatus,
            stripeAccountId: connectTarget ? connectTarget.accountId : null,
            applicationFeeCents: appFeeCents || 0,
          });
          if (!terminalBinding.terminal) {
            throw new Error('stripe_terminal_result_not_bound_as_terminal');
          }
          await finalizeRemoteTerminalStrict(
            attempt.id, terminalStatus, stripeErr.message || `stripe_${pi.status}`
          );
          return res.status(502).json({
            error: 'payment_provider_error', status: pi.status,
          });
        } catch (terminalErr) {
          logger.error('payment_attempt_terminal_reconciliation_failed', {
            mesa_id: mesa.id, attempt_id: attempt.id, error: terminalErr.message,
          });
          return res.status(503).json(paymentReconciliationPendingBody(attempt.status));
        }
      }
      const definitiveCardDecline = stripeErr.type === 'StripeCardError'
        && ['card_declined', 'expired_card', 'incorrect_cvc'].includes(stripeErr.code);
      if (definitiveCardDecline) {
        try {
          await failAttemptStrict(attempt.id, stripeErr.message || stripeErr.code);
          return res.status(502).json({
            error: 'payment_provider_error', code: stripeErr.code,
          });
        } catch (failureErr) {
          logger.error('payment_attempt_decline_persistence_failed', {
            mesa_id: mesa.id, attempt_id: attempt.id, error: failureErr.message,
          });
          return res.status(503).json(paymentReconciliationPendingBody(attempt.status));
        }
      }
      // Timeout, 5xx o error sin resultado terminal verificable: Stripe pudo
      // haber aplicado el cargo con la idempotency key aunque la respuesta se
      // perdiera. Liberar claims/marcar failed permitiría que settlement cobre
      // además la garantía. Se conserva el attempt para reconciliación.
      logger.error('stripe_payment_intent_result_ambiguous', {
        attempt_id: attempt.id, error: stripeErr.message, type: stripeErr.type,
      });
      return res.status(503).json(paymentReconciliationPendingBody(attempt.status));
    }
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({
        error: err.message, ...(err.item_id && { item_id: err.item_id }),
        ...(err.remaining_bps !== undefined && { remaining_bps: err.remaining_bps }),
      });
    }
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════
// POST /:code/invitations  (autoridad canónica + journal idempotente)
// ═══════════════════════════════════════════════════════════
router.post('/:code/invitations', requireAuth, validateBody(schemas.createInvitation),
  async (req, res, next) => {
  try {
    const {
      invited_user_id, invited_payme_id, type, idempotency_key,
    } = req.body;
    const expiry = Number(process.env.INVITATION_EXPIRY_SECONDS) || 86400;
    const outcome = await invitationAuthority.createOrReplay({
      mesaCode: req.params.code,
      inviter: req.user,
      type,
      invitedUserId: invited_user_id || null,
      invitedPaymeId: invited_payme_id || null,
      idempotencyKey: idempotency_key || null,
      expirySeconds: Math.max(1, Math.min(Math.trunc(expiry), 604800)),
    });
    const inv = outcome.invitation;

    const publicUrl = process.env.FRONTEND_PUBLIC_URL || 'http://localhost:5173';
    res.status(outcome.created ? 201 : 200).json({
      invitation: {
        id: inv.id,
        invitation_type: inv.invitation_type,
        status: inv.status,
        expires_at: inv.expires_at,
        created_at: inv.created_at,
      },
      idempotent: outcome.idempotent,
      ...(type === 'link' && outcome.rawToken && {
        // Determinista: el mismo UUID canónico reconstruye el mismo link en
        // cualquier replay, sin guardar el token crudo en la base.
        link: `${publicUrl}/mesa/${req.params.code}?t=${outcome.rawToken}`,
      }),
    });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({
        error: err.code || err.message,
        ...(err.mesa_status && { status: err.mesa_status }),
        ...(err.invitation_status && { invitation_status: err.invitation_status }),
      });
    }
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════
// v2.5.2 P1 #2: busca por guest_token_hash con fallback a guest_token (legacy)
// ── B-06 §4.1 (v2.25): helpers de idempotencia de la creación de mesa ──
async function findExistingMesa(openerId, idempotencyKey) {
  const { rows } = await pool.query(
    `SELECT id, code, opener_user_id, total_cents, division_mode, expected_participants,
            status, expires_at, created_at, metadata, idempotency_payload_hash,
            auth_method, auth_stripe_account_id, auth_payment_intent_id,
            auth_amount_cents, auth_application_fee_cents,
            auth_source_payment_method_id, auth_charge_payment_method_id,
            auth_card_policy_version,auth_card_brand,auth_card_funding,
            auth_card_verified_at,auth_charge_card_verified_at,
            auth_stripe_customer_id, auth_off_session,
            auth_save_payment_method
       FROM mesas
      WHERE opener_user_id = $1 AND idempotency_key = $2`,
    [openerId, idempotencyKey]
  );
  return rows[0] || null;
}

// Estados de los que una mesa NO vuelve: replayarlos sería devolver 200 sobre
// algo que el request original resolvió con error.
const MESA_ESTADOS_MUERTOS = ['auth_failed', 'cancelled', 'expired'];

/**
 * Respuesta del replay, con el mismo shape que el 201.
 *
 * Si la mesa quedó esperando el 3DS se RECUPERA el client_secret desde Stripe.
 * El client_secret de un PaymentIntent NO es de un solo uso: sirve para
 * confirmar ESE intent las veces que haga falta. Omitirlo dejaba al front sin
 * forma de terminar la autenticación, y su única salida habría sido rotar la
 * clave → segunda mesa con segundo hold, o sea el bug que esto viene a cerrar.
 */
async function mesaReplayResponse(m) {
  const { opener_user_id, metadata,
    auth_method, auth_stripe_account_id,
    auth_payment_intent_id, auth_charge_payment_method_id,
    auth_stripe_customer_id,
    auth_amount_cents, auth_application_fee_cents,
    auth_off_session, auth_save_payment_method } = m;
  const mesa = publicCreatedMesa(m);
  const guarantee = {
    method: auth_method || null,
    status: m.status === 'open' ? 'open'
      : m.status === 'pending_auth' ? 'requires_action'
        : m.status,
    ...(auth_stripe_account_id && { connected_account_id: auth_stripe_account_id }),
  };
  if (m.status === 'pending_auth') {
    if (auth_method !== 'card' || !auth_payment_intent_id) {
      return {
        httpStatus: 503,
        body: {
          error: 'guarantee_reconciliation_pending',
          retry_with_same_idempotency_key: true,
        },
      };
    }
    const reconciled = await settlement.reconcileGuaranteeReplay({
      mesaId: m.id,
      organizerId: opener_user_id,
      amountCents: Number(auth_amount_cents),
      intentId: auth_payment_intent_id,
      accountId: auth_stripe_account_id || null,
      applicationFeeCents: Number(auth_application_fee_cents || 0),
      chargePaymentMethodId: auth_charge_payment_method_id,
      customerId: auth_stripe_customer_id,
      offSession: auth_off_session,
      savePaymentMethod: auth_save_payment_method,
    });
    if (reconciled.status === 'failed') {
      return {
        httpStatus: 402,
        body: { error: 'guarantee_failed', reason: reconciled.reason },
      };
    }
    if (!reconciled.resolved) {
      return {
        httpStatus: 503,
        body: {
          error: reconciled.manualReview
            ? 'guarantee_manual_review_required'
            : 'guarantee_reconciliation_pending',
          retry_with_same_idempotency_key: true,
        },
      };
    }
    guarantee.status = reconciled.status;
    if (reconciled.clientSecret) guarantee.client_secret = reconciled.clientSecret;
    if (reconciled.connectedAccountId) {
      guarantee.connected_account_id = reconciled.connectedAccountId;
    }
    mesa.status = reconciled.status === 'open' ? 'open' : mesa.status;
  }
  if (m.status === 'settling' && metadata?.guarantee_manual_review) {
    return {
      httpStatus: 503,
      body: {
        error: 'guarantee_manual_review_required',
        retry_with_same_idempotency_key: true,
      },
    };
  }
  return { httpStatus: 200, body: { mesa, guarantee, idempotent: true } };
}

// B-06 §4.2 (v2.25): estados de los que NO se puede seguir. Un replay sobre
// ellos devolvía 200 {idempotent:true} indistinguible de un cobro exitoso —
// hoy inalcanzable porque el front genera clave nueva siempre, pero su propio
// fix de B-06 (reusar la clave) lo abre: pintaría comprobante de un pago que
// nunca se cobró. Se responde 409 para que rote la clave, que es exactamente
// lo que corresponde: en estos estados el slot/la fracción YA se liberaron.
// 'refunded' quedó AFUERA a propósito: ese pago SÍ se cobró. Devolver 409 haría
// que el front rotara la clave y COBRARA DE NUEVO algo recién reembolsado.
// 'cancelling' sí entra: el timer está matando ese intent justo ahora, y
// devolver su client_secret vivo sería mandar al comensal a confirmar un pago
// que estamos cancelando.
const ATTEMPT_TERMINALES = ['failed', 'cancelled', 'cancelling'];

function assertStripePaymentIntentContract(pi, {
  attemptId, mesaId, amountCents, stripeAccountId,
  applicationFeeCents, chargePaymentMethodId, customerId,
  offSession, setupFutureUsage, requestContextKnown = false,
}) {
  const remoteAmount = Number(pi?.amount);
  const remoteFee = Number(pi?.application_fee_amount || 0);
  const expectedAccount = stripeAccountId || null;
  const expectedCustomer = customerId || null;
  const expectedSetup = setupFutureUsage || null;
  const remoteAccount = pi?.payme_request_account_id ?? null;
  const paymentMethodTypes = Array.isArray(pi?.payment_method_types)
    ? pi.payment_method_types
    : [];
  const valid = !!pi?.id
    && Number.isSafeInteger(remoteAmount) && remoteAmount === amountCents
    && String(pi.currency || '').toLowerCase() === 'mxn'
    && pi.metadata?.attempt_id === attemptId
    && pi.metadata?.mesa_id === mesaId
    && Number.isSafeInteger(remoteFee) && remoteFee === applicationFeeCents
    && pi.capture_method === 'automatic'
    && pi.payment_method === chargePaymentMethodId
    && (pi.customer || null) === expectedCustomer
    && (pi.setup_future_usage || null) === expectedSetup
    && paymentMethodTypes.length === 1 && paymentMethodTypes[0] === 'card'
    && (requestContextKnown || (
      remoteAccount === expectedAccount
      && (pi.payme_request_customer_id || null) === expectedCustomer
      && pi.payme_request_payment_method_id === chargePaymentMethodId
      && pi.payme_request_off_session === !!offSession
      && (pi.payme_request_setup_future_usage || null) === expectedSetup
      && pi.payme_request_capture_method === 'automatic'
      && Array.isArray(pi.payme_request_payment_method_types)
      && pi.payme_request_payment_method_types.length === 1
      && pi.payme_request_payment_method_types[0] === 'card'
    ));
  if (!valid) {
    const err = new Error('payment_intent_contract_mismatch');
    err.code = 'payment_intent_contract_mismatch';
    throw err;
  }
}

async function prepareAttemptStripeContract({
  attemptId, stripeAccountId, applicationFeeCents, sourcePaymentMethodId,
  sourceCardSnapshot, customerId, usedSavedCard, savePaymentMethod,
}) {
  return pool.tx(async (client) => {
    const { rows: [current] } = await client.query(
      `SELECT status, stripe_payment_intent_id, stripe_contract_prepared_at,
              stripe_account_id, application_fee_cents,
              stripe_source_payment_method_id, stripe_customer_id_snapshot,
              stripe_used_saved_card, stripe_save_payment_method,
              stripe_charge_payment_method_id,charge_card_verified_at,
              card_policy_version,card_brand_snapshot,card_funding_snapshot,
              card_verified_at
         FROM payment_attempts WHERE id=$1 FOR UPDATE`,
      [attemptId]
    );
    // `cancelling` es una barrera: si settlement ganó primero, ya no se prepara
    // un contrato remoto nuevo. Los cancelling YA preparados se reconcilian por
    // su key durable, pero nunca se inicia un side effect desde ese estado.
    if (!current || current.stripe_payment_intent_id
        || current.status !== 'pending') {
      throw new Error('payment_attempt_contract_state_conflict');
    }
    const account = stripeAccountId || null;
    const fee = Number(applicationFeeCents || 0);
    const durableSnapshot = storedAttemptCardSnapshot(current);
    if (!Number.isSafeInteger(fee) || fee < 0 || !sourcePaymentMethodId
        || typeof usedSavedCard !== 'boolean'
        || typeof savePaymentMethod !== 'boolean'
        || !cardEligibility.isTrustedSnapshot(sourceCardSnapshot)
        || !durableSnapshot
        || current.stripe_source_payment_method_id !== sourcePaymentMethodId
        || durableSnapshot.policyVersion !== sourceCardSnapshot.policyVersion
        || durableSnapshot.brand !== sourceCardSnapshot.brand
        || durableSnapshot.funding !== sourceCardSnapshot.funding
        || new Date(durableSnapshot.verifiedAt).getTime()
          !== new Date(sourceCardSnapshot.verifiedAt).getTime()) {
      throw new Error('payment_attempt_contract_invalid');
    }
    const customer = customerId || null;
    if (current.stripe_contract_prepared_at) {
      if ((current.stripe_account_id || null) !== account
          || Number(current.application_fee_cents) !== fee
          || current.stripe_source_payment_method_id !== sourcePaymentMethodId
          || (current.stripe_customer_id_snapshot || null) !== customer
          || current.stripe_used_saved_card !== usedSavedCard
          || current.stripe_save_payment_method !== savePaymentMethod) {
        throw new Error('payment_attempt_contract_conflict');
      }
      if (account) {
        // El attempt pudo quedar preparado y caer antes del siguiente paso.
        // Un retry termina idempotentemente de retirar la proyección wallet.
        await client.query(
          `DELETE FROM tip_distributions
            WHERE payment_attempt_id=$1 AND status='pending'`,
          [attemptId]
        );
      }
      return current;
    }
    const { rows: [prepared] } = await client.query(
      `UPDATE payment_attempts
          SET stripe_contract_prepared_at=NOW(), stripe_account_id=$2,
              application_fee_cents=$3, stripe_source_payment_method_id=$4,
              stripe_customer_id_snapshot=$5,
              stripe_used_saved_card=$6, stripe_save_payment_method=$7
        WHERE id=$1
      RETURNING stripe_contract_prepared_at, stripe_account_id,
                application_fee_cents, stripe_source_payment_method_id,
                stripe_charge_payment_method_id, stripe_customer_id_snapshot,
                stripe_used_saved_card, stripe_save_payment_method,
                card_policy_version,card_brand_snapshot,card_funding_snapshot,
                card_verified_at,charge_card_verified_at`,
      [attemptId, account, fee, sourcePaymentMethodId, customer,
       usedSavedCard, savePaymentMethod]
    );
    if (account) {
      // El direct charge deposita el bruto —incluida la propina— en la cuenta
      // del restaurante. La fila pending se creó antes de conocer el riel y
      // debe desaparecer atómicamente con el snapshot del contrato Stripe.
      await client.query(
        `DELETE FROM tip_distributions
          WHERE payment_attempt_id=$1 AND status='pending'`,
        [attemptId]
      );
    }
    return prepared;
  });
}

async function persistAttemptChargePaymentMethod(
  attemptId, chargePaymentMethodId, chargeCardVerifiedAt
) {
  return pool.tx(async (client) => {
    const { rows: [current] } = await client.query(
      `SELECT stripe_contract_prepared_at, stripe_charge_payment_method_id,
              charge_card_verified_at,card_policy_version
         FROM payment_attempts WHERE id=$1 FOR UPDATE`, [attemptId]
    );
    const verifiedAt = new Date(chargeCardVerifiedAt);
    if (!current?.stripe_contract_prepared_at || !chargePaymentMethodId
        || Number(current.card_policy_version) !== 1
        || !Number.isFinite(verifiedAt.getTime())) {
      throw new Error('payment_attempt_contract_not_prepared');
    }
    if (current.stripe_charge_payment_method_id
        && current.stripe_charge_payment_method_id !== chargePaymentMethodId) {
      throw new Error('payment_attempt_charge_method_conflict');
    }
    if (current.stripe_charge_payment_method_id && current.charge_card_verified_at) {
      // El primer verificador gana. Dos retries pueden recuperar el mismo clon
      // idempotente y observarlo en instantes distintos; eso no es conflicto.
      return {
        id: current.stripe_charge_payment_method_id,
        verifiedAt: current.charge_card_verified_at,
      };
    }
    if (!current.stripe_charge_payment_method_id) {
      await client.query(
        `UPDATE payment_attempts
            SET stripe_charge_payment_method_id=$2,charge_card_verified_at=$3
          WHERE id=$1`,
        [attemptId, chargePaymentMethodId, verifiedAt]
      );
    } else {
      // Compat de una fila legacy con el ID ya durable: sólo se completa la
      // evidencia del MISMO ID. La migración/trigger impiden cambiarlo.
      await client.query(
        `UPDATE payment_attempts SET charge_card_verified_at=$3
          WHERE id=$1 AND stripe_charge_payment_method_id=$2
            AND charge_card_verified_at IS NULL`,
        [attemptId, chargePaymentMethodId, verifiedAt]
      );
    }
    return { id: chargePaymentMethodId, verifiedAt };
  });
}

/**
 * Persiste el resultado de crear el PI sin resucitar un attempt que settlement
 * ya está cancelando. El binding remoto se conserva aun en la carrera para que
 * el worker/webhook pueda reconciliarlo. Si Stripe ya cobró, succeeded gana y
 * el siguiente cálculo de faltante lo contará; cualquier otro estado permanece
 * cancelling y no se publica un client_secret confirmable.
 */
async function persistAttemptStripeResult({
  attemptId, intentId, clientSecret, newStatus, stripeAccountId, applicationFeeCents,
}) {
  return pool.tx(async (client) => {
    const { rows: [current] } = await client.query(
      `SELECT status, stripe_payment_intent_id, stripe_account_id,
              application_fee_cents, stripe_contract_prepared_at,
              stripe_charge_payment_method_id,charge_card_verified_at,
              card_policy_version,card_verified_at
         FROM payment_attempts WHERE id=$1 FOR UPDATE`, [attemptId]
    );
    if (!current) {
      throw Object.assign(new Error('payment_attempt_not_found'), {
        code: 'payment_attempt_not_found', status: 409,
      });
    }
    if (current.stripe_payment_intent_id && current.stripe_payment_intent_id !== intentId) {
      throw Object.assign(new Error('payment_attempt_stripe_binding_conflict'), {
        code: 'payment_attempt_stripe_binding_conflict', status: 409,
      });
    }
    if (!current.stripe_contract_prepared_at || !current.stripe_charge_payment_method_id
        || Number(current.card_policy_version) !== 1
        || !current.card_verified_at || !current.charge_card_verified_at) {
      throw Object.assign(new Error('payment_attempt_contract_not_prepared'), {
        code: 'payment_attempt_contract_not_prepared', status: 409,
      });
    }
    if ((current.stripe_account_id || null) !== (stripeAccountId || null)) {
      throw Object.assign(new Error('payment_attempt_stripe_account_conflict'), {
        code: 'payment_attempt_stripe_account_conflict', status: 409,
      });
    }
    if (Number(current.application_fee_cents) !== Number(applicationFeeCents || 0)) {
      throw Object.assign(new Error('payment_attempt_application_fee_conflict'), {
        code: 'payment_attempt_application_fee_conflict', status: 409,
      });
    }

    const bindOnly = async () => client.query(
      `UPDATE payment_attempts
          SET stripe_payment_intent_id = COALESCE(stripe_payment_intent_id, $2),
              stripe_client_secret = $3
        WHERE id = $1`,
      [attemptId, intentId, clientSecret || null]
    );

    if (['cancelled', 'failed'].includes(newStatus)
        && stateMachine.canTransition('payment_attempt', current.status, newStatus)) {
      await bindOnly();
      return {
        accepted: false, terminal: true, status: current.status,
        terminalStatus: newStatus, race: current.status !== 'pending',
      };
    }

    const progressRank = {
      pending: 0,
      requires_action: 1,
      authorized: 1,
      processing: 2,
      succeeded: 3,
      processed: 4,
      refunded: 5,
    };
    const canAdvance = progressRank[newStatus] > progressRank[current.status]
      && stateMachine.canTransition('payment_attempt', current.status, newStatus);
    const settlementWin = current.status === 'cancelling' && newStatus === 'succeeded';

    if (newStatus === 'succeeded' && ['failed', 'cancelled'].includes(current.status)) {
      await bindOnly();
      return {
        accepted: true, terminal: false, lateSuccess: true,
        status: current.status, race: true,
      };
    }

    if (current.status === 'pending' || canAdvance || settlementWin) {
      await client.query(
        `UPDATE payment_attempts
            SET stripe_payment_intent_id=$2, stripe_client_secret=$3, status=$4
          WHERE id=$1`,
        [attemptId, intentId, clientSecret || null, newStatus]
      );
      if (current.status !== newStatus) {
        await stateMachine.transition({
          client, entityType: 'payment_attempt', entityId: attemptId,
          fromState: current.status, toState: newStatus,
          reason: current.status === 'cancelling'
            ? 'stripe_won_settlement_race'
            : 'stripe_sync_result',
          triggeredBy: 'system',
        });
      }
      return { accepted: true, terminal: false, status: newStatus, race: current.status !== 'pending' };
    }

    await bindOnly();
    const alreadyUsable = ['requires_action', 'processing', 'authorized', 'succeeded', 'processed', 'refunded']
      .includes(current.status);
    return { accepted: alreadyUsable, status: current.status, race: true };
  });
}

async function rejectStripeResultDuringSettlement({
  binding, stripeIntent, stripeAccountId, mesaId, attemptId,
}) {
  logger.error('payment_attempt_settlement_race', {
    mesa_id: mesaId, attempt_id: attemptId,
    attempt_status: binding.status, stripe_status: stripeIntent.status,
  });
  const successResponse = async () => {
    const row = await loadAttemptByIdForResponse(attemptId);
    return row
      ? { httpStatus: 200, body: attemptReplayResponse(row) }
      : { httpStatus: 503, body: paymentReconciliationPendingBody(binding.status) };
  };
  if (stripeIntent.status === 'succeeded') {
    const result = await settlement.reconcileSucceededAttempt({
      attemptId, mesaId, remoteIntent: stripeIntent,
      stripeAccountId: stripeAccountId || null, triggeredBy: 'system',
    });
    return result.resolved
      ? successResponse()
      : { httpStatus: 503, body: paymentReconciliationPendingBody(binding.status) };
  }
  {
    try {
      const canceled = await stripeService.cancelIntent(
        stripeIntent.id, 'abandoned', stripeAccountId || null
      );
      const reconciliation = await settlement.reconcileAttemptCancellation({
        attemptId,
        mesaId,
        intentId: stripeIntent.id,
        stripeAccountId: stripeAccountId || null,
        reason: 'stripe_cancelled_during_settlement_race',
        triggeredBy: 'system',
        remoteIntent: canceled,
      });
      if (reconciliation.resolved && reconciliation.outcome === 'succeeded') {
        return successResponse();
      }
      if (!reconciliation.resolved) {
        return {
          httpStatus: 503,
          body: paymentReconciliationPendingBody('cancelling'),
        };
      }
    } catch (err) {
      const reconciliation = await settlement.reconcileAttemptCancellation({
        attemptId,
        mesaId,
        intentId: stripeIntent.id,
        stripeAccountId: stripeAccountId || null,
        reason: 'stripe_cancelled_during_settlement_race',
        triggeredBy: 'system',
      });
      logger.error('payment_attempt_race_cancel_uncertain', {
        mesa_id: mesaId, attempt_id: attemptId,
        intent_id: stripeIntent.id, error: err.message,
        reconciled: reconciliation.resolved,
        remote_status: reconciliation.remoteStatus || null,
      });
      if (reconciliation.resolved && reconciliation.outcome === 'succeeded') {
        return successResponse();
      }
      if (!reconciliation.resolved) {
        return {
          httpStatus: 503,
          body: paymentReconciliationPendingBody('cancelling'),
        };
      }
      const mesaStatus = await currentMesaStatus(mesaId);
      return {
        httpStatus: 409,
        body: { error: 'mesa_not_payable', status: mesaStatus, attempt_status: 'cancelled' },
      };
    }
  }
  const mesaStatus = await currentMesaStatus(mesaId);
  return {
    httpStatus: 409,
    body: { error: 'mesa_not_payable', status: mesaStatus, attempt_status: 'cancelled' },
  };
}

async function currentMesaStatus(mesaId) {
  const { rows: [row] } = await pool.query(`SELECT status FROM mesas WHERE id=$1`, [mesaId]);
  return row?.status || null;
}

async function loadAttemptByIdForResponse(attemptId) {
  const { rows: [row] } = await pool.query(
    `SELECT id, status, stripe_client_secret, gross_amount_cents,
            items_amount_cents, tip_amount_cents, payment_type,
            stripe_account_id
       FROM payment_attempts WHERE id=$1`,
    [attemptId]
  );
  return hydrateAttemptItems(pool, row || null);
}

function pendingBoundAttemptReplay(row) {
  return {
    httpStatus: 503,
    body: {
      error: 'payment_reconciliation_pending',
      attempt_status: row.status,
      retry_with_same_idempotency_key: true,
    },
  };
}

async function persistRecoveredAttemptClientSecret({
  attemptId, mesaId, intentId, stripeAccountId, remoteIntent, clientSecret,
}) {
  await pool.tx(async (client) => {
    // Mismo orden global de dinero que settlement/webhooks: mesa → attempt.
    const { rows: [currentMesa] } = await client.query(
      `SELECT status FROM mesas WHERE id=$1 FOR UPDATE`, [mesaId]
    );
    if (!currentMesa || !['open', 'partially_paid'].includes(currentMesa.status)) {
      throw new Error('payment_attempt_replay_mesa_not_payable');
    }
    const { rows: [current] } = await client.query(
      `SELECT status,stripe_payment_intent_id,stripe_account_id,
              stripe_client_secret
         FROM payment_attempts WHERE id=$1 FOR UPDATE`,
      [attemptId]
    );
    if (!current || current.status !== 'requires_action'
        || current.stripe_payment_intent_id !== intentId
        || (current.stripe_account_id || null) !== (stripeAccountId || null)) {
      throw new Error('payment_attempt_replay_binding_race');
    }

    // La segunda validación ocurre con la fila bloqueada. Así un snapshot
    // completo y el mismo PI son condición de la única escritura permitida.
    const contractAttempt = await loadPaymentAttemptContract(attemptId, client);
    assertPaymentIntentContract(contractAttempt, remoteIntent, {
      stripeAccountId: stripeAccountId || null,
      expectedStatus: 'requires_action',
    });
    if (current.stripe_client_secret) {
      if (current.stripe_client_secret !== clientSecret) {
        throw new Error('payment_attempt_replay_client_secret_conflict');
      }
      return;
    }
    const persisted = await client.query(
      `UPDATE payment_attempts
          SET stripe_client_secret=$3
        WHERE id=$1 AND stripe_payment_intent_id=$2
          AND stripe_account_id IS NOT DISTINCT FROM $4
          AND status='requires_action' AND stripe_client_secret IS NULL
        RETURNING id`,
      [attemptId, intentId, clientSecret, stripeAccountId || null]
    );
    if (persisted.rowCount !== 1) {
      throw new Error('payment_attempt_replay_client_secret_cas_lost');
    }
  });

  const latest = await loadAttemptByIdForResponse(attemptId);
  if (!latest || latest.status !== 'requires_action'
      || latest.stripe_client_secret !== clientSecret) {
    throw new Error('payment_attempt_replay_client_secret_incomplete');
  }
  return latest;
}

/**
 * Recupera exclusivamente el PI durable de un replay 3DS cuya respuesta local
 * perdió el client_secret. No vuelve a evaluar tarjeta ni crea side effects
 * remotos: retrieve exacto → contrato durable → convergencia o cierre probado.
 */
async function reconcileBoundRequiresActionReplay(row, mesaId) {
  const pending = () => pendingBoundAttemptReplay(row);
  try {
    if (row.status !== 'requires_action' || row.stripe_client_secret
        || !row.stripe_payment_intent_id) {
      throw new Error('payment_attempt_replay_not_recoverable');
    }
    const stripeAccountId = row.stripe_account_id || null;
    const remoteIntent = await stripeService.retrieveIntent(
      row.stripe_payment_intent_id, stripeAccountId
    );
    const contractAttempt = await loadPaymentAttemptContract(row.id);
    if (!contractAttempt || contractAttempt.mesa_id !== mesaId
        || contractAttempt.status !== 'requires_action') {
      throw new Error('payment_attempt_replay_local_contract_race');
    }
    assertPaymentIntentContract(contractAttempt, remoteIntent, {
      stripeAccountId,
      allowedStatuses: [
        'requires_action', 'succeeded', 'canceled', 'requires_payment_method',
      ],
    });

    if (remoteIntent.status === 'requires_action') {
      const clientSecret = remoteIntent.client_secret;
      if (typeof clientSecret !== 'string' || clientSecret.length === 0
          || clientSecret.length > 255) {
        throw new Error('payment_attempt_replay_client_secret_missing');
      }
      const latest = await persistRecoveredAttemptClientSecret({
        attemptId: row.id,
        mesaId,
        intentId: row.stripe_payment_intent_id,
        stripeAccountId,
        remoteIntent,
        clientSecret,
      });
      return { httpStatus: 200, body: attemptReplayResponse(latest) };
    }

    if (remoteIntent.status === 'succeeded') {
      const result = await settlement.reconcileSucceededAttempt({
        attemptId: row.id,
        mesaId,
        remoteIntent,
        stripeAccountId,
        triggeredBy: 'system',
      });
      if (!result.resolved) {
        throw Object.assign(new Error('payment_attempt_replay_success_pending'), {
          reason: result.reason || null,
        });
      }
      const latest = await loadAttemptByIdForResponse(row.id);
      if (!latest || !['processed', 'refunded'].includes(latest.status)) {
        throw new Error('payment_attempt_replay_success_incomplete');
      }
      return { httpStatus: 200, body: attemptReplayResponse(latest) };
    }

    const terminalStatus = remoteIntent.status === 'canceled'
      ? 'cancelled'
      : 'failed';
    await finalizeRemoteTerminalStrict(
      row.id, terminalStatus, `stripe_replay_${remoteIntent.status}`
    );
    const latest = await loadAttemptByIdForResponse(row.id);
    if (!latest || latest.status !== terminalStatus) {
      throw new Error('payment_attempt_replay_terminal_incomplete');
    }
    return {
      httpStatus: 409,
      body: {
        error: 'idempotency_key_terminal',
        attempt_status: terminalStatus,
      },
    };
  } catch (err) {
    logger.error('payment_attempt_requires_action_replay_reconciliation_failed', {
      mesa_id: mesaId,
      attempt_id: row.id,
      intent_id: row.stripe_payment_intent_id || null,
      account: row.stripe_account_id || null,
      error: err.message,
      code: err.code || null,
      reason: err.reason || null,
      mismatches: err.details?.mismatches || null,
    });
    return pending();
  }
}

/**
 * Un replay durable en `succeeded` no acredita que los efectos locales hayan
 * terminado: el proceso pudo caer luego de bindear el PI y antes de aplicar
 * slots/items/propina/outbox. Releemos el objeto remoto exacto y pasamos por la
 * misma primitiva transaccional que usan sync, webhook y reconciliación. Nunca
 * se crea un PI nuevo ni se responde éxito sobre una proyección incompleta.
 */
async function reconcileSucceededReplay(row, mesaId) {
  try {
    if (!row.stripe_payment_intent_id) {
      throw new Error('succeeded_attempt_without_payment_intent');
    }
    const remoteIntent = await stripeService.retrieveIntent(
      row.stripe_payment_intent_id,
      row.stripe_account_id || null
    );
    const result = await settlement.reconcileSucceededAttempt({
      attemptId: row.id,
      mesaId,
      remoteIntent,
      stripeAccountId: row.stripe_account_id || null,
      triggeredBy: 'system',
    });
    if (!result.resolved) {
      throw Object.assign(new Error('succeeded_attempt_reconciliation_pending'), {
        reason: result.reason || null,
      });
    }
    const latest = await loadAttemptByIdForResponse(row.id);
    if (!latest || !['processed', 'refunded'].includes(latest.status)) {
      throw new Error('succeeded_attempt_reconciliation_incomplete');
    }
    return { httpStatus: 200, body: attemptReplayResponse(latest) };
  } catch (err) {
    logger.error('succeeded_attempt_replay_reconciliation_failed', {
      mesa_id: mesaId,
      attempt_id: row.id,
      intent_id: row.stripe_payment_intent_id || null,
      error: err.message,
      reason: err.reason || null,
    });
    return {
      httpStatus: 503,
      body: {
        error: 'payment_reconciliation_pending',
        attempt_status: 'succeeded',
        retry_with_same_idempotency_key: true,
      },
    };
  }
}

/**
 * Replay con el MISMO shape que el 201 (el crudo de la fila devolvía
 * `stripe_client_secret` en vez de `client_secret`, sin `requires_action`, y
 * `gross_amount_cents` como STRING — violando el barrido D4).
 */
function attemptReplayResponse(row) {
  const wallet = row.payment_type === 'wallet';
  return {
    attempt: {
      id: row.id,
      gross_amount_cents: Number(row.gross_amount_cents),
      ...(wallet && { gross_display: centsToDisplay(Number(row.gross_amount_cents)) }),
      tip_cents: Number(row.tip_amount_cents || 0),
      ...(row.items && { items: row.items.map((item) => ({
        item_id: item.item_id,
        fraction_bps: Number(item.fraction_bps),
        amount_cents: Number(item.amount_cents),
      })) }),
      status: row.status,
      payment_type: row.payment_type,
      ...(!wallet && {
        client_secret: row.stripe_client_secret || null,
        requires_action: row.status === 'requires_action',
      }),
      ...(row.stripe_account_id && { connected_account_id: row.stripe_account_id }),
    },
    idempotent: true,
  };
}

async function loadAttemptReplayGate(identity) {
  return pool.tx(async (client) => {
    // Orden único con webhook/refund/settlement: mesa → attempt.
    const { rows: [currentMesa] } = await client.query(
      `SELECT status FROM mesas WHERE id=$1 FOR UPDATE`, [identity.mesa_id]
    );
    const attempt = currentMesa
      ? await findExistingAttempt(identity, client)
      : null;
    return {
      payable: !!currentMesa && ['open', 'partially_paid'].includes(currentMesa.status),
      status: currentMesa?.status || null,
      attempt,
    };
  });
}

function isAttemptIdempotencyViolation(err, { userId, guestTokHash, guestTok }) {
  if (err?.code !== '23505') return false;
  if (userId) return err.constraint === 'uq_payment_attempts_idem_user';
  if (guestTokHash) return err.constraint === 'uq_payment_attempts_idem_guest_hash';
  if (guestTok) return err.constraint === 'uq_payment_attempts_idem_guest';
  return false;
}

async function hydrateAttemptItems(db, row) {
  if (!row) return null;
  const { rows: items } = await db.query(
    `SELECT mesa_item_id AS item_id, fraction_bps, amount_cents
       FROM payment_attempt_items
      WHERE payment_attempt_id=$1
        AND fraction_bps IS NOT NULL AND amount_cents IS NOT NULL
      ORDER BY mesa_item_id ASC, fraction_bps ASC`,
    [row.id]
  );
  return items.length > 0 ? { ...row, items } : row;
}

async function findExistingAttempt(
  { user_id, guest_token_hash, guest_token, mesa_id, idempotency_key },
  db,
) {
  if (!db) throw new Error('findExistingAttempt_requires_transaction');
  // v2.23: se trae stripe_account_id para que el REPLAY idempotente también
  // devuelva connected_account_id. Sin eso, un reintento del front sobre un
  // pago del riel directo recibía el client_secret sin la cuenta, y el 3DS
  // quedaba inconfirmable.
  const SELECT = `SELECT id, status, stripe_client_secret, gross_amount_cents,
                         items_amount_cents, tip_amount_cents, fee_amount_cents, payment_type,
                         division_slot_index, payment_method_id,
                         idempotency_payload_hash, idempotency_hash_version,
                         stripe_account_id,
                         stripe_payment_intent_id, application_fee_cents,
                         stripe_contract_prepared_at,
                         stripe_source_payment_method_id,
                         stripe_charge_payment_method_id,
                         stripe_customer_id_snapshot,
                         stripe_used_saved_card, stripe_save_payment_method,
                         card_policy_version,card_brand_snapshot,
                         card_funding_snapshot,card_verified_at,
                         charge_card_verified_at
                   FROM payment_attempts
                   WHERE %COL% = $1 AND mesa_id = $2
                     AND operation_type = 'mesa_pay' AND idempotency_key = $3
                   FOR UPDATE`;

  if (user_id) {
    const { rows } = await db.query(SELECT.replace('%COL%', 'user_id'),
      [user_id, mesa_id, idempotency_key]);
    return hydrateAttemptItems(db, rows[0] || null);
  }
  if (guest_token_hash) {
    const { rows } = await db.query(SELECT.replace('%COL%', 'guest_token_hash'),
      [guest_token_hash, mesa_id, idempotency_key]);
    if (rows[0]) return hydrateAttemptItems(db, rows[0]);
  }
  if (guest_token) {
    const { rows } = await db.query(SELECT.replace('%COL%', 'guest_token'),
      [guest_token, mesa_id, idempotency_key]);
    return hydrateAttemptItems(db, rows[0] || null);
  }
  return null;
}

function attemptHashesMatch(row, currentHash, legacyHash) {
  return Number(row?.idempotency_hash_version || 1) >= 2
    ? hashesMatch(row.idempotency_payload_hash, currentHash)
    : hashesMatch(row.idempotency_payload_hash, legacyHash);
}

async function releaseAttemptItems(attemptId, reason) {
  try {
    await failAttemptStrict(attemptId, reason);
    return true;
  } catch (err) {
    logger.error('release_attempt_items_failed', { attempt_id: attemptId, error: err.message });
    return false;
  }
}

async function failAttemptStrict(attemptId, reason) {
  return pool.tx(async (client) => {
    const result = await paymentProcessor.processFailedPayment(client, attemptId, reason);
    if (!result.processed) {
      const err = new Error('payment_attempt_failure_not_applied');
      err.code = 'payment_attempt_failure_not_applied';
      throw err;
    }
    return result;
  });
}

async function finalizeRemoteTerminalStrict(attemptId, terminalStatus, reason) {
  if (terminalStatus === 'cancelled') {
    const result = await settlement.finalizeCancellingAttempt(attemptId, {
      reason,
      triggeredBy: 'system',
      allowedFrom: ['pending', 'requires_action', 'processing', 'authorized', 'cancelling'],
    });
    if (!result.finalized && result.status !== 'cancelled') {
      const err = new Error('payment_attempt_cancellation_not_applied');
      err.code = 'payment_attempt_cancellation_not_applied';
      throw err;
    }
    return result;
  }
  return failAttemptStrict(attemptId, reason);
}

module.exports = router;
