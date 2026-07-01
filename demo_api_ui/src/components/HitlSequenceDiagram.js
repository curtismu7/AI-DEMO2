import { useState, useRef, useCallback, useEffect } from "react";
import { DEFAULT_STEP_MS, DiagramControls, STEP_TIME_OPTIONS } from "./diagram";

// ─── Token card components (copied from SequenceDiagramPage.js) ─────────────

const FLOW_ACCENT = {
  oauth: "var(--brand-blue)",
  exchange: "#7c3aed",
  permit: "#16a34a",
  hitl: "#d97706",
  idtoken: "#0891b2",
  mcp: "#475569",
  error: "#dc2626",
};

function FlowClaimRow({ k, v }) {
  const isAud = k === "aud" || k === "audience" || k === "TokenAudience";
  const isAct = k === "act" || k === "may_act" || k === "ActClientId";
  const isDecide = k === "decision" || k === "DecisionContext";
  if (k === "note" || k === "_type" || k === "_rfcs" || k === "_title")
    return null;
  const val = String(v);
  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        marginBottom: 4,
        alignItems: "flex-start",
      }}
    >
      <span
        style={{
          fontSize: "0.73rem",
          color: "#64748b",
          minWidth: 100,
          flexShrink: 0,
          lineHeight: 1.5,
          fontFamily: "inherit",
        }}
      >
        {k}
      </span>
      <span
        style={{
          fontSize: "0.8rem",
          fontFamily: "inherit",
          lineHeight: 1.5,
          wordBreak: "break-word",
          color: isAud
            ? "var(--sidebar-bg-active)"
            : isAct
              ? "#15803d"
              : isDecide
                ? "#15803d"
                : "#0f172a",
          fontWeight: isAud || isAct || isDecide ? 700 : 500,
        }}
      >
        {val}
      </span>
    </div>
  );
}

function OneFlowCard({ token }) {
  if (!token) return null;
  const accentType =
    token._type ||
    (token.decision?.includes("PERMIT")
      ? "permit"
      : token.decision?.includes("DENY")
        ? "error"
        : "oauth");
  const accent = FLOW_ACCENT[accentType] || FLOW_ACCENT.oauth;
  const rfcs = token._rfcs || [];
  const title = token.type || "Token";
  const note = token.note;
  const claimEntries = Object.entries(token).filter(
    ([k]) =>
      k !== "type" &&
      k !== "_type" &&
      k !== "_title" &&
      k !== "_rfcs" &&
      k !== "note",
  );
  return (
    <div
      style={{
        background: "#fff",
        borderRadius: 10,
        padding: "12px 14px",
        minWidth: 270,
        maxWidth: 340,
        boxShadow: "0 4px 20px rgba(0,0,0,0.14)",
        border: "1px solid #e2e8f0",
        borderLeft: `4px solid ${accent}`,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 5,
          marginBottom: 9,
        }}
      >
        <span
          style={{
            fontSize: "0.86rem",
            fontWeight: 700,
            color: "#0f172a",
            flex: "1 1 auto",
          }}
        >
          {title}
        </span>
        {rfcs.map((r) => (
          <span
            key={r}
            style={{
              fontSize: "0.65rem",
              fontWeight: 700,
              background: "#eff6ff",
              color: "#1d4ed8",
              border: "1px solid #bfdbfe",
              borderRadius: 4,
              padding: "1px 5px",
              whiteSpace: "nowrap",
            }}
          >
            {r}
          </span>
        ))}
      </div>
      {claimEntries.map(([k, v]) => (
        <FlowClaimRow key={k} k={k} v={v} />
      ))}
      {note && (
        <div
          style={{
            marginTop: 8,
            paddingTop: 6,
            borderTop: "1px solid #f1f5f9",
            fontSize: "0.73rem",
            color: "#64748b",
            fontStyle: "italic",
            lineHeight: 1.4,
            fontFamily: "system-ui,sans-serif",
          }}
        >
          {note}
        </div>
      )}
    </div>
  );
}

