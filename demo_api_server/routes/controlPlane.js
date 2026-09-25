'use strict';
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const demoAgentRoster = require('../services/controlPlane/demoAgentRoster');
const { getLiveAgentRow } = require('../services/controlPlane/liveAgentInfo');
const auditLogService = require('../services/auditLogService');
const appEventService = require('../services/appEventService');
const agentLifecycleEvents = require('../services/agentLifecycleEvents');
const controlPlaneOverview = require('../services/controlPlaneOverview');
const { terminateAllUserSessions } = require('../services/pingOneSessionService');

// Honest-subset stop for a demo platform identity: writes a REAL immutable audit
// record and emits a control_plane push event, then flips session status. Does
// NOT call PingOne token/user/app disable — there is no real PingOne user/app
// behind these demo identities, so that would be a no-op/dishonest.
async function stopDemoAgent(req, agent, reason) {
  const snapshot = { demo: true, agent_id: agent.id, active_sessions: [] };
  const auditId = await auditLogService.recordKillEvent(agent.id, reason, snapshot, 0, `demo-${agent.id}`);
  demoAgentRoster.setStatus(req, agent.id, 'revoked');
  appEventService.logEvent(
    'control_plane',
    'warning',
    `${agent.label} stopped by the Ping control plane`,
    { tag: 'agent_stopped', metadata: { agentId: agent.id, label: agent.label, reason, kind: 'demo', audit_id: auditId } }
  );
  agentLifecycleEvents.emit({
    eventType: 'leaver',
    agentId: agent.id,
    agentLabel: agent.label,
    source: agent.source || null,
    kind: 'demo',
    reason,
    auditId,
  });
  return auditId;
}

router.get('/agents', authenticateToken, (req, res) => {
  const demo = demoAgentRoster.getRoster(req);
  const live = getLiveAgentRow(req);
  return res.json({ live, demo });
});

router.post('/agents/:agentId/stop', authenticateToken, async (req, res) => {
  const { agentId } = req.params;
  const reason = (req.body && req.body.reason) || 'manual_safety';
  if (agentId === 'demo-agent') {
    return res.status(409).json({
      error: 'use_live_endpoint',
      message: 'Stop the live agent via /api/admin/agent/demo-agent/kill-switch',
    });
  }
  const agent = demoAgentRoster.getRoster(req).find((a) => a.id === agentId);
  if (!agent) {
    return res.status(404).json({ error: 'unknown_agent', message: `No demo agent '${agentId}'` });
  }
  try {
    const auditId = await stopDemoAgent(req, agent, reason);
    req.session.save(() => res.json({ ok: true, agent: { ...agent, status: 'revoked' }, audit_id: auditId }));
  } catch (e) {
    try { await auditLogService.recordKillFailure(agentId, reason, e.message); } catch (_) { /* non-fatal */ }
    return res.status(500).json({ error: 'stop_failed', message: e.message });
  }
});

router.post('/stop-all', authenticateToken, async (req, res) => {
  const reason = (req.body && req.body.reason) || 'manual_safety';
  const active = demoAgentRoster.getRoster(req).filter((a) => a.status === 'active');
  const stopped = [];
  for (const agent of active) {
    try {
      const auditId = await stopDemoAgent(req, agent, reason);
      stopped.push({ id: agent.id, audit_id: auditId });
    } catch (e) {
      try { await auditLogService.recordKillFailure(agent.id, reason, e.message); } catch (_) { /* non-fatal */ }
    }
  }
  req.session.save(() => res.json({ ok: true, stopped, count: stopped.length }));
});

router.post('/reset', authenticateToken, (req, res) => {
  const demo = demoAgentRoster.reset(req);
  demo.forEach((agent) => {
    agentLifecycleEvents.emit({
      eventType: 'joiner',
      agentId: agent.id,
      agentLabel: agent.label,
      source: agent.source || null,
      kind: 'demo',
      reason: 'registration',
    });
  });
  req.session.save(() => res.json({ ok: true, demo }));
});

