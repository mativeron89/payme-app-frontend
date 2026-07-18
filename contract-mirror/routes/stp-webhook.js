/**
 * routes/stp-webhook.js — Callback de abono SPEI de STP — v2.8
 *
 * POST /webhooks/stp/abono → STP notifica un SPEI entrante a una CLABE virtual.
 * Valida, acredita la wallet (idempotente) y responde el ack que STP espera.
 *
 * Montaje en server.js (junto al webhook de Stripe, ANTES del express.json global,
 * SIN rate limit, SIN auth de usuario):
 *     app.use('/webhooks/stp', stpWebhookRoutes);
 *
 * ⚠️ Seguridad: además del secreto opcional (STP_ABONO_SECRET), restringí por
 *    allowlist de IP de STP a nivel infra. Confirmá el formato del payload y del
 *    ack con el manual de STP. Probar en DEMO.
 *
 * Repositorio destino: routes/stp-webhook.js
 */
'use strict';

const express = require('express');
const stpAbono = require('../services/stpAbono');
const walletFunding = require('../services/walletFunding');
const logger = require('../utils/logger');

const router = express.Router();

// STP envía JSON; el express.json global se monta DESPUÉS de los webhooks,
// así que parseamos a nivel de ruta.
router.use(express.json({ limit: '256kb' }));

router.post('/abono', async (req, res) => {
  let parsed;
  try {
    parsed = stpAbono.validateAbono(req.body, req.headers);
  } catch (err) {
    logger.warn('stp_abono_invalid', { error: err.message });
    const code = err.message === 'stp_abono_unauthorized' ? 401 : 400;
    return res.status(code).json(stpAbono.buildAbonoAck(req.body, { ok: false }));
  }

  try {
    const result = await walletFunding.creditWalletFromSpei(parsed);

    if (result.status === 'wallet_not_found') {
      // la plata ya se movió en STP: ACK igual y dejar para revisión/devolución manual
      logger.error('stp_abono_wallet_not_found', {
        clabe: parsed.clabeDestino, clave_rastreo: parsed.claveRastreo, amount_cents: parsed.amountCents,
      });
    } else if (result.status === 'duplicate') {
      logger.info('stp_abono_duplicate', { clave_rastreo: parsed.claveRastreo });
    } else {
      logger.audit('stp_abono_credited', {
        clave_rastreo: parsed.claveRastreo, amount_cents: parsed.amountCents, user_id: result.userId,
      });
    }
    return res.json(stpAbono.buildAbonoAck(req.body, { ok: true }));
  } catch (err) {
    logger.error('stp_abono_handler_error', { error: err.message, clave_rastreo: parsed?.claveRastreo });
    // 500 → STP reintenta el callback (la idempotencia evita doble crédito)
    return res.status(500).json(stpAbono.buildAbonoAck(req.body, { ok: false }));
  }
});

module.exports = router;
