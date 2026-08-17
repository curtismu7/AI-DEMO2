// PrivilegesGatewayPreviewPage.jsx — "P1 Privileges MCP Gateway (Preview)":
// Flow 1/2 step 7 and Flow 3 step 8 — enforcement. A state view (mock audit
// log), not a step sequence, so it uses the calmer row-table treatment.
import React from "react";
import PreviewBanner from "./PreviewBanner";
import "./agentStudioPreview.css";

const MOCK_LOG = [
  { agent: "demouser — Claude Desktop", tool: "accounts.read", decision: "permit" },
  { agent: "claims-triage-agent", tool: "claims.submit", decision: "permit" },
  { agent: "cursor-shadow-session", tool: "files.write", decision: "deny" },
  { agent: "demouser — Claude Desktop", tool: "transactions.write", decision: "permit" },
  { agent: "claims-triage-agent", tool: "documents.read", decision: "permit" },
];

export default function PrivilegesGatewayPreviewPage() {
  return (
    <div className="asp-root">
      <div className="asp-page">
        <PreviewBanner />
        <div className="asp-hero">
          <span className="asp-eyebrow">Agent Studio · Preview</span>
          <h1>AI Agent Gateway</h1>
          <p>Every tool call from a governed agent, permitted or denied.</p>
        </div>

        <div className="asp-stats">
          <div className="asp-stat">
            <div className="n">1,204</div>
            <div className="l">Calls today</div>
          </div>
          <div className="asp-stat">
            <div className="n" style={{ color: "var(--asp-good)" }}>1,187</div>
            <div className="l">Permitted</div>
          </div>
          <div className="asp-stat">
            <div className="n" style={{ color: "var(--asp-bad)" }}>17</div>
            <div className="l">Denied</div>
          </div>
          <div className="asp-stat">
            <div className="n">9</div>
            <div className="l">Step-up challenges</div>
          </div>
        </div>

        <div className="asp-rowlist">
          {MOCK_LOG.map((row, i) => (
            <div className="asp-rowcard" key={`${row.agent}-${row.tool}-${i}`}>
              <span className="t">{row.agent}</span>
              <span className="s">{row.tool}</span>
              <span className={`asp-badge asp-badge--${row.decision}`}>{row.decision}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
