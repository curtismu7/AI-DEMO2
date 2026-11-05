'use strict';

// End to end with the REAL policy functions (no stubs): the callback evaluates the wall's policy on the app sign-in's
// claims and stamps the approval on the app session; the gate must then open for that session, and ONLY while it is
// still current and its tokens are live. Guards the bug where the second (app) login was needed after the wall login.

const {
  loadHostedAccessPolicy,
  evaluateHostedIdentity,
  coherentHostedIdentityClaims,
  stampHostedAccessApproval,
} = require('../services/hostedAccessPolicy');
const { createHostedAccessGate, hostedAccessCheck } = require('../middleware/hostedAccessGate');

const ENV = {
  HOSTED_ACCESS_GATE_ENABLED: 'true',
  HOSTED_ACCESS_ALLOWED_DOMAINS: 'pingidentity.com,pingone.com',
  HOSTED_ACCESS_ALLOWED_IDENTIFIERS: 'test.user@pingidentity.com,demouser',
  HOSTED_ACCESS_REQUIRE_VERIFIED_EMAIL: 'true',
};
const policy = loadHostedAccessPolicy(ENV);

// What the user callback does: id token + userinfo -> coherent claims -> decision -> stamp on the (regenerated) session.
function appSessionAfterLogin({ sub = 'sub-1', email = 'test.user@pingidentity.com', verified = true, groups = [], extra = {} } = {}) {
  const idToken = { sub, email, email_verified: verified, preferred_username: email, groups };
  const userInfo = { sub, email, email_verified: verified, preferred_username: email, groups };
  const decision = evaluateHostedIdentity(coherentHostedIdentityClaims(idToken, userInfo), policy);
  const session = {
    user: { id: 'u1', username: email, email, oauthId: sub }, // what dataStore.updateUser stores (oauthId = the validated sub)
    oauthType: 'user',
    oauthTokens: { accessToken: 'real', expiresAt: Date.now() + 3_600_000 },
    ...extra,
  };
  if (decision.allowed) stampHostedAccessApproval(session, decision, policy);
  return { session, decision };
}

const gateWith = (session, hostedSession) => {
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, send() { return this; }, set() { return this; } };
  const next = jest.fn();
  createHostedAccessGate({ policy })({ method: 'GET', originalUrl: '/api/accounts/my', headers: {}, session, hostedSession }, res, next);
  return { res, next };
};

describe('the app sign-in alone opens the wall (real policy, no hosted-session login)', () => {
  test('an allowlisted identity signs in once at the app: the gate opens and /check says 204', () => {
    const { session, decision } = appSessionAfterLogin();
    expect(decision.allowed).toBe(true);
    expect(gateWith(session, undefined).next).toHaveBeenCalled();
    const check = hostedAccessCheck({ policy });
    const res = { statusCode: 0, status(c) { this.statusCode = c; return this; }, end() { return this; }, set() { return this; } };
    check({ session, hostedSession: undefined }, res);
    expect(res.statusCode).toBe(204);
  });

  test('an identity the policy denies never gets an approval, so the wall stays shut', () => {
    const { session, decision } = appSessionAfterLogin({ email: 'someone@gmail.com' });
    expect(decision.allowed).toBe(false);
    expect(session.hostedAccessApproval).toBeUndefined();
    const { res, next } = gateWith(session, undefined);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  test('unverified email is denied even with live tokens', () => {
    const { session } = appSessionAfterLogin({ verified: false });
    expect(gateWith(session, undefined).next).not.toHaveBeenCalled();
  });

  test('a stale app session (tokens gone) does not open the wall even though the approval is still there', () => {
    const { session } = appSessionAfterLogin();
    delete session.oauthTokens;
    expect(gateWith(session, undefined).next).not.toHaveBeenCalled();
  });

  test('an approval for a DIFFERENT subject does not open the wall (subject must match the session user)', () => {
    const { session } = appSessionAfterLogin({ sub: 'sub-1' });
    session.user.oauthId = 'someone-else';
    expect(gateWith(session, undefined).next).not.toHaveBeenCalled();
  });

  test('narrowing the policy invalidates an existing approval for a non-allowlisted identity', () => {
    // sam@pingone.com is let in by DOMAIN, not by the allowlist, so removing the domain must lock the session out again.
    const { session, decision } = appSessionAfterLogin({ email: 'sam@pingone.com', sub: 'sub-9' });
    expect(decision.allowed).toBe(true);
    expect(gateWith(session, undefined).next).toHaveBeenCalled();
    const stricter = loadHostedAccessPolicy({ ...ENV, HOSTED_ACCESS_ALLOWED_DOMAINS: 'pingidentity.com' });
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, send() { return this; }, set() { return this; } };
    const next = jest.fn();
    createHostedAccessGate({ policy: stricter })({ method: 'GET', originalUrl: '/api/x', headers: {}, session }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });
});
