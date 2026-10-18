// Redirect-free customer sign-in: /login?pi_flow=1 + POST /pi-flow/credentials.
const request = require('supertest');
const express = require('express');
const session = require('express-session');
const router = require('../routes/oauthUser');
const loginFlowTrace = require('../services/loginFlowTraceService');
const configStore = require('../services/configStore');

jest.mock('../services/configStore', () => ({
  getEffective: jest.fn((key) => ({
    pingone_environment_id: 'test-env-id',
    user_client_id: 'test-client-id',
    user_client_secret: 'test-secret',
    user_pingone_authorize_pi_flow: 'true',
    pf_authorization_endpoint: 'https://pf.example:9031/as/authorization.oauth2',
    // The address the BFF itself can reach PF at (differs from the browser-facing one above).
    pf_token_endpoint: 'https://pingfederate.internal:9031/as/token.oauth2',
    pf_user_client_id: 'pf-client',
  })[key]),
  isUserOAuthConfigured: jest.fn(() => true),
  getOAuthProvider: jest.fn(() => 'pingone'),
  setConfig: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../services/oauthRedirectUris', () => ({
  getFrontendOrigin: jest.fn(() => 'http://localhost:3000'),
  getUserRedirectUri: jest.fn(() => 'https://api.ping.demo:4000/api/auth/oauth/user/callback'),
  validateRedirectUriOrigin: jest.fn(() => ({ ok: true })),
  getExpectedFrontendOrigin: jest.fn(() => 'http://localhost:3000'),
}));
jest.mock('../services/pkceStateCookie');
jest.mock('../services/authStateCookie');
jest.mock('../utils/oauthAuthorizeResource', () => ({
  buildPingOneAuthorizeResourceQueryParam: jest.fn(() => ''),
}));
jest.mock('../services/appEventService', () => ({ logEvent: jest.fn() }));
jest.mock('../services/pingOneUserLookupService', () => ({
  fetchPingOneUserByUsername: jest.fn().mockResolvedValue({ user: null, error: 'not_found' }),
}));
jest.mock('../services/pingOneUserService', () => ({ initialize: jest.fn(), makeRequest: jest.fn() }));

const app = express();
app.use(session({ secret: 'test-secret', resave: false, saveUninitialized: true }));
app.use(express.json());
app.use('/api/auth/oauth/user', router);

const json = (status, body, headers = {}, setCookies = []) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: {
    get: (h) => ({ 'content-type': 'application/json', ...headers })[h.toLowerCase()] ?? null,
    getSetCookie: () => setCookies,
  },
  json: async () => body,
});

