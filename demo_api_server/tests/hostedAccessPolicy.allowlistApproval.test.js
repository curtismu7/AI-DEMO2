'use strict';

// Regression: an allowlisted demo identifier whose email domain is NOT in
// HOSTED_ACCESS_ALLOWED_DOMAINS (demoAdmin@api.ping.demo vs the pingidentity/
// pingone domain list) could complete the wall login — evaluateHostedIdentity
// exempts allowlisted identifiers from the domain rule — but the approval it
// stamped failed hasCurrentHostedAccessApproval's own domain re-check. The
// wall then 401'd every subsequent request and bounced the browser back to
// PingOne forever (observed live on SE 2026-10-12, invalid_state-free loop:
// callback 302 success -> /check 401 -> /login 302 -> ...).
//
// The approval check must honour the same allowlist exemption the decision
// path grants: an approval stamped for an allowlisted identifier validates on
// its identifier, not its domain.

const {
  loadHostedAccessPolicy,
  evaluateHostedIdentity,
  stampHostedAccessApproval,
  hasCurrentHostedAccessApproval,
} = require('../services/hostedAccessPolicy');

const ENV = {
  HOSTED_ACCESS_GATE_ENABLED: 'true',
  HOSTED_ACCESS_ALLOWED_DOMAINS: 'pingidentity.com,pingone.com',
  HOSTED_ACCESS_ALLOWED_IDENTIFIERS: 'demouser,demoadmin,demoAdmin@api.ping.demo',
  HOSTED_ACCESS_REQUIRE_VERIFIED_EMAIL: 'true',
};

describe('hosted access approval honours the identifier allowlist exemption', () => {
  test('allowlisted identifier with off-list domain: evaluate allows, approval validates', () => {
    const policy = loadHostedAccessPolicy(ENV);
    const claims = {
      sub: 'subject-1',
      email: 'demoAdmin@api.ping.demo',
      email_verified: true,
      preferred_username: 'demoadmin',
    };

    const decision = evaluateHostedIdentity(claims, policy);
    expect(decision.allowed).toBe(true);

    const session = {};
    stampHostedAccessApproval(session, decision, policy);
    session.hostedAccessIdentity = { subject: decision.subject };

    expect(hasCurrentHostedAccessApproval(session, policy)).toBe(true);
  });

  test('non-allowlisted identity with off-list domain still fails at evaluate', () => {
    const policy = loadHostedAccessPolicy(ENV);
    const decision = evaluateHostedIdentity({
      sub: 'subject-2',
      email: 'attacker@evil.example',
      email_verified: true,
    }, policy);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('domain_not_allowed');
  });

  test('same-subject mismatch still fails the approval check', () => {
    const policy = loadHostedAccessPolicy(ENV);
    const decision = evaluateHostedIdentity({
      sub: 'subject-1',
      email: 'demoAdmin@api.ping.demo',
      email_verified: true,
      preferred_username: 'demoadmin',
    }, policy);
    const session = {};
    stampHostedAccessApproval(session, decision, policy);
    session.hostedAccessIdentity = { subject: 'someone-else' };
    expect(hasCurrentHostedAccessApproval(session, policy)).toBe(false);
  });

  test('policy fingerprint rotation still invalidates old approvals', () => {
    const before = loadHostedAccessPolicy(ENV);
    const decision = evaluateHostedIdentity({
      sub: 'subject-1',
      email: 'demoAdmin@api.ping.demo',
      email_verified: true,
      preferred_username: 'demoadmin',
    }, before);
    const session = {};
    stampHostedAccessApproval(session, decision, before);
    session.hostedAccessIdentity = { subject: decision.subject };

    const after = loadHostedAccessPolicy({
      ...ENV,
      HOSTED_ACCESS_ALLOWED_IDENTIFIERS: 'demouser,demoAdmin@api.ping.demo',
    });
    expect(hasCurrentHostedAccessApproval(session, after)).toBe(false);
  });

  test('username-allowlisted account passes via the stored username even with an off-list email', () => {
    // demoUser signs in by username; PingOne asserts an email whose local part
    // need not match the allowlist. The approval carries the username, so the
    // validate path can still match it.
    const policy = loadHostedAccessPolicy(ENV);
    const claims = {
      sub: 'subject-3',
      email: 'some.other.mailbox@api.ping.demo',
      email_verified: true,
      preferred_username: 'demouser',
    };
    const decision = evaluateHostedIdentity(claims, policy);
    expect(decision.allowed).toBe(true);

    const session = {};
    stampHostedAccessApproval(session, decision, policy);
    session.hostedAccessIdentity = { subject: decision.subject };
    expect(hasCurrentHostedAccessApproval(session, policy)).toBe(true);
  });
});
