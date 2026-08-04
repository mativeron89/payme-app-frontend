/**
 * services/notifications.js — Notificaciones internas (v2.10)
 *
 * Cuando FCM/APNs estén configurados, un worker separado lee
 * pushed_at IS NULL y dispara push real.
 *
 * Cambios v2.10:
 *   - (BUG3, PASE2) registrado tipo 'mesa_shortfall_charged' (settlement.js lo emite
 *     cuando se cobra el faltante a la garantía; sin registrarlo, create() lo ignoraba).
 *   - (Opción 1, FINDING A) nuevo tipo 'mesa_garantia_impagos' (aviso al organizador
 *     con los comensales que no completaron el pago a tiempo; su garantía los cubrió).
 */
'use strict';

const pool = require('../db/pool');
const logger = require('../utils/logger');

const TYPES = {
  invitation_received:  { title: 'Te invitaron a una mesa' },
  invitation_cancelled: { title: 'Invitación cancelada' },
  invitation_accepted:  { title: 'Aceptaron tu invitación' },
  mesa_paid_by_friend:  { title: 'Tu amigo pagó su parte' },
  mesa_fully_paid:      { title: 'Mesa cerrada' },
  mesa_expired:         { title: 'Mesa expirada' },
  mesa_shortfall_charged: { title: 'Se cobró el faltante de tu mesa' },   // BUG3 (PASE2)
  mesa_garantia_impagos:  { title: 'Comensales sin pagar en tu mesa' },   // Opción 1 (FINDING A)
  topup_succeeded:      { title: 'Saldo acreditado' },
  topup_failed:         { title: 'Carga de saldo falló' },
  topup_pending:        { title: 'Carga pendiente de pago' },
  transfer_received:    { title: 'Recibiste una transferencia' },
  transfer_sent:        { title: 'Transferencia enviada' },
  tip_received:         { title: 'Recibiste una propina' },
  payment_failed:       { title: 'Pago rechazado' },
  payment_succeeded:    { title: 'Pago exitoso' },
  friend_added:         { title: 'Nuevo amigo en PayMe' },
  // OLA 3C: una solicitud avisa. Antes nadie se enteraba de que lo agregaban.
  friend_request_received: { title: 'Te quieren agregar en PayMe' },
};

/**
 * OLA 5 · avisos del riel saldo. La ratificación saca wallet del MVP: cero UI,
 * cero rutas. Estos tipos avisan de hechos de saldo que ya no tienen pantalla
 * donde mirarse, así que emitirlos deja el hecho viajando por la red hacia un
 * consumidor que no puede ni debe mostrarlo.
 *
 * El gate vive ACÁ y no en los tres emisores a propósito: un solo lugar no se
 * puede aplicar a medias y cubre al próximo emisor que nadie previó. Los
 * llamadores quedan intactos y durmientes — no se borra nada, como manda la
 * ratificación.
 *
 * `tip_received` NO está en la lista, y es deliberado. Avisa a un mesero —una
 * persona identificada— de plata acreditada a su nombre (`paymentProcessor.js`
 * la escribe en su wallet). Esa acreditación es obligación legacy: hasta que el
 * inventario de OLA 5 la drene, callarla sería ocultarle a alguien un
 * movimiento propio. Se decide con la cuarentena de cargos históricos, no acá.
 *
 * Consecuencia declarada: un abono SPEI entrante deja de avisarle al usuario.
 * NO queda invisible — `walletFunding.js` registra `wallet_credited_spei` del
 * lado del operador en la misma transacción. Lo que se pierde es el aviso a
 * alguien que hoy no tiene pantalla de saldo donde usarlo.
 */
const WALLET_RAIL_TYPES = new Set([
  'topup_succeeded', 'topup_failed', 'topup_pending',
  'transfer_received', 'transfer_sent',
]);

async function create({ user_id, type, title, body, payload = {}, related_entity_type, related_entity_id, client }) {
  if (!TYPES[type]) {
    logger.warn('unknown_notification_type', { type });
    return null;
  }
  // Antes de tocar la base: devolver acá no puede abortar la tx de dinero que
  // envuelve al llamador. Mismo contrato que un tipo desconocido — `null`.
  if (WALLET_RAIL_TYPES.has(type)) {
    logger.audit('notification_suppressed_wallet_rail', { user_id, type });
    return null;
  }
  const finalTitle = title || TYPES[type].title;
  const db = client || pool;
  const insert = async () => {
    const { rows } = await db.query(
      `INSERT INTO notifications
         (user_id, type, title, body, payload, related_entity_type, related_entity_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, type, title, created_at`,
      [user_id, type, finalTitle, body || null, payload,
       related_entity_type || null, related_entity_id || null]
    );
    return rows[0];
  };

  // Las notificaciones son explícitamente opcionales. Dentro de una tx no se
  // puede atrapar una query fallida a pelo: PostgreSQL deja la tx abortada.
  if (client) {
    const optional = await pool.withSavepoint(client, insert);
    if (!optional.ok) {
      logger.error('notification_create_failed', { user_id, type, error: optional.error.message });
      return null;
    }
    logger.audit('notification_created', { user_id, type, notif_id: optional.value.id });
    return optional.value;
  }

  try {
    const notification = await insert();
    logger.audit('notification_created', { user_id, type, notif_id: notification.id });
    return notification;
  } catch (err) {
    logger.error('notification_create_failed', { user_id, type, error: err.message });
    return null;
  }
}

async function createBulk(items) {
  const created = [];
  for (const item of items) {
    const r = await create(item);
    if (r) created.push(r);
  }
  return created;
}

async function markRead(notif_id, user_id) {
  const { rowCount } = await pool.query(
    `UPDATE notifications SET read_at = NOW()
      WHERE id = $1 AND user_id = $2 AND read_at IS NULL`,
    [notif_id, user_id]
  );
  return rowCount > 0;
}

async function markAllRead(user_id) {
  const { rowCount } = await pool.query(
    `UPDATE notifications SET read_at = NOW()
      WHERE user_id = $1 AND read_at IS NULL`,
    [user_id]
  );
  return rowCount;
}

async function unreadCount(user_id) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS c FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
    [user_id]
  );
  return rows[0].c;
}

module.exports = { create, createBulk, markRead, markAllRead, unreadCount, TYPES, WALLET_RAIL_TYPES };
