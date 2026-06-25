# PingOne Authorize — Trust Framework rule for receipt-aware PERMIT (`HitlApproved`)

**Date:** 2026-05-29
**Status:** Required console config — the live-PingAuthorize code path is INERT without it.
**Scope:** PingOne Authorize console only (no repo code). Pairs with the simulated
engine, which already enforces this rule in JS.

---

## Why this exists

The receipt-aware PERMIT feature lets a verified HITL approval discharge the
HITL_CONSENT gate on an agent's retry. In **simulated** mode
(`ff_authorize_simulated=true`, the default demo) the discharge is hard-coded in
`simulatedAuthorizeService.evaluateMcpFirstTool` — when a verified receipt is
present it suppresses the HITL_CONSENT candidate so the shared classifier yields
PERMIT.

In **live** mode, `pingOneAuthorizeService.evaluateMcpToolDelegation` only
FORWARDS a decision parameter: it adds `HitlApproved: true` to the decision
endpoint request body's `parameters` when (and only when) the BFF gate has
verified an approved, caller-bound receipt against the canonical HITL service
(3009). **The code does not decide PERMIT — the PingOne Authorize policy must.**
If the deployed Trust Framework has no rule keying off `HitlApproved`, a verified
retry forwards the flag but the policy still returns INDETERMINATE → the gate
re-challenges → the user is stuck in a 428 loop. So live mode is inert until the
rule below is added.

This is the documented sim↔live parity requirement: both engines must produce the
same verdict for the same inputs.

## What the BFF sends (live path)

POST `…/decisionEndpoints/{authorize_mcp_decision_endpoint_id}` with body:

```json
{ "parameters": {
    "DecisionContext": "McpFirstTool",
    "UserId": "<sub>",
    "ToolName": "create_transfer",
    "TokenAudience": "<aud>",
    "ActClientId": "<act.client_id||act.sub>",
    "NestedActClientId": "<act.act.*>",
    "McpResourceUri": "<expected aud>",
    "HitlApproved": true            // present ONLY on a verified retry
} }
```

`HitlApproved` is emitted only when true (conditional spread), matching `Acr`.

## Trust Framework changes (console)

1. **Add an attribute** `HitlApproved` (Boolean), resolved from the decision
   request `parameters.HitlApproved`. Default/absent → treat as `false`.

2. **Amend the MCP consent rule.** Where today the rule is effectively:
   - `TransactionAmount >= confirm_threshold → INDETERMINATE (HITL_CONSENT obligation)`

   split it on `HitlApproved`:
   - `TransactionAmount >= confirm_threshold AND HitlApproved != true → INDETERMINATE (HITL_CONSENT)`
   - `TransactionAmount >= confirm_threshold AND HitlApproved == true → PERMIT`

3. **Do NOT let `HitlApproved` discharge step-up.** The step-up (MFA) rule must
   remain independent of `HitlApproved`:
   - `TransactionAmount >= stepup_threshold AND acr-not-strong → STEP_UP` regardless of `HitlApproved`.

   A receipt is human approval, not an MFA. The simulated engine enforces this by
   letting STEP_UP win before the consent branch; the policy must match.

4. **Audience-mismatch / DENY rules win first.** `HitlApproved` must not override
   the step-skipping (audience) DENY or the hard deny-amount DENY.

## Anti-replay note (out of policy scope)

`HitlApproved` is a bare boolean to the policy — the policy trusts it. The
*provenance* (that an approved challenge exists AND is bound to this user, agent,
and tool) is enforced **before** the flag is ever set, in the BFF/gateway via
`hitlServiceClient.verifyHitlReceipt` (3009). The policy cannot and need not
re-verify the receipt; do not attempt to read the challenge id in the policy.

## Verification

- Simulated mode already passes its parity/unit tests (the JS discharge rule).
- After the console rule is added, exercise live mode end-to-end:
  retry with an approved receipt → forwarded `HitlApproved:true` → policy PERMIT →
  tool runs (no second 428). Confirm a step-up-threshold amount still returns
  STEP_UP even with `HitlApproved:true`.
