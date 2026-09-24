'use strict';

const axios = require('axios');
const configStore = require('./configStore');
const pingOneClientService = require('./pingOneClientService');

function apiBase() {
  const region = configStore.getEffective('PINGONE_REGION') || 'com';
  return `https://api.pingone.${region}/v1/environments/${configStore.getEffective('PINGONE_ENVIRONMENT_ID')}/riskEvaluations`;
}

async function createAgentDispatchEvaluation({ user, ip, userAgent, signalsData, sessionId }) {
  const environmentId = configStore.getEffective('PINGONE_ENVIRONMENT_ID');
  if (!environmentId) throw new Error('PingOne environment is not configured');
  const token = await pingOneClientService.getManagementToken();
  const event = {
    ip,
    user: { id: user.id, type: 'PING_ONE', ...(user.name ? { name: user.name } : {}) },
    browser: { userAgent },
    flow: { type: 'AUTHORIZATION' },
    ...(sessionId ? { session: { id: sessionId } } : {}),
    ...(signalsData ? { sdk: { signals: { data: signalsData } } } : {}),
  };
  let response;
  try {
    response = await axios.post(apiBase(), { event }, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10000,
    });
  } catch (error) {
    const apiError = error.response?.data || {};
    // Keep the management token and submitted Signals payload out of diagnostics.
    console.warn('[PingOneProtect] risk evaluation request rejected', {
      status: error.response?.status || null,
      code: apiError.code || null,
      message: apiError.message || null,
      details: Array.isArray(apiError.details)
        ? apiError.details.map((detail) => ({ code: detail.code || null, message: detail.message || null, target: detail.target || null }))
        : undefined,
    });
    throw new Error(`PingOne Protect risk evaluation failed (${error.response?.status || 'network'})`);
  }
  if (!response.data?.id) throw new Error('PingOne Protect did not return a risk evaluation ID');
  return response.data;
}

async function createAuthenticationEvaluation({ userId, ip, userAgent, signalsData, targetResourceId, sessionId }) {
  const environmentId = configStore.getEffective('PINGONE_ENVIRONMENT_ID');
  if (!environmentId) throw new Error('PingOne environment is not configured');
  if (!targetResourceId) throw new Error('PingOne OIDC client is not configured');
  const token = await pingOneClientService.getManagementToken();
  const event = {
    ip,
    user: { id: userId, type: 'PING_ONE', name: userId },
    browser: { userAgent },
    flow: { type: 'AUTHENTICATION' },
    ...(sessionId ? { session: { id: sessionId } } : {}),
    targetResource: { id: targetResourceId, name: 'PingOne Protect browser OIDC demo' },
    ...(signalsData ? { sdk: { signals: { data: signalsData } } } : {}),
  };
  let response;
  try {
    response = await axios.post(apiBase(), { event }, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10000,
    });
  } catch (error) {
    const apiError = error.response?.data || {};
    console.warn('[PingOneProtect] authentication risk evaluation rejected', {
      status: error.response?.status || null,
      code: apiError.code || null,
      message: apiError.message || null,
      details: Array.isArray(apiError.details)
        ? apiError.details.map((detail) => ({ code: detail.code || null, message: detail.message || null, target: detail.target || null }))
        : undefined,
    });
    throw new Error(`PingOne Protect risk evaluation failed (${error.response?.status || 'network'})`);
  }
  if (!response.data?.id) throw new Error('PingOne Protect did not return a risk evaluation ID');
  return response.data;
}

async function completeEvaluation(evaluationId, completionStatus) {
  const environmentId = configStore.getEffective('PINGONE_ENVIRONMENT_ID');
  const token = await pingOneClientService.getManagementToken();
  const region = configStore.getEffective('PINGONE_REGION') || 'com';
  await axios.put(
    `https://api.pingone.${region}/v1/environments/${environmentId}/riskEvaluations/${encodeURIComponent(evaluationId)}/event`,
    { completionStatus },
    { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 },
  );
}

function shouldBlock(result = {}) {
  if (!['LOW', 'MEDIUM', 'HIGH'].includes(result.level)) return true;
  return result.level === 'HIGH' || [
    'BOT_MITIGATION',
    'DENY',
    'AITM_MITIGATION',
    'ACCOUNT_RECOVERY',
  ].includes(result.recommendedAction);
}

function toTokenEvent(evaluation) {
  const result = evaluation?.result || {};
  const botDetection = evaluation?.details?.botDetection || {};
  return {
    id: 'protect-risk-evaluation',
    eventType: 'protect_risk_evaluation',
    status: 'done',
    evaluationId: evaluation?.id || null,
    level: result.level || 'UNKNOWN',
    recommendedAction: result.recommendedAction || null,
    botDetectionLevel: botDetection.level || null,
    botDetectionStatus: botDetection.status || null,
    detectedRuleId: botDetection.detected?.rule?.id ?? null,
    blocked: shouldBlock(result),
    timestamp: new Date().toISOString(),
  };
}

module.exports = { createAgentDispatchEvaluation, createAuthenticationEvaluation, completeEvaluation, shouldBlock, toTokenEvent };
