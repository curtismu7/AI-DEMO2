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
//   /llm/openai/v1/chat/completions    OpenAI-compatible (same shape as google)
// Both error envelopes expose the message at data.error.message, so denial
// handling is shared.

const { llmFetch } = require('./llmFetch');

const DEFAULT_MODEL_GOOGLE = 'gemini-2.0-flash';
const DEFAULT_MODEL_ANTHROPIC = 'claude-haiku-4-5-20251001';
const DEFAULT_MODEL_OPENAI = 'gpt-4o-mini';
const ANTHROPIC_VERSION = '2023-06-01';

// The lanes, and the ONLY place their routes live. privilegeMcpClient.js used to
// keep a second copy for display, which meant the panel could confidently print a
// path the code no longer called. Import LANES instead of restating them.
const LANES = {
  anthropic: { route: '/llm/anthropic/v1/messages', defaultModel: DEFAULT_MODEL_ANTHROPIC, keyEnv: 'PRIVILEGE_LLM_VIRTUAL_KEY_ANTHROPIC' },
  google: { route: '/llm/google/v1/chat/completions', defaultModel: DEFAULT_MODEL_GOOGLE, keyEnv: 'PRIVILEGE_LLM_VIRTUAL_KEY_GOOGLE' },
  openai: { route: '/llm/openai/v1/chat/completions', defaultModel: DEFAULT_MODEL_OPENAI, keyEnv: 'PRIVILEGE_LLM_VIRTUAL_KEY_OPENAI' },
};

// A route override arrives from the browser, so it is a trust boundary: the server
// owns the origin and the caller may only steer the PATH, to a shape that looks like
// a gateway LLM route. Without this the panel could aim a server-side, credentialed
// fetch at any path on the gateway host.
const ROUTE_SHAPE = /^\/llm\/[a-z0-9-]+\/v1\/[a-z0-9/-]+$/;

function resolveRoute(lane, override) {
  if (override === undefined || override === null || override === '') return LANES[lane].route;
  const route = String(override).trim();
  if (route.length > 128 || route.includes('..') || route.includes('//') || !ROUTE_SHAPE.test(route)) {
    const err = new Error(`Invalid route "${route}" — expected a path like ${LANES[lane].route}`);
    err.code = 'llm_bad_route';
    throw err;
  }
  return route;
}

function gatewayUrl() {
  return process.env.PRIVILEGE_LLM_GATEWAY_URL || '';
}

/**
 * The provider's own model catalog, fetched through the gateway with the
 * lane's virtual key. NOT filtered to what that key is actually allowed to
 * use — Privilege enforces the per-key model allowlist on the chat-completions
 * call itself (a 403 there), not on this endpoint — so this is only useful
 * to confirm a model name is real, not that this key can use it.
 * @param {'anthropic'|'google'|'openai'} lane
 */
async function listModels(lane) {
  const base = gatewayUrl();
  const key = process.env[LANES[lane].keyEnv] || '';
  if (!base) throw new Error('PRIVILEGE_LLM_GATEWAY_URL not configured');
  if (!key) throw new Error(`${LANES[lane].keyEnv} not configured`);

  const url = `${base.replace(/\/+$/, '')}/llm/${lane}/v1/models`;
  const res = await llmFetch(url, {
    headers: { Authorization: `Bearer ${key}` },
  }, { label: `privilege-llm-${lane}-models`, timeoutMs: 10000, retryOn429: false });
  const data = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, data };
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
  const url = `${base.replace(/\/+$/, '')}${resolveRoute('google', config.route)}`;
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

  const url = `${base.replace(/\/+$/, '')}${resolveRoute('anthropic', config.route)}`;
  const res = await llmFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify({ model, max_tokens: config.max_tokens || 512, system: system || undefined, messages: turns }),
  }, { label: 'privilege-llm-anthropic', timeoutMs: 12000, retryOn429: false });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throwForResponse(res, data, 'anthropic');

  const text = data?.content?.[0]?.text;
  if (!text) throw new Error('Privilege LLM proxy (anthropic) returned empty response');
  return text;
}

/**
 * Call OpenAI through the Privilege virtual key and return assistant text.
 * OpenAI-compatible wire shape — the same as the Google lane, NOT Anthropic's:
 * `system` stays a message role and the reply is at choices[0].message.content.
 * Throws an Error with `code: 'llm_policy_denied'` when Privilege's policy
 * layer denies the request.
 * @param {Array<{role: string, content: string}>} messages
 * @param {object} [config]
 * @returns {Promise<string>}
 */
async function callPrivilegeOpenAI(messages, config = {}) {
  const base = gatewayUrl();
  const key = process.env.PRIVILEGE_LLM_VIRTUAL_KEY_OPENAI || '';
  if (!base) throw new Error('PRIVILEGE_LLM_GATEWAY_URL not configured');
  if (!key) throw new Error('PRIVILEGE_LLM_VIRTUAL_KEY_OPENAI not configured');

  const model = config.openai_model || config.model || process.env.PRIVILEGE_LLM_MODEL_OPENAI || DEFAULT_MODEL_OPENAI;

  const url = `${base.replace(/\/+$/, '')}${resolveRoute('openai', config.route)}`;
  const res = await llmFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ model, max_tokens: config.max_tokens || 512, messages }),
  }, { label: 'privilege-llm-openai', timeoutMs: 12000, retryOn429: false });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throwForResponse(res, data, 'openai');

  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('Privilege LLM proxy (openai) returned empty response');
  return text;
}

module.exports = {
  LANES,
  resolveRoute,
  listModels,
  callPrivilegeGemini,
  callPrivilegeClaude,
  callPrivilegeOpenAI,
  DEFAULT_MODEL_GOOGLE,
  DEFAULT_MODEL_ANTHROPIC,
  DEFAULT_MODEL_OPENAI,
};
