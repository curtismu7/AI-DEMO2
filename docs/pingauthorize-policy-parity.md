# PingAuthorize policy parity — aud-match rule

**Date added:** 2026-05-13
**Companion to:** [docs/token-flow-audit.md](token-flow-audit.md)
**Related code:** `banking_api_server/services/simulatedAuthorizeService.js` (Phase 1 enforcement),
`banking_api_server/services/mcpToolAuthorizationService.js` (caller — picks the right expected aud per FF).

## Why this doc exists

The Super Banking demo runs **two parallel authorization-server (AS) implementations**, picked at runtime via `ff_authorize_simulated`:

| FF value | Active AS |
|---|---|
| `true` | `simulatedAuthorizeService` (in-process JS) |
| `false` (default) | `pingOneAuthorizeService` (calls PingAuthorize PAZ via decision-endpoint POST) |

Both must produce **identical decisions** for the same inputs (`tokenAudience`, `actClientId`, `nestedActClientId`, `mcpResourceUri`, `userId`, `toolName`, `acr`, `amount`, `transactionType`). Phase 1 (commit landed 2026-05-13) added an audience-match guard to the simulated AS — when `tokenAudience` doesn't include `mcpResourceUri`, it returns `DENY` with reason "possible step-skipping."

**The PingAuthorize policy must enforce the same rule** to maintain parity. PingAuthorize policy logic lives in the PingOne Console (Trust Framework / Authorization Policies), not in our codebase, so it cannot be provisioned programmatically. This doc describes the rule a PA admin must add.

## The rule

In whichever PingAuthorize policy is referenced by `authorize_mcp_decision_endpoint_id`:

```
IF NOT contains(parameters.TokenAudience, parameters.McpResourceUri)
THEN DENY
WITH advice obligation reason = "Audience mismatch — possible step-skipping"
```

In Trust Framework expression syntax (approximate — verify against PingOne docs):

```spel
not (parameters.TokenAudience matches parameters.McpResourceUri)
```

Or as a structured rule:

- **Effect:** `DENY`
- **Condition:** `parameters.TokenAudience` does not contain `parameters.McpResourceUri`
- **Priority:** highest (runs before tool-name allow/deny rules)

## Why this matters

**Catches step-skipping attacks.** Without this rule, an attacker who obtains an intermediate-step exchange token (e.g. `aud=intermediate.2x.ping.demo` from Two-Exchange Step 2) could send it directly to the MCP server and bypass Step 4's narrowing.

The simulated AS enforces this. PingAuthorize must match — otherwise switching `ff_authorize_simulated` from `true` to `false` silently loosens the policy.

## Verification

After adding the rule to PingAuthorize policy:

1. Set `ff_authorize_simulated=false` in `.env`.
2. Restart BFF.
3. Click any chip from the dashboard.
4. Live session log:
   ```bash
   grep "PingOne Authorize.*decision" /tmp/bank-api-server.log
   ```
   should show `decision: PERMIT` for normal chip clicks.
5. Manual negative test — synthesize a Step 2 token (audience `intermediate.2x.ping.demo`) and call `POST /api/mcp/tool` with it. PingAuthorize should `DENY` with the audience-mismatch reason.
6. Compare against simulated — flip FF to `true`, repeat steps 4-5. The decision strings should match.

## Open question

The provisioner currently does NOT create a PingAuthorize Trust Framework policy. It creates **decision endpoints** (in `pingOneAuthorizeService.provisionDemoDecisionEndpoints`) and links them to a `policyId` the operator already has. If your environment doesn't have a PA policy yet:

1. Create one in PingOne Console → Authorization Policies → Add Policy.
2. Add the audience-match rule above as the highest-priority condition.
3. Add a Trust Framework attribute `parameters.TokenAudience` mapped to the request input of the same name.
4. Add a Trust Framework attribute `parameters.McpResourceUri` mapped to the request input of the same name.
5. Save and publish the policy.
6. Copy the policy ID into `authorize_policy_id` in your `.env`.
7. Restart BFF.

If/when PingOne exposes a Management API for writing Trust Framework policies, the provisioner can be extended to do this automatically. As of 2026-05-13 our investigation found the decision-endpoint creation API but not a policy-write API.

## Related

- `simulatedAuthorizeService.js` — the in-process AS that enforces this rule today
- `mcpToolAuthorizationService.js` — caller; picks the expected aud per FF
- `src/__tests__/simulatedAuthorizeService.test.js` — 4 tests that lock the rule in
- `docs/token-flow-audit.md` — the broader audit that surfaced the parity gap
