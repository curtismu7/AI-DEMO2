import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every page route must be findable: on the side nav (so also in its search) or on the explicit
 * exemption list below, with a reason class. Added after six real pages shipped (Dot workbench,
 * Workload Agents, Embedded Worker, Governance Timeline, Hosted Registrations, PingFederate DaVinci
 * Kit) that App.js routed but the nav never listed, so neither the tree nor the search could find them.
 *
 * Adding a route? Either give it a nav entry in AdminSideNav.jsx (+ the catalogs: navStructureCatalog,
 * navPagePaths) or add it to EXEMPT. Both directions are enforced so the list cannot rot.
 */
const SRC = path.resolve(__dirname, '../..');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const dirJs = (rel) => fs.readdirSync(path.join(SRC, rel)).filter((f) => f.endsWith('.js')).map((f) => read(`${rel}/${f}`));

function staticRoutes() {
  return [...new Set([...read('App.js').matchAll(/path="(\/[^"*]*)"/g)].map((m) => m[1]))].filter((r) => !r.includes(':'));
}

function navPaths() {
  const found = new Set();
  const sources = [read('components/AdminSideNav.jsx'), ...dirJs('config'), ...dirJs('routes')];
  for (const src of sources) {
    for (const m of src.matchAll(/path:\s*["']([^"'?#]+)/g)) found.add(m[1]);
  }
  for (const m of read('config/navPagePaths.js').matchAll(/:\s*"(\/[^"?#]*)"/g)) found.add(m[1]);
  return found;
}

// Routes that are intentionally NOT nav entries: OAuth/flow callbacks, pop-out windows, deep links
// reached from another page, legacy redirects, dev/showcase pages, and admin sub-consoles opened from
// their own hub. Keep this list short: a real page belongs in the nav.
const EXEMPT = new Set([
  '/pingfederate-id-jag/learn', // deep link from the ID-JAG Playground header
  '/activity',
  '/admin',
  '/admin/walbuy',
  '/admin/agentic-access-console',
  '/admin/government',
  '/admin/investment',
  '/admin/manufacturing',
  '/admin/university',
  '/agent-onboarding-flow-mermaid',
  '/api-traffic',
  '/authorize-config',
  '/authz-server-rules',
  '/authz-test',
  '/ciba-approve',
  '/compliance-modal-popout',
  '/config',
  '/copilot',
  '/dashboard',
  '/davinci-login/callback',
  '/davinci-login/confirmed',
  '/demo-data',
  '/demo-guide-popout',
  '/demo/footprint-mocks',
  '/demo/footprint-picks',
  '/external-door-diagrams',
  '/feature-flags',
  '/intent-binding-learning',
  '/jev-demos',
  '/llm-test',
  '/login',
  '/logout',
  '/logs',
  '/m2m-sample',
  '/mcp-gateway',
  '/mcp-gateway-oauth-flow',
  '/mcp-inspector',
  '/mcp-tools',
  '/mcp-traffic',
  '/oauth/token-display',
  '/path/apikey-info',
  '/path/dualtoken-info',
  '/path/feature',
  '/personal-agent/client',
  '/pinggateway-inspector',
  '/pinggateway-test',
  '/profile',
  '/protect-auth-demo',
  '/protect-auth-demo/popout',
  '/request-access',
  '/rs/api',
  '/rs/invest',
  '/rs/olb',
  '/sdk-login/callback',
  '/security',
  '/servers',
  '/spinner-showcase',
  '/standalone',
  '/standalone/runner/m2m',
  '/themes',
  '/user-accounts',
  '/webmcp',
  '/welcome',
]);

describe('every page route is on the side nav (and so searchable) or explicitly exempt', () => {
  const routes = staticRoutes();
  const inNav = navPaths();

  it('no route is missing from both', () => {
    const missing = routes.filter((r) => !inNav.has(r) && !EXEMPT.has(r));
    expect(
      missing,
      `Routes with no nav entry (so no search hit): add each to AdminSideNav.jsx ` +
        `(+ navStructureCatalog / navPagePaths) or to EXEMPT in this test:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  it('EXEMPT has no stale entries (a route that is now in the nav, or no longer exists)', () => {
    const stale = [...EXEMPT].filter((r) => !routes.includes(r) || inNav.has(r));
    expect(stale, `Remove from EXEMPT:\n  ${stale.join('\n  ')}`).toEqual([]);
  });
});
