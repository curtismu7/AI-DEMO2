/**
 * @file authzGateFailOpen.test.js
 *
 * Fail-open / invisible-skip hardening for the BFF MCP first-tool gate
 * (docs/authorization-decision-split.md F3 + F5, planning/authz-fix-contract.md
 * C1 + C4).
 *
 * Three defects pinned here:
 *   F5.1  admin role skipped the ENTIRE authorization gate in code.
 *   F5.2  failoverMode='permit' returned a bare {ran:false} — indistinguishable
 *         from a PERMIT to the caller (violates C4 "omission is not permission").
 *   F3    the BFF never sent ActChainDepth / TokenScopes, so the two PDP gates
 *         evaluated different inputs.
 */

jest.mock('../../services/configStore');
jest.mock('../../services/pingOneAuthorizeService', () => ({
  evaluateMcpToolDelegation: jest.fn(),
  isMcpDelegationDecisionReady: jest.fn(),
}));
jest.mock('../../services/simulatedAuthorizeService', () => ({
  evaluateMcpFirstTool: jest.fn(),
  isSimulatedModeEnabled: jest.fn(),
  resolveAuthorizeMode: jest.fn(),
  buildAuthorizeFallbackSignal: jest.fn(() => ({ occurred: true })),
}));
jest.mock('../../services/hitlServiceClient', () => ({
  getChallengeStatus: jest.fn(),
  verifyHitlReceipt: jest.fn(),
}));

const configStore = require('../../services/configStore');
const pingOneAuthorizeService = require('../../services/pingOneAuthorizeService');
const simulatedAuthorizeService = require('../../services/simulatedAuthorizeService');
const {
  evaluateMcpFirstToolGate,
  resolveExpectedMcpResourceUri,
} = require('../../services/mcpToolAuthorizationService');

function jwtWithPayload(payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `eyJhbGciOiJub25lIn0.${body}.x`;
}

const PERMIT = { decision: 'PERMIT', stepUpRequired: false, raw: {}, decisionId: 'd1' };

