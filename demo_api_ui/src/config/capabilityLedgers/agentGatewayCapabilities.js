/**
 * Single source of truth for the Agent Gateway capability showcase: the
 * standalone tour page and the /use-cases "Agent Gateway" group both read
 * from here. Ledger shape is generic — see CapabilityShowcasePage — so it
 * shares the same rendering as the PingOne Authorize showcase.
 *
 * PingGateway is the default LIVE enforcement path in this demo
 * (ff_mcp_gateway_pinggateway) — Node is the offline/dev fallback, not what
 * runs by default. Each evidence string cites both paths so that claim is
 * inspectable, not asserted. RAR is the one exception: no Groovy equivalent
 * exists yet, so it runs on the Node path only, live or not.
 */

export const AGENT_GATEWAY_GROUPS = [
  { id: 'validate-audit', label: 'Validate & audit MCP requests' },
  { id: 'throttle-transform', label: 'Throttle requests & transform tokens' },
  { id: 'oauth-policy-metadata', label: 'Enforce OAuth, policy & metadata controls' },
];

export const AGENT_GATEWAY_CAPABILITIES = [
  {
    id: 'mcp-validation',
    group: 'validate-audit',
    title: 'Validate MCP requests',
    oneLiner: 'Method allowlist plus per-tool Ajv schema validation — fail closed on an unknown tool or malformed call.',
    evidence: { code: 'Node: demo_mcp_gateway/src/validation/mcpRequestValidation.ts:15-69 · PingGateway (default, live): ping-gateway/scripts/groovy/mcp-request-validation.groovy:1-30' },
    relatedUCIds: ['UC1', 'UC5', 'UC11'],
  },
  {
    id: 'audit-logging',
    group: 'validate-audit',
    title: 'Audit every MCP call',
    oneLiner: 'Every tool-call outcome is shipped to durable storage with the acting agent, subject, and decision.',
    evidence: { code: 'Node: demo_mcp_gateway/src/gatewayAudit.ts:41-118 · PingGateway (default, live): demo_api_server/services/unifiedTrace.js:128-141' },
    relatedUCIds: ['UC20'],
  },
  {
    id: 'rate-limiting',
    group: 'throttle-transform',
    title: 'Throttle requests',
    oneLiner: 'Sliding-window per-agent, per-tool rate limit — a burst past quota gets 429 with Retry-After.',
    evidence: { code: 'Node: demo_mcp_gateway/src/rateLimit.ts:38-97 · PingGateway (default, live): ping-gateway/scripts/groovy/uc18-rate-limit.groovy:1-20' },
    relatedUCIds: ['UC18', 'UC29'],
  },
  {
    id: 'token-transformation',
    group: 'throttle-transform',
    title: 'Transform tokens',
    oneLiner: 'RFC 8693 token exchange rewrites the inbound gateway-audience token to the backend resource audience.',
    evidence: { code: 'Node: demo_mcp_gateway/src/auth/McpTokenExchangeClient.ts:1-24 · PingGateway (default, live): ping-gateway/scripts/groovy/olb-token-exchange.groovy:1-20' },
    relatedUCIds: ['UC1'],
  },
  {
    id: 'oauth-enforcement',
    group: 'oauth-policy-metadata',
    title: 'Enforce OAuth',
    oneLiner: 'RFC 7662 introspection confirms the token is active before anything else runs — fails closed on outage.',
    evidence: { code: 'Node: demo_mcp_gateway/src/auth/GatewayIntrospectionClient.ts:110-187 · PingGateway (default, live): ping-gateway/config/routes/01-mcp-olb.json:33,41' },
    relatedUCIds: ['UC1', 'UC29'],
  },
  {
    id: 'policy-enforcement',
    group: 'oauth-policy-metadata',
    title: 'Enforce policy',
    oneLiner: 'Every call is evaluated against PingOne Authorize (P1AZ) — PERMIT, DENY, or INDETERMINATE, failing closed if the PDP is unreachable.',
    evidence: { code: 'Node: demo_mcp_gateway/src/auth/PingOneAuthorizeClient.ts:1-36 · PingGateway (default, live): ping-gateway/scripts/groovy/p1az-decision.groovy:1-19' },
    relatedUCIds: ['UC6', 'UC10'],
  },
  {
    id: 'metadata-controls',
    group: 'oauth-policy-metadata',
    title: 'Enforce metadata controls (RAR)',
    oneLiner: 'RFC 9396 rich-authorization-request subset check — the actual tool-call params must be covered by what was granted.',
    evidence: { code: 'Node only — no Groovy equivalent exists yet: demo_mcp_gateway/src/rarEnforce.ts:1-41' },
    relatedUCIds: ['UC14b'],
  },
];

export function allRelatedUCIds() {
  const seen = new Set();
  for (const cap of AGENT_GATEWAY_CAPABILITIES) {
    for (const id of cap.relatedUCIds) seen.add(id);
  }
  return Array.from(seen);
}
