'use strict';

// Direct-to-provider calls, for comparing against the same call through the Privilege
// gateway. Two sides, one prompt, one model list.
//
// This app deliberately holds NO usable provider key — configStore reports
// anthropic/google/openai as "not available", which is the property the virtual-key
// demo exists to show. So the direct side's key is supplied per request by the
// operator, used for that one call, and never stored, cached or logged. Nothing here
// writes it anywhere, and the caller must keep it out of its response.

const { llmFetch } = require('./llmFetch');

const ANTHROPIC_VERSION = '2023-06-01';

// Where each provider lives without the gateway in front, and how it authenticates.
// `completionPath` is chosen so BOTH sides speak the same wire shape: Anthropic has
// no /chat/completions of its own, so that lane is compared on /messages instead.
const DIRECT = {
  anthropic: {
    base: 'https://api.anthropic.com/v1',
    completionPath: '/messages',
    gatewaySuffix: '/messages',
    headers: (key) => ({ 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION }),
  },
  openai: {
    base: 'https://api.openai.com/v1',
    completionPath: '/chat/completions',
    gatewaySuffix: '/chat/completions',
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  google: {
    // Google's OpenAI-compatible surface, so the comparison is like-for-like rather
    // than native Gemini vs an OpenAI-shaped gateway response.
    base: 'https://generativelanguage.googleapis.com/v1beta/openai',
    completionPath: '/chat/completions',
    gatewaySuffix: '/chat/completions',
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
};

function bodyFor(provider, model, prompt) {
  const messages = [{ role: 'user', content: prompt }];
  return provider === 'anthropic'
    ? { model, max_tokens: 64, messages }
    : { model, messages, max_tokens: 64 };
}

/** Model ids out of whichever list shape came back, so the two sides can be diffed. */
function modelIds(json) {
  const rows = Array.isArray(json?.data) ? json.data : Array.isArray(json?.models) ? json.models : [];
  return rows
    .map((m) => (typeof m === 'string' ? m : m?.id || m?.name || null))
    .filter(Boolean)
    // Google returns "models/gemini-…"; strip the prefix so the sets are comparable.
    .map((id) => id.replace(/^models\//, ''))
    .sort();
}

async function call(url, init, label) {
  const t0 = Date.now();
  try {
    const res = await llmFetch(url, init, { label, timeoutMs: 30000, retryOn429: false });
    const text = await res.text().catch(() => '');
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { url, status: res.status, ok: res.ok, json, raw: json ? null : text.slice(0, 2000), latencyMs: Date.now() - t0 };
  } catch (err) {
    return { url, status: null, ok: false, error: err.message || 'request failed', latencyMs: Date.now() - t0 };
  }
}

/**
 * Run the same two questions down both paths.
 * @param {object} o
 * @param {string} o.provider          anthropic | openai | google
 * @param {string} o.directKey         operator-supplied, used once, never stored
 * @param {string} o.gatewayBase       PRIVILEGE_LLM_GATEWAY_URL, no trailing slash
 * @param {string} o.virtualKey        the Privilege virtual key, server-side only
 * @param {string} o.model
 * @param {string} o.prompt
 */
async function compare({ provider, directKey, gatewayBase, virtualKey, model, prompt }) {
  const d = DIRECT[provider];
  if (!d) throw Object.assign(new Error(`No direct endpoint known for "${provider}"`), { code: 'llm_no_direct' });

  const gwBase = `${gatewayBase.replace(/\/+$/, '')}/llm/${provider}/v1`;
  const json = { 'Content-Type': 'application/json' };
  const body = JSON.stringify(bodyFor(provider, model, prompt));

  const [directModels, gatewayModels, directCompletion, gatewayCompletion] = await Promise.all([
    call(`${d.base}/models`, { method: 'GET', headers: d.headers(directKey) }, `direct-models-${provider}`),
    // Anthropic's /models needs anthropic-version too, on either side of the gateway
    // — without it the list comes back 400 and the comparison silently reads "0 models".
    call(`${gwBase}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${virtualKey}`, ...(provider === 'anthropic' ? { 'anthropic-version': ANTHROPIC_VERSION } : {}) },
    }, `gw-models-${provider}`),
    call(`${d.base}${d.completionPath}`, { method: 'POST', headers: { ...json, ...d.headers(directKey) }, body }, `direct-chat-${provider}`),
    call(`${gwBase}${d.gatewaySuffix}`, {
      method: 'POST',
      headers: { ...json, Authorization: `Bearer ${virtualKey}`, ...(provider === 'anthropic' ? { 'anthropic-version': ANTHROPIC_VERSION } : {}) },
      body,
    }, `gw-chat-${provider}`),
  ]);

  const directIds = modelIds(directModels.json);
  const gatewayIds = modelIds(gatewayModels.json);

  return {
    provider,
    model,
    models: {
      direct: { ...directModels, ids: directIds, count: directIds.length },
      gateway: { ...gatewayModels, ids: gatewayIds, count: gatewayIds.length },
      // The question this comparison exists to answer: does Privilege narrow what the
      // key can see, or only what it may call? Measured, not assumed.
      onlyDirect: directIds.filter((id) => !gatewayIds.includes(id)),
      onlyGateway: gatewayIds.filter((id) => !directIds.includes(id)),
      identical: directIds.length > 0 && directIds.join('|') === gatewayIds.join('|'),
    },
    completion: { direct: directCompletion, gateway: gatewayCompletion, requestBody: JSON.parse(body) },
  };
}

module.exports = { compare, modelIds, DIRECT };
