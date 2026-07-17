// setupDefaults.js
// Single source of truth for setup-wizard form defaults that must not drift
// independently across SetupPage.js, SetupWizard.js, and SetupWizardTab.js.
// This mirrors the *initial-setup-wizard-only* default; the live runtime
// default (once a server exists) is demo_api_server/config/runtimeSettings.js's
// own STEP_UP_ACR_VALUE fallback -- the two are independent by design (see
// docs/superpowers/specs/2026-07-16-settings-consolidation-design.md).
export const DEFAULT_STEP_UP_ACR_VALUE = 'Multi_Factor';
