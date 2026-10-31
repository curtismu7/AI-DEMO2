// Non-human identity (NHI) in PingOne Privilege: what an agent identity is made of, and the checks the gateway
// runs on each call. Sources: privilege/GATEWAY-SETTING-UP-A-CALLING-AGENT.md and the privilege-nhi-setup notes.
// Workload-identity acceptance on the gateway is not yet proven, so the NHI path is drawn as the design, not a tested flow.
const N = (id, group, label, sub, x, y) => ({ id, group, label, sub, x, y });
const E = (src, tgt, label, opts) => (opts ? [src, tgt, label, opts] : [src, tgt, label]);
const FAIL = { color: 'var(--th-status-warning)', dashed: true };

// ─── 1. Entity map ───
export const NHI_ENTITY_GROUPS = {
  who: { label: 'Who the key acts as', bg: 'var(--th-status-info)' },
  core: { label: 'Agent identity', bg: 'var(--th-bg-emphasis)' },
  attr: { label: 'Attached to the key', bg: 'var(--th-status-success)' },
  target: { label: 'Reachable', bg: 'var(--th-border-strong)' },
};

export const NHI_ENTITY_NODES = [
  N('custodian', 'who', 'Custodian', ['the human the agent acts as', 'policy is issued to them'], 0, 40),
  N('nhi', 'who', 'NonHumanIdentity', ['secretless: issuer, audience,', 'subject, expiry'], 0, 300),
  N('key', 'core', 'Agent access key', ["the agent's whole identity", 'Bearer key on every call'], 300, 170),
  N('apps', 'target', 'Apps and models', ['MCP servers, A2A agents,', 'LLM providers'], 0, 170),
  N('scopes', 'attr', 'Scopes', ['llm · mcp · a2a'], 600, 40),
  N('limits', 'attr', 'Limits', ['models · RPM/TPM · budget', 'NotAfter'], 600, 170),
  N('guard', 'attr', 'Guardrail (AI Guard)', ['per key, not per app'], 600, 300),
  N('grant', 'attr', 'Grant (pacpolicys)', ['created when apps are', 'selected on the key'], 600, 430),
];

export const NHI_ENTITY_EDGES = [
  E('custodian', 'key', 'acts as: policy is issued to the custodian'), // 0
  E('nhi', 'key', 'or supplies federation: no static secret', FAIL), // 1
  E('key', 'apps', 'reaches, through the grant'), // 2
  E('key', 'scopes', 'limits which surfaces it can reach'), // 3
  E('key', 'limits', 'caps models, rate, budget, expiry'), // 4
  E('key', 'guard', 'screens its traffic (AI Guard)'), // 5
  E('key', 'grant', 'selecting apps on the key creates this'), // 6
  E('grant', 'apps', 'which apps and tools it covers'), // 7
];

export const NHI_ENTITY_STEPS = [
  { key: 'who', edges: [0, 1], title: 'Who the key acts as', what: 'Every agent key has a custodian: the human it acts as. Policy is issued to them and the gateway log names them. A key can instead be owned by a NonHumanIdentity, which proves itself with a platform token and holds no static secret.', why: 'If the custodian goes inactive, the key stops working. Pick someone who will stay.' },
  { key: 'grant', edges: [6], title: 'Selecting apps creates the grant', what: 'When apps are selected on the key, Privilege creates a policy issued to the custodian and tied to this key. For MCP apps the grant can list individual tools.', why: 'Selecting the app is the grant. Nothing else needs writing.' },
  { key: 'reach', edges: [2, 7], title: 'What it can reach', what: 'The key reaches the apps and models its grant covers, and the grant decides which tools are visible.', why: 'Tools not in the grant are hidden and refused.' },
  { key: 'limits', edges: [3, 4], title: 'Scopes and limits', what: 'Scopes (llm, mcp, a2a) set which gateway surfaces the key can use. Limits cap models, requests and tokens per minute, budget and expiry.', why: 'Give only the scopes the agent uses. A three-scope key is one secret that reaches models, tools and agents.' },
  { key: 'guard', edges: [5], title: 'The guardrail', what: 'AI Guard is configured on the key, not on the app. It is the only screen on agent-to-agent calls.', why: 'Defaults mostly alert rather than block, so thresholds are set on purpose.' },
];

