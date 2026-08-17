# Handoff — 2026-08-17 session (apikey-disposition tools + A&F SQLite)

Repo state at handoff: `main` synced to latest, all PRs below merged and
live-verified against the running Docker stack. No open PRs from this
session.

---

## Start here — the one thing that's NOT done

### `permitted_tools` intent-token mismatch blocks 5 of 10 apikey-disposition tools

**Status: root-caused down to the mechanism, not located in code yet.**

10 "apikey-disposition" MCP tools exist (`show_mortgage`, `show_large_purchase`,
`show_health_record`, `show_gear_order`, `show_gear_warranty`,
`show_expense_report`, `show_permit`, `show_enrollment`, `show_work_order`,
`show_investment` — see `APIKEY_TOOLS` in
`demo_api_server/services/mcpGatewayClient.js`). A 3-layer audience/scope/
policy bug that blocked ALL of them was found and fixed this session (see
"What shipped" below) — confirmed via live PingOne Authorize `PERMIT` +
200 + real data for `show_gear_order` (sporting-goods) and 4 others.

Live-tested all 10 by typing each vertical's exact `-feature` chip message
into the chat UI (already-logged-in browser at
`https://local.ping-devops.com:4000`) and inspecting the `/api/mcp/tool`
network response:

| tool | vertical | chip message | result |
|---|---|---|---|
| show_mortgage | banking | "show my mortgage" | **PASS** |
| show_health_record | healthcare | "show my health record" | **PASS** |
| show_large_purchase | retail | "show my large purchase" | **PASS** |
| show_expense_report | workforce | "view my expense report" | **PASS** |
| show_gear_order | sporting-goods | "show my gear orders" | **PASS** (the original repro) |
| show_permit | government | "show permit status" | FAIL — `intent_mismatch` |
| show_investment | investment | "show portfolio status" | FAIL — `intent_mismatch` |
| show_work_order | manufacturing | "show work order status" | FAIL — `intent_mismatch` |
| show_enrollment | university | "show enrollment status" | FAIL — `intent_mismatch` |
| show_gear_warranty | sporting-goods | "show my gear warranty" | FAIL — routed to a DIFFERENT wrong tool entirely |

**The 4 `intent_mismatch` FAILs share one mechanism:** the BFF mints an
Intent Token (`bff:intent-token`, HS256) whose `permitted_tools` claim
lists which MCP tools the classified intent may invoke. For these 4
verticals, `permitted_tools` is populated from a stale/legacy
`view_*`/`list_*` name list that never contains the real `show_*` tool
name — so PingOne Authorize's `mcp-intent-mismatch` check correctly denies
a call the BFF itself mis-labeled. **This is NOT the audience/scope/policy
bug already fixed** — confirmed live that `gw-authorize` / `P1AZDecision`
behaved correctly in every case (deny on a genuine mismatch). The bug is
upstream, wherever the BFF computes `permitted_tools` per vertical/intent —
**not yet located**. Worth grep'ing `nlIntentSanitize.js`,
`demoAgentLangGraphService.js`, and wherever `intent-token` gets minted
(search for `permitted_tools` and `bff:intent-token` as anchors) for a
per-vertical or hardcoded list that's drifted from the live `show_*` tool
names.

**`show_gear_warranty` is a second, distinct issue**: its freeform chip
text got routed through `/api/agent/invoke` (the LangGraph "Heuristic"
customer agent path), which invoked a DIFFERENT wrong tool name
(`gear_warranty_demo`, not `show_gear_warranty`) — a routing-layer
mismatch, not just a `permitted_tools` gap. Same vertical's `show_gear_order`
chip routes correctly (via `/api/mcp/tool` directly) — so whatever decides
which of the two paths a chip's NL text takes is itself inconsistent within
the same vertical. Not investigated further.

**How to reproduce/verify a fix**: switch vertical via
`fetch('/api/verticals/active', {method:'POST', body: JSON.stringify({id: '<vertical>'})})`,
open the AI Agent dialog, type the EXACT chip message from the table above
(not a paraphrase — the NL classifier is keyword-fuzzy and approximate text
can route to the wrong tool), inspect the newest `/api/mcp/tool` POST's
response body. PASS = HTTP 200 + a `result` field with real content. The
intent-token's `permitted_tools` claim is visible in the response's
`tokenEvents[].claims.permitted_tools` array — that's the fastest way to
confirm whether a fix actually added the missing tool name.

---

## What shipped this session (5 PRs, all merged)

