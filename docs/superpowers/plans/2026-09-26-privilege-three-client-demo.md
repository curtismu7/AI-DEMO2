# Privilege Three-Client Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the same Direct, Privilege-limited, and Privilege-denied OpenSearch demonstration repeatable in the web app, LM Studio, and LibreChat, then run the full AI Guard Attack Lab in the app and document both first-time setup and presenter flow.

**Architecture:** Keep the existing local OrbStack app/BFF, desktop LM Studio, and standalone LibreChat stack. Map client-specific endpoints to the same OpenSearch backend and hosted Privilege apps; each client retains its own OAuth session but resolves to the same intended main-PingOne identity. Validate the live policies before changing configs, then capture screenshots only from passing runs.

**Tech Stack:** React 19/Vite/Vitest, Node 22/CommonJS/Jest, LM Studio MCP JSON and workflow manifest, LibreChat YAML and seeded agents, Docker Compose, BrowserSkill/manual client verification, Markdown and PNG screenshots.

**Spec:** `docs/superpowers/specs/2026-09-26-privilege-three-client-demo-design.md`

## Global Constraints

- Local OrbStack is the canonical presenter environment; do not deploy to remote or SE Kubernetes.
- Do not publish to `cmuir_pingcorp` unless the user explicitly overrides the repository restriction.
- Do not alter live Privilege policies or PingOne identity state silently; read provisioning scripts before any live mutation.
- Keep the direct route outside Privilege, the allowlist on `opensearch22`, and the expected deny on the separate `opensearch` app.
- Never describe an AI Guard decision unless live evidence identifies AI Guard as the enforcement component.
- Preserve OAuth federation to the main PingOne environment and do not copy tokens between clients.
- Before auth, session, authorization, or UI edits, preserve the applicable `REGRESSION_PLAN.md` §0–§1 invariants and `.claude/skills/regression-guard/` rules.
- Any `demo_api_ui/` change requires focused Vitest, `npm run build`, and the touched page’s contrast audit in light and dark themes.
- Capture only real client screens; remove secrets, tokens, and personal identifiers; provide captions and alt text.

## File Map

| File | Responsibility |
|---|---|
| `lmstudio/mcp.json` | Named direct, limited, and denied OpenSearch MCP entries for LM Studio. |
| `lmstudio/demo-steps.json` | Matching workflow names, allowed tool selections, and repeatable read prompts. |
| `lmstudio/README.md` | Fast path and setup/troubleshooting details for the three OpenSearch states. |
| `librechat/librechat.yaml` | MCP entries and clearly named OpenSearch demo agents in LibreChat. |
| `librechat/seed-demo-agents.js` | Idempotent OpenSearch demo-agent definitions and tool allowlists. |
| `librechat/seed-demo-agents.test.js` | Configuration/seed invariants for the client presets. |
| `demo_api_ui/src/pages/PrivilegeMcpClientPage.jsx` | Existing web client and dynamic door/path controls; change only if live audit finds a concrete blocker. |
| `demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.*.test.jsx` | Existing focused tests for page paths, OAuth, and door selection; extend only for an identified behavior change. |
| `demo_api_server/routes/privilegeMcpClient.js` | Existing OAuth discovery/federation; change only if the first-time flow audit proves the login-hint or session identity mismatch is a defect. |
| `demo_api_server/tests/routes/privilegeMcpClient.*.test.js` | Focused regression coverage for any BFF OAuth fix. |
| `docs/user-guide/privilege-three-client-demo*.md` | Presenter flow and one first-time setup page per client. |
| `docs/screenshots/privilege-three-client-demo/` | Sanitized real-client setup and result screenshots. |
| `REGRESSION_PLAN.md` §4 | Reverse-chron entry only if an actual protected-area bug is fixed. |

## Task 1: Audit the live demo before changing configuration

**Files:** Read-only; do not edit live tenant policy or source files in this task.

