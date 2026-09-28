'use strict';

const express = require('express');
const configStore = require('../services/configStore');
const { getFrontendOrigin } = require('../services/oauthRedirectUris');
const {
  getFeatureStatus,
  resolveCimdConfig,
} = require('../services/pfAiAgentFeatureConfig');
const { metadataDocument, beginCimd, completeCimd } = require('../services/pfAiAgentCimdService');
const { exchangeForThirdPartyAccessToken } = require('../services/pfAiAgentCrossDomainExchangeService');
const { beginRar, completeRar } = require('../services/pfAiAgentRarService');

function sessionProvider(req) {
  return String(req.session?.oauthProvider || req.session?.user?.oauthProvider || '').toLowerCase();
}

function requireApplicationSession(req, res, next) {
  if (!req.session?.oauthTokens?.accessToken || !['pingone', 'pingfederate'].includes(sessionProvider(req))) {
    return res.status(401).json({ error: 'application_session_required' });
  }
  return next();
}

function saveSession(req, callback) {
  if (typeof req.session?.save !== 'function') return callback();
  req.session.save((error) => callback(error));
}

function errorCode(error, fallback) {
  return /^[A-Z0-9_]+$/.test(String(error?.code || '')) ? error.code : fallback;
}

function createPfAiAgentRouter({ configStore: store = configStore, fetchImpl = fetch } = {}) {
  const router = express.Router();

  router.get('/status', (req, res) => {
    res.json({
      sessionProvider: sessionProvider(req) || 'none',
      features: getFeatureStatus(store),
      nativeIdJagPath: '/pingfederate-id-jag/demo',
    });
  });

  router.get('/cimd/client-metadata.json', (req, res) => {
    try {
      if (!getFeatureStatus(store).cimd) return res.status(404).json({ error: 'pf_ai_cimd_not_enabled' });
      res.set('Cache-Control', 'public, max-age=60');
      return res.json(metadataDocument(resolveCimdConfig(store)));
    } catch (error) {
      return res.status(error.httpStatus || 503).json({ error: errorCode(error, 'pf_ai_cimd_config_invalid') });
    }
  });

  router.get('/cimd/start', requireApplicationSession, async (req, res) => {
    try {
      const { redirectUrl } = await beginCimd(req, { store, fetchImpl });
      return res.redirect(302, redirectUrl);
    } catch (error) {
      return res.status(error.httpStatus || 502).json({ error: errorCode(error, 'pf_ai_cimd_start_failed') });
    }
  });

  router.get('/cimd/callback', async (req, res) => {
    const featureSession = req.session?.pfAiAgent;
    const pendingTypes = ['cimd', 'rar'].filter((type) => Boolean(featureSession?.[`${type}Pending`]));
    if (pendingTypes.length !== 1) {
      const suffix = pendingTypes.length ? '?cimd=error&rar=error' : '?cimd=error';
      return res.redirect(`${getFrontendOrigin()}/pingfederate-ai-agent${suffix}`);
    }
    const flow = pendingTypes[0];
    try {
      let result;
      if (flow === 'cimd') result = await completeCimd(req, { store, fetchImpl });
      else result = await completeRar(req, { store, fetchImpl });
      const status = flow === 'rar' && result.outcome === 'denied' ? 'denied' : 'success';
      return saveSession(req, (error) => {
        if (error) return res.redirect(`${getFrontendOrigin()}/pingfederate-ai-agent?${flow}=error`);
        return res.redirect(`${getFrontendOrigin()}/pingfederate-ai-agent?${flow}=${status}`);
      });
    } catch {
      return res.redirect(`${getFrontendOrigin()}/pingfederate-ai-agent?${flow}=error`);
    }
  });

  router.post('/cross-domain/exchange', requireApplicationSession, async (req, res) => {
    try {
      const result = await exchangeForThirdPartyAccessToken(req, {
        subjectProvider: req.body?.subjectProvider,
        store,
        fetchImpl,
      });
      return res.json(result);
    } catch (error) {
      return res.status(error.httpStatus || 502).json({
        error: errorCode(error, 'pf_ai_cross_domain_exchange_failed'),
      });
    }
  });

  router.post('/rar/start', requireApplicationSession, async (req, res) => {
    try {
      const { redirectUrl } = await beginRar(req, {
        scenario: req.body?.scenario || 'allowed',
        userKey: req.body?.userKey,
        store,
        fetchImpl,
      });
      return res.redirect(302, redirectUrl);
    } catch (error) {
      const result = error.code === 'PF_AI_RAR_POLICY_REJECTED' ? 'denied' : 'error';
      return res.redirect(`${getFrontendOrigin()}/pingfederate-ai-agent?rar=${result}`);
    }
  });

  return router;
}

module.exports = createPfAiAgentRouter();
module.exports.createPfAiAgentRouter = createPfAiAgentRouter;
