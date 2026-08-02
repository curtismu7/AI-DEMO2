// demo_mcp_gateway/tests/authorizeObligations.test.ts
import axios from 'axios';
import { PingOneAuthorizeClient } from '../src/auth/PingOneAuthorizeClient';
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
});
