'use strict';

jest.mock('../routes/featureFlags', () => ({
  FLAG_REGISTRY: [
    { id: 'ff_a', name: 'A', category: 'X', type: 'boolean', defaultValue: false },
    { id: 'ff_b', name: 'B', category: 'X', type: 'boolean', defaultValue: true },
  ],
  serializeFlag: (f) => ({ id: f.id, value: f.id === 'ff_b' }),
}));

const svc = require('../services/checkService');

describe('checkService core', () => {
  test('currentFlags maps id -> value', () => {
    expect(svc.currentFlags()).toEqual({ ff_a: false, ff_b: true });
  });

  test('selectChecks honors appliesWhen and heavy', () => {
    const checks = [
      { id: 'always', run: async () => ({ status: 'pass' }) },
      { id: 'only_b', appliesWhen: (f) => f.ff_b === true, run: async () => ({ status: 'pass' }) },
      { id: 'only_a', appliesWhen: (f) => f.ff_a === true, run: async () => ({ status: 'pass' }) },
      { id: 'heavy', heavy: true, run: async () => ({ status: 'pass' }) },
    ];
    const flags = svc.currentFlags();
    expect(svc.selectChecks(flags, {}, checks).map((c) => c.id)).toEqual(['always', 'only_b']);
    expect(svc.selectChecks(flags, { includeHeavy: true }, checks).map((c) => c.id))
      .toEqual(['always', 'only_b', 'heavy']);
  });

  test('aggregateVerdict precedence with severity', () => {
    expect(svc.aggregateVerdict([{ status: 'pass' }, { status: 'skip' }])).toBe('ready');
    expect(svc.aggregateVerdict([{ status: 'pass' }, { status: 'warn' }])).toBe('ready_with_warnings');
    expect(svc.aggregateVerdict([{ status: 'warn' }, { status: 'fail', severity: 'blocking' }])).toBe('not_ready');
    expect(svc.aggregateVerdict([{ status: 'pass', severity: 'gate' }, { status: 'fail', severity: 'advisory' }]))
      .toBe('ready_with_warnings');
    expect(svc.aggregateVerdict([{ status: 'fail', severity: 'gate' }])).toBe('not_ready');
    // Missing severity defaults to blocking
    expect(svc.aggregateVerdict([{ status: 'fail' }])).toBe('not_ready');
  });

  test('runChecks forwards nextAction and severity', async () => {
    const checks = [{
      id: 'g', name: 'g', category: 'Use cases', severity: 'gate',
      run: async () => ({ status: 'fail', detail: 'x', nextAction: 'Do Y' }),
    }];
    const results = await svc.runChecks(checks, {});
    expect(results[0]).toMatchObject({
      status: 'fail', nextAction: 'Do Y', severity: 'gate',
    });
  });

  test('runChecks streams results, times each, and isolates throws', async () => {
    const seen = [];
    const checks = [
      { id: 'ok', name: 'ok', category: 'C', run: async () => ({ status: 'pass', detail: 'fine' }) },
      { id: 'boom', name: 'boom', category: 'C', run: async () => { throw new Error('kaboom'); } },
    ];
    const results = await svc.runChecks(checks, {}, (r) => seen.push(r.id));
    expect(seen).toEqual(['ok', 'boom']);
    expect(results[1]).toMatchObject({ id: 'boom', status: 'fail', detail: 'kaboom' });
    expect(typeof results[0].durationMs).toBe('number');
  });

  test('runChecks normalizes a non-object outcome to fail and does not abort the batch', async () => {
    const seen = [];
    const checks = [
      { id: 'undef', name: 'undef', category: 'C', run: async () => undefined },
      { id: 'after', name: 'after', category: 'C', run: async () => ({ status: 'pass' }) },
    ];
    const results = await svc.runChecks(checks, {}, (r) => seen.push(r.id));
    expect(seen).toEqual(['undef', 'after']);
    expect(results[0]).toMatchObject({ id: 'undef', status: 'fail' });
    expect(results[1]).toMatchObject({ id: 'after', status: 'pass' });
  });
});
