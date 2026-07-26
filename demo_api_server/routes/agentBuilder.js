// demo_api_server/routes/agentBuilder.js
/**
 * /api/agent-builder — self-service per-user agent identity (AgentBuilderPage).
 * Session-authenticated (any logged-in user); Management API calls run
 * server-side in agentBuilderService with the worker token.
 */
'use strict';

const express = require('express');
const router = express.Router();
const { requireSession } = require('../middleware/auth');
const svc = require('../services/agentBuilderService');
const { normalizeAxiosError } = require('../utils/normalizeAxiosError');

router.use(requireSession);

function sendError(res, err) {
  if (err.code === 'invalid') return res.status(400).json({ error: 'invalid', message: err.message });
  if (err.code === 'forbidden') return res.status(403).json({ error: 'forbidden', message: err.message });
  if (err.code === 'not_found') return res.status(404).json({ error: 'not_found', message: err.message });
  if (err.code === 'duplicate_scope_name') return res.status(409).json({ error: 'duplicate_scope_name', message: err.message });
  const pingone = err.response?.data;
  console.error('[agent-builder]', err.message, pingone ? JSON.stringify(pingone).slice(0, 500) : '');
  return res.status(502).json({
    error: 'pingone_error',
    message: pingone?.details?.[0]?.message || pingone?.message
      || normalizeAxiosError(err, { label: 'PingOne agent build' }).message,
  });
}

/** Route bodies just throw — error mapping is structural, not per-handler. */
function asyncRoute(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      sendError(res, err);
    }
  };
}

// GET /api/agent-builder/state — hydrate the whole page in one call.
router.get('/state', asyncRoute(async (req, res) => {
  const user = req.session.user;
  const [agent, resources] = await Promise.all([
    svc.getAgentForUser(user),
    svc.listResourcesForUser(user),
  ]);
  const granted = agent ? await svc.getAgentGrants(agent.id) : {};
  res.json({
    user: { username: user.username, email: user.email, sub: user.oauthId || user.id },
    agent,
    resources: resources.map((r) => ({ ...r, granted: granted[r.id] || [] })),
  });
}));

// POST /api/agent-builder/agent  body (optional): { grantTypes?: [..], tokenEndpointAuthMethod? }
// — config copied from an existing agent via the picker.
router.post('/agent', asyncRoute(async (req, res) => {
  const { grantTypes, tokenEndpointAuthMethod } = req.body || {};
  const result = await svc.createAgentForUser(req.session.user, {
    grantTypes: Array.isArray(grantTypes) ? grantTypes.map(String) : undefined,
    tokenEndpointAuthMethod: typeof tokenEndpointAuthMethod === 'string' ? tokenEndpointAuthMethod : undefined,
  });
  res.status(result.created ? 201 : 200).json(result);
}));

// One-click upgrade: fallback WEB_APP → first-class AI_AGENT, grants re-applied.
router.post('/agent/upgrade', asyncRoute(async (req, res) => {
  res.json(await svc.upgradeAgentForUser(req.session.user));
}));

router.delete('/agent', asyncRoute(async (req, res) => {
  await svc.deleteAgentForUser(req.session.user);
  res.json({ deleted: true });
}));

// Reference agents already in the environment (read-only picker).
router.get('/agents', asyncRoute(async (req, res) => {
  res.json({ agents: await svc.listEnvironmentAgents() });
}));

// Copyable setup (config + grants) of one existing agent.
router.get('/agents/:id/setup', asyncRoute(async (req, res) => {
  res.json(await svc.getAgentSetup(req.params.id));
}));

// PUT /api/agent-builder/grants  { grants: [{ resourceId, scopes: [name] }] }
router.put('/grants', asyncRoute(async (req, res) => {
  const agent = await svc.getAgentForUser(req.session.user);
  if (!agent) return res.status(404).json({ error: 'not_found', message: 'Build your agent first.' });
  await svc.setAgentGrants(agent.id, req.body?.grants || []);
  res.json({ applied: true });
}));

// POST /api/agent-builder/resources  { name, audience?, scopes?: [name] }
router.post('/resources', asyncRoute(async (req, res) => {
  const { name, audience, scopes } = req.body || {};
  const result = await svc.createUserResource(req.session.user, { name, audience, scopes });
  res.status(result.created ? 201 : 200).json(result);
}));

router.delete('/resources/:id', asyncRoute(async (req, res) => {
  await svc.deleteUserResource(req.session.user, req.params.id);
  res.json({ deleted: true });
}));

module.exports = router;
