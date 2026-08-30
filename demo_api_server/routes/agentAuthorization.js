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
const delegationStore = require('../services/lmdb/delegationStore.lmdb');
const delegationService = require('../services/delegationService');
const { revokeToken } = require('../services/tokenRevocation');

/** Bound on the "revoke remaining records" cleanup loops below. */
const MAX_REVOKE_ATTEMPTS = 10;

/** Resolve the AI Agent client_id that may_act.sub must equal (same source the exchange uses).
 *
 * The *_ACTOR_* names are the ones the deployment actually sets — every other
 * key here was empty in the live container (2026-08-29), so this returned null,
 * grant/revoke answered 503 agent_not_configured, and nothing could write the
 * user's mayAct at all. Users therefore kept whatever value was written before
 * the AI Agent Actor app was recreated on 2026-08-22: demoUser's PingOne record
 * still carried mayAct.sub = 71e878ea, the deleted app.
 *
 * PingOne CONSTRUCTS the act claim from the subject token's may_act, which is
 * projected from ${user.mayAct} (pingoneProvisionService step 23.5) — so a
 * stale user attribute silently poisons every exchanged token's act.sub, and
 * the gateway rejects it: `Unauthorized delegation actor: act.sub "71e878ea…"
 * is not an authorized actor`. Same missed-variable shape as the snapshot
 * generator's actor harvest (#2594): a key list that predates the ACTOR rename.
 */
function agentMayActSub() {
  return (
    configStore.getEffective('ai_agent_client_id') ||
    configStore.getEffective('pingone_ai_agent_client_id') ||
    configStore.getEffective('pingone_ai_agent_actor_client_id') ||
    process.env.AI_AGENT_CLIENT_ID ||
    process.env.PINGONE_AI_AGENT_CLIENT_ID ||
    process.env.PINGONE_AI_AGENT_ACTOR_CLIENT_ID ||
    null
  );
}

// Revocation is now always enforced via the act-chain (a revoked/never-granted
// agent's may_act is absent, so PingOne never mints an act claim, and
// demo_authz_server's Rule 2.5 — REQUIRE_ACT_FOR_AGENT_TOOLS — denies
// agent-mediated tools with no act claim). No longer a toggleable flag.
function isEnforced() {
  return true;
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
    const accessToken = req.session?.oauthTokens?.accessToken || null;
    const existing = delegationStore.findActiveByActorAndGrantor(sub, req.user.id);
    if (!existing) {
      delegationStore.grantDelegation({
        delegator_user_id: req.user.id,
        delegator_email: req.user.email || '',
        delegate_email: sub,
        scopes: [],
        access_token: accessToken,
      });
    }
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
  const sub = agentMayActSub();
  const authorized = sub
    ? !!delegationStore.findActiveByActorAndGrantor(sub, req.user.id)
    : false;
  res.json({ authorized, enforced: isEnforced() });
});

router.delete('/hard', async (req, res) => {
  const sub = agentMayActSub();
  if (!sub) return res.status(503).json({ error: 'agent_not_configured', message: 'AI Agent client id not configured.' });
  const record = delegationStore.findActiveByActorAndGrantor(sub, req.user.id);
  if (!record) return res.status(404).json({ error: 'no_active_delegation' });
  try {
    await delegationService.revokeDelegation(record.id, req.user.id);
  } catch (err) {
    console.error('[agent-authorization] delegationService.revokeDelegation (hard) failed (non-fatal):', err.message);
  }
  // Revoke all remaining active records for this actor/grantor pair. Bounded:
  // if revokeDelegation fails, the record's status never actually flips to
  // 'revoked', so the re-query below returns the SAME record forever — an
  // unbounded spin with no attempt cap or backoff.
  let next = delegationStore.findActiveByActorAndGrantor(sub, req.user.id);
  let attempts = 0;
  while (next && attempts < MAX_REVOKE_ATTEMPTS) {
    attempts++;
    try { await delegationService.revokeDelegation(next.id, req.user.id); } catch (_) {}
    next = delegationStore.findActiveByActorAndGrantor(sub, req.user.id);
  }
  if (next) {
    console.error(`[agent-authorization] gave up revoking remaining delegation ${next.id} after ${MAX_REVOKE_ATTEMPTS} attempts (hard)`);
  }
  const accessToken = req.session?.oauthTokens?.accessToken;
  if (accessToken) {
    const clientId = configStore.getEffective('pingone_client_id') || process.env.PINGONE_CLIENT_ID;
    const clientSecret = configStore.getEffective('pingone_client_secret') || process.env.PINGONE_CLIENT_SECRET;
    try {
      await revokeToken(accessToken, 'access_token', clientId, clientSecret);
    } catch (err) {
      console.error('[agent-authorization] RFC 7009 revocation failed (non-fatal):', err.message);
    }
  }
  // ok reflects whether delegation-record revocation actually completed —
  // the token revocation and session clear above always run regardless
  // (this is the aggressive kill-switch path), but the response must not
  // unconditionally claim ok:true when a record demonstrably remained active.
  res.json({
    ok: !next,
    revoked: 'hard',
    sessionClear: true,
    ...(next ? { warning: 'Some delegation records could not be revoked. Try again or contact an administrator.' } : {}),
  });
});

router.delete('/', async (req, res) => {
  const sub = agentMayActSub();
  if (!sub) return res.status(503).json({ error: 'agent_not_configured', message: 'AI Agent client id not configured.' });
  const record = delegationStore.findActiveByActorAndGrantor(sub, req.user.id);
  if (!record) return res.status(404).json({ error: 'no_active_delegation' });
  try {
    await delegationService.revokeDelegation(record.id, req.user.id);
  } catch (err) {
    return res.status(502).json({ error: 'revoke_failed', message: err.message });
  }
  // Revoke all remaining active records for this actor/grantor pair. Bounded
  // for the same reason as /hard above — a failed revokeDelegation leaves the
  // record active, so an unbounded loop would spin on it forever.
  let next = delegationStore.findActiveByActorAndGrantor(sub, req.user.id);
  let attempts = 0;
  while (next && attempts < MAX_REVOKE_ATTEMPTS) {
    attempts++;
    try { await delegationService.revokeDelegation(next.id, req.user.id); } catch (_) {}
    next = delegationStore.findActiveByActorAndGrantor(sub, req.user.id);
  }
  if (next) {
    console.error(`[agent-authorization] gave up revoking remaining delegation ${next.id} after ${MAX_REVOKE_ATTEMPTS} attempts (soft)`);
    return res.status(502).json({ error: 'revoke_incomplete', message: 'Could not fully revoke agent access. Try again.' });
  }
  res.json({ ok: true, revoked: 'soft' });
});

module.exports = router;

// Exported for tests only. Router export above is unchanged.
module.exports.__test = { agentMayActSub };
