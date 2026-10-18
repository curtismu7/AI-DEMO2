import { describe, it, expect } from 'vitest';
import { appendMcpCall, getCalls } from '../mcpCallStore';

describe('mcpCallStore detail', () => {
  it('stores detail, defaulting to null', () => {
    appendMcpCall('t', 200, 5, {}, null, { src: 'you' });
    expect(getCalls()[0].detail).toEqual({ src: 'you' });
    appendMcpCall('u', 200, 5, {});
    expect(getCalls()[0].detail).toBeNull();
  });
});
