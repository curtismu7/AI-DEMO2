'use strict';

const appEventService = require('./appEventService');
const { buildOpsSystemPrompt } = require('../config/ops/systemPrompt');
const { noCustomer, reasoningUnavailable } = require('../config/ops/responses');

/**
 * Build system prompt for Ops Assistant.
 * Reads customer records and grounds the assistant in their data.
 *
 * Returns: { prompt, success, error? }
 */
async function buildOpsPrompt({ vertical, customer, records }) {
  try {
    appEventService.logEvent('agent', 'info', 'Ops assistant building prompt…', { tag: 'agent/ops_prompt' });

    if (!customer) {
      return {
        prompt: null,
        success: false,
        error: noCustomer.code,
        message: noCustomer.userMessage,
      };
    }

    const prompt = buildOpsSystemPrompt({ vertical, customer, records });

    return {
      prompt,
      success: true,
      error: null,
    };
  } catch (err) {
    console.error('[opsAgentService] Failed to build ops prompt:', err.message);
    return {
      prompt: null,
      success: false,
      error: reasoningUnavailable().code,
      message: reasoningUnavailable().userMessage,
    };
  }
}

module.exports = {
  buildOpsPrompt,
};
