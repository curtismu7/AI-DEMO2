import React, { useState } from "react";

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

const RFC8693_CLAIMS = `{
  "iss": "demo-rfc8693-exchanger",
  "sub": "demo-user",
  "aud": "demo-resource-server",
  "act": { "sub": "demo-agent" }
}`;

const TABS = [
  { id: "agentMcp", label: "Agent → MCP tool" },
  { id: "a2a", label: "A2A delegation (UC2)" },
];

export default function TokenExchangeSection() {
  const [tab, setTab] = useState("agentMcp");
  const steps = tab === "agentMcp" ? AGENT_MCP_STEPS : A2A_STEPS;
  const finalToken = tab === "agentMcp" ? AGENT_MCP_FINAL_TOKEN : A2A_FINAL_TOKEN;

  return (
    <div>
      <p className="aac-section-intro">
        RFC 8693 token exchange chains a nested <code>act</code> claim for every
        hop: each exchanger adds itself under the previous actor rather than
        replacing the subject, so the final token still carries the whole chain.
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
        <h3>Decoded final token</h3>
        <pre className="aac-prompt-block">{finalToken}</pre>
      </div>

      <div className="aac-section-block">
        <h3>Minimal real example — <code>demo_api_server/routes/rfc8693Demo.js</code></h3>
        <p className="aac-card-sub" style={{ marginBottom: 8 }}>Request</p>
        <pre className="aac-prompt-block">{RFC8693_REQUEST}</pre>
        <p className="aac-card-sub" style={{ margin: "10px 0 8px" }}>Minted claims</p>
        <pre className="aac-prompt-block">{RFC8693_CLAIMS}</pre>
      </div>
    </div>
  );
}
