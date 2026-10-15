'use strict';
/**
 * navConfigStore.lmdb.js — LMDB-backed persistence for sidebar nav
 * customization. Sibling to verticalStore.lmdb.js (same prefixed-key,
 * single-DB convention).
 *
 * Key layout (single LMDB DB named 'navConfigs'):
 *   config:<id>        -> { id, name, isBuiltin, hiddenLabels, flagSnapshot, createdAt, updatedAt }
 *   userPrefs:<userId>  -> { hiddenLabels, activeConfigId, updatedAt }
 */
const { getDb } = require('./openEnv');
const crypto = require('crypto');

const DB_NAME = 'navConfigs';

function _db() { return getDb(DB_NAME); }

// Top-level AdminSideNav groups, in order. Mirrors NAV_STRUCTURE_CATALOG in
// demo_api_ui/src/config/navStructureCatalog.js — a UI test fails on drift.
const TOP_LEVEL_LABELS = [
  'Home', 'Security Dashboard', 'Skin Studio', 'Agent Privilege', 'Jev Demos', 'DaVinci',
  'Ping products', 'Identity Journeys', 'Authorize', 'Delegation & Consent', 'Exploring',
  'Utilities', 'AI Experiences', 'Personal Agents', 'MCP & Integrations',
  'PingFederate ID-JAG', 'AIC', 'Developer Tools', 'Observability', 'Diagrams',
  'Demo arch slides', 'Architecture & Learning', 'Administration',
];

// Presets are written as "show only these groups" so a newly added nav group
// stays hidden everywhere until a preset opts in. Home and Administration
// (which holds Demo Config itself) are always kept. Sidebar-only: no flags.
function preset(id, name, ...show) {
  const keep = new Set(['Home', 'Administration', ...show]);
  return {
    id, name, isBuiltin: true,
    hiddenLabels: TOP_LEVEL_LABELS.filter((l) => !keep.has(l)),
    flagSnapshot: {},
  };
}

// A2A also trims pages inside the groups it shows (labels are verified
// against the UI nav catalog by navConfigStore.lmdb.test.js).
const a2aPreset = {
  ...preset('uc-a2a', 'Use case · A2A', 'Agent Privilege', 'AI Experiences', 'Personal Agents', 'Delegation & Consent', 'Diagrams', 'Observability'),
};
a2aPreset.hiddenLabels.push(
    "AI Guard",
    "Protocol Playground",
    "AI Guard Client",
    "LLM Gateway",
    "Intent Inspector",
    "Audit Agent",
    "Agent Gateway Authorization",
    "Agent Privilege Diagrams",
    "PingOne Authorize",
    "Agent Privilege · LLM",
    "Agent Privilege · MCP",
    "Malicious MCP Catalog",
    "Agent Privilege Demo",
    "Agent Studio",
    "Weather MCP",
    "Brave Search MCP",
    "Use Cases",
    "Use Cases (Live)",
    "Guided Demo Track",
    "Jev Decision Model",
    "Group Policy Board",
    "Demo Script",
    "Agent Kill Switch",
    "PingOne Agent Builder",
    "Autonomous Agents",
    "Agent Onboarding Flow (Node)",
    "Agent Onboarding Flow Subway (Node)",
    "Agent Lifecycle (guided demo)",
    "Delegated Commerce (guided demo)",
    "LangChain Agent",
    "Ungoverned Agent",
    "Prompt Injection",
    "HITL Bypass",
    "Indirect Injection",
    "Unauthorized Commitments",
    "Scope Abuse",
    "Intent Bypass",
    "IGA for AI",
    "Discovery",
    "Agent Privilege (Preview)",
    "Platform Gaps",
    "AI Security Academy",
    "Academy Standalone Demos",
    "Agentic Trust",
    "Agent Guardrails",
    "OWASP Agent Risks",
    "Agent Privilege for AI",
    "Target Design",
    "Dual Gateway Design",
    "Design Review",
    "Server Topology (Interactive)",
    "PingFederate ID-JAG (Node)",
    "System Diagram (Node)",
    "Overview Diagram (Node)",
    "Token Flow (Interactive) (Node)",
    "Token Chain Architecture (Node)",
    "Interactive Flow (Node)",
    "Sequence Diagram (Node)",
    "Canvas Diagram (Node)",
    "Demo Steps Lifeline Audit",
    "Invest Dual-Auth (MM)",
    "Agent Privilege (MM)",
    "Agent Privilege Enforcement (Node)",
    "Gateway vs P1AZ Enforcement (MM)",
    "Resource Server Placement (MM)",
    "Personal Agent Design (Node)",
    "Personal Agent Dual Gateway (Node)",
    "Personal Agent Design Review",
    "CIMD in Privilege (Node)",
    "Learning Log",
    "API Activity",
    "Run Reports",
    "Error Audit Log",
    "New Relic",
    "CI Queue Dashboard",
    "PingOne Events",
    "PingOne Authorize Decisions",
    "System Flow",
    "Service Graph",
    "MCP Observability",
    "Observability Demo",
    "Grafana",
);