describe('MCP first-tool gate — fail-open hardening', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    configStore.get.mockImplementation(() => null);
    configStore.getEffective = jest.fn((k) => configStore.get(k));
    simulatedAuthorizeService.isSimulatedModeEnabled.mockReturnValue(false);
    simulatedAuthorizeService.resolveAuthorizeMode.mockReturnValue({
      mode: 'pingone', useSimulated: false, failoverMode: 'deny',
    });
    pingOneAuthorizeService.isMcpDelegationDecisionReady.mockReturnValue(true);
    pingOneAuthorizeService.evaluateMcpToolDelegation.mockResolvedValue(PERMIT);
  });

  // ── F5.1 — admin bypass ────────────────────────────────────────────────────
  describe('admin role (F5)', () => {
    it('RUNS the gate for an admin session instead of skipping it', async () => {
      const r = await evaluateMcpFirstToolGate({
        req: { session: { user: { role: 'admin' } } },
        tool: 'create_transfer',
        agentToken: jwtWithPayload({ sub: 'u1', aud: 'mcp' }),
        userSub: 'u1',
      });
      expect(pingOneAuthorizeService.evaluateMcpToolDelegation).toHaveBeenCalled();
      expect(r).toMatchObject({ ran: true, permit: true });
    });

    it('forwards the role as a policy input (userRole), not a code-level skip', async () => {
      await evaluateMcpFirstToolGate({
        req: { session: { user: { role: 'admin' } } },
        tool: 'create_transfer',
        agentToken: jwtWithPayload({ sub: 'u1', aud: 'mcp' }),
        userSub: 'u1',
      });
      const args = pingOneAuthorizeService.evaluateMcpToolDelegation.mock.calls[0][0];
      expect(args.userRole).toBe('admin');
    });

    it('lets policy DENY an admin (the bypass previously made this impossible)', async () => {
      pingOneAuthorizeService.evaluateMcpToolDelegation.mockResolvedValue({
        decision: 'DENY', raw: { reason: 'admin_not_permitted' }, decisionId: 'd2',
      });
      const r = await evaluateMcpFirstToolGate({
        req: { session: { user: { role: 'admin' } } },
        tool: 'create_transfer',
        agentToken: jwtWithPayload({ sub: 'u1', aud: 'mcp' }),
        userSub: 'u1',
      });
      expect(r).toMatchObject({ ran: true, block: { status: 403 } });
      expect(r.block.body.error).toBe('mcp_authorization_denied');
    });
  });

  // ── F5.2 — failover=permit must be an INSPECTABLE skip (contract C4) ───────
  describe('failoverMode=permit skips are inspectable (C4)', () => {
    it('carries skipReason when the decision endpoint is not configured', async () => {
      pingOneAuthorizeService.isMcpDelegationDecisionReady.mockReturnValue(false);
      simulatedAuthorizeService.resolveAuthorizeMode.mockReturnValue({
        mode: 'pingone', useSimulated: false, failoverMode: 'permit',
      });
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const r = await evaluateMcpFirstToolGate({
        req: { session: {} },
        tool: 'get_my_accounts',
        agentToken: jwtWithPayload({ sub: 'u1', aud: 'mcp' }),
        userSub: 'u1',
      });

      expect(r.ran).toBe(false);
      expect(r.skipReason).toBe('authorize_not_configured_failover_permit');
      // The caller must be able to tell "gate did not run" from "gate PERMITted".
      expect(r.permit).toBeUndefined();
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it('carries skipReason when the PDP call itself fails', async () => {
      simulatedAuthorizeService.resolveAuthorizeMode.mockReturnValue({
        mode: 'pingone', useSimulated: false, failoverMode: 'permit',
      });
      pingOneAuthorizeService.evaluateMcpToolDelegation.mockRejectedValue(
        new Error('ECONNREFUSED'),
      );
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

      const r = await evaluateMcpFirstToolGate({
        req: { session: {} },
        tool: 'get_my_accounts',
        agentToken: jwtWithPayload({ sub: 'u1', aud: 'mcp' }),
        userSub: 'u1',
      });

      expect(r.ran).toBe(false);
      expect(r.skipReason).toBe('pingone_error_failover_permit');
      expect(r.permit).toBeUndefined();
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it('carries skipReason when there is no agent token', async () => {
      const r = await evaluateMcpFirstToolGate({
        req: { session: {} }, tool: 'get_my_accounts', agentToken: null,
      });
      expect(r).toMatchObject({ ran: false, skipReason: 'no_agent_token' });
    });
  });

  // ── F3 — the BFF must send the C1 keys it was missing ─────────────────────
  describe('C1 parameter parity (F3)', () => {
    it('derives tokenScopes and the temporal claims from the presented token', async () => {
      await evaluateMcpFirstToolGate({
        req: { session: {} },
        tool: 'create_transfer',
        agentToken: jwtWithPayload({
          sub: 'u1', aud: 'mcp', scope: 'gateway:mcp:invoke banking:transfers:write',
          exp: 1900000000, iat: 1800000000, nbf: 1800000000,
          iss: 'https://auth.pingone.com/env-123/as',
          may_act: { sub: 'agent-1' },
        }),
        userSub: 'u1',
      });
      const args = pingOneAuthorizeService.evaluateMcpToolDelegation.mock.calls[0][0];
      expect(args.tokenScopes).toBe('gateway:mcp:invoke banking:transfers:write');
      expect(args.tokenExp).toBe(1900000000);
      expect(args.tokenIat).toBe(1800000000);
      expect(args.tokenNbf).toBe(1800000000);
      expect(args.tokenIss).toBe('https://auth.pingone.com/env-123/as');
      expect(args.mayActSub).toBe('agent-1');
      expect(args.clientId).toBe('u1');
    });

    it('leaves absent token facts undefined rather than fabricating them', async () => {
      await evaluateMcpFirstToolGate({
        req: { session: {} },
        tool: 'get_my_accounts',
        agentToken: jwtWithPayload({ sub: 'u1', aud: 'mcp' }),
        userSub: 'u1',
      });
      const args = pingOneAuthorizeService.evaluateMcpToolDelegation.mock.calls[0][0];
      expect(args.tokenScopes).toBeNull();
      expect(args.tokenExp).toBeNull();
      expect(args.mayActSub).toBeNull();
    });
  });

  // ── Undefined flag read (ff_two_exchange_delegation) ──────────────────────
  // The key has no FIELD_DEFS entry and no featureFlags registry row, so
  // getEffective() returned undefined and `!== 'false'` was permanently true.
  // The real driver is req.session.mcpExchangeMode (agentMcpTokenService).
  it('never reads the unregistered ff_two_exchange_delegation flag', () => {
    resolveExpectedMcpResourceUri();
    const keysRead = configStore.getEffective.mock.calls.map((c) => c[0]);
    expect(keysRead).not.toContain('ff_two_exchange_delegation');
  });

  // ── No invented endpoints (REGRESSION_PLAN §3 — no hardcoded hosts/ports) ──
  // Each branch ended in `|| 'https://api.ping.demo:<port>/mcp'`. That literal
  // contradicted the function's own JSDoc ("or '' when nothing is configured")
  // and is the same defect class as a fabricated audience: an unconfigured
  // deployment silently got a made-up expected resource, so the audience guard
  // compared real tokens against an endpoint nobody configured.
  describe('expected MCP resource URI resolution', () => {
    const HOST_LITERAL = /https?:\/\/[^'"]+/;

    beforeEach(() => {
      configStore.get.mockReturnValue(null);
      configStore.getEffective.mockReturnValue(null);
      delete process.env.MCP_GATEWAY_HTTP_URL;
      delete process.env.PINGONE_RESOURCE_PINGGATEWAY_URI;
    });

    it('returns empty when nothing is configured, rather than inventing a host', () => {
      expect(resolveExpectedMcpResourceUri()).toBe('');
    });

    it('returns empty on the Node-gateway branch too', () => {
      process.env.MCP_GATEWAY_HTTP_URL = 'http://gw.internal';
      expect(resolveExpectedMcpResourceUri()).toBe('');
    });

    it('returns empty on the PingGateway branch too', () => {
      configStore.getEffective.mockImplementation((k) =>
        k === 'ff_mcp_gateway_pinggateway' ? 'true' : null,
      );
      expect(resolveExpectedMcpResourceUri()).toBe('');
    });

    it('still returns the configured value when one exists', () => {
      configStore.getEffective.mockImplementation((k) =>
        k === 'pingone_resource_two_exchange_uri' ? 'https://configured.example/mcp' : null,
      );
      expect(resolveExpectedMcpResourceUri()).toBe('https://configured.example/mcp');
    });

    it('has no URL literal left in the source', () => {
      const src = require('fs').readFileSync(
        require('path').join(__dirname, '..', '..', 'services', 'mcpToolAuthorizationService.js'),
        'utf8',
      );
      const body = src.slice(
        src.indexOf('function resolveExpectedMcpResourceUri'),
      );
      const fnBody = body.slice(0, body.indexOf('\n}\n') + 3);
      // Strip comments — the explanatory prose may legitimately name a URI.
      const code = fnBody.replace(/\/\/.*$/gm, '');
      expect(code).not.toMatch(HOST_LITERAL);
    });
  });
});
