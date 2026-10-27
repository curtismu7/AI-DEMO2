// How Privilege decides an agent's tool call with Cedar INSIDE the gateway, and where our demo page and PingFederate fit.
// Ported from the corrected mock (~/Desktop/cedar-paths-mock.html), re-laid out for four columns: the renderer fits the whole
// graph to the container width, so more columns make the text unreadable. Solid arrows were observed on the SE gateway (door
// opensearch-hitl); dashed arrows are inferred or not proven, and each step says which in its title. The demo page is only a
// client: it sends a real call and shows the real result; it evaluates nothing. The renderer numbers the steps itself.
const N = (id, group, label, sub, x, y) => ({ id, group, label, sub, x, y });
const E = (src, tgt, label, opts) => (opts ? [src, tgt, label, opts] : [src, tgt, label]);
const DASH = { dashed: true };
const V = { vertical: true };
const VD = { vertical: true, dashed: true };
const PF = { color: 'var(--th-status-warning)' };

export const AI_POLICIES_GROUPS = {
  demo: { label: 'Our demo page (a client; it evaluates nothing)', bg: 'var(--th-status-info)' },
  priv: { label: 'Agent Privilege gateway (Cedar runs inside)', bg: 'var(--th-bg-emphasis)' },
  pf: { label: 'PingFederate (agent path measured 2026-10-26)', bg: 'var(--th-status-warning)' },
};

export const AI_POLICIES_NODES = [
  N('page', 'demo', 'AI Policies demo page', ['pick a scenario; shows the real', 'verdict + the real policy'], 0, 0),
  N('bff', 'demo', 'Privilege client (BFF)', ['tools/call with YOUR', 'Privilege sign-in'], 380, 0),
  N('pfagent', 'pf', 'Agent with a PF token', ['identity trusts the PF issuer;', 'act.sub pins the agent'], 0, 170),
  N('door', 'priv', 'Gateway door', ['opensearch-hitl: advertises', 'itself as the auth server'], 380, 170),
  N('auth', 'priv', 'Authenticate, resolve who', ['people: door OAuth, PingOne', '(PF = sign-in source only)', 'user by email alias + groups'], 760, 170),
  N('pac', 'priv', 'Access grant (pacpolicys)', ['union of grants per app;', 'optional RequiredClaims'], 1140, 170),
  N('cedar', 'priv', 'AI Policies = Cedar (aipolicys)', ['Active policies only;', 'run on every tools/call'], 1140, 340),
  N('tool', 'priv', 'ALLOW: backend tool runs', ['page shows the tool result'], 380, 510),
  N('refuse', 'priv', 'DENY: refused', ['page shows the gateway error', 'and the policy that decided'], 760, 510),
  N('hold', 'priv', 'HOLD: for a human', ['page shows the approval id', 'and a Retry button'], 1140, 510),
  N('approver', 'priv', 'Approver (console)', ['Access Request Approvals:', 'approve, then press Retry'], 1140, 680),
];

export const AI_POLICIES_EDGES = [
  E('page', 'bff', 'scenario'), // 0
  E('bff', 'door', 'tools/call', V), // 1
  E('pfagent', 'door', 'PF JWT', PF), // 2
  E('door', 'auth', 'who is calling'), // 3
  E('auth', 'pac', 'grants', DASH), // 4
  E('pac', 'cedar', 'then Cedar runs', VD), // 5
  E('cedar', 'tool', 'ALLOW', V), // 6
  E('cedar', 'refuse', 'DENY', V), // 7
  E('cedar', 'hold', 'HOLD', V), // 8
  E('hold', 'approver', 'approve in console', V), // 9
];

