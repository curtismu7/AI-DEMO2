'use strict';

/**
 * Tier (groupToTier) local enforcement — mirrors decision.js Rule 3d
 * (demo_authz_server/routes/decision.js:823-855). Real P1AZ cannot map a
 * PingOne group ARRAY to a tier (no set-membership operator,
 * snapshots/gen-authorize-snapshot.js:44-47), so the BFF pre-resolves the
 * tier and its definition and forwards them as headers; this only compares.
 * Absence of tier data is not a violation — this backstop only ever narrows
 * access relative to what the token's own scopes already earned, never widens it.
 */
export function evaluateTierDecision(
  toolName: string,
  isWriteTool: boolean,
  amount: number | undefined,
  maxAmountUsd: number | undefined,
  restrictedTools: string[],
): { decision: 'PERMIT' } | { decision: 'DENY'; reason: string } {
  if (restrictedTools.includes(toolName)) {
    return { decision: 'DENY', reason: `tier_tool_not_allowed: "${toolName}" is not permitted at this tier` };
  }
  if (isWriteTool && typeof maxAmountUsd === 'number' && typeof amount === 'number' && amount > maxAmountUsd) {
    return { decision: 'DENY', reason: `tier_amount_exceeded: ${amount} exceeds tier ceiling ${maxAmountUsd}` };
  }
  return { decision: 'PERMIT' };
}

/** Parses the comma-joined X-Tier-Restricted-Tools header. Empty/absent -> []. */
export function parseRestrictedTools(header: string | undefined): string[] {
  return String(header || '').split(',').map((s) => s.trim()).filter(Boolean);
}
