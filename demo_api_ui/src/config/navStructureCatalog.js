// Structural catalog of the AdminSideNav — groups with their child item labels.
// Used by DemoConfigPage for show/hide toggles and drag-to-reorder.
// Must stay in sync with allNavItems in AdminSideNav.jsx — enforced by
// __tests__/navStructureCatalog.drift.test.js, which fails on any divergence.
// Top-level labels without children appear as flat entries (no children array).

export const NAV_STRUCTURE_CATALOG = [
  { label: "Home" },
  { label: "Security Dashboard" },
  { label: "Themes" },
  { label: "AI Gateway", children: [
    "AI Guard", "Protocol Playground", "AI Gateway Client", "LLM Gateway", "Intent Inspector", "Audit Agent",
    "AI Gateway Guide", "Agent Gateway Authorization", "AI Gateway Diagrams", "Agent IAM Core",
    "Agent Gateway", "PingOne Authorize", "AI Gateway · LLM", "AI Gateway · A2A", "AI Gateway · MCP",
    "Protected RAG", "AI Gateway Demo",
  ] },
  { label: "DaVinci", children: [
    "DaVinci Widget", "DaVinci Login", "DaVinci SDK Login", "DaVinci Orchestration",
    "DaVinci Orchestration SDK", "Orchestration SDK Guide", "DaVinci Orchestration Overview",
  ] },
  { label: "PingOne Products", children: [
    "Headless Identity / PingCLI", "SDK Login", "M2M Client Credentials", "Custom Admin Role",
  ] },
  { label: "Identity Journeys", children: [
    "Self-Service Registration", "User Registration", "Login with MFA", "Identity Journey Map", "OAuth Academy", "OAS Demo",
  ] },
  { label: "Authorize", children: [
    "P1AZ Inspector", "PAC Editor", "Authorize Capabilities", "Policy Decision Trace", "Scope Audit",
    "Scope Reference", "Snapshot Import", "Resource Server Checkpoint",
  ] },
  { label: "Delegation & Consent", children: [
    "Transaction Consent", "Actor Token Education", "Family Delegation",
  ] },
  { label: "Utilities", children: [
    "PingOne Test", "MFA Test", "OAuth Debug", "Token Exchange Tester", "Management API Runner",
    "OAS Demo", "PingOne MCP Setup", "MCP Discovery", "Resource Server Checkpoint",
    "Scope Reference", "Snapshot Import", "Health Check",
  ] },
  { label: "AI Experiences", children: [
    "Weather MCP", "Brave Search MCP", "Use Cases", "Use Cases (Live)", "Guided Demo Track",
    "Delegation Chain Value", "A2A Protocol & Identity", "Group Policy Board", "Demo Script",
    "Agentic Control Plane", "Agent Kill Switch", "Agent Registry", "PingOne Agent Builder",
    "Agent & Token Flow History", "Autonomous Agents", "Personal Agent",
    "Agent Onboarding Flow (Node)", "Agent Onboarding Flow Subway (Node)",
    "Agent Lifecycle (guided demo)", "Delegated Commerce (guided demo)", "LangChain Agent", "Ungoverned Agent",
    "NotebookLM Docs Oracle", "Prompt Injection", "HITL Bypass", "Indirect Injection", "Unauthorized Commitments",
    "Scope Abuse", "Intent Bypass", "IGA for AI", "Discovery", "AI Gateway (Preview)", "Platform Gaps",
    "AI Security Academy", "Academy Standalone Demos", "Agentic Trust", "Agent Guardrails", "OWASP Agent Risks",
    "AI Gateway for AI",
  ] },
  { label: "MCP & Integrations", children: [
    "MCP Inspector", "Agent Gateway Inspector", "Enterprise-Managed MCP Auth", "Ping AI Test Lab",
    "Capability Tour", "MCP Runtime Inventory", "MCP Scanner", "Personal Agent Clients", "LibreChat (browser)", "LM Studio (Mac)",
  ] },
  { label: "Developer Tools", children: [
    "Code Explorer", "Graphify", "Postman Collections", "API Docs (Swagger)", "API Reference (Scalar)", "llama-vscode Guide",
  ] },
  { label: "Observability", children: [
    "Audit Trail", "Learning Log", "Activity Log", "API Activity", "Run Reports", "Error Audit Log", "New Relic",
    "PingOne Events", "PingOne Authorize Decisions", "Token Exchange", "System Flow", "Service Graph", "Tracing",
    "Transaction Trace", "MCP Observability", "Grafana",
  ] },
  { label: "Architecture & Learning", children: [
    "System Diagram (Node)", "Overview Diagram (Node)", "Token Flow (Interactive) (Node)",
    "Token Chain Architecture (Node)", "Interactive Flow (Node)", "Sequence Diagram (Node)", "Canvas Diagram (Node)",
    "Delegated Access Proof",
    "Invest Dual-Auth (MM)", "AI Gateway (MM)",
    "AI Gateway Enforcement (Node)", "Gateway vs P1AZ Enforcement (MM)", "Resource Server Placement (MM)", "Learning Hub",
    "SPIFFE → PingOne Bridge (TODO)", "llama-vscode Guide",
  ] },
  { label: "Administration", children: [
    "Feature Flags", "LLM Config", "Secret Rotation", "App Configuration", "Security Settings", "CIMD Simulation",
    "Demo Config", "PingOne Admin", "Banking Ops", "Healthcare Ops", "Retail Ops", "Sporting Goods Ops", "Workforce Ops",
    "Vertical Editor", "Mortgage Path", "Users", "Accounts", "Transactions", "OIDC Resource Server", "CC Resource Server",
  ] },
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
