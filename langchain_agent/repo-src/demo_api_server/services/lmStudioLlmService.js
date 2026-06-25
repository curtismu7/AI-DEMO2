// demo_api_server/services/lmStudioLlmService.js
//
// Minimal client for a local LM Studio server (OpenAI-compatible API). Used as the
// failover target when Helix returns a quota-exhausted reply (see helixLlmService.js).
// Self-contained: no dependency on the :3006 agent runtime.
//
// Config (configStore → env → FIELD_DEFS default):
//   lmstudio_base_url  default http://localhost:1234/v1
//   lmstudio_model     default '' → resolved to LM Studio's first loaded model

const configStore = require('./configStore');

const DEFAULT_BASE_URL = 'http://localhost:1234/v1';

function baseUrl() {
  const v = configStore.getEffective('lmstudio_base_url');
  return (typeof v === 'string' && v.trim()) ? v.trim().replace(/\/$/, '') : DEFAULT_BASE_URL;
}

/** Map our message roles to OpenAI chat roles (Helix uses 'human' for user turns). */
function toOpenAiMessages(messages) {
  return (messages || []).map((m) => {
    const role = m.role === 'human' ? 'user' : (m.role || 'user');
    const content = typeof m.content === 'string' ? m.content : String(m.content ?? '');
    return { role, content };
  });
}

/** Resolve the model id: configured value wins, else LM Studio's first loaded model. */
async function resolveModel(base) {
  const configured = configStore.getEffective('lmstudio_model');
  if (typeof configured === 'string' && configured.trim()) return configured.trim();
  const res = await fetch(`${base}/models`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`LM Studio /models failed: ${res.status}`);
  const data = await res.json();
  const first = Array.isArray(data?.data) ? data.data.find((m) => m && m.id) : null;
  if (!first) throw new Error('LM Studio has no loaded model to fall back to');
  return first.id;
}

/**
 * Call the local LM Studio chat endpoint and return the assistant reply text.
 * @param {Array} messages [{ role:'system'|'user'|'assistant'|'human', content }]
 * @returns {Promise<string>}
 */
async function callLmStudio(messages) {
  if (!messages || messages.length === 0) throw new Error('No messages provided to LM Studio');
  const base = baseUrl();
  const model = await resolveModel(base);

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      // LM Studio ignores the key but the OpenAI client shape expects one.
      Authorization: 'Bearer lm-studio',
    },
    body: JSON.stringify({ model, messages: toOpenAiMessages(messages), stream: false }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`LM Studio chat/completions failed: ${res.status} ${errText}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('LM Studio returned an empty completion');
  }
  return content;
}

module.exports = { callLmStudio };
