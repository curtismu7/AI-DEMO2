'use strict';

const {
  loadHostedAccessPolicy,
  evaluateHostedIdentity,
  coherentHostedIdentityClaims,
  stampHostedAccessApproval,
  hasCurrentHostedAccessApproval,
  clearHostedAccessApproval,
} = require('../../services/hostedAccessPolicy');

describe('hostedAccessPolicy', () => {
  const enabledEnv = {
    HOSTED_ACCESS_GATE_ENABLED: 'true',
    HOSTED_ACCESS_ALLOWED_DOMAINS: 'pingidentity.com,pingone.com',
    HOSTED_ACCESS_REQUIRE_VERIFIED_EMAIL: 'true',
  };

  test('is disabled by default', () => {
    expect(loadHostedAccessPolicy({})).toMatchObject({ enabled: false, domains: [] });
  });

  test('rejects enabled policy without domains', () => {
    expect(() => loadHostedAccessPolicy({ HOSTED_ACCESS_GATE_ENABLED: 'true' }))
      .toThrow('HOSTED_ACCESS_ALLOWED_DOMAINS');
  });

  test.each(['@pingidentity.com', 'https://pingidentity.com', '*.pingidentity.com', 'pingidentity.com:443'])
  ('rejects invalid domain entry %s', (entry) => {
    expect(() => loadHostedAccessPolicy({
      HOSTED_ACCESS_GATE_ENABLED: 'true',
      HOSTED_ACCESS_ALLOWED_DOMAINS: entry,
    })).toThrow('Invalid hosted access domain');
  });

  test('accepts and normalizes an exact verified Ping domain', () => {
    const policy = loadHostedAccessPolicy(enabledEnv);
    expect(evaluateHostedIdentity({
      sub: 'user-1',
      email: 'Person@PingIdentity.com',
      email_verified: true,
    }, policy)).toEqual({
      allowed: true,
      reason: 'allowed',
      subject: 'user-1',
      email: 'Person@pingidentity.com',
      domain: 'pingidentity.com',
    });
  });

  test('never combines an email with another claim set verification bit', () => {
    expect(coherentHostedIdentityClaims(
      { sub: 'user-1', email: 'old@pingone.com', email_verified: true },
      { sub: 'user-1', email: 'new@pingidentity.com' },
    )).toEqual({ sub: null, email: null, email_verified: false });
    expect(coherentHostedIdentityClaims(
      { sub: 'user-1', email: 'person@pingone.com', email_verified: true },
      { sub: 'user-2', email: 'person@pingone.com', email_verified: true },
    )).toEqual({ sub: null, email: null, email_verified: false });
  });

  test('can require membership in the approved hosted-access group', () => {
    const policy = loadHostedAccessPolicy({
      ...enabledEnv,
      HOSTED_ACCESS_REQUIRED_GROUP_ID: 'group-hosted-users',
    });
    expect(evaluateHostedIdentity({
      sub: 'user-1', email: 'person@pingidentity.com', email_verified: true, groups: [],
    }, policy)).toMatchObject({ allowed: false, reason: 'group_not_allowed' });
    expect(evaluateHostedIdentity({
      sub: 'user-1', email: 'person@pingidentity.com', email_verified: true, groups: ['group-hosted-users'],
    }, policy)).toMatchObject({ allowed: true });
  });

  test.each([
    ['person@evilpingidentity.com', 'domain_not_allowed'],
    ['person@pingidentity.com.example.org', 'domain_not_allowed'],
    ['person@sub.pingone.com', 'domain_not_allowed'],
    ['person@pingidentity.com.', 'email_malformed'],
    ['person@pіngidentity.com', 'email_malformed'],
    ['person@@pingidentity.com', 'email_malformed'],
    ['', 'email_missing'],
  ])('rejects %s with %s', (email, reason) => {
    const result = evaluateHostedIdentity({ sub: 'user-1', email, email_verified: true }, loadHostedAccessPolicy(enabledEnv));
    expect(result).toMatchObject({ allowed: false, reason });
  });

  test.each([false, 'true', undefined, null])('requires boolean true email_verified (%p)', (emailVerified) => {
    const result = evaluateHostedIdentity({
      sub: 'user-1',
      email: 'person@pingone.com',
      email_verified: emailVerified,
    }, loadHostedAccessPolicy(enabledEnv));
    expect(result).toMatchObject({ allowed: false, reason: 'email_unverified' });
  });

  test('fingerprint is stable across domain order and invalidates changed policy', () => {
    const first = loadHostedAccessPolicy(enabledEnv);
    const reordered = loadHostedAccessPolicy({
      ...enabledEnv,
      HOSTED_ACCESS_ALLOWED_DOMAINS: 'PINGONE.COM, pingidentity.com',
    });
    const changed = loadHostedAccessPolicy({
      ...enabledEnv,
      HOSTED_ACCESS_ALLOWED_DOMAINS: 'pingidentity.com',
    });
    expect(first.fingerprint).toBe(reordered.fingerprint);
    expect(first.fingerprint).not.toBe(changed.fingerprint);
  });

  test('stamps, validates, invalidates, and clears a session approval', () => {
    const policy = loadHostedAccessPolicy(enabledEnv);
    const decision = evaluateHostedIdentity({
      sub: 'user-1', email: 'person@pingone.com', email_verified: true,
    }, policy);
    const session = { user: { oauthId: 'user-1' } };

    stampHostedAccessApproval(session, decision, policy, 1234);
    expect(session.hostedAccessApproval).toEqual({
      version: 1,
      subject: 'user-1',
      email: 'person@pingone.com',
      domain: 'pingone.com',
      approvedAt: 1234,
      policyFingerprint: policy.fingerprint,
    });
    expect(hasCurrentHostedAccessApproval(session, policy)).toBe(true);
    session.user.oauthId = 'user-2';
    expect(hasCurrentHostedAccessApproval(session, policy)).toBe(false);
    session.user.oauthId = 'user-1';
    expect(hasCurrentHostedAccessApproval(session, loadHostedAccessPolicy({
      ...enabledEnv,
      HOSTED_ACCESS_ALLOWED_DOMAINS: 'pingidentity.com',
    }))).toBe(false);
    clearHostedAccessApproval(session);
    expect(session.hostedAccessApproval).toBeUndefined();
  });
});