// Personal agent includes the OBO story: the Delegation & Consent group plus
// just the token-exchange pages from Utilities and Observability.
const personalAgentPreset = preset('uc-personal-agent', 'Use case · Personal agent', 'Personal Agents', 'AI Experiences', 'Delegation & Consent', 'MCP & Integrations', 'Utilities', 'Observability');
personalAgentPreset.hiddenLabels.push(
  "PingOne Test",
  "MFA Test",
  "Management API Runner",
  "PingOne MCP Setup",
  "MCP Discovery",
  "Resource Server Checkpoint",
  "Scope Reference",
  "Snapshot Import",
  "Health Check",
  "Learning Log",
  "Activity Log",
  "API Activity",
  "Run Reports",
  "Error Audit Log",
  "New Relic",
  "CI Queue Dashboard",
  "PingOne Events",
  "PingOne Authorize Decisions",
  "System Flow",
  "Service Graph",
  "Tracing",
  "MCP Observability",
  "Observability Demo",
  "Grafana",
);

const BUILTIN_CONFIGS = [
  { id: 'full-mode', name: 'Full mode', isBuiltin: true, hiddenLabels: [], flagSnapshot: {} },
  preset('demo-mode', 'Demo mode', 'Security Dashboard', 'AI Experiences', 'Personal Agents', 'Agent Privilege', 'Observability'),
  preset('learning', 'Learning', 'Exploring', 'Architecture & Learning', 'Identity Journeys', 'AI Experiences'),
  // By Ping product
  preset('product-davinci', 'Product · DaVinci', 'DaVinci', 'Identity Journeys', 'Ping products', 'Observability'),
  preset('product-privilege', 'Product · Privilege / Agent Gateway', 'Agent Privilege', 'MCP & Integrations', 'Observability', 'Diagrams'),
  preset('product-authorize', 'Product · PingOne Authorize', 'Authorize', 'Delegation & Consent', 'Observability'),
  preset('product-protect-verify', 'Product · Protect / Verify / MFA', 'Ping products', 'Identity Journeys', 'Utilities'),
  preset('product-aic-idjag', 'Product · AIC + ID-JAG', 'AIC', 'PingFederate ID-JAG', 'Delegation & Consent', 'Diagrams'),
  // By use case
  personalAgentPreset,
  preset('uc-digital-assistant', 'Use case · Digital assistant', 'AI Experiences', 'Jev Demos', 'MCP & Integrations'),
  preset('uc-agent-security', 'Use case · Agent security', 'Agent Privilege', 'AI Experiences', 'MCP & Integrations', 'Observability'),
  a2aPreset,
  preset('uc-delegation', 'Use case · Delegation & OBO', 'Delegation & Consent', 'Authorize', 'Utilities', 'Diagrams'),
  // By demo situation
  preset('exec-10min', 'Exec · 10 minutes', 'Security Dashboard', 'AI Experiences', 'Personal Agents'),
  preset('architecture-walkthrough', 'Architecture walkthrough', 'Diagrams', 'Demo arch slides', 'Architecture & Learning', 'Agent Privilege'),
  preset('workshop', 'Workshop / hands-on', 'Exploring', 'Architecture & Learning', 'AI Experiences'),
  preset('preflight', 'Pre-flight check', 'Utilities', 'Observability'),
];

