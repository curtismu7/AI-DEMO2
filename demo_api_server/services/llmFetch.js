/**
 * Shared LLM fetch ladder (demo hardening Phase 2) — the helixLlmService
 * pattern (helixFetch/helixFetchWithRetry) extracted for every provider:
 *   1. hard AbortController timeout per attempt,
 *   2. one transport retry with a fresh connection (Connection: close),
 *   3. one retry on 429/5xx honoring Retry-After (opt-out via retryOn429:false
 *      for providers with their own quota strategy, e.g. gemini model rotation).
 * HTTP error statuses are RETURNED, never thrown — callers keep their own
 * status handling and error message formats.
 */
'use strict';

const envTimeout = parseInt(process.env.LLM_FETCH_TIMEOUT_MS || '', 10);
// Hang guard, not a latency target: stays under the UI's 60s local-provider
// budget on /api/demo-agent/nl (AIAgent.js) without cutting off slow big-model
// replies. Remote providers with a 15s client budget pass a tighter timeoutMs.
const DEFAULT_LLM_TIMEOUT_MS = Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : 55000;

async function llmFetch(url, options = {}, { label = 'llm', timeoutMs = DEFAULT_LLM_TIMEOUT_MS, retryOn429 = true } = {}) {
  async function attempt(extraHeaders = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {
        ...options,
        headers: { ...(options.headers || {}), ...extraHeaders },
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error(`${label} timed out after ${timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  let res;
  try {
    res = await attempt();
  } catch (err) {
    // Timeouts are not transport blips — surface them without a retry.
    if (/timed out after/.test(err.message)) throw err;
    console.warn(`[llmFetch] ${label} transport error — retrying once with a fresh connection:`, err.message);
    await new Promise((r) => setTimeout(r, 250));
    res = await attempt({ Connection: 'close' });
  }

  if (retryOn429 && (res.status === 429 || res.status >= 500)) {
    const retryAfter = parseInt(res.headers?.get?.('Retry-After') ?? '', 10);
    // Cap the honored Retry-After: the client gives up long before a large
    // value elapses, and an HTTP-date Retry-After parses to NaN → default.
    const backoffMs = Math.min(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000, 5000);
    console.warn(`[llmFetch] ${label} got ${res.status} — retrying in ${backoffMs}ms`);
    await new Promise((r) => setTimeout(r, backoffMs));
    return attempt();
  }

  // Detect provider content-policy blocks before returning to callers.
  // HTTP 400 is the common status for safety refusals across OpenAI-compatible,
  // Gemini, and llamacpp providers; the body signals which it is.
  if (res.status === 400) {
    let body;
    try {
      body = await res.clone().text();
    } catch (_) { /* ignore read failure */ }
    if (body && (/safety|content_filter|HARM_CATEGORY|content_policy/i).test(body)) {
      const err = new Error('Request blocked by content policy');
      err.code = 'CONTENT_POLICY_VIOLATION';
      err.status = 422;
      throw err;
    }
  }

  return res;
}

module.exports = { llmFetch, DEFAULT_LLM_TIMEOUT_MS };
