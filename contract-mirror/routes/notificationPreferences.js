/**
 * routes/notificationPreferences.js — GET/PUT /api/notifications/preferences (v2.128.0, E1).
 *
 * «Notificaciones» en Configuración, sólo correo (decisiones 33-37 de Mati, 2026-09-24).
 * Se monta EXPLÍCITO en `/api/notifications/preferences`, antes del router de inbox, para
 * no depender del orden de `PATCH /:id/read` y `DELETE /:id` de routes/notifications.js.
 *
 * Contrato owner: contract/notification-preferences-v1.schema.json (espejado al front). Los
 * títulos no viajan: el front traduce por `type`. Respuestas `private, no-store`, sin ETag,
 * con `Vary: Authorization` expuesto, igual que /friends/avatar-notice.
 */
'use strict';

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { validateBody, notificationPreferencesPut } = require('../schemas');
const prefs = require('../services/notificationPreferences');
const legal = require('../services/legal');

const router = express.Router();
router.use(requireAuth);

function privado(res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.vary('Authorization');
  res.setHeader('Access-Control-Expose-Headers', 'Vary, ETag');
}

const CERRADOS = ['notification_preference_not_editable', 'auth_required', 'legal_text_unavailable'];

async function noticeVersion() {
  const v = await legal.getVerifiedCurrent('aviso_privacidad');
  if (!v.status.ready) {
    throw Object.assign(new Error('legal_text_unavailable'), { code: 'legal_text_unavailable', status: 503 });
  }
  return v.vigente.version;
}

function responder(res, body) {
  return res.type('application/json').end(JSON.stringify(body));
}

function manejar(res, next, err) {
  if (CERRADOS.includes(err.code)) {
    return res.status(err.status).type('application/json').end(JSON.stringify({ error: err.code }));
  }
  return next(err);
}

router.get('/', async (req, res, next) => {
  privado(res);
  try {
    return responder(res, await prefs.get(req.user.id, { noticeVersion: await noticeVersion() }));
  } catch (err) { return manejar(res, next, err); }
});

router.put('/', validateBody(notificationPreferencesPut), async (req, res, next) => {
  privado(res);
  try {
    return responder(res, await prefs.put(req.user.id, req.body.items, { noticeVersion: await noticeVersion() }));
  } catch (err) { return manejar(res, next, err); }
});

module.exports = router;
