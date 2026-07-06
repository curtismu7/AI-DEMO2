import React from "react";
import AgentGuardrailsDiagram from "../components/AgentGuardrailsDiagram";

// Public education page: Lucid-style reference diagram showing how Ping
// keeps an AI agent inside explicit guardrails (identity, delegated access,
// runtime enforcement, risk detection, human oversight). Sibling to
// /agentic-trust and /ungoverned-agent.
export default function AgentGuardrailsPage() {
  return (
    <div className="agent-guardrails-page">
      <AgentGuardrailsDiagram />
    </div>
  );
}
