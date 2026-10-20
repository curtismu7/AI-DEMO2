# Demo ID-JAG playground: port flow runner v2 and Learn from the kit

> Status: IMPLEMENTED (2026-10-18). Open questions took their defaults: no PingFederate change (Q1), real-client panel on localhost only (Q2), Learn page linked from the playground with no sidebar item, exempted in `navRouteCoverage.test.js` (Q3).
>
> Not done, by choice: REST|MCP toggle (the demo already shows MCP in step 4 and REST in the resource section); STEP_TERMS links on step titles (Learn supports `#term-<id>` anchors for them); step tabs (the Code view is a third option on the existing Form|JSON toggle, and applies to requests only); diagram step 6 for revoke (diagrams stay at steps 1-5, so step 6 has no diagram link); the MCP backend chip (the strip covers the IdP and the resource AS). Revoke in `oauth-mcp` mode kills the app's own PingFederate refresh token but does not sign the user out of the app. Not run: live check against the local stack and SE.

**Goal:** bring the standalone kit's playground upgrades (backends strip, step Code tab, revoke-and-prove, real-client panel, Learn page) into the demo at `/pingfederate-id-jag/playground`, keeping the demo's modes (`oauth-mcp`, `pf-pf`, `byo`), its diagrams, and its Learning Hub card.

**Success criteria (all required before the PR is called done):**
1. Unit tests for every new client util and component pass in `demo_api_ui` (vitest), and server tests for new routes pass in `demo_api_server` (jest, `ALLOW_TEST_NETWORK=1` only where loopback is needed).
2. `npm run authz:verify` passes for every new route.
3. A focused Playwright run covers: backends strip shows real state, step Code tab is redacted, revoke-and-prove reports `proved`, Learn page search and filter work.
4. Live check on local stack (`scripts/serve-worktree.sh here`) proves the new API fields from the branch, not from the bundle alone.
5. Diagram, demo page and Learning Hub card are updated in the same pass (memory `diagram-demo-learninghub-sync`).
6. Ping brand only (Montserrat, official logo, Ping Red gradient; memory `ping-brand-standard`).

## Scope and non-goals

- **In:** the five kit features above, plus the demo-side server endpoints they need (`/backends`, `/revoke`, `/call` JSON-RPC id).
- **Out:** changing the demo's `oauth-mcp` MCP server auth. It stays as is (`MCP_AUTH_DISABLED=true` by design; gateways own authz). Memory `ai-demo2-id-jag-playground-and-pf-gotchas`.
- **Out (superseded):** a live SAML subject-token path. This port left SAML out; the real path is now built in `2026-10-19-demo-saml-playground.md` (OIDC | SAML toggle, server-signed assertion, PingFederate token exchange).
- **Out:** new PingFederate objects, unless Open question 1 is answered yes.

## Gap audit (Task 0, read-only, done first)

The demo already has: modes, Form|JSON toggle, preflight panel, trusted-IdP config, xaa and byo flows, `/call`, `/negative/:id`, and per-mode diagrams (`idJagPlaygroundDiagrams.js`). The kit's additions are missing or different:

| Kit feature | Demo today | Port plan |
|---|---|---|
| Backends strip (`probeBackends`, `GET /backends`) | preflight panel only | port server probe; reuse preflight data where possible |
| StepTabs Request / Response / Decoded / Code | Form + JSON views | add tabs; Code uses `codeSnippet.js` |
| `codeSnippet.js` redaction | none | copy util + its test verbatim |
| Revoke and prove (`POST /revoke`) | none | port route; step 6 in run flow |
| REST \| MCP toggle on the resource step | none on the demo resource step | port toggle |
| Real-client panel (`realClients.js`) | none | port utils; point at kit sample MCP (Open question 2) |
| Learn page (`terms.json`, `sources.json`, `LearnPage`) | Learning Hub card, no Learn page | add `/learn` route under ID-JAG, reuse the kit's data files |
| STEP_TERMS links in steps | none | port `STEP_TERMS` with the Learn terms |

Task 0 output: a one-table diff confirming each row against the demo's current files (`IdJagPlaygroundPage.jsx` 919 lines, `IdJagPlaygroundDiagramPage.jsx` 140 lines). Stop and report if a row is already done.

## Route and wiring checklist (every task that touches routes)

- `demo_api_ui/src/App.js` ~L1491–1495: add the Learn route next to `/pingfederate-id-jag/playground`.
- `demo_api_server/config/auth-requirements.json` L204–209: add the new path as `"public"`. Run `npm run authz:verify`.
- `k8s/aws/se-ingress.yaml`: the playground routes are not on the oauth-bypass ingress today. `grep` confirms no `/pingfederate-id-jag*` path is on `ai-demo-oauth-bypass-ingress` today (only `/welcome` and `/request-access`). So the playground and its Learn page sit behind the hosted-access gate on SE like the rest of the app. Add the Learn route to the bypass only if it must be reachable without sign-in, and ask first.
- `demo_api_ui/src/components/AdminSideNav.jsx` ~L190 and ~L1548–1553: add a "Learn" entry only if the Learn page is a sidebar item. Ask in Open question 3 first.
- `demo_api_ui/tests/e2e/helpers/e2e-storage-state.json`: seed any new `demo_*_seen` flag for every origin/port variant (4173 CI, 4000 local). Only if a new one-shot modal is added.
- `demo_api_ui/src/config/navPagePaths.js`, `pageGuides.js`, `diagramsIndex.js`, `utils/diagramLinks.js`: keep in sync when a page or diagram is added.

