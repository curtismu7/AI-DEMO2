import { correlationIdFromRequest } from '../src/agentRunHandler';

describe('agentRunHandler correlation resolution', () => {
  it('prefers the x-correlation-id header', () => {
    expect(correlationIdFromRequest({ 'x-correlation-id': 'H' }, { context: { correlationId: 'B' } })).toBe('H');
  });

  it('falls back to context.correlationId in the body', () => {
    expect(correlationIdFromRequest({}, { context: { correlationId: 'B' } })).toBe('B');
  });

  it('falls back to a top-level body correlationId', () => {
    expect(correlationIdFromRequest({}, { correlationId: 'T' })).toBe('T');
  });

  it('generates a uuid when nothing is supplied', () => {
    const out = correlationIdFromRequest({}, {});
    expect(out).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('ignores an array-valued header', () => {
    expect(correlationIdFromRequest({ 'x-correlation-id': ['a', 'b'] as any }, { correlationId: 'T' })).toBe('T');
  });
});
