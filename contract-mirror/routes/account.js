/**
 * routes/account.js — Saldo, movimientos, historial, stats
 *
 * FIX m6: limit validado con Zod (no Number manual).
 * Incluye /wallet-transactions unificado (B3).
 */
'use strict';

const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const {
  movementsQuery, historyQuery, walletTxQuery, updateMe, uuidIdParam,
  validateQuery, validateBody, validateParams,
} = require('../schemas');
const { centsToDisplay } = require('../utils/money');
const logger = require('../utils/logger');
const consent = require('../services/consent');

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
async function perfilPropio(userId) {
  const { rows } = await pool.query(
    `SELECT id, payme_id, email, first_name, last_name, phone,
            to_char(birth_date, 'YYYY-MM-DD') AS birth_date, created_at
       FROM users WHERE id = $1`,
    [userId]
  );
  if (!rows[0]) return null;
  return {
    ...rows[0],
    // Pedido explícito del front (GAPS.md G-13): saber SI hay fecha sin tener
    // que leer la fecha. Es el campo que debería alcanzarle para decidir si
    // pregunta o no; `birth_date` crudo se mantiene por compatibilidad.
    birth_date_set: rows[0].birth_date !== null,
    // D-11: el veredicto de mayoría de edad lo da el BACKEND. Si el front
    // calculara la edad desde la fecha cruda repetiría el bug de husos que ya
    // nos pasó una vez (con TZ al este de México, un menor pasaba por mayor).
    is_adult: await consent.edadConocida(userId),
  };
}

router.get('/me', async (req, res, next) => {
  try {
    const user = await perfilPropio(req.user.id);
    if (!user) return res.status(404).json({ error: 'user_not_found' });
    res.json({ user });
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
    res.json({ user });
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
