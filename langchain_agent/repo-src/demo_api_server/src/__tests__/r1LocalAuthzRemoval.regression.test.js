/**
 * @file r1LocalAuthzRemoval.regression.test.js
 *
 * Architecture-note R1 (docs/architecture-notes/2026-05-15-agent-local-authz-smell.md)
 * / ARCHITECTURE-TRUTHS T-2.
 *
 * R1 removed the BFF's redundant LOCAL authorization decision (the former
 * `agentMcpScopePolicy` scope-allow-list veto in
 * resolveMcpAccessTokenWithEvents that threw `agent_mcp_scope_denied` 403).
 * After R1, whether an MCP tool call is permitted is decided SOLELY by
 * PingAuthorize via mcpToolAuthorizationService.evaluateMcpFirstToolGate.
 *
 * These regression tests pin R1's intent:
 *   1. PingAuthorize is authoritative — a tool the OLD local scope map would
 *      have vetoed (create_transfer with write absent from
 *      agent_mcp_allowed_scopes) is now decided only by the gate:
 *        - simulated DENY  → still blocked (403)
 *        - simulated PERMIT → now allowed (the local veto no longer fires)
 *   2. The deleted module is gone and nothing imports it for authorization.
 *   3. The surviving MCP_TOOL_SCOPES catalog still exposes per-tool scopes
 *      (used for RFC 8693 request scopes + the MCP Inspector hint) — catalog
 *      role preserved, authz role removed.
 */

'use strict';

const path = require('path');
const fs = require('fs');

// ── Mocks for the authoritative gate (PingAuthorize / simulated) ──────────────
jest.mock('../../services/configStore');
jest.mock('../../services/pingOneAuthorizeService', () => ({
  evaluateMcpToolDelegation: jest.fn(),
  isMcpDelegationDecisionReady: jest.fn(),
}));
jest.mock('../../services/simulatedAuthorizeService', () => ({
  evaluateMcpFirstTool: jest.fn(),
  isSimulatedModeEnabled: jest.fn(),
}));

const configStore = require('../../services/configStore');
const pingOneAuthorizeService = require('../../services/pingOneAuthorizeService');
const simulatedAuthorizeService = require('../../services/simulatedAuthorizeService');
const { evaluateMcpFirstToolGate } = require('../../services/mcpToolAuthorizationService');
const { MCP_TOOL_SCOPES } = require('../../services/mcpWebSocketClient');

function jwtWithPayload(payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `eyJhbGciOiJub25lIn0.${body}.x`;
}

// create_transfer requires write. Under the OLD agentMcpScopePolicy
// veto, a config of agent_mcp_allowed_scopes='read' would have thrown
// agent_mcp_scope_denied (403) BEFORE the exchange and BEFORE the gate. We
// simulate that "old map would block" scenario and prove the verdict now comes
// only from the authoritative gate.
const TOOL_OLD_MAP_WOULD_BLOCK = 'create_transfer';
const AGENT_TOKEN = jwtWithPayload({ sub: 'u1', aud: 'mcp-resource', act: { client_id: 'bff' } });

describe('R1: PingAuthorize is the sole authoritative MCP tool gate (T-2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    configStore.get.mockImplementation(() => null);
    configStore.getEffective = jest.fn(() => null);
    // Use the simulated authorize backend as the authoritative decision maker.
    simulatedAuthorizeService.isSimulatedModeEnabled.mockReturnValue(true);
    pingOneAuthorizeService.isMcpDelegationDecisionReady.mockReturnValue(false);
  });

  it('simulated DENY blocks a tool the old local scope map would also have blocked', async () => {
    simulatedAuthorizeService.evaluateMcpFirstTool.mockResolvedValue({
      decision: 'DENY',
      decisionId: 'dec-deny-1',
    });

    const r = await evaluateMcpFirstToolGate({
      req: { session: {} },
      tool: TOOL_OLD_MAP_WOULD_BLOCK,
      agentToken: AGENT_TOKEN,
      userSub: 'u1',
      toolParams: { amount: 250 },
    });

    expect(r.ran).toBe(true);
    expect(r.block).toBeDefined();
    expect(r.block.status).toBe(403);
    expect(r.block.body.error).toBe('mcp_authorization_denied');
    // The decision came from the authoritative engine, not a local scope map.
    expect(r.block.body.authorize_engine).toBe('simulated');
  });

  it('simulated PERMIT now ALLOWS the same tool — the removed local veto no longer overrides PingAuthorize', async () => {
    simulatedAuthorizeService.evaluateMcpFirstTool.mockResolvedValue({
      decision: 'PERMIT',
      path: 'mcp-first-tool',
      decisionId: 'dec-permit-1',
    });

    const r = await evaluateMcpFirstToolGate({
      req: { session: {} },
      tool: TOOL_OLD_MAP_WOULD_BLOCK,
      agentToken: AGENT_TOKEN,
      userSub: 'u1',
      toolParams: { amount: 250 },
    });

    // Pre-R1 the local agentMcpScopePolicy veto would have thrown
    // agent_mcp_scope_denied for this tool regardless of PingAuthorize's
    // verdict. Post-R1 PERMIT is authoritative and the call is allowed.
    expect(r.ran).toBe(true);
    expect(r.permit).toBe(true);
    expect(r.block).toBeUndefined();
    expect(r.evaluation.decision).toBe('PERMIT');
  });
});

describe('R1: the local authz module is deleted and unreferenced for authorization', () => {
  it('services/agentMcpScopePolicy.js no longer exists', () => {
    const deleted = path.join(__dirname, '..', '..', 'services', 'agentMcpScopePolicy.js');
    expect(fs.existsSync(deleted)).toBe(false);
  });

  it('requiring the deleted module throws (no code path can consult it)', () => {
    expect(() => require('../../services/agentMcpScopePolicy')).toThrow();
  });

  it('no source file imports the deleted module', () => {
    const serverRoot = path.join(__dirname, '..', '..');
    const offenders = [];
    const skipDirs = new Set(['node_modules', '.git', 'tests', '__tests__', 'test-results', 'data', 'coverage']);
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (!skipDirs.has(entry.name)) walk(path.join(dir, entry.name));
          continue;
        }
        if (!entry.name.endsWith('.js')) continue;
        if (entry.name.includes('.test.')) continue;
        const full = path.join(dir, entry.name);
        const src = fs.readFileSync(full, 'utf8');
        if (/require\(['"][^'"]*agentMcpScopePolicy['"]\)/.test(src)) {
          offenders.push(path.relative(serverRoot, full));
        }
      }
    };
    walk(serverRoot);
    expect(offenders).toEqual([]);
  });
});

describe('R1: surviving catalog role preserved (MCP_TOOL_SCOPES is data, not an authz oracle)', () => {
  it('still maps tools to their RFC 8693 / Inspector-hint scopes', () => {
    expect(MCP_TOOL_SCOPES.get_my_accounts).toEqual(['read']);
    // create_transfer requires write AND transfer (granular scope model)
    expect(MCP_TOOL_SCOPES.create_transfer).toEqual(['write', 'transfer']);
  });

  it('the catalog has no duplicate scope entries for any tool (WR-02 cannot recur here)', () => {
    for (const [tool, scopes] of Object.entries(MCP_TOOL_SCOPES)) {
      expect(new Set(scopes).size).toBe(scopes.length); // eslint-disable-line no-undef
      expect(Array.isArray(scopes)).toBe(true);
      expect(tool.length).toBeGreaterThan(0);
    }
  });
});
