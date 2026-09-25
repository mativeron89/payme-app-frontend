/**
 * services/notificationPreferences.js — «Notificaciones» en Configuración, sólo correo.
 *
 * Decisiones de Mati 33 a 37 (2026-09-24). Un solo catálogo de canales, CHANNEL_POLICY,
 * junto a TYPES de services/notifications.js:
 *   · fixed_on    → transaccional: siempre por correo, sin interruptor (seguridad, dinero propio,
 *                   eliminación de cuenta).
 *   · editable    → interruptor; default según decisión 37 («Todos encendidos»), pero SÓLO para los
 *                   avisos que el aviso 2.5.6 nombra: invitación a mesa, cierre de mesa, solicitud
 *                   de amistad.
 *   · unavailable → se muestra sin interruptor y con motivo: `payments_disabled` (pagos apagados)
 *                   o `notice_pending` («amigo agregado»: sin texto de aviso que lo cubra).
 *
 * El correo NO se decide acá: acá sólo se guarda y se lee la preferencia. Quien manda es
 * services/notificationEmailDelivery.js (E3), que relee esta preferencia al enviar.
 */
'use strict';

const pool = require('../db/pool');
const { modoMonetarioCapability } = require('./moneyRail');
const { TYPES } = require('./notifications');

const ACCOUNT_RECOVERY = 'account_recovery';   // sintético: no es un notifications.type
const ACCOUNT_DELETED = 'account_deleted';     // sintético: correo transaccional de E3

const CHANNEL_POLICY = Object.freeze({
  [ACCOUNT_RECOVERY]:        { group: 'seguridad', email: 'fixed_on' },
  [ACCOUNT_DELETED]:         { group: 'seguridad', email: 'fixed_on' },
  invitation_received:       { group: 'mesas',     email: 'editable', default: true },
  mesa_expired:              { group: 'mesas',     email: 'editable', default: true },
  friend_request_received:   { group: 'amigos',    email: 'editable', default: true },
  friend_added:              { group: 'amigos',    email: 'unavailable', reason: 'notice_pending' },
  mesa_paid_by_friend:       { group: 'pagos',     email: 'editable', default: true, requires: 'payments' },
  mesa_fully_paid:           { group: 'pagos',     email: 'editable', default: true, requires: 'payments' },
  payment_failed:            { group: 'pagos',     email: 'fixed_on', requires: 'payments' },
  mesa_shortfall_charged:    { group: 'pagos',     email: 'fixed_on', requires: 'payments' },
  mesa_garantia_impagos:     { group: 'pagos',     email: 'fixed_on', requires: 'payments' },
  tip_received:              { group: 'pagos',     email: 'fixed_on', requires: 'payments' },
});
// Orden de presentación cerrado: el front no ordena, espeja.
const ORDER = Object.freeze(Object.keys(CHANNEL_POLICY));

for (const type of ORDER) {
  if (type !== ACCOUNT_RECOVERY && type !== ACCOUNT_DELETED && !TYPES[type]) {
    throw new Error(`CHANNEL_POLICY nombra un tipo que no existe en TYPES: ${type}`);
  }
}

function paymentsEnabled() {
  return modoMonetarioCapability().payments_enabled === true;
}

/** Modo EFECTIVO de un tipo hoy: `requires: payments` con pagos apagados ⇒ unavailable. */
function effectiveMode(type) {
  const p = CHANNEL_POLICY[type];
  if (!p) return null;
  if (p.requires === 'payments' && !paymentsEnabled()) {
    return { mode: 'unavailable', reason: 'payments_disabled', fixed: p.email === 'fixed_on' };
  }
  if (p.email === 'unavailable') return { mode: 'unavailable', reason: p.reason };
  if (p.email === 'fixed_on') return { mode: 'fixed_on' };
  return { mode: 'editable', default: p.default };
}

const EDITABLE_TYPES = Object.freeze(ORDER.filter((t) => CHANNEL_POLICY[t].email === 'editable'));

async function readStored(userId, db = pool) {
  const { rows } = await db.query(
    `SELECT type, email FROM notification_preferences WHERE user_id=$1`, [userId]
  );
  return new Map(rows.map((r) => [r.type, r.email]));
}

function dto(stored, noticeVersion) {
  return {
    notice_version: noticeVersion,
    channels: ['email'],
    items: ORDER.map((type) => {
      const eff = effectiveMode(type);
      const base = { type, group: CHANNEL_POLICY[type].group };
      if (eff.mode === 'editable') {
        return { ...base, email: { mode: 'editable', value: stored.has(type) ? stored.get(type) : eff.default, default: eff.default } };
      }
      if (eff.mode === 'fixed_on') return { ...base, email: { mode: 'fixed_on' } };
      return { ...base, email: { mode: 'unavailable', reason: eff.reason } };
    }),
  };
}

async function get(userId, { noticeVersion, db = pool }) {
  return dto(await readStored(userId, db), noticeVersion);
}

/**
 * Upsert por (user, type). Sólo tipos `editable` HOY (con pagos apagados los de pagos no se
 * pueden tocar: no hay que guardar preferencias sobre algo que no se muestra). Idempotente.
 */
async function put(userId, items, { noticeVersion }) {
  for (const it of items) {
    const eff = effectiveMode(it.type);
    if (!eff || eff.mode !== 'editable') {
      throw Object.assign(new Error('notification_preference_not_editable'),
        { code: 'notification_preference_not_editable', status: 400 });
    }
  }
  return pool.tx(async (client) => {
    const { rows: [u] } = await client.query(`SELECT status FROM users WHERE id=$1 FOR UPDATE`, [userId]);
    if (u?.status !== 'active') throw Object.assign(new Error('auth_required'), { code: 'auth_required', status: 401 });
    for (const it of items) {
      await client.query(
        `INSERT INTO notification_preferences(user_id,type,email) VALUES ($1,$2,$3)
         ON CONFLICT (user_id,type) DO UPDATE
           SET email=EXCLUDED.email,
               updated_at=CASE WHEN notification_preferences.email=EXCLUDED.email
                               THEN notification_preferences.updated_at ELSE clock_timestamp() END`,
        [userId, it.type, it.email]
      );
    }
    return dto(await readStored(userId, client), noticeVersion);
  });
}

/**
 * Lo que usa el WORKER de E3: ¿este tipo va por correo para esta persona, HOY?
 *   fixed_on ⇒ true; editable ⇒ preferencia guardada o default; unavailable ⇒ false.
 * Relee la base en cada envío: apagar el interruptor entre encolar y enviar corta el correo.
 */
async function emailWanted(userId, type, db = pool) {
  const eff = effectiveMode(type);
  if (!eff || eff.mode === 'unavailable') return false;
  if (eff.mode === 'fixed_on') return true;
  const { rows: [row] } = await db.query(
    `SELECT email FROM notification_preferences WHERE user_id=$1 AND type=$2`, [userId, type]
  );
  return row ? row.email === true : eff.default === true;
}

module.exports = {
  CHANNEL_POLICY, ORDER, EDITABLE_TYPES, ACCOUNT_RECOVERY, ACCOUNT_DELETED,
  effectiveMode, get, put, emailWanted,
};
