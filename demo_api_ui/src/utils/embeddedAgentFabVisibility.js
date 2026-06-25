// banking_api_ui/src/utils/embeddedAgentFabVisibility.js

/**
 * Customer/admin home routes where the embedded bottom-dock agent is mounted.
 * @param {string} [pathname]
 * @returns {boolean}
 */
export function isBankingAgentDashboardRoute(pathname) {
  if (pathname == null || typeof pathname !== 'string') return false;
  const p = pathname.replace(/\/$/, '') || '/';
  return p === '/' || p === '/admin' || p === '/dashboard';
}

/**
 * Routes where the embedded bottom-dock agent is mounted (dashboard homes + Application Configuration).
 * Floating FAB still uses {@link isBankingAgentDashboardRoute} only — not `/config`.
 * @param {string} [pathname]
 * @returns {boolean}
 */
export function isEmbeddedAgentDockRoute(pathname) {
  if (pathname == null || typeof pathname !== 'string') return false;
  const p = pathname.replace(/\/$/, '') || '/';
  if (p === '/config') return true;
  // Monitoring sidebar pages — agent FAB lets users trigger tool calls and see results live.
  // Excludes /logs and /activity/audit (no agent interaction needed there).
  if (p.startsWith('/monitoring') || p === '/api-traffic' || p === '/mcp-traffic') return true;
  return isBankingAgentDashboardRoute(pathname);
}

/**
 * Routes that render a token-chain surface. Update this list when adding new
 * pages that show token-chain UI so background refresh stays route-scoped.
 * @param {string} [pathname]
 * @returns {boolean}
 */
export function isTokenChainRoute(pathname) {
  if (pathname == null || typeof pathname !== 'string') return false;
  const p = pathname.replace(/\/$/, '') || '/';
  return p === '/' || p === '/dashboard' || p === '/admin' || p === '/agent-flow-inspector';
}

/**
 * Marketing / landing surfaces where we show the banking agent before sign-in (SPA path only).
 * @param {string} [pathname]
 * @returns {boolean}
 */
export function isPublicMarketingAgentPath(pathname) {
  if (pathname == null || typeof pathname !== 'string') return false;
  const p = pathname.replace(/\/$/, '') || '/';
  return p === '/' || p === '/dashboard';
}

/**
 * Routes where the fixed upper-left quick nav (Home, Dashboard, API, Logs) is shown.
 * Includes admin banking ops so admins can jump back without losing the rail.
 * @param {string} [pathname]
 * @param {{ role?: string } | null | undefined} [user]
 */
export function isDashboardQuickNavRoute(pathname, user) {
  if (pathname == null || typeof pathname !== 'string') return false;
  const p = pathname.replace(/\/$/, '') || '/';
  if (isBankingAgentDashboardRoute(pathname)) return true;
  if (user?.role === 'admin' && p === '/admin/banking') return true;
  // Also show on secondary pages so the nav rail is always accessible while signed in
  if (p === '/demo-data' || p === '/config' || p === '/mcp-inspector' || p === '/logs' || p === '/activity' || p === '/agent') return true;
  return false;
}

/**
 * Whether the global corner FAB floating agent should render.
 *
 * - Float-only (`placement === 'none'`) or Middle/Bottom with **+ FAB** checked.
 *
 * @param {{ user?: { role?: string } | null | undefined; placement: 'middle' | 'bottom' | 'none'; fab: boolean; pathname?: string }} p
 * @returns {boolean}
 */
export function shouldShowGlobalFloatingBankingAgentFab({ user, placement, fab, pathname = '' }) {
  if (!user) return false;
  if (placement !== 'none' && !fab) return false;
  return isBankingAgentDashboardRoute(pathname);
}

/**
 * Monitoring / observability routes where the floating agent FAB is shown so
 * users can trigger tool calls and see audit/traffic/token results on the same page.
 * @param {string} [pathname]
 * @returns {boolean}
 */
export function isMonitoringRoute(pathname) {
  if (pathname == null || typeof pathname !== 'string') return false;
  const p = pathname.replace(/\/$/, '') || '/';
  const MONITORING_PREFIXES = [
    '/activity',
    '/audit',
    '/logs',
    '/api-traffic',
    '/mcp-traffic',
    '/monitoring',       // covers /monitoring/token-chain, /monitoring/token-diff,
                         //         /monitoring/flow-inspector, /monitoring/mcp-traffic,
                         //         /monitoring/api-explorer
    '/architecture',
  ];
  return MONITORING_PREFIXES.some(prefix => p === prefix || p.startsWith(prefix + '/'));
}
