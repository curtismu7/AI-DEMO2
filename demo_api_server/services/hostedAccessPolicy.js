'use strict';

const crypto = require('crypto');

const APPROVAL_VERSION = 1;
const DOMAIN_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))+$/;
const EMAIL_PATTERN = /^([\x21-\x3f\x41-\x5a\x5e-\x7e]+)@([A-Za-z0-9.-]+)$/;

function parseBoolean(value, defaultValue = false) {
  if (value == null || value === '') return defaultValue;
  return value === true || String(value).toLowerCase() === 'true';
}

function normalizeDomains(raw) {
  const entries = String(raw || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  for (const entry of entries) {
    if (!DOMAIN_PATTERN.test(entry)) {
      throw new Error(`Invalid hosted access domain: ${entry}`);
    }
  }
  return [...new Set(entries)].sort();
}

// Exact-match identifier allowlist (usernames or emails, case-insensitive).
// Exempts named accounts — the demo presenters' test users — from the
// plus-addressing rule AND the domain rule (demoAdmin is provisioned with
// an @api.ping.demo address that can never pass the domain check). Only
// PingOne can assert these identifiers, so the bypass cannot be reached by
// an attacker-chosen value. The group check still applies to them.
function normalizeIdentifiers(raw) {
  return [...new Set(
    String(raw || '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  )].sort();
}

function policyFingerprint(policy) {
  const canonical = JSON.stringify({
    enabled: policy.enabled,
    requireVerifiedEmail: policy.requireVerifiedEmail,
    requiredGroupId: policy.requiredGroupId || '',
    domains: policy.domains,
    allowedIdentifiers: policy.allowedIdentifiers,
    rejectPlusAddressing: policy.rejectPlusAddressing,
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function loadHostedAccessPolicy(env = process.env) {
  const enabled = parseBoolean(env.HOSTED_ACCESS_GATE_ENABLED, false);
  const domains = normalizeDomains(env.HOSTED_ACCESS_ALLOWED_DOMAINS);
  const requireVerifiedEmail = parseBoolean(
    env.HOSTED_ACCESS_REQUIRE_VERIFIED_EMAIL,
    enabled,
  );
  const requiredGroupId = String(env.HOSTED_ACCESS_REQUIRED_GROUP_ID || '').trim();
  const allowedIdentifiers = normalizeIdentifiers(env.HOSTED_ACCESS_ALLOWED_IDENTIFIERS);
  // On by default when the gate is enabled; the allowlist is the only way
  // through. Set HOSTED_ACCESS_REJECT_PLUS_ADDRESSING=false to accept
  // plus-addressed mail for everyone (not wanted for the public demo).
  const rejectPlusAddressing = parseBoolean(env.HOSTED_ACCESS_REJECT_PLUS_ADDRESSING, enabled);
  if (enabled && domains.length === 0) {
    throw new Error('HOSTED_ACCESS_ALLOWED_DOMAINS is required when hosted access is enabled');
  }
  const policy = {
    enabled, domains, requireVerifiedEmail, requiredGroupId,
    allowedIdentifiers, rejectPlusAddressing,
  };
  return {
    ...policy,
    domainSet: new Set(domains),
    identifierSet: new Set(allowedIdentifiers),
    fingerprint: policyFingerprint(policy),
  };
}

function denied(reason, fields = {}) {
  return { allowed: false, reason, subject: fields.subject || null, email: fields.email || null, domain: fields.domain || null };
}

// The identifier the signer typed / PingOne reports: preferred_username first
// (demoUser signs in by username, not email), then the email itself.
function claimedIdentifiers(claims = {}) {
  const identifiers = [];
  for (const key of ['preferred_username', 'username', 'email']) {
    const value = claims[key];
    if (typeof value === 'string' && value.trim()) identifiers.push(value.trim().toLowerCase());
  }
  return identifiers;
}

function isAllowlistedIdentifier(claims, policy) {
  if (policy.identifierSet.size === 0) return false;
  return claimedIdentifiers(claims).some((id) => policy.identifierSet.has(id));
}

function evaluateHostedIdentity(claims = {}, policy = loadHostedAccessPolicy()) {
  const subject = typeof claims.sub === 'string' && claims.sub.trim() ? claims.sub.trim() : null;
  if (!policy.enabled) {
    return { allowed: true, reason: 'gate_disabled', subject, email: null, domain: null };
  }
  if (typeof claims.email !== 'string' || !claims.email.trim()) return denied('email_missing', { subject });
  if (policy.requireVerifiedEmail && claims.email_verified !== true) {
    return denied('email_unverified', { subject });
  }
  const match = claims.email.trim().match(EMAIL_PATTERN);
  if (!match || !match[1] || !DOMAIN_PATTERN.test(match[2].toLowerCase())) {
    return denied('email_malformed', { subject });
  }
  const domain = match[2].toLowerCase();
  const email = `${match[1]}@${domain}`;
  // Allowlisted demo accounts (exact identifier match on PingOne-asserted
  // claims) skip the + and domain rules; everything else is walled.
  const allowlisted = isAllowlistedIdentifier(claims, policy);
  if (policy.rejectPlusAddressing && match[1].includes('+') && !allowlisted) {
    return denied('email_plus_addressed', { subject, email, domain });
  }
  if (!allowlisted && !policy.domainSet.has(domain)) {
    return denied('domain_not_allowed', { subject, email, domain });
  }
  if (policy.requiredGroupId && !allowlisted) {
    // The group check exists for real employees; the hosted app's claims may
    // not even carry a groups claim (scopes: openid profile email), which
    // would lock out everyone — observed live for demoAdmin after the domain
    // exemption (2026-10-12). Allowlisted demo accounts skip it.
    const groups = Array.isArray(claims.groups) ? claims.groups.map(String) : [];
    if (!groups.includes(policy.requiredGroupId)) return denied('group_not_allowed', { subject, email, domain });
  }
  if (!subject) return denied('subject_missing', { email, domain });
  return { allowed: true, reason: 'allowed', subject, email, domain };
}

function coherentHostedIdentityClaims(idTokenClaims = {}, userInfo = {}) {
  const idSub = typeof idTokenClaims.sub === 'string' ? idTokenClaims.sub : null;
  const uiSub = typeof userInfo.sub === 'string' ? userInfo.sub : null;
  const idEmail = typeof idTokenClaims.email === 'string' ? idTokenClaims.email.trim().toLowerCase() : null;
  const uiEmail = typeof userInfo.email === 'string' ? userInfo.email.trim().toLowerCase() : null;
  if ((idSub && uiSub && idSub !== uiSub) || (idEmail && uiEmail && idEmail !== uiEmail)) {
    return { sub: null, email: null, email_verified: false, groups: [], preferred_username: null, username: null };
  }
  const source = uiEmail ? userInfo : idTokenClaims;
  return {
    sub: uiSub || idSub,
    email: source.email,
    email_verified: source.email_verified,
    groups: Array.isArray(userInfo.groups) ? userInfo.groups : Array.isArray(idTokenClaims.groups) ? idTokenClaims.groups : [],
    // preferred_username must survive the coherence pass — the identifier
    // allowlist (demoUser/demoAdmin) matches on it, and demoAdmin's email
    // alone (@api.ping.demo) can never pass the domain rule.
    preferred_username: source.preferred_username || idTokenClaims.preferred_username || null,
    username: source.username || idTokenClaims.username || null,
  };
}

function stampHostedAccessApproval(session, decision, policy, approvedAt = Date.now()) {
  if (!session || !decision?.allowed || decision.reason !== 'allowed') {
    throw new Error('A successful hosted access decision is required');
  }
  session.hostedAccessApproval = {
    version: APPROVAL_VERSION,
    subject: decision.subject,
    email: decision.email,
    domain: decision.domain,
    approvedAt,
    policyFingerprint: policy.fingerprint,
  };
  return session.hostedAccessApproval;
}

function hasCurrentHostedAccessApproval(session, policy = loadHostedAccessPolicy()) {
  if (!policy.enabled) return true;
  const approval = session?.hostedAccessApproval;
  const subject = session?.hostedAccessIdentity?.subject
    || session?.user?.oauthId
    || session?.user?.sub
    || null;
  return !!(
    approval
    && approval.version === APPROVAL_VERSION
    && approval.subject
    && approval.subject === subject
    && approval.policyFingerprint === policy.fingerprint
    && policy.domainSet.has(approval.domain)
  );
}

function clearHostedAccessApproval(session) {
  if (session) delete session.hostedAccessApproval;
}

module.exports = {
  loadHostedAccessPolicy,
  evaluateHostedIdentity,
  coherentHostedIdentityClaims,
  claimedIdentifiers,
  stampHostedAccessApproval,
  hasCurrentHostedAccessApproval,
  clearHostedAccessApproval,
};
