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

/**
 * Record a Token Chain step for one admin tool execution — shared by the LLM
 * reason loop's executeTool wrapper AND the heuristic-first dispatch, so a
 * heuristic-routed call is exactly as visible in the rail as a model-routed
 * one. executeAdminTool never rejects on a real PingOne failure — it resolves
 * with a JSON-stringified { error, message } (config/admin/tools.js) — so the
 * error is detected from the resolved payload. Returns the parsed error (or
 * null) so callers can branch.
 */
function recordAdminToolStep(tokenEvents, name, args, result, startedAt) {
  const { buildTokenEvent } = require('./agentMcpTokenService');
  let resolvedError = null;
  try {
    const parsed = JSON.parse(result);
    if (parsed && typeof parsed === 'object' && parsed.error) {
      resolvedError = parsed;
    }
  } catch (_parseErr) {
    // Not JSON, or not an error payload — a normal success result.
  }
  if (resolvedError) {
    tokenEvents.push(buildTokenEvent(
      `pingone-admin-api:${name}`,
      `PingOne Admin API — ${name}`,
      'failed',
      null,
      `Admin agent's PingOne Management API tool "${name}" failed: ${resolvedError.message || resolvedError.error}`,
      { tool: name, args, error: resolvedError.message || resolvedError.error },
    ));
  } else {
    tokenEvents.push(buildTokenEvent(
      `pingone-admin-api:${name}`,
      `PingOne Admin API — ${name}`,
      'success',
      null,
      `Admin agent called PingOne Management API tool "${name}" (${Date.now() - startedAt}ms).`,
      { tool: name, args, durationMs: Date.now() - startedAt },
    ));
  }
  return resolvedError;
}

/**
 * Deterministic reply for a heuristic-dispatched admin tool result — the
 * same envelope the tool hands the LLM (responseSummary/rows/totalCount/
 * rowsTruncated from config/verticals/pingone-admin/tools.js), rendered as
 * prose without a model in the loop.
 */
