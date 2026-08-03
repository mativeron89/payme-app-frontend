/**
 * routes/config.js v2.5.2
 *
 * v2.28 · capability de PQ-2. El front necesita saber QUÉ soporta este backend
 * antes de mandar `birth_date`, y hoy no tiene cómo:
 *   · `version` se toma del package para no quedar congelada en un literal.
 *   · La ausencia de la clave es indistinguible de un backend viejo SOLO si se
 *     chequea por presencia, que es frágil de tipar.
 * Por eso la capability es explícita y booleana. Ver
 * docs/AUDITORIA_ROLLOUT_PQ2_2026-07-30.md.
 */
'use strict';
const express = require('express');
const { birthDateRequeridaEnRegistro } = require('../schemas');
const { stpRestaurantDispersalReady } = require('../middleware/envValidation');
const { version } = require('../package.json');
const router = express.Router();

router.get('/stripe-key', (req, res) => {
  res.json({ publishable_key: process.env.STRIPE_PUBLISHABLE_KEY });
});

router.get('/', (req, res) => {
  res.json({
    version,
    currency: 'mxn',
    stripe_publishable_key: process.env.STRIPE_PUBLISHABLE_KEY,
    mesa_hold_seconds: Number(process.env.MESA_HOLD_SECONDS) || 1800,
    payment_hold_seconds: Number(process.env.PAYMENT_HOLD_SECONDS) || 420,
    invitation_expiry_seconds: Number(process.env.INVITATION_EXPIRY_SECONDS) || 86400,
    item_lock_seconds: Number(process.env.ITEM_LOCK_SECONDS) || 600,
    features: {
      // Los enums existen, pero hoy no hay Express Checkout/Payment Request
      // real ni prueba de dispositivo. Publicar true hacía que un consumidor
      // creyera disponible una integración inexistente.
      apple_pay: false,
      google_pay: false,
      // Sólo describe la capacidad de dispersar settlement al restaurante;
      // nunca es un gate de wallet/IFPE ni habilita endpoints de saldo.
      stp_dispersal: stpRestaurantDispersalReady(),
      ocr_real: process.env.OCR_FEATURE_FLAG === 'real',
      // PQ-2 (v2.28). Cuatro booleanos, cada uno con una decisión del front detrás:
      //   supported  → ¿existe el campo? Un backend ≤ v2.27 no manda esta clave.
      //                Es explícito y no por presencia para que el front pueda
      //                chequear un booleano en vez de un `undefined`, y para que
      //                apagarlo no exija borrar la clave.
      //   registration_required → LO ÚNICO que cambia entre compatibilidad y
      //                estado final. Es la señal del gate de rollout: mientras
      //                sea false, mandar la fecha es seguro y NO mandarla también.
      //   write_once → se declara una vez; una fecha distinta después da 409.
      //                El front usa esto para decidir si ofrece editarla.
      //   adulthood_server_authoritative → hay `is_adult` en /account/me y el
      //                front NO debe calcular la edad. No es decorativo: el front
      //                calculando la edad es exactamente el bug de husos de D-11.
      account_birth_date: {
        supported: true,
        registration_required: birthDateRequeridaEnRegistro(),
        write_once: true,
        adulthood_server_authoritative: true,
      },
    },
  });
});

module.exports = router;
