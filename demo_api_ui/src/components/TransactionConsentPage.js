// banking_api_ui/src/components/TransactionConsentPage.js
import React from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { navigateToCustomerOAuthLogin } from '../utils/authUi';
import TransactionConsentModal from './TransactionConsentModal';
import '../styles/appShellPages.css';
import './TransactionConsentPage.css';

/**
 * Route wrapper for deep links: `/transaction-consent?challenge=…` opens the same popup as the dashboard.
 *
 * This route is accessible without authentication so that deep-links from
 * external systems (e.g. PingOne Authorize challenge redirects) land correctly.
 * If the user is not logged in, we redirect to the BFF OAuth login with a
 * return_to parameter so the user lands back here after authenticating.
 */
export default function TransactionConsentPage({ user }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const challengeId = searchParams.get('challenge');
  const restore = location.state?.restore;

  const homePath = user?.role === 'admin' ? '/admin' : '/dashboard';

  if (!user) {
    // Redirect to the BFF OAuth login, preserving the full return URL (path + query)
    // so the user lands back on this page after authenticating.
    const returnPath = `${location.pathname}${location.search}`;
    navigateToCustomerOAuthLogin(returnPath);
    return null;
  }

  if (!challengeId) {
    // Show a helpful message instead of silently redirecting
    return (
      <div className="transaction-consent-card" style={{ marginTop: '3rem', textAlign: 'center' }}>
        <h2 className="transaction-consent-card__h2">No Transaction Challenge Found</h2>
        <p style={{ color: '#64748b', marginBottom: '1rem' }}>
          This page requires a <code>?challenge=</code> parameter to display a transaction consent request.
          Please initiate a transaction from your dashboard.
        </p>
        <button
          className="transaction-consent-btn transaction-consent-btn--primary"
          onClick={() => navigate(homePath, { replace: true })}
        >
          Go to Dashboard
        </button>
      </div>
    );
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