/**
 * POST /api/control-plane/comprehensive-shutdown
 *
 * The "everything at once" escalation of the kill switch:
 *   1. Full-scope kill of the live agent via the unchanged killSwitchService
 *      (token revocation, user disable, agent app disable, schedule cancel,
 *      session invalidation, revoked flag, audit record).
 *   2. Terminate every active PingOne SSO session for the user — closes the
 *      "agent re-mints via an alive SSO session" hole that token revocation
 *      alone leaves open.
 *
 * Only real identities are touched: there are no simulated roster rows, so
 * nothing fake is stopped. Like the kill-switch, this destroys the caller's
 * session: the kill is the expected 401-shaped response (error:
 * 'agent_killed') so the UI's existing session-expiry handling takes over.
 */
router.post('/comprehensive-shutdown', authenticateToken, async (req, res) => {
  const reason = (req.body && req.body.reason) || 'comprehensive_shutdown';
  const userId = req.session?.user?.oauthId || req.session?.user?.id || null;
  const oauthTokens = req.session?.oauthTokens || null;
  const agentId = 'demo-agent';
  const steps = [];

  // 1. Full-scope kill (real PingOne revocation + app disable). Reuse the
  //    service directly rather than the /kill-switch route so this one call
  //    can continue to step 2 before the session dies with the response.
  let killResult = null;
  try {
    const killSwitchService = require('../services/killSwitchService');
    killResult = await killSwitchService.killAgent(agentId, reason, userId, oauthTokens, 'full', req.sessionID);
    steps.push({ key: 'live_kill', label: 'Full-scope kill of the live agent', detail: `Revoked tokens and disabled the agent's PingOne application (${killResult.time_to_revoke_ms}ms).`, ran: true, skipped: false });
  } catch (e) {
    steps.push({ key: 'live_kill', label: 'Full-scope kill of the live agent', detail: `Kill switch failed: ${e.message}`, ran: false, skipped: false });
  }

  // 2. PingOne SSO session termination (best-effort; already-covered by
  //    token revocation when this fails).
  try {
    const sessionResult = await terminateAllUserSessions(userId);
    steps.push({
      key: 'pingone_sessions',
      label: 'Terminate PingOne SSO sessions',
      detail: sessionResult.terminated > 0
        ? `${sessionResult.terminated} of ${sessionResult.sessions_found} SSO session(s) terminated — the agent cannot silently re-authenticate.`
        : 'No active PingOne SSO sessions found (or termination unsupported) — token revocation above already covers re-auth.',
      ran: sessionResult.terminated > 0,
      skipped: sessionResult.sessions_found === 0,
      skipReason: sessionResult.sessions_found === 0 ? 'no_sessions' : undefined,
    });
  } catch (e) {
    steps.push({ key: 'pingone_sessions', label: 'Terminate PingOne SSO sessions', detail: `Could not enumerate/terminate SSO sessions: ${e.message}`, ran: false, skipped: false });
  }

  // Session is dead after a full kill — respond in the kill-switch's expected
  // 401 shape so the UI's existing handling (redirect to sign-in, result
  // modal) takes over unchanged.
  req.session.destroy(() => {});
  return res.status(401).json({
    error: 'agent_killed',
    need_auth: true,
    revoked_at: killResult ? killResult.revoked_at : null,
    scope: 'full',
    stopped: [],
    steps,
    message: 'Comprehensive shutdown complete. Session revoked. Please sign in again.',
  });
});

router.get('/lifecycle-events', authenticateToken, (req, res) => {
  const { limit, eventType, agentId } = req.query;
  const filters = {};
  if (eventType) filters.eventType = eventType;
  if (agentId) filters.agentId = agentId;
  if (limit) filters.limit = Math.min(Number(limit) || 50, 500);
  return res.json({ events: agentLifecycleEvents.query(filters), summary: agentLifecycleEvents.summary() });
});

/**
 * GET /api/control-plane/overview
 *
 * The whole control-plane surface in one request: five zones, the enforcement
 * band, and the computed findings. 200 whenever the response can be assembled
 * at all — a dead source shows as `sources.<name>.state === 'down'` and every
 * other zone still renders.
 *
 * `req` is passed through because the registry's runtime source reads the
 * session-scoped control-plane roster.
 */
router.get('/overview', authenticateToken, async (req, res) => {
  try {
    return res.json(await controlPlaneOverview.buildOverview(req));
  } catch (err) {
    console.error('[controlPlane] overview failed:', err?.stack || String(err));
    return res.status(500).json({ error: 'overview_unavailable' });
  }
});

module.exports = router;
