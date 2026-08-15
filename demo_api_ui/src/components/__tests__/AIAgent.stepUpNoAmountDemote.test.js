/**
 * Canary: mcp_step_up_required must never be demoted to consent by amount.
 *
 * #1788 added a UI "defense-in-depth" that treated step_up_required with
 * transactionAmount < MFA_DEFAULT as consent. That routed into
 * TransactionConsentModal → createTransferWithConsent (REST), which for the
 * $300 HITL band completes without MFA — converting a server-mandated step-up
 * into a consent-only transfer.
 *
 * Sub-threshold MCP-gate step-up is demoted to HITL on the BFF
 * (mcpToolAuthorizationService._applyTransactionPolicy). The UI must always
 * open P1MFA for a genuine step_up_required error.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../AIAgent.js'),
  'utf8',
);

describe('AIAgent step-up gate — no amount demotion', () => {
  it('isStepUpGate does not gate MFA on transactionAmount vs MFA_DEFAULT', () => {
    // The demotion block keyed MFA on transactionAmount >= MFA_DEFAULT. Keep
    // the step-up branch amount-agnostic.
    expect(src).not.toMatch(
      /isStepUpGate[\s\S]{0,400}MFA_DEFAULT/,
    );
    expect(src).toMatch(
      /const isStepUpGate =\s*\n\s*response\.error === "step_up_required" \|\|\s*\n\s*response\.error === "mcp_step_up_required";/,
    );
  });
});
