import { MCPMessageHandler } from '../MCPMessageHandler';

/**
 * tools/list must return ALL tools regardless of the token's scopes — scope and
 * vertical filtering now belong to the gateway + Authorize. The MCP server is a
 * pure executor; it still enforces scope at tools/call time (see
 * toolScopeFilter.regression.test.ts), but discovery is unfiltered here.
 */
describe('MCPMessageHandler.handleListTools — no scope filtering', () => {
  const allTools = [
    { name: 'view_records', title: 'view records', description: 'read', inputSchema: {}, requiresUserAuth: true, requiredScopes: ['records:read'], readOnly: true, vertical: 'healthcare', annotations: {} },
    { name: 'book_appointment', title: 'book appointment', description: 'write', inputSchema: {}, requiresUserAuth: true, requiredScopes: ['write'], readOnly: false, vertical: 'healthcare', annotations: {} },
  ];

  // Stub provider: getAvailableToolsForToken would filter by scope (old behavior);
  // getAvailableTools returns everything (new behavior). The handler must use the latter.
  const toolProvider = {
    getAvailableTools: () => allTools,
    getAvailableToolsForToken: (scopes: string[]) => allTools.filter(t => t.requiredScopes.every(s => scopes.includes(s))),
  };

  const handler = new MCPMessageHandler(
    {} as never,
    {} as never,
    toolProvider as never,
  );

  it('returns write tools even when the token carries only a read scope', async () => {
    // agentToken with only records:read — old behavior would drop book_appointment.
    const context = { connectionId: 'c1', agentToken: makeToken(['records:read']) };
    const res = await handler.handleListTools({ id: 1, method: 'tools/list' } as never, context as never);
    const names = (res.result.tools as Array<{ name: string }>).map(t => t.name);
    expect(names).toContain('view_records');
    expect(names).toContain('book_appointment');
  });
});

// Minimal unsigned JWT (header.payload.sig) carrying a scope claim — the handler
// decodes scopes without verifying the signature (token pre-validated at transport).
function makeToken(scopes: string[]): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none' })}.${b64({ scope: scopes.join(' ') })}.sig`;
}
