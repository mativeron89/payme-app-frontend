/**
 * services/legalAcceptance.js — constancia de aceptación del paquete legal 3.0.0
 * (v2.129.0 · AB1 · decisiones 39, 44 y 45 de Mati).
 *
 * Con `LEGAL_3_0_0_VIGENTE` encendida, cada titular acepta el Aviso de
 * Privacidad y los Términos de Uso vigentes y declara tener 18 años o más. La
 * aceptación queda en `legal_acceptances` (append-only) con las versiones y
 * huellas exactas de lo que se le mostró, y en la MISMA transacción cuenta como
 * acuse del aviso de foto entre amigos (decisión 45).
 *
 * Con la bandera apagada no existe nada de esto hacia afuera: el estado responde
 * `{required:false, aviso:null, terminos:null}`, el POST responde 409
 * `legal_package_not_active` y las altas ignoran el campo.
 *
 * No mueve dinero, no toca el outbox.
 */
'use strict';

const { z } = require('zod');
const pool = require('../db/pool');
const legal = require('./legal');

const error = (code, status) => Object.assign(new Error(code), { code, status });

const version = z.string().regex(/^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$/);
const huella = z.string().regex(/^[0-9a-f]{64}$/);
/** Cuerpo EXACTO de la aceptación: 5 claves, sin extras. */
const aceptacionSchema = z.object({
  aviso_version: version,
  aviso_hash: huella,
  terminos_version: version,
  terminos_hash: huella,
  adult_declaration: z.literal(true),
}).strict();

const ACCIONES = Object.freeze(['registro_correo', 'registro_google', 'registro_google_continuar', 'aceptacion_existente']);

function vigente() {
  return legal.PAQUETE_300_VIGENTE;
}

/**
 * Valida la forma. Devuelve el cuerpo parseado o lanza un error con `issues`
 * (misma forma que `validateBody`), con el prefijo que corresponda al lugar
 * donde viene el objeto (`legal_acceptance.` en las altas).
 */
function parsear(input, prefijo = '') {
  const r = aceptacionSchema.safeParse(input);
  if (r.success) return r.data;
  const e = error('validation_error', 400);
  e.issues = r.error.issues.map((i) => ({ path: prefijo + i.path.join('.'), message: i.message }));
  throw e;
}

/** El par vigente (aviso integral + Términos), verificado contra su archivo. */
async function parVigente(db = pool) {
  const aviso = await legal.getVerifiedCurrent('aviso_privacidad', { client: db });
  const terminos = await legal.getVerifiedCurrent('terminos_uso', { client: db });
  if (!aviso.status.ready || !terminos.status.ready) throw error('legal_text_unavailable', 503);
  return {
    aviso: { version: aviso.vigente.version, hash: aviso.vigente.hash },
    terminos: { version: terminos.vigente.version, hash: terminos.vigente.hash },
  };
}

async function aceptoPar(userId, par, db) {
  const { rows } = await db.query(
    `SELECT 1 FROM legal_acceptances
      WHERE user_id = $1 AND aviso_version = $2 AND aviso_hash = $3
        AND terminos_version = $4 AND terminos_hash = $5
      LIMIT 1`,
    [userId, par.aviso.version, par.aviso.hash, par.terminos.version, par.terminos.hash]
  );
  return rows.length > 0;
}

/** Estado para `GET /api/legal/acceptance`. Exactamente 3 claves. */
async function estado(userId, db = pool) {
  if (!vigente()) return { required: false, aviso: null, terminos: null };
  const par = await parVigente(db);
  return { required: !(await aceptoPar(userId, par, db)), aviso: par.aviso, terminos: par.terminos };
}

/**
 * Graba la aceptación dentro de la transacción del llamador. El par tiene que
 * ser EXACTAMENTE el vigente: aceptar un texto que ya no rige no prueba nada.
 */
