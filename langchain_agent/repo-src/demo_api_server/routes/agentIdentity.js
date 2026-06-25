// banking_api_server/routes/agentIdentity.js
/**
 * Human ↔ agent representative identity: optional PingOne user provisioning and (lab-only) password-grant re-check.
 * Main demos use OAuth code + PKCE or marketing pi.flow — not this route. Password grant here is gated by env and PingOne app config.
 */
'use strict';

const express = require('express');
const router = express.Router();
const oauthUserService = require('../services/oauthUserService');
const agentIdentityStore = require('../services/agentIdentityStore');
const pingOneAgentUserService = require('../services/pingOneAgentUserService');

function sessionUser(req) {
  return req.session?.user || null;
}

function sessionOAuthSub(req) {
  return req.session?.user?.oauthId || req.session?.user?.id || null;
}

/** GET /api/agent/identity/status */
router.get('/identity/status', async (req, res) => {
  const u = sessionUser(req);
  if (!u) {
    return res.status(401).json({ error: 'authentication_required', message: 'Sign in first.' });
  }
  const sub = sessionOAuthSub(req);
  const mapping = sub ? await agentIdentityStore.getByPrincipalSub(sub) : null;
  return res.json({
    principalUsername: u.username,
    principalEmail: u.email,
    principalPingOneSub: sub,
    agentMapping: mapping,
    actorMcpEnabled:
      process.env.USE_AGENT_ACTOR_FOR_MCP === 'true' && !!process.env.AGENT_OAUTH_CLIENT_ID,
  });
});

/**
 * POST /api/agent/identity/bootstrap
 * body: { username?, password? } — optional resource-owner (password) grant re-check when enabled (lab); otherwise mapping only.
 */
router.post('/identity/bootstrap', express.json(), async (req, res) => {
  const u = sessionUser(req);
  if (!u) {
    return res.status(401).json({ error: 'authentication_required', message: 'Sign in first.' });
  }

  const sub = sessionOAuthSub(req);
  if (!sub) {
    return res.status(400).json({ error: 'no_oauth_subject', message: 'Session has no OAuth subject.' });
  }

  const { username, password } = req.body || {};
  const allowRopc = process.env.PINGONE_ROPC_FOR_AGENT_BOOTSTRAP === 'true';

  if (username || password) {
    if (!allowRopc) {
      return res.status(403).json({
        error: 'ropc_disabled',
        message:
          'Set PINGONE_ROPC_FOR_AGENT_BOOTSTRAP=true and enable ROPC on the end-user PingOne app to validate username/password here.',
      });
    }
    const uname = String(username || u.username || u.email || '').trim();
    if (!uname || !password) {
      return res.status(400).json({ error: 'invalid_body', message: 'username and password required for ROPC.' });
    }
    if (u.email && uname !== u.email && uname !== u.username) {
      return res.status(400).json({ error: 'username_mismatch', message: 'Username must match the signed-in user.' });
    }
    try {
      await oauthUserService.exchangeResourceOwnerPassword(uname, password);
    } catch (err) {
      return res.status(401).json({ error: 'credential_validation_failed', message: err.message });
    }
  }

  let provision = { created: false };
  if (process.env.PINGONE_PROVISION_AGENT_USER === 'true') {
    provision = await pingOneAgentUserService.createAgentRepresentativeUser({
      principalSub: sub,
      principalEmail: u.email,
    });
  }

  const mapping = await agentIdentityStore.upsertMapping({
    principalPingOneSub: sub,
    principalUsername: u.username,
    principalEmail: u.email,
    pingoneAgentUserId: provision.created ? provision.pingoneAgentUserId || '' : '',
    pingoneAgentUsername: provision.created ? provision.pingoneAgentUsername || '' : '',
    customAttributeName: pingOneAgentUserService.CUSTOM_ATTR,
    customAttributeValue: sub,
  });

  return res.json({
    ok: true,
    mapping,
    pingOneProvision: provision,
  });
});

module.exports = router;
