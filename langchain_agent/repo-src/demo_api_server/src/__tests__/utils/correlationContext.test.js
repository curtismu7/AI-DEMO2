const { runWithCorrelation, getCorrelationId } = require('../../../utils/correlationContext');

describe('correlationContext', () => {
  it('returns undefined outside a run scope', () => {
    expect(getCorrelationId()).toBeUndefined();
  });
  it('exposes the id inside runWithCorrelation, including across async', async () => {
    await runWithCorrelation('abc-123', async () => {
      expect(getCorrelationId()).toBe('abc-123');
      await new Promise((r) => setTimeout(r, 5));
      expect(getCorrelationId()).toBe('abc-123');
    });
    expect(getCorrelationId()).toBeUndefined();
  });
  it('isolates concurrent scopes', async () => {
    const seen = [];
    await Promise.all([
      runWithCorrelation('A', async () => { await new Promise(r=>setTimeout(r,10)); seen.push(getCorrelationId()); }),
      runWithCorrelation('B', async () => { await new Promise(r=>setTimeout(r,1));  seen.push(getCorrelationId()); }),
    ]);
    expect(seen.sort()).toEqual(['A', 'B']);
  });
});
