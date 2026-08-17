// ResourceServerCheckpointPage.jsx — teaching page for the Kong-mock final
// checkpoint at the resource server: pick what the agent attempts and see the
// AAM sideband legs (request decision / response redaction) that PingOne
// Authorize evaluates before banking data is touched. UI mock — panes show
// canned payloads matching the sideband contract pinned in
// demo_authz_server/routes/sideband.js; not wired to the live stack.
import React, { useState } from "react";
import "./ResourceServerCheckpointPage.css";

const FLOW_STEPS = [
  { id: "agent", label: "agent" },
  { id: "mcp", label: "mcp server · step-9 token" },
  { id: "inbound", label: "1. sideband request" },
  { id: "decision", label: "P1AZ decision" },
  { id: "handler", label: "handler + data" },
  { id: "outbound", label: "2. sideband response" },
  { id: "reply", label: "reply to agent" },
];

const SCENARIOS = {
  balance: {
    button: "Check balance",
    buttonSub: "get_account_balance · scope read",
    verdict: "permit",
    title: "Request allowed through to banking data",
    sub: "Audience + scope satisfied; no custom policy objects.",
    steps: { inbound: "on", decision: "ok", handler: "ok", outbound: "on", reply: "ok" },
    request: `{
  "source_ip": "172.19.0.7",
  "method": "GET",
  "url": "https://api.ping.demo:3001/api/accounts/my/balance",
  "http_version": "1.1",
  "headers": [
    { "authorization": "Bearer eyJ…step9" },
    { "x-agent-sub": "ai-agent-olb" },
    { "x-mcp-tool": "get_account_balance" }
  ]
}
// token inside: aud=banking RS · scope=read · act.sub=ai-agent-olb`,
    decision: `{
  "url": "https://api.ping.demo:3001/api/accounts/my/balance",
  "http_version": "1.1"
}
// no "response" field — that IS the permit`,
    note: 'Contract quirk worth teaching: PERMIT is the "response" field being absent. Present = deny, and "response_code" is a string.',
    replyTitle: "What the agent finally receives",
    reply: `HTTP/1.1 200 OK
{
  "account": "Everyday Checking",
  "balance": "$4,982.17"
}`,
  },
  transfer: {
    button: "Transfer $8,500",
    buttonSub: "transfer_funds · over agent ceiling",
    verdict: "deny",
    title: "Blocked: agent transfer ceiling is $5,000",
    sub: "Custom policy read amount 8500 from the request body. Handler never ran.",
    steps: { inbound: "on", decision: "on", handler: "dead", outbound: "dead", reply: "on" },
    request: `{
  "source_ip": "172.19.0.7",
  "method": "POST",
  "url": "https://api.ping.demo:3001/api/transactions/transfer",
  "http_version": "1.1",
  "headers": [
    { "authorization": "Bearer eyJ…step9" },
    { "x-mcp-tool": "transfer_funds" }
  ],
  "body": "{\\"amount\\":8500,\\"to\\":\\"ACCT-2231\\"}"
}
// token inside: scope=write · act.sub=ai-agent-olb`,
    decision: `{
  "response": {
    "response_code": "403",
    "headers": [ { "content-type": "application/json" } ],
    "body": "{\\"error\\":\\"transfer_ceiling_exceeded\\",
             \\"detail\\":\\"Agent transfers are capped at $5,000.
             Ask the account owner to approve or raise the limit.\\"}"
  }
}`,
    note: "The deny is a complete response authored by policy. The resource server relays it byte-for-byte — no banking code wrote this error.",
    replyTitle: "What the agent finally receives — P1AZ's words, relayed verbatim",
    reply: `HTTP/1.1 403 Forbidden
{
  "error": "transfer_ceiling_exceeded",
  "detail": "Agent transfers are capped at $5,000. Ask the account owner to approve or raise the limit."
}`,
  },
  sensitive: {
    button: "Sensitive details",
    buttonSub: "missing scope sensitive:read",
    verdict: "deny",
    title: "Blocked: token lacks scope sensitive:read",
    sub: "Built-in scope rule on the operation — no custom policy needed.",
    steps: { inbound: "on", decision: "on", handler: "dead", outbound: "dead", reply: "on" },
    request: `{
  "source_ip": "172.19.0.7",
  "method": "GET",
  "url": "https://api.ping.demo:3001/api/accounts/my/details",
  "http_version": "1.1",
  "headers": [
    { "authorization": "Bearer eyJ…step9" },
    { "x-mcp-tool": "get_sensitive_account_details" }
  ]
}
// token inside: scope=read — sensitive:read missing`,
    decision: `{
  "response": {
    "response_code": "403",
    "headers": [ { "content-type": "application/json" } ],
    "body": "{\\"error\\":\\"insufficient_scope\\",\\"scope\\":\\"sensitive:read\\"}"
  }
}`,
    note: "The MCP server narrows scopes per tool before step-9 — so this deny proves the whole chain: the tool never asked for sensitive:read, and the last hop held the line.",
    replyTitle: "What the agent finally receives",
    reply: `HTTP/1.1 403 Forbidden
{
  "error": "insufficient_scope",
  "scope": "sensitive:read"
}`,
  },
  redact: {
    button: "List transactions",
    buttonSub: "permitted, response redacted",
    verdict: "permit",
    title: "Allowed — then the response was rewritten by policy",
    sub: "Outbound leg masked account numbers before the reply left the server.",
    steps: { inbound: "on", decision: "ok", handler: "ok", outbound: "on", reply: "ok" },
    request: `// inbound leg permitted (as in Check balance) — this is the OUTBOUND leg
{
  "method": "GET",
  "url": "https://api.ping.demo:3001/api/transactions",
  "http_version": "1.1",
  "response_code": "200",
  "body": "[{\\"payee\\":\\"City Utilities\\",
            \\"account\\":\\"8802-114-2231\\",\\"amount\\":-120.5}]"
}`,
    decision: `{
  "response": {
    "response_code": "200",
    "headers": [ { "content-type": "application/json" } ],
    "body": "[{\\"payee\\":\\"City Utilities\\",
             \\"account\\":\\"****2231\\",\\"amount\\":-120.5}]"
  }
}`,
    note: "On the outbound leg, a returned \"response\" means use this instead — policy statements included, modified, or excluded fields.",
    replyTitle: "What the agent finally receives — account number masked by policy",
    reply: `HTTP/1.1 200 OK
[
  {
    "payee": "City Utilities",
    "account": "****2231",
    "amount": -120.5
  }
]`,
  },
};

