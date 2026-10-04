'use strict';

const crypto = require('crypto');
const express = require('express');
const configStore = require('../services/configStore');
const { getFrontendOrigin } = require('../services/oauthRedirectUris');
const {
  getFeatureStatus,
  resolveCimdConfig,
} = require('../services/pfAiAgentFeatureConfig');
const { metadataDocument, beginCimd, completeCimd } = require('../services/pfAiAgentCimdService');
const { exchangeForThirdPartyAccessToken } = require('../services/pfAiAgentCrossDomainExchangeService');
const { redeemIdJag } = require('../services/pfAiAgentMockThirdPartyService');
const { beginRar, completeRar, userLimits } = require('../services/pfAiAgentRarService');
const { startCiba, pollCiba } = require('../services/pfAiAgentCibaService');

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

function createPfAiAgentRouter({ configStore: store = configStore, fetchImpl = fetch, dataStore } = {}) {
  const router = express.Router();

  router.get('/status', (req, res) => {
    res.json({
      sessionProvider: sessionProvider(req) || 'none',
      features: getFeatureStatus(store),
      nativeIdJagPath: '/pingfederate-id-jag/demo',
      // Safe metadata of this session's last RAR run (outcome, token type, DPoP key thumbprint);
      // never a token, code, verifier or key.
      rarResult: req.session?.pfAiAgent?.rarResult || null,
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

  // Called by the PingFederate banking_transaction processor after sign-in, not
  // by a browser: it has no session, so it presents a shared credential.
  router.get('/rar/user-limits', (req, res) => {
    const expected = String(store.getEffective('pf_ai_rar_lookup_secret') || '');
    const presented = Buffer.from(String(req.get('authorization') || '').replace(/^Bearer /, ''));
    if (!expected || presented.length !== Buffer.byteLength(expected)
      || !crypto.timingSafeEqual(presented, Buffer.from(expected))) {
      return res.status(401).json({ error: 'pf_ai_rar_lookup_unauthorized' });
    }
    const limits = userLimits(req.query.username, dataStore);
    if (!limits) return res.status(404).json({ error: 'pf_ai_rar_user_unknown' });
    res.set('Cache-Control', 'no-store');
    return res.json(limits);
  });

  // A stand-in third-party authorization server for the cross-domain demo: redeems the
  // PingFederate ID-JAG at the JWT-bearer grant. Not for browsers; the BFF's own exchange
  // calls it. Answers 404 unless pf_ai_third_party_mock_enabled is true.
  router.post('/mock-third-party/token', async (req, res) => {
    const result = await redeemIdJag({ body: req.body || {}, headers: req.headers, store, fetchImpl });
    if (!result) return res.status(404).json({ error: 'not_found' });
    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
    if (result.challenge) res.set('WWW-Authenticate', 'Basic realm="mock-third-party"');
    return res.status(result.status).json(result.body);
  });

  // CIBA: ask a named user to approve on their PingOne MFA device, then poll. Responses carry the
  // state and safe metadata only, never the auth_req_id, a token or the client secret.
  router.post('/ciba/start', requireApplicationSession, async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      return res.json(await startCiba(req, {
        loginHint: req.body?.loginHint, bindingMessage: req.body?.bindingMessage, store, fetchImpl,
      }));
    } catch (error) {
      return res.status(error.httpStatus || 502).json({ error: errorCode(error, 'pf_ai_ciba_failed') });
    }
  });

  router.get('/ciba/status', requireApplicationSession, async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      return res.json(await pollCiba(req, { store, fetchImpl }));
    } catch (error) {
      return res.status(error.httpStatus || 502).json({ error: errorCode(error, 'pf_ai_ciba_failed') });
    }
  });

  router.post('/rar/start', requireApplicationSession, async (req, res) => {
    try {
      const { redirectUrl } = await beginRar(req, {
        scenario: req.body?.scenario || 'allowed',
        userKey: req.body?.userKey,
        dpop: ['1', 'true', 'on'].includes(String(req.body?.dpop || '').toLowerCase()),
        store,
        dataStore,
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
