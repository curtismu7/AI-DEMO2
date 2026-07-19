'use strict';

const { project } = require('../../services/traceProjector');
const liveFixture = require('../fixtures/trace-agent-run.json');
const chipFixture = require('../fixtures/trace-chip-run.json');

/** Builds a minimal Jaeger response with one process per service. */
function makeTrace(spans) {
  const services = [...new Set(spans.map((s) => s.service))];
  const processes = Object.fromEntries(services.map((s, i) => [`p${i}`, { serviceName: s }]));
  const pidOf = (svc) => Object.keys(processes).find((k) => processes[k].serviceName === svc);
  return {
    data: [{
      traceID: 'feedfacefeedfacefeedfacefeedface',
      processes,
      spans: spans.map((s, i) => ({
        traceID: 'feedfacefeedfacefeedfacefeedface',
        spanID: `s${i}`,
        processID: pidOf(s.service),
        operationName: s.op,
        startTime: 1_000_000 + i * 1000,
        duration: s.duration ?? 5000,
        references: [],
        tags: Object.entries(s.tags || {}).map(([key, value]) => ({ key, value })),
      })),
    }],
  };
}

describe('traceProjector.project', () => {
  test('empty response projects to empty contract', () => {
    const out = project({ data: [] });
    expect(out).toMatchObject({ traceId: '', outcome: 'ok', spans: [] });
  });

  test('agent reasoning: groups reasoning-step-N spans into one card', () => {
    const out = project(makeTrace([
      { service: 'agent-service', op: 'reasoning-step-1', tags: { provider: 'llamacpp', input_tokens: 100, output_tokens: 40 } },
      { service: 'agent-service', op: 'reasoning-step-2', tags: { provider: 'llamacpp', input_tokens: 120, output_tokens: 30 } },
    ]));
    const card = out.spans.find((s) => s.id === 'agent_reasoning');
    expect(card).toBeDefined();
    expect(card.title).toBe('Agent Reasoning');
    expect(card.ids).toHaveLength(2);
    expect(card.summary).toContainEqual({ facet: 'outcome', value: '2 reasoning steps' });
    expect(card.summary).toContainEqual({ facet: 'additionalMetadata', key: 'provider', value: 'llamacpp' });
  });

  test('tool call: one card per tool-execution span, named from tool_name', () => {
    const out = project(makeTrace([
      { service: 'agent-service', op: 'tool-execution', tags: { tool_name: 'get_accounts', tool_call_id: 'c1' } },
      { service: 'agent-service', op: 'tool-execution', tags: { tool_name: 'create_transfer', tool_call_id: 'c2' } },
    ]));
    const cards = out.spans.filter((s) => s.title === 'Tool Call');
    expect(cards).toHaveLength(2);
    expect(cards[0].summary).toContainEqual({ facet: 'target', value: 'get_accounts' });
  });

  test('token exchange: anchors on demo-api-server POST to /as/token', () => {
    const out = project(makeTrace([
      { service: 'demo-api-server', op: 'POST', tags: { 'http.url': 'https://auth.pingone.com/x/as/token', 'http.status_code': 200 } },
    ]));
    const card = out.spans.find((s) => s.title === 'Token Exchange');
    expect(card).toBeDefined();
    expect(card.status).toBe('ok');
    expect(card.summary).toContainEqual({ facet: 'additionalMetadata', key: 'spec', value: 'RFC 8693 (token exchange)' });
  });

  test('token exchange: HTTP 4xx anchor projects status error', () => {
    const out = project(makeTrace([
      { service: 'demo-api-server', op: 'POST', tags: { 'url.full': 'https://auth.pingone.com/x/as/token', 'http.response.status_code': '401' } },
    ]));
    expect(out.spans.find((s) => s.title === 'Token Exchange').status).toBe('error');
    expect(out.outcome).toBe('error');
  });

  // Amendment (Task 1 fixture finding, trace-chip-run.json): /as/token client
  // spans appear on BOTH demo-api-server and mcp-gateway (mcp-gateway proxies
  // its own token exchange on the way to the MCP backend). The anchor must
  // recognize both services, not demo-api-server alone.
  test('token exchange: mcp-gateway POST to /as/token also anchors a card', () => {
    const out = project(makeTrace([
      { service: 'mcp-gateway', op: 'POST', tags: { 'http.url': 'https://auth.pingone.com/x/as/token', 'http.status_code': 200 } },
    ]));
    const card = out.spans.find((s) => s.title === 'Token Exchange');
    expect(card).toBeDefined();
    expect(card.status).toBe('ok');
  });

  test('authorization: anchors on authz-server server span', () => {
    const out = project(makeTrace([
      { service: 'authz-server', op: 'POST /api/authorize', tags: { 'http.status_code': 200, 'span.kind': 'server' } },
    ]));
    const card = out.spans.find((s) => s.title === 'Authorization');
    expect(card).toBeDefined();
    expect(card.icon).toBe('shield');
  });

  test('backend api: anchors on mcp-server / mcp-invest server spans', () => {
    const out = project(makeTrace([
      { service: 'mcp-server', op: 'POST /mcp', tags: { 'http.status_code': 200, 'span.kind': 'server' } },
    ]));
    expect(out.spans.find((s) => s.title === 'MCP Backend')).toBeDefined();
  });

  test('hitl approval: card appears only when hitl-service spans exist', () => {
    const withHitl = project(makeTrace([
      { service: 'hitl-service', op: 'POST /api/consent', tags: { 'span.kind': 'server' } },
    ]));
    expect(withHitl.spans.find((s) => s.title === 'Human Approval')).toBeDefined();
    const without = project(makeTrace([
      { service: 'agent-service', op: 'reasoning-step-1', tags: {} },
    ]));
    expect(without.spans.find((s) => s.title === 'Human Approval')).toBeUndefined();
  });

  test('cards are sorted by anchor start time', () => {
    const out = project(makeTrace([
      { service: 'mcp-server', op: 'POST /mcp', tags: { 'span.kind': 'server' } },      // starts first
      { service: 'agent-service', op: 'reasoning-step-1', tags: {} },                    // starts second
    ]));
    expect(out.spans.map((s) => s.title)).toEqual(['MCP Backend', 'Agent Reasoning']);
  });

  // Live-fixture integration: structural, anchored to what Task 1 captured.
  // trace-agent-run.json — single service (agent-service), 54 spans: 6
  // reasoning-step-N spans + 6 tool-execution spans (tool outcomes are
  // errors — fetch failed — so this does not assert status:'ok' on tool cards).
  test('live fixture: projects at least agent reasoning and one tool call', () => {
    const out = project(liveFixture);
    expect(out.traceId).toMatch(/^[0-9a-f]+$/i);
    expect(out.spans.length).toBeGreaterThanOrEqual(2);
    expect(out.spans.find((s) => s.id === 'agent_reasoning')).toBeDefined();
    expect(out.spans.find((s) => s.title === 'Tool Call')).toBeDefined();
    for (const s of out.spans) {
      expect(typeof s.title).toBe('string');
      expect(['ok', 'error']).toContain(s.status);
      expect(s.durationMs).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(s.summary)).toBe(true);
    }
  });

  // Live-fixture integration: trace-chip-run.json — 4 services (demo-api-server,
  // mcp-gateway, mcp-server, authz-server), 77 spans, rooted at demo-api-server
  // POST /api/agent/invoke. No agent-service spans exist in this trace, so no
  // Agent Reasoning card should be projected; Token Exchange, Authorization and
  // MCP Backend anchors are all present (demo-api-server + mcp-gateway /as/token
  // client spans, authz-server introspect/decision server spans, mcp-server
  // server spans).
  test('live fixture (chip run): projects token exchange, authorization, and MCP backend cards, no agent reasoning', () => {
    const out = project(chipFixture);
    expect(out.traceId).toMatch(/^[0-9a-f]+$/i);
    expect(out.spans.find((s) => s.id === 'agent_reasoning')).toBeUndefined();
    expect(out.spans.find((s) => s.title === 'Token Exchange')).toBeDefined();
    expect(out.spans.find((s) => s.title === 'Authorization')).toBeDefined();
    expect(out.spans.find((s) => s.title === 'MCP Backend')).toBeDefined();
    for (const s of out.spans) {
      expect(typeof s.title).toBe('string');
      expect(['ok', 'error']).toContain(s.status);
      expect(s.durationMs).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(s.summary)).toBe(true);
    }
  });
});
