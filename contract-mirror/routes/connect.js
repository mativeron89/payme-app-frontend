/**
 * routes/connect.js — Onboarding de cuentas conectadas de Stripe (v2.22)
 *
 * Fase 1 del pivote (acta 2026-07-24). Se monta en /api/restaurants, junto a
 * routes/restaurants.js (GET '/' y '/:id') y routes/staff.js ('/:rid/staff…'):
 * los paths son disjuntos ('/:rid/connect/…').
 *
 * NO mueve dinero. Habilita que un restaurante tenga cuenta conectada y expone
 * su estado; el gate de cobro (Fase 2) leerá `stripe_account_status='active'`.
 *
 * Autorización: las rutas de escritura y de lectura de estado exigen manager u
 * owner del restaurante (mismo criterio que routes/staff.js). Las dos rutas de
 * retorno del flujo hosted (`/refresh` y `/return`) las visita el navegador del
 * restaurante SIN sesión nuestra, así que van firmadas con un token de un solo
 * propósito y vida corta — sin él, cualquiera podría generar links de
 * onboarding para un restaurante ajeno.
 */
'use strict';

const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const connect = require('../services/connect');
const logger = require('../utils/logger');

const router = express.Router();

const LINK_TOKEN_TTL = '30m';         // una sesión de KYC entra de sobra
const LINK_TOKEN_AUD = 'connect-onboarding';

function signLinkToken(restaurantId) {
  return jwt.sign({ rid: restaurantId }, process.env.JWT_SECRET, {
    audience: LINK_TOKEN_AUD, expiresIn: LINK_TOKEN_TTL,
  });
}

function verifyLinkToken(token, restaurantId) {
  try {
    const p = jwt.verify(token, process.env.JWT_SECRET, { audience: LINK_TOKEN_AUD });
    return p.rid === restaurantId;
  } catch (_) { return false; }
}

function baseUrl(req) {
  return (process.env.API_PUBLIC_URL || `${req.protocol}://${req.get('host')}`)
    .replace(/\/+$/, '');
}

async function loadRestaurant(rid) {
  const { rows } = await pool.query(
    `SELECT id, name, address, status, stripe_account_id, stripe_account_status,
            stripe_charges_enabled, stripe_payouts_enabled, stripe_card_payments_status,
            stripe_requirements, stripe_fees_payer, stripe_onboarded_at,
            stripe_account_synced_at
       FROM restaurants WHERE id = $1`,
    [rid]
  );
  return rows[0] || null;
}

