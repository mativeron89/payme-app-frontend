/**
 * Snapshot privado e inmutable del principal pendiente al fence de settlement.
 *
 * La notificación es sólo un aviso: esta tabla/servicio es la autoridad. La
 * exposición queda apagada hasta aprobar el aviso de privacidad coordinado.
 */
'use strict';

const pool = require('../db/pool');
const { normalizarNombre } = require('../utils/profileNames');

const TOMBSTONE_USER_ID = '00000000-0000-0000-0000-0000000dead0';

const SETTLEMENT_SHORTFALL_DETAIL_CAPABILITY = Object.freeze({
  supported: true,
  enabled: false,
  version: 1,
  owner_only: true,
  includes_tip: false,
  notice_version: null,
  notice_required: true,
  activation_blocker: 'privacy_notice_and_legacy_identity_inventory_pending',
});
let testRolloutEnabled = false;

function shortfallDetailRolloutEnabled() {
  return SETTLEMENT_SHORTFALL_DETAIL_CAPABILITY.enabled
    || (process.env.NODE_ENV === 'test' && testRolloutEnabled);
}

function habilitarShortfallDetailParaTests() {
  if (process.env.NODE_ENV !== 'test') throw detailError('shortfall_test_seam_forbidden', 403);
  const previous = testRolloutEnabled;
  testRolloutEnabled = true;
  return () => { testRolloutEnabled = previous; };
}

function detailError(code, status = 500) {
  return Object.assign(new Error(code), { code, status });
}

function safeCents(value, { positive = false } = {}) {
  if (value === null || value === undefined) {
    throw detailError('shortfall_amount_invalid');
  }
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0 || (positive && n < 1)) {
    throw detailError('shortfall_amount_invalid');
  }
  return n;
}

function candidateAttempt(attempt) {
  return attempt.status === 'cancelled'
    && attempt.failure_reason === 'mesa_settled'
    && attempt.operation_type === 'mesa_pay';
}

function canonicalDisplayName(user) {
  try {
    const firstName = normalizarNombre(user.first_name);
    const lastName = normalizarNombre(user.last_name);
    // Validar, no migrar: una fila histórica no canónica no se corrige en el
    // fence ni se publica con caracteres invisibles/bidi. Su dinero permanece
    // dentro del residual `unassigned` y la reconciliación sigue exacta.
    if (firstName !== user.first_name || lastName !== user.last_name) return null;
    const displayName = `${firstName} ${lastName}`;
    return [...displayName].length <= 201 ? displayName : null;
  } catch {
    return null;
  }
}

function deriveAttribution({ attempts, claims, slots, users, shortfall }) {
  const fencedShortfall = safeCents(shortfall);
  if (fencedShortfall === 0) {
    return { rows: [], attributed_cents: 0, unassigned_cents: 0 };
  }
  const candidates = attempts.filter(candidateAttempt).map((attempt) => ({
    ...attempt,
    items_amount_cents: safeCents(attempt.items_amount_cents, { positive: true }),
  }));
  const claimsByAttempt = new Map();
  for (const claim of claims) {
    const list = claimsByAttempt.get(claim.payment_attempt_id) || [];
    list.push(claim);
    claimsByAttempt.set(claim.payment_attempt_id, list);
  }
  const slotsByIndex = new Map(slots.map((slot) => [Number(slot.slot_index), slot]));
  const equalCandidates = new Map();
  for (const attempt of candidates.filter((x) => x.division_slot_index != null)) {
    const index = Number(attempt.division_slot_index);
    const list = equalCandidates.get(index) || [];
    list.push(attempt);
    equalCandidates.set(index, list);
  }
  const processedSlots = new Set(attempts
    .filter((x) => x.status === 'processed' && x.division_slot_index != null)
    .map((x) => Number(x.division_slot_index)));
  const usersById = new Map(users.map((user) => [user.id, user]));
  const byUser = new Map();

  const attributableIdentity = (attempt) => {
    if (!attempt.user_id || attempt.user_id === TOMBSTONE_USER_ID) return null;
    const user = usersById.get(attempt.user_id);
    if (!user || user.status === 'deleted') return null;
    const displayName = canonicalDisplayName(user);
    return displayName ? { user, displayName } : null;
  };

  for (const attempt of candidates) {
    const identity = attributableIdentity(attempt);
    if (!identity) continue;
    const { user, displayName } = identity;
    let valid = false;
    if (attempt.division_slot_index != null) {
      const index = Number(attempt.division_slot_index);
      const slot = slotsByIndex.get(index);
      valid = Number.isSafeInteger(index)
        && equalCandidates.get(index)?.length === 1
        && !processedSlots.has(index)
        && slot?.status === 'available'
        && safeCents(slot.amount_cents) === attempt.items_amount_cents;
    } else {
      const boundClaims = claimsByAttempt.get(attempt.id) || [];
      let claimTotal = 0;
      valid = boundClaims.length > 0;
      for (const claim of boundClaims) {
        if (claim.status !== 'released'
            || claim.locked_by_user_id !== attempt.user_id
            || claim.locked_by_guest_token_hash) {
          valid = false;
          break;
        }
        if (claim.amount_cents === null || claim.amount_cents === undefined) {
          valid = false;
          break;
        }
        claimTotal += safeCents(claim.amount_cents);
        if (!Number.isSafeInteger(claimTotal)) throw detailError('shortfall_amount_invalid');
      }
      valid = valid && claimTotal === attempt.items_amount_cents;
    }
    if (!valid) continue;
    const previous = byUser.get(user.id) || {
      source_user_id: user.id,
      display_name: displayName,
      due_cents: 0,
    };
    previous.due_cents += attempt.items_amount_cents;
    if (!Number.isSafeInteger(previous.due_cents)) throw detailError('shortfall_amount_invalid');
    byUser.set(user.id, previous);
  }

  const rows = [...byUser.values()].sort((a, b) =>
    a.source_user_id.localeCompare(b.source_user_id));
  const attributed = rows.reduce((sum, row) => sum + row.due_cents, 0);
  if (!Number.isSafeInteger(attributed)) throw detailError('shortfall_amount_invalid');
  if (attributed > fencedShortfall) throw detailError('shortfall_attribution_exceeds_fence');
  const unassigned = fencedShortfall - attributed;
  if (attributed + unassigned !== fencedShortfall) {
    throw detailError('shortfall_reconciliation_invalid');
  }
  return { rows, attributed_cents: attributed, unassigned_cents: unassigned };
}

