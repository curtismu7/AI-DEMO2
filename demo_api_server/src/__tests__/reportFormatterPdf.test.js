'use strict';
/**
 * reportFormatterPdf.test.js — Redesigned formatPdf renderer.
 *
 * The fixture exercises every layout feature: exchange legs with narrowing
 * scopes (token-diff block), a CIBA step-up event, a failed event, delegation
 * act chain, and MCP calls with JSON bodies.
 */

const { formatPdf, computeClaimDiff, scopeNarrowing } = require('../../services/reportFormatter');

const FIXTURE_RUN = {
  runId: 'run-fixture-0001',
  userId: 'demoUser',
  vertical: 'banking',
  prompt: 'Transfer $500 from checking to savings, then show my balances.',
  startedAt: '2026-07-10T15:00:00.000Z',
  completedAt: '2026-07-10T15:00:09.000Z',
  success: true,
  agentPath: 'langchain-mcp',
  intent: 'transfer_funds',
  confidence: 0.94,
  toolsCalled: ['create_transfer', 'get_accounts'],
  tokenCount: 4,
  hasCibaStepUp: true,
  tokenEvents: [
    {
      id: 'user-auth',
      label: 'User Access Token (RFC 6749)',
      status: 'active',
      timestamp: '2026-07-10T15:00:01.000Z',
      alg: 'RS256',
      rfc: 'RFC 6749',
      explanation: 'User authenticated via PingOne authorization code flow.',
      claims: {
        sub: 'demoUser',
        aud: 'https://api.ping.demo',
        scope: 'openid profile banking:read banking:write banking:transfer admin',
        iss: 'https://auth.pingone.com/env/as',
      },
    },
    {
      id: 'token-exchange',
      label: 'Agent Token Exchange (RFC 8693)',
      status: 'exchanged',
      timestamp: '2026-07-10T15:00:02.000Z',
      alg: 'RS256',
      rfc: 'RFC 8693',
      eventType: 'exchange',
      explanation: 'User token exchanged for a narrowed agent token carrying the act claim.',
      claims: {
        sub: 'demoUser',
        aud: 'https://mcp.ping.demo',
        scope: 'banking:read banking:transfer',
        iss: 'https://auth.pingone.com/env/as',
        act: { sub: 'ai-agent' },
      },
      exchangeSteps: [
        { step: 'subject_token', description: 'User access token presented', timestamp: '2026-07-10T15:00:02.000Z' },
        { step: 'issued_token', description: 'Narrowed delegated token issued', timestamp: '2026-07-10T15:00:02.500Z' },
      ],
    },
    {
      id: 'ciba-step-up',
      label: 'CIBA Step-Up Approval',
      status: 'success',
      timestamp: '2026-07-10T15:00:05.000Z',
      rfc: 'OpenID CIBA',
      grantedVia: 'ciba',
      explanation: 'Transfer over threshold; user approved on secondary device.',
      claims: {
        sub: 'demoUser',
        aud: 'https://mcp.ping.demo',
        scope: 'banking:read banking:transfer',
        act: { sub: 'specialist-agent', act: { sub: 'ai-agent' } },
      },
    },
    {
      id: 'introspect-fail',
      label: 'Token Introspection (RFC 7662)',
      status: 'failed',
      timestamp: '2026-07-10T15:00:06.000Z',
      rfc: 'RFC 7662',
      explanation: 'Expired token presented; introspection returned active=false.',
      claims: null,
    },
  ],
  mcpToolCallsChain: [
    {
      id: 'call-1',
      timestamp: '2026-07-10T15:00:07.000Z',
      toolName: 'create_transfer',
      status: 'success',
      duration: 412,
      chainIndex: 1,
      isDelegated: true,
      scopes: ['banking:transfer'],
      requestJson: { from: 'checking', to: 'savings', amount: 500 },
      resultJson: { transferId: 'tx-789', status: 'completed' },
      resultSummary: 'Transfer tx-789 completed.',
    },
    {
      id: 'call-2',
      timestamp: '2026-07-10T15:00:08.000Z',
      toolName: 'get_accounts',
      status: 'failed',
      duration: 55,
      chainIndex: 2,
      isDelegated: true,
      scopes: ['banking:read'],
      resultSummary: 'Scope check denied: token lacks banking:read on this resource.',
    },
  ],
};

describe('formatPdf (redesigned)', () => {
  test('renders a valid multi-page PDF buffer from a full fixture run', async () => {
    const buf = await formatPdf(FIXTURE_RUN);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.slice(0, 5).toString()).toBe('%PDF-');
    // Rich layout should comfortably exceed the old flat renderer's size.
    expect(buf.length).toBeGreaterThan(5000);
  });

  test('renders minimal runs (no events, no MCP calls, missing fields)', async () => {
    const buf = await formatPdf({
      runId: 'run-min',
      vertical: 'healthcare',
      prompt: 'hello',
      startedAt: '2026-07-10T15:00:00.000Z',
      completedAt: '2026-07-10T15:00:01.000Z',
      success: false,
    });
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.slice(0, 5).toString()).toBe('%PDF-');
  });
});

describe('computeClaimDiff', () => {
  const prev = FIXTURE_RUN.tokenEvents[0].claims;
  const next = FIXTURE_RUN.tokenEvents[1].claims;

  test('detects removed and kept scopes across an exchange leg', () => {
    const diff = computeClaimDiff(prev, next);
    expect(diff.scopesRemoved).toEqual(
      expect.arrayContaining(['openid', 'profile', 'banking:write', 'admin']),
    );
    expect(diff.scopesAdded).toEqual([]);
  });

  test('detects added act claim and audience change', () => {
    const diff = computeClaimDiff(prev, next);
    expect(diff.claimsAdded).toEqual(expect.arrayContaining(['act']));
    expect(diff.audienceChanged).toEqual({
      from: 'https://api.ping.demo',
      to: 'https://mcp.ping.demo',
    });
  });

  test('returns null when there is nothing to compare or no change', () => {
    expect(computeClaimDiff(null, next)).toBeNull();
    expect(computeClaimDiff(prev, null)).toBeNull();
    expect(computeClaimDiff(prev, prev)).toBeNull();
  });
});

describe('scopeNarrowing', () => {
  test('reports first-to-last scope count across the chain', () => {
    const n = scopeNarrowing(FIXTURE_RUN.tokenEvents);
    expect(n).toEqual({ from: 6, to: 2 });
  });

  test('returns null when scopes never narrow or are absent', () => {
    expect(scopeNarrowing([])).toBeNull();
    expect(scopeNarrowing([{ claims: { scope: 'a b' } }])).toBeNull();
  });
});
