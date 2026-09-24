'use strict';

const express = require('express');
const configStore = require('../services/configStore');
const protectService = require('../services/pingOneProtectService');

const router = express.Router();
const MAX_SIGNALS_BYTES = 64 * 1024;

function requireCsrf(req, res, next) {
  if (!req.headers['x-protect-auth-csrf']) {
    return res.status(403).json({ error: 'forbidden', reason: 'missing x-protect-auth-csrf header' });
  }
  return next();
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
    return res.status(503).json({ error: 'protect_evaluation_not_configured' });
  }
  try {
    const evaluation = await protectService.createBrowserRiskEvaluation({
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
      return res.status(502).json({ error: 'unknown_risk_result' });
    }
    const botDetection = evaluation.details?.botDetection;
    return res.json({
      level,
      recommendedAction,
      ...(botDetection ? {
        botDetection: {
          level: botDetection.level || null,
          status: botDetection.status || null,
          detectedRuleId: botDetection.detected?.rule?.id ?? null,
        },
      } : {}),
    });
  } catch {
    console.warn('[PingOneProtect] browser risk evaluation unavailable');
    return res.status(502).json({ error: 'protect_evaluation_failed' });
  }
});

module.exports = router;
