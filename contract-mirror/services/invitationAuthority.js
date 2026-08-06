/**
 * Autoridad canónica e idempotencia de invitaciones.
 *
 * Cada inviter (en runtime, únicamente el opener) tiene como máximo una
 * invitación pending por destinatario in-app y una link pending por mesa.
 * Varias claves pueden converger a esa autoridad; cada una conserva su payload
 * hash en invitation_requests.
 */
'use strict';

const pool = require('../db/pool');
const notifs = require('./notifications');
const { payloadHash, hashesMatch } = require('../utils/idempotency');
const {
  invitationLinkToken, verifyInvitationLinkToken, tokenHash, INVITATION_TOKEN_PREFIX,
} = require('../utils/tokens');

function codedError(code, status, extra = {}) {
  const err = new Error(code);
  err.code = code;
  err.status = status;
  Object.assign(err, extra);
  return err;
}

function makeLinkToken(invitationId) {
  try {
    return invitationLinkToken(invitationId);
  } catch (err) {
    if (err?.code === 'invitation_link_secret_invalid') {
      throw codedError('invitation_link_unavailable', 503);
    }
    throw err;
  }
}

function invitationFields(alias = 'i') {
  return `${alias}.id, ${alias}.mesa_id, ${alias}.inviter_user_id,
          ${alias}.invited_user_id, ${alias}.invited_payme_id,
          ${alias}.invitation_type, ${alias}.status, ${alias}.expires_at,
          ${alias}.accepted_at, ${alias}.cancelled_at, ${alias}.created_at`;
}

async function resolveRecipient(client, { invitedUserId, invitedPaymeId }) {
  const query = invitedUserId && invitedPaymeId
    ? {
        text: `SELECT id, payme_id FROM users
                WHERE id=$1 AND payme_id=$2 AND status='active'`,
        values: [invitedUserId, invitedPaymeId],
      }
    : invitedUserId
    ? {
        text: `SELECT id, payme_id FROM users WHERE id=$1 AND status='active'`,
        values: [invitedUserId],
      }
    : {
        text: `SELECT id, payme_id FROM users WHERE payme_id=$1 AND status='active'`,
        values: [invitedPaymeId],
      };
  const { rows } = await client.query(query.text, query.values);
  if (rows.length !== 1) {
    if (invitedUserId && invitedPaymeId) {
      throw codedError('invitation_recipient_mismatch', 409);
    }
    throw codedError('invited_user_not_found', 404);
  }
  return rows[0];
}

async function findNaturalPending(client, {
  mesaId, inviterUserId, type, invitedUserId,
}) {
  const query = type === 'link'
    ? {
        text: `SELECT ${invitationFields('i')}
                 FROM invitations i
                WHERE i.mesa_id=$1 AND i.inviter_user_id=$2
                  AND i.invitation_type='link' AND i.status='pending'
                  AND i.superseded_by_id IS NULL
                FOR UPDATE`,
        values: [mesaId, inviterUserId],
      }
    : {
        text: `SELECT ${invitationFields('i')}
                 FROM invitations i
                WHERE i.mesa_id=$1 AND i.inviter_user_id=$2
                  AND i.invitation_type='in_app' AND i.invited_user_id=$3
                  AND i.status='pending' AND i.superseded_by_id IS NULL
                FOR UPDATE`,
        values: [mesaId, inviterUserId, invitedUserId],
      };
  const { rows } = await client.query(query.text, query.values);
  if (rows.length > 1) throw codedError('invitation_authority_ambiguous', 503);
  return rows[0] || null;
}

