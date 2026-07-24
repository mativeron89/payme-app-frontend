/**
 * services/itemClaims.js — v2.18 · Tenencia de ítems por FRACCIONES
 * Acta: ops/actas/[PAYME]_ACTA_2026-07-23_FRACCIONES_PLATOS_COMPARTIDOS.md
 *
 * LA fuente de verdad de quién tiene qué parte de cada ítem es
 * mesa_item_claims: una fila por reclamo (entero = 10000 bps). El camino
 * entero legacy (item_ids) también pasa por acá — un solo modelo; dos fuentes
 * de verdad sobre tenencia es como se vende un plato dos veces.
 *
 * Serialización: TODA mutación de claims ocurre bajo `SELECT ... FOR UPDATE`
 * de la fila de mesa_items (el caller lo garantiza vía withItemsLocked) — el
 * mismo punto de serialización que el modelo viejo.
 *
 * Fracciones admitidas (UX ratificada): 2500 | 3333 | 5000 | 10000.
 *
 * POLÍTICA DE REDONDEO (definida en el acta):
 *   - Fracción no-completadora: nominal = round(price × bps / 10000).
 *   - La fracción que COMPLETA el ítem (deja la suma en 10000 bps) AJUSTA:
 *     paga price − Σ(las demás vivas, preciadas o a su nominal) → el total del
 *     ítem cierra EXACTO, sin residuo (⅓+⅓+⅓ de $70.00 = 23.33+23.33+23.34).
 *     Sin esto, una mesa 100% pagada quedaría centavos corta para siempre y
 *     jamás llegaría a fully_paid.
 *   - Tolerancia anti-tercios: si lo pedido deja un remanente < 100 bps
 *     (3×3333 = 9999), la fracción absorbe el remanente (en bps y centavos).
 *
 * Expiración (espeja el modelo viejo):
 *   - En el camino (lock/pay): un claim locked VENCIDO es robable — se libera
 *     lazy bajo el candado del ítem (mismo criterio que el pay legacy).
 *   - En el timer: solo se barren los vencidos SIN attempt (los atados a un
 *     attempt los liberan los caminos de fallo/cancelación, como siempre).
 */
'use strict';

const { fractionAmount } = require('../utils/money');
const stateMachine = require('../utils/stateMachine');

const FRACTION_VALUES = [2500, 3333, 5000, 10000];
const COMPLETING_TOLERANCE_BPS = 100;

// ─── puros (exportados para tests) ──────────────────────────────────────────

/**
 * bps efectivos de un pedido contra lo que queda. Lanza err.status=409 si no
 * entra; absorbe el remanente si lo dejaría < 100 bps.
 */
function effectiveBps(requestedBps, remainingBps) {
  if (remainingBps <= 0 || requestedBps > remainingBps) {
    const err = new Error('fraction_not_available');
    err.status = 409;
    err.remaining_bps = Math.max(0, remainingBps);
    throw err;
  }
  return (remainingBps - requestedBps < COMPLETING_TOLERANCE_BPS) ? remainingBps : requestedBps;
}

/**
 * Precio de una fracción dado el resto de claims vivos del ítem
 * (otherLive: [{ fraction_bps, amount_cents|null }]).
 * Completa (suma llega a 10000) → ajusta contra los demás (preciados o nominal).
 */
function priceFraction(priceCents, effBps, otherLive) {
  const otherBps = otherLive.reduce((s, c) => s + Number(c.fraction_bps), 0);
  if (otherBps + effBps >= 10000) {
    const others = otherLive.reduce(
      (s, c) => s + (c.amount_cents != null ? Number(c.amount_cents) : fractionAmount(priceCents, Number(c.fraction_bps))),
      0
    );
    return Math.max(0, priceCents - others);
  }
  return fractionAmount(priceCents, effBps);
}

// ─── acceso a claims (bajo el FOR UPDATE del ítem, garantizado por el caller) ─

function ownsClaim(c, owner, lockTokens) {
  return (owner.userId && c.locked_by_user_id === owner.userId)
      || (owner.guestTokHash && c.locked_by_guest_token_hash === owner.guestTokHash)
      || (Array.isArray(lockTokens) && lockTokens.includes(c.lock_token));
}

/** Libera lazy los locked vencidos del ítem (robables, criterio del pay legacy). */
async function releaseExpired(client, itemId) {
  await client.query(
    `UPDATE mesa_item_claims SET status='released'
      WHERE mesa_item_id=$1 AND status='locked'
        AND lock_expires_at IS NOT NULL AND lock_expires_at < NOW()`,
    [itemId]
  );
}

async function liveClaims(client, itemId) {
  const { rows } = await client.query(
    `SELECT id, fraction_bps, amount_cents, status, payment_attempt_id,
            locked_by_user_id, locked_by_guest_token_hash, lock_token
       FROM mesa_item_claims
      WHERE mesa_item_id=$1 AND status IN ('locked','paid')`,
    [itemId]
  );
  return rows;
}