// StepInfoPanel: left sidebar showing current step number, description, and details
// Collapsible <details>-style section used by the rich step panel below.
// Default-open for "Why" so the most-important context is always visible
// without a click; everything else is default-closed to keep the column
// scrollable. Tone: muted gray header, accent bar on the left when open.
function StepDetailSection({
  title,
  accent = "#3b82f6",
  defaultOpen = false,
  children,
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      style={{
        marginTop: "0.5rem",
        borderTop: "1px solid #e2e8f0",
        paddingTop: "0.5rem",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          background: "transparent",
          border: "none",
          padding: 0,
          width: "100%",
          textAlign: "left",
          cursor: "pointer",
          color: "#475569",
          fontWeight: 600,
          fontSize: "0.7rem",
          display: "flex",
          alignItems: "center",
          gap: "0.35rem",
          marginBottom: open ? "0.4rem" : 0,
        }}
      >
        <span style={{ color: accent, fontSize: "0.65rem", width: "0.7rem" }}>
          {open ? "▼" : "▶"}
        </span>
        {title}
      </button>
      {open ? (
        <div
          style={{
            borderLeft: `2px solid ${accent}`,
            paddingLeft: "0.5rem",
            fontSize: "0.7rem",
            color: "#334155",
            lineHeight: 1.5,
          }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

// Pretty key/value rows for request/response blocks. Long URLs and bodies
// wrap onto multiple lines; values render in a slightly darker code-style
// font so the reader can pick fields apart at a glance.
function HttpDetailGrid({ entries }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
      {entries.map(([k, v]) => (
        <div key={k} style={{ display: "flex", gap: "0.4rem" }}>
          <div
            style={{
              fontWeight: 600,
              color: "#64748b",
              minWidth: "3.5rem",
              flexShrink: 0,
            }}
          >
            {k}
          </div>
          <div
            style={{
              color: "#0f172a",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: "0.65rem",
              wordBreak: "break-word",
              whiteSpace: "pre-wrap",
            }}
          >
            {typeof v === "string" || typeof v === "number"
              ? String(v)
              : JSON.stringify(v, null, 2)}
          </div>
        </div>
      ))}
    </div>
  );
}

function StepInfoPanel({
  activeStep,
  currentStepIdx,
  steps,
  isPaused,
  onStepClick,
  panelWidth = 280,
}) {
  const arrowSteps = steps.filter((s) => s.step);
  const totalSteps = arrowSteps.length;
  const stepListRef = useRef(null);

  // Auto-scroll active step into view
  const activeStepNum = activeStep?.step;
  const activeIdx = arrowSteps.findIndex((s) => s.step === activeStepNum);
  useEffect(() => {
    if (activeIdx >= 0 && stepListRef.current) {
      const activeElem = stepListRef.current.querySelector(
        `[data-step="${activeStepNum}"]`,
      );
      if (activeElem) {
        activeElem.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  }, [activeStepNum, activeIdx]);

  if (!activeStep) {
    return (
      <div
        style={{
          width: `${panelWidth}px`,
          flexShrink: 0,
          padding: "1.5rem 1rem",
          background: "#f8fafc",
          borderRight: "1px solid #e2e8f0",
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
          overflowY: "auto",
          maxHeight: "800px",
        }}
      >
        <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "#475569" }}>
          Flow Steps
        </div>
        <div style={{ fontSize: "0.75rem", color: "#94a3b8", lineHeight: 1.6 }}>
          Press Simulate to begin. Then Pause to navigate steps with Prev/Next
          or click a step in this list.
        </div>
        <div
          style={{
            marginTop: "0.5rem",
            fontSize: "0.75rem",
            color: "#cbd5e1",
            fontStyle: "italic",
          }}
        >
          {totalSteps} steps total
        </div>
      </div>
    );
  }

  const fromParticipant = HITL_PARTICIPANTS.find((p) => p.id === activeStep.from);
  const toParticipant = HITL_PARTICIPANTS.find((p) => p.id === activeStep.to);

  return (
    <div
      style={{
        width: `${panelWidth}px`,
        flexShrink: 0,
        padding: "1.5rem 1rem",
        background: "#f8fafc",
        borderRight: "1px solid #e2e8f0",
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
        overflowY: "auto",
        maxHeight: "800px",
      }}
    >
      {/* Active step details */}
      <div
        style={{
          paddingBottom: "1rem",
          borderBottom: "1px solid #e2e8f0",
          marginBottom: "0.5rem",
        }}
      >
        <div
          style={{
            fontSize: "1.1rem",
            fontWeight: 700,
            color: "#0f172a",
            marginBottom: "0.25rem",
          }}
        >
          Step {activeStep.step} of {totalSteps}
        </div>
        <div
          style={{
            fontSize: "1.25rem",
            fontWeight: 700,
            color: "#0f172a",
            marginBottom: "0.5rem",
          }}
        >
          {activeStep.description}
        </div>
        {fromParticipant && toParticipant && (
          <div
            style={{
              fontSize: "0.85rem",
              fontWeight: 600,
              color: "#0f172a",
              marginBottom: "0.4rem",
              lineHeight: 1.4,
            }}
          >
            {fromParticipant.label} calls {toParticipant.label}
          </div>
        )}
        <div
          style={{
            fontSize: "0.78rem",
            color: "#334155",
            lineHeight: 1.5,
            marginBottom: "0.5rem",
          }}
        >
          {activeStep.label}
        </div>
        {activeStep.scopes && activeStep.scopes.length > 0 && (
          <div
            style={{
              paddingTop: "0.5rem",
              borderTop: "1px solid #e2e8f0",
              marginTop: "0.5rem",
            }}
          >
            <div
              style={{
                fontSize: "0.7rem",
                fontWeight: 600,
                color: "#475569",
                marginBottom: "0.3rem",
              }}
            >
              Scopes:
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.25rem",
              }}
            >
              {activeStep.scopes.map((scope) => (
                <div
                  key={scope}
                  style={{
                    fontSize: "0.7rem",
                    color: "#1d4ed8",
                    fontWeight: 500,
                    background: "#eff6ff",
                    padding: "0.3rem 0.5rem",
                    borderRadius: 3,
                  }}
                >
                  {scope}
                </div>
              ))}
            </div>
          </div>
        )}
        {activeStep.tokenChanges && activeStep.tokenChanges.length > 0 && (
          <div
            style={{
              paddingTop: "0.5rem",
              marginTop: "0.5rem",
              borderTop: "1px solid #e2e8f0",
            }}
          >
            <div
              style={{
                fontSize: "0.7rem",
                fontWeight: 600,
                color: "#475569",
                marginBottom: "0.3rem",
              }}
            >
              Token Changes:
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.25rem",
              }}
            >
              {activeStep.tokenChanges.map((change) => (
                <div
                  key={`${activeStep.step}-${change}`}
                  style={{
                    fontSize: "0.74rem",
                    color: "#451a03",
                    fontWeight: 600,
                    background: "#fef9c3",
                    padding: "0.4rem 0.55rem",
                    borderRadius: 4,
                    border: "1px solid #d97706",
                    lineHeight: 1.45,
                  }}
                >
                  {change}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Rich detail sections. Default-open for Why (most-important context);
            everything else is collapsed so the column stays scrollable. Sections
            self-hide when the step doesn't define that field. */}
        {activeStep.why && (
          <StepDetailSection
            title="Why this step matters"
            accent="#0f766e"
            defaultOpen={true}
          >
            {activeStep.why}
          </StepDetailSection>
        )}

        {activeStep.request && (
          <StepDetailSection title="Request" accent="#1d4ed8">
            <HttpDetailGrid
              entries={Object.entries(activeStep.request).filter(
                ([_, v]) => v != null && v !== "",
              )}
            />
          </StepDetailSection>
        )}

        {activeStep.response && (
          <StepDetailSection title="Response" accent="#15803d">
            <HttpDetailGrid
              entries={Object.entries(activeStep.response).filter(
                ([_, v]) => v != null && v !== "",
              )}
            />
          </StepDetailSection>
        )}

        {activeStep.rulesEvaluated && activeStep.rulesEvaluated.length > 0 && (
          <StepDetailSection
            title="Policy rules checked"
            accent="#7c3aed"
            defaultOpen={true}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.4rem",
              }}
            >
              {activeStep.rulesEvaluated.map((r, i) => {
                const palette =
                  r.result === "PASS"
                    ? {
                        bg: "#ecfdf5",
                        border: "#a7f3d0",
                        badgeBg: "#10b981",
                        badgeFg: "#fff",
                      }
                    : r.result === "FAIL"
                      ? {
                          bg: "#fef2f2",
                          border: "#fecaca",
                          badgeBg: "#dc2626",
                          badgeFg: "#fff",
                        }
                      : {
                          bg: "#f8fafc",
                          border: "#e2e8f0",
                          badgeBg: "#94a3b8",
                          badgeFg: "#fff",
                        };
                return (
                  <div
                    key={i}
                    style={{
                      background: palette.bg,
                      border: `1px solid ${palette.border}`,
                      borderRadius: 4,
                      padding: "0.4rem 0.5rem",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "0.4rem",
                      }}
                    >
                      <span
                        style={{
                          background: palette.badgeBg,
                          color: palette.badgeFg,
                          fontWeight: 700,
                          fontSize: "0.6rem",
                          padding: "0.1rem 0.35rem",
                          borderRadius: 3,
                          flexShrink: 0,
                          marginTop: "0.05rem",
                        }}
                      >
                        {r.result}
                      </span>
                      <span
                        style={{
                          fontWeight: 600,
                          color: "#0f172a",
                          fontSize: "0.7rem",
                        }}
                      >
                        {r.rule}
                      </span>
                    </div>
                    {r.detail ? (
                      <div
                        style={{
                          marginLeft: "2.25rem",
                          marginTop: "0.2rem",
                          fontSize: "0.65rem",
                          color: "#475569",
                          fontFamily:
                            "ui-monospace, SFMono-Regular, Menlo, monospace",
                          wordBreak: "break-word",
                        }}
                      >
                        {r.detail}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </StepDetailSection>
        )}

        {activeStep.onError && (
          <StepDetailSection title="What can go wrong" accent="#b91c1c">
            {Array.isArray(activeStep.onError) ? (
              <ul style={{ paddingLeft: "1rem", margin: 0 }}>
                {activeStep.onError.map((line, i) => (
                  <li key={i} style={{ marginBottom: "0.25rem" }}>
                    {line}
                  </li>
                ))}
              </ul>
            ) : (
              activeStep.onError
            )}
          </StepDetailSection>
        )}
      </div>

      {/* Step list */}
      <div
        style={{
          fontSize: "0.75rem",
          fontWeight: 600,
          color: "#475569",
          marginBottom: "0.5rem",
        }}
      >
        Steps:
      </div>
      <div
        ref={stepListRef}
        style={{
          flex: 1,
          overflowY: "auto",
          fontSize: "0.75rem",
          display: "flex",
          flexDirection: "column",
          gap: "0.25rem",
        }}
      >
        {arrowSteps.map((step, idx) => {
          const isActive = step.step === activeStepNum;
          return (
            <button
              key={step.step}
              data-step={step.step}
              onClick={() => {
                if (isPaused) {
                  onStepClick(idx);
                }
              }}
              style={{
                padding: "0.35rem 0.5rem",
                borderRadius: 4,
                border: "none",
                background: isActive ? "#dbeafe" : "#fff",
                color: isActive ? "#004687" : "#475569",
                fontWeight: isActive ? 600 : 400,
                cursor: isPaused ? "pointer" : "default",
                textAlign: "left",
                fontSize: "0.75rem",
                opacity: isPaused ? 1 : 0.6,
                transition: "all 0.2s",
              }}
              disabled={!isPaused}
            >
              <span style={{ color: "#94a3b8", marginRight: "0.25rem" }}>
                {step.step}.
              </span>
              {step.description}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// SVG layout constants
const BASE_X = 100;
const PARTICIPANT_SPACING = 160;
const BASE_Y = 140;
const STEP_HEIGHT = 22;

// Path styling — fill and stroke for each consent path background rect
const PATH_COLORS = { homegrown: "#bbf7d0", onetime: "#bfdbfe", device: "#fed7aa" };
const PATH_STROKES = { homegrown: "#4ade80", onetime: "#60a5fa", device: "#fb923c" };

// HITL_PARTICIPANTS — matches hitl-sequence.mmd participant declarations
const HITL_PARTICIPANTS = [
  { id: "B",   label: "Browser" },
  { id: "BFF", label: "BFF (demo_api_server)" },
  { id: "TC",  label: "transactionConsent.js" },
  { id: "P1",  label: "PingOne MFA" },
];

// HITL_STEPS — populated in Task 2 and Task 3
const HITL_STEPS = [
  // ── Shared preamble ─────────────────────────────────────────────────────────
  {
    type: "note",
    participants: ["B", "P1"],
    path: "shared",
    text: "ALL PATHS — 428 gate enforces consent requirement",
    description: "428 gate",
    why: "Every write operation (transfer, withdrawal, deposit >= $250) is gated by a mandatory consent challenge. The 428 Precondition Required response is the BFF telling the browser 'you must prove consent before I'll execute this'. No challenge ID, no transaction.",
    onError: [
      "Feature flag ff_hitl_enabled=false — gate is bypassed entirely; expected in dev/test only",
      "Amount below threshold — 428 is not issued; transaction proceeds without challenge",
    ],
  },
  {
    step: 1,
    path: "shared",
    from: "B",
    to: "BFF",
    label: "POST /api/transactions (transfer, or withdrawal/deposit >= $250)",
    type: "request",
    description: "POST /api/transactions",
    why: "The user has triggered a write operation in the UI. The BFF receives it, checks the HITL feature flag and amount threshold, and immediately returns 428 — it does not attempt the transaction. This makes the gate synchronous and impossible to race.",
    request: {
      method: "POST",
      url: "https://api.ping.demo:3001/api/transactions",
      headers: { "Content-Type": "application/json", Cookie: "connect.sid=…" },
      body: { type: "transfer", fromAccountId: "acct_01", toAccountId: "acct_02", amount: 500 },
    },
    response: {
      status: 428,
      headers: { "Content-Type": "application/json" },
      body: { error: "precondition_required", message: "Consent challenge required before executing this transaction" },
    },
    rulesEvaluated: [
      { rule: "ff_hitl_enabled = true", result: "PASS", detail: "configStore.getEffective('ff_hitl_enabled') = 'true'" },
      { rule: "amount >= confirm_threshold_usd ($250)", result: "PASS", detail: "amount=500 >= threshold=250" },
    ],
    onError: [
      "200 returned instead of 428 — HITL flag is off or amount is below threshold",
      "401 — session expired; user must re-authenticate before retrying",
    ],
  },
  {
    step: 2,
    path: "shared",
    from: "BFF",
    to: "B",
    label: "428 Precondition Required",
    type: "response",
    description: "428 response",
    why: "RFC 6585 §3: 428 signals that the server requires a precondition the client hasn't met. The UI uses this status code to trigger the consent modal — it's not an error, it's a protocol signal.",
    response: {
      status: 428,
      body: { error: "precondition_required", message: "Consent challenge required" },
    },
    onError: [
      "UI treats 428 as a generic error and shows an error toast — UI must handle 428 specifically",
      "Browser blocks the response — CORS misconfiguration on the BFF",
    ],
  },
  {
    step: 3,
    path: "shared",
    from: "B",
    to: "BFF",
    label: "POST /consent-challenge { type, amount, fromAccountId, ... }",
    type: "request",
    description: "Create challenge",
    why: "The browser now creates a consent challenge, attaching the transaction details. The BFF hashes a snapshot of those details into the challenge record — this snapshot is checked at verify time to prevent tampering with the amount or destination between challenge creation and execution.",
    request: {
      method: "POST",
      url: "https://api.ping.demo:3001/consent-challenge",
      headers: { "Content-Type": "application/json", Cookie: "connect.sid=…" },
      body: { type: "transfer", amount: 500, fromAccountId: "acct_01", toAccountId: "acct_02", currency: "USD" },
    },
    response: {
      status: 201,
      body: { challengeId: "ch_01ABC", expiresAt: "2026-05-23T…", snapshot: "sha256:…" },
    },
    onError: [
      "400 — missing required field (type, amount, fromAccountId)",
      "401 — session expired",
      "Challenge created but snapshot hash wrong — tampering detection will fail at verify step",
    ],
  },
  {
    step: 4,
    path: "shared",
    from: "BFF",
    to: "TC",
    label: "createChallenge()",
    type: "request",
    description: "createChallenge()",
    why: "The BFF delegates challenge lifecycle to transactionConsentChallenge.js. This service stores the challenge in the session (keyed by challengeId), including a SHA-256 snapshot of the transaction details. Keeping it in the session ties the challenge to the authenticated user — a different session cannot consume it.",
    request: { call: "createChallenge({ type, amount, fromAccountId, toAccountId, userId })" },
    response: { returns: "{ challengeId, expiresAt, snapshot }" },
    rulesEvaluated: [
      { rule: "User is authenticated", result: "PASS", detail: "req.session.user.id present" },
      { rule: "Challenge fields valid", result: "PASS", detail: "type, amount, fromAccountId all present and typed correctly" },
    ],
    onError: [
      "Session missing — createChallenge throws; BFF returns 401",
      "Duplicate challengeId collision — extremely unlikely (UUID v4); retry is safe",
    ],
  },
  {
    step: 5,
    path: "shared",
    from: "BFF",
    to: "B",
    label: "201 { challengeId, expiresAt, snapshot }",
    type: "response",
    description: "Challenge created",
    why: "The browser receives the challengeId it will attach to every subsequent consent-flow request. The expiresAt field lets the UI display a countdown and disable the form when the challenge expires. The snapshot is opaque to the browser — it's for server-side tamper detection only.",
    response: {
      status: 201,
      body: { challengeId: "ch_01ABC", expiresAt: "2026-05-23T12:05:00Z", snapshot: "sha256:abc…" },
    },
    onError: [
      "UI doesn't store challengeId — subsequent confirm call will 404",
      "UI ignores expiresAt — user submits OTP after expiry; verify returns 410 Gone",
    ],
  },

  // ── Path 1: Homegrown OTP ────────────────────────────────────────────────────
  {
    type: "note",
    participants: ["B", "TC"],
    path: "homegrown",
    text: "PATH 1 — mode = homegrown (BFF-generated OTP, any amount)",
    description: "Path 1 start",
    why: "When hitl_consent_mfa_mode=homegrown, the BFF generates and emails a 6-digit OTP itself — no PingOne call needed. This path is the simplest: no external MFA dependency, no device enrollment, works at any amount. It's the fallback for environments without PingOne MFA configured.",
    onError: [
      "Config flag is wrong — check configStore.getEffective('hitl_consent_mfa_mode')",
    ],
  },
  {
    step: 6,
    path: "homegrown",
    from: "B",
    to: "BFF",
    label: "POST /consent-challenge/:id/confirm",
    type: "request",
    description: "Confirm challenge (P1)",
    why: "The browser posts to confirm, signalling that the user has reviewed the transaction details in the modal and is ready to receive the OTP. The BFF checks the challenge is still pending and not expired before generating the OTP.",
    request: {
      method: "POST",
      url: "https://api.ping.demo:3001/consent-challenge/ch_01ABC/confirm",
      headers: { "Content-Type": "application/json", Cookie: "connect.sid=…" },
      body: {},
    },
    response: {
      status: 200,
      body: { otpSent: true, otpExpiresAt: "2026-05-23T12:06:00Z" },
    },
    onError: [
      "404 — challengeId not found or already consumed",
      "410 — challenge expired (expiresAt in the past)",
      "403 — session user doesn't match challenge subject",
    ],
  },
  {
    step: 7,
    path: "homegrown",
    from: "BFF",
    to: "TC",
    label: "confirmChallenge() — mode=homegrown — generates OTP, stores HMAC hash",
    type: "request",
    description: "Generate OTP",
    why: "transactionConsentChallenge.js generates a cryptographically random 6-digit OTP and stores its HMAC-SHA256 hash in the challenge record (never the plaintext). The OTP is emailed to the user's registered address. Storing the hash means a DB read can't leak the OTP.",
    request: { call: "confirmChallenge(challengeId, { mode: 'homegrown' })" },
    response: { returns: "{ otpSent: true, otpExpiresAt }" },
    rulesEvaluated: [
      { rule: "Challenge status = pending", result: "PASS", detail: "ch.status='pending'" },
      { rule: "Challenge not expired", result: "PASS", detail: "ch.expiresAt > now" },
      { rule: "mode = homegrown", result: "PASS", detail: "configStore 'hitl_consent_mfa_mode' = 'homegrown'" },
    ],
    onError: [
      "Email send fails — BFF returns 500; user must retry",
      "OTP generation uses Math.random() — must use crypto.randomInt() for security",
    ],
  },
  {
    step: 8,
    path: "homegrown",
    from: "BFF",
    to: "B",
    label: "200 { otpSent: true, otpExpiresAt }",
    type: "response",
    description: "OTP sent (P1)",
    why: "The browser receives confirmation that an OTP email was sent. The UI should now show the OTP entry field and the expiry countdown. Note: no maskedContact is returned on this path (unlike Path 2) because the BFF already knows the address from the session.",
    response: {
      status: 200,
      body: { otpSent: true, otpExpiresAt: "2026-05-23T12:06:00Z" },
    },
    onError: [
      "UI doesn't show OTP field — it must check otpSent: true to reveal the input",
    ],
  },
  {
    step: 9,
    path: "homegrown",
    from: "B",
    to: "BFF",
    label: "POST /consent-challenge/:id/verify-otp { otp }",
    type: "request",
    description: "Submit OTP (P1)",
    why: "The user enters the 6-digit OTP and submits. The BFF will compare it against the stored HMAC hash using timingSafeEqual to prevent timing-based oracle attacks.",
    request: {
      method: "POST",
      url: "https://api.ping.demo:3001/consent-challenge/ch_01ABC/verify-otp",
      headers: { "Content-Type": "application/json", Cookie: "connect.sid=…" },
      body: { otp: "123456" },
    },
    response: {
      status: 200,
      body: { challengeId: "ch_01ABC", confirmExpiresAt: "2026-05-23T12:10:00Z" },
    },
    onError: [
      "401 — OTP wrong; challenge status remains 'pending'; user can retry until expiry",
      "410 — OTP expired (otpExpiresAt in the past)",
      "429 — too many wrong OTP attempts (if rate limiting is enabled)",
    ],
  },
  {
    step: 10,
    path: "homegrown",
    from: "BFF",
    to: "TC",
    label: "verifyOtp() — timingSafeEqual(hash) — status = confirmed",
    type: "request",
    description: "Verify OTP (P1)",
    why: "timingSafeEqual prevents an attacker from guessing the OTP one digit at a time by measuring response latency. Once verified, the challenge status is set to 'confirmed' and a confirmExpiresAt window is set — the actual transaction must be submitted within this window.",
    request: { call: "verifyOtp(challengeId, otp)" },
    response: { returns: "{ confirmed: true, confirmExpiresAt }" },
    rulesEvaluated: [
      { rule: "HMAC hash matches OTP", result: "PASS", detail: "crypto.timingSafeEqual(stored, submitted)" },
      { rule: "OTP not expired", result: "PASS", detail: "ch.otpExpiresAt > now" },
    ],
    onError: [
      "Using string equality instead of timingSafeEqual — timing oracle vulnerability",
      "Status not updated to 'confirmed' — transaction step will re-challenge",
    ],
  },
  {
    step: 11,
    path: "homegrown",
    from: "BFF",
    to: "B",
    label: "200 { challengeId, confirmExpiresAt }",
    type: "response",
    description: "OTP verified (P1)",
    why: "The browser now knows the challenge is confirmed. It has a window (confirmExpiresAt) to submit the actual transaction. The UI should immediately POST the transaction without waiting for user interaction — the consent was given.",
    response: {
      status: 200,
      body: { challengeId: "ch_01ABC", confirmExpiresAt: "2026-05-23T12:10:00Z" },
    },
    onError: [
      "UI delays transaction submission past confirmExpiresAt — transaction is rejected",
    ],
  },
  {
    step: 12,
    path: "homegrown",
    from: "B",
    to: "BFF",
    label: "POST /api/transactions { consentChallengeId }",
    type: "request",
    description: "Execute transaction (P1)",
    why: "The original transaction is now re-submitted with the consentChallengeId attached. The BFF will verify and consume the challenge (one-time use) before executing. The transaction payload is exactly what the user reviewed — the snapshot check ensures it hasn't changed.",
    request: {
      method: "POST",
      url: "https://api.ping.demo:3001/api/transactions",
      headers: { "Content-Type": "application/json", Cookie: "connect.sid=…" },
      body: { type: "transfer", fromAccountId: "acct_01", toAccountId: "acct_02", amount: 500, consentChallengeId: "ch_01ABC" },
    },
    response: {
      status: 200,
      body: { transactionId: "txn_01XYZ", status: "completed" },
    },
    onError: [
      "409 — challenge already consumed (replay attempt)",
      "422 — snapshot mismatch (amount or destination tampered)",
      "410 — confirmExpiresAt passed",
    ],
  },
  {
    step: 13,
    path: "homegrown",
    from: "BFF",
    to: "TC",
    label: "verifyAndConsumeChallenge() — snapshot match, one-time use",
    type: "request",
    description: "Consume challenge (P1)",
    why: "Two invariants are checked atomically: (1) the transaction snapshot matches what the user approved — prevents amount/destination tampering between challenge creation and execution; (2) the challenge is marked consumed so it can never be replayed, even if the network retransmits the request.",
    request: { call: "verifyAndConsumeChallenge(challengeId, { type, amount, fromAccountId, toAccountId })" },
    response: { returns: "{ consumed: true }" },
    rulesEvaluated: [
      { rule: "Challenge status = confirmed", result: "PASS", detail: "ch.status='confirmed'" },
      { rule: "Snapshot matches transaction payload", result: "PASS", detail: "sha256(payload) === ch.snapshot" },
      { rule: "confirmExpiresAt not passed", result: "PASS", detail: "ch.confirmExpiresAt > now" },
      { rule: "Challenge not already consumed", result: "PASS", detail: "ch.consumed = false" },
    ],
    onError: [
      "Snapshot mismatch — attacker modified amount after user approved",
      "Challenge already consumed — replay attack or network retry",
    ],
  },
  {
    step: 14,
    path: "homegrown",
    from: "BFF",
    to: "B",
    label: "200 transaction result",
    type: "response",
    description: "Transaction complete (P1)",
    why: "The transaction executed successfully. The challenge lifecycle is complete — created, confirmed, consumed. The UI can now show the success state and close the modal.",
    response: {
      status: 200,
      body: { transactionId: "txn_01XYZ", status: "completed", amount: 500, type: "transfer" },
    },
    onError: [
      "Downstream banking error after consent passed — show error but don't re-challenge",
    ],
  },

  // ── Path 2: PingOne One-Time OTP ──────────────────────────────────────────
  {
    type: "note",
    participants: ["B", "P1"],
    path: "onetime",
    text: "PATH 2 — mode = onetime (DEFAULT) — PingOne sends OTP, no device enrollment needed",
    description: "Path 2 start",
    why: "The default mode. PingOne sends the OTP directly to the user's email or phone on file — no device enrollment, no FIDO2. The BFF acts as an intermediary: it fetches the user's contact details from PingOne, initiates a deviceAuthentication, and then delegates OTP verification to PingOne.",
    onError: [
      "User has no email/phone in PingOne — GET /users/:id returns no contact; confirm fails",
    ],
  },
  {
    step: 15,
    path: "onetime",
    from: "B",
    to: "BFF",
    label: "POST /consent-challenge/:id/confirm",
    type: "request",
    description: "Confirm challenge (P2)",
    why: "Same endpoint as Path 1 confirm. The BFF reads the mode config flag to decide which confirmation path to take. On this path it will look up the user's PingOne contact details before initiating the deviceAuthentication.",
    request: {
      method: "POST",
      url: "https://api.ping.demo:3001/consent-challenge/ch_01ABC/confirm",
      headers: { "Content-Type": "application/json", Cookie: "connect.sid=…" },
      body: {},
    },
    response: {
      status: 200,
      body: { otpSent: true, otpExpiresAt: "2026-05-23T12:06:00Z", maskedContact: "j***@example.com" },
    },
    onError: [
      "404 — challengeId not found",
      "410 — challenge expired",
      "PingOne returns 404 for user — userId in session doesn't exist in PingOne",
    ],
  },
  {
    step: 16,
    path: "onetime",
    from: "BFF",
    to: "TC",
    label: "confirmChallenge() — mode=onetime — getPingOneUserContact(userId)",
    type: "request",
    description: "Confirm, get contact",
    why: "transactionConsentChallenge.js switches on mode=onetime and fetches the user's contact details from PingOne via the management API. The maskedContact (e.g. 'j***@example.com') is returned to the browser so the user knows where the OTP is being sent.",
    request: { call: "confirmChallenge(challengeId, { mode: 'onetime' })" },
    response: { returns: "{ otpSent: true, otpExpiresAt, maskedContact }" },
    rulesEvaluated: [
      { rule: "Challenge status = pending", result: "PASS", detail: "ch.status='pending'" },
      { rule: "mode = onetime", result: "PASS", detail: "configStore 'hitl_consent_mfa_mode' = 'onetime'" },
    ],
    onError: [
      "PingOne worker token expired — re-auth required before contact lookup",
    ],
  },
  {
    step: 17,
    path: "onetime",
    from: "BFF",
    to: "P1",
    label: "GET /environments/{envId}/users/{userId} (worker token)",
    type: "request",
    description: "Get user contact",
    why: "The BFF calls the PingOne management API with a worker (client_credentials) token to fetch the user's email and mobilePhone. A user token cannot be used here — the user is at the consent modal, not in an active OAuth flow.",
    request: {
      method: "GET",
      url: "https://api.pingone.com/v1/environments/{envId}/users/{userId}",
      headers: { Authorization: "Bearer {WORKER_TOKEN}" },
    },
    response: {
      status: 200,
      body: { id: "{userId}", email: "jane.doe@example.com", mobilePhone: "+1555…" },
    },
    onError: [
      "401 — worker token expired; BFF must re-acquire via client_credentials before retrying",
      "404 — userId not found in PingOne; check session userId vs PingOne user store",
    ],
  },
  {
    step: 18,
    path: "onetime",
    from: "P1",
    to: "BFF",
    label: "{ email, mobilePhone }",
    type: "response",
    description: "User contact returned",
    why: "PingOne returns the user's contact details. The BFF uses the email (or mobilePhone) to determine maskedContact for the UI and to drive the upcoming deviceAuthentication OTP delivery.",
    response: {
      status: 200,
      body: { id: "{userId}", email: "jane.doe@example.com", mobilePhone: "+1555…" },
    },
    onError: [
      "email and mobilePhone both null — no contact to send OTP to; BFF should return 422",
    ],
  },
  {
    step: 19,
    path: "onetime",
    from: "BFF",
    to: "P1",
    label: "POST /environments/{envId}/deviceAuthentications (user token)",
    type: "request",
    description: "Initiate deviceAuth",
    why: "The BFF initiates a PingOne deviceAuthentication using the user's token. PingOne will send the OTP to the user's email or phone. The returned daId is stored in the session — it's needed for OTP verification in the next step.",
    request: {
      method: "POST",
      url: "https://api.pingone.com/v1/environments/{envId}/deviceAuthentications",
      headers: { Authorization: "Bearer {USER_TOKEN}", "Content-Type": "application/json" },
      body: { userId: "{userId}" },
    },
    response: {
      status: 201,
      body: { id: "da_01ABC", status: "OTP_REQUIRED", maskedContact: "j***@example.com" },
    },
    onError: [
      "400 — user has no registered devices and no email/phone for onetime OTP",
      "User token expired — deviceAuthentication call fails with 401",
    ],
  },
  {
    step: 20,
    path: "onetime",
    from: "P1",
    to: "BFF",
    label: "{ id: daId, status: OTP_REQUIRED, maskedContact }",
    type: "response",
    description: "deviceAuth initiated",
    why: "PingOne has created the deviceAuthentication and sent the OTP. The daId is the handle the BFF will use to check the OTP. status: OTP_REQUIRED tells the BFF the OTP was dispatched and the user just needs to enter it.",
    response: {
      status: 201,
      body: { id: "da_01ABC", status: "OTP_REQUIRED", maskedContact: "j***@example.com" },
    },
    onError: [
      "status: FAILED — PingOne couldn't deliver the OTP (invalid contact); user must update their profile",
    ],
  },
  {
    step: 21,
    path: "onetime",
    from: "BFF",
    to: "TC",
    label: "ch.oneTimePath=true, ch.daId stored in session",
    type: "request",
    description: "Store daId in challenge",
    why: "The challenge record is updated with the daId and a flag marking this as a one-time-path challenge. This ties the PingOne deviceAuthentication to the specific consent challenge so the OTP verify step can look it up.",
    request: { call: "updateChallenge(challengeId, { oneTimePath: true, daId: 'da_01ABC' })" },
    response: { returns: "void" },
    rulesEvaluated: [
      { rule: "Challenge still in session", result: "PASS", detail: "session.challenges[challengeId] exists" },
    ],
    onError: [
      "Session lost between confirm and verify — challenge can't be found; user must restart",
    ],
  },
  {
    step: 22,
    path: "onetime",
    from: "BFF",
    to: "B",
    label: "200 { otpSent: true, otpExpiresAt, maskedContact }",
    type: "response",
    description: "OTP sent (P2)",
    why: "The browser receives the masked contact so the user knows where to look for the OTP. The UI shows the OTP entry field and countdown timer.",
    response: {
      status: 200,
      body: { otpSent: true, otpExpiresAt: "2026-05-23T12:06:00Z", maskedContact: "j***@example.com" },
    },
    onError: [
      "maskedContact not shown in UI — user doesn't know where to look for OTP",
    ],
  },
  {
    step: 23,
    path: "onetime",
    from: "B",
    to: "BFF",
    label: "POST /consent-challenge/:id/verify-otp { otp }",
    type: "request",
    description: "Submit OTP (P2)",
    why: "The user enters the OTP from their email/phone. The BFF will forward it to PingOne's deviceAuthentication endpoint for verification rather than checking a local hash — PingOne owns the OTP lifecycle on this path.",
    request: {
      method: "POST",
      url: "https://api.ping.demo:3001/consent-challenge/ch_01ABC/verify-otp",
      headers: { "Content-Type": "application/json", Cookie: "connect.sid=…" },
      body: { otp: "123456" },
    },
    response: {
      status: 200,
      body: { challengeId: "ch_01ABC", confirmExpiresAt: "2026-05-23T12:10:00Z" },
    },
    onError: [
      "401 — OTP wrong; PingOne returns FAILED status",
      "OTP 123123 bypasses PingOne in demo environments (bypass code hardcoded for demos)",
    ],
  },
  {
    step: 24,
    path: "onetime",
    from: "BFF",
    to: "TC",
    label: "verifyMfa() — getChallengePath() = onetime",
    type: "request",
    description: "Route to onetime verify",
    why: "transactionConsentChallenge.js reads the stored path flag (oneTimePath=true) to decide which verification branch to take. This is the routing step — actual PingOne call happens next.",
    request: { call: "verifyMfa(challengeId, otp)" },
    response: { returns: "delegates to mfaService.verifyOnetime(daId, otp)" },
    rulesEvaluated: [
      { rule: "ch.oneTimePath = true", result: "PASS", detail: "routing to onetime branch" },
    ],
    onError: [
      "Path flag not set — falls through to wrong branch; verify fails",
    ],
  },
  {
    step: 25,
    path: "onetime",
    from: "BFF",
    to: "P1",
    label: "POST /deviceAuthentications/{daId} — otp.check (worker token)",
    type: "request",
    description: "Check OTP with PingOne",
    why: "The BFF submits the OTP to PingOne's deviceAuthentication check endpoint using a worker token. PingOne validates the OTP against the one it sent and returns COMPLETED or FAILED.",
    request: {
      method: "POST",
      url: "https://api.pingone.com/v1/environments/{envId}/deviceAuthentications/{daId}",
      headers: { Authorization: "Bearer {WORKER_TOKEN}", "Content-Type": "application/json" },
      body: { otp: { value: "123456" } },
    },
    response: {
      status: 200,
      body: { id: "da_01ABC", status: "COMPLETED" },
    },
    onError: [
      "status: FAILED — wrong OTP; BFF returns 401 to browser",
      "status: OTP_EXPIRED — user took too long; challenge must be restarted",
    ],
  },
  {
    step: 26,
    path: "onetime",
    from: "P1",
    to: "BFF",
    label: "{ status: COMPLETED }",
    type: "response",
    description: "PingOne OTP verified",
    why: "PingOne confirms the OTP was correct. The BFF can now mark the challenge as confirmed and return the confirmExpiresAt window to the browser.",
    response: {
      status: 200,
      body: { id: "da_01ABC", status: "COMPLETED" },
    },
    onError: [
      "COMPLETED returned but BFF doesn't update challenge status — transaction step will reject",
    ],
  },
  {
    step: 27,
    path: "onetime",
    from: "BFF",
    to: "TC",
    label: "status = confirmed",
    type: "request",
    description: "Mark confirmed (P2)",
    why: "The challenge status is updated to 'confirmed' in the session. This is the gate that verifyAndConsumeChallenge checks — it won't execute the transaction unless status is confirmed.",
    request: { call: "updateChallenge(challengeId, { status: 'confirmed', confirmExpiresAt })" },
    response: { returns: "void" },
    rulesEvaluated: [
      { rule: "PingOne status = COMPLETED", result: "PASS", detail: "verified upstream before this call" },
    ],
    onError: [
      "Session expired between PingOne verify and status update — challenge lost",
    ],
  },
  {
    step: 28,
    path: "onetime",
    from: "BFF",
    to: "B",
    label: "200 { challengeId, confirmExpiresAt }",
    type: "response",
    description: "OTP verified (P2)",
    why: "Same response shape as Path 1. Browser proceeds to submit the transaction immediately.",
    response: {
      status: 200,
      body: { challengeId: "ch_01ABC", confirmExpiresAt: "2026-05-23T12:10:00Z" },
    },
    onError: [
      "UI delays transaction past confirmExpiresAt window",
    ],
  },
  {
    step: 29,
    path: "onetime",
    from: "B",
    to: "BFF",
    label: "POST /api/transactions { consentChallengeId }",
    type: "request",
    description: "Execute transaction (P2)",
    why: "Same as Path 1 step 12 — the transaction is re-submitted with the challengeId. verifyAndConsumeChallenge runs the same snapshot + one-time-use checks regardless of which path was used to confirm.",
    request: {
      method: "POST",
      url: "https://api.ping.demo:3001/api/transactions",
      headers: { "Content-Type": "application/json", Cookie: "connect.sid=…" },
      body: { type: "transfer", fromAccountId: "acct_01", toAccountId: "acct_02", amount: 500, consentChallengeId: "ch_01ABC" },
    },
    response: {
      status: 200,
      body: { transactionId: "txn_01XYZ", status: "completed" },
    },
    onError: [
      "409 — replay attempt",
      "422 — snapshot mismatch",
    ],
  },
  {
    step: 30,
    path: "onetime",
    from: "BFF",
    to: "TC",
    label: "verifyAndConsumeChallenge() — snapshot match, one-time use",
    type: "request",
    description: "Consume challenge (P2)",
    why: "Identical invariants to Path 1: snapshot match + one-time consumption. The consume step is path-agnostic by design — any confirmed challenge, regardless of how it was confirmed, goes through the same final gate.",
    request: { call: "verifyAndConsumeChallenge(challengeId, payload)" },
    response: { returns: "{ consumed: true }" },
    rulesEvaluated: [
      { rule: "Challenge status = confirmed", result: "PASS", detail: "ch.status='confirmed'" },
      { rule: "Snapshot matches payload", result: "PASS", detail: "sha256(payload) === ch.snapshot" },
      { rule: "confirmExpiresAt not passed", result: "PASS", detail: "ch.confirmExpiresAt > now" },
      { rule: "Challenge not consumed", result: "PASS", detail: "ch.consumed = false" },
    ],
    onError: [
      "Snapshot mismatch — payload was modified after approval",
      "Already consumed — replay or double-submit",
    ],
  },
  {
    step: 31,
    path: "onetime",
    from: "BFF",
    to: "B",
    label: "200 transaction result",
    type: "response",
    description: "Transaction complete (P2)",
    why: "Transaction executed. Challenge lifecycle complete.",
    response: {
      status: 200,
      body: { transactionId: "txn_01XYZ", status: "completed", amount: 500, type: "transfer" },
    },
    onError: [
      "Downstream banking error — show error; do not re-challenge",
    ],
  },

  // ── Path 3: Device Picker ────────────────────────────────────────────────────
  {
    type: "note",
    participants: ["B", "P1"],
    path: "device",
    text: "PATH 3 — mode = device_picker, amount >= confirm_stepup_threshold_usd ($500)",
    description: "Path 3 start",
    why: "For high-value transactions (>= $500 by default), the user is required to authenticate with an enrolled device (EMAIL, SMS, FIDO2, etc.) rather than a one-time OTP. The device_picker mode adds a device selection step before the OTP is sent.",
    onError: [
      "amount below confirm_stepup_threshold_usd — device picker not triggered even in device_picker mode",
    ],
  },
  {
    step: 32,
    path: "device",
    from: "B",
    to: "BFF",
    label: "POST /consent-challenge/:id/confirm",
    type: "request",
    description: "Confirm challenge (P3)",
    why: "Same confirm endpoint. Mode=device_picker + amount >= $500 triggers the device selection path. The BFF initiates a deviceAuthentication that returns a list of the user's enrolled devices rather than immediately sending an OTP.",
    request: {
      method: "POST",
      url: "https://api.ping.demo:3001/consent-challenge/ch_01ABC/confirm",
      headers: { "Content-Type": "application/json", Cookie: "connect.sid=…" },
      body: {},
    },
    response: {
      status: 200,
      body: { mfaRequired: true, devices: [{ id: "dev_01", type: "EMAIL", maskedContact: "j***@…" }, { id: "dev_02", type: "SMS", maskedContact: "+1***5678" }] },
    },
    onError: [
      "No enrolled devices — returns mfaRequired: true but devices: [] — UI must handle empty state",
      "amount < threshold — falls through to onetime path instead",
    ],
  },
  {
    step: 33,
    path: "device",
    from: "BFF",
    to: "TC",
    label: "confirmChallenge() — mode=device_picker + amount >= $500",
    type: "request",
    description: "Confirm, device picker mode",
    why: "transactionConsentChallenge.js takes the device_picker branch when both mode=device_picker and amount >= confirm_stepup_threshold_usd. It initiates a deviceAuthentication that returns DEVICE_SELECTION_REQUIRED and the list of the user's registered devices.",
    request: { call: "confirmChallenge(challengeId, { mode: 'device_picker', amount: 500 })" },
    response: { returns: "{ mfaRequired: true, devices: [...] }" },
    rulesEvaluated: [
      { rule: "mode = device_picker", result: "PASS", detail: "configStore 'hitl_consent_mfa_mode' = 'device_picker'" },
      { rule: "amount >= confirm_stepup_threshold_usd", result: "PASS", detail: "amount=500 >= threshold=500" },
    ],
    onError: [
      "Threshold mis-configured — device picker triggered for small amounts; check configStore",
    ],
  },
  {
    step: 34,
    path: "device",
    from: "BFF",
    to: "P1",
    label: "POST /environments/{envId}/users/{userId}/deviceAuthentications (user token)",
    type: "request",
    description: "Initiate deviceAuth (P3)",
    why: "The BFF posts to the user-scoped deviceAuthentications endpoint. PingOne returns DEVICE_SELECTION_REQUIRED and the list of the user's enrolled devices, which the BFF passes to the browser for the user to choose from.",
    request: {
      method: "POST",
      url: "https://api.pingone.com/v1/environments/{envId}/users/{userId}/deviceAuthentications",
      headers: { Authorization: "Bearer {USER_TOKEN}", "Content-Type": "application/json" },
    },
    response: {
      status: 201,
      body: { id: "da_01ABC", status: "DEVICE_SELECTION_REQUIRED", devices: [{ id: "dev_01", type: "EMAIL" }, { id: "dev_02", type: "SMS" }] },
    },
    onError: [
      "User has no enrolled devices — DEVICE_SELECTION_REQUIRED but devices: [] — UI dead end",
      "User token expired — 401; re-auth required",
    ],
  },
  {
    step: 35,
    path: "device",
    from: "P1",
    to: "BFF",
    label: "{ id: daId, status: DEVICE_SELECTION_REQUIRED, devices: [...] }",
    type: "response",
    description: "Devices returned",
    why: "PingOne returns the available devices. The BFF stores the daId in the session (needed for selectDevice and submitOtp calls) and returns the device list to the browser.",
    response: {
      status: 201,
      body: { id: "da_01ABC", status: "DEVICE_SELECTION_REQUIRED", devices: [{ id: "dev_01", type: "EMAIL", maskedContact: "j***@…" }] },
    },
    onError: [
      "daId not stored in session — subsequent selectDevice call will fail",
    ],
  },
  {
    step: 36,
    path: "device",
    from: "BFF",
    to: "TC",
    label: "ch.mfaPath=true, ch.daId, ch.devices stored in session",
    type: "request",
    description: "Store devices in challenge",
    why: "The challenge record is updated with the daId, the device list, and a flag marking this as an mfa-path challenge. This ties the PingOne deviceAuthentication to the challenge and makes the device list available for the select-device step.",
    request: { call: "updateChallenge(challengeId, { mfaPath: true, daId: 'da_01ABC', devices: [...] })" },
    response: { returns: "void" },
    rulesEvaluated: [
      { rule: "Challenge still in session", result: "PASS", detail: "session.challenges[challengeId] exists" },
    ],
    onError: [
      "Session evicted between confirm and device selection — user must restart the challenge",
    ],
  },
  {
    step: 37,
    path: "device",
    from: "BFF",
    to: "B",
    label: "200 { mfaRequired: true, devices: [{ id, type, maskedContact }] }",
    type: "response",
    description: "Device list returned",
    why: "The browser receives the list of enrolled devices. The UI renders a device picker so the user can choose which enrolled device (EMAIL, SMS, FIDO2) to receive the OTP on.",
    response: {
      status: 200,
      body: { mfaRequired: true, devices: [{ id: "dev_01", type: "EMAIL", maskedContact: "j***@…" }, { id: "dev_02", type: "SMS", maskedContact: "+1***5678" }] },
    },
    onError: [
      "UI doesn't render device picker — user is stuck at the confirm button",
    ],
  },
  {
    step: 38,
    path: "device",
    from: "B",
    to: "BFF",
    label: "POST /consent-challenge/:id/select-device { deviceId }",
    type: "request",
    description: "Select device",
    why: "The user picks a device from the picker. The BFF tells PingOne which device to send the OTP to, and PingOne transitions the deviceAuthentication from DEVICE_SELECTION_REQUIRED to OTP_REQUIRED.",
    request: {
      method: "POST",
      url: "https://api.ping.demo:3001/consent-challenge/ch_01ABC/select-device",
      headers: { "Content-Type": "application/json", Cookie: "connect.sid=…" },
      body: { deviceId: "dev_01" },
    },
    response: {
      status: 200,
      body: { otpSent: true },
    },
    onError: [
      "deviceId not in the stored devices list — 400 Bad Request",
      "daId missing from session — device selection fails; challenge must be restarted",
    ],
  },
  {
    step: 39,
    path: "device",
    from: "BFF",
    to: "TC",
    label: "selectMfaDevice() — mfaService.selectDevice(daId, deviceId)",
    type: "request",
    description: "Delegate device select",
    why: "transactionConsentChallenge.js delegates to mfaService.selectDevice(), which posts the device selection to PingOne. Once PingOne confirms OTP_REQUIRED, the BFF returns otpSent: true to the browser.",
    request: { call: "selectMfaDevice(challengeId, deviceId)" },
    response: { returns: "{ otpSent: true }" },
    rulesEvaluated: [
      { rule: "ch.mfaPath = true", result: "PASS", detail: "routing to device-picker branch" },
      { rule: "deviceId in ch.devices", result: "PASS", detail: "dev_01 found in stored device list" },
    ],
    onError: [
      "daId stale — PingOne returns 404 for the deviceAuthentication",
    ],
  },
  {
    step: 40,
    path: "device",
    from: "BFF",
    to: "P1",
    label: "POST /deviceAuthentications/{daId} — device.select (worker token)",
    type: "request",
    description: "Select device in PingOne",
    why: "The BFF posts the device selection to PingOne's deviceAuthentication endpoint. PingOne sends the OTP to the selected device and returns OTP_REQUIRED.",
    request: {
      method: "POST",
      url: "https://api.pingone.com/v1/environments/{envId}/deviceAuthentications/{daId}",
      headers: { Authorization: "Bearer {WORKER_TOKEN}", "Content-Type": "application/json" },
      body: { device: { id: "dev_01" } },
    },
    response: {
      status: 200,
      body: { id: "da_01ABC", status: "OTP_REQUIRED" },
    },
    onError: [
      "DEVICE_NOT_FOUND — device was de-registered between list and select",
    ],
  },
  {
    step: 41,
    path: "device",
    from: "P1",
    to: "BFF",
    label: "{ status: OTP_REQUIRED | ASSERTION_REQUIRED }",
    type: "response",
    description: "OTP dispatched",
    why: "PingOne confirms the OTP was sent (or ASSERTION_REQUIRED for FIDO2 devices). The BFF returns otpSent: true to the browser. For FIDO2 the UI would need to trigger the authenticator — not covered in this demo flow.",
    response: {
      status: 200,
      body: { id: "da_01ABC", status: "OTP_REQUIRED" },
    },
    onError: [
      "ASSERTION_REQUIRED — FIDO2 device selected; UI needs WebAuthn flow (out of scope for this demo)",
    ],
  },
  {
    step: 42,
    path: "device",
    from: "BFF",
    to: "B",
    label: "200 { otpSent: true }",
    type: "response",
    description: "OTP sent (P3)",
    why: "The browser now shows the OTP entry field. The user enters the code from their chosen device.",
    response: {
      status: 200,
      body: { otpSent: true },
    },
    onError: [
      "UI doesn't show OTP input — must check otpSent: true",
    ],
  },
  {
    step: 43,
    path: "device",
    from: "B",
    to: "BFF",
    label: "POST /consent-challenge/:id/verify-otp { deviceId, otp }",
    type: "request",
    description: "Submit OTP (P3)",
    why: "The user submits the OTP from their selected device. deviceId is included so the BFF can route to the correct mfaService.submitOtp call.",
    request: {
      method: "POST",
      url: "https://api.ping.demo:3001/consent-challenge/ch_01ABC/verify-otp",
      headers: { "Content-Type": "application/json", Cookie: "connect.sid=…" },
      body: { deviceId: "dev_01", otp: "123456" },
    },
    response: {
      status: 200,
      body: { challengeId: "ch_01ABC", confirmExpiresAt: "2026-05-23T12:10:00Z" },
    },
    onError: [
      "401 — wrong OTP",
      "410 — OTP expired",
    ],
  },
  {
    step: 44,
    path: "device",
    from: "BFF",
    to: "TC",
    label: "verifyMfa() — getChallengePath() = mfa",
    type: "request",
    description: "Route to mfa verify",
    why: "transactionConsentChallenge.js reads the mfaPath flag (true) and routes to mfaService.submitOtp. Same routing pattern as Path 2 but the mfa branch.",
    request: { call: "verifyMfa(challengeId, otp, deviceId)" },
    response: { returns: "delegates to mfaService.submitOtp(daId, deviceId, otp)" },
    rulesEvaluated: [
      { rule: "ch.mfaPath = true", result: "PASS", detail: "routing to mfa branch" },
    ],
    onError: [
      "mfaPath flag not set — falls to wrong branch",
    ],
  },
  {
    step: 45,
    path: "device",
    from: "BFF",
    to: "P1",
    label: "mfaService.submitOtp(daId, deviceId, otp) — worker token",
    type: "request",
    description: "Submit OTP to PingOne (P3)",
    why: "The BFF submits the OTP to PingOne via the worker token. PingOne validates it against the code it sent to the selected device.",
    request: {
      method: "POST",
      url: "https://api.pingone.com/v1/environments/{envId}/deviceAuthentications/{daId}",
      headers: { Authorization: "Bearer {WORKER_TOKEN}", "Content-Type": "application/json" },
      body: { otp: { value: "123456" }, device: { id: "dev_01" } },
    },
    response: {
      status: 200,
      body: { id: "da_01ABC", status: "COMPLETED" },
    },
    onError: [
      "status: FAILED — wrong OTP; BFF returns 401",
    ],
  },
  {
    step: 46,
    path: "device",
    from: "P1",
    to: "BFF",
    label: "{ status: COMPLETED }",
    type: "response",
    description: "PingOne OTP verified (P3)",
    why: "PingOne confirms the OTP. BFF proceeds to mark the challenge confirmed.",
    response: {
      status: 200,
      body: { id: "da_01ABC", status: "COMPLETED" },
    },
    onError: [
      "COMPLETED returned but status not persisted — transaction gate will reject",
    ],
  },
  {
    step: 47,
    path: "device",
    from: "BFF",
    to: "TC",
    label: "status = confirmed",
    type: "request",
    description: "Mark confirmed (P3)",
    why: "Challenge status set to 'confirmed'. Same pattern as Path 2 step 27.",
    request: { call: "updateChallenge(challengeId, { status: 'confirmed', confirmExpiresAt })" },
    response: { returns: "void" },
    rulesEvaluated: [
      { rule: "PingOne status = COMPLETED", result: "PASS", detail: "verified upstream" },
    ],
    onError: [
      "Session expired between PingOne verify and status update",
    ],
  },
  {
    step: 48,
    path: "device",
    from: "BFF",
    to: "B",
    label: "200 { challengeId, confirmExpiresAt }",
    type: "response",
    description: "OTP verified (P3)",
    why: "Browser proceeds to submit the transaction. Same window as Paths 1 and 2.",
    response: {
      status: 200,
      body: { challengeId: "ch_01ABC", confirmExpiresAt: "2026-05-23T12:10:00Z" },
    },
    onError: [
      "UI delays transaction past window",
    ],
  },
  {
    step: 49,
    path: "device",
    from: "B",
    to: "BFF",
    label: "POST /api/transactions { consentChallengeId }",
    type: "request",
    description: "Execute transaction (P3)",
    why: "Transaction re-submitted with challengeId. verifyAndConsumeChallenge runs identical snapshot + one-time-use checks.",
    request: {
      method: "POST",
      url: "https://api.ping.demo:3001/api/transactions",
      headers: { "Content-Type": "application/json", Cookie: "connect.sid=…" },
      body: { type: "transfer", fromAccountId: "acct_01", toAccountId: "acct_02", amount: 500, consentChallengeId: "ch_01ABC" },
    },
    response: {
      status: 200,
      body: { transactionId: "txn_01XYZ", status: "completed" },
    },
    onError: ["409 — replay", "422 — snapshot mismatch"],
  },
  {
    step: 50,
    path: "device",
    from: "BFF",
    to: "TC",
    label: "verifyAndConsumeChallenge() — snapshot match, one-time use",
    type: "request",
    description: "Consume challenge (P3)",
    why: "Identical to Path 1 step 13 and Path 2 step 30. The consume gate is path-agnostic.",
    request: { call: "verifyAndConsumeChallenge(challengeId, payload)" },
    response: { returns: "{ consumed: true }" },
    rulesEvaluated: [
      { rule: "Challenge status = confirmed", result: "PASS", detail: "ch.status='confirmed'" },
      { rule: "Snapshot matches payload", result: "PASS", detail: "sha256(payload) === ch.snapshot" },
      { rule: "confirmExpiresAt not passed", result: "PASS", detail: "ch.confirmExpiresAt > now" },
      { rule: "Challenge not consumed", result: "PASS", detail: "ch.consumed = false" },
    ],
    onError: [
      "Snapshot mismatch — payload modified after approval",
      "Already consumed — replay",
    ],
  },
  {
    step: 51,
    path: "device",
    from: "BFF",
    to: "B",
    label: "200 transaction result",
    type: "response",
    description: "Transaction complete (P3)",
    why: "Transaction executed. Full HITL device-picker consent lifecycle complete.",
    response: {
      status: 200,
      body: { transactionId: "txn_01XYZ", status: "completed", amount: 500, type: "transfer" },
    },
    onError: [
      "Downstream error — show error; do not re-challenge",
    ],
  },

  // ── Closing note ─────────────────────────────────────────────────────────────
  {
    type: "note",
    participants: ["B", "TC"],
    path: "shared",
    text: "OTP 123123 bypasses PingOne in paths 2 and 3 for demo environments",
    description: "Demo bypass note",
    why: "The magic OTP '123123' short-circuits PingOne MFA verification in demo environments so engineers can test the HITL flow without a real PingOne tenant or enrolled devices. It must never be enabled in production — the bypass is guarded by an environment check.",
    onError: [
      "Bypass active in production — critical security vulnerability; check NODE_ENV and bypass guard",
    ],
  },
];

// HITL_SCENARIOS — populated in Task 4
const HITL_SCENARIOS = {
  all:       HITL_STEPS,
  homegrown: HITL_STEPS.filter((s) => s.path === "shared" || s.path === "homegrown"),
  onetime:   HITL_STEPS.filter((s) => s.path === "shared" || s.path === "onetime"),
  device:    HITL_STEPS.filter((s) => s.path === "shared" || s.path === "device"),
};

export default function HitlSequenceDiagram() {
  const [selectedScenario, setSelectedScenario] = useState("all");
  const [isSimulating, setIsSimulating] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentStepIdx, setCurrentStepIdx] = useState(-1);
  const [stepMs, setStepMs] = useState(DEFAULT_STEP_MS);
  const [leftPanelWidth, setLeftPanelWidth] = useState(300);
  const [zoomLevel, setZoomLevel] = useState(100);
  const simTimeouts = useRef([]);
  const pausedStepIdx = useRef(-1);

  const steps = HITL_SCENARIOS[selectedScenario] || HITL_STEPS;
  const activeStep = currentStepIdx >= 0 ? steps[currentStepIdx] : null;

  const participantIndex = (id) => HITL_PARTICIPANTS.findIndex((p) => p.id === id);

  const applyStep = useCallback((idx) => { setCurrentStepIdx(idx); }, []);

  const resetDiagram = useCallback(() => {
    setCurrentStepIdx(-1);
    setIsPaused(false);
    pausedStepIdx.current = -1;
  }, []);

  const scheduleSteps = useCallback((startIdx) => {
    simTimeouts.current.forEach(clearTimeout);
    simTimeouts.current = [];
    steps.slice(startIdx).forEach((_, offset) => {
      const i = startIdx + offset;
      const t = setTimeout(() => {
        applyStep(i);
        if (i === steps.length - 1) {
          const done = setTimeout(() => { resetDiagram(); setIsSimulating(false); }, 4000);
          simTimeouts.current.push(done);
        }
      }, (offset + (startIdx === 0 ? 0 : 1)) * stepMs);
      simTimeouts.current.push(t);
    });
  }, [steps, applyStep, resetDiagram, stepMs]);

  const runSimulation = useCallback(() => {
    if (isSimulating) return;
    setCurrentStepIdx(-1);
    setIsSimulating(true);
    setIsPaused(false);
    scheduleSteps(0);
  }, [isSimulating, scheduleSteps]);

  const pause = useCallback(() => {
    simTimeouts.current.forEach(clearTimeout);
    simTimeouts.current = [];
    pausedStepIdx.current = currentStepIdx;
    setIsPaused(true);
  }, [currentStepIdx]);

  const resume = useCallback(() => {
    if (!isPaused) return;
    setIsPaused(false);
    scheduleSteps(pausedStepIdx.current + 1);
  }, [isPaused, scheduleSteps]);

  const prevStep = useCallback(() => {
    if (!isPaused) return;
    const prev = pausedStepIdx.current - 1;
    if (prev < 0) return;
    applyStep(prev);
    pausedStepIdx.current = prev;
  }, [isPaused, applyStep]);

  const nextStep = useCallback(() => {
    if (!isPaused) return;
    const next = pausedStepIdx.current + 1;
    if (next >= steps.length) { resetDiagram(); setIsSimulating(false); return; }
    applyStep(next);
    pausedStepIdx.current = next;
  }, [isPaused, steps.length, applyStep, resetDiagram]);

  const stopSim = useCallback(() => {
    simTimeouts.current.forEach(clearTimeout);
    simTimeouts.current = [];
    resetDiagram();
    setIsSimulating(false);
  }, [resetDiagram]);

  const handleStepClick = useCallback((idx) => {
    if (!isPaused) return;
    applyStep(idx);
    pausedStepIdx.current = idx;
  }, [isPaused, applyStep]);

  const handleMouseDownResize = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = leftPanelWidth;
    const onMove = (ev) => {
      const newWidth = Math.max(240, Math.min(500, startWidth + ev.clientX - startX));
      setLeftPanelWidth(newWidth);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const arrowSteps = steps.filter((s) => s.step);
  return (
    <div style={{ background: "#fff", display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Controls bar */}
      <div style={{ padding: "0.5rem 1rem", borderBottom: "1px solid #e2e8f0", flexShrink: 0 }}>
        <DiagramControls
          zoom={zoomLevel / 100}
          onZoomIn={() => setZoomLevel((z) => Math.min(200, z + 25))}
          onZoomOut={() => setZoomLevel((z) => Math.max(50, z - 25))}
          onZoomReset={() => setZoomLevel(100)}
          zoomMin={0.5}
          zoomMax={2.0}
          currentStep={activeStep?.step ?? 0}
          totalSteps={arrowSteps.length}
          isSimulating={isSimulating}
          isPaused={isPaused}
          onSimulate={runSimulation}
          onPrev={prevStep}
          onPause={pause}
          onResume={resume}
          onNext={nextStep}
          onStop={stopSim}
          onReset={stopSim}
          stepTimeOptions={STEP_TIME_OPTIONS}
          stepMs={stepMs}
          onSetStepMs={setStepMs}
          extra={
            <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
              <label htmlFor="hitl-scenario-select" style={{ fontSize: "0.8rem", fontWeight: 600, color: "#475569" }}>Scenario:</label>
              <select
                id="hitl-scenario-select"
                value={selectedScenario}
                onChange={(e) => { stopSim(); setSelectedScenario(e.target.value); }}
                style={{ fontSize: "0.8rem", border: "1px solid #cbd5e1", borderRadius: 4, padding: "0.25rem 0.4rem" }}
              >
                <option value="all">All Paths</option>
                <option value="homegrown">Path 1 — Homegrown OTP</option>
                <option value="onetime">Path 2 — PingOne One-Time</option>
                <option value="device">Path 3 — Device Picker</option>
              </select>
            </span>
          }
        />
      </div>

      {/* Split layout */}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <StepInfoPanel
          activeStep={activeStep}
          currentStepIdx={currentStepIdx}
          steps={steps}
          isPaused={isPaused}
          onStepClick={handleStepClick}
          panelWidth={leftPanelWidth}
        />
        {/* Drag handle */}
        <button
          type="button"
          aria-label="Resize panel"
          onMouseDown={handleMouseDownResize}
          style={{ width: 4, cursor: "col-resize", background: "#e2e8f0", flexShrink: 0, border: "none", padding: 0, outline: "none" }}
        />
        {/* SVG area */}
        <div style={{ flex: 1, overflow: "auto", background: "#f8fafc", padding: "1rem" }}>
          <div style={{ transform: `scale(${zoomLevel / 100})`, transformOrigin: "top left", transition: "transform 0.15s", width: zoomLevel === 100 ? "100%" : `${BASE_X + HITL_PARTICIPANTS.length * PARTICIPANT_SPACING}px` }}>
            <svg
              viewBox={`0 0 ${BASE_X + HITL_PARTICIPANTS.length * PARTICIPANT_SPACING} ${BASE_Y + steps.length * STEP_HEIGHT + 60}`}
              width="100%"
              style={{ display: "block" }}
              aria-label="HITL consent sequence diagram"
              role="img"
            >
              <title>HITL consent flow sequence diagram</title>
              <defs>
                <marker id="hitl-solid" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
                  <path d="M0,0 L0,6 L8,3 z" fill="#475569" />
                </marker>
                <marker id="hitl-solid-active" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
                  <path d="M0,0 L0,6 L8,3 z" fill="#004687" />
                </marker>
                <marker id="hitl-dashed" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
                  <path d="M0,0 L0,6 L8,3 z" fill="#475569" />
                </marker>
                <marker id="hitl-dashed-active" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
                  <path d="M0,0 L0,6 L8,3 z" fill="#004687" />
                </marker>
              </defs>

              {/* Path background rects — drawn before lifelines so arrows appear on top */}
              {["homegrown", "onetime", "device"].map((pathKey) => {
                let firstIdx = -1;
                let lastIdx = -1;
                steps.forEach((s, i) => {
                  if (s.path !== pathKey) return;
                  if (firstIdx === -1) firstIdx = i;
                  lastIdx = i;
                });
                if (firstIdx === -1) return null;
                const y1 = BASE_Y + firstIdx * STEP_HEIGHT - 14;
                const y2 = BASE_Y + lastIdx * STEP_HEIGHT + 14;
                return (
                  <rect
                    key={pathKey}
                    x={60}
                    y={y1}
                    width={BASE_X + (HITL_PARTICIPANTS.length - 1) * PARTICIPANT_SPACING - 20}
                    height={y2 - y1}
                    rx={4}
                    fill={PATH_COLORS[pathKey]}
                    stroke={PATH_STROKES[pathKey]}
                    strokeWidth={1}
                    opacity={0.5}
                  />
                );
              })}

              {/* Participant boxes and lifelines */}
              {HITL_PARTICIPANTS.map((p, i) => {
                const x = BASE_X + i * PARTICIPANT_SPACING;
                const words = p.label.split(" ");
                const lines = [];
                let cur = "";
                words.forEach((w) => {
                  if ((cur + w).length > 14) { if (cur) lines.push(cur.trim()); cur = w; }
                  else { cur += (cur ? " " : "") + w; }
                });
                if (cur) lines.push(cur.trim());
                return (
                  <g key={p.id}>
                    <rect x={x - 60} y={20} width={120} height={20 + lines.length * 16} fill="#f1f5f9" stroke="#cbd5e1" strokeWidth={1} rx={4} />
                    {lines.map((line, li) => (
                      <text key={`${p.id}-${line}`} x={x} y={40 + li * 16} textAnchor="middle" fontSize={11} fontWeight="600" fill="#0f172a">{line}</text>
                    ))}
                    <line x1={x} y1={20 + lines.length * 16 + 10} x2={x} y2={BASE_Y + steps.length * STEP_HEIGHT + 40} stroke="#cbd5e1" strokeDasharray="4" strokeWidth={1} />
                  </g>
                );
              })}

              {/* Steps */}
              {steps.map((step, idx) => {
                const isActive = idx === currentStepIdx;
                const isPastStep = idx < currentStepIdx;
                const y = BASE_Y + idx * STEP_HEIGHT;
                const opacity = isPastStep ? 0.35 : 1;

                if (step.type === "note") {
                  const partIdxs = step.participants.map(participantIndex).filter((i) => i >= 0);
                  if (partIdxs.length === 0) return null;
                  const minX = BASE_X + Math.min(...partIdxs) * PARTICIPANT_SPACING - 50;
                  const maxX = BASE_X + Math.max(...partIdxs) * PARTICIPANT_SPACING + 50;
                  return (
                    <g key={`note-${step.path}-${step.description}`} opacity={opacity}>
                      <rect x={minX} y={y - 13} width={maxX - minX} height={26} rx={5}
                        fill={isActive ? "#fef08a" : "#fef9c3"} stroke="#d97706" strokeWidth={isActive ? 2 : 1} />
                      <text x={(minX + maxX) / 2} y={y + 4} textAnchor="middle" fontSize={10} fill="#451a03" fontWeight="600">
                        {step.text.length > 70 ? step.text.slice(0, 68) + "…" : step.text}
                      </text>
                    </g>
                  );
                }

                const fromX = BASE_X + participantIndex(step.from) * PARTICIPANT_SPACING;
                const toX = BASE_X + participantIndex(step.to) * PARTICIPANT_SPACING;
                const midX = (Math.min(fromX, toX) + Math.max(fromX, toX)) / 2;
                const isDashed = step.type === "response";
                const markerId = isActive
                  ? (isDashed ? "hitl-dashed-active" : "hitl-solid-active")
                  : (isDashed ? "hitl-dashed" : "hitl-solid");

                return (
                  <g key={`step-${step.step}-${idx}`} opacity={opacity}>
                    <line
                      x1={fromX} y1={y} x2={toX} y2={y}
                      stroke={isActive ? "#004687" : "#cbd5e1"}
                      strokeWidth={isActive ? 3 : 1.5}
                      strokeDasharray={isDashed ? "6 3" : undefined}
                      markerEnd={`url(#${markerId})`}
                    />
                    <text x={midX} y={y - 4} textAnchor="middle" fontSize={9.5}
                      fill={isActive ? "#004687" : "#475569"} fontWeight={isActive ? 700 : 400}>
                      {step.step ? `${step.step}. ` : ""}{step.label.length > 55 ? step.label.slice(0, 53) + "…" : step.label}
                    </text>
                    {isActive && (
                      <g>
                        <circle cx={fromX} cy={y} r={9} fill="#1d4ed8" />
                        <text x={fromX} y={y + 4} textAnchor="middle" fontSize={8} fill="#fff" fontWeight="700">{step.step}</text>
                      </g>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

