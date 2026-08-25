/**
 * routes/account.js — Saldo, movimientos, historial, stats
 *
 * FIX m6: limit validado con Zod (no Number manual).
 * Incluye /wallet-transactions unificado (B3).
 */
'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const {
  movementsQuery, historyQuery, walletTxQuery, updateMe, updateProfileName, uuidIdParam,
  validateQuery, validateBody, validateParams,
} = require('../schemas');
const { centsToDisplay } = require('../utils/money');
const logger = require('../utils/logger');
const profileIdentity = require('../services/profileIdentity');

const router = express.Router();
router.use(requireAuth);

// ─── GET /me — perfil propio (G-02, v2.20) ─────────────────────────────────
// SELECT propio con ALLOWLIST explícita en el punto de exposición: no se
// reusa req.user (el middleware no trae phone/created_at y no queremos
// engordar una query que corre en CADA request autenticado). Jamás exponer
// password_hash / stripe_customer_id / email_normalized / kyc_status.
// Mismo shape que register (+ phone/created_at); wrapper { user } idéntico.
/**
 * Perfil propio, en UN solo lugar (v2.28).
 *
 * Antes GET y PATCH armaban la respuesta por separado y PATCH se olvidaba de
 * `is_adult`: el front recibía de PATCH un `user` con la misma pinta que el de
 * GET pero sin el veredicto de edad, o sea `undefined`, que es falsy — un adulto
 * recién declarado parecía menor hasta que el front hiciera otro GET. La única
 * defensa real contra eso es que haya una sola función que arme el objeto.
 *
 * Devuelve null si el usuario no existe.
 */
async function perfilPropio(userId) { return profileIdentity.obtenerPerfil(userId); }

function responderPerfilPrivado(res, user) {
  // El perfil incluye PII y `avatar.revision` participa del CAS de reemplazo.
  // Ninguna de esas dos cosas puede sobrevivir en caches intermediarios o del
  // navegador después de una edición, un conflicto 409 o un borrado.
  res.setHeader('Cache-Control', 'private, no-store');
  return res.json({ user });
}

router.get('/me', async (req, res, next) => {
  try {
    const user = await perfilPropio(req.user.id);
    if (!user) return res.status(404).json({ error: 'user_not_found' });
    responderPerfilPrivado(res, user);
  } catch (err) { next(err); }
});

/**
 * PATCH /me — declarar la fecha de nacimiento (D-03 / D-11).
 *
 * Existe porque el registro pasó a exigirla, pero TODOS los usuarios previos
 * quedaron sin ella — y sin fecha, el gate de menores los bloquea para siempre.
 *
 * Se puede declarar UNA sola vez: cambiarla después devuelve 409 y va a
 * soporte. Si se pudiera editar libremente, el gate de D-11 no protegería nada
 * (bastaría con corregirla para saltearlo).
 */
router.patch('/me', validateBody(updateMe), async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      `UPDATE users SET birth_date = $2 WHERE id = $1 AND birth_date IS NULL`,
      [req.user.id, req.body.birth_date]
    );
    if (rowCount === 0) {
      const { rows } = await pool.query(
        `SELECT to_char(birth_date, 'YYYY-MM-DD') AS bd FROM users WHERE id = $1`,
        [req.user.id]
      );
      if (!rows[0]) return res.status(404).json({ error: 'user_not_found' });
      // IDEMPOTENTE: reenviar la MISMA fecha no es un conflicto. Un reintento
      // por red perdida no puede parecerle al usuario un error.
      if (rows[0].bd !== req.body.birth_date) {
        // NADA de fecha en el log: ni completa, ni el año, ni la diferencia de
        // años. El logger enmascara email/phone/clabe/rfc pero NO birth_date, y
        // el log general no necesita datos de nacimiento para nada — quien tenga
        // autorización para revisar el caso consulta la cuenta por su canal.
        // Con user_id y el código del evento alcanza para encontrarlo.
        logger.error('birth_date_cambio_rechazado_revision_manual', {
          user_id: req.user.id,
        });
        return res.status(409).json({
          error: 'birth_date_already_set',
          detail: 'La fecha de nacimiento ya fue declarada y no se puede cambiar desde la app.',
        });
      }
    }
    logger.audit('birth_date_declarada', { user_id: req.user.id });
    // Mismo armador que GET /me: la respuesta trae `is_adult` y `birth_date_set`,
    // así el front no necesita un GET extra para saber si quedó habilitado.
    const user = await perfilPropio(req.user.id);
    if (!user) return res.status(404).json({ error: 'user_not_found' });
    responderPerfilPrivado(res, user);
  } catch (err) { next(err); }
});

