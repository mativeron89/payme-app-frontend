/**
 * services/connect.js — Stripe Connect: cuentas conectadas de restaurantes (v2.22)
 *
 * Fase 1 del pivote (acta 2026-07-24): onboarding + estado de la cuenta.
 * NO mueve dinero — eso es Fase 2 (direct charges) y Fase 3 (garantía).
 *
 * Forma de cuenta ratificada por Mati (2026-07-24), verificada en Stripe test
 * mode (Fase 0, experimento E2a):
 *   - `stripe_dashboard.type = 'full'`   → el restaurante ve su propio Stripe
 *   - `losses.payments = 'stripe'`       → los contracargos NO los come PayMe
 *   - `requirement_collection = 'stripe'`→ KYC hosted por Stripe (nada de PII acá)
 *   - `fees.payer = 'account'`           → las comisiones de Stripe las paga el
 *     RESTAURANTE. ⚠️ Stripe CONGELA esto al crear la cuenta: no se puede
 *     cambiar después. Por eso se persiste por restaurante (stripe_fees_payer).
 *
 * México (verificado en Fase 0, E3): pide RFC (`individual.id_number` /
 * `company.tax_id`), NO pide CURP. Todo eso lo recolecta Stripe en el flujo
 * hosted — este backend nunca ve documentos de identidad.
 */
'use strict';

const { stripe } = require('./stripe');
const pool = require('../db/pool');
const logger = require('../utils/logger');

const COUNTRY = 'MX';
const MCC_RESTAURANTE = '5812';   // Eating places, restaurants

/**
 * Estado derivado que guardamos en restaurants.stripe_account_status.
 * `charges_enabled` y la capability son cosas distintas: Stripe puede tener
 * charges_enabled=true con card_payments todavía en 'pending'. Para el gate de
 * cobro exigimos LAS DOS.
 */
function deriveStatus(acct) {
  const cap = acct.capabilities?.card_payments;
  if (acct.charges_enabled && cap === 'active') return 'active';
  const reason = acct.requirements?.disabled_reason || '';
  if (reason.startsWith('rejected')) return 'disabled';
  if (reason) return 'restricted';
  return 'pending';
}

/** Proyección pura de una cuenta de Stripe a nuestras columnas. Sin I/O. */
function mapAccountState(acct) {
  return {
    status: deriveStatus(acct),
    charges_enabled: !!acct.charges_enabled,
    payouts_enabled: !!acct.payouts_enabled,
    card_payments_status: acct.capabilities?.card_payments || null,
    requirements: {
      currently_due: acct.requirements?.currently_due || [],
      past_due: acct.requirements?.past_due || [],
      pending_verification: acct.requirements?.pending_verification || [],
      disabled_reason: acct.requirements?.disabled_reason || null,
      current_deadline: acct.requirements?.current_deadline || null,
      // Señal canónica de Stripe para "¿terminó de cargar sus datos?": separa
      // «nunca arrancó el KYC» de «lo mandó y está en verificación», que de
      // otro modo se ven iguales desde `status='pending'`.
      details_submitted: !!acct.details_submitted,
    },
  };
}

/** Vista pública del estado (la que devuelven las rutas). Sin datos de KYC. */
function publicState(row) {
  return {
    stripe_account_id: row.stripe_account_id || null,
    status: row.stripe_account_status,
    charges_enabled: !!row.stripe_charges_enabled,
    payouts_enabled: !!row.stripe_payouts_enabled,
    card_payments_status: row.stripe_card_payments_status || null,
    fees_payer: row.stripe_fees_payer,
    requirements: row.stripe_requirements || {},
    onboarded_at: row.stripe_onboarded_at || null,
    synced_at: row.stripe_account_synced_at || null,
  };
}

/**
 * Crea la cuenta conectada del restaurante. Idempotente por restaurante: si ya
 * tiene `stripe_account_id`, no crea otra (el UPDATE con `IS NULL` es el guard
 * contra la carrera de dos managers tocando el botón a la vez).
 */
