/**
 * Presenter Demo script — catalog ids in walkthrough order.
 * Shared by UseCaseLauncherPage (/use-cases Demo section) and the agent
 * "Demo steps" dropdown so both lists stay identical.
 *
 * Primary = trust-ladder walkthrough (expanded).
 * Advanced = CIBA / A2A / attack deep-dives (collapsed "More demos").
 * Attacks + Testing chips live in the Actions popout, not here.
 */
export const DEMO_PRIMARY_USE_CASE_IDS = [
  'UC1',   // Full flow — delegated access
  'UC8',   // Consent HITL
  'UC7',   // MFA step-up
  'UC14b', // Intent (RAR verified)
  'UC12',  // DPoP / replay defense
  'UC6',   // Authz DENY
];

export const DEMO_ADVANCED_USE_CASE_IDS = [
  'UC2',   // A2A delegation
  'UC2.5', // A2A orchestrator learning
  'UC22',  // CIBA out-of-band
  'UC5',   // Insufficient scope
  'UC10',  // Cross-owner
  'UC13',  // Confused deputy
  'UC11',  // Bad client gateway
  'UC20',  // Audit trail
  'UC18',  // Rate-limit / throttle burst
  'UC29',  // OAuth fail-closed
  'UC30',  // Weather MCP — Texas permit
  'UC31',  // Weather MCP — out-of-scope deny
  'UC32',  // Weather MCP — live-reconfigure the gateway scope
];

/** Flat list for callers that only need order (primary then advanced). */
export const DEMO_USE_CASE_IDS = [
  ...DEMO_PRIMARY_USE_CASE_IDS,
  ...DEMO_ADVANCED_USE_CASE_IDS,
];

/**
 * PingOne Admin vertical's demo-steps ids. Served by a separate backend
 * list (demo_api_server/config/admin/demoSteps.js), not the 22-use-case
 * banking catalog — see docs/superpowers/specs/2026-07-19-pingone-admin-demo-steps-design.md.
 */
export const ADMIN_PRIMARY_USE_CASE_IDS = ['ADMIN1', 'ADMIN2', 'ADMIN3', 'ADMIN4'];

/** Section heading used on /use-cases for this script. */
export const DEMO_USE_CASE_LABEL = 'Demo — a scripted walkthrough';
