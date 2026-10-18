# Inspector redesign — handoff (2026-10-18)

Pick-up guide for the MCP / Authorize / Agent Gateway inspector redesign. Tick boxes as work lands.

- Branch: `feat/inspector-redesign`, worktree `.worktrees/inspector-redesign` (HEAD `4e62a1b5a` on top of merged `origin/main` `f1f36d23b`). Not pushed, no PR yet.
- Plan: `docs/superpowers/plans/2026-10-17-inspector-redesign.md`. Mockups: `docs/mockups/inspectors/{mcp,authorize,agent-gateway}.html`.
- Execution ledger (rulings R1–R15, deferred minors, per-task reports): `.superpowers/sdd/2026-10-17-inspector-redesign/` in the worktree (git-ignored).
- PR body draft: `.superpowers/sdd/2026-10-17-inspector-redesign/pr-body.md`.

## Done

### Shared shell (`demo_api_ui/src/components/inspector/`)
- [x] `inspectorCalls.js`: `InspectorCall` model, chip helpers, `tokensFromEvents`, `stepsFromTokenEvents`, `diffPaths`, `diagramConfigFromCall` (ReactFlow config)
- [x] `InspectorLayout.jsx`: header (eyebrow, h1, lede, "More tools" links, mode chip, source select), visible "Send a call" card, Calls list with All/Problems
- [x] `CallDetail.jsx`: five tabs (What happened, Request & response, Tokens, API calls, Diagram via `EmbeddedFlowDiagram`), Resend / Edit & resend (driven by `call.input`, R9), Compare with (field-level diff + side-by-side), banner, raw-token disclosure
- [x] `Inspector.css`: `insp-` prefix, theme tokens, Ping red, 60rem one-column breakpoint, dark mode via `data-theme`

### Pages
- [x] MCP (`McpInspectorPageClean.jsx`): all six sources, custom-server profiles + "+ Add server" form, elicitation Confirm/Decline row, tool info + scopes, Input schema, Browse all tools, autofill note, mode chip (Live / Local fallback / Loading / Unavailable), Vertical select
- [x] Authorize (`PingOneAuthorizeConsoleClean.jsx` + slimmed `PingOneAuthorizePage.jsx`): presets Transaction / MCP tool / Custom, Policies on this endpoint, Include PingOne's recent decisions, policy tree in What happened, More-tools links with Back link, records lifted to page state, replay guard, Vertical select; dead `EvaluatePanel` (~490 lines) deleted
- [x] Gateway (`AgentGatewayInspectorClean.jsx` + trimmed `AgentGatewayLogPanel.jsx`): real `/api/mcp-gateway/test` + burst + chain, Scenario select (presets, chain, attack library), Repeat, gateway switch + Authz Real/Simulated, decisions polling (visible-only, stops on 401), per-call log lines, filter chain + 5W1H in What happened, Vertical select; mock `/api/agent-gateway/invoke` route + hook deleted
- [x] Vertical catalog `config/inspectorVerticals.js`: 10 verticals, per-vertical tools/scenarios/presets, ownership rule + `GLOBAL_TOOLS`, truthfulness tests against `scopeTopology`, MCP schemas and seed data

### Server (`demo_api_server`)
- [x] `GET /api/mcp/inspector/tools` → `requiredScopes` per tool
- [x] `POST /api/authorize/evaluate-endpoint` → `policyEvalMs`, `ruleName`, `ruleCode`, `workerTokenCached`, `tokenEvents[worker-token]` (with `raw`); telemetry isolated so it can never 502 a decision
- [x] Gateway decision buffer keeps `parameters`, `rawResponse`, `filterChain`, `mcpAudit`, `introspectionActive` (32 KB cap per field)
- [x] `POST /api/mcp-gateway/test` forwards `gwAuditTrail` on failures and returns `rawInboundToken`
- [x] Raw tokens shown on purpose (user decision, R13/R15): `agentToken` redaction reverted; new raw fields not redacted

