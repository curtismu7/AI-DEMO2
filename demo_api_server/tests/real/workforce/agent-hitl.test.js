'use strict';

// Regression: consent-only WRITE tool with no transaction amount must gate.
// workforce/request_time_off is challengeType:'consent' (no amount). The authz
// server's no-amount HITL trigger previously fired only for step_up tools, so
// these silently executed. Now any write tool that declares a challengeType in
// scope-topology.json requires human approval.

const { createBffClient, setVertical, restoreVertical } = require('../helpers/bffClient');

const VERTICAL = 'workforce';

describe(`Agent vertical-tool HITL — ${VERTICAL}/request_time_off consent gate (real)`, () => {
  let client;
  let hitlEnabled = false;

  beforeAll(async () => {
    skipIfNoSession();
    const flagR = await createBffClient('enduser').get('/api/feature-flags');
    hitlEnabled = flagR.data?.find?.((f) => f.id === 'ff_hitl_enabled')?.value === 'true';
    client = createBffClient('enduser');
    await setVertical(client, VERTICAL);
  });

  afterAll(async () => {
    await restoreVertical(client);
  });

  it('request_time_off (consent write, no amount) gates with a challengeId', async () => {
    if (!hitlEnabled) return;
    const r = await client.post('/api/agent/invoke', {
      prompt: 'request 3 days off', forceHeuristic: true, vertical: VERTICAL,
    });
    expect(r.status).toBe(200);
    expect(String(r.data.reply)).not.toContain('HITL_REQUIRED');
    expect(['hitl_required', 'step_up_required']).toContain(r.data.error);
    expect(typeof r.data.hitlChallengeId).toBe('string');
    expect(r.data.hitlChallengeId.length).toBeGreaterThan(0);
  });

  it('approve then retry → request submitted', async () => {
    if (!hitlEnabled) return;
    const r1 = await client.post('/api/agent/invoke', {
      prompt: 'request 3 days off', forceHeuristic: true, vertical: VERTICAL,
    });
    const cid = r1.data.hitlChallengeId;
    if (!cid) return;
    const approve = await client.post(`/api/mcp/decision/${cid}/approve`, {});
    expect([200, 204]).toContain(approve.status);
    const r2 = await client.post('/api/agent/invoke', {
      prompt: 'request 3 days off', forceHeuristic: true, vertical: VERTICAL,
      hitlChallengeId: cid, consentGiven: true,
    });
    expect(r2.status).toBe(200);
    expect(r2.data.success).toBe(true);
  });
});