describe('customer pi.flow sign-in', () => {
  let fetchMock;
  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  async function openFlow(agent) {
    fetchMock.mockResolvedValueOnce(json(200, { id: 'flow-1', status: 'USERNAME_PASSWORD_REQUIRED' }));
    return agent.get('/api/auth/oauth/user/login?pi_flow=1').expect(200);
  }

  test('opens the flow with response_type=code + response_mode=pi.flow and returns JSON, not a redirect', async () => {
    const res = await openFlow(request.agent(app));
    // PingOne does not bind login_hint, so no usernameHint is sent.
    expect(res.body).toEqual({ flowId: 'flow-1', status: 'USERNAME_PASSWORD_REQUIRED' });
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('response_mode')).toBe('pi.flow');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  test('mfa=1 asks for acr_values=Multi_Factor; nothing else can set acr', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { id: 'flow-1', status: 'USERNAME_PASSWORD_REQUIRED' }));
    await request.agent(app).get('/api/auth/oauth/user/login?pi_flow=1&mfa=1&acr_values=Other').expect(200);
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('acr_values')).toBe('Multi_Factor');
    fetchMock.mockClear();
    await openFlow(request.agent(app));
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('acr_values')).toBeNull();
  });

  test('passwordless=1 selects the passwordless policy (mfa_only) via acr_values', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { id: 'flow-1', status: 'SIGN_ON_REQUIRED' }));
    await request.agent(app).get('/api/auth/oauth/user/login?pi_flow=1&passwordless=1').expect(200);
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('acr_values')).toBe('mfa_only');
    fetchMock.mockClear();
    await openFlow(request.agent(app));
    // The password path never asks for the policy.
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('acr_values')).toBeNull();
  });

  test('plain /login is still a redirect without response_mode', async () => {
    const res = await request(app).get('/api/auth/oauth/user/login').expect(302);
    expect(res.headers.location).not.toContain('response_mode=pi.flow');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('AIC toggle on: redirect login with acr_values=AIC_Login, even when the SPA asks for pi_flow=1', async () => {
    const base = configStore.getEffective.getMockImplementation();
    configStore.getEffective.mockImplementation((key) => (key === 'aic_login_enabled' ? 'true' : base(key)));
    const addStep = jest.spyOn(loginFlowTrace, 'addStep');
    try {
      const res = await request(app).get('/api/auth/oauth/user/login?pi_flow=1').expect(302);
      expect(new URL(res.headers.location).searchParams.get('acr_values')).toBe('AIC_Login');
      expect(fetchMock).not.toHaveBeenCalled();
      // The live login diagram gains the PingOne -> AIC -> PingOne hop.
      const hops = addStep.mock.calls.map(([, s]) => `${s.actor}>${s.toActor}`);
      expect(hops).toEqual(expect.arrayContaining(['pingone>aic', 'aic>pingone']));
    } finally {
      addStep.mockRestore();
      configStore.getEffective.mockImplementation(base);
    }
  });

  test('AIC toggle off: plain /login sends no acr_values and draws no AIC hop', async () => {
    const addStep = jest.spyOn(loginFlowTrace, 'addStep');
    const res = await request(app).get('/api/auth/oauth/user/login').expect(302);
    expect(new URL(res.headers.location).searchParams.get('acr_values')).toBeNull();
    expect(addStep.mock.calls.some(([, s]) => s.actor === 'aic' || s.toActor === 'aic')).toBe(false);
    addStep.mockRestore();
  });

  test('502 when PingOne does not open a flow, so the SPA can fall back to the redirect login', async () => {
    fetchMock.mockResolvedValueOnce(json(400, { code: 'INVALID_REQUEST' }));
    const res = await request(app).get('/api/auth/oauth/user/login?pi_flow=1').expect(502);
    expect(res.body.error).toBe('pi_flow_unavailable');
  });

  test('credentials step: COMPLETED -> resume -> callback URL carrying code and the session state', async () => {
    const agent = request.agent(app);
    await openFlow(agent);
    fetchMock
      .mockResolvedValueOnce(json(200, { status: 'COMPLETED' }))
      .mockResolvedValueOnce(json(200, { authorizeResponse: { code: 'the-code' } }));
    const res = await agent.post('/api/auth/oauth/user/pi-flow/credentials')
      .send({ username: 'u', password: 'p' }).expect(200);
    const target = new URL(res.body.redirectTo);
    expect(target.pathname).toBe('/api/auth/oauth/user/callback');
    expect(target.searchParams.get('code')).toBe('the-code');
    expect(target.searchParams.get('state')).toBeTruthy();
    const [postUrl, postInit] = fetchMock.mock.calls[1];
    expect(postUrl).toMatch(/\/flows\/flow-1$/);
    expect(postInit.headers['Content-Type']).toBe('application/vnd.pingidentity.usernamePassword.check+json');
    expect(String(fetchMock.mock.calls[2][0])).toMatch(/\/as\/resume\?flowId=flow-1$/);
  });

  test('replays the ST cookie issued by the password step on /as/resume (PingOne rejects a stale one)', async () => {
    const agent = request.agent(app);
    fetchMock.mockResolvedValueOnce(json(200, { id: 'flow-1', status: 'USERNAME_PASSWORD_REQUIRED' }, {}, ['ST=first; Path=/; HttpOnly']));
    await agent.get('/api/auth/oauth/user/login?pi_flow=1').expect(200);
    fetchMock
      .mockResolvedValueOnce(json(200, { status: 'COMPLETED' }, {}, ['ST=second; Path=/; HttpOnly']))
      .mockResolvedValueOnce(json(200, { authorizeResponse: { code: 'c' } }));
    await agent.post('/api/auth/oauth/user/pi-flow/credentials').send({ username: 'u', password: 'p' }).expect(200);
    expect(fetchMock.mock.calls[1][1].headers.Cookie).toBe('ST=first');
    expect(fetchMock.mock.calls[2][1].headers.Cookie).toBe('ST=second');
  });

  test('bad password -> 401 invalid_credentials', async () => {
    const agent = request.agent(app);
    await openFlow(agent);
    fetchMock.mockResolvedValueOnce(json(400, { details: [{ code: 'INVALID_CREDENTIALS' }] }));
    const res = await agent.post('/api/auth/oauth/user/pi-flow/credentials')
      .send({ username: 'u', password: 'bad' }).expect(401);
    expect(res.body.error).toBe('invalid_credentials');
  });

  test('a non-ok PingOne step response is logged with its status and code, not a silent 502', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const agent = request.agent(app);
    await openFlow(agent);
    // PingOne answered (network fine) but refused the step: a 429 rate limit
    // with a code, the shape that used to vanish into a bare { pi_flow_failed }.
    fetchMock.mockResolvedValueOnce(json(429, { code: 'RATE_LIMITED' }));
    await agent.post('/api/auth/oauth/user/pi-flow/credentials')
      .send({ username: 'u', password: 'p' }).expect(502);
    const warn = warnSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(warn).toContain('[oauth/pi-flow]');
    expect(warn).toContain('429');
    expect(warn).toContain('RATE_LIMITED');
    warnSpy.mockRestore();
  });

  test('identifier-first flow (SIGN_ON_REQUIRED): identifies with user.lookup, then posts the password', async () => {
    const agent = request.agent(app);
    fetchMock.mockResolvedValueOnce(json(200, { id: 'flow-1', status: 'SIGN_ON_REQUIRED' }, {}, ['ST=open; Path=/']));
    await agent.get('/api/auth/oauth/user/login?pi_flow=1').expect(200);
    fetchMock
      .mockResolvedValueOnce(json(200, { status: 'PASSWORD_REQUIRED' }, {}, ['ST=identified; Path=/']))
      .mockResolvedValueOnce(json(200, { status: 'OTP_REQUIRED', _embedded: { devices: [{ id: 'dev-1', type: 'SMS', phone: '***86' }] } }))
      .mockResolvedValueOnce(json(200, { authorizeResponse: { code: 'idfirst-code' } }));
    const res = await agent.post('/api/auth/oauth/user/pi-flow/credentials')
      .send({ username: 'u', password: 'p' }).expect(200);
    expect(res.body.step).toBe('otp');
    expect(res.body.devices).toHaveLength(1);
    const [lookupUrl, lookupInit] = fetchMock.mock.calls[1];
    expect(lookupUrl).toMatch(/\/flows\/flow-1$/);
    expect(lookupInit.headers['Content-Type']).toBe('application/vnd.pingidentity.user.lookup+json');
    expect(JSON.parse(lookupInit.body)).toEqual({ username: 'u' });
    expect(fetchMock.mock.calls[2][1].headers['Content-Type']).toBe('application/vnd.pingidentity.usernamePassword.check+json');
    // the password step replays the cookie the lookup issued
    expect(fetchMock.mock.calls[2][1].headers.Cookie).toBe('ST=identified');
  });

  test('identifier-first flow: user.lookup landing on OTP_REQUIRED skips the password step', async () => {
    const agent = request.agent(app);
    fetchMock.mockResolvedValueOnce(json(200, { id: 'flow-1', status: 'SIGN_ON_REQUIRED' }));
    await agent.get('/api/auth/oauth/user/login?pi_flow=1').expect(200);
    fetchMock
      .mockResolvedValueOnce(json(200, { status: 'OTP_REQUIRED', _embedded: { devices: [] } }));
    const res = await agent.post('/api/auth/oauth/user/pi-flow/credentials')
      .send({ username: 'u', password: 'p' }).expect(200);
    expect(res.body.step).toBe('otp');
    // user.lookup only — no usernamePassword.check, no resume (flow stays open for otp.check)
    expect(fetchMock.mock.calls[1][1].headers['Content-Type']).toBe('application/vnd.pingidentity.user.lookup+json');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('OTP_REQUIRED after the password returns the otp step for the modal to drive', async () => {
    const agent = request.agent(app);
    await openFlow(agent);
    fetchMock.mockResolvedValueOnce(json(200, { status: 'OTP_REQUIRED' }));
    const res = await agent.post('/api/auth/oauth/user/pi-flow/credentials')
      .send({ username: 'u', password: 'p' }).expect(200);
    expect(res.body.step).toBe('otp');
    expect(res.body.devices).toEqual([]);
    expect(res.body.selectedDeviceId).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('otp step: otp.check posts the code with the flow cookie; COMPLETED resumes to the callback', async () => {
    const agent = request.agent(app);
    fetchMock.mockResolvedValueOnce(json(200, { id: 'flow-1', status: 'USERNAME_PASSWORD_REQUIRED' }, {}, ['ST=open; Path=/']));
    await agent.get('/api/auth/oauth/user/login?pi_flow=1').expect(200);
    // password step -> OTP_REQUIRED (issues a rotated ST like the real flow)
    fetchMock.mockResolvedValueOnce(json(200, { status: 'OTP_REQUIRED' }, {}, ['ST=after-password; Path=/']));
    await agent.post('/api/auth/oauth/user/pi-flow/credentials').send({ username: 'u', password: 'p' }).expect(200);
    // otp step -> COMPLETED
    fetchMock.mockResolvedValueOnce(json(200, { status: 'COMPLETED' }, {}, ['ST=after-otp; Path=/']));
    // resume -> code
    fetchMock.mockResolvedValueOnce(json(200, { authorizeResponse: { code: 'otpc-code' } }));
    const res = await agent.post('/api/auth/oauth/user/pi-flow/otp').send({ otp: ' 123456 ' }).expect(200);
    const [, , otpCall, resumeCall] = fetchMock.mock.calls;
    expect(String(otpCall[0])).toMatch(/\/flows\/flow-1$/);
    expect(otpCall[1].headers.Cookie).toBe('ST=after-password');
    expect(otpCall[1].headers['Content-Type']).toBe('application/vnd.pingidentity.otp.check+json');
    expect(JSON.parse(otpCall[1].body)).toEqual({ otp: '123456' });
    expect(String(resumeCall[0])).toMatch(/\/as\/resume\?flowId=flow-1$/);
    expect(resumeCall[1].headers.Cookie).toBe('ST=after-otp');
    expect(new URL(res.body.redirectTo).searchParams.get('code')).toBe('otpc-code');
  });

  test('otp step: OTP_VALIDATION_FAILED -> 401 invalid_otp, flow stays open', async () => {
    const agent = request.agent(app);
    await openFlow(agent);
    fetchMock.mockResolvedValueOnce(json(200, { status: 'OTP_REQUIRED' }, {}, ['ST=after-password; Path=/']));
    await agent.post('/api/auth/oauth/user/pi-flow/credentials').send({ username: 'u', password: 'p' }).expect(200);
    fetchMock.mockResolvedValueOnce(json(400, { details: [{ code: 'OTP_VALIDATION_FAILED' }] }));
    const res = await agent.post('/api/auth/oauth/user/pi-flow/otp').send({ otp: 'wrong' }).expect(401);
    expect(res.body.error).toBe('invalid_otp');
  });

  describe('passkey step (ASSERTION_REQUIRED)', () => {
    const OPTIONS = { challenge: 'Y2hhbGw', rpId: 'ping-devops.com', allowCredentials: [{ type: 'public-key', id: 'aWQ' }] };
    const ORIGIN = 'https://local.ping-devops.com:4000';
    const ASSERTION = { id: 'cred', rawId: 'cmF3', type: 'public-key', response: { clientDataJSON: 'Y2Q=', authenticatorData: 'YWQ=', signature: 'c2ln', userHandle: null } };

    async function toPasskeyStep(agent) {
      await openFlow(agent);
      fetchMock.mockResolvedValueOnce(json(200, {
        status: 'ASSERTION_REQUIRED',
        publicKeyCredentialRequestOptions: JSON.stringify(OPTIONS), // PingOne sends it as a string
      }, {}, ['ST=after-password; Path=/']));
      return agent.post('/api/auth/oauth/user/pi-flow/credentials').send({ username: 'u', password: 'p' }).expect(200);
    }

    test('password step returns the passkey step with parsed request options instead of falling back', async () => {
      const res = await toPasskeyStep(request.agent(app));
      expect(res.body).toEqual({ step: 'passkey', publicKeyCredentialRequestOptions: OPTIONS });
    });

    test('assertion.check posts origin + JSON-STRING assertion + FULL with the password-step cookie, then resumes', async () => {
      const agent = request.agent(app);
      await toPasskeyStep(agent);
      fetchMock
        .mockResolvedValueOnce(json(200, { status: 'COMPLETED' }, {}, ['ST=after-assertion; Path=/']))
        .mockResolvedValueOnce(json(200, { authorizeResponse: { code: 'the-code' } }));
      const res = await agent.post('/api/auth/oauth/user/pi-flow/assertion').send({ assertion: ASSERTION, origin: ORIGIN }).expect(200);
      const [url, init] = fetchMock.mock.calls[2];
      expect(url).toMatch(/\/flows\/flow-1$/);
      expect(init.headers['Content-Type']).toBe('application/vnd.pingidentity.assertion.check+json');
      expect(init.headers.Cookie).toBe('ST=after-password');
      expect(JSON.parse(init.body)).toEqual({ origin: ORIGIN, assertion: JSON.stringify(ASSERTION), compatibility: 'FULL' });
      expect(fetchMock.mock.calls[3][1].headers.Cookie).toBe('ST=after-assertion');
      expect(new URL(res.body.redirectTo).searchParams.get('code')).toBe('the-code');
    });

    test('rejects an origin that is not a known deployment origin without calling PingOne', async () => {
      const agent = request.agent(app);
      await toPasskeyStep(agent);
      const calls = fetchMock.mock.calls.length;
      await agent.post('/api/auth/oauth/user/pi-flow/assertion').send({ assertion: ASSERTION, origin: 'https://evil.example' }).expect(400);
      await agent.post('/api/auth/oauth/user/pi-flow/assertion').send({ assertion: 'not-an-object', origin: ORIGIN }).expect(400);
      expect(fetchMock.mock.calls.length).toBe(calls);
    });

    test('a rejected assertion -> 401 assertion_failed', async () => {
      const agent = request.agent(app);
      await toPasskeyStep(agent);
      fetchMock.mockResolvedValueOnce(json(400, { code: 'INVALID_DATA' }));
      const res = await agent.post('/api/auth/oauth/user/pi-flow/assertion').send({ assertion: ASSERTION, origin: ORIGIN }).expect(401);
      expect(res.body.error).toBe('assertion_failed');
    });

    test('assertion without an open flow -> 409', async () => {
      await request(app).post('/api/auth/oauth/user/pi-flow/assertion').send({ assertion: ASSERTION, origin: ORIGIN }).expect(409);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('PingFederate (provider = pingfederate)', () => {
    const PF_FLOW = 'flowPF1abc';
    beforeEach(() => { configStore.getOAuthProvider.mockReturnValue('pingfederate'); });
    afterEach(() => { configStore.getOAuthProvider.mockReturnValue('pingone'); });

    async function openPfFlow(agent, id = PF_FLOW) {
      fetchMock.mockResolvedValueOnce(json(200, { id, status: 'USERNAME_PASSWORD_REQUIRED' }, {}, ['PF=first; Path=/; Secure; HttpOnly']));
      return agent.get('/api/auth/oauth/user/login?pi_flow=1');
    }

    test('opens the flow on PF with response_type=code + response_mode=pi.flow and Accept: application/json', async () => {
      const res = await openPfFlow(request.agent(app)).then((r) => r);
      expect(res.status).toBe(200);
      // PF locks the flow to the login_hint, so the SPA is told which username to prefill.
      expect(res.body).toEqual({ flowId: PF_FLOW, status: 'USERNAME_PASSWORD_REQUIRED', usernameHint: 'demouser' });
      const [url, init] = fetchMock.mock.calls[0];
      // Sent to the server-reachable PF address, not the browser-facing one the redirect login uses.
      expect(url).toMatch(/^https:\/\/pingfederate\.internal:9031\/as\/authorization\.oauth2\?/);
      expect(new URL(url).searchParams.get('response_mode')).toBe('pi.flow');
      expect(new URL(url).searchParams.get('response_type')).toBe('code');
      expect(init.headers.Accept).toBe('application/json');
    });

    test('password step posts the PF content type + CSRF header + cookie to /pf-ws/authn/flows, and takes the code inline (no resume)', async () => {
      const agent = request.agent(app);
      await openPfFlow(agent);
      fetchMock.mockResolvedValueOnce(json(200, { status: 'COMPLETED', authorizeResponse: { code: 'pf-code' } }, {}, ['pf-hfa-exp-pwd=x; Path=/']));
      const res = await agent.post('/api/auth/oauth/user/pi-flow/credentials').send({ username: 'u', password: 'p' }).expect(200);
      const [url, init] = fetchMock.mock.calls[1];
      expect(url).toBe(`https://pingfederate.internal:9031/pf-ws/authn/flows/${PF_FLOW}`);
      expect(init.headers['Content-Type']).toBe('application/vnd.pingidentity.checkUsernamePassword+json');
      expect(init.headers['X-XSRF-Header']).toBeTruthy();
      expect(init.headers.Cookie).toBe('PF=first');
      expect(JSON.parse(init.body)).toEqual({ username: 'u', password: 'p' });
      expect(fetchMock).toHaveBeenCalledTimes(2); // authorize + password only: no /as/resume on PF
      const target = new URL(res.body.redirectTo);
      expect(target.pathname).toBe('/api/auth/oauth/user/callback');
      expect(target.searchParams.get('code')).toBe('pf-code');
      expect(target.searchParams.get('state')).toBeTruthy();
    });

    test('an authorize response whose state is not the session state is refused', async () => {
      const agent = request.agent(app);
      await openPfFlow(agent);
      fetchMock.mockResolvedValueOnce(json(200, { status: 'COMPLETED', authorizeResponse: { code: 'pf-code', state: 'someone-elses-state' } }));
      const res = await agent.post('/api/auth/oauth/user/pi-flow/credentials').send({ username: 'u', password: 'p' }).expect(502);
      expect(res.body.error).toBe('pi_flow_no_code');
    });

    test('bad credentials (CREDENTIAL_VALIDATION_FAILED) -> 401 invalid_credentials', async () => {
      const agent = request.agent(app);
      await openPfFlow(agent);
      fetchMock.mockResolvedValueOnce(json(400, { code: 'VALIDATION_ERROR', details: [{ code: 'CREDENTIAL_VALIDATION_FAILED' }] }));
      const res = await agent.post('/api/auth/oauth/user/pi-flow/credentials').send({ username: 'u', password: 'bad' }).expect(401);
      expect(res.body.error).toBe('invalid_credentials');
    });

    test('a status this BFF cannot drive falls back to the redirect login', async () => {
      const agent = request.agent(app);
      await openPfFlow(agent);
      fetchMock.mockResolvedValueOnce(json(200, { status: 'MFA_REQUIRED' }));
      const res = await agent.post('/api/auth/oauth/user/pi-flow/credentials').send({ username: 'u', password: 'p' }).expect(200);
      expect(res.body).toEqual({ fallback: true, status: 'MFA_REQUIRED' });
    });

    describe('PF passwordless (acr_values=mfa_only -> identifier first -> PingOne MFA adapter)', () => {
      const PF_DEVICES = [
        { id: 'pf-sms-1', type: 'SMS', target: '******1586', usable: true, defaultDevice: false },
        { id: 'pf-mail-1', type: 'Email', target: 'cm***@pingone.com', usable: true, defaultDevice: true },
        { id: 'pf-off-1', type: 'SMS', target: '******0000', usable: false, defaultDevice: false },
        { id: 'pf-fido-1', type: 'FIDO2', target: null, usable: true, defaultDevice: false },
      ];
      async function openPfPasswordless(agent, status) {
        fetchMock.mockResolvedValueOnce(json(200, { id: PF_FLOW, status }, {}, ['PF=first; Path=/; Secure; HttpOnly']));
        return agent.get('/api/auth/oauth/user/login?pi_flow=1&passwordless=1').expect(200);
      }
      const ct = (i) => fetchMock.mock.calls[i][1].headers['Content-Type'];
      const body = (i) => JSON.parse(fetchMock.mock.calls[i][1].body);

      test('opened at AUTHENTICATION_REQUIRED (hinted user): posts authenticate, returns the mapped device step', async () => {
        const agent = request.agent(app);
        await openPfPasswordless(agent, 'AUTHENTICATION_REQUIRED');
        fetchMock.mockResolvedValueOnce(json(200, { status: 'DEVICE_SELECTION_REQUIRED', devices: PF_DEVICES }));
        const res = await agent.post('/api/auth/oauth/user/pi-flow/passwordless').send({ username: 'demouser' }).expect(200);
        expect(ct(1)).toBe('application/vnd.pingidentity.authenticate+json');
        expect(body(1)).toEqual({});
        expect(res.body.step).toBe('device');
        expect(res.body.devices).toEqual([
          { id: 'pf-sms-1', type: 'SMS', nickname: null, email: null, phone: '******1586' },
          { id: 'pf-mail-1', type: 'EMAIL', nickname: null, email: 'cm***@pingone.com', phone: null },
          { id: 'pf-fido-1', type: 'FIDO2', nickname: null, email: null, phone: null },
        ]);
      });

      test('device step swaps the masked email for the full PingOne address', async () => {
        const { fetchPingOneUserByUsername } = require('../services/pingOneUserLookupService');
        const pingOneUserService = require('../services/pingOneUserService');
        fetchPingOneUserByUsername.mockResolvedValueOnce({ user: { id: 'p1-user', username: 'demoUser' } });
        pingOneUserService.makeRequest.mockResolvedValueOnce({
          _embedded: { devices: [{ id: 'pf-mail-1', type: 'EMAIL', email: 'cmuir+demo@pingone.com' }] },
        });
        const agent = request.agent(app);
        await openPfPasswordless(agent, 'AUTHENTICATION_REQUIRED');
        fetchMock.mockResolvedValueOnce(json(200, { status: 'DEVICE_SELECTION_REQUIRED', devices: PF_DEVICES }));
        const res = await agent.post('/api/auth/oauth/user/pi-flow/passwordless').send({ username: 'demouser' }).expect(200);
        expect(fetchPingOneUserByUsername).toHaveBeenCalledWith('demouser');
        expect(pingOneUserService.makeRequest).toHaveBeenCalledWith('GET', '/users/p1-user/devices');
        expect(res.body.devices.find((d) => d.id === 'pf-mail-1').email).toBe('cmuir+demo@pingone.com');
        expect(res.body.devices.find((d) => d.id === 'pf-sms-1').phone).toBe('******1586');
      });

      test('opened at IDENTIFIER_REQUIRED: submits the identifier, then authenticate', async () => {
        const agent = request.agent(app);
        await openPfPasswordless(agent, 'IDENTIFIER_REQUIRED');
        fetchMock.mockResolvedValueOnce(json(200, { status: 'AUTHENTICATION_REQUIRED' }));
        fetchMock.mockResolvedValueOnce(json(200, { status: 'DEVICE_SELECTION_REQUIRED', devices: PF_DEVICES }));
        const res = await agent.post('/api/auth/oauth/user/pi-flow/passwordless').send({ username: ' demouser ' }).expect(200);
        expect(ct(1)).toBe('application/vnd.pingidentity.submitIdentifier+json');
        expect(body(1)).toEqual({ identifier: 'demouser' });
        expect(ct(2)).toBe('application/vnd.pingidentity.authenticate+json');
        expect(res.body.step).toBe('device');
      });

      test('policy without the mfa_only branch (opens on the password form) -> 409 passwordless_unavailable, PF not called', async () => {
        const agent = request.agent(app);
        await openPfPasswordless(agent, 'USERNAME_PASSWORD_REQUIRED');
        const calls = fetchMock.mock.calls.length;
        const res = await agent.post('/api/auth/oauth/user/pi-flow/passwordless').send({ username: 'demouser' }).expect(409);
        expect(res.body.error).toBe('passwordless_unavailable');
        expect(fetchMock.mock.calls.length).toBe(calls);
      });

      test("device select uses PF's selectDevice action with deviceRef; OTP_REQUIRED returns the otp step", async () => {
        const agent = request.agent(app);
        await openPfPasswordless(agent, 'AUTHENTICATION_REQUIRED');
        fetchMock.mockResolvedValueOnce(json(200, { status: 'DEVICE_SELECTION_REQUIRED', devices: PF_DEVICES }));
        await agent.post('/api/auth/oauth/user/pi-flow/passwordless').send({ username: 'demouser' }).expect(200);
        fetchMock.mockResolvedValueOnce(json(200, { status: 'OTP_REQUIRED' }));
        const res = await agent.post('/api/auth/oauth/user/pi-flow/device').send({ deviceId: 'pf-mail-1' }).expect(200);
        expect(ct(2)).toBe('application/vnd.pingidentity.selectDevice+json');
        expect(body(2)).toEqual({ deviceRef: { id: 'pf-mail-1' } });
        expect(res.body.step).toBe('otp');
      });

      test('MFA_COMPLETED -> continueAuthentication -> COMPLETED signs in (no fallback to the hosted password page)', async () => {
        const agent = request.agent(app);
        await openPfPasswordless(agent, 'AUTHENTICATION_REQUIRED');
        fetchMock.mockResolvedValueOnce(json(200, { status: 'OTP_REQUIRED' }));
        await agent.post('/api/auth/oauth/user/pi-flow/passwordless').send({ username: 'demouser' }).expect(200);
        fetchMock
          .mockResolvedValueOnce(json(200, { status: 'MFA_COMPLETED', _links: { continueAuthentication: { href: 'x' } } }))
          .mockResolvedValueOnce(json(200, { status: 'COMPLETED', authorizeResponse: { code: 'pf-pwless-code' } }));
        const res = await agent.post('/api/auth/oauth/user/pi-flow/otp').send({ otp: '123456' }).expect(200);
        expect(ct(3)).toBe('application/vnd.pingidentity.continueAuthentication+json');
        expect(res.body.fallback).toBeUndefined();
        const target = new URL(res.body.redirectTo);
        expect(target.pathname).toBe('/api/auth/oauth/user/callback');
        expect(target.searchParams.get('code')).toBe('pf-pwless-code');
      });

      test("OTP uses PF's checkOtp; INVALID_OTP -> 401 invalid_otp so the modal re-prompts", async () => {
        const agent = request.agent(app);
        await openPfPasswordless(agent, 'AUTHENTICATION_REQUIRED');
        fetchMock.mockResolvedValueOnce(json(200, { status: 'OTP_REQUIRED' }));
        await agent.post('/api/auth/oauth/user/pi-flow/passwordless').send({ username: 'demouser' }).expect(200);
        fetchMock.mockResolvedValueOnce(json(400, { code: 'VALIDATION_ERROR', details: [{ code: 'INVALID_OTP' }] }));
        const bad = await agent.post('/api/auth/oauth/user/pi-flow/otp').send({ otp: '000000' }).expect(401);
        expect(bad.body.error).toBe('invalid_otp');
        expect(ct(2)).toBe('application/vnd.pingidentity.checkOtp+json');
        expect(body(2)).toEqual({ otp: '000000' });
      });
    });

    test('the passkey step posts PF checkAssertion (JSON-string assertion); a rejection -> 401', async () => {
      const agent = request.agent(app);
      await openPfFlow(agent);
      const calls = fetchMock.mock.calls.length;
      fetchMock.mockResolvedValueOnce(json(400, { code: 'VALIDATION_ERROR' }));
      const res = await agent.post('/api/auth/oauth/user/pi-flow/assertion')
        .send({ assertion: { id: 'x' }, origin: 'https://local.ping-devops.com:4000' }).expect(401);
      expect(res.body.error).toBe('assertion_failed');
      const [, init] = fetchMock.mock.calls[calls];
      expect(init.headers['Content-Type']).toBe('application/vnd.pingidentity.checkAssertion+json');
      expect(JSON.parse(init.body)).toEqual({ origin: 'https://local.ping-devops.com:4000', assertion: JSON.stringify({ id: 'x' }), compatibility: 'FULL' });
    });

    test('a flow id that is not a plain token is rejected before it can reach a URL path', async () => {
      const res = await openPfFlow(request.agent(app), '../../admin');
      expect(res.status).toBe(502);
      expect(res.body.error).toBe('pi_flow_unavailable');
    });
  });

  test('credentials without an open flow -> 409, PingOne never called', async () => {
    await request(app).post('/api/auth/oauth/user/pi-flow/credentials')
      .send({ username: 'u', password: 'p' }).expect(409);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe('passwordless start (username-only)', () => {
    test('posts username.check with the flow cookie; OTP_REQUIRED returns the otp step', async () => {
      const agent = request.agent(app);
      fetchMock.mockResolvedValueOnce(json(200, { id: 'flow-1', status: 'USERNAME_PASSWORD_REQUIRED' }, {}, ['ST=open; Path=/']));
      await agent.get('/api/auth/oauth/user/login?pi_flow=1').expect(200);
      fetchMock.mockResolvedValueOnce(json(200, { status: 'OTP_REQUIRED' }, {}, ['ST=after-username; Path=/']));
      const res = await agent.post('/api/auth/oauth/user/pi-flow/passwordless')
        .send({ username: 'u' }).expect(200);
      expect(res.body.step).toBe('otp');
      expect(res.body.devices).toEqual([]);
      const call = fetchMock.mock.calls[1];
      expect(String(call[0])).toMatch(/\/flows\/flow-1$/);
      expect(call[1].headers['Content-Type']).toBe('application/vnd.pingidentity.user.lookup+json');
      expect(call[1].headers.Cookie).toBe('ST=open');
      expect(JSON.parse(call[1].body)).toEqual({ username: 'u' });
    });

    test('ASSERTION_REQUIRED returns the passkey step with parsed options', async () => {
      const agent = request.agent(app);
      await openFlow(agent);
      const OPTIONS = { challenge: 'Y2g', rpId: 'ping-devops.com' };
      fetchMock.mockResolvedValueOnce(json(200, {
        status: 'ASSERTION_REQUIRED',
        publicKeyCredentialRequestOptions: JSON.stringify(OPTIONS),
      }));
      const res = await agent.post('/api/auth/oauth/user/pi-flow/passwordless')
        .send({ username: 'u' }).expect(200);
      expect(res.body.step).toBe('passkey');
      expect(res.body.publicKeyCredentialRequestOptions).toEqual(OPTIONS);
    });

    test('DEVICE_SELECTION_REQUIRED (several devices) returns the device step, not passwordless_unavailable', async () => {
      const agent = request.agent(app);
      await openFlow(agent);
      fetchMock.mockResolvedValueOnce(json(200, {
        status: 'DEVICE_SELECTION_REQUIRED',
        _embedded: { devices: [{ id: 'dev-email-1', type: 'EMAIL' }, { id: 'dev-fido-1', type: 'FIDO2' }] },
      }));
      const res = await agent.post('/api/auth/oauth/user/pi-flow/passwordless')
        .send({ username: 'u' }).expect(200);
      expect(res.body.step).toBe('device');
      expect(res.body.devices.map((d) => d.id)).toEqual(['dev-email-1', 'dev-fido-1']);
    });

    test('policy requires a password -> 409 passwordless_unavailable with a message', async () => {
      const agent = request.agent(app);
      await openFlow(agent);
      fetchMock.mockResolvedValueOnce(json(200, { status: 'USERNAME_PASSWORD_REQUIRED' }));
      const res = await agent.post('/api/auth/oauth/user/pi-flow/passwordless')
        .send({ username: 'u' }).expect(409);
      expect(res.body.error).toBe('passwordless_unavailable');
      expect(res.body.message).toContain('password');
    });

    test('after a PASSWORD_REQUIRED lookup, the password form posts the password without re-identifying', async () => {
      const agent = request.agent(app);
      fetchMock.mockResolvedValueOnce(json(200, { id: 'flow-1', status: 'SIGN_ON_REQUIRED' }, {}, ['ST=open; Path=/']));
      await agent.get('/api/auth/oauth/user/login?pi_flow=1').expect(200);
      fetchMock.mockResolvedValueOnce(json(200, { status: 'PASSWORD_REQUIRED' }, {}, ['ST=after-lookup; Path=/']));
      await agent.post('/api/auth/oauth/user/pi-flow/passwordless').send({ username: 'u' }).expect(409);
      fetchMock.mockResolvedValueOnce(json(200, { status: 'OTP_REQUIRED' }));
      await agent.post('/api/auth/oauth/user/pi-flow/credentials').send({ username: 'u', password: 'p' }).expect(200);
      const call = fetchMock.mock.calls[2];
      expect(call[1].headers['Content-Type']).toBe('application/vnd.pingidentity.usernamePassword.check+json');
      expect(call[1].headers.Cookie).toBe('ST=after-lookup');
    });

    test('trims the username before posting', async () => {
      const agent = request.agent(app);
      await openFlow(agent);
      fetchMock.mockResolvedValueOnce(json(200, { status: 'OTP_REQUIRED' }));
      await agent.post('/api/auth/oauth/user/pi-flow/passwordless')
        .send({ username: '  u  ' }).expect(200);
      expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ username: 'u' });
    });

    test('empty username -> 400 invalid_request without calling PingOne', async () => {
      const agent = request.agent(app);
      await openFlow(agent);
      fetchMock.mockClear();
      await agent.post('/api/auth/oauth/user/pi-flow/passwordless')
        .send({ username: '   ' }).expect(400);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    test('without an open flow -> 409 pi_flow_not_started without calling PingOne', async () => {
      fetchMock.mockClear();
      await request(app).post('/api/auth/oauth/user/pi-flow/passwordless')
        .send({ username: 'u' }).expect(409);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('device selection (device.select)', () => {
    async function toOtpWithDevices(agent) {
      fetchMock.mockResolvedValueOnce(json(200, { id: 'flow-1', status: 'USERNAME_PASSWORD_REQUIRED' }));
      await agent.get('/api/auth/oauth/user/login?pi_flow=1').expect(200);
      fetchMock.mockResolvedValueOnce(json(200, {
        status: 'OTP_REQUIRED',
        selectedDevice: { id: 'dev-email-1' },
        _embedded: {
          devices: [
            { id: 'dev-email-1', type: 'EMAIL', email: 'cm****@pingidentity.com', usableStatus: { status: 'ENABLED' } },
            { id: 'dev-sms-1', type: 'SMS', phone: '*******86', usableStatus: { status: 'ENABLED' } },
            { id: 'dev-fido-1', type: 'FIDO2', nickname: 'My Passkey', usableStatus: { status: 'ENABLED' } },
            { id: 'dev-old-1', type: 'EMAIL', email: 'x@y.z', usableStatus: { status: 'DISABLED' } },
          ],
        },
      }));
      const res = await agent.post('/api/auth/oauth/user/pi-flow/credentials')
        .send({ username: 'u', password: 'p' }).expect(200);
      expect(res.body.step).toBe('otp');
      expect(res.body.devices).toHaveLength(3); // DISABLED device filtered
      expect(res.body.selectedDeviceId).toBe('dev-email-1');
    }

    test('credentials response carries the usable device list and the selected device', async () => {
      await toOtpWithDevices(request.agent(app));
    });

    test('picking the FIDO2 device posts device.select with the PingOne shape and returns the passkey step', async () => {
      const agent = request.agent(app);
      await toOtpWithDevices(agent);
      const OPTIONS = { challenge: 'Y2g', rpId: 'ping-devops.com' };
      fetchMock.mockResolvedValueOnce(json(200, {
        status: 'ASSERTION_REQUIRED',
        publicKeyCredentialRequestOptions: JSON.stringify(OPTIONS),
      }));
      const res = await agent.post('/api/auth/oauth/user/pi-flow/device')
        .send({ deviceId: 'dev-fido-1' }).expect(200);
      expect(res.body.step).toBe('passkey');
      expect(res.body.publicKeyCredentialRequestOptions).toEqual(OPTIONS);
      const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
      expect(call[1].headers['Content-Type']).toBe('application/vnd.pingidentity.device.select+json');
      expect(JSON.parse(call[1].body)).toEqual({ device: { id: 'dev-fido-1' } });
    });

    test('picking an OTP device returns a fresh otp step', async () => {
      const agent = request.agent(app);
      await toOtpWithDevices(agent);
      fetchMock.mockResolvedValueOnce(json(200, { status: 'OTP_REQUIRED', selectedDevice: { id: 'dev-sms-1' } }));
      const res = await agent.post('/api/auth/oauth/user/pi-flow/device')
        .send({ deviceId: 'dev-sms-1' }).expect(200);
      expect(res.body.step).toBe('otp');
      expect(res.body.selectedDeviceId).toBe('dev-sms-1');
    });

    test('malformed deviceId -> 400 invalid_request without calling PingOne', async () => {
      const agent = request.agent(app);
      await toOtpWithDevices(agent);
      fetchMock.mockClear();
      await agent.post('/api/auth/oauth/user/pi-flow/device')
        .send({ deviceId: '../../etc' }).expect(400);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    test('device select without an open flow -> 409', async () => {
      await request(app).post('/api/auth/oauth/user/pi-flow/device')
        .send({ deviceId: 'dev-1' }).expect(409);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});

// The session-token modal's sign-in: /login?mode=pi.flow returns the authorize URL as JSON
// (no 302), and must never replace an Admin session.
describe('/login?mode=pi.flow (session token modal)', () => {
  const oauthUserService = require('../services/oauthUserService');
  const seeded = { session: {} };
  const modeApp = express();
  modeApp.use(session({ secret: 'test-secret', resave: false, saveUninitialized: true }));
  modeApp.use((req, _res, next) => { Object.assign(req.session, seeded.session); next(); });
  modeApp.use('/api/auth/oauth/user', router);

  beforeEach(() => { seeded.session = {}; });
  afterEach(() => jest.restoreAllMocks());

  test('returns the authorize URL as JSON with response_type=code + response_mode=pi.flow', async () => {
    const res = await request(modeApp).get('/api/auth/oauth/user/login?mode=pi.flow').expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.callbackPath).toBe('/api/auth/oauth/user/callback');
    const url = new URL(res.body.authorizeUrl);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('response_mode')).toBe('pi.flow');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  test.each([
    ['oauthType admin', { oauthType: 'admin' }],
    ['user role admin', { user: { role: 'admin' } }],
  ])('409 admin_session_active when %s', async (_n, seed) => {
    seeded.session = seed;
    const res = await request(modeApp).get('/api/auth/oauth/user/login?mode=pi.flow').expect(409);
    expect(res.body.error).toBe('admin_session_active');
  });

  test('400 pi_flow_provider_unsupported when the end-user provider is not PingOne', async () => {
    jest.spyOn(oauthUserService, 'identifyProvider').mockReturnValue('pingfederate');
    const res = await request(modeApp).get('/api/auth/oauth/user/login?mode=pi.flow').expect(400);
    expect(res.body.error).toBe('pi_flow_provider_unsupported');
  });

  test('400 not_configured as JSON, not a redirect, when end-user OAuth is unset', async () => {
    configStore.isUserOAuthConfigured.mockReturnValueOnce(false);
    const res = await request(modeApp).get('/api/auth/oauth/user/login?mode=pi.flow').expect(400);
    expect(res.body.error).toBe('not_configured');
  });
});

describe('PUT /login-hint', () => {
  test('stores a valid hint for the customer role', async () => {
    const res = await request(app)
      .put('/api/auth/oauth/user/login-hint')
      .send({ value: 'someone@pingone.com' });
    expect(res.status).toBe(204);
    expect(configStore.setConfig).toHaveBeenCalledWith(
      expect.objectContaining({ last_login_hint_customer: 'someone@pingone.com' }));
  });

  test('rejects control characters and overlong values with 400', async () => {
    const res1 = await request(app)
      .put('/api/auth/oauth/user/login-hint').send({ value: 'bad\u0007name' });
    expect(res1.status).toBe(400);
    expect(res1.body.error).toBe('invalid_hint');
    const res2 = await request(app)
      .put('/api/auth/oauth/user/login-hint').send({ value: 'x'.repeat(257) });
    expect(res2.status).toBe(400);
  });

  test('empty body is a 400, not a wiped hint', async () => {
    const res = await request(app)
      .put('/api/auth/oauth/user/login-hint').send({});
    expect(res.status).toBe(400);
  });
});

describe('stored login hint at flow open', () => {
  let fetchMock;
  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  test('pi_flow open includes the stored hint as usernameHint for PingOne too', async () => {
    configStore.getEffective.mockImplementation((key) => ({
      pingone_environment_id: 'test-env-id',
      user_client_id: 'test-client-id',
      user_client_secret: 'test-secret',
      user_pingone_authorize_pi_flow: 'true',
      last_login_hint_customer: 'stored-user@pingone.com',
    })[key]);
    fetchMock.mockResolvedValueOnce(json(200, { id: 'flow-1', status: 'SIGN_ON_REQUIRED' }));
    const res = await request(app).get('/api/auth/oauth/user/login?pi_flow=1').expect(200);
    expect(res.body.usernameHint).toBe('stored-user@pingone.com');
    const authorizeUrl = fetchMock.mock.calls[0][0];
    expect(authorizeUrl).toContain('login_hint=stored-user');
  });

  test('hint is advisory: signing in with a different username than the hint succeeds', async () => {
    configStore.getEffective.mockImplementation((key) => ({
      pingone_environment_id: 'test-env-id',
      user_client_id: 'test-client-id',
      user_client_secret: 'test-secret',
      user_pingone_authorize_pi_flow: 'true',
      last_login_hint_customer: 'stored-user@pingone.com',
    })[key]);
    const agent = request.agent(app);
    fetchMock.mockResolvedValueOnce(json(200, { id: 'flow-1', status: 'USERNAME_PASSWORD_REQUIRED' }));
    await agent.get('/api/auth/oauth/user/login?pi_flow=1').expect(200);
    fetchMock
      .mockResolvedValueOnce(json(200, { status: 'COMPLETED' }))
      .mockResolvedValueOnce(json(200, { authorizeResponse: { code: 'c' } }));
    // a DIFFERENT username than the stored hint completes fine
    await agent.post('/api/auth/oauth/user/pi-flow/credentials')
      .send({ username: 'other-user@pingone.com', password: 'p' }).expect(200);
  });

  test('no stored hint: open still works and sends no usernameHint', async () => {
    configStore.getEffective.mockImplementation((key) => ({
      pingone_environment_id: 'test-env-id',
      user_client_id: 'test-client-id',
      user_client_secret: 'test-secret',
      user_pingone_authorize_pi_flow: 'true',
    })[key]);
    fetchMock.mockResolvedValueOnce(json(200, { id: 'flow-1', status: 'SIGN_ON_REQUIRED' }));
    const res = await request(app).get('/api/auth/oauth/user/login?pi_flow=1').expect(200);
    expect(res.body.usernameHint).toBeUndefined();
  });
});

// ── Review-fix pins: the STORED hint is PingOne-only and never on force ──────
describe('stored login hint is PingOne-only and force-suppressed', () => {
  let fetchMock;
  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  test('PingFederate never receives the stored hint (it binds the flow to it)', async () => {
    configStore.getOAuthProvider.mockReturnValue('pingfederate');
    // Full PF config (a prior describe may have left its own impl installed).
    configStore.getEffective.mockImplementation((key) => ({
      pingone_environment_id: 'test-env-id',
      user_pingone_authorize_pi_flow: 'true',
      pf_authorization_endpoint: 'https://pf.example:9031/as/authorization.oauth2',
      pf_token_endpoint: 'https://pingfederate.internal:9031/as/token.oauth2',
      pf_user_client_id: 'pf-client',
      last_login_hint_customer: 'person-a@pingone.com',
    })[key]);
    fetchMock.mockResolvedValueOnce(json(200, { id: 'flow-1', status: 'USERNAME_PASSWORD_REQUIRED' }));
    const res = await request(app).get('/api/auth/oauth/user/login?pi_flow=1').expect(200);
    const authorizeUrl = fetchMock.mock.calls[0][0];
    expect(authorizeUrl).not.toContain('login_hint=person-a');
  });

  test('forced re-auth on PingOne drops the stored hint (a different person may sign in)', async () => {
    configStore.getOAuthProvider.mockReturnValue('pingone');
    configStore.getEffective.mockImplementation((key) => ({
      pingone_environment_id: 'test-env-id',
      user_client_id: 'test-client-id',
      user_client_secret: 'test-secret',
      user_pingone_authorize_pi_flow: 'true',
      last_login_hint_customer: 'person-a@pingone.com',
    })[key]);
    fetchMock.mockResolvedValueOnce(json(200, { id: 'flow-1', status: 'SIGN_ON_REQUIRED' }));
    await request(app).get('/api/auth/oauth/user/login?pi_flow=1&force=true').expect(200);
    const authorizeUrl = fetchMock.mock.calls[0][0];
    expect(authorizeUrl).toContain('prompt=login');
    expect(authorizeUrl).not.toContain('login_hint=person-a');
  });
});