function formatAdminToolReply(action, result, params) {
  if (action === 'list_pingone_tools') {
    const names = (result.tools || []).map((t) => `- ${t.name}`).join('\n');
    return `Available PingOne tools:\n${names}\n\nSource: ${result.source || 'unknown'}`;
  }
  const lines = [result.responseSummary || 'Done.'];
  if (Array.isArray(result.rows) && result.rows.length) {
    lines.push('');
    for (const row of result.rows) {
      const label = row.username || row.name || JSON.stringify(row);
      const extra = row.email && row.email !== row.username ? ` (${row.email})`
        : row.type ? ` — ${row.type}`
        : row.description ? ` — ${row.description}`
        : '';
      lines.push(`- ${label}${extra}`);
    }
    if (result.rowsTruncated && result.totalCount) {
      lines.push(`\nShowing the first ${result.rows.length} of ${result.totalCount}.`);
    }
  }
  // Discoverability: nobody knows the prefix filter exists from a bare list
  // (reported live: "we need to have a box that tells them"). Only on
  // UNFILTERED user/app lists — a filtered reply repeating the tip is noise,
  // and populations has no prefix heuristic to advertise.
  const filterHint = {
    listUsers: 'Tip: you can filter — try "users starting with curt", or click the List Users chip to pick a prefix.',
    listApplications: 'Tip: you can filter — try "apps that start with Demo", or click the List Apps chip to pick a prefix. Prefixes are case-sensitive.',
  }[result.tool];
  if (filterHint && !params?.arguments?.filter) {
    lines.push(`\n${filterHint}`);
  }
  lines.push(`\nSource: ${result.source || 'unknown'}`);
  return lines.join('\n');
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
async function processAdminMessage({ message, userId, sessionId, tokenEvents = [], langchainConfig = {}, req = null, customer = null }) {
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
    const { runReasonLoop, withTruncationNotice } = require('./agentReasoningClient');
    // The admin dashboard's demoed LLM is llama.cpp (Heuristics is the other
    // demoed mode) — explicitly requested here rather than left to
    // resolveLlmProvider's own default (Helix), which isn't reliably
    // configured across environments. This is a real explicit selection via
    // the resolver's normal `requested === 'llamacpp'` pass-through, not an
    // inlined default (that would violate the resolver's own "no other
    // module may inline a provider default" rule).
    const { provider: llmProvider, model: llmModel } = resolveLlmProvider(
      { ...langchainConfig, provider: 'llamacpp' }
    );

    // Fallback (Heuristics) routing, honored on THIS vertical too. Typed admin
    // chat always lands here (demoAgentService.sendToAdminAgent), so before
    // this gate the mode picker's "Fallback (Heuristics)" promise was silently
    // ignored and every message rode the LLM — one llama.cpp refusal ("I'm
    // sorry, but I can't help with that", captured in the step-verification
    // fixtures) killed a demo step that the deterministic parser resolves
    // perfectly, filter included. LLM-only mode (ff_heuristic_enabled=false)
    // still bypasses this.
    const heuristicFirst =
      String(configStore.getEffective('ff_heuristic_enabled') ?? 'true') === 'true';
    if (heuristicFirst) {
      try {
        const { parseHeuristic, resolveVerticalCtx } = require('./nlIntentParser');
        const parsed = parseHeuristic(
          message, 'pingone-admin', resolveVerticalCtx('pingone-admin'), {},
        );
        if (
          parsed && parsed.kind === 'vertical' &&
          (parsed.action === 'call_pingone_tool' || parsed.action === 'list_pingone_tools')
        ) {
          const startedAt = Date.now();
          const raw = await executeAdminTool(parsed.action, parsed.params || {});
          // Same Token Chain step the LLM loop records — a heuristic-routed
          // call must be exactly as visible in the rail as a model-routed one.
          const stepError = recordAdminToolStep(
            tokenEvents, parsed.action, parsed.params || {}, raw, startedAt,
          );
          if (!stepError) {
            let result = null;
            try { result = JSON.parse(raw); } catch (_) { /* reply falls back to raw */ }
            if (result) {
              appEventService.logEvent('agent', 'info',
                `Admin heuristic dispatch: ${parsed.action} (${parsed.params?.name || '-'})`,
                { tag: 'agent/admin_heuristic' });
              return {
                reply: formatAdminToolReply(parsed.action, result, parsed.params),
                success: true,
                toolsCalled: [parsed.action],
                tokensUsed: 0,
                requiresConsent: false,
                agentConfigured: true,
                tokenEvents: tokenEvents || [],
              };
            }
          }
          // Tool-level error (failed step already recorded): fall through to
          // the LLM, which can read the live tool list and try another route.
        }
      } catch (heurErr) {
        console.warn('[adminAgentService] heuristic pre-parse failed, using LLM:', heurErr.message);
      }
    }

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

    const systemPrompt = buildAdminSystemPrompt(customer);

    // Scoped separately from the worker-token-card require above (that one is
    // local to its own try block) — needed here to record a Token Chain step
    // for each admin tool call the LLM makes below.
    const { buildTokenEvent } = require('./agentMcpTokenService');

    const loopResult = await runReasonLoop({
      messages: [{ role: 'user', content: message }],
      tools: toolSchemas,
      provider: llmProvider,
      model: llmModel,
      systemPrompt,
      helixConfig: _extractHelixConfig(langchainConfig),
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      maxIterations: MAX_TOOL_ITERATIONS,
      executeTool: async (name, args) => {
        const startedAt = Date.now();
        try {
          const result = await executeAdminTool(name, args);
          // Step recording (success or resolved-error failure) is shared with
          // the heuristic-first path — see recordAdminToolStep.
          recordAdminToolStep(tokenEvents, name, args, result, startedAt);
          return result;
        } catch (err) {
          tokenEvents.push(buildTokenEvent(
            `pingone-admin-api:${name}`,
            `PingOne Admin API — ${name}`,
            'failed',
            null,
            `Admin agent's PingOne Management API tool "${name}" failed: ${err.message}`,
            { tool: name, args, error: err.message },
          ));
          throw err;
        }
      },
    });

    if (loopResult.ok) {
      appEventService.logEvent('agent', 'info', 'Admin agent response ready', { tag: 'agent/admin_complete' });
      if (loopResult.truncated) {
        appEventService.logEvent('agent', 'warning',
          'Admin agent answer was truncated — the model hit its response length limit',
          { tag: 'agent/truncated' });
      }
      const displayModel = llmModel || 'Claude 3.5 Sonnet';
      const rawAnswer = withTruncationNotice(loopResult.answer, loopResult.truncated);
      return {
        // A conversational LLM can return whitespace-only text — truthy to
        // loopResult.ok, but it renders as a blank agent bubble in the UI.
        reply: rawAnswer && rawAnswer.trim() !== ''
          ? rawAnswer
          : "I'm not sure how to help with that one. Try one of the suggested actions, or rephrase your question.",
        truncated: loopResult.truncated || undefined,
        success: true,
        toolsCalled: [],
        inputTokens: loopResult.inputTokens ?? 0,
        outputTokens: loopResult.outputTokens ?? 0,
        requiresConsent: false,
        agentConfigured: true,
        tokenEvents: tokenEvents || [],
        agentHeader: `🤖 [ADMIN AGENT - LangGraph - ${displayModel}]`,
        metadata: {
          framework: 'LangGraph',
          model: displayModel,
          provider: llmProvider,
          agentType: 'admin',
          features: ['MCP tools', 'state graphs', 'RFC 8693 tokens']
        }
      };
    }

    const displayModel = llmModel || 'Claude 3.5 Sonnet';
    return {
      reply: loopResult.reason === 'max_iterations' ? maxIterationsReached() : reasoningUnavailable(),
      success: false,
      toolsCalled: [],
      tokensUsed: 0,
      requiresConsent: false,
      agentConfigured: true,
      tokenEvents: tokenEvents || [],
      error: loopResult.reason || 'reasoning_unavailable',
      agentHeader: `🤖 [ADMIN AGENT - LangGraph - ${displayModel}]`,
      metadata: {
        framework: 'LangGraph',
        model: displayModel,
        provider: llmProvider,
        agentType: 'admin'
      }
    };
  } catch (err) {
    console.error('[adminAgentService] Unhandled error:', err.message);
    // Fallback: if llmModel wasn't captured, get it again
    let displayModel = llmModel;
    if (!displayModel) {
      try {
        const { resolveLlmProvider } = require('./llmProviderResolver');
        const resolved = resolveLlmProvider({ ...langchainConfig, provider: 'llamacpp' });
        displayModel = resolved.model;
      } catch {
        displayModel = 'Claude 3.5 Sonnet';
      }
    }
    return {
      reply: reasoningUnavailable(),
      success: false,
      toolsCalled: [],
      tokensUsed: 0,
      requiresConsent: false,
      agentConfigured: true,
      tokenEvents: tokenEvents || [],
      error: 'internal_error',
      agentHeader: `🤖 [ADMIN AGENT - LangGraph - ${displayModel || 'Claude 3.5 Sonnet'}]`,
      metadata: {
        framework: 'LangGraph',
        model: displayModel || 'Claude 3.5 Sonnet',
        agentType: 'admin'
      }
    };
  }
}

module.exports = { processAdminMessage };
