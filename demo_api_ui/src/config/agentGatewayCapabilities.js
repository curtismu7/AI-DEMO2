/**
 * Single source of truth for the Agent Gateway capability showcase: the
 * standalone tour page, the existing-panel callouts, and the /use-cases
 * "Agent Gateway" group all read from here.
 */

export const CAPABILITY_GROUPS = [
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
    evidence: {
      node: 'demo_mcp_gateway/src/validation/mcpRequestValidation.ts:15-69',
      pingGateway: 'ping-gateway/scripts/groovy/mcp-request-validation.groovy:1-30',
    },
    enforcedByDefault: 'pinggateway',
    fallbackNote: 'Node mirrors this for offline/dev — not the live path.',
    relatedUCIds: ['UC1', 'UC5', 'UC11'],
  },
  {
    id: 'audit-logging',
    group: 'validate-audit',
    title: 'Audit every MCP call',
    oneLiner: 'Every tool-call outcome is shipped to durable storage with the acting agent, subject, and decision.',
    evidence: {
      node: 'demo_mcp_gateway/src/gatewayAudit.ts:41-118',
      pingGateway: 'demo_api_server/services/unifiedTrace.js:128-141',
    },
    enforcedByDefault: 'pinggateway',
    fallbackNote: 'Node mirrors this for offline/dev — not the live path.',
    relatedUCIds: ['UC20'],
  },
  {
    id: 'rate-limiting',
    group: 'throttle-transform',
    title: 'Throttle requests',
    oneLiner: 'Sliding-window per-agent, per-tool rate limit — a burst past quota gets 429 with Retry-After.',
    evidence: {
      node: 'demo_mcp_gateway/src/rateLimit.ts:38-97',
      pingGateway: 'ping-gateway/scripts/groovy/uc18-rate-limit.groovy:1-20',
    },
    enforcedByDefault: 'pinggateway',
    fallbackNote: 'Node mirrors this for offline/dev — not the live path.',
    relatedUCIds: ['UC18', 'UC29'],
  },
  {
    id: 'token-transformation',
    group: 'throttle-transform',
    title: 'Transform tokens',
    oneLiner: 'RFC 8693 token exchange rewrites the inbound gateway-audience token to the backend resource audience.',
    evidence: {
      node: 'demo_mcp_gateway/src/auth/McpTokenExchangeClient.ts:1-24',
      pingGateway: 'ping-gateway/scripts/groovy/olb-token-exchange.groovy:1-20',
    },
    enforcedByDefault: 'pinggateway',
    fallbackNote: 'Node mirrors this for offline/dev — not the live path.',
    relatedUCIds: ['UC1'],
  },
  {
    id: 'oauth-enforcement',
    group: 'oauth-policy-metadata',
    title: 'Enforce OAuth',
    oneLiner: 'RFC 7662 introspection confirms the token is active before anything else runs — fails closed on outage.',
    evidence: {
      node: 'demo_mcp_gateway/src/auth/GatewayIntrospectionClient.ts:110-187',
      pingGateway: 'ping-gateway/config/routes/01-mcp-olb.json:33,41',
    },
    enforcedByDefault: 'pinggateway',
    fallbackNote: 'Node mirrors this for offline/dev — not the live path.',
    relatedUCIds: ['UC1', 'UC29'],
  },
  {
    id: 'policy-enforcement',
    group: 'oauth-policy-metadata',
    title: 'Enforce policy',
    oneLiner: 'Every call is evaluated against PingOne Authorize (P1AZ) — PERMIT, DENY, or INDETERMINATE, failing closed if the PDP is unreachable.',
    evidence: {
      node: 'demo_mcp_gateway/src/auth/PingOneAuthorizeClient.ts:1-36',
      pingGateway: 'ping-gateway/scripts/groovy/p1az-decision.groovy:1-19',
    },
    enforcedByDefault: 'pinggateway',
    fallbackNote: 'Node mirrors this for offline/dev — not the live path.',
    relatedUCIds: ['UC6', 'UC10'],
  },
  {
    id: 'metadata-controls',
    group: 'oauth-policy-metadata',
    title: 'Enforce metadata controls (RAR)',
    oneLiner: 'RFC 9396 rich-authorization-request subset check — the actual tool-call params must be covered by what was granted.',
    evidence: {
      node: 'demo_mcp_gateway/src/rarEnforce.ts:1-41',
      pingGateway: null,
    },
    enforcedByDefault: 'node-only',
    fallbackNote: 'No Groovy equivalent exists yet — this one runs on the Node path only, live or not.',
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
