import { useState, useCallback } from "react";
import DraggableModal from "./DraggableModal";
import IntentAuthDecisionDisplay from "./IntentAuthDecisionDisplay";
import { formatCurrency } from "../utils/formatters";
import "./AgentConsentModal.css";

/**
 * AgentConsentModal
 *
 * Three modes:
 *   1. MCP HITL agent action — when `hitlContext` prop is provided.
 *      Shows tool name + reason, consent checkbox, then calls onAccept()
 *      which triggers the OTP flow before approving the HITL challenge.
 *   2. High-risk transaction consent — when a `transaction` prop is provided.
 *      Shows the transaction details and, on "Authorize", calls onAccept() directly.
 *   3. Agent access consent (legacy) — no `transaction` or `hitlContext` prop.
 *      POSTs to /api/auth/oauth/user/consent before calling onAccept().
 *
 * Props:
 *   hitlContext  — optional { tool, reason } for MCP HITL agent action approval
 *   transaction  — optional { type, amount, fromAccountId, toAccountId, description }
 *   onAccept     — callback; called after consent is confirmed.
 *   onDismiss    — callback; user closed the modal without accepting.
 *   intentAuthDecision — optional { intent, confidence, riskScore, authorityScore, reason }
 */
export default function AgentConsentModal({
  hitlContext,
  transaction,
  onAccept,
  onDismiss,
  hitlThreshold = 500,
  intentAuthDecision,
}) {
  const [accepting, setAccepting] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState(null);

  const handleAccept = useCallback(async () => {
    setAccepting(true);
    setError(null);
    if (hitlContext || transaction) {
      // MCP HITL and transaction modes — caller (BankingAgent) drives the next step.
      // Wrap in try/catch so a throw from onAccept resets the button instead of
      // leaving both buttons permanently disabled.
      try {
        await onAccept?.();
      } catch (err) {
        setError(err.message || "Failed to process request. Please try again.");
        setAccepting(false);
      }
      return;
    }
    try {
      const res = await fetch("/api/auth/oauth/user/consent", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `Server error ${res.status}`);
      }
      const data = await res.json();
      onAccept?.(data);
    } catch (err) {
      setError(err.message || "Failed to record consent. Please try again.");
      setAccepting(false);
    }
  }, [onAccept, hitlContext, transaction]);

  const prettyLabel = (s) =>
    String(s || "")
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
  const fmtAmount = (n) => formatCurrency(Number(n || 0), "USD");

  // `transaction` may be a real money transaction OR a generic agent-action
  // descriptor (vertical intent payload, e.g. Checkout) with amount 0 and no
  // accounts. Adapt the UI so we never show a meaningless "$0.00".
  const txAmount = Number(transaction?.amount || 0);
  const isMonetary = txAmount > 0;
  const actionHeadline = transaction
    ? prettyLabel(transaction.description || transaction.type) || "Agent Action"
    : null;
  const showFrom =
    !!transaction?.fromAccountId &&
    (transaction.type === "transfer" || transaction.type === "withdrawal");
  const showTo =
    !!transaction?.toAccountId &&
    (transaction.type === "transfer" || transaction.type === "deposit");
  const showDetails =
    !!transaction?.description &&
    prettyLabel(transaction.description) !== actionHeadline;
  const hasTxRows = isMonetary || showFrom || showTo || showDetails;

  const title = hitlContext
    ? "Authorize Agent Action"
    : transaction
      ? `Authorize ${actionHeadline}`
      : "Allow AI Agent Access";

  const requiresCheckbox = !!(hitlContext || transaction);

  const footer = (
    <>
      <button
        type="button"
        className="acm-btn acm-btn--primary"
        onClick={handleAccept}
        disabled={accepting || (requiresCheckbox && !agreed)}
      >
        {accepting ? "Processing…" : requiresCheckbox ? "Agree & Continue" : "Allow"}
      </button>
      <button
        type="button"
        className="acm-btn acm-btn--secondary"
        onClick={onDismiss}
        disabled={accepting}
      >
        Cancel
      </button>
    </>
  );

  return (
    <DraggableModal
      isOpen
      onClose={onDismiss}
      title={title}
      footer={footer}
      defaultWidth={460}
      defaultHeight={470}
      storageKey="agent-consent-modal-v2"
      zIndex={100070}
      backdropClose={false}
    >
      {/* HITL persistent badge */}
      <div className="acm-hitl-badge" aria-live="polite">
        <span className="acm-hitl-badge__label">
          Human-in-the-Loop — <strong>manual approval required</strong>
        </span>
      </div>

      <div className="acm-body-wrap">
        {hitlContext ? (
          <>
            <p className="acm-lead">
              The agent needs your approval to run this tool. It cannot proceed
              without you.
            </p>

            <section className="acm-card">
              <div className="acm-card__head">
                <span className="acm-card__kicker">Requested action</span>
                <span className="acm-card__title">
                  {prettyLabel(hitlContext.tool) || "Agent tool call"}
                </span>
              </div>
              {hitlContext.reason && (
                <dl className="acm-kv">
                  <div className="acm-kv__row">
                    <dt>Reason</dt>
                    <dd>{hitlContext.reason}</dd>
                  </div>
                </dl>
              )}
            </section>

            <ul className="acm-assurances">
              <li>Verified with a one-time code sent to your registered contact</li>
              <li>Recorded in the audit trail</li>
              <li>Cannot proceed without your explicit approval</li>
            </ul>

            <label className="acm-agree-label">
              <input
                type="checkbox"
                className="acm-agree-cb"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
              />
              <span>I have reviewed this request and authorize the agent to proceed.</span>
            </label>
          </>
        ) : transaction ? (
          <>
            <p className="acm-lead">
              The agent needs your approval to continue. Review the request below
              — it cannot proceed without you.
            </p>

            {intentAuthDecision && (
              <IntentAuthDecisionDisplay decision={intentAuthDecision} compact />
            )}

            <section className="acm-card">
              <div className="acm-card__head">
                <span className="acm-card__kicker">Requested action</span>
                <span className="acm-card__title">{actionHeadline}</span>
              </div>
              {hasTxRows && (
                <dl className="acm-kv">
                  {isMonetary && (
                    <div className="acm-kv__row">
                      <dt>Amount</dt>
                      <dd className="acm-kv__amount">{fmtAmount(txAmount)}</dd>
                    </div>
                  )}
                  {showFrom && (
                    <div className="acm-kv__row">
                      <dt>From</dt>
                      <dd>{transaction.fromAccountId}</dd>
                    </div>
                  )}
                  {showTo && (
                    <div className="acm-kv__row">
                      <dt>To</dt>
                      <dd>{transaction.toAccountId}</dd>
                    </div>
                  )}
                  {showDetails && (
                    <div className="acm-kv__row">
                      <dt>Details</dt>
                      <dd>{transaction.description}</dd>
                    </div>
                  )}
                </dl>
              )}
            </section>

            {isMonetary && txAmount >= hitlThreshold && (
              <div className="acm-high-value-warning">
                ⚠️ This exceeds {fmtAmount(hitlThreshold)} — please double-check
                before authorizing.
              </div>
            )}

            <ul className="acm-assurances">
              <li>Verified with a one-time code sent to your registered email</li>
              <li>Recorded in the audit trail</li>
              <li>Cannot proceed without your explicit approval</li>
            </ul>

            <label className="acm-agree-label">
              <input
                type="checkbox"
                className="acm-agree-cb"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
              />
              <span>I have reviewed the details above and authorize this action.</span>
            </label>
          </>
        ) : (
          <>
            <p className="acm-body">
              The <strong>AI Banking Assistant</strong> is requesting permission
              to act on your behalf — checking balances, viewing transactions,
              and initiating transfers.
            </p>
            <ul className="acm-list">
              <li>The agent can only act within this session</li>
              <li>
                All actions are logged and visible in the Token Chain display
              </li>
              <li>You can revoke access at any time by logging out</li>
              <li>
                The agent cannot change your credentials or contact details
              </li>
            </ul>
          </>
        )}

        {error && (
          <p className="acm-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </DraggableModal>
  );
}
