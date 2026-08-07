'use strict';

const nrContext = require('../services/nrContext');

describe('nrContext', () => {
  test('mintCorrelation returns object with UUID correlationId, useCaseId, useCaseName, startedAt', () => {
    const ctx = nrContext.mintCorrelation('UC14', 'UC14-AttackSim');
    expect(typeof ctx.correlationId).toBe('string');
    expect(ctx.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(ctx.useCaseId).toBe('UC14');
    expect(ctx.useCaseName).toBe('UC14-AttackSim');
    expect(typeof ctx.startedAt).toBe('number');
  });

  test('mintCorrelation accepts null args', () => {
    const ctx = nrContext.mintCorrelation(null, null);
    expect(ctx.useCaseId).toBeNull();
    expect(ctx.useCaseName).toBeNull();
  });

  test('getCorrelationId returns null outside run()', () => {
    expect(nrContext.getCorrelationId()).toBeNull();
  });

  test('getCorrelationId returns correct id inside run()', () => {
    const ctx = nrContext.mintCorrelation('UC1', 'UC1-ChipLogin');
    let captured = null;
    nrContext.run(ctx, () => {
      captured = nrContext.getCorrelationId();
    });
    expect(captured).toBe(ctx.correlationId);
  });

  test('get() returns {} outside run()', () => {
    expect(nrContext.get()).toEqual({});
  });

  test('two concurrent run() contexts do not bleed', async () => {
    const ctx1 = nrContext.mintCorrelation('UC1', 'A');
    const ctx2 = nrContext.mintCorrelation('UC2', 'B');
    const results = await Promise.all([
      new Promise((resolve) => nrContext.run(ctx1, () => resolve(nrContext.getCorrelationId()))),
      new Promise((resolve) => nrContext.run(ctx2, () => resolve(nrContext.getCorrelationId()))),
    ]);
    expect(results[0]).toBe(ctx1.correlationId);
    expect(results[1]).toBe(ctx2.correlationId);
    expect(results[0]).not.toBe(results[1]);
  });
});
