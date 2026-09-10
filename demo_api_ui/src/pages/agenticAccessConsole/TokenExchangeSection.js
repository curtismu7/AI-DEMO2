import React, { useState } from "react";
import apiClient from "../../services/apiClient";

/** Minimal base64url decode — no library needed for one JWT payload. */
function decodeJwtPayload(token) {
  const part = token.split(".")[1];
  if (!part) return null;
  const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(part.length + ((4 - (part.length % 4)) % 4), "=");
  try {
    return JSON.parse(atob(b64));
  } catch {
    return null;
  }
}

const AGENT_MCP_STEPS = [
  "User sign-in (authorization_code / PKCE).",
  "Agent gets an actor client_credentials token — aud=AGENT_GATEWAY_AUDIENCE.",
  "Exchange #1: grant=token-exchange, exchanger=the agent, mints an Agent Exchanged Token — aud=AI_AGENT_INTERMEDIATE_AUDIENCE.",
  "Exchange #2: grant=token-exchange, exchanger=banking-mcp-gateway, mints the Final Token — aud=oauth-mcp.",
];

const AGENT_MCP_FINAL_TOKEN = `{
  "iss": "https://auth.pingone.com/{envId}/as",
  "sub": "<user>",
  "aud": "oauth-mcp",
  "scope": "accounts:read transfer",
  "act": {
    "sub": "banking-mcp-gateway",
    "act": { "sub": "openai-agent-svc" }
  }
}`;

const A2A_STEPS = [
  "User sign-in (authorization_code / PKCE).",
  "Exchange #1: exchanger=banking-assistant-agent, mints T_agent1 — aud=a2a-intermediate.",
  "Exchange #2: exchanger=investment-advisor-agent, mints T_invest — aud=investment-gateway.",
];

const A2A_FINAL_TOKEN = `{
  "sub": "<user>",
  "aud": "investment-gateway",
  "scope": "invest:read",
  "act": {
    "sub": "investment-advisor-agent",
    "act": { "sub": "banking-assistant-agent" }
  }
}`;

const RFC8693_REQUEST = `{
  "grant_type": "urn:ietf:params:oauth:grant-type:token-exchange",
  "subject_token": "eyJhbGciOi...",
  "subject_token_type": "urn:ietf:params:oauth:token-type:id_token",
  "requested_token_type": "urn:ietf:params:oauth:token-type:access_token",
  "audience": "demo-resource-server"
}`;

const TABS = [
  { id: "agentMcp", label: "Agent → MCP tool" },
  { id: "a2a", label: "A2A delegation (UC2)" },
];

export default function TokenExchangeSection() {
  const [tab, setTab] = useState("agentMcp");
  const steps = tab === "agentMcp" ? AGENT_MCP_STEPS : A2A_STEPS;
  const finalToken = tab === "agentMcp" ? AGENT_MCP_FINAL_TOKEN : A2A_FINAL_TOKEN;

  const [liveResult, setLiveResult] = useState(null);
  const [liveError, setLiveError] = useState(null);
  const [liveLoading, setLiveLoading] = useState(false);

  const runLiveExchange = async () => {
    setLiveLoading(true);
    setLiveError(null);
    setLiveResult(null);
    try {
      const { data } = await apiClient.post("/api/demo/rfc8693/token", {
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        subject_token: "demo-subject-id-token",
        subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
        requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
        audience: "demo-resource-server",
      });
      const claims = decodeJwtPayload(data.access_token);
      setLiveResult({ response: data, claims });
    } catch (err) {
      setLiveError(err?.response?.data?.error_description || err.message || "Request failed");
    } finally {
      setLiveLoading(false);
    }
  };

  return (
    <div>
      <p className="aac-section-intro">
        RFC 8693 token exchange chains a nested <code>act</code> claim for every
        hop: each exchanger adds itself under the previous actor rather than
        replacing the subject, so the final token still carries the whole chain.
      </p>

      <p className="aac-card-sub" style={{ marginBottom: 4 }}>
        Chain shape <span className="aac-badge aac-badge--neutral">Illustrative</span> — pick which delegation pattern to walk through:
      </p>
      <div className="aac-tabs-inline">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`aac-tab${tab === t.id ? " aac-tab--active" : ""}`}
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
          >
            {t.label}
          </button>
        ))}
      </div>

      <ol className="aac-step-list">
        {steps.map((s, i) => (
          <li key={i} className="aac-step">
            <span className="aac-step-num">{i + 1}</span>
            <span className="aac-step-body">{s}</span>
          </li>
        ))}
      </ol>

      <div className="aac-section-block">
        <h3>Decoded final token <span className="aac-badge aac-badge--neutral">Illustrative</span></h3>
        <p className="aac-card-sub" style={{ marginBottom: 8 }}>
          What this chain's Final Token looks like in a real deployment — fictional
          identities, shown to illustrate the nested <code>act</code> shape.
        </p>
        <pre className="aac-prompt-block">{finalToken}</pre>
      </div>

      <div className="aac-section-block">
        <h3>Try a real exchange <span className="aac-badge aac-badge--live">Live</span></h3>
        <p className="aac-card-sub" style={{ marginBottom: 8 }}>
          <code>demo_api_server/routes/rfc8693Demo.js</code> — a self-contained
          mock exchange (no PingOne dependency, one hop only) that mints a real
          JWT. It doesn't replicate the multi-hop chain above; it demonstrates
          the same RFC 8693 request/response shape with something you can
          actually run.
        </p>
        <p className="aac-card-sub" style={{ marginBottom: 8 }}>Request this button sends</p>
        <pre className="aac-prompt-block">{RFC8693_REQUEST}</pre>
        <button type="button" className="aac-filter-btn" style={{ marginTop: 10 }} onClick={runLiveExchange} disabled={liveLoading}>
          {liveLoading ? "Exchanging…" : "Send it — POST /api/demo/rfc8693/token"}
        </button>
        {liveError && (
          <p className="aac-card-sub" style={{ marginTop: 8, color: "var(--th-status-error-text)" }}>
            {liveError}
          </p>
        )}
        {liveResult && (
          <>
            <p className="aac-card-sub" style={{ margin: "12px 0 8px" }}>Real response, just now</p>
            <pre className="aac-prompt-block">{JSON.stringify(liveResult.response, null, 2)}</pre>
            {liveResult.claims && (
              <>
                <p className="aac-card-sub" style={{ margin: "10px 0 8px" }}>Decoded claims (client-side base64url, from the real token above)</p>
                <pre className="aac-prompt-block">{JSON.stringify(liveResult.claims, null, 2)}</pre>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
