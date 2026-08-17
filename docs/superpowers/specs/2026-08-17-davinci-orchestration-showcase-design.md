# DaVinci Orchestration Showcase — Design

## Context

Part 1 of the approved AI-orchestration plan (`~/.claude/plans/need-a-plan-on-adaptive-micali.md`) originally wired PingOne DaVinci in as a single-hop pass-through to PingOne Authorize (P1AZ) for transaction step-up and MCP tool authorization, plus a net-new login flow. On review, that under-sells DaVinci: the transaction/tool-authz flows' own embedded descriptions say they "wrap the same P1AZ policy call" — no different from calling P1AZ directly, just an extra hop. A demo built that way answers "does DaVinci work" but not "why would anyone pay for it."

Competitive research (Okta Workflows, Auth0 Actions, Microsoft Entra ID Governance) shows DaVinci's real differentiation is never "it can call one policy engine" — it's:
- **Vendor-agnostic breadth** — 350+ connectors spanning identity services AND business/IT systems (Slack, Twilio, ServiceNow, generic HTTP), vs. Okta Workflows (locked to Okta ecosystem) or Auth0 Actions (code-based extensibility, not visual/no-code)
- **Visual multi-system branching** — one canvas chaining several connector types with conditional logic, vs. Entra ID Governance (strong only inside Azure)
- **Flow versioning / A-B testing** — compare live flow variants without redeploying an app
- **Deployment flexibility** — SaaS/self-managed/hybrid, a differentiator over cloud-only competitors

None of that shows in a flow that only touches one connector. This spec redesigns the transaction step-up and login legs to actually chain multiple connector types, and makes "run the same scenario without DaVinci" a first-class, presenter-facing comparison rather than just a safety fallback flag.

## Goals

1. Transaction step-up flow demonstrably orchestrates across identity (SSO, Protect, MFA) AND a business-system connector (notification), not just P1AZ.
2. Login flow demonstrates risk-adaptive branching and is authored as two versions to show DaVinci's A/B/version-compare capability.
3. A presenter can run the identical business scenario two ways back-to-back — hand-coded direct-call path vs. DaVinci-orchestrated path — from one toggle, with both producing the same outcome for the same inputs.
4. The existing hand-coded paths (`transactionConsentChallenge.js`, `oauth.js`/`oauthUser.js`) stay fully intact, untouched, and are what runs when DaVinci is off — the demo never *requires* DaVinci to function.

## Non-goals

- MCP tool authorization leg (original Leg 3) stays as designed — a fast M2M policy gate check is honestly a single-connector, low-latency use case; padding it with unrelated connectors would be dishonest in the other direction. No change to that leg.
- Not building a general-purpose DaVinci flow library — two flows (transaction step-up, login), each showcasing a different orchestration dimension, is the full scope.
- Not touching the protected redirect-OIDC login (`routes/oauth.js`, `routes/oauthUser.js` — REGRESSION_PLAN §1) as an implementation detail — it's exactly the "without DaVinci" comparison baseline and must keep working unmodified.

## Architecture

### Component 1 — Transaction step-up: multi-connector DaVinci flow

Extends `docs/Super_Banking_Transaction_Authorization_DaVinci.json` (imported as the skeleton — its Decision Router and Amount-threshold branches already exist) rather than replacing it. The Step-Up branch, which today would just return a bare `STEP_UP` status, gets built out in DaVinci Studio to:

1. **PingOne SSO connector** — look up the user (already in the JSON's connector list)
2. **PingOne Protect connector** — Evaluate node, real risk score (new)
3. **Branch on risk**: LOW → PingOne Authorize decision → Permit. MEDIUM/HIGH → continue:
4. **PingOne MFA connector** — step-up challenge (new)
5. **Generic HTTP connector** as the notification step — POSTs to a new `demo_api_server` "fraud queue" endpoint in parallel with the MFA challenge (new). Chosen over Twilio/Slack to keep the demo self-contained (no external account/credentials to provision or fail mid-demo) while still proving the point: DaVinci reaching into an arbitrary business system via a generic connector, not just PingOne services — this is the business-system-integration beat competitors can't match as cleanly
6. **PingOne Authorize connector** — final decision (already in the JSON)
7. **Generic HTTP connector** — callback into a new demo_api_server webhook endpoint so the result shows up in the existing audit trail UI (new) — modeled on the existing `routes/webhookPingOne.js` receiver pattern (same shape: authenticated POST, write to the LMDB-backed event store already powering `/monitoring/pingone-events`)

### Component 2 — Login: risk-adaptive, two-version DaVinci flow

New flow (no existing artifact), authored in DaVinci Studio per the Login flow pattern, invoked via the `@forgerock/davinci-client` Widget SDK exactly as the original plan's Leg 4 described (new demo page, does not touch `routes/oauth.js`). Two differences from the original Leg 4 design:

- **PingOne Protect Evaluate** runs inline before the credential check, branching LOW risk → passkey/passwordless path, MEDIUM/HIGH risk → password + mandatory MFA step-up. This is the same friction-tier pattern from the ping-orchestration skill's passwordless reference, now actually wired instead of a bare username/password form.
- **Two deployed flow versions** (e.g., v1 = MFA-always, v2 = risk-adaptive as above) under one DaVinci Application, so the demo can show DaVinci's version/A-B comparison surface — flip between them live without redeploying the app.

### Component 3 — "Without DaVinci" comparison toggle

New: a `davinci_orchestration_mode` config value (`off` default / `on`), same admin-flag mechanism as everything else in this repo (`configStore` + `routes/featureFlags.js`). When `off`, the demo runs exactly the current hand-coded paths — `transactionConsentChallenge.js`'s existing 4-step OTP state machine (`routes/transactions.js:677` 428 enforcement, untouched) and the protected redirect login. When `on`, the same UI action instead calls the DaVinci flow client (Component 4) for that one scenario. This is presented in the UI as a visible mode indicator (not just a hidden dev flag) so a presenter can narrate "here's the hand-written version… now flip this… here's the same outcome, built in DaVinci with zero backend code for the fraud-notification step."

### Component 4 — Shared DaVinci API/Widget client

Unchanged from the original plan's Leg 1/Leg 0: `demo_api_server/services/davinciFlowClient.js` (API invocation for the transaction flow) and `@forgerock/davinci-client` (Widget invocation for login), `config/davinci.js` for env vars. Console setup (Leg 0) gains the new connector instances this design needs: PingOne Protect, PingOne MFA, and one notification connector (Twilio or generic HTTP/Slack), alongside the already-planned PingOne Authorize and PingOne SSO instances.

## Data flow (transaction step-up, DaVinci-on path)

```
User submits transfer > $threshold
  -> demo_api_server calls davinciFlowClient.invokeFlow('transactionAuthorization', {Amount, TransactionType, Username})
  -> DaVinci: SSO lookup -> Protect risk eval
  -> [LOW risk]  -> Authorize -> PERMIT  -> flow returns {decision: PERMIT}
  -> [MED/HIGH]  -> MFA challenge (parallel: Generic HTTP connector posts to fraud-queue endpoint)
                 -> user completes MFA in DaVinci-hosted step (or flow polls)
                 -> Authorize -> PERMIT/DENY -> flow returns {decision, stepUpCompleted: true}
  -> DaVinci calls back demo_api_server's new webhook endpoint (audit trail write)
  -> demo_api_server receives flow's terminal response, applies decision to the transaction
```

## Error handling

Same posture as the original plan: any DaVinci API failure (timeout, malformed response) fails closed — `davinci_orchestration_mode=on` falls back to the existing hand-coded HITL path for that single request rather than blocking the transaction, and logs the fallback via `appEventService` (same pattern `a2aOrchestratorService.js` uses for its LLM→heuristic fallback). This keeps the "runs without DaVinci" guarantee true even mid-demo if the DaVinci API is unreachable.

## Testing / verification

- Unit: `davinciFlowClient.invokeFlow` mocked-response tests (unchanged from original Leg 1 plan) plus a new test for the fail-closed fallback path.
- `davinci_orchestration_mode=off`: full existing `demo_api_server` suite must be unaffected — this is the regression guarantee for REGRESSION_PLAN §1's "Transfer HITL enforcement."
- `davinci_orchestration_mode=on`, manual: walk both the hand-coded and DaVinci-orchestrated paths back-to-back for the same transaction amount/vertical (Super Sports), confirm identical final decision and that the audit trail webhook receives the DaVinci-path event.
- Login: manual walk of both deployed flow versions via the widget page, confirm risk branch actually changes which challenge renders.

## What stays exactly as originally planned

- Leg 0 console setup mechanics (import JSON, deploy, configure Decision Router branches) — extended with the new connector instances above, not replaced.
- Leg 3 (MCP tool authorization) — no change.
- Leg 1 (`davinciFlowClient.js`) — no change to its shape, reused as-is by the enriched transaction flow.