async function sealAtFence(client, { mesaId, fencedAt, shortfall }) {
  const { rows: attempts } = await client.query(
    `SELECT id,user_id,status,failure_reason,operation_type,items_amount_cents,
            division_slot_index,created_at
       FROM payment_attempts
      WHERE mesa_id=$1
      ORDER BY created_at,id
      FOR UPDATE`,
    [mesaId]
  );
  const candidateIds = attempts.filter(candidateAttempt).map((x) => x.id);
  const { rows: claims } = candidateIds.length === 0 ? { rows: [] } : await client.query(
    `SELECT id,payment_attempt_id,mesa_item_id,status,amount_cents,
            locked_by_user_id,locked_by_guest_token_hash
       FROM mesa_item_claims
      WHERE mesa_id=$1 AND payment_attempt_id=ANY($2::uuid[])
      ORDER BY mesa_item_id,id
      FOR UPDATE`,
    [mesaId, candidateIds]
  );
  const slotIndexes = [...new Set(attempts
    .filter((x) => x.division_slot_index != null)
    .map((x) => Number(x.division_slot_index)))]
    .sort((a, b) => a - b);
  const { rows: slots } = slotIndexes.length === 0 ? { rows: [] } : await client.query(
    `SELECT slot_index,amount_cents,status
       FROM mesa_division_slots
      WHERE mesa_id=$1 AND slot_index=ANY($2::smallint[])
      ORDER BY slot_index
      FOR UPDATE`,
    [mesaId, slotIndexes]
  );
  const userIds = [...new Set(candidateIds.length === 0 ? [] : attempts
    .filter((x) => candidateAttempt(x) && x.user_id)
    .map((x) => x.user_id))].sort();
  const { rows: users } = userIds.length === 0 ? { rows: [] } : await client.query(
    `SELECT id,first_name,last_name,status
       FROM users WHERE id=ANY($1::uuid[])
      ORDER BY id
      FOR KEY SHARE`,
    [userIds]
  );
  const result = deriveAttribution({ attempts, claims, slots, users, shortfall });
  await client.query(
    `INSERT INTO mesa_shortfall_snapshots
       (mesa_id,version,state,settlement_fenced_at,shortfall_cents,
        attributed_cents,unassigned_cents,rows_count)
     VALUES ($1,1,'sealed',$2,$3,$4,$5,$6)`,
    [mesaId, fencedAt, shortfall, result.attributed_cents,
     result.unassigned_cents, result.rows.length]
  );
  if (result.rows.length > 0) {
    await client.query(`SELECT set_config('payme.shortfall_row_insert','on',true)`);
  }
  for (let index = 0; index < result.rows.length; index += 1) {
    const row = result.rows[index];
    await client.query(
      `INSERT INTO mesa_shortfall_snapshot_rows
         (mesa_id,ordinal,source_user_id,display_name,due_cents)
       VALUES ($1,$2,$3,$4,$5)`,
      [mesaId, index, row.source_user_id, row.display_name, row.due_cents]
    );
  }
  if (result.rows.length > 0) {
    await client.query(`SELECT set_config('payme.shortfall_row_insert','off',true)`);
  }
  return { ...result, sealed: true };
}

async function markUnavailableAtFence(client, { mesaId, fencedAt, shortfall }) {
  await client.query(
    `INSERT INTO mesa_shortfall_snapshots
       (mesa_id,version,state,settlement_fenced_at,shortfall_cents,
        attributed_cents,unassigned_cents,rows_count)
     VALUES ($1,1,'unavailable',$2,$3,0,$3,0)
     ON CONFLICT (mesa_id) DO NOTHING`,
    [mesaId, fencedAt, shortfall]
  );
  return { sealed: false };
}

