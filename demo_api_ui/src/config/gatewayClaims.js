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

// The Required claims on the Federated Identity (the Privilege policy rule).
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
    '    participant N as Federated Identity\\nRequiredClaims rule',
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
  N: 'The Federated Identity trusting the PingFederate issuer. Its RequiredClaims are the rule: client_id and act.sub equal the agent id.',
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
  { where: 'Federated Identity: Required claims', value: 'client_id = <agent id>  and  act.sub = <agent id>' },
  { where: 'Federated Identity: Audience', value: 'the P1 Privilege Agent App URL' },
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

// Part 3: measured 2026-10-27 (source: the two measured-run notes; Cedar run on gateway v1.261027, scope-tier run on v1.261024).
// Names below are the demo's own sample app/tool/scope names, not tenant identifiers.
export const NEXT_RELEASE = {
  version: 'v1.261027',
  novelty: 'Binary symbol diff of the gateway image v1.261024 against v1.261027 (2026-10-27). Mainly the two top layers (8 and 9) differ; layers 5 and 6 differ by a few bytes. Ping published no release notes for this tag. The measured results below are separate from the diff: they show what works, not what is new.',
  cedarPolicy: [
    'forbid (principal,',
    '  action in [Action::"mcp:Invoke", Action::"mcp:InvokeUnattended"],',
    '  resource == Tool::"SearchIndexTool")',
    'when { context.app == "pftoken" }',
    'unless { context has token && context.token.scopes.contains("opensearch:search") };',
  ].join('\n'),
};

export const NEXT_RELEASE_RESULTS = [
  { evidence: 'verified', gateway: 'v1.261027', what: 'Cedar gates a tool call on the PingFederate token scope',
    detail: 'Without opensearch:search the call is refused with JSON-RPC 400 -32600 "action denied by policy". With it the call returns 200. Other tools are unaffected. The gateway log shows a policy_decision event.' },
  { evidence: 'verified', gateway: 'v1.261024', what: 'Grant rules gate on token claims, and two rules make tiers',
    detail: 'Two rules on the same agent app with different tools and different required claims gave 3 tools, 9 tools or 403, depending on the token scope. A list of values means any of them. A scope is split per value, so requiring whoami:read matches the scope "openid whoami:read". A mismatch is a 403.' },
];

export const NEXT_RELEASE_TRAPS = [
  { symptom: 'Policy made through the API never denies', cause: 'It is stored with State "" (a candidate). It is compiled and shadow-evaluated only, and logs mcp_policy_shadow_delta.', fix: 'PUT the policy with State "Active".' },
  { symptom: '401 token_not_found after asking PingFederate for a scope', cause: 'A client_credentials request with scope= is served by a different token manager, with no sub and no act.', fix: 'Send resource=<the agent app URL> so PingFederate picks the token manager the gateway trusts.' },
  { symptom: 'Clearing required claims does nothing', cause: 'PUT with an empty claims map is ignored; the old value stays.', fix: 'Delete the RequiredClaims field from the rule.' },
];

// Symbols that exist in v1.261027 and not in v1.261024 (strings diff of the mcpgw binary). Nothing here is in the console API
// baseline of 2026-10-26 and none of it has been run, so every row is UNVERIFIED and the readings are ours.
export const NEXT_RELEASE_DIFF = [
  { change: 'More AgentCore posture fields', symbols: 'CallerAccessJSON (gateway); RuntimeCallerAccessJSON, TargetCallerAccessJSON, BypassDiffJSON (account); agentCoreEndpointMissing',
    reading: 'Builds on section 2: who can call an AgentCore gateway, runtime or target, and how the account differs from the bypass posture.' },
  { change: 'SIEM provider: new sign-in method', symbols: 'SiemAuthMethod; AuthMethod, AzureTenantId, ClientCertificatePEM, DcrImmutableId, WorkspaceId',
    reading: 'Reads like sending events to an Azure workspace through a data collection rule, signing in with a client certificate.' },
  { change: 'Approval action on an AI policy request', symbols: 'aipolicy.Request.ApprovalAction',
    reading: 'A policy result that asks for approval instead of allow or deny. We have not seen it return one.' },
  { change: 'A rate and period structure', symbols: 'entries > requests > rate, period',
    reading: 'A configuration shape for rate limits. We do not know where it is used.' },
  { change: 'Cedar scope gate', symbols: 'none',
    reading: 'The diff shows nothing about it. We know it works on v1.261027 but cannot say it is new in this tag.' },
];