async function registrar(client, userId, accion, aceptacion) {
  if (!ACCIONES.includes(accion)) throw new Error(`legal_acceptance_action_invalid:${accion}`);
  // Serializa con el bootstrap legal: el vigente no cambia a mitad del acto.
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['payme/legal-sync/aviso_privacidad/v1']);
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['payme/legal-sync/terminos_uso/v1']);
  const par = await parVigente(client);
  if (aceptacion.aviso_version !== par.aviso.version || aceptacion.aviso_hash !== par.aviso.hash
      || aceptacion.terminos_version !== par.terminos.version
      || aceptacion.terminos_hash !== par.terminos.hash) {
    throw error('legal_version_mismatch', 409);
  }
  await client.query(
    `INSERT INTO legal_acceptances
       (user_id, action, aviso_version, aviso_hash, terminos_version, terminos_hash, declara_mayor_edad)
     VALUES ($1, $2, $3, $4, $5, $6, true)`,
    [userId, accion, par.aviso.version, par.aviso.hash, par.terminos.version, par.terminos.hash]
  );
  // Decisión 45: la aceptación del aviso vigente cuenta como acuse de la foto
  // entre amigos. Mismo upsert que services/friendAvatarNotice.js.
  await client.query(
    `INSERT INTO friend_avatar_notice_acknowledgements(user_id,notice_version,notice_hash)
     VALUES ($1,$2,$3) ON CONFLICT (user_id) DO UPDATE
     SET notice_version=EXCLUDED.notice_version,notice_hash=EXCLUDED.notice_hash,
         acknowledged_at=CASE WHEN friend_avatar_notice_acknowledgements.notice_version=EXCLUDED.notice_version
           AND friend_avatar_notice_acknowledgements.notice_hash=EXCLUDED.notice_hash
           THEN friend_avatar_notice_acknowledgements.acknowledged_at ELSE clock_timestamp() END`,
    [userId, par.aviso.version, par.aviso.hash]
  );
}

/**
 * Para las altas: con la bandera apagada el campo se ignora; encendida, si
 * viene se valida la forma (400) antes de abrir la transacción. En AB1 es
 * opcional; AB2 lo vuelve obligatorio.
 */
function paraAlta(input) {
  if (!vigente() || input === undefined) return null;
  return parsear(input, 'legal_acceptance.');
}

/** `POST /api/legal/acceptance` — quien ya tenía cuenta. Idempotente. */
async function aceptar(userId, input) {
  if (!vigente()) throw error('legal_package_not_active', 409);
  const aceptacion = parsear(input);
  return pool.tx(async (client) => {
    const { rows: [user] } = await client.query('SELECT status FROM users WHERE id=$1 FOR UPDATE', [userId]);
    if (user?.status !== 'active') throw error('auth_required', 401);
    const par = await parVigente(client);
    if (!(await aceptoPar(userId, par, client))) {
      await registrar(client, userId, 'aceptacion_existente', aceptacion);
    } else if (aceptacion.aviso_version !== par.aviso.version || aceptacion.aviso_hash !== par.aviso.hash
        || aceptacion.terminos_version !== par.terminos.version
        || aceptacion.terminos_hash !== par.terminos.hash) {
      throw error('legal_version_mismatch', 409);
    }
    return { required: false, aviso: par.aviso, terminos: par.terminos };
  });
}

/**
 * Mayoría de edad con la bandera encendida (decisiones 39 y 44): la declaración
 * «18 años o más» que acompaña toda aceptación. `true` si existe; `null` si no
 * (mismo contrato que consent.edadConocida: null = no verificable, cierra).
 */
async function declaroMayoria(userId, db = pool) {
  const { rows } = await db.query(
    'SELECT 1 FROM legal_acceptances WHERE user_id = $1 AND declara_mayor_edad LIMIT 1', [userId]);
  return rows.length > 0 ? true : null;
}

module.exports = { ACCIONES, vigente, parsear, parVigente, estado, registrar, paraAlta, aceptar, declaroMayoria };
