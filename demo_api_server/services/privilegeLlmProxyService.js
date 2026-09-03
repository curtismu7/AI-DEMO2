// demo_api_server/services/privilegeLlmProxyService.js
//
// Calls Google Gemini through a PingOne Privilege virtual key: an
// OpenAI-compatible proxy that injects the real Google API key server-side
// and can deny the request by Privilege policy before it reaches Google.
// Sibling to googleGeminiLlmService.js (same call shape), OpenAI-compatible
// instead of Gemini-native.

const { llmFetch } = require('./llmFetch');

const DEFAULT_MODEL = 'gemini-2.0-flash';

function gatewayUrl() {
  return process.env.PRIVILEGE_LLM_GATEWAY_URL || '';
}

function virtualKey() {
  return process.env.PRIVILEGE_LLM_VIRTUAL_KEY_GOOGLE || '';
}

function modelName(config = {}) {
  return config.google_model || config.model || process.env.PRIVILEGE_LLM_MODEL || DEFAULT_MODEL;
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
  const key = virtualKey();
  if (!base) throw new Error('PRIVILEGE_LLM_GATEWAY_URL not configured');
  if (!key) throw new Error('PRIVILEGE_LLM_VIRTUAL_KEY_GOOGLE not configured');

  const url = `${base.replace(/\/+$/, '')}/llm/google/v1/chat/completions`;
  const res = await llmFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ model: modelName(config), messages }),
  }, { label: 'privilege-llm', timeoutMs: 12000, retryOn429: false });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg = data?.error?.message || res.statusText || String(res.status);
    // Unverified against the live gateway: treat any denial-shaped 4xx as a
    // policy block until the real response shape is confirmed empirically.
    if (res.status === 403 || res.status === 400) {
      const err = new Error(msg);
      err.code = 'llm_policy_denied';
      err.reason = msg;
      throw err;
    }
    throw new Error(`Privilege LLM proxy ${res.status}: ${msg}`);
  }

  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('Privilege LLM proxy returned empty response');
  return text;
}

module.exports = { callPrivilegeGemini, DEFAULT_MODEL };