async function createConnectedAccount({ restaurant, feesPayer = 'account' }) {
  if (restaurant.stripe_account_id) {
    return { created: false, accountId: restaurant.stripe_account_id };
  }

  const acct = await stripe.accounts.create({
    country: COUNTRY,
    controller: {
      stripe_dashboard: { type: 'full' },
      losses: { payments: 'stripe' },
      requirement_collection: 'stripe',
      fees: { payer: feesPayer },
    },
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },   // card_payments la exige
    },
    business_profile: {
      name: restaurant.name,
      mcc: MCC_RESTAURANTE,
    },
    metadata: { payme_restaurant_id: restaurant.id },
  }, { idempotencyKey: `connect_acct_${restaurant.id}` });

  const st = mapAccountState(acct);
  const { rowCount } = await pool.query(
    `UPDATE restaurants
        SET stripe_account_id = $2,
            stripe_account_status = $3,
            stripe_charges_enabled = $4,
            stripe_payouts_enabled = $5,
            stripe_card_payments_status = $6,
            stripe_requirements = $7,
            stripe_fees_payer = $8,
            stripe_account_synced_at = NOW()
      WHERE id = $1 AND stripe_account_id IS NULL`,
    [restaurant.id, acct.id, st.status, st.charges_enabled, st.payouts_enabled,
     st.card_payments_status, JSON.stringify(st.requirements), feesPayer]
  );

  if (rowCount === 0) {
    // Otro request ganó la carrera: la cuenta recién creada queda huérfana en
    // Stripe (sin KYC, sin poder cobrar). Se traza para limpieza manual.
    logger.error('connect_account_race_orphan', {
      restaurant_id: restaurant.id, orphan_account_id: acct.id,
    });
    const { rows } = await pool.query(
      `SELECT stripe_account_id FROM restaurants WHERE id = $1`, [restaurant.id]
    );
    return { created: false, accountId: rows[0]?.stripe_account_id || null };
  }

  logger.audit('connect_account_created', {
    restaurant_id: restaurant.id, account_id: acct.id, fees_payer: feesPayer,
  });
  return { created: true, accountId: acct.id, state: st };
}

/**
 * Link de onboarding hosted. OJO (verificado en Fase 0, E4): dura ~5 minutos y
 * es de UN SOLO USO — además se quema si un preview de chat lo abre. Por eso se
 * genera on-demand y se redirige en el momento; nunca se manda por WhatsApp.
 */
async function createOnboardingLink({ accountId, refreshUrl, returnUrl }) {
  const link = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: 'account_onboarding',
    // eventually_due: junta todo de una en vez de pedirle datos al restaurante
    // dos veces.
    collection_options: { fields: 'eventually_due' },
  });
  return { url: link.url, expires_at: link.expires_at };
}

/**
 * Relee la cuenta en Stripe y persiste el estado.
 *
 * SIEMPRE relee en vez de confiar en el payload del evento: los webhooks de
 * Stripe no garantizan orden, y dos `account.updated` en ráfaga (el KYC de
 * Connect emite varios seguidos) podían pisar el estado nuevo con uno viejo.
 * Releer + serializar por fila hace que el resultado converja al estado ACTUAL,
 * que es lo que decide si un restaurante puede cobrar.
 */
async function syncAccount(restaurantId, accountId) {
  const acct = await stripe.accounts.retrieve(accountId);
  return persistAccountState(restaurantId, acct);
}

/**
 * Persiste el estado de una cuenta ya leída.
 *
 * `FOR UPDATE` serializa por restaurante: sin eso, dos webhooks concurrentes de
 * la misma cuenta eran last-writer-wins.
 *
 * ⚠️ Los `::varchar` NO son decorativos: sin ellos Postgres deduce `$2` como
 * varchar (por el SET) y como text (por el CASE) en la misma sentencia y falla
 * en el PARSE con 42P08 — la query no llega a ejecutarse NUNCA. Con el
 * protocolo extendido de node-pg los parámetros van sin tipo, así que probar el
 * SQL a mano en psql (que sí los declara) da verde y engaña.
 */
