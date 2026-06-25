'use strict';

// Regression: agent-initiated vertical-tool HITL (NOT the direct /api/transactions
// 428 path in hitl.test.js). Guards the bug where the gateway's HITL_REQUIRED
// reason leaked to the UI as a raw "❌ HITL_REQUIRED" bubble instead of a
// structured directive + challengeId that drives the consent modal, and where
// approve→retry never PERMITted. healthcare/release_records is stepUp+consent.

const { createBffClient, setVertical, restoreVertical } = require('../helpers/bffClient');

const VERTICAL = 'healthcare';

describe(`Agent vertical-tool HITL — ${VERTICAL}/release_records (real)`, () => {
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

  it('release_records returns a structured HITL directive + challengeId (never a raw HITL_REQUIRED reply)', async () => {
    if (!hitlEnabled) return;
    const r = await client.post('/api/agent/invoke', {
      prompt: 'release record 102', forceHeuristic: true, vertical: VERTICAL,
    });
    expect(r.status).toBe(200);
    // The exact regression: the reply must NOT be the raw uppercase reason.
    expect(String(r.data.reply)).not.toContain('HITL_REQUIRED');
    expect(['hitl_required', 'step_up_required']).toContain(r.data.error);
    expect(typeof r.data.hitlChallengeId).toBe('string');
    expect(r.data.hitlChallengeId.length).toBeGreaterThan(0);
  });

  it('approve the challenge then retry with it → tool PERMITs and executes', async () => {
    if (!hitlEnabled) return;
    const r1 = await client.post('/api/agent/invoke', {
      prompt: 'release record 102', forceHeuristic: true, vertical: VERTICAL,
    });
    const cid = r1.data.hitlChallengeId;
    if (!cid) return; // gating disabled in this env — covered by the assertion above
    const approve = await client.post(`/api/mcp/decision/${cid}/approve`, {});
    expect([200, 204]).toContain(approve.status);
    const r2 = await client.post('/api/agent/invoke', {
      prompt: 'release record 102', forceHeuristic: true, vertical: VERTICAL,
      hitlChallengeId: cid, consentGiven: true,
    });
    expect(r2.status).toBe(200);
    expect(r2.data.success).toBe(true);
    expect(String(r2.data.reply)).not.toContain('HITL_REQUIRED');
  });
});
