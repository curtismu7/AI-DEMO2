'use strict';
const demos = require('../../services/authorizeLearningDemos');

describe('authorizeLearningDemos', () => {
  test('exports the four demo types', () => {
    expect(demos.LEARNING_DEMO_TYPES).toEqual(['abac', 'indeterminate', 'payloadFilter', 'obligations']);
  });

  test('buildTrace normalizes a full trace', () => {
    const t = demos.buildTrace({
      policySet: 'Account Access', rule: 'Region match', condition: 'user.region == resource.region',
      effect: 'PERMIT', statements: [{ type: 'ADVICE', detail: 'logged' }],
    });
    expect(t).toEqual({
      policySet: 'Account Access', rule: 'Region match', condition: 'user.region == resource.region',
      effect: 'PERMIT', statements: [{ type: 'ADVICE', detail: 'logged' }],
    });
    expect(demos.buildTrace({ policySet: 'x', rule: 'y', condition: 'z', effect: 'DENY' }).statements).toEqual([]);
  });

  test('abac: matching region + manager role PERMITs, with trace', async () => {
    const r = await demos.evaluateLearningDemo({
      demoType: 'abac',
      input: { role: 'manager', userRegion: 'EU', resourceRegion: 'EU', action: 'read' },
    });
    expect(r.decision).toBe('PERMIT');
    expect(r.effect).toBe('PERMIT');
    expect(r.trace.rule).toMatch(/region/i);
    expect(r.trace.condition).toContain('EU');
  });

  test('abac: region mismatch DENYs', async () => {
    const r = await demos.evaluateLearningDemo({
      demoType: 'abac',
      input: { role: 'manager', userRegion: 'US', resourceRegion: 'EU', action: 'read' },
    });
    expect(r.decision).toBe('DENY');
    expect(r.trace.effect).toBe('DENY');
  });

  test('abac: clerk cannot write even in-region', async () => {
    const r = await demos.evaluateLearningDemo({
      demoType: 'abac',
      input: { role: 'clerk', userRegion: 'EU', resourceRegion: 'EU', action: 'write' },
    });
    expect(r.decision).toBe('DENY');
  });

  test('indeterminate: unresolved attribute fails closed', async () => {
    const r = await demos.evaluateLearningDemo({
      demoType: 'indeterminate',
      input: { attributeResolves: false },
    });
    expect(r.decision).toBe('INDETERMINATE');
    expect(r.effect).toBe('INDETERMINATE');
    expect(r.raw.failClosed).toBe(true);
  });

  test('indeterminate: resolved attribute PERMITs', async () => {
    const r = await demos.evaluateLearningDemo({
      demoType: 'indeterminate',
      input: { attributeResolves: true },
    });
    expect(r.decision).toBe('PERMIT');
  });

  test('payloadFilter: teller role redacts ssn and balance', async () => {
    const r = await demos.evaluateLearningDemo({
      demoType: 'payloadFilter',
      input: { role: 'teller', payload: { name: 'Ada', ssn: '123-45-6789', balance: 9000, accountId: 'a1' } },
    });
    expect(r.decision).toBe('PERMIT');
    expect(r.output.ssn).toBe('***-**-6789');
    expect(r.output.balance).toBeUndefined();
    expect(r.output.name).toBe('Ada');
    expect(r.statements.some((s) => s.type === 'FILTER')).toBe(true);
  });

  test('payloadFilter: auditor role sees full payload', async () => {
    const r = await demos.evaluateLearningDemo({
      demoType: 'payloadFilter',
      input: { role: 'auditor', payload: { name: 'Ada', ssn: '123-45-6789', balance: 9000, accountId: 'a1' } },
    });
    expect(r.output.ssn).toBe('123-45-6789');
    expect(r.output.balance).toBe(9000);
  });

  test('obligations: high-value read attaches audit-log advice + step-up obligation', async () => {
    const r = await demos.evaluateLearningDemo({
      demoType: 'obligations',
      input: { amount: 25000, acr: '' },
    });
    expect(r.decision).toBe('PERMIT');
    expect(r.obligations.some((o) => o.type === 'STEP_UP')).toBe(true);
    expect(r.statements.some((s) => s.type === 'ADVICE' && /audit/i.test(s.detail))).toBe(true);
  });

  test('obligations: satisfied MFA drops the step-up obligation', async () => {
    const r = await demos.evaluateLearningDemo({
      demoType: 'obligations',
      input: { amount: 25000, acr: 'Multi_Factor' },
    });
    expect(r.obligations.some((o) => o.type === 'STEP_UP')).toBe(false);
  });

  test('unknown demoType throws', async () => {
    await expect(demos.evaluateLearningDemo({ demoType: 'nope', input: {} })).rejects.toThrow(/unknown demoType/);
  });
});
