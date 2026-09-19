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
  validateQuery, validateBody, validateParams, statsPeriodQuery,
} = require('../schemas');
const { centsToDisplay } = require('../utils/money');
const logger = require('../utils/logger');
const profileIdentity = require('../services/profileIdentity');
const { proveedoresVinculados } = require('../services/externalIdentities');
const consumoPropio = require('../services/consumoPropio');
const {
  inicioDeMesMxSql, rangoDePeriodoMxSql, rangoDeMesAtrasMxSql, filtroDeRango,
} = require('../services/inicioDeMes');
// AB-21 · n169: TODAS las consultas de estadísticas cortan el mes a la
// medianoche de México (services/inicioDeMes.js), no en la zona de la sesión.
const INICIO_DE_MES = inicioDeMesMxSql();
const { dineroHabilitado } = require('../services/moneyRail');

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

function marcarRespuestaPrivada(_req, res, next) {
  // Se instala antes de los validadores de la ruta: el detalle individual no
  // debe ser cacheable tampoco cuando el resultado sea 400 o 404.
  res.setHeader('Cache-Control', 'private, no-store');
  next();
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
// este contrato. La capability se activó con el aviso 2.3.0 ratificado.
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

/**
 * GET /me/linked-providers — v2.91.0 · APP-LINKED-PROVIDERS-AB-05 (addendum).
 *
 * Proveedores con binding ACTIVO de la cuenta del bearer: sólo el nombre, del
 * vocabulario cerrado ["facebook","google"], ordenado, [] si no hay. Endpoint
 * propio y NO una clave de GET /me: el front publicado decodifica /me con
 * claves exactas y una clave nueva le rompe el editor de perfil. No depende
 * del rollout de identidad de perfil: no hay foto ni nombre en juego.
 */
router.get('/me/linked-providers', async (req, res, next) => {
  try {
    const linkedProviders = await proveedoresVinculados(req.user.id);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ linked_providers: linkedProviders });
  } catch (err) { next(err); }
});

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

