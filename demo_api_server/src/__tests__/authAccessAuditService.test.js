'use strict';

jest.mock('../../services/appEventService', () => ({ logEvent: jest.fn() }));

const appEventService = require('../../services/appEventService');
const {
  startLoginAudit,
  resumeLoginAudit,
  finishLoginAudit,
  hashSessionId,
  OUTCOMES,
  REASON_CODES,
} = require('../../services/authAccessAuditService');

function request(overrides = {}) {
  return {
    sessionID: 'raw-session-secret',
    session: {},
    ip: '10.0.0.4',
    headers: {
      'user-agent': 'Mozilla/5.0 test',
      'x-forwarded-for': '203.0.113.9, 10.0.0.4',
    },
    correlationId: 'corr-1',
    ...overrides,
  };
}

describe('authAccessAuditService', () => {
  beforeEach(() => jest.clearAllMocks());

  test('records a closed-shape login attempt without secrets', () => {
    const req = request();
    startLoginAudit(req, 'user', 1000);

    expect(req.session.hostedLoginAudit).toEqual(expect.objectContaining({
      loginType: 'user', startedAt: 1000, terminal: false,
    }));
    expect(appEventService.logEvent).toHaveBeenCalledWith(
      'auth_lifecycle', 'info', 'Hosted login started',
      expect.objectContaining({
        tag: 'hosted-access/login/attempt',
        metadata: expect.objectContaining({
          eventType: 'hosted_login', phase: 'attempt', outcome: 'started',
          sourceIp: '203.0.113.9', correlationId: 'corr-1',
          sessionHash: hashSessionId('raw-session-secret'),
        }),
      }),
    );
    expect(JSON.stringify(appEventService.logEvent.mock.calls[0])).not.toContain('raw-session-secret');
  });

  test('records one terminal success with identity and duration', () => {
    const req = request();
    startLoginAudit(req, 'admin', 1000);
    jest.clearAllMocks();

    expect(finishLoginAudit(req, {
      outcome: 'success', reasonCode: 'allowed',
      identity: { subject: 'sub-1', email: 'Person@pingone.com', domain: 'pingone.com' },
    }, 1350)).toBe(true);
    expect(finishLoginAudit(req, {
      outcome: 'failure', reasonCode: 'session_persist_failed',
    }, 1400)).toBe(false);

    expect(appEventService.logEvent).toHaveBeenCalledTimes(1);
    expect(appEventService.logEvent).toHaveBeenCalledWith(
      'auth_lifecycle', 'info', 'Hosted login succeeded',
      expect.objectContaining({
        tag: 'hosted-access/login/success',
        metadata: expect.objectContaining({
          phase: 'terminal', outcome: 'success', reasonCode: 'allowed',
          loginType: 'admin', subjectId: 'sub-1', durationMs: 350,
        }),
      }),
    );
  });

  test('keeps concurrent state-bound attempts distinct and correlated', () => {
    const req = request();
    const stateA = 'a'.repeat(64);
    const stateB = 'b'.repeat(64);
    startLoginAudit(req, 'user', 1000, stateA);
    req.correlationId = 'corr-2';
    startLoginAudit(req, 'user', 1010, stateB);
    resumeLoginAudit(req, stateA, 'user');
    expect(req.session.hostedLoginAudit.auditKey).toBe(stateA);
    finishLoginAudit(req, { outcome: 'failure', reasonCode: 'invalid_state' }, 1020);
    expect(req.session.hostedLoginAudits[stateA].terminal).toBe(true);
    expect(req.session.hostedLoginAudits[stateB].terminal).toBe(false);
    expect(appEventService.logEvent.mock.calls.at(-1)[3].correlationId).toBe('corr-1');
  });

  test('does not resolve inherited or malformed state keys', () => {
    const req = request();
    startLoginAudit(req, 'user', 1000, 'state-a');
    resumeLoginAudit(req, '__proto__', 'user');
    expect(req.session.hostedLoginAudit.auditKey).toBeNull();
    expect(Object.prototype.terminal).toBeUndefined();
  });

  test.each([
    ['denied', 'domain_not_allowed', 'warning', 'Hosted login denied'],
    ['failure', 'nonce_mismatch', 'error', 'Hosted login failed'],
  ])('records %s with stable severity and message', (outcome, reasonCode, severity, message) => {
    const req = request();
    startLoginAudit(req, 'user', 1000);
    jest.clearAllMocks();
    finishLoginAudit(req, { outcome, reasonCode }, 1001);
    expect(appEventService.logEvent).toHaveBeenCalledWith(
      'auth_lifecycle', severity, message, expect.any(Object),
    );
  });

  test('rejects open-ended outcomes and reason codes', () => {
    const req = request();
    startLoginAudit(req, 'user');
    expect(() => finishLoginAudit(req, { outcome: 'maybe', reasonCode: 'allowed' })).toThrow('Invalid hosted login outcome');
    expect(() => finishLoginAudit(req, { outcome: 'failure', reasonCode: 'raw upstream error' })).toThrow('Invalid hosted login reason code');
    expect(OUTCOMES).toEqual(expect.arrayContaining(['started', 'success', 'denied', 'failure']));
    expect(REASON_CODES).toContain('token_exchange_failed');
  });

  test('never copies request query, body, cookies, or authorization headers', () => {
    const req = request({
      query: { code: 'authorization-secret' },
      body: { refresh_token: 'refresh-secret' },
      headers: {
        authorization: 'Bearer access-secret',
        cookie: 'sid=cookie-secret',
        'user-agent': 'agent',
      },
    });
    startLoginAudit(req, 'user');
    finishLoginAudit(req, { outcome: 'failure', reasonCode: 'oauth_provider_error' });
    const serialized = JSON.stringify(appEventService.logEvent.mock.calls);
    for (const secret of ['authorization-secret', 'refresh-secret', 'access-secret', 'cookie-secret']) {
      expect(serialized).not.toContain(secret);
    }
  });
});
