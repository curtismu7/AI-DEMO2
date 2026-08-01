import { extractTratClaims } from './TratClaimsExtractor';

describe('TratClaimsExtractor', () => {
  const base64 = (obj: object) => Buffer.from(JSON.stringify(obj)).toString('base64url');

  function makeJwt(payload: object): string {
    const header = base64({ alg: 'RS256', typ: 'JWT' });
    const body = base64(payload);
    return `${header}.${body}.fakesig`;
  }

  it('returns null when trat mode disabled', () => {
    const result = extractTratClaims(makeJwt({ sub: 'u1' }), undefined, false);
    expect(result).toBeNull();
  });

  it('extracts reqctx from JWT claims', () => {
    const token = makeJwt({
      sub: 'u1',
      reqctx: { tool: 'get_my_accounts', session_id: 's1', correlation_id: 'c1' },
      purp: 'banking:mcp:tool_call',
      azd: { sub: 'u1', act: 'agent-client' },
      rctx: { ip: '127.0.0.1', user_agent: 'banking-bff/1.0', timestamp: '2026-05-20T00:00:00Z' },
    });
    const result = extractTratClaims(token, undefined, true);
    expect(result).not.toBeNull();
    expect(result!.reqctx.tool).toBe('get_my_accounts');
    expect(result!.purp).toBe('banking:mcp:tool_call');
    expect(result!.trat_sim).toBeUndefined();
  });

  // The X-TraT-Context header is an UNSIGNED simulation shim, so Path 2 in
  // TratClaimsExtractor.ts only trusts it when ALLOW_UNSIGNED_TRAT_CONTEXT is
  // explicitly 'true'. Without that gate a direct caller could forge
  // purp/reqctx/azd and influence the authorize decision and the audit trail.
  // These two tests pin both halves of that gate.
  const tratHeader = JSON.stringify({
    reqctx: { tool: 'get_account_balance', session_id: 's2', correlation_id: 'c2' },
    purp: 'banking:mcp:tool_call',
    azd: { sub: 'u2', act: 'agent-client' },
    rctx: { ip: '127.0.0.1', user_agent: 'banking-bff/1.0', timestamp: '2026-05-20T00:00:00Z' },
    trat_sim: true,
  });

  it('falls back to X-TraT-Context header when the unsigned shim is allowed', () => {
    const prev = process.env.ALLOW_UNSIGNED_TRAT_CONTEXT;
    process.env.ALLOW_UNSIGNED_TRAT_CONTEXT = 'true';
    try {
      const result = extractTratClaims(makeJwt({ sub: 'u2' }), tratHeader, true);
      expect(result).not.toBeNull();
      expect(result!.reqctx.tool).toBe('get_account_balance');
      expect(result!.trat_sim).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.ALLOW_UNSIGNED_TRAT_CONTEXT;
      else process.env.ALLOW_UNSIGNED_TRAT_CONTEXT = prev;
    }
  });

  it('IGNORES the X-TraT-Context header when the unsigned shim is NOT allowed', () => {
    const prev = process.env.ALLOW_UNSIGNED_TRAT_CONTEXT;
    delete process.env.ALLOW_UNSIGNED_TRAT_CONTEXT;
    try {
      // A bearer with no embedded TraT claims + a forged header must yield null,
      // never the header's claims.
      expect(extractTratClaims(makeJwt({ sub: 'u2' }), tratHeader, true)).toBeNull();
    } finally {
      if (prev !== undefined) process.env.ALLOW_UNSIGNED_TRAT_CONTEXT = prev;
    }
  });

  it('returns null when trat mode on but neither source has claims', () => {
    const result = extractTratClaims(makeJwt({ sub: 'u3' }), undefined, true);
    expect(result).toBeNull();
  });
});
