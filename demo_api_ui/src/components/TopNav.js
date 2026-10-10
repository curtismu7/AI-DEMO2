import PageGuideButton from './PageGuideButton';
import { useEffect, useState } from "react";
import {
  MdAccountBalance, MdLogin, MdLogout, MdSearch, MdSwapHoriz,
  MdLocalHospital, MdShoppingCart, MdStorefront, MdWork, MdSportsBasketball,
  MdFlight, MdGavel, MdSchool, MdRestaurant, MdDirectionsCar,
} from "react-icons/md";
import { useLocation, useNavigate } from "react-router-dom";
import { useSessionToken } from "../context/SessionTokenContext";
import { useTheme } from "../context/ThemeContext";
import { useRoleSwitch } from "../hooks/useRoleSwitch";
import { useAgentUiMode } from "../context/AgentUiModeContext";
import { useVertical } from "../vertical/useVertical";
import { navigateToCustomerOAuthLogin } from "../utils/authUi";
import {
  cameFromUseCases,
  clearCameFromUseCases,
} from "../utils/fromUseCasesNav";
import ThresholdControls from "./ThresholdControls";
import QuickFlagsPill from "./QuickFlagsPill";
import UserMenu from "./UserMenu";
import FavoritesMenu from "./FavoritesMenu";
import VerticalSwitcher from "./VerticalSwitcher";
import OAuthProviderToggle from "./OAuthProviderToggle";
import ConfirmModal from "./ConfirmModal";
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
  const { tokenSecondsLeft, tokenLoading, sessionType, staleSession, hasRefreshToken, hasActiveToken, openTokenModal } = useSessionToken();
  const { darkMode, toggleDarkMode, fontScale, cycleFontScale } = useTheme();
  // Dashboard split-column mode: the Command Dock owns these demo controls
  // (vertical switcher, Configuration, thresholds, Reset Demo, P1/PF), so the
  // top bar drops them to keep one home per control. Any other route or
  // agent placement keeps the classic top-bar controls.
  const { placement: agentPlacement } = useAgentUiMode();
  const dockOwnsDashboardControls =
    location.pathname === "/dashboard" && agentPlacement === "middle";
  const brandName = (identity && (identity.headerTitle || identity.displayName)) || 'AI Demo';
  // Per-vertical brand icon (manifest identity.icon); unknown/absent → bank icon.
  const BrandIcon = (identity && BRAND_ICONS[identity.icon]) || MdAccountBalance;
  // Ping-branded surfaces keep the Ping Identity mark; a customer vertical's
  // page shows only that vertical's brand. Admin/setup routes are Ping surfaces
  // regardless of the active vertical.
  const PING_SURFACE_VERTICALS = ['admin', 'admin-console', 'pingone-admin', 'oauth-teaching', 'a2a'];
  const onPingSurfaceRoute =
    location.pathname.startsWith('/admin') ||
    location.pathname.startsWith('/setup') ||
    location.pathname.startsWith('/pingone');
  const showPingMark =
    onPingSurfaceRoute ||
    !pageManifest ||
    PING_SURFACE_VERTICALS.includes(pageManifest?.id) ||
    !identity?.logoPath;

  // Sign Out asks first — an accidental sign-out kills the token chain and
  // the live demo mid-run. The modal interposes; performLogout semantics
  // (token revocation, PingOne signoff) stay untouched behind it.
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const requestLogout = () => setShowLogoutConfirm(true);

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

  // Asymmetric by design. Going to the customer dashboard is a view change: it
  // renders without authentication (demo data when the token can't read customer
  // records), so it must not sign the admin out. Going to admin is a real
  // identity change and still re-logs in under an admin token.
  //
  // The previous comment here said an admin "can't view the customer dashboard
  // with an admin token, so the only way there is to switch" — that stopped
  // being true when the dashboard started falling back to demo data on
  // admin_token_forbidden.
  const { switching, switchRole } = useRoleSwitch();
  const handleSwitchRole = () => {
    if (isAdmin) {
      navigate('/dashboard');
      return;
    }
    switchRole('admin');
  };

  function formatCountdown(seconds) {
    if (seconds === null || seconds < 0) return '';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }

  const tokenExpiring = tokenSecondsLeft !== null && tokenSecondsLeft > 0 && tokenSecondsLeft < 300;
  const tokenExpired = tokenSecondsLeft !== null && tokenSecondsLeft <= 0;
  // Presence is the signal: keep the red R visible even if the access token
  // expired or a refresh attempt failed transiently. The server hides it once
  // the refresh token is gone or revoked.
  const showRefreshMarker = !!user && hasRefreshToken;
  const refreshMarker = showRefreshMarker ? (
    <span
      className="topnav-token-pill__refresh-marker"
      title="Refresh token present — access token refreshes automatically near expiry"
      aria-label="Refresh token present"
    >
      R
    </span>
  ) : null;

  const displayName =
    (user?.firstName && user?.lastName)
      ? `${user.firstName} ${user.lastName}`
      : user?.username || user?.email || null;

  return (
    <header className="topnav">
      <div className="topnav-container">

        {/* Left: Brand — Ping mark on Ping surfaces, vertical logo elsewhere.
            The brand button always opens the Demo Summary page (Ctrl+Shift+B
            toggles the side nav). */}
        <div className="topnav-left">
          {showPingMark ? (
            <div className="topnav-ping-identity" aria-label="Ping Identity">
              <img
                src="/assets/ping-identity-logo.png"
                alt="Ping Identity"
                className="topnav-ping-identity-logo"
              />
            </div>
          ) : null}
          <button
            type="button"
            className="topnav-brand"
            onClick={() => navigate('/demo-summary')}
            title="Demo Summary — everything you can demo"
            aria-label="Demo Summary"
          >
            {identity?.logoPath
              ? <img src={identity.logoPath} alt={identity.logoAlt || brandName} className="topnav-brand-logo" />
              : <BrandIcon className="topnav-brand-icon" />}
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
            itself when fewer than 2 verticals exist. Hidden on the dashboard
            split-column layout, where the Command Dock hosts it instead. */}
        {!dockOwnsDashboardControls && <VerticalSwitcher variant="nav" />}

        {/* Quick Flags — live validation-mode pill + curated demo switches.
            Visible to everyone (read-only without an admin session). Hidden
            on the dashboard split-column layout (Command Dock hosts it). */}
        {!dockOwnsDashboardControls && <QuickFlagsPill user={user} />}

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

        <PageGuideButton />

        <span className="topnav-spacer" aria-hidden="true" />

        {/* Right: scrollable controls area + always-visible user menu */}
        <div className="topnav-right">

          {/* Scrollable middle: dashboard controls + token pill + search + login.
              These can overflow on narrow screens; they scroll behind the UserMenu. */}
          <div className="topnav-right-scroll">

            {/* Dashboard controls — only when viewing /dashboard. Hidden in
                split-column mode: the Command Dock hosts thresholds + Reset
                Demo there. */}
            {location.pathname === '/dashboard' && !dockOwnsDashboardControls && (
              <div className="topnav-dashboard-controls" role="toolbar" aria-label="Dashboard actions">
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
                    {refreshMarker}
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
                    {refreshMarker}
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
                    {refreshMarker}
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
                    {refreshMarker}
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

          {/* Keep the dropdown outside the horizontal scroller. The menu is
              absolutely positioned below this control, and the scroller's
              overflow clipping would hide it after the trigger opens it. */}
          <FavoritesMenu />

          {/* In split dashboard mode the Demo Steps panel is opened from the
              page header, beside Favorites, while the panel itself stays in
              the same draggable/resizable floating window. */}
          {dockOwnsDashboardControls && (
            <button
              type="button"
              className="topnav-demo-steps-btn"
              onClick={() => window.dispatchEvent(new CustomEvent('agent-demo-steps-open'))}
              title="Open Demo steps"
              aria-label="Demo steps"
              data-testid="topnav-demo-steps-trigger"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M9 6h12M9 12h12M9 18h12" />
                <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
              </svg>
              <span>Demo steps</span>
            </button>
          )}

          {/* OAuth provider toggle — visible to everyone. Switches the BFF's
              login provider (PingOne ⇄ PingFederate) at runtime; no restart
              needed because every OAuth config getter reads the provider
              lazily. Changing provider invalidates the current token chain,
              so the user is signed out after the switch. The component hides
              itself if the BFF config endpoint is unreachable. Keep it in the
              shared top bar so it remains available when the dashboard agent
              dock is collapsed. */}
          <OAuthProviderToggle />

          {/* Theme toggle — always visible (outside the scroll area) so it never
              scrolls off, and available to every page since TopNav is app-wide. */}
          <button
            type="button"
            className="topnav-theme-toggle"
            onClick={toggleDarkMode}
            title="Switch between light and dark mode"
            aria-pressed={darkMode}
            aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {darkMode ? '☀️' : '🌙'}
          </button>

          {/* Font sizer — demo-projector dial. Cycles the page zoom (ThemeContext
              owns the scale and applies it to <html>); the label shows the current
              step so the presenter knows where they are. Always visible, same
              reasoning as the theme toggle. */}
          <button
            type="button"
            className="topnav-font-size-btn"
            onClick={cycleFontScale}
            title={`Page text size: ${Math.round(fontScale * 100)}% — click to step larger (wraps to 100%)`}
            aria-label={`Page text size ${Math.round(fontScale * 100)} percent, click to step larger`}
            data-testid="topnav-font-size-btn"
          >
            <span aria-hidden="true">A</span>
            <span className="topnav-font-size-value">{Math.round(fontScale * 100)}%</span>
          </button>

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
              <button type="button" className="topnav-login-btn topnav-logout-btn" onClick={requestLogout}>
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
            onLogout={requestLogout}
            isAdminView={isAdminView}
            onSwitchView={handleSwitchRole}
          />
        </div>

      </div>

      <ConfirmModal
        isOpen={showLogoutConfirm}
        title="Sign out?"
        message="This ends your session and clears the live token chain. Sign back in to continue."
        confirmLabel="Sign Out"
        danger
        onConfirm={() => { setShowLogoutConfirm(false); onLogout?.(); }}
        onCancel={() => setShowLogoutConfirm(false)}
      />
    </header>
  );
}