/** manager/owner activo del restaurante (mismo guard que routes/staff.js). */
async function requireManager(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT 1 FROM restaurant_staff
        WHERE restaurant_id = $1 AND user_id = $2
          AND role IN ('manager','owner') AND status = 'active'`,
      [req.params.rid, req.user.id]
    );
    if (rows.length === 0) return res.status(403).json({ error: 'not_restaurant_manager' });
    next();
  } catch (err) { next(err); }
}

// ─── GET /:rid/connect/status — estado de la cuenta conectada ───────────────
router.get('/:rid/connect/status', requireAuth, requireManager, async (req, res, next) => {
  try {
    const r = await loadRestaurant(req.params.rid);
    if (!r) return res.status(404).json({ error: 'restaurant_not_found' });
    res.json({ connect: connect.publicState(r) });
  } catch (err) { next(err); }
});

// ─── POST /:rid/connect/account — crear la cuenta conectada ─────────────────
router.post('/:rid/connect/account', requireAuth, requireManager, async (req, res, next) => {
  try {
    const r = await loadRestaurant(req.params.rid);
    if (!r) return res.status(404).json({ error: 'restaurant_not_found' });
    if (r.status !== 'active') return res.status(409).json({ error: 'restaurant_not_active' });
    // Una cuenta desautorizada (el restaurante desconectó su Stripe) queda
    // clavada en la fila: sin este guard, la ruta respondía 200 {created:false}
    // como si estuviera todo bien. Re-onboardear exige intervención manual a
    // propósito — no se crea otra cuenta sola.
    if (r.stripe_account_status === 'disabled') {
      return res.status(409).json({
        error: 'connect_account_disabled',
        message: 'La cuenta conectada fue desautorizada o rechazada. Requiere revisión manual.',
      });
    }

    // El modo de comisiones NO se acepta por request: es política de PayMe
    // (decisión de Mati 2026-07-24) y Stripe lo congela al crear la cuenta.
    const { created, accountId } = await connect.createConnectedAccount({
      restaurant: r, feesPayer: 'account',
    });

    const fresh = await loadRestaurant(req.params.rid);
    res.status(created ? 201 : 200).json({
      created, connect: connect.publicState(fresh || { ...r, stripe_account_id: accountId }),
    });
  } catch (err) { next(err); }
});

// ─── POST /:rid/connect/onboarding-link — link hosted de KYC ────────────────
router.post('/:rid/connect/onboarding-link', requireAuth, requireManager, async (req, res, next) => {
  try {
    const r = await loadRestaurant(req.params.rid);
    if (!r) return res.status(404).json({ error: 'restaurant_not_found' });
    if (!r.stripe_account_id) return res.status(409).json({ error: 'connect_account_missing' });
    if (r.stripe_account_status === 'disabled') {
      return res.status(409).json({ error: 'connect_account_disabled' });
    }

    const t = signLinkToken(r.id);
    const base = baseUrl(req);
    const link = await connect.createOnboardingLink({
      accountId: r.stripe_account_id,
      refreshUrl: `${base}/api/restaurants/${r.id}/connect/refresh?t=${t}`,
      returnUrl: `${base}/api/restaurants/${r.id}/connect/return?t=${t}`,
    });

    logger.audit('connect_onboarding_link_created', {
      restaurant_id: r.id, account_id: r.stripe_account_id, by: req.user.id,
    });
    // Vive ~5 minutos y es de un solo uso: hay que abrirlo YA y no compartirlo
    // (un preview de chat lo quema).
    res.json({ url: link.url, expires_at: link.expires_at, single_use: true });
  } catch (err) { next(err); }
});

// ─── GET /:rid/connect/refresh — Stripe manda acá si el link venció ─────────
// No es una página de error: hay que generar un link nuevo y redirigir.
router.get('/:rid/connect/refresh', async (req, res, next) => {
  try {
    if (!verifyLinkToken(req.query.t, req.params.rid)) {
      return res.status(401).json({ error: 'invalid_onboarding_token' });
    }
    const r = await loadRestaurant(req.params.rid);
    if (!r?.stripe_account_id) return res.status(404).json({ error: 'connect_account_missing' });

    // Token NUEVO en cada refresh: reinyectar el original hacía que el flujo
    // muriera con un 401 seco a los 30 minutos, justo cuando el restaurante
    // está a mitad del KYC y Stripe lo manda acá a reintentar.
    const t = signLinkToken(req.params.rid);
    const base = baseUrl(req);
    const link = await connect.createOnboardingLink({
      accountId: r.stripe_account_id,
      refreshUrl: `${base}/api/restaurants/${r.id}/connect/refresh?t=${t}`,
      returnUrl: `${base}/api/restaurants/${r.id}/connect/return?t=${t}`,
    });
    res.redirect(302, link.url);
  } catch (err) { next(err); }
});

// ─── GET /:rid/connect/return — Stripe manda acá al terminar el flujo ───────
// OJO: "terminó el flujo" NO significa "quedó habilitada". Hay que releer la
// cuenta por API (y escuchar account.updated) antes de afirmar nada.
router.get('/:rid/connect/return', async (req, res, next) => {
  try {
    if (!verifyLinkToken(req.query.t, req.params.rid)) {
      return res.status(401).json({ error: 'invalid_onboarding_token' });
    }
    const r = await loadRestaurant(req.params.rid);
    if (!r?.stripe_account_id) return res.status(404).json({ error: 'connect_account_missing' });

    let fresh = null;
    try {
      fresh = await connect.syncAccount(r.id, r.stripe_account_id);
    } catch (e) {
      logger.warn('connect_return_sync_failed', { restaurant_id: r.id, error: e.message });
    }
    const state = connect.publicState(fresh || r);

    const dest = process.env.CONNECT_RETURN_REDIRECT_URL;
    if (dest) {
      const sep = dest.includes('?') ? '&' : '?';
      return res.redirect(302, `${dest}${sep}restaurant_id=${r.id}&status=${state.status}`);
    }
    res.json({ connect: state });
  } catch (err) { next(err); }
});

module.exports = router;
