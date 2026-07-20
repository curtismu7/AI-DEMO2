/**
 * Single source of truth for the PingOne Authorize capability showcase: the
 * standalone tour page and the /use-cases "PingOne Authorize" group both read
 * from here. Ledger shape is generic — see CapabilityShowcasePage — so it can
 * be reused by other product showcases later without rework.
 */

export const PINGONE_AUTHORIZE_GROUPS = [
  { id: 'realtime-decisioning', label: 'Real-time, contextual decisions' },
  { id: 'fine-grained-policy', label: 'Fine-grained, attribute-driven policy' },
  { id: 'operations-audit', label: 'Operations & audit' },
];

export const PINGONE_AUTHORIZE_CAPABILITIES = [
  {
    id: 'decision-endpoints',
    group: 'realtime-decisioning',
    title: 'Real-time decision evaluation',
    oneLiner: 'Every transaction/tool call is evaluated live against PingOne Authorize — PERMIT, DENY, or INDETERMINATE, never assumed.',
    evidence: { code: 'demo_api_server/services/pingOneAuthorizeService.js — evaluateTransaction (L676-704), _postDecisionEndpoint (L380-412)' },
    relatedUCIds: ['UC1', 'UC6'],
  },
  {
    id: 'mcp-first-tool-gate',
    group: 'realtime-decisioning',
    title: 'Dynamic least-privilege for agent tool calls',
    oneLiner: 'The literal "Contextual Runtime Authorization" claim: DecisionContext=McpFirstTool grants/denies each MCP tool call dynamically, not via a static scope grant.',
    evidence: { code: 'demo_api_server/services/pingOneAuthorizeService.js — evaluateMcpToolDelegation (L455-599)' },
    relatedUCIds: ['UC1', 'UC10', 'UC13'],
  },
  {
    id: 'fail-closed-resilience',
    group: 'realtime-decisioning',
    title: 'Fail-closed resilience',
    oneLiner: 'Circuit breaker + bounded retry + effect normalization: an unrecognized or errored response collapses to DENY, never a silent PERMIT.',
    evidence: { code: 'demo_api_server/services/pingOneAuthorizeService.js — _evaluateWithBreaker (L275-294), _normalizeDecision (L347-352)' },
    relatedUCIds: ['UC6'],
  },
  {
    id: 'trust-framework-attributes',
    group: 'fine-grained-policy',
    title: 'Attribute-driven least privilege',
    oneLiner: 'RAR amount/payee ceiling, entitlement tier, group membership, and resource-owner binding all flow into the same decision as named Trust Framework attributes.',
    evidence: { code: 'demo_api_server/services/pingOneAuthorizeService.js — evaluateMcpToolDelegation parameters (L483-594)' },
    relatedUCIds: ['UC14b', 'UC9', 'UC21'],
  },
  {
    id: 'policy-tree-visibility',
    group: 'fine-grained-policy',
    title: 'Policy tree visibility',
    oneLiner: 'Policy Set → Policy → Rule, fetched live or from the repo’s import snapshot when the worker token can’t reach the policy-editor API.',
    evidence: { code: 'demo_api_server/services/pingOneAuthorizeService.js — getAuthorizationPolicies (L846-868), getAuthorizationPoliciesFromSnapshot (L884-930)' },
    relatedUCIds: ['UC6'],
  },
  {
    id: 'obligations-response-shaping',
    group: 'fine-grained-policy',
    title: 'Obligations shape the response, not just permit/deny',
    oneLiner: 'A decision can carry step-up, HITL, or consent obligations — the runtime context changes what happens next, not only whether it happens.',
    evidence: { code: 'demo_api_server/services/authorizeObligations.js — classifyObligations (L81)' },
    relatedUCIds: ['UC7', 'UC8'],
  },
  {
    id: 'recent-decisions-audit',
    group: 'operations-audit',
    title: 'Recent-decisions audit trail',
    oneLiner: 'The last 20 decisions on a configured endpoint are queryable directly from PingOne — an independent verification surface, not just app-side logs.',
    evidence: { code: 'demo_api_server/services/pingOneAuthorizeService.js — getRecentDecisions (L760-786)' },
    relatedUCIds: ['UC20'],
  },
  {
    id: 'coarse-fine-split',
    group: 'operations-audit',
    title: 'One engine, two enforcement points',
    oneLiner: 'The same PingOne Authorize engine backs both the Agent Gateway’s coarse allow/deny gate and this BFF’s fine-grained per-tool gate — not two competing systems.',
    evidence: { code: 'demo_mcp_gateway/src/auth/PingOneAuthorizeClient.ts (coarse) + demo_api_server/services/pingOneAuthorizeService.js evaluateMcpToolDelegation (fine)' },
    relatedUCIds: ['UC1'],
  },
];

export function allRelatedUCIds() {
  const seen = new Set();
  for (const cap of PINGONE_AUTHORIZE_CAPABILITIES) {
    for (const id of cap.relatedUCIds) seen.add(id);
  }
  return Array.from(seen);
}