async function persistAccountState(restaurantId, acct) {
  const st = mapAccountState(acct);
  return pool.tx(async (client) => {
    await client.query(`SELECT id FROM restaurants WHERE id = $1 FOR UPDATE`, [restaurantId]);
    const { rows } = await client.query(
      `UPDATE restaurants
          SET stripe_account_status = $2::varchar,
              stripe_charges_enabled = $3,
              stripe_payouts_enabled = $4,
              stripe_card_payments_status = $5,
              stripe_requirements = $6,
              stripe_account_synced_at = NOW(),
              -- se sella la primera vez que la cuenta queda habilitada, y no se
              -- borra si después se degrada
              stripe_onboarded_at = COALESCE(stripe_onboarded_at,
                                             CASE WHEN $2::varchar = 'active' THEN NOW() END)
        WHERE id = $1
        RETURNING *`,
      [restaurantId, st.status, st.charges_enabled, st.payouts_enabled,
       st.card_payments_status, JSON.stringify(st.requirements)]
    );
    return rows[0] || null;
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// GATE DE COBRO — una sola definición para pagos (v2.23) y garantía (v2.24)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Los direct charges son OPT-IN explícito (al revés de RELAY/TIMER, que vienen
 * encendidos). Encenderlos antes de tiempo cobra plata real en una cuenta ajena
 * y deja dos agujeros sin red: el front todavía no confirma 3DS sobre cuenta
 * conectada, y sin el secreto del webhook Connect un cobro real no se registra.
 * Por eso exige AMBAS: la variable en 'true' y el secreto configurado.
 */
function directChargesEnabled() {
  return process.env.CONNECT_DIRECT_CHARGES === 'true'
    && !!process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
}

/**
 * ¿Los cobros de este restaurante van a su cuenta conectada?
 * Devuelve { accountId, feePct } o null.
 *
 * Exige `charges_enabled` Y la capability `card_payments` activa: Stripe puede
 * tener una sin la otra, y con una sola el cargo se rechaza. Ante cualquier
 * duda devuelve null = se cobra por plataforma y se dispersa por STP, o sea el
 * comportamiento previo al pivote.
 */
async function resolveChargeTarget(restaurantId) {
  if (!directChargesEnabled() || !restaurantId) return null;
  const { rows } = await pool.query(
    `SELECT stripe_account_id, stripe_account_status, stripe_charges_enabled,
            stripe_card_payments_status, fee_pct
       FROM restaurants WHERE id = $1`,
    [restaurantId]
  );
  return targetDe(rows[0]);
}

/** Idem, resolviendo el restaurante desde la mesa (lo usa la garantía). */
async function resolveChargeTargetByMesa(mesaId) {
  if (!directChargesEnabled() || !mesaId) return null;
  const { rows } = await pool.query(
    `SELECT r.stripe_account_id, r.stripe_account_status, r.stripe_charges_enabled,
            r.stripe_card_payments_status, r.fee_pct
       FROM mesas m JOIN restaurants r ON r.id = m.restaurant_id
      WHERE m.id = $1`,
    [mesaId]
  );
  return targetDe(rows[0]);
}

function targetDe(r) {
  if (!r?.stripe_account_id) return null;
  const listo = r.stripe_account_status === 'active'
    && r.stripe_charges_enabled === true
    && r.stripe_card_payments_status === 'active';
  return listo ? { accountId: r.stripe_account_id, feePct: Number(r.fee_pct || 0.02) } : null;
}

/** Busca el restaurante dueño de una cuenta conectada (ruteo del webhook). */
async function findRestaurantByAccount(accountId) {
  const { rows } = await pool.query(
    `SELECT id, stripe_account_id FROM restaurants WHERE stripe_account_id = $1`,
    [accountId]
  );
  return rows[0] || null;
}

module.exports = {
  COUNTRY,
  deriveStatus,
  mapAccountState,
  publicState,
  directChargesEnabled,
  resolveChargeTarget,
  resolveChargeTargetByMesa,
  createConnectedAccount,
  createOnboardingLink,
  syncAccount,
  persistAccountState,
  findRestaurantByAccount,
};
