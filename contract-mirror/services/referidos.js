/**
 * services/referidos.js — v2.173.0 · AB-LINK-DE-INVITACION · decisión 252 de Mati.
 *
 * «En amigos, quiero agregar que se pueda invitar a alguien que no tiene la app, como un código de referido
 * […] ahora solo es el link que necesito que se genere y se pueda compartir». Eligió «Quedan amigos directo».
 * Plan OK del Bibliotecario: 2026-10-09T20:42:40Z (plan.sha256 1c165bbe…).
 *
 * Qué hace:
 *   · cada cuenta tiene UN link vigente, `${FRONTEND_PUBLIC_URL}/invitacion/<code>`, igual que el link de una
 *     mesa (routes/mesas.js). El código es al azar (96 bits, 16 caracteres base64url): no lleva id, nombre ni
 *     correo. Revocar lo marca y emite otro;
 *   · una cuenta NUEVA que se registra con ese código (por correo o por cualquiera de las tres altas de Google)
 *     queda amiga aceptada de quien la invitó, en los dos sentidos, y queda anotado quién invitó a quién. A
 *     quien invitó le llega el aviso «{Nombre} se sumó a PayMe con tu invitación. Ya son amigos.».
 *
 * Qué NO hace, a propósito:
 *   · no reutiliza `invitation_token` (services/signupInvitations.js): ésa es la invitación de operador, atada a
 *     un correo, de un solo uso, y un token inválido da 403. Acá un código que no vale se ignora y la cuenta se
 *     crea igual, sin referido;
 *   · no aplica un código a una cuenta que ya existe: sólo lo llaman los tres lugares que crean cuentas, dentro
 *     de su transacción. Las respuestas del alta no cambian con o sin código: no hay oráculo;
 *   · no tiene puntos: ni saldos, ni montos, ni promesas en textos. El registro queda para cuando existan.
 *   · no toca la baja de cuenta (plan OK): la fila de referido queda (dos ids y una fecha) y el código de una
 *     cuenta que ya no está activa deja de valer.
 *
 * Contrato: contract/invitacion-personal-v1.json.
 */
'use strict';

const pool = require('../db/pool');
const { generateToken } = require('../utils/tokens');
const notifs = require('./notifications');
const logger = require('../utils/logger');

const CONTRATO = 'payme.app.invitacion_personal/v1';
/** Interruptor del servicio. En false, las rutas del link no existen y el alta ignora el código. */
const HABILITADO = true;
/** 12 bytes al azar en base64url = 16 caracteres. El mismo formato lo exige el CHECK de la tabla. */
const BYTES_DEL_CODIGO = 12;
const CODIGO_RE = /^[A-Za-z0-9_-]{16}$/;
const INTENTOS_DE_EMISION = 3;

let forzadoEnTests = null;
function habilitado() {
  return forzadoEnTests === null ? HABILITADO : forzadoEnTests;
}
/** Seam de tests: enciende o apaga el link y devuelve la función que restaura. */
function forzarParaTests(valor) {
  if (process.env.NODE_ENV !== 'test') throw new Error('referidos_test_seam_forbidden');
  if (typeof valor !== 'boolean') throw new Error('referidos_test_seam_valor_invalido');
  const anterior = forzadoEnTests;
  forzadoEnTests = valor;
  return () => { forzadoEnTests = anterior; };
}

/** Lo que publica `GET /api/config` en `features.invite_link`. */
function capacidad() {
  return { supported: true, enabled: habilitado() };
}

/** El link se arma como el de una mesa: con la URL pública del front, que en producción termina en `/#`. */
function linkDe(code) {
  const publicUrl = process.env.FRONTEND_PUBLIC_URL || 'http://localhost:5173';
  return `${publicUrl}/invitacion/${code}`;
}
const proyectar = (fila) => ({ code: fila.code, link: linkDe(fila.code), created_at: fila.created_at });

/** El texto del aviso a quien invitó. Sin montos ni puntos (censo D181). */
function textoDelAviso(nombre) {
  return `${nombre} se sumó a PayMe con tu invitación. Ya son amigos.`;
}

