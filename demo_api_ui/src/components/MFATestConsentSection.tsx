import { FC, useEffect, useState } from "react";
import apiClient from "../services/apiClient";
import TransactionConsentModal from "./TransactionConsentModal";

type Phase = "idle" | "starting" | "open" | "approved" | "declined" | "error";

const PHASE_LABEL: Record<Phase, string> = {
  idle: "Not started",
  starting: "Starting…",
  open: "Waiting for approval",
  approved: "Approved",
  declined: "Declined",
  error: "Error",
};

// Same status vocabulary as MFATestCard so the pill looks like every other test on the page.
const CARD_STATUS: Record<Phase, "pending" | "running" | "passed" | "failed"> = {
  idle: "pending",
  starting: "running",
  open: "running",
  approved: "passed",
  declined: "failed",
  error: "failed",
};
const CARD_STATUS_LABEL = { pending: "Pending", running: "Testing", passed: "Passed", failed: "Failed" };

const errMessage = (err: any, fallback: string) =>
  err?.response?.data?.message || err?.response?.data?.error || err?.message || fallback;

/**
 * HITL transaction consent (passkey or code), exactly as the banking dashboard runs it:
 * create a consent challenge, approve in TransactionConsentModal, then re-fire the transfer.
 */
const MFATestConsentSection: FC = () => {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [user, setUser] = useState<any>(null);
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [amount, setAmount] = useState("25");
  const [phase, setPhase] = useState<Phase>("idle");
  const [detail, setDetail] = useState("");
  const [challenge, setChallenge] = useState<{ id: string; snapshot: any; payload: any } | null>(null);

  useEffect(() => {
    apiClient
      .get("/api/auth/oauth/user/status")
      .then(({ data }) => setUser(data?.user || null))
      .catch(() => setUser(null));
    apiClient
      .get("/api/accounts/my")
      .then(({ data }) => {
        const list = data?.accounts || [];
        setAccounts(list);
        setFromId(list[0]?.id || "");
        setToId(list[1]?.id || "");
      })
      .catch((err) => setDetail(errMessage(err, "Could not load accounts")));
  }, []);

  const start = async () => {
    const payload = { type: "transfer", amount: Number(amount), fromAccountId: fromId, toAccountId: toId };
    setPhase("starting");
    setDetail("");
    try {
      const { data } = await apiClient.post("/api/transactions/consent-challenge", payload);
      if (!data?.challengeId) throw new Error("No challenge id from server.");
      setChallenge({ id: data.challengeId, snapshot: data.snapshot || null, payload });
      setPhase("open");
    } catch (err: any) {
      setPhase("error");
      setDetail(errMessage(err, "Could not start consent flow."));
    }
  };

  const busy = phase === "starting" || phase === "open";
  const status = CARD_STATUS[phase];
  const label = (a: any) => `${a.accountType || "Account"} - ${a.accountNumber || a.id}`;

  return (
    <div className={`mfa-test-card mfa-test-card--${status}`} data-testid="mfa-consent">
      <div className="mfa-test-card__api-preview">
        <div className="mfa-test-card__api-header">
          <span className="mfa-test-card__method mfa-test-card__method--post">POST</span>
          <code className="mfa-test-card__endpoint">/api/transactions/consent-challenge</code>
          <a
            href="https://developer.pingidentity.com/pingone-api/mfa/"
            target="_blank"
            rel="noopener noreferrer"
            className="mfa-test-card__docs-link"
            title="PingOne MFA"
          >
            Docs
          </a>
        </div>
      </div>

      <p className="info-text">This moves demo money between your demo accounts, like the dashboard does.</p>

      <div style={{ marginBottom: "0.75rem" }}>
        <div className="config-label">From account</div>
        <select className="otp-input" style={{ width: "100%", fontSize: "1rem" }} value={fromId}
          onChange={(e) => setFromId(e.target.value)} data-testid="mfa-consent-from">
          {accounts.map((a) => <option key={a.id} value={a.id}>{label(a)}</option>)}
        </select>
      </div>
      <div style={{ marginBottom: "0.75rem" }}>
        <div className="config-label">To account</div>
        <select className="otp-input" style={{ width: "100%", fontSize: "1rem" }} value={toId}
          onChange={(e) => setToId(e.target.value)} data-testid="mfa-consent-to">
          {accounts.map((a) => <option key={a.id} value={a.id}>{label(a)}</option>)}
        </select>
      </div>
      <div style={{ marginBottom: "0.75rem" }}>
        <div className="config-label">Amount</div>
        <input type="number" min="0.01" step="0.01" className="otp-input" style={{ width: "100%", fontSize: "1rem" }}
          value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="mfa-consent-amount" />
      </div>

      <div className="mfa-test-card__actions">
        <button
          type="button"
          className="mfa-test-button mfa-test-button--primary"
          onClick={start}
          disabled={busy || !fromId || !toId || fromId === toId}
          data-testid="mfa-consent-start"
        >
          {busy ? "Waiting…" : "Request transfer approval"}
        </button>
        <span className={`mfa-test-card__status mfa-test-card__status--${status}`} data-testid="mfa-consent-status">
          {CARD_STATUS_LABEL[status]}: {PHASE_LABEL[phase]}
        </span>
      </div>

      {(detail || challenge) && (
        <div className={`mfa-test-card__results mfa-test-card__results--${status}`}>
          {status === "passed" && <div className="mfa-test-card__success-badge">Success</div>}
          {status === "failed" && detail && (
            <div className="mfa-test-card__error-message">
              <strong>Error:</strong> {detail}
            </div>
          )}
          {status === "passed" && detail && <div className="mfa-test-card__success-message">{detail}</div>}
          {challenge && (
            <div className="test-card-raw-json" style={{ fontSize: "0.85rem" }} data-testid="mfa-consent-challenge">
              challengeId: {challenge.id.slice(0, 8)}…
            </div>
          )}
        </div>
      )}

      {phase === "open" && challenge && (
        <TransactionConsentModal
          open
          challengeId={challenge.id}
          preloadedSnapshot={challenge.snapshot}
          user={user}
          onClose={() => setPhase("idle")}
          onTransactionSuccess={async (msg) => {
            // Same as the dashboard: approval only confirms the challenge; re-fire the transfer with it.
            try {
              await apiClient.post("/api/transactions", { ...challenge.payload, consentChallengeId: challenge.id });
              setPhase("approved");
              setDetail(msg);
            } catch (err: any) {
              setPhase("error");
              setDetail(errMessage(err, "Transaction failed after consent."));
            }
          }}
          onDeclinedConfirmed={() => {
            setPhase("declined");
            setDetail("Declined");
          }}
        />
      )}
    </div>
  );
};

export default MFATestConsentSection;
