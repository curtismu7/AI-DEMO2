// demo_mcp_gateway/tests/PingOneAuthorizeClient.sentParameters.test.ts
import axios from 'axios';
import { PingOneAuthorizeClient, buildAuthorizeParameters } from '../src/auth/PingOneAuthorizeClient';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const baseConfig: any = {
  pingAuthorizeEndpoint: 'https://real.example/authz',
  pingAuthorizeMockBase: 'http://authz-server:9001',
  pingAuthorizeWorkerId: 'mcp-gateway',
  gatewayResourceUri: 'mcpgateway.ping.demo',
  p1azEnabled: true,
};
const decoded: any = { sub: 'u1', scope: 'read transfer', act: { sub: 'agent' } };

describe('PingOneAuthorizeClient — sentParameters', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the exact attributes sent to the decision endpoint', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: { decision: 'PERMIT', decision_id: 'dec-abc', policy_version: 'cloud-v7' },
    });
    const client = new PingOneAuthorizeClient(baseConfig);
    const d = await client.evaluate(decoded, 'tools/call', 'create_transfer', { amount: 100 });

    expect(d.decision).toBe('PERMIT');
    expect(d.decisionId).toBe('dec-abc');
    expect(d.policyVersion).toBe('cloud-v7');
    expect(d.sentParameters).toBeDefined();
    expect(d.sentParameters!.ToolName).toBe('create_transfer');
    expect(d.sentParameters!.ClientId).toBe('u1');
    expect(d.sentParameters!.ActClientId).toBe('agent');
    expect(d.sentParameters!.TransactionAmount).toBe('100');
    expect(d.sentParameters!.TokenScopes).toBe('read transfer');
  });

  it('omits sentParameters on the no-P1AZ local-scope fallback', async () => {
    const client = new PingOneAuthorizeClient({
      ...baseConfig, p1azEnabled: false, pingAuthorizeEndpoint: '', allowLocalScopeFallback: true,
    });
    const d = await client.evaluate(decoded, 'tools/call', 'get_my_accounts', {});
    expect(d.sentParameters).toBeUndefined();
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });
});

/**
 * Contract C1 — the canonical decision parameter set.
 *
 * The headline defect: TokenAudience and McpResourceUri were BOTH hardcoded to
 * gatewayResourceUri, so the cloud rule `HasValidMcpAudience`
 * (TokenAudience == McpResourceUri) and mock Rule 0c compared a value to itself.
 * The audience rule could not fail, no matter what the token actually carried.
 */
