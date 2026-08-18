import { useState, useRef, useCallback, useEffect } from "react";
import useDividerDrag from "../hooks/useDividerDrag";
import { DEFAULT_STEP_MS, DiagramControls, STEP_TIME_OPTIONS } from "./diagram";
import DiagramExportBar from "./DiagramExportBar";
/**

/**
 * SequenceDiagramPage.js — /sequence-diagram
 *
 * Interactive sequence diagram of the i4ai reference architecture.
 * Participants: User → Chatbot → Agent → LLM → PingOne → Agent Gateway → Ping Authorize → MCP → Resource Server
 * 44 steps with simulation, scenarios, and token cards (same UX as ArchitectureFlowPage).
 */

// ─── Token card components (reused from ArchitectureFlowPage) ───────────────

const FLOW_ACCENT = {
  oauth: "#2563eb",
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
            ? "#1d4ed8"
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
          ℹ {note}
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

  const fromParticipant = PARTICIPANTS.find((p) => p.id === activeStep.from);
  const toParticipant = PARTICIPANTS.find((p) => p.id === activeStep.to);

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
                  • {change}
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
                // Colour-code by result: green = PASS, red = FAIL, gray = N/A.
                // Show the rule on its own line, then a smaller detail line beneath.
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

// IMPORTANT: No emojis in any UI text (participant labels, step labels, notes).
// All labels and notes must match i4ai-ref-arch.mmd exactly, including multi-line formatting.

// PARTICIPANTS (from i4ai-ref-arch.mmd, see https://demo-api-server:3001/architecture/flow)
const PARTICIPANTS = [
  // Mermaid: actor U as User
  { id: "U", label: "User", icon: "" },
  // Mermaid: participant WA as Web Application
  { id: "WA", label: "Web Application", icon: "" },
  // Mermaid: participant CB as Chatbot
  { id: "CB", label: "Chatbot", icon: "" },
  // Mermaid: participant A as Agent (Digital Assistant)
  { id: "A", label: "Agent (Digital Assistant)", icon: "" },
  // Mermaid: participant LLM as LLM
  { id: "LLM", label: "LLM", icon: "" },
  // Mermaid: participant PID as Ping Identity IDM/IAM
  { id: "PID", label: "Ping Identity IDM/IAM", icon: "" },
  // Mermaid: participant AG as Agent Gateway
  { id: "AG", label: "Agent Gateway", icon: "" },
  // Mermaid: participant PA as Ping Authorize
  { id: "PA", label: "Ping Authorize", icon: "" },
  // Mermaid: participant MCP as MCP
  { id: "MCP", label: "MCP", icon: "" },
  // Mermaid: participant RS as Resource Server (OAuth 2.1)
  { id: "RS", label: "Resource Server (OAuth 2.1)", icon: "" },
];

// ALL_STEPS: 1:1 with i4ai-ref-arch.mmd (see https://demo-api-server:3001/architecture/flow)
// Each step/note references the corresponding Mermaid line in a comment.
// description field: brief human-readable title for the left step panel (2-5 words)
const ALL_STEPS = [
  // Note over U,CB: User submits prompt
  {
    type: "note",
    participants: ["U", "CB"],
    text: "User submits prompt",
    description: "User submits prompt",
    why: "Frames the scenario: a real customer is about to ask the chatbot a question that needs access to their private banking data. Everything that follows is in service of answering that one prompt safely.",
    onError: [
      "No prompt entered — the chatbot has nothing to act on; UI should disable submit until input is non-empty",
      "User isn't on the chatbot page at all — front-end routing issue, not an auth issue",
    ],
  },
  // U->>CB: "What is my current account balance\nand recent transactions?"
  {
    step: 1,
    from: "U",
    to: "CB",
    label: '"What is my current account balance\nand recent transactions?"',
    type: "request",
    description: "User Prompt",
    why: "The user's natural-language question is the trigger for the whole flow. Capturing it cleanly is what lets the agent later decide which banking tool to call.",
    request: {
      method: "POST",
      url: "https://demo-api-server:3001/chat",
      headers: {
        "Content-Type": "application/json",
        Cookie: "connect.sid=s%3A{SESSION_ID}.{SIG}",
      },
      body: {
        message: "What is my current account balance and recent transactions?",
        conversationId: "conv_01HXYZ...",
      },
    },
    response: {
      status: 202,
      headers: { "Content-Type": "application/json" },
      body: { accepted: true, conversationId: "conv_01HXYZ..." },
    },
    onError: [
      "401 Unauthorized — user's session cookie expired; chatbot should redirect to login",
      "413 Payload Too Large — prompt exceeded the chatbot's input limit",
      "Network error — UI should retry with backoff and show a transient banner",
    ],
  },
  // CB->>A: Process user request via Agent
  {
    step: 2,
    from: "CB",
    to: "A",
    label: "Process user request via Agent",
    type: "request",
    description: "Agent Handoff",
    why: "The chatbot UI itself doesn't reason — it hands the prompt to the Agent (digital assistant) service, which owns LLM orchestration and tool calling. This keeps the front-end thin and the brains server-side.",
    request: {
      method: "POST",
      url: "https://api.ping.demo:3001/api/agent/converse",
      headers: {
        "Content-Type": "application/json",
        Cookie: "connect.sid=s%3A{SESSION_ID}.{SIG}",
      },
      body: {
        prompt: "What is my current account balance and recent transactions?",
        conversationId: "conv_01HXYZ...",
      },
    },
    response: {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { agentRequestId: "agent_req_01HXYZ...", status: "processing" },
    },
    onError: [
      "502 Bad Gateway — agent service is down or unreachable from the BFF",
      "503 Service Unavailable — agent service overloaded; surface a retry hint",
      "504 Gateway Timeout — agent took too long to acknowledge the handoff",
    ],
  },
  // Note over A: Agent initializes
  {
    type: "note",
    participants: ["A"],
    text: "Agent initializes",
    description: "Agent initializes",
    why: "Before the agent can do anything useful it has to introduce itself to PingOne as a trusted identity. This is where it acquires its own credentials, separate from the user's.",
    onError: [
      "Misconfigured client_id/secret in agent service environment — initialization will fail on first token call",
      "PingOne reachability problem from the agent host — DNS or egress firewall issue",
    ],
  },
  // A->>PID: Token request (client_credentials)
  {
    step: 3,
    from: "A",
    to: "PID",
    label: "Token request (client_credentials)",
    type: "request",
    description: "CC Token Request",
    why: "The agent authenticates as itself using OAuth 2.0 client credentials. This token represents the agent's own identity — not the user — and is used for things only the agent should be allowed to do, like listing available tools.",
    request: {
      method: "POST",
      url: "https://auth.pingone.com/{ENV_ID}/as/token",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: "Basic {BASE64(CLIENT_ID:CLIENT_SECRET)}",
      },
      body: "grant_type=client_credentials&scope=tools.list",
    },
    response: {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
      body: {
        access_token: "eyJhbGciOi...AgentCCToken...",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "tools.list",
      },
    },
    onError: [
      "401 invalid_client — wrong client_id or client_secret, or the app isn't enabled in PingOne",
      "400 unauthorized_client — client_credentials grant not allowed on this PingOne app",
      "400 invalid_scope — agent requested a scope it isn't entitled to",
    ],
  },
  // PID-->>A: Access token
  {
    step: 4,
    from: "PID",
    to: "A",
    label: "Access token",
    type: "response",
    description: "Access Token",
    why: "PingOne issues a short-lived bearer token that proves the agent's identity. The agent will present this on the next call so downstream services know who is asking.",
    request: {
      frame: "token-response",
      payload: { grant_type: "client_credentials", aud: "agent-gateway" },
    },
    response: {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: {
        access_token: "eyJhbGciOi...AgentCCToken...",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "tools.list",
        claims: {
          sub: "agent1-cc-client",
          aud: "agent-gateway",
          iss: "https://auth.pingone.com/{ENV_ID}",
          scope: "tools.list",
          client_id: "{PINGONE_AGENT_CLIENT_ID}",
          iat: 1778000000,
          exp: 1778003600,
        },
      },
    },
    onError: [
      "Token missing expected audience — PingOne resource config doesn't map this client to the agent-gateway resource",
      "Token has wider scope than requested — review PingOne app's default scopes",
      "Clock skew on the agent host — exp/iat checks downstream will fail",
    ],
  },
  // Note over A: Request tool list
  {
    type: "note",
    participants: ["A"],
    text: "Request tool list",
    description: "Request tool list",
    why: "Before the agent can pick a tool, it needs to know which tools it's even allowed to use. Asking the gateway lets policy — not hardcoding — decide what's available.",
    onError: [
      "Agent skips this step and hardcodes a tool list — fragile, won't reflect policy changes",
      "Agent caches the list too long and misses newly added or revoked tools",
    ],
  },
  // A->>AG: tools/list (JSON-RPC)
  {
    step: 5,
    from: "A",
    to: "AG",
    label: "tools/list (JSON-RPC)",
    type: "request",
    description: "Tools List Request",
    why: "The agent asks the gateway for its catalog of MCP tools, presenting its own client_credentials token. The gateway will use this token to ask the authorizer what this agent is allowed to see.",
    request: {
      method: "POST",
      url: "http://localhost:3036/jsonrpc",
      headers: {
        Authorization: "Bearer eyJhbGciOi...AgentCCToken...",
        "Content-Type": "application/json",
      },
      body: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      },
    },
    response: {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: {
        jsonrpc: "2.0",
        id: 1,
        result: {
          tools: ["check_balance", "list_transactions", "transfer_funds"],
        },
      },
    },
    onError: [
      "401 invalid_token — gateway can't verify the agent's bearer (wrong issuer or expired)",
      "Connection refused — Agent Gateway not running on 3036 or firewall blocking",
      "JSON-RPC parse error — malformed payload from agent",
    ],
  },
  // AG->>PA: Authorization check (agent token)
  {
    step: 6,
    from: "AG",
    to: "PA",
    label: "Authorization check (agent token)",
    type: "request",
    description: "Auth Check (Agent)",
    why: "The gateway never decides authorization itself — it always asks Ping Authorize. This keeps policy externalized so the security team can change it without redeploying gateways.",
    request: {
      method: "POST",
      url: "https://pa.ping.demo/governance-engine/decision",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer {GATEWAY_PA_CLIENT_TOKEN}",
      },
      body: {
        action: "tools/list",
        subject: { token: "eyJhbGciOi...AgentCCToken..." },
        resource: { type: "mcp.tools", id: "*" },
      },
    },
    response: {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: {
        decision: "PERMIT",
        obligations: { filter_tools_by: "agent_scope" },
      },
    },
    rulesEvaluated: [
      {
        rule: "Agent identity is a registered agent app",
        result: "PASS",
        detail: "client_id={PINGONE_AGENT_CLIENT_ID} matches registered AI_AGENT app",
      },
      {
        rule: "Agent token has tools.list scope",
        result: "PASS",
        detail: "scope='tools.list'",
      },
      {
        rule: "Token audience matches agent gateway",
        result: "PASS",
        detail: "aud='agent-gateway'",
      },
      {
        rule: "Token not expired",
        result: "PASS",
        detail: "exp=1778003600 > now",
      },
      {
        rule: "Agent persona permits tool discovery",
        result: "PASS",
        detail: "role=banking_assistant; discovery=allowed",
      },
    ],
    onError: [
      "401 from Ping Authorize — gateway's own service credentials are wrong",
      "Policy returns INDETERMINATE — missing attributes; check the PA policy trace",
      "Network timeout to PA — falling back may unsafely permit; ensure fail-closed default",
    ],
  },
  // PA->>PID: Introspect agent token
  {
    step: 7,
    from: "PA",
    to: "PID",
    label: "Introspect agent token",
    type: "request",
    description: "Token Introspect",
    why: "Ping Authorize doesn't trust raw token bytes — it asks PingOne to confirm the token is real, unrevoked, and to surface its claims. This is OAuth 2.0 Token Introspection (RFC 7662).",
    request: {
      method: "POST",
      url: "https://auth.pingone.com/{ENV_ID}/as/introspect",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: "Basic {BASE64(PA_INTROSPECT_CLIENT_ID:SECRET)}",
      },
      body: "token=eyJhbGciOi...AgentCCToken...&token_type_hint=access_token",
    },
    response: {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: {
        active: true,
        sub: "agent1-cc-client",
        aud: "agent-gateway",
        scope: "tools.list",
        client_id: "{PINGONE_AGENT_CLIENT_ID}",
        iat: 1778000000,
        exp: 1778003600,
      },
    },
    onError: [
      "401 invalid_client — PA's introspection credentials are wrong",
      "200 with active:false — token revoked or expired; deny the request",
      "Slow introspect responses — consider short-lived JWT validation with JWKS as a fallback",
    ],
  },
  // PID-->>PA: Token claims (sub, aud, scope)
  {
    step: 8,
    from: "PID",
    to: "PA",
    label: "Token claims (sub, aud, scope)",
    type: "response",
    description: "Token Claims",
    why: "PingOne returns the introspected token's claims so Ping Authorize can make a policy decision. Without this, the authorizer would be blind to the requester's identity and scopes.",
    request: {
      frame: "introspect-claims-return",
      payload: { token_type_hint: "access_token" },
    },
    response: {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: {
        active: true,
        sub: "agent1-cc-client",
        aud: "agent-gateway",
        scope: "tools.list",
        client_id: "{PINGONE_AGENT_CLIENT_ID}",
        iss: "https://auth.pingone.com/{ENV_ID}",
        iat: 1778000000,
        exp: 1778003600,
      },
    },
    onError: [
      "Claims missing the aud — PA can't enforce audience binding; treat as deny",
      "active:false slipped past — usually a caching bug at PA",
      "Empty scope claim — PingOne app config didn't grant any scope to this client",
    ],
  },
  // Note over PA: Fine-grained policy evaluation:<br/>return allowed tools for this agent
  {
    type: "note",
    participants: ["PA"],
    text: "Fine-grained policy evaluation:\nreturn allowed tools for this agent",
    description: "Fine-grained policy evaluation",
    why: "Different agents may have access to different tool sets. Ping Authorize trims the catalog down to exactly what this agent's identity and scopes permit — least privilege, enforced centrally.",
    rulesEvaluated: [
      {
        rule: "Per-tool agent allowlist",
        result: "PASS",
        detail:
          "agent1 allowed: check_balance, list_transactions, transfer_funds; denied: admin_close_account, freeze_user",
      },
      {
        rule: "Subject-less tools available without user context",
        result: "N/A",
        detail: "no educational/public tools registered for this catalog",
      },
      {
        rule: "Risk tier of each tool vs agent's risk authorization",
        result: "PASS",
        detail: "agent risk_tier=medium; included tools tier <= medium",
      },
      {
        rule: "Tenant-level tool feature flags",
        result: "PASS",
        detail: "tenant=bxf; flags allow read+transfer tools",
      },
      {
        rule: "Scope reduction filter — drop tools requiring missing scopes",
        result: "PASS",
        detail:
          "agent has tools.list; tools requiring admin filtered out",
      },
    ],
    onError: [
      "Policy returns the full catalog by mistake — agent ends up with tools it shouldn't see",
      "Policy returns an empty list — likely a missing entitlement assignment in PA",
      "Decision latency spikes — add a short cache keyed on (subject, resource) to keep UX snappy",
    ],
  },
  // PA-->>AG: Permitted tool list for agent
  {
    step: 9,
    from: "PA",
    to: "AG",
    label: "Permitted tool list for agent",
    type: "response",
    description: "Tool List (Filtered)",
    why: "Ping Authorize hands the gateway the final, policy-filtered list. The gateway can now answer the agent confidently without making its own access decisions.",
    request: {
      frame: "pa-decision-result",
      payload: { agent: "agent1-cc-client" },
    },
    response: {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: {
        decision: "PERMIT",
        permitted_tools: [
          "check_balance",
          "list_transactions",
          "transfer_funds",
        ],
      },
    },
    rulesEvaluated: [
      {
        rule: "Per-tool agent allowlist applied",
        result: "PASS",
        detail: "returned 3 of 5 catalog tools after allowlist filter",
      },
      {
        rule: "Subject-less mode tools",
        result: "N/A",
        detail: "no public tools registered",
      },
      {
        rule: "Risk tier filter applied",
        result: "PASS",
        detail: "all returned tools <= agent risk_tier (medium)",
      },
      {
        rule: "Tenant feature flags applied",
        result: "PASS",
        detail: "tenant=bxf flags honored",
      },
      {
        rule: "Scope reduction filter applied",
        result: "PASS",
        detail: "tools needing scopes outside agent grant removed",
      },
    ],
    onError: [
      "Decision body missing permitted_tools — gateway should fail closed and return an empty list",
      "PA returns DENY at the top level — agent shouldn't have reached tools/list at all; revisit baseline scope grants",
    ],
  },
  // AG-->>A: List of available tools
  {
    step: 10,
    from: "AG",
    to: "A",
    label: "List of available tools",
    type: "response",
    description: "Available Tools",
    why: "The agent now knows the menu. It will hand this list to the LLM so the model can pick the right tool for the user's question.",
    request: {
      frame: "tools-list-response",
      payload: { jsonrpc: "2.0", id: 1 },
    },
    response: {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: {
        jsonrpc: "2.0",
        id: 1,
        result: {
          tools: [
            {
              name: "check_balance",
              description: "Get current account balance",
            },
            {
              name: "list_transactions",
              description: "List recent transactions",
            },
            {
              name: "transfer_funds",
              description: "Transfer money between accounts",
            },
          ],
        },
      },
    },
    onError: [
      "WebSocket dropped before result arrived — agent should reopen and retry once",
      "Tools missing descriptions — LLM tool-choice quality drops; ensure schemas are populated",
      "Stale list cached at agent — refresh on every conversation start to honor policy changes",
    ],
  },
  // CB->>A: Pass user prompt to agent
  {
    step: 11,
    from: "CB",
    to: "A",
    label: "Pass user prompt to agent",
    type: "request",
    description: "Forward Prompt to Agent",
    why: "Now that the agent has its tool catalog, the chatbot relays the user's original question so the agent can reason about which tool fits. Splitting prompt handling from tool listing keeps each step debuggable.",
    request: {
      method: "POST",
      url: "https://api.ping.demo:3001/api/agent/prompt",
      headers: {
        "Content-Type": "application/json",
        Cookie: "connect.sid=s%3A{SESSION_ID}.{SIG}",
      },
      body: {
        agentRequestId: "agent_req_01HXYZ...",
        prompt: "What is my current account balance and recent transactions?",
        availableTools: [
          "check_balance",
          "list_transactions",
          "transfer_funds",
        ],
      },
    },
    response: {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { accepted: true },
    },
    onError: [
      "404 — agentRequestId not found; conversation state was lost server-side",
      "400 — prompt missing or malformed",
      "Race condition where tools list hadn't completed — chatbot should await step 10 before this",
    ],
  },
  // A->>LLM: Tool list + chatbot prompt
  {
    step: 12,
    from: "A",
    to: "LLM",
    label: "Tool list + chatbot prompt",
    type: "request",
    description: "Pass Prompt to LLM",
    why: "The agent gives the LLM both the user's question and the menu of allowed tools. The model's job is to decide which (if any) tool to invoke — it doesn't see tokens or call anything itself.",
    request: {
      method: "POST",
      url: "https://api.anthropic.com/v1/messages",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": "{ANTHROPIC_API_KEY}",
        "anthropic-version": "2023-06-01",
      },
      body: {
        model: "claude-opus-4-7",
        max_tokens: 1024,
        tools: [
          {
            name: "check_balance",
            input_schema: { type: "object", properties: {} },
          },
          {
            name: "list_transactions",
            input_schema: { type: "object", properties: {} },
          },
        ],
        messages: [
          {
            role: "user",
            content:
              "What is my current account balance and recent transactions?",
          },
        ],
      },
    },
    response: {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { id: "msg_01XYZ", stop_reason: "tool_use" },
    },
    onError: [
      "401 from LLM provider — bad or rotated API key",
      "429 rate limited — agent should back off and retry",
      "Tool schemas malformed — model can't emit a valid tool_use; tighten JSON Schema",
    ],
  },
  // LLM-->>A: Determine tool to use (check_balance)
  {
    step: 13,
    from: "LLM",
    to: "A",
    label: "Determine tool to use (check_balance)",
    type: "response",
    description: "Tool Decision",
    why: "The LLM returns a structured tool_use directive telling the agent to call check_balance. Centralizing this decision in the model is what lets the chatbot answer freeform questions without hard-coded routing.",
    request: {
      frame: "llm-tool-decision",
      payload: { stop_reason: "tool_use" },
    },
    response: {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: {
        content: [
          {
            type: "tool_use",
            id: "tool_use_01ABC",
            name: "check_balance",
            input: {},
          },
        ],
        stop_reason: "tool_use",
      },
    },
    onError: [
      "Model hallucinated a tool name not in the catalog — agent must reject and reprompt",
      "Model returned plain text instead of tool_use — usually a malformed system prompt",
      "Model invented unsafe parameters — agent must validate against the tool's JSON Schema",
    ],
  },
  // Note over A: Tool call — agent context only <br/> (no user subject token)
  {
    type: "note",
    participants: ["A"],
    text: "Tool call — agent context only\n(no user subject token)",
    description: "Tool call — agent context only",
    why: "This is the deliberate failure we want viewers to see. The agent tries to call check_balance using only its own identity. The system must refuse — agents shouldn't read a specific user's balance without that user's consent.",
    onError: [
      "Agent skips this attempt and goes straight to step-up — viewers miss the security teaching moment",
      "Gateway erroneously permits the call — major security regression; PA policy is broken",
    ],
  },
  // A->>AG: tools/call check_balance (JSON-RPC)
  {
    step: 14,
    from: "A",
    to: "AG",
    label: "tools/call check_balance (JSON-RPC)",
    type: "request",
    description: "Tool Call (No Subject)",
    why: "The agent calls the tool with only its own client_credentials token attached. There's no user identity in the request, which is exactly the condition the next steps will catch.",
    request: {
      method: "POST",
      url: "http://localhost:3036/jsonrpc",
      headers: {
        Authorization: "Bearer eyJhbGciOi...AgentCCToken...",
        "Content-Type": "application/json",
      },
      body: {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "check_balance", arguments: {} },
      },
    },
    response: {
      status: 403,
      headers: { "Content-Type": "application/json" },
      body: {
        jsonrpc: "2.0",
        id: 2,
        error: { code: -32001, message: "insufficient_scope" },
      },
    },
    onError: [
      "Agent forgets it has no user token and assumes success — wrap tool calls in error handling",
      "401 instead of 403 — token expired entirely; refresh client_credentials and retry",
      "WS frame too large — tool args bloated; trim or paginate",
    ],
  },
  // AG->>PA: Authorization check
  {
    step: 15,
    from: "AG",
    to: "PA",
    label: "Authorization check",
    type: "request",
    description: "Auth Check (No Subject)",
    why: "Gateway asks Ping Authorize whether this specific tool call is allowed given only the agent's token. The point of this step is for PA to notice no user subject is present and refuse.",
    request: {
      method: "POST",
      url: "https://pa.ping.demo/governance-engine/decision",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer {GATEWAY_PA_CLIENT_TOKEN}",
      },
      body: {
        action: "tools/call",
        tool: "check_balance",
        subject: { token: "eyJhbGciOi...AgentCCToken..." },
        resource: {
          type: "mcp.tool",
          id: "check_balance",
          required_scope: "read",
        },
      },
    },
    response: {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: {
        decision: "DENY",
        reason: "insufficient_scope:balance, no_subject_token",
      },
    },
    rulesEvaluated: [
      {
        rule: "subject_token present for user-context tools",
        result: "FAIL",
        detail: "subject_token=null; check_balance requires user identity",
      },
      {
        rule: "Tool's requires_user_context flag",
        result: "FAIL",
        detail: "check_balance.requires_user_context=true; no user supplied",
      },
      {
        rule: "Agent client_credentials scope sufficient for user-specific data",
        result: "FAIL",
        detail:
          "CC token has only 'tools.list'; missing read for user resource",
      },
      {
        rule: "Audience match for MCP gateway",
        result: "PASS",
        detail: "aud='agent-gateway' (correct gateway)",
      },
    ],
    onError: [
      "PA returns PERMIT despite missing subject — policy gap; banking data could leak",
      "PA returns INDETERMINATE — likely missing attribute; treat as deny",
      "PA unreachable — gateway MUST fail closed, never open",
    ],
  },
  // PA-->>AG: Deny (insufficient_scope: balance, no subject token)
  {
    step: 16,
    from: "PA",
    to: "AG",
    label: "Deny (insufficient_scope: balance, no subject token)",
    type: "response",
    description: "DENY — No Subject Token",
    why: "Ping Authorize correctly refuses: reading a user's balance requires the user's consent, encoded as a subject token. The deny carries enough context for the agent to know what's missing and trigger step-up.",
    request: {
      frame: "pa-decision-result",
      payload: { action: "tools/call", tool: "check_balance" },
    },
    response: {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: {
        decision: "DENY",
        reason: "insufficient_scope:balance, no_subject_token",
        required_scope: "read",
        required_resource: "agent1",
      },
    },
    rulesEvaluated: [
      {
        rule: "requires_user_context=true AND subject_token=null triggers DENY",
        result: "FAIL",
        detail:
          "tool=check_balance; requires_user_context=true; subject_token=null",
      },
      {
        rule: "Policy requires act.sub != null AND sub != client_id",
        result: "FAIL",
        detail: "sub=client_id ({PINGONE_AGENT_CLIENT_ID}); no act delegation present",
      },
      {
        rule: "Required scope read present on subject token",
        result: "FAIL",
        detail: "no subject token → no read scope available",
      },
    ],
  },
  // AG-->>A: HTTP 403 Forbidden (insufficient_scope: balance, no subject token)
  {
    step: 17,
    from: "AG",
    to: "A",
    label: "HTTP 403 Forbidden (insufficient_scope: balance, no subject token)",
    type: "response",
    description: "403 Forbidden",
    why: "The gateway translates PA's deny into a standards-compliant 403 with an insufficient_scope hint, telling the agent precisely what additional context is required (a user subject token with the balance scope).",
    request: {
      frame: "gateway-deny",
      payload: { jsonrpc: "2.0", id: 2 },
    },
    response: {
      status: 403,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate":
          'Bearer error="insufficient_scope", scope="read", resource="agent1"',
      },
      body: {
        jsonrpc: "2.0",
        id: 2,
        error: {
          code: -32001,
          message: "insufficient_scope",
          data: { required_scope: "read", required_resource: "agent1" },
        },
      },
    },
  },
  // A-->>CB: User context required (resource: agent1, scope: balance)
  {
    step: 18,
    from: "A",
    to: "CB",
    label: "User context required (resource: agent1, scope: balance)",
    type: "response",
    description: "User Context Required",
    why: "The agent reports back to the chatbot that this question can't be answered without the user's explicit consent. The chatbot now has everything it needs to either send the user to login or use an existing session to mint a scoped token.",
    request: {
      frame: "agent-needs-user-context",
      payload: { agentRequestId: "agent_req_01HXYZ..." },
    },
    response: {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: {
        status: "user_context_required",
        required: { resource: "agent1", scope: "read" },
        prompt_replay_token: "replay_01XYZ",
      },
    },
    onError: [
      "Chatbot misinterprets as a hard failure — surface a clean 'sign in to continue' UI instead",
      "prompt_replay_token missing — user has to retype their question after auth; bad UX",
      "Loop risk if chatbot retries the same call without obtaining context — guard with a state flag",
    ],
  },
  // Note over CB,WA: EITHER: User already authenticated (skip to step 19)
  {
    type: "note",
    participants: ["CB", "WA"],
    text: "EITHER: User already authenticated\nObtain scoped subject token (skip to step 19)",
    description: "User already authenticated",
    why: "If the user has already signed in to the web app, there's no need to interrupt them with another login. The chatbot can reuse the existing session to mint a narrow, agent-scoped token immediately.",
    onError: [
      "Session cookie present but expired — treat as not-authenticated and fall into the login branch",
      "Session belongs to a different PingOne environment — reject and force re-login",
    ],
  },
  // Note over CB,WA: OR: If user is not authenticated
  {
    type: "note",
    participants: ["CB", "WA"],
    text: "OR: If user is not authenticated,\nPingOne authentication is triggered",
    description: "If user is not authenticated",
    why: "If there's no live session, the chatbot has to send the user through standard OIDC authentication before any tokens can be minted. This is the branch where PingOne sees the user in person for the first time.",
    onError: [
      "User abandons login — chatbot must time out gracefully and not loop the redirect",
      "Third-party cookies blocked — popup-based login flows can fail silently on Safari",
    ],
  },
  // CB-->>U: Redirect to PingOne login
  {
    step: "18a",
    from: "CB",
    to: "U",
    label: "Redirect to PingOne login (OIDC authorize)",
    type: "response",
    description: "Redirect to PingOne",
    why: "Authentication has to happen on PingOne's own domain, not on the chatbot's. The redirect hands control to PingOne and includes the resource/scope hints so PingOne can issue the right kind of token at the end.",
    request: {
      frame: "browser-redirect",
      payload: { trigger: "user_context_required" },
    },
    response: {
      status: 302,
      headers: {
        Location:
          "https://auth.pingone.com/{ENV_ID}/as/authorize?response_type=code&client_id={WA_CLIENT_ID}&redirect_uri=https%3A%2F%2Fapi.ping.demo%3A4000%2Fcallback&scope=openid%20profile%20banking%3Aread&resource=agent1&state={STATE}&code_challenge={PKCE_CHALLENGE}&code_challenge_method=S256",
      },
    },
    onError: [
      "Missing state or PKCE challenge — CSRF and code-injection protections are off; abort",
      "redirect_uri not allowlisted in PingOne — PingOne will return invalid_redirect_uri",
      "scope contains a value the app isn't entitled to — PingOne returns invalid_scope",
    ],
  },
  // U->>PID: Authenticate with PingOne
  {
    step: "18b",
    from: "U",
    to: "PID",
    label: "Authenticate (email, password, MFA)",
    type: "request",
    description: "PingOne Authentication",
    why: "PingOne actually verifies the human — credentials, MFA, risk signals. Keeping this work centralized means the chatbot and BFF never see passwords and can't be tricked into accepting weaker auth.",
    request: {
      method: "POST",
      url: "https://auth.pingone.com/{ENV_ID}/as/authorize/login",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "username=jane.doe%40example.com&password=*****&mfa_otp=123456",
    },
    response: {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { status: "AUTHENTICATION_SUCCESS", flowId: "flow_01ABC" },
    },
    onError: [
      "401 INVALID_CREDENTIALS — user mistyped; PingOne handles retry counting",
      "PASSWORD_LOCKED_OUT — too many bad attempts; surface unlock instructions",
      "MFA_REQUIRED challenge — flow needs another round trip for OTP/push",
    ],
  },
  // PID-->>U: Session established, redirect to app callback
  {
    step: "18c",
    from: "PID",
    to: "U",
    label: "Session established, redirect to callback URL",
    type: "response",
    description: "Session Established",
    why: "Once PingOne is satisfied, it sets its own session cookie and bounces the browser back to the chatbot's callback with an authorization code. The code is short-lived and only redeemable by the chatbot's BFF — never by JavaScript.",
    request: {
      frame: "browser-redirect-back",
      payload: { flowId: "flow_01ABC" },
    },
    response: {
      status: 302,
      headers: {
        Location:
          "https://demo-api-server:3001/callback?code={AUTH_CODE}&state={STATE}",
        "Set-Cookie":
          "ST={PINGONE_SESSION}; Path=/; Secure; HttpOnly; SameSite=None",
      },
    },
    onError: [
      "state mismatch on return — possible CSRF; reject immediately",
      "code already redeemed — PingOne returns invalid_grant; user must restart login",
      "Browser drops third-party cookies — session won't persist across redirects",
    ],
  },
  // U-->>CB: User returns authenticated
  {
    step: "18d",
    from: "U",
    to: "CB",
    label: "User authenticated, session cookie set",
    type: "response",
    description: "Authenticated Session",
    why: "The chatbot's BFF exchanges the auth code for tokens server-side and sets its own httpOnly session cookie. From the browser's perspective the user is just 'signed in' — tokens never touch front-end code.",
    request: {
      method: "GET",
      url: "https://demo-api-server:3001/callback?code={AUTH_CODE}&state={STATE}",
      headers: { Cookie: "ST={PINGONE_SESSION}" },
    },
    response: {
      status: 302,
      headers: {
        Location: "https://demo-api-server:3001/chat?resume=replay_01XYZ",
        "Set-Cookie":
          "connect.sid=s%3A{SESSION_ID}.{SIG}; Path=/; HttpOnly; Secure; SameSite=Lax",
      },
    },
    onError: [
      "Code exchange fails (invalid_grant) — usually clock skew or reused code",
      "Session cookie not Secure/HttpOnly — token-custody rule violated; review BFF middleware",
      "replay_token lost in the redirect — user lands on the chatbot with no original question to answer",
    ],
  },
  // CB->>A: Request token (resource: agent1, scope: balance)
  {
    step: 19,
    from: "CB",
    to: "WA",
    label: "Request token (resource: agent1, scope: balance)",
    type: "request",
    description: "Scoped Token Request",
    why: "Now that there's a logged-in user, the chatbot asks the web app's BFF to mint a token specifically scoped to what the agent needs — not a broad-access token. Narrow scope means even a leaked token has limited blast radius.",
    request: {
      method: "POST",
      url: "https://demo-api-server:3001/api/agent-token",
      headers: {
        "Content-Type": "application/json",
        Cookie: "connect.sid=s%3A{SESSION_ID}.{SIG}",
      },
      body: { resource: "agent1", scope: "read" },
    },
    response: {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { tokenRequestId: "treq_01XYZ", status: "issuing" },
    },
    onError: [
      "401 — session expired between login and this call; bounce user to login again",
      "400 invalid_resource — resource indicator not registered in PingOne",
      "403 — user not entitled to the requested scope; show a clear permission-denied message",
    ],
  },
  // WA->>PID: Token request (resource: agent1, scope: balance)
  {
    step: 20,
    from: "WA",
    to: "PID",
    label: "Token request (resource: agent1, scope: balance)",
    type: "request",
    description: "PingOne Token Request",
    scopes: ["read"],
    why: "The BFF talks to PingOne on the user's behalf to issue a subject token narrowly audienced to the agent. The resource indicator (RFC 8707) is what tells PingOne to embed aud=agent1 and may_act so this token can later be exchanged.",
    request: {
      method: "POST",
      url: "https://auth.pingone.com/{ENV_ID}/as/token",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: "Basic {BASE64(WA_CLIENT_ID:SECRET)}",
      },
      body: "grant_type=authorization_code&code={AUTH_CODE}&redirect_uri=https%3A%2F%2Fapi.ping.demo%3A4000%2Fcallback&resource=agent1&scope=banking%3Aread&code_verifier={PKCE_VERIFIER}",
    },
    response: {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: {
        access_token: "eyJhbGciOi...SubjectToken...",
        token_type: "Bearer",
        expires_in: 600,
        scope: "read",
      },
    },
    onError: [
      "400 invalid_grant — auth code already used or expired",
      "400 invalid_target — resource indicator agent1 not registered in PingOne",
      "401 invalid_client — BFF's client_id/secret wrong",
    ],
  },
  // PID-->>WA: Subject token (sub: user, aud: agent1, may_act: {sub: agent1}, scope: balance)
  {
    step: 21,
    from: "PID",
    to: "WA",
    label:
      "Subject token (sub: user, aud: agent1, may_act: {sub: agent1}, scope: balance)",
    type: "response",
    description: "Subject Token Issued",
    scopes: ["read"],
    why: "PingOne issues a token where the user is the subject and the agent is recorded as an allowed actor via may_act. That single claim is what unlocks safe RFC 8693 delegation downstream — it's the consent record.",
    request: {
      frame: "token-issuance-response",
      payload: { grant_type: "authorization_code", resource: "agent1" },
    },
    response: {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
      body: {
        access_token: "eyJhbGciOi...SubjectToken...",
        token_type: "Bearer",
        expires_in: 600,
        scope: "read",
        claims: {
          sub: "user_jane_doe",
          aud: "agent1",
          iss: "https://auth.pingone.com/{ENV_ID}",
          scope: "read",
          may_act: { sub: "agent1-cc-client" },
          iat: 1778000000,
          exp: 1778000600,
        },
      },
    },
    onError: [
      "Token missing may_act — RFC 8693 exchange in step 24 will fail; check PingOne actor policy",
      "Token aud is too broad — narrow it via resource indicators; otherwise it can be used anywhere",
      "Expiry too long — subject tokens should be short-lived; 5-10 min is typical",
    ],
  },
  // WA-->>CB: Subject token
  {
    step: 22,
    from: "WA",
    to: "CB",
    label: "Subject token",
    type: "response",
    description: "Subject Token Return",
    why: "The BFF passes the subject token to the chatbot's server-side handler. Crucially the token itself never reaches the browser — only its session cookie does.",
    request: {
      frame: "internal-handoff",
      payload: { tokenRequestId: "treq_01XYZ" },
    },
    response: {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: {
        subject_token: "eyJhbGciOi...SubjectToken...",
        token_type: "urn:ietf:params:oauth:token-type:access_token",
        expires_in: 600,
      },
    },
    onError: [
      "Token leaked into a browser-visible response — token-custody rule broken; redact and audit",
      "Chatbot service stores token longer than expires_in — stale-token failures downstream",
    ],
  },
  // CB->>A: Subject token (sub: user, may_act: {sub: agent1})
  {
    step: 23,
    from: "CB",
    to: "A",
    label: "Subject token (sub: user, may_act: {sub: agent1})",
    type: "request",
    description: "Subject Token to Agent",
    why: "The chatbot hands the subject token to the agent service so the agent can use it as the subject in the upcoming RFC 8693 exchange. The agent never receives the user's password — only this purpose-built token.",
    request: {
      method: "POST",
      url: "https://api.ping.demo:3001/api/agent/attach-subject-token",
      headers: {
        "Content-Type": "application/json",
        Cookie: "connect.sid=s%3A{SESSION_ID}.{SIG}",
      },
      body: {
        agentRequestId: "agent_req_01HXYZ...",
        subject_token: "eyJhbGciOi...SubjectToken...",
      },
    },
    response: {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { attached: true, ready_to_retry: true },
    },
    onError: [
      "Token forwarded over plain HTTP — must be TLS only",
      "Agent caches the token past its exp — every tool call will 401; refresh on demand",
      "agentRequestId doesn't match — conversation state was lost; start over",
    ],
  },
  // Note over A,PID: Exchange token for Agent Gateway (RFC 8693)
  {
    type: "note",
    participants: ["A", "PID"],
    text: "Exchange token for Agent Gateway (RFC 8693)",
    description: "Exchange token — Agent Gateway",
    why: "Rather than reusing the same token everywhere, each hop gets its own audience-bound token via RFC 8693 Token Exchange. That way a token stolen from one segment can't be replayed against another.",
    onError: [
      "Teams skip exchange and reuse the subject token everywhere — audience binding lost; major security regression",
      "Confused subject vs. actor token order — exchange will succeed but with wrong sub/act claims",
    ],
  },
  // A->>PID: Token exchange (actor_token: agent token, subject_token: user token)
  {
    step: 24,
    from: "A",
    to: "PID",
    label:
      "Token exchange (actor_token: agent token, subject_token: user token)",
    type: "request",
    description: "RFC 8693 Exchange #1",
    tokenChanges: [
      "Add act claim (agent1)",
      "Change aud to mcp-gw",
      "Keep scope: read",
    ],
    why: "The agent asks PingOne to mint a new token that says 'this is the user, being acted on by agent1, targeted at the gateway'. This is the core RFC 8693 'delegation' pattern — provable on-behalf-of with no impersonation.",
    request: {
      method: "POST",
      url: "https://auth.pingone.com/{ENV_ID}/as/token",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: "Basic {BASE64(PINGONE_AGENT_CLIENT_ID:SECRET)}",
      },
      body: "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Atoken-exchange&subject_token=eyJhbGciOi...SubjectToken...&subject_token_type=urn%3Aietf%3Aparams%3Aoauth%3Atoken-type%3Aaccess_token&actor_token=eyJhbGciOi...AgentCCToken...&actor_token_type=urn%3Aietf%3Aparams%3Aoauth%3Atoken-type%3Aaccess_token&resource=mcp-gw&scope=banking%3Aread",
    },
    response: {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: {
        access_token: "eyJhbGciOi...TxTokenGW...",
        issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
        token_type: "Bearer",
        expires_in: 600,
        scope: "read",
      },
    },
    onError: [
      "400 unsupported_grant_type — token-exchange grant not enabled on the PingOne app",
      "400 invalid_request — subject_token missing may_act for this actor",
      "400 invalid_target — mcp-gw not registered as a resource indicator in PingOne",
    ],
  },
  // PID-->>A: TX token (sub: user, act: {sub: agent1}, aud: mcp-gw, scope: balance)
  {
    step: 25,
    from: "PID",
    to: "A",
    label:
      "TX token (sub: user, act: {sub: agent1}, aud: mcp-gw, scope: balance)",
    type: "response",
    description: "TX Token (Agent GW)",
    tokenChanges: [
      "Add act claim (agent1)",
      "Change aud to mcp-gw",
      "Keep scope: read",
    ],
    why: "PingOne returns the first exchanged token. The act claim is the cryptographic proof that the agent is operating on the user's behalf — downstream services can see both who and on-whose-behalf in one token.",
    request: {
      frame: "token-exchange-response",
      payload: {
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        resource: "mcp-gw",
      },
    },
    response: {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
      body: {
        access_token: "eyJhbGciOi...TxTokenGW...",
        issued_token_type: "urn:ietf:params:oauth:token-type:access_token",
        token_type: "Bearer",
        expires_in: 600,
        scope: "read",
        claims: {
          sub: "user_jane_doe",
          aud: "mcp-gw",
          iss: "https://auth.pingone.com/{ENV_ID}",
          scope: "read",
          act: { sub: "agent1-cc-client", client_id: "{PINGONE_AGENT_CLIENT_ID}" },
          iat: 1778000000,
          exp: 1778000600,
        },
      },
    },
    onError: [
      "act claim absent — PingOne resource policy needs to emit it; see CLAUDE.md token-policy notes",
      "Token still has aud=agent1 — resource indicator was ignored; check PingOne config",
      "scope quietly widened — verify PingOne scope-policy isn't auto-granting extra scopes",
    ],
  },
  // Note over A: sub=user, act=agent1 — Agent acts on behalf of user
  {
    type: "note",
    participants: ["A"],
    text: "sub=user, act=agent1 — Agent acts on behalf of user",
    description: "sub=user, act=agent1",
    why: "This is the moment to pause and explain: the token is provably 'about the user, by the agent'. Any service that reads it can hold both parties accountable in the audit log.",
    onError: [
      "Teams confuse sub and act and audit by the wrong party — train ops staff on RFC 8693 semantics",
    ],
  },
  // Note over A: Option: aud: mcp-olb<br/>(requires assurance only path to MCP is via gateway)
  {
    type: "note",
    participants: ["A"],
    text: "Option: aud: mcp-olb\n(requires assurance only path to MCP is via gateway)",
    description: "aud: mcp-olb option",
    why: "An advanced topology can target the MCP directly (aud: mcp-olb) but only if you can prove the gateway is the sole entry point. Most deployments keep aud=mcp-gw for safety — exchanges happen at each boundary.",
    onError: [
      "aud=mcp-olb used without enforcing gateway-only ingress — MCP can be hit directly with stolen token",
      "Mixing audiences across calls — confusing to operate; pick one model and stick to it",
    ],
  },
  // A->>AG: tools/call check_balance (JSON-RPC) with TX token
  {
    step: 26,
    from: "A",
    to: "AG",
    label: "tools/call check_balance (JSON-RPC) with TX token",
    type: "request",
    description: "Tool Call with TX Token",
    why: "This is the retry of step 14, but now with a real on-behalf-of token. The agent expects this call to succeed because the token carries both the user's consent and the agent's identity.",
    request: {
      method: "POST",
      url: "http://localhost:3036/jsonrpc",
      headers: {
        Authorization: "Bearer eyJhbGciOi...TxTokenGW...",
        "Content-Type": "application/json",
      },
      body: {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "check_balance", arguments: {} },
      },
    },
    response: {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { jsonrpc: "2.0", id: 3, result: { balance: 2450.32 } },
    },
    onError: [
      "401 invalid_token — TX token expired in transit; mint a fresh one",
      "403 — gateway saw aud != mcp-gw; the exchange in step 24 used the wrong resource indicator",
      "WebSocket closed mid-frame — retry with the same id, server should dedupe",
    ],
  },
  // Note over AG,PA: Gateway authorizes TX token + tool call
  {
    type: "note",
    participants: ["AG", "PA"],
    text: "Gateway authorizes TX token + tool call",
    description: "Gateway authorizes TX token",
    why: "Even with a delegated token, the gateway re-checks with the authorizer. Never trust a token blindly — always ask policy whether this token, this scope, and this specific tool call are still allowed right now.",
    onError: [
      "Gateway skips authorization because the token 'looks valid' — that's how scope creep happens",
      "Policy cache too aggressive — authorize on every call or use very short TTLs",
    ],
  },
  // AG->>PA: Authorization check (TX token, tool: check_balance)
  {
    step: 27,
    from: "AG",
    to: "PA",
    label: "Authorization check (TX token, tool: check_balance)",
    type: "request",
    description: "Auth Check (TX Token)",
    why: "Gateway hands Ping Authorize both the delegated token and the specific tool being invoked. PA can now make a holistic decision: who is the user, who is the agent, what tool, what arguments.",
    request: {
      method: "POST",
      url: "https://pa.ping.demo/governance-engine/decision",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer {GATEWAY_PA_CLIENT_TOKEN}",
      },
      body: {
        action: "tools/call",
        tool: "check_balance",
        subject: { token: "eyJhbGciOi...TxTokenGW..." },
        resource: { type: "mcp.tool", id: "check_balance" },
      },
    },
    response: {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { decision: "PERMIT" },
    },
    rulesEvaluated: [
      {
        rule: "Subject token valid (user not revoked, not expired)",
        result: "PASS",
        detail: "sub=user_jane_doe; active=true; exp in future",
      },
      {
        rule: "Actor token valid (agent client active)",
        result: "PASS",
        detail: "act.sub=agent1-cc-client; client status=active",
      },
      {
        rule: "may_act claim lists this agent as permitted actor",
        result: "PASS",
        detail: "may_act.sub=agent1-cc-client matches act.sub",
      },
      {
        rule: "Resource indicator (aud) matches MCP gateway",
        result: "PASS",
        detail: "aud='mcp-gw'",
      },
      {
        rule: "Requested scope is subset of user's granted scopes",
        result: "PASS",
        detail:
          "requested=read; user granted=read write",
      },
      {
        rule: "High-value transaction threshold (>$500 requires step-up)",
        result: "N/A",
        detail: "tool=check_balance (read-only, non-monetary)",
      },
      {
        rule: "Tool-specific business rules (account ownership, consent)",
        result: "PASS",
        detail:
          "check_balance on user's own account; no consent gate triggered",
      },
    ],
    onError: [
      "PA returns DENY despite a valid token — check the act-claim policy attribute mapping in PA",
      "PA returns INDETERMINATE — required attributes missing in the decision context",
      "Decision context too large — trim what gateway sends to keep latency low",
    ],
  },
  // PA->>PID: Introspect TX token
  {
    step: 28,
    from: "PA",
    to: "PID",
    label: "Introspect TX token",
    type: "request",
    description: "TX Token Introspect",
    why: "PA verifies the new delegated token the same way it verified the agent token earlier. Introspection confirms the token is real, unrevoked, and exposes the act claim PA needs for policy.",
    request: {
      method: "POST",
      url: "https://auth.pingone.com/{ENV_ID}/as/introspect",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: "Basic {BASE64(PA_INTROSPECT_CLIENT_ID:SECRET)}",
      },
      body: "token=eyJhbGciOi...TxTokenGW...&token_type_hint=access_token",
    },
    response: {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: {
        active: true,
        sub: "user_jane_doe",
        aud: "mcp-gw",
        scope: "read",
        act: { sub: "agent1-cc-client" },
      },
    },
    onError: [
      "active:false — token revoked, possibly by an admin or user logout",
      "Slow PingOne response — consider local JWT validation with JWKS for steady-state perf",
      "act claim missing — PingOne didn't propagate it through exchange; policy will incorrectly run as if no agent",
    ],
  },
  // PID-->>PA: Token claims (sub, act, aud, scope)
  {
    step: 29,
    from: "PID",
    to: "PA",
    label: "Token claims (sub, act, aud, scope)",
    type: "response",
    description: "TX Token Claims",
    why: "PingOne returns the full claim set including the act delegation chain. Now PA can evaluate policy with full context — who acted on behalf of whom, with what scope, for what audience.",
    request: {
      frame: "introspect-claims-return",
      payload: { token_type_hint: "access_token" },
    },
    response: {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: {
        active: true,
        sub: "user_jane_doe",
        aud: "mcp-gw",
        scope: "read",
        act: { sub: "agent1-cc-client", client_id: "{PINGONE_AGENT_CLIENT_ID}" },
        iss: "https://auth.pingone.com/{ENV_ID}",
        iat: 1778000000,
        exp: 1778000600,
      },
    },
    onError: [
      "Audit logs show sub but not act — fix log emit to record the delegation chain",
      "act.sub doesn't match any known agent — possible token misuse; alert and deny",
    ],
  },
  // Note over PA: Validate: aud, scope: balance,<br/>tool call details vs. policy
  {
    type: "note",
    participants: ["PA"],
    text: "Validate: aud, scope: balance,\ntool call details vs. policy",
    description: "Validate policy",
    why: "PA enforces the full constraint set in one place: token audience matches the gateway, scope covers the requested action, agent is one of the allowed actors, and the tool itself is approved for this user. Centralized policy beats scattered per-service if-statements.",
    rulesEvaluated: [
      {
        rule: "Token aud matches gateway",
        result: "PASS",
        detail: "aud='mcp-gw'",
      },
      {
        rule: "Scope covers requested action",
        result: "PASS",
        detail: "scope='read' satisfies check_balance",
      },
      {
        rule: "Agent is in user's may_act allowlist",
        result: "PASS",
        detail: "may_act.sub=agent1-cc-client",
      },
      {
        rule: "Tool approved for this user",
        result: "PASS",
        detail: "user_jane_doe entitled to check_balance",
      },
    ],
    onError: [
      "Policy allows aud mismatch — fundamental authz bug; must always check aud",
      "Policy ignores scope — defeats the purpose of narrow tokens",
      "Policy doesn't constrain by tool — agent could call destructive tools with read-only scope",
    ],
  },
  // PA-->>AG: Permit
  {
    step: 30,
    from: "PA",
    to: "AG",
    label: "Permit",
    type: "response",
    description: "PERMIT",
    why: "Policy decision returns clean — the gateway can proceed. This PERMIT is the audit anchor: if anyone asks 'why was this allowed?', the policy trace can be replayed against the exact decision context.",
    request: {
      frame: "pa-decision-result",
      payload: { action: "tools/call", tool: "check_balance" },
    },
    response: {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { decision: "PERMIT", obligations: { log_audit_event: true } },
    },
    rulesEvaluated: [
      {
        rule: "All sub/act/aud/scope/may_act checks passed",
        result: "PASS",
        detail:
          "sub=user_jane_doe, act=agent1-cc-client, aud=mcp-gw, scope=read, may_act match",
      },
      {
        rule: "Transaction amount under high-value threshold OR step-up satisfied",
        result: "PASS",
        detail: "tool=check_balance (no monetary value); threshold N/A",
      },
      {
        rule: "No fraud/risk signals flagged on session",
        result: "PASS",
        detail: "risk_score=low; no anomaly flags on session_id",
      },
    ],
    onError: [
      "PERMIT returned but obligations dropped — gateway must enforce obligations (e.g., audit logging)",
      "Latency spike — first decision can be slow; warm the policy cache at startup",
    ],
  },
  // AG->>MCP: tools/call check_balance (JSON-RPC) with TX token (passthrough)
  {
    step: 33,
    from: "AG",
    to: "MCP",
    label: "tools/call check_balance (JSON-RPC) with TX token (passthrough)",
    type: "request",
    description: "Tool Call to MCP",
    why: "The gateway forwards the tool call to the MCP server with the original TX token unchanged — no RFC 8693 re-exchange on this hop. The TX token is audienced to the shared ping.demo resource URI, valid at both the gateway and the downstream MCP server. mTLS between gateway and MCP enforces that this token cannot be used to reach MCP directly from outside.",
    request: {
      method: "POST",
      url: "https://mcp.ping.demo:8080/mcp",
      headers: {
        Authorization: "Bearer eyJhbGciOi...TxToken...",
        "Content-Type": "application/json",
        "MCP-Protocol-Version": "2025-11-25",
      },
      body: {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "check_balance", arguments: {} },
      },
    },
    response: {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { jsonrpc: "2.0", id: 4, result: { balance: 2450.32 } },
    },
    onError: [
      "401 invalid_token — MCP rejected the TX token; verify shared audience URI between gateway and MCP",
      "WebSocket connection refused — MCP not up, or TLS chain broken on mcp.ping.demo",
      "Tool name not registered in MCP — BankingToolRegistry missing this tool",
    ],
  },
  // MCP->>RS: GET /balance (TX token forwarded unchanged from gateway)
  {
    step: 34,
    from: "MCP",
    to: "RS",
    label: "GET /balance (TX token — forwarded unchanged from gateway)",
    type: "request",
    description: "GET /balance",
    why: "The MCP Server calls the Banking API with the same TX token it received from the gateway. No second RFC 8693 exchange occurs — the token (aud=mcp-gw) is accepted directly by the Banking API. The delegation chain (sub=user, act=agent1) is visible end-to-end.",
    request: {
      method: "GET",
      url: "https://api.ping.demo:3001/api/accounts/balance",
      headers: {
        Authorization: "Bearer eyJhbGciOi...TxToken...",
        Accept: "application/json",
      },
    },
    response: {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { accountId: "acct_01ABC", balance: 2450.32, currency: "USD" },
    },
    onError: [
      "401 invalid_token — Banking API rejected token; verify shared audience (aud=mcp-gw) between gateway, MCP, and API",
      "403 insufficient_scope — token scope missing read",
      "404 — accountId not found for this sub; data layer mismatch with PingOne user id",
    ],
  },
  // RS->>PID: Introspect TX token (validate before returning data)
  {
    step: 37,
    from: "RS",
    to: "PID",
    label: "Introspect TX token (validate before returning data)",
    type: "request",
    description: "TX Token Introspect (Banking API)",
    why: "The Banking API verifies the TX token via introspection or local JWT validation against PingOne's JWKS. The API checks: active=true, aud=mcp-gw (matches), sub (the user), act (agent delegation), scope (read). The API never trusts a token without checking it.",
    request: {
      method: "POST",
      url: "https://auth.pingone.com/{ENV_ID}/as/introspect",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: "Basic {BASE64(RS_INTROSPECT_CLIENT_ID:SECRET)}",
      },
      body: "token=eyJhbGciOi...TxToken...&token_type_hint=access_token",
    },
    response: {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: {
        active: true,
        sub: "user_jane_doe",
        aud: "mcp-gw",
        scope: "read",
        act: { sub: "agent1-cc-client" },
      },
    },
    onError: [
      "Per-request introspection adds latency — prefer local JWT validation with cached JWKS",
      "JWKS cache stale during PingOne key rotation — refresh on signature mismatch",
      "Introspect endpoint rate-limited — back off and switch to local verification temporarily",
    ],
  },
  // PID-->>RS: Token claims (sub, act, aud, scope)
  {
    step: 38,
    from: "PID",
    to: "RS",
    label: "Token claims (sub, act, aud=mcp-gw, scope)",
    type: "response",
    description: "TX Token Claims",
    why: "PingOne returns the full claims so the Banking API can apply final checks: sub is a real user, scope is sufficient, aud=mcp-gw is accepted, and act identifies the delegating agent.",
    request: {
      frame: "introspect-claims-return",
      payload: { token_type_hint: "access_token" },
    },
    response: {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: {
        active: true,
        sub: "user_jane_doe",
        aud: "mcp-gw",
        scope: "read",
        act: { sub: "agent1-cc-client", client_id: "{PINGONE_AGENT_CLIENT_ID}" },
        iss: "https://auth.pingone.com/{ENV_ID}",
        iat: 1778000000,
        exp: 1778000600,
      },
    },
    onError: [
      "RS audit logs don't capture act — fix log emit so agent actions are attributable",
      "aud mismatch — ensure Banking API accepts aud=mcp-gw; configure in API token validation policy",
    ],
  },
  // Note over RS: Validate: aud=mcp-gw, scope: balance, act: agent1
  {
    type: "note",
    participants: ["RS"],
    text: "Validate: aud=mcp-gw,\nscope: balance, act: agent1",
    description: "Validate TX token at Banking API",
    why: "Last line of defense: the Banking API enforces aud, scope, and act. The token forwarded unchanged from the gateway is valid here because aud=mcp-gw is accepted at both the gateway and the downstream Banking API by design.",
    onError: [
      "Skipping aud check at the API — tokens from other audiences would work; always validate aud",
      "Not checking act — agent attribution lost; can't tell user from agent in audit",
      "Wildcard scope check — defeats narrow scoping; require exact match",
    ],
  },
  // RS-->>MCP: Balance data
  {
    step: 39,
    from: "RS",
    to: "MCP",
    label: "Balance data",
    type: "response",
    description: "Balance Data",
    why: "Resource server returns only the data this token is allowed to see. The data leaves the secure boundary already filtered to the user — MCP can pass it on without re-checking permissions.",
    request: {
      frame: "rs-data-response",
      payload: { resource: "balance" },
    },
    response: {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: {
        accountId: "acct_01ABC",
        balance: 2450.32,
        currency: "USD",
        recentTransactions: [
          { date: "2026-05-09", description: "Starbucks", amount: -5.42 },
          {
            date: "2026-05-07",
            description: "Employer Payroll",
            amount: 2500.0,
          },
        ],
      },
    },
    onError: [
      "RS leaks fields not in scope — review serializer to honor scope-driven field masking",
      "PII included where not needed — apply data minimization for agent calls",
    ],
  },
  // MCP-->>AG: Tool result
  {
    step: 40,
    from: "MCP",
    to: "AG",
    label: "Tool result",
    type: "response",
    description: "Tool Result (MCP → GW)",
    why: "MCP wraps the data in the standard tool-result envelope and returns it to the gateway. From here on it's pure data transit — no more auth decisions.",
    request: {
      frame: "tool-result",
      payload: { tool: "check_balance", request_id: 4 },
    },
    response: {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: {
        jsonrpc: "2.0",
        id: 4,
        result: {
          content: [{ type: "text", text: "Balance: $2,450.32" }],
          structuredContent: { balance: 2450.32, currency: "USD" },
        },
      },
    },
    onError: [
      "Result not in MCP envelope format — gateway can't forward; agent will fail to parse",
      "Result too large — paginate or summarize; otherwise WS frame size issues",
    ],
  },
  // AG-->>A: Tool result
  {
    step: 41,
    from: "AG",
    to: "A",
    label: "Tool result",
    type: "response",
    description: "Tool Result (GW → Agent)",
    why: "Gateway relays the tool result back to the agent service. The agent now has structured data to give to the LLM so it can phrase a human-friendly answer.",
    request: {
      frame: "tool-result-forward",
      payload: { request_id: 3 },
    },
    response: {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: {
        jsonrpc: "2.0",
        id: 3,
        result: {
          content: [{ type: "text", text: "Balance: $2,450.32" }],
          structuredContent: { balance: 2450.32, currency: "USD" },
        },
      },
    },
    onError: [
      "Gateway drops part of the result (truncation) — bump WS frame and HTTP body limits",
      "Multiple in-flight tool calls confused — make sure JSON-RPC id is correlated correctly",
    ],
  },
  // A->>LLM: Tool result + context
  {
    step: 42,
    from: "A",
    to: "LLM",
    label: "Tool result + context",
    type: "request",
    description: "LLM Context",
    why: "The agent feeds the structured tool result back to the LLM along with the original prompt. The model's job now is to turn raw numbers and transaction rows into something a human will understand.",
    request: {
      method: "POST",
      url: "https://api.anthropic.com/v1/messages",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": "{ANTHROPIC_API_KEY}",
        "anthropic-version": "2023-06-01",
      },
      body: {
        model: "claude-opus-4-7",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content:
              "What is my current account balance and recent transactions?",
          },
          {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "tool_use_01ABC",
                name: "check_balance",
                input: {},
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "tool_use_01ABC",
                content:
                  '{"balance":2450.32,"currency":"USD","recentTransactions":[...]}',
              },
            ],
          },
        ],
      },
    },
    response: {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { id: "msg_02XYZ", stop_reason: "end_turn" },
    },
    onError: [
      "Tool result too large for the model's context — summarize or chunk before sending",
      "LLM model deprecated mid-conversation — pin a specific model id and update deliberately",
      "Provider outage — fall back to a templated response so the user still sees their balance",
    ],
  },
  // LLM-->>A: Natural language response
  {
    step: 43,
    from: "LLM",
    to: "A",
    label: "Natural language response",
    type: "response",
    description: "Natural Language Response",
    why: "The model returns a friendly, plain-English summary of the user's balance and transactions. This is what makes a chatbot feel like a chatbot rather than a database query tool.",
    request: {
      frame: "llm-text-response",
      payload: { msg_id: "msg_02XYZ" },
    },
    response: {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: {
        content: [
          {
            type: "text",
            text: "Your checking account balance is $2,450.32. Recent transactions: Purchase at Starbucks ($5.42), Direct deposit from employer ($2,500.00).",
          },
        ],
        stop_reason: "end_turn",
      },
    },
    onError: [
      "Model hallucinates a balance not in the tool result — strict prompt + post-check against the structured data",
      "Reply omits the actual answer the user asked for — tune the system prompt to always include numbers from tool results",
      "PII echoed verbatim in ways the user didn't ask for — apply output filtering",
    ],
  },
  // A-->>CB: Response
  {
    step: 44,
    from: "A",
    to: "CB",
    label: "Response",
    type: "response",
    description: "Agent → Chatbot",
    why: "The agent service hands the rendered answer back to the chatbot. From the chatbot's perspective, the whole token dance just looked like 'asked agent, got answer'.",
    request: {
      frame: "agent-response",
      payload: { agentRequestId: "agent_req_01HXYZ..." },
    },
    response: {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: {
        status: "complete",
        message:
          "Your checking account balance is $2,450.32. Recent transactions: Purchase at Starbucks ($5.42), Direct deposit from employer ($2,500.00).",
        conversationId: "conv_01HXYZ...",
      },
    },
    onError: [
      "Chatbot loses the agentRequestId mapping — response gets dropped; ensure idempotency keys",
      "Long-running response not streamed — UX feels frozen; switch to SSE/WS streaming if available",
    ],
  },
  // Note over CB,U: Chatbot shows AI response:<br/>"Your checking account balance is $2,450.32.<br/>Recent transactions: Purchase at Starbucks ($5.42),<br/>Direct deposit from employer ($2,500.00)..."
  {
    type: "note",
    participants: ["CB", "U"],
    text: 'Chatbot shows AI response:\n"Your checking account balance is $2,450.32.\nRecent transactions: Purchase at Starbucks ($5.42),\nDirect deposit from employer ($2,500.00)..."',
    description: "Chatbot shows AI response",
    why: "The point of the entire flow: the user gets a useful, accurate, plain-English answer to their question. Behind that one sentence are one RFC 8693 exchange (at the BFF), two inline authorization checks per tool call (introspect + policy), and a token that flows unchanged from the BFF through the gateway to the Banking API — all invisible to them.",
    onError: [
      "User sees a generic 'I can help with that' instead of actual numbers — the tool path silently fell back to no-op",
      "Old conversation content leaks in — make sure conversation history is properly scoped per session",
    ],
  },
  // CB-->>U: Display in chatbot interface
  {
    step: 45,
    from: "CB",
    to: "U",
    label: "Display in chatbot interface",
    type: "response",
    description: "Display in Chatbot",
    why: "The chatbot UI renders the agent's response in the conversation thread. From the user's point of view, the entire OAuth + token-exchange flow just happened in a couple of seconds.",
    request: {
      frame: "ui-render",
      payload: { conversationId: "conv_01HXYZ..." },
    },
    response: {
      status: 200,
      headers: { "Content-Type": "text/html" },
      body: {
        rendered:
          "<div class='msg agent'>Your checking account balance is $2,450.32...</div>",
      },
    },
    onError: [
      "XSS risk if the response is rendered as raw HTML — always escape model output",
      "Markdown not rendered — tables/lists from the model look like raw asterisks; pipe through a renderer",
    ],
  },
  // CB-->>WA: Response + context
  {
    step: 46,
    from: "CB",
    to: "WA",
    label: "Response + context",
    type: "response",
    description: "Sync to Web App",
    why: "Some demos keep the chatbot pane and the main web app dashboard in sync, so an answer in the chatbot also updates the dashboard's balance widget. This shows OAuth-bound data flowing into multiple UIs at once.",
    request: {
      method: "POST",
      url: "https://demo-api-server:3001/api/dashboard/sync",
      headers: {
        "Content-Type": "application/json",
        Cookie: "connect.sid=s%3A{SESSION_ID}.{SIG}",
      },
      body: {
        conversationId: "conv_01HXYZ...",
        update: { type: "balance", accountId: "acct_01ABC", balance: 2450.32 },
      },
    },
    response: {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { synced: true },
    },
    onError: [
      "Dashboard sync uses cached stale data — invalidate after every tool call that mutates state",
      "Sync runs without checking session — could update the wrong user's dashboard",
    ],
  },
  // WA-->>U: Also sync to dashboard/full UI
  {
    step: 47,
    from: "WA",
    to: "U",
    label: "Also sync to dashboard/full UI",
    type: "response",
    description: "Dashboard Update",
    why: "The web app pushes the updated balance to the dashboard UI (often via WebSocket or SSE). The user sees both the chatbot answer and the dashboard widget update together — proof the data is one consistent source.",
    request: {
      frame: "ws-push",
      payload: { channel: "dashboard:{USER_ID}" },
    },
    response: {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: {
        event: "balance.updated",
        accountId: "acct_01ABC",
        balance: 2450.32,
        timestamp: "2026-05-10T12:34:56Z",
      },
    },
    onError: [
      "WebSocket to the browser disconnected — fall back to polling so the UI eventually catches up",
      "Pushed event includes more data than the scoped token permitted — re-derive what to push from the tool result",
    ],
  },
  // Note over U: User can view in both<br/>chatbot interface and main dashboard
  {
    type: "note",
    participants: ["U"],
    text: "User can view in both\nchatbot interface and main dashboard",
    description: "User can view in both",
    why: "End of flow. The user got their answer in the chatbot and saw their dashboard update, all without ever seeing or handling a token, and with every backend hop independently audited and authorized.",
    onError: [
      "Two views show inconsistent numbers — likely a caching mismatch between chatbot and dashboard",
      "User unsure which surface to trust — agree on a single source of truth (the resource server) and propagate from there",
    ],
  },
];

