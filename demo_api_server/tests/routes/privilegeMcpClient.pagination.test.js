'use strict';
/**
 * Regression (finding #43): listAllMcpPages() paged through an
 * operator-configured MCP upstream via a `do { ... } while (cursor)` loop
 * with no iteration cap and no repeated-cursor detection -- a pagination
 * bug on that upstream (always emitting a fresh nextCursor, or repeating
 * one) hung the request indefinitely.
 */
const { listAllMcpPages } = require('../../routes/privilegeMcpClient').__test;

function buildSession() {
  return {
    config: { mcpUrl: 'http://mock-mcp.test' },
    mcpSession: { era: 'modern', sessionId: null, protocolVersion: '2025-06-18', nextRequestId: 1, initialized: true },
    oauth: {},
  };
}

function mockFetchSequence(buildResult) {
  let callCount = 0;
  global.fetch = jest.fn(async (_url, opts) => {
    callCount += 1;
    const reqBody = JSON.parse(opts.body);
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify({ jsonrpc: '2.0', id: reqBody.id, result: buildResult(callCount) }),
    };
  });
  return () => callCount;
}

describe('privilegeMcpClient listAllMcpPages pagination guard', () => {
  afterEach(() => { delete global.fetch; });

  it('stops after MAX_MCP_PAGES (100) when the upstream keeps emitting a fresh cursor forever', async () => {
    const getCallCount = mockFetchSequence((n) => ({ items: [{ id: n }], nextCursor: `cursor-${n}` }));

    const items = await listAllMcpPages(buildSession(), 'items/list', 'items');

    expect(getCallCount()).toBe(100);
    expect(items).toHaveLength(100);
  });

  it('stops immediately if the upstream repeats the same cursor', async () => {
    const getCallCount = mockFetchSequence((n) => ({ items: [{ id: n }], nextCursor: 'same-cursor' }));

    const items = await listAllMcpPages(buildSession(), 'items/list', 'items');

    expect(getCallCount()).toBe(2); // page 1 sees the cursor for the first time; page 2's repeat stops it
    expect(items).toHaveLength(2);
  });

  it('terminates normally once the upstream stops returning a cursor', async () => {
    const getCallCount = mockFetchSequence((n) => ({
      items: [{ id: n }],
      nextCursor: n < 3 ? `cursor-${n}` : undefined,
    }));

    const items = await listAllMcpPages(buildSession(), 'items/list', 'items');

    expect(getCallCount()).toBe(3);
    expect(items).toHaveLength(3);
  });
});
