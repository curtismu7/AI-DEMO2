// /privilege-ai-policies: a Privilege demo. Cedar runs INSIDE the Privilege gateway; this page only sends real tool calls
// through a real door and shows what the gateway answered. Nothing here evaluates a policy.
// The policy texts are mirrors of the live ACTIVE AI policies on the opensearch-hitl door, read from the console on
// 2026-10-22 (State "Active"); the approver id is elided. If the console copy changes, these go stale: re-read them.

export const DOOR_NAME = 'opensearch-hitl';

export const POLICIES = {
  'hitl-opensearch': {
    state: 'Active',
    summary: 'Holds SearchIndexTool for a human unless an approval is on record.',
    cedar: `@grant("capability")
@ttl("900")
@request_ttl("3600")
@approvers("<approver id elided>")
@reason("This is HITL")
forbid (
  principal,
  action == Action::"mcp:InvokeUnattended",
  resource == Tool::"SearchIndexTool"
)
when   { context.app == "opensearch-hitl" }
unless { context has approval_count && context.approval_count >= 1 };`,
  },
  'hitl-block-generic-api': {
    state: 'Active',
    summary: 'Refuses GenericOpenSearchApiTool outright: no approval path.',
    cedar: `@reason("this tool can call any OpenSearch API endpoint - blocked outright, no approval path")
forbid (
  principal,
  action == Action::"mcp:Invoke",
  resource == Tool::"GenericOpenSearchApiTool"
)
when   { context.app == "opensearch-hitl" };`,
  },
};

// expect: what the gateway is expected to answer. 'hold' was verified end to end on this door on 2026-10-13.
// Backend tool arguments barely matter for hold and deny (the gateway decides before the backend runs).
export const SCENARIOS = [
  {
    id: 'hold',
    title: 'Hold for a human, then approve and retry',
    tool: 'SearchIndexTool',
    args: { index: '*', query_dsl: { query: { match_all: {} }, size: 1 } },
    policies: ['hitl-opensearch'],
    expect: 'hold',
    story: 'An agent searches an index. A forbid that names an approver holds the call; a person approves it in the Privilege console and the retry goes through.',
    notice: 'The page shows the approval id the gateway returned. Approve it in the console under Access Request Approvals, then press Retry.',
  },
  {
    id: 'deny',
    title: 'Hard deny: the unrestricted API tool',
    tool: 'GenericOpenSearchApiTool',
    args: { method: 'GET', path: '/_cluster/health' },
    policies: ['hitl-block-generic-api'],
    expect: 'deny',
    story: 'This tool can call any OpenSearch endpoint, so an Active policy blocks it outright. There is no approval path.',
    notice: 'Nothing reaches the backend. The page shows exactly what the gateway returned.',
  },
  {
    id: 'allow',
    title: 'An allowed call',
    tool: 'ListIndexTool',
    args: {},
    policies: [],
    expect: 'allow',
    story: 'A read-only tool that no AI policy touches. If your grant covers it the call goes through; if not, the gateway will say so.',
    notice: 'No Cedar rule names this tool, so the outcome comes from the access grant alone.',
  },
];

// Measured 2026-10-26; the live run is its own page, /privilege-pf-token.
export const PF_AGENT = {
  id: 'pf-agent',
  title: 'An agent with a PingFederate token',
  status: 'Measured 2026-10-27',
  link: '/privilege-pf-token',
  story: 'Privilege trusts a PingFederate issuer natively: a non-human identity with the PF issuer and the P1 Privilege Agent App as audience, act.sub and client_id pinned as required claims, backing the agent key pftoken-agent. The key\'s grant gives tools by the token\'s scope (opensearch:admin 9 tools, opensearch:read 3, neither 403), and the MCP server behind pftoken-rs receives the agent\'s own token unchanged.',
  facts: [
    'People: PF is only a sign-in source behind PingOne. The agent app\'s token comes from the Privilege-owned PingOne environment, and Cedar sees a Privilege user and their groups, not a PF claim.',
    'Agents: the identity pins the agent through required claims (act.sub, client_id), and the key\'s grant decides the tools per agent app, by scope with RequiredClaims. Cedar sees token scopes but not other claims; Ping says context.token.claims is coming.',
  ],
};

