// /standalone/cedar: the data behind the Cedar demo. Source: planning/standalone-research/cedar.md and its prototype
// (cedar-prototype/{schema.cedarschema,policies.json,run.mjs}), re-run against @cedar-policy/cedar-wasm 4.14.0.
// The vocabulary mirrors what the real Privilege console editor exposes (privilege/PF-CLAIMS-IN-CEDAR-POLICIES.md).
// Fields marked DEMO are extensions the real console does NOT have; the page labels them so nobody promises them.

export const CEDAR_SCHEMA = `entity Group;
entity User in [Group];
entity Agent in [Group];
entity Tool;

type ToolCallContext = {
  app: String,
  args: { amount?: Long },
  token: {
    scopes: Set<String>,
    client_id: String,
    actor?: String,
  },
  approval_count: Long,
  pinnedHash: String,
  observedHash: String,
};

action "mcp:Invoke", "mcp:InvokeUnattended" appliesTo {
  principal: [User, Agent],
  resource: Tool,
  context: ToolCallContext,
};
`;

// Which attributes the real console's engine exposes today, and which are demo-only. Drives the "what Privilege can read" panel.
export const VOCABULARY = [
  { attr: 'principal in Group::"x"', real: true, from: 'Privilege directory (user matched by email alias), not a raw PF groups claim' },
  { attr: 'context.token.scopes', real: true, from: 'the presented token; PF scopes reaching it are untested' },
  { attr: 'context.app', real: true, from: 'the door / MCP app' },
  { attr: 'resource == Tool::"x"', real: true, from: 'the tool being called' },
  { attr: 'context.args.<name>', real: true, from: 'tool arguments' },
  { attr: 'context.approval_count', real: true, from: 'human approvals recorded for this call' },
  { attr: 'context.token.client_id', real: false, from: 'DEMO: the PF client_id, mapped by this page' },
  { attr: 'context.token.actor', real: false, from: 'DEMO: act.sub from a PF token; the real console has no act or ID-JAG hook' },
  { attr: 'context.pinnedHash / observedHash', real: false, from: 'DEMO: tool-schema pinning (rug-pull defence), not in the console' },
];

export const TOOLS = {
  search_docs: { app: 'search', label: 'search_docs' },
  create_ticket: { app: 'ticketing', label: 'create_ticket' },
  pay_invoice: { app: 'payments', label: 'pay_invoice' },
  book_fare: { app: 'booking', label: 'book_fare' },
};

export const ACTIONS = ['mcp:Invoke', 'mcp:InvokeUnattended'];

export const DEFAULT_POLICIES = `@id("s04-analysts-search-ticketing")
@reason("Analysts may use Search and Ticketing")
permit (principal in Group::"analysts", action == Action::"mcp:Invoke", resource)
when { context.app == "search" || context.app == "ticketing" };

@id("s04-payments-finance-only")
@reason("Payments is for finance, with the payments:write scope")
permit (principal in Group::"finance", action == Action::"mcp:Invoke", resource)
when { context.app == "payments" && context.token.scopes.contains("payments:write") };

@id("s05-rugpull-pin")
@reason("Tool schema changed since it was approved")
forbid (principal, action, resource)
when { context.pinnedHash != context.observedHash };

@id("s01-hold-large-fare")
@reason("Fares over 1000 need a second pair of eyes")
@approvers("priya")
forbid (principal, action == Action::"mcp:InvokeUnattended", resource == Tool::"book_fare")
when { context.args has amount && context.args.amount > 1000 }
unless { context.approval_count >= 1 };

@id("s23-permit-travel-agents")
@reason("Travel agents may book fares")
permit (principal in Group::"travel-agents", action in [Action::"mcp:Invoke", Action::"mcp:InvokeUnattended"], resource)
when { context.app == "booking" };

@id("s23-forbid-over-cap")
@reason("Hard cap: no booking over 10000 for anyone")
forbid (principal, action in [Action::"mcp:Invoke", Action::"mcp:InvokeUnattended"], resource == Tool::"book_fare")
when { context.args has amount && context.args.amount > 10000 };
`;