function requireProfileIdentityRollout(_req, res, next) {
  if (!profileIdentity.profileIdentityRolloutEnabled()) {
    return res.status(503).json({
      error: 'profile_identity_rollout_not_ready',
      capability: profileIdentity.PROFILE_IDENTITY_CAPABILITY,
    });
  }
  next();
}

// Separado del PATCH write-once de birth_date: ni payme_id ni fecha entran en
// este contrato. La capability se activó con el aviso 2.2.0 ratificado.
router.patch('/me/profile', requireProfileIdentityRollout,
  validateBody(updateProfileName), async (req, res, next) => {
    try {
      const user = await profileIdentity.actualizarNombre(req.user.id, req.body);
      logger.audit('profile_name_updated', { user_id: req.user.id });
      responderPerfilPrivado(res, user);
    } catch (err) { next(err); }
  });

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: profileIdentity.MAX_INPUT_BYTES, files: 1, fields: 0 },
});

// Defensa específica antes de bufferizar/decodificar. Se clavea por principal
// autenticado; el budget de CPU del servicio añade un techo concurrente por
// proceso. Ninguno de los dos pretende ser un lock distribuido.
const avatarUploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `avatar:${req.user.id}`,
  handler: (_req, res) => res.status(429).json({ error: 'avatar_rate_limited' }),
});

function reserveAvatarProcessingBudget(req, res, next) {
  let release;
  try {
    release = profileIdentity.acquireAvatarProcessingBudget(req.user.id);
  } catch (error) {
    return next(error);
  }
  let released = false;
  const releaseOnce = () => {
    if (released) return;
    released = true;
    res.off('finish', releaseOnce);
    res.off('close', releaseOnce);
    req.off('aborted', releaseOnce);
    release();
  };
  // El cupo se toma ANTES de memoryStorage y cubre bytes + decode + escritura.
  // `finish`, `close` y `aborted` compiten; el guard garantiza una sola salida.
  res.once('finish', releaseOnce);
  res.once('close', releaseOnce);
  req.once('aborted', releaseOnce);
  next();
}

function singleAvatar(req, res, next) {
  avatarUpload.single('avatar')(req, res, (error) => {
    if (!error) return next();
    const tooLarge = error.code === 'LIMIT_FILE_SIZE';
    return res.status(tooLarge ? 413 : 400).json({
      error: tooLarge ? 'avatar_input_too_large' : 'avatar_multipart_invalid',
    });
  });
}

function revisionFromIfMatch(req) {
  const raw = req.headers['if-match'];
  if (raw === undefined) return null;
  const match = String(raw).match(
    /^(?:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})|"([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})")$/i
  );
  if (!match) {
    throw Object.assign(new Error('avatar_revision_invalid'), {
      code: 'avatar_revision_invalid', status: 400,
    });
  }
  const revision = match[1] || match[2];
  return revision.toLowerCase();
}

router.get('/me/avatar', requireProfileIdentityRollout, async (req, res, next) => {
  try {
    const avatar = await profileIdentity.obtenerAvatar(req.user.id);
    if (!avatar) return res.status(404).json({ error: 'avatar_not_found' });
    // Bytes privados y borrables: nunca quedan en cache ni se revalidan con
    // una revisión. `res.end` evita el ETag automático que Express agrega a
    // `res.send` aun cuando la respuesta sea privada.
    res.setHeader('Cache-Control', 'private, no-store');
    res.type(avatar.mimeType);
    res.setHeader('Content-Length', String(avatar.bytes.length));
    res.end(avatar.bytes);
  } catch (err) { next(err); }
});