// ---------------------------------------------------------------------------------------------------------------------
// v1.261027 lab: three measured behaviours, each as a tiny pure model so the page can run them. Source: privilege/
// PF-TOKEN-EXCHANGE-PASS-AGENT-TOKEN.md (parts F and H, sections 15 and 16) and privilege/PF-CLAIMS-IN-CEDAR-POLICIES.md,
// measured 2026-10-27. Hosts, ids and tokens are placeholders; only the SHAPE and the outcomes are real.
// ---------------------------------------------------------------------------------------------------------------------
export const GATEWAY_VERSION_NEXT = 'v1.261027';
export const APP_URL = 'https://mcpgw.example.com/pftoken/mcp';
export const OPENSEARCH_TOOLS_READ = ['ListIndexTool', 'SearchIndexTool', 'CountTool'];
export const GUARDED_TOOL = 'SearchIndexTool';
export const GUARDED_SCOPE = 'opensearch:search';

export const NEXT_GROUPS = [
  { id: 'cedar', label: 'Cedar scope gate', blurb: 'An AI policy (Cedar) refuses a tool call unless the PingFederate token carries a scope.' },
  { id: 'pf', label: 'PingFederate resource= trap', blurb: 'Which PingFederate token manager answers decides whether the gateway accepts the token at all.' },
  { id: 'tiers', label: 'RequiredClaims scope tiers', blurb: 'Two grant rules on one agent app give the same agent 9 tools, 3 tools or a 403, by token scope.' },
];

/** AI policy decision for one tools/call. state "Active" enforces; the API-created state "" is a candidate: shadow only. */
export function evaluateCedarScope({ tool, scopes, state }) {
  const scopeList = String(scopes || '').split(/\s+/).filter(Boolean);
  const wouldDeny = tool === GUARDED_TOOL && !scopeList.includes(GUARDED_SCOPE);
  if (wouldDeny && state === 'Active') {
    return { allowed: false, status: 400, rpcCode: -32600, message: `action denied by policy: ${GUARDED_TOOL} needs the ${GUARDED_SCOPE} scope in the agent's token`, log: `aipolicy: denied PFtoken calling ${GUARDED_TOOL} on pftoken (policies=[pftoken-scope-search:1])`, event: 'policy_decision', wouldDeny };
  }
  if (wouldDeny) {
    return { allowed: true, status: 200, log: 'mcp_policy_shadow_delta: candidate policy would have returned deny where the active set returned allow', event: 'mcp_policy_shadow_delta', wouldDeny };
  }
  return { allowed: true, status: 200, log: 'workload token accepted for key pftoken-agent, no policy denial', event: null, wouldDeny };
}

/** Which PingFederate token manager answers a client_credentials request, and what the gateway then does with the token. */
export function evaluatePfRequest({ param }) {
  if (param === 'resource') {
    return { manager: 'routeCTestAtm (JWT)', aud: APP_URL, hasSubAct: true, allowed: true, status: 200, log: 'workload token accepted for key pftoken-agent' };
  }
  return { manager: 'pi.atm (q0cl)', aud: 'enduser.ping.demo', hasSubAct: false, allowed: false, status: 401, log: 'auth rejected: reason=token_not_found app=pftoken method=POST path=/pftoken/mcp' };
}

/** Two grant rules on one app, each with RequiredClaims on scope. A listed value means any of; the token scope is split per value. */
export const TIER_RULES = [
  { name: 'Tier 1 (read)', tools: OPENSEARCH_TOOLS_READ, requiredScopes: ['opensearch:read'] },
  { name: 'Tier 2 (admin)', tools: ['all nine tools'], toolCount: 9, requiredScopes: ['opensearch:admin'] },
];
export function evaluateTiers({ scope, rules = TIER_RULES }) {
  const have = String(scope || '').split(/\s+/).filter(Boolean);
  const matched = rules.filter((r) => r.requiredScopes.some((s) => have.includes(s)));
  if (!matched.length) return { allowed: false, status: 403, count: 0, matched: [], log: 'policy denied: no grant rule matched the token claims' };
  const size = (r) => r.toolCount || r.tools.length;
  const widest = matched.reduce((a, b) => (size(b) > size(a) ? b : a));
  return { allowed: true, status: 200, count: size(widest), matched: matched.map((r) => r.name), log: `workload token accepted for key pftoken-agent, rule "${widest.name}"` };
}

const MEASURED = 'Measured 2026-10-27 on the real gateway.';
const cedarSc = (id, label, input, evidenceNote, story) => ({ id, group: 'cedar', label, input, result: evaluateCedarScope(input), evidence: 'verified', evidenceNote, story });
const tierSc = (id, label, input, evidenceNote, story, rules) => ({ id, group: 'tiers', label, input, result: evaluateTiers({ ...input, rules }), evidence: 'verified', evidenceNote, story });

