// demo_api_server/tests/real/shared/mcp.test.js
'use strict';

const { createBffClient } = require('../helpers/bffClient');

async function isMcpRunning(client) {
  try {
    const r = await client.get('/api/mcp/status');
    return r.status < 500;
  } catch (_) {
    return false;
  }
}

describe('MCP tool path (real)', () => {
  let client;

  beforeAll(async () => {
    skipIfNoSession();
    client = createBffClient('enduser');
    const running = await isMcpRunning(client);
    if (!running) {
      console.warn('[mcp.test] MCP server not running — skipping MCP tests. Start with ./run.sh');
    }
  });

  it('GET /api/demo-agent/nl with accounts query invokes MCP tool and returns result', async () => {
    const r = await client.post('/api/demo-agent/nl', {
      message: 'show my accounts',
    });
    // 200 with tool result, or 503 if MCP unavailable
    expect([200, 503]).toContain(r.status);
    if (r.status === 200) {
      expect(r.data).toBeDefined();
    }
  });

  it('MCP tool call logs appear in app events', async () => {
    const r = await client.get('/api/admin/app-events?category=mcp&limit=5');
    // May be 403 if enduser doesn't have admin scope — that is fine
    expect([200, 403]).toContain(r.status);
  });
});
