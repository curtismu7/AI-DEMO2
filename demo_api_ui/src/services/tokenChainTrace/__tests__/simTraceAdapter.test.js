import { describe, it, expect } from 'vitest';
import { buildSimRailEvents } from '../simTraceAdapter';

describe('buildSimRailEvents', () => {
  it('remaps sim-exchange-ok to exchanged-token, preserving claims + status', () => {
    const out = buildSimRailEvents({
      tokenChainEvents: [
        { id: 'sim-exchange-ok', status: 'active', claims: { sub: 'u1', aud: 'gw' } },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('exchanged-token');
    expect(out[0].status).toBe('active');
    expect(out[0].claims).toEqual({ sub: 'u1', aud: 'gw' });
  });

  it('remaps sim-exchange-error and sim-rar-grant onto rail ids', () => {
    const out = buildSimRailEvents({
      tokenChainEvents: [
        { id: 'sim-exchange-error', status: 'error', error: 'invalid_scope' },
        { id: 'sim-rar-grant', status: 'active', authorization_details: [{ amount: 100 }] },
      ],
    });
    expect(out.map((e) => e.id)).toEqual(['exchange-failed', 'rar-authorization']);
    expect(out[0].error).toBe('invalid_scope');
    expect(out[1].authorization_details[0].amount).toBe(100);
  });

  it('passes user-token and other events through unchanged', () => {
    const out = buildSimRailEvents({
      tokenChainEvents: [
        { id: 'user-token', status: 'active' },
        { id: 'sim-gateway-deny', status: 'error', error: 'mcp_invalid_actor' },
      ],
    });
    expect(out.map((e) => e.id)).toEqual(['user-token', 'sim-gateway-deny']);
    expect(out[1].error).toBe('mcp_invalid_actor');
  });

  it('does not mutate the original event objects', () => {
    const original = { id: 'sim-exchange-ok', status: 'active' };
    const out = buildSimRailEvents({ tokenChainEvents: [original] });
    expect(original.id).toBe('sim-exchange-ok');
    expect(out[0]).not.toBe(original);
  });

  it('tolerates missing / empty / malformed input', () => {
    expect(buildSimRailEvents(null)).toEqual([]);
    expect(buildSimRailEvents({})).toEqual([]);
    expect(buildSimRailEvents({ tokenChainEvents: [null, { }, { id: 'ok' }] })).toEqual([{ id: 'ok' }]);
  });
});
