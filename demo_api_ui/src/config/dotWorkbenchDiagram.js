// demo_api_ui/src/config/dotWorkbenchDiagram.js
//
// What happens when you send Dot a message on /personal-agent/dot. Mirrors
// pages/DotWorkbenchPage.jsx (POST /api/agent/invoke, mapInvokeResult) and
// demo_api_server/routes/agentInvokeRoute.js (promptGuard, preference-only
// shortcut, intent gate behind ff_intent_authorization_enabled, processAgentMessage,
// MCP token resolution, memory save). Embedded directly (not a demo step).
const N = (id, group, label, sub, x, y) => ({ id, group, label, sub, x, y });
const E = (src, tgt, label, opts) => (opts ? [src, tgt, label, opts] : [src, tgt, label]);
const OK = { color: 'var(--th-status-success)' };
const STOP = { color: 'var(--th-status-error)' };

export const DOT_WORKBENCH_GROUPS = {
  user: { label: 'You', bg: 'var(--th-status-info)' },
  app: { label: 'Demo BFF', bg: 'var(--th-bg-emphasis)' },
  gate: { label: 'Authorization', bg: 'var(--th-status-warning)' },
  agent: { label: 'Dot agent', bg: 'var(--th-status-success)' },
  resource: { label: 'Tools + memory', bg: 'var(--th-text-faint)' },
};

export const DOT_WORKBENCH_NODES = [
  N('user', 'user', 'You (Dot workbench)', ['chat message or suggested', 'prompt chip; page sends', 'prompt + vertical + agentMode'], 0, 200),
  N('invoke', 'app', 'POST /api/agent/invoke', ['session cookie identifies you;', 'promptGuard screens the text;', 'guests get 401 -> sign-in card'], 340, 200),
  N('memory', 'resource', 'Dot memory', ['preference-only prompt is saved', 'and answered without a tool;', 'preferences in any run saved after'], 340, 0),
  N('intent', 'gate', 'Intent authorization', ['only when ff_intent_authorization_enabled:', 'allow, 403 deny or 428 consent', 'before the agent runs'], 680, 0),
  N('agent', 'agent', 'Agent run', ['processAgentMessage;', 'Heuristics (no model) or', 'llama.cpp per the mode toggle'], 680, 200),
  N('tokens', 'gate', 'MCP access token', ['resolved for the tool called,', 'token events recorded for', 'the run report'], 1020, 200),
  N('tools', 'resource', 'MCP tool', ['the governed tool call', 'on your behalf'], 1020, 400),
  N('panel', 'user', 'Verdict cards + panels', ['mapInvokeResult -> PERMIT / DENY /', 'CONSENT tool card; "What Ping', 'governs" tally; memory panel'], 340, 400),
];

export const DOT_WORKBENCH_EDGES = [
  E('user', 'invoke', 'send message'), // 0
  E('invoke', 'memory', 'preference-only: remember it, no tool runs', OK), // 1
  E('invoke', 'intent', 'intent pre-check (flag on)'), // 2
  E('intent', 'panel', '403 DENY / 428 CONSENT stops the run', STOP), // 3
  E('intent', 'agent', 'authorized: run the agent', OK), // 4
  E('agent', 'tokens', 'tool chosen: resolve its access token'), // 5
  E('tokens', 'tools', 'call the tool', OK), // 6
  E('tools', 'agent', 'result'), // 7
  E('agent', 'memory', 'save preferences found in the prompt'), // 8
  E('agent', 'panel', 'reply + toolsCalled + dotMemories', OK), // 9
];

export const DOT_WORKBENCH_STEPS = [
  { key: 'send', edges: [0], title: 'You send a message', what: 'The page POSTs the prompt, the active vertical and the Heuristics|llama.cpp mode to /api/agent/invoke with your session cookie.', why: 'Dot acts under your identity, so a signed-out call returns 401 and the page shows the sign-in card instead of a reply.' },
  { key: 'pref', edges: [1], title: 'A pure preference never reaches a tool', what: 'A prompt that is only a standing preference ("always book me an aisle seat") is saved to your Dot memory and answered directly.', why: 'Heuristics would otherwise misread it as a seat-availability request.' },
  { key: 'gate', edges: [2, 3, 4], title: 'The intent gate decides before the agent runs', what: 'With intent authorization enabled, the route extracts the intent and checks it first. A deny returns 403, a consent requirement returns 428, otherwise the agent runs.', why: 'The page turns 403 and 428 into DENY and CONSENT tool cards, so the verdict you see is what the route returned.' },
  { key: 'tool', edges: [5, 6, 7], title: 'The agent calls a governed tool', what: 'The agent run picks a tool, an MCP access token is resolved for it, and the tool is called.', why: 'Each call carries its own token, which is what the "What Ping governs" panel tallies.' },
  { key: 'answer', edges: [8, 9], title: 'Reply, memory and verdicts come back', what: 'Preferences in the prompt are saved after a successful run, and the reply returns with the tools called and any new memories.', why: 'The memory chip appears under the reply that learned it; tool calls render as PERMIT cards.' },
];