const SCENARIOS = {
  "full-flow": ALL_STEPS,
  "agent-init": ALL_STEPS.filter((s) => s.step && s.step <= 10),
  "no-subject-token": ALL_STEPS.filter(
    (s) => s.step && s.step >= 11 && s.step <= 18,
  ),
  "obtain-subject": ALL_STEPS.filter(
    (s) => s.step && s.step >= 19 && s.step <= 23,
  ),
  "token-exchanges": ALL_STEPS.filter(
    (s) =>
      s.step &&
      ([24, 25, 34, 35].includes(s.step) ||
        (s.step >= 26 && s.step <= 30)),
  ),
  "full-auth": ALL_STEPS.filter((s) => s.step && s.step >= 26 && s.step <= 30),
  "data-return": ALL_STEPS.filter(
    (s) => s.step && s.step >= 36 && s.step <= 47,
  ),

  // Phase 266 R2: 3 credential-path scenarios (gateway divergence branches)
  "api-key-path": [
    {
      type: "note",
      participants: ["U", "CB"],
      text: "API-KEY PATH: scope gate + credential swap\nGateway calls banking_api_resource_server",
      description:
        "Path A: the gateway verifies mortgage:read, swaps the OAuth bearer for a service API key, and calls banking_api_resource_server :8082.",
      why: "Demonstrates credential swap pattern: the user token never reaches the backend; only the API key + X-User-Sub are forwarded.",
    },
    {
      type: "arrow",
      from: "U",
      to: "CB",
      label: "User: 'show mortgage data'",
      description:
        "User triggers the api_key demo prompt via natural language.",
      token: {
        type: "NL prompt",
        credentialPath: "api_key",
        tool: "show_mortgage",
      },
    },
    {
      type: "arrow",
      from: "CB",
      to: "AG",
      label: "tools/call show_mortgage (OAuth bearer)",
      description:
        "Agent forwards the tool call to the MCP gateway with the user OAuth bearer.",
      token: { type: "OAuth Bearer (inbound)", credentialPath: "oauth_bearer" },
    },
    {
      type: "note",
      participants: ["AG"],
      text: "API-KEY PATH: enforce mortgage:read\nGateway drops bearer, attaches X-API-Key + X-User-Sub\ncredentialPath = api_key",
      description:
        "The gateway recognizes show_mortgage as an api_key-disposition tool, enforces mortgage:read on the user bearer (local scope gate, before swap), then drops the OAuth bearer and injects X-API-Key + X-User-Sub. No RFC 8693 exchange on this path.",
      why: "API-KEY PATH distinguishes this from oauth_bearer (RFC 8693 exchange) and dual_token (id_token forward). The scope gate is the consent step before the credential swap.",
    },
    {
      type: "note",
      participants: ["AG"],
      text: "GET banking_api_resource_server :8082 /mortgage\nX-API-Key + X-User-Sub (no user token)",
      description:
        "The gateway calls banking_api_resource_server with the service API key and X-User-Sub. The backend validates the API key (constant-time compare) and returns the mortgage record.",
      why: "The backend never sees the user's OAuth token — possession of the API key is the trust boundary (demo-grade).",
    },
    {
      type: "arrow",
      from: "AG",
      to: "CB",
      label: "Mortgage record + _meta.maskedApiKey",
      description:
        "Gateway returns the mortgage payload with the masked API key (last-4). The SPA routes to /path/mortgage with the payload.",
      token: {
        type: "Mortgage payload",
        credentialPath: "api_key",
        destination: "/path/mortgage",
      },
    },
  ],

  "dual-token-path": [
    {
      type: "note",
      participants: ["U", "CB"],
      text: "DUAL-TOKEN PATH: /api/resource-server/identity\nbearer validated + id_token decoded server-side",
      description:
        "Path B: gateway forwards the OAuth bearer AND id_token to banking_resource_server /identity.",
      why: "Demonstrates dual-credential forwarding: access token proves authorization; id_token provides identity claims. Both decoded server-side — no raw JWT crosses any boundary.",
    },
    {
      type: "arrow",
      from: "U",
      to: "CB",
      label: "User: 'show my profile card'",
      description: "User triggers the dual_token demo prompt.",
      token: {
        type: "NL prompt",
        credentialPath: "dual_token",
        tool: "user_profile_card",
      },
    },
    {
      type: "arrow",
      from: "CB",
      to: "AG",
      label: "tools/call user_profile_card (OAuth bearer)",
      description: "Agent forwards tool call with user OAuth bearer (inbound).",
      token: { type: "OAuth Bearer (inbound)", credentialPath: "oauth_bearer" },
    },
    {
      type: "note",
      participants: ["AG"],
      text: "DUAL-TOKEN PATH: /api/resource-server/identity\nGateway fetches id_token from BFF session\nForwards: bearer (Authorization header) + id_token (params.idToken body)",
      description:
        "Gateway performs a server-to-server call to BFF /internal/id-token to retrieve the id_token, then POSTs both to banking_resource_server /identity in a JSON-RPC envelope.",
      why: "id_token lives only in the BFF session (OIDC Core §3.1.3.7). The SPA never sees the raw JWT.",
    },
    {
      type: "arrow",
      from: "AG",
      to: "RS",
      label: "POST /api/resource-server/identity (Bearer + id_token)",
      description:
        "Gateway sends JSON-RPC envelope to banking_resource_server /identity. Bearer in Authorization header; id_token in params.idToken.",
      token: {
        type: "Bearer + id_token",
        credentialPath: "dual_token",
        route: "/api/resource-server/identity",
      },
    },
    {
      type: "note",
      participants: ["RS"],
      text: "banking_resource_server validates bearer (RFC 6750)\ndecodes id_token server-side (OIDC Core)\nreturns claims only — no raw JWT",
      description:
        "authenticateToken middleware validates the access token signature/exp/aud. id_token sub is verified against bearer sub. Claims decoded server-side via decodeJwtClaims. scrubRawJwts walker applied before response.",
      why: "Token custody rule: raw JWTs never cross the server boundary. Only sanitized claims are returned.",
    },
    {
      type: "arrow",
      from: "RS",
      to: "CB",
      label: "200 OK: accessTokenClaims + idTokenClaims",
      description:
        "banking_resource_server returns decoded claims only. SPA routes to /path/dualtoken-info.",
      token: {
        type: "Claims response (identity)",
        credentialPath: "dual_token",
        destination: "/path/dualtoken-info",
      },
    },
  ],

  "oauth-bearer-path": [
    {
      type: "note",
      participants: ["U", "CB"],
      text: "OAUTH BEARER PATH: /api/resource-server/accounts | /transactions\nRFC 8693 exchange + LMDB-backed banking data",
      description:
        "Path C: gateway performs RFC 8693 token exchange, then forwards the backend-scoped bearer to banking_resource_server /accounts or /transactions.",
      why: "Demonstrates the standard OAuth 2.0 resource-server pattern: RFC 8693 narrows audience to banking_resource_server; bank data served from LMDB seeded at boot.",
    },
    {
      type: "arrow",
      from: "U",
      to: "CB",
      label: "User: 'show my accounts'",
      description: "User triggers the oauth_bearer banking-data prompt.",
      token: {
        type: "NL prompt",
        credentialPath: "oauth_bearer",
        tool: "demo_show_accounts",
      },
    },
    {
      type: "arrow",
      from: "CB",
      to: "AG",
      label: "tools/call demo_show_accounts (OAuth bearer)",
      description: "Agent forwards tool call with user OAuth bearer.",
      token: { type: "OAuth Bearer (inbound)", credentialPath: "oauth_bearer" },
    },
    {
      type: "note",
      participants: ["AG", "PID"],
      text: "OAUTH BEARER PATH: RFC 8693 token exchange\naud narrowed to banking_resource_server (RFC 8707)\nact chain preserved",
      description:
        "RFC 8693 token exchange: subject_token = user bearer; audience = banking_resource_server resource URI (RFC 8707). Resulting token has aud=banking_resource_server and act claim for audit trail.",
      why: "RFC 8693 §3: the inbound user bearer (aud=AI-agent-resource) is rejected by the RS per RFC 6750/8707. Exchange is mandatory.",
    },
    {
      type: "arrow",
      from: "AG",
      to: "RS",
      label: "GET /api/resource-server/accounts (exchanged Bearer)",
      description:
        "Gateway forwards the backend-scoped bearer to banking_resource_server /accounts (or /transactions).",
      token: {
        type: "Exchanged Bearer",
        credentialPath: "oauth_bearer",
        route: "/api/resource-server/accounts",
        aud: "banking_resource_server",
      },
    },
    {
      type: "note",
      participants: ["RS"],
      text: "banking_resource_server validates bearer (RFC 6750)\nqueries LMDB\nreturns accounts/transactions",
      description:
        "authenticateToken validates the exchanged bearer. bankingDb.getAccountsByUserId queries LMDB seeded from data/store.js at first BFF boot.",
      why: "LMDB persistence: bank data survives BFF restarts; idempotent seed from in-memory store on first boot.",
    },
    {
      type: "arrow",
      from: "RS",
      to: "CB",
      label: "200 OK: accounts (LMDB-backed)",
      description:
        "banking_resource_server returns accounts or transactions. ResourceServerPage renders with OAUTH BEARER PATH badge.",
      token: {
        type: "Banking data response",
        credentialPath: "oauth_bearer",
        data_source: "banking-resource-server.db",
      },
    },
  ],
};

