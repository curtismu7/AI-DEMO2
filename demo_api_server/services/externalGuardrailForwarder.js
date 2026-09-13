'use strict';
const axios = require('axios');
const configStore = require('./configStore');

/**
 * True when this process is a test runner.
 *
 * Mirrors sailpointForwarder/newRelicForwarder's guard: without it, every
 * `npm test` run would ship fixture prompts to whatever
 * EXTERNAL_GUARDRAIL_WEBHOOK_URL happens to be configured. Set
 * EXTERNAL_GUARDRAIL_ALLOW_TEST_FORWARD=true to override.
 */
function _isTestRun() {
  if (process.env.EXTERNAL_GUARDRAIL_ALLOW_TEST_FORWARD === 'true') return false;
  return process.env.NODE_ENV === 'test' || !!process.env.JEST_WORKER_ID;
}

/**
 * Forward an AI Guard (Privilege LLM sub-gateway) denial to
 * EXTERNAL_GUARDRAIL_WEBHOOK_URL, gated on the ff_external_guardrail_webhook
 * flag. No-op unless both are set. Never throws.
 *
 * Purpose: let an operator point this at a generic webhook inspector (e.g.
 * webhook.site) to see exactly what data is present at the moment AI Guard
 * blocks a request.
 *
 * @param {object} attempt
 * @param {string} attempt.provider
 * @param {string} attempt.prompt
 * @param {string} attempt.route
 * @param {'BLOCKED'} attempt.verdict
 * @param {string} attempt.reason
 * @param {number} attempt.latencyMs
 */
async function forwardDenial(attempt) {
  if (_isTestRun()) return;
  if (configStore.getEffective('ff_external_guardrail_webhook') !== 'true') return;
  const url = configStore.getEffective('EXTERNAL_GUARDRAIL_WEBHOOK_URL');
  if (!url) return;

  const payload = {
    source: 'ai-demo-bff',
    eventType: 'ai_guard_denial',
    timestamp: new Date().toISOString(),
    ...attempt,
  };

  await axios
    .post(url, payload, { headers: { 'Content-Type': 'application/json' }, timeout: 5000 })
    .catch((err) => {
      console.warn('[externalGuardrailForwarder] forward failed:', err?.message);
    });
}

module.exports = { forwardDenial };
