'use strict';
// tests/supportDelegationService.exchange.test.js
//
// Task 3: RFC 8693 exchange for support writes. Subject = the customer's
// ceremony token (session), actor = a fresh admin-client CC token. PingOne
// mints act.sub from the actor token's client_id — this code never fabricates
// claims. Stubs oauthService; the mapping/wiring is under test.

jest.mock('../services/oauthService');
// Real decodeJwt parses JWTs; the exchange tests only need claims out.
jest.mock('../utils/tokenUtils', () => ({
  decodeJwt: jest.fn(() => ({
    claims: { sub: '1583af47', act: { sub: 'admin-cid' }, scope: 'write', aud: 'enduser.ping.demo', jti: 'j-1' },
  })),
}));

describe('exchangeForWrite', () => {
  let svc, oauthService;
  beforeEach(() => {
    // The service captures its required modules at load time, so the mock
    // instance under test must come from the SAME isolateModules sandbox —
    // a require outside it returns a different automock object.
    jest.isolateModules(() => {
      svc = require('../services/supportDelegationService');
      oauthService = require('../services/oauthService');
    });
    process.env.ENDUSER_AUDIENCE = 'enduser.ping.demo';
  });

  function reqWithSubject() {
    return { session: { support: {
      customerUsername: 'demoUser', customerId: '5', pingOneUserId: '1583af47',
      subjectToken: 'subject.jwt.value', subjectClaims: { sub: '1583af47', scope: 'read write' },
      verifiedUntil: Date.now() + 1000,
    }, save: (cb) => cb && cb() } };
  }

  it('exchanges with subject=customer, actor=admin CC, single scope, 5-min lifetime', async () => {
    oauthService.getAdminClientCredentialsToken.mockResolvedValue('actor.cc.token');
    oauthService.performTokenExchangeWithActor.mockResolvedValue('delegated.jwt.value');

    const out = await svc.exchangeForWrite(reqWithSubject(), { scope: 'write', actorClientId: 'admin-cid' });
    expect(out.delegatedToken).toBe('delegated.jwt.value');
    expect(out.delegatedClaims.act.sub).toBe('admin-cid');
    const [subject, actor, audience, scopes, exchangeOptions] = oauthService.performTokenExchangeWithActor.mock.calls[0];
    expect(subject).toBe('subject.jwt.value');
    expect(actor).toBe('actor.cc.token');
    expect(audience).toBe('enduser.ping.demo');
    expect(scopes).toEqual(['write']);
    expect(exchangeOptions).toMatchObject({ tokenLifetime: 300 }); // spec: 5-minute delegated token
    expect(oauthService.getAdminClientCredentialsToken).toHaveBeenCalledWith('write');
  });

  it('maps an exchange failure to 502 exchange_failed', async () => {
    oauthService.getAdminClientCredentialsToken.mockResolvedValue('actor.cc.token');
    oauthService.performTokenExchangeWithActor.mockRejectedValue(new Error('down'));
    await expect(svc.exchangeForWrite(reqWithSubject(), { scope: 'write', actorClientId: 'c' }))
      .rejects.toMatchObject({ status: 502, code: 'exchange_failed' });
  });

  it('maps errors without status/code (AbortSignal timeout) to 502 exchange_failed', async () => {
    oauthService.getAdminClientCredentialsToken.mockRejectedValue(
      Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' })
    );
    await expect(svc.exchangeForWrite(reqWithSubject(), { scope: 'write', actorClientId: 'c' }))
      .rejects.toMatchObject({ status: 502, code: 'exchange_failed' });
  });

  it('keeps customer_not_verified as 403 when no ceremony token is in session', async () => {
    const req = { session: { support: { customerUsername: 'demoUser' }, save: (cb) => cb && cb() } };
    await expect(svc.exchangeForWrite(req, { scope: 'write', actorClientId: 'c' }))
      .rejects.toMatchObject({ status: 403, code: 'customer_not_verified' });
    expect(oauthService.performTokenExchangeWithActor).not.toHaveBeenCalled();
  });
});

describe('buildExchangeEvents', () => {
  let svc;
  beforeEach(() => {
    jest.isolateModules(() => { svc = require('../services/supportDelegationService'); });
  });

  it('carries the real act claim and no token values', () => {
    const events = svc.buildExchangeEvents({
      delegatedClaims: { sub: '1583af47', act: { sub: 'admin-cid' }, scope: 'write', aud: 'enduser.ping.demo', jti: 'j-1' },
      request: { audience: 'enduser.ping.demo', scope: 'write', hasActor: true },
    });
    const s = JSON.stringify(events);
    expect(s).toContain('admin-cid');
    expect(s).toContain('RFC 8693');
    expect(s).not.toContain('jwt.value');
  });
});
