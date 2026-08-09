// banking_api_ui/src/utils/__tests__/embeddedAgentFabVisibility.test.js
import {
  isBankingAgentDashboardRoute,
  isEmbeddedAgentDockRoute,
  isDashboardQuickNavRoute,
  shouldShowGlobalFloatingBankingAgentFab,
  isLiveWorkbenchRoute,
  isAgentLifecycleRoute,
  isPingOneAdminAgentRoute,
} from '../embeddedAgentFabVisibility';

const customer = { role: 'customer', id: '1' };
const admin = { role: 'admin', id: 'a1' };

describe('isBankingAgentDashboardRoute', () => {
  it('matches home dashboards only', () => {
    expect(isBankingAgentDashboardRoute('/')).toBe(true);
    expect(isBankingAgentDashboardRoute('/admin')).toBe(true);
    expect(isBankingAgentDashboardRoute('/dashboard')).toBe(true);
    expect(isBankingAgentDashboardRoute('/admin/')).toBe(true);
    expect(isBankingAgentDashboardRoute('/demo-data')).toBe(false);
    expect(isBankingAgentDashboardRoute('/mcp-inspector')).toBe(false);
    expect(isBankingAgentDashboardRoute('/config')).toBe(false);
  });
});

describe('isPingOneAdminAgentRoute', () => {
  it('matches both dashboard paths, not the vertical consoles or customer dash', () => {
    // The PingOne admin content moved from /admin to /admin/pingone when the
    // support console took /admin; this predicate moved with it. If it ever
    // points at a page that does not hold Demo Steps, the agent falls back to
    // the theme vertical and running a step hits customerTokenGuard — the
    // 2026-07-22 regression in REGRESSION_PLAN §4.
    expect(isPingOneAdminAgentRoute('/admin/pingone')).toBe(true);
    expect(isPingOneAdminAgentRoute('/admin/pingone/')).toBe(true);
    // /admin renders the dashboard again after the #1486 repoint was reverted,
    // and /admin/pingone still resolves to the same component, so the admin
    // agent must mount on both.
    expect(isPingOneAdminAgentRoute('/admin')).toBe(true);
    expect(isPingOneAdminAgentRoute('/admin/')).toBe(true);
    expect(isPingOneAdminAgentRoute('/admin/banking')).toBe(false);
    expect(isPingOneAdminAgentRoute('/dashboard')).toBe(false);
    expect(isPingOneAdminAgentRoute('/')).toBe(false);
  });
});

describe('isEmbeddedAgentDockRoute', () => {
  it('includes dashboard homes and Application Configuration', () => {
    expect(isEmbeddedAgentDockRoute('/')).toBe(true);
    expect(isEmbeddedAgentDockRoute('/admin')).toBe(true);
    expect(isEmbeddedAgentDockRoute('/dashboard')).toBe(true);
    expect(isEmbeddedAgentDockRoute('/config')).toBe(true);
    expect(isEmbeddedAgentDockRoute('/config/')).toBe(true);
    expect(isEmbeddedAgentDockRoute('/logs')).toBe(false);
  });
});

describe('isDashboardQuickNavRoute', () => {
  it('matches dashboard homes for any signed-in user', () => {
    expect(isDashboardQuickNavRoute('/', customer)).toBe(true);
    expect(isDashboardQuickNavRoute('/dashboard', customer)).toBe(true);
    expect(isDashboardQuickNavRoute('/admin', admin)).toBe(true);
  });

  it('includes /admin/banking for admins only', () => {
    expect(isDashboardQuickNavRoute('/admin/banking', admin)).toBe(true);
    expect(isDashboardQuickNavRoute('/admin/banking', customer)).toBe(false);
  });

  it('includes secondary nav pages (logs, mcp-inspector, demo-data, config, activity)', () => {
    // These were intentionally added so the nav rail stays accessible on key tool pages
    expect(isDashboardQuickNavRoute('/mcp-inspector', admin)).toBe(true);
    expect(isDashboardQuickNavRoute('/logs', admin)).toBe(true);
    expect(isDashboardQuickNavRoute('/demo-data', customer)).toBe(true);
    expect(isDashboardQuickNavRoute('/config', admin)).toBe(true);
    expect(isDashboardQuickNavRoute('/activity', admin)).toBe(true);
  });

  it('does not match truly arbitrary routes', () => {
    expect(isDashboardQuickNavRoute('/users', admin)).toBe(false);
    expect(isDashboardQuickNavRoute('/accounts', admin)).toBe(false);
    expect(isDashboardQuickNavRoute('/some-random-page', customer)).toBe(false);
  });
});

