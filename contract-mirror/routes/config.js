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
const { walletRailCapability } = require('../services/walletRail');
const { modoMonetarioCapability } = require('../services/moneyRail');
const { ocrCapability } = require('../services/ocrRail');
const { PROFILE_IDENTITY_CAPABILITY } = require('../services/profileIdentity');
const {
  SETTLEMENT_SHORTFALL_DETAIL_CAPABILITY,
} = require('../services/shortfallDetails');
const { version } = require('../package.json');
const router = express.Router();

/**
 * OLA 5 · capability de wallet. Ratificada 2026-08-02/03: el riel wallet sale
 * completo del MVP.
 *
 * Hasta acá el apagado lo decidía el FRONT con una constante propia, así que un
 * deploy suyo con otro valor lo reencendía sin que el backend se enterara. La
 * constitución manda lo contrario: la capability es global y autoritativa del
 * backend, y el front no la decide ni la hardcodea. Esto es esa capability.
 *
 * `enabled` es una CONSTANTE, no una bandera. No se lee de `process.env`, ni del
 * usuario, ni del restaurante ni de la sucursal: no existe permiso por cuenta,
 * rol ni entorno que la mueva. Reactivar exige IFPE vigente, auditoría y una
 * ratificación nueva de Mati — una orden, jamás una variable de entorno.
 *
 * `account_activity` está acá A PROPÓSITO y separado: `/api/account/history` y
 * `/api/account/stats` leen `payment_attempts`, NO tablas de wallet, y la
 * ratificación manda conservarlas. Publicarlo aparte es lo que impide que un
 * consumidor las vuelva a gatear con la bandera de wallet — que es exactamente
 * lo que pasó en el front en `07f0ba2` y escondió superficie card-only.
 *
 * Ausencia de la clave = backend previo a OLA 5. El consumidor debe leerla como
 * APAGADO: acá el fail-closed cae del lado seguro y no hace falta un booleano
 * `supported` como en `account_birth_date`.
 */
const WALLET_RAIL = Object.freeze({
  // P0 · ORDEN 1 · NO es un literal: sale de `services/walletRail`, que es la
  // única fuente autoritativa. Antes eran DOS fuentes —un `false` acá y una
  // bandera allá— y podían describir estados opuestos: la capability decía
  // apagado mientras el runtime aceptaba operaciones wallet.
  enabled: walletRailCapability(),
  account_activity: true,
});
const googleIdentity = require('../services/googleIdentity');
const facebookIdentity = require('../services/facebookIdentity');
const authRecovery = require('../services/authRecovery');

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
      // ⚠️ `ocr_real` se CONSERVA con su valor de siempre: es contrato vigente y
      // el front lo lee. Lo que NO hace es lo que su nombre sugiere — publica
      // el FLAG, no que el OCR funcione.
      ocr_real: ocrCapability().mode === 'real',
      // 🔴 Lo aditivo y honesto. `credentials_present` dice exactamente lo que
      // mide: que las tres variables de AWS están definidas. NO acredita que la
      // clave sirva, que el rol tenga permiso de Textract, que la región sea la
      // correcta ni que haya salida a internet — eso sólo lo prueba un escaneo.
      // Prometer más sería la misma mentira por omisión que un `/ready` que
      // sólo mira que el proceso esté vivo.
      ocr: ocrCapability(),
      // OLA 5 · ver WALLET_RAIL arriba. Constante, no bandera.
      wallet_rail: WALLET_RAIL,
      // D-FF-2 (2026-08-10) · modo monetario global. Sale de
      // services/moneyRail.js, que es una CONSTANTE del código y no una
      // bandera de entorno: el front LEE esto, no lo decide ni lo hardcodea.
      // Cubre TODO el dinero (tarjeta incluida), no sólo wallet.
      money_rail: modoMonetarioCapability(),
      social_auth: {
        google_sign_in: googleIdentity.capability(),
        facebook_sign_in: facebookIdentity.capability(),
        recovery_email: {
          ...authRecovery.capability(),
          completion_route: authRecovery.capability().enabled ? '#/recovery' : null,
        },
        password_login: { enabled: true },
      },
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
      // Implementación owner-first activada con aviso 2.3.0 ratificado.
      // El payme_id sigue inmutable y el avatar nunca tiene URL pública.
      profile_identity: PROFILE_IDENTITY_CAPABILITY,
      // Activo y owner-only bajo aviso 2.3.0. Las identidades no canónicas se
      // mantienen en el residual sin asignar; nunca se infieren nombres.
      settlement_shortfall_detail: SETTLEMENT_SHORTFALL_DETAIL_CAPABILITY,
    },
  });
});

module.exports = router;