/**
 * Adquiere (o re-adquiere) una fracción de UN ítem para `owner`.
 * Re-reclamo: los claims locked propios del ítem se liberan y se reemplazan
 * (mismo espíritu que el re-lock que refresca del modelo viejo).
 * `price: true` → fija amount_cents (camino de pago).
 * Devuelve { claimId, effBps, amountCents|null }.
 */
async function acquire(client, {
  item, mesaId, owner, requestedBps,
  lockToken = null, lockExpiresAt, lockTokens = [], price = false,
  triggeredBy = 'user',
}) {
  await releaseExpired(client, item.id);
  const live = await liveClaims(client, item.id);

  const mine = live.filter((c) => c.status === 'locked' && ownsClaim(c, owner, lockTokens));
  if (mine.length > 0) {
    await client.query(
      `UPDATE mesa_item_claims SET status='released' WHERE id = ANY($1::uuid[])`,
      [mine.map((c) => c.id)]
    );
  }
  const others = live.filter((c) => !mine.includes(c));

  const taken = others.reduce((s, c) => s + Number(c.fraction_bps), 0);
  const effBps = effectiveBps(requestedBps, 10000 - taken);
  const amountCents = price ? priceFraction(Number(item.price_cents), effBps, others) : null;

  const { rows } = await client.query(
    `INSERT INTO mesa_item_claims
       (mesa_id, mesa_item_id, fraction_bps, amount_cents, status,
        locked_by_user_id, locked_by_guest_token_hash, lock_token, lock_expires_at)
     VALUES ($1,$2,$3,$4,'locked',$5,$6,$7,$8)
     RETURNING id`,
    [mesaId, item.id, effBps, amountCents,
     owner.userId || null, owner.guestTokHash || null, lockToken, lockExpiresAt]
  );

  // Reflejo en mesa_items (compat con GET/agregados/FSM): ocupado = 'locked'.
  if (['available', 'released'].includes(item.status)) {
    await client.query(`UPDATE mesa_items SET status='locked', locked_at=NOW() WHERE id=$1`, [item.id]);
    await stateMachine.transition({
      client, entityType: 'mesa_item', entityId: item.id,
      fromState: item.status, toState: 'locked', triggeredBy,
    });
  }

  return { claimId: rows[0].id, effBps, amountCents };
}

/** Ata claims recién preciados a su attempt (misma tx, post-INSERT del attempt). */
async function bindToAttempt(client, claimIds, attemptId, lockExpiresAt) {
  if (claimIds.length === 0) return;
  await client.query(
    `UPDATE mesa_item_claims
        SET payment_attempt_id=$2, lock_expires_at=$3
      WHERE id = ANY($1::uuid[])`,
    [claimIds, attemptId, lockExpiresAt]
  );
}

/**
 * Pago confirmado: claims del attempt → paid; refleja mesa_items
 * ('paid' SOLO con 10000 bps pagados). Devuelve ítems tocados.
 */
async function markAttemptPaid(client, attemptId, triggeredBy = 'system') {
  const { rows: claims } = await client.query(
    `UPDATE mesa_item_claims SET status='paid', paid_at=NOW()
      WHERE payment_attempt_id=$1 AND status='locked'
      RETURNING mesa_item_id`,
    [attemptId]
  );
  const itemIds = [...new Set(claims.map((c) => c.mesa_item_id))];
  const fullyPaid = [];
  for (const itemId of itemIds) {
    const { rows } = await client.query(
      `SELECT COALESCE(SUM(fraction_bps) FILTER (WHERE status='paid'), 0)::int AS paid_bps
         FROM mesa_item_claims WHERE mesa_item_id=$1 AND status IN ('locked','paid')`,
      [itemId]
    );
    if (Number(rows[0].paid_bps) >= 10000) {
      const upd = await client.query(
        `UPDATE mesa_items
            SET status='paid', paid_at=NOW(),
                locked_by_attempt=NULL, locked_by_user_id=NULL,
                locked_by_guest_token=NULL, locked_by_guest_token_hash=NULL,
                lock_token=NULL, lock_expires_at=NULL
          WHERE id=$1 AND status <> 'paid'
          RETURNING id`,
        [itemId]
      );
      if (upd.rowCount === 1) {
        await stateMachine.transition({
          client, entityType: 'mesa_item', entityId: itemId,
          fromState: 'locked', toState: 'paid', triggeredBy,
        });
      }
      fullyPaid.push(itemId);
    }
  }
  return { itemIds, fullyPaid, claimsPaid: claims.length };
}

/**
 * Pago fallido/cancelado: claims del attempt → released; el ítem vuelve a
 * 'released' SOLO si no le quedan claims vivos (parciales siguen 'locked').
 */
