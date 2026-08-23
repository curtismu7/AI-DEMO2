// demo_api_ui/src/services/enterpriseMcpDemoFlags.js
//
// Arm / reset for the Enterprise-Managed MCP Authorization demo.
//
// Native ID-JAG is configured permanently in docker-compose on BOTH services
// (oauth-mcp reads it from process.env, which no UI toggle could ever set), so
// the only runtime switch is this single boolean flag. Any logged-in user can
// flip it — /api/admin/feature-flags is gated by authentication, not by admin.
//
// Deliberately scoped to ONE flag id. The same instinct as the existing
// POST /api/admin/reset-demo, whose comment says it is "not a general reset
// every flag feature": a demo control that can reach arbitrary flags is a demo
// control that can turn off signature validation.

import apiClient from "./apiClient";

export const DEMO_FLAG_ID = "ff_enterprise_managed_mcp_auth";

const FLAGS_URL = "/api/admin/feature-flags";

/** The API returns booleans as either real booleans or "true"/"false" strings. */
function isOn(value) {
  return value === true || value === "true";
}

/**
 * Current armed state. Never throws — a failed read reports "not armed" so the
 * page renders a Start button rather than an error wall.
 * @returns {Promise<boolean>}
 */
export async function readEnterpriseMcpDemoState() {
  try {
    const res = await apiClient.get(FLAGS_URL);
    const flags = res?.data?.flags || [];
    const flag = flags.find((f) => f && f.id === DEMO_FLAG_ID);
    return isOn(flag?.value);
  } catch {
    return false;
  }
}

/** Turn the demo on. */
export async function armEnterpriseMcpDemo() {
  await apiClient.patch(FLAGS_URL, { updates: { [DEMO_FLAG_ID]: true } });
}

/**
 * Turn the demo off. ALWAYS off — never "back to whatever it was".
 *
 * An earlier version restored the flag's pre-demo value, meaning a presenter
 * who already had enterprise mode on would click Reset and see nothing change.
 * Reset has one job: leave the machine safe for the next demo. The existing
 * POST /api/admin/reset-demo resets to registry defaults for the same reason.
 */
export async function resetEnterpriseMcpDemo() {
  await apiClient.patch(FLAGS_URL, { updates: { [DEMO_FLAG_ID]: false } });
}
