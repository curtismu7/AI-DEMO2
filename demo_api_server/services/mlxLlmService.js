// demo_api_server/services/mlxLlmService.js
//
// Minimal client for Apple's mlx_lm.server (OpenAI-compatible /v1 API).
// Used when agent mode is "MLX (Apple)" — points at the demo server on :8098.
//
//   MLX_LM_BASE_URL  default http://127.0.0.1:8098  (origin only, no /v1)
//   MLX_LM_MODEL     optional — when unset we use /v1/models

const { llmFetch } = require('./llmFetch');

const DEFAULT_BASE_URL = 'http://127.0.0.1:8098';
const FALLBACK_MODEL = 'local-model';

function baseUrl() {
  const v = process.env.MLX_LM_BASE_URL;
  return (typeof v === 'string' && v.trim()) ? v.trim().replace(/\/+$/, '') : DEFAULT_BASE_URL;
}

let cachedModel;

/** Resolve the model id mlx-lm is serving. */
async function model() {
  const explicit = process.env.MLX_LM_MODEL;
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();
  if (cachedModel) return cachedModel;
  try {
    const res = await llmFetch(`${baseUrl()}/v1/models`, {}, { label: 'mlx-lm models', timeoutMs: 5000, retryOn429: false });
    const data = await res.json();
    const first = Array.isArray(data?.data) ? data.data.find((m) => m && m.id) : undefined;
    cachedModel = first?.id || FALLBACK_MODEL;
  } catch {
    cachedModel = FALLBACK_MODEL;
  }
  return cachedModel;
}

function toOpenAiMessages(messages) {
  return (messages || []).map((m) => {
    const role = m.role === 'human' ? 'user' : (m.role || 'user');
    const content = typeof m.content === 'string' ? m.content : String(m.content ?? '');
    return { role, content };
  });
}

/** Call mlx-lm chat/completions and return assistant text. */
async function callMlx(messages) {
  if (!messages || messages.length === 0) throw new Error('No messages provided to mlx-lm');
  const base = baseUrl();
  const mdl = await model();

  const res = await llmFetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: 'Bearer mlx-lm',
    },
    body: JSON.stringify({
      model: mdl,
      messages: toOpenAiMessages(messages),
      stream: false,
    }),
  }, { label: 'mlx-lm' });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`mlx-lm chat/completions failed: ${res.status} ${errText}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('mlx-lm returned an empty completion');
  }
  return content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

module.exports = { callMlx };