const WHY_CARDS = [
  {
    title: "Trust the chain, guard the door",
    text: "No re-validation of upstream tokens. The resource server inspects only the step-9 token addressed to it — and even that check is delegated to PingOne Authorize.",
  },
  {
    title: "The last hop sees the whole truth",
    text: "Final URL, real request body, actual response data. Policies here can read the transfer amount and redact the response — things no earlier hop can fully see.",
  },
  {
    title: "Policy without redeploys",
    text: "Limits, allowlists, and redaction rules live in PingOne Authorize, not in banking code. Change the transfer ceiling in the console; the API never restarts.",
  },
];

const TEACH = [
  {
    title: "Defense in depth ends at the data's door.",
    text: "If every upstream check missed something, the bad call still dies here — the store is only reachable on PERMIT.",
  },
  {
    title: "The agent is controllable per tool, per amount, per field.",
    text: "X-MCP-Tool allowlists, transfer ceilings read from the body, and response redaction are all last-hop policies.",
  },
  {
    title: "Deny messages are policy-authored.",
    text: "PingOne Authorize writes the full error response; the resource server relays it verbatim, so the agent's error card is the policy speaking.",
  },
  {
    title: "Swap in real Kong, change nothing else.",
    text: "The middleware speaks the same sideband contract as Kong's ping-auth plugin. Replace it with Kong in front of the API and the P1AZ side is already done.",
  },
];

