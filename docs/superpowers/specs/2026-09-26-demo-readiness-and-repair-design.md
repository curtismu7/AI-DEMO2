# Demo Readiness and Repair Design

## Status

Approved for implementation. The task sequence and commit checkpoints are in [the implementation plan](../plans/2026-09-27-demo-readiness-and-repair.md).

## Goal

Give presenters one repeatable way to bring the demo environment into a known-good state and prove that all 46 Demo Steps use cases work before a presentation, within a 15-minute wall-clock limit.

The readiness run covers both local Docker and hosted SE. It exercises every use case in the complete 46-case Demo Steps inventory and applicable vertical variant through both PingOne session login and PingFederate session login. It also verifies the native PingFederate ID-JAG journey. A run is ready only when every required check and every demo step on each target has the expected result. If the full repair-and-verification run cannot finish within 15 minutes, it returns NOT READY with the remaining work listed.

The same readiness workflow is available as a command the user can run directly and through **Admin → Reset Demo**. It audits first, previews safe configuration repairs, requires one administrator confirmation, applies those repairs, and reruns the checks. The Admin reset clears demo state and signs out only after readiness passes.

## Current repository behavior

- Derive the 46-case inventory from the actual Demo Steps UI sources: the 24 `DEMO_PRIMARY_USE_CASE_IDS`, the four additional IDs in `CIAM_AGENT_TYPE_USE_CASE_IDS` after removing the repeated UC2, the six additional unique IDs in `PRIVILEGE_USE_CASE_IDS`, and `ADMIN1`–`ADMIN12` from `ADMIN_PRIMARY_USE_CASE_IDS`. `ADMIN13` opens a page rather than running a use case. Cross-check each listed ID against its backend catalog (`USE_CASES` or `ADMIN_DEMO_STEPS`) and fail on missing or duplicate entries.
- `scope-topology.json` is the source of truth for resources, audiences, scopes, app grants, and tool scope relationships.
- `npm run topology:verify` checks several local topology and generated-config contracts. `npm run topology:verify:live` adds a live PingOne scope configuration comparison.
- `npm run demo:health-gate` checks local runtime health and selected auth invariants; its full UC2 flow is opt-in. `npm run demo:preflight` checks network/metadata reachability and does not prove authenticated tool invocation.
- The current live scope verifier is read-focused and does not reconcile every kind of drift. Existing startup reconciliation can add some scopes, grants, or resources, so the new workflow must account for those mutations instead of allowing unpreviewed repairs.
- The live Authorize policy readiness check verifies configured decision endpoint IDs. Current worker credentials cannot read or edit the complete live policy tree. Because the requested gate includes the policy configuration itself, unavailable policy readback is a blocker for full READY, even if observed demo decisions pass.
- The current `/api/admin/reset-demo` route is used by more than the Admin sidebar and is not an appropriate place to add tenant-wide privileged repairs. Admin sidebar Reset Demo needs a separate admin-only workflow; the dashboard reset and account resets keep their existing behavior.
- The selected OAuth provider is process-wide configuration, while a login records the provider in the resulting session. The readiness runner must not flip that shared setting under active demo traffic.

## User-approved decisions

- Cover both local Docker and hosted SE.
- Cover all 46 actual use-case entries in the Demo Steps UI: primary, CIAM additions, Privilege-group entries, and Admin1–12. Treat Admin13 as navigation, not a use case.
- Complete audit, safe repair, full verification, reset, and report within 15 minutes; target 12 minutes to leave contingency.
- Exercise PingOne session login and PingFederate session login for each demo step.
- Exercise native PingFederate ID-JAG for UC40, the current catalog contract. For other PingFederate steps, verify the standard exchange path and verify that they do not emit native ID-JAG evidence.
- Repair unambiguous drift from repository source of truth. Show the exact proposed changes and require one administrator confirmation before applying them.
- Connect the privileged workflow only to Admin sidebar **Reset Demo**. The user can also run the readiness command directly.
- A failed, unknown, or untested required step cannot produce a ready result.

## Proposed design

### 1. One readiness service with two entry points

Implement one orchestration service owned by the BFF, which is the sole browser-token custodian. Expose it through:

1. A root command such as `npm run demo:ready`, for a user to run before a demo.
2. An admin-only asynchronous API job used by Admin sidebar **Reset Demo**.

Both entry points call the same orchestration logic. The HTTP route invokes application code directly; it does not launch a shell command. The job API returns a job ID and progress/results so the long full matrix does not depend on one request remaining open.

The command runs both targets by default. An explicit local-only or SE-only diagnostic may be supported, but its result is labeled for that target only and cannot be reported as complete readiness for both environments. The Admin reset action covers both configured targets. A missing target, missing credential, or unreachable target is a blocker, not a skipped success. Start a wall-clock timer when the run begins; the single administrator confirmation is part of that time budget.

### 2. Run order and 15-minute budget

