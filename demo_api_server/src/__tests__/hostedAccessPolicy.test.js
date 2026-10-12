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
    )).toEqual({ sub: null, email: null, email_verified: false, groups: [], preferred_username: null, username: null });
    expect(coherentHostedIdentityClaims(
      { sub: 'user-1', email: 'person@pingone.com', email_verified: true },
      { sub: 'user-2', email: 'person@pingone.com', email_verified: true },
    )).toEqual({ sub: null, email: null, email_verified: false, groups: [], preferred_username: null, username: null });
  });

  test('keeps preferred_username through the coherence pass (allowlist needs it)', () => {
    // demoAdmin's email (@api.ping.demo) can never pass the domain rule — the
    // allowlist matches on preferred_username, which PingOne reports on the
    // id_token/userinfo. If the coherence pass stripped it, demoAdmin would
    // be locked out (observed live 2026-10-12).
    const coherent = coherentHostedIdentityClaims(
      { sub: 'admin-1', email: 'demoAdmin@api.ping.demo', email_verified: true, preferred_username: 'demoAdmin' },
      { sub: 'admin-1', email: 'demoAdmin@api.ping.demo', email_verified: true, preferred_username: 'demoAdmin' },
    );
    expect(coherent.preferred_username).toBe('demoAdmin');
    const policy = loadHostedAccessPolicy({
      ...enabledEnv,
      HOSTED_ACCESS_ALLOWED_IDENTIFIERS: 'demoAdmin',
    });
    expect(evaluateHostedIdentity(coherent, policy)).toMatchObject({ allowed: true });
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

  // Plus-addressing: the demo must never admit cmuir+x@pingone.com-style
  // aliases, but the presenter's own test accounts sign in AS a + address —
  // so the allowlist (HOSTED_ACCESS_ALLOWED_IDENTIFIERS) exempts exact
  // identifiers from the + rule only; domain + group checks still apply.
  test('rejects plus-addressed emails with email_plus_addressed', () => {
    const result = evaluateHostedIdentity({
      sub: 'user-1', email: 'cmuir+demo@pingone.com', email_verified: true,
    }, loadHostedAccessPolicy(enabledEnv));
    expect(result).toMatchObject({ allowed: false, reason: 'email_plus_addressed' });
  });

  test('allowlisted identifier may use a plus address (demo exemption)', () => {
    const policy = loadHostedAccessPolicy({
      ...enabledEnv,
      HOSTED_ACCESS_ALLOWED_IDENTIFIERS: 'DemoUser, cmuir+demo-user@pingone.com',
    });
    // The + address itself is the allowlisted identifier.
    expect(evaluateHostedIdentity({
      sub: 'user-1', email: 'cmuir+demo-user@pingone.com', email_verified: true,
    }, policy)).toMatchObject({ allowed: true });
    // A DIFFERENT + address is still rejected — the allowlist is exact.
    expect(evaluateHostedIdentity({
      sub: 'user-2', email: 'attacker+1@pingone.com', email_verified: true,
    }, policy)).toMatchObject({ allowed: false, reason: 'email_plus_addressed' });
  });

  test('allowlist matches preferred_username, not just email', () => {
    const policy = loadHostedAccessPolicy({
      ...enabledEnv,
      HOSTED_ACCESS_ALLOWED_IDENTIFIERS: 'demoUser',
    });
    // PingOne may report username demoUser with a + email — the username alone exempts it.
    expect(evaluateHostedIdentity({
      sub: 'user-1', email: 'cmuir+demo-user@pingone.com', email_verified: true,
      preferred_username: 'demoUser',
    }, policy)).toMatchObject({ allowed: true });
  });

  test('allowlisted accounts skip the group requirement (hosted app may not emit groups)', () => {
    // The hosted app requests openid profile email — no group scope — so
    // claims.groups can be absent for everyone. That must not lock out the
    // allowlisted demo accounts (observed live 2026-10-12: demoAdmin denied
    // group_not_allowed after the domain fix). Real employees still need
    // the group.
    const policy = loadHostedAccessPolicy({
      ...enabledEnv,
      HOSTED_ACCESS_ALLOWED_IDENTIFIERS: 'demoUser',
      HOSTED_ACCESS_REQUIRED_GROUP_ID: 'group-hosted-users',
    });
    // Allowlisted: in WITHOUT the group.
    expect(evaluateHostedIdentity({
      sub: 'user-1', email: 'someone+1@pingone.com', email_verified: true,
      preferred_username: 'demoUser', groups: [],
    }, policy)).toMatchObject({ allowed: true });
    // Non-allowlisted, same group-less claims: denied.
    expect(evaluateHostedIdentity({
      sub: 'user-2', email: 'person@pingidentity.com', email_verified: true,
      groups: [],
    }, policy)).toMatchObject({ allowed: false, reason: 'group_not_allowed' });
  });

  test('allowlisted demo account may carry a non-Ping email (demoAdmin@api.ping.demo)', () => {
    // demoAdmin's PingOne account is provisioned with an @api.ping.demo
    // address — it can never pass the domain rule. The exact-match allowlist
    // is the exemption: only PingOne can assert that username, so the
    // bypass cannot be reached by an attacker-chosen identifier.
    const policy = loadHostedAccessPolicy({
      ...enabledEnv,
      HOSTED_ACCESS_ALLOWED_IDENTIFIERS: 'demoAdmin',
    });
    expect(evaluateHostedIdentity({
      sub: 'user-2', email: 'demoAdmin@api.ping.demo', email_verified: true,
      preferred_username: 'demoAdmin',
    }, policy)).toMatchObject({ allowed: true });
    // A DIFFERENT user cannot ride the exemption by email similarity.
    expect(evaluateHostedIdentity({
      sub: 'user-3', email: 'demoAdmin@api.ping.demo', email_verified: true,
      preferred_username: 'imposter',
    }, policy)).toMatchObject({ allowed: false, reason: 'domain_not_allowed' });
  });

  test('fingerprint changes when the identifier allowlist changes', () => {
    const base = loadHostedAccessPolicy(enabledEnv);
    const withAllowlist = loadHostedAccessPolicy({
      ...enabledEnv,
      HOSTED_ACCESS_ALLOWED_IDENTIFIERS: 'demoUser',
    });
    expect(base.fingerprint).not.toBe(withAllowlist.fingerprint);
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