export const NEXT_SCENARIOS = [
  cedarSc('cedar-missing', 'No opensearch:search, policy Active', { tool: GUARDED_TOOL, scopes: 'openid opensearch:admin', state: 'Active' },
    `${MEASURED} gateway v1.261027: JSON-RPC 400, code -32600.`, 'The token is valid and the key is allowed the tool, but the Cedar forbid fires because the token has no opensearch:search scope.'),
  cedarSc('cedar-present', 'With opensearch:search', { tool: GUARDED_TOOL, scopes: 'openid opensearch:admin opensearch:search', state: 'Active' },
    `${MEASURED} HTTP 200 with search results.`, 'Same token plus the one scope the policy asks for: the unless clause is true, so the forbid does not apply.'),
  cedarSc('cedar-other-tool', 'Other tool, no scope', { tool: 'ListIndexTool', scopes: 'openid opensearch:admin', state: 'Active' },
    `${MEASURED} Other tools were unaffected.`, 'The forbid names SearchIndexTool only, so every other tool call goes through on the same token.'),
  cedarSc('cedar-candidate', 'Policy still a candidate', { tool: GUARDED_TOOL, scopes: 'openid opensearch:admin', state: '' },
    `${MEASURED} The call was allowed and the log said the candidate policy would have denied.`, 'A policy created through the API is stored with State "" (a candidate). It is compiled and logged in shadow, never enforced. PUT it with State "Active" to make it bite.'),
  { id: 'pf-scope-only', group: 'pf', label: 'Token request with scope= only', input: { param: 'scope' }, result: evaluatePfRequest({ param: 'scope' }), evidence: 'verified',
    evidenceNote: `${MEASURED} Audience enduser.ping.demo, no sub, no act; gateway 401 token_not_found.`, story: 'A client_credentials request that names a scope but no resource is served by a different token manager. The token is a perfectly good PingFederate token, but it is not one the gateway accepts.' },
  { id: 'pf-resource', group: 'pf', label: 'Token request with resource=', input: { param: 'resource' }, result: evaluatePfRequest({ param: 'resource' }), evidence: 'verified',
    evidenceNote: `${MEASURED} HTTP 200 on tools/list.`, story: 'Sending resource=<the agent app URL> makes PingFederate pick the token manager the gateway trusts. The token carries the agent audience, sub and the object-valued act.' },
  tierSc('tier-admin', 'Token scope opensearch:admin', { scope: 'openid opensearch:admin' }, `${MEASURED} All nine tools listed.`, 'The admin rule requires opensearch:admin; the scope is split per value, so it matches "openid opensearch:admin".', TIER_RULES),
  tierSc('tier-read', 'Token scope opensearch:read', { scope: 'openid opensearch:read' }, `${MEASURED} The three read tools listed.`, 'Only the read rule matches, so the same agent sees three tools.', TIER_RULES),
  tierSc('tier-none', 'Neither scope', { scope: 'openid' }, `${MEASURED} HTTP 403.`, 'The token is accepted but no grant rule matches its claims, so the gateway answers 403 and logs policy denied.', TIER_RULES),
  tierSc('tier-whole-string', 'Rule asks for the whole scope string', { scope: 'openid opensearch:read' }, `${MEASURED} Requiring "openid opensearch:read" did not match that token.`,
    'Scopes are matched one at a time. A rule that lists the whole space-joined string never matches, so the agent gets 403 even though the text is in the token.', [{ name: 'Whole-string rule', tools: OPENSEARCH_TOOLS_READ, requiredScopes: ['openid opensearch:read'] }]),
];

const tokenFor = (s) => {
  if (s.group === 'pf') {
    const r = s.result;
    return { iss: 'https://pf.example.com', aud: r.aud, client_id: 'agent-example-01', ...(r.hasSubAct ? { sub: 'agent-example-01', act: { sub: 'agent-example-01' } } : {}), scope: 'openid opensearch:read', exp: 1790000600 };
  }
  const scope = s.input.scopes ?? s.input.scope;
  return { iss: 'https://pf.example.com', sub: 'agent-example-01', aud: APP_URL, client_id: 'agent-example-01', act: { sub: 'agent-example-01' }, scope, exp: 1790000600 };
};