// ─── Mermaid source ────────────────────────────────────────────────────────

/**
 * mermaidFromSteps — emit a Mermaid `sequenceDiagram` from this page's own
 * PARTICIPANTS + ALL_STEPS arrays, so the "Generated from steps" view exactly
 * matches what the page renders. ALL_STEPS is maintained 1:1 with
 * i4ai-ref-arch.mmd (see the header comment on ALL_STEPS), so this generated
 * source should track the canonical .mmd closely; showing both side by side
 * lets a viewer confirm that.
 *
 * Multi-line labels use Mermaid's <br/> convention; we map literal "\n" in the
 * step label to <br/>. Notes become `Note over A,B:` lines.
 */
function mermaidFromSteps() {
  const lines = ["sequenceDiagram", "    autonumber"];
  for (const p of PARTICIPANTS) {
    const keyword = p.id === "U" ? "actor" : "participant";
    lines.push(`    ${keyword} ${p.id} as ${p.label}`);
  }
  lines.push("");
  for (const s of ALL_STEPS) {
    if (s.type === "note") {
      const span = (s.participants || []).join(",");
      const text = String(s.text || "").replace(/\n/g, "<br/>");
      lines.push(`    Note over ${span}: ${text}`);
      continue;
    }
    const arrow = s.type === "response" ? "-->>" : "->>";
    const label = String(s.label || s.description || "").replace(
      /\n/g,
      "<br/>",
    );
    lines.push(`    ${s.from}${arrow}${s.to}: ${label}`);
  }
  return lines.join("\n");
}

