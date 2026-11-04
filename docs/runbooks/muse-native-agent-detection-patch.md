# Muse native agent detection — tenant patch (APPLIED 2026-11-04)

Applied live via pingcli 1.1.0 + worker-token curl. Verified against the API before and after.

## What the wiring was (API-verified)

- Main Muse sign-on flow: `My Username and Password Flow - Muse` (`50dbcce388b71537aebb52a5fd2e7867`), now **v80** (was v79)
  - node `0skvu46t4m` → startSubFlow → the Muse risk subflow
  - node `1exlfdvbw6` "Did Protect flag the agent?" → `museAgentLevel == HIGH` → "Muse Agent Detected (Protect)" screen; else "Muse Agent Detected (Bot)" screen
  - node `nfadrh7zj9` custom function keys on the PingOne app id (client-id heuristic) — unchanged
- Risk subflow returned claims: `riskLevel, riskEvalId, museAgentLevel, museAgentReason, botLevel, botReason`
  - `botLevel/botReason` = `rawResponse.details.botDetection.{level,reason}`

## What changed

1. **Cloned** `MOB_TST_Risk_Subflow_ORG_muse` (c7b9db340e42d014b22001c2a54cac32, v14) →
   `MOB_TST_Risk_Subflow_ORG_muse-native` (`eddb00c817d1d6566b9d6b1850309f65`), **v1 deployed**.
2. **Added two claims** to all four createSuccessResponse nodes of the clone
   (`2rlo2t5v0e`, `a1a1ddacyj`, `uesq938o0x`, `izt7p6j8vo`):
   - `agentRuleId`   = `{{local.bw32baevv6.payload.output.rawResponse.details.botDetection.detected.rule.id}}`
   - `agentRuleName` = `{{local.bw32baevv6.payload.output.rawResponse.details.botDetection.detected.rule.name}}`
   - Expected native values: rule id `674`, name `AI agent - Muse detected` (when the hosted page's
     Signals SDK ≥ 5.6.10 sends `agentIdentification`; other native rules 660/661/663/664/665/666).
3. **Repointed** the main flow's subflow node `0skvu46t4m` to the clone and **deployed v80**.
   Live v79→v80 diff: subflow pointer only. The live v14 subflow remains untouched for rollback.

## Rollback

PUT the main flow's node `0skvu46t4m.subFlowId` back to
`{"label":"MOB_TST_Risk_Subflow_ORG_muse","value":"c7b9db340e42d014b22001c2a54cac32"}` (v14) and redeploy.

## Tooling notes

- `pingcli pingone davinci flows clone|replace|deploy` work, but `flows get/list` fails on
  294-node flows (unmarshal bug: "no value given for required property grabbable").
  Workaround: raw `curl` with a worker token for reads, pingcli for writes.
- `pingcli pingone api` on the flows path 403s with a bogus "Invalid key=value pair in
  Authorization header" — a pingcli bug in its custom-request auth, not a tenant issue.
- The subflow's `createRiskEvaluation` node (`bw32baevv6`) supplies `rawResponse`.
