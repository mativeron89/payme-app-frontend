/**
 * routes/consent.js — consentimiento y textos legales (PQ-1 · 1.3)
 *
 * Acta: ops/actas/[PAYME]_ACTA_2026-07-24_GOBIERNO_DATOS_CONSUMO.md.
 *
 * Se monta en dos prefijos:
 *   /api/legal            → lectura PÚBLICA del texto vigente (el front debe
 *                           mostrar siempre la vigente, y la necesita sin sesión).
 *   /api/account/consents → estado / otorgar / revocar (requiere sesión).
 *
 * El router con sesión se monta en el prefijo COMPLETO `/api/account/consents`,
 * no en `/api/account`: montarlo en el prefijo corto hacía que su
 * `use(requireAuth)` corriera TAMBIÉN en cada request a /me, /balance,
 * /movements… — dos verificaciones de sesión y dos queries extra por request,
 * en rutas que no tienen nada que ver con consentimiento.
 */
'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const consent = require('../services/consent');
const legal = require('../services/legal');
const logger = require('../utils/logger');

const publicRouter = express.Router();
const accountRouter = express.Router();

// ═══════════ PÚBLICO: textos legales ═══════════

/** GET /api/legal — qué textos existen y cuál es su versión vigente. */
publicRouter.get('/', async (req, res, next) => {
  try {
    const out = [];
    for (const kind of legal.KINDS) {
      const v = await legal.getVigente(kind);
      out.push({
        kind,
        version: v?.version || null,
        hash: v?.hash || null,
        effective_from: v?.effective_from || null,
      });
    }
    res.json({ legal_texts: out });
  } catch (err) { next(err); }
});

/**
 * GET /api/legal/:kind — el texto VIGENTE, con su versión y hash.
 * El hash que se devuelve acá es el mismo que queda grabado en el
 * consentimiento: así el front puede probar qué mostró.
 */
publicRouter.get('/:kind', async (req, res, next) => {
  try {
    if (!legal.KINDS.includes(req.params.kind)) {
      return res.status(404).json({ error: 'legal_text_not_found' });
    }
    const v = await legal.getVigente(req.params.kind);
    if (!v) return res.status(404).json({ error: 'legal_text_not_published' });
    res.json({
      legal_text: {
        kind: v.kind, version: v.version, hash: v.hash,
        effective_from: v.effective_from, body: v.body,
      },
    });
  } catch (err) { next(err); }
});

/** GET /api/legal/:kind/versions/:version — recupera un texto HISTÓRICO. */
publicRouter.get('/:kind/versions/:version', async (req, res, next) => {
  try {
    const v = await legal.getVersion(req.params.kind, req.params.version);
    if (!v) return res.status(404).json({ error: 'legal_text_not_found' });
    res.json({
      legal_text: {
        kind: v.kind, version: v.version, hash: v.hash,
        effective_from: v.effective_from, effective_to: v.effective_to, body: v.body,
      },
    });
  } catch (err) { next(err); }
});

// ═══════════ CON SESIÓN: consentimientos ═══════════
accountRouter.use(requireAuth);

/** GET /api/account/consents — estado vigente de todas las finalidades. */
accountRouter.get('/', async (req, res, next) => {
  try {
    res.json({ consents: await consent.getAllConsentStates(req.user.id) });
  } catch (err) { next(err); }
});

/** GET /api/account/consents/:purpose */
accountRouter.get('/:purpose', async (req, res, next) => {
  try {
    if (!consent.isPurpose(req.params.purpose)) {
      return res.status(404).json({ error: 'unknown_purpose' });
    }
    res.json({ consent: await consent.getConsentState(req.user.id, req.params.purpose) });
  } catch (err) { next(err); }
});

function datosDelActo(req) {
  return {
    channel: req.body?.channel || 'app',
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    appVersion: req.body?.app_version || req.headers['x-app-version'] || null,
  };
}

/** POST /api/account/consents/:purpose/grant */
accountRouter.post('/:purpose/grant', async (req, res, next) => {
  try {
    if (!consent.isPurpose(req.params.purpose)) {
      return res.status(404).json({ error: 'unknown_purpose' });
    }
    await consent.grantConsent({
      userId: req.user.id, purposeKey: req.params.purpose, ...datosDelActo(req),
    });
    res.status(201).json({ consent: await consent.getConsentState(req.user.id, req.params.purpose) });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message, ...(err.detail && { detail: err.detail }) });
    }
    next(err);
  }
});

/**
 * POST /api/account/consents/:purpose/revoke
 * Efecto inmediato: la lectura siguiente ya lo ve. No hay job intermedio.
 */
accountRouter.post('/:purpose/revoke', async (req, res, next) => {
  try {
    if (!consent.isPurpose(req.params.purpose)) {
      return res.status(404).json({ error: 'unknown_purpose' });
    }
    await consent.revokeConsent({
      userId: req.user.id, purposeKey: req.params.purpose, ...datosDelActo(req),
    });
    logger.audit('consent_revocado', { user_id: req.user.id, purpose_key: req.params.purpose });
    res.json({ consent: await consent.getConsentState(req.user.id, req.params.purpose) });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ error: err.message, ...(err.detail && { detail: err.detail }) });
    }
    next(err);
  }
});

module.exports = { publicRouter, accountRouter };
