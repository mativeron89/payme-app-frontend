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
const { MESA_ESTADOS_VIVOS } = require('../utils/stateMachine');

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
  // v2.166.0 · decisión 219 · unirse con el código de la mesa. Sólo en la app: no están en la
  // política de correo (`notificationPreferences.CHANNEL_POLICY`).
  join_request_received: { title: 'Quieren unirse a tu mesa' },
  join_request_accepted: { title: 'Te aceptaron en la mesa' },
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
  // v2.130.0 · E3 · el correo se encola en la MISMA escritura que el aviso: sin aviso no hay
  // correo, y un fallo de la cola voltea sólo el aviso opcional (savepoint), nunca la tx del
  // llamador. Con E3 apagado `enqueue` no escribe nada. Require perezoso: hay ciclo con
  // notificationPreferences (que lee TYPES de este módulo).
  const correo = require('./notificationEmailDelivery');
  const conCorreo = correo.capability().enabled;
  const insert = async (db) => {
    const { rows } = await db.query(
      `INSERT INTO notifications
         (user_id, type, title, body, payload, related_entity_type, related_entity_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, type, title, created_at`,
      [user_id, type, finalTitle, body || null, payload,
       related_entity_type || null, related_entity_id || null]
    );
    await correo.enqueue(db, { userId: user_id, notificationId: rows[0].id, type });
    return rows[0];
  };

  // Las notificaciones son explícitamente opcionales. Dentro de una tx no se
  // puede atrapar una query fallida a pelo: PostgreSQL deja la tx abortada.
  if (client) {
    const optional = await pool.withSavepoint(client, () => insert(client));
    if (!optional.ok) {
      logger.error('notification_create_failed', { user_id, type, error: optional.error.message });
      return null;
    }
    logger.audit('notification_created', { user_id, type, notif_id: optional.value.id });
    return optional.value;
  }

  try {
    const notification = conCorreo ? await pool.tx((c) => insert(c)) : await insert(pool);
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

/**
 * Los avisos sin leer de la campana. La ÚNICA definición: la usan `GET /unread-count` y el
 * `unread_count` del listado de avisos.
 *
 * v2.166.2 · decisión 228: no cuenta el `invitation_received` de una invitación cuya mesa ya no
 * admite gente (la misma regla `mesaViva` de aceptar): esa invitación salió de «Te invitaron»
 * y no queda nada que hacer con ella. El aviso sigue en la lista; sólo deja de sumar a la campana.
 */
async function unreadCount(user_id, db = pool) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS c FROM notifications n
      WHERE n.user_id = $1 AND n.read_at IS NULL
        AND NOT (n.type = 'invitation_received' AND n.related_entity_type = 'invitation'
                 AND EXISTS (SELECT 1 FROM invitations i JOIN mesas m ON m.id = i.mesa_id
                              WHERE i.id = n.related_entity_id
                                AND NOT (m.status = ANY($2::text[]))))`,
    [user_id, [...MESA_ESTADOS_VIVOS]]
  );
  return rows[0].c;
}

/**
 * v2.148.0 · E174-2 · borra TODAS las notificaciones del usuario y devuelve cuántas. Sólo las
 * suyas (`user_id`), como el borrado por id; la cola de correos queda con `notification_id`
 * en NULL (FK `ON DELETE SET NULL`).
 */
async function borrarTodas(userId, db = pool) {
  const { rowCount } = await db.query('DELETE FROM notifications WHERE user_id = $1', [userId]);
  return rowCount;
}

/**
 * v2.148.0 · E174-3 · la foto de quien invita, para una notificación `invitation_received` del
 * propio usuario. Regla n164 de las fotos de personas de una mesa
 * (`profileIdentity.fotoVisibleN164`). Toda denegación devuelve null, y la ruta la convierte en el
 * mismo 404: notificación ajena o de otro tipo, invitación inexistente, cuenta eliminada, sin
 * foto, menor o sin fecha conocida, identidad de perfil apagada. Resuelve al invitador por la
 * invitación (`related_entity_id`), que ya viaja en la notificación: no expone ids nuevos.
 */
async function fotoDeQuienInvita(notificationId, userId, db = pool) {
  const { rows: [fila] } = await db.query(
    `SELECT i.inviter_user_id AS user_id, u.status,
            EXISTS (SELECT 1 FROM user_avatars a WHERE a.user_id = i.inviter_user_id) AS tiene_foto
       FROM notifications n
       JOIN invitations i ON i.id = n.related_entity_id
       LEFT JOIN users u ON u.id = i.inviter_user_id
      WHERE n.id = $1 AND n.user_id = $2
        AND n.type = 'invitation_received' AND n.related_entity_type = 'invitation'
        AND i.inviter_user_id <> $2`,
    [notificationId, userId]
  );
  return fotoDelInvitador(fila, db);
}

/**
 * v2.149.0 · E174-3B · la misma foto, para una invitación cuyo destinatario es el propio usuario
 * (la tarjeta «Te invitaron» y la burbuja de Inicio salen de GET /api/invitations). Mismas
 * denegaciones y la misma función interna (`fotoDelInvitador`): invitación ajena o inexistente,
 * de link (sin destinatario), cuenta eliminada, sin foto, menor o sin fecha.
 */
async function fotoDeQuienInvitaPorInvitacion(invitationId, userId, db = pool) {
  const { rows: [fila] } = await db.query(
    `SELECT i.inviter_user_id AS user_id, u.status,
            EXISTS (SELECT 1 FROM user_avatars a WHERE a.user_id = i.inviter_user_id) AS tiene_foto
       FROM invitations i
       LEFT JOIN users u ON u.id = i.inviter_user_id
      WHERE i.id = $1 AND i.invited_user_id = $2 AND i.inviter_user_id <> $2`,
    [invitationId, userId]
  );
  return fotoDelInvitador(fila, db);
}

/** La ÚNICA decisión de las dos rutas: regla n164 y, si pasa, los bytes. Sin fila, null. */
async function fotoDelInvitador(fila, db) {
  if (!fila) return null;
  const profileIdentity = require('./profileIdentity');
  const visible = await profileIdentity.fotoVisibleN164(
    { userId: fila.user_id, status: fila.status, tieneFoto: fila.tiene_foto }, db);
  if (!visible) return null;
  const avatar = await profileIdentity.obtenerAvatar(fila.user_id, db);
  return avatar ? { mimeType: avatar.mimeType, bytes: avatar.bytes } : null;
}

/**
 * La pista `has_inviter_avatar` del payload, al crear la invitación: la misma regla, sin bytes.
 * Es sólo una pista para no pedir en vano; la ruta vuelve a decidir en cada pedido.
 */
async function fotoDeInvitadorVisible(inviterId, db = pool) {
  const profileIdentity = require('./profileIdentity');
  const { rows: [u] } = await db.query(
    `SELECT u.status, EXISTS (SELECT 1 FROM user_avatars a WHERE a.user_id = u.id) AS tiene_foto
       FROM users u WHERE u.id = $1`,
    [inviterId]
  );
  if (!u) return false;
  return profileIdentity.fotoVisibleN164({ userId: inviterId, status: u.status, tieneFoto: u.tiene_foto }, db);
}

module.exports = {
  create, createBulk, markRead, markAllRead, unreadCount, borrarTodas, fotoDeQuienInvita,
  fotoDeQuienInvitaPorInvitacion, fotoDeInvitadorVisible, TYPES, WALLET_RAIL_TYPES,
};
