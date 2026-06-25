'use strict';

/**
 * Healthcare `view_coverage` through the full MCP pipeline (real).
 * Complements workforce Slice 1 test — same ff_vertical_tools_via_mcp path,
 * different vertical tool name (the bug was executeBffTool not knowing plugin tools).
 */

const { createBffClient } = require('../helpers/bffClient');

const VERTICAL = 'healthcare';

describe(`view_coverage via MCP — ${VERTICAL} (real)`, () => {
  let client;
  let admin;
  let bearer;

  beforeAll(async () => {
    skipIfNoSession();
    skipIfNoSession('admin');
    client = createBffClient('enduser');
    admin = createBffClient('admin');
    const claims = await client.get('/api/auth/oauth/token-claims');
    bearer = claims.data && claims.data.payload && claims.data.payload.accessToken;
    if (bearer) {
      await client.post('/api/verticals/active', { id: VERTICAL }, { headers: { Authorization: `Bearer ${bearer}` } });
    }
  });

  const liveOrSkip = (name, fn) => it(name, async () => {
    if (!bearer) {
      console.warn(`[healthcare-mcp] no bearer — skipping: ${name}`);
      return;
    }
    await fn();
  });

  afterAll(async () => {
    if (bearer) {
      await client.post('/api/verticals/active', { id: 'banking' }, { headers: { Authorization: `Bearer ${bearer}` } }).catch(() => {});
    }
  });

  liveOrSkip('flag ON: "check my coverage" must not return Unknown tool', async () => {
    const patch = await admin.patch('/api/admin/feature-flags', { ff_vertical_tools_via_mcp: 'true' });
    expect([200, 204]).toContain(patch.status);

    const inv = await client.post(
      '/api/agent/invoke',
      { prompt: 'check my coverage', forceHeuristic: true },
      bearer ? { headers: { Authorization: `Bearer ${bearer}` } } : {},
    );

    expect([200, 403, 428, 503]).toContain(inv.status);
    expect(String(inv.data.reply || '')).not.toMatch(/Unknown tool/i);

    if (inv.status === 200) {
      expect(inv.data.success).not.toBe(false);
      expect(String(inv.data.reply || '').toLowerCase()).toMatch(/coverage|plan|ppo|shield/);
    }
  });
});