describe('buildAuthorizeParameters — C1 canonical parameter set', () => {
  const GW = 'mcpgateway.ping.demo';
  const tok = (over: any = {}): any => ({
    sub: 'u1', scope: 'read transfer', aud: GW, exp: 111, iat: 100, ...over,
  });

  it('TokenAudience is the token\'s REAL aud, not the expected resource URI', () => {
    const p = buildAuthorizeParameters(tok({ aud: 'some-other-audience' }), 'tools/call', GW, 'create_transfer');
    expect(p.TokenAudience).toBe('some-other-audience');
    expect(p.McpResourceUri).toBe(GW);
    // The audience rule must now be capable of failing.
    expect(p.TokenAudience).not.toBe(p.McpResourceUri);
  });

  it('a matching audience still compares equal (the rule can PERMIT too)', () => {
    const p = buildAuthorizeParameters(tok(), 'tools/call', GW, 'create_transfer');
    expect(p.TokenAudience).toBe(GW);
    expect(p.TokenAudience).toBe(p.McpResourceUri);
  });

  it('an array aud contributes its FULL space-joined list (D-05 anti-bypass parity with Groovy)', () => {
    // A multi-aud [gateway, upstream] confused-deputy token must send EVERY aud
    // entry, not just aud[0] — mock Rule 0b-2 splits TokenAudActual on whitespace,
    // so truncating to the first entry would let the upstream aud escape the check.
    const p = buildAuthorizeParameters(tok({ aud: [GW, 'https://banking-resource-server.ping.demo'] }), 'tools/call', GW, 'create_transfer');
    expect(p.TokenAudience).toBe(`${GW} https://banking-resource-server.ping.demo`);
    expect(p.TokenAudActual).toBe(p.TokenAudience);
  });

  it('TokenAudActual carries the same value (mock back-compat)', () => {
    const p = buildAuthorizeParameters(tok({ aud: ['first-aud', 'second-aud'] }), 'tools/call', GW, 'create_transfer');
    expect(p.TokenAudActual).toBe(p.TokenAudience);
  });

  it('omits the audience keys entirely when the token has no aud (rule 1)', () => {
    const p = buildAuthorizeParameters(tok({ aud: undefined }), 'tools/call', GW, 'create_transfer');
    expect(p).not.toHaveProperty('TokenAudience');
    expect(p).not.toHaveProperty('TokenAudActual');
    // The EXPECTED uri is still sent — it is the gateway's own fact, not the token's.
    expect(p.McpResourceUri).toBe(GW);
  });

  it('sends Amount alongside TransactionAmount (the cloud Trust Framework reads Amount)', () => {
    const p = buildAuthorizeParameters(tok(), 'tools/call', GW, 'create_transfer', { amount: 750 });
    expect(p.Amount).toBe('750');
    expect(p.TransactionAmount).toBe('750');
  });

  it("Amount and TransactionAmount move together — both '0' when there is no amount (rule 2)", () => {
    // Contract changed 2026-08-03: an ABSENT Amount makes the cloud policy's
    // amount-band comparisons evaluate INDETERMINATE, failing every plain read
    // closed past the MCP catch-all permit (PDP-probed). Amount-less tools send
    // '0'; amount-carrying tools REQUIRE amount in their schema so a real
    // transaction always overwrites it.
    const p = buildAuthorizeParameters(tok(), 'tools/call', GW, 'get_my_accounts', {});
    expect(p.Amount).toBe('0');
    expect(p.TransactionAmount).toBe('0');
  });

  it('sends Acr from the token claim so a completed MFA can discharge step-up', () => {
    const p = buildAuthorizeParameters(tok({ acr: 'Multi_Factor' }), 'tools/call', GW, 'create_transfer');
    expect(p.Acr).toBe('Multi_Factor');
  });

  it('omits Acr rather than fabricating one when the token carries no acr', () => {
    const p = buildAuthorizeParameters(tok(), 'tools/call', GW, 'create_transfer');
    expect(p).not.toHaveProperty('Acr');
  });

  it('sends a Timestamp', () => {
    const p = buildAuthorizeParameters(tok(), 'tools/call', GW, 'create_transfer');
    expect(p.Timestamp).toBeDefined();
    expect(Number.isNaN(Date.parse(p.Timestamp))).toBe(false);
  });

  it('omits unverified binding claims rather than sending false (rule 3)', () => {
    // No intentValidation passed => the transport did not verify intent at all.
    // "Omitted" means unknown; `false` would mean "verified absent".
    const p = buildAuthorizeParameters(tok(), 'tools/call', GW, 'create_transfer');
    expect(p).not.toHaveProperty('IntentTokenValid');
    expect(p).not.toHaveProperty('IntentMatchesTool');
  });
});

