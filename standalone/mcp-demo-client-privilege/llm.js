// How the demo client talks to its LLM: Ollama's native /api/chat by default, an
// OpenAI-compatible call when the URL is a PingOne Agent Privilege LLM lane
// (<gateway>/llm/<provider>[/v1]). The virtual key comes from the environment, never
// from the UI config, so it cannot be echoed back to the browser.
const isLane = (url) => /\/llm\//.test(url || '');

export function llmPath(llmUrl) {
  return isLane(llmUrl) ? 'PRIVILEGE' : 'direct (NOT governed by Privilege)';
}

export function buildLlmRequest({ llmUrl, llmModel }, messages, apiKey = '') {
  const base = String(llmUrl).replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const body = JSON.stringify({ model: llmModel, stream: false, messages });
  if (isLane(base) || /\/v1$/.test(base)) {
    const root = /\/v1$/.test(base) ? base : `${base}/v1`;
    return { url: `${root}/chat/completions`, init: { method: 'POST', headers, body } };
  }
  return { url: `${base}/api/chat`, init: { method: 'POST', headers, body } };
}

export function readLlmReply(json) {
  return json?.message?.content || json?.choices?.[0]?.message?.content || json?.response || '';
}
