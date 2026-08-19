// banking_api_ui/src/services/bankingAgentNlService.js
/**
 * Natural language routing for the Banking Agent (Backend-for-Frontend (BFF): heuristic + optional Gemini).
 */

export async function fetchNlStatus() {
  const res = await fetch('/api/demo-agent/nl/status', { credentials: 'include' });
  if (!res.ok) return { geminiConfigured: false, heuristicAlwaysAvailable: true };
  return res.json();
}

/**
 * @param {string} message
 * @param {string} [provider='auto'] - 'auto', 'helix', 'lmstudio', etc.
 * @returns {Promise<{ source: string, result: object }>}
 */
async function parseNaturalLanguage(message, provider = 'auto') {
  const opts = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ message, provider }),
  };
  const res = await fetch('/api/demo-agent/nl', opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || data.error || `NL request failed (${res.status})`);
    err.statusCode = res.status;
    err.code = data.error;
    throw err;
  }
  return data;
}
