// demo_api_server/services/llamacppLlmService.js
//
// Minimal client for a local llama.cpp llama-server (OpenAI-compatible /v1 API).
// Used for NL intent classification in "llama.cpp only" agent mode.
// Self-contained: no dependency on the :3006 agent runtime.
//
// Config (env var — same var agent-service uses):
//   LLAMACPP_BASE_URL  default http://127.0.0.1:8090   (origin only, no /v1)
//   LLAMACPP_MODEL     optional — llama-server serves whatever model it was
//                      launched with; when unset we send the model it reports
//                      via /v1/models (cached), falling back to 'local-model'.
//
// Latency note: NL intent classification and short teaching answers must return
// well under the SPA's fetch timeout (60s here, 15s on some chip paths). Launch
// llama-server with a small, fast model (e.g. a 3B class quant) so a single call
// completes in a few seconds; a large reasoning model can blow the timeout and
// surface "Could not parse: signal timed out".

const DEFAULT_BASE_URL = 'http://127.0.0.1:8090';
const FALLBACK_MODEL = 'local-model';

function baseUrl() {
  const v = process.env.LLAMACPP_BASE_URL;
  return (typeof v === 'string' && v.trim()) ? v.trim().replace(/\/+$/, '') : DEFAULT_BASE_URL;
}

let cachedModel;
/** Resolve the model id llama-server is serving (OpenAI-style /v1/models). */
async function model() {
  const explicit = process.env.LLAMACPP_MODEL;
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();
  if (cachedModel) return cachedModel;
  try {
    const res = await fetch(`${baseUrl()}/v1/models`);
    const data = await res.json();
    const first = Array.isArray(data?.data) ? data.data.find((m) => m && m.id) : undefined;
    cachedModel = first?.id || FALLBACK_MODEL;
  } catch {
    cachedModel = FALLBACK_MODEL;
  }
  return cachedModel;
}

/** Map our message roles to OpenAI chat roles. */
function toOpenAiMessages(messages) {
  return (messages || []).map((m) => {
    const role = m.role === 'human' ? 'user' : (m.role || 'user');
    const content = typeof m.content === 'string' ? m.content : String(m.content ?? '');
    return { role, content };
  });
}

/**
 * Call llama-server's OpenAI-compatible chat endpoint and return the assistant reply text.
 * @param {Array} messages [{ role:'system'|'user'|'assistant'|'human', content }]
 * @returns {Promise<string>}
 */
async function callLlamaCpp(messages) {
  if (!messages || messages.length === 0) throw new Error('No messages provided to llama.cpp');
  const base = baseUrl();
  const mdl = await model();

  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: 'Bearer llama-cpp',
    },
    body: JSON.stringify({
      model: mdl,
      messages: toOpenAiMessages(messages),
      stream: false,
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`llama.cpp chat/completions failed: ${res.status} ${errText}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('llama.cpp returned an empty completion');
  }
  // Strip any <think>…</think> chain-of-thought wrapper some models emit.
  return content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

module.exports = { callLlamaCpp };
