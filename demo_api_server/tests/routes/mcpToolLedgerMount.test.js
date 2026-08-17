'use strict';
/**
 * POST /api/mcp/tool must carry transactionTurnMiddleware.
 *
 * That route is the entry point for every chip-fired / direct MCP tool call:
 * browser -> BFF -> gateway -> MCP server. The gateway and MCP hops already
 * land in the ledger under this request's correlation id, but without the turn
 * middleware the BFF itself emits no ui.request/response hop, so the record
 * contained gateway + mcp hops and NO demo-api-server hop — the orphan cluster
 * /transaction-trace could not attach to anything. Mounting is the whole fix,
 * so the mount is what this asserts.
 */
const app = require('../../server');

/** The express Layer for an exact method+path, or undefined. */
function findRouteLayer(method, path) {
  return (app._router?.stack || []).find(
    (l) => l.route?.path === path && l.route?.methods?.[method],
  );
}

describe('POST /api/mcp/tool ledger mount', () => {
  test('is registered', () => {
    expect(findRouteLayer('post', '/api/mcp/tool')).toBeDefined();
  });

  test('runs transactionTurnMiddleware so its gateway/MCP hops join one record', () => {
    const layer = findRouteLayer('post', '/api/mcp/tool');
    const handlerNames = (layer.route.stack || []).map((s) => s.name);
    expect(handlerNames).toContain('transactionTurnMiddleware');
  });

  // Order matters: the ui.request hop must be emitted for an authenticated
  // turn only, and requireSession is what rejects the rest. Mounting the turn
  // middleware first would file a ledger record for every unauthenticated
  // probe of this route and burn the 500-record cap.
  test('runs requireSession before transactionTurnMiddleware', () => {
    const handlerNames = (findRouteLayer('post', '/api/mcp/tool').route.stack || []).map(
      (s) => s.name,
    );
    expect(handlerNames.indexOf('requireSession')).toBeLessThan(
      handlerNames.indexOf('transactionTurnMiddleware'),
    );
  });
});
