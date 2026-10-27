// /gateway-claims: what Privilege gateway (mcpgw) v1.261024 added.
// Part 1 (nested-claim gate) source of truth: privilege/PF-TOKEN-EXCHANGE-PASS-AGENT-TOKEN.md, "Working configuration"
// and its failure/fix table, verified live 2026-10-26 on gateway v1.261024. Part 2 (AgentCore posture) comes from the
// gateway binary's symbols only and is NOT in the console API. Every value shown here is a placeholder.
import { wrapMessages } from './sequenceWrap';

export const GATEWAY_VERSION = 'v1.261024';
export const DOC_PATH = 'privilege/PF-TOKEN-EXCHANGE-PASS-AGENT-TOKEN.md';

// Evidence labels used across the page. VERIFIED = seen on the real product. INFERRED = our reading, not run.
export const EVIDENCE = {
  verified: { label: 'VERIFIED', note: 'Seen on the real gateway.' },
  inferred: { label: 'INFERRED', note: 'Our reading of the mechanism. Not run on its own.' },
  unverified: { label: 'UNVERIFIED', note: 'Inferred from the gateway binary. Not seen in the console or API.' },
};

export const AGENT_ID = 'agent-example-01';
export const ISSUER = 'https://pf.example.com';
export const AUDIENCE = 'https://mcpgw.example.com/pftoken/mcp';

// The Required claims on the Non-Human Identity (the Privilege policy rule).
export const REQUIRED_CLAIMS = { client_id: AGENT_ID, 'act.sub': AGENT_ID };

/** Flatten nested objects into dotted paths. Arrays and primitives are leaves; the TEXT "{}" is a leaf, not an object. */
export function flattenClaims(claims, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(claims || {})) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, flattenClaims(v, path));
    else out[path] = v;
  }
  return out;
}

/** Check a token's claims against the required claims. Mirrors the gateway log `required claim "<path>" does not match`. */
export function evaluateRule(required, claims) {
  const flat = flattenClaims(claims);
  const checks = Object.entries(required).map(([path, expected]) => {
    const present = Object.prototype.hasOwnProperty.call(flat, path);
    return { path, expected, actual: present ? flat[path] : undefined, present, ok: present && flat[path] === expected };
  });
  const failed = checks.find((c) => !c.ok);
  return { allowed: !failed, checks, flat, log: failed ? `workload token rejected: required claim "${failed.path}" does not match` : null };
}

const BASE = { iss: ISSUER, sub: AGENT_ID, aud: AUDIENCE, client_id: AGENT_ID, scope: 'openid' };

export const SCENARIOS = [
  {
    id: 'match',
    label: 'Match',
    claims: { ...BASE, act: { sub: AGENT_ID } },
    evidence: 'verified',
    evidenceNote: 'Measured 2026-10-26 18:12 UTC on gateway v1.261024: HTTP 200 and all nine tools from the pftoken P1 Privilege Agent App.',
    story: 'PingFederate emits act as an object whose sub is the agent. The gateway flattens it to act.sub, both required claims match, and the call goes through.',
  },
  {
    id: 'wrong-act-sub',
    label: 'Wrong act.sub',
    claims: { ...BASE, act: { sub: 'some-other-agent' } },
    evidence: 'inferred',
    evidenceNote: 'Same mechanism as the measured failure, not run on its own. The doc records a mistyped required value (act.sub set to the audience), which failed the same way.',
    story: 'act is an object, but it names a different agent. act.sub is present and does not equal the required agent id, so the gateway refuses with 401.',
  },
  {
    id: 'no-act',
    label: 'No act',
    claims: { ...BASE },
    evidence: 'inferred',
    evidenceNote: 'Not run. The doc notes the earlier route C token had no act at all and "will not satisfy the recipe". The exact log wording for an absent claim was not captured.',
    story: 'The token has no act claim, so there is no act.sub to flatten. The required claim cannot match and the gateway refuses with 401.',
  },
  {
    id: 'act-text',
    label: 'act is the text "{}"',
    claims: { ...BASE, act: '{}' },
    evidence: 'inferred',
    evidenceNote: 'Seen only together with a second fault. On 2026-10-26 act arrived as the text "{}" and the gateway logged required claim "act.sub" does not match (401), but the required value was also mistyped in that run, so the text alone was never isolated.',
    story: 'The real trap. The PingFederate mapping emitted act as a string. A string has no sub, so nothing flattens to act.sub. The token looks right in a decoder and still fails. The fix is the mapping expression #{"sub": "<agent id>"}, which yields an object.',
  },
  {
    id: 'wrong-client',
    label: 'Wrong client_id',
    claims: { ...BASE, client_id: 'some-other-client', act: { sub: AGENT_ID } },
    evidence: 'inferred',
    evidenceNote: 'Not run. The required claims are all checked, so a wrong client_id should fail the same way. The log line is assumed to name client_id.',
    story: 'act.sub is right but client_id is another client. Every required claim must match, so one wrong value is enough for 401.',
  },
].map((s) => ({ ...s, result: evaluateRule(REQUIRED_CLAIMS, s.claims) }));

