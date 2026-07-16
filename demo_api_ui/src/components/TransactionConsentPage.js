// banking_api_ui/src/components/TransactionConsentPage.js
import React from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import TransactionConsentModal from './TransactionConsentModal';
import '../styles/appShellPages.css';
import './TransactionConsentPage.css';

/**
 * Route wrapper for deep links: `/transaction-consent?challenge=…` opens the same popup as the dashboard.
 *
 * This route is accessible without authentication so that deep-links from
 * external systems (e.g. PingOne Authorize challenge redirects) land correctly.
 * If the user is not logged in, we redirect to the OAuth login flow and
 * preserve the current URL so they return here after authenticating.
 */
export default function TransactionConsentPage({ user }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const challengeId = searchParams.get('challenge');
  const restore = location.state?.restore;

  const homePath = user?.role === 'admin' ? '/admin' : '/dashboard';

  if (!user) {
    // Redirect to login, preserving the full return URL (path + query string)
    // so the user lands back on this page after authenticating.
    const returnUrl = `${location.pathname}${location.search}`;
    return <Navigate to={`/?returnTo=${encodeURIComponent(returnUrl)}`} replace />;
  }

  if (!challengeId) {
    return <Navigate to={homePath} replace />;
  }

  return (
    <TransactionConsentModal
      open
      challengeId={challengeId}
      user={user}
      onClose={() => navigate(homePath, { replace: true })}
      onTransactionSuccess={(msg) => navigate(homePath, { state: { transactionSuccess: msg } })}
      onDeclinedConfirmed={() => navigate(homePath, { state: { restore, consentDeclined: true } })}
    />
  );
}