// ─── 2. Gateway checks on each call ───
export const NHI_CHECK_GROUPS = {
  caller: { label: 'Caller', bg: 'var(--th-status-info)' },
  check: { label: 'Gateway check', bg: 'var(--th-bg-emphasis)' },
  pass: { label: 'Reaches target', bg: 'var(--th-status-success)' },
  refuse: { label: 'Refusal', bg: 'var(--th-status-warning)' },
};

export const NHI_CHECK_NODES = [
  N('agent', 'caller', 'Agent', ['sends Bearer key'], 0, 0),
  N('c1', 'check', '1. Key valid?', ['exists, not revoked, not expired'], 0, 120),
  N('c2', 'check', '2. Scope granted?', ['llm / mcp / a2a on the key'], 0, 240),
  N('c3', 'check', '3. App or model granted?', ['policy rule + model allowlist'], 0, 360),
  N('c4', 'check', '4. Within limits?', ['RPM, TPM, budget'], 0, 480),
  N('c5', 'check', '5. Guardrail passes?', ['AI Guard on this key'], 0, 600),
  N('ok', 'pass', 'Reaches app or model', ['the call goes through'], 0, 720),
  N('r1', 'refuse', '401 invalid virtual key', ['unknown, revoked or expired'], 420, 120),
  N('r2', 'refuse', '403 key not scoped', ['key lacks the scope (mcp access)'], 420, 240),
  N('r3', 'refuse', '403 Forbidden or model not allowed', ['gateway log: policy denied'], 420, 360),
  N('r4', 'refuse', '429 rate limit', ['retry-after header'], 420, 480),
  N('r5', 'refuse', '400 content_blocked', ['JSON-RPC -32600 security policy'], 420, 600),
];

export const NHI_CHECK_EDGES = [
  E('agent', 'c1', 'Bearer key on every call'), // 0
  E('c1', 'c2', 'pass'), // 1
  E('c2', 'c3', 'pass'), // 2
  E('c3', 'c4', 'pass'), // 3
  E('c4', 'c5', 'pass'), // 4
  E('c5', 'ok', 'pass: the call reaches the app or model'), // 5
  E('c1', 'r1', 'fail: unknown, revoked or expired', FAIL), // 6
  E('c2', 'r2', 'fail: no scope for this surface', FAIL), // 7
  E('c3', 'r3', 'fail: no grant, or model not allowed', FAIL), // 8
  E('c4', 'r4', 'fail: a cap is hit', FAIL), // 9
  E('c5', 'r5', 'fail: guardrail blocks the text', FAIL), // 10
];

export const NHI_CHECK_STEPS = [
  { key: 'key', edges: [0, 1, 6], title: 'Is the key alive?', what: 'The gateway looks the key up. An unknown, revoked or expired key gets 401 invalid virtual key.', why: 'Nothing else is checked for a key that does not exist.' },
  { key: 'scope', edges: [1, 7], title: 'Does it have the scope?', what: 'The key must carry the scope for the surface being called. A missing scope gets 403 key not scoped for mcp access, the only refusal that names its cause.', why: 'Scope is the coarse gate; grants refine it.' },
  { key: 'grant', edges: [2, 8], title: 'Is the app or model granted?', what: 'The target app must be selected on the key, and the model must be on the allowlist. A bare 403 here usually means the grant is missing; the gateway log says policy denied.', why: 'Most "it does not work" reports are a grant missing on this step.' },
  { key: 'limits', edges: [3, 9], title: 'Is it within its limits?', what: 'Requests per minute, tokens per minute and budget are enforced by the gateway. A hit returns 429 with retry-after.', why: 'Caps protect the budget and the upstream provider.' },
  { key: 'guard', edges: [4, 5, 10], title: 'Does the guardrail pass the text?', what: 'AI Guard screens the request on this key. A block returns 400 content_blocked, or a JSON-RPC -32600 error for MCP. The call that passes reaches the app or model.', why: 'Working as designed: check the key AI Guard events before blaming the app.' },
];

export const NHI_ENTITY_DIAGRAM = { GROUPS: NHI_ENTITY_GROUPS, NODES: NHI_ENTITY_NODES, EDGES: NHI_ENTITY_EDGES, STEPS: NHI_ENTITY_STEPS };
export const NHI_CHECK_DIAGRAM = { GROUPS: NHI_CHECK_GROUPS, NODES: NHI_CHECK_NODES, EDGES: NHI_CHECK_EDGES, STEPS: NHI_CHECK_STEPS };
