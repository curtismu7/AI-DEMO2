'use strict';

const crypto = require('crypto');
const express = require('express');
const configStore = require('../services/configStore');
const protectService = require('../services/pingOneProtectService');

const router = express.Router();
const MAX_SIGNALS_BYTES = 64 * 1024;
const FLOW_TTL_MS = 10 * 60 * 1000;

function requireCsrf(req, res, next) {
  if (!req.headers['x-protect-auth-csrf']) {
    return res.status(403).json({ error: 'forbidden', reason: 'missing x-protect-auth-csrf header' });
  }
  return next();
}

function flowStore(req) {
  if (!req.session) return null;
  if (!req.session.protectAuthenticationFlows) req.session.protectAuthenticationFlows = {};
  const flows = req.session.protectAuthenticationFlows;
  const now = Date.now();
  Object.keys(flows).forEach((id) => {
    if (!flows[id] || flows[id].expiresAt <= now || flows[id].consumed) delete flows[id];
  });
  return flows;
}

function requestIp(req) {
  // Express applies the BFF's configured trust-proxy chain before exposing req.ip.
  return req.ip || req.socket?.remoteAddress || '';
}

router.post('/evaluations', requireCsrf, async (req, res) => {
  const { userId, signalsData } = req.body || {};
  if (typeof userId !== 'string' || !userId.trim() || userId.length > 320) {
    return res.status(400).json({ error: 'invalid_user_id' });
  }
  if (typeof signalsData !== 'string' || !signalsData.trim()) {
    return res.status(400).json({ error: 'invalid_signals_data' });
  }
  if (Buffer.byteLength(signalsData, 'utf8') > MAX_SIGNALS_BYTES) {
    return res.status(413).json({ error: 'signals_data_too_large' });
  }
  const environmentId = configStore.getEffective('PINGONE_ENVIRONMENT_ID');
  const targetResourceId = configStore.getEffective('PINGONE_SDK_DEMO_CLIENT_ID');
  if (!environmentId || !targetResourceId) {
    return res.status(503).json({ error: 'protect_auth_not_configured' });
  }
  const flows = flowStore(req);
  if (!flows || !req.sessionID) return res.status(500).json({ error: 'session_unavailable' });

  try {
    const evaluation = await protectService.createAuthenticationEvaluation({
      userId: userId.trim(),
      ip: requestIp(req),
      userAgent: String(req.get('user-agent') || '').slice(0, 1024),
      signalsData,
      targetResourceId,
      sessionId: req.sessionID,
    });
    const level = evaluation.result?.level;
    const recommendedAction = evaluation.result?.recommendedAction || null;
    if (!['LOW', 'MEDIUM', 'HIGH'].includes(level)) {
      await protectService.completeEvaluation(evaluation.id, 'FAILED');
      return res.status(502).json({ error: 'unknown_risk_result' });
    }
    if (level === 'HIGH') {
      await protectService.completeEvaluation(evaluation.id, 'FAILED');
      return res.json({ level, recommendedAction });
    }

    const flowId = crypto.randomUUID();
    flows[flowId] = { evaluationId: evaluation.id, expiresAt: Date.now() + FLOW_TTL_MS };
    return res.json({ flowId, level, recommendedAction });
  } catch {
    console.warn('[ProtectAuth] risk evaluation unavailable');
    return res.status(502).json({ error: 'protect_evaluation_failed' });
  }
});

router.post('/completions', requireCsrf, async (req, res) => {
  const { flowId, completionStatus } = req.body || {};
  if (typeof flowId !== 'string' || !flowId || !['SUCCESS', 'FAILED'].includes(completionStatus)) {
    return res.status(400).json({ error: 'invalid_completion' });
  }
  const flows = flowStore(req);
  const flow = flows?.[flowId];
  if (!flow || flow.consumed) return res.status(404).json({ error: 'protect_flow_not_found' });

  // Consume before the network request so concurrent/replayed completions cannot
  // report more than one outcome for the same Protect evaluation.
  flow.consumed = true;
  delete flows[flowId];
  try {
    await protectService.completeEvaluation(flow.evaluationId, completionStatus);
    return res.status(204).end();
  } catch {
    console.warn('[ProtectAuth] completion update failed');
    return res.status(502).json({ error: 'protect_completion_failed' });
  }
});

module.exports = router;
