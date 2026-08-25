'use strict';
const { renderReelSvg } = require('../../services/reelSvg');

const RECORD = {
  correlationId: 'cid-1',
  startedAt: '2026-08-25T04:00:00.000Z',
  endedAt: '2026-08-25T04:00:01.000Z',
  principal: 'user-1',
  hops: [
    { seq: 1, phase: 'ui.request', service: 'mcp-facade', op: 'tools/call get_my_accounts',
      identity: { sub: 'user-1' }, details: { doorLabel: 'Agent Gateway' } },
    { seq: 2, phase: 'gateway.authorize', service: 'mcp-gateway', op: 'get_my_accounts',
      decision: { outcome: 'permit', by: 'gateway' } },
    { seq: 3, phase: 'mcp.tool', service: 'mcp-facade', op: 'get_my_accounts', status: 'ok', durationMs: 410 },
    { seq: 4, phase: 'response', service: 'mcp-facade', op: 'tools/call', status: 'ok' },
  ],
};

describe('renderReelSvg', () => {
  test('renders one row per hop with service, phase, op and duration', () => {
    const svg = renderReelSvg(RECORD);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    for (const h of RECORD.hops) expect(svg).toContain(`${h.service}`);
    expect(svg).toContain('gateway.authorize');
    expect(svg).toContain('410ms');
    // header names the door and the call
    expect(svg).toContain('Agent Gateway');
    expect(svg).toContain('tools/call get_my_accounts');
  });

  test('renders decision badges: PERMIT, DENY, and the inferred marker', () => {
    expect(renderReelSvg(RECORD)).toContain('✓ PERMIT');
    const denied = { ...RECORD, hops: [{ seq: 1, phase: 'gateway.authorize', service: 'mcp-facade', op: 'x',
      decision: { outcome: 'deny', by: 'Privilege agentless', reason: 'HTTP 403', source: 'inferred' } }] };
    const svg = renderReelSvg(denied);
    expect(svg).toContain('❌ DENY');
    expect(svg).toContain('inferred');
    expect(svg).toContain('HTTP 403');
  });

  test('escapes XML in hop text so a hostile tool name cannot break the document', () => {
    const nasty = { ...RECORD, hops: [{ seq: 1, phase: 'mcp.tool', service: 'mcp-facade', op: '<script>alert(1)</script>&x' }] };
    const svg = renderReelSvg(nasty);
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;alert(1)&lt;/script&gt;&amp;x');
  });

  test('null record renders a waiting frame that is still a valid svg', () => {
    const svg = renderReelSvg(null);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('Waiting for the first hop');
  });

  test('a session with no tool call yet is titled by the client from the initialize step', () => {
    const svg = renderReelSvg({ ...RECORD, hops: [
      { seq: 1, phase: 'mcp.step', service: 'mcp-facade', op: 'initialize', details: { doorLabel: 'Agent Gateway', client: { name: 'LM Studio' } } },
      { seq: 2, phase: 'mcp.step', service: 'mcp-facade', op: 'tools/list', details: { toolCount: 242 } },
    ] });
    expect(svg).toContain('LM Studio MCP session (Agent Gateway)');
    expect(svg).toContain('tools/list');
  });

  test('height grows with the number of hops', () => {
    const one = renderReelSvg({ ...RECORD, hops: RECORD.hops.slice(0, 1) });
    const four = renderReelSvg(RECORD);
    const h = (svg) => Number(svg.match(/height="(\d+)"/)[1]);
    expect(h(four)).toBeGreaterThan(h(one));
  });
});
