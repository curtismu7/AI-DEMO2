'use strict';

const appEventService = require('./appEventService');
const configStore = require('./configStore');
const { buildAdminToolSchemas, executeAdminTool } = require('../config/admin/tools');
const { buildAdminSystemPrompt } = require('../config/admin/systemPrompt');
const { toolsUnavailable, maxIterationsReached, reasoningUnavailable } = require('../config/admin/responses');

const LOG_FULL_PROMPTS = process.env.LOG_FULL_PROMPTS === 'true';
const MAX_TOOL_ITERATIONS = 10;

function _fingerprint(msg) {
  const { createHash } = require('crypto');
  return createHash('sha256').update(String(msg)).digest('hex').slice(0, 8);
}

function _extractHelixConfig(langchainConfig = {}) {
  const cfg = langchainConfig || {};
  return {
    helix_base_url:        cfg.helix_base_url        || configStore.getEffective('helix_base_url')        || '',
    helix_api_key:         cfg.helix_api_key          || configStore.getEffective('helix_api_key')          || '',
    helix_environment_id:  cfg.helix_environment_id   || configStore.getEffective('helix_environment_id')   || '',
    helix_agent_id:        cfg.helix_agent_id         || configStore.getEffective('helix_agent_id')         || '',
    helix_prompt_field_id: cfg.helix_prompt_field_id  || configStore.getEffective('helix_prompt_field_id')  || '',
  };
}

/**
 * Process an admin agent message.
 * Uses the hosted PingOne MCP server (HTTP) via worker client_credentials — no RFC 8693 exchange.
 *
 * Returns the same response envelope as processAgentMessage in demoAgentLangGraphService:
 *   { reply, success, toolsCalled, inputTokens?, outputTokens?, tokenEvents, requiresConsent, agentConfigured, error? }
 */
async function processAdminMessage({ message, userId, sessionId, tokenEvents = [], langchainConfig = {}, req = null }) {
  try {
    appEventService.logEvent('agent', 'info', 'Admin agent processing message…', { tag: 'agent/admin_message' });

    if (LOG_FULL_PROMPTS) {
      appEventService.logEvent('agent_prompt', 'info', `Admin LLM prompt: ${String(message)}`,
        { tag: 'agent_prompt/llm_invoke', metadata: { userId, sessionId, messageLength: message?.length || 0, prompt: String(message) } });
    } else {
      appEventService.logEvent('agent_prompt', 'info', `Admin LLM prompt (${_fingerprint(message)})`,
        { tag: 'agent_prompt/llm_invoke', metadata: { userId, sessionId, messageLength: message?.length || 0, promptFingerprint: _fingerprint(message) } });
    }

    const { resolveLlmProvider } = require('./llmProviderResolver');
    const { runReasonLoop } = require('./agentReasoningClient');
    const { provider: llmProvider, model: llmModel } = resolveLlmProvider(
      { ...langchainConfig, provider: undefined }
    );

    let toolSchemas;
    try {
      toolSchemas = await buildAdminToolSchemas();
    } catch (schemaErr) {
      console.error('[adminAgentService] Failed to build admin tool schemas:', schemaErr.message);
      return {
        reply: toolsUnavailable(),
        success: false,
        toolsCalled: [],
        tokensUsed: 0,
        requiresConsent: false,
        agentConfigured: true,
        tokenEvents: tokenEvents || [],
        error: 'pingone_tools_unavailable',
      };
    }

    // Build worker token event card — best-effort; never blocks the reply.
    try {
      const { getWorkerTokenDecoded } = require('./mcpPingOneHttpAdapter');
      const { buildTokenEvent } = require('./agentMcpTokenService');
      const decoded = await getWorkerTokenDecoded();
      tokenEvents.push(buildTokenEvent(
        'pingone-worker-token',
        'PingOne Worker Token (client_credentials)',
        decoded ? 'active' : 'warning',
        decoded,
        'Single-actor worker token (RFC 6749 §4.4 client_credentials) the BFF presents to the ' +
        'hosted PingOne MCP server. No user subject, no act chain — the worker app\'s admin roles ' +
        'authorize the management tools directly.',
        { rfc: 'RFC 6749 §4.4', tokenType: 'actor' },
      ));
    } catch (cardErr) {
      console.warn('[adminAgentService] Worker token card failed:', cardErr.message);
    }

    const systemPrompt = buildAdminSystemPrompt();

    const loopResult = await runReasonLoop({
      messages: [{ role: 'user', content: message }],
      tools: toolSchemas,
      provider: llmProvider,
      model: llmModel,
      systemPrompt,
      helixConfig: _extractHelixConfig(langchainConfig),
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      maxIterations: MAX_TOOL_ITERATIONS,
      executeTool: executeAdminTool,
    });

    if (loopResult.ok) {
      appEventService.logEvent('agent', 'info', 'Admin agent response ready', { tag: 'agent/admin_complete' });
      return {
        reply: loopResult.answer,
        success: true,
        toolsCalled: [],
        inputTokens: loopResult.inputTokens ?? 0,
        outputTokens: loopResult.outputTokens ?? 0,
        requiresConsent: false,
        agentConfigured: true,
        tokenEvents: tokenEvents || [],
        agentHeader: '🤖 [ADMIN AGENT - LangGraph - Claude 3.5 Sonnet]',
        metadata: {
          framework: 'LangGraph',
          model: 'Claude 3.5 Sonnet',
          agentType: 'admin',
          features: ['MCP tools', 'state graphs', 'RFC 8693 tokens']
        }
      };
    }

    return {
      reply: loopResult.reason === 'max_iterations' ? maxIterationsReached() : reasoningUnavailable(),
      success: false,
      toolsCalled: [],
      tokensUsed: 0,
      requiresConsent: false,
      agentConfigured: true,
      tokenEvents: tokenEvents || [],
      error: loopResult.reason || 'reasoning_unavailable',
      agentHeader: '🤖 [ADMIN AGENT - LangGraph - Claude 3.5 Sonnet]',
      metadata: {
        framework: 'LangGraph',
        model: 'Claude 3.5 Sonnet',
        agentType: 'admin'
      }
    };
  } catch (err) {
    console.error('[adminAgentService] Unhandled error:', err.message);
    return {
      reply: reasoningUnavailable(),
      success: false,
      toolsCalled: [],
      tokensUsed: 0,
      requiresConsent: false,
      agentConfigured: true,
      tokenEvents: tokenEvents || [],
      error: 'internal_error',
      agentHeader: '🤖 [ADMIN AGENT - LangGraph - Claude 3.5 Sonnet]',
      metadata: {
        framework: 'LangGraph',
        model: 'Claude 3.5 Sonnet',
        agentType: 'admin'
      }
    };
  }
}

module.exports = { processAdminMessage };
