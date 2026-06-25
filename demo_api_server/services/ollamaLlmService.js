// demo_api_server/services/ollamaLlmService.js
//
// Minimal client for a local Ollama server (OpenAI-compatible /v1 API).
// Used for NL intent classification in "Ollama only" agent mode.
// Self-contained: no dependency on the :3006 agent runtime.
//
// Config (env var — same var agent-service uses):
//   OLLAMA_BASE_URL  default http://127.0.0.1:11434
//   OLLAMA_MODEL     default qwen2.5:3b
//
// Model note: the default is a small, fast, NON-reasoning model. NL intent
// classification and short teaching answers must return well under the SPA's
// fetch timeout (60s for Ollama, 15s on some chip paths). A reasoning model
// like qwen3:8b spends ~20s+ per call (longer on cold start), blowing the
// timeout and surfacing "Could not parse: signal timed out". qwen2.5:3b
// answers the same prompt in ~3s cold. Override with OLLAMA_MODEL if you have
// pulled a different model and accept the latency.

const DEFAULT_BASE_URL = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'qwen2.5:3b';

function baseUrl() {
  const v = process.env.OLLAMA_BASE_URL;
  return (typeof v === 'string' && v.trim()) ? v.trim().replace(/\/$/, '') : DEFAULT_BASE_URL;
}

function model() {
  const v = process.env.OLLAMA_MODEL;
  return (typeof v === 'string' && v.trim()) ? v.trim() : DEFAULT_MODEL;
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
 * Call Ollama's OpenAI-compatible chat endpoint and return the assistant reply text.
 * @param {Array} messages [{ role:'system'|'user'|'assistant'|'human', content }]
 * @returns {Promise<string>}
 */
async function callOllama(messages) {
  if (!messages || messages.length === 0) throw new Error('No messages provided to Ollama');
  const base = baseUrl();
  const mdl = model();

  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: 'Bearer ollama',
    },
    body: JSON.stringify({
      model: mdl,
      messages: toOpenAiMessages(messages),
      stream: false,
      // Disable chain-of-thought for JSON intent classification — cleaner output.
      think: false,
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Ollama chat/completions failed: ${res.status} ${errText}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('Ollama returned an empty completion');
  }
  // Strip any <think>…</think> chain-of-thought wrapper some models emit.
  return content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

module.exports = { callOllama };
