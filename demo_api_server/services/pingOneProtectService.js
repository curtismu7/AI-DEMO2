'use strict';

const axios = require('axios');
const configStore = require('./configStore');
const pingOneClientService = require('./pingOneClientService');

function apiBase() {
  const region = configStore.getEffective('PINGONE_REGION') || 'com';
  return `https://api.pingone.${region}/v1/environments/${configStore.getEffective('PINGONE_ENVIRONMENT_ID')}/riskEvaluations`;
}

async function createBrowserRiskEvaluation({ userId, ip, userAgent, signalsData, targetResourceId, sessionId }) {
  const environmentId = configStore.getEffective('PINGONE_ENVIRONMENT_ID');
  if (!environmentId) throw new Error('PingOne environment is not configured');
  if (!targetResourceId) throw new Error('PingOne Protect evaluation target is not configured');
  const token = await pingOneClientService.getManagementToken();
  const event = {
    ip,
    user: { id: userId, type: 'PING_ONE', name: userId },
    browser: { userAgent },
    flow: { type: 'AUTHENTICATION' },
    ...(sessionId ? { session: { id: sessionId } } : {}),
    targetResource: { id: targetResourceId, name: 'PingOne Protect browser risk evaluation demo' },
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

module.exports = { createBrowserRiskEvaluation };
