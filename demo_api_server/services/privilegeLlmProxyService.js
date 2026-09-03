// demo_api_server/services/privilegeLlmProxyService.js
//
// Calls an LLM provider through a PingOne Privilege virtual key: a gateway
// that injects the real provider API key server-side and can deny the
// request by Privilege policy before it ever reaches the provider.
//
// Two routes on the same gateway, two different wire shapes — verified live
// against https://mcpgw.ai-demo.ping-devops.com 2026-09-03:
//   /llm/google/v1/chat/completions    OpenAI-compatible (googleGeminiLlmService.js sibling)
//   /llm/anthropic/v1/messages         native Anthropic Messages API (requires
//                                      anthropic-version header, system is a
//                                      top-level field, not a message role)
// Both error envelopes expose the message at data.error.message, so denial
// handling is shared.

const { llmFetch } = require('./llmFetch');

const DEFAULT_MODEL_GOOGLE = 'gemini-2.0-flash';
const DEFAULT_MODEL_ANTHROPIC = 'claude-haiku-4-5-20251001';
const ANTHROPIC_VERSION = '2023-06-01';

function gatewayUrl() {
  return process.env.PRIVILEGE_LLM_GATEWAY_URL || '';
}

/** Denial (400/403) vs any other failure — shared by both providers. */
function throwForResponse(res, data, label) {
  const msg = data?.error?.message || res.statusText || String(res.status);
  if (res.status === 403 || res.status === 400) {
    const err = new Error(msg);
    err.code = 'llm_policy_denied';
    err.reason = msg;
    err.provider = label;
    throw err;
  }
  throw new Error(`Privilege LLM proxy (${label}) ${res.status}: ${msg}`);
}

/**
 * Call Gemini through the Privilege virtual key and return assistant text.
 * Throws an Error with `code: 'llm_policy_denied'` when Privilege's policy
 * layer denies the request (surfaced to the UI as a structured block, not a
 * generic failure).
 * @param {Array<{role: string, content: string}>} messages
 * @param {object} [config]
 * @returns {Promise<string>}
 */
async function callPrivilegeGemini(messages, config = {}) {
  const base = gatewayUrl();
  const key = process.env.PRIVILEGE_LLM_VIRTUAL_KEY_GOOGLE || '';
  if (!base) throw new Error('PRIVILEGE_LLM_GATEWAY_URL not configured');
  if (!key) throw new Error('PRIVILEGE_LLM_VIRTUAL_KEY_GOOGLE not configured');

  const model = config.google_model || config.model || process.env.PRIVILEGE_LLM_MODEL || DEFAULT_MODEL_GOOGLE;
  const url = `${base.replace(/\/+$/, '')}/llm/google/v1/chat/completions`;
  const res = await llmFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ model, messages }),
  }, { label: 'privilege-llm-google', timeoutMs: 12000, retryOn429: false });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throwForResponse(res, data, 'google');

  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('Privilege LLM proxy (google) returned empty response');
  return text;
}

/**
 * Call Claude through the Privilege virtual key and return assistant text.
 * Same denial contract as callPrivilegeGemini.
 * @param {Array<{role: string, content: string}>} messages
 * @param {object} [config]
 * @returns {Promise<string>}
 */
async function callPrivilegeClaude(messages, config = {}) {
  const base = gatewayUrl();
  const key = process.env.PRIVILEGE_LLM_VIRTUAL_KEY_ANTHROPIC || '';
  if (!base) throw new Error('PRIVILEGE_LLM_GATEWAY_URL not configured');
  if (!key) throw new Error('PRIVILEGE_LLM_VIRTUAL_KEY_ANTHROPIC not configured');

  const model = config.anthropic_model || config.model || process.env.PRIVILEGE_LLM_MODEL_ANTHROPIC || DEFAULT_MODEL_ANTHROPIC;
  // Anthropic's Messages API takes system as a top-level field, not a message role.
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const turns = messages.filter((m) => m.role !== 'system');

  const url = `${base.replace(/\/+$/, '')}/llm/anthropic/v1/messages`;
  const res = await llmFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({ model, max_tokens: 512, system: system || undefined, messages: turns }),
  }, { label: 'privilege-llm-anthropic', timeoutMs: 12000, retryOn429: false });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throwForResponse(res, data, 'anthropic');

  const text = data?.content?.[0]?.text;
  if (!text) throw new Error('Privilege LLM proxy (anthropic) returned empty response');
  return text;
}

module.exports = { callPrivilegeGemini, callPrivilegeClaude, DEFAULT_MODEL_GOOGLE, DEFAULT_MODEL_ANTHROPIC };
