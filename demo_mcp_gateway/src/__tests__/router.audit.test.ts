/**
 * The audit target is the whole PingOne surface the gateway can reach. If a
 * tool name ever falls through to 'olb' by accident, the caller silently gets
 * the banking backend instead of an error — so pin the routing, and pin that
 * nothing outside the three names resolves here.
 */
import { routeTool, backendHttpMcpUrl, backendWsUrl } from '../router';
import type { GatewayConfig } from '../config';

const config = {
  mcpAuditHttpUrl: 'http://mcp-audit:8898',
  mcpBraveHttpUrl: 'http://mcp-brave:8897',
  mcpOlbWsUrl: 'ws://olb:9000',
  mcpResourceServerWsUrl: 'ws://invest:9001',
} as unknown as GatewayConfig;

describe('router — audit target', () => {
  it.each([
    'search_audit_activities',
    'get_audit_activity',
    'audit_summary',
  ])('routes %s to the audit backend', (tool) => {
    expect(routeTool(tool)).toBe('audit');
  });

  it('forwards audit over HTTP, never the OLB WebSocket', () => {
    // Without the backendWsUrl guard this falls through to mcpOlbWsUrl and the
    // call lands on the banking backend instead of failing.
    expect(backendHttpMcpUrl('audit', config)).toBe('http://mcp-audit:8898');
    expect(backendWsUrl('audit', config)).toBe('');
  });

  it('does not swallow tool names outside the three it implements', () => {
    // A near-miss name must NOT reach the audit backend just because it looks
    // audit-ish — the backend implements exactly three tools.
    expect(routeTool('list_audit_logs')).not.toBe('audit');
    expect(routeTool('delete_audit_activity')).not.toBe('audit');
  });

  it('leaves existing targets alone', () => {
    expect(routeTool('brave_news_search')).toBe('brave');
    expect(routeTool('get_my_accounts')).toBe('olb');
  });
});
