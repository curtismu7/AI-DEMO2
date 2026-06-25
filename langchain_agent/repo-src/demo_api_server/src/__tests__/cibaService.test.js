/**
 * @file cibaService.test.js
 * @description Unit tests for services/cibaService.js
 *
 * Covers:
 *   isEnabled()                    — env var vs configStore precedence
 *   initiateBackchannelAuth()      — endpoint construction, credential encoding,
 *                                    binding_message fallback, poll vs ping mode,
 *                                    PingOne response parsing, missing config
 *   pollForTokens()                — success, authorization_pending, access_denied
 *   waitForApproval()              — pending → approved, slow_down backoff,
 *                                    access_denied, timeout ceiling
 */

'use strict';

// ── Mock axios and dependencies BEFORE requiring the service ──────────────────
jest.mock('axios');
jest.mock('../../config/oauth', () => ({
  clientId:      'test-client-id',
  clientSecret:  'test-client-secret',
  cibaEndpoint:  'https://auth.pingone.com/env-123/as/bc-authorize',
  tokenEndpoint: 'https://auth.pingone.com/env-123/as/token',
}));
jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn(),
}));

const axios       = require('axios');
const configStore = require('../../services/configStore');
const cibaService = require('../../services/cibaService');

// Convenience: the base64-encoded "test-client-id:test-client-secret"
const EXPECTED_BASIC = Buffer.from('test-client-id:test-client-secret').toString('base64');

// ── Mock token response ───────────────────────────────────────────────────────

const MOCK_TOKENS = {
  access_token:  'access-abc',
  id_token:      'id-abc',
  refresh_token: 'refresh-abc',
  token_type:    'Bearer',
  expires_in:    3600,
};

// ═══════════════════════════════════════════════════════════════════════════════
// isEnabled()
// ═══════════════════════════════════════════════════════════════════════════════

