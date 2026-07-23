import { describe, expect, it } from 'vitest';
import { buildTokenEventMsg } from '../agentFormatters';

describe('buildTokenEventMsg', () => {
  it('shows act/aud/scope details and no may_act line for an exchanged token', () => {
    const message = buildTokenEventMsg([
      {
        id: 'exchanged-token',
        actPresent: true,
        actDetails: '{"sub":"agent-1"}',
        audienceNarrowed: 'demo_mcp_server',
        audExpected: 'demo_mcp_server',
        audMatches: true,
        audActual: 'demo_mcp_server',
        scopeNarrowed: 'read write',
        claims: { aud: 'demo_mcp_server', scope: 'read write' },
      },
    ]);

    expect(message).toContain('Security Verification — RFC 8693 Token Exchange');
    expect(message).not.toContain('may_act');
    expect(message).toContain('act:');
    expect(message).toContain('BFF confirmed');
    expect(message).toContain('aud:');
    expect(message).toContain('demo_mcp_server');
    expect(message).toContain('scope:');
    expect(message).toContain('read write');
  });

  it('omits may_act even when no user-token event is present', () => {
    const message = buildTokenEventMsg([
      {
        id: 'exchanged-token',
        actPresent: false,
        audienceNarrowed: 'demo_mcp_server',
        scopeNarrowed: 'read',
        claims: {},
      },
    ]);

    expect(message).not.toContain('may_act');
    expect(message).toContain('subject-only exchange');
  });

  it('gives act-claim guidance (not may_act guidance) when exchange fails', () => {
    const message = buildTokenEventMsg([
      { id: 'exchange-failed', error: 'invalid_grant' },
    ]);

    expect(message).toContain('Token Exchange (RFC 8693) failed');
    expect(message).not.toContain('may_act');
    expect(message).toContain('Token Exchange grant');
  });
});
