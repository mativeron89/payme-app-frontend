/**
 * routes/joinRequests.js — el lado de quien pide unirse con el código de una mesa (v2.166.0,
 * decisión 219). El lado del titular vive en routes/mesas.js (`/:code/join-requests`).
 *
 *   POST /api/join-requests             { code }  → 201 pedido | 200 ya pendiente o ya en la mesa
 *   GET  /api/join-requests/:id                    → estado del pedido propio
 *   POST /api/join-requests/:id/cancel             → retirarlo mientras esté pendiente
 *
 * La lógica y las respuestas están en services/joinRequests.js.
 */
'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');
const { uuidIdParam, validateParams } = require('../schemas');
const joinRequests = require('../services/joinRequests');

const router = express.Router();
router.use(requireAuth);

/**
 * Tope EN MEMORIA por cuenta: 5 intentos por hora, cuenten o no (un código equivocado también
 * suma y no se guarda en ningún lado). El tope durable de 5 pedidos creados por hora lo cuenta el
 * servicio en la base. Constantes y no variables de entorno: la orden no admite variables nuevas.
 */
const pedirLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: joinRequests.TOPE_POR_HORA,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `join:${req.user.id}`,
  handler: (req, res) => res.status(429).json({ error: 'join_requests_rate_limited' }),
});

const escribir = (res, { status, body }) => res.status(status).json(body);

router.post('/', pedirLimiter, async (req, res, next) => {
  try {
    escribir(res, await joinRequests.pedir(req.user.id, req.body?.code));
  } catch (err) { next(err); }
});

router.get('/:id', validateParams(uuidIdParam), async (req, res, next) => {
  try {
    escribir(res, await joinRequests.estado(req.user.id, req.params.id));
  } catch (err) { next(err); }
});

router.post('/:id/cancel', validateParams(uuidIdParam), async (req, res, next) => {
  try {
    escribir(res, await joinRequests.cancelar(req.user.id, req.params.id));
  } catch (err) { next(err); }
});

module.exports = router;
