import React, {
  FC,
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import bffAxios from "../services/bffAxios";
import { notifyError, notifyWarning, notifySuccess } from "../utils/appToast";
import { setAgentBlockedByConsentDecline } from "../services/agentAccessConsent";
import { useEducationUI } from "../context/EducationUIContext";
import { EDU } from "./education/educationIds";
import { useIndustryBranding } from "../context/IndustryBrandingContext";
import { useDraggablePanel } from "../hooks/useDraggablePanel";
import DeviceSelector, { type Device, type EnrollableType } from "./DeviceSelector";
import {
  registerPasskey,
  normalizePublicKeyRequestOptions,
  formatPublicKeyCredentialAssertion,
} from "../utils/passkeyCeremony";
import {
  normalizePhoneE164,
  describePasskeyRegistrationError,
} from "../utils/mfaEnrollment";
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

/**
 * Renders `children` into the pop-out window's root element via a portal, so
 * the SAME React state/handlers keep driving the UI once it's in a separate
 * browser window. Mirrors DraggableModal.jsx's PopOutPortal.
 */
function PopOutPortal({
  win,
  children,
}: {
  win: Window;
  children: React.ReactNode;
}) {
  const [container] = useState(() => win.document.getElementById("drp-popout-root"));
  if (!container) return null;
  return createPortal(children, container);
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

  // Enrolling a method that's missing from the picker (SMS / email / passkey).
  // registeringType only covers passkey (a single async ceremony, no sub-step
  // UI); SMS/email need their own contact-entry + activation-code sub-steps,
  // tracked by enrollStep.
  const [registeringType, setRegisteringType] = useState<EnrollableType | null>(null);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [enrollStep, setEnrollStep] = useState<
    null | "sms-phone" | "sms-otp" | "email-address" | "email-otp"
  >(null);
  const [enrollContact, setEnrollContact] = useState("");
  const [enrollCode, setEnrollCode] = useState("");
  const [enrollDeviceId, setEnrollDeviceId] = useState<string | null>(null);
  const [enrollBusy, setEnrollBusy] = useState(false);
  // True while a WebAuthn ceremony (register or authenticate) is in progress —
  // hides the device list so the modal doesn't look frozen during the
  // browser's native passkey prompt.
  const [assertionPending, setAssertionPending] = useState(false);
  // Pop-out: content renders in a separate browser window via createPortal,
  // mirroring DraggableModal.jsx's handlePopOut/PopOutPortal pattern.
  const [popoutWin, setPopoutWin] = useState<Window | null>(null);

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
      setRegisteringType(null);
      setRegisterError(null);
      setEnrollStep(null);
      setEnrollContact("");
      setEnrollCode("");
      setEnrollDeviceId(null);
      setEnrollBusy(false);
      setAssertionPending(false);
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

  const modalTitle = otpStep
    ? "Enter verification code"
    : mfaStep
      ? "Select verification method"
      : contactStep
        ? "Where should we send the code?"
        : "Approve high-value transaction";

  const isPoppedOut = Boolean(popoutWin && !popoutWin.closed);

  const handlePopOut = useCallback(() => {
    if (popoutWin && !popoutWin.closed) {
      popoutWin.focus();
      return;
    }
    const w = size.w + 40;
    const h = size.h + 60;
    const left = window.screenX + pos.x;
    const top = window.screenY + pos.y;
    const win = window.open(
      "",
      `tx-consent-${Date.now()}`,
      `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`,
    );
    if (!win) return;

    const styleLinks = Array.from(
      document.querySelectorAll('link[rel="stylesheet"]'),
    )
      .map((el) => `<link rel="stylesheet" href="${(el as HTMLLinkElement).href}">`)
      .join("\n");
    const inlineStyles = Array.from(document.querySelectorAll("style"))
      .map((el) => `<style>${el.textContent}</style>`)
      .join("\n");

    win.document.write(`<!DOCTYPE html><html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${modalTitle}</title>
${styleLinks}
${inlineStyles}
<style>
html,body{margin:0;padding:0;height:100%;background:#fff}
#drp-popout-root{display:flex;flex-direction:column;height:100%;overflow:hidden}
</style>
</head><body><div id="drp-popout-root"></div></body></html>`);
    win.document.close();
    win.addEventListener("beforeunload", () => setPopoutWin(null));
    setPopoutWin(win);
  }, [popoutWin, size, pos, modalTitle]);

  // Close the pop-out window if this component unmounts while it's open.
  useEffect(
    () => () => {
      if (popoutWin && !popoutWin.closed) popoutWin.close();
    },
    [popoutWin],
  );

  // Close any pop-out window if the modal itself is dismissed from outside
  // (parent flips `open` to false) — otherwise it's left orphaned since the
  // early `if (!open...) return null` below stops rendering the portal.
  useEffect(() => {
    if (!open && popoutWin && !popoutWin.closed) popoutWin.close();
  }, [open, popoutWin]);

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
      } else if (data.consentOnly) {
        // Consent-only tier (amount below the step-up threshold): Authorize asked
        // for human approval, NOT identity re-proof. The server already promoted
        // the challenge to 'confirmed', so there is no OTP/MFA step — proceed
        // straight to the transaction, same terminal action as a verified OTP.
        setAgentBlockedByConsentDecline(false);
        notifySuccess("Consent approved. Proceeding with transaction...");
        onTransactionSuccess("Consent approved. Proceeding with transaction...");
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
      if (data.status === "ASSERTION_REQUIRED" && data.publicKeyCredentialRequestOptions) {
        // Passkey: PingOne wants a WebAuthn assertion, not a typed code. Keep
        // mfaStep true (picker stays the "back" target on failure) but hide it
        // behind assertionPending while the browser prompt is up.
        await runFidoAssertion(data.publicKeyCredentialRequestOptions);
        return;
      }
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

  /**
   * Refresh the challenge's device list from PingOne. confirmChallenge()
   * captures it once and moves the challenge past 'pending', so it cannot be
   * re-run — a device enrolled while the picker is open (typically a first
   * passkey) would otherwise never appear without cancelling and restarting
   * the transfer.
   */
  const refreshMfaDevices = async (): Promise<Device[]> => {
    const { data } = await bffAxios.post(
      `/api/transactions/consent-challenge/${encodeURIComponent(challengeId as string)}/mfa-reinit`,
    );
    const fresh: Device[] = data.devices || [];
    setMfaDevices(fresh);
    return fresh;
  };

  /** User chose "Set up <method>" for a type they have no device for. */
  const handleRegisterDevice = async (type: EnrollableType) => {
    setRegisterError(null);
    if (type === "FIDO2") {
      setRegisteringType("FIDO2");
      try {
        await registerPasskey();
        const fresh = await refreshMfaDevices();
        const fido = fresh.find((d) => d.type?.toUpperCase() === "FIDO2");
        if (!fido) {
          throw new Error("Passkey registered but was not returned by PingOne.");
        }
        // Register-then-authenticate, same as the agent step-up modal: the new
        // credential still has to satisfy THIS transaction's challenge.
        await handleSelectDevice(fido.id);
      } catch (err: any) {
        setRegisterError(describePasskeyRegistrationError(err));
      } finally {
        setRegisteringType(null);
      }
      return;
    }
    // SMS / EMAIL collect a contact value first; the network call happens once
    // the user submits it (handleEnrollContactSubmit).
    setEnrollContact("");
    setEnrollCode("");
    setEnrollDeviceId(null);
    setEnrollStep(type === "SMS" ? "sms-phone" : "email-address");
  };

  const handleEnrollContactSubmit = async () => {
    const val = enrollContact.trim();
    if (!val) {
      setRegisterError(
        enrollStep === "sms-phone"
          ? "Enter a phone number in E.164 format, e.g. +15551234567"
          : "Enter an email address.",
      );
      return;
    }
    setRegisterError(null);
    setEnrollBusy(true);
    try {
      if (enrollStep === "sms-phone") {
        const phone = normalizePhoneE164(val);
        const { data } = await bffAxios.post("/api/auth/mfa/enroll/sms-init", { phone });
        const status = String(data.status || "").toUpperCase();
        // Worker-token enroll can return ACTIVE immediately — skip the code step.
        if (status === "ACTIVE" || status === "ENABLED") {
          const fresh = await refreshMfaDevices();
          const sms = fresh.find((d) => d.type?.toUpperCase() === "SMS");
          setEnrollStep(null);
          if (sms) await handleSelectDevice(sms.id);
          return;
        }
        if (!data.deviceId) throw new Error("SMS enroll did not return a deviceId");
        setEnrollDeviceId(data.deviceId);
        setEnrollStep("sms-otp");
      } else {
        const { data } = await bffAxios.post("/api/auth/mfa/enroll/email", { email: val });
        if (!data.deviceId) throw new Error("Email enroll did not return a deviceId");
        setEnrollDeviceId(data.deviceId);
        setEnrollStep("email-otp");
      }
    } catch (e: any) {
      const d = e.response?.data;
      setRegisterError(
        d?.message || d?.error || e.message || "Could not start enrollment.",
      );
    } finally {
      setEnrollBusy(false);
    }
  };

  const handleEnrollCodeSubmit = async () => {
    if (!/^\d{6}$/.test(enrollCode) || !enrollDeviceId) {
      setRegisterError("Enter the 6-digit code you received.");
      return;
    }
    setRegisterError(null);
    setEnrollBusy(true);
    try {
      const path = enrollStep === "sms-otp" ? "sms-complete" : "email/verify";
      await bffAxios.post(`/api/auth/mfa/enroll/${path}`, {
        deviceId: enrollDeviceId,
        otp: enrollCode,
      });
      const wanted = enrollStep === "sms-otp" ? "SMS" : "EMAIL";
      const fresh = await refreshMfaDevices();
      const device = fresh.find((d) => d.type?.toUpperCase() === wanted);
      setEnrollStep(null);
      setEnrollDeviceId(null);
      setEnrollCode("");
      // Enrolling only proves the user controls the address — this challenge
      // still needs its own authentication code from the freshly active device.
      if (device) await handleSelectDevice(device.id);
    } catch (e: any) {
      const d = e.response?.data;
      setRegisterError(
        d?.message || d?.error || e.message || "Could not activate device.",
      );
    } finally {
      setEnrollBusy(false);
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

  /**
   * Verify identity for this challenge, either with a typed code (SMS / email /
   * onetime path) or a WebAuthn assertion (passkey). One endpoint, one set of
   * error branches (428 step-up, otp_locked, otp_expired) shared by both —
   * factored out of the original OTP-only handleVerifyOtp so a passkey doesn't
   * need its own copy of that error handling to drift from.
   */
  const submitMfaVerification = async (
    credential: { otp: string } | { fido2Assertion: object },
  ) => {
    if (otpVerifying || !challengeId || !user?.id || !snapshot) return;
    setOtpError("");
    setOtpVerifying(true);
    try {
      const verifyBody =
        "fido2Assertion" in credential
          ? { deviceId: selectedDeviceId, fido2Assertion: credential.fido2Assertion }
          : selectedDeviceId
            ? { deviceId: selectedDeviceId, otp: credential.otp }
            : { otpCode: credential.otp };
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
      // otp_incorrect only applies to typed codes — a rejected assertion (or any
      // other error) surfaces as a toast instead of re-focusing a hidden input.
      const inline = "otp" in credential && d?.error === "otp_incorrect";
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
        if ("fido2Assertion" in credential) {
          // Land back on the picker rather than a dead-end error screen.
          setMfaStep(true);
        }
      }
    } finally {
      setOtpVerifying(false);
    }
  };

  const handleVerifyOtp = () => {
    if (!otpCode) return;
    submitMfaVerification({ otp: otpCode });
  };

  /**
   * Run the WebAuthn assertion ceremony for a PingOne FIDO2 device-selection
   * challenge, then submit the result the same way a typed code is submitted.
   */
  const runFidoAssertion = async (rawOptions: unknown) => {
    setSubmitting(false);
    setAssertionPending(true);
    try {
      const publicKey = normalizePublicKeyRequestOptions(rawOptions);
      const credential = (await navigator.credentials.get({
        publicKey,
      })) as PublicKeyCredential | null;
      if (!credential) throw new Error("No passkey assertion was returned");
      const assertion = formatPublicKeyCredentialAssertion(credential);
      await submitMfaVerification({ fido2Assertion: assertion });
    } catch (err: any) {
      // This is the get() ceremony (authenticate with an existing passkey), not
      // registration — describePasskeyRegistrationError's rp.id diagnosis is
      // about create() and would be misleading here (e.g. a cancelled prompt).
      const detail =
        err?.name && err.name !== "Error"
          ? `${err.name}: ${err.message || ""}`.trim()
          : err?.message || String(err);
      notifyError(`Passkey verification failed — ${detail}`);
      setMfaStep(true);
    } finally {
      setAssertionPending(false);
    }
  };

  if (!open || !challengeId) return null;

  const stepContent = assertionPending ? (
          <div className="tx-otp-panel">
            <p className="tx-otp-panel__lead">
              Waiting for your passkey — follow the prompt from your browser or
              device.
            </p>
          </div>
        ) : enrollStep === "sms-phone" || enrollStep === "email-address" ? (
          <div className="tx-otp-panel">
            <p className="tx-otp-panel__lead">
              {enrollStep === "sms-phone"
                ? "Enter the phone number where you'd like to receive verification codes."
                : "Enter the email address where you'd like to receive verification codes."}
            </p>
            <div className="tx-otp-panel__input-row">
              <input
                className={`tx-otp-panel__input${registerError ? " tx-otp-panel__input--error" : ""}`}
                type="text"
                inputMode={enrollStep === "sms-phone" ? "tel" : "email"}
                autoComplete={enrollStep === "sms-phone" ? "tel" : "email"}
                placeholder={enrollStep === "sms-phone" ? "+15551234567" : "your@email.com"}
                value={enrollContact}
                onChange={(e) => {
                  setRegisterError(null);
                  setEnrollContact(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && enrollContact.trim()) handleEnrollContactSubmit();
                }}
                disabled={enrollBusy}
                aria-label={enrollStep === "sms-phone" ? "Phone number" : "Email address"}
              />
              <button
                type="button"
                className="transaction-consent-btn transaction-consent-btn--primary tx-otp-panel__verify-btn"
                onClick={handleEnrollContactSubmit}
                disabled={!enrollContact.trim() || enrollBusy}
              >
                {enrollBusy ? "Sending…" : "Send code"}
              </button>
            </div>
            {registerError && (
              <p className="tx-otp-panel__error" role="alert">
                {registerError}
              </p>
            )}
            <button
              type="button"
              className="tx-otp-panel__back-btn"
              onClick={() => {
                setEnrollStep(null);
                setRegisterError(null);
                setMfaStep(true);
              }}
              disabled={enrollBusy}
            >
              ← Back
            </button>
          </div>
        ) : enrollStep === "sms-otp" || enrollStep === "email-otp" ? (
          <div className="tx-otp-panel">
            <p className="tx-otp-panel__lead">
              Enter the 6-digit code sent to {enrollContact}.
            </p>
            <div className="tx-otp-panel__input-row">
              <input
                className={`tx-otp-panel__input${registerError ? " tx-otp-panel__input--error" : ""}`}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                value={enrollCode}
                onChange={(e) => {
                  setRegisterError(null);
                  setEnrollCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && enrollCode.length === 6) handleEnrollCodeSubmit();
                }}
                disabled={enrollBusy}
                aria-label="6-digit activation code"
              />
              <button
                type="button"
                className="transaction-consent-btn transaction-consent-btn--primary tx-otp-panel__verify-btn"
                onClick={handleEnrollCodeSubmit}
                disabled={enrollCode.length !== 6 || enrollBusy}
              >
                {enrollBusy ? "Verifying…" : "Activate"}
              </button>
            </div>
            {registerError && (
              <p className="tx-otp-panel__error" role="alert">
                {registerError}
              </p>
            )}
            <button
              type="button"
              className="tx-otp-panel__back-btn"
              onClick={() => {
                setEnrollStep(null);
                setEnrollDeviceId(null);
                setRegisterError(null);
                setMfaStep(true);
              }}
              disabled={enrollBusy}
            >
              Cancel
            </button>
          </div>
        ) : mfaStep && !otpStep ? (
          <DeviceSelector
            devices={mfaDevices}
            selectedDeviceId={selectedDeviceId}
            onSelectDevice={handleSelectDevice}
            onRegisterDevice={handleRegisterDevice}
            registeringType={registeringType}
            registerError={registerError}
            onBack={() => {
              setMfaStep(false);
              setSelectedDeviceId(null);
              setMfaDevices([]);
              setRegisterError(null);
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
        );

  const denialOverlay = denialOpen ? (
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
      ) : null;

  if (isPoppedOut && popoutWin) {
    return createPortal(
      <>
        <PopOutPortal win={popoutWin}>
          <div className="drp-popout-layout">
            <div
              className="drp-header drp-header--static"
              style={{
                padding: "1rem",
                borderBottom: "1px solid #e2e8f0",
                background: "linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%)",
                color: "#1f2937",
              }}
            >
              <h2
                id="transaction-consent-popup-title"
                className="transaction-consent-popup__title"
                style={{ margin: 0, color: "#1f2937" }}
              >
                {modalTitle}
              </h2>
              <div className="drp-header__controls">
                <button
                  type="button"
                  className="drp-header__btn"
                  onClick={onClose}
                  title="Close"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="drp-popout-body">{stepContent}</div>
          </div>
          {denialOverlay}
        </PopOutPortal>
        <div className="drp-popout-placeholder">
          <span>🪟 {modalTitle} — open in separate window</span>
          <button
            type="button"
            className="drp-popout-placeholder__btn"
            onClick={() => popoutWin.focus()}
          >
            Focus
          </button>
          <button
            type="button"
            className="drp-popout-placeholder__btn"
            onClick={() => popoutWin.close()}
          >
            Close
          </button>
        </div>
      </>,
      document.body,
    );
  }

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
            {modalTitle}
          </h2>
          <div className="drp-header__controls">
            <button
              type="button"
              className="drp-header__btn"
              onClick={handlePopOut}
              title="Pop out to new window"
              aria-label="Pop out to new window"
            >
              🪟
            </button>
            <button
              type="button"
              className="drp-header__btn"
              onClick={onClose}
              title="Close"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
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

        {stepContent}
      </div>

      {denialOverlay}

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
