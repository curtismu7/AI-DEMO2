/**
 * Unit tests for audienceAccepted — the exported pure function backing
 * TokenIntrospector's RFC 8707 aud check. MCP_SERVER_RESOURCE_URI may be a
 * comma-separated list of accepted audiences (rollout: own backend URI +
 * gateway URI while both token shapes are live).
 */

import { audienceAccepted } from '../../src/auth/TokenIntrospector';

describe('audienceAccepted', () => {
  it('accepts any audience in the comma-separated env list', () => {
    expect(audienceAccepted(['mcpserver.ping.demo'], 'mcpserver.ping.demo,mcpgateway.ping.demo')).toBe(true);
    expect(audienceAccepted('mcpgateway.ping.demo', 'mcpserver.ping.demo,mcpgateway.ping.demo')).toBe(true);
  });

  it('rejects audiences not in the list', () => {
    expect(audienceAccepted(['other.ping.demo'], 'mcpserver.ping.demo,mcpgateway.ping.demo')).toBe(false);
  });

  it('handles whitespace around commas', () => {
    expect(audienceAccepted(['a'], ' a , b ')).toBe(true);
  });

  it('rejects when none of a multi-value token aud match', () => {
    expect(audienceAccepted(['x', 'y'], 'mcpserver.ping.demo,mcpgateway.ping.demo')).toBe(false);
  });

  it('accepts a single-value env (no comma) exactly as before', () => {
    expect(audienceAccepted('mcpgateway.ping.demo', 'mcpgateway.ping.demo')).toBe(true);
    expect(audienceAccepted('other.ping.demo', 'mcpgateway.ping.demo')).toBe(false);
  });
});
