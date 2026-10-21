// Personal Agent Studio request path, drawn as the same six cards as the movie reel under it (TokenChainFilmstrip):
// Sign-in, Banking Agent, Token Exchange, Authorize, MCP, Reply. Mirrors PersonalAgentStudioPage.jsx:
// handleSend -> /api/agent/invoke; the three SecurityRail gates (DEFAULT_GATES); 428 requiresConsent ->
// /api/auth/mfa/challenge, or hitl_required -> /api/mcp/decision/:id/approve|deny -> retry.
const N = (id, group, label, sub, x, y) => ({ id, group, label, sub, x, y });
const E = (src, tgt, label, opts) => (opts ? [src, tgt, label, opts] : [src, tgt, label]);
const TOKEN = { dashed: true }; // pingStyle: dashed blue = a token or a decision handed back

export const PERSONAL_AGENT_GROUPS = {
  // Ping palette: red = Ping products, dark = the page and what the team builds, grey = the outside client.
  user: { label: 'User', bg: '#151a24' },
  agent: { label: 'Agent client', bg: '#5a5f69' },
  bff: { label: 'Demo BFF and tools', bg: '#151a24' },
  idp: { label: 'PingOne', bg: '#b5231a' },
  gateway: { label: 'Gateway + Authorize', bg: '#b5231a' },
};

// Same order and names as the reel's cards, so a run lights up the box it is drawn as.
export const PERSONAL_AGENT_NODES = [
  N('signin', 'user', 'Sign-in', ['PingOne session', 'gate 1: MFA (acr claim)'], 0, 0),
  N('agent', 'agent', 'Banking Agent', ['POST /api/agent/invoke', 'looks up the personal agent'], 340, 0),
  N('exchange', 'idp', 'Token Exchange', ['RFC 8693: user token to', 'agent token, act claim'], 680, 0),
  N('authorize', 'gateway', 'Authorize', ['gate 2 and 3: introspection,', 'agent identity, tier, scope'], 1020, 0),
  N('mcp', 'bff', 'MCP', ['tool server runs the call', 'after a permit'], 1360, 0),
  N('reply', 'user', 'Reply', ['answer back in the', 'selected skin'], 1700, 0),
];

export const PERSONAL_AGENT_EDGES = [
  E('signin', 'agent', 'prompt or Run, signed in'), // 0
  E('agent', 'exchange', 'user token handed to the BFF'), // 1
  E('exchange', 'authorize', 'agent token; ask for a verdict', TOKEN), // 2
  E('authorize', 'mcp', 'permit: tool call allowed'), // 3
  E('mcp', 'reply', 'tool result returned', TOKEN), // 4
  E('authorize', 'agent', '428 requiresConsent or hitl_required: MFA / approval, then retry', TOKEN), // 5
];

export const PERSONAL_AGENT_STEPS = [
  { key: 'invoke', edges: [0, 1], title: 'Request enters the BFF', what: 'Chat and workload runs both post to /api/agent/invoke; the CUA script uses the same path.', evidence: 'The security rail starts with all three gates waiting.' },
  { key: 'gates', edges: [2, 3, 4], title: 'Token exchange, Authorize, then the tool', what: 'The user token is exchanged for an agent token, PingOne Authorize gives a verdict, and a permit lets the MCP tool run and the reply return.', evidence: 'The rail derives each gate from the BFF events (personal-agent-lookup, gw-introspection, gw-authorize).' },
  { key: 'held', edges: [5], title: 'Held for MFA or human approval', what: 'A 428 or step_up_required starts a PingOne MFA challenge in-app; hitl_required shows Approve/Decline. Finishing either retries the request.', evidence: 'Agent says "Verify with PingOne MFA to continue." then re-sends the prompt.' },
];

// Shared by the Studio page and the standalone /personal-agent-flow page so the two cannot drift apart.
export const PERSONAL_AGENT_DIAGRAM_PROPS = {
  testId: 'pas-flow-diagram',
  pingStyle: true,
  title: 'How a personal-agent request is governed',
  ariaLabel: 'Personal agent request flow diagram',
  diagramLabel: 'Sign-in, Banking Agent, token exchange, Authorize, MCP and reply, with an MFA and approval detour',
  lede: 'The same six steps as the movie reel below. Every skin posts to /api/agent/invoke; the three gates match the security rail, and MFA or human approval is how a request is held and retried.',
};
