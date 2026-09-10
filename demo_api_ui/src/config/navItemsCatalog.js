// Static catalog of top-level AdminSideNav.jsx entries, for the Demo Config
// picker + built-in preset seeds (demo_api_server/services/lmdb/navConfigStore.lmdb.js
// BUILTIN_CONFIGS). Keep in sync with allNavItems' top-level labels in
// AdminSideNav.jsx, in the same order — the picker lists them in this order.
// Intentionally excludes the dynamically-conditional "Latest Report" entry
// (only rendered when a run just completed) and the Demo Config page's own link
// (never hideable).
//
// This drifted once: "AI Agent Gateway", "Inspectors", "PingOne Sample Apps"
// and "Platform Admin" were all added to the nav and never added here, so the
// Demo Config picker could not show or hide any of them. The sync test in
// components/__tests__/adminSideNav.test.jsx only asserted that every catalog
// label RENDERS, which stays green when the catalog is missing entries — the
// reverse assertion in config/__tests__/navStructureCatalog.drift.test.js now
// closes that direction.
export const NAV_ITEM_CATALOG = [
  "Home",
  "Dashboard",
  "Agentic Access Console",
  "AI Agent Gateway",
  "Themes",
  "Demos",
  "AI Flows",
  "Inspectors",
  "PingOne MCP",
  "MCP & Gateways",
  "PingOne Sample Apps",
  "PingOne Demo Apps",
  "Delegation & Consent",
  "Authorize",
  "OAuth & Identity",
  "Platform Admin",
  "Industry Verticals",
  "Users & Accounts",
  "AI Attack Demos",
  "Monitoring",
  "Telemetry",
  "Diagrams",
  "Agent Studio (Preview)",
  "Learn & Present",
  "Developer Tools",
  "System Tools",
  "Integration Tests",
];