const PAYLOAD_CLAIMS = (c) => `Token claims (JWT, PLACEHOLDER values)\n${JSON.stringify(c, null, 2)}`;

function sequence(s) {
  const ok = s.result.allowed;
  const rows = [
    'sequenceDiagram',
    '    autonumber',
    '    participant A as Agent\\nthe caller',
    '    participant F as PingFederate\\nissues the token',
    '    participant G as Privilege gateway\\nmcpgw v1.261024',
    '    participant N as Non-Human Identity\\nRequiredClaims rule',
    '    participant B as MCP server\\nbehind the Agent App',
    '    rect rgb(255,235,222)',
    '    Note over A,F: 1 Get the token',
    '    A->>F: Token request (client credentials)',
    '    F-->>A: Access token with the claims shown below',
    '    end',
    '    rect rgb(218,240,240)',
    '    Note over A,N: 2 Present it and check the rule',
    '    A->>G: tools/list with the bearer, to the P1 Privilege Agent App pftoken',
    '    G->>F: Verify signature (JWKS), issuer and audience',
    '    G->>N: Flatten the claims, then check client_id and act.sub',
    ok ? '    N-->>G: Both required claims match' : '    N-->>G: Refused: ' + s.result.log,
    '    end',
    '    rect rgb(225,229,238)',
    `    Note over A,B: 3 ${ok ? 'Allowed' : 'Denied'}`,
    ...(ok
      ? ['    G->>B: Forwards the verified token (Pass Agent Token)', '    B-->>A: HTTP 200 with the nine tools']
      : ['    G-->>A: HTTP 401 Unauthorized']),
    '    end',
  ];
  return wrapMessages(rows.join('\n') + '\n');
}

export function scenarioDiagram(s) {
  const ok = s.result.allowed;
  const payloads = [
    'grant_type=client_credentials\nclient_id: agent-example-01\n(secret or key: never shown here)',
    PAYLOAD_CLAIMS(s.claims),
    `POST https://mcpgw.example.com/pftoken/mcp\nAuthorization: Bearer <access token>\n{"method": "tools/list"}`,
    `iss: ${ISSUER}\naud: ${AUDIENCE}\nsignature checked against the issuer's JWKS`,
    'Flattened claims\n' + Object.entries(s.result.flat).map(([k, v]) => `${k} = ${typeof v === 'string' ? v : JSON.stringify(v)}`).join('\n') + '\n\nRequired\n' + Object.entries(REQUIRED_CLAIMS).map(([k, v]) => `${k} = ${v}`).join('\n'),
    ok ? 'client_id: match\nact.sub: match' : `gateway log\n${s.result.log}`,
    ...(ok
      ? ['Authorization: Bearer <same token>\nThe agent app is in Pass Agent Token mode', 'HTTP 200\n9 tools: ListIndexTool, SearchIndexTool, ...']
      : ['HTTP 401 Unauthorized']),
  ];
  return { source: sequence(s), payloads };
}

