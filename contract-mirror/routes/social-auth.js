/** Superficie owner-first para Google dark y recovery PayMe por email. */
'use strict';

const express = require('express');
const schemas = require('../schemas');
const { requireAuth } = require('../middleware/auth');
const google = require('../services/googleIdentity');
const facebook = require('../services/facebookIdentity');
const facebookDataRights = require('../services/facebookDataRights');
const recovery = require('../services/authRecovery');
const identities = require('../services/externalIdentities');
const legal = require('../services/legal');
const logger = require('../utils/logger');
const pool = require('../db/pool');
const { signupRateLimitMiddleware } = require('../services/signupRateLimit');

const router = express.Router();
const { validateBody } = schemas;
const socialSignupRateLimit = signupRateLimitMiddleware({ db: pool });

function googleDark(action) {
  return (req, res, next) => {
    if (google.capability()[action] !== true) {
      return res.status(404).json({ error: 'not_found' });
    }
    return next();
  };
}

function recoveryRequestDark(req, res, next) {
  if (!recovery.capability().enabled) return res.status(404).json({ error: 'not_found' });
  return next();
}

function facebookDark(purpose) {
  return (req, res, next) => {
    const current = facebook.capability();
    const enabled = purpose === 'register' ? current.registration : current.login;
    if (!enabled) return res.status(404).json({ error: 'not_found' });
    return next();
  };
}

function facebookCallbacksDark(req, res, next) {
  if (!facebook.callbacksCapability().enabled) {
    return res.status(404).json({ error: 'not_found' });
  }
  return next();
}

async function requirePrivacyNotice(req, res, next) {
  try {
    const status = await legal.getRequiredPublicationStatus();
    if (!status.ready) return res.status(503).json({ error: 'registration_unavailable' });
    return next();
  } catch (error) {
    logger.error('social_registration_legal_check_failed', {
      code: error.code, correlation_id: req.correlationId,
    });
    return res.status(503).json({ error: 'registration_unavailable' });
  }
}

function socialError(res, error, registration = false) {
  if (registration) {
    if (error.code === 'social_auth_temporarily_unavailable') {
      return res.status(503).json({ error: 'registration_not_available' });
    }
    if (error.status < 500 || error.code?.startsWith('social_')) {
      return res.status(403).json({ error: 'registration_not_available' });
    }
  }
  if (error.code === 'social_auth_temporarily_unavailable') {
    return res.status(503).json({ error: 'social_auth_failed' });
  }
  if (error.code === 'reauthentication_failed') {
    return res.status(403).json({ error: 'reauthentication_failed' });
  }
  if (error.code === 'social_auth_failed' || error.code === 'social_auth_not_available') {
    return res.status(401).json({ error: 'social_auth_failed' });
  }
  return null;
}

router.post('/google/register', googleDark('registration'), socialSignupRateLimit, requirePrivacyNotice,
  validateBody(schemas.socialRegisterSchema()), async (req, res, next) => {
    try {
      const evidence = await google.verifyIdToken(req.body.id_token);
      const response = await identities.registerWithExternalIdentity({
        invitationToken: req.body.invitation_token,
        evidence,
        firstName: req.body.first_name,
        lastName: req.body.last_name,
        birthDate: req.body.birth_date,
      });
      logger.audit('user_registered_external', { user_id: response.user.id, provider: 'google' });
      return res.status(201).json(response);
    } catch (error) {
      return socialError(res, error, true) || next(error);
    }
  });

router.post('/google/login', googleDark('login'), validateBody(schemas.socialLogin), async (req, res, next) => {
  try {
    const evidence = await google.verifyIdToken(req.body.id_token);
    const response = await identities.loginWithExternalIdentity(evidence);
    logger.audit('user_login_external', { user_id: response.user.id, provider: 'google' });
    return res.json(response);
  } catch (error) {
    return socialError(res, error) || next(error);
  }
});

router.post('/google/link', googleDark('linking'), requireAuth,
  validateBody(schemas.socialLink), async (req, res, next) => {
    try {
      const evidence = await google.verifyIdToken(req.body.id_token);
      const response = await identities.linkExternalIdentity({
        userId: req.user.id,
        currentPassword: req.body.current_password,
        evidence,
      });
      logger.audit('external_identity_linked', { user_id: req.user.id, provider: 'google' });
      return res.json(response);
    } catch (error) {
      return socialError(res, error) || next(error);
    }
  });

