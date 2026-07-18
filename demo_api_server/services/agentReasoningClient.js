// banking_api_server/services/agentReasoningClient.js
// BFF drives the reason loop and EXECUTES tools (token custody + HITL stay
// here). :3006 only proposes tool calls / returns a final answer. On
// reasoningUnavailable or transport failure → signal heuristic-fallback
// (ARCHITECTURE-TRUTHS T-3 floor). Recursion cap enforced here.
const axios = require('axios');
const configStore = require('./configStore');

const REASON_URL =
  (process.env.AGENT_SERVICE_URL || 'http://localhost:3006') + '/api/agent/reason';

/**
 * Label a cut-off answer. A truncated reply is otherwise indistinguishable from a
 * complete one — it just stops mid-sentence — so the user has no way to know the
 * model ran out of room. Keep the partial answer (usually mostly useful) and say so.
 * Callers pass loopResult.truncated straight through; no-op when false.
 * @param {string} answer
 * @param {boolean} truncated
 * @returns {string}
 */
function withTruncationNotice(answer, truncated) {
  if (!truncated) return answer;
  return `${answer || ''}\n\n⚠️ This answer was cut off — it reached the response length limit. ` +
    'Ask a narrower question, or raise the response limit (LLAMACPP_MAX_TOKENS) if this keeps happening.';
}

/** Resolve Google/Gemini API key from configStore or env (never a user token). */
function resolveGoogleApiKey(override) {
  return override ||
    configStore.getEffective('google_api_key') ||
    process.env.GOOGLE_API_KEY ||
    process.env.GEMINI_API_KEY ||
    '';
}

/** Resolve GroqCloud API key from configStore or env (never a user token). */
function resolveGroqApiKey(override) {
  return override ||
    configStore.getEffective('groq_api_key') ||
    process.env.GROQ_API_KEY ||
    '';
}

async function runReasonLoop(p) {
  // Prefer configStore (vault-loaded value) over process.env so that the vault
  // secret for BFF_INTERNAL_SECRET reaches :3006 correctly. The vault loads
  // into configStore (not process.env) at BFF startup, so process.env holds
  // only the .env fallback value which may differ from what :3006 loaded.
  const secret = configStore.getEffective('BFF_INTERNAL_SECRET') || process.env.BFF_INTERNAL_SECRET || '';
  let messages = p.messages;
  // Loop guard: terminate the moment a tool result is TERMINAL (e.g. an admin
  // token hit a customer tool), or the model re-issues an IDENTICAL tool call
  // that produces the IDENTICAL result (no state progress — the model is stuck).
  // We compare result too, so legitimate repeat-reads (e.g. re-checking balance
  // after a transfer, which returns a CHANGED result) are not falsely stopped.
  // Without this the model can re-propose the same failing call up to
  // maxIterations times — the visible "show my accounts" loop.
  const seenCalls = new Map(); // sig -> last result string
  for (let i = 0; i < p.maxIterations; i++) {
    let resp;
    try {
      resp = await axios.post(
        REASON_URL,
        {
          messages, tools: p.tools, provider: p.provider, model: p.model,
          systemPrompt: p.systemPrompt,
          helixConfig: p.helixConfig,
          // Anthropic API key forwarded from BFF env; never a user token
          anthropicApiKey: p.anthropicApiKey,
          googleApiKey: resolveGoogleApiKey(p.googleApiKey),
          groqApiKey: resolveGroqApiKey(p.groqApiKey),
        },
        { headers: { 'x-internal-gateway-secret': secret }, timeout: 70000 },
      );
    } catch (err) {
      return { ok: false, reason: 'reasoning_unavailable' };
    }
    const data = resp.data;
    if (data.type === 'final') {
      if (data.reasoningUnavailable) return { ok: false, reason: 'reasoning_unavailable' };
      // `truncated`: the model hit its token ceiling, so `answer` is cut off. Keep
      // the partial answer (it is usually mostly useful) but pass the flag up so the
      // caller labels it — a cut-off answer must never look like a complete one.
      // Only present when true, so the untruncated shape is unchanged for callers.
      return {
        ok: true,
        answer: data.answer,
        ...(data.truncated === true ? { truncated: true } : {}),
        inputTokens: data.inputTokens ?? 0,
        outputTokens: data.outputTokens ?? 0,
      };
    }
    if (data.type === 'tool_calls') {
      const toolMessages = [];
      for (const call of data.calls) {
        const sig = `${call.name}|${JSON.stringify(call.args || {})}`;
        const result = await p.executeTool(call.name, call.args);
        const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
        // Parse the result to detect a terminal signal (e.g. requiresCustomerLogin).
        let parsed = null;
        if (result && typeof result === 'object') parsed = result;
        else if (typeof result === 'string') { try { parsed = JSON.parse(result); } catch (_) { parsed = null; } }
        if (parsed && (parsed.terminal || parsed.requiresCustomerLogin)) {
          return { ok: false, reason: 'tool_terminal', toolResult: parsed };
        }
        // Same call + same result as a prior iteration → no progress, stop.
        if (seenCalls.get(sig) === resultStr) {
          return { ok: false, reason: 'repeated_tool_call', toolResult: parsed };
        }
        seenCalls.set(sig, resultStr);
        toolMessages.push({ role: 'tool', content: resultStr, tool_call_id: call.id });
      }
      messages = [...(data.messages || messages), ...toolMessages];
      continue;
    }
    return { ok: false, reason: 'reasoning_unavailable' };
  }
  return { ok: false, reason: 'max_iterations' };
}

module.exports = { runReasonLoop, resolveGoogleApiKey, withTruncationNotice };