router.get('/movements/:id', marcarRespuestaPrivada,
  validateParams(uuidIdParam), async (req, res, next) => {
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
              pai.amount_cents, pai.fraction_bps, pai.declared_fraction_bps
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
        // declarado como consumo, pero el cobro correspondió al slot. La
        // declaración viaja separada para no convertirla en dinero/tenencia.
        amount_cents: i.amount_cents == null ? null : Number(i.amount_cents),
        fraction_bps: i.fraction_bps == null ? null : Number(i.fraction_bps),
        declared_fraction_bps: i.declared_fraction_bps == null
          ? null : Number(i.declared_fraction_bps),
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

/**
 * AB-17 · «Mis estadísticas» etapa 1 (decisión de Mati: «Con lo que cada uno
 * eligió en sus mesas»). Mientras los pagos estén apagados, el mes se arma con
 * LO QUE ELEGISTE —la misma definición que `GET /api/mesas/mine`
 * (services/consumoPropio.js)—; con el dinero encendido, con lo pagado. `basis`
 * le dice al front cuál de las dos es, para rotular «consumo» o «gasto» sin
 * adivinar. Sólo la cuenta del bearer.
 *
 * Mes: la MISMA regla que el resto de /stats: desde la medianoche del día 1 en
 * hora de México (services/inicioDeMes.js; AB-21 corrigió el corte, que antes
 * dependía de la zona de la sesión de la base).
 * Una visita = una mesa creada este mes con consumo propio > 0.
 * Promedio en centavos enteros, truncado. Porcentajes: los calcula el front.
 * Orden: monto desc, empate por nombre de categoría, `other` siempre al final;
 * una categoría con monto 0 no sale.
 */
/**
 * AB-22 · período. `RANGO_DEL_MES` es el this_month de siempre; los handlers
 * leen `req.validatedQuery.period` (validado con lista cerrada en schemas/).
 */
const RANGO_DEL_MES = rangoDePeriodoMxSql('this_month');
function periodoDe(req) {
  const key = req.validatedQuery?.period || 'this_month';
  return { key, rango: rangoDePeriodoMxSql(key) };
}
async function periodoPublicado(key, rango) {
  const { rows: [r] } = await pool.query(
    `SELECT ${rango.desde} AS desde, ${rango.hasta || 'NULL::timestamptz'} AS hasta`
  );
  return {
    key,
    start: new Date(r.desde).toISOString(),
    end: r.hasta ? new Date(r.hasta).toISOString() : null,
  };
}

/**
 * Pagos del rango por categoría, convención G-34 (neto de reembolsos
 * procesados). La usan `category_breakdown` (siempre el mes) y
 * `consumption_month` en base payments (el período pedido).
 */
async function categoriasPagadas(userId, rango) {
  const { rows } = await pool.query(
    `SELECT r.category,
            COALESCE(SUM(GREATEST(pa.gross_amount_cents - COALESCE(rf.reembolsado, 0), 0)), 0)
              AS spent,
            COUNT(*)::int AS visits
       FROM payment_attempts pa
       JOIN mesas m ON m.id = pa.mesa_id
       JOIN restaurants r ON r.id = m.restaurant_id
       LEFT JOIN (
         SELECT payment_attempt_id, SUM(amount_cents) AS reembolsado
           FROM payment_refunds WHERE status = 'processed'
          GROUP BY payment_attempt_id
       ) rf ON rf.payment_attempt_id = pa.id
      WHERE pa.user_id = $1 AND pa.status IN ('succeeded','processed')
        AND ${filtroDeRango('pa.created_at', rango)}
      GROUP BY r.category`, [userId]
  );
  return rows
    .map((c) => ({ category: c.category, spent_cents: Number(c.spent), visits: c.visits }))
    .filter((c) => c.spent_cents > 0)
    .sort((a, b) => b.spent_cents - a.spent_cents || a.category.localeCompare(b.category));
}

function ordenarCategorias(lista) {
  return lista
    .filter((c) => c.amount_cents > 0)
    .sort((a, b) => {
      if ((a.category === 'other') !== (b.category === 'other')) return a.category === 'other' ? 1 : -1;
      return b.amount_cents - a.amount_cents || a.category.localeCompare(b.category);
    });
}

function bloqueDeConsumo(basis, categorias, total, visitas) {
  return {
    basis,
    total_cents: total,
    visits: visitas,
    avg_per_visit_cents: visitas > 0 ? Math.floor(total / visitas) : 0,
    categories: ordenarCategorias(categorias),
  };
}

/**
 * Las mesas del mes con selección propia: la MISMA consulta para
 * `consumption_month` y para «Tus restaurantes», así los dos totales salen del
 * mismo conjunto.
 */
async function mesasDelMesConSeleccion(userId, rango = RANGO_DEL_MES) {
  const { rows } = await pool.query(
    `SELECT m.id, m.code, m.division_mode, m.created_at,
            r.id AS restaurant_id, r.name AS restaurant_name, r.category
       FROM mesas m
       JOIN restaurants r ON r.id = m.restaurant_id
      WHERE ${filtroDeRango('m.created_at', rango)}
        AND (
              EXISTS (
                SELECT 1 FROM mesa_item_claims c
                 WHERE c.mesa_id = m.id AND c.locked_by_user_id = $1
                   AND (c.status = 'paid'
                        OR (c.status = 'locked'
                            AND (c.lock_expires_at IS NULL OR c.lock_expires_at >= NOW())))
              )
              OR EXISTS (
                SELECT 1 FROM mesa_division_slots s
                 WHERE s.mesa_id = m.id AND s.claimed_by_user_id = $1
              )
            )`,
    [userId]
  );
  return rows;
}

async function consumoDesdeSelecciones(userId, rango = RANGO_DEL_MES) {
  const mesas = await mesasDelMesConSeleccion(userId, rango);
  const mios = await consumoPropio.porMesa(userId, mesas);
  const porCategoria = new Map();
  let total = 0;
  let visitas = 0;
  for (const m of mesas) {
    const monto = mios.get(m.id)?.amount_cents || 0;
    if (monto <= 0) continue;
    total += monto;
    visitas += 1;
    const acc = porCategoria.get(m.category) || { category: m.category, amount_cents: 0, visits: 0 };
    acc.amount_cents += monto;
    acc.visits += 1;
    porCategoria.set(m.category, acc);
  }
  return bloqueDeConsumo('consumption', [...porCategoria.values()], total, visitas);
}

/** Con el dinero encendido: lo pagado, con la convención de category_breakdown. */
function consumoDesdePagos(categoriasPagadas) {
  const categorias = categoriasPagadas.map((c) => ({
    category: c.category, amount_cents: c.spent_cents, visits: c.visits,
  }));
  const total = categorias.reduce((acc, c) => acc + c.amount_cents, 0);
  const visitas = categorias.reduce((acc, c) => acc + c.visits, 0);
  return bloqueDeConsumo('payments', categorias, total, visitas);
}

/**
 * AB-20 · «Tus restaurantes» (pantalla 2b). Ruta propia y no un bloque de
 * /stats: el detalle por visita e ítem sólo lo necesita esta pantalla, y una
 * mesa puede tener 100+ ítems. Acotada al mes en hora de México (misma regla
 * que /stats, services/inicioDeMes.js); sin paginar. `month_start` es ese
 * instante, en ISO UTC.
 *
 * `basis` igual que `consumption_month`: con el dinero apagado sale de lo
 * elegido (services/consumoPropio.js, con detalle por ítem); encendido, de lo
 * pagado con la convención de `category_breakdown` (intentos succeeded/
 * processed del mes, neto de reembolsos procesados). En esa base el monto de
 * la visita INCLUYE la propina (bruto del intento) y los ítems no; se declara.
 * `total_cents` coincide con `consumption_month.total_cents` en las dos bases.
 *
 * Tope defensivo: más de MAX_VISITAS_DEL_MES visitas en el mes ⇒ 413
 * `stats_month_too_large`, sin datos parciales (nunca una lista recortada que
 * parezca completa).
 * Nunca otros comensales, cuántos eran, el total ni la propina de la mesa.
 */
const MAX_VISITAS_DEL_MES = 1000;
let maxVisitasDelMes = MAX_VISITAS_DEL_MES;
function fijarMaxVisitasParaTests(n) {
  if (process.env.NODE_ENV !== 'test') throw new Error('stats_test_seam_forbidden');
  const previo = maxVisitasDelMes;
  maxVisitasDelMes = n;
  return () => { maxVisitasDelMes = previo; };
}

function armarRestaurantes(basis, visitas) {
  const porResto = new Map();
  let total = 0;
  for (const v of visitas) {
    if (v.amount_cents <= 0) continue;
    total += v.amount_cents;
    const r = porResto.get(v.restaurant_id) || {
      id: v.restaurant_id, name: v.restaurant_name, category: v.category,
      amount_cents: 0, visits_count: 0, visits: [],
    };
    r.amount_cents += v.amount_cents;
    r.visits_count += 1;
    r.visits.push({
      code: v.code,
      created_at: new Date(v.created_at).toISOString(),
      division_mode: v.division_mode,
      amount_cents: v.amount_cents,
      items: v.items,
    });
    porResto.set(v.restaurant_id, r);
  }
  const restaurants = [...porResto.values()]
    .sort((a, b) => b.amount_cents - a.amount_cents || a.name.localeCompare(b.name));
  for (const r of restaurants) {
    r.visits.sort((a, b) => b.created_at.localeCompare(a.created_at) || a.code.localeCompare(b.code));
  }
  return { basis, total_cents: total, restaurants };
}

async function restaurantesDesdeSelecciones(userId, rango = RANGO_DEL_MES) {
  const mesas = await mesasDelMesConSeleccion(userId, rango);
  const mios = await consumoPropio.porMesa(userId, mesas, pool, { detalle: true });
  return armarRestaurantes('consumption', mesas.map((m) => ({
    ...m,
    amount_cents: mios.get(m.id)?.amount_cents || 0,
    items: mios.get(m.id)?.items || [],
  })));
}

async function restaurantesDesdePagos(userId, rango = RANGO_DEL_MES) {
  const { rows: mesas } = await pool.query(
    `SELECT m.id, m.code, m.division_mode, m.created_at,
            r.id AS restaurant_id, r.name AS restaurant_name, r.category,
            COALESCE(SUM(GREATEST(pa.gross_amount_cents - COALESCE(rf.reembolsado, 0), 0)), 0)
              AS amount
       FROM payment_attempts pa
       JOIN mesas m ON m.id = pa.mesa_id
       JOIN restaurants r ON r.id = m.restaurant_id
       LEFT JOIN (
         SELECT payment_attempt_id, SUM(amount_cents) AS reembolsado
           FROM payment_refunds WHERE status = 'processed'
          GROUP BY payment_attempt_id
       ) rf ON rf.payment_attempt_id = pa.id
      WHERE pa.user_id = $1 AND pa.status IN ('succeeded','processed')
        AND ${filtroDeRango('pa.created_at', rango)}
      GROUP BY m.id, m.code, m.division_mode, m.created_at, r.id, r.name, r.category`,
    [userId]
  );
  const { rows: items } = await pool.query(
    `SELECT pa.mesa_id, pai.mesa_item_id, mi.name, mi.created_at,
            COALESCE(SUM(pai.fraction_bps), 0)::int AS fraction_bps,
            COALESCE(SUM(pai.amount_cents), 0) AS amount_cents
       FROM payment_attempt_items pai
       JOIN payment_attempts pa ON pa.id = pai.payment_attempt_id
       JOIN mesa_items mi ON mi.id = pai.mesa_item_id
      WHERE pa.user_id = $1 AND pa.status IN ('succeeded','processed')
        AND ${filtroDeRango('pa.created_at', rango)}
      GROUP BY pa.mesa_id, pai.mesa_item_id, mi.name, mi.created_at
      ORDER BY mi.created_at ASC, pai.mesa_item_id ASC`,
    [userId]
  );
  const itemsPorMesa = new Map();
  for (const i of items) {
    if (!itemsPorMesa.has(i.mesa_id)) itemsPorMesa.set(i.mesa_id, []);
    itemsPorMesa.get(i.mesa_id).push({
      name: i.name, fraction_bps: Number(i.fraction_bps), amount_cents: Number(i.amount_cents),
    });
  }
  return armarRestaurantes('payments', mesas.map((m) => ({
    ...m, amount_cents: Number(m.amount), items: itemsPorMesa.get(m.id) || [],
  })));
}

router.get('/stats/restaurants', validateQuery(statsPeriodQuery), async (req, res, next) => {
  try {
    const { key: periodo, rango } = periodoDe(req);
    const period = await periodoPublicado(periodo, rango);
    const cuerpo = dineroHabilitado()
      ? await restaurantesDesdePagos(req.user.id, rango)
      : await restaurantesDesdeSelecciones(req.user.id, rango);
    const visitas = cuerpo.restaurants.reduce((s, r) => s + r.visits_count, 0);
    if (visitas > maxVisitasDelMes) {
      return res.status(413).json({ error: 'stats_month_too_large' });
    }
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({
      basis: cuerpo.basis,
      period,
      // Compatibilidad (AB-20): el inicio del rango; con period=this_month, el del mes.
      month_start: period.start,
      total_cents: cuerpo.total_cents,
      restaurants: cuerpo.restaurants,
    });
  } catch (err) { next(err); }
});

/**
 * AB-22 · «Qué comes» por platos (pantalla 2c). Se arma desde la MISMA
 * estructura que «Tus restaurantes» (restaurantes → visitas → lo propio por
 * ítem), en las dos bases: una sola fuente para las dos pantallas.
 *
 * Regla de agrupación (REVISABLE, declarada en el handoff): un plato es
 * (restaurante, nombre normalizado). Normalizar = NFC, minúsculas, sin espacios
 * al borde y con los internos colapsados; los ACENTOS se conservan
 * («Tiramisu» ≠ «Tiramisú»). Nunca se mezclan restaurantes. El nombre
 * mostrado es la grafía de la visita más reciente.
 * `times` = cantidad de VISITAS en que lo elegiste (media porción = 1; dos
 * ítems con el mismo nombre en la misma mesa = 1). `amount_cents` = lo tuyo
 * (en base payments, lo cobrado por ítem, sin propina). Mesas «igual»: sin
 * ítems ⇒ no aportan platos.
 * Orden: times desc, monto desc, nombre, restaurante; tope 5; `distinct_dishes`
 * = cuántos platos distintos hubo en el período.
 */
const MAX_VISITAS_DEL_RANGO = 5000;
let maxVisitasDelRango = MAX_VISITAS_DEL_RANGO;
function fijarMaxVisitasDelRangoParaTests(n) {
  if (process.env.NODE_ENV !== 'test') throw new Error('stats_test_seam_forbidden');
  const previo = maxVisitasDelRango;
  maxVisitasDelRango = n;
  return () => { maxVisitasDelRango = previo; };
}

function normalizarPlato(nombre) {
  return String(nombre).normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
}

function armarPlatos(restaurants) {
  const platos = new Map();
  for (const r of restaurants) {
    // De la visita más vieja a la más nueva: la última grafía vista gana.
    const visitas = [...r.visits].sort((a, b) => a.created_at.localeCompare(b.created_at));
    for (const v of visitas) {
      const enEstaVisita = new Set();
      for (const it of v.items) {
        const clave = `${r.id}\u0000${normalizarPlato(it.name)}`;
        const p = platos.get(clave) || {
          name: it.name,
          restaurant: { id: r.id, name: r.name, category: r.category },
          times: 0, amount_cents: 0,
        };
        p.name = it.name;
        p.amount_cents += it.amount_cents;
        if (!enEstaVisita.has(clave)) { p.times += 1; enEstaVisita.add(clave); }
        platos.set(clave, p);
      }
    }
  }
  const todos = [...platos.values()].sort((a, b) => b.times - a.times
    || b.amount_cents - a.amount_cents
    || a.name.localeCompare(b.name)
    || a.restaurant.name.localeCompare(b.restaurant.name));
  return { distinct_dishes: todos.length, dishes: todos.slice(0, 5) };
}

router.get('/stats/dishes', validateQuery(statsPeriodQuery), async (req, res, next) => {
  try {
    const { key: periodo, rango } = periodoDe(req);
    const period = await periodoPublicado(periodo, rango);
    const cuerpo = dineroHabilitado()
      ? await restaurantesDesdePagos(req.user.id, rango)
      : await restaurantesDesdeSelecciones(req.user.id, rango);
    const visitas = cuerpo.restaurants.reduce((s, r) => s + r.visits_count, 0);
    if (visitas > maxVisitasDelRango) {
      return res.status(413).json({ error: 'stats_range_too_large' });
    }
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ basis: cuerpo.basis, period, ...armarPlatos(cuerpo.restaurants) });
  } catch (err) { next(err); }
});

