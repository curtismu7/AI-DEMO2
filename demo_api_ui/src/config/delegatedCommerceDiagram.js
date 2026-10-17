// Delegated-Agent Commerce lifecycle: register -> claim/consent -> protected MCP call
// -> CIBA approval -> revoke. Mirrors DelegatedCommercePage.jsx and
// demo_api_server/routes/delegatedCommerce.js (register/claim/consent/revoke) plus
// the page's /api/auth/ciba/* and callMcpTool calls.
const N = (id, group, label, sub, x, y) => ({ id, group, label, sub, x, y });
const E = (src, tgt, label, opts) => (opts ? [src, tgt, label, opts] : [src, tgt, label]);
const DENY = { color: 'var(--th-status-error)' };
const SAFE = { color: 'var(--th-status-success)' };

export const DELEGATED_COMMERCE_GROUPS = {
  user: { label: 'People', bg: 'var(--th-status-info)' },
  agent: { label: 'Shopping agent', bg: 'var(--th-bg-emphasis)' },
  bff: { label: 'Demo BFF', bg: 'var(--th-text-faint)' },
  idp: { label: 'PingOne', bg: 'var(--th-status-warning)' },
  gateway: { label: 'MCP gateway + policy', bg: 'var(--th-status-success)' },
};

export const DELEGATED_COMMERCE_NODES = [
  N('admin', 'user', 'Administrator', ['1A: creates the agent', 'receives a one-time claim code'], 0, 0),
  N('customer', 'user', 'Customer', ['1B: claims the agent, picks scopes', 'approves the $600 checkout', 'revokes access'], 0, 300),
  N('bff', 'bff', 'Delegated-commerce routes', ['/api/delegated-commerce/', 'register · claim · consent · revoke', 'secret stays server-side'], 340, 150),
  N('pingone', 'idp', 'PingOne', ['OAuth app for the agent', 'may_act = agent app id', 'delegation grant (read/write)'], 700, 0),
  N('agent', 'agent', 'AF Personal Shopping Agent', ['calls list_orders and checkout', 'with a delegated token'], 340, 450),
  N('mcp', 'gateway', 'MCP gateway + PingOne Authorize', ['RFC 8693 exchange: subject + actor', 'list_orders: permit', 'checkout $600: held for approval'], 700, 450),
  N('ciba', 'bff', 'CIBA approval', ['/api/auth/ciba/initiate then poll', '/ciba-approve page', 'engine live or simulated'], 1060, 300),
  N('audit', 'bff', 'Audit', ['delegated_agent_revoked', 'event with auditId'], 1060, 0),
];

export const DELEGATED_COMMERCE_EDGES = [
  E('admin', 'bff', 'register agent (admin only)'), // 0
  E('bff', 'pingone', 'create OAuth/OIDC app; claim code returned', undefined), // 1
  E('admin', 'customer', 'shares the one-time claim code'), // 2
  E('customer', 'bff', 'claim code, then consent to scopes'), // 3
  E('bff', 'pingone', 'write may_act and grant the delegation', SAFE), // 4
  E('agent', 'mcp', 'list_orders with delegated token'), // 5
  E('mcp', 'agent', 'orders returned (permit)', SAFE), // 6
  E('agent', 'mcp', 'checkout $600 headphones'), // 7
  E('mcp', 'ciba', 'held: step-up / HITL required (428)', undefined), // 8
  E('customer', 'ciba', 'approves out of band'), // 9
  E('ciba', 'agent', 'poll sees approved; checkout retried', SAFE), // 10
  E('customer', 'bff', 'revoke agent access'), // 11
  E('bff', 'pingone', 'clear may_act, revoke delegations', DENY), // 12
  E('bff', 'audit', 'append delegated_agent_revoked'), // 13
  E('agent', 'mcp', 'retry list_orders: confirmed denied', DENY), // 14
];

export const DELEGATED_COMMERCE_STEPS = [
  { key: 'register', edges: [0, 1], title: 'Admin registers the agent', what: 'POST /register creates a standard PingOne OAuth app for the agent and returns a one-time claim code; the client secret is never sent to the browser.', evidence: 'Page shows client_id, claim code, and "Held server-side; never returned".' },
  { key: 'consent', edges: [2, 3, 4], title: 'Customer claims and consents', what: 'The customer enters the claim code, picks read and/or write, and consent writes may_act for the agent app and a scoped delegation grant.', evidence: 'Consent panel shows the delegationId and selected scopes; registration becomes active.' },
  { key: 'mcp', edges: [5, 6], title: 'Protected MCP call', what: 'list_orders runs with the delegated token through the RFC 8693 exchange and PingOne Authorize.', evidence: 'The exchange token event (two-ex-final-token or mcp-access-token) fills the proof rail.' },
  { key: 'approval', edges: [7, 8, 9, 10], title: 'Human approval', what: 'A $600 checkout is held by policy; the page starts CIBA, the customer approves, and the poll triggers the retry.', evidence: 'Approval panel shows engine, auth_req_id, then "Checkout completed after human approval."' },
  { key: 'revoke', edges: [11, 12, 13, 14], title: 'Self-service revoke', what: 'Revoke clears may_act, revokes active delegations, writes an audit event, then the page retries list_orders and expects a denial.', evidence: 'Revocation proof shows "Confirmed denied" and a link to the audit evidence.' },
];
