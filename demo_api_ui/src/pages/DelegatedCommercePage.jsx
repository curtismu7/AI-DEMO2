import React from "react";
import useDividerDrag from "../hooks/useDividerDrag";
import "./DelegatedCommercePage.css";
import apiClient from "../services/apiClient";
import { callMcpTool } from "../services/demoAgentService";
import TokenChainTraceRail from "../components/TokenChainTraceRail";
import DraggableModal from "../components/DraggableModal";
import { useAgentUiMode } from "../context/AgentUiModeContext";
import { notifyError, notifySuccess } from "../utils/appToast";
import { startRoleSwitch } from "../utils/roleSwitch";

const CLAIM_CODE_KEY = "delegated-commerce-claim-code";

const STEPS = [
  { title: "Register + consent", detail: "Create a new agent app, bind it, and choose scopes." },
  { title: "Protected MCP call", detail: "Run list_orders with the delegated token." },
  { title: "Human approval", detail: "Checkout crosses policy and waits for CIBA." },
  { title: "Self-service revoke", detail: "Revoke, retry, and prove immediate denial." },
];

function parseToolResult(result) {
  const text = result?.content?.[0]?.text;
  if (!text) return result;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function AvailabilityBadge({ children, tone = "ga" }) {
  return <span className={`dc-badge dc-badge--${tone}`}>{children}</span>;
}

function ConsentModal({ open, scopes, onScopesChange, onClose, onConfirm, busy }) {
  const toggle = (scope) => {
    onScopesChange(
      scopes.includes(scope)
        ? scopes.filter((item) => item !== scope)
        : [...scopes, scope],
    );
  };
  return (
    <DraggableModal
      isOpen={open}
      onClose={onClose}
      title="Authorize A&F Personal Shopping Agent"
      storageKey="delegated-commerce-consent"
      defaultWidth={560}
      defaultHeight={500}
      footer={
        <div className="dc-modal-actions">
          <button className="dc-btn dc-btn--secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="dc-btn"
            type="button"
            onClick={onConfirm}
            disabled={busy || scopes.length === 0}
          >
            {busy ? "Authorizing..." : "Authorize selected scopes"}
          </button>
        </div>
      }
    >
      <p className="dc-modal-copy">
        This agent can act only within the permissions selected below. Sensitive
        purchases still require human approval.
      </p>
      <label className="dc-scope">
        <input
          type="checkbox"
          checked={scopes.includes("read")}
          onChange={() => toggle("read")}
        />
        <span><strong>Read my orders</strong><small>Allows list_orders using the read scope.</small></span>
      </label>
      <label className="dc-scope">
        <input
          type="checkbox"
          checked={scopes.includes("write")}
          onChange={() => toggle("write")}
        />
        <span><strong>Place purchases</strong><small>Allows checkout using the write scope; policy approval still applies.</small></span>
      </label>
    </DraggableModal>
  );
}

export default function DelegatedCommercePage({ user }) {
  const { size: seqWidth, handleProps: seqHandleProps } = useDividerDrag({
    min: 220,
    max: 420,
    initial: 250,
    storageKey: "dcp-sequence-width",
  });
  const { size: proofWidth, handleProps: proofHandleProps } = useDividerDrag({
    min: 310,
    max: 520,
    initial: 350,
    storageKey: "dcp-proof-width",
    invert: true, // proof rail sits right of its divider
  });
  const { setSurfaceHostEl } = useAgentUiMode();
  const [agentHostEl, setAgentHostEl] = React.useState(null);
  const agentHostRef = React.useCallback((node) => setAgentHostEl(node), []);
  const isAdmin = user?.role === "admin" || user?.isAdmin === true;

  const [activeStep, setActiveStep] = React.useState(0);
  const [completed, setCompleted] = React.useState([]);
  const [busy, setBusy] = React.useState("");
  const [registration, setRegistration] = React.useState(null);
  const [claimCode, setClaimCode] = React.useState(
    () => window.sessionStorage.getItem(CLAIM_CODE_KEY) || "",
  );
  const [scopes, setScopes] = React.useState(["read", "write"]);
  const [consentOpen, setConsentOpen] = React.useState(false);
  const [evidence, setEvidence] = React.useState({});
  const [result, setResult] = React.useState("");
  const [ciba, setCiba] = React.useState(null);
  const pollTimerRef = React.useRef(null);

  React.useEffect(() => {
    setSurfaceHostEl(agentHostEl);
    return () => setSurfaceHostEl((current) => (current === agentHostEl ? null : current));
  }, [agentHostEl, setSurfaceHostEl]);

  React.useEffect(() => {
    Promise.all([
      apiClient.post("/api/verticals/active", { id: "retail" }),
      apiClient.get("/api/delegated-commerce/status"),
    ])
      .then(([, status]) => {
        if (status.data?.registration) {
          setRegistration(status.data.registration);
          setScopes(status.data.scopes || []);
          if (status.data.authorized) setCompleted([0]);
        }
      })
      .catch(() => {});
  }, []);

  React.useEffect(() => () => window.clearTimeout(pollTimerRef.current), []);

  const markComplete = React.useCallback((step) => {
    setCompleted((current) => [...new Set([...current, step])]);
    setActiveStep((current) => Math.min(3, Math.max(current, step + 1)));
  }, []);

  const registerAgent = async () => {
    setBusy("register");
    try {
      const response = await apiClient.post("/api/delegated-commerce/register", {
        name: "A&F Personal Shopping Agent",
      });
      const data = response.data;
      setRegistration(data.registration);
      setClaimCode(data.claimCode);
      window.sessionStorage.setItem(CLAIM_CODE_KEY, data.claimCode);
      setEvidence((current) => ({ ...current, registration: data.actorToken }));
      notifySuccess("Agent application created and verified in PingOne.");
    } catch (err) {
      notifyError(err.response?.data?.message || err.message || "Registration failed.");
    } finally {
      setBusy("");
    }
  };

  const claimAgent = async () => {
    setBusy("claim");
    try {
      const response = await apiClient.post("/api/delegated-commerce/claim", { claimCode });
      setRegistration(response.data.registration);
      setConsentOpen(true);
    } catch (err) {
      notifyError(err.response?.data?.message || err.message || "Claim failed.");
    } finally {
      setBusy("");
    }
  };

  const authorizeAgent = async () => {
    setBusy("consent");
    try {
      const response = await apiClient.post("/api/delegated-commerce/consent", { scopes });
      setRegistration(response.data.registration);
      setEvidence((current) => ({
        ...current,
        consent: {
          delegationId: response.data.delegationId,
          scopes: response.data.registration.scopes,
        },
      }));
      setConsentOpen(false);
      window.sessionStorage.removeItem(CLAIM_CODE_KEY);
      markComplete(0);
      notifySuccess("Scoped consent is active.");
    } catch (err) {
      notifyError(err.response?.data?.message || err.message || "Consent failed.");
    } finally {
      setBusy("");
    }
  };

  const callOrders = async () => {
    setBusy("orders");
    setResult("");
    try {
      const response = await callMcpTool("list_orders", {}, { vertical: "retail" });
      if (response.result?.error) {
        throw new Error(response.result.error_description || response.result.message || response.result.error);
      }
      const parsed = parseToolResult(response.result);
      setResult(JSON.stringify(parsed, null, 2));
      const exchanged = response.tokenEvents?.find((event) =>
        ["two-ex-final-token", "mcp-access-token"].includes(event.id),
      );
      setEvidence((current) => ({ ...current, exchange: exchanged || { status: "completed" } }));
      markComplete(1);
    } catch (err) {
      setResult(err.message || "Protected MCP call failed.");
      notifyError(err.message || "Protected MCP call failed.");
    } finally {
      setBusy("");
    }
  };

  const postCheckout = React.useCallback(async () => {
    try {
      const response = await callMcpTool(
        "checkout",
        { product: "Headphones", amount: 600 },
        { vertical: "retail", useCaseId: "ciba-out-of-band-approval" },
      );
      const error = response.result?.error;
      if (error) return { ok: false, error, message: response.result.error_description || response.result.message };
      return { ok: true, response };
    } catch (err) {
      return {
        ok: false,
        error: err.code || err.response?.data?.error,
        message: err.message,
        status: err.statusCode || err.response?.status,
      };
    }
  }, []);

  const pollCiba = React.useCallback((authReqId, intervalMs) => {
    pollTimerRef.current = window.setTimeout(async () => {
      try {
        const response = await apiClient.get(`/api/auth/ciba/poll/${authReqId}`);
        setCiba((current) => ({ ...current, ...response.data }));
        if (response.data.status === "approved") {
          const retry = await postCheckout();
          if (!retry.ok) throw new Error(retry.message || retry.error || "Checkout retry failed.");
          setResult("Checkout completed after human approval.");
          markComplete(2);
          setBusy("");
          return;
        }
        pollCiba(authReqId, intervalMs);
      } catch (err) {
        setBusy("");
        notifyError(err.response?.data?.message || err.message || "Approval polling failed.");
      }
    }, intervalMs);
  }, [markComplete, postCheckout]);

  const checkout = async () => {
    setBusy("checkout");
    setResult("");
    const initial = await postCheckout();
    const gated = initial.status === 428 || [
      "mcp_step_up_required",
      "mcp_hitl_required",
      "step_up_required",
      "hitl_required",
    ].includes(initial.error);
    if (!gated) {
      if (initial.ok) {
        setResult("Checkout completed without a human gate; verify the active policy threshold.");
      } else {
        notifyError(initial.message || initial.error || "Checkout failed.");
      }
      setBusy("");
      return;
    }
    try {
      const response = await apiClient.post("/api/auth/ciba/initiate", {
        binding_message: "Approve your $600 headphones purchase",
        amount: 600,
        tool: "checkout",
      });
      const request = response.data;
      setCiba({ ...request, status: "pending" });
      setEvidence((current) => ({
        ...current,
        approval: { requestId: request.auth_req_id, engine: request.engine },
      }));
      pollCiba(request.auth_req_id, Math.max(1000, (request.interval || 5) * 1000));
    } catch (err) {
      setBusy("");
      notifyError(err.response?.data?.message || err.message || "Could not start approval.");
    }
  };

  const revoke = async () => {
    setBusy("revoke");
    try {
      const response = await apiClient.post("/api/delegated-commerce/revoke", {
        reason: "Customer ended shopping-agent access",
      });
      let retry;
      let denied = false;
      try {
        const retryResponse = await callMcpTool("list_orders", {}, { vertical: "retail" });
        if (retryResponse.result?.error) {
          denied = true;
          retry = `Confirmed denied: ${
            retryResponse.result.error_description ||
            retryResponse.result.message ||
            retryResponse.result.error
          }`;
        } else {
          retry = "Unexpected: the protected call still succeeded.";
        }
      } catch (err) {
        denied = true;
        retry = `Confirmed denied: ${err.code || err.message}`;
      }
      setEvidence((current) => ({
        ...current,
        revocation: { auditId: response.data.auditId, retry },
      }));
      setResult(retry);
      setRegistration(response.data.registration);
      if (denied) {
        markComplete(3);
      } else {
        notifyError(retry);
      }
    } catch (err) {
      notifyError(err.response?.data?.message || err.message || "Revocation failed.");
    } finally {
      setBusy("");
    }
  };

  const preflight = async () => {
    setBusy("preflight");
    try {
      const [status, cibaStatus] = await Promise.all([
        apiClient.get("/api/delegated-commerce/status"),
        apiClient.get("/api/auth/ciba/status"),
      ]);
      setEvidence((current) => ({
        ...current,
        preflight: {
          session: user?.email || user?.username || "authenticated",
          registration: status.data.registration?.status || "not claimed",
          ciba: cibaStatus.data.engine,
          failoverMode: cibaStatus.data.failoverMode,
        },
      }));
      notifySuccess("Preflight checks completed.");
    } catch (err) {
      notifyError(err.message || "Preflight failed.");
    } finally {
      setBusy("");
    }
  };

  const runCurrent = () => {
    if (activeStep === 0) {
      if (isAdmin && !registration) return registerAgent();
      if (!isAdmin && !registration) return claimAgent();
      if (!isAdmin && registration?.status !== "active") return setConsentOpen(true);
      return undefined;
    }
    if (activeStep === 1) return callOrders();
    if (activeStep === 2) return checkout();
    return revoke();
  };

  const reset = () => {
    window.sessionStorage.removeItem(CLAIM_CODE_KEY);
    setActiveStep(0);
    setCompleted([]);
    setResult("");
    setCiba(null);
    setEvidence({});
  };

  return (
    <main className="dc-page">
      <section className="dc-hero">
        <div>
          <div className="dc-eyebrow">Agentic AI / Delegated-Agent Commerce</div>
          <h1>Register. Delegate. Approve. Revoke.</h1>
          <p>A single guided workspace for proving the complete delegated-agent lifecycle.</p>
        </div>
        <div className="dc-actions">
          <button className="dc-btn dc-btn--secondary" type="button" onClick={preflight} disabled={!!busy}>Run preflight</button>
          <button className="dc-btn dc-btn--secondary" type="button" onClick={reset}>Reset view</button>
          <button className="dc-btn" type="button" onClick={runCurrent} disabled={!!busy}>{busy ? "Running..." : "Run current step"}</button>
        </div>
      </section>

      <section className="dc-truth">
        <strong>Demo truth</strong>
        <AvailabilityBadge>GA building blocks</AvailabilityBadge>
        <span>OAuth app, scopes, token exchange, protected API, revocation</span>
        <AvailabilityBadge tone="pattern">Demo pattern</AvailabilityBadge>
        <span>AI-agent registration profile</span>
        <AvailabilityBadge tone={ciba?.engine === "simulated" ? "simulated" : "live"}>
          {ciba?.engine === "simulated" ? "Simulated execution" : "Live execution"}
        </AvailabilityBadge>
      </section>

      <div
        className="dc-layout"
        style={{ "--dcp-seq-w": `${seqWidth}px`, "--dcp-proof-w": `${proofWidth}px` }}
      >
        <aside className="dc-card dc-sequence">
          <div className="dc-card-head"><h2>Guided sequence</h2><span>{completed.length} of 4</span></div>
          {STEPS.map((step, index) => (
            <button
              type="button"
              key={step.title}
              className={`dc-step ${activeStep === index ? "dc-step--active" : ""} ${completed.includes(index) ? "dc-step--done" : ""}`}
              onClick={() => setActiveStep(index)}
            >
              <span className="dc-step-number">{completed.includes(index) ? "✓" : index + 1}</span>
              <span><strong>{step.title}</strong><small>{step.detail}</small></span>
            </button>
          ))}
          <div className="dc-persona">
            <strong>Current persona: {isAdmin ? "Administrator" : "Customer"}</strong>
            <button
              type="button"
              className="dc-link-button"
              onClick={() => startRoleSwitch(isAdmin ? "customer" : "admin", "/delegated-commerce")}
            >
              Switch to {isAdmin ? "customer" : "administrator"}
            </button>
          </div>
        </aside>

        <div className="divider-drag-handle" aria-label="Resize sequence rail" {...seqHandleProps} />

        <section className="dc-card dc-workspace">
          <div className="dc-card-head">
            <h2>Step {activeStep + 1} workspace</h2>
            <span>{completed.includes(activeStep) ? "Complete" : "Ready"}</span>
          </div>

          {activeStep === 0 && (
            <div className="dc-workspace-body">
              <div className="dc-title-row">
                <div><h2>Create and authorize a new shopping agent</h2><p>The client secret remains server-side.</p></div>
                <div><AvailabilityBadge>GA building blocks</AvailabilityBadge> <AvailabilityBadge tone="live">Live</AvailabilityBadge></div>
              </div>
              <div className="dc-note"><strong>Availability note:</strong> This creates a standard PingOne OAuth/OIDC application representing an agent. A dedicated AI-agent registry is presented as a demo pattern.</div>
              {isAdmin ? (
                <div className="dc-subcard">
                  <h3>1A. Register the agent application</h3>
                  <label>Agent display name<input value="A&F Personal Shopping Agent" readOnly /></label>
                  <button className="dc-btn" type="button" onClick={registerAgent} disabled={busy === "register" || !!registration}>
                    {registration ? "Agent created" : "Create in PingOne"}
                  </button>
                  {registration && (
                    <div className="dc-safe-result">
                      <strong>Agent application created and verified</strong>
                      <dl><dt>client_id</dt><dd>{registration.applicationId}</dd><dt>claim code</dt><dd>{claimCode}</dd><dt>secret</dt><dd>Held server-side; never returned</dd></dl>
                    </div>
                  )}
                </div>
              ) : (
                <div className="dc-subcard">
                  <h3>1B. Claim and authorize the agent</h3>
                  {!registration && (
                    <>
                      <p className="dc-claim-code-help">
                        The administrator receives this one-time code after completing 1A. Ask them to create the agent and share the displayed code before claiming it.
                      </p>
                      <label>One-time agent claim code<input value={claimCode} onChange={(event) => setClaimCode(event.target.value)} /></label>
                      <button className="dc-btn" type="button" onClick={claimAgent} disabled={!claimCode || busy === "claim"}>Claim agent</button>
                    </>
                  )}
                  {registration && registration.status !== "active" && (
                    <button className="dc-btn" type="button" onClick={() => setConsentOpen(true)}>Review scoped consent</button>
                  )}
                  {registration?.status === "active" && <div className="dc-safe-result"><strong>Scoped consent active</strong><p>{registration.scopes.join(", ")}</p></div>}
                </div>
              )}
            </div>
          )}

          {activeStep === 1 && (
            <div className="dc-workspace-body">
              <div className="dc-title-row"><div><h2>Call a protected MCP tool</h2><p>Run list_orders through RFC 8693 and PingOne Authorize.</p></div><AvailabilityBadge tone="live">Live</AvailabilityBadge></div>
              <button className="dc-btn" type="button" onClick={callOrders} disabled={!!busy}>Call list_orders as agent</button>
              {result && <pre className="dc-result">{result}</pre>}
            </div>
          )}

          {activeStep === 2 && (
            <div className="dc-workspace-body">
              <div className="dc-title-row"><div><h2>Require human approval</h2><p>A $600 checkout crosses the configured policy threshold.</p></div><AvailabilityBadge tone={ciba?.engine === "simulated" ? "simulated" : "live"}>{ciba?.engine === "simulated" ? "Simulated" : "Live"}</AvailabilityBadge></div>
              <button className="dc-btn" type="button" onClick={checkout} disabled={!!busy}>Checkout $600 headphones</button>
              {ciba && (
                <div className="dc-safe-result">
                  <strong>Approval {ciba.status}</strong>
                  <p>Engine: {ciba.engine} | Request: {ciba.auth_req_id}</p>
                  {ciba.status === "pending" && ciba.auth_req_id && (
                    <a href={`/ciba-approve?authReqId=${encodeURIComponent(ciba.auth_req_id)}`} target="_blank" rel="noreferrer">Open human approval page</a>
                  )}
                </div>
              )}
              {result && <p className="dc-status">{result}</p>}
            </div>
          )}

          {activeStep === 3 && (
            <div className="dc-workspace-body">
              <div className="dc-title-row"><div><h2>Revoke delegated access</h2><p>The customer ends consent, then the page retries list_orders.</p></div><AvailabilityBadge tone="live">Live</AvailabilityBadge></div>
              <button className="dc-btn dc-btn--danger" type="button" onClick={revoke} disabled={!!busy || registration?.status === "revoked"}>{registration?.status === "revoked" ? "Revoked" : "Revoke agent access"}</button>
              {result && <p className="dc-status">{result}</p>}
              {evidence.revocation?.auditId && <a href={`/audit?agentId=${registration.applicationId}`}>View audit evidence</a>}
            </div>
          )}
        </section>

        <div className="divider-drag-handle" aria-label="Resize proof rail" {...proofHandleProps} />

        <aside className="dc-proof">
          <div className="dc-card dc-agent-card">
            <div className="dc-card-head"><h2>Agent + proof</h2><span>Connected</span></div>
            <div className="dc-agent-host" ref={agentHostRef} />
          </div>
          <div className="dc-card dc-proof-card">
            <h3>Live token and policy chain</h3>
            <div className={evidence.registration ? "dc-proof-item dc-proof-item--active" : "dc-proof-item"}><strong>Agent registration</strong><small>{evidence.registration ? evidence.registration.clientId : "Waiting for a new PingOne client."}</small></div>
            <div className={evidence.consent ? "dc-proof-item dc-proof-item--active" : "dc-proof-item"}><strong>User consent</strong><small>{evidence.consent ? evidence.consent.scopes.join(", ") : "Waiting for scope selection."}</small></div>
            <div className={evidence.exchange ? "dc-proof-item dc-proof-item--active" : "dc-proof-item"}><strong>RFC 8693 exchange</strong><small>{evidence.exchange ? "Subject and actor evidence captured." : "Will prove subject + actor."}</small></div>
            <div className={evidence.approval ? "dc-proof-item dc-proof-item--active" : "dc-proof-item"}><strong>Human approval</strong><small>{evidence.approval ? `${evidence.approval.engine}: ${evidence.approval.requestId}` : "Execution mode shown explicitly."}</small></div>
            <div className={evidence.revocation ? "dc-proof-item dc-proof-item--active" : "dc-proof-item"}><strong>Revocation proof</strong><small>{evidence.revocation?.retry || "Retry and audit close the lifecycle."}</small></div>
          </div>
          <div className="dc-card dc-trace"><TokenChainTraceRail /></div>
        </aside>
      </div>

      <ConsentModal
        open={consentOpen}
        scopes={scopes}
        onScopesChange={setScopes}
        onClose={() => setConsentOpen(false)}
        onConfirm={authorizeAgent}
        busy={busy === "consent"}
      />
    </main>
  );
}