// What Cedar can read in the real console's AI policies (measured from the console editor, 2026-10-20).
export const CEDAR_VOCABULARY = [
  { attr: 'principal in Group::"x"', from: 'Privilege directory (user matched by email alias), not a raw PF groups claim' },
  { attr: 'context.token.scopes', from: 'the presented token' },
  { attr: 'context.agent.scopes', from: 'the agent key' },
  { attr: 'context.app', from: 'the door' },
  { attr: 'resource == Tool::"x"', from: 'the tool being called' },
  { attr: 'context.args.<name>', from: 'tool arguments' },
  { attr: 'context.approval_count', from: 'human approvals recorded for the call' },
];

export const OUTCOMES = {
  allow: { label: 'ALLOWED', note: 'The gateway let the call through and the tool answered.' },
  hold: { label: 'HELD', note: 'A forbid that names an approver held the call. Approve it in the Privilege console, then retry.' },
  deny: { label: 'DENIED', note: 'The gateway refused the call.' },
  signin: { label: 'SIGN IN FIRST', note: 'You are not signed in to this door yet.' },
  'tool-error': { label: 'UNCLEAR', note: 'The gateway returned an error result. It may be a policy refusal or a tool error; read the raw response below.' },
  error: { label: 'ERROR', note: 'The request did not complete.' },
};

// ---------------------------------------------------------------------------------------------------------------------
// Options lab: mirrors the Privilege console's AI Policies "Build a rule" form (From a template | Build a rule | Write Cedar):
// When it runs, Outcome, MCP server, Caller, Target, Conditions, Reason, and "Save as Candidate to validate a change without
// enforcing it". The Cedar text is generated the way the console's builder generates it (shapes copied from the two live
// policies above). The impact is a PREDICTION from documented behaviour for these three tools only: the gateway decides for
// real when the change is saved in the console and the scenario is run again.
// ---------------------------------------------------------------------------------------------------------------------

export const LAB_TOOLS = ['SearchIndexTool', 'GenericOpenSearchApiTool', 'ListIndexTool'];

// The two live rules, in the builder's own terms. outcome: 'hold' (ask a human on the unattended action) | 'refuse'.
export const BASELINE_RULES = [
  { id: 'hitl-opensearch', outcome: 'hold', tool: 'SearchIndexTool', state: 'Active', liftsOnApproval: true },
  { id: 'hitl-block-generic-api', outcome: 'refuse', tool: 'GenericOpenSearchApiTool', state: 'Active', liftsOnApproval: false },
];

export const OUTCOME_CHOICES = [
  { value: 'refuse', label: 'Refuse the request', note: 'The request is refused. No approval can lift it. (Action mcp:Invoke.)' },
  { value: 'hold', label: 'Hold for a human', note: 'The call is held and an approval is opened. (Action mcp:InvokeUnattended; only the "On the request" stage can ask a human.)' },
];

// The Cedar the builder saves. Refuse = forbid on mcp:Invoke; hold = forbid on mcp:InvokeUnattended with the approval
// annotations and an `unless` that lifts the hold once an approval is on record. The approver id is elided on purpose.
export function buildCedar({ outcome, tool, liftsOnApproval = true, app = DOOR_NAME, reason }) {
  if (outcome === 'refuse') {
    return `@reason("${reason || `${tool} is refused`}")
forbid (
  principal,
  action == Action::"mcp:Invoke",
  resource == Tool::"${tool}"
)
when   { context.app == "${app}" };`;
  }
  return `@grant("capability")
@ttl("900")
@request_ttl("3600")
@approvers("<approver id elided>")
@reason("${reason || `${tool} needs a human`}")
forbid (
  principal,
  action == Action::"mcp:InvokeUnattended",
  resource == Tool::"${tool}"
)
when   { context.app == "${app}" }${liftsOnApproval ? '\nunless { context has approval_count && context.approval_count >= 1 };' : ';'}`;
}

