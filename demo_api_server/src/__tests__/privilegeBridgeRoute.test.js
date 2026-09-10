/**
 * @file privilegeBridgeRoute.test.js
 *
 * Task 8b: PingGateway's equivalent of the Node gateway's privilege bridge.
 *
 * There is no Groovy test harness in this repo — IG filters are validated live.
 * What CAN be pinned statically is the part that is both security-critical and
 * easy to break by accident: WHERE the filter sits in the chain, and whether the
 * secret it needs is actually emitted into ping-gateway/.env.
 *
 * The ordering is load-bearing twice over:
 *   - before McpGatewayProtection, because that filter introspects the bearer.
 *     Privilege's Static Token is not introspectable, so running after it means
 *     the request is already a 401 — the "Error discovering MCP server: calling
 *     \"initialize\": Unauthorized" the console showed on 2026-09-10.
 *   - before McpAudit, so the static secret is swapped out before anything logs it.
 *   - AFTER TransactionHop, which is outermost by design so the ledger still
 *     records a bridge refusal.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const ROUTE = path.join(ROOT, 'ping-gateway', 'config', 'routes', '01-mcp-olb.json');
const GROOVY = path.join(ROOT, 'ping-gateway', 'scripts', 'groovy', 'privilege-bridge.groovy');
const GENERATOR = path.join(__dirname, '..', '..', 'scripts', 'refresh-service-envs.js');

function filterNames() {
  const route = JSON.parse(fs.readFileSync(ROUTE, 'utf8'));
  return route.handler.config.filters.map((f) => f.name);
}

describe('PingGateway privilege bridge (Task 8b)', () => {
  test('the filter is mounted on the /mcp route and points at a file that exists', () => {
    const route = JSON.parse(fs.readFileSync(ROUTE, 'utf8'));
    const bridge = route.handler.config.filters.find((f) => f.name === 'PrivilegeBridge');
    expect(bridge).toBeDefined();
    expect(bridge.type).toBe('ScriptableFilter');
    expect(bridge.config.file).toBe('privilege-bridge.groovy');
    // A ScriptableFilter naming a missing file fails the route at IG boot, and
    // the gateway still starts on its other routes — so this goes unnoticed.
    expect(fs.existsSync(GROOVY)).toBe(true);
  });

  test('runs BEFORE the filters that introspect or log the bearer', () => {
    const names = filterNames();
    const bridge = names.indexOf('PrivilegeBridge');
    expect(bridge).toBeGreaterThanOrEqual(0);
    // McpGatewayProtection introspects the bearer; Privilege's Static Token is
    // not introspectable, so after it the request is already a 401.
    expect(bridge).toBeLessThan(names.indexOf('McpGatewayProtection'));
    // McpAudit must not see the static secret.
    expect(bridge).toBeLessThan(names.indexOf('McpAudit'));
  });

  test('runs AFTER TransactionHop so a bridge refusal still reaches the ledger', () => {
    const names = filterNames();
    // TransactionHop is mounted outermost on purpose (see its header) so it
    // observes the final response, including denies produced by filters that
    // return without calling downstream.
    expect(names.indexOf('TransactionHop')).toBeLessThan(names.indexOf('PrivilegeBridge'));
  });

  test('the groovy honours the two rules that keep the header from being a forgery channel', () => {
    const src = fs.readFileSync(GROOVY, 'utf8');
    // 1. An unset secret can never match — the failure mode that would turn
    //    missing config into an open door.
    expect(src).toMatch(/if\s*\(!secret\s*\|\|\s*!bearer\)\s*return false/);
    // 2. A non-bridge caller's X-Subject-Token is STRIPPED, not merely ignored:
    //    left in place, a downstream filter or the backend could still read it.
    expect(src).toMatch(/request\.headers\.remove\(SUBJECT_HEADER\)/);
    // Constant-time compare, not ==.
    expect(src).toContain('MessageDigest.isEqual');
    // Remove-before-add on Authorization, or Privilege's static token stays
    // ahead of ours and a downstream getFirst() reads THAT.
    expect(src).toMatch(/request\.headers\.remove\('Authorization'\)[\s\S]{0,200}request\.headers\.add\('Authorization'/);
  });

  test('a bridge call with no subject token is refused, matching the Node gateway', () => {
    const src = fs.readFileSync(GROOVY, 'utf8');
    // GatewayServer.ts:716-723 refuses rather than inventing a machine subject.
    // The two gateways must not disagree about this.
    expect(src).toContain('Privilege bridge presented no X-Subject-Token');
  });

  test('refresh-service-envs emits the secret into ping-gateway/.env', () => {
    // That script REWRITES ping-gateway/.env wholesale, so a hand-added key is
    // wiped on the next run and the bridge silently reverts to 401.
    const src = fs.readFileSync(GENERATOR, 'utf8');
    expect(src).toContain('MCP_GW_PRIVILEGE_BRIDGE_SECRET');
  });
});
