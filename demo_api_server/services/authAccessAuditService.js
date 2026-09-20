'use strict';

const crypto = require('crypto');
const appEventService = require('./appEventService');

const OUTCOMES = Object.freeze(['started', 'success', 'denied', 'failure']);
const REASON_CODES = Object.freeze([
  'allowed',
  'domain_not_allowed',
  'email_unverified',
  'email_missing',
  'email_malformed',
  'subject_missing',
  'oauth_provider_error',
  'invalid_state',
  'authorization_code_missing',
  'nonce_mismatch',
  'nonce_missing',
  'token_exchange_failed',
  'userinfo_failed',
  'session_regenerate_failed',
  'session_persist_failed',
  'callback_failed',
]);

function hashSessionId(sessionId) {
  if (!sessionId) return null;
  return crypto.createHash('sha256').update(String(sessionId)).digest('hex').slice(0, 16);
}

function sourceIp(req) {
  const forwarded = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req?.ip || req?.socket?.remoteAddress || null;
}

function baseMetadata(req, audit) {
  const sessionId = req?.hostedAudit ? req?.hostedSession?.id : req?.sessionID;
  return {
    eventType: 'hosted_login',
    loginType: audit.loginType,
    sourceIp: sourceIp(req),
    userAgent: String(req?.headers?.['user-agent'] || '').slice(0, 256) || null,
    correlationId: audit.correlationId || req?.correlationId || req?.id || null,
    sessionHash: hashSessionId(sessionId),
  };
}

function auditSession(req) {
  return req?.hostedAudit ? req?.hostedSession : req?.session;
}

function startLoginAudit(req, loginType, now = Date.now(), auditKey = null) {
  if (!['user', 'admin', 'frontdoor'].includes(loginType)) throw new Error('Invalid hosted login type');
  const audit = {
    loginType,
    startedAt: now,
    correlationId: req?.correlationId || req?.id || crypto.randomUUID(),
    auditKey: auditKey || null,
    terminal: false,
  };
  const session = auditSession(req);
  if (session) {
    session.hostedLoginAudit = audit;
    if (auditKey) {
      session.hostedLoginAudits = session.hostedLoginAudits || Object.create(null);
      session.hostedLoginAudits[auditKey] = audit;
    }
  }
  appEventService.logEvent('auth_lifecycle', 'info', 'Hosted login started', {
    tag: 'hosted-access/login/attempt',
    correlationId: audit.correlationId,
    metadata: {
      ...baseMetadata(req, audit),
      phase: 'attempt',
      outcome: 'started',
      reasonCode: null,
    },
  });
  return audit;
}

function resumeLoginAudit(req, auditKey, loginType) {
  const validKey = typeof auditKey === 'string' && /^[a-f0-9]{64}$/.test(auditKey);
  const session = auditSession(req);
  const audits = session?.hostedLoginAudits;
  const audit = validKey && audits && Object.prototype.hasOwnProperty.call(audits, auditKey)
    ? audits[auditKey]
    : null;
  if (audit && !audit.terminal) {
    session.hostedLoginAudit = audit;
    return audit;
  }
  return startLoginAudit(req, loginType, Date.now(), validKey ? auditKey : null);
}

function finishLoginAudit(req, { outcome, reasonCode, identity = {} }, now = Date.now()) {
  if (!OUTCOMES.includes(outcome) || outcome === 'started') throw new Error('Invalid hosted login outcome');
  if (!REASON_CODES.includes(reasonCode)) throw new Error('Invalid hosted login reason code');
  const audit = auditSession(req)?.hostedLoginAudit;
  if (!audit || audit.terminal) return false;
  audit.terminal = true;
  const severity = outcome === 'success' ? 'info' : outcome === 'denied' ? 'warning' : 'error';
  const message = outcome === 'success'
    ? 'Hosted login succeeded'
    : outcome === 'denied'
      ? 'Hosted login denied'
      : 'Hosted login failed';
  appEventService.logEvent('auth_lifecycle', severity, message, {
    tag: `hosted-access/login/${outcome}`,
    correlationId: audit.correlationId || null,
    metadata: {
      ...baseMetadata(req, audit),
      phase: 'terminal',
      outcome,
      reasonCode,
      subjectId: identity.subject || null,
      email: identity.email || null,
      domain: identity.domain || null,
      durationMs: Math.max(0, now - audit.startedAt),
    },
  });
  return true;
}

module.exports = {
  startLoginAudit,
  resumeLoginAudit,
  finishLoginAudit,
  hashSessionId,
  OUTCOMES,
  REASON_CODES,
};