export const DIAGRAM_LANES = { A: 'agent', F: 'pingone', G: 'gateway', N: 'authz', B: 'api' };
export const DIAGRAM_DETAILS = {
  A: 'The caller. It holds a PingFederate token and presents it as a bearer. It never holds a Privilege-issued key.',
  F: 'PingFederate: signs the token. The token mapping decides what act looks like, so a wrong expression here is the trap.',
  G: 'Privilege gateway, mcpgw. Verifies the signature, issuer and audience, then flattens nested claims and checks the rule.',
  N: 'The Non-Human Identity trusting the PingFederate issuer. Its RequiredClaims are the rule: client_id and act.sub equal the agent id.',
  B: 'The MCP server behind the P1 Privilege Agent App. In Pass Agent Token mode it receives the verified token.',
};

// The failure table from the doc, trimmed to the claim-related rows plus their fixes. All measured 2026-10-26.
export const TRAP_ROWS = [
  { symptom: '401, log: required claim "act.sub" does not match', cause: 'The required value was mistyped (set to the audience) and the token act was the text "{}".', fix: 'Set the required claim to the agent id. Make PingFederate emit act as an object.' },
];

// The PingFederate mapping facts and the rule, as shown on the page.
export const MAPPING_ROWS = [
  { where: 'PF mapping: sub, client_id', value: 'the client id (the agent id)' },
  { where: 'PF mapping: act', value: '#{"sub": "<agent id>"}  (an object, not the text "{}")' },
  { where: 'Non-Human Identity: Required claims', value: 'client_id = <agent id>  and  act.sub = <agent id>' },
  { where: 'Non-Human Identity: Audience', value: 'the P1 Privilege Agent App URL' },
];

export const WHAT_CHANGED = {
  version: GATEWAY_VERSION,
  how: 'Binary symbol diff of the gateway image v1.261023 against v1.261024. Only the two top layers (8 and 9) differ. Ping published no release notes for this tag.',
  confirmed: 'Nested claim matching works on v1.261024: a token with act.sub passed a rule that requires act.sub (the measured run).',
  inferred: 'That v1.261024 is where nested matching arrived is inferred from a new symbol, workloadid.Claims.FlatClaims. We did not run v1.261023 against the same token, so this is not proven.',
};

export const POSTURE_SAMPLE = {
  gateway: {
    name: 'sample-gateway',
    authorizerType: 'CUSTOM_JWT',
    jwtDiscoveryUrl: 'https://idp.example.com/.well-known/openid-configuration',
    allowedAudiences: ['sample-audience'],
    linkedAgents: ['sample-agent'],
    policyEngine: { arn: 'arn:aws:...:policy-engine/sample', mode: 'ENFORCE' },
    scorecard: 'sample score',
    wafFailureMode: 'sample mode',
  },
  policyEngine: { policyCount: 0, attachedGateways: ['sample-gateway'], kmsKeyArn: 'arn:aws:kms:...:key/sample', orphaned: false },
  account: { gatewayBypassPosture: 'sample posture', scorecard: 'sample score' },
};

export const POSTURE_GROUPS = [
  { object: 'Gateway', fields: [
    ['Authorizer type', 'How callers are authenticated to the gateway'],
    ['JWT discovery URL', 'Where the gateway finds the issuer metadata for JWT callers'],
    ['Allowed audiences', 'Which aud values the gateway accepts'],
    ['Linked agents', 'The agents attached to the gateway'],
    ['Policy engine ARN and mode', 'Which policy engine is attached and whether it enforces'],
    ['Scorecard', 'A posture score for the gateway'],
    ['WAF failure mode', 'What happens when the web application firewall fails'],
  ] },
  { object: 'Policy engine', fields: [
    ['Policy count', 'How many policies the engine holds'],
    ['Attached gateways', 'Which gateways use it'],
    ['KMS key ARN', 'The key protecting it'],
    ['Orphaned flag', 'True when no gateway uses the engine'],
  ] },
  { object: 'Account', fields: [
    ['Gateway-bypass posture', 'Whether traffic can reach agents around the gateway'],
    ['Scorecard', 'An account-level posture score'],
  ] },
  { object: 'Policy parsing', fields: [
    ['Cedar statements for AgentCore', 'The gateway can read Cedar statements from AgentCore policies'],
  ] },
];
