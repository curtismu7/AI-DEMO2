// demo_mcp_gateway/tests/authorizeObligations.test.ts
import axios from 'axios';
import { PingOneAuthorizeClient, summarizeIndeterminate } from '../src/auth/PingOneAuthorizeClient';
import { classifyStatement, classifyStatements } from '../src/auth/authorizeObligations';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

/**
 * The gateway used to read ONLY the top-level `decision` field and treat
 * INDETERMINATE as "a human must approve". That is the MOCK authz server's
 * shape. Live PingOne Authorize cannot return INDETERMINATE for an obligation —
 * a rule effect is `unconditionalPermit` or `conditionalDenyElsePermit`, and
 * INDETERMINATE is what P1AZ returns when a condition could not be EVALUATED.
 * Live returns `decision: PERMIT` with the applied rule effects in
 * `statements[]`, so reading the label alone FORWARDED every call the real PDP
 * had attached a consent obligation to — silently, and only against the cloud.
 *
 * These tests pin the real-first behaviour on both shapes.
 */

const baseConfig: any = {
  pingAuthorizeEndpoint: 'https://real.example/authz',
  pingAuthorizeMockBase: 'https://real.example/authz', // same → no failover noise
  pingAuthorizeWorkerId: 'mcp-gateway',
  gatewayResourceUri: 'mcpgateway.ping.demo',
  p1azEnabled: true,
};
const decoded: any = { sub: 'u1', scope: 'read write', act: { sub: 'agent' } };

describe('classifyStatements — same vocabulary as the BFF classifier', () => {
  it('reads HITL_CONSENT as consent, not as plain HITL (most specific wins)', () => {
    expect(classifyStatement({ code: 'HITL_CONSENT' })).toBe('consent');
    expect(classifyStatement({ code: 'HITL' })).toBe('hitl');
  });

  it('normalizes separators and case, so hyphenated cloud codes match', () => {
    expect(classifyStatement({ code: 'step-up-required' })).toBe('stepUp');
    expect(classifyStatement({ code: 'MCP_STEP_UP_REQUIRED' })).toBe('stepUp');
    expect(classifyStatement({ code: 'hitl-consent-required' })).toBe('consent');
  });

  it('falls back through type/id/name so either shape classifies', () => {
    expect(classifyStatement({ name: 'Transaction Consent Required' })).toBe(null);
    expect(classifyStatement({ name: 'HITL Approval Required' })).toBe('hitl');
    expect(classifyStatement({ type: 'STEP_UP' })).toBe('stepUp');
  });

  it('ignores statements that carry no obligation', () => {
    expect(classifyStatements([{ code: 'mcp-tool-authorized' }])).toBe(null);
    expect(classifyStatements([])).toBe(null);
    expect(classifyStatements(undefined)).toBe(null);
  });

  it('applies highest-gate-wins: step-up outranks consent', () => {
    // A $600 transfer is over BOTH the step-up and the consent threshold. It must
    // demo as step-up, matching demo_api_server/services/authorizeObligations.js.
    expect(classifyStatements([{ code: 'HITL_CONSENT' }, { code: 'STEP_UP_REQUIRED' }])).toBe('stepUp');
  });

  it('classifies ELICITATION statement as elicitation', () => {
    const result = classifyStatement({ code: 'ELICITATION' });
    expect(result).toBe('elicitation');
  });

  it('classifies ELICITATION case-insensitively', () => {
    expect(classifyStatement({ code: 'elicitation' })).toBe('elicitation');
    expect(classifyStatement({ name: 'Elicitation-Required' })).toBe('elicitation');
  });
});