The runner follows this sequence and records elapsed time at each phase. The implementation target is completion within 12 minutes, leaving a three-minute contingency; the hard deadline is 15 minutes from start, including provider login, the repair confirmation, final reset, and report generation. Suggested budgets are: grouped live/static audit 90 seconds; establish the four target/provider worker contexts 120 seconds; preview, confirm, apply, and read back repairs 150 seconds; full use-case matrix 300 seconds; final cleanup and report 60 seconds. Tune concurrency against the actual targets, but do not omit rows to meet the budget. At the deadline, stop launching work, cancel outstanding requests where safe, and report NOT READY with every unfinished check.

1. **Check prerequisites.** Confirm the required services, configuration, target endpoints, test identities, and repair permissions are available. Identify the repository revision and target revisions/configuration used for the run.
2. **Audit without writing.** Run local source-of-truth checks and compare live target values for every setting consumed by Agent Gateway and Authorize. Include resource audiences, scopes and mirrors, app grants, registered tool scopes, route/auth configuration, decision endpoint references, and live policy definitions wherever supported. Collect all findings before proposing changes. If any required setting has no supported read path, mark full readiness NOT READY.
3. **Show a repair plan.** For each eligible finding, show the target, object, current value, expected value, source-of-truth reference, and exact proposed change. State which findings cannot be repaired automatically and why.
4. **Get one administrator confirmation.** Bind the confirmation to the displayed plan and selected targets. Recheck the affected live values immediately before applying; if the state changed, stop and show a refreshed plan.
5. **Apply eligible repairs.** Apply only the confirmed, unambiguous changes. Record sanitized before/after evidence. Do not silently invoke other mutation paths during this run.
6. **Re-audit.** Verify each changed value and rerun the relevant local topology, audience, scope, grant, route, and authorization checks.
7. **Exercise the full demo matrix.** Run every required target/provider/use-case combination, capturing the expected and observed result for each step.
8. **Finish the selected action.** The CLI reports readiness and leaves demo state alone. Admin → Reset Demo clears existing demo state and signs out only if the complete readiness gate passes. If readiness fails, keep the diagnostic report visible and do not claim the demo was reset into a ready state.

The time budget is designed around parallel target/provider workers, one login per worker, bulk live-configuration reads, batched repair writes, and bounded-concurrency scenario execution. Do not re-login for each use case or perform a serial API round trip for every scope/resource. Validate these assumptions against both targets before claiming the 12-minute target. Existing startup reconciliation and any `--fix` commands must be inspected during implementation. They must not cause additional live changes outside the displayed and confirmed repair plan in this workflow.

### 3. Full demo matrix and pass criteria

The runner derives its 46 rows from the Demo Steps UI lists and verifies each against the matching backend catalog, auth requirements, and vertical configuration. A selected step missing from the backend, marked as needing a build, missing an expected result, or otherwise not executable blocks readiness.

The base matrix is 46 use cases × 2 session providers × 2 targets (184 executions), before expanding vertical variants and the additional UC40 ID-JAG execution on each target. The runner reports the actual expanded row count before execution and must meet the same 15-minute limit for the complete expanded inventory.

For each target:

- Establish a fresh PingOne-authenticated user session and execute every demo step through the same supported entry path used by the demo.
- Establish a separate fresh PingFederate-authenticated user session and execute every demo step through that same entry path.
- Execute UC40 through the native PingFederate ID-JAG path.
- For all other PingFederate steps, assert the expected standard exchange path and absence of native ID-JAG provenance.

A row passes when the observed behavior matches the catalog's declared expectation. Expected denials, consent or HITL pauses, step-up results, and other intentional outcomes count as passes when the correct outcome and evidence are observed; success does not mean every call must be permitted.

A demo step that is expected to work on both targets and both session providers cannot be labeled unsupported and still yield readiness. “Not applicable” is reserved for a path that the current contract explicitly excludes, such as native ID-JAG outside UC40; that row must still verify the correct standard PingFederate behavior. Missing, stale, unknown, timed-out, or unauthenticated results fail closed. The runner continues collecting independent results where possible so the report identifies all failing steps in one run.

The test identities and data must be dedicated to readiness runs and isolated from a presenter's active session and demo state. Authentication must exercise the provider login/session boundary, not substitute a client-credentials-only check. Secrets are supplied through the existing protected runtime configuration and never written to reports.

### 4. Repair policy

The repository's declared configuration and generated topology are the repair source of truth. A repair is automatic only when all of the following hold:

- The drift is deterministic and maps to one uniquely identified live object.
- The expected value is declared in the repository.
- A supported API can apply the exact change with the runner's credentials.
- The operation is safe to retry and its before/after state can be verified.
- The exact change appeared in the preview and was confirmed by an administrator.

This can include known missing scopes or grants and a uniquely identified resource value when the relevant target API and credentials support the update. The runner must not guess which duplicate object to change, remove unknown extra grants/scopes, broaden permissions, or apply changes outside the preview.

