import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { computeStepsThroughIndex } from '../ArchitectureFlowPage';

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
