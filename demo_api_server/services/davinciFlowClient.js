// DaVinci flow invocation client — server-to-server API mode.
// See docs/superpowers/specs/2026-08-17-davinci-orchestration-showcase-design.md.
'use strict';

const axios = require('axios');
const davinciConfig = require('../config/davinci');
const { normalizeAxiosError } = require('../utils/normalizeAxiosError');

const ORCHESTRATE_BASE = 'https://orchestrate-api.pingone.com/v1';

const FLOWS = {
  transactionAuthorization: () => davinciConfig.transaction,
};

async function invokeFlow(flowKey, params) {
  const resolve = FLOWS[flowKey];
  if (!resolve) {
    throw new Error(`davinciFlowClient: unknown flow "${flowKey}"`);
  }
  const { companyId, appId, flowId } = resolve();
  const url = `${ORCHESTRATE_BASE}/company/${companyId}/applications/${appId}/flows/${flowId}/start`;

  try {
    const res = await axios.post(url, params, {
      headers: {
        Authorization: `Bearer ${await _getApiToken()}`,
        'Content-Type': 'application/json',
      },
      timeout: 10_000,
    });
    return res.data;
  } catch (err) {
    throw normalizeAxiosError(err, { label: 'DaVinci flow invocation', timeoutMs: 10_000 });
  }
}

// Placeholder client_credentials token fetch — same shape as other worker-token
// call sites in this repo (e.g. mfaService's userAccessToken usage). Kept as its
// own function so a future PINGONE_DAVINCI token-cache can slot in without
// touching invokeFlow's call sites.
async function _getApiToken() {
  return `${davinciConfig.apiClientId}:${davinciConfig.apiClientSecret}`;
}

module.exports = { invokeFlow };
