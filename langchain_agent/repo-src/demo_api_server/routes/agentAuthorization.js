'use strict';
/**
 * routes/agentAuthorization.js — user control over the RFC 8693 `may_act` claim.
 *
 * Grant/revoke whether the AI agent may act on the user's behalf by writing/clearing
 * the user's PingOne `mayAct` attribute. The value MUST be { sub: <ai_agent_client_id> }
 * (the actor token's aud[0]) so PingOne's SpEL emits `act` during exchange.
 *
 * After grant/revoke the SPA must silently re-auth (reauthRequired) so the new token
 * carries/drops may_act.
 *
 * Mounted (authenticated) at /api/agent-authorization in server.js.
 */
const express = require('express');
const router = express.Router();
const pingOneUserService = require('../services/pingOneUserService');
const configStore = require('../services/configStore');

/** Resolve the AI Agent client_id that may_act.sub must equal (same source the exchange uses). */
function agentMayActSub() {
  return (
    configStore.getEffective('ai_agent_client_id') ||
    configStore.getEffective('pingone_ai_agent_client_id') ||
    process.env.AI_AGENT_CLIENT_ID ||
    process.env.PINGONE_AI_AGENT_CLIENT_ID ||
    null
  );
}

function isEnforced() {
  const v = configStore.getEffective('ff_require_may_act');
  return v === true || v === 'true';
}

/** Read the may_act claim from the user's current session access token (PingOne GET omits custom attrs). */
function sessionTokenMayAct(req) {
  const token = req.session?.oauthTokens?.accessToken;
  if (!token || typeof token !== 'string' || token.split('.').length < 2) return null;
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
    return payload.may_act || null;
  } catch {
    return null;
  }
}

router.post('/grant', async (req, res) => {
  const sub = agentMayActSub();
  if (!sub) return res.status(503).json({ error: 'agent_not_configured', message: 'AI Agent client id (ai_agent_client_id) not configured.' });
  try {
    pingOneUserService.initialize();
    await pingOneUserService.setMayActAttribute(req.user.id, { sub });
    res.json({ ok: true, reauthRequired: true });
  } catch (err) {
    res.status(502).json({ error: 'mayact_write_failed', message: 'Could not update agent authorization. Try again.' });
  }
});

router.post('/revoke', async (req, res) => {
  try {
    pingOneUserService.initialize();
    await pingOneUserService.setMayActAttribute(req.user.id, null);
    res.json({ ok: true, reauthRequired: true });
  } catch (err) {
    res.status(502).json({ error: 'mayact_write_failed', message: 'Could not update agent authorization. Try again.' });
  }
});

router.get('/status', (req, res) => {
  // Authorized = the live token carries may_act (what the token chain reflects).
  res.json({ authorized: !!sessionTokenMayAct(req), enforced: isEnforced() });
});

module.exports = router;