describe('cibaService.isEnabled()', () => {
  const origEnv = process.env.CIBA_ENABLED;

  afterEach(() => {
    if (origEnv === undefined) delete process.env.CIBA_ENABLED;
    else process.env.CIBA_ENABLED = origEnv;
  });

  it('returns true when CIBA_ENABLED env var is "true"', () => {
    process.env.CIBA_ENABLED = 'true';
    expect(cibaService.isEnabled()).toBe(true);
  });

  it('returns false when CIBA_ENABLED env var is "false"', () => {
    process.env.CIBA_ENABLED = 'false';
    expect(cibaService.isEnabled()).toBe(false);
  });

  it('env var overrides configStore when both are set', () => {
    process.env.CIBA_ENABLED = 'false';
    configStore.getEffective.mockReturnValue('true');
    expect(cibaService.isEnabled()).toBe(false); // env var wins
  });

  it('falls back to configStore when env var is not set', () => {
    delete process.env.CIBA_ENABLED;
    configStore.getEffective.mockReturnValue('true');
    expect(cibaService.isEnabled()).toBe(true);
  });

  it('returns false when neither env var nor configStore is set', () => {
    delete process.env.CIBA_ENABLED;
    configStore.getEffective.mockReturnValue(null);
    expect(cibaService.isEnabled()).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// initiateBackchannelAuth()
// ═══════════════════════════════════════════════════════════════════════════════

describe('cibaService.initiateBackchannelAuth()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'ciba_token_delivery_mode') return 'poll';
      if (key === 'ciba_binding_message')     return 'Banking App Authentication';
      return null;
    });
    axios.post.mockResolvedValue({
      data: { auth_req_id: 'req-456', expires_in: 300, interval: 5 },
    });
  });

  it('POSTs to the CIBA endpoint with Basic auth credentials', async () => {
    await cibaService.initiateBackchannelAuth('user@example.com', 'Test', 'openid', '');

    expect(axios.post).toHaveBeenCalledWith(
      'https://auth.pingone.com/env-123/as/bc-authorize',
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Basic ${EXPECTED_BASIC}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        }),
      })
    );
  });

  it('sends login_hint, scope, and binding_message in the request body', async () => {
    await cibaService.initiateBackchannelAuth('user@example.com', 'Approve payment', 'openid profile', '');

    const [, body] = axios.post.mock.calls[0];
    const params = new URLSearchParams(body);
    expect(params.get('login_hint')).toBe('user@example.com');
    expect(params.get('scope')).toBe('openid profile');
    expect(params.get('binding_message')).toBe('Approve payment');
  });

  it('falls back to configStore binding_message when none provided', async () => {
    await cibaService.initiateBackchannelAuth('user@example.com', undefined, 'openid', '');

    const [, body] = axios.post.mock.calls[0];
    const params = new URLSearchParams(body);
    expect(params.get('binding_message')).toBe('Banking App Authentication');
  });

  it('includes acr_values when provided', async () => {
    await cibaService.initiateBackchannelAuth('user@example.com', 'Test', 'openid', 'Multi_factor');

    const [, body] = axios.post.mock.calls[0];
    expect(new URLSearchParams(body).get('acr_values')).toBe('Multi_factor');
  });

  it('omits acr_values when empty string', async () => {
    await cibaService.initiateBackchannelAuth('user@example.com', 'Test', 'openid', '');

    const [, body] = axios.post.mock.calls[0];
    expect(new URLSearchParams(body).has('acr_values')).toBe(false);
  });

  it('returns { auth_req_id, expires_in, interval } from PingOne response', async () => {
    const result = await cibaService.initiateBackchannelAuth('user@example.com', 'Test', 'openid', '');
    expect(result).toEqual({ auth_req_id: 'req-456', expires_in: 300, interval: 5 });
  });

  it('applies default expires_in=300 and interval=5 when PingOne omits them', async () => {
    axios.post.mockResolvedValue({ data: { auth_req_id: 'req-999' } });
    const result = await cibaService.initiateBackchannelAuth('user@example.com', 'Test', 'openid', '');
    expect(result.expires_in).toBe(300);
    expect(result.interval).toBe(5);
  });

  it('does NOT include client_notification_token in poll mode', async () => {
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'ciba_token_delivery_mode') return 'poll';
      return null;
    });
    await cibaService.initiateBackchannelAuth('user@example.com', 'Test', 'openid', '');

    const [, body] = axios.post.mock.calls[0];
    expect(new URLSearchParams(body).has('client_notification_token')).toBe(false);
  });

  it('includes client_notification_token in ping mode', async () => {
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'ciba_token_delivery_mode')   return 'ping';
      if (key === 'ciba_notification_endpoint') return 'https://my-app.example.com/notify';
      return null;
    });
    await cibaService.initiateBackchannelAuth('user@example.com', 'Test', 'openid', '');

    const [, body] = axios.post.mock.calls[0];
    const params = new URLSearchParams(body);
    expect(params.get('client_notification_token')).toBeTruthy();
    expect(params.get('client_notification_token')).toHaveLength(64); // 32 bytes hex
    expect(params.get('client_notification_endpoint')).toBe('https://my-app.example.com/notify');
  });

  it('includes ping notification token even when endpoint not configured', async () => {
    configStore.getEffective.mockImplementation((key) => {
      if (key === 'ciba_token_delivery_mode') return 'ping';
      return null;
    });
    await cibaService.initiateBackchannelAuth('user@example.com', 'Test', 'openid', '');

    const [, body] = axios.post.mock.calls[0];
    const params = new URLSearchParams(body);
    // token present but no endpoint
    expect(params.get('client_notification_token')).toBeTruthy();
    expect(params.has('client_notification_endpoint')).toBe(false);
  });

  it('propagates axios errors (PingOne 4xx / network failure)', async () => {
    axios.post.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      cibaService.initiateBackchannelAuth('user@example.com', 'Test', 'openid', '')
    ).rejects.toThrow('ECONNREFUSED');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// pollForTokens()
// ═══════════════════════════════════════════════════════════════════════════════

describe('cibaService.pollForTokens()', () => {
  beforeEach(() => jest.clearAllMocks());

  it('POSTs to the token endpoint with CIBA grant_type', async () => {
    axios.post.mockResolvedValue({ data: MOCK_TOKENS });
    await cibaService.pollForTokens('req-abc');

    const [url, body, opts] = axios.post.mock.calls[0];
    expect(url).toBe('https://auth.pingone.com/env-123/as/token');
    const params = new URLSearchParams(body);
    expect(params.get('grant_type')).toBe('urn:openid:params:grant-type:ciba');
    expect(params.get('auth_req_id')).toBe('req-abc');
    expect(opts.headers.Authorization).toBe(`Basic ${EXPECTED_BASIC}`);
  });

  it('returns the token object on success (simulates user approved via email)', async () => {
    axios.post.mockResolvedValue({ data: MOCK_TOKENS });
    const tokens = await cibaService.pollForTokens('req-abc');
    expect(tokens).toEqual(MOCK_TOKENS);
  });

  it('throws with error:"authorization_pending" while user has not approved yet', async () => {
    axios.post.mockRejectedValue({
      response: { data: { error: 'authorization_pending' } },
    });
    await expect(cibaService.pollForTokens('req-abc')).rejects.toMatchObject({
      response: { data: { error: 'authorization_pending' } },
    });
  });

  it('throws with error:"access_denied" when user denies the request', async () => {
    axios.post.mockRejectedValue({
      response: { data: { error: 'access_denied' } },
    });
    await expect(cibaService.pollForTokens('req-abc')).rejects.toMatchObject({
      response: { data: { error: 'access_denied' } },
    });
  });

  it('throws with error:"expired_token" when auth request expired at PingOne', async () => {
    axios.post.mockRejectedValue({
      response: { data: { error: 'expired_token' } },
    });
    await expect(cibaService.pollForTokens('req-abc')).rejects.toMatchObject({
      response: { data: { error: 'expired_token' } },
    });
  });

  it('throws on network / timeout error', async () => {
    axios.post.mockRejectedValue(new Error('timeout of 10000ms exceeded'));
    await expect(cibaService.pollForTokens('req-abc')).rejects.toThrow('timeout');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// waitForApproval()
// ═══════════════════════════════════════════════════════════════════════════════

describe('cibaService.waitForApproval()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => jest.useRealTimers());

  const pending = { response: { data: { error: 'authorization_pending' } } };
  const denied  = { response: { data: { error: 'access_denied' } } };
  const slow    = { response: { data: { error: 'slow_down' } } };

  async function drainTimers() {
    // Advance timers while there are pending microtasks
    for (let i = 0; i < 20; i++) {
      jest.advanceTimersByTime(5000);
      await Promise.resolve();
    }
  }

  it('returns tokens when user approves on first attempt', async () => {
    axios.post.mockResolvedValue({ data: MOCK_TOKENS });
    const promise = cibaService.waitForApproval('req-abc', 5, 60);
    await drainTimers();
    const tokens = await promise;
    expect(tokens).toEqual(MOCK_TOKENS);
  });

  it('retries after authorization_pending and returns tokens on 3rd attempt (OTP simulation)', async () => {
    axios.post
      .mockRejectedValueOnce(pending)  // attempt 1: user hasn't clicked email link yet
      .mockRejectedValueOnce(pending)  // attempt 2: still waiting
      .mockResolvedValue({ data: MOCK_TOKENS }); // attempt 3: user clicked — approved!

    const promise = cibaService.waitForApproval('req-abc', 5, 60);
    // runAllTimersAsync drives the full sleep→poll chain including async rejections
    await jest.runAllTimersAsync();
    const tokens = await promise;
    expect(tokens).toEqual(MOCK_TOKENS);
    expect(axios.post).toHaveBeenCalledTimes(3);
  });

  it('throws on access_denied without retrying further', async () => {
    axios.post.mockRejectedValue(denied);
    const promise = cibaService.waitForApproval('req-abc', 5, 60);
    await drainTimers();
    await expect(promise).rejects.toMatchObject({
      response: { data: { error: 'access_denied' } },
    });
    // Should not retry after a definitive denial
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  it('backs off (increases interval) on slow_down signal', async () => {
    // slow_down twice, then approved
    axios.post
      .mockRejectedValueOnce(slow)
      .mockRejectedValueOnce(slow)
      .mockResolvedValue({ data: MOCK_TOKENS });

    const promise = cibaService.waitForApproval('req-abc', 5, 60);
    // Advance enough for back-off intervals (5 → 10 → 15 s)
    for (let i = 0; i < 12; i++) {
      jest.advanceTimersByTime(5000);
      await Promise.resolve();
    }
    const tokens = await promise;
    expect(tokens).toEqual(MOCK_TOKENS);
  });

  it('throws "timed out" after maxAttempts without approval', async () => {
    axios.post.mockRejectedValue(pending);
    // Very small maxAttempts=2 so the test is fast
    const promise = cibaService.waitForApproval('req-abc', 5, 2);
    for (let i = 0; i < 10; i++) {
      jest.advanceTimersByTime(5000);
      await Promise.resolve();
    }
    await expect(promise).rejects.toThrow(/timed out/i);
  });
});