// A builtin's stored copy is a CACHE of BUILTIN_CONFIGS, never user data:
// createConfig only mints `cfg_*` ids and deleteConfig refuses isBuiltin, so
// nothing can edit one. Seeding only-when-absent therefore meant an edit here
// reached new installs and nowhere else — renaming a nav group left every
// existing install hiding a label that no longer existed, silently. Write
// through instead, keeping createdAt so the age of the preset survives.
function seedBuiltins() {
  const db = _db();
  for (const cfg of BUILTIN_CONFIGS) {
    const prev = db.get(`config:${cfg.id}`);
    // listConfigs() calls this on every read; skip the write when nothing
    // moved so we don't churn LMDB (and updatedAt) on each page load.
    const same = prev
      && JSON.stringify([prev.name, prev.hiddenLabels, prev.flagSnapshot])
         === JSON.stringify([cfg.name, cfg.hiddenLabels, cfg.flagSnapshot]);
    if (same) continue;
    const now = Date.now();
    db.putSync(`config:${cfg.id}`, {
      ...cfg,
      createdAt: prev ? prev.createdAt : now,
      updatedAt: now,
    });
  }
}

function listConfigs() {
  seedBuiltins();
  const db = _db();
  const configs = [];
  for (const { value } of db.getRange({ start: 'config:', end: 'config;' })) {
    if (value) configs.push(value);
  }
  return configs.sort((a, b) => Number(b.isBuiltin) - Number(a.isBuiltin) || a.name.localeCompare(b.name));
}

function getConfig(id) {
  seedBuiltins();
  return _db().get(`config:${id}`) || null;
}

function createConfig(name, hiddenLabels, flagSnapshot) {
  const id = 'cfg_' + crypto.randomBytes(4).toString('hex');
  const now = Date.now();
  const config = { id, name, isBuiltin: false, hiddenLabels, flagSnapshot, createdAt: now, updatedAt: now };
  _db().putSync(`config:${id}`, config);
  return config;
}

function deleteConfig(id) {
  const config = _db().get(`config:${id}`);
  if (!config) return { ok: false, reason: 'not_found' };
  if (config.isBuiltin) return { ok: false, reason: 'builtin' };
  _db().removeSync(`config:${id}`);
  return { ok: true };
}

// New/unconfigured users start with "Use Cases" hidden (the catalog page is
// superseded by "Use Cases (Live)" as the primary entry point) — they can
// re-enable it themselves from Demo Config.
const DEFAULT_HIDDEN_LABELS = ['Use Cases'];

function getUserPrefs(userId) {
  const v = _db().get(`userPrefs:${userId}`);
  return v || { hiddenLabels: DEFAULT_HIDDEN_LABELS, activeConfigId: null, navOrder: null, childOrder: null, updatedAt: null };
}

// navOrder / childOrder: explicit null clears the stored value (Reset order),
// undefined leaves it untouched (callers that only update hiddenLabels).
function setUserPrefs(userId, hiddenLabels, activeConfigId, navOrder, childOrder) {
  const existing = getUserPrefs(userId);
  const prefs = {
    hiddenLabels,
    activeConfigId: activeConfigId || null,
    navOrder: navOrder === null ? null : (Array.isArray(navOrder) ? navOrder : (existing.navOrder || null)),
    childOrder: childOrder === null ? null : (isChildOrder(childOrder) ? childOrder : (existing.childOrder || null)),
    updatedAt: Date.now(),
  };
  _db().putSync(`userPrefs:${userId}`, prefs);
  return prefs;
}

// { [groupLabel]: [childLabel, ...] } — plain object of string arrays.
function isChildOrder(v) {
  return (
    !!v && typeof v === 'object' && !Array.isArray(v) &&
    Object.values(v).every((arr) => Array.isArray(arr) && arr.every((l) => typeof l === 'string'))
  );
}

module.exports = {
  listConfigs, getConfig, createConfig, deleteConfig,
  getUserPrefs, setUserPrefs, isChildOrder,
  seedBuiltins, BUILTIN_CONFIGS, TOP_LEVEL_LABELS, DEFAULT_HIDDEN_LABELS, DB_NAME,
};