/**
 * AB-22 · «Evolución» (pantalla 2f). Los últimos 6 meses calendario de México,
 * del más viejo al actual, meses vacíos incluidos. Cada mes se calcula con la
 * MISMA función que `consumption_month` sobre su propio rango, así el mes en
 * curso es, por construcción, `consumption_month` (un test lo exige igual).
 * `avg_per_month_cents` = floor(total / 6), con los meses vacíos adentro (el
 * ejemplo del diseño: 4380 / 6 = 730). Sin período (el rango es fijo).
 * Tope: más de 5000 visitas en los 6 meses ⇒ 413, sin datos parciales.
 */
const MESES_DE_EVOLUCION = 6;

router.get('/stats/evolution', async (req, res, next) => {
  try {
    const meses = [];
    for (let k = MESES_DE_EVOLUCION - 1; k >= 0; k -= 1) {
      const rango = rangoDeMesAtrasMxSql(k);
      const bloque = dineroHabilitado()
        ? consumoDesdePagos(await categoriasPagadas(req.user.id, rango))
        : await consumoDesdeSelecciones(req.user.id, rango);
      const { rows: [inicio] } = await pool.query(`SELECT ${rango.desde} AS t`);
      meses.push({ basis: bloque.basis, month_start: new Date(inicio.t).toISOString(), bloque });
    }
    const visitas = meses.reduce((s, m) => s + m.bloque.visits, 0);
    if (visitas > maxVisitasDelRango) {
      return res.status(413).json({ error: 'stats_range_too_large' });
    }
    const total = meses.reduce((s, m) => s + m.bloque.total_cents, 0);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({
      basis: meses[meses.length - 1].basis,
      months: meses.map((m) => ({
        month_start: m.month_start,
        total_cents: m.bloque.total_cents,
        visits: m.bloque.visits,
        categories: m.bloque.categories,
      })),
      total_cents: total,
      avg_per_month_cents: Math.floor(total / MESES_DE_EVOLUCION),
    });
  } catch (err) { next(err); }
});

