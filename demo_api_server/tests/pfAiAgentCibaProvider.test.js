'use strict';

const { startCiba, pollCiba } = require('../services/pfAiAgentCibaService');
const cibaService = require('../services/cibaService');

jest.mock('../services/cibaService', () => ({
  isEnabled: jest.fn(),
  initiateBackchannelAuth: jest.fn(),
  pollForTokens: jest.fn(),
  validateCibaIdToken: jest.fn(),
}));

// PingFederate CIBA and the mock phone are fully configured here, to prove a PingOne session still ignores them.
const store = {
  getEffective: (key) => ({
    pf_ai_ciba_mock_enabled: 'true',
    pf_ai_ciba_enabled: 'true',
  }[String(key).toLowerCase()] || ''),
};
const fetchImpl = jest.fn();
const p1Session = (extra = {}) => ({
  session: { oauthProvider: 'pingone', user: { id: 'user-1', username: 'demouser', email: 'demo@example.test', ...extra } },
});
const pendingError = (error) => Object.assign(new Error(error), { response: { data: { error } } });

describe('CIBA follows the signed-in provider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    cibaService.isEnabled.mockReturnValue(true);
    cibaService.initiateBackchannelAuth.mockResolvedValue({ auth_req_id: 'p1-req', expires_in: 120, interval: 5 });
  });

  test('a PingOne session starts PingOne CIBA with the email, never the mock phone or PingFederate', async () => {
    const req = p1Session();
    const view = await startCiba(req, { loginHint: 'demouser', bindingMessage: 'Approve-125', store, fetchImpl });
    expect(cibaService.initiateBackchannelAuth).toHaveBeenCalledWith('demo@example.test', 'Approve-125', 'openid');
    expect(view).toMatchObject({ state: 'pending', provider: 'pingone', loginHint: 'demo@example.test' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(req.session.pfAiAgent.cibaPending.mock).toBeUndefined();
    expect(JSON.stringify(view)).not.toMatch(/p1-req/);
  });

  test('a PingFederate session still uses the mock phone, labelled as PingFederate', async () => {
    const req = { session: { oauthProvider: 'pingfederate', user: { username: 'demouser' } } };
    const view = await startCiba(req, { loginHint: 'demouser', store, fetchImpl });
    expect(view).toMatchObject({ state: 'pending', provider: 'pingfederate' });
    expect(cibaService.initiateBackchannelAuth).not.toHaveBeenCalled();
  });

  test('PingOne needs an email and says so', async () => {
    await expect(startCiba(p1Session({ email: '' }), { loginHint: 'demouser', store, fetchImpl }))
      .rejects.toMatchObject({ code: 'PF_AI_CIBA_P1_EMAIL_REQUIRED', httpStatus: 400 });
    expect(cibaService.initiateBackchannelAuth).not.toHaveBeenCalled();
  });

  test('PingOne CIBA off is refused', async () => {
    cibaService.isEnabled.mockReturnValue(false);
    await expect(startCiba(p1Session(), { store, fetchImpl })).rejects.toMatchObject({ code: 'PF_AI_CIBA_P1_NOT_CONFIGURED' });
  });

  test('a PingOne refusal keeps PingOne\'s own reason in the code', async () => {
    cibaService.initiateBackchannelAuth.mockRejectedValue(pendingError('unauthorized_client'));
    await expect(startCiba(p1Session(), { store, fetchImpl })).rejects.toMatchObject({ code: 'PF_AI_CIBA_P1_UNAUTHORIZED_CLIENT' });
    cibaService.initiateBackchannelAuth.mockRejectedValue(new Error('socket hang up'));
    await expect(startCiba(p1Session(), { store, fetchImpl })).rejects.toMatchObject({ code: 'PF_AI_CIBA_REQUEST_FAILED' });
  });

  test('an unknown PingOne user maps to a clear error', async () => {
    cibaService.initiateBackchannelAuth.mockRejectedValue(pendingError('unknown_user_id'));
    await expect(startCiba(p1Session(), { store, fetchImpl })).rejects.toMatchObject({ code: 'PF_AI_CIBA_USER_UNKNOWN' });
  });

  describe('polling', () => {
    let clock;
    const now = () => clock;
    const started = async () => {
      clock = 1000;
      const req = p1Session();
      await startCiba(req, { store, fetchImpl, now });
      clock += 6000;
      return req;
    };

    test('pending, then approved with the verified identity', async () => {
      const req = await started();
      cibaService.pollForTokens.mockRejectedValueOnce(pendingError('authorization_pending'));
      expect((await pollCiba(req, { store, fetchImpl, now })).state).toBe('pending');

      clock += 6000;
      cibaService.pollForTokens.mockResolvedValueOnce({ id_token: 'idt', access_token: 'at', token_type: 'Bearer', scope: 'openid' });
      cibaService.validateCibaIdToken.mockResolvedValueOnce({ sub: 'user-1', iss: 'https://auth.pingone.test' });
      const done = await pollCiba(req, { store, fetchImpl, now });
      expect(cibaService.validateCibaIdToken).toHaveBeenCalledWith('idt', 'user-1');
      expect(done).toMatchObject({ state: 'approved', provider: 'pingone', subject: 'user-1' });
      expect(JSON.stringify(done)).not.toMatch(/idt|"at"|p1-req/);
      expect(done.trace.map((step) => step.id)).toEqual(['start', 'poll']);
      expect(done.trace[0].title).toMatch(/PingOne CIBA/);
      expect(done.trace[0].request.params).toMatchObject({ login_hint: 'demo@example.test', scope: 'openid' });
      expect(done.trace[0].response.body.auth_req_id).toMatch(/^<redacted/);
      expect(done.trace[1].note).toBe('1 earlier poll answered authorization_pending while the user decided.');
      expect(req.session.pfAiAgent.cibaPending).toBeUndefined();
    });

    test.each([
      ['access_denied', 'denied'],
      ['expired_token', 'expired'],
    ])('%s ends the request as %s', async (error, state) => {
      const req = await started();
      cibaService.pollForTokens.mockRejectedValueOnce(pendingError(error));
      expect((await pollCiba(req, { store, fetchImpl, now })).state).toBe(state);
    });

    test('an identity that does not match the user is an error, never an approval', async () => {
      const req = await started();
      cibaService.pollForTokens.mockResolvedValueOnce({ id_token: 'idt', access_token: 'at' });
      cibaService.validateCibaIdToken.mockRejectedValueOnce(new Error('CIBA subject does not match the initiating user'));
      await expect(pollCiba(req, { store, fetchImpl, now })).rejects.toMatchObject({ code: 'PF_AI_ID_TOKEN_INVALID' });
      expect(req.session.pfAiAgent.cibaResult).toMatchObject({ state: 'error' });
    });
  });
});