Code defects, missing test credentials, unavailable services, permission failures, ambiguous resources, unknown extra configuration, and live Authorize policy changes without a supported read/write path remain blocking findings. The report gives the affected use case or configuration object, observed evidence, and the specific manual action needed. If live policy content cannot be read, report the exact missing read capability and block full readiness. The runner does not edit application code or claim that a live policy tree matches the repository when it cannot read that tree.

### 5. Admin reset behavior

Admin sidebar **Reset Demo** starts the readiness job through a dedicated admin-only endpoint. Its UI shows audit progress, the proposed repair list, the single apply confirmation, per-target/per-provider execution progress, and the final report.

After a fully green result, the action performs the existing demo-state cleanup and signs out as it does today. If any required repair is unconfirmed or any required check fails, it shows the report and leaves the demo state available for diagnosis. The separate dashboard reset, account reset, and reset-all flows do not gain privileged tenant repair behavior.

### 6. Readiness report

Every run produces a concise UI/terminal summary and a machine-readable report. The report contains:

- Run ID, time, repository revision, target, and the target/provider matrix attempted.
- Every static and live check with status, sanitized evidence, and source-of-truth reference.
- Every demo step and vertical variant with provider, expected result, observed result, and status.
- The full repair preview and, if confirmed, sanitized before/after verification.
- Blockers, unavailable checks, and explicit limitations, including inability to read exact live Authorize policy content.

Do not include access tokens, ID-JAG tokens, passwords, client secrets, cookies, or authorization headers. A report with any failed/unknown required row, untested required target, unresolved repair, or unavailable readback for a required live authorization setting is **NOT READY**. The summary may say **READY — BOTH TARGETS** only after every required live configuration comparison and every required row on both targets passes.

## Build-time repairability validation

Before declaring the readiness feature complete, validate that each of the 46 Demo Steps cases has a documented configuration contract and an actionable failure path:

- Map each case and supported provider/target path to the audiences, scopes, grants, gateway settings, Authorize checks, and other configuration it depends on.
- For each configuration drift class the runner claims to repair, introduce a controlled mismatch in a disposable local fixture, verify that the runner previews and repairs it, then rerun the affected demo step successfully.
- Verify that configuration repair changes only configuration; it must not require editing application source or rebuilding the application.
- If a demo step cannot be made healthy through supported configuration, classify it as requiring a code fix and keep that case blocked until the code is corrected during feature construction. The build workflow may automatically apply a focused source patch in an isolated checkout, then must run the affected service tests/build and present the patch for review before release. Do not claim that runtime configuration repair covers it.
- Fail the build-time validation when a newly added Demo Steps entry lacks an expected outcome, dependency mapping, or repairability classification.

This validation proves the current application can recover from supported demo drift by changing configuration alone, while surfacing actual source defects before the pre-demo runner is considered ready.

## Acceptance criteria

- One direct command runs the same readiness service used by Admin → Reset Demo.
- The default full run covers local Docker and hosted SE; partial target runs cannot be mistaken for full readiness. Full repair and verification finishes within 15 minutes or explicitly returns NOT READY; representative full runs meet the 12-minute target on both targets, including the expanded vertical matrix.
- The runner validates exactly 46 unique Demo Steps use cases mapped to the backend catalogs and expands all applicable vertical variants.
- Each required step is exercised with both PingOne and PingFederate user sessions on both targets.
- UC40 passes through native PF ID-JAG; other PF steps use the standard exchange and contain no native ID-JAG provenance.
- Expected negative and consent/HITL outcomes are recognized as valid only when they match the declared scenario expectation.
- Every live repair is previewed, confirmed once, applied exactly, and read back successfully before the full matrix runs.
- Unsupported required steps, unknown results, inaccessible required targets, and unrepairable findings produce NOT READY with actionable detail.
- Admin-only reset integration does not change dashboard/account reset authorization or behavior.
- Reports and UI never expose tokens or credentials.
- Full READY requires exact live readback for required Authorize policy content. If the target exposes no supported read path, the report states that limitation and remains NOT READY.

## Known limits and implementation prerequisites

The 46-case inventory is derived from the Demo Steps UI sources and validated against the backend catalogs at runtime. A fully automated provider-login matrix requires dedicated non-production PingOne and PingFederate user identities with repeatable login under the intended demo policies. The implementation must confirm how those identities can authenticate without bypassing interactive login or MFA requirements. Hosted SE repair also depends on the target's administrative API permissions.

Current policy APIs/worker credentials do not expose the complete live Authorize policy tree. The implementation can verify repository-side policy contracts and references and exercise every declared demo decision path, but those checks do not attest policy-tree parity. A least-privilege supported read path is a prerequisite for a full READY result; until then, the runner must return NOT READY and identify the missing capability.

## Out of scope

- Editing or rebuilding application source from the live pre-demo Reset Demo action; source changes belong in the isolated build workflow and must be verified before release.
- Guessing or deleting ambiguous live grants, scopes, resources, or policies.
- Deploying to a remote SE cluster.
- Changing the dashboard reset or account reset into a privileged configuration-repair operation.
- Treating network reachability alone as proof of a successful authenticated demo.