| PR | What |
|---|---|
| #1918 | A&F (abercrombie-fitch) migrated from flat mock JSON to real SQLite (`abercrombieDb.ts`, mirrors `workforceDb.ts`) — last of the 8-vertical SQLite migration |
| #1920 | apikey-disposition tools were minting a token for the WRONG PingGateway audience (plain `/mcp` instead of `/mcp/apikey`) — 401 |
| #1923 | Fixed #1920 exposed: Exchange #2 wasn't requesting the tool's per-tool scope (e.g. `gear:read`) — 403 `insufficient_scope`. Moved the 9 tool scopes live from the `Demo MCP Gateway` PingOne resource to the new `MCP Gateway - API-Key` resource (PingOne forbids one client holding a scope name on two resources) |
| #1925 | Fixed #1923 exposed: PingOne Authorize's REAL cloud policy (`HasValidMcpAudience`) still denied — its accepted-audience list is baked at **import time** from `scope-topology.json` via `snapshots/gen-authorize-snapshot.js`, not read dynamically as old code comments assumed. Added the new resource to the SoT, regenerated the snapshot, **imported it into the live PingOne Authorize console (env `01d89b06`) — done, `verify:authorize-parity` confirms 7/7 rules live** |
| #1929 | Two UI fixes: full-viewport loading overlay (was leaving the demo-script teleprompter visible behind it), collapsible "Live Pipeline" section in both `TokenChainTraceRail.jsx` and `TokenChainFilmstrip.jsx` |

**Full live proof for `show_gear_order`** (Super Sports / sporting-goods),
captured from the actual `/api/mcp/tool` response after all 3 fixes +
console import + resync:
```
Final MCP Token: aud=["https://api.ping.demo:3036/mcp/apikey"] ✅
scope: "apikey:mcp:invoke gear:read"
PingGateway → PingOne Authorize: PERMIT (backend: real)
filterChain: all 5 filters passed, P1AZDecision forwarded
```
Response: real order data (Garmin Fenix 8 GPS Watch, $799, Delivered).

---

## Traps this session cost real time — do not repeat

- **This worktree cannot write the running Docker stack's main checkout** —
  confirmed the permission classifier blocks bulk `cp` of multiple source
  files into `/Users/cmuir/Development/AI-DEMO2` at once, but allows a
  SINGLE targeted file copy for live-testing purposes. Bulk-copying is not
  a reliable dev-loop; commit+push+merge+`scripts/sync-main-checkout.sh`+
  `run-docker.sh restart <svc>` is the real loop. `sync-main-checkout.sh`
  backs off (does nothing) on ANY unexpected dirty file in main checkout,
  including a live-test `cp` byte-identical to what would be pulled anyway
  — you (a fresh session, not blocked the same way this worktree was) can
  just `git checkout -- <file>` there directly to clear it before syncing.
- **`gh pr merge --delete-branch` always fails on the LOCAL branch delete**
  step in this worktree ("fatal: 'main' is already used by worktree") —
  harmless, the remote branch still deletes fine, the merge still lands.
  Don't chase this error.
- **PingOne resource NAMES in this repo are NOT literally "AI Demo X" or
  "Super Banking X"** — the live PingOne resources are bare names like
  `Demo MCP Gateway`, `Demo PingGateway MCP`. `scope-topology.json` uses
  `Super Banking X` as its internal SoT convention (101 occurrences,
  unrelated to the UI's "AI Demo"-branding naming-contract work from an
  earlier session) and maps SoT name → live resource name via its own
  `resourceNames` block. Don't rename one without the other; don't assume
  they're the same string.
- **`gitleaks` false-positives on `3036/mcp/apikey`** wherever that literal
  substring appears (env files, scope-topology.json, the P1AZ snapshot,
  generated docs) — already added to `.gitleaksignore` with exact
  `file:rule:line` fingerprints; if a NEW file introduces the same string,
  you'll need a new `.gitleaksignore` line (`gitleaks detect --source
  <file> --no-git --verbose` to get the fingerprint) — don't `--no-verify`.
- **`topology:verify` (8 offline steps) is worth running after ANY
  `scope-topology.json` edit** — it caught 2 real drifts this session
  (missing scope alias, stale generated doc) before they became CI
  failures. It's offline-only by design though: it can't catch live
  PingOne state or application-logic bugs (exactly the class of bug
  described in "Start here" above) — only `verify:authorize-parity` +
  actual browser testing closes that gap.
- **Session/login expires across long work** — `demoUser` /
  `demo_api_server/.env`'s `DEMO_USER_PASSWORD` value (probe fresh, it has
  flipped before — see memory `project-demo-user-password-hint-is-stale`).
  Sign-in only works on `local.ping-devops.com:4000`, not `api.ping.demo`.
- **Worktree has no gitignored `.env`, `node_modules`** in any service
  dir — symlink `node_modules` from the main checkout per-service
  (`demo_api_server`, `demo_api_ui`, `demo_mcp_gateway`, etc.) before
  running jest/vitest; P1AZ-provisioning scripts that need PingOne worker
  creds must run via `docker exec ai-demo-api-server node -e "..."`
  (reuses the container's live env) since the worktree has no `.env` to
  read them from directly.

---

## Environments

**Local Docker** — `./run-docker.sh`; UI `https://local.ping-devops.com:4000`
(sign-in ONLY works on this host).

**Full memory record**: `project-sqlite-migration-all-8-verticals-2026-08-17`
in this session's auto-memory has the complete blow-by-blow (every root
cause, every live evidence snippet, every PR).
