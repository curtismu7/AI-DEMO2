/**
 * Browser destinations for the demo's two log views.
 *
 * Kibana is intentionally configurable because the local PingOne-protected
 * proxy and a hosted demo may use different origins. Elasticsearch itself is
 * not exposed here: it requires credentials and has no document-oriented UI.
 */
export const KIBANA_URL = process.env.REACT_APP_KIBANA_URL || 'http://localhost:4180';
export const MCP_OBSERVABILITY_PATH = '/mcp-observability';