describe('PingOneAuthorizeClient — a live PERMIT can still carry a gate', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does NOT permit a PERMIT that carries a consent obligation', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      status: 200,
      data: { decision: 'PERMIT', statements: [{ code: 'HITL_CONSENT' }] },
    });
    const client = new PingOneAuthorizeClient(baseConfig);
    const d = await client.evaluate(decoded, 'tools/call', 'create_transfer');
    expect(d.decision).not.toBe('PERMIT');
    expect(d.reason).toBe('HITL_REQUIRED');
    expect(d.obligation).toBe('consent');
  });

  it('surfaces a step-up obligation distinctly from a consent hold', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      status: 200,
      data: { decision: 'PERMIT', statements: [{ code: 'step-up-required' }] },
    });
    const client = new PingOneAuthorizeClient(baseConfig);
    const d = await client.evaluate(decoded, 'tools/call', 'create_transfer');
    expect(d.obligation).toBe('stepUp');
    expect(d.reason).toBe('STEP_UP_REQUIRED');
  });

  it('still permits a bare PERMIT with no obligation', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      status: 200,
      data: { decision: 'PERMIT', statements: [{ code: 'mcp-tool-authorized' }] },
    });
    const client = new PingOneAuthorizeClient(baseConfig);
    const d = await client.evaluate(decoded, 'tools/call', 'get_my_accounts');
    expect(d.decision).toBe('PERMIT');
    expect(d.obligation).toBeUndefined();
  });

  it('keeps honouring the mock INDETERMINATE shape, and reads its statements too', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      status: 200,
      data: { decision: 'INDETERMINATE', reason: 'STEP_UP', statements: [{ code: 'step-up-required' }] },
    });
    const client = new PingOneAuthorizeClient(baseConfig);
    const d = await client.evaluate(decoded, 'tools/call', 'create_transfer');
    expect(d.decision).toBe('INDETERMINATE');
    expect(d.obligation).toBe('stepUp');
    expect(d.reason).toBe('STEP_UP_REQUIRED');
  });

  it('a DENY is terminal — obligations never soften it', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      status: 200,
      data: { decision: 'DENY', reason: 'amount over limit', statements: [{ code: 'HITL_CONSENT' }] },
    });
    const client = new PingOneAuthorizeClient(baseConfig);
    const d = await client.evaluate(decoded, 'tools/call', 'create_transfer');
    expect(d.decision).toBe('DENY');
  });

  // INDETERMINATE with NO classifiable obligation is not a legitimate step-up
  // or consent ask — it means the PDP could not produce a real verdict (no
  // rule fired, an unrecognized statement code, or absent statements). That is
  // a policy engine fault, not a business decision: it must resolve to a
  // concrete PERMIT/DENY instead of masquerading as a HITL challenge the
  // agent would then loop on forever.
  it('resolves an INDETERMINATE with no obligation to DENY (fail closed)', async () => {
    // P1AZ "could not evaluate" = missing operand or no rule fired.
    // Fail-closed: unknown outcome must never widen access.
    mockedAxios.post.mockResolvedValueOnce({
      status: 200,
      data: { decision: 'INDETERMINATE', reason: 'policy could not evaluate' },
    });
    const client = new PingOneAuthorizeClient(baseConfig);
    const d = await client.evaluate(decoded, 'tools/call', 'create_transfer');
    expect(d.decision).toBe('DENY');
    expect(d.obligation).toBeUndefined();
  });

  it('resolves an INDETERMINATE with unrecognized statements to DENY', async () => {
    // Unrecognised statement code = PDP gave an answer we cannot parse.
    // Fail-closed: ambiguous ≠ permitted.
    mockedAxios.post.mockResolvedValueOnce({
      status: 200,
      data: { decision: 'INDETERMINATE', reason: 'n/a', statements: [{ code: 'unrelated-statement' }] },
    });
    const client = new PingOneAuthorizeClient(baseConfig);
    const d = await client.evaluate(decoded, 'tools/call', 'create_transfer');
    expect(d.decision).toBe('DENY');
  });

  it('resolves an INDETERMINATE with an explicit deny reason to DENY, not permit', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      status: 200,
      data: { decision: 'INDETERMINATE', reason: 'deny: policy engine could not confirm eligibility' },
    });
    const client = new PingOneAuthorizeClient(baseConfig);
    const d = await client.evaluate(decoded, 'tools/call', 'create_transfer');
    expect(d.decision).toBe('DENY');
  });
});

