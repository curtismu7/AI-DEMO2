// /privilege-pf-token: a PingFederate-issued token, accepted by the Privilege gateway (verified 2026-10-26).
// Source of every value here: privilege/PF-TOKEN-EXCHANGE-PASS-AGENT-TOKEN.md, section "Working configuration".
export const DOC_URL = 'https://github.com/cmuir_pingcorp/AI-DEMO2/blob/main/privilege/PF-TOKEN-EXCHANGE-PASS-AGENT-TOKEN.md';

// What each gateway answer means. 401 and 403 are different layers: the log is the only place that names the reason.
export const VERDICTS = {
  allowed: { label: 'ALLOWED', tone: 'ok', note: 'The gateway accepted the PingFederate token and the agent key\'s grant let the call through.' },
  'allowed-no-tools': { label: 'ALLOWED, NO TOOLS', tone: 'warn', note: 'Accepted, but the agent app listed no tools. Its tools may not be discovered yet.' },
  'refused-by-policy': { label: 'REFUSED BY POLICY', tone: 'bad', note: 'The token was accepted, then a Privilege grant refused the call (403). The key has no grant on this agent app.' },
  'token-rejected': { label: 'TOKEN REJECTED', tone: 'bad', note: 'The gateway did not accept the token (401): issuer, audience, subject, a required claim or lifetime did not match the identity.' },
  error: { label: 'ERROR', tone: 'bad', note: 'The call did not complete.' },
};

// What Privilege does for a PingFederate-token agent, and what it cannot do yet. `status` says how we know.
export const PRIVILEGE_CAN = [
  { what: 'Trust PingFederate as the agent\'s issuer', how: 'The identity checks the signature (PingFederate JWKS), iss, aud (bound to one agent app) and token lifetime. Anything else is 401.', status: 'measured' },
  { what: 'Accept only this agent', how: 'Required claims on the identity (act.sub, client_id) must match exactly, or the token is rejected (401).', status: 'measured' },
  { what: 'Hold no secret for the agent', how: 'The PingFederate token is the only credential. Privilege issues no key value to the agent.', status: 'measured' },
  { what: 'Decide which tools, per agent app', how: 'The agent key\'s grant lists tools per agent app. No rule for the app is 403; tools not listed are hidden.', status: 'measured' },
  { what: 'Give different tools by scope (tiers)', how: 'Two grant rules for the same app, each with RequiredClaims on scope: the token\'s scope picks 3 tools, 9 tools, or 403. Each scope is matched on its own; a list means any of.', status: 'measured 2026-10-27' },
  { what: 'Pass the agent\'s token through', how: 'Pass Agent Token forwards the PingFederate token unchanged, so the MCP server can verify it too (see What the backend received).', status: 'measured' },
  { what: 'Find the tools without a person signing in', how: 'The first accepted agent call discovers the app\'s tools (gateway v1.261024).', status: 'measured' },
  { what: 'Switch the agent off', how: 'Disable the identity or revoke the key.', status: 'not tested on this path' },
];

export const PRIVILEGE_CANNOT = [
  { what: 'Token exchange (on behalf of a user)', how: 'Privilege does not exchange tokens. A user in sub with the agent in act has to come from PingFederate. Privilege\'s OBO support is in staging (Ping, 2026-10-23).' },
  { what: 'Narrow the token it forwards', how: 'The MCP server gets the same token the agent sent, with every scope in it. A down-scoped token needs a token exchange in front of the gateway.' },
  { what: 'Cedar rules on any token claim', how: 'Cedar sees the token\'s scopes (context.token.scopes is in the policy editor; not yet tried with a PingFederate token) but no other claim: context.token.claims (act.sub, client_id …) is due in a later release. Other claim checks today are the identity\'s required claims and the grant rules\' RequiredClaims, exact match only.' },
  { what: 'Wildcard audiences', how: 'The audience must name the gateway; no wildcard. An allow-list of audiences is possible on request.' },
  { what: 'New grant policies through the API', how: 'Grants created with POST are deleted within about a minute (cause unknown). Edit the key\'s existing grant instead.' },
];

// Every row had to be true at the same time for the 200.
export const WORKING_SETUP = [
  { layer: 'PingFederate', setting: 'Client', value: 'pf-route-c-test (client credentials)' },
  { layer: 'PingFederate', setting: 'Token manager', value: 'routeCTestAtm — audience and resource URI = the agent app URL' },
  { layer: 'PingFederate', setting: 'Scopes', value: 'opensearch:admin, opensearch:read and whoami:read registered; the requested scope goes into the token (no scope requested = the mapping\'s "openid whoami:read")' },
  { layer: 'PingFederate', setting: 'act claim', value: 'expression #{"sub": "pf-route-c-test"} (an object, not the text "{}")' },
  { layer: 'Privilege identity (NHI)', setting: 'PFtoken', value: 'issuer cmuir-pf, JWKS /pf/JWKS, subject *, audience = the agent app URL' },
  { layer: 'Privilege identity (NHI)', setting: 'Required claims', value: 'client_id = pf-route-c-test and act.sub = pf-route-c-test' },
  { layer: 'Privilege identity (NHI)', setting: 'End user', value: 'Opaque, claim sub' },
  { layer: 'Privilege agent key', setting: 'pftoken-agent', value: 'custodian = the PFtoken identity, scope mcp' },
  { layer: 'Privilege grant', setting: 'KarunRiver-5a485737526f', value: 'two rules for agent app pftoken, key pftoken-agent: all nine tools when scope has opensearch:admin, three read tools when scope has opensearch:read (RequiredClaims)' },
  { layer: 'P1 Privilege Agent App', setting: 'pftoken', value: 'Pass Agent Token, backend opensearch-mcp-noget' },
  { layer: 'P1 Privilege Agent App', setting: 'pftoken-rs', value: 'Pass Agent Token, backend mcp-resource-server :8081/mcp (whoami); grant rule: tool whoami' },
  { layer: 'Resource server', setting: 'Trust', value: 'PF_ISSUER = cmuir-pf, the pftoken agent app URL in its accepted audiences, PF scope includes whoami:read' },
  { layer: 'Gateway', setting: 'Version', value: 'privilege-aigw v1.261024 or later (discovers tools from the first agent call)' },
];

