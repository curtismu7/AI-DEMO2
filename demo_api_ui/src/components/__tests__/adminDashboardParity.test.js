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

// Both files, because /admin is Dashboard.js PLUS the panels it composes.
// The customer lookup consolidation moved the search and the PingOne read from
// Dashboard.js into AdminCustomerPanel.jsx; the guarantee being guarded is
// "this feature is reachable on /admin", not "this feature lives in this
// file". Widening the scope keeps that guarantee across the move instead of
// deleting assertions to make them pass.
const SRC = [
  fs.readFileSync(path.resolve(__dirname, '../Dashboard.js'), 'utf8'),
  fs.readFileSync(path.resolve(__dirname, '../AdminCustomerPanel.jsx'), 'utf8'),
].join('\n');

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

describe('/admin skin must not clip escaping UI', () => {
  const SKIN = fs.readFileSync(
    path.resolve(__dirname, '../AdminDashboardSkin.css'),
    'utf8',
  );

  // TokenChainTraceRail's .tctr-more-pop is position:absolute at
  // top: calc(100% + 5px), so it hangs outside its trigger's box. A card with
  // overflow:hidden puts that menu out of reach — a feature lost to styling,
  // which is the one thing this restyle promised not to do.
  it('never sets overflow:hidden on a dashboard card', () => {
    const rules = SKIN.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rules).not.toMatch(/overflow\s*:\s*hidden/);
  });

  // The page went dark-capable on 2026-08-10 (explicit request: light/dark
  // across the whole dashboard), reversing this file's original "light in
  // every scheme" stance. Two things survive from that era:
  //
  // 1. Dark is app-controlled only. :root[data-theme="dark"] is what
  //    ThemeProvider writes; keying any rule to the OS setting instead would
  //    make the page disagree with the app's own theme toggle. (Comments are
  //    stripped first — prose ABOUT the media query is fine.)
  it('keys dark to data-theme, never the OS prefers-color-scheme', () => {
    const rules = SKIN.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rules).not.toMatch(/prefers-color-scheme/);
    expect(rules).toMatch(/:root\[data-theme="dark"\]\s*\.admin-dashboard-page/);
  });

  // 2. A colour-only dark override is how #1483 happened (near-white text on
  //    a white ground). The dark block must move surface and ink TOGETHER —
  //    if it redefines either, it redefines both.
  it('dark block redefines surface and ink together', () => {
    const dark = SKIN.match(/:root\[data-theme="dark"\]\s*\.admin-dashboard-page\s*\{[^}]*\}/);
    expect(dark).not.toBeNull();
    expect(dark[0]).toMatch(/--admin-surface:/);
    expect(dark[0]).toMatch(/--admin-ink:/);
  });
});

describe('/admin skin must not fight the design system', () => {
  const SKIN = fs.readFileSync(
    path.resolve(__dirname, '../AdminDashboardSkin.css'),
    'utf8',
  );
  const RULES = SKIN.replace(/\/\*[\s\S]*?\*\//g, '');

  // A blanket `.dash-shell-card button` rule outranks .btn-primary (0,2,1 vs
  // 0,1,0), so it stripped the primary button's fill and left its white label
  // on a white background — the "Look up customer" control rendered as an empty
  // box. Skin only buttons the design system does not own.
  it('never styles .btn* buttons', () => {
    const buttonRules = RULES.match(/[^{}]*\bbutton\b[^{}]*\{/g) || [];
    expect(buttonRules.length).toBeGreaterThan(0);
    for (const rule of buttonRules) {
      expect(rule).toContain(':not([class*="btn"])');
    }
  });

  it('never styles .form-control inputs', () => {
    const inputRules = RULES.match(/[^{}]*\binput\b[^{}]*\{/g) || [];
    expect(inputRules.length).toBeGreaterThan(0);
    for (const rule of inputRules) {
      expect(rule).toContain(':not(.form-control)');
    }
  });

  // .admin-dash-col2 is a flex column with gap and overflow-y: auto. A bottom
  // margin on the last card is clipped by that scroll container and the end of
  // the page becomes unreachable.
  it('adds no card margin that the scroll column would clip', () => {
    expect(RULES).not.toMatch(/\.dash-shell-card\s*\{[^}]*margin-bottom/);
  });
});
