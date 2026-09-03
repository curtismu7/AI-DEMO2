// Structural catalog of the AdminSideNav — groups with their child item labels.
// Used by DemoConfigPage for show/hide toggles and drag-to-reorder.
// Must stay in sync with allNavItems in AdminSideNav.jsx — enforced by
// __tests__/navStructureCatalog.drift.test.js, which fails on any divergence.
// Top-level labels without children appear as flat entries (no children array).

export const NAV_STRUCTURE_CATALOG = [
  { label: "Home" },
  { label: "Dashboard" },
  {
    label: "AI Agent Gateway",
    children: [
      "Protocol Playground",
      "AI Gateway Client",
      "Audit Agent",
      "AI Agent Gateway Guide",
      "AI Agent Gateway Diagrams",
      "Privilege Gateway Topologies",
    ],
  },
  { label: "Themes" },
  {
    label: "Demos",
    children: [
      "Weather MCP",
      "Brave Search MCP",
      "Use Cases",
      "Use Cases (Live)",
      "Guided Demo Track",
      "Delegation Chain Value",
      "A2A Protocol & Identity",
      "Group Policy Board",
      "Demo Script",
      "Demo Config",
    ],
  },
  {
    label: "AI Flows",
    children: [
      "Agentic Control Plane",
      "Agent Kill Switch",
      "Agent Registry",
      "PingOne Agent Builder",
      "Agent & Token Flow History",
      "Autonomous Agents",
      "Personal Agent",
      "Agent Lifecycle (guided demo)",
      "Delegated Commerce (guided demo)",
      "Family Delegation",
      "LangChain Agent",
      "Ungoverned Agent",
      "NotebookLM Docs Oracle",
    ],
  },
  {
    label: "Inspectors",
    children: [
      "MCP Inspector",
      "Agent Gateway Inspector",
      "P1AZ Inspector",
    ],
  },
  {
    label: "PingOne MCP",
    children: [
      "MCP Inspector",
      "PingOne MCP Setup",
      "Enterprise-Managed MCP Auth",
    ],
  },
  {
    label: "MCP & Gateways",
    children: [
      "Ping AI Test Lab",
      "Agent Gateway Inspector",
      "Capability Tour",
    ],
  },
  {
    label: "PingOne Sample Apps",
    children: [
      "M2M Client Credentials",
      "Custom Admin Role",
      "User Registration",
      "Login with MFA",
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
      "DaVinci Login",
    ],
  },
  {
    label: "Delegation & Consent",
    children: [
      "Transaction Consent",
      "Actor Token Education",
    ],
  },
  {
    label: "Authorize",
    children: [
      "P1AZ Inspector",
      "PAC Editor",
      "Authorize Capabilities",
      "Policy Decision Trace",
      "Scope Audit",
      "Scope Reference",
      "Snapshot Import",
      "Headless Identity Demo",
      "Resource Server Checkpoint",
    ],
  },
  {
    label: "OAuth & Identity",
    children: [
      "Security Settings",
      "OAuth Debug",
      "CIMD Simulation",
    ],
  },
  {
    label: "Platform Admin",
    children: [
      "Dashboard",
    ],
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
    children: [
      "Users",
      "Accounts",
      "Transactions",
    ],
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
      "New Relic",
      "PingOne Events",
      "PingOne Authorize",
      "Token Exchange",
    ],
  },
  {
    label: "Telemetry",
    children: [
      "Service Graph",
      "Tracing",
      "Transaction Trace",
      "Grafana",
      "Health Check",
    ],
  },
  {
    label: "Diagrams",
    children: [
      "System Diagram (Node)",
      "Overview Diagram (Node)",
      "Token Flow (Interactive) (Node)",
      "Token Chain Architecture (Node)",
      "Interactive Flow (Node)",
      "Phase 266 — 3 Paths (MM)",
      "Sequence Diagram (Node)",
      "Canvas Diagram (Node)",
      "Agent Onboarding Flow (Node)",
      "Agent Onboarding Flow Subway (Node)",
      "Agent Onboarding Flow (MM)",
      "Agent Gateway OAuth Flow (MM)",
      "Invest Dual-Auth (MM)",
      "External Door MCP Flow (MM)",
      "AI Agent Gateway (MM)",
      "Privilege Gateway Topologies (MM)",
      "Gateway vs P1AZ Enforcement (MM)",
      "Resource Server Placement (MM)",
    ],
  },
  {
    label: "Agent Studio (Preview)",
    children: [
      "IGA for AI",
      "Discovery",
      "AI Agent Gateway (Preview)",
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
    children: [
      "Code Explorer",
      "Protected RAG",
      "Graphify",
      "Mgmt API Runner",
    ],
  },
  {
    label: "System Tools",
    children: [
      "Feature Flags",
      "LLM Config",
      "App Configuration",
      "OAuth Debug",
      "Postman Collections",
    ],
  },
  {
    label: "Integration Tests",
    children: [
      "OIDC Resource Server",
      "CC Resource Server",
    ],
  },
];

// Ordered list of all hideable top-level labels (for backward compat).
const NAV_ITEM_CATALOG = NAV_STRUCTURE_CATALOG.map((g) => g.label);

// Apply a saved childOrder ({ [groupLabel]: [childLabel, ...] }) to a list of
// groups. A group's array in childOrder replaces that group's child membership
// AND order; a child label claimed by any group's array is removed from every
// other group (moves are by label — a label duplicated across groups, e.g.
// "MCP Inspector", consolidates into the claiming group). Children not claimed
// anywhere stay in their original group, appended after the ordered ones, so
// items added to the sidebar later still show up.
// Works on catalog groups (children are strings) and AdminSideNav items
// (children are objects with .label).
export function applyChildOrder(groups, childOrder) {
  if (!childOrder || typeof childOrder !== "object" || Array.isArray(childOrder)) return groups;
  const labelOf = (c) => (typeof c === "string" ? c : c.label);
  const pool = new Map();
  groups.forEach((g) => {
    (g.children || []).forEach((c) => {
      if (!pool.has(labelOf(c))) pool.set(labelOf(c), c);
    });
  });
  const claimed = new Set(
    Object.values(childOrder).flat().filter((l) => pool.has(l)),
  );
  return groups.map((g) => {
    if (!Array.isArray(g.children)) return g;
    const override = Array.isArray(childOrder[g.label]) ? childOrder[g.label] : null;
    const kept = g.children.filter((c) => !claimed.has(labelOf(c)));
    if (!override) {
      return kept.length === g.children.length ? g : { ...g, children: kept };
    }
    const ordered = override.filter((l) => pool.has(l)).map((l) => pool.get(l));
    const rest = kept.filter((c) => !override.includes(labelOf(c)));
    return { ...g, children: [...ordered, ...rest] };
  });
}
