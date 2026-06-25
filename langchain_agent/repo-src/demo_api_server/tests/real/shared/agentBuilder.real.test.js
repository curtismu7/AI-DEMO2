// demo_api_server/tests/real/shared/agentBuilder.real.spec.js
'use strict';

const { createBffClient, BFF_BASE } = require('../helpers/bffClient');

describe('agent-builder real round-trip', () => {
  let client;

  beforeAll(() => { client = createBffClient('enduser'); });

  afterAll(async () => {
    if (!client) return;
    // Cleanup: delete test resource(s) and the agent. Guarded server-side, so
    // a half-failed run can never delete provisioned objects.
    const state = await client.get('/api/agent-builder/state');
    for (const r of state.data?.resources || []) {
      if (r.ownedByUser) await client.delete(`/api/agent-builder/resources/${r.id}`);
    }
    await client.delete('/api/agent-builder/agent');
  });

  test('state requires a session', async () => {
    const axios = require('axios');
    const https = require('https');
    const anon = await axios.get(`${BFF_BASE}/api/agent-builder/state`, {
      validateStatus: () => true,
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    });
    expect(anon.status).toBe(401);
  });

  test('full lifecycle: state → build agent (idempotent) → create resource → grant → delete', async () => {
    // 1. Initial state
    const s1 = await client.get('/api/agent-builder/state');
    expect(s1.status).toBe(200);
    expect(s1.data.user.sub).toBeTruthy();
    expect(Array.isArray(s1.data.resources)).toBe(true);

    // 2. Build agent — then build again, must be idempotent
    const b1 = await client.post('/api/agent-builder/agent');
    expect([200, 201]).toContain(b1.status);
    // Record what the environment actually created (first-class AI_AGENT vs
    // WEB_APP fallback) so the run log proves which path executed.
    console.log(`[agent-builder.real] created agent type: ${b1.data.agent.type} (fallback: ${b1.data.agent.fallback})`);
    expect(['AI_AGENT', 'WEB_APP']).toContain(b1.data.agent.type);
    const b2 = await client.post('/api/agent-builder/agent');
    expect(b2.status).toBe(200);
    expect(b2.data.created).toBe(false);
    expect(b2.data.agent.id).toBe(b1.data.agent.id);

    // 3. Create a user resource with a custom scope
    const r1 = await client.post('/api/agent-builder/resources', {
      name: 'RealTest', scopes: ['read', 'forecast'],
    });
    expect([200, 201]).toContain(r1.status);
    const resourceId = r1.data.resource.id;

    // 4. Grant the custom scope to the agent (single resource → no
    //    duplicate-scope-name collision with demo resources).
    const g = await client.put('/api/agent-builder/grants', {
      grants: [{ resourceId, scopes: ['forecast'] }],
    });
    expect(g.status).toBe(200);

    // 5. State reflects the grant
    const s2 = await client.get('/api/agent-builder/state');
    const mine = s2.data.resources.find((r) => r.id === resourceId);
    expect(mine.ownedByUser).toBe(true);
    expect(mine.granted).toContain('forecast');

    // 6. Delete resource, then agent
    const dr = await client.delete(`/api/agent-builder/resources/${resourceId}`);
    expect(dr.status).toBe(200);
    const da = await client.delete('/api/agent-builder/agent');
    expect(da.status).toBe(200);

    // 7. Gone
    const s3 = await client.get('/api/agent-builder/state');
    expect(s3.data.agent).toBeNull();
  });
});