/** The wire for a scenario: request and response text, plus the decoded token, as the page shows them. */
export function nextWire(s) {
  const r = s.result;
  const token = tokenFor(s);
  if (s.group === 'pf') {
    return {
      token,
      request: `POST https://pf.example.com/as/token.oauth2\nAuthorization: Basic <client id:secret, never shown>\nContent-Type: application/x-www-form-urlencoded\n\ngrant_type=client_credentials&scope=openid opensearch:read${s.input.param === 'resource' ? `&resource=${APP_URL}` : ''}`,
      response: `Token manager: ${r.manager}\n${JSON.stringify(token, null, 2)}\n\nThen: POST ${APP_URL}  {"method":"tools/list"}\n=> HTTP ${r.status}\nGateway log: ${r.log}`,
    };
  }
  const call = s.group === 'cedar'
    ? { method: 'tools/call', params: { name: s.input.tool, arguments: { query: 'example' } } }
    : { method: 'tools/list' };
  const request = `POST ${APP_URL}\nAuthorization: Bearer <token below>\nContent-Type: application/json\n\n${JSON.stringify({ jsonrpc: '2.0', id: 1, ...call })}`;
  let response;
  if (s.group === 'cedar') {
    response = r.allowed ? 'HTTP 200\n{"result": "search results"}' : `HTTP 400\n${JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: r.rpcCode, message: r.message } })}`;
  } else {
    response = r.allowed ? `HTTP 200\n${r.count} tools` : 'HTTP 403 Forbidden';
  }
  return { token, request, response: `${response}\nGateway log: ${r.log}` };
}

export const NEXT_DETAILS = {
  A: 'The caller. It holds a PingFederate token and presents it as a bearer. It never holds a Privilege-issued key.',
  F: 'PingFederate. Which token manager answers (decided by resource=) sets the audience and whether sub and act exist.',
  G: 'Privilege gateway, mcpgw. Verifies the token, then runs the grant rules and the AI policies on the call.',
  N: 'The decision point for this scenario: the AI policy (Cedar) for the scope gate, the grant rules with RequiredClaims for the tiers.',
  B: 'The MCP server behind the P1 Privilege Agent App, reached only when the gateway allows the call.',
};
export const NEXT_LANES = DIAGRAM_LANES;

export function nextScenarioDiagram(s) {
  const r = s.result;
  const w = nextWire(s);
  const rows = ['sequenceDiagram', '    autonumber', '    participant A as Agent\\nthe caller'];
  const msgs = [];
  if (s.group === 'pf') {
    rows.push('    participant F as PingFederate\\nissues the token', '    participant G as Privilege gateway\\nmcpgw v1.261027', '    participant B as MCP server\\nbehind the Agent App');
    msgs.push([`A->>F: Token request, ${s.input.param === 'resource' ? 'scope and resource' : 'scope only'}`, w.request]);
    msgs.push([`F-->>A: Token from ${r.manager}, aud ${r.aud}${r.hasSubAct ? ', with sub and act' : ', no sub, no act'}`, JSON.stringify(w.token, null, 2)]);
    msgs.push(['A->>G: tools/list with the bearer', `POST ${APP_URL}\nAuthorization: Bearer <token>`]);
    if (r.allowed) {
      msgs.push(['G->>B: Forwards the verified token', 'Authorization: Bearer <same token>']);
      msgs.push(['B-->>A: HTTP 200 with the tools', 'HTTP 200\n9 tools']);
    } else {
      msgs.push([`G-->>A: HTTP 401, token_not_found`, `HTTP 401\n${r.log}`]);
    }
  } else {
    rows.push('    participant G as Privilege gateway\\nmcpgw v1.261027', `    participant N as ${s.group === 'cedar' ? 'AI policy (Cedar)\\npftoken-scope-search' : 'Grant rules\\nRequiredClaims on scope'}`, '    participant B as MCP server\\nbehind the Agent App');
    msgs.push([`A->>G: ${s.group === 'cedar' ? `tools/call ${s.input.tool}` : 'tools/list'} with the bearer`, w.request]);
    msgs.push(['G->>N: ' + (s.group === 'cedar' ? `Evaluate with context.token.scopes = [${String(s.input.scopes).split(' ').join(', ')}]` : `Match the rules against scope "${s.input.scope}"`), JSON.stringify(w.token, null, 2)]);
    const verdict = s.group === 'cedar'
      ? (r.allowed ? (r.wouldDeny ? 'N-->>G: Candidate: would deny, logged in shadow, so allowed' : 'N-->>G: No forbid applies, allowed') : `N-->>G: forbid fires: ${r.message}`)
      : (r.allowed ? `N-->>G: Rule matched, ${r.count} tools` : 'N-->>G: No rule matched');
    msgs.push([verdict, r.log]);
    if (r.allowed) {
      msgs.push(['G->>B: Forwards the call', 'Authorization: Bearer <same token>']);
      msgs.push(['B-->>A: HTTP 200', w.response]);
    } else {
      msgs.push([`G-->>A: HTTP ${r.status}`, w.response]);
    }
  }
  rows.push('    rect rgb(225,229,238)', ...msgs.map(([m]) => `    ${m}`), '    end');
  return { source: wrapMessages(`${rows.join('\n')}\n`), payloads: msgs.map(([, p]) => p) };
}
