// demo_api_server/services/googleGeminiLlmService.js
//
// Minimal Gemini API client for NL intent in "Google Gemini only" agent mode.
// Uses the Generative Language REST API (same key as GOOGLE_API_KEY / LangChain config).

const DEFAULT_MODEL = 'gemini-2.0-flash';

/** Models to try when the preferred model hits free-tier quota (429). */
const MODEL_FALLBACKS = [
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-2.0-flash-lite',
];

function apiKey(config = {}) {
  return config.google_api_key
    || process.env.GOOGLE_API_KEY
    || process.env.GEMINI_API_KEY
    || '';
}

function modelName(config = {}) {
  return config.google_model || config.model || process.env.GOOGLE_MODEL || DEFAULT_MODEL;
}

/** Flatten chat messages into Gemini contents + optional system instruction. */
function toGeminiPayload(messages) {
  let systemText = '';
  const contents = [];
  for (const m of messages || []) {
    const text = typeof m.content === 'string' ? m.content : String(m.content ?? '');
    if (m.role === 'system') {
      systemText = systemText ? `${systemText}\n\n${text}` : text;
      continue;
    }
    const role = m.role === 'assistant' ? 'model' : 'user';
    contents.push({ role, parts: [{ text }] });
  }
  const body = { contents };
  if (systemText) body.systemInstruction = { parts: [{ text: systemText }] };
  return body;
}

/**
 * Call one Gemini model once.
 * @param {string} key
 * @param {string} model
 * @param {object} body
 */
async function generateOnce(key, model, body) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

/**
 * Call Gemini generateContent and return assistant text.
 * Retries alternate models on HTTP 429 quota errors.
 * @param {Array} messages
 * @param {object} [config]
 * @returns {Promise<string>}
 */
async function callGemini(messages, config = {}) {
  const key = apiKey(config);
  if (!key) throw new Error('GOOGLE_API_KEY not configured');

  const preferred = modelName(config);
  const models = [preferred, ...MODEL_FALLBACKS.filter((m) => m !== preferred)];
  const body = toGeminiPayload(messages);
  let lastErr = null;

  for (const model of models) {
    const { res, data } = await generateOnce(key, model, body);
    if (res.ok) {
      const parts = data?.candidates?.[0]?.content?.parts || [];
      const text = parts.map((p) => p.text || '').join('').trim();
      if (!text) throw new Error('Gemini returned empty response');
      return text;
    }
    const msg = data?.error?.message || res.statusText || String(res.status);
    lastErr = new Error(`Gemini API ${res.status}: ${msg}`);
    // Only rotate models on quota / rate-limit; other errors fail immediately.
    if (res.status !== 429) throw lastErr;
    console.warn(`[googleGemini] ${model} returned 429 — trying next model`);
  }
  throw lastErr || new Error('Gemini API unavailable');
}

module.exports = { callGemini, DEFAULT_MODEL, MODEL_FALLBACKS };
