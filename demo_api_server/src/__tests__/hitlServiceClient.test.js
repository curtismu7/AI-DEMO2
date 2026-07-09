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

  it('rejects when expected agentId is provided but absent on the receipt', () => {
    const r = verifyHitlReceipt({ status: 'approved', userId: 'u1', expiresAt: future }, 'u1', 'a1', 'create_transfer', NOW);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/different agent/);
  });

  it('rejects when expected tool is provided but absent on the receipt', () => {
    const r = verifyHitlReceipt({ status: 'approved', userId: 'u1', agentId: 'a1', expiresAt: future }, 'u1', 'a1', 'create_transfer', NOW);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/different tool/);
  });

  it('skips agentId check when caller provides no expectedAgentId', () => {
    const r = verifyHitlReceipt(
      { status: 'approved', userId: 'u1', agentId: 'a1', tool: 'create_transfer', expiresAt: future },
      'u1',
      undefined,
      'create_transfer',
      NOW,
    );
    expect(r.ok).toBe(true);
  });

  it('rejects a null/garbage status object', () => {
    expect(verifyHitlReceipt(null, 'u1', 'a1', 'create_transfer', NOW).ok).toBe(false);
    expect(verifyHitlReceipt(undefined, 'u1', 'a1', 'create_transfer', NOW).ok).toBe(false);
  });

  it('ok when retry amount matches receipt context.amount', () => {
    const r = verifyHitlReceipt(
      approved({ context: { amount: 250 } }),
      'u1',
      'a1',
      'create_transfer',
      NOW,
      250,
    );
    expect(r.ok).toBe(true);
  });

  it('rejects when retry amount differs from receipt context.amount', () => {
    const r = verifyHitlReceipt(
      approved({ context: { amount: 250 } }),
      'u1',
      'a1',
      'create_transfer',
      NOW,
      499,
    );
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/different amount/);
  });

  it('rejects when retry carries amount but receipt has none', () => {
    const r = verifyHitlReceipt(approved(), 'u1', 'a1', 'create_transfer', NOW, 250);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/no bound amount/);
  });

  it('rejects when receipt has amount but retry omits it (one-sided)', () => {
    const r = verifyHitlReceipt(
      approved({ context: { amount: 250 } }),
      'u1',
      'a1',
      'create_transfer',
      NOW,
      undefined,
      {},
    );
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/missing amount/);
  });

  it('rejects same-amount recipient swap (to_account_id mismatch)', () => {
    const r = verifyHitlReceipt(
      approved({ context: { amount: 250, to_account_id: 'acct-a', from_account_id: 'acct-from' } }),
      'u1',
      'a1',
      'create_transfer',
      NOW,
      250,
      { amount: 250, to_account_id: 'acct-attacker', from_account_id: 'acct-from' },
    );
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/to_account_id/);
  });

  it('ok when amount and account ids match', () => {
    const r = verifyHitlReceipt(
      approved({ context: { amount: 250, to_account_id: 'acct-a', from_account_id: 'acct-from' } }),
      'u1',
      'a1',
      'create_transfer',
      NOW,
      250,
      { amount: 250, to_account_id: 'acct-a', from_account_id: 'acct-from' },
    );
    expect(r.ok).toBe(true);
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
