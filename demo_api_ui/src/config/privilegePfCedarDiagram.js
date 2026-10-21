// PingFederate identity -> Privilege AI policy (Cedar). Source: privilege/PF-CLAIMS-IN-CEDAR-POLICIES.md
// (measured 2026-10-20). Dashed arrows are the route-A design that is NOT set up yet: PF is not registered
// anywhere in Privilege today. Solid arrows were observed on the SE gateway (door opensearch-hitl).
const N = (id, group, label, sub, x, y) => ({ id, group, label, sub, x, y });
const E = (src, tgt, label, opts) => (opts ? [src, tgt, label, opts] : [src, tgt, label]);
const DASH = { dashed: true };
const PFD = { color: 'var(--th-status-warning)', dashed: true };

export const PF_CEDAR_GROUPS = {
  user: { label: 'Caller', bg: 'var(--th-status-info)' },
  pf: { label: 'PingFederate (route A, not set up)', bg: 'var(--th-status-warning)' },
  p1: { label: 'PingOne', bg: 'var(--th-status-success)' },
  gw: { label: 'Privilege gateway', bg: 'var(--th-bg-emphasis)' },
};

export const PF_CEDAR_NODES = [
  N('caller', 'user', 'MCP client', ['signs in as a PF user', 'calls a tool'], 0, 150),
  N('door', 'gw', 'Gateway door', ['opensearch-hitl', 'issuer = the door itself'], 380, 150),
  N('priv', 'p1', 'PingOne 0428ba4f', ['Privilege "AI Agent" env', 'issues the token', 'fixed scopes'], 760, 40),
  N('demo', 'p1', 'PingOne 01d89b06', ['demo env', 'federation app + sign-on'], 1140, 40),
  N('pf', 'pf', 'PingFederate', ['external OIDC IdP', 'not registered anywhere yet'], 1140, 260),
  N('dir', 'gw', 'Privilege directory', ['users + email aliases', 'groups'], 760, 260),
  N('cedar', 'gw', 'AI policy (Cedar)', ['aipolicys, State Active', 'app, tool, args, scopes, group'], 380, 380),
  N('tool', 'gw', 'OpenSearch MCP tool', ['SearchIndexTool', 'runs only if allowed'], 0, 380),
];

export const PF_CEDAR_EDGES = [
  E('caller', 'door', 'tools/call with no token: 401, the door is its own authorization server'), // 0
  E('door', 'priv', '302 /authorize: scopes openid profile email offline_access p1:read:*'), // 1
  E('priv', 'demo', 'federates onward to the demo environment (one login)'), // 2
  E('demo', 'pf', 'Route A: PF added as an external OIDC IdP', PFD), // 3
  E('pf', 'demo', 'PF authenticates the user; identity comes back, not PF claims', PFD), // 4
  E('priv', 'door', 'token issued by 0428ba4f; PF scopes are not expected in it', DASH), // 5
  E('door', 'dir', 'caller matched to a Privilege user by email alias; groups loaded', DASH), // 6
  E('door', 'cedar', 'evaluate: context.app, Tool, context.args, context.token.scopes, principal in Group'), // 7
  E('cedar', 'door', 'allow, refuse (mcp:Invoke) or hold for a human (mcp:InvokeUnattended)', DASH), // 8
  E('door', 'tool', 'forwarded only when allowed; a hold waits for approval, then the client retries'), // 9
];

export const PF_CEDAR_STEPS = [
  { key: 'door', edges: [0, 1], title: 'The door is its own authorization server', what: 'An unauthenticated call gets a 401 whose metadata names the door itself as issuer. Its /authorize redirects to the Privilege-owned PingOne environment 0428ba4f with a fixed scope list.', why: 'A PingFederate token never reaches the door; there is no PF trust to configure at the app.' },
  { key: 'federate', edges: [2], title: 'Sign-in is federated to the demo environment', what: 'Environment 0428ba4f hands the sign-in on to 01d89b06, the demo environment, so the user logs in once, there.', why: 'That is the only place PingFederate can be added without touching Privilege.' },
  { key: 'pf', edges: [3, 4], title: 'Route A: PingFederate as an external IdP', what: 'PF would be added to 01d89b06 the way AIC already is: an IdP object plus a sign-on policy on the federation app. PF authenticates; PingOne takes the identity. Not done yet, and a write to ask about first.', why: 'This brings the PF user in. It does not carry PF claims through to Cedar.' },
  { key: 'token', edges: [5], title: 'The token Cedar sees is Privilege\'s', what: '0428ba4f issues the token with its own scopes. PF scopes appearing in context.token.scopes is untested; assume they do not.', why: 'Protect on identity and groups, not on a PF scope, until a live call proves otherwise.' },
  { key: 'principal', edges: [6], title: 'The caller becomes a Privilege principal', what: 'The gateway matches the caller to a Privilege user by email alias and loads that user\'s groups. Its log reports the registry: 4 users (+4 email aliases), 4 agents, 1 group, 112 resources.', why: 'Group rules only work for people who exist in the Privilege directory.' },
  { key: 'cedar', edges: [7, 8], title: 'Cedar decides', what: 'Active AI policies run on every call. The vocabulary is fixed: app, tool, arguments, token scopes, agent scopes, group, named agent, approval count. There is no raw claims object and no act or ID-JAG hook.', why: 'A rule can only name attributes the engine exposes.' },
  { key: 'tool', edges: [9], title: 'Allowed calls reach the tool', what: 'A refusal logs mcp_policy_denied. A hold logs mcp_policy_approval_required and opens an approval; the client retries after it is approved. Policies created as Candidate never enforce until set to Active.', why: 'The hold-approve-retry loop is the same one proven on this door for SearchIndexTool.' },
];

export const PF_CEDAR_DIAGRAM = { GROUPS: PF_CEDAR_GROUPS, NODES: PF_CEDAR_NODES, EDGES: PF_CEDAR_EDGES, STEPS: PF_CEDAR_STEPS };
