/**
 * MortgagePathPage.jsx — Phase 266 / Phase 267 Path A landing page.
 *
 * The agent navigates the user here after the "show mortgage data" prompt
 * AFTER it has already invoked the gateway tool (api_key disposition) and
 * received the mortgage payload. The payload is passed via React Router
 * location.state so this page does NOT make a direct BFF call — the demo
 * narrative is that the gateway is the sole caller of banking_mortgage_service.
 *
 * If a user arrives at /path/mortgage without state (direct URL navigation,
 * bookmark, refresh), the page renders a "no data — go run the prompt"
 * empty state with a button back to the dashboard. Phase 267 will wire the
 * gateway api_key disposition end-to-end; until then, navigating here
 * directly produces the empty state.
 *
 * Visual identity: amber — distinguishes Path A from Path B (teal) and
 * Path C (blue). No emojis (REGRESSION_PLAN §0).
 */
import { useNavigate, useLocation } from 'react-router-dom';
import './MortgagePathPage.css';

function fmtMoney(amt, currency = 'USD') {
  if (typeof amt !== 'number') return String(amt ?? '');
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amt);
}

function fmtPct(rate) {
  if (typeof rate !== 'number') return String(rate ?? '');
  return `${rate.toFixed(3)}%`;
}

export default function MortgagePathPage() {
  const navigate = useNavigate();
  const location = useLocation();
  // The BankingAgent passes the gateway response via location.state after the
  // api_key disposition fires. Shape: { mortgage, apiKeyMaskedLast4, backend, message }.
  const data = location.state?.mortgagePayload || null;

  if (!data) {
    return (
      <div className="mpp-container">
        <header className="mpp-header">
          <span className="mpp-badge">API-KEY PATH</span>
          <h1 className="mpp-title">Mortgage data not loaded</h1>
          <p className="mpp-subtitle">
            This page renders mortgage data returned by the MCP gateway's api_key
            disposition. To see the data, ask the agent: <code>show mortgage data</code>.
            The agent will call the gateway, which swaps your OAuth bearer for a
            service API key, calls banking_mortgage_service, and routes you back here
            with the result.
          </p>
        </header>
        <div className="mpp-actions">
          <button className="mpp-back-btn" onClick={() => navigate('/dashboard')}>Back to Dashboard</button>
        </div>
      </div>
    );
  }

  const m = data.mortgage || {};

  return (
    <div className="mpp-container">
      <header className="mpp-header">
        <span className="mpp-badge">API-KEY PATH</span>
        <h1 className="mpp-title">Mortgage account</h1>
        <p className="mpp-subtitle">{data.message}</p>
      </header>

      <section className="mpp-card mpp-card--mortgage">
        <h2 className="mpp-card-title">Loan details</h2>
        <dl className="mpp-fields">
          <div className="mpp-field-row">
            <dt>Property</dt>
            <dd>{m.propertyAddress}</dd>
          </div>
          <div className="mpp-field-row">
            <dt>Term</dt>
            <dd>{m.term}</dd>
          </div>
          <div className="mpp-field-row">
            <dt>Origination date</dt>
            <dd>{m.originationDate}</dd>
          </div>
          <div className="mpp-field-row">
            <dt>Interest rate</dt>
            <dd>{fmtPct(m.interestRate)}</dd>
          </div>
          <div className="mpp-field-row">
            <dt>Original loan amount</dt>
            <dd>{fmtMoney(m.loanAmount, m.currency)}</dd>
          </div>
          <div className="mpp-field-row mpp-field-row--accent">
            <dt>Current balance</dt>
            <dd>{fmtMoney(m.currentBalance, m.currency)}</dd>
          </div>
          <div className="mpp-field-row">
            <dt>Monthly payment</dt>
            <dd>{fmtMoney(m.monthlyPayment, m.currency)}</dd>
          </div>
          <div className="mpp-field-row">
            <dt>Next payment due</dt>
            <dd>{m.nextPaymentDate}</dd>
          </div>
        </dl>
      </section>

      <section className="mpp-card mpp-card--swap">
        <h2 className="mpp-card-title">Credential swap</h2>
        <p className="mpp-swap-line">
          <strong>Gateway swapped your OAuth bearer</strong> for a service API key before
          calling the backend. The user's bearer never reached banking_mortgage_service.
        </p>
        <div className="mpp-swap-row">
          <span className="mpp-swap-label">Service API key (last 4 chars only):</span>
          <code className="mpp-swap-value">****{data.apiKeyMaskedLast4 || 'XXXX'}</code>
        </div>
        <ul className="mpp-swap-details">
          <li><strong>Source:</strong> {data.backend?.source || 'banking_mortgage_service'}</li>
          <li><strong>Auth mechanism:</strong> {data.backend?.authMechanism || 'X-API-Key (shared secret)'}</li>
          <li><strong>Note:</strong> {data.backend?.note}</li>
        </ul>
      </section>

      <div className="mpp-actions">
        <button className="mpp-back-btn" onClick={() => navigate('/dashboard')}>Back to Dashboard</button>
      </div>
    </div>
  );
}
