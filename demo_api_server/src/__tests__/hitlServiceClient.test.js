/**
 * @file hitlServiceClient.test.js
 * BFF client for the canonical HITL service (port 3009). Verifies the
 * verifyHitlReceipt binding contract (ported from the gateway) and the
 * create/get wire calls with global.fetch mocked.
 */

const { createChallenge, getChallengeStatus, verifyHitlReceipt } =
  require('../../services/hitlServiceClient');

describe('hitlServiceClient.verifyHitlReceipt — anti-replay binding contract', () => {
  const NOW = 1_000_000;
  const future = new Date(NOW + 60_000).toISOString();
  const past = new Date(NOW - 60_000).toISOString();
  const approved = (over = {}) => ({
    status: 'approved', userId: 'u1', agentId: 'a1', tool: 'create_transfer', expiresAt: future, ...over,
  });

  it('ok when approved, not expired, and user/agent/tool all match', () => {
    expect(verifyHitlReceipt(approved(), 'u1', 'a1', 'create_transfer', NOW)).toEqual({ ok: true });
  });

  it('rejects a non-approved status (pending)', () => {
    const r = verifyHitlReceipt(approved({ status: 'pending' }), 'u1', 'a1', 'create_transfer', NOW);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/not approved/);
  });

  it('rejects a denied status', () => {
    expect(verifyHitlReceipt(approved({ status: 'denied' }), 'u1', 'a1', 'create_transfer', NOW).ok).toBe(false);
  });

  it('rejects an approved-but-expired receipt', () => {
    const r = verifyHitlReceipt(approved({ expiresAt: past }), 'u1', 'a1', 'create_transfer', NOW);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/expired/);
  });

  it('rejects a receipt bound to a different user', () => {
    const r = verifyHitlReceipt(approved(), 'attacker', 'a1', 'create_transfer', NOW);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/different user/);
  });

  it('rejects a receipt bound to a different agent', () => {
    const r = verifyHitlReceipt(approved(), 'u1', 'other-agent', 'create_transfer', NOW);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/different agent/);
  });

  it('rejects a receipt bound to a different tool', () => {
    const r = verifyHitlReceipt(approved(), 'u1', 'a1', 'delete_everything', NOW);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/different tool/);
  });

  it('is lenient when a binding field is absent on the record (does not reject)', () => {
    // older/looser challenge records may omit agentId/tool — only a MISMATCH rejects.
    const r = verifyHitlReceipt({ status: 'approved', userId: 'u1', expiresAt: future }, 'u1', 'a1', 'create_transfer', NOW);
    expect(r.ok).toBe(true);
  });

  it('rejects a null/garbage status object', () => {
    expect(verifyHitlReceipt(null, 'u1', 'a1', 'create_transfer', NOW).ok).toBe(false);
    expect(verifyHitlReceipt(undefined, 'u1', 'a1', 'create_transfer', NOW).ok).toBe(false);
  });
});

describe('hitlServiceClient wire calls', () => {
  let fetchSpy;
  afterEach(() => { if (fetchSpy) fetchSpy.mockRestore(); jest.clearAllMocks(); });

  it('createChallenge POSTs to /challenges with the payload', async () => {
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true, json: async () => ({ challengeId: 'c1', status: 'pending', expiresAt: 'x' }),
    });
    const out = await createChallenge({ tool: 'create_transfer', userId: 'u1', agentId: 'a1' }, 'corr-9');
    expect(out.challengeId).toBe('c1');
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toMatch(/\/challenges$/);
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body);
    expect(body.tool).toBe('create_transfer');
    expect(body.userId).toBe('u1');
    expect(body.agentId).toBe('a1');
    expect(body.correlationId).toBe('corr-9');
    expect(opts.headers['X-Correlation-ID']).toBe('corr-9');
  });

  it('getChallengeStatus GETs /challenges/:id', async () => {
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true, json: async () => ({ challengeId: 'c1', status: 'approved' }),
    });
    const out = await getChallengeStatus('c1');
    expect(out.status).toBe('approved');
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toMatch(/\/challenges\/c1$/);
    expect(opts.method).toBe('GET');
  });

  it('throws on a non-2xx response (caller fails closed)', async () => {
    fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false, status: 503, text: async () => 'down',
    });
    await expect(getChallengeStatus('c1')).rejects.toThrow(/failed \(503\)/);
  });

  it('throws on a network error (caller fails closed)', async () => {
    fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(getChallengeStatus('c1')).rejects.toThrow();
  });
});