router.get('/stats', validateQuery(statsPeriodQuery), async (req, res, next) => {
  try {
    const { rows: month } = await pool.query(
      `SELECT COALESCE(SUM(gross_amount_cents), 0) AS spent,
              COUNT(*)::int AS visits,
              -- v2.98.0 · SUM(bigint) es numeric: dividirlo daba decimales
              -- (6500/3 = 2166.67) y centsToDisplay lanzaba ⇒ 500 en /stats.
              -- Centavos enteros, truncando hacia abajo (los montos no son negativos).
              CASE WHEN COUNT(*) > 0
                   THEN FLOOR(COALESCE(SUM(gross_amount_cents), 0)::numeric / COUNT(*))::bigint
                   ELSE 0 END AS avg_per_visit
         FROM payment_attempts
        WHERE user_id = $1 AND status IN ('succeeded','processed')
          AND created_at >= ${INICIO_DE_MES}`, [req.user.id]
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
    // v2.98.0 · G-09 (Roadmap n77) · gasto del mes por categoría, calculado en
    // el servidor: la torta del front lo arma hoy desde /account/history con
    // limit=100 y trunca con más de 100 pagos. Sólo pagos de la cuenta del
    // bearer. Mismo mes que `month` (inicio de mes en hora de México, sobre la
    // fecha del intento).
    // «Pagado» con la convención de G-34 (/mesas/open): intentos succeeded o
    // processed, menos lo reembolsado en payment_refunds procesados, sin bajar
    // de cero por intento. OJO: `month.spent_cents` de arriba es BRUTO (no
    // resta reembolsos) y no se cambia para no alterar lo que el front ya
    // muestra; con reembolsos, la suma de categorías puede ser menor.
    const categorias = await categoriasPagadas(req.user.id, RANGO_DEL_MES);
    // AB-22 · `?period=` mueve SÓLO `consumption_month`; lo demás sigue mensual.
    const { key: periodo, rango } = periodoDe(req);
    const consumoDelMes = dineroHabilitado()
      ? consumoDesdePagos(periodo === 'this_month' ? categorias : await categoriasPagadas(req.user.id, rango))
      : await consumoDesdeSelecciones(req.user.id, rango);
    res.json({
      period: await periodoPublicado(periodo, rango),
      consumption_month: consumoDelMes,
      category_breakdown: {
        convention: 'net_of_processed_refunds',
        total_cents: categorias.reduce((acc, c) => acc + c.spent_cents, 0),
        categories: categorias,
      },
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
// Seam de test (NODE_ENV=test) para ejercitar el tope sin crear mil mesas.
module.exports.fijarMaxVisitasParaTests = fijarMaxVisitasParaTests;
module.exports.fijarMaxVisitasDelRangoParaTests = fijarMaxVisitasDelRangoParaTests;
