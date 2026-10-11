# Board Backlog — piped 2026-07-10

Raw feedback from the board for ai-demo.ping-devops.com, triaged into work items.

## Bugs

### B1. `/pinggateway-test.html` returns 404 — FIXED
- Served from `demo_api_ui/public/pinggateway-test.html`; nginx uses `try_files` (no BFF proxy dependency).

### B2. Authorization policies list fails with 403 — FIXED
- `/api/authorize/pingone-policies` serves the repo P1AZ snapshot first (worker tokens always 403 on the live policy-editor API).

### B3. `/pingcli` page — every command returns INVALID_ARGUMENT — FIXED
- Live commands use `pingone api <uri>`; `--config` resolved at call time; auth bootstrap fails closed if worker creds are missing.

### B4. AI Attack Demos — run buttons do nothing — FIXED
- Showcase fallback navigates to `/dashboard` with pending-attack replay; Intent Bypass uses the same handoff; catalog tabs use router state.

### B5. Code chat — "CodeGraph index not available" — FIXED
- Cause: agent image shipped a zero-byte `/app/codegraph.db` (`touch` placeholder) because `setup:fresh` never baked `langchain_agent/codegraph.db` for the Dockerfile COPY. Refresh wrote to `repo-src/.codegraph` (staged indexer without `--out`) while queries read `/app/codegraph.db`.
- Fix: bake DB in setup/run/se-update; bake current `scripts/build-codegraph.py` to `/app/indexer`; `ensure_index` promotes legacy → query path on startup + every query + Refresh; startup auto-builds when still empty (`build_query_index_sync`); Refresh fails closed if query DB still empty.
- Verify: rebuild/redeploy agent, ask "How does the MCP gateway work?" on `/code-explorer` — expect SSE answer, not 503. Pod restart must keep working without a manual copy.

### B6. `/code-search` — button CSS broken — FIXED
- Scoped all code-search button rules under `.code-search-page` so global `.btn`/reset rules can't flatten them (0b1054216, 2026-07-21).
- Verified live 2026-10-10 (signed in, Playwright computed-style dump): Search, tabs, Upload & Index, Index-a-folder, starter chips, Send all styled correctly. Remaining nano-reset artifact: the page's dark-mode toggle computes `border-radius: 0` (unscoped `var(--radius-md)` loses to `.end-user-nano button`) — cosmetic, tracked in E5's styling pass if wanted.

## Enhancements

### E1. Vertical ops pages: show Agent (MCP Client) → MCP Server — FIXED (superseded by a better answer)
- "Just the MCP route" would have rendered an empty rail: operator writes on `/admin/<vertical>` run no agent pipeline (no LLM, no RFC 8693, no MCP hop), and the ops chain honestly shows that (PR #1129, 2026-10-11). The literal ask is the exact regression the SupportConsole comment warns about — `mcpRouteOnly` on a chain with zero MCP steps.
- What ships instead: the rail's operator story — operator session → customer identity verification → store write (row, before/after) → audit — the hops that actually happened, with nothing minted for fiction. Board's underlying goal ("show the hops this surface really takes, not the agent pipeline") met.
- Example URL: https://ai-demo.ping-devops.com/admin/healthcare

### E2. `/scope-reference` — keep current with code
- URL: https://ai-demo.ping-devops.com/scope-reference
- Verify the page content matches what the code actually uses.

### E3. `/settings` — verify all options work — FIXED (audited 2026-10-11)
- URL: https://ai-demo.ping-devops.com/settings
- Audit every option on the page end-to-end.
- Audit result: all 10 editable settings + 1 read-only status are live-read at enforcement time via `runtimeSettings.get()` (no stale env copies): step-up chain in `mcpLocalTools.js` + `sensitiveBanking.js` (enabled, threshold, ACR, types, method, withdrawals-always), `maxTransactionAmount` in `routes/admin.js`, agent stop limits in `agentTransactionTracker.js`, `authorizePolicyId` in `transactionAuthorizationService.js`. 184 test cases across the enforcement suites pass (runtime-settings-api 16, threshold bridge 2, amount-gate band, policy-HITL, ACR gates, HITL integration, RFC 9470, workload agents). Auth gate verified live: unauthenticated `/settings` renders the admin sign-in modal; `GET /api/admin/settings` answers 401. The four related-settings nav links and both education modals resolve. Live click-through of an actual save needs an admin MFA session (SMS) — the API surface itself is covered by the 16-case runtime-settings-api suite.

### E4. `/delegation` — real demo-user login flow — FIXED (partial)
- Backend provisioning + credential card shipped 2026-07-12 (PingOne user creation, DEMO_PASSWORD, email notification).
- Gap closed 2026-10-10: delegate-facing `DelegatedAccessPanel` on `/dashboard` — the logged-in delegate now sees who granted them access, the scopes, and the grant date (`GET /api/delegation/granted-to-me`). Renders nothing when the viewer holds no delegations.
- Create a user in PingOne with a password.
- Show a message to the demo user with those credentials so they can log in and see delegation.
- URL: https://ai-demo.ping-devops.com/delegation

### E5. `/code-search` — real agent experience — FIXED
- Chat panel (`CodeSearchAsk`: bubbles, typing dots, stop button, prompt library), native toast for the file-size warning, and the global upload spinner all shipped in prior passes.
- Header unified with the other Exploring pages 2026-10-11 (PR #1132): shared `HeroSection`, theme toggle in the hero row.
- Remaining nit: "look like the OAuth Academy page" is a moving target — flagged as follow-up if the board wants a deeper restyle.

### E6. Consistent "Exploring" section — FIXED
- New "Exploring" nav group shipped 2026-10-11 (PR #1132): Code Explorer, OAuth Academy, Protected RAG (`/code-search`), OAS Demo.
- OAS Demo's hand-rolled header was deliberately left as-is (spec-browser, not an agent page) — follow-up if the board wants it on the shared hero too.

### E7. `/agent-studio-preview` — needs to be greatly enhanced — FIXED (the page now exists)
- Root cause found 2026-10-11 (PR #1133): of the spec's five pages, four shipped 2026-07 — but page 1, Agent Studio itself, was never built. `/agent-studio-preview` hit the SPA 404, and IGA for AI's empty state pointed at the missing page.
- Now built per the approved spec: three persona tabs (Enterprise AI User / Developer wizards over `FLOWS`, Admin approves Discovery's pending agents), completing the mock-store pipeline (Studio registers → Discovery surfaces → Admin approves → IGA certifies → Gateway audits).
- Live nav note: the preview pages render under **AI Experiences** — the legacy "Agent Studio (Preview)" registry group never renders (no productGroup references it).
- Was fixed for blank-page-when-signed-out in PR #1641 (route was gated behind login); content itself still needs the enhancement pass.
