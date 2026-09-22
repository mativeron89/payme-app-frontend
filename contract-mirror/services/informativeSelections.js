'use strict';

// Estado informativo propio de igual. Nunca crea claims, slots ni importes.
const pool = require('../db/pool');
const stateMachine = require('../utils/stateMachine');
const { dineroHabilitado } = require('./moneyRail');
const CONTRACT = 'payme.app.informative-selections/v2';
// Fracciones legacy: las únicas admitidas cuando la mesa no registró N.
const { FRACTION_VALUES } = require('./itemClaims');
const mesaPresentation = require('./mesaPresentation');
// Misma participación que el middleware y misma frontera de mesa privada.
const ACCESS_SQL = `(
  m.opener_user_id=$2 OR EXISTS (SELECT 1 FROM mesa_participants p
    WHERE p.mesa_id=m.id AND p.user_id=$2 AND p.status='active')
  OR (r.created_by_user_id IS NULL AND EXISTS (SELECT 1 FROM invitations inv
    WHERE inv.mesa_id=m.id AND inv.invited_user_id=$2 AND inv.status='pending'
      AND inv.superseded_by_id IS NULL AND inv.expires_at>clock_timestamp()))
)`;
const eligible = m => m.division_mode === 'igual'
  && m.guarantee_mode === false && m.metadata?.sin_garantia === true;
