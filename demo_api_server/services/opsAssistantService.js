'use strict';
const { getCustomerContext } = require('./verticalOpsData');
const { buildOpsSystemPrompt } = require('../config/ops/systemPrompt');
const RESPONSES = require('../config/ops/responses');
const { runReasonLoop } = require('./agentReasoningClient');
const { resolveLlmProvider } = require('./llmProviderResolver');

function _extractHelixConfig(cfg = {}) {
  return {
    helix_base_url: cfg.helix_base_url || '',
    helix_api_key: cfg.helix_api_key || '',
    helix_environment_id: cfg.helix_environment_id || '',
    helix_agent_id: cfg.helix_agent_id || '',
    helix_prompt_field_id: cfg.helix_prompt_field_id || '',
  };
}

async function processOpsMessage({ vertical, query, message, history = [], langchainConfig = {} }) {
  const { customer, records } = getCustomerContext(vertical, query);
  if (!customer) {
    return { reply: RESPONSES.noCustomer.userMessage, success: true, toolsCalled: [], inputTokens: 0, outputTokens: 0, agentConfigured: true };
  }

  const { provider, model } = resolveLlmProvider({ ...langchainConfig, provider: undefined });
  const systemPrompt = buildOpsSystemPrompt({ vertical, customer, records });
  const messages = [...history.filter((m) => m && m.role && m.content), { role: 'user', content: message }];

  const loop = await runReasonLoop({
    messages,
    tools: [],                                   // READ-ONLY: no tools
    provider,
    model,
    systemPrompt,
    helixConfig: _extractHelixConfig(langchainConfig),
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    maxIterations: 1,
    executeTool: async () => '',                 // never called (no tools)
  });

  // A 200-but-empty answer is not a success (see demoAgentLangGraphService) —
  // treat it as reasoning_unavailable so the honest error reply wins instead
  // of a blank success:true bubble.
  if (loop.ok && !String(loop.answer || '').trim()) {
    loop.ok = false;
    loop.reason = loop.reason || 'empty_answer';
  }
  if (loop.ok) {
    return { reply: loop.answer, success: true, toolsCalled: [], inputTokens: loop.inputTokens || 0, outputTokens: loop.outputTokens || 0, agentConfigured: true };
  }
  return { reply: RESPONSES.reasoningUnavailable(loop.reason || 'unknown').userMessage, success: false, toolsCalled: [], inputTokens: 0, outputTokens: 0, agentConfigured: true, error: loop.reason || 'reasoning_failed' };
}

module.exports = { processOpsMessage };