router.put('/me/avatar', requireProfileIdentityRollout, avatarUploadLimiter,
  reserveAvatarProcessingBudget, singleAvatar,
  async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'avatar_file_required' });
      const expectedRevision = revisionFromIfMatch(req);
      const image = await profileIdentity.procesarAvatar(req.file.buffer, req.file.mimetype);
      const avatar = await profileIdentity.guardarAvatar(req.user.id, image, { expectedRevision });
      logger.audit('profile_avatar_saved', { user_id: req.user.id });
      res.status(avatar.created ? 201 : 200).json({
        avatar: {
          revision: avatar.revision, width: avatar.width, height: avatar.height,
          updated_at: avatar.updated_at,
        },
      });
    } catch (err) { next(err); }
  });

router.delete('/me/avatar', requireProfileIdentityRollout, async (req, res, next) => {
  try {
    if (req.headers['if-match'] === undefined) {
      return res.status(428).json({ error: 'avatar_revision_required' });
    }
    const expectedRevision = revisionFromIfMatch(req);
    const deleted = await profileIdentity.borrarAvatar(req.user.id, expectedRevision);
    if (!deleted) return res.status(409).json({ error: 'avatar_revision_conflict' });
    logger.audit('profile_avatar_deleted', { user_id: req.user.id });
    res.status(204).end();
  } catch (err) { next(err); }
});

