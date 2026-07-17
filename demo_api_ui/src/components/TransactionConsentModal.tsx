import React, {
  FC,
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import bffAxios from "../services/bffAxios";
import { notifyError, notifyWarning, notifySuccess } from "../utils/appToast";
import { setAgentBlockedByConsentDecline } from "../services/agentAccessConsent";
import { useEducationUI } from "../context/EducationUIContext";
import { EDU } from "./education/educationIds";
import { useIndustryBranding } from "../context/IndustryBrandingContext";
import { useDraggablePanel } from "../hooks/useDraggablePanel";
import DeviceSelector, { type Device } from "./DeviceSelector";
import "../styles/draggablePanel.css";
import "./TransactionConsentPage.css";

interface Account {
  id: string;
  accountNumber?: string;
  accountType?: string;
  name?: string;
  email?: string;
}

interface ConsentSnapshot {
  amount: string | number;
  type: "transfer" | "deposit" | "withdrawal";
  fromAccountId?: string;
  toAccountId?: string;
  description?: string;
}

interface User {
  id?: string;
  email?: string;
}

interface TransactionConsentModalProps {
  open: boolean;
  challengeId: string | null;
  user: User | null;
  onClose: () => void;
  onTransactionSuccess: (message: string) => void;
  onDeclinedConfirmed: () => void;
  preloadedSnapshot?: ConsentSnapshot | null;
  // Preview the modal with no live challenge behind it: approving must not call
  // the server, which holds no challenge to confirm. Not implied by
  // preloadedSnapshot — real dashboard/HITL flows preload a real challenge.
  simulated?: boolean;
}

function accountSummaryLine(account: Account): string {
  const num = account.accountNumber || "N/A";
  const type = account.accountType || "Account";
  const nick =
    typeof account.name === "string" && account.name.trim()
      ? account.name.trim()
      : "";
  if (nick) return `${nick} · ${type} - ${num}`;
  return `${type} - ${num}`;
}

const TransactionConsentModal: FC<TransactionConsentModalProps> = ({
  open,
  challengeId,
  user,
  onClose,
  onTransactionSuccess,
  onDeclinedConfirmed,
  preloadedSnapshot = null,
  simulated = false,
}) => {
  const { preset } = useIndustryBranding() as any;
  const { open: openEducation } = useEducationUI();
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [denialOpen, setDenialOpen] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<ConsentSnapshot | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);

  const [otpStep, setOtpStep] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpError, setOtpError] = useState("");
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [otpExpiresAt, setOtpExpiresAt] = useState<string | null>(null);
  const otpInputRef = useRef<HTMLInputElement>(null);

  const [mfaStep, setMfaStep] = useState(false);
  const [mfaDevices, setMfaDevices] = useState<Device[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  const [contactStep, setContactStep] = useState(false);
  const [contactInput, setContactInput] = useState("");
  const [contactError, setContactError] = useState("");
  const [maskedContact, setMaskedContact] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setAgreed(false);
      setDenialOpen(false);
      setLoadFailed(false);
      setSnapshot(null);
      setAccounts([]);
      setLoading(true);
      setOtpStep(false);
      setOtpCode("");
      setOtpSent(false);
      setOtpError("");
      setOtpVerifying(false);
      setOtpExpiresAt(null);
      setMfaStep(false);
      setMfaDevices([]);
      setSelectedDeviceId(null);
      setContactStep(false);
      setContactInput("");
      setContactError("");
      setMaskedContact(null);
    }
  }, [open]);

  useEffect(() => {
    if (otpStep && otpInputRef.current) {
      otpInputRef.current.focus();
    }
  }, [otpStep]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (open) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
    return undefined;
  }, [open]);

  useEffect(() => {
    if (!open || !challengeId || !user) return;
    if (preloadedSnapshot) {
      setSnapshot(preloadedSnapshot);
      bffAxios
        .get("/api/accounts/my")
        .then((r) =>
          setAccounts(Array.isArray(r.data?.accounts) ? r.data.accounts : []),
        )
        .catch(() => {})
        .finally(() => setLoading(false));
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadFailed(false);
      try {
        const [chRes, accRes] = await Promise.all([
          bffAxios.get(
            `/api/transactions/consent-challenge/${encodeURIComponent(challengeId)}`,
          ),
          bffAxios.get("/api/accounts/my"),
        ]);
        if (cancelled) return;
        setSnapshot(chRes.data.snapshot);
        setAccounts(
          Array.isArray(accRes.data?.accounts) ? accRes.data.accounts : [],
        );
      } catch (e: any) {
        if (!cancelled) {
          const msg =
            e.response?.data?.message ||
            e.response?.data?.error ||
            "Consent challenge expired or invalid.";
          notifyError(msg);
          setLoadFailed(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, user, challengeId, preloadedSnapshot]);

  const summaryLines = useMemo(() => {
    if (!snapshot) return [];
    const amt = Number(snapshot.amount);
    const lines: string[] = [];
    const t = snapshot.type;
    if (t === "transfer") {
      lines.push(`Transfer: $${amt.toFixed(2)}`);
      const fromA = accounts.find((a) => a.id === snapshot.fromAccountId);
      const toA = accounts.find((a) => a.id === snapshot.toAccountId);
      if (fromA) lines.push(`From: ${accountSummaryLine(fromA)}`);
      else if (snapshot.fromAccountId)
        lines.push(`From account: ${snapshot.fromAccountId}`);
      if (toA) lines.push(`To: ${accountSummaryLine(toA)}`);
      else if (snapshot.toAccountId)
        lines.push(`To account: ${snapshot.toAccountId}`);
    } else if (t === "deposit") {
      lines.push(`Deposit: $${amt.toFixed(2)}`);
      const toA = accounts.find((a) => a.id === snapshot.toAccountId);
      if (toA) lines.push(`To: ${accountSummaryLine(toA)}`);
      else if (snapshot.toAccountId)
        lines.push(`To account: ${snapshot.toAccountId}`);
    } else if (t === "withdrawal") {
      lines.push(`Withdrawal: $${amt.toFixed(2)}`);
      const fromA = accounts.find((a) => a.id === snapshot.fromAccountId);
      if (fromA) lines.push(`From: ${accountSummaryLine(fromA)}`);
      else if (snapshot.fromAccountId)
        lines.push(`From account: ${snapshot.fromAccountId}`);
    }
    if (snapshot.description) lines.push(`Note: ${snapshot.description}`);
    return lines;
  }, [snapshot, accounts]);

  const handleCancelClick = useCallback(() => {
    setDenialOpen(true);
  }, []);

  const handleDenialDismiss = () => {
    setDenialOpen(false);
  };

  const handleDenialConfirm = () => {
    setAgentBlockedByConsentDecline(true);
    setDenialOpen(false);
    onDeclinedConfirmed();
  };

  const handleBackdropPointer = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget && !submitting && !otpVerifying)
        handleCancelClick();
    },
    [submitting, otpVerifying, handleCancelClick],
  );

  const { pos, size, handleDragStart, createResizeHandler } = useDraggablePanel(
    () => ({
      x: Math.max(20, (window.innerWidth - 500) / 2),
      y: Math.max(20, (window.innerHeight - 600) / 2),
    }),
    { w: 500, h: 600 },
    { storageKey: "transaction-consent-modal" },
  ) as any;

  const handleConfirm = async () => {
    if (!agreed || submitting || !snapshot || !challengeId || !user?.id) return;
    if (simulated) {
      notifySuccess("Simulation complete — no real transaction was made.");
      onTransactionSuccess("Simulation complete — no real transaction was made.");
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await bffAxios.post(
        `/api/transactions/consent-challenge/${encodeURIComponent(challengeId)}/confirm`,
      );
      if (data.mfaRequired) {
        setMfaDevices(data.devices || []);
        setMfaStep(true);
      } else if (data.needsContact) {
        setContactStep(true);
      } else {
        setOtpExpiresAt(data.otpExpiresAt || null);
        setOtpSent(data.otpSent || false);
        setMaskedContact(data.maskedContact || null);
        setOtpStep(true);
      }
    } catch (e: any) {
      const d = e.response?.data;
      const status = e.response?.status;
      if (status === 401) {
        notifyError(
          "Session expired. Please sign in again to complete this transaction.",
        );
      } else {
        notifyError(
          d?.message ||
            d?.error_description ||
            d?.error ||
            e.message ||
            "Could not confirm consent.",
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSelectDevice = async (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    setSubmitting(true);
    try {
      const { data } = await bffAxios.post(
        `/api/transactions/consent-challenge/${encodeURIComponent(challengeId as string)}/select-device`,
        { deviceId },
      );
      setOtpExpiresAt(data.otpExpiresAt || null);
      setOtpSent(data.otpSent || false);
      setOtpStep(true);
      setMfaStep(false);
    } catch (e: any) {
      const d = e.response?.data;
      notifyError(
        d?.message ||
          d?.error_description ||
          d?.error ||
          e.message ||
          "Could not select device.",
      );
      setSelectedDeviceId(null);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitContact = async () => {
    const val = contactInput.trim();
    if (!val) {
      setContactError("Enter an email address or phone number.");
      return;
    }
    setContactError("");
    setSubmitting(true);
    try {
      const isPhone = /^\+?\d[\d\s\-().]{6,}$/.test(val);
      const body = isPhone ? { phone: val } : { email: val };
      const { data } = await bffAxios.post(
        `/api/transactions/consent-challenge/${encodeURIComponent(challengeId as string)}/confirm-contact`,
        body,
      );
      setOtpExpiresAt(data.otpExpiresAt || null);
      setOtpSent(data.otpSent || false);
      setMaskedContact(data.maskedContact || val);
      setContactStep(false);
      setOtpStep(true);
    } catch (e: any) {
      const d = e.response?.data;
      setContactError(
        d?.message || d?.error || e.message || "Could not send verification code.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otpCode || otpVerifying || !challengeId || !user?.id || !snapshot)
      return;
    setOtpError("");
    setOtpVerifying(true);
    try {
      const verifyBody = selectedDeviceId
        ? { deviceId: selectedDeviceId, otp: otpCode }
        : { otpCode };
      await bffAxios.post(
        `/api/transactions/consent-challenge/${encodeURIComponent(challengeId)}/verify-otp`,
        verifyBody,
      );
      setAgentBlockedByConsentDecline(false);
      notifySuccess("Consent verified. Proceeding with transaction...");
      onTransactionSuccess(
        "Consent verified. Checking if additional verification is needed...",
      );
    } catch (e: any) {
      const status = e.response?.status;
      const d = e.response?.data;
      if (status === 428) {
        notifyWarning(
          "Additional verification (step-up MFA) is required. After you complete it, start the high-value transaction again from the dashboard.",
        );
        return;
      }
      if (d?.error === "otp_locked") {
        notifyError(
          "Too many incorrect attempts. The verification has been locked — please start the transaction again.",
        );
        onClose();
        return;
      }
      if (d?.error === "otp_expired") {
        notifyError(
          "Verification code expired. Please start the transaction again.",
        );
        onClose();
        return;
      }
      const inline = d?.error === "otp_incorrect";
      if (inline) {
        setOtpError(d.message || "Incorrect code. Try again.");
        setOtpCode("");
        otpInputRef.current?.focus();
      } else {
        notifyError(
          d?.message ||
            d?.error_description ||
            d?.error ||
            e.message ||
            "Request failed.",
        );
      }
    } finally {
      setOtpVerifying(false);
    }
  };

  if (!open || !challengeId) return null;

  return (
    <div
      className="transaction-consent-popup-overlay"
      role="presentation"
      onClick={handleBackdropPointer}
    >
      <div
        className="drp-panel transaction-consent-popup"
        style={{
          position: "fixed",
          left: `${pos.x}px`,
          top: `${pos.y}px`,
          width: `${size.w}px`,
          height: "auto",
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="transaction-consent-popup-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="drp-header"
          onMouseDown={handleDragStart}
          style={{
            padding: "1rem",
            cursor: "move",
            borderBottom: "1px solid #e2e8f0",
            background: "linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%)",
            color: "#1f2937",
            borderRadius: "0.5rem 0.5rem 0 0",
          }}
        >
          <h2
            id="transaction-consent-popup-title"
            className="transaction-consent-popup__title"
            style={{ margin: 0, color: "#1f2937" }}
          >
            {otpStep
              ? "Enter verification code"
              : mfaStep
                ? "Select verification method"
                : contactStep
                  ? "Where should we send the code?"
                  : "Approve high-value transaction"}
          </h2>
        </div>

        <div className="drp-resize-handles">
          <div
            className="drp-resize-handle drp-resize-handle--nw"
            onMouseDown={createResizeHandler("nw")}
            aria-hidden
            title="Resize from top-left"
          />
          <div
            className="drp-resize-handle drp-resize-handle--ne"
            onMouseDown={createResizeHandler("ne")}
            aria-hidden
            title="Resize from top-right"
          />
          <div
            className="drp-resize-handle drp-resize-handle--sw"
            onMouseDown={createResizeHandler("sw")}
            aria-hidden
            title="Resize from bottom-left"
          />
          <div
            className="drp-resize-handle drp-resize-handle--se"
            onMouseDown={createResizeHandler("se")}
            aria-hidden
            title="Resize from bottom-right"
          />

          <div
            className="drp-resize-handle drp-resize-handle--n"
            onMouseDown={createResizeHandler("n")}
            aria-hidden
            title="Resize from top"
          />
          <div
            className="drp-resize-handle drp-resize-handle--s"
            onMouseDown={createResizeHandler("s")}
            aria-hidden
            title="Resize from bottom"
          />
          <div
            className="drp-resize-handle drp-resize-handle--e"
            onMouseDown={createResizeHandler("e")}
            aria-hidden
            title="Resize from right"
          />
          <div
            className="drp-resize-handle drp-resize-handle--w"
            onMouseDown={createResizeHandler("w")}
            aria-hidden
            title="Resize from left"
          />
        </div>

        {mfaStep && !otpStep ? (
          <DeviceSelector
            devices={mfaDevices}
            selectedDeviceId={selectedDeviceId}
            onSelectDevice={handleSelectDevice}
            onBack={() => {
              setMfaStep(false);
              setSelectedDeviceId(null);
              setMfaDevices([]);
            }}
            disabled={submitting}
          />
        ) : contactStep && !otpStep ? (
          <div className="tx-otp-panel">
            <p className="tx-otp-panel__lead">
              No email or phone was found on your account. Enter the address
              where you would like to receive your one-time verification code.
            </p>
            <div className="tx-otp-panel__input-row">
              <input
                className={`tx-otp-panel__input${contactError ? " tx-otp-panel__input--error" : ""}`}
                type="text"
                inputMode="email"
                autoComplete="email"
                placeholder="your@email.com"
                value={contactInput}
                onChange={(e) => {
                  setContactError("");
                  setContactInput(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && contactInput.trim()) handleSubmitContact();
                }}
                disabled={submitting}
                aria-label="Email address or phone number"
              />
              <button
                type="button"
                className="transaction-consent-btn transaction-consent-btn--primary tx-otp-panel__verify-btn"
                onClick={handleSubmitContact}
                disabled={!contactInput.trim() || submitting}
              >
                {submitting ? "Sending…" : "Send code"}
              </button>
            </div>
            {contactError && (
              <p className="tx-otp-panel__error" role="alert">
                {contactError}
              </p>
            )}
            <button
              type="button"
              className="tx-otp-panel__back-btn"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
          </div>
        ) : otpStep ? (
          <div className="tx-otp-panel">
            {otpSent ? (
              <p className="tx-otp-panel__lead">
                {maskedContact
                  ? `A 6-digit verification code was sent to ${maskedContact}.`
                  : "Enter your 6-digit verification code to authorise this transaction."}
              </p>
            ) : (
              <p className="tx-otp-panel__lead tx-otp-panel__lead--warn">
                Email delivery unavailable. Check server logs for the OTP code.
              </p>
            )}

            <div className="tx-otp-panel__summary">
              {summaryLines.map((line, i) => (
                <span key={i} className="tx-otp-panel__summary-line">
                  {line}
                </span>
              ))}
            </div>

            <div className="tx-otp-panel__input-row">
              <input
                ref={otpInputRef}
                className={`tx-otp-panel__input${otpError ? " tx-otp-panel__input--error" : ""}`}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123123"
                value={otpCode}
                onChange={(e) => {
                  // No maxLength: it truncates a pasted string to 6 chars BEFORE
                  // we strip non-digits, so a code copied with a label/spaces
                  // (e.g. "Code: 633603") loses digits. Filter here instead so
                  // paste works regardless of formatting.
                  setOtpError("");
                  setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                }}
                onPaste={(e) => {
                  e.preventDefault();
                  const text = (e.clipboardData?.getData("text") || "")
                    .replace(/\D/g, "")
                    .slice(0, 6);
                  if (text) {
                    setOtpError("");
                    setOtpCode(text);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && otpCode.length === 6)
                    handleVerifyOtp();
                }}
                disabled={otpVerifying}
                aria-label="6-digit verification code"
              />
              <button
                type="button"
                className="transaction-consent-btn transaction-consent-btn--primary tx-otp-panel__verify-btn"
                onClick={handleVerifyOtp}
                disabled={otpCode.length !== 6 || otpVerifying}
              >
                {otpVerifying ? "Verifying…" : "Confirm"}
              </button>
            </div>

            {otpError && (
              <p className="tx-otp-panel__error" role="alert">
                {otpError}
              </p>
            )}

            {otpExpiresAt && (
              <p className="tx-otp-panel__expiry">
                Code expires at{" "}
                {new Date(otpExpiresAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            )}

            <button
              type="button"
              className="tx-otp-panel__back-btn"
              onClick={onClose}
              disabled={otpVerifying}
            >
              Cancel
            </button>
          </div>
        ) : (
          <>
            <p className="transaction-consent-popup__lead">
              Amounts over $500 require your explicit consent. Review the
              summary, then confirm if you want the banking assistant to
              complete this transaction on your behalf.
            </p>
            <p className="transaction-consent-popup__learn">
              <button
                type="button"
                className="transaction-consent-learn-btn transaction-consent-learn-btn--dark"
                onClick={() => openEducation(EDU.HUMAN_IN_LOOP, "what")}
              >
                Learn: Human-in-the-loop
              </button>
            </p>

            {loading && (
              <p className="transaction-consent-card__loading">
                Loading consent details…
              </p>
            )}

            {!loading && loadFailed && (
              <div>
                <p className="transaction-consent-card__error" role="alert">
                  Could not load this consent challenge. It may have expired.
                </p>
                <button
                  type="button"
                  className="transaction-consent-btn transaction-consent-btn--primary"
                  onClick={onClose}
                >
                  Close
                </button>
              </div>
            )}

            {!loading && !loadFailed && snapshot && (
              <div className="transaction-consent-card transaction-consent-card--in-popup">
                <h3 className="transaction-consent-card__h2">
                  Transaction summary
                </h3>
                <ul className="transaction-consent-card__summary">
                  {summaryLines.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>

                <div className="transaction-consent-card__legal">
                  <p>
                    By continuing, you authorize {preset.shortName} to process
                    this one-time transaction for the amount and accounts shown.
                    A one-time verification code will be sent to your email.
                  </p>
                </div>

                <label className="transaction-consent-card__check">
                  <input
                    type="checkbox"
                    checked={agreed}
                    onChange={(e) => setAgreed(e.target.checked)}
                  />
                  <span>
                    I agree to allow the AI banking assistant to complete this
                    transaction on my behalf. I have reviewed the details above.
                  </span>
                </label>

                <div className="transaction-consent-card__actions">
                  <button
                    type="button"
                    className="transaction-consent-btn transaction-consent-btn--primary"
                    onClick={handleConfirm}
                    disabled={!agreed || submitting}
                  >
                    {submitting ? "Initiating…" : "Agree & continue"}
                  </button>
                  <button
                    type="button"
                    className="transaction-consent-btn transaction-consent-btn--ghost"
                    onClick={handleCancelClick}
                    disabled={submitting}
                  >
                    Cancel
                  </button>
                </div>

                <p className="transaction-consent-rfc-note">
                  This consent checkpoint implements{" "}
                  <a
                    href="https://www.rfc-editor.org/rfc/rfc9396"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    RFC 9396 (Rich Authorization Requests)
                  </a>{" "}
                  — your approval is cryptographically bound to the specific
                  transaction parameters above. Agent delegation uses{" "}
                  <a
                    href="https://www.rfc-editor.org/rfc/rfc8693"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    RFC 8693 (Token Exchange)
                  </a>
                  .
                </p>
              </div>
            )}
          </>
        )}
      </div>

      {denialOpen && (
        <div
          className="transaction-consent-modal-overlay"
          role="presentation"
          onClick={handleDenialDismiss}
        >
          <div
            className="transaction-consent-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="consent-denial-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="consent-denial-title"
              className="transaction-consent-modal__title"
            >
              Transaction not authorized
            </h2>
            <p className="transaction-consent-modal__body">
              You chose not to agree to this high-value transaction. The request
              is denied and will not be processed.
            </p>
            <p className="transaction-consent-modal__body transaction-consent-modal__body--emphasis">
              You will not be able to use the AI banking assistant for this
              session. To use the assistant again, sign out and sign in again.
            </p>
            <div className="transaction-consent-modal__actions">
              <button
                type="button"
                className="transaction-consent-btn transaction-consent-btn--ghost"
                onClick={handleDenialDismiss}
              >
                Keep reviewing
              </button>
              <button
                type="button"
                className="transaction-consent-btn transaction-consent-btn--danger"
                onClick={handleDenialConfirm}
              >
                Confirm decline
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="drp-resize-handles">
        <div
          className="drp-resize-handle drp-resize-handle--nw"
          onMouseDown={createResizeHandler("nw")}
          aria-hidden
          title="Resize from top-left"
        />
        <div
          className="drp-resize-handle drp-resize-handle--ne"
          onMouseDown={createResizeHandler("ne")}
          aria-hidden
          title="Resize from top-right"
        />
        <div
          className="drp-resize-handle drp-resize-handle--sw"
          onMouseDown={createResizeHandler("sw")}
          aria-hidden
          title="Resize from bottom-left"
        />
        <div
          className="drp-resize-handle drp-resize-handle--se"
          onMouseDown={createResizeHandler("se")}
          aria-hidden
          title="Resize from bottom-right"
        />

        <div
          className="drp-resize-handle drp-resize-handle--n"
          onMouseDown={createResizeHandler("n")}
          aria-hidden
          title="Resize from top"
        />
        <div
          className="drp-resize-handle drp-resize-handle--s"
          onMouseDown={createResizeHandler("s")}
          aria-hidden
          title="Resize from bottom"
        />
        <div
          className="drp-resize-handle drp-resize-handle--e"
          onMouseDown={createResizeHandler("e")}
          aria-hidden
          title="Resize from right"
        />
        <div
          className="drp-resize-handle drp-resize-handle--w"
          onMouseDown={createResizeHandler("w")}
          aria-hidden
          title="Resize from left"
        />
      </div>
    </div>
  );
};

export default TransactionConsentModal;
