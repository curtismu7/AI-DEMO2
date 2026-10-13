'use strict';

const express = require('express');
const configStore = require('../services/configStore');
const { getFrontendOrigin } = require('../services/oauthRedirectUris');
const aicDemo = require('../services/aicDemoService');

const PAGE_PATH = '/aic-token-exchange';

function requireApplicationSession(req, res, next) {
  if (!req.session?.oauthTokens?.accessToken) return res.status(401).json({ error: 'application_session_required' });
  return next();
}

function saveSession(req, callback) {
  if (typeof req.session?.save !== 'function') return callback();
  req.session.save((error) => callback(error));
}

function errorCode(error, fallback) {
  return /^[A-Z0-9_]+$/.test(String(error?.code || '')) ? error.code : fallback;
}

function createAicDemoRouter({ configStore: store = configStore, fetchImpl = fetch } = {}) {
  const router = express.Router();

  // Safe metadata only: redacted traces and who signed in — never a token, code or secret.
  router.get('/status', (req, res) => {
    const demo = req.session?.aicDemo || {};
    const config = aicDemo.resolveConfig(store);
    res.set('Cache-Control', 'no-store');
    res.json({
      features: aicDemo.featureStatus(store),
      issuer: config.issuer || null,
      subjectClientId: config.subjectClientId || null,
      actorClientId: config.actorClientId || null,
      delegatedScope: config.delegatedScope || null,
      redirectUri: config.redirectUri,
      userSignedIn: aicDemo.usable(demo.userTokens),
      actorReady: aicDemo.usable(demo.actorTokens),
      userResult: demo.userResult || null,
      actorResult: demo.actorResult || null,
      lastError: demo.lastError || null,
    });
  });

  router.get('/login/start', requireApplicationSession, async (req, res) => {
    try {
      const { redirectUrl } = await aicDemo.beginLogin(req, { store, fetchImpl });
      return saveSession(req, () => res.redirect(302, redirectUrl));
    } catch (error) {
      return res.status(error.httpStatus || 502).json({ error: errorCode(error, 'AIC_LOGIN_START_FAILED'), message: error.message });
    }
  });

  // No auth guard: this is a bare browser redirect back from AIC; the pending entry in the session is the guard.
  router.get('/callback', async (req, res) => {
    const back = (status) => res.redirect(`${getFrontendOrigin()}${PAGE_PATH}?aic=${status}`);
    try {
      await aicDemo.completeLogin(req, { store, fetchImpl });
      if (req.session?.aicDemo) delete req.session.aicDemo.lastError;
      return saveSession(req, (error) => back(error ? 'error' : 'success'));
    } catch (error) {
      // AIC's own error text (never a token) so the page can say which client setting is wrong.
      if (req.session) {
        req.session.aicDemo ||= {};
        req.session.aicDemo.lastError = { code: errorCode(error, 'AIC_LOGIN_FAILED'), message: error.message };
      }
      return saveSession(req, () => back('error'));
    }
  });

  router.post('/actor-token', requireApplicationSession, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const actorResult = await aicDemo.fetchActorToken(req, { store, fetchImpl });
      return saveSession(req, (error) => (error
        ? res.status(500).json({ error: 'AIC_SESSION_SAVE_FAILED' })
        : res.json({ actorResult })));
    } catch (error) {
      return res.status(error.httpStatus || 502).json({ error: errorCode(error, 'AIC_ACTOR_TOKEN_FAILED'), message: error.message });
    }
  });

  return router;
}

module.exports = createAicDemoRouter();
module.exports.createAicDemoRouter = createAicDemoRouter;
