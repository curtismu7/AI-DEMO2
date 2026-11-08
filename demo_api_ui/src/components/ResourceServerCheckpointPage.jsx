// ResourceServerCheckpointPage.jsx — teaching page for the Kong-mock final
// checkpoint at the resource server: pick what the agent attempts and see the
// AAM sideband legs (request decision / response redaction) that PingOne
// Authorize evaluates before banking data is touched. UI mock — panes show
// canned payloads matching the sideband contract pinned in
// demo_authz_server/routes/sideband.js; not wired to the live stack.
//
// Layout follows the standalone Ping UI Standard (AI-DEMO-Standalone/shared/
// STANDALONE-UI-PATTERNS.md) on the shared primitives (components/pingUi,
// docs/ping-ui-primitives.md): P2 banner first, P3 frame, P4 cards, P5 kv, P7 chips,
// P9 buttons. Skipped: P6 (not an inspector) and P8 (the flow strip is a text path, not a
// diagram). The standalone shell bar is not added (the app has its own).
//
// P9, one primary per view state: the scenario buttons are a pick-one SELECTOR, so they are
// secondaries (aria-pressed, a check mark and a heavier edge on the chosen one, as Privilege
// Map's PickButton does), never a call to action. Nothing on the page submits or runs anything,
// so the one primary is the only real action: the link that opens the companion diagram. It is
// the same in every state (balance, transfer, sensitive, redact). The theme toggle is a
// secondary in the title band.
//
// Honesty: every outcome is a recorded sample, never a live run. The verdict and the key-value
// rows say "would" / "sample", the chip says "Simulated", and the payload panes are titled "Sample".
//
// The divider between the list and the stage is mouse-only (shared hook, no keyboard handler), so
// it is hidden from assistive tech instead of announcing a separator it cannot operate.
import React, { useState } from "react";
import { Link } from "react-router-dom";
import { diagramLinkProps } from "../utils/diagramLinks";
import useDividerDrag from "../hooks/useDividerDrag";
import { useThemeOptional } from "../context/ThemeContext";
import "./ResourceServerCheckpointPage.css";
import PageHeader from './common/PageHeader';
import { PingPage, SimBanner, PageFrame, Section, CardGrid, Card, StatusChip, KvList } from "./pingUi";

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
    title: "Would be allowed through to banking data",
    sub: "In this sample the audience and scope are satisfied; no custom policy objects.",
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
    replyTitle: "What the agent would receive",
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
    title: "Would be blocked: agent transfer ceiling is $5,000",
    sub: "A custom policy would read amount 8500 from the request body. The banking handler would never run.",
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
    replyTitle: "What the agent would receive — P1AZ's words, relayed verbatim",
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
    title: "Would be blocked: token lacks scope sensitive:read",
    sub: "A built-in scope rule on the operation would deny it — no custom policy needed.",
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
    replyTitle: "What the agent would receive",
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
    title: "Would be allowed — then the response rewritten by policy",
    sub: "The outbound leg would mask account numbers before the reply left the server.",
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
    replyTitle: "What the agent would receive — account number masked by policy",
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

// Sample wording: a recorded sample never reads as a live result.
const HANDLER = (v) => (v === "ok" ? "Would run" : "Would not run");
const OUTBOUND = (v) => (v === "on" ? "Would run" : "Would not be reached");

