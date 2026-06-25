// banking_api_ui/src/components/TransactionConsentPage.js
import React from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import TransactionConsentModal from './TransactionConsentModal';
import '../styles/appShellPages.css';
import './TransactionConsentPage.css';

/**
 * Route wrapper for deep links: `/transaction-consent?challenge=…` opens the same popup as the dashboard.
 */
export default function TransactionConsentPage({ user }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const challengeId = searchParams.get('challenge');
  const restore = location.state?.restore;

  const homePath = user?.role === 'admin' ? '/admin' : '/dashboard';

  if (!user) {
    return <Navigate to="/" replace />;
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