async function vigente(db, userId) {
  const { rows: [fila] } = await db.query(
    `SELECT code, created_at FROM codigos_de_invitacion WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId]
  );
  return fila || null;
}

/**
 * Emite un código si la cuenta no tiene uno vigente. El índice único parcial «uno vigente por cuenta» es el
 * árbitro de dos pedidos simultáneos: el segundo no inserta y lee el del primero. Una colisión del código al
 * azar (2^-96) se reintenta con otro.
 */
async function emitir(db, userId) {
  for (let intento = 1; ; intento += 1) {
    try {
      const { rows: [fila] } = await db.query(
        `INSERT INTO codigos_de_invitacion (user_id, code) VALUES ($1, $2)
         ON CONFLICT (user_id) WHERE revoked_at IS NULL DO NOTHING
         RETURNING code, created_at`,
        [userId, generateToken(BYTES_DEL_CODIGO)]
      );
      return fila || vigente(db, userId);
    } catch (error) {
      if (error.code !== '23505' || error.constraint !== 'uq_codigos_de_invitacion_code'
          || intento >= INTENTOS_DE_EMISION) throw error;
    }
  }
}

/** `GET /api/friends/invite-link`: el link vigente de quien lo pide; si no tiene, nace ahora. */
async function miLink(userId) {
  const actual = await vigente(pool, userId);
  return proyectar(actual || await emitir(pool, userId));
}

/**
 * `POST /api/friends/invite-link/revoke`: el link vigente deja de valer y nace otro. Dos revocaciones
 * simultáneas se ordenan por la fila del código: la segunda no encuentra nada que revocar y devuelve el que
 * dejó la primera. Un alta que está aplicando el código vigente se ordena contra esta misma fila.
 */
async function revocar(userId) {
  for (let intento = 1; ; intento += 1) {
    try {
      const fila = await pool.tx(async (client) => {
        await client.query(
          `UPDATE codigos_de_invitacion SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`,
          [userId]
        );
        const { rows: [nueva] } = await client.query(
          `INSERT INTO codigos_de_invitacion (user_id, code) VALUES ($1, $2)
           ON CONFLICT (user_id) WHERE revoked_at IS NULL DO NOTHING
           RETURNING code, created_at`,
          [userId, generateToken(BYTES_DEL_CODIGO)]
        );
        return nueva || vigente(client, userId);
      });
      logger.audit('invite_link_revoked', { user_id: userId });
      return proyectar(fila);
    } catch (error) {
      if (error.code !== '23505' || error.constraint !== 'uq_codigos_de_invitacion_code'
          || intento >= INTENTOS_DE_EMISION) throw error;
    }
  }
}

/**
 * Dentro de la transacción del alta, con la cuenta ya creada. Devuelve `{ quienInvita }` o null.
 *
 * Un código mal formado, desconocido, revocado o de una cuenta que no está activa no hace nada: la cuenta se
 * crea igual, sin referido. Todo el referido va en su propio savepoint: si algo falla, vuelve atrás entero y
 * el alta sigue. El aviso va después, en el suyo (los savepoints de pool.withSavepoint no se anidan), y nace
 * dentro de la misma transacción: si el alta se revierte, no queda.
 *
 * Orden de locks: la fila del código (FOR SHARE, contra revocar) y después la cuenta de quien invita
 * (FOR SHARE, contra su baja, que la actualiza). La cuenta nueva es de esta transacción.
 */
async function aplicarEnAlta(client, { codigo, invitado }) {
  if (!habilitado() || typeof codigo !== 'string' || !CODIGO_RE.test(codigo)) return null;
  const hecho = await pool.withSavepoint(client, async () => {
    const { rows: [fila] } = await client.query(
      `SELECT id, user_id FROM codigos_de_invitacion WHERE code = $1 AND revoked_at IS NULL FOR SHARE`,
      [codigo]
    );
    if (!fila || fila.user_id === invitado.id) return null;
    const { rows: [quien] } = await client.query(
      `SELECT id FROM users WHERE id = $1 AND status = 'active' FOR SHARE`,
      [fila.user_id]
    );
    if (!quien) return null;
    await client.query(
      `INSERT INTO referidos (quien_invita, invitado, codigo_id) VALUES ($1, $2, $3)`,
      [fila.user_id, invitado.id, fila.id]
    );
    // La misma amistad aceptada que deja aceptar una solicitud (routes/friends.js), en los dos sentidos. La
    // cuenta es nueva: no hay fila previa ni bloqueo posibles, y si la hubiera, el savepoint vuelve atrás.
    await client.query(
      `INSERT INTO friendships (user_id, friend_user_id, status, responded_at)
       VALUES ($1, $2, 'accepted', NOW()), ($2, $1, 'accepted', NOW())`,
      [fila.user_id, invitado.id]
    );
    return { quienInvita: fila.user_id };
  });
  if (!hecho.ok) {
    logger.error('referido_no_aplicado', { user_id: invitado.id, error: hecho.error.code || hecho.error.message });
    return null;
  }
  if (!hecho.value) return null;
  await notifs.create({
    client,
    user_id: hecho.value.quienInvita,
    type: 'friend_added',
    body: textoDelAviso(String(invitado.first_name || '').trim() || 'Alguien'),
    related_entity_type: 'user',
    related_entity_id: invitado.id,
  });
  logger.audit('referido_registrado', { quien_invita: hecho.value.quienInvita, invitado: invitado.id });
  return hecho.value;
}

module.exports = {
  CONTRATO, HABILITADO, CODIGO_RE,
  habilitado, forzarParaTests, capacidad, linkDe, textoDelAviso, miLink, revocar, aplicarEnAlta,
};
