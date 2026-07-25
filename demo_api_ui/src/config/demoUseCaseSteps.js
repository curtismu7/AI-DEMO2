/**
 * Presenter Demo script — catalog ids in walkthrough order.
 * Shared by UseCaseLauncherPage (/use-cases Demo section) and the agent
 * "Demo steps" dropdown so both lists stay identical.
 *
 * Primary = all 19 steps shown in the 5×4 visible grid.
 * Advanced = empty (nothing hidden).
 * Attacks + Testing chips live in the Actions popout, not here.
 */
export const DEMO_PRIMARY_USE_CASE_IDS = [
  'UC1',   // Full flow — delegated access
  'UC8',   // Consent HITL
  'UC7',   // MFA step-up
  'UC14b', // Intent (RAR verified)
  'UC12',  // DPoP / replay defense
  'UC6',   // Authz DENY
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

export const DEMO_ADVANCED_USE_CASE_IDS = [];

/**
 * 15-Min Security demo script — the exact tiles that script runs, in order,
 * gathered into one workbench group so the presenter doesn't hunt across
 * tracks. This list IS the teleprompter script order (demoScript.js) 1:1, so
 * step N here == beat N there. Mostly duplicates ids in DEMO_PRIMARY; UC24 and
 * UC14 are the two not there. Consumed only by LiveUseCaseWorkbenchPage.
 * Flag-gated tiles (UC2, UC14/UC14b) auto-arm their flag on run — see the
 * maturity→flag arming in routes/useCases.js and attackSimulatorService.js.
 */
export const SECURITY_DEMO_USE_CASE_IDS = [
  'UC1',   // show my balance → PERMIT (act claim)
  'UC2',   // hand off to a specialist → PERMIT (nested-act A2A chain), ff_a2a_delegation
  'UC24',  // branches near me → public PERMIT (no exchange)
  'UC6',   // transfer $2500 → DENY
  'UC8',   // transfer $300 → HITL
  'UC14b', // PAR within cap → PERMIT (intent-binding page), ff_rar
  'UC14',  // PAR over cap → DENY (rar-exceeded attack sim), ff_rar
  'UC31',  // weather Miami → gateway DENY
  'UC12',  // DPoP / replay attack sim → DENY_401
  'UC5',   // insufficient scope attack sim → DENY_403
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
