import { describe, it, expect } from 'vitest';
import { GATE_COPY, LESSONS, badgeLabel, gateStatus, gateResult, explainRun, effectiveGates } from '../studioLearn';

const gates = (a, b, c) => [{ id: 'mfa', status: a }, { id: 'gw', status: b }, { id: 'authz', status: c }];

describe('studioLearn', () => {
  it('has the three real gates in order and three lessons with real airline prompts', () => {
    expect(GATE_COPY.map((g) => g.id)).toEqual(['mfa', 'gw', 'authz']);
    expect(LESSONS.map((l) => l.prompt)).toEqual(['What is my loyalty status?', 'access my sensitive airline bookings', 'pay a $2500 change fee']);
  });

  it('labels badges and shows a pending step-up as Held on the Authorize gate only', () => {
    expect(badgeLabel('permit')).toBe('Pass');
    expect(badgeLabel('nonsense')).toBe('Waiting');
    expect(gateStatus({ id: 'authz', status: 'checking' }, 'held')).toBe('held');
    expect(gateStatus({ id: 'gw', status: 'checking' }, 'held')).toBe('checking');
    expect(gateStatus({ id: 'authz', status: 'permit' }, 'held')).toBe('permit');
  });

  it('describes each gate result from its real status', () => {
    expect(gateResult({ id: 'authz', status: 'permit' }, 'done')).toBe('PERMIT');
    expect(gateResult({ id: 'authz', status: 'waiting' }, 'idle')).toBe('');
    expect(gateResult({ id: 'authz', status: 'checking' }, 'held')).toMatch(/HELD/);
  });

  it('explains the run from what the gates actually reported', () => {
    expect(explainRun(gates('waiting', 'waiting', 'waiting'), { phase: 'idle' })).toBeNull();
    expect(explainRun(gates('waiting', 'waiting', 'waiting'), { phase: 'running' }).tone).toBe('info');
    expect(explainRun(gates('permit', 'permit', 'checking'), { phase: 'held' }).tone).toBe('held');
    expect(explainRun(gates('permit', 'permit', 'permit'), { phase: 'done' }).tone).toBe('permit');
    const refused = explainRun(gates('permit', 'permit', 'deny'), { phase: 'done' });
    expect(refused.tone).toBe('deny');
    expect(refused.text).toContain('PingOne Authorize');
    expect(explainRun(gates('permit', 'permit', 'waiting'), { phase: 'done' }).text).toMatch(/2 of 3/);
    expect(explainRun(gates('waiting', 'waiting', 'waiting'), { phase: 'error', errorText: 'Request failed (500)' }).text).toContain('Request failed (500)');
  });

  // Gate 1 used to be titled "Signed in with MFA" and sat at WAITING for any plain read (no MFA step reports an event),
  // which read as "you did MFA" + "nothing happened". It is the sign-in gate; MFA is only mentioned when it is real.
  describe('gate 1 is about the sign-in, and only claims MFA when MFA really happened', () => {
    test('it is titled "Signed in", not "Signed in with MFA"', () => {
      expect(GATE_COPY[0].title).toBe('Signed in');
      expect(JSON.stringify(GATE_COPY[0])).not.toMatch(/with MFA/i);
    });

    test.each([
      ['a finished run', 'done', true, 'permit'],
      ['a run held for step-up', 'held', true, 'permit'],
      ['still running', 'running', true, 'waiting'],
      ['nothing run yet', 'idle', true, 'waiting'],
      ['not signed in', 'done', false, 'waiting'],
    ])('a silent MFA gate for %s -> %s', (_n, phase, signedIn, expected) => {
      const out = effectiveGates([{ id: 'mfa', status: 'waiting' }, { id: 'gw', status: 'permit' }, { id: 'authz', status: 'permit' }], { phase, signedIn });
      expect(out[0].status).toBe(expected);
      expect(out.slice(1).map((g) => g.status)).toEqual(['permit', 'permit']);
    });

    test('a reported result is never overridden', () => {
      expect(effectiveGates([{ id: 'mfa', status: 'deny' }], { phase: 'done', signedIn: true })[0].status).toBe('deny');
      expect(effectiveGates([{ id: 'mfa', status: 'permit' }], { phase: 'done', signedIn: true })[0].status).toBe('permit');
    });

    test('the result line says who signed in and whether MFA was needed, verified, or is still to come', () => {
      const g = { id: 'mfa', status: 'permit' };
      expect(gateResult(g, 'done', { userLabel: 'sam@x.com', mfaVerified: false })).toBe("Signed in as sam@x.com. MFA wasn't needed for this request.");
      expect(gateResult(g, 'done', { userLabel: 'sam@x.com', mfaVerified: true })).toBe('Signed in as sam@x.com, and MFA verified.');
      expect(gateResult(g, 'held', { userLabel: 'sam@x.com', mfaVerified: false })).toBe('Signed in as sam@x.com. This request needs MFA before it can run.');
      expect(gateResult(g, 'done', {})).toBe("Signed in. MFA wasn't needed for this request.");
    });
  });
});
