/**
 * routes/spei-funding.js — CLABE virtual para abono SPEI — v2.9 (PASE3)
 *
 * CORREGIDO (auditoría PASE3 — FINDING C): pasa el `client` de la transacción a
 * crearClabeVirtual para que el nextval('clabe_seq') corra sobre la MISMA
 * conexión (sin abrir otra del pool desde adentro de la tx). Evita el riesgo de
 * agotamiento de pool / deadlock bajo concurrencia.
 *
 * GET /api/wallet/clabe → devuelve la CLABE virtual del usuario; si no tiene,
 * la emite (vía stpAbono.crearClabeVirtual) y la persiste en wallets.clabe.
 *
 * Montaje en server.js:  app.use('/api/wallet', speiFundingRoutes);
 * Repositorio destino: routes/spei-funding.js
 */
'use strict';

const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const stpAbono = require('../services/stpAbono');
const logger = require('../utils/logger');

const router = express.Router();

router.get('/clabe', requireAuth, async (req, res, next) => {
  try {
    const result = await pool.tx(async (client) => {
      // asegurar wallet + lock (evita doble emisión de CLABE en carrera)
      let { rows } = await client.query(
        `SELECT id, clabe FROM wallets WHERE user_id = $1 FOR UPDATE`, [req.user.id]
      );
      let wallet = rows[0];
      if (!wallet) {
        ({ rows } = await client.query(
          `INSERT INTO wallets (user_id, balance_cents) VALUES ($1, 0)
           ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
           RETURNING id, clabe`, [req.user.id]
        ));
        wallet = rows[0];
      }
      if (wallet.clabe) return { clabe: wallet.clabe, issued: false };

      // FINDING C: pasamos el client de la tx (nextval sobre la misma conexión)
      const clabe = await stpAbono.crearClabeVirtual({ userId: req.user.id, client });
      await client.query(
        `UPDATE wallets SET clabe = $2, updated_at = NOW() WHERE id = $1`,
        [wallet.id, clabe]
      );
      return { clabe, issued: true };
    });

    if (result.issued) {
      logger.audit('wallet_clabe_issued', { user_id: req.user.id, clabe: result.clabe });
    }
    res.json({
      clabe: result.clabe,
      banco: 'STP',
      beneficiario: 'PayMe',
      instrucciones: 'Transferí por SPEI a esta CLABE desde tu banco; el saldo se acredita solo.',
    });
  } catch (err) { next(err); }
});

module.exports = router;
