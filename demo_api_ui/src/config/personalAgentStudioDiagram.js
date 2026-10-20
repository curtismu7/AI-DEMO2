// Personal Agent Studio request path. Mirrors PersonalAgentStudioPage.jsx:
// handleSend -> /api/agent/invoke; 428 requiresConsent -> /api/auth/mfa/challenge -> retry;
// the three SecurityRail gates (DEFAULT_GATES); workload runs' hitl_required ->
// /api/mcp/decision/:id/approve|deny -> retry with hitlChallengeId.
const N = (id, group, label, sub, x, y) => ({ id, group, label, sub, x, y });
const E = (src, tgt, label, opts) => (opts ? [src, tgt, label, opts] : [src, tgt, label]);
const TOKEN = { dashed: true }; // pingStyle: dashed blue = a token or a decision handed back

export const PERSONAL_AGENT_GROUPS = {
  // Ping palette: red = Ping products, dark = the page and what the team builds, grey = the outside client.
  user: { label: 'User', bg: '#151a24' },
  agent: { label: 'Agent client', bg: '#5a5f69' },
  bff: { label: 'Demo BFF', bg: '#151a24' },
  idp: { label: 'PingOne', bg: '#b5231a' },
  gateway: { label: 'Gateway + Authorize', bg: '#b5231a' },
};

export const PERSONAL_AGENT_NODES = [
  N('user', 'user', 'User', ['chats or runs a workload', 'action in the selected skin'], 0, 150),
  N('client', 'agent', 'Agent client (skin)', ['Privilege, Claude, ChatGPT,', 'Gemini, Computer Use, Dot'], 340, 200),
  N('bff', 'bff', 'POST /api/agent/invoke', ['gate 1: MFA (acr claim)', 'looks up the personal agent'], 0, 400),
  N('mfa', 'idp', 'PingOne MFA', ['/api/auth/mfa/challenge', 'step-up before the action'], 0, 0),
  N('gw', 'gateway', 'Gateway: token validation', ['gate 2: audience, act claim,', 'RFC 7662 introspection'], 1020, 400),
  N('authz', 'gateway', 'PingOne Authorize', ['gate 3: agent identity,', 'loyalty tier, action scope'], 1020, 200),
  N('approve', 'user', 'Human approval', ['/api/mcp/decision/:id/', 'approve or deny'], 1020, 0),
];

export const PERSONAL_AGENT_EDGES = [
  E('user', 'client', 'prompt or Run'), // 0
  E('client', 'bff', 'invoke (credentials included)'), // 1
  E('bff', 'gw', 'MFA passed; agent token exchanged', TOKEN), // 2
  E('gw', 'authz', 'token valid; ask for a verdict'), // 3
  E('authz', 'client', 'permit: result and reply returned', TOKEN), // 4
  E('bff', 'mfa', '428 requiresConsent / step_up_required', TOKEN), // 5
  E('mfa', 'client', 'challenge done; the request is retried'), // 6
  E('authz', 'approve', 'hitl_required: challenge id', TOKEN), // 7
  E('approve', 'client', 'approve: retry with hitlChallengeId'), // 8
];

export const PERSONAL_AGENT_STEPS = [
  { key: 'invoke', edges: [0, 1], title: 'Request enters the BFF', what: 'Chat and workload runs both post to /api/agent/invoke; the CUA script uses the same path.', evidence: 'The security rail starts with all three gates waiting.' },
  { key: 'gates', edges: [2, 3, 4], title: 'Three gates, then the tool', what: 'MFA check, gateway token validation, then PingOne Authorize; a permit returns the reply.', evidence: 'The rail derives each gate from the BFF events (personal-agent-lookup, gw-introspection, gw-authorize).' },
  { key: 'mfa', edges: [5, 6], title: 'Consent or step-up through MFA', what: 'A 428 or step_up_required starts a PingOne MFA challenge in-app; finishing it retries the request.', evidence: 'Agent says "Verify with PingOne MFA to continue." then re-sends the prompt.' },
  { key: 'hitl', edges: [7, 8], title: 'Human approval on workload runs', what: 'hitl_required returns a challenge; approving posts the decision and re-runs with hitlChallengeId, declining ends the run.', evidence: '"Approval required" modal with Approve/Decline.' },
];