### Reviews, tests, copy
- [x] Every task reviewed (spec + quality) with fix rounds; final whole-branch review (2 Critical + 7 Important) fixed and re-reviewed
- [x] Copy sweep + Learning Hub sync; `?subtab=tester` links → `/agent-gateway-capabilities`; `McpInspectorPage.clean.css` deleted; themingRatchet pin 59→58
- [x] Full UI suite at HEAD: 932 files, 7175 passed, 0 failed. Touched server suites: 48/48
- [x] `origin/main` merged (incl. #1525 PF device-type fix); API container restarted for the peer session's PF testing

### Live check (local OrbStack stack serving the worktree, PF sign-in as demouser)
- [x] Authorize: DENY + PERMIT rows, all five tabs, policy tree, Simulate/Reset, Compare, More-tools round trip keeps rows, raw worker JWT visible with Copy
- [x] MCP: mounts, Local-fallback chip + note (PF token has only `openid` → exchange blocked), local-handler rows with all tabs
- [x] Gateway: mounts, Vertical/Scenario/Tool wiring, scope-less 401 shows the server message (no sign-in modal; Task 12)
- [x] No horizontal scroll at 400px; dark mode (`data-theme=dark`) renders on all pages
- [x] Branch history scrubbed of accidentally committed probe files (browser profile, session state) before any push

## Left

### Before merge
- [ ] Live check with a **PingOne** session that has MCP scopes (PF gives `openid` only): MCP page against the live MCP server (raw exchanged token in Tokens tab, token-exchange hop), gateway PERMIT → DENY → approval story (Read accounts / Sensitive read / Withdrawal scenarios), chain, AI-agent call appearing in the MCP and Gateway lists. Sign-in redirect host is `https://local.ping-devops.com:4000`; the session cookie lives there.
- [ ] Hand the local stack back: `bash scripts/serve-worktree.sh main` (peer session "agents-d5" is waiting for this)
- [ ] Push `feat/inspector-redesign`, open the PR with `pr-body.md`, hand Curtis the `gh pr merge` command (don't run it)
- [ ] Run CI once (one run at a time); fix anything it finds

### Open questions for Curtis
- [ ] Every vertical currently shows the Transaction preset (all have a transaction decision path). OK, or should some hide it?
- [ ] Healthcare / manufacturing approval scenarios use the $500 threshold amount, but the seeded bill is $50 and the PO $8,750; the BFF decides on the record's amount when an id is sent, so the hold may not fire. Drop the id, or pick records that cross the threshold?

### Deferred minors (from the ledger; none block merge)
- [ ] Failed call with no `durationMs` shows "open" instead of "—" in the Calls row
- [ ] Cross-inspector autofill doesn't map `accounts[].id` → `account_id` (pre-existing `InspectorFieldContext` matcher)
- [ ] Tools on the live MCP server but absent from `mcp-tool-schemas.json` show under every vertical
- [ ] `claimsOf()` in `gatewayCalls.js` returns a non-object for a JSON-null JWT payload; `atob` is not UTF-8
- [ ] `.insp-json` panes: raw-token Copy has no fallback/feedback; tab list has no arrow-key navigation
- [ ] `AIAgent.js` button renamed "Agent Gateway Tester" (it opens the Tester); confirm that's the wanted target
- [ ] `data/pageCatalog.md:280` still says "Authorization Policies tree" (generated file; regenerate)
- [ ] Changing the vertical resets a typed Transaction amount
- [ ] Pre-existing: a Token Chain replay into Authorize could double-run before the guard; now guarded, but `pendingTest` clearing lives in the page's `onRan`

### Nice-to-have (not planned)
- [ ] Gateway upstream (post-exchange) token card: the audit trail doesn't carry it
- [ ] PingOne recent-decision rows show no request parameters (API limitation)
- [ ] Per-hop timings for the internal MCP hops (initialize, exchange) are not measured server-side

## How to resume
1. `cd .worktrees/inspector-redesign && git status && git log --oneline -3` (expect clean, HEAD 4e62a1b5a or later).
2. `bash scripts/serve-worktree.sh` shows which checkout the stack serves; `here` to serve this branch, `main` to hand back.
3. Probe recipe and sign-in traps: memory note `ai-demo2-serve-worktree-live-check`.
4. Tests: `cd demo_api_ui && npx vitest run src/components/inspector src/components/__tests__/McpInspectorPageClean src/components/__tests__/PingOneAuthorizePage.test.jsx src/components/__tests__/AgentGatewayInspectorClean.test.jsx`; server: `cd demo_api_server && npx jest src/__tests__/mcp-inspector.test.js tests/routes/authorizeEvaluateEndpointInspector.test.js tests/routes/mcpGatewayTestDeny.test.js tests/routes/gatewayDecisionIngest.test.js tests/inspectorVerticalsCatalog.test.js`.
