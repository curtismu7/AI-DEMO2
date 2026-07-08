import React from "react";
import AgentGuardrailsDiagram from "../components/AgentGuardrailsDiagram";

const PUBLIC_PAGE_URL =
  "https://curtismu7.github.io/llama-vscode-setup-guide/learning/agent-guardrails.html";

// Public education page: Lucid-style reference diagram showing how Ping
// keeps an AI agent inside explicit guardrails (identity, delegated access,
// runtime enforcement, risk detection, human oversight). Sibling to
// /agentic-trust and /ungoverned-agent.
export default function AgentGuardrailsPage() {
  return (
    <div className="agent-guardrails-page">
      <a
        className="learning-hub__weblink"
        href={PUBLIC_PAGE_URL}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          margin: "16px 24px 0",
          padding: "8px 14px",
          borderRadius: 999,
          background: "#f0eefb",
          border: "1px solid #ddd5fb",
          color: "#5b3fd6",
          textDecoration: "none",
          fontSize: 14,
          fontWeight: 600,
        }}
      >
        Share this diagram on the web — open the public page ↗
      </a>
      <AgentGuardrailsDiagram />
    </div>
  );
}
