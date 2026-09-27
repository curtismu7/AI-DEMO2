'use strict';

const {
  HARD_DEADLINE_MS,
  TARGET_WARNING_MS,
  createReadinessReport,
  recordCheck,
  redactReadinessValue,
  remainingBudget,
} = require('../services/demoReadinessReport');

const STARTED_AT = 1_000_000;
const DEADLINE_AT = STARTED_AT + HARD_DEADLINE_MS;

function makeReport() {
  return createReadinessReport({
    runId: 'run-1',
    commit: 'abc123',
    targets: ['local'],
    startedAt: STARTED_AT,
    deadlineAt: DEADLINE_AT,
  });
}

describe('demo readiness report', () => {
  test('creates a stable empty report with the exact hard deadline and target warning', () => {
    const report = makeReport();

    expect(HARD_DEADLINE_MS).toBe(900_000);
    expect(TARGET_WARNING_MS).toBe(720_000);
    expect(report).toMatchObject({
      runId: 'run-1',
      commit: 'abc123',
      targets: ['local'],
      startedAt: STARTED_AT,
      deadlineAt: DEADLINE_AT,
      status: 'running',
      ready: false,
      elapsedMs: 0,
      targetWarning: false,
      inventory: { total: 0, pass: 0, fail: 0, blocked: 0, 'not-run': 0 },
      checks: [],
      repairs: [],
      unfinished: [],
    });
  });

  test.each(['pass', 'fail', 'blocked', 'not-run'])('records the %s status and stable counts', (status) => {
    const report = makeReport();

    recordCheck(report, { id: `check-${status}`, target: 'local', status, expected: 'works', observed: 'result' });

    expect(report.checks).toHaveLength(1);
    expect(report.checks[0]).toMatchObject({ id: `check-${status}`, status, required: true });
    expect(report.inventory).toEqual({
      total: 1,
      pass: status === 'pass' ? 1 : 0,
      fail: status === 'fail' ? 1 : 0,
      blocked: status === 'blocked' ? 1 : 0,
      'not-run': status === 'not-run' ? 1 : 0,
    });
  });

  test('rejects a check status outside the report contract', () => {
    expect(() => recordCheck(makeReport(), { id: 'bad', status: 'queued' })).toThrow(/invalid readiness check status/i);
  });

  test('is ready only when every required row passes', () => {
    const report = makeReport();
    recordCheck(report, { id: 'required-pass', status: 'pass' });
    recordCheck(report, { id: 'optional-failure', status: 'fail', required: false });

    expect(report.ready).toBe(true);
    expect(report.status).toBe('ready');

    recordCheck(report, { id: 'required-blocked', status: 'blocked' });
    expect(report.ready).toBe(false);
    expect(report.status).toBe('not-ready');
  });

  test.each(['fail', 'blocked', 'not-run'])('a required %s row keeps the report not ready', (status) => {
    const report = makeReport();
    recordCheck(report, { id: `required-${status}`, status });

    expect(report.ready).toBe(false);
    expect(report.status).toBe('not-ready');
  });

  test('redacts nested bearer, JWT, password, cookie, authorization, and session values before serialization', () => {
    const bearer = 'Bearer raw-bearer-token';
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhbGljZSJ9.c2lnbmF0dXJl';
    const password = 'open-sesame';
    const cookie = 'sid=raw-cookie-value';
    const authorization = 'Basic raw-auth-value';
    const session = 'sess_1234567890abcdef';
    const value = {
      evidence: {
        request: { authorization: bearer, cookie },
        nested: [{ password, jwt, sessionId: session }],
        response: { headers: { 'set-cookie': cookie }, authorization },
      },
    };

    const redacted = redactReadinessValue(value);
    const serialized = JSON.stringify(redacted);

    for (const secret of [bearer, jwt, password, cookie, authorization, session]) {
      expect(serialized).not.toContain(secret);
    }
    expect(redacted.evidence.nested[0].jwt).toBe('[REDACTED_JWT]');
    expect(redacted.evidence.nested[0].sessionId).toBe('[REDACTED]');
  });

  test('redacts check evidence as it is recorded', () => {
    const report = makeReport();
    recordCheck(report, {
      id: 'safe-evidence',
      status: 'pass',
      evidence: { sessionId: 'session-secret', observed: 'Bearer secret-value' },
    });

    expect(JSON.stringify(report)).not.toContain('session-secret');
    expect(JSON.stringify(report)).not.toContain('secret-value');
  });

  test('redacts nested secret fixtures inserted into repairs and unfinished rows before report serialization', () => {
    const report = makeReport();
    const bearer = 'Bearer repair-bearer-token';
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJyZXBhaXIifQ.c2lnbmF0dXJl';
    const password = 'repair-password';
    const cookie = 'sid=repair-cookie';
    const authorization = 'Basic repair-authorization';
    const session = 'repair-session-id';

    report.repairs.push({
      before: { authorization, nested: [{ password, jwt }] },
      after: { cookie, sessionId: session },
    });
    report.unfinished.push({
      id: 'queued-secret-row',
      status: 'queued',
      evidence: { bearer, headers: { authorization, cookie }, sessionId: session },
    });

    const serialized = JSON.stringify(report);
    for (const secret of [bearer, jwt, password, cookie, authorization, session]) {
      expect(serialized).not.toContain(secret);
    }
  });

  test('redacts direct nested repair mutations before callers can read them', () => {
    const report = makeReport();
    report.repairs.push({ before: {} });

    report.repairs[0].before.authorization = 'Bearer direct-read-secret';
    report.repairs[0].before.sessionId = 'direct-read-session';

    expect(report.repairs[0].before.authorization).toBe('[REDACTED]');
    expect(report.repairs[0].before.sessionId).toBe('[REDACTED]');
  });

  test('updates elapsed time and target warning without expiring before the exact deadline', () => {
    const report = makeReport();

    expect(remainingBudget(report, STARTED_AT + TARGET_WARNING_MS)).toBe(HARD_DEADLINE_MS - TARGET_WARNING_MS);
    expect(report.elapsedMs).toBe(TARGET_WARNING_MS);
    expect(report.targetWarning).toBe(true);
    expect(report.status).toBe('running');

    expect(remainingBudget(report, DEADLINE_AT - 1)).toBe(1);
    expect(report.status).toBe('running');
  });

  test('expires queued and active rows at the hard deadline', () => {
    const report = makeReport();
    report.unfinished.push(
      { id: 'queued-row', status: 'queued', evidence: { sessionId: 'queued-session-secret' } },
      { id: 'active-row', status: 'active' },
    );

    expect(remainingBudget(report, DEADLINE_AT)).toBe(0);
    expect(report.elapsedMs).toBe(HARD_DEADLINE_MS);
    expect(report.status).toBe('deadline_exceeded');
    expect(report.unfinished).toEqual([
      {
        id: 'queued-row',
        status: 'not-run',
        reason: 'deadline_exceeded',
        evidence: { sessionId: '[REDACTED]' },
      },
      { id: 'active-row', status: 'blocked', reason: 'deadline_exceeded' },
    ]);
    expect(JSON.stringify(report)).not.toContain('queued-session-secret');
  });

  test('keeps deadline expiry terminal when later checks pass', () => {
    const report = makeReport();
    remainingBudget(report, DEADLINE_AT);

    recordCheck(report, { id: 'late-pass', status: 'pass' });

    expect(report.ready).toBe(false);
    expect(report.status).toBe('deadline_exceeded');
  });
});