describe('buildAuthorizeParameters — Tool annotations and elicitation', () => {
  const GW = 'mcpgateway.ping.demo';
  const tok = (over: any = {}): any => ({
    sub: 'u1', scope: 'read write transfer', aud: GW, exp: 111, iat: 100, ...over,
  });

  it('includes tool annotation fields in P1AZ context for a write tool', () => {
    const p = buildAuthorizeParameters(tok(), 'tools/call', GW, 'create_withdrawal', { amount: 100 });
    expect(p.ToolReadOnly).toBe('false');
    expect(p.ToolDestructive).toBe('true');
    expect(p.ToolIdempotent).toBe('false');
  });

  it('includes tool annotation fields for a read tool', () => {
    const p = buildAuthorizeParameters(tok(), 'tools/call', GW, 'get_my_accounts', {});
    expect(p.ToolReadOnly).toBe('true');
    expect(p.ToolDestructive).toBe('false');
    expect(p.ToolIdempotent).toBe('true');
  });

  it('includes tool annotation fields for an unknown tool (fail-safe: all false)', () => {
    const p = buildAuthorizeParameters(tok(), 'tools/call', GW, 'nonexistent_tool_xyz', {});
    expect(p.ToolReadOnly).toBe('false');
    expect(p.ToolDestructive).toBe('false');
    expect(p.ToolIdempotent).toBe('false');
  });

  it('sets ElicitationConfirmed to true when args contain _elicitation_confirmed: true', () => {
    const p = buildAuthorizeParameters(
      tok(), 'tools/call', GW, 'create_withdrawal',
      { amount: 100, _elicitation_confirmed: true, _elicitation_id: 'test-uuid' },
    );
    expect(p.ElicitationConfirmed).toBe('true');
  });

  it('sets ElicitationConfirmed to false when args do not contain _elicitation_confirmed', () => {
    const p = buildAuthorizeParameters(tok(), 'tools/call', GW, 'create_withdrawal', { amount: 100 });
    expect(p.ElicitationConfirmed).toBe('false');
  });

  it('sets ElicitationConfirmed to false when _elicitation_confirmed is false', () => {
    const p = buildAuthorizeParameters(
      tok(), 'tools/call', GW, 'create_withdrawal',
      { amount: 100, _elicitation_confirmed: false },
    );
    expect(p.ElicitationConfirmed).toBe('false');
  });

  it('includes tool annotations with all-false for tools/list (no toolName)', () => {
    const p = buildAuthorizeParameters(tok(), 'tools/list', GW);
    // Annotation fields always present: unknown toolName returns all-false (fail-safe)
    expect(p.ToolReadOnly).toBe('false');
    expect(p.ToolDestructive).toBe('false');
    expect(p.ToolIdempotent).toBe('false');
    // ElicitationConfirmed is always sent as it is tool-agnostic
    expect(p.ElicitationConfirmed).toBe('false');
  });

  it('sends binding claims when the transport DID verify them', () => {
    const p = buildAuthorizeParameters(
      tok(), 'tools/call', GW, 'create_transfer', {}, null, false,
      { valid: true, toolPermitted: true } as any,
    );
    expect(p.IntentTokenValid).toBe('true');
    expect(p.IntentMatchesTool).toBe('true');
  });

  it('sends NestedActClientId from act.act (A2A generalist identity)', () => {
    const p = buildAuthorizeParameters(
      tok({ act: { sub: 'specialist', act: { sub: 'generalist-1' } } }),
      'tools/call', GW, 'get_portfolio_summary',
    );
    expect(p.ActClientId).toBe('specialist');
    expect(p.ActChainDepth).toBe('2');
    expect(p.NestedActClientId).toBe('generalist-1');
  });

  it('prefers nested act.client_id over act.sub (PingOne claim shape)', () => {
    const p = buildAuthorizeParameters(
      tok({ act: { sub: 'specialist', act: { client_id: 'generalist-cid', sub: 'generalist-sub' } } }),
      'tools/call', GW, 'get_portfolio_summary',
    );
    expect(p.NestedActClientId).toBe('generalist-cid');
  });

  it('sends empty NestedActClientId when there is no nested act', () => {
    const p = buildAuthorizeParameters(
      tok({ act: { sub: 'agent' } }),
      'tools/call', GW, 'get_my_accounts',
    );
    expect(p.ActChainDepth).toBe('1');
    expect(p.NestedActClientId).toBe('');
  });

  // C1 parity with the BFF's McpFirstTool gate, which sends TokenKidKnown.
  // Only 'true' or omitted is honest from here: in JWKS mode an unmatched kid
  // throws in _decodeAndVerify, so any token reaching this builder names a
  // published key. Decode-only mode knows nothing and must omit.
  describe('TokenKidKnown (signing-key identity)', () => {
    const ENV_KEYS = ['PINGONE_JWKS_ENDPOINT', 'PINGONE_JWKS_URI'] as const;
    const saved: Record<string, string | undefined> = {};
    beforeEach(() => {
      for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
    });
    afterEach(() => {
      for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    });

    it("sends 'true' when JWKS verification is enabled", () => {
      process.env.PINGONE_JWKS_ENDPOINT = 'https://auth.pingone.com/e/as/jwks';
      const p = buildAuthorizeParameters(tok(), 'tools/call', GW, 'get_my_accounts');
      expect(p.TokenKidKnown).toBe('true');
    });

    // PINGONE_JWKS_URI is the name this stack actually sets; the endpoint var
    // was an orphan for a long time. Both must count as JWKS mode.
    it("accepts PINGONE_JWKS_URI as the alias the stack actually sets", () => {
      process.env.PINGONE_JWKS_URI = 'https://auth.pingone.com/e/as/jwks';
      const p = buildAuthorizeParameters(tok(), 'tools/call', GW, 'get_my_accounts');
      expect(p.TokenKidKnown).toBe('true');
    });

    // THE load-bearing case: decode-only mode knows nothing about the kid, and
    // a fabricated value here would be a claim the gateway cannot support.
    it('OMITS the key entirely in decode-only mode', () => {
      const p = buildAuthorizeParameters(tok(), 'tools/call', GW, 'get_my_accounts');
      expect('TokenKidKnown' in p).toBe(false);
    });

    it("never sends 'false' — an unpublished kid is rejected before P1AZ", () => {
      process.env.PINGONE_JWKS_ENDPOINT = 'https://auth.pingone.com/e/as/jwks';
      const withJwks = buildAuthorizeParameters(tok(), 'tools/call', GW, 'get_my_accounts');
      delete process.env.PINGONE_JWKS_ENDPOINT;
      const without = buildAuthorizeParameters(tok(), 'tools/call', GW, 'get_my_accounts');
      expect(withJwks.TokenKidKnown).not.toBe('false');
      expect(without.TokenKidKnown).not.toBe('false');
    });
  });
});