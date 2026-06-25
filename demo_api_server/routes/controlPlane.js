'use strict';
const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const demoAgentRoster = require('../services/controlPlane/demoAgentRoster');
const { getLiveAgentRow } = require('../services/controlPlane/liveAgentInfo');
const auditLogService = require('../services/auditLogService');
const appEventService = require('../services/appEventService');

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
  req.session.save(() => res.json({ ok: true, demo }));
});

module.exports = router;