router.post('/facebook/register/start', facebookDark('register'), socialSignupRateLimit,
  requirePrivacyNotice,
  validateBody(schemas.facebookRegisterStartSchema()), async (req, res, next) => {
    try {
      const response = await facebook.startAuthorization('register', {
        registration: {
          invitationToken: req.body.invitation_token,
          firstName: req.body.first_name,
          lastName: req.body.last_name,
          birthDate: req.body.birth_date,
        },
      });
      return res.json(response);
    } catch (error) {
      return socialError(res, error, true) || next(error);
    }
  });

router.post('/facebook/register/complete', facebookDark('register'), requirePrivacyNotice,
  validateBody(schemas.facebookComplete), async (req, res, next) => {
    try {
      const completed = await facebook.completeAuthorization('register', req.body);
      if (!completed.registration) {
        return res.status(403).json({ error: 'registration_not_available' });
      }
      if (schemas.birthDateRequeridaEnRegistro() && !completed.registration.birthDate) {
        return res.status(403).json({ error: 'registration_not_available' });
      }
      const response = await identities.registerWithExternalIdentity({
        invitationTokenHash: completed.registration.invitationTokenHash,
        evidence: completed.evidence,
        firstName: completed.registration.firstName,
        lastName: completed.registration.lastName,
        birthDate: completed.registration.birthDate,
      });
      logger.audit('user_registered_external', { user_id: response.user.id, provider: 'facebook' });
      return res.status(201).json(response);
    } catch (error) {
      return socialError(res, error, true) || next(error);
    }
  });

router.post('/facebook/login/start', facebookDark('login'),
  validateBody(schemas.facebookLoginStart), async (req, res, next) => {
    try {
      return res.json(await facebook.startAuthorization('login'));
    } catch (error) {
      return socialError(res, error) || next(error);
    }
  });

router.post('/facebook/login/complete', facebookDark('login'),
  validateBody(schemas.facebookComplete), async (req, res, next) => {
    try {
      const completed = await facebook.completeAuthorization('login', req.body);
      const response = await identities.loginWithExternalIdentity(completed.evidence);
      logger.audit('user_login_external', { user_id: response.user.id, provider: 'facebook' });
      return res.json(response);
    } catch (error) {
      return socialError(res, error) || next(error);
    }
  });

const facebookForm = express.urlencoded({ extended: false, limit: '16kb' });
router.post('/facebook/deauthorize', facebookCallbacksDark, facebookForm,
  validateBody(schemas.facebookSignedRequest), async (req, res, next) => {
    try {
      const result = await facebookDataRights.deauthorize(req.body.signed_request);
      if (result.userId) {
        logger.audit('facebook_deauthorized', { user_id: result.userId });
      }
      return res.json({ accepted: true });
    } catch (error) {
      return next(error);
    }
  });

router.post('/facebook/data-deletion', facebookCallbacksDark, facebookForm,
  validateBody(schemas.facebookSignedRequest), async (req, res, next) => {
    try {
      const result = await facebookDataRights.requestDataDeletion(req.body.signed_request);
      if (result.userId) {
        logger.audit('facebook_data_deletion_requested', { user_id: result.userId });
      }
      return res.json({
        url: result.url,
        confirmation_code: result.confirmation_code,
      });
    } catch (error) {
      return next(error);
    }
  });

router.get('/facebook/data-deletion/status/:confirmation_code', async (req, res, next) => {
    try {
      return res.json(await facebookDataRights.deletionStatus(req.params.confirmation_code));
    } catch (error) {
      return next(error);
    }
  });

router.post('/recovery/request', recoveryRequestDark,
  validateBody(schemas.recoveryRequest), async (req, res, next) => {
    try {
      return res.status(202).json(await recovery.requestRecovery(req.body.email));
    } catch (error) {
      if (error.code === 'recovery_not_available') {
        return res.status(404).json({ error: 'not_found' });
      }
      return next(error);
    }
  });

router.post('/recovery/complete', validateBody(schemas.recoveryComplete), async (req, res, next) => {
  try {
    return res.json(await recovery.completeRecovery(req.body.token, req.body.new_password));
  } catch (error) {
    if (error.code === 'recovery_not_available') {
      return res.status(403).json({ error: 'recovery_not_available' });
    }
    return next(error);
  }
});

module.exports = router;
