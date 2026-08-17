// PlatformGapsPage.jsx — "Platform Gaps": the 5 Ping Identity platform-level
// gaps behind Tarun Madiraju's proposed architecture. Deliberately distinct
// from the other 4 Agent Studio (Preview) pages — these are gaps in the
// Ping Identity platform, not in this demo (the other 4 pages simulate what
// each gap, once closed, would enable).
import React from "react";
import "./agentStudioPreview.css";

const GAPS = [
  {
    title: "Unified Agent Studio portal",
    body: "Registering an agent today means separate steps in the PingOne admin console, PingFederate, and Advanced Identity Cloud — no single portal spans all three with one create-identity → register-MCP → review flow for all three personas.",
  },
  {
    title: "IGA for AI",
    body: "PingOne IGA governs human identity — inventory, lifecycle, certification, access review. None of that extends to non-human AI agent identities or their MCP tool grants today.",
  },
  {
    title: "AI-agent discovery",
    body: "Nothing in the current portfolio scans cloud platforms (Foundry, AWS Bedrock, Vertex) or endpoints/browsers for unmanaged AI agents already running. Closer to CASB/EDR territory than classic IAM.",
  },
  {
    title: "Distinct Privileges MCP Gateway",
    body: "PingOne Privilege handles human privileged-session brokering. An MCP-protocol-aware privilege layer — policy, step-up, and audit specifically for MCP tool calls — isn't its own product; today it's hand-assembled from PingOne Agent Gateway + PingOne Authorize config.",
  },
  {
    title: "Federated cross-product Agent Identity",
    body: 'An agent’s identity record in PingOne, PingFederate, and AIC are three separate records today (exactly what Tarun’s steps mean by "metadata created on pf, p1, aic, ais"). True single-pane governance needs one canonical Agent Identity spanning all three platforms.',
  },
];

export default function PlatformGapsPage() {
  return (
    <div className="asp-root">
      <div className="asp-page">
        <div className="asp-hero">
          <span className="asp-eyebrow">Agent Studio · what's missing today</span>
          <h1>Where Ping Identity is missing pieces</h1>
          <p>
            These are gaps in the platform, not this demo — everything else you clicked
            through in Agent Studio (Preview) simulates what each would enable.
          </p>
        </div>

        <div className="asp-gapgrid">
          {GAPS.map((g) => (
            <div className="asp-gapcard" key={g.title}>
              <span className="asp-gapstatus">Not a Ping product today</span>
              <h3>{g.title}</h3>
              <p>{g.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
