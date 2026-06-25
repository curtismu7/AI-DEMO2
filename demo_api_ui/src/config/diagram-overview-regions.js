/**
 * diagram-overview-regions.js
 *
 * Region coordinate map for the Ping Identity Digital Assistants overview diagram.
 * Coordinates are PERCENTAGES of the image dimensions (0–100), used as-is in a
 * viewBox="0 0 100 100" SVG overlay so text sizing works correctly.
 *
 * Tune bounds visually: zoom into the diagram and adjust xPct/yPct/wPct/hPct
 * until the highlight box tightly wraps each component.
 */
export const OVERVIEW_REGIONS = [
  {
    id: 'user',
    label: 'User',
    bounds: { xPct: 2, yPct: 38, wPct: 7, hPct: 18 },
    triggers: ['oauth', 'auth_lifecycle'],
    tags: [],
    keywords: ['user', 'customer', 'end user', 'authentication'],
  },
  {
    id: 'trust-boundary',
    label: 'Trust Boundary',
    bounds: { xPct: 14, yPct: 8, wPct: 2, hPct: 80 },
    triggers: ['oauth', 'auth_lifecycle'],
    tags: [],
    keywords: ['trust boundary', 'perimeter'],
  },
  {
    id: 'idp-oauth-as',
    label: 'IdP / OAuth AS (PingOne)',
    bounds: { xPct: 18, yPct: 7, wPct: 14, hPct: 16 },
    triggers: ['oauth', 'token_exchange', 'introspection'],
    tags: [],
    keywords: ['pingone', 'idp', 'oauth', 'authorization server', 'token exchange', 'token issuer'],
  },
  {
    id: 'pingauthorize',
    label: 'PingOne Authorization Server',
    bounds: { xPct: 38, yPct: 7, wPct: 13, hPct: 16 },
    triggers: ['authorize'],
    tags: [],
    keywords: ['pingauthorize', 'authorize', 'policy', 'permit', 'deny', 'authorization'],
  },
  {
    id: 'agent',
    label: 'Agent (AI)',
    bounds: { xPct: 29, yPct: 40, wPct: 11, hPct: 16 },
    triggers: ['agent', 'agent_prompt'],
    tags: [],
    keywords: ['agent', 'llm', 'ai', 'assistant', 'langgraph'],
  },
  {
    id: 'mcp-gw',
    label: 'Ping Agent Gateway',
    bounds: { xPct: 58, yPct: 31, wPct: 10, hPct: 12 },
    triggers: ['mcp', 'token_exchange'],
    tags: [],
    keywords: ['mcp gateway', 'mcp gw', 'gateway', 'mcp server'],
  },
  {
    id: 'api-gw',
    label: 'API Gateway',
    bounds: { xPct: 58, yPct: 52, wPct: 10, hPct: 12 },
    triggers: ['mcp'],
    tags: [],
    keywords: ['api gateway', 'api gw'],
  },
  {
    id: 'service-a',
    label: 'Service A',
    bounds: { xPct: 77, yPct: 13, wPct: 7, hPct: 10 },
    triggers: ['agent_prompt'],
    tags: ['agent_prompt/heuristic_tool'],
    keywords: ['backend', 'service a', 'accounts', 'balance'],
  },
  {
    id: 'service-b',
    label: 'Service B',
    bounds: { xPct: 77, yPct: 31, wPct: 7, hPct: 10 },
    triggers: ['agent_prompt'],
    tags: ['agent_prompt/heuristic_tool'],
    keywords: ['service b', 'transactions'],
  },
  {
    id: 'service-c',
    label: 'Service C',
    bounds: { xPct: 77, yPct: 51, wPct: 7, hPct: 10 },
    triggers: ['agent_prompt'],
    tags: ['agent_prompt/heuristic_tool'],
    keywords: ['service c', 'investments'],
  },
  {
    id: 'service-d',
    label: 'Service D',
    bounds: { xPct: 77, yPct: 70, wPct: 7, hPct: 10 },
    triggers: ['agent_prompt'],
    tags: ['agent_prompt/heuristic_tool'],
    keywords: ['service d'],
  },
];
