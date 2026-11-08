import { describe, it, expect } from 'vitest';
import { overallDecision, decisionTone, engineLabel, elapsedMs, DECISION_LABELS } from '../policyDecisionSummary';

describe('policyDecisionSummary', () => {
  it('overallDecision: step-up and consent override the engine decision', () => {
    expect(overallDecision(null)).toBe('INDETERMINATE');
    expect(overallDecision({ decision: 'PERMIT', stepUpRequired: true })).toBe('STEP_UP');
    expect(overallDecision({ decision: 'PERMIT', consentRequired: true })).toBe('CONSENT');
    expect(overallDecision({ decision: 'PERMIT', hitlRequired: true })).toBe('CONSENT');
    expect(overallDecision({ decision: 'DENY' })).toBe('DENY');
    expect(overallDecision({})).toBe('INDETERMINATE');
  });

  it('decisionTone maps every display token to a chip tone', () => {
    expect(decisionTone('PERMIT')).toBe('ok');
    expect(decisionTone('DENY')).toBe('danger');
    expect(decisionTone('STEP_UP')).toBe('warn');
    expect(decisionTone('CONSENT')).toBe('warn');
    expect(decisionTone('INDETERMINATE')).toBe('neutral');
    expect(Object.keys(DECISION_LABELS)).toEqual(['PERMIT', 'DENY', 'STEP_UP', 'CONSENT', 'INDETERMINATE']);
  });

  it('engineLabel: only "pingone" counts as a real PingOne decision', () => {
    expect(engineLabel('pingone')).toMatchObject({ real: true, label: 'PingOne Authorize' });
    for (const e of ['simulated', 'simulated-learning', 'fallback_simulated']) {
      expect(engineLabel(e)).toMatchObject({ real: false, label: 'Simulated rules' });
    }
    expect(engineLabel('mock_authz_server')).toMatchObject({ real: false, label: 'Mock authorization server' });
    expect(engineLabel('off')).toMatchObject({ real: false, label: 'Engine off' });
    expect(engineLabel(undefined)).toMatchObject({ real: false, label: 'Not recorded' });
  });

  it('elapsedMs reads the PingOne response first, then raw, and returns null when absent', () => {
    expect(elapsedMs({ pingoneResponse: { elapsedMicroseconds: 1500 }, raw: { elapsedMicroseconds: 9 } })).toBe(1.5);
    expect(elapsedMs({ raw: { elapsedMicroseconds: 2000 } })).toBe(2);
    expect(elapsedMs({ raw: {} })).toBeNull();
    expect(elapsedMs(null)).toBeNull();
  });
});
