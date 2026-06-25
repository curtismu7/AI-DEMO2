'use strict';

// Regression: sensitive READ tools must gate via the gateway HITL flow.
// sensitive_membership_details is read+consent. Rule 4 was write-only, so it
// executed with no approval. Now any tool that declares a challengeType in the
// SoT gates (read or write). Also asserts the boundary: a plain read (no
// challengeType) must NOT gate, so we didn't over-broaden the rule.

const { createBffClient, setVertical, restoreVertical } = require('../helpers/bffClient');

const VERTICAL = 'sporting-goods';

describe(`Agent vertical-tool HITL — ${VERTICAL} sensitive-read gate (real)`, () => {
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

  it('sensitive_membership_details (read+consent) gates with a challengeId', async () => {
    if (!hitlEnabled) return;
    const r = await client.post('/api/agent/invoke', {
      prompt: 'show sensitive member details', forceHeuristic: true, vertical: VERTICAL,
    });
    expect(r.status).toBe(200);
    expect(String(r.data.reply)).not.toContain('HITL_REQUIRED');
    expect(['hitl_required', 'step_up_required']).toContain(r.data.error);
    expect(typeof r.data.hitlChallengeId).toBe('string');
    expect(r.data.hitlChallengeId.length).toBeGreaterThan(0);
  });

  it('approve then retry → sensitive details returned', async () => {
    if (!hitlEnabled) return;
    const r1 = await client.post('/api/agent/invoke', {
      prompt: 'show sensitive member details', forceHeuristic: true, vertical: VERTICAL,
    });
    const cid = r1.data.hitlChallengeId;
    if (!cid) return;
    const approve = await client.post(`/api/mcp/decision/${cid}/approve`, {});
    expect([200, 204]).toContain(approve.status);
    const r2 = await client.post('/api/agent/invoke', {
      prompt: 'show sensitive member details', forceHeuristic: true, vertical: VERTICAL,
      hitlChallengeId: cid, consentGiven: true,
    });
    expect(r2.status).toBe(200);
    expect(r2.data.success).toBe(true);
  });

  it('boundary: a plain read with no challengeType does NOT gate', async () => {
    if (!hitlEnabled) return;
    const r = await client.post('/api/agent/invoke', {
      prompt: 'show my gear', forceHeuristic: true, vertical: VERTICAL,
    });
    expect(r.status).toBe(200);
    expect(r.data.error).not.toBe('hitl_required');
    expect(r.data.error).not.toBe('step_up_required');
    expect(r.data.hitlChallengeId == null).toBe(true);
  });
});
