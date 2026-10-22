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

// Shown, never run: the decisive call's output was lost, so this is designed but unproven.
export const PF_AGENT = {
  id: 'pf-agent',
  title: 'An agent with a PingFederate token',
  status: 'Not proven',
  story: 'Privilege can trust a PingFederate issuer natively: a workload-identity key with the PF issuer and audience, claims pinned with RequiredClaims. The gateway then applies the grant and Cedar. The test that would prove it ran, but its output was lost, so there is no live run here.',
  facts: [
    'People: PF is only a sign-in source behind PingOne. The door\'s token comes from the Privilege-owned PingOne environment, and Cedar sees a Privilege user and their groups, not a PF claim.',
    'Agents: the token had no sub claim (only client_id), so the key trusts any subject and pins client_id; whether the gateway accepts that is exactly what remains unproven.',
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