describe('shouldShowGlobalFloatingBankingAgentFab', () => {
  it('hides FAB when not logged in', () => {
    expect(
      shouldShowGlobalFloatingBankingAgentFab({
        user: null,
        placement: 'bottom',
        fab: false,
        pathname: '/',
      }),
    ).toBe(false);
  });

  it('shows FAB when float-only on dashboard home routes', () => {
    expect(
      shouldShowGlobalFloatingBankingAgentFab({
        user: customer,
        placement: 'none',
        fab: true,
        pathname: '/dashboard',
      }),
    ).toBe(true);
  });

  it('shows FAB when middle or bottom with + FAB', () => {
    expect(
      shouldShowGlobalFloatingBankingAgentFab({
        user: customer,
        placement: 'middle',
        fab: true,
        pathname: '/dashboard',
      }),
    ).toBe(true);
    expect(
      shouldShowGlobalFloatingBankingAgentFab({
        user: customer,
        placement: 'bottom',
        fab: true,
        pathname: '/',
      }),
    ).toBe(true);
  });

  it('hides FAB on tool routes', () => {
    expect(
      shouldShowGlobalFloatingBankingAgentFab({
        user: customer,
        placement: 'none',
        fab: true,
        pathname: '/mcp-inspector',
      }),
    ).toBe(false);
  });

  it('hides FAB when embedded bottom without + FAB', () => {
    expect(
      shouldShowGlobalFloatingBankingAgentFab({
        user: customer,
        placement: 'bottom',
        fab: false,
        pathname: '/dashboard',
      }),
    ).toBe(false);
  });

  it('hides FAB on /config when float-only (dashboard homes only)', () => {
    expect(
      shouldShowGlobalFloatingBankingAgentFab({
        user: customer,
        placement: 'none',
        fab: true,
        pathname: '/config',
      }),
    ).toBe(false);
  });

  it('hides FAB when middle without + FAB', () => {
    expect(
      shouldShowGlobalFloatingBankingAgentFab({
        user: customer,
        placement: 'middle',
        fab: false,
        pathname: '/dashboard',
      }),
    ).toBe(false);
  });
});

describe('isLiveWorkbenchRoute', () => {
  it('is true only for /use-cases/live', () => {
    expect(isLiveWorkbenchRoute('/use-cases/live')).toBe(true);
    expect(isLiveWorkbenchRoute('/use-cases/live/')).toBe(true);
  });

  it('is false for the catalog page, dashboard, and unrelated routes', () => {
    expect(isLiveWorkbenchRoute('/use-cases')).toBe(false);
    expect(isLiveWorkbenchRoute('/dashboard')).toBe(false);
    expect(isLiveWorkbenchRoute('/')).toBe(false);
    expect(isLiveWorkbenchRoute(null)).toBe(false);
    expect(isLiveWorkbenchRoute(undefined)).toBe(false);
  });
});

describe('isAgentLifecycleRoute', () => {
  it('is true for the guided lifecycle surfaces', () => {
    expect(isAgentLifecycleRoute('/agent-lifecycle')).toBe(true);
    expect(isAgentLifecycleRoute('/agent-lifecycle/')).toBe(true);
    expect(isAgentLifecycleRoute('/delegated-commerce')).toBe(true);
    expect(isAgentLifecycleRoute('/delegated-commerce/')).toBe(true);
  });

  it('is false for unrelated routes', () => {
    expect(isAgentLifecycleRoute('/use-cases/live')).toBe(false);
    expect(isAgentLifecycleRoute('/dashboard')).toBe(false);
    expect(isAgentLifecycleRoute('/')).toBe(false);
    expect(isAgentLifecycleRoute(null)).toBe(false);
    expect(isAgentLifecycleRoute(undefined)).toBe(false);
  });
});
