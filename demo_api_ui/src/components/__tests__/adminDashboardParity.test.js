/**
 * Feature parity guard for /admin (Dashboard.js).
 *
 * Every item below is load-bearing in the demo. /admin was briefly repointed at
 * the support console (#1486) and reverted (#1494) precisely because that move
 * dropped several of them — PingOne lookup, group membership, the full token
 * chain. This file exists so a restyle cannot repeat that quietly.
 *
 * Scope, stated honestly: these are SOURCE assertions, not render assertions.
 * They prove a component/endpoint/heading is still wired into Dashboard.js —
 * which is exactly the failure mode a restyle risks (deleting markup while
 * moving it) — but they do not prove the feature works at runtime. Behaviour is
 * covered by each component's own suite.
 */
import fs from 'node:fs';
import path from 'node:path';

const SRC = fs.readFileSync(
  path.resolve(__dirname, '../Dashboard.js'),
  'utf8',
);

// 1–16 of the census taken before the restyle.
const COMPONENTS = [
  'AdminCustomerPanel',
  'ApiCallsModal',
  'ConfirmModal',
  'EventStreamPanel',
  'ExchangeModeToggle',
  'FloatingPanel',
  'GroupMembershipToggle',
  'OAuthTokenDisplayPage',
  'ThresholdControls',
  'TokenChainTraceRail',
];

const ENDPOINTS = [
  '/api/accounts/reset-all-demo',
  '/api/admin/bootstrap/export',
  '/api/admin/config',
  '/api/admin/stats',
  '/api/admin/transactions/lookup',
  '/api/admin/users/hints',
  '/api/auth/oauth/status',
  '/api/auth/oauth/user/status',
];

const HEADINGS = [
  'PingOne Admin access',
  'Customer lookup',
  'Customer profile',
  'Accounts',
  'Recent transactions',
  'Key metrics',
  'Recent Activity',
];

const KPIS = [
  'total users',
  'active users',
  'total accounts',
  'total transactions',
  'total balance',
  'average balance',
];

const ADMIN_ACTIONS = ['Sign out', 'Export seed JSON', 'Save seed on server'];

const CONFIRMS = ['Reset Demo Accounts?', 'Overwrite seed file?'];

describe('/admin feature parity', () => {
  it.each(COMPONENTS)('still renders %s', (name) => {
    expect(SRC).toMatch(new RegExp(`<${name}[\\s/>]`));
  });

  it.each(ENDPOINTS)('still calls %s', (url) => {
    expect(SRC).toContain(url);
  });

  it.each(HEADINGS)('still shows the "%s" section', (heading) => {
    expect(SRC).toContain(heading);
  });

  it.each(KPIS)('still exposes the %s metric', (kpi) => {
    expect(SRC).toContain(`View ${kpi} details`);
  });

  it.each(ADMIN_ACTIONS)('still offers "%s"', (label) => {
    expect(SRC).toContain(label);
  });

  it.each(CONFIRMS)('still confirms before "%s"', (title) => {
    expect(SRC).toContain(title);
  });

  // The console rendered this as mcpRouteOnly inside a collapsed <details>,
  // which is the "new token chain" that was rejected. /admin must keep the full
  // rail.
  it('keeps the FULL token chain, not the mcpRouteOnly variant', () => {
    expect(SRC).toMatch(/<TokenChainTraceRail\s*\/>/);
    expect(SRC).not.toContain('mcpRouteOnly');
  });

  // The lookup response carries the real PingOne user record; the console's
  // per-vertical lookup does not. Losing this was one of the reported
  // regressions.
  it('keeps the PingOne record from the lookup response', () => {
    expect(SRC).toContain('pingOne');
  });
});
