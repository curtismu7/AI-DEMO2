# Muse native agent detection — tenant patch (APPLIED 2026-11-04)

Applied live via pingcli 1.1.0 + worker-token curl; every step verified against the API and a live sign-in drive.

## Final state

- **Risk subflow** `MOB_TST_Risk_Subflow_ORG_muse` (`c7b9db340e42d014b22001c2a54cac32`) **v15 deployed**:
  all four `createSuccessResponse` nodes (`2rlo2t5v0e`, `a1a1ddacyj`, `uesq938o0x`, `izt7p6j8vo`)
  now return two extra claims sourced from the Protect raw response:
  - `agentRuleId`   = `{{local.bw32baevv6.payload.output.rawResponse.details.botDetection.detected.rule.id}}`
  - `agentRuleName` = `{{local.bw32baevv6.payload.output.rawResponse.details.botDetection.detected.rule.name}}`
  - Native values when the agent is identified: rule `674` "AI agent - Muse detected"
    (sibling native rules: 660 generic, 661 ChatGPT, 663 Manus, 664 Claude, 665 Skyvern, 666 Anchor;
    require Signals SDK ≥ 5.6.10 with `agentIdentification` on the sign-on page).
- **Main Muse sign-on flow** `My Username and Password Flow - Muse` (`50dbcce388b71537aebb52a5fd2e7867`) **v82 deployed**:
  new Functions trigger node `nativ3AgentRuleChk` ("Native AI-agent rule fired?", AEqualsMultipleB:
  `agentRuleId` ∈ {660,661,663,664,665,666,674}), wired in parallel with the existing heuristic:
  `bizwr5jp6a` → `nativ3AgentRuleChk` → `oa82clnrlo` ("Muse Agent Detected (Protect)" screen).
  The original client-id heuristic (`1exlfdvbw6` `museAgentLevel == HIGH`) is untouched.

## Verified

- Human sign-in (demouser) completes end-to-end on v82: authorize → sign-on form → auth code.
  Heuristic agent screen path unchanged.
- Untouched AI-Demo user flow also verified working (isolation control).

## What NOT to do (learned the hard way)

- Repointing the main flow's `subFlowId` node (`0skvu46t4m`) to a CLONE of the subflow
  (`MOB_TST_Risk_Subflow_ORG_muse-native`, `eddb00c817d1d6566b9d6b1850309f65`) broke the
  sign-in: the form submitted but the flow never advanced (blank screen). The clone remains
  in the tenant, unused — safe to delete. In-place additive edits to the live subflow and
  additive node/edge edits to the live main flow both deployed and worked.

## Rollback

- Subflow: PUT the v14 graph back and deploy (claim removal only).
- Main flow: PUT the v81 graph back (removes node `nativ3AgentRuleChk` + its two edges) and deploy.
- v80 (broken repoint) was fully rolled back during the session; v81 = pre-patch wiring.

## Tooling notes

- `pingcli pingone davinci flows clone|replace|deploy` work; `flows get|list` fail on large
  flows (unmarshal bug: "no value given for required property grabbable"). Workaround:
  raw `curl` with a worker token for reads, pingcli for writes.
- `pingcli pingone api` on the flows path 403s with a bogus "Invalid key=value pair in
  Authorization header" — a pingcli custom-request auth bug, not a tenant issue.
- Deploy via curl POST `/flows/{id}/deploy` 403s; use `pingcli davinci flows deploy`
  (its unmarshal failure is response-parsing only — the deploy succeeds).

## v83 addendum (same day): IAF flag on the sign-on form

- `isIAFDetectionEnabled: {value: true}` added to the Sign On showForm node
  (`1azylcnorz`, form 6ce9b9fb…) of the main flow → **v83 deployed**.
- Full real Muse flow re-verified live on v83: 401 → sign-in → heuristic
  "AI agent detected" screen (predictor museAgentClient = HIGH, evaluation
  c63dfbcf-52ff-4299-8c85-e2698a18a324) → consent → both token exchanges 200.
  The parallel native branch did not double-trigger for a human browser.
- Rule 674 firing still requires a REAL Muse CUA agent session (the native
  rules key on agent TTPs, not just the app id); the branch is armed and will
  route to the same agent screen when Protect natively names the agent.
- Note: risk-evaluation reads via the worker token 403 (Protect-scoped
  token needed) — server-side evaluation introspection was not possible.
