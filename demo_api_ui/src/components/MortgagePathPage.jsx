/**
 * MortgagePathPage.jsx — Phase 266 / Phase 267 Path A landing page.
 *
 * The agent navigates the user here after the "show mortgage data" prompt
 * AFTER it has already invoked the gateway tool (api_key disposition) and
 * received the mortgage payload. The payload is passed via React Router
 * location.state so this page does NOT make a direct BFF call — the demo
 * narrative is that the gateway is the sole caller of banking_api_resource_server.
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
import { formatCurrency, formatPercent } from '../utils/formatters';
import TokenChainTraceRail from './TokenChainTraceRail';
import { useThemeOptional } from '../context/ThemeContext';
import './MortgagePathPage.css';

function ThemeToggleButton() {
  const { darkMode, toggleDarkMode } = useThemeOptional();
  return (
    <button
      type="button"
      onClick={toggleDarkMode}
      className="mpp-theme-toggle"
      title="Switch this page between light and dark"
      aria-pressed={darkMode}
    >
      {darkMode ? '☀️ Light mode' : '🌙 Dark mode'}
    </button>
  );
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
        <ThemeToggleButton />
        <header className="mpp-header">
          <span className="mpp-badge">API-KEY PATH</span>
          <h1 className="mpp-title">Mortgage data not loaded</h1>
          <p className="mpp-subtitle">
            This page renders mortgage data returned by the MCP gateway's api_key
            disposition. To see the data, ask the agent: <code>show mortgage data</code>.
            The agent will call the gateway, which swaps your OAuth bearer for a
            service API key, calls banking_api_resource_server, and routes you back here
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
      <ThemeToggleButton />
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
            <dd>{formatPercent(m.interestRate, 3)}</dd>
          </div>
          <div className="mpp-field-row">
            <dt>Original loan amount</dt>
            <dd>{formatCurrency(m.loanAmount, m.currency)}</dd>
          </div>
          <div className="mpp-field-row mpp-field-row--accent">
            <dt>Current balance</dt>
            <dd>{formatCurrency(m.currentBalance, m.currency)}</dd>
          </div>
          <div className="mpp-field-row">
            <dt>Monthly payment</dt>
            <dd>{formatCurrency(m.monthlyPayment, m.currency)}</dd>
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
          calling the backend. The user's bearer never reached banking_api_resource_server.
        </p>
        <div className="mpp-swap-row">
          <span className="mpp-swap-label">Service API key (last 4 chars only):</span>
          <code className="mpp-swap-value">****{data.apiKeyMaskedLast4 || 'XXXX'}</code>
        </div>
        <ul className="mpp-swap-details">
          <li><strong>Source:</strong> {data.backend?.source || 'banking_api_resource_server'}</li>
          <li><strong>Auth mechanism:</strong> {data.backend?.authMechanism || 'X-API-Key (shared secret)'}</li>
          <li><strong>Note:</strong> {data.backend?.note}</li>
        </ul>
      </section>

      <section className="mpp-card mpp-card--learning">
        <h2 className="mpp-card-title">Token chain — Learning path</h2>
        <p className="mpp-learning-intro">
          Below is the full RFC 8693 token exchange flow that just completed. Each step shows
          how credentials were transformed and verified as the request passed through the system.
        </p>
        <div className="mpp-token-rail">
          <TokenChainTraceRail />
        </div>
      </section>

      <div className="mpp-actions">
        <button className="mpp-back-btn" onClick={() => navigate('/dashboard')}>Back to Dashboard</button>
      </div>
    </div>
  );
}