async function readSeal(client, { mesaId, fencedAt, shortfall }) {
  const { rows: [snapshot] } = await client.query(
    `SELECT h.state,h.settlement_fenced_at,h.shortfall_cents,h.attributed_cents,
            h.unassigned_cents,h.rows_count,
            COUNT(r.ordinal)::int AS actual_rows,
            COALESCE(SUM(r.due_cents),0)::bigint AS actual_attributed
       FROM mesa_shortfall_snapshots h
       LEFT JOIN mesa_shortfall_snapshot_rows r ON r.mesa_id=h.mesa_id
      WHERE h.mesa_id=$1
      GROUP BY h.mesa_id,h.state,h.settlement_fenced_at,h.shortfall_cents,
               h.attributed_cents,h.unassigned_cents,h.rows_count`,
    [mesaId]
  );
  if (!snapshot || snapshot.state !== 'sealed') return { sealed: false };
  const exactFence = new Date(snapshot.settlement_fenced_at).getTime()
    === new Date(fencedAt).getTime();
  const exact = exactFence
    && safeCents(snapshot.shortfall_cents) === safeCents(shortfall)
    && safeCents(snapshot.attributed_cents) === safeCents(snapshot.actual_attributed)
    && safeCents(snapshot.attributed_cents) + safeCents(snapshot.unassigned_cents)
      === safeCents(snapshot.shortfall_cents)
    && Number(snapshot.rows_count) === Number(snapshot.actual_rows);
  return { sealed: exact };
}

async function markClosed(client, mesaId, closedAt) {
  await client.query(`SELECT set_config('payme.shortfall_close','on',true)`);
  const updated = await client.query(
    `UPDATE mesa_shortfall_snapshots SET closed_at=$2
      WHERE mesa_id=$1 AND state='sealed' AND closed_at IS NULL`,
    [mesaId, closedAt]
  );
  return updated.rowCount === 1;
}

async function anonymizeUser(client, userId) {
  await client.query(`SELECT set_config('payme.shortfall_anonymization','on',true)`);
  const updated = await client.query(
    `UPDATE mesa_shortfall_snapshot_rows
        SET source_user_id=NULL,display_name='Cuenta eliminada',anonymized_at=NOW()
      WHERE source_user_id=$1`,
    [userId]
  );
  return updated.rowCount;
}

async function getOwnerDetail({ userId, mesaCode }, db = pool) {
  const { rows: mesas } = await db.query(
    `SELECT m.id,m.settled_at,
            COALESCE(m.settlement_snapshot_shortfall_cents,
                     m.captured_shortfall_cents) AS settlement_snapshot_shortfall_cents,
            h.version,h.state,h.closed_at,h.shortfall_cents,
            h.attributed_cents,h.unassigned_cents,h.rows_count
       FROM mesas m
       LEFT JOIN mesa_shortfall_snapshots h ON h.mesa_id=m.id
      WHERE m.code=$1 AND m.opener_user_id=$2 AND m.settled_at IS NOT NULL`,
    [mesaCode, userId]
  );
  const mesa = mesas[0];
  if (!mesa) throw detailError('shortfall_detail_not_found', 404);
  const knownShortfall = mesa.settlement_snapshot_shortfall_cents == null
    ? null
    : safeCents(mesa.settlement_snapshot_shortfall_cents);
  const unavailable = {
    version: 1,
    detail_available: false,
    closed_at: mesa.settled_at,
    // En una mesa histórica sin fence, ausencia NO significa cero.
    shortfall_cents: knownShortfall,
    // `null` es deliberado: sin sello no sabemos qué fracción es atribuible.
    // Publicar todo como “Sin asignar” convertiría una falla técnica en hecho.
    unassigned_cents: null,
    rows: [],
  };
  if (mesa.state !== 'sealed' || !mesa.closed_at) return unavailable;
  const { rows } = await db.query(
    `SELECT display_name,due_cents
       FROM mesa_shortfall_snapshot_rows
      WHERE mesa_id=$1 ORDER BY ordinal`,
    [mesa.id]
  );
  const attributed = rows.reduce((sum, row) => sum + safeCents(row.due_cents), 0);
  if (rows.length !== Number(mesa.rows_count)
      || attributed !== safeCents(mesa.attributed_cents)
      || attributed + safeCents(mesa.unassigned_cents) !== safeCents(mesa.shortfall_cents)) {
    return unavailable;
  }
  return {
    version: Number(mesa.version),
    detail_available: true,
    closed_at: mesa.closed_at,
    shortfall_cents: safeCents(mesa.shortfall_cents),
    unassigned_cents: safeCents(mesa.unassigned_cents),
    rows: rows.map((row) => ({
      display_name: row.display_name,
      due_cents: safeCents(row.due_cents),
    })),
  };
}

module.exports = {
  SETTLEMENT_SHORTFALL_DETAIL_CAPABILITY,
  shortfallDetailRolloutEnabled,
  habilitarShortfallDetailParaTests,
  deriveAttribution,
  sealAtFence,
  markUnavailableAtFence,
  readSeal,
  markClosed,
  anonymizeUser,
  getOwnerDetail,
};
