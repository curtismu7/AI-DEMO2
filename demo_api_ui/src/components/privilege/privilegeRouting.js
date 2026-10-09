// The Agent Privilege routes on the application name: /<door>/mcp. Our own façade
// routes are nested one level deeper (/mcp-facade/<door>/mcp), so the first
// segment there is always the meaningless "mcp-facade" — skip it.
//
// privilege-gateway is itself a multiApp door: /mcp-facade/privilege-gateway/
// <app>/mcp resolves to <gateway>/<app>/mcp (mcpFacade.js DOORS.privilege-gateway).
// Naming by the door here would collapse every registered Agentic App
// (opensearch22, opensearch, brave, ...) to the same "privilege-gateway"
// label — name by the APP segment instead when one is present.
export function doorName(mcpUrl) {
  try {
    const segments = new URL(mcpUrl).pathname.split('/').filter(Boolean);
    let idx = 0;
    if (segments[idx] === 'mcp-facade') idx += 1;
    if (segments[idx] === 'privilege-gateway' && segments.length > idx + 2) idx += 1;
    return segments[idx] || null;
  } catch { return null; }
}

// The three ways to reach the same MCP server. Each says what the audience is
// meant to notice, because the whole page is a comparison.
//
// This replaced an Agent/Agentless pair on 2026-09-02: there is one Agent Privilege
// now, and the agent-mode frontend the old option named has nothing behind it.
// The mode is authoritative — it used to be sniffed from the URL, which guessed
// wrong the moment two paths shared a hostname, as the façade and direct doors do.
export const GATEWAY_MODES = {
  direct: {
    key: 'direct',
    title: 'Direct to MCP',
    // The door still authenticates — every façade door sets requireBearer, so
    // "nobody checks who asked" was never true here and read as a bug once the
    // 401 became visible. What Direct actually leaves out is Privilege: no
    // per-tool policy, no denial, no record of the call.
    detail: 'No Privilege in this path. The door still checks who you are, but no per-tool policy is applied, nothing is denied, and nothing is recorded.',
  },
  privilege: {
    key: 'privilege',
    title: 'Agent Privilege',
    detail: 'The gateway authenticates the user and applies per-tool policy. The client registers with the gateway, so a gateway restart breaks it.',
  },
  facade: {
    key: 'facade',
    title: 'Privilege — through the façade',
    detail: 'Same policy, same user token upstream, but the client registers with our own authorization server and survives a gateway restart.',
  },
};

// The Path picker carries two kinds of route. The three above are MCP paths — they
// change which gateway the TOOL calls traverse. These three are LLM paths: the chat
// prompt goes to a model through a Privilege virtual key instead of to the MCP agent
// loop, so the thing under policy is the PROMPT, not a tool. Prefixed 'llm:' in the
// select so one control can offer both without two dropdowns.
export const LLM_PATHS = {
  anthropic: { key: 'anthropic', title: 'LLM — Anthropic through Privilege', detail: 'The prompt goes to Claude through a Privilege virtual key. Privilege injects the provider key and can deny the call before the model ever sees it.' },
  google: { key: 'google', title: 'LLM — Google through Privilege', detail: 'The prompt goes to Gemini through a Privilege virtual key. Privilege injects the provider key and can deny the call before the model ever sees it.' },
  openai: { key: 'openai', title: 'LLM — OpenAI through Privilege', detail: 'The prompt goes to GPT through a Privilege virtual key. Privilege injects the provider key and can deny the call before the model ever sees it.' },
};

// The four direct-path doors (mirrors mcpFacade.js DOORS): a same-origin preset
// from another path must not appear in Direct's door list.
export const DIRECT_DOOR_NAMES = new Set(['banking', 'opensearch', 'brave', 'pingone-admin']);

export function doorsForMode(presets, mode) {
  return (presets || [])
    .filter((p) => p.mode === mode)
    .filter((p) => mode !== 'direct' || DIRECT_DOOR_NAMES.has(doorName(p.url)))
    .map((p) => p.url);
}

/**
 * How a path or door switch should authenticate, given what /config reported.
 * Pure: the caller performs the side effects. `signedIn` = the main app OR this
 * client already has a session to reuse.
 *  - path: authenticated | silent | forceReauth | manual
 *  - door: silent (Privilege mode only) | authenticated | manual
 */
export function decideAfterSwitch({ kind, destinationAuthenticated, mode, forceReauth = false, signedIn }) {
  if (kind === 'door') {
    if (!destinationAuthenticated && mode === 'privilege' && signedIn) return 'silent';
    return destinationAuthenticated ? 'authenticated' : 'manual';
  }
  if (destinationAuthenticated && !forceReauth) return 'authenticated';
  if (!forceReauth && signedIn) return 'silent';
  if (forceReauth) return 'forceReauth';
  return 'manual';
}

/** The Façade relay token dies with the BFF process; Re-arm applies only there. */
export function needsRearm(mode, session) {
  return mode === 'facade' && Boolean(session) && !session.ready;
}

export function rearmReason(session) {
  return session.reason === 'expired' ? 'expired' : 'not established';
}

/** One /doors/probe result as the row's trailing text. */
export function probeResultLabel(r) {
  return r.ok ? `${r.tools} tools` : `${r.status || ''} ${r.error || ''}`.trim() || 'failed';
}