async function findRequestReplay(client, {
  inviterUserId, mesaId, idempotencyKey,
}) {
  if (!idempotencyKey) return null;
  const { rows } = await client.query(
    `SELECT r.payload_hash, ${invitationFields('c')}
       FROM invitation_requests r
       JOIN invitations source ON source.id=r.invitation_id
       JOIN invitations c
         ON c.id=COALESCE(source.superseded_by_id, source.id)
        AND c.mesa_id=source.mesa_id
        AND c.inviter_user_id=source.inviter_user_id
        AND c.invitation_type=source.invitation_type
        AND (c.invitation_type <> 'in_app'
             OR c.invited_user_id IS NOT DISTINCT FROM source.invited_user_id)
        AND c.superseded_by_id IS NULL
      WHERE r.inviter_user_id=$1 AND r.mesa_id=$2 AND r.idempotency_key=$3
        AND source.inviter_user_id=r.inviter_user_id
        AND source.mesa_id=r.mesa_id
      FOR UPDATE OF c`,
    [inviterUserId, mesaId, idempotencyKey]
  );
  if (rows.length > 1) throw codedError('invitation_request_ambiguous', 503);
  if (rows.length === 0) {
    const existing = await client.query(
      `SELECT 1 FROM invitation_requests
        WHERE inviter_user_id=$1 AND mesa_id=$2 AND idempotency_key=$3`,
      [inviterUserId, mesaId, idempotencyKey]
    );
    if (existing.rowCount > 0) throw codedError('invitation_request_corrupt', 503);
  }
  return rows[0] || null;
}

async function bindRequest(client, {
  inviterUserId, mesaId, idempotencyKey, requestHash, invitationId,
}) {
  if (!idempotencyKey) return;
  await client.query(
    `INSERT INTO invitation_requests
       (inviter_user_id, mesa_id, idempotency_key, payload_hash, invitation_id)
     VALUES ($1,$2,$3,$4,$5)`,
    [inviterUserId, mesaId, idempotencyKey, requestHash, invitationId]
  );
}

function canonicalPayloadForInvitation(invitation) {
  return invitation.invitation_type === 'link'
    ? { type: 'link' }
    : { type: 'in_app', invited_user_id: invitation.invited_user_id };
}

function replayMatchesRequest(invitation, {
  type, invitedUserId, invitedPaymeId,
}) {
  if (invitation.invitation_type !== type) return false;
  // El contrato legacy aceptaba metadata de recipient en links; nunca tuvo
  // semántica de autoridad y se descarta al crear/replayar.
  if (type === 'link') return true;
  if (invitedUserId && invitation.invited_user_id !== invitedUserId) return false;
  if (invitedPaymeId && invitation.invited_payme_id !== invitedPaymeId) return false;
  return !!(invitedUserId || invitedPaymeId);
}

