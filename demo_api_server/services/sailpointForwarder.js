'use strict';
const axios = require('axios');

/**
 * True when this process is a test runner.
 *
 * Mirrors newRelicForwarder's guard: env vars live in demo_api_server/.env,
 * which jest loads, so without this guard every `npm test` run would ship
 * fixture agent-lifecycle events to whatever SAILPOINT_WEBHOOK_URL is
 * configured. Set SAILPOINT_ALLOW_TEST_FORWARD=true to override, for the
 * rare case of deliberately exercising the real forwarder.
 */
function _isTestRun() {
  if (process.env.SAILPOINT_ALLOW_TEST_FORWARD === 'true') return false;
  return process.env.NODE_ENV === 'test' || !!process.env.JEST_WORKER_ID;
}

function _post(payload) {
  if (_isTestRun()) return Promise.resolve();
  const url = process.env.SAILPOINT_WEBHOOK_URL;
  if (!url) return Promise.resolve();
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.SAILPOINT_WEBHOOK_API_KEY) headers['X-Api-Key'] = process.env.SAILPOINT_WEBHOOK_API_KEY;
  return axios
    .post(url, payload, { headers, timeout: 5000 })
    .catch((err) => {
      console.warn('[sailpointForwarder] forward failed:', err?.message);
    });
}

/**
 * Forward an agent lifecycle event (joiner/mover/leaver) to the configured
 * SAILPOINT_WEBHOOK_URL. No-op when unset. Never throws.
 * Illustrative-only — this is NOT a real SailPoint API integration, just a
 * generic JSON webhook shaped to simulate feeding an external IGA system.
 * @param {object} event — storedEvent from agentLifecycleEventStore
 */
async function forward(event) {
  return _post({ source: 'ai-demo-bff', eventType: 'agent_lifecycle', event });
}

module.exports = { forward };
