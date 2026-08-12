/**
 * D-FF-1 · autoridad de invitaciones para ALTA de cuenta.
 *
 * Separada deliberadamente de `services/invitationAuthority.js`: esa autoridad
 * decide quién entra a una mesa DESPUÉS de tener cuenta. Ésta decide quién
 * puede crearla. Mezclarlas convertiría un link de mesa en una invitación a la
 * cohorte, que es una autoridad mayor.
 *
 * Propiedades duras:
 *   · el token crudo sólo se devuelve al emisor una vez; DB guarda SHA-256;
 *   · email se compara normalizado;
 *   · inexistente, usado, vencido y email distinto producen el MISMO error;
 *   · el caller bloquea y consume dentro de la misma tx que crea la cuenta.
 */
'use strict';

const { generateToken, tokenHash, normalizeEmail } = require('../utils/tokens');
const { normalizarEmailDeContrato } = require('../schemas');

const ERROR_PUBLICO = 'registration_not_available';

function registroNoDisponible() {
  return Object.assign(new Error(ERROR_PUBLICO), {
    code: ERROR_PUBLICO,
    status: 403,
  });
}

function fechaValidaFutura(value, now = Date.now()) {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.getTime() > now ? parsed : null;
}

/** Emite una autoridad. Sólo una CLI repo-local llama esta función. */
async function emitirInvitacion(client, {
  email, expiresAt, actor, ticket, cohort,
}) {
  // La CLI no tiene un validateBody delante. Usa exactamente el mismo parser
  // que POST /register para no emitir autoridades para emails que el alta
  // después rechazaría.
  const normalized = normalizarEmailDeContrato(email);
  const expiry = fechaValidaFutura(expiresAt);
  if (!normalized) {
    throw new Error('signup_invitation_email_invalid');
  }
  if (!expiry) throw new Error('signup_invitation_expiry_invalid');
  for (const [field, [value, max]] of Object.entries({
    actor: [actor, 200], ticket: [ticket, 200], cohort: [cohort, 100],
  })) {
    if (typeof value !== 'string' || !value.trim() || value.length > max) {
      throw new Error(`signup_invitation_${field}_invalid`);
    }
  }

  // 256 bits de entropía. El raw vive sólo en memoria y en el único resultado
  // de esta llamada; nunca entra a parámetros SQL ni a logs de auditoría.
  const rawToken = generateToken(32);
  const hash = tokenHash(rawToken);
  const { rows: [row] } = await client.query(
    `INSERT INTO signup_invitations
       (token_hash, email_normalized, cohort, issued_by_actor,
        authorization_ticket, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id,email_normalized,cohort,issued_by_actor,
               authorization_ticket,issued_at,expires_at`,
    [hash, normalized, cohort.trim(), actor.trim(), ticket.trim(), expiry]
  );
  return { ...row, token: rawToken };
}

/**
 * Bloquea la autoridad canónica. Devuelve null para TODA causa inválida.
 * No actualiza: si luego falla el INSERT de user, el rollback deja la
 * invitación utilizable, en vez de consumirla sin crear la cuenta.
 */
async function bloquearInvitacion(client, { token, email }) {
  const hash = typeof token === 'string' && token.length >= 20 && token.length <= 200
    ? tokenHash(token)
    : null;
  // Igual se consulta con un hash imposible para que "token sin forma" y
  // "token no encontrado" recorran la misma sentencia y no abran otra rama.
  const searchedHash = hash || '0'.repeat(64);
  const { rows: [row] } = await client.query(
    `SELECT id,email_normalized,expires_at,consumed_at
       FROM signup_invitations
      WHERE token_hash=$1
      FOR UPDATE`,
    [searchedHash]
  );
  if (!row || row.consumed_at || new Date(row.expires_at) <= new Date()
      || row.email_normalized !== normalizeEmail(email)) return null;
  return row;
}

async function marcarConsumida(client, { invitationId, userId }) {
  const { rowCount } = await client.query(
    `UPDATE signup_invitations
        SET consumed_at=NOW(), consumed_by_user_id=$2
      WHERE id=$1 AND consumed_at IS NULL AND expires_at > NOW()`,
    [invitationId, userId]
  );
  if (rowCount !== 1) throw registroNoDisponible();
}

// El código de producción NO tiene bandera para abrir el alta. Este seam evita
// reescribir cientos de fixtures históricos y sólo existe bajo NODE_ENV=test.
// Las pruebas D-FF-1 lo cierran explícitamente para ejercitar el camino real.
let permitirSinInvitacionEnTests = false;

function invitacionRequerida() {
  return !permitirSinInvitacionEnTests;
}

function exigirInvitacionEnTests() {
  if (process.env.NODE_ENV !== 'test') throw new Error('signup_invitation_test_seam_forbidden');
  const anterior = permitirSinInvitacionEnTests;
  permitirSinInvitacionEnTests = false;
  return () => { permitirSinInvitacionEnTests = anterior; };
}

/**
 * Compatibilidad explícita para fixtures históricos. NODE_ENV=test por sí
 * solo NO abre el alta: el runner canónico debe precargar tests/setup.js.
 */
function habilitarAltaSinInvitacionParaTests() {
  if (process.env.NODE_ENV !== 'test') throw new Error('signup_invitation_test_seam_forbidden');
  permitirSinInvitacionEnTests = true;
  return () => { permitirSinInvitacionEnTests = false; };
}

module.exports = {
  emitirInvitacion,
  bloquearInvitacion,
  marcarConsumida,
  invitacionRequerida,
  exigirInvitacionEnTests,
  habilitarAltaSinInvitacionParaTests,
  registroNoDisponible,
  ERROR_PUBLICO,
  fechaValidaFutura,
};
