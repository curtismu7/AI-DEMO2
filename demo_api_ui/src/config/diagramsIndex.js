// diagramsIndex.js — the list behind /diagrams. Every route in the side nav's Diagrams group must appear here;
// config/__tests__/diagramsIndex.drift.test.js fails when a nav entry is missing, so the index cannot go stale.
// `more` holds diagram pages that live outside the Diagrams group.

const D = (title, path, blurb) => ({ title, path, blurb });

export const DIAGRAMS_INDEX = [
  {
    section: "Architecture",
    items: [
      D("Server Topology", "/architecture/server-topology", "Interactive map of the services and how they connect."),
      D("System Diagram", "/architecture/system", "The whole system, with focus tabs for frontend, BFF and gateways, MCP servers and PingOne."),
      D("System Flow (Live)", "/monitoring/system-flow", "Live system flow, also listed under Observability."),
      D("Overview Diagram", "/architecture/overview", "One-page overview of the demo architecture."),
      D("PingFederate ID-JAG", "/architecture/pingfederate-id-jag", "Cross-app access with ID-JAG through PingFederate."),
    ],
  },
  {
    section: "Tokens and delegation",
    items: [
      D("Token Flow", "/architecture/token-flow", "Interactive token flow."),
      D("Token Chain Architecture", "/architecture/token-chain", "How tokens are exchanged and chained, step by step."),
      D("Interactive Flow", "/architecture/flow", "Step through the end-to-end flow."),
      D("Sequence Diagram", "/sequence-diagram", "Sequence view of a run."),
      D("Canvas Diagram", "/architecture/canvas", "Editable canvas for drawing your own diagram."),
      D("Delegated Access Proof", "/academy/delegation/guided", "Guided proof of delegated access."),
      D("A2A Architecture", "/a2a-architecture", "Agent-to-agent delegation and Agent Card discovery."),
      D("Invest Dual-Auth", "/invest-dual-auth", "Two authorization flows for investments, side by side."),
    ],
  },
  {
    section: "Agent Privilege and Privilege",
    items: [
      D("AI Agent Gateway", "/privilege-mcp-diagrams", "Architecture, sign-in with tool call, and auth flow."),
      D("Privilege-First Gateway", "/privilege-first-gateway", "How the gateway enforces access, in two figures."),
      D("Gateway vs P1AZ Enforcement", "/gateway-enforcement-map", "Where the gateway and PingOne Authorize each enforce."),
      D("Resource Server Placement", "/resource-server-placement", "Where the resource server sits relative to the gateway."),
      D("CIMD in Privilege", "/cimd-privilege", "A client identified by a document URL, and what that gives an agent."),
    ],
  },
  {
    section: "Personal agent",
    items: [
      D("Personal Agent Design", "/personal-agent-design", "Agent Gateway only."),
      D("Personal Agent Dual Gateway", "/personal-agent-dual-gateway", "Privilege first."),
      D("Personal Agent Design Review", "/personal-agent-review", "Review of the design."),
    ],
  },
  {
    section: "Agent onboarding and audit",
    items: [
      D("Agent Onboarding Flow", "/agent-onboarding-flow", "Onboarding simulator."),
      D("Agent Onboarding Flow Subway", "/agent-onboarding-flow-subway", "Onboarding drawn as a subway map."),
      D("Demo Steps Lifeline Audit", "/demo-steps-lifeline-audit", "Every demo step, with the step in focus ringed."),
    ],
  },
];

export const DIAGRAMS_MORE = [
  D("Demo Map", "/demo-map", "Every demo step, inspector, diagram and learning topic on one page."),
  D("Privilege Gateway Topologies", "/privilege-gateway-topologies", "Three topologies plus a request-flow sequence."),
  D("MCP Gateway OAuth Flow", "/mcp-gateway-oauth-flow", "Architecture, then the OAuth sequence."),
  D("External Door", "/external-door-diagrams", "Topology and the dual-path sequence."),
  D("DaVinci SDK explainer", "/davinci-sdk", "Client lifecycle sequence."),
  D("Phase 266 architecture", "/architecture/phase-266", "Phase 266 architecture, step by step."),
  D("Agent Onboarding (React Flow)", "/agent-onboarding-flow-mermaid", "Onboarding drawn in React Flow."),
  D("Use-case diagrams", "/use-case-diagrams", "One walkthrough per demo step, deep-linkable by UC id."),
  D("Observability Demo", "/architecture/observability", "Telemetry data flow — emitters, collectors, surfaces — plus the two-part demo walkthrough."),
];
