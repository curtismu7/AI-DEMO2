// banking_api_ui/src/components/DashboardQuickNav.js
import { useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { isDashboardQuickNavRoute } from '../utils/embeddedAgentFabVisibility';
import './DashboardQuickNav.css';

const POPOUT = 'width=1400,height=900,scrollbars=yes,resizable=yes';

/**
 * Fixed upper-left controls (Home, role-based Dashboard, API + Log viewer popouts).
 * Signed-in quick nav on home routes /, /admin, /dashboard, plus /admin/banking for admins (not landing, /config, etc.).
 */
export default function DashboardQuickNav({ user }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    if (!user || !isDashboardQuickNavRoute(pathname, user)) return;
    // Home + Dashboard + Agent + [Banking admin] + [Config admin] + Settings + Activity Log + API + Logs
    const count = 6 + (isAdmin ? 2 : 0);
    const height = count * 44; // gap: 0, no inter-button spacing
    // Must target .App directly — CSS declares --quick-nav-stack-height on .App.App--has-quick-nav,
    // which shadows any value inherited from documentElement.
    const appEl = document.querySelector('.App');
    if (appEl) appEl.style.setProperty('--quick-nav-stack-height', `${height}px`);
  }, [isAdmin, user, pathname]);

  // Admin users get AdminSideNav instead — hide DashboardQuickNav for them
  if (!user || isAdmin || !isDashboardQuickNavRoute(pathname, user)) {
    return null;
  }

  const dashboardPath = user ? (isAdmin ? '/admin' : '/dashboard') : '/dashboard';

  const openApiPopout = () => {
    window.open('/api-traffic', 'ApiTraffic', POPOUT);
  };

  const openLogPopout = () => {
    window.open('/logs', 'BankingLogs', POPOUT);
  };

  const homeActive = pathname === '/' || pathname === '';
  const dashActive = user
    ? (isAdmin ? pathname === '/admin' : pathname === '/dashboard')
    : pathname === '/dashboard';
  const bankingAdminActive = isAdmin && pathname.replace(/\/$/, '') === '/admin/banking';

  return (
    <nav className="dashboard-quick-nav" aria-label="Quick navigation">
      <Link
        to="/"
        className={`dashboard-quick-nav__btn${homeActive ? ' dashboard-quick-nav__btn--active' : ''}`}
        title="Home"
      >
        Home
      </Link>
      <Link
        to={dashboardPath}
        className={`dashboard-quick-nav__btn${dashActive ? ' dashboard-quick-nav__btn--active' : ''}`}
        title={isAdmin ? 'Admin dashboard' : 'Customer dashboard'}
      >
        Dashboard
      </Link>
      <button
        type="button"
        className="dashboard-quick-nav__btn"
        title="Open AI Agent panel"
        onClick={() => {
          const agentRoutes = ['/', '/admin', '/dashboard'];
          const norm = pathname.replace(/\/$/, '') || '/';
          if (agentRoutes.includes(norm)) {
            window.dispatchEvent(new CustomEvent('banking-agent-open'));
          } else {
            const dest = isAdmin ? '/admin' : '/dashboard';
            navigate(dest, { state: { openAgent: true } });
          }
        }}
      >
        Agent
      </button>
      {isAdmin && (
        <Link
          to="/admin/banking"
          className={`dashboard-quick-nav__btn${bankingAdminActive ? ' dashboard-quick-nav__btn--active' : ''}`}
          title="Demo admin — lookup accounts, seed demo charges"
        >
          Banking
        </Link>
      )}
      {isAdmin && (
        <Link
          to="/config"
          className={`dashboard-quick-nav__btn${pathname === '/config' ? ' dashboard-quick-nav__btn--active' : ''}`}
          title="App Config — async UX, display preferences, industry"
        >
          Config
        </Link>
      )}
      {!isAdmin && (
        <Link
          to="/configure?tab=feature-flags"
          className={`dashboard-quick-nav__btn${pathname === '/configure' ? ' dashboard-quick-nav__btn--active' : ''}`}
          title="Demo settings — toggle feature flags (e.g. dashboard banking column)"
        >
          Settings
        </Link>
      )}
      {!isAdmin && (
        <Link
          to="/monitoring/activity-log"
          className={`dashboard-quick-nav__btn${pathname.startsWith('/monitoring/activity-log') ? ' dashboard-quick-nav__btn--active' : ''}`}
          title="Live event stream — OAuth, MCP, token, and delegation events"
        >
          Activity Log
        </Link>
      )}
      <button type="button" className="dashboard-quick-nav__btn" onClick={openApiPopout} title="Open API traffic in a new window">
        API
      </button>
      <button type="button" className="dashboard-quick-nav__btn" onClick={openLogPopout} title="Open log viewer in a new window">
        Logs
      </button>
    </nav>
  );
}