// Phase 5's second half: "surface the missing attribute". PingOne has no
// dedicated `missingAttribute` field — it names the offending attribute in
// `statements[].payload` prose. The fixture below is the REAL payload shape
// captured live 2026-08-19 from this exact decision endpoint (a DENY for a
// request omitting UserId), not an invented one.
describe('summarizeIndeterminate — surfaces what the response actually carries', () => {
  const LIVE_MISSING_USER_ID_STATEMENT = {
    name: 'MCP Denied — Missing User ID',
    code: 'mcp-missing-user-id',
    payload: '{"denied": true, "reason": "missing-user-id", "message": "No user identity found in the MCP token delegation chain. UserId is required for all Super Banking MCP tool invocations."}',
    obligatory: false,
    fulfilled: false,
  };

  it('names the missing attribute from the live statement payload', () => {
    const summary = summarizeIndeterminate({
      decision: 'INDETERMINATE',
      statements: [LIVE_MISSING_USER_ID_STATEMENT],
      status: { code: 'OKAY' },
    });
    expect(summary).toContain('mcp-missing-user-id');
    // The whole point: the operator sees WHICH attribute, not just "failed".
    expect(summary).toContain('UserId is required');
    expect(summary).toContain('status=OKAY');
  });

  it('falls back to the payload `reason` when there is no message', () => {
    const summary = summarizeIndeterminate({
      statements: [{ code: 'some-code', payload: '{"reason":"attribute-provider-unreachable"}' }],
    });
    expect(summary).toContain('attribute-provider-unreachable');
  });

  it('surfaces a non-JSON payload raw rather than dropping it', () => {
    const summary = summarizeIndeterminate({
      statements: [{ code: 'weird', payload: 'not json at all' }],
    });
    expect(summary).toContain('not json at all');
  });

  it('says so plainly when there are no statements — the bare INDETERMINATE case', () => {
    const summary = summarizeIndeterminate({ decision: 'INDETERMINATE', reason: 'could not evaluate' });
    expect(summary).toContain('statements=(none)');
    expect(summary).toContain('reason=could not evaluate');
  });

  it('never throws on malformed input — a diagnostic must not break the decision path', () => {
    expect(() => summarizeIndeterminate(undefined)).not.toThrow();
    expect(() => summarizeIndeterminate(null)).not.toThrow();
    expect(() => summarizeIndeterminate({ statements: 'not-an-array' })).not.toThrow();
    expect(() => summarizeIndeterminate({ statements: [null, 42] })).not.toThrow();
  });

  it('is actually wired into the fail-closed path (logged, not just exported)', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockedAxios.post.mockResolvedValueOnce({
      status: 200,
      data: {
        decision: 'INDETERMINATE',
        statements: [LIVE_MISSING_USER_ID_STATEMENT],
      },
    });
    const client = new PingOneAuthorizeClient(baseConfig);
    const d = await client.evaluate(decoded, 'tools/call', 'create_transfer');

    expect(d.decision).toBe('DENY');
    const logged = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('UserId is required');
    warn.mockRestore();
  });
});

// INDETERMINATE-rework phase 3: the demo PDP now sends an EXPLICIT
// `obligations: [{ id, type, obligatory, fulfilled }]` array on every pause
// (phase 2). The client prefers it over statement inference — the structural
// contract the rework migrates everything onto — with statements kept as the
// fallback for engines that have not adopted it.
describe('explicit obligations[] (phase 2 contract) is preferred over statement inference', () => {
  const pauses: Array<[string, string, string]> = [
    ['step-up', 'STEP_UP', 'stepUp'],
    ['hitl-consent', 'HITL_CONSENT', 'consent'],
    ['elicitation-confirm', 'ELICITATION', 'elicitation'],
  ];

  it.each(pauses)('classifies a pause from obligations[] alone (no statements): %s', async (id, type, kind) => {
    // Before this change, obligations-only responses hit the fail-closed DENY
    // branch — the pause was only readable through statements.
    mockedAxios.post.mockResolvedValueOnce({
      status: 200,
      data: {
        decision: 'INDETERMINATE',
        reason: type,
        obligations: [{ id, type, obligatory: true, fulfilled: false }],
      },
    });
    const client = new PingOneAuthorizeClient(baseConfig);
    const d = await client.evaluate(decoded, 'tools/call', 'create_transfer');
    expect(d.decision).toBe('INDETERMINATE');
    expect(d.obligation).toBe(kind);
  });

  it('explicit obligation wins when statements disagree', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      status: 200,
      data: {
        decision: 'INDETERMINATE',
        obligations: [{ id: 'step-up', type: 'STEP_UP', obligatory: true, fulfilled: false }],
        statements: [{ code: 'HITL_CONSENT' }],
      },
    });
    const client = new PingOneAuthorizeClient(baseConfig);
    const d = await client.evaluate(decoded, 'tools/call', 'create_transfer');
    expect(d.obligation).toBe('stepUp');
  });

  it('statements still classify when no obligations[] is present (fallback intact)', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      status: 200,
      data: { decision: 'INDETERMINATE', statements: [{ code: 'HITL_CONSENT' }] },
    });
    const client = new PingOneAuthorizeClient(baseConfig);
    const d = await client.evaluate(decoded, 'tools/call', 'create_transfer');
    expect(d.decision).toBe('INDETERMINATE');
    expect(d.obligation).toBe('consent');
  });
});
