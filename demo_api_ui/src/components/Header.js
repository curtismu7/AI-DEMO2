import React, { useState, useEffect } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import BrandLogo from './BrandLogo';
import './Header.css';

/** Session expiry countdown shown in the top header. */
function HeaderSessionTimer({ user }) {
  const [timeRemaining, setTimeRemaining] = useState(null);

  useEffect(() => {
    if (!user?.expiresAt) return;
    const calc = () => {
      const remaining = Math.max(0, new Date(user.expiresAt).getTime() - Date.now());
      setTimeRemaining(remaining);
    };
    calc();
    const id = setInterval(calc, 1000);
    return () => clearInterval(id);
  }, [user?.expiresAt]);

  if (!timeRemaining || timeRemaining <= 0) return null;

  const minutes = Math.floor(timeRemaining / 60000);
  const seconds = Math.floor((timeRemaining % 60000) / 1000);
  const label = `${minutes}:${seconds.toString().padStart(2, '0')}`;
  const expiringSoon = timeRemaining < 5 * 60 * 1000;

  return (
    <span
      className={`header-session-timer${expiringSoon ? ' header-session-timer--expiring' : ''}`}
      title={`Session expires in ${label}`}
    >
      {label}
    </span>
  );
}

/**
 * Calls POST /api/auth/switch then navigates to the returned login URL.
 * The OAuth callback clears the _switch_target cookie and redirects to the
 * correct dashboard. The plan (P2) describes the full flow with token stashing.
 */
async function callSwitchRole(targetRole) {
  const r = await fetch('/api/auth/switch', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetRole }),
  });
  if (!r.ok) throw new Error(`Switch failed: ${r.status}`);
  const { redirectUrl } = await r.json();
  window.location.href = redirectUrl;
}

const Header = ({ user, onLogout }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const isAdmin = user?.role === 'admin';
  const [switching, setSwitching] = useState(false);

  // Asymmetric by design. "Customer view" is a view change — the customer
  // dashboard renders without authentication (demo data when the token cannot
  // read customer records), so it must not sign the admin out. "Admin view" is
  // a real identity change and still re-authenticates.
  const handleSwitchRole = async () => {
    if (isAdmin) {
      navigate('/dashboard');
      return;
    }
    setSwitching(true);
    try {
      await callSwitchRole('admin');
    } catch (e) {
      console.error('[Header] Role switch failed:', e.message);
      setSwitching(false);
    }
  };

  return (
    <header className="header app-top-header">
      <div className="container">
        <div className="app-top-header__brand">
          <BrandLogo className="app-top-header__logo" height={32} width={32} />
          <h1 className="app-top-header__title">
            {isAdmin ? 'Accounts API Admin Dashboard' : 'Personal Account Dashboard'}
          </h1>
        </div>
        <nav className="nav">
            {isAdmin ? (
              <>
                <NavLink 
                  to="/admin" 
                  className={`nav-link ${location.pathname === '/admin' ? 'active' : ''}`}
                >
                  Admin Dashboard
                </NavLink>
                <NavLink 
                  to="/activity" 
                  className={`nav-link ${location.pathname === '/activity' ? 'active' : ''}`}
                >
                  Activity Logs
                </NavLink>
                <NavLink 
                  to="/users" 
                  className={`nav-link ${location.pathname === '/users' ? 'active' : ''}`}
                >
                  Users
                </NavLink>
                <NavLink 
                  to="/accounts" 
                  className={`nav-link ${location.pathname === '/accounts' ? 'active' : ''}`}
                >
                  Accounts
                </NavLink>
                <NavLink 
                  to="/transactions" 
                  className={`nav-link ${location.pathname === '/transactions' ? 'active' : ''}`}
                >
                  Transactions
                </NavLink>
                <NavLink
                  to="/config"
                  className={`nav-link ${location.pathname === '/config' ? 'active' : ''}`}
                >
                  Config
                </NavLink>
                <NavLink 
                  to="/postman" 
                  className={`nav-link ${location.pathname === '/postman' ? 'active' : ''}`}
                >
                  Postman
                </NavLink>
              </>
            ) : (
              <NavLink 
                to="/dashboard" 
                className={`nav-link ${location.pathname === '/dashboard' ? 'active' : ''}`}
              >
                My Dashboard
              </NavLink>
            )}
            <div className="app-top-header__user">
              <HeaderSessionTimer user={user} />
              <span>Welcome, {user.firstName} {user.lastName}</span>
              <button
                type="button"
                onClick={handleSwitchRole}
                disabled={switching}
                className="btn btn-secondary header-switch-role-btn"
                title={`Switch to ${isAdmin ? 'Customer' : 'Admin'} view`}
              >
                {switching ? '…' : `⇄ ${isAdmin ? 'Customer' : 'Admin'} view`}
              </button>
              <button type="button" onClick={onLogout} className="btn btn-secondary">
                Sign Out
              </button>
            </div>
        </nav>
      </div>
    </header>
  );
};

export default Header;