router.get('/balance', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT balance_cents, held_balance_cents, clabe FROM wallets WHERE user_id = $1`,
      [req.user.id]
    );
    const w = rows[0] || { balance_cents: 0, held_balance_cents: 0, clabe: null };
    const balance = Number(w.balance_cents);
    // G-03 (v2.21): retenido en garantías + disponible computado server-side —
    // misma resta que placeWalletHold, el 402 de pago wallet y transfers.
    // chk_wallets_held_balance garantiza 0 ≤ held ≤ balance en la fila.
    const held = Number(w.held_balance_cents || 0);
    const available = balance - held;
    res.json({
      balance_cents: balance,
      balance_display: centsToDisplay(balance),
      held_balance_cents: held,
      held_balance_display: centsToDisplay(held),
      available_cents: available,
      available_display: centsToDisplay(available),
      clabe: w.clabe,
      currency: 'mxn',
    });
  } catch (err) { next(err); }
});

router.get('/movements', validateQuery(movementsQuery), async (req, res, next) => {
  try {
    const { limit, offset } = req.validatedQuery;
    const { rows } = await pool.query(
      `SELECT pa.id, pa.gross_amount_cents, pa.tip_amount_cents,
              pa.payment_type, pa.status, pa.created_at,
              m.code AS mesa_code,
              r.name AS restaurant_name, r.category AS restaurant_category,
              pm.brand, pm.bank_name, pm.last_four
         FROM payment_attempts pa
         JOIN mesas m ON m.id = pa.mesa_id
         JOIN restaurants r ON r.id = m.restaurant_id
    LEFT JOIN payment_methods pm ON pm.id = pa.payment_method_id
        WHERE pa.user_id = $1 AND pa.status IN ('succeeded','processed')
        ORDER BY pa.created_at DESC
        LIMIT $2 OFFSET $3`,
      [req.user.id, limit, offset]
    );
    res.json({
      movements: rows.map(r => ({
        id: r.id,
        amount_cents: Number(r.gross_amount_cents),
        amount_display: centsToDisplay(Number(r.gross_amount_cents)),
        tip_cents: Number(r.tip_amount_cents),
        payment_type: r.payment_type,
        status: r.status,
        date: r.created_at,
        mesa: { code: r.mesa_code, restaurant: r.restaurant_name, category: r.restaurant_category },
        method: r.brand ? {
          brand: r.brand, bank: r.bank_name, last_four: r.last_four,
          display: `${r.brand === 'visa' ? 'Visa' : r.brand === 'mastercard' ? 'MC' : 'Amex'} ••${r.last_four}`,
        } : null,
      })),
      limit, offset,
    });
  } catch (err) { next(err); }
});

router.get('/movements/:id', validateParams(uuidIdParam), async (req, res, next) => {
  try {
    const { rows: aRows } = await pool.query(
      `SELECT pa.*, m.code AS mesa_code, r.name AS restaurant_name, r.category,
              pm.brand, pm.bank_name, pm.last_four
         FROM payment_attempts pa
         JOIN mesas m ON m.id = pa.mesa_id
         JOIN restaurants r ON r.id = m.restaurant_id
    LEFT JOIN payment_methods pm ON pm.id = pa.payment_method_id
        WHERE pa.id = $1 AND pa.user_id = $2`,
      [req.params.id, req.user.id]
    );
    const a = aRows[0];
    if (!a) return res.status(404).json({ error: 'movement_not_found' });

    const { rows: items } = await pool.query(
      `SELECT mi.name, mi.price_cents, mi.quantity, mi.category,
              pai.amount_cents, pai.fraction_bps
         FROM payment_attempt_items pai
         JOIN mesa_items mi ON mi.id = pai.mesa_item_id
        WHERE pai.payment_attempt_id = $1`, [a.id]
    );

    res.json({
      id: a.id,
      restaurant: { name: a.restaurant_name, category: a.category },
      mesa: { code: a.mesa_code },
      date: a.created_at,
      payment_type: a.payment_type,
      method: a.brand ? { brand: a.brand, bank: a.bank_name, last_four: a.last_four } : null,
      items: items.map(i => ({
        name: i.name, price_cents: Number(i.price_cents),
        quantity: i.quantity, category: i.category,
        // En consumo estos dos campos son el importe/fracción realmente
        // cobrados. En partes iguales quedan null a propósito: el item fue
        // declarado como consumo, pero el cobro correspondió al slot.
        amount_cents: i.amount_cents == null ? null : Number(i.amount_cents),
        fraction_bps: i.fraction_bps == null ? null : Number(i.fraction_bps),
      })),
      items_amount_cents: Number(a.items_amount_cents),
      tip_amount_cents: Number(a.tip_amount_cents),
      gross_amount_cents: Number(a.gross_amount_cents),
      fee_amount_cents: Number(a.fee_amount_cents),
      status: a.status,
    });
  } catch (err) { next(err); }
});

// ─── /wallet-transactions: TODO unificado ──────────────────
router.get('/wallet-transactions', validateQuery(walletTxQuery), async (req, res, next) => {
  try {
    const { type, from, to, limit, offset } = req.validatedQuery;
    const params = [req.user.id];
    let where = `user_id = $1`;
    if (type) { params.push(type); where += ` AND type = $${params.length}`; }
    if (from) { params.push(from); where += ` AND created_at >= $${params.length}`; }
    if (to)   { params.push(to);   where += ` AND created_at <= $${params.length}`; }
    params.push(limit, offset);

    const { rows } = await pool.query(
      `SELECT id, type, amount_cents, balance_after_cents,
              related_entity_type, related_entity_id,
              description, metadata, created_at
         FROM wallet_transactions
        WHERE ${where}
        ORDER BY created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({
      transactions: rows.map(t => ({
        id: t.id,
        type: t.type,
        amount_cents: Number(t.amount_cents),
        amount_display: centsToDisplay(Math.abs(Number(t.amount_cents))),
        sign: Number(t.amount_cents) >= 0 ? 'credit' : 'debit',
        balance_after_cents: Number(t.balance_after_cents),
        balance_after_display: centsToDisplay(Number(t.balance_after_cents)),
        related: t.related_entity_type
          ? { type: t.related_entity_type, id: t.related_entity_id } : null,
        description: t.description,
        metadata: t.metadata,
        date: t.created_at,
      })),
      limit, offset,
    });
  } catch (err) { next(err); }
});