- [ ] Pin the local stack generation with `gen="$(npm run -s stack:generation)"`; confirm the expected UI and API containers are running.
- [ ] Read the effective local LibreChat config and `lmstudio/mcp.json`; list every OpenSearch entry, transport, URL, tool cap, and auth owner without printing secrets.
- [ ] In the app at `https://local.ping-devops.com:4000/privilege-mcp-client`, verify the direct OpenSearch, `opensearch22`, and `opensearch` choices resolve to the documented endpoints.
- [ ] Run one direct `tools/list` and one read-only tool call; record the exact catalog size and response.
- [ ] Run one `opensearch22` authorization and one `opensearch` authorization through the real gateway; record status, tool list, resolved gateway identity, and whether the MCP backend was reached.
- [ ] Confirm the allowlist is effective and unexpired, and that no union of group policies broadens it. Confirm the deny log identifies policy denial for the synced identity rather than `user not found`.
- [ ] Check whether the existing gateway OAuth `login_hint` matches the identity the app intends to demonstrate. Do not treat the hint or console login as evidence of the resolved gateway principal.
- [ ] Inventory current Attack Lab scenarios and live readiness; run only safe, side-effect-free cases. Record each observed enforcement point and outcome.
- [ ] Run `npm run -s stack:generation -- --check "$gen"`; void the run if the stack changed.
- [ ] If limited policy is absent/overbroad/expired, identity is unsynced, or the 403 has the wrong cause, stop before tenant mutation and report the precise prerequisite to the user.

**Gate:** Continue only when the existing gateway config can truthfully produce the intended allowed subset and the separate expected 403. A policy or identity change requires explicit user direction.

## Task 2: Align LM Studio's three OpenSearch states

**Files:**
- Modify: `lmstudio/mcp.json`
- Modify: `lmstudio/demo-steps.json`
- Modify: `lmstudio/README.md`
- Test: `scripts/lmstudio-privilege-demo-config.test.js` (new, Node test runner).

- [ ] Write a failing config test that parses `mcp.json` and requires named Direct, Privilege-limited (`opensearch22`), and Privilege-denied (`opensearch`) entries with their correct base/backend paths.
- [ ] Run `node --test scripts/lmstudio-privilege-demo-config.test.js` to confirm the missing or mislabeled state fails.
- [ ] Add only the missing server entries; retain the unrelated working banking, Brave, and PingOne Admin connections.
- [ ] Add three corresponding workflow entries in `demo-steps.json`. Use a read-only OpenSearch prompt and only tools actually returned by the verified policy for the limited case. Do not attach the full direct allowlist to the limited case.
- [ ] Update the OpenSearch section of `lmstudio/README.md` with import/restart/authenticate steps, the expected limited tool set, the expected policy 403, and clear distinction from OAuth/transport failures.
- [ ] Run `node --test scripts/lmstudio-privilege-demo-config.test.js scripts/lmstudio-mcp-sync.test.js` and inspect the exact entries in `mcp.json` and `demo-steps.json`.
- [ ] Start/reload LM Studio on the running workstation; verify all three entries connect, the limited entry lists only the allowlisted tools, the allowed read returns data, and the denied app returns a gateway 403.

## Task 3: Align LibreChat's three OpenSearch states

**Files:**
- Modify: `librechat/librechat.yaml`
- Modify: `librechat/seed-demo-agents.js`
- Modify: `librechat/seed-demo-agents.test.js`
- Modify: `librechat/README.md`

- [ ] Add failing seed/config assertions for exactly labeled Direct, Privilege-limited, and Privilege-denied OpenSearch choices; assert the limited agent’s tool allowlist is a subset of the verified gateway tool list.
- [ ] Run `node --test librechat/seed-demo-agents.test.js` and capture the expected failure.
- [ ] Update the three OpenSearch MCP entries to use one recommended route per state. Remove misleading labels that conflate “gateway session missing” with a real Privilege policy denial; retain alternate route documentation only where useful.
- [ ] Update seed agents and model-selector labels so a presenter can select the same three states without guessing. Preserve unrelated agents, schedules, and LibreChat login behavior.
- [ ] Update the README’s quick-start and known-door table with the three OpenSearch states, first-time MCP sign-in, expected 403, and the error-recovery distinction.
- [ ] Validate YAML with the project’s existing config/parser path and run `node --test librechat/seed-demo-agents.test.js`.
- [ ] Start the existing LibreChat stack and verify each state with a new chat: direct full catalog/read, Privilege allowlisted catalog/read, and a genuine gateway 403 from the deny app. Confirm gateway identity on both Privilege apps.

