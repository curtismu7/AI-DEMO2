'use strict';
/**
 * opikTurnTrace.js — fire-and-forget Opik trace for one /api/demo-agent/nl chat turn.
 *
 * The BFF holds no Opik key, so the record is POSTed to the langchain_agent's
 * POST /opik/trace (same internal-secret hop as routes/agentOpik.js), which owns
 * the key and writes the trace. Never awaited by the chat path, never throws.
 *
 * Metadata only by default (mode, route, action name, timing, errors). Prompt and
 * reply text leave the BFF only for LLM turns and only when OPIK_BFF_TRACE_CONTENT=1
 * (redacted, 500 chars). Tool args/results/tokens are never sent.
 * OPIK_BFF_TRACE=0 switches it off. Skipped under jest (NODE_ENV=test).
 */
const axios = require('axios');
const { internalSecret } = require('../utils/internalSecret');
const { redactMessage } = require('../utils/logRedact');

const MAX_CONTENT = 500;
const DOWN_MS = 60000;
let downUntil = 0; // drop-if-down guard: skip posts for a minute after a failure

function agentBase() {
  return process.env.LANGCHAIN_AGENT_HTTP_URL || 'http://langchain-agent:8888';
}

function clip(text) {
  return redactMessage(String(text ?? '')).slice(0, MAX_CONTENT);
}

function actionName(result) {
  if (!result || typeof result !== 'object') return null;
  if (result.kind === 'banking') return result.banking?.action || null;
  if (result.kind === 'education') return `edu:${result.education?.panel || 'unknown'}`;
  return result.action || result.kind || null;
}

/**
 * Build the compact record. Pure — exported for tests.
 * @param {{req:object, provider:string, vertical?:string, startMs:number, endMs:number,
 *   parsed?:{source:string,result:object,llm_attempted?:boolean,cache_hit?:boolean}, error?:Error, message?:string}} o
 */
function buildRecord({ req, provider, vertical, startMs, endMs, parsed, error, message }) {
  const source = parsed?.source;
  const err = error?.code === 'llm_policy_denied' ? { type: 'PrivilegePolicyDenied', message: error.reason || error.message }
    : error?.code === 'llm_rate_limited' ? { type: 'PrivilegeRateLimited', message: error.message }
    : error ? { type: 'NlParseError', message: error.message } : null;
  const llmError = error && (error.code === 'llm_policy_denied' || error.code === 'llm_rate_limited');
  // An LLM was called when the answer came from one, or the parser says it tried (a cache hit did not call).
  const llmCalled = !!llmError || (!!parsed && !parsed.cache_hit && (source !== 'heuristic' || parsed.llm_attempted === true));
  const mode = llmCalled
    ? (provider && provider !== 'auto' ? provider : String(source || 'llm').replace(/_fallback$/, ''))
    : 'bff-heuristic';
  const withContent = llmCalled && process.env.OPIK_BFF_TRACE_CONTENT === '1';
  const action = actionName(parsed?.result);

  const spans = [{
    name: 'intent', type: 'general', start_ms: startMs, end_ms: endMs,
    output: `source=${source || 'error'}${action ? ` action=${action}` : ''}`,
  }];
  if (llmCalled) {
    const span = { name: `llm.${mode}`, type: 'llm', start_ms: startMs, end_ms: endMs, provider: mode };
    if (err) span.error = err;
    if (withContent) { span.input = clip(message); if (parsed?.result?.message) span.output = clip(parsed.result.message); }
    spans.push(span);
  }
  const rec = {
    name: 'bff.nl',
    thread_id: req?.session?.id || req?.sessionID || undefined,
    start_ms: startMs,
    end_ms: endMs,
    tags: ['bff', mode, `source:${llmCalled ? 'llm' : 'heuristic'}`, `vertical:${vertical || 'default'}`],
    spans,
  };
  if (err) rec.error = err;
  if (withContent) { rec.input = clip(message); if (parsed?.result?.message) rec.output = clip(parsed.result.message); }
  return rec;
}

/** Queue one turn trace. Returns immediately; swallows every failure. */
function traceNlTurn(o) {
  try {
    if (process.env.NODE_ENV === 'test' || process.env.OPIK_BFF_TRACE === '0') return;
    if (Date.now() < downUntil) return;
    axios.post(`${agentBase()}/opik/trace`, buildRecord(o), {
      headers: { 'x-internal-gateway-secret': internalSecret() },
      timeout: 2000,
      validateStatus: () => true,
    }).then((r) => {
      if (r.status >= 300) downUntil = Date.now() + DOWN_MS;
      else if (r.data?.enabled === false) downUntil = Date.now() + 10 * DOWN_MS; // no Opik key: stop asking
    }).catch(() => { downUntil = Date.now() + DOWN_MS; });
  } catch (_e) { /* tracing must never affect the chat turn */ }
}

module.exports = { traceNlTurn, buildRecord, _resetForTest: () => { downUntil = 0; } };