const error = (code, status = 409) => Object.assign(new Error(code), { status, code });
function capability(m) {
  return { contract: CONTRACT, supported: eligible(m),
    mutable: eligible(m) && !dineroHabilitado() && m.status === 'open' && m.before_expiry === true };
}
function reason(m) {
  return m.metadata?.closure_reason || (m.status === 'expired' ? 'time' : null);
}
async function load(client, mesaId, userId, lock = false) {
  const { rows: [m] } = await client.query(
    `SELECT m.* FROM mesas m WHERE m.id=$1${lock ? ' FOR UPDATE' : ''}`, [mesaId]);
  if (!m) throw error('mesa_not_found', 404);
  const { rows: [access] } = await client.query(
    `SELECT ${ACCESS_SQL} AS allowed, r.created_by_user_id
     FROM mesas m JOIN restaurants r ON r.id=m.restaurant_id WHERE m.id=$1`, [mesaId, userId]);
  if (!access?.allowed) throw error(access?.created_by_user_id ? 'mesa_not_found' : 'not_a_mesa_participant',
    access?.created_by_user_id ? 404 : 403);
  // Se evalúa después de adquirir el lock, no antes de una espera.
  const { rows: [clock] } = await client.query(
    'SELECT expires_at>clock_timestamp() AS before_expiry FROM mesas WHERE id=$1', [mesaId]);
  m.before_expiry = clock.before_expiry;
  return m;
}
function assertEligible(m) {
  if (m.division_mode !== 'igual') throw error('informative_selection_not_available_for_division_mode');
  if (!eligible(m)) throw error('informative_selection_requires_no_guarantee');
}
async function own(client, mesaId, userId) {
  const { rows } = await client.query(
    `SELECT mesa_item_id AS item_id,declared_fraction_bps,updated_at
     FROM mesa_informative_selections WHERE mesa_id=$1 AND user_id=$2 ORDER BY mesa_item_id`,
    [mesaId, userId]);
  return { source: 'informative', items: rows.map(({ item_id, declared_fraction_bps }) =>
    ({ item_id, declared_fraction_bps })), updated_at: rows[0]?.updated_at || null };
}
async function complete(client, mesaId) {
  const { rows: [r] } = await client.query(
    `SELECT EXISTS(SELECT 1 FROM mesa_items WHERE mesa_id=$1) AND NOT EXISTS(
      SELECT 1 FROM mesa_items i WHERE i.mesa_id=$1 AND NOT EXISTS(
        SELECT 1 FROM mesa_informative_selections s WHERE s.mesa_id=i.mesa_id AND s.mesa_item_id=i.id
      )) AS complete`, [mesaId]);
  return r.complete;
}
function response(m, selection, covered) {
  return { contract: CONTRACT, mesa: { code: m.code, division_mode: m.division_mode,
    status: m.status, mutable: capability(m).mutable, closure_reason: reason(m) },
  selection, coverage: { all_items_selected: covered } };
}
async function read({ mesaId, userId }) {
  return pool.tx(async client => {
    const m = await load(client, mesaId, userId);
    assertEligible(m);
    return response(m, await own(client, mesaId, userId), await complete(client, mesaId));
  });
}
async function getCapability({ mesaId, userId }) {
  return pool.tx(async client => capability(await load(client, mesaId, userId)));
}
async function replace({ mesaId, userId, items, confirmClosure }) {
  if (confirmClosure !== true || !Array.isArray(items) || items.length > 100
      || new Set(items.map(i => i.item_id)).size !== items.length
      || items.some(i => !mesaPresentation.FRACCIONES_INFORMATIVAS.includes(i.declared_fraction_bps))) {
    throw error('validation_error', 400);
  }
  const desired = items.map(i => ({ item_id: i.item_id.toLowerCase(), declared_fraction_bps: i.declared_fraction_bps }))
    .sort((a, b) => a.item_id.localeCompare(b.item_id));
  if (new Set(desired.map(i => i.item_id)).size !== desired.length) throw error('validation_error', 400);
  return pool.tx(async client => {
    const m = await load(client, mesaId, userId, true);
    assertEligible(m);
    const previous = await own(client, mesaId, userId);
    if (JSON.stringify(previous.items) === JSON.stringify(desired)) {
      return response(m, previous, await complete(client, mesaId));
    }
    if (dineroHabilitado()) throw error('informative_selection_requires_payments_disabled');
    if (m.status !== 'open' || !m.before_expiry) throw error('informative_selection_read_only');
    mesaPresentation.validateInformativeFractions(m, desired, FRACTION_VALUES,
      new Map(previous.items.map(i => [i.item_id, i.declared_fraction_bps])));
    const ids = desired.map(i => i.item_id);
    const valid = await client.query('SELECT id FROM mesa_items WHERE mesa_id=$1 AND id=ANY($2::uuid[])',
      [mesaId, ids]);
    if (valid.rowCount !== ids.length) throw error('item_not_found', 404);
    await client.query(`DELETE FROM mesa_informative_selections
      WHERE mesa_id=$1 AND user_id=$2 AND NOT(mesa_item_id=ANY($3::uuid[]))`, [mesaId, userId, ids]);
    if (ids.length) await client.query(
      `INSERT INTO mesa_informative_selections
        (mesa_id,mesa_item_id,user_id,declared_fraction_bps,created_at,updated_at)
       SELECT $1,x.item_id,$2,x.bps,NOW(),NOW()
       FROM unnest($3::uuid[],$4::integer[]) x(item_id,bps)
       ON CONFLICT(mesa_id,mesa_item_id,user_id) DO UPDATE
       SET declared_fraction_bps=EXCLUDED.declared_fraction_bps,updated_at=EXCLUDED.updated_at`,
      [mesaId, userId, ids, desired.map(i => i.declared_fraction_bps)]);
    const covered = await complete(client, mesaId);
    if (covered) {
      await client.query(`UPDATE mesas SET status='expired',
        metadata=jsonb_set(COALESCE(metadata,'{}'::jsonb),'{closure_reason}','"all_items_selected"'::jsonb,true)
        WHERE id=$1`, [mesaId]);
      await stateMachine.transition({ client, entityType: 'mesa', entityId: mesaId,
        fromState: 'open', toState: 'expired', reason: 'mesa_cerrada_seleccion_informativa_completa',
        triggeredBy: 'user' });
      m.status = 'expired'; m.metadata = { ...m.metadata, closure_reason: 'all_items_selected' };
    }
    return response(m, await own(client, mesaId, userId), covered);
  });
}
async function ownSelectionsForMesas({ mesaIds, userId, client = pool }) {
  if (!mesaIds.length) return new Map();
  const { rows } = await client.query(
    `SELECT m.id,s.mesa_item_id AS item_id,s.declared_fraction_bps,s.updated_at
     FROM mesa_informative_selections s JOIN mesas m ON m.id=s.mesa_id
     JOIN restaurants r ON r.id=m.restaurant_id
     WHERE m.id=ANY($1::uuid[]) AND s.user_id=$2 AND m.division_mode='igual'
       AND m.guarantee_mode=false AND m.metadata->>'sin_garantia'='true' AND ${ACCESS_SQL}
     ORDER BY m.id,s.mesa_item_id`, [mesaIds, userId]);
  const result = new Map();
  for (const row of rows) {
    if (!result.has(row.id)) result.set(row.id, { source: 'informative', items: [], updated_at: row.updated_at });
    result.get(row.id).items.push({ item_id: row.item_id, declared_fraction_bps: row.declared_fraction_bps });
  }
  return result;
}
async function history({ userId, limit, offset }) {
  return pool.tx(async client => {
    const { rows } = await client.query(
      `SELECT m.id,m.code,m.division_mode,m.status,m.metadata,MAX(s.updated_at) AS updated_at
       FROM mesa_informative_selections s JOIN mesas m ON m.id=s.mesa_id
       JOIN restaurants r ON r.id=m.restaurant_id
       WHERE s.user_id=$2 AND m.division_mode='igual' AND m.guarantee_mode=false
         AND m.metadata->>'sin_garantia'='true' AND ${ACCESS_SQL}
       GROUP BY m.id ORDER BY MAX(s.updated_at) DESC,m.id DESC LIMIT $1 OFFSET $3`, [limit, userId, offset]);
    const selections = await ownSelectionsForMesas({ mesaIds: rows.map(m => m.id), userId, client });
    return { contract: CONTRACT, history: rows.filter(m => selections.has(m.id)).map(m => ({
      mesa_code: m.code, division_mode: m.division_mode, mesa_status: m.status,
      closure_reason: reason(m), items: selections.get(m.id).items, updated_at: selections.get(m.id).updated_at,
    })), limit, offset };
  });
}
// FRACTIONS: las seis legacy (lo que se admite cuando la mesa no registró N).
module.exports = { CONTRACT, FRACTIONS: FRACTION_VALUES, ACCESS_SQL, read, replace, getCapability, ownSelectionsForMesas, history };
