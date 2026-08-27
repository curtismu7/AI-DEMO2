'use strict';

/**
 * @file agentMcpTokenService.idJagOlbOnly.test.js
 * @description Native ID-JAG is a per-server grant — take it only for OLB tools.
 *
 * The redeemed ID-JAG bearer carries exactly ONE audience: oauth-mcp's own resource
 * (TokenIssuer.resolveOwnAudience — the AS may assert no other). That is right for
 * tools the gateway routes to the `olb` backend and wrong for every other backend.
 *
 * routeTool() sends TEN verticals to the `invest` backend. For those the gateway's
 * ID-JAG exemption correctly refuses to forward (the aud is not the invest resource,
 * and forwarding would widen what the bearer reaches past what D-05 verified), falls
 * through to the RFC 8693 exchange, and PingOne rejects a token it did not sign:
 *
 *   Cannot parse token claims for request param 'subject_token'
 *
 * Measured live 2026-08-26 on `list_gear` — every non-banking vertical 502'd.
 *
 * This pins the predicate itself. The OLB set is derived from the BFF's own banking
 * tool registry, so there is no copy of the gateway's routing table to drift.
 */

const { __test } = require('../../services/agentMcpTokenService');

const isOlbBackedTool = __test && __test.isOlbBackedTool;

// A skipped suite reads as green and proves nothing — the exact trap this whole
// area keeps falling into. If the export disappears, fail.
it('exposes the predicate under test', () => {
  expect(typeof isOlbBackedTool).toBe('function');
});

describe('isOlbBackedTool', () => {
  // These live on the OLB MCP server and ARE in the banking registry.
  it.each(['get_my_accounts', 'get_account_balance', 'create_transfer'])(
    '%s is OLB-backed, so the native ID-JAG path applies',
    (tool) => {
      expect(isOlbBackedTool(tool)).toBe(true);
    },
  );

  // Every one of these routes to `invest` in demo_mcp_gateway/src/router.ts.
  it.each([
    ['list_gear', 'sporting-goods'],
    ['list_orders', 'retail'],
    ['view_coverage', 'healthcare'],
    ['view_permits', 'government'],
    ['view_benefits', 'workforce'],
    ['view_courses', 'university'],
    ['view_work_orders', 'manufacturing'],
  ])('%s (%s) is NOT OLB-backed, so ID-JAG must be skipped', (tool) => {
    expect(isOlbBackedTool(tool)).toBe(false);
  });

  // Fail safe: anything unknown takes the exchange path, which works today.
  it.each([null, undefined, '', 'not_a_real_tool'])('%p is treated as not OLB-backed', (tool) => {
    expect(isOlbBackedTool(tool)).toBe(false);
  });
});
