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
];

/** Flat list for callers that only need order (primary then advanced). */
export const DEMO_USE_CASE_IDS = [
  ...DEMO_PRIMARY_USE_CASE_IDS,
  ...DEMO_ADVANCED_USE_CASE_IDS,
];

/** Section heading used on /use-cases for this script. */
export const DEMO_USE_CASE_LABEL = 'Demo — a scripted walkthrough';