// What broke on the way, as the gateway log says it.
export const FAILURES = [
  { seen: '401', log: 'workload token rejected: required claim "act.sub" does not match', fix: 'Set the identity\'s act.sub to the agent id; make PingFederate emit act as an object.' },
  { seen: '403', log: 'policy denied PFtoken access to pftoken (agent=true)', fix: 'Add a rule for the agent app to the agent key\'s existing grant.' },
  { seen: '404', log: 'rejecting /mcp on app pftoken-rs: outside entry path "/mc"', fix: 'The agent app\'s MCP Server URL must end in exactly /mcp; the gateway splits the path off as the entry path.' },
  { seen: 'no tools', log: 'tool discovery for pftoken failed: … no such host', fix: 'Point the agent app at a backend that resolves.' },
  { seen: 'grant vanishes', log: 'RDP terminate: policy deleted', fix: 'Do not create a new grant policy for the key; edit the key\'s existing one.' },
  { seen: 'console refuses save', log: 'Spec.UserClaim resolves to "sub" …', fix: 'With End user on sub, widen the subject to * and pin the agent with required claims.' },
];

const N = (id, group, label, sub, x, y) => ({ id, group, label, sub, x, y });
const E = (src, tgt, label, opts) => (opts ? [src, tgt, label, opts] : [src, tgt, label]);
const V = { vertical: true };

export const PF_TOKEN_DIAGRAM = {
  GROUPS: {
    demo: { label: 'This page (a client; decides nothing)', bg: 'var(--th-status-info)' },
    pf: { label: 'PingFederate', bg: 'var(--th-status-warning)' },
    priv: { label: 'Agent Privilege (gateway)', bg: 'var(--th-bg-emphasis)' },
  },
  NODES: [
    N('bff', 'demo', 'Demo BFF', ['holds the client secret;', 'returns claims, never the token'], 0, 0),
    N('pf', 'pf', 'PingFederate', ['client credentials ->', 'JWT with act.sub = agent'], 380, 0),
    N('door', 'priv', 'P1 Privilege Agent App pftoken', ['Pass Agent Token'], 0, 200),
    N('nhi', 'priv', 'Identity PFtoken', ['issuer, audience, subject *,', 'act.sub + client_id pinned'], 380, 200),
    N('key', 'priv', 'Agent key pftoken-agent', ['custodian = PFtoken'], 760, 200),
    N('grant', 'priv', 'Grant on the key', ['scope tiers (RequiredClaims):', 'admin -> 9 tools, read -> 3, else 403'], 760, 400),
    N('tools', 'priv', 'OpenSearch MCP', ['tools/list answered'], 380, 400),
    N('rs', 'priv', 'Agent app pftoken-rs -> MCP resource server', ['whoami: the claims it verified', 'on the forwarded token'], 0, 400),
  ],
  EDGES: [
    E('bff', 'pf', 'mint'), // 0
    E('bff', 'door', 'tools/list + JWT', V), // 1
    E('door', 'nhi', 'verify'), // 2
    E('nhi', 'key', 'match'), // 3
    E('key', 'grant', 'authorize', V), // 4
    E('grant', 'tools', 'allowed by scope'), // 5
    E('grant', 'rs', 'same JWT, passed through'), // 6
  ],
  STEPS: [
    { key: 'mint', edges: [0], title: 'PingFederate mints the agent\'s token', what: 'The BFF asks PingFederate for client-credentials tokens for pf-route-c-test, one per scope tier (opensearch:admin, opensearch:read, neither). Each carries sub, client_id, the agent app URL as aud, act = {"sub": "pf-route-c-test"} and the requested scope.', why: 'act.sub names the agent; it is what the identity pins. scope is what the grant reads.' },
    { key: 'present', edges: [1], title: 'The token goes to the P1 Privilege Agent App', what: 'The BFF calls tools/list on the pftoken agent app with the PingFederate JWT as the bearer. The agent app is on Pass Agent Token.', why: 'No Privilege secret is involved; the PingFederate token is the credential.' },
    { key: 'verify', edges: [2, 3], title: 'The gateway verifies it against the identity', what: 'Issuer and signature (from the PingFederate JWKS), audience, subject, the required claims act.sub and client_id, and lifetime. A match maps the token to the agent key pftoken-agent.', why: 'A mismatch is a 401, and the log names the claim.' },
    { key: 'grant', edges: [4], title: 'The key\'s grant decides by scope', what: 'The key\'s grant has two rules for pftoken, each with RequiredClaims on scope: opensearch:admin gets all nine tools, opensearch:read the three read tools.', why: 'Same agent, same agent app: a token with neither scope matches no rule and gets 403.' },
    { key: 'tools', edges: [5], title: 'The tools come back', what: 'The gateway forwards to the OpenSearch MCP server and returns the tool list the matching rule allows.', why: 'The page shows exactly what the gateway returned for each scope.' },
    { key: 'passthrough', edges: [6], title: 'The backend sees the agent\'s own token', what: 'On the agent app pftoken-rs the same PingFederate JWT reaches the MCP resource server unchanged. Its whoami tool returns every claim it verified.', why: 'Pass Agent Token forwards the token; it does not swap in a gateway credential or narrow the scopes.' },
  ],
};
