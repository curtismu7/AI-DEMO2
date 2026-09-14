import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { computeStepsThroughIndex, standardClaimsFor } from '../ArchitectureFlowPage';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = path.join(DIR, '..', 'ArchitectureFlowPage.js');

function steps() {
  return [
    { nodeIds: ['user', 'chatbot'], colorClass: 'active', stepLabel: 'step0', activeEdgeIds: ['user-chatbot'], nodeBadges: {} },
    { nodeIds: ['chatbot', 'agent'], colorClass: 'active', stepLabel: 'step1', activeEdgeIds: ['chatbot-agent'], nodeBadges: { agent: { aud: 'x' } } },
    { nodeIds: ['agent', 'idp'], colorClass: 'active-permit', stepLabel: 'step2', activeEdgeIds: ['agent-idp'], nodeBadges: {} },
  ];
}

describe('computeStepsThroughIndex — progressive reveal accumulator', () => {
  it('only includes nodes/edges touched by steps 0..i, not later steps', () => {
    const { nodeMeta, edgeIdsSoFar } = computeStepsThroughIndex(steps(), 0);
    expect(Object.keys(nodeMeta).sort()).toEqual(['chatbot', 'user']);
    expect(edgeIdsSoFar).toEqual(new Set(['user-chatbot']));
    // step 2's node/edge must not leak in yet
    expect(nodeMeta.idp).toBeUndefined();
    expect(edgeIdsSoFar.has('agent-idp')).toBe(false);
  });

  it('accumulates nodes/edges as the index advances, marking earlier steps active-prev', () => {
    const { nodeMeta, edgeIdsSoFar } = computeStepsThroughIndex(steps(), 2);
    expect(Object.keys(nodeMeta).sort()).toEqual(['agent', 'chatbot', 'idp', 'user']);
    expect(edgeIdsSoFar).toEqual(new Set(['user-chatbot', 'chatbot-agent', 'agent-idp']));
    expect(nodeMeta.user.colorClass).toBe('active-prev');
    expect(nodeMeta.chatbot.colorClass).toBe('active-prev');
    expect(nodeMeta.idp.colorClass).toBe('active-permit'); // current step keeps its own colorClass
  });

  it('carries a badge forward across later steps that revisit the same node without their own badge', () => {
    const { nodeMeta } = computeStepsThroughIndex(steps(), 2);
    // "agent" got a badge at step 1 and reappears at step 2 with no nodeBadges entry —
    // the badge must survive, not be wiped by step 2's nodeIds pass.
    expect(nodeMeta.agent.badge).toEqual({ aud: 'x' });
  });
});

describe('standardClaimsFor — synthesized standard JWT claims', () => {
  it('returns null for non-token payloads (decision/response objects)', () => {
    expect(standardClaimsFor({ _type: 'mcp' })).toBeNull();
    expect(standardClaimsFor({ _type: 'permit' })).toBeNull();
    expect(standardClaimsFor({ _type: 'hitl' })).toBeNull();
    expect(standardClaimsFor({ _type: 'error' })).toBeNull();
    expect(standardClaimsFor({})).toBeNull();
  });

  it('returns iat/exp/jti for real token types, with exp after iat', () => {
    for (const type of ['oauth', 'idtoken', 'exchange']) {
      const claims = standardClaimsFor({ _type: type, aud: 'x' });
      expect(claims).not.toBeNull();
      expect(new Date(claims.exp).getTime()).toBeGreaterThan(new Date(claims.iat).getTime());
      expect(claims.jti).toMatch(/^[0-9a-f]+$/);
    }
  });

  it('jti is deterministic for identical token content, and differs for different content', () => {
    const a = standardClaimsFor({ _type: 'oauth', sub: 'alice' });
    const b = standardClaimsFor({ _type: 'oauth', sub: 'alice' });
    const c = standardClaimsFor({ _type: 'oauth', sub: 'bob' });
    expect(a.jti).toBe(b.jti);
    expect(a.jti).not.toBe(c.jti);
  });

  it('treats an untyped-but-token-shaped payload (has aud, no decision fields) as a token', () => {
    // Several hand-authored steps omit _type entirely on real bearer tokens
    // (e.g. "Agent Token (tools/list)": { type, aud, scope, note }) — these
    // must still get standard claims, not just objects with an explicit _type.
    expect(standardClaimsFor({ type: 'Agent Token', aud: 'agent1', scope: 'mcp:invoke' })).not.toBeNull();
  });

  it('does not treat an untyped non-token signal/request payload as a token', () => {
    // No `aud` at all — an internal UI signal, not a bearer token.
    expect(standardClaimsFor({ type: 'User Context Required', resource: 'agent1', required_scope: 'balance' })).toBeNull();
    // Has `aud`-like shape but is a PingOne Authorize decision/request — never a token itself.
    expect(standardClaimsFor({ type: 'Authorization Decision', decision: '✅ PERMIT', DecisionContext: 'McpToolCall' })).toBeNull();
    expect(standardClaimsFor({ type: 'PingOne Authorization Server Request', DecisionContext: 'McpToolCall', TokenAudience: 'mcp-gw' })).toBeNull();
  });
});

describe('ArchitectureFlowPage scenario data — pinned accuracy fixes', () => {
  const src = readFileSync(SOURCE_PATH, 'utf8');

  it('never emits the invented "McpToolsList" DecisionContext (real client only sends McpToolCall/McpRequest)', () => {
    expect(src).not.toMatch(/McpToolsList/);
  });

  it('never emits invented P1AZ policy identifiers', () => {
    expect(src).not.toMatch(/mcp-tools-access-v2|mcp-tool-call-v2|tool-scope-balance-v2/);
  });

  it('depicts the real gateway-to-backend RFC 8693 Exchange #3 instead of a passthrough claim', () => {
    expect(src).not.toMatch(/forward(s)? TX token unchanged/);
    expect(src).not.toMatch(/No second RFC 8693 exchange/);
    expect(src).toMatch(/Exchange #3/);
    expect(src).toMatch(/mcpserver\.ping\.demo/);
  });

  it('never claims an RFC 8693 exchange happens on the OAuth Bearer Path (Path C)', () => {
    const scenarioStart = src.indexOf('"oauth-bearer-path": [');
    const scenarioEnd = src.indexOf('\n};', scenarioStart);
    const scenario = src.slice(scenarioStart, scenarioEnd);
    expect(scenario).not.toMatch(/RFC 8693 token exchange/);
    expect(scenario).toMatch(/no RFC 8693 exchange/);
  });

  it('the Withdrawal + HITL scenario shows PERMIT + obligation, not a bare INDETERMINATE', () => {
    const scenarioStart = src.indexOf('withdrawal: [');
    const scenarioEnd = src.indexOf('\n  ],', scenarioStart);
    const scenario = src.slice(scenarioStart, scenarioEnd);
    // The old wrong decision value must be gone; a note may still mention the
    // word "INDETERMINATE" itself to explain the correction, so check the
    // specific decision string, not the bare word.
    expect(scenario).not.toMatch(/decision: "⚠️ INDETERMINATE"/);
    expect(scenario).toMatch(/HITL_CONSENT/);
  });

  it('the ID Token Exchange scenario does not cite RFC 8693 on the login-issued access token', () => {
    const scenarioStart = src.indexOf('"id-token": [');
    const accessTokenStart = src.indexOf('type: "Access Token"', scenarioStart);
    const rfcsLine = src.slice(accessTokenStart, accessTokenStart + 200);
    expect(rfcsLine).not.toMatch(/RFC 8693/);
    expect(rfcsLine).toMatch(/RFC 9068/);
  });
});
