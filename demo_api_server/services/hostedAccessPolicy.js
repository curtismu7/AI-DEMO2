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

function policyFingerprint(policy) {
  const canonical = JSON.stringify({
    enabled: policy.enabled,
    requireVerifiedEmail: policy.requireVerifiedEmail,
    requiredGroupId: policy.requiredGroupId || '',
    domains: policy.domains,
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
  if (enabled && domains.length === 0) {
    throw new Error('HOSTED_ACCESS_ALLOWED_DOMAINS is required when hosted access is enabled');
  }
  const policy = { enabled, domains, requireVerifiedEmail, requiredGroupId };
  return {
    ...policy,
    domainSet: new Set(domains),
    fingerprint: policyFingerprint(policy),
  };
}

function denied(reason, fields = {}) {
  return { allowed: false, reason, subject: fields.subject || null, email: fields.email || null, domain: fields.domain || null };
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
  if (!policy.domainSet.has(domain)) return denied('domain_not_allowed', { subject, email, domain });
  if (policy.requiredGroupId) {
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
    return { sub: null, email: null, email_verified: false };
  }
  const source = uiEmail ? userInfo : idTokenClaims;
  return {
    sub: uiSub || idSub,
    email: source.email,
    email_verified: source.email_verified,
    groups: Array.isArray(userInfo.groups) ? userInfo.groups : Array.isArray(idTokenClaims.groups) ? idTokenClaims.groups : [],
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
  stampHostedAccessApproval,
  hasCurrentHostedAccessApproval,
  clearHostedAccessApproval,
};
