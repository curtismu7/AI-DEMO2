import { describe, it, expect } from 'vitest';
import {
  reconcileToolSteps,
  authorizeDecisionToStep,
  errorStep,
  hitlStep,
  identityStep,
  delegationStep,
  mapActivityRecord,
} from '../activityNarration';

describe('reconcileToolSteps', () => {
  it('maps a running tool call to a present-tense running step', () => {
    const steps = reconcileToolSteps([{ id: 't1', name: 'get_balance', status: 'running' }]);
    expect(steps).toEqual([
      { key: 'tool:t1', text: 'Reading your balance…', status: 'running', tone: 'neutral' },
    ]);
  });

  it('maps a done tool call to a past-tense done step', () => {
    const steps = reconcileToolSteps([{ id: 't1', name: 'get_balance', status: 'done' }]);
    expect(steps).toEqual([
      { key: 'tool:t1', text: 'Read your balance', status: 'done', tone: 'neutral' },
    ]);
  });
});

describe('authorizeDecisionToStep', () => {
  it('narrates a PERMIT', () => {
    const step = authorizeDecisionToStep({ id: 'a1', decision: 'PERMIT' }, 'Bank');
    expect(step).toEqual({ key: 'authz:a1', text: 'The Bank approved the request.', status: 'done', tone: 'security' });
  });

  it('narrates a DENY', () => {
    const step = authorizeDecisionToStep({ id: 'a2', decision: 'DENY' }, 'Bank');
    expect(step.text).toBe("The Bank said no — that action isn't allowed.");
    expect(step.status).toBe('failed');
    expect(step.tone).toBe('security');
  });

  it('narrates a step-up obligation regardless of decision', () => {
    const step = authorizeDecisionToStep(
      { id: 'a3', decision: 'PERMIT', obligations: [{ type: 'gateway_step_up_required' }] },
      'Bank',
    );
    expect(step.text).toBe('The Bank wants you to approve this on your phone first.');
    expect(step.tone).toBe('security');
  });

  it('narrates a HITL/consent obligation', () => {
    const step = authorizeDecisionToStep(
      { id: 'a4', decision: 'PERMIT', obligations: [{ type: 'hitl_consent_required' }] },
      'Bank',
    );
    expect(step.text).toBe('This needs your explicit OK before it can continue.');
  });
});

describe('fixed steps', () => {
  it('identity and delegation are neutral running/done', () => {
    expect(identityStep()).toEqual({ key: 'identity', text: "Confirming it's really you…", status: 'done', tone: 'neutral' });
    expect(delegationStep().key).toBe('delegation');
    expect(errorStep('Bank').tone).toBe('error');
  });

  it('hitlStep is a security-tone running pending-approval step', () => {
    expect(hitlStep()).toEqual({
      key: 'hitl',
      text: 'This needs your explicit OK before it can continue.',
      status: 'running',
      tone: 'security',
    });
  });
});

describe('mapActivityRecord', () => {
  it('maps identity/delegation/answer fixed kinds', () => {
    expect(mapActivityRecord({ kind: 'identity' }, 'Clinic')).toEqual(identityStep());
    expect(mapActivityRecord({ kind: 'delegation' }, 'Clinic').key).toBe('delegation');
    expect(mapActivityRecord({ kind: 'answer' }, 'Clinic').key).toBe('answer');
  });

  it('maps an authorize record through authorizeDecisionToStep (vertical-aware)', () => {
    const step = mapActivityRecord({ kind: 'authorize', data: { id: 'd1', decision: 'DENY' } }, 'Clinic');
    expect(step.text).toBe("The Clinic said no — that action isn't allowed.");
    expect(step.tone).toBe('security');
  });

  it('maps a tool record through reconcileToolSteps (done → past tense)', () => {
    const step = mapActivityRecord({ kind: 'tool', data: { id: 'get_balance', name: 'get_balance', status: 'done' } }, 'Clinic');
    expect(step).toEqual({ key: 'tool:get_balance', text: 'Read your balance', status: 'done', tone: 'neutral' });
  });

  it('maps an error record with the institution noun', () => {
    expect(mapActivityRecord({ kind: 'error' }, 'Clinic').tone).toBe('error');
  });

  it('returns null for unknown or empty records', () => {
    expect(mapActivityRecord(null, 'Clinic')).toBeNull();
    expect(mapActivityRecord({}, 'Clinic')).toBeNull();
    expect(mapActivityRecord({ kind: 'nope' }, 'Clinic')).toBeNull();
  });
});