export const AI_POLICIES_STEPS = [
  { key: 'pick', edges: [0], title: 'Pick a real scenario', what: 'You pick a scenario on the page: a search that gets held, a call to the unrestricted API tool that is denied outright, a plain list call, or the PF agent (shown as not proven). The page asks its Privilege client to make that one tool call.', why: 'The page sends a call and shows what comes back. It never decides anything.' },
  { key: 'door', edges: [1], title: 'The call goes through the real door (measured)', what: 'The client sends tools/call to the opensearch-hitl door with your Privilege sign-in. The door advertises itself as the authorization server; with no valid token it answers a generic 401, the same for any bearer.', why: 'A bare 401 proves nothing about whether a token was understood.' },
  { key: 'who', edges: [3], title: 'Who is calling (inferred)', what: 'People sign in through PingOne env 0428ba4f (federated to the demo environment; PingFederate is only a sign-in source behind it). The gateway matches the caller to a Privilege user by email alias and loads their groups; its log reports 4 users, 4 agents, 1 group.', why: 'A PF token never reaches the door for people. The match by email is read from the log, not tested.' },
  { key: 'grant', edges: [4, 5], title: 'The grant gate (not exercised)', what: 'Grants decide which tools an identity sees in tools/list (the union of every non-expired policy). A rule can also require claim values on the presented token (RequiredClaims). The order relative to Cedar is inferred.', why: 'RequiredClaims exists in the console, but none of the 28 rules on this tenant use it.' },
  { key: 'cedar', edges: [5], title: 'Cedar decides, inside Privilege, on every call (measured)', what: 'AI Policies are Cedar. Only Active policies are compiled and enforced; Candidates are validated and stored but never enforced. The vocabulary is fixed: app, tool, args, token scopes, agent scopes, group, named agent, approval count.', why: 'No raw claims, no act, no ID-JAG hook: Cedar cannot read a PingFederate claim directly.' },
  { key: 'allow', edges: [6], title: 'Outcome: allow (measured)', what: 'A permit matched and no forbid did: the call is forwarded to the backend tool and the result comes back to the page.', why: 'Forbid always beats permit.' },
  { key: 'refuse', edges: [7], title: 'Outcome: refuse (measured)', what: 'A forbid matched, or nothing matched (default deny). The gateway logs mcp_policy_denied with the policy ids, and the page shows the real error and the policy that decided it.', why: 'The unrestricted API tool is blocked outright by an Active policy; a door with no policy denies everything.' },
  { key: 'hold', edges: [8, 9], title: 'Outcome: hold for a human (measured, verified 2026-10-13)', what: 'A forbid that names approvers on the unattended action opens an approval and returns its id. Someone approves it in the console; then Retry on the page passes.', why: 'Clients that are not hold-aware show a cryptic result and give up, so the page shows the approval id and the Retry step.' },
  { key: 'show', edges: [6, 7, 8], title: 'The page shows what the gateway returned', what: 'Whatever the gateway returned is shown as it is: the result, the real error, or the approval id, with the real Cedar policy text and name that decided it (mirrored from the live Active policies) and the raw response.', why: 'Everything on screen came from the gateway, not from the page.' },
  { key: 'pf-people', edges: [3], title: 'PingFederate and people (inferred)', what: 'For a person, PingFederate would only be a sign-in source behind PingOne: the Privilege user and their groups are what Cedar sees, not a PF claim. Adding PF there is a PingOne configuration, not a Privilege one.', why: 'So protecting on a PF claim cannot be done in Cedar for people.' },
  { key: 'pf-agent', edges: [2], title: 'PingFederate and agents (measured 2026-10-26)', what: 'An agent presents a PingFederate-issued JWT. The gateway verifies it against a non-human identity that trusts the PF issuer (audience = the door, act.sub and client_id pinned as required claims), maps it to the agent key, and applies the key\'s grant: tools/list returned 200 with all nine tools.', why: 'Claims are checked by the identity and the grant, not by Cedar. Try it on the PingFederate Token Demo page.' },
];

export const AI_POLICIES_DIAGRAM = { GROUPS: AI_POLICIES_GROUPS, NODES: AI_POLICIES_NODES, EDGES: AI_POLICIES_EDGES, STEPS: AI_POLICIES_STEPS };