/**
 * MermaidSourceModal — overlay showing the Mermaid source two ways:
 *  - "Canonical (i4ai-ref-arch.mmd)": the repo-root source that also renders
 *    token-flow.png; fetched as a static asset from /architecture/ (no admin
 *    route — keeps /sequence-diagram anon-safe per REGRESSION_PLAN).
 *  - "Generated from this page's steps": emitted from ALL_STEPS at runtime so
 *    it always matches what's drawn here.
 * Each view has a Copy button.
 */
function MermaidSourceModal({ onClose }) {
  const [tab, setTab] = useState("canonical");
  const [canonical, setCanonical] = useState(null);
  const [canonicalErr, setCanonicalErr] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/architecture/i4ai-ref-arch.mmd")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((t) => {
        if (alive) setCanonical(t);
      })
      .catch((e) => {
        if (alive) setCanonicalErr(e.message);
      });
    return () => {
      alive = false;
    };
  }, []);

  const generated = mermaidFromSteps();
  const shown =
    tab === "canonical" ? (canonical ?? canonicalErr ?? "Loading…") : generated;

  const copy = () => {
    navigator.clipboard?.writeText(shown).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Mermaid source"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: "2rem",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 10,
          maxWidth: 900,
          width: "100%",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 20px 50px rgba(0,0,0,0.35)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            padding: "0.85rem 1rem",
            borderBottom: "1px solid #e2e8f0",
          }}
        >
          <strong style={{ fontSize: "0.95rem", color: "#0f172a" }}>
            Mermaid source
          </strong>
          <button
            type="button"
            onClick={() => setTab("canonical")}
            style={mermaidTabStyle(tab === "canonical")}
          >
            Canonical (i4ai-ref-arch.mmd)
          </button>
          <button
            type="button"
            onClick={() => setTab("generated")}
            style={mermaidTabStyle(tab === "generated")}
          >
            Generated from this page
          </button>
          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={copy}
            style={{
              padding: "0.35rem 0.7rem",
              borderRadius: 5,
              border: "1px solid #cbd5e1",
              background: "#fff",
              color: "#0f172a",
              fontSize: "0.8rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              padding: "0.35rem 0.6rem",
              borderRadius: 5,
              border: "1px solid #cbd5e1",
              background: "#fff",
              color: "#0f172a",
              fontSize: "0.8rem",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </div>
        <div
          style={{
            padding: "0.5rem 0.75rem 0.25rem",
            fontSize: "0.75rem",
            color: "#475569",
            lineHeight: 1.5,
          }}
        >
          {tab === "canonical"
            ? "The repo-root sequenceDiagram source that also renders token-flow.png. This page is maintained 1:1 with it."
            : "Emitted live from this page's step data — paste into mermaid.live to render."}
        </div>
        <pre
          style={{
            margin: 0,
            overflow: "auto",
            padding: "0.75rem 1rem 1rem",
            fontSize: "0.74rem",
            lineHeight: 1.5,
            fontFamily: "ui-monospace, Menlo, Consolas, monospace",
            color: "#0f172a",
            background: "#f8fafc",
            whiteSpace: "pre",
            flex: 1,
          }}
        >
          {shown}
        </pre>
      </div>
    </div>
  );
}

