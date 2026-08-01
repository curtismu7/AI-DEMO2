'use strict';

/**
 * Canary: Privilege MCP Client SSE must not broadcast relay traffic across
 * express sessions. Before the fix, sseClients was a global Set and emitEvent
 * wrote every MCP request/response body to every connected EventSource —
 * so browser A could observe browser B's tools/call results.
 */

const router = require('../../routes/privilegeMcpClient');
const { __test } = router;

function mockRes() {
  const writes = [];
  return {
    writes,
    write(chunk) {
      writes.push(String(chunk));
      return true;
    },
  };
}

describe('privilege-mcp SSE session isolation', () => {
  beforeEach(() => {
    __test.reset();
  });

  afterEach(() => {
    __test.reset();
  });

  it('does not deliver relay events to a different session listener', () => {
    const resA = mockRes();
    const resB = mockRes();
    __test.subscribeSse('sess-a', resA);
    __test.subscribeSse('sess-b', resB);

    const sessionB = { _sid: 'sess-b' };
    __test.emitEvent(sessionB, 'relay', {
      direction: 'mcp->client',
      body: { result: { secret: 'user-b-tool-result' } },
    });

    const aJoined = resA.writes.join('');
    const bJoined = resB.writes.join('');
    expect(bJoined).toContain('user-b-tool-result');
    expect(bJoined).toContain('event: relay');
    expect(aJoined).not.toContain('user-b-tool-result');
    expect(aJoined).toBe('');
  });

  it('delivers events only to listeners on the same session', () => {
    const resA1 = mockRes();
    const resA2 = mockRes();
    __test.subscribeSse('sess-a', resA1);
    __test.subscribeSse('sess-a', resA2);

    __test.emitEvent('sess-a', 'config', { config: { mcpUrl: 'https://example.test/mcp' } });

    expect(resA1.writes.join('')).toContain('https://example.test/mcp');
    expect(resA2.writes.join('')).toContain('https://example.test/mcp');
  });
});