async function releaseAttemptClaims(client, attemptId, triggeredBy = 'system') {
  const { rows: claims } = await client.query(
    `UPDATE mesa_item_claims SET status='released'
      WHERE payment_attempt_id=$1 AND status='locked'
      RETURNING mesa_item_id`,
    [attemptId]
  );
  const itemIds = [...new Set(claims.map((c) => c.mesa_item_id))];
  for (const itemId of itemIds) {
    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS vivos FROM mesa_item_claims
        WHERE mesa_item_id=$1 AND status IN ('locked','paid')`,
      [itemId]
    );
    if (Number(rows[0].vivos) === 0) {
      const upd = await client.query(
        `UPDATE mesa_items SET status='released',
                locked_by_attempt=NULL, locked_by_user_id=NULL,
                locked_by_guest_token=NULL, locked_by_guest_token_hash=NULL,
                lock_token=NULL, lock_expires_at=NULL
          WHERE id=$1 AND status='locked'
          RETURNING id`,
        [itemId]
      );
      if (upd.rowCount === 1) {
        await stateMachine.transition({
          client, entityType: 'mesa_item', entityId: itemId,
          fromState: 'locked', toState: 'released', triggeredBy,
        });
      }
    }
  }
  return { itemIds };
}

/**
 * Refund FULL (D1 pre-settle): los claims PAGADOS del attempt vuelven a
 * 'released' (otros pueden retomarlos); el ítem baja de 'paid' según le queden
 * claims vivos ('locked' si quedan, 'released' si no). El neteo del monto lo
 * hace E3 como siempre — acá solo tenencia.
 */
async function refundAttemptClaims(client, attemptId, triggeredBy = 'webhook') {
  const { rows: claims } = await client.query(
    `UPDATE mesa_item_claims SET status='released'
      WHERE payment_attempt_id=$1 AND status='paid'
      RETURNING mesa_item_id`,
    [attemptId]
  );
  const itemIds = [...new Set(claims.map((c) => c.mesa_item_id))];
  let itemsReleased = 0;
  for (const itemId of itemIds) {
    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS vivos FROM mesa_item_claims
        WHERE mesa_item_id=$1 AND status IN ('locked','paid')`,
      [itemId]
    );
    const nuevo = Number(rows[0].vivos) === 0 ? 'released' : 'locked';
    const upd = await client.query(
      `UPDATE mesa_items SET status=$2, paid_at=NULL
        WHERE id=$1 AND status='paid' RETURNING id`,
      [itemId, nuevo]
    );
    if (upd.rowCount === 1) {
      await client.query(
        `INSERT INTO state_transitions
           (entity_type, entity_id, from_state, to_state, reason, triggered_by)
         VALUES ('mesa_item', $1, 'paid', $2, 'refund', $3)`,
        [itemId, nuevo, triggeredBy]
      );
      itemsReleased++;
    }
  }
  return { itemIds, itemsReleased };
}

/**
 * Rescate tardío (A11, webhook cancelled/failed→succeeded): intenta re-tomar
 * los claims released del attempt. Conflicto si alguna fracción ya no entra.
 */
async function restoreAttemptClaims(client, attemptId) {
  const { rows: released } = await client.query(
    `SELECT id, mesa_item_id, fraction_bps FROM mesa_item_claims
      WHERE payment_attempt_id=$1 AND status='released'
      ORDER BY mesa_item_id`,
    [attemptId]
  );
  // Pasada 1 (solo lectura, bajo candado de cada ítem): ¿entran TODAS las
  // fracciones? Si alguna no entra, es conflicto y NO se restaura nada
  // (fiel al A11 original: succeeded sin procesar → revisión manual).
  for (const c of released) {
    await client.query(`SELECT id FROM mesa_items WHERE id=$1 FOR UPDATE`, [c.mesa_item_id]);
    await releaseExpired(client, c.mesa_item_id);
    const live = await liveClaims(client, c.mesa_item_id);
    const taken = live.reduce((s, x) => s + Number(x.fraction_bps), 0);
    if (10000 - taken < Number(c.fraction_bps)) {
      return { conflict: true, item_id: c.mesa_item_id };
    }
  }
  // Pasada 2: restaurar (los candados de la pasada 1 siguen tomados en esta tx).
  for (const c of released) {
    await client.query(
      `UPDATE mesa_item_claims SET status='locked', lock_expires_at=NOW() + INTERVAL '5 minutes'
        WHERE id=$1`,
      [c.id]
    );
    const upd = await client.query(
      `UPDATE mesa_items SET status='locked'
        WHERE id=$1 AND status IN ('available','released') RETURNING status`,
      [c.mesa_item_id]
    );
    if (upd.rowCount === 1) {
      await stateMachine.transition({
        client, entityType: 'mesa_item', entityId: c.mesa_item_id,
        fromState: 'released', toState: 'locked',
        reason: 'webhook_late_rescue', triggeredBy: 'webhook',
      });
    }
  }
  return { conflict: false, restored: released.length };
}

module.exports = {
  FRACTION_VALUES,
  COMPLETING_TOLERANCE_BPS,
  effectiveBps,
  priceFraction,
  acquire,
  bindToAttempt,
  markAttemptPaid,
  releaseAttemptClaims,
  refundAttemptClaims,
  restoreAttemptClaims,
};