## Tasks

### Task 1: Port the kit's pure utils (no UI change yet)
- Copy `codeSnippet.js`, `realClients.js`, and their tests from `id-jag-standalone/web/src/utils/` into `demo_api_ui/src/utils/`. Do not change the redaction rules.
- Port `terms.json` (18 terms) and `sources.json` (36 sources, Okta and Auth0 samples excluded) into `demo_api_ui/src/data/`. Reuse the existing demo data location if there is one for Learning Hub content.
- Tests: `codeSnippet.test.js` (must still contain "never prints a secret" and "redacts nested JSON tokens") and a `realClients` test for the mcpc command and VS Code settings.

### Task 2: Server: `/backends`, `/revoke`, `/call` id
- Port `probeBackends(s, mcpUrl, fetchImpl)` (4 s timeout, 1.5 s slow, unconfigured backends omitted) and `GET /backends` into `demo_api_server/routes/idJagPlayground.js`. Use the existing `requirePf` for PF-dependent probes.
- Port `POST /revoke`: control exchange, then revoke, then retry. `proved` is true only if control is 200, revoke is 200, and retry error is in `[invalid_request, invalid_grant]`. PingFederate returns `invalid_request` for a revoked refresh token (RFC 8693 §2.2.2). Delete the issuer session on proof. Return 409 `sign_in_required` or `byo_mode` as the kit does.
- `POST /call` shows JSON-RPC `id: 1` in the request.
- Tests: supertest for each route with fetch mocked; jest network guard means `ALLOW_TEST_NETWORK=1` only for loopback suites.
- Verify on the live stack (Task 6) before merging.

### Task 3: Backends strip and step tabs in the page
- `BackendsStrip`: `seq` ref newest-wins; `role="group"`; visible state text, not colour alone.
- `StepTabs` (Request / Response / Decoded / Code) inside `Step`. Keep the existing Form|JSON toggle; it becomes the Request tab's view mode. Tab wiring: `aria-controls` and arrow-key movement (deferred minor from kit PR #7).
- `STEP_TERMS` links on step titles that point at the Learn page.

### Task 4: REST | MCP toggle and revoke step
- REST | MCP toggle on the resource step, persisted as `idjag.playground.resource` (the demo has its own storage key prefix; use the same name pattern).
- Step 6 "Revoke and prove it" with its control tab. Failed revoke shows a distinct state, not "Signed in" (deferred minor).
- Mock path: `idJagPlaygroundMock.js` gets mock `/backends`, `/revoke` (control, revoke, retry).

### Task 5: Real-client panel and Learn page
- Real-client `<details>` in step 1 with mcpc and VS Code copy blocks. Points at the kit's sample MCP server `http://localhost:19090/mcp` (option 2). Show it only when the page is on localhost; on SE show a one-line note instead (Open question 2).
- Learn page at `/pingfederate-id-jag/learn` (or the path chosen in Open question 3): glossary search, glossary `dl`, library filter chips, verified/not-read status tags, using the kit's `.kc-*` styles restyled to the demo's Ping tokens.
- Playwright headless check: search, chip filter, and that a step term link lands on the glossary anchor.

### Task 6: Diagrams, docs, live check, PR
- Update `idJagPlaygroundDiagrams.js` only where the new revoke and backends steps change the flow; every diagram stays ReactFlow with movable boxes, Simulate, Reset and speed control (memory `diagrams-are-reactflow`).
- Update `pageCatalog.md`, `DIAGRAMS.md` if the diagram list changes, and the Learning Hub card, in the same PR.
- Focused live check: `scripts/serve-worktree.sh here`, then the local stack. Prove the new fields from the branch (memory `ai-demo2-serve-worktree-live-check`). Run `scripts/serve-worktree.sh main` afterwards to repoint the shared stack.
- Open the PR from this worktree. CI green, then Claude merges (`gh pr merge --merge --delete-branch`). Focused SE deploy only after merge and after checking the live sha (memory `ai-demo2-pr-merge-deploy-traps`).

## Open questions (answer before Task 1)

1. **Minutes Before 5 → 1** on the demo's two ID-JAG SP connections (shared PingFederate). Needed only if the demo's own revoke proof needs the kit's 1-minute setting. Default if no answer: do not change PF.
2. **Real-client panel on SE:** the kit's sample MCP is not deployed on SE. Options: (a) show the panel on localhost only, with a note on SE, recommended; (b) deploy the kit's mcp-sample to SE, which adds a service to the shared cluster.
3. **Learn page location and nav:** a new sidebar item, or only linked from the playground and Learning Hub? Recommended: linked from the playground, no sidebar item, to keep the nav unchanged.

## Risks

- The demo page is 919 lines. Keep the port to new components in their own files, with the page importing them, so the diff stays reviewable.
- Shared main checkout: all work happens in this worktree (memory `ai-demo2-concurrent-session-clobber`).
- Two demo ID-JAG flows share the playground's PF-issuer session. The revoke proof deletes that session. Test that `pf-pf` and `oauth-mcp` still sign in after a proof.
