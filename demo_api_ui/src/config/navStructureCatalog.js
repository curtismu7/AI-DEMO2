// Structural catalog of the AdminSideNav — groups with their child item labels.
// Used by DemoConfigPage for show/hide toggles and drag-to-reorder.
// Must stay in sync with allNavItems in AdminSideNav.jsx.
// Top-level labels without children appear as flat entries (no children array).

export const NAV_STRUCTURE_CATALOG = [
  { label: "Home" },
  { label: "Dashboard" },
  { label: "Themes" },
  { label: "Use Cases" },
  { label: "Use Cases (Live)" },
  { label: "AI Footprint" },
  { label: "Footprint Gallery" },
  { label: "Family Delegation" },
  {
    label: "AI Agents",
    children: [
      "AI Control Plane",
      "Copilot",
      "PingOne Agent Builder",
      "Agent Flow Inspector",
      "LangChain Agent",
      "Ungoverned Agent",
    ],
  },
  {
    label: "Inspectors",
    children: ["MCP Inspector", "Agent Gateway Inspector", "P1AZ Inspector"],
  },
  {
    label: "PingOne MCP",
    children: ["MCP Inspector", "PingOne MCP Setup", "Privilege MCP Client"],
  },
  {
    label: "MCP & Gateways",
    children: [
      "Ping AI Test Lab",
      "Web MCP",
      "Agent Gateway Inspector",
      "Capability Tour",
      "Weather MCP",
    ],
  },
  {
    label: "PingOne Demo Apps",
    children: [
      "Self-Service Registration",
      "PingOne Test",
      "MFA Test",
      "Token Exchange Tester",
      "OAuth Academy",
      "OAS Demo",
      "Privilege Demo",
      "SDK Login",
    ],
  },
  {
    label: "Delegation & Consent",
    children: ["Transaction Consent", "Actor Token Education"],
  },
  {
    label: "Authorize",
    children: [
      "P1AZ Inspector",
      "Authorize Capabilities",
      "Policy Decision Trace",
      "Scope Audit",
      "Scope Reference",
      "Snapshot Import",
      "PingCLI Demo",
    ],
  },
  {
    label: "OAuth & Identity",
    children: ["Security Settings", "OAuth Debug", "CIMD Simulation"],
  },
  {
    label: "Industry Verticals",
    children: [
      "Banking Ops",
      "Healthcare Ops",
      "Retail Ops",
      "Sporting Goods Ops",
      "Workforce Ops",
      "Vertical Editor",
      "Mortgage Path",
    ],
  },
  {
    label: "Users & Accounts",
    children: ["Users", "Accounts", "Transactions"],
  },
  {
    label: "AI Attack Demos",
    children: [
      "Prompt Injection",
      "HITL Bypass",
      "Indirect Injection",
      "Unauthorized Commitments",
      "Scope Abuse",
      "Intent Bypass",
    ],
  },
  {
    label: "Monitoring",
    children: [
      "Audit Trail",
      "Learning Log",
      "Activity Log",
      "Run Reports",
      "Error Audit Log",
    ],
  },
  {
    label: "Telemetry",
    children: ["Service Graph", "Tracing", "Transaction Trace", "Health Check"],
  },
  {
    label: "Diagrams",
    children: [
      "System Diagram",
      "Overview Diagram",
      "Token Flow (Interactive)",
      "Token Chain Architecture",
      "Interactive Flow",
      "Phase 266 — 3 Paths",
      "Sequence Diagram",
      "Canvas Diagram",
      "Agent Onboarding Flow",
      "Agent Onboarding Flow Subway",
      "Agent Onboarding Flow (MM)",
      "MCP Gateway OAuth Flow",
    ],
  },
  {
    label: "Agent Studio (Preview)",
    children: [
      "Agent Studio",
      "IGA for AI",
      "Discovery",
      "Privileges Gateway",
      "Platform Gaps",
    ],
  },
  {
    label: "Learn & Present",
    children: [
      "Learning Hub",
      "Agentic Trust",
      "Agent Guardrails",
      "OWASP Agent Risks",
      "llama-vscode Guide",
    ],
  },
  {
    label: "Developer Tools",
    children: ["Code Explorer", "Code Search", "Graphify", "Mgmt API Runner"],
  },
  {
    label: "System Tools",
    children: [
      "Feature Flags",
      "LLM Config",
      "App Configuration",
      "OAuth Debug",
      "Postman Collections",
      "Vault",
    ],
  },
  {
    label: "Integration Tests",
    children: ["OIDC Resource Server", "CC Resource Server"],
  },
];

// Ordered list of all hideable top-level labels (for backward compat).
export const NAV_ITEM_CATALOG = NAV_STRUCTURE_CATALOG.map((g) => g.label);
