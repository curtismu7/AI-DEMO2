// /privilege-pf-token: a PingFederate-issued token, accepted by the Privilege gateway (verified 2026-10-26).
// Source of every value here: privilege/PF-TOKEN-EXCHANGE-PASS-AGENT-TOKEN.md, section "Working configuration".
export const DOC_URL = 'https://github.com/cmuir_pingcorp/AI-DEMO2/blob/main/privilege/PF-TOKEN-EXCHANGE-PASS-AGENT-TOKEN.md';

// What each gateway answer means. 401 and 403 are different layers: the log is the only place that names the reason.
export const VERDICTS = {
  allowed: { label: 'ALLOWED', tone: 'ok', note: 'The gateway accepted the PingFederate token and the agent key\'s grant let the call through.' },
  'allowed-no-tools': { label: 'ALLOWED, NO TOOLS', tone: 'warn', note: 'Accepted, but the door listed no tools. Its tools may not be discovered yet.' },
  'refused-by-policy': { label: 'REFUSED BY POLICY', tone: 'bad', note: 'The token was accepted, then a Privilege grant refused the call (403). The key has no grant on this door.' },
  'token-rejected': { label: 'TOKEN REJECTED', tone: 'bad', note: 'The gateway did not accept the token (401): issuer, audience, subject, a required claim or lifetime did not match the identity.' },
  error: { label: 'ERROR', tone: 'bad', note: 'The call did not complete.' },
};

// Every row had to be true at the same time for the 200.
export const WORKING_SETUP = [
  { layer: 'PingFederate', setting: 'Client', value: 'pf-route-c-test (client credentials)' },
  { layer: 'PingFederate', setting: 'Token manager', value: 'routeCTestAtm — audience and resource URI = the door URL' },
  { layer: 'PingFederate', setting: 'act claim', value: 'expression #{"sub": "pf-route-c-test"} (an object, not the text "{}")' },
  { layer: 'Privilege identity (NHI)', setting: 'PFtoken', value: 'issuer cmuir-pf, JWKS /pf/JWKS, subject *, audience = the door URL' },
  { layer: 'Privilege identity (NHI)', setting: 'Required claims', value: 'client_id = pf-route-c-test and act.sub = pf-route-c-test' },
  { layer: 'Privilege identity (NHI)', setting: 'End user', value: 'Opaque, claim sub' },
  { layer: 'Privilege agent key', setting: 'pftoken-agent', value: 'custodian = the PFtoken identity, scope mcp' },
  { layer: 'Privilege grant', setting: 'KarunRiver-5a485737526f', value: 'rule for door pftoken, key pftoken-agent, nine OpenSearch tools' },
  { layer: 'Privilege door', setting: 'pftoken', value: 'Pass Agent Token, backend opensearch-mcp-noget' },
  { layer: 'Gateway', setting: 'Version', value: 'privilege-aigw v1.261024 or later (discovers tools from the first agent call)' },
];

// What broke on the way, as the gateway log says it.
export const FAILURES = [
  { seen: '401', log: 'workload token rejected: required claim "act.sub" does not match', fix: 'Set the identity\'s act.sub to the agent id; make PingFederate emit act as an object.' },
  { seen: '403', log: 'policy denied PFtoken access to pftoken (agent=true)', fix: 'Add a rule for the door to the agent key\'s existing grant.' },
  { seen: 'no tools', log: 'tool discovery for pftoken failed: … no such host', fix: 'Point the door at a backend that resolves.' },
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
    priv: { label: 'Privilege gateway', bg: 'var(--th-bg-emphasis)' },
  },
  NODES: [
    N('bff', 'demo', 'Demo BFF', ['holds the client secret;', 'returns claims, never the token'], 0, 0),
    N('pf', 'pf', 'PingFederate', ['client credentials ->', 'JWT with act.sub = agent'], 380, 0),
    N('door', 'priv', 'Door pftoken', ['Pass Agent Token'], 0, 200),
    N('nhi', 'priv', 'Identity PFtoken', ['issuer, audience, subject *,', 'act.sub + client_id pinned'], 380, 200),
    N('key', 'priv', 'Agent key pftoken-agent', ['custodian = PFtoken'], 760, 200),
    N('grant', 'priv', 'Grant on the key', ['door pftoken, nine tools'], 760, 400),
    N('tools', 'priv', 'OpenSearch MCP', ['tools/list answered'], 380, 400),
  ],
  EDGES: [
    E('bff', 'pf', 'mint'), // 0
    E('bff', 'door', 'tools/list + JWT', V), // 1
    E('door', 'nhi', 'verify'), // 2
    E('nhi', 'key', 'match'), // 3
    E('key', 'grant', 'authorize', V), // 4
    E('grant', 'tools', 'allowed'), // 5
  ],
  STEPS: [
    { key: 'mint', edges: [0], title: 'PingFederate mints the agent\'s token', what: 'The BFF asks PingFederate for a client-credentials token for pf-route-c-test. The token carries sub, client_id, the door URL as aud, and act = {"sub": "pf-route-c-test"}.', why: 'act.sub names the agent; it is what the identity pins.' },
    { key: 'present', edges: [1], title: 'The token goes to the Privilege door', what: 'The BFF calls tools/list on the pftoken door with the PingFederate JWT as the bearer. The door is on Pass Agent Token.', why: 'No Privilege secret is involved; the PingFederate token is the credential.' },
    { key: 'verify', edges: [2, 3], title: 'The gateway verifies it against the identity', what: 'Issuer and signature (from the PingFederate JWKS), audience, subject, the required claims act.sub and client_id, and lifetime. A match maps the token to the agent key pftoken-agent.', why: 'A mismatch is a 401, and the log names the claim.' },
    { key: 'grant', edges: [4], title: 'The key\'s grant decides the door', what: 'The rule on the key\'s grant lets pftoken-agent use the nine tools on pftoken.', why: 'No rule is a 403 "policy denied", even with a valid token.' },
    { key: 'tools', edges: [5], title: 'The tools come back', what: 'The gateway forwards to the OpenSearch MCP server and returns the tool list.', why: 'The page shows exactly what the gateway returned.' },
  ],
};