export default function ResourceServerCheckpointPage() {
  const { darkMode, toggleDarkMode } = useThemeOptional();
  const [active, setActive] = useState("balance");
  const s = SCENARIOS[active];
  const { size: scenarioWidth, handleProps: scenarioHandleProps } = useDividerDrag({
    min: 180,
    max: 420,
    initial: 230,
    storageKey: "rsc-scenarios-width",
  });

  return (
    <PingPage className="rsc-page">
      <SimBanner data-testid="rsc-banner">
        <strong>SIMULATED — SAMPLE PAYLOADS.</strong> Nothing on this page is sent anywhere: no real service is called and
        every value is made up. Only the contract shape is real.
      </SimBanner>
      <PageHeader
        className="rsc-hero"
        eyebrow="Last hop · Kong pattern · PingOne Authorize AAM"
        title="The final check before your data"
        summary={<>Every gateway upstream already validated its own token. This page shows the one
          check that still matters at the very end: the resource server hands the incoming
          request — token and all — to PingOne Authorize over the AAM sideband, exactly the
          way a Kong ping-auth plugin would, and only touches banking data on PERMIT.</>}
        actions={
          <button
            type="button"
            onClick={toggleDarkMode}
            className="pu-btn"
            title="Switch this page between light and dark"
            aria-pressed={darkMode}
          >
            <span aria-hidden="true">{darkMode ? "☀️ " : "🌙 "}</span>Dark mode
          </button>
        }
      />

      <PageFrame>
        <Section id="rsc-why" kicker="1 · Why the last hop" title="Three reasons the final check still matters">
          <CardGrid>
            {WHY_CARDS.map((c) => (
              <Card key={c.title} title={c.title}>
                <p className="pu-note">{c.text}</p>
              </Card>
            ))}
          </CardGrid>
        </Section>

        <Section
          id="rsc-try"
          kicker="2 · Try it"
          title="Pick what the agent attempts"
          lede="Four sample tool calls. Pick one to see the sideband request, the decision PingOne Authorize would return, and the reply the agent would get."
        >
          <Card tone="neutral" className="rsc-lab-card">
            <div className="rsc-lab" style={{ "--rsc-scenarios-w": `${scenarioWidth}px` }}>
              <div className="rsc-scenarios" role="group" aria-label="Agent tool call">
                <p className="pu-label">Agent tool call</p>
                {Object.entries(SCENARIOS).map(([key, sc]) => (
                  <button
                    key={key}
                    type="button"
                    className="pu-btn rsc-sc"
                    aria-pressed={active === key}
                    data-testid={`rsc-scenario-${key}`}
                    onClick={() => setActive(key)}
                  >
                    {active === key ? <span className="rsc-sc-check" aria-hidden="true">&#10003; </span> : null}
                    {sc.button}
                    <small>{sc.buttonSub}</small>
                  </button>
                ))}
              </div>

              <div className="divider-drag-handle" {...scenarioHandleProps} role="presentation" aria-orientation={undefined} aria-hidden="true" />

              <div className="rsc-stage">
                <ol className="rsc-flowstrip" aria-label="Path of the sample request">
                  {FLOW_STEPS.map((step, i) => {
                    const state = s.steps[step.id];
                    return (
                      <li key={step.id} className={`rsc-pill${state ? ` rsc-pill--${state}` : ""}`}>
                        {i > 0 ? <span className="rsc-pill-sep" aria-hidden="true">›</span> : null}
                        <span className="rsc-pill-label">{step.label}</span>
                        {state === "dead" ? <span className="rsc-sr"> (not reached in this sample)</span> : null}
                      </li>
                    );
                  })}
                </ol>

                <div className="rsc-verdict" role="status" data-testid="rsc-verdict">
                  <p className="pu-status-line">
                    <StatusChip tone="neutral">{s.verdict === "permit" ? "Simulated PERMIT" : "Simulated DENY"}</StatusChip>
                    <strong>{s.title}</strong>
                  </p>
                  <p className="pu-note">{s.sub}</p>
                </div>

                <KvList
                  items={[
                    { label: "Agent tool call", value: `${s.button} — ${s.buttonSub}` },
                    { label: "Banking handler (sample)", value: HANDLER(s.steps.handler) },
                    { label: "Outbound redaction leg (sample)", value: OUTBOUND(s.steps.outbound) },
                  ]}
                />

                <div className="rsc-panes">
                  <div className="rsc-pane">
                    <h3 className="pu-label">
                      Sample: what the resource server sends · <em>POST /sideband/request</em>
                    </h3>
                    <pre tabIndex={0} role="region" aria-label="Sample sideband request">{s.request}</pre>
                  </div>
                  <div className="rsc-pane">
                    <h3 className="pu-label">Sample: what PingOne Authorize would reply</h3>
                    <pre tabIndex={0} role="region" aria-label="Sample PingOne Authorize reply">{s.decision}</pre>
                    <p className="pu-note rsc-contract-note">{s.note}</p>
                  </div>
                  <div className="rsc-pane rsc-pane--wide">
                    <h3 className="pu-label">Sample: {s.replyTitle.charAt(0).toLowerCase() + s.replyTitle.slice(1)}</h3>
                    <pre tabIndex={0} role="region" aria-label="Sample reply to the agent">{s.reply}</pre>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </Section>

        <Section id="rsc-phases" kicker="3 · The two legs" title="The two moments Kong would hook — and we mock">
          <CardGrid>
            <Card title={<>Inbound — <code className="rsc-code">/sideband/request</code></>}>
              <p className="pu-note">
                Fires before any handler runs. Carries method, URL, headers (raw Authorization
                included), body, and source IP. PingOne Authorize validates the token, maps the
                path to an API service operation, and evaluates built-in rules plus custom
                policies. A deny arrives as a complete ready-to-send response.
              </p>
            </Card>
            <Card title={<>Outbound — <code className="rsc-code">/sideband/response</code></>}>
              <p className="pu-note">
                Fires only after a PERMIT, with the real response body. Policy statements
                include, modify, or exclude fields — masking account numbers, stripping columns
                the agent never consented to see — before anything leaves the building.
              </p>
            </Card>
          </CardGrid>
        </Section>

        <Section id="rsc-teach" kicker="4 · Takeaways" title="What this teaches">
          <Card tone="neutral">
            <ul className="rsc-teach">
              {TEACH.map((t) => (
                <li key={t.title}>
                  <span className="rsc-check" aria-hidden="true">✓</span>
                  <strong>{t.title}</strong> {t.text}
                </li>
              ))}
            </ul>
          </Card>
        </Section>

        <p className="pu-actions rsc-diagram-link">
          <Link className="pu-btn pu-btn--primary" to="/resource-server-placement" {...diagramLinkProps("/resource-server-placement")}>
            Open the companion diagram in a new tab <span aria-hidden="true">&#8599;</span>
          </Link>
        </p>
        <p className="pu-note rsc-footer">
          Companion diagram: Diagrams → Resource Server Placement (MM). The sample payloads are fixed
          text written to match the sideband contract pinned by <code className="rsc-code">demo_authz_server/routes/sideband.js</code> —
          permit = no "response" field, string response_code, single-key header objects.
        </p>
      </PageFrame>
    </PingPage>
  );
}
