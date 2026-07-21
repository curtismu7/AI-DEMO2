import { useEffect, useState } from "react";
import {
  MdAccountBalance, MdLogin, MdLogout, MdSearch, MdSwapHoriz,
  MdLocalHospital, MdShoppingCart, MdStorefront, MdWork, MdSportsBasketball,
  MdFlight, MdGavel, MdSchool, MdRestaurant, MdDirectionsCar,
} from "react-icons/md";
import { useLocation, useNavigate } from "react-router-dom";
import { useSessionToken } from "../context/SessionTokenContext";
import { useRoleSwitch } from "../hooks/useRoleSwitch";
import { useVertical } from "../vertical/useVertical";
import { navigateToCustomerOAuthLogin } from "../utils/authUi";
import {
  cameFromUseCases,
  clearCameFromUseCases,
} from "../utils/fromUseCasesNav";
import AgentUiModeToggle from "./AgentUiModeToggle";
import ThresholdControls from "./ThresholdControls";
import QuickFlagsPill from "./QuickFlagsPill";
import UserMenu from "./UserMenu";
import VerticalSwitcher from "./VerticalSwitcher";
import "./TopNav.css";

// Curated react-icons/md set selectable per vertical via manifest identity.icon.
// Importing by name (not the whole md namespace) keeps the bundle small.
const BRAND_ICONS = {
  MdAccountBalance, MdLocalHospital, MdShoppingCart, MdStorefront, MdWork,
  MdSportsBasketball, MdFlight, MdGavel, MdSchool, MdRestaurant, MdDirectionsCar,
};