function mermaidTabStyle(active) {
  return {
    padding: "0.35rem 0.7rem",
    borderRadius: 5,
    border: active ? "2px solid #004687" : "1px solid #cbd5e1",
    background: active ? "#dbeafe" : "#fff",
    color: active ? "#004687" : "#475569",
    fontSize: "0.78rem",
    fontWeight: 600,
    cursor: "pointer",
  };
}

// ─── Main Component ────────────────────────────────────────────────────────

export default function SequenceDiagramPage() {
  const [showMermaid, setShowMermaid] = useState(false);
  const [selectedScenario, setSelectedScenario] = useState("full-flow");
  const [authScenario, setAuthScenario] = useState("authenticated"); // 'authenticated' or 'not-authenticated'

  const [isSimulating, setIsSimulating] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentStepIdx, setCurrentStepIdx] = useState(-1);
  const [stepMs, setStepMs] = useState(DEFAULT_STEP_MS);
  const { size: leftPanelWidth, handleProps: leftPanelHandleProps } = useDividerDrag({
    min: 240,
    max: 500,
    initial: 280,
  });
  const [zoomLevel, setZoomLevel] = useState(100); // zoom percentage
  const diagramRef = useRef(null);
  const pausedStepIdx = useRef(-1);
  const simTimeouts = useRef([]);

  // Filter steps based on authentication scenario
  let scenarioSteps = SCENARIOS[selectedScenario] || ALL_STEPS;
  const steps =
    authScenario === "not-authenticated"
      ? scenarioSteps // Show all steps including 18a-18d
      : scenarioSteps.filter(
          (s) => !["18a", "18b", "18c", "18d"].includes(String(s.step)),
        ); // Hide auth steps if already authenticated

  const activeStep = currentStepIdx >= 0 ? steps[currentStepIdx] : null;

  const applyStep = useCallback((idx) => {
    setCurrentStepIdx(idx);
  }, []);

  const resetDiagram = useCallback(() => {
    setCurrentStepIdx(-1);
    setIsPaused(false);
    pausedStepIdx.current = -1;
  }, []);

  const scheduleSteps = useCallback(
    (startIdx) => {
      simTimeouts.current.forEach(clearTimeout);
      simTimeouts.current = [];
      steps.slice(startIdx).forEach((_, offset) => {
        const i = startIdx + offset;
        const t = setTimeout(
          () => {
            applyStep(i);
            if (i === steps.length - 1) {
              const done = setTimeout(() => {
                resetDiagram();
                setIsSimulating(false);
              }, 4000);
              simTimeouts.current.push(done);
            }
          },
          (offset + (startIdx === 0 ? 0 : 1)) * stepMs,
        );
        simTimeouts.current.push(t);
      });
    },
    [steps, applyStep, resetDiagram, stepMs],
  );

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
    if (next >= steps.length) {
      resetDiagram();
      setIsSimulating(false);
      return;
    }
    applyStep(next);
    pausedStepIdx.current = next;
  }, [isPaused, steps.length, applyStep, resetDiagram]);

  const handleStepClick = useCallback(
    (idx) => {
      if (!isPaused) return;
      applyStep(idx);
      pausedStepIdx.current = idx;
    },
    [isPaused, applyStep],
  );

  const stopSim = useCallback(() => {
    simTimeouts.current.forEach(clearTimeout);
    simTimeouts.current = [];
    resetDiagram();
    setIsSimulating(false);
  }, [resetDiagram]);

  const participantIndex = (id) => PARTICIPANTS.findIndex((p) => p.id === id);

  const handleZoom = (delta) => {
    setZoomLevel((prev) => Math.max(50, Math.min(200, prev + delta)));
  };

  const handleResetZoom = () => {
    setZoomLevel(100);
  };

  return (
    <div style={{ padding: "1rem", background: "#fff", display: "flex", flexDirection: "column", height: "100%" }}>
      {showMermaid && (
        <MermaidSourceModal onClose={() => setShowMermaid(false)} />
      )}
      {/* Toolbar */}
      <div
        style={{
          marginBottom: "1rem",
          display: "flex",
          alignItems: "center",
          gap: "1rem",
          flexWrap: "wrap",
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: "1.1rem",
            fontWeight: 700,
            color: "#1e293b",
          }}
        >
          Sequence Diagram — i4ai Token Exchange Flow
        </h2>
        <button
          type="button"
          onClick={() => setShowMermaid(true)}
          style={{
            padding: "0.4rem 0.8rem",
            borderRadius: 6,
            fontSize: "0.78rem",
            fontWeight: 600,
            border: "1px solid #cbd5e1",
            background: "#fff",
            color: "#1e293b",
            cursor: "pointer",
          }}
        >
          View Mermaid source
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <label
            htmlFor="scenario-select"
            style={{
              fontSize: "0.75rem",
              fontWeight: 600,
              color: "#475569",
              whiteSpace: "nowrap",
            }}
          >
            Scenario:
          </label>
          <select
            id="scenario-select"
            value={selectedScenario}
            onChange={(e) => setSelectedScenario(e.target.value)}
            disabled={isSimulating}
            style={{
              fontSize: "0.78rem",
              padding: "4px 8px",
              borderRadius: 6,
              border: "1px solid #cbd5e1",
              background: "#fff",
              color: "#1e293b",
              cursor: isSimulating ? "not-allowed" : "pointer",
            }}
          >
            <option value="full-flow">Full Flow</option>
            <option value="agent-init">
              Agent Init (CC Token + Tool List)
            </option>
            <option value="no-subject-token">No Subject Token (DENY)</option>
            <option value="obtain-subject">Obtain Subject Token</option>
            <option value="token-exchanges">RFC 8693 Exchanges</option>
            <option value="full-auth">Full Auth (tools/call + PA)</option>
            <option value="data-return">Data Return (RS → Results)</option>
            <option value="api-key-path">API-Key Path (Path A)</option>
            <option value="dual-token-path">Dual-Token Path (Path B)</option>
            <option value="oauth-bearer-path">
              OAuth Bearer Path (Path C)
            </option>
          </select>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            borderLeft: "1px solid #e2e8f0",
            paddingLeft: "1rem",
            marginLeft: "0.5rem",
          }}
        >
          <div
            style={{
              fontSize: "0.75rem",
              fontWeight: 600,
              color: "#475569",
              whiteSpace: "nowrap",
            }}
          >
            Authentication:
          </div>
          <button
            type="button"
            onClick={() => setAuthScenario("authenticated")}
            disabled={isSimulating}
            style={{
              padding: "0.4rem 0.8rem",
              borderRadius: 6,
              fontSize: "0.78rem",
              fontWeight: 600,
              border:
                authScenario === "authenticated"
                  ? "2px solid #004687"
                  : "1px solid #cbd5e1",
              background: authScenario === "authenticated" ? "#dbeafe" : "#fff",
              color: authScenario === "authenticated" ? "#004687" : "#475569",
              cursor: isSimulating ? "not-allowed" : "pointer",
            }}
          >
            User Already Authenticated
          </button>
          <button
            type="button"
            onClick={() => setAuthScenario("not-authenticated")}
            disabled={isSimulating}
            style={{
              padding: "0.4rem 0.8rem",
              borderRadius: 6,
              fontSize: "0.78rem",
              fontWeight: 600,
              border:
                authScenario === "not-authenticated"
                  ? "2px solid #004687"
                  : "1px solid #cbd5e1",
              background:
                authScenario === "not-authenticated" ? "#dbeafe" : "#fff",
              color:
                authScenario === "not-authenticated" ? "#004687" : "#475569",
              cursor: isSimulating ? "not-allowed" : "pointer",
            }}
          >
            User NOT Authenticated
          </button>
        </div>
        <DiagramControls
          zoom={zoomLevel / 100}
          onZoomIn={() => handleZoom(10)}
          onZoomOut={() => handleZoom(-10)}
          onZoomReset={handleResetZoom}
          zoomMin={0.5}
          zoomMax={2.0}
          currentStep={currentStepIdx + 1}
          totalSteps={steps.length}
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
        />
      </div>

      {/* Downloads of the canonical sequence source. No .drawio for sequence
          diagrams — paste the .mmd into Lucid's Mermaid diagram-as-code editor
          (sequenceDiagram is supported) or draw.io's Insert > Advanced > Mermaid. */}
      <DiagramExportBar
        items={[
          { label: "Mermaid (.mmd)", href: "/architecture/i4ai-ref-arch.mmd" },
          { label: "PNG", href: "/architecture/token-flow.png" },
        ]}
      />

      {/* Diagram + Left Panel Flex Row */}
      <div
        style={{
          display: "flex",
          gap: 0,
          border: "1px solid #e2e8f0",
          borderRadius: 8,
          background: "#f8fafc",
          flex: 1,
          minHeight: 0,
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Left Step Panel */}
        <div style={{ position: "relative" }}>
          <StepInfoPanel
            activeStep={activeStep}
            currentStepIdx={currentStepIdx}
            steps={steps}
            isPaused={isPaused}
            onStepClick={handleStepClick}
            panelWidth={leftPanelWidth}
          />
          {/* Resize Handle */}
          <button
            type="button"
            {...leftPanelHandleProps}
            style={{
              position: "absolute",
              right: 0,
              top: 0,
              bottom: 0,
              width: "6px",
              background: "#cbd5e1",
              cursor: "col-resize",
              border: "none",
              padding: 0,
              transition: "background 0.2s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "#94a3b8";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "#cbd5e1";
            }}
            aria-label="Resize panel"
          />
        </div>

        {/* Right Diagram Area */}
        <div
          style={{
            flex: 1,
            padding: "2rem 1rem",
            overflowY: "auto",
            overflowX: "auto",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* SVG Diagram with Zoom — zoom controls are in the toolbar above */}
          <div
            style={{
              transform: `scale(${zoomLevel / 100})`,
              transformOrigin: "top left",
              transition: "transform 0.15s ease-out",
            }}
          >
            <svg
              ref={diagramRef}
              width="100%"
              style={{
                display: "block",
                minHeight: `${120 + steps.length * 20 + 100}px`,
              }}
              aria-label="Sequence diagram flow"
              role="img"
            >
              <title>Sequence diagram flow</title>
              {/* Participant boxes and lifelines */}
              {PARTICIPANTS.map((p, i) => {
                const x = 100 + i * 120;
                // Split long labels into multiple lines (max 12 chars per line for wrap)
                const words = p.label.split(" ");
                const lines = [];
                let currentLine = "";
                words.forEach((word) => {
                  if ((currentLine + word).length > 12) {
                    if (currentLine) lines.push(currentLine.trim());
                    currentLine = word;
                  } else {
                    currentLine += (currentLine ? " " : "") + word;
                  }
                });
                if (currentLine) lines.push(currentLine.trim());

                return (
                  <g key={p.id}>
                    {/* Participant box — size adjusts for text height */}
                    <rect
                      x={x - 50}
                      y="20"
                      width="100"
                      height={20 + lines.length * 16}
                      fill="#f1f5f9"
                      stroke="#cbd5e1"
                      strokeWidth="1"
                      rx="4"
                    />
                    {/* Wrapped text */}
                    {lines.map((line, idx) => (
                      <text
                        key={`${p.id}-line-${idx}`}
                        x={x}
                        y={40 + idx * 16}
                        textAnchor="middle"
                        fontSize="11"
                        fontWeight="600"
                        fill="#0f172a"
                      >
                        {line}
                      </text>
                    ))}
                    {/* Lifeline */}
                    <line
                      x1={x}
                      y1={20 + lines.length * 16 + 10}
                      x2={x}
                      y2={120 + steps.length * 20 + 50}
                      stroke="#cbd5e1"
                      strokeDasharray="4"
                      strokeWidth="1"
                    />
                  </g>
                );
              })}

              {/* Steps */}
              {steps.map((step, idx) => {
                const isActive = idx === currentStepIdx;
                const isPast = idx < currentStepIdx;
                const y = 120 + idx * 20;
                if (step.type === "note") {
                  // Render note as amber callout band spanning participant columns
                  const partIndexes = step.participants
                    .map(participantIndex)
                    .filter((i) => i >= 0);
                  if (partIndexes.length === 0) return null;
                  const minX = 100 + Math.min(...partIndexes) * 120 - 40;
                  const maxX = 100 + Math.max(...partIndexes) * 120 + 40;
                  // Use a stable key for notes: text + participants
                  const noteKey = `note-${step.text.replace(/\W+/g, "-")}-${step.participants.join("-")}`;
                  return (
                    <g key={noteKey}>
                      <rect
                        x={minX}
                        y={y - 13}
                        width={maxX - minX}
                        height={26}
                        rx={6}
                        fill="#fef9c3"
                        stroke="#d97706"
                        strokeWidth="1.5"
                      />
                      <text
                        x={(minX + maxX) / 2}
                        y={y + 4}
                        textAnchor="middle"
                        fontSize="11"
                        fill="#451a03"
                        fontWeight="700"
                      >
                        {step.text}
                      </text>
                    </g>
                  );
                }
                // Arrow step
                const fromX = 100 + participantIndex(step.from) * 120;
                const toX = 100 + participantIndex(step.to) * 120;
                const minX = Math.min(fromX, toX);
                const maxX = Math.max(fromX, toX);
                // Use a stable key for arrows: step number + from + to
                const arrowKey = step.step
                  ? `arrow-${step.step}-${step.from}-${step.to}`
                  : `arrow-${idx}`;
                return (
                  <g key={arrowKey}>
                    {/* Arrow */}
                    <line
                      x1={fromX}
                      y1={y}
                      x2={toX}
                      y2={y}
                      stroke={isActive ? "#004687" : "#cbd5e1"}
                      strokeWidth={isActive ? 3 : 1.5}
                      markerEnd={
                        isActive
                          ? step.type === "response"
                            ? "url(#markerDashedActive)"
                            : "url(#markerSolidActive)"
                          : step.type === "response"
                            ? "url(#markerDashed)"
                            : "url(#markerSolid)"
                      }
                      opacity={isPast ? 0.35 : 1}
                    />
                    {/* Label */}
                    <text
                      x={(minX + maxX) / 2}
                      y={y - 3}
                      textAnchor="middle"
                      fontSize="10"
                      fill={
                        isActive ? "#004687" : isPast ? "#94a3b8" : "#0f172a"
                      }
                      fontWeight={isActive ? 700 : 400}
                    >
                      {step.step ? `${step.step}. ` : ""}
                      {step.label}
                    </text>
                  </g>
                );
              })}

              {/* Arrow markers — idle and active variants */}
              <defs>
                <marker id="markerSolid" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
                  <path d="M0,0 L0,6 L9,3 z" fill="#475569" />
                </marker>
                <marker id="markerDashed" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
                  <path d="M0,0 L0,6 L9,3 z" fill="#475569" />
                </marker>
                <marker id="markerSolidActive" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
                  <path d="M0,0 L0,6 L9,3 z" fill="#004687" />
                </marker>
                <marker id="markerDashedActive" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
                  <path d="M0,0 L0,6 L9,3 z" fill="#004687" />
                </marker>
              </defs>
            </svg>
          </div>
        </div>
      </div>

      {/* Token card */}
      {activeStep && (
        <div
          style={{
            marginTop: "1rem",
            padding: "1rem",
            background: "#f8fafc",
            borderRadius: 8,
            border: "1px solid #e2e8f0",
          }}
        >
          <OneFlowCard token={activeStep.token} />
        </div>
      )}

      <p style={{ marginTop: "0.4rem", fontSize: "0.7rem", color: "#94a3b8" }}>
        Hit <strong>▶ Simulate</strong> then <strong>⏸ Pause</strong> at any
        step to read the token card.
      </p>
    </div>
  );
}
