import { formatTokenAudience } from '../src/auth/tokenAudience';

// Pins the ONE canonical formatting rule for TokenAudience. Both PEPs
// (PingOneAuthorizeClient, pingAuthorizeGuard) must go through this helper —
// their historical comma/space disagreement is exactly what this file exists
// to prevent (see tokenAudience.ts for the full history).
describe('formatTokenAudience', () => {
  it('space-joins an array aud (D-05: policy splits TokenAudActual on whitespace)', () => {
    expect(formatTokenAudience(['gateway-a', 'upstream-b'])).toBe('gateway-a upstream-b');
  });

  it('passes a string aud through verbatim', () => {
    expect(formatTokenAudience('mcpgateway.ping.demo')).toBe('mcpgateway.ping.demo');
  });

  it('returns empty string for an absent aud (callers omit, not fabricate)', () => {
    expect(formatTokenAudience(undefined)).toBe('');
    expect(formatTokenAudience('')).toBe('');
  });

  it('does not mangle a single-element array', () => {
    expect(formatTokenAudience(['only-one'])).toBe('only-one');
  });
});