// What each tool's call does for a set of rules. Only Active rules are enforced (Candidates are stored, never enforced), a refuse
// beats a hold, and a hold lifts after approval only when the rule has the `unless approval_count` clause. A tool no rule names
// is decided by the access grant alone (allowed here, if the grant covers it).
export function predictImpact(rules) {
  const out = {};
  for (const tool of LAB_TOOLS) {
    const active = rules.filter((r) => r.tool === tool && r.state === 'Active');
    const refuse = active.find((r) => r.outcome === 'refuse');
    const hold = active.find((r) => r.outcome === 'hold');
    if (refuse) out[tool] = { outcome: 'deny', afterApproval: null, by: refuse.id };
    else if (hold) out[tool] = { outcome: 'hold', afterApproval: hold.liftsOnApproval ? 'allow' : 'hold', by: hold.id };
    else out[tool] = { outcome: 'allow', afterApproval: null, by: null };
  }
  return out;
}

// Replace the rule being edited (or add a new one) and predict again. editing: a baseline id, or 'new'.
export function applyEdit(editing, edit) {
  const rule = { id: editing === 'new' ? 'your-new-rule' : editing, ...edit };
  const rules = editing === 'new' ? [...BASELINE_RULES, rule] : BASELINE_RULES.map((r) => (r.id === editing ? rule : r));
  return { rules, impact: predictImpact(rules) };
}

// One note per option, with how we know. evidence: measured (seen on this tenant or in the console text), console-text
// (stated by the console UI or its warnings, behaviour not re-run), inferred (follows from the above, not run).
export const OPTION_NOTES = [
  { option: 'When it runs', where: 'On the request / on the response', effect: 'On the request runs before content inspection and is the only stage that can ask a human. A response-side rule can withhold a completion but cannot hold the call.', evidence: 'console-text' },
  { option: 'Outcome', where: 'Refuse the request / hold', effect: 'Refuse is a forbid on mcp:Invoke and no approval lifts it. Hold is a forbid on mcp:InvokeUnattended: the call is held, an approval is opened, and the client retries once it is approved. Our two live policies are exactly these two shapes.', evidence: 'measured' },
  { option: 'MCP server and Target', where: 'opensearch-hitl · one named tool', effect: 'The rule only applies to that server and tool. Name a different tool and the original tool stops being covered by it; a typo means the rule never matches anything.', evidence: 'inferred' },
  { option: 'Caller', where: 'Any caller / a group / a named agent', effect: 'Narrows who the rule applies to. Groups must exist in the Privilege directory: the console reports a group it cannot find as an unresolved entity.', evidence: 'measured' },
  { option: 'Conditions', where: 'Add a condition', effect: 'Adds `when` / `unless` clauses. For a hold, leaving out `unless approval_count >= 1` makes the console warn that it "asks for a human and then refuses the approval it asked for": approving never lets the call through.', evidence: 'console-text' },
  { option: 'Save as', where: 'Save changes / Save as Candidate', effect: 'Candidate validates and stores the rule without enforcing it, so it changes nothing about any call. The console also refuses a save that does not compile and stores nothing.', evidence: 'measured' },
];

export const EVIDENCE = {
  measured: 'measured on this tenant or in the console',
  'console-text': 'stated by the console, behaviour not re-run',
  inferred: 'inferred, not run',
};

// Tools on a door that a live ACTIVE rule holds for a human, as { toolName: policyId }. Read from the same mirror of the
// console's rules as above, so it only knows the opensearch-hitl door; every other door answers {}.
export function hitlToolsFor(door) {
  if (door !== DOOR_NAME) return {};
  return Object.fromEntries(BASELINE_RULES.filter((r) => r.outcome === 'hold' && r.state === 'Active').map((r) => [r.tool, r.id]));
}