router.get('/history', validateQuery(historyQuery), async (req, res, next) => {
  try {
    const { category, from, to, limit, offset } = req.validatedQuery;
    const params = [req.user.id];
    let where = `pa.user_id = $1 AND pa.status IN ('succeeded','processed')`;
    if (category) { params.push(category); where += ` AND r.category = $${params.length}`; }
    if (from)     { params.push(from);     where += ` AND pa.created_at >= $${params.length}`; }
    if (to)       { params.push(to);       where += ` AND pa.created_at <= $${params.length}`; }
    params.push(limit, offset);

    const { rows } = await pool.query(
      // `m.status` (aditivo): el front no tenía forma de saber si la mesa de un
      // pago sigue abierta, así que pintaba las mesas vivas del invitado bajo un
      // encabezado de mes, como si ya hubieran terminado.
      //
      // ⚠️ La GRANULARIDAD no cambia: esto devuelve UN RENGLÓN POR PAGO y también
      // alimenta PagosScreen, que es superficie card-only ratificada. Hacerlo
      // devolver una fila por mesa mutaría una superficie ratificada para
      // acomodar una pantalla nueva. La agregación se queda en el front.
      `SELECT pa.id, pa.gross_amount_cents, pa.created_at,
              m.code AS mesa_code, m.status AS mesa_status,
              r.name AS restaurant_name, r.category
         FROM payment_attempts pa
         JOIN mesas m ON m.id = pa.mesa_id
         JOIN restaurants r ON r.id = m.restaurant_id
        WHERE ${where}
        ORDER BY pa.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json({
      history: rows.map(r => ({
        id: r.id,
        amount_cents: Number(r.gross_amount_cents),
        date: r.created_at,
        mesa_code: r.mesa_code,
        mesa_status: r.mesa_status,
        restaurant: r.restaurant_name,
        category: r.category,
      })),
      limit, offset,
    });
  } catch (err) { next(err); }
});

router.get('/stats', async (req, res, next) => {
  try {
    const { rows: month } = await pool.query(
      `SELECT COALESCE(SUM(gross_amount_cents), 0) AS spent,
              COUNT(*)::int AS visits,
              CASE WHEN COUNT(*) > 0
                   THEN COALESCE(SUM(gross_amount_cents), 0) / COUNT(*) ELSE 0 END AS avg_per_visit
         FROM payment_attempts
        WHERE user_id = $1 AND status IN ('succeeded','processed')
          AND created_at >= date_trunc('month', NOW())`, [req.user.id]
    );
    const { rows: topR } = await pool.query(
      `SELECT r.name, COUNT(*)::int AS visits
         FROM payment_attempts pa JOIN mesas m ON m.id = pa.mesa_id JOIN restaurants r ON r.id = m.restaurant_id
        WHERE pa.user_id = $1 AND pa.status IN ('succeeded','processed')
        GROUP BY r.id, r.name ORDER BY visits DESC LIMIT 3`, [req.user.id]
    );
    const { rows: topD } = await pool.query(
      `SELECT mi.name, COUNT(*)::int AS times
         FROM payment_attempt_items pai
         JOIN payment_attempts pa ON pa.id = pai.payment_attempt_id
         JOIN mesa_items mi ON mi.id = pai.mesa_item_id
        WHERE pa.user_id = $1 AND pa.status IN ('succeeded','processed')
        GROUP BY mi.name ORDER BY times DESC LIMIT 1`, [req.user.id]
    );
    const { rows: topCat } = await pool.query(
      `SELECT r.category, COUNT(*)::int AS visits
         FROM payment_attempts pa JOIN mesas m ON m.id = pa.mesa_id JOIN restaurants r ON r.id = m.restaurant_id
        WHERE pa.user_id = $1 AND pa.status IN ('succeeded','processed')
        GROUP BY r.category ORDER BY visits DESC LIMIT 1`, [req.user.id]
    );
    res.json({
      month: {
        spent_cents: Number(month[0].spent),
        spent_display: centsToDisplay(Number(month[0].spent)),
        visits: month[0].visits,
        avg_per_visit_cents: Number(month[0].avg_per_visit),
        avg_per_visit_display: centsToDisplay(Number(month[0].avg_per_visit)),
      },
      top_restaurants: topR,
      top_dish: topD[0] || null,
      favorite_category: topCat[0]?.category || null,
    });
  } catch (err) { next(err); }
});

module.exports = router;