export default function ResourceServerCheckpointPage() {
  const [active, setActive] = useState("balance");
  const s = SCENARIOS[active];

  return (
    <div className="rsc-page">
      <div className="rsc-hero">
        <span className="rsc-eyebrow">Last hop · Kong pattern · PingOne Authorize AAM</span>
        <h1>The final check before your data</h1>
        <p className="rsc-sub">
          Every gateway upstream already validated its own token. This page shows the one
          check that still matters at the very end: the resource server hands the incoming
          request — token and all — to PingOne Authorize over the AAM sideband, exactly the
          way a Kong ping-auth plugin would, and only touches banking data on PERMIT.
        </p>
      </div>

      <div className="rsc-whycards">
        {WHY_CARDS.map((c) => (
          <div className="rsc-why" key={c.title}>
            <h3>{c.title}</h3>
            <p>{c.text}</p>
          </div>
        ))}
      </div>

      <h2>Try it — pick what the agent attempts</h2>
      <div className="rsc-lab">
        <div className="rsc-scenarios">
          <div className="rsc-sc-label">Agent tool call</div>
          {Object.entries(SCENARIOS).map(([key, sc]) => (
            <button
              key={key}
              type="button"
              className={`rsc-sc${active === key ? " rsc-sc--active" : ""}`}
              onClick={() => setActive(key)}
            >
              {sc.button}
              <small>{sc.buttonSub}</small>
            </button>
          ))}
        </div>

        <div className="rsc-stage">
          <div className="rsc-flowstrip">
            {FLOW_STEPS.map((step, i) => (
              <React.Fragment key={step.id}>
                {i > 0 ? <span className="rsc-pill-sep">›</span> : null}
                <span className={`rsc-pill${s.steps[step.id] ? ` rsc-pill--${s.steps[step.id]}` : ""}`}>
                  {step.label}
                </span>
              </React.Fragment>
            ))}
          </div>

          <div className={`rsc-verdict rsc-verdict--${s.verdict}`}>
            <span className="rsc-badge">{s.verdict === "permit" ? "PERMIT" : "DENY"}</span>
            <div className="rsc-vtext">
              <strong>{s.title}</strong>
              <span>{s.sub}</span>
            </div>
          </div>

          <div className="rsc-panes">
            <div className="rsc-pane">
              <h4>
                What the resource server sends · <em>POST /sideband/request</em>
              </h4>
              <pre>{s.request}</pre>
            </div>
            <div className="rsc-pane">
              <h4>What PingOne Authorize replies</h4>
              <pre>{s.decision}</pre>
              <p className="rsc-contract-note">{s.note}</p>
            </div>
            <div className="rsc-pane rsc-pane--wide">
              <h4>{s.replyTitle}</h4>
              <pre>{s.reply}</pre>
            </div>
          </div>
        </div>
      </div>

      <h2>The two moments Kong would hook — and we mock</h2>
      <div className="rsc-phases">
        <div className="rsc-phase">
          <h3>
            Inbound — <code>/sideband/request</code>
          </h3>
          <p>
            Fires before any handler runs. Carries method, URL, headers (raw Authorization
            included), body, and source IP. PingOne Authorize validates the token, maps the
            path to an API service operation, and evaluates built-in rules plus custom
            policies. A deny arrives as a complete ready-to-send response.
          </p>
        </div>
        <div className="rsc-phase">
          <h3>
            Outbound — <code>/sideband/response</code>
          </h3>
          <p>
            Fires only after a PERMIT, with the real response body. Policy statements
            include, modify, or exclude fields — masking account numbers, stripping columns
            the agent never consented to see — before anything leaves the building.
          </p>
        </div>
      </div>

      <h2>What this teaches</h2>
      <ul className="rsc-teach">
        {TEACH.map((t) => (
          <li key={t.title}>
            <span className="rsc-check">✓</span>
            <strong>{t.title}</strong> {t.text}
          </li>
        ))}
      </ul>

      <p className="rsc-footer">
        Companion diagram: Diagrams → Resource Server Placement (MM). Payloads follow the
        sideband contract pinned by demo_authz_server/routes/sideband.js — permit = no
        "response" field, string response_code, single-key header objects.
      </p>
    </div>
  );
}