async function createOrReplay({
  mesaCode, inviter, type, invitedUserId = null, invitedPaymeId = null,
  idempotencyKey = null, expirySeconds = 86400,
}) {
  return pool.tx(async (client) => {
    // Lock global de la autoridad: todos los mutations siguen mesa → canónica.
    const { rows: mesaRows } = await client.query(
      `SELECT id, code, opener_user_id, status
         FROM mesas WHERE code=$1 FOR UPDATE`,
      [mesaCode]
    );
    const mesa = mesaRows[0];
    if (!mesa) throw codedError('mesa_not_found', 404);
    if (mesa.opener_user_id !== inviter.id) throw codedError('only_opener_can_invite', 403);

    await client.query(
      `UPDATE invitations
          SET status='expired'
        WHERE mesa_id=$1 AND status='pending'
          AND expires_at <= clock_timestamp()`,
      [mesa.id]
    );

    const replay = await findRequestReplay(client, {
      inviterUserId: inviter.id,
      mesaId: mesa.id,
      idempotencyKey,
    });
    if (replay) {
      const storedHash = payloadHash(canonicalPayloadForInvitation(replay));
      if (!hashesMatch(replay.payload_hash, storedHash)) {
        throw codedError('invitation_request_corrupt', 503);
      }
      if (!replayMatchesRequest(replay, { type, invitedUserId, invitedPaymeId })) {
        throw codedError('idempotency_conflict', 409);
      }
      return {
        invitation: replay,
        rawToken: replay.invitation_type === 'link'
          ? makeLinkToken(replay.id)
          : null,
        created: false,
        idempotent: true,
      };
    }

    // Un retry con journal durable reproduce la autoridad original aunque la
    // mesa o la invitación hayan cambiado después. Sólo una creación fresca
    // atraviesa los gates de estado y destinatario actuales.
    if (!['open', 'partially_paid'].includes(mesa.status)) {
      throw codedError('mesa_not_invitable', 409, { mesa_status: mesa.status });
    }

    let recipient = null;
    if (type === 'in_app') {
      recipient = await resolveRecipient(client, { invitedUserId, invitedPaymeId });
      const active = await client.query(
        `SELECT 1 FROM mesa_participants
          WHERE mesa_id=$1 AND user_id=$2 AND status='active'`,
        [mesa.id, recipient.id]
      );
      if (active.rowCount > 0) throw codedError('already_mesa_participant', 409);
    }

    const canonicalPayload = type === 'link'
      ? { type: 'link' }
      : { type: 'in_app', invited_user_id: recipient.id };
    const requestHash = payloadHash(canonicalPayload);

    let invitation = await findNaturalPending(client, {
      mesaId: mesa.id,
      inviterUserId: inviter.id,
      type,
      invitedUserId: recipient?.id || null,
    });
    let created = false;
    if (!invitation) {
      const { rows } = await client.query(
        `INSERT INTO invitations
           (mesa_id, inviter_user_id, invited_user_id, invited_payme_id,
            invitation_type, token, token_hash, expires_at)
         VALUES ($1,$2,$3,$4,$5,NULL,NULL,
                 clock_timestamp() + ($6::int * INTERVAL '1 second'))
         RETURNING ${invitationFields('invitations')}`,
        [mesa.id, inviter.id, recipient?.id || null, recipient?.payme_id || null,
         type, expirySeconds]
      );
      invitation = rows[0];
      created = true;
    }

    // Construir el token dentro de la tx hace que una configuración criptográfica
    // inválida revierta también el INSERT: nunca queda una autoridad sin respuesta.
    const rawToken = type === 'link' ? makeLinkToken(invitation.id) : null;

    await bindRequest(client, {
      inviterUserId: inviter.id,
      mesaId: mesa.id,
      idempotencyKey,
      requestHash,
      invitationId: invitation.id,
    });

    if (created && type === 'in_app') {
      await notifs.create({
        client,
        user_id: recipient.id,
        type: 'invitation_received',
        body: `${inviter.first_name} ${inviter.last_name} te invitó a una mesa`,
        payload: {
          mesa_code: mesa.code,
          inviter_name: `${inviter.first_name} ${inviter.last_name}`,
          inviter_payme_id: inviter.payme_id,
        },
        related_entity_type: 'invitation',
        related_entity_id: invitation.id,
      });
    }

    return {
      invitation, rawToken, created, idempotent: !created,
    };
  });
}

/**
 * Resuelve un ID legacy/superseded y bloquea en orden mesa → canónica.
 */
async function lockCanonical(client, invitationId) {
  const { rows: sources } = await client.query(
    `SELECT id AS source_id, mesa_id, inviter_user_id, invited_user_id,
            invitation_type, expires_at AS source_expires_at,
            COALESCE(superseded_by_id, id) AS canonical_id
       FROM invitations WHERE id=$1`,
    [invitationId]
  );
  const source = sources[0];
  if (!source) return null;
  const mesaLock = await client.query(
    `SELECT id FROM mesas WHERE id=$1 FOR UPDATE`, [source.mesa_id]
  );
  if (mesaLock.rowCount !== 1) return null;
  const { rows } = await client.query(
    `SELECT ${invitationFields('i')},
            i.expires_at <= clock_timestamp() AS expired,
            CASE WHEN $6::uuid=i.id
                 THEN i.expires_at <= clock_timestamp()
                 ELSE $7::timestamptz <= clock_timestamp()
             END AS source_expired
       FROM invitations i
      WHERE i.id=$1 AND i.mesa_id=$2
        AND i.inviter_user_id=$3
        AND i.invitation_type=$4
        AND (i.invitation_type <> 'in_app'
             OR i.invited_user_id IS NOT DISTINCT FROM $5::uuid)
        AND i.superseded_by_id IS NULL
      FOR UPDATE`,
    [source.canonical_id, source.mesa_id, source.inviter_user_id,
     source.invitation_type, source.invited_user_id,
     source.source_id, source.source_expires_at]
  );
  return rows[0] ? { ...rows[0], source_id: source.source_id } : null;
}

