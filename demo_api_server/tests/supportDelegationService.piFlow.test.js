'use strict';
// tests/supportDelegationService.piFlow.test.js
//
// Headless customer pi.flow sign-on ceremony for the support console (Task 2):
// the operator's BFF drives PingOne pi.flow server-side; the customer's own
// OTP device is the human moment. Stubs fetch; the service's own flow-state
// machine is under test.

const flush = () => new Promise((r) => setImmediate(r));

function jsonRes(status, body, headers = {}) {
  return { ok: status < 400, status, headers: { get: (n) => headers[n.toLowerCase()] || null }, json: async () => body };
}

function fakeSession() {
  return { support: null, save: (cb) => cb && cb() };
}

function fakeReq() {
  const req = { session: fakeSession(), headers: {} };
  return req;
}

beforeEach(() => {
  global.fetch = jest.fn();
  process.env.PINGONE_USER_CLIENT_ID = 'user-cid';
  process.env.DEMO_PASSWORD = 'Baseball123!';
});

describe('supportDelegationService.openCustomerSignon', () => {
  let svc;
  beforeEach(() => { jest.isolateModules(() => { svc = require('../services/supportDelegationService'); }); });

  it('drives lookup + password steps headlessly and stops at OTP_REQUIRED', async () => {
    // authorize → flow JSON
    global.fetch.mockImplementationOnce(async () => jsonRes(200, { id: 'flow-abc123', status: 'SIGN_ON_REQUIRED' }, { 'set-cookie': 'PF=1' }));
    // user.lookup
    global.fetch.mockImplementationOnce(async () => jsonRes(200, { status: 'PASSWORD_REQUIRED' }));
    // usernamePassword.check → OTP_REQUIRED
    global.fetch.mockImplementationOnce(async () => jsonRes(200, { status: 'OTP_REQUIRED', _embedded: { devices: [{ type: 'SMS', phone: { number: '+19725550186' } }] } }));

    const req = fakeReq();
    const out = await svc.openCustomerSignon(req, { username: 'demoUser', pingOneUserId: '1583af47' });
    await flush();
    expect(out.step).toBe('otp');
    expect(out.maskedContact).toContain('86');
    const s = req.session.support;
    expect(s.pendingFlow.flowId).toBe('flow-abc123');
    expect(s.codeVerifier).toMatch(/^[A-Za-z0-9._~-]{43,128}$/);
    expect(s.subjectToken).toBeUndefined();
  });

  it('rejects a customer lookup when PingOne opens no flow', async () => {
    global.fetch.mockImplementationOnce(async () => jsonRes(400, { error: 'nope' }));
    await expect(svc.openCustomerSignon(fakeReq(), { username: 'demoUser', pingOneUserId: 'x' }))
      .rejects.toMatchObject({ code: 'pi_flow_unavailable' });
  });
});

describe('supportDelegationService.submitCustomerOtp', () => {
  let svc;
  beforeEach(() => { jest.isolateModules(() => { svc = require('../services/supportDelegationService'); }); });

  function sessionWithFlow() {
    const req = fakeReq();
    req.session.support = {
      customerUsername: 'demoUser', pingOneUserId: '1583af47',
      pendingFlow: { flowId: 'flow-abc123', cookies: { PF: '1' }, status: 'OTP_REQUIRED', startedAt: Date.now() },
      codeVerifier: 'v'.repeat(64), state: 'st', nonce: 'n', redirectUri: 'https://x/cb',
      verifiedUntil: 0,
    };
    return req;
  }

  it('wrong OTP → 401 invalid_otp, flow kept for retry', async () => {
    const req = sessionWithFlow();
    global.fetch.mockImplementationOnce(async () => jsonRes(400, { details: [{ code: 'OTP_VALIDATION_FAILED' }] }));
    await expect(svc.submitCustomerOtp(req, { otp: '000000' }))
      .rejects.toMatchObject({ status: 401, code: 'invalid_otp' });
    expect(req.session.support.pendingFlow).toBeTruthy(); // flow survives
  });

  it('correct OTP → code redeemed → session holds the subject token', async () => {
    const req = sessionWithFlow();
    // otp.check → COMPLETED
    global.fetch.mockImplementationOnce(async () => jsonRes(200, { status: 'COMPLETED' }));
    // as/resume → code (via Location header)
    global.fetch.mockImplementationOnce(async () => jsonRes(302, {}, { location: 'https://x/cb?code=AUTHCODE&state=st' }));

    // Stub exchangeCodeForToken. doMock only affects module loads AFTER the
    // call, so the doMock and the service require share one isolateModules block.
    jest.isolateModules(() => {
      jest.doMock('../services/oauthUserService', () => ({
        ...jest.requireActual('../services/oauthUserService'),
        exchangeCodeForToken: jest.fn(async () => ({ access_token: 'subject.jwt.value', id_token: 'idt', expires_in: 3600, scope: 'openid read write' })),
      }));
      svc = require('../services/supportDelegationService');
    });

    const out = await svc.submitCustomerOtp(req, { otp: '123456' });
    await flush();
    expect(out.verified).toBe(true);
    expect(req.session.support.subjectToken).toBe('subject.jwt.value');
    expect(req.session.support.verifiedUntil).toBeGreaterThan(Date.now());
    expect(req.session.support.pendingFlow).toBeUndefined();
    // tokenEvent carries claims, never the token value
    expect(JSON.stringify(out.tokenEvent)).not.toContain('subject.jwt.value');
  });
});