## Task 4: Verify and fix the web app flow only where the audit found a blocker

**Files:**
- Modify only if needed: `demo_api_ui/src/pages/PrivilegeMcpClientPage.jsx` and its existing focused test.
- Modify BFF only if the confirmed login-hint/session mismatch selects the wrong identity: `demo_api_server/routes/privilegeMcpClient.js` plus a focused route test.

- [ ] Preserve the page’s dynamic direct-door allowlist (`banking`, `opensearch`, `brave`, `pingone-admin`), the Privilege/facade distinction, and separate per-app sessions.
- [ ] If app labels or controls prevent a presenter from selecting Direct, `opensearch22`, and `opensearch`, add the smallest focused change and a failing regression test first.
- [ ] If `login_hint` is demonstrably selecting an unintended identity, write a focused OAuth-start test asserting the intended source and do not change the redirect origin, PKCE/state validation, token exchange, or callback session semantics.
- [ ] Run the exact touched Vitest/Jest test paths. For any UI change, run the page contrast auditor in both themes and `cd demo_api_ui && npm run build`.
- [ ] Add a §4 regression-plan entry only for a confirmed protected-area bug fix, stating Files changed / What was broken / What was fixed / Do not break / Verify.

## Task 5: Write the first-time guides and presenter runbook

**Files:**
- Create: `docs/user-guide/privilege-three-client-demo.md`
- Create: `docs/user-guide/privilege-three-client-demo-app.md`
- Create: `docs/user-guide/privilege-three-client-demo-lm-studio.md`
- Create: `docs/user-guide/privilege-three-client-demo-librechat.md`

- [ ] Write the shared presenter runbook with prerequisites, 3-client order, a concise talk track, expected observations, and the app-only AI Guard handoff.
- [ ] Write each setup guide for a first-time user, using exact tested URLs, current UI control names, OAuth behavior, expected tools, and recovery steps.
- [ ] Include a troubleshooting table that distinguishes a valid 403 policy denial from expired/missing policy, unsynced identity, stale OAuth registration, unreachable backend, and local port-forward failure.
- [ ] State that client OAuth sessions are separate, resolve through the same federated main-PingOne identity, and should never share tokens.
- [ ] Describe all five Attack Lab scenarios using measured enforcement attribution; identify where the outcome is local validation, non-AI-Guard authorization, a model response, or no verdict.
- [ ] Review all names, URLs, catalog counts, tool allowlists, and statuses against the successful Task 6 matrix; do not copy unverified claims from older notes.

## Task 6: Capture screenshots and complete the matrix rehearsal

**Files:**
- Create: `docs/screenshots/privilege-three-client-demo/` images referenced by the guides.

- [ ] Capture real screenshots for client setup/authentication and the visible Direct, limited, and denied result in each client.
- [ ] Capture the app’s Attack Lab overview and enough representative results to illustrate the full suite and actual attribution.
- [ ] Crop and sanitize every image; remove tokens, authorization codes, personal identifiers, browser secrets, and unrelated desktop content. Add alt text and captions in the Markdown guides.
- [ ] Run the direct / limited / denied matrix in the web app, LM Studio, and LibreChat with the intended identity; record catalog counts, tool names, tool-call outputs, HTTP status, gateway decision, and backend reachability.
- [ ] Run all five Attack Lab scenarios from the app and verify the result copy matches each observed enforcement point.
- [ ] Have a first-time user follow each setup guide, then have a presenter run the complete demo from the runbook without undocumented steps.
- [ ] Run scoped unit/config checks, changed service tests, UI tests/build and contrast audit where applicable; run `git diff --check` and inspect the final screenshot/doc list.

## Self-Review

- Spec sections map to Tasks 1–6: live readiness and policies (1), client parity (2–4), docs/screenshots (5–6), and acceptance rehearsal (6).
- A live identity/policy defect stops at Task 1’s gate until the user directs an external PingOne/Privilege change.
- Client OAuth stays per client; only the resolved identity and gateway policy outcomes are shared. AI Guard remains app-only.
- No placeholder task remains; each task names files, exact state, verification path, and a stop condition for external policy changes.
