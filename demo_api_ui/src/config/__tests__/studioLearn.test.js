import { describe, it, expect } from 'vitest';
import { GATE_COPY, LESSONS, badgeLabel, gateStatus, gateResult, explainRun } from '../studioLearn';

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
});