export default function TopNav({ user, onLogout }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { pageManifest } = useVertical();
  const identity = pageManifest?.identity;
  const { tokenSecondsLeft, tokenLoading, sessionType, staleSession, hasActiveToken: tokenIsActive, openTokenModal } = useSessionToken();
  const brandName = (identity && (identity.headerTitle || identity.displayName)) || 'AI Demo';
  // Per-vertical brand icon (manifest identity.icon); unknown/absent → bank icon.
  const BrandIcon = (identity && BRAND_ICONS[identity.icon]) || MdAccountBalance;

  // After Run/Open from /use-cases, show a clear "← Use Cases" control in the top bar.
  const [fromUseCases, setFromUseCases] = useState(() => cameFromUseCases());
  useEffect(() => {
    if (location.pathname === '/use-cases') {
      clearCameFromUseCases();
      setFromUseCases(false);
      return;
    }
    setFromUseCases(cameFromUseCases());
  }, [location.pathname]);

  /** Navigate back to the use-case catalog and clear the launcher-origin flag. */
  function handleUseCasesNav() {
    clearCameFromUseCases();
    setFromUseCases(false);
    navigate('/use-cases');
  }

  const isAdmin = user?.role === 'admin';
  const isAdminView =
    isAdmin &&
    (location.pathname.startsWith('/admin') ||
      location.pathname === '/users' ||
      location.pathname === '/activity' ||
      location.pathname === '/audit' ||
      location.pathname === '/configure' ||
      location.pathname === '/settings' ||
      location.pathname === '/scope-audit' ||
      location.pathname === '/scope-reference' ||
      location.pathname === '/feature-flags' ||
      location.pathname === '/pingone-test' ||
      location.pathname === '/mfa-test' ||
      location.pathname === '/error-audit' ||
      location.pathname === '/oauth-debug');

  // Real token switch (not a view toggle): signs out and re-logs in under the
  // other role so the session carries a token actually issued for that role.
  // Admins can't view the customer dashboard with an admin token, so the only
  // way there is to switch to a user token.
  const { switching, switchRole } = useRoleSwitch();
  const handleSwitchRole = () => switchRole(isAdmin ? 'customer' : 'admin');

  function formatCountdown(seconds) {
    if (seconds === null || seconds < 0) return '';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }

  const tokenExpiring = tokenSecondsLeft !== null && tokenSecondsLeft > 0 && tokenSecondsLeft < 300;
  const tokenExpired = tokenSecondsLeft !== null && tokenSecondsLeft <= 0;
  const hasActiveToken = !!user && tokenIsActive;

  const displayName =
    (user?.firstName && user?.lastName)
      ? `${user.firstName} ${user.lastName}`
      : user?.username || user?.email || null;

  return (
    <header className="topnav">
      <div className="topnav-container">

        {/* Left: Brand */}
        <div className="topnav-left">
          <button
            type="button"
            className="topnav-brand"
            onClick={() => navigate(user?.role === 'admin' ? '/admin' : '/dashboard')}
            aria-label="Go to dashboard"
          >
            <BrandIcon className="topnav-brand-icon" />
            <span className="topnav-brand-name">{brandName}</span>
          </button>
        </div>

        {/* Context chip — Customer / Admin / Setup */}
        {user && (
          <span className="topnav-context-chip">
            {location.pathname === '/setup' || location.pathname.startsWith('/setup/')
              ? 'Setup'
              : isAdminView
                ? 'Admin'
                : 'Customer'}
          </span>
        )}

        {/* Vertical switcher — visible to everyone (guests too) so the
            demo flow can be tailored before sign-in. The switcher hides
            itself when fewer than 2 verticals exist. */}
        <VerticalSwitcher variant="nav" />

        {/* Quick Flags — live validation-mode pill + curated demo switches.
            Visible to everyone (read-only without an admin session). */}
        <QuickFlagsPill user={user} />

        {/* 3-tab nav — admin gets all three; customer gets nothing here (chip is enough) */}
        {user?.role === 'admin' && (
          <nav className="topnav-nav">
            <button
              type="button"
              className={`topnav-nav-link${location.pathname === '/dashboard' ? ' topnav-nav-link--active' : ''}`}
              onClick={() => navigate('/dashboard')}
            >
              Customer
            </button>
            <button
              type="button"
              className={`topnav-nav-link${isAdminView ? ' topnav-nav-link--active' : ''}`}
              onClick={() => navigate('/admin')}
            >
              Admin
            </button>
            <button
              type="button"
              className={`topnav-nav-link${location.pathname.startsWith('/setup') ? ' topnav-nav-link--active' : ''}`}
              onClick={() => navigate('/setup')}
            >
              Setup
            </button>
          </nav>
        )}

        <button
          type="button"
          className={[
            'topnav-use-cases-btn',
            location.pathname === '/use-cases' ? 'topnav-use-cases-btn--active' : '',
            fromUseCases ? 'topnav-use-cases-btn--back' : '',
          ].filter(Boolean).join(' ')}
          onClick={handleUseCasesNav}
          title={fromUseCases ? 'Back to use cases' : 'Browse all use cases'}
          data-testid="topnav-use-cases"
        >
          {fromUseCases ? '← Use Cases' : 'Use Cases'}
        </button>

        <span className="topnav-spacer" aria-hidden="true" />

        {/* Right: scrollable controls area + always-visible user menu */}
        <div className="topnav-right">

          {/* Scrollable middle: dashboard controls + token pill + search + login.
              These can overflow on narrow screens; they scroll behind the UserMenu. */}
          <div className="topnav-right-scroll">

            {/* Dashboard controls — only when viewing /dashboard. */}
            {location.pathname === '/dashboard' && (
              <div className="topnav-dashboard-controls" role="toolbar" aria-label="Dashboard actions">
                <AgentUiModeToggle variant="config" />
                <ThresholdControls />
                <button
                  type="button"
                  className="topnav-reset-demo-btn"
                  title="Reset demo: clear agent history and token chain"
                  onClick={() => window.dispatchEvent(new CustomEvent('dashboard:open-reset-modal'))}
                >
                  Reset Demo
                </button>
              </div>
            )}

            {/* Token pill — only when user is logged in */}
            {user && (
              <div
                className={[
                  'topnav-token-pill',
                  staleSession ? 'topnav-token-pill--stale' : '',
                  (!staleSession && !tokenLoading && tokenSecondsLeft === null) ? 'topnav-token-pill--expired' : '',
                  (!staleSession && tokenExpiring) ? 'topnav-token-pill--expiring' : '',
                  (!staleSession && tokenExpired) ? 'topnav-token-pill--expired' : '',
                ].filter(Boolean).join(' ')}
                role="status"
                aria-label="Session status"
              >
                {tokenLoading && (
                  <span className="topnav-token-pill__shimmer" aria-hidden="true" />
                )}
                {/* Stale: customer tokens gone but admin session alive — hide countdown, show which session is healthy */}
                {!tokenLoading && staleSession && (
                  <>
                    <span className="topnav-token-pill__dot" aria-hidden="true" />
                    {sessionType === 'admin' && (
                      <span className="topnav-token-pill__session-label">Admin</span>
                    )}
                    <span className="topnav-token-pill__countdown">{formatCountdown(tokenSecondsLeft)}</span>
                    {openTokenModal && (
                      <button
                        type="button"
                        className="topnav-token-pill__view-btn"
                        onClick={openTokenModal}
                        title="View token details"
                      >
                        View Token
                      </button>
                    )}
                  </>
                )}
                {!tokenLoading && !staleSession && tokenSecondsLeft === null && (
                  <>
                    <span className="topnav-token-pill__dot" aria-hidden="true" />
                    <span className="topnav-token-pill__expired-label">No token — please sign in</span>
                  </>
                )}
                {!staleSession && tokenSecondsLeft !== null && !tokenExpired && (
                  <>
                    <span className="topnav-token-pill__dot" aria-hidden="true" />
                    {sessionType && (
                      <span className="topnav-token-pill__session-label">
                        {sessionType === 'admin' ? 'Admin' : 'Customer'}
                      </span>
                    )}
                    {displayName && <span className="topnav-token-pill__name">{displayName}</span>}
                    <span className="topnav-token-pill__countdown">{formatCountdown(tokenSecondsLeft)}</span>
                    {openTokenModal && (
                      <button
                        type="button"
                        className="topnav-token-pill__view-btn"
                        onClick={openTokenModal}
                        title="View token details"
                      >
                        View Token
                      </button>
                    )}
                  </>
                )}
                {!staleSession && tokenExpired && (
                  <>
                    <span className="topnav-token-pill__dot" aria-hidden="true" />
                    <span className="topnav-token-pill__expired-label">Session expired</span>
                    <button
                      type="button"
                      className="topnav-token-pill__view-btn"
                      onClick={() => navigateToCustomerOAuthLogin()}
                    >
                      Sign In
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Search → Code Search (RAG) page */}
            <div className="topnav-search">
              <button
                className="topnav-search-btn"
                onClick={() => navigate('/code-search')}
                aria-label="Search code"
                type="button"
                title="Code Search"
              >
                <MdSearch size={20} />
              </button>
            </div>

          </div>

          {/* Always-visible session actions — Switch + Sign Out/Sign In never
              scroll off behind the user menu (the reported "no way to logout"). */}
          <div className="topnav-session-actions">
            {hasActiveToken && (
              <button
                type="button"
                className="topnav-switch-btn"
                onClick={handleSwitchRole}
                disabled={switching}
                title={isAdmin
                  ? 'Switch to a user token (sign in as a customer)'
                  : 'Switch to an admin token (sign in as an admin)'}
              >
                <MdSwapHoriz size={18} />
                <span>{switching ? 'Switching…' : (isAdmin ? 'Switch to user' : 'Switch to admin')}</span>
              </button>
            )}

            {/* Auth button — Sign Out only when token is confirmed active */}
            {hasActiveToken ? (
              <button type="button" className="topnav-login-btn topnav-logout-btn" onClick={() => onLogout?.()}>
                <MdLogout size={18} />
                <span>Sign Out</span>
              </button>
            ) : !tokenLoading ? (
              <button type="button" className="topnav-login-btn" onClick={() => navigateToCustomerOAuthLogin()}>
                <MdLogin size={18} />
                <span>Sign In</span>
              </button>
            ) : null}
          </div>

          {/* User menu — always visible, never scrolls off */}
          <UserMenu
            user={user}
            onLogout={onLogout}
            isAdminView={isAdminView}
            onSwitchView={handleSwitchRole}
          />
        </div>

      </div>
    </header>
  );
}
