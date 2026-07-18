/**
 * routes/config.js v2.5.2
 */
'use strict';
const express = require('express');
const router = express.Router();

router.get('/stripe-key', (req, res) => {
  res.json({ publishable_key: process.env.STRIPE_PUBLISHABLE_KEY });
});

router.get('/', (req, res) => {
  res.json({
    version: '2.5.2',
    currency: 'mxn',
    stripe_publishable_key: process.env.STRIPE_PUBLISHABLE_KEY,
    mesa_hold_seconds: Number(process.env.MESA_HOLD_SECONDS) || 1800,
    payment_hold_seconds: Number(process.env.PAYMENT_HOLD_SECONDS) || 420,
    invitation_expiry_seconds: Number(process.env.INVITATION_EXPIRY_SECONDS) || 86400,
    item_lock_seconds: Number(process.env.ITEM_LOCK_SECONDS) || 600,
    features: {
      apple_pay: true,
      google_pay: true,
      stp_dispersal: process.env.NODE_ENV === 'production',
      ocr_real: process.env.OCR_FEATURE_FLAG === 'real',
    },
  });
});

module.exports = router;
