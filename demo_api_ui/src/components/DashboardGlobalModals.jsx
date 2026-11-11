import React from "react";
import { COUNTRY_CODES } from "../utils/countryCodes";
import ConfirmModal from "./ConfirmModal";
import DraggableModal from "./DraggableModal";
import Fido2Challenge from "./Fido2Challenge";
import FloatingPanel from "./FloatingPanel";
import OAuthTokenDisplayPage from "./OAuthTokenDisplayPage";
import PingIdentitySpinner from "./shared/PingIdentitySpinner";
import ReelDock from "./ReelDock";
import TransactionConsentModal from "./TransactionConsentModal";
import apiClient from "../services/apiClient";
import { extractRfc9470Challenge } from "../utils/wwwAuthenticate";
import { notifyError, notifyInfo, notifySuccess } from "../utils/appToast";

/**
 * The dashboard's global overlays (reset, HITL consent, enrolment, OTP / TOTP / push / FIDO2 step-up, token and
 * movie-reel pop-outs). Moved out of UserDashboardPing2026.js unchanged; each is its own view state, so a primary
 * button inside one is that state's one primary. Every value it reads is passed in as a prop.
 */
export default function DashboardGlobalModals({
  agentHitlAutoConfirm,
  agentHitlDetailRef,
  agentTriggeredStepUp,
  beginStepUp,
  closeEnrollModal,
  consentChallengeId,
  devicePickerDevices,
  devicePickerOpen,
  enrollError,
  enrollModalOpen,
  enrolling,
  fetchUserData,
  fido2DaId,
  fido2DeviceId,
  fido2ModalOpen,
  handleDevicePick,
  handleEnrollEmail,
  handleEnrollFido2,
  handleEnrollSmsComplete,
  handleEnrollSmsInit,
  handleInitiateOtp,
  handleInitiateOtpRef,
  handleTotpSubmit,
  handleVerifyOtp,
  mfaChallengeExpired,
  movieReelSurface,
  onLogout,
  otpCode,
  otpEmail,
  otpError,
  otpModalOpen,
  otpSubmitting,
  pushModalOpen,
  setAgentHitlAutoConfirm,
  setAgentTriggeredStepUp,
  setConsentChallengeId,
  setDepositAccount,
  setDepositForm,
  setDevicePickerOpen,
  setEnrollError,
  setEnrollModalOpen,
  setFido2ModalOpen,
  setMfaChallengeExpired,
  setMovieReelSurface,
  setOtpCode,
  setOtpError,
  setOtpModalOpen,
  setPushModalOpen,
  setPushPolling,
  setSelectedAccount,
  setShowResetModal,
  setShowTokenModal,
  setSmsCountryCode,
  setSmsEnrollOtp,
  setSmsEnrollPhone,
  setSmsEnrollStep,
  setStepUpRequired,
  setTotpCode,
  setTotpError,
  setTotpModalOpen,
  setTransferForm,
  setWithdrawAccount,
  setWithdrawForm,
  showFilmstripPopout,
  showResetModal,
  showTokenModal,
  smsCountryCode,
  smsEnrollOtp,
  smsEnrollPhone,
  smsEnrollStep,
  totpCode,
  totpError,
  totpModalOpen,
  totpSubmitting,
  user,
}) {
  return (
    <>
      {consentChallengeId?.id && (
        <TransactionConsentModal
          open
          challengeId={consentChallengeId.id}
          preloadedSnapshot={consentChallengeId.snapshot}
          user={user}
          autoConfirm={agentHitlAutoConfirm}
          onClose={() => {
            setConsentChallengeId(null);
            setAgentHitlAutoConfirm(false);
            agentHitlDetailRef.current = null;
          }}
          onTransactionSuccess={async (msg) => {
            const agentDetail = agentHitlDetailRef.current;
            const challenge = consentChallengeId;
            setConsentChallengeId(null);
            setAgentHitlAutoConfirm(false);
            agentHitlDetailRef.current = null;

            if (agentDetail) {
              // Agent-triggered: agent handles re-fire via banking-agent-hitl-confirmed event
              notifySuccess(msg);
              void fetchUserData(true);
              window.dispatchEvent(
                new CustomEvent("banking-agent-hitl-confirmed", {
                  detail: { actionId: agentDetail.actionId, successMsg: msg },
                }),
              );
            } else if (challenge?.payload) {
              // Dashboard-triggered: re-fire the transaction with the approved challenge
              try {
                await apiClient.post("/api/transactions", {
                  ...challenge.payload,
                  consentChallengeId: challenge.id,
                });
                if (challenge.payload.type === "transfer") {
                  setTransferForm({
                    toAccountId: "",
                    amount: "",
                    description: "",
                  });
                  setSelectedAccount(null);
                } else if (challenge.payload.type === "deposit") {
                  setDepositForm({ amount: "", description: "" });
                  setDepositAccount(null);
                } else if (challenge.payload.type === "withdrawal") {
                  setWithdrawForm({ amount: "", description: "" });
                  setWithdrawAccount(null);
                }
                notifySuccess("Transaction completed successfully!");
                void fetchUserData(true);
                window.dispatchEvent(
                  new CustomEvent("banking-transaction-completed", {
                    detail: { type: challenge.payload.type },
                  }),
                );
              } catch (err) {
                const rfc9470StepUp = extractRfc9470Challenge(err.response);
                if (err.response?.status === 428) {
                  beginStepUp(err.response.data);
                } else if (rfc9470StepUp) {
                  beginStepUp(rfc9470StepUp);
                } else {
                  notifyError(
                    err.response?.data?.error_description ||
                      err.response?.data?.error ||
                      "Transaction failed after consent.",
                  );
                }
              }
            } else {
              notifySuccess(msg);
              void fetchUserData(true);
            }
          }}
          onDeclinedConfirmed={() => {
            setConsentChallengeId(null);
            setAgentHitlAutoConfirm(false);
            notifyInfo(
              "You declined high-value consent. The AI banking assistant is paused — dismiss the decline notice to keep using it.",
            );
          }}
        />
      )}

      <ConfirmModal
        isOpen={showResetModal}
        title="Reset Demo"
        message="Clear all agent history, token chain events, and MCP audit logs? You will be signed out and the theme will reset to default."
        confirmLabel="Reset"
        danger
        onConfirm={async () => {
          setShowResetModal(false);
          try {
            await fetch("/api/admin/reset-demo", {
              method: "POST",
              credentials: "include",
            });
          } catch (_) {}
          // Clear traffic-store cache (onLogout does not know about this key)
          try { localStorage.removeItem("api-traffic-store"); } catch (_) {}
          // Use the App-level logout so userLoggedOut flag is set and the
          // session-check effect fast-paths past the auth endpoints on reload.
          onLogout();
        }}
        onCancel={() => setShowResetModal(false)}
      />

      {/* Email OTP Step-Up Modal */}
      {otpModalOpen && (
        <div
          className="otp-step-up-overlay"
          onClick={() => {
            setOtpModalOpen(false);
            setOtpCode("");
            setOtpError("");
            window.dispatchEvent(new CustomEvent("cibaStepUpCancelled"));
          }}
        >
          <div
            className="otp-step-up-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="otp-step-up-modal__header">
              <h3 className="otp-step-up-modal__title">Verify Your Identity</h3>
              <button
                className="otp-step-up-modal__close"
                onClick={() => {
                  setOtpModalOpen(false);
                  setOtpCode("");
                  setOtpError("");
                  window.dispatchEvent(new CustomEvent("cibaStepUpCancelled"));
                }}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="otp-step-up-modal__body">
              <p className="otp-step-up-modal__lead">
                A 6-digit verification code was sent to{" "}
                <strong>{otpEmail}</strong>. Enter it below to authorise your
                transaction.
              </p>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={otpCode}
                onChange={(e) => {
                  setOtpCode(e.target.value.replace(/\D/g, ""));
                  setOtpError("");
                }}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    otpCode.length === 6 &&
                    !otpSubmitting
                  )
                    handleVerifyOtp();
                }}
                placeholder="000000"
                autoFocus
                className={`otp-step-up-modal__input${otpError ? " otp-step-up-modal__input--error" : ""}`}
              />
              {otpError && (
                <p className="otp-step-up-modal__error">{otpError}</p>
              )}
              {mfaChallengeExpired && (
                <div style={{ marginTop: "0.75rem" }}>
                  <p className="otp-step-up-modal__error">
                    MFA session expired.
                  </p>
                  <button
                    type="button"
                    className="otp-step-up-modal__btn-ghost"
                    style={{ marginTop: "0.5rem" }}
                    onClick={() => {
                      setMfaChallengeExpired(false);
                      setOtpModalOpen(false);
                      handleInitiateOtpRef.current &&
                        handleInitiateOtpRef.current();
                    }}
                  >
                    Try Again
                  </button>
                </div>
              )}
              <p className="otp-step-up-modal__hint">
                Code expires in 5 minutes.
              </p>
              <div className="otp-step-up-modal__actions">
                <button
                  type="button"
                  className="otp-step-up-modal__btn-primary"
                  disabled={otpCode.length !== 6 || otpSubmitting}
                  onClick={handleVerifyOtp}
                >
                  {otpSubmitting ? "Verifying…" : "Verify"}
                </button>
                <button
                  type="button"
                  className="otp-step-up-modal__btn-ghost"
                  onClick={() => handleInitiateOtp()}
                >
                  Resend code
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TOTP Step-Up Modal */}
      {totpModalOpen && (
        <div
          className="otp-step-up-overlay"
          onClick={() => setTotpModalOpen(false)}
        >
          <div
            className="otp-step-up-modal otp-step-up-modal--totp"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="otp-step-up-modal__header">
              <h3 className="otp-step-up-modal__title">Verify Your Identity</h3>
              <button
                className="otp-step-up-modal__close"
                onClick={() => {
                  setTotpModalOpen(false);
                  window.dispatchEvent(new CustomEvent("cibaStepUpCancelled"));
                }}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="otp-step-up-modal__body">
              <p className="otp-step-up-modal__lead">
                Enter the 6-digit code from your{" "}
                <strong>authenticator app</strong>.
              </p>
              <input
                className={`otp-step-up-modal__input${totpError ? " otp-step-up-modal__input--error" : ""}`}
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                autoFocus
                value={totpCode}
                onChange={(e) => {
                  setTotpCode(e.target.value.replace(/\D/g, ""));
                  setTotpError(null);
                }}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    totpCode.length === 6 &&
                    !totpSubmitting
                  )
                    handleTotpSubmit();
                }}
              />
              {totpError && (
                <p className="otp-step-up-modal__error">{totpError}</p>
              )}
              <p className="otp-step-up-modal__hint">
                Open your authenticator app and enter the current 6-digit code.
              </p>
            </div>
            <div className="otp-step-up-modal__actions">
              <button
                className="otp-step-up-modal__btn-ghost"
                onClick={() => setTotpModalOpen(false)}
              >
                Cancel
              </button>
              <button
                className="otp-step-up-modal__btn-primary"
                disabled={totpCode.length !== 6 || totpSubmitting}
                onClick={handleTotpSubmit}
              >
                {totpSubmitting ? "Verifying…" : "Verify"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Device Picker — shown when multiple MFA devices are enrolled */}
      {devicePickerOpen && (
        <div
          className="otp-step-up-overlay"
          onClick={() => setDevicePickerOpen(false)}
        >
          <div
            className="otp-step-up-modal otp-step-up-modal--device-picker"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="otp-step-up-modal__header">
              <h3 className="otp-step-up-modal__title">
                Choose Verification Method
              </h3>
              <button
                className="otp-step-up-modal__close"
                onClick={() => setDevicePickerOpen(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="otp-step-up-modal__body">
              <p className="otp-step-up-modal__lead">
                Select how you want to verify your identity:
              </p>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "8px",
                  marginTop: "8px",
                }}
              >
                {devicePickerDevices.map((device) => (
                  <button
                    key={device.id}
                    className="otp-step-up-modal__btn-ghost"
                    style={{ textAlign: "left" }}
                    onClick={() => handleDevicePick(device)}
                  >
                    {device.type === "EMAIL"
                      ? "Email code"
                      : device.type === "SMS"
                        ? "SMS code"
                        : device.type === "TOTP"
                          ? "Authenticator app"
                          : device.type === "MOBILE"
                            ? "Push notification"
                            : "Passkey / FIDO2"}
                    {device.nickname ? ` (${device.nickname})` : ""}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Push Notification Waiting Panel */}
      {pushModalOpen && (
        <div className="otp-step-up-overlay">
          <div className="otp-step-up-modal otp-step-up-modal--push">
            <div className="otp-step-up-modal__header">
              <h3 className="otp-step-up-modal__title">Check Your Device</h3>
            </div>
            <div
              className="otp-step-up-modal__body"
              style={{ textAlign: "center", padding: "1rem 0" }}
            >
              <PingIdentitySpinner size={48} label="Waiting for approval…" />
              <p
                className="otp-step-up-modal__lead"
                style={{ marginTop: "1rem" }}
              >
                A push notification was sent to your registered device.
                <br />
                <strong>Tap Approve</strong> in the PingOne app to continue.
              </p>
              <p className="otp-step-up-modal__hint">Waiting for approval…</p>
            </div>
            <div
              className="otp-step-up-modal__actions"
              style={{ justifyContent: "center" }}
            >
              <button
                className="otp-step-up-modal__btn-ghost"
                onClick={() => {
                  setPushPolling(false);
                  setPushModalOpen(false);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FIDO2 Passkey Step-Up */}
      {fido2ModalOpen && (
        <Fido2Challenge
          daId={fido2DaId}
          deviceId={fido2DeviceId}
          onSuccess={() => {
            setFido2ModalOpen(false);
            setStepUpRequired(false);
            notifySuccess(
              agentTriggeredStepUp
                ? "Identity verified — resuming agent request…"
                : "Identity verified — please retry your transaction.",
            );
            if (agentTriggeredStepUp) {
              setAgentTriggeredStepUp(false);
              window.dispatchEvent(new CustomEvent("cibaStepUpApproved"));
            }
          }}
          onCancel={() => {
            setFido2ModalOpen(false);
            window.dispatchEvent(new CustomEvent("cibaStepUpCancelled"));
          }}
          onError={(msg) => {
            setFido2ModalOpen(false);
            notifyError(msg);
          }}
          onRegisterPasskey={() => {
            // No passkey for this site on this device — send the user to the
            // enrollment modal rather than dead-ending the step-up.
            setFido2ModalOpen(false);
            setEnrollError("");
            setEnrollModalOpen(true);
          }}
        />
      )}

      {/* MFA Challenge Expired — Try Again bubble (shown outside modals) */}
      {mfaChallengeExpired &&
        !otpModalOpen &&
        !totpModalOpen &&
        !pushModalOpen &&
        !fido2ModalOpen && (
          <div
            className="otp-step-up-overlay"
            onClick={() => setMfaChallengeExpired(false)}
          >
            <div
              className="otp-step-up-modal"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="otp-step-up-modal__header">
                <h3 className="otp-step-up-modal__title">
                  MFA Session Expired
                </h3>
                <button
                  className="otp-step-up-modal__close"
                  onClick={() => setMfaChallengeExpired(false)}
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
              <div className="otp-step-up-modal__body">
                <p className="otp-step-up-modal__lead">
                  Your MFA session has expired. Click below to start a new
                  challenge.
                </p>
                <div className="otp-step-up-modal__actions">
                  <button
                    type="button"
                    className="otp-step-up-modal__btn-primary"
                    onClick={() => {
                      setMfaChallengeExpired(false);
                      handleInitiateOtpRef.current &&
                        handleInitiateOtpRef.current();
                    }}
                  >
                    Try Again
                  </button>
                  <button
                    type="button"
                    className="otp-step-up-modal__btn-ghost"
                    onClick={() => setMfaChallengeExpired(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

      {/* MFA Device Enrollment — no devices enrolled, or none usable here */}
      {enrollModalOpen && (
        <div
          className="otp-step-up-overlay"
          onClick={() => {
            if (!enrolling) closeEnrollModal();
          }}
        >
          <div
            className="otp-step-up-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="otp-step-up-modal__header">
              <h3 className="otp-step-up-modal__title">Set Up MFA</h3>
              <button
                className="otp-step-up-modal__close"
                onClick={closeEnrollModal}
                aria-label="Close"
                disabled={enrolling}
              >
                ✕
              </button>
            </div>
            <div className="otp-step-up-modal__body">
              <p className="otp-step-up-modal__lead">
                Set up a verification method to continue. Email, SMS, and
                passkeys can each be registered here.
              </p>
              {enrollError && (
                <p className="otp-step-up-modal__error">{enrollError}</p>
              )}

              {smsEnrollStep === "choose" && (
                <div
                  className="otp-step-up-modal__actions"
                  style={{ flexDirection: "column", gap: "0.75rem" }}
                >
                  <button
                    type="button"
                    className="otp-step-up-modal__btn-primary"
                    disabled={enrolling}
                    onClick={handleEnrollEmail}
                    data-testid="enroll-email"
                  >
                    {enrolling ? "Setting up…" : "Set up Email OTP"}
                  </button>
                  <button
                    type="button"
                    className="otp-step-up-modal__btn-ghost"
                    disabled={enrolling}
                    onClick={() => {
                      setEnrollError("");
                      setSmsEnrollStep("phone");
                    }}
                    data-testid="enroll-sms"
                  >
                    Set up SMS OTP
                  </button>
                  <button
                    type="button"
                    className="otp-step-up-modal__btn-ghost"
                    disabled={enrolling}
                    onClick={handleEnrollFido2}
                    data-testid="enroll-passkey"
                  >
                    {enrolling ? "Setting up…" : "Register a Passkey"}
                  </button>
                </div>
              )}

              {smsEnrollStep === "phone" && (
                <>
                  <label
                    className="otp-step-up-modal__lead"
                    htmlFor="enroll-sms-phone"
                  >
                    Mobile number
                  </label>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <select
                      className="otp-step-up-modal__input"
                      style={{ width: 130, flex: "0 0 auto" }}
                      value={smsCountryCode}
                      onChange={(e) => setSmsCountryCode(e.target.value)}
                      aria-label="Country code"
                      data-testid="mfa-country-code"
                    >
                      {COUNTRY_CODES.map((c) => (
                        <option key={c.code} value={c.code}>{c.label}</option>
                      ))}
                    </select>
                    <input
                      id="enroll-sms-phone"
                      className="otp-step-up-modal__input"
                      type="tel"
                      placeholder="5551234567"
                      value={smsEnrollPhone}
                      onChange={(e) => setSmsEnrollPhone(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleEnrollSmsInit();
                      }}
                      data-testid="enroll-sms-phone"
                    />
                  </div>
                  <div
                    className="otp-step-up-modal__actions"
                    style={{ flexDirection: "column", gap: "0.75rem" }}
                  >
                    <button
                      type="button"
                      className="otp-step-up-modal__btn-primary"
                      disabled={enrolling}
                      onClick={handleEnrollSmsInit}
                      data-testid="enroll-sms-send"
                    >
                      {enrolling ? "Sending…" : "Send activation code"}
                    </button>
                    <button
                      type="button"
                      className="otp-step-up-modal__btn-ghost"
                      disabled={enrolling}
                      onClick={() => {
                        setEnrollError("");
                        setSmsEnrollStep("choose");
                      }}
                    >
                      ← Back
                    </button>
                  </div>
                </>
              )}

              {smsEnrollStep === "otp" && (
                <>
                  <label
                    className="otp-step-up-modal__lead"
                    htmlFor="enroll-sms-otp"
                  >
                    Enter the 6-digit code we texted you
                  </label>
                  <input
                    id="enroll-sms-otp"
                    className="otp-step-up-modal__input"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="000000"
                    value={smsEnrollOtp}
                    onChange={(e) =>
                      setSmsEnrollOtp(e.target.value.replace(/\D/g, ""))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleEnrollSmsComplete();
                    }}
                    data-testid="enroll-sms-otp"
                  />
                  <div
                    className="otp-step-up-modal__actions"
                    style={{ flexDirection: "column", gap: "0.75rem" }}
                  >
                    <button
                      type="button"
                      className="otp-step-up-modal__btn-primary"
                      disabled={enrolling}
                      onClick={handleEnrollSmsComplete}
                      data-testid="enroll-sms-activate"
                    >
                      {enrolling ? "Activating…" : "Activate SMS"}
                    </button>
                    <button
                      type="button"
                      className="otp-step-up-modal__btn-ghost"
                      disabled={enrolling}
                      onClick={() => {
                        setEnrollError("");
                        setSmsEnrollStep("phone");
                      }}
                    >
                      ← Back
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* User Session Token Modal */}
      {showTokenModal && (
        <FloatingPanel
          title="Session Token"
          onClose={() => setShowTokenModal(false)}
          defaultWidth={820}
          defaultHeight={Math.min(window.innerHeight - 80, 940)}
          defaultX={Math.max(0, Math.round((window.innerWidth - 820) / 2))}
          defaultY={60}
          minWidth={360}
          minHeight={200}
        >
          <div style={{ overflowY: "auto", height: "100%" }}>
            <OAuthTokenDisplayPage />
          </div>
        </FloatingPanel>
      )}

      {showFilmstripPopout && (
        <DraggableModal
          isOpen
          onClose={() => {
            const nextSurface = movieReelSurface === "both" ? "embedded" : "none";
            setMovieReelSurface(nextSurface);
            try {
              localStorage.setItem("ba_movie_reel_surface", nextSurface);
              localStorage.setItem("ba_show_filmstrip", nextSurface === "embedded" ? "1" : "0");
            } catch {}
            window.dispatchEvent(new CustomEvent("agent-filmstrip-toggle", {
              detail: { on: nextSurface === "embedded", surface: nextSurface },
            }));
          }}
          title="Movie reel"
          defaultWidth={Math.min(1120, Math.max(640, window.innerWidth - 48))}
          defaultHeight={Math.min(720, Math.max(420, window.innerHeight - 80))}
          defaultX={Math.max(24, Math.round((window.innerWidth - Math.min(1120, Math.max(640, window.innerWidth - 48))) / 2))}
          defaultY={40}
          minWidth={560}
          minHeight={360}
          storageKey="movie-reel-popout"
        >
          <div className="dm-scroll">
            <ReelDock />
          </div>
        </DraggableModal>
      )}
    </>
  );
}