/**
 * Resuelve QUÉ invitación de link autoriza un token crudo, o null.
 *
 * ⚠️ CORRECCIÓN · esto NO es una extracción, es una SEGUNDA COPIA.
 *
 * El mensaje de `211fccd` afirmó que el predicado quedaba con "una sola
 * definición". Es falso, y lo encontró una revisión independiente:
 * `middleware/auth.js:218-258` conserva su propio predicado v2 y legacy, sin
 * refactorizar. O sea que el drift que ese mensaje decía haber eliminado
 * SIGUE EXISTIENDO — hoy en código sin call sites, porque tras el cierre del
 * pago sin cuenta ninguna ruta usa `guestOrAuth`.
 *
 * El riesgo concreto: si alguien vuelve a colgar `guestOrAuth` de una ruta,
 * reactiva un predicado de autorización que **no tiene un solo test**, porque
 * los tests de invitado se movieron todos acá. Por eso hay un guard que falla
 * si alguna ruta vuelve a usarlo (`tests/guest-rail-cerrado.test.js`).
 *
 * Deduplicar de verdad es un refactor de middleware de autorización y va en
 * orden propia. Mientras tanto queda escrito acá para que nadie vuelva a leer
 * "una sola definición" y lo crea.
 *
 * Los dos formatos van por caminos SEPARADOS a propósito. El intento anterior
 * de cerrar esto los mezcló en un solo predicado con
 * `($2::uuid IS NULL OR canonical.id = $2::uuid)`, que para un token legacy no
 * filtra nada: alcanzaba con que existiera cualquier otro link vivo en la misma
 * mesa para que un link cancelado siguiera dando acceso. Acá un token v2 nunca
 * toca la rama legacy y viceversa, así que esa forma no se puede volver a
 * escribir por descuido.
 *
 * NO decide si el usuario ya es participante: sólo si el token sigue siendo
 * autoridad para admitir a alguien nuevo. Esa separación es la ratificación del
 * 2026-08-04 — cancelar deja de admitir gente nueva y no expulsa a nadie.
 */
async function resolveLinkToken(db, rawToken) {
  if (typeof rawToken !== 'string' || rawToken.length < 8 || rawToken.length > 200) return null;

  if (rawToken.startsWith(`${INVITATION_TOKEN_PREFIX}.`)) {
    const invitationId = verifyInvitationLinkToken(rawToken);
    if (!invitationId) return null;
    const { rows } = await db.query(
      `SELECT canonical.id, canonical.mesa_id
         FROM invitations canonical
        WHERE canonical.id = $1::uuid
          AND canonical.invitation_type = 'link'
          AND canonical.superseded_by_id IS NULL
          AND canonical.status = 'pending'
          AND canonical.expires_at > NOW()`,
      [invitationId]
    );
    return rows[0] || null;
  }

  // Legacy: el token se resuelve por hash contra la fila que lo emitió, y de ahí
  // se salta a su canónica. `source.expires_at` se mira además del de la
  // canónica: un link viejo vencido no revive porque lo hayan supersedido.
  const { rows } = await db.query(
    `SELECT canonical.id, canonical.mesa_id
       FROM invitations source
       JOIN invitations canonical
         ON canonical.id = COALESCE(source.superseded_by_id, source.id)
        AND canonical.mesa_id = source.mesa_id
        AND canonical.inviter_user_id = source.inviter_user_id
        AND canonical.invitation_type = source.invitation_type
      WHERE (source.token_hash = $1::text OR source.token = $2::text)
        AND canonical.invitation_type = 'link'
        AND canonical.superseded_by_id IS NULL
        AND canonical.status = 'pending'
        AND source.expires_at > NOW()
        AND canonical.expires_at > NOW()
      LIMIT 1`,
    [tokenHash(rawToken), rawToken]
  );
  return rows[0] || null;
}

module.exports = {
  createOrReplay,
  lockCanonical,
  codedError,
  resolveLinkToken,
};