// PF-token-shaped callers. `act` is the RFC 8693 actor claim; the demo maps it to context.token.actor (DEMO).
export const PRESETS = {
  mary: { sub: 'mary', groups: ['analysts'], scope: 'tools:invoke', client_id: 'dot' },
  finance: { sub: 'fin1', groups: ['analysts', 'finance'], scope: 'tools:invoke payments:write', client_id: 'dot' },
  travel: { sub: 'ta1', groups: ['travel-agents'], scope: 'tools:invoke', client_id: 'dot', actor: 'dot' },
};

const S = (id, title, story, preset, request, expect, decidedBy, notice) => ({ id, title, story, preset, request, expect, decidedBy, notice });
const R = (action, tool, args = {}, over = {}) => ({ action, tool, args, ...over });

// `expect` is asserted against the real engine in cedarEngine.test.js.
export const SCENARIOS = [
  S('analyst-search', 'Analyst searches docs', 'Mary is in the analysts group. She calls search_docs.', 'mary', R('mcp:Invoke', 'search_docs'), 'allow', ['s04-analysts-search-ticketing'], 'A group permit on the app. Her PF token only has to name her; the group comes from the directory.'),
  S('analyst-ticket', 'Analyst opens a ticket', 'Same group, different tool on an app the policy also names.', 'mary', R('mcp:Invoke', 'create_ticket'), 'allow', ['s04-analysts-search-ticketing'], 'One policy covers two apps with `||`.'),
  S('default-deny', 'Analyst tries payments', 'No policy permits analysts on payments.', 'mary', R('mcp:Invoke', 'pay_invoice'), 'default-deny', [], 'Cedar is default-deny: nothing matched, so nothing is allowed. No policy had to say "no".'),
  S('finance-pay', 'Finance pays an invoice', 'Finance group plus the payments:write scope.', 'finance', R('mcp:Invoke', 'pay_invoice'), 'allow', ['s04-payments-finance-only'], 'Group AND scope: the permit only fires when the token carries payments:write.'),
  S('schema-drift', 'Tool schema changed', 'The server now advertises a different tool schema than the one approved.', 'mary', R('mcp:Invoke', 'search_docs', {}, { schemaDrift: true }), 'deny', ['s05-rugpull-pin'], 'A forbid beats every permit. DEMO: schema pinning is not in the real console.'),
  S('hold-large', 'Large fare is held', 'A travel agent books 2400 unattended; the hold policy forbids it unless a human approved.', 'travel', R('mcp:InvokeUnattended', 'book_fare', { amount: 2400 }), 'hold', ['s01-hold-large-fare'], 'A forbid with @approvers is a HOLD: the real gateway opens an approval and the client retries after it.'),
  S('hold-approved', 'Same fare, approved', 'Priya approved once: approval_count is 1.', 'travel', R('mcp:InvokeUnattended', 'book_fare', { amount: 2400 }, { approvalCount: 1 }), 'allow', ['s23-permit-travel-agents'], 'The `unless` clause lifts the hold, and the permit now decides.'),
  S('small-fare', 'Small fare, no hold', 'The same agent books 400 unattended.', 'travel', R('mcp:InvokeUnattended', 'book_fare', { amount: 400 }), 'allow', ['s23-permit-travel-agents'], 'Under the threshold the hold policy never matches.'),
  S('cap', 'Over the hard cap', 'A travel agent books 12000. A permit applies, but so does a forbid.', 'travel', R('mcp:Invoke', 'book_fare', { amount: 12000 }), 'deny', ['s23-forbid-over-cap'], 'Forbid beats permit, always. No approval can unlock it.'),
  S('under-cap', 'Under the cap', 'The same agent books 900.', 'travel', R('mcp:Invoke', 'book_fare', { amount: 900 }), 'allow', ['s23-permit-travel-agents'], 'Permit applies, no forbid matches.'),
];

// Something the real console's engine rejects, with the message the strict validator gives. Teaches "no raw claims".
export const NO_CLAIMS_POLICY = `@id("try-raw-claims")
permit (principal, action, resource)
when { context.claims.groups.contains("x") };
`;
