// Calls the existing Privilege MCP client endpoints (routes/privilegeMcpClient.js) to send ONE real tool call through a real
// door, and classifies what the gateway answered. Nothing here decides anything: Cedar runs inside the gateway.
//   GET  /api/privilege-mcp/state        -> presets (door URLs), oauth state
//   POST /api/privilege-mcp/config       -> switch this session's door
//   POST /api/privilege-mcp/tools/call   -> the real call
const API_BASE = '/api/privilege-mcp';

export async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'include',
  });
  const text = await r.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!r.ok) {
    // The status matters: 401 = not signed in, 403 = a Privilege policy refused it.
    const err = new Error(data.error || text || `HTTP ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return data;
}

// The door's URL comes from the BFF's presets (built from the console's discovered apps).
export function findDoorUrl(state, name) {
  const preset = (state?.presets || []).find((p) => p.mode === 'privilege' && typeof p.url === 'string' && p.url.includes(`/${name}/`));
  return preset ? preset.url : null;
}

// A hold: tools/call answers 200 with a result that announces pending_approval and the ins_ instruction id. A denial is
// never a hold, even if its text quotes one. (Same rule as PrivilegeMcpClientPage.holdInfo.)
export function holdInfo(data) {
  if (data?.error || data?.result?.isError) return null;
  const haystack = JSON.stringify(data);
  const id = haystack && haystack.match(/ins_[0-9a-f]{12,}/i);
  return id && /pending_approval/i.test(haystack) ? { instructionId: id[0] } : null;
}

const textOf = (result) => {
  const parts = Array.isArray(result?.content) ? result.content.map((c) => c && c.text).filter(Boolean) : [];
  const text = parts.length ? parts.join(' ') : JSON.stringify(result ?? {});
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
};

// outcome: allow | hold | deny | signin | tool-error | error. A result flagged isError is NOT called a denial: it may be a
// refusal or a tool failure after the gateway let the call through, so it is reported as unclear with the raw response.
export function classifyCall({ data, error } = {}) {
  if (error) {
    if (error.status === 401) return { outcome: 'signin', detail: error.message };
    if (error.status === 403) return { outcome: 'deny', detail: error.message };
    return { outcome: 'error', detail: error.message };
  }
  const hold = holdInfo(data);
  if (hold) return { outcome: 'hold', instructionId: hold.instructionId, detail: textOf(data?.result) };
  if (data?.error) return { outcome: 'deny', detail: String(data.error.message || data.error) };
  if (data?.result?.isError) return { outcome: 'tool-error', detail: textOf(data.result) };
  return { outcome: 'allow', detail: textOf(data?.result ?? data) };
}

// Point this session at the door and report whether it is signed in. Switching the door is the same thing the client page's
// door picker does, so it also moves that page to this door.
export async function connectDoor(name) {
  const state = await api('/state');
  const url = findDoorUrl(state, name);
  if (!url) return { ok: false, reason: 'no-door', state };
  const saved = await api('/config', { method: 'POST', body: { gatewayMode: 'privilege', mcpUrl: url } });
  const authenticated = Boolean(saved?.oauth?.destinationAuthenticated ?? saved?.oauth?.authenticated);
  return { ok: true, url, authenticated };
}

export async function runTool(name, args) {
  try {
    const data = await api('/tools/call', { method: 'POST', body: { name, arguments: args || {} } });
    return { ...classifyCall({ data }), raw: data };
  } catch (error) {
    return { ...classifyCall({ error }), raw: { error: error.message, status: error.status } };
  }
}
