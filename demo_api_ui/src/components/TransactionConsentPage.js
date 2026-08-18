// banking_api_ui/src/components/TransactionConsentPage.js
import React, { useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import SignInPrompt from './SignInPrompt';
import TransactionConsentModal from './TransactionConsentModal';
import '../styles/appShellPages.css';
import './TransactionConsentPage.css';

/**
 * Simulated consent scenario presets.
 */
const SIMULATE_SCENARIOS = [
  {
    id: 'standard-transfer',
    label: 'Standard Transfer ($500)',
    snapshot: { amount: 500, type: 'transfer', description: 'Monthly rent payment' },
  },
  {
    id: 'high-value',
    label: 'High-Value Transfer ($15,000)',
    snapshot: { amount: 15000, type: 'transfer', description: 'Investment portfolio transfer' },
  },
  {
    id: 'withdrawal',
    label: 'ATM Withdrawal ($200)',
    snapshot: { amount: 200, type: 'withdrawal', description: 'Cash withdrawal' },
  },
  {
    id: 'agent-initiated',
    label: 'AI Agent-Initiated ($2,500)',
    snapshot: { amount: 2500, type: 'transfer', description: 'Agent: pay utility bill' },
  },
];

/**
 * Simulate mode landing — shown when no ?challenge= is present.
 * Lets the user pick a scenario and see the consent modal with mock data.
 */
function SimulateLanding({ user, onStartSimulation }) {
  return (
    <div className="tc-simulate">
      <div className="tc-simulate__header">
        <h1 className="tc-simulate__title">Transaction Consent — Simulate</h1>
        <p className="tc-simulate__subtitle">
          This page normally activates via a CIBA push notification with a challenge ID.
          Use the scenarios below to see how the consent modal works without a live challenge.
        </p>
      </div>

      <div className="tc-simulate__info">
        <div className="tc-simulate__info-icon">i</div>
        <div>
          <strong>How it works in production:</strong> When a high-value transaction triggers a step-up
          requirement, PingOne sends a CIBA (Client-Initiated Backchannel Authentication) push to
          the user&apos;s device. The user opens this page via the push link containing a challenge ID,
          reviews the transaction details, and approves or denies.
        </div>
      </div>

      <div className="tc-simulate__scenarios">
        <h2 className="tc-simulate__section-title">Pick a scenario to simulate</h2>
        <div className="tc-simulate__grid">
          {SIMULATE_SCENARIOS.map((s) => (
            <button
              key={s.id}
              className="tc-simulate__card"
              onClick={() => onStartSimulation(s)}
            >
              <span className="tc-simulate__card-label">{s.label}</span>
              <span className="tc-simulate__card-desc">{s.snapshot.description}</span>
              <span className="tc-simulate__card-meta">
                {s.snapshot.type} — ${Number(s.snapshot.amount).toLocaleString()}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="tc-simulate__flow">
        <h2 className="tc-simulate__section-title">CIBA Consent Flow</h2>
        <ol className="tc-simulate__steps">
          <li>User (or AI agent) initiates a transaction that exceeds the authorization threshold</li>
          <li>PingOne Authorize returns a step-up obligation (CIBA consent required)</li>
          <li>BFF calls PingOne CIBA endpoint — sends push notification to user&apos;s device</li>
          <li>User opens this page via the deep link (<code>/transaction-consent?challenge=...</code>)</li>
          <li>User reviews transaction details, enters OTP, and approves or denies</li>
          <li>PingOne completes the CIBA flow — transaction proceeds or is blocked</li>
        </ol>
      </div>
    </div>
  );
}

/**
 * Route wrapper for deep links: `/transaction-consent?challenge=…` opens the consent modal.
 * Without a challenge, shows simulate mode instead of redirecting away.
 */
export default function TransactionConsentPage({ user }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const challengeId = searchParams.get('challenge');
  const restore = location.state?.restore;
  const [simulating, setSimulating] = useState(null);

  const homePath = user?.role === 'admin' ? '/admin' : '/dashboard';

  if (!user) {
    // CIBA push deep-links land here signed out — show the page and ask,
    // never dump on home. (return_to is a bare path; the ?challenge= param
    // does not survive login — the push notification link remains the way back.)
    return <SignInPrompt message="Sign in to review this transfer approval." />;
  }

  // Live mode: real challenge from CIBA push
  if (challengeId) {
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

  // Simulate mode: show scenario picker or simulated modal
  if (simulating) {
    return (
      <TransactionConsentModal
        open
        challengeId="simulate-demo"
        user={user}
        simulated
        preloadedSnapshot={simulating.snapshot}
        onClose={() => setSimulating(null)}
        onTransactionSuccess={() => setSimulating(null)}
        onDeclinedConfirmed={() => setSimulating(null)}
      />
    );
  }

  return <SimulateLanding user={user} onStartSimulation={setSimulating} />;
}
