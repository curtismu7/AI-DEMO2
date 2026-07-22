# Weather MCP — session handoff (2026-07-22)

Continuation notes for picking this work back up on a different machine. Written at the
end of a long session that built out the weather-mcp Agent Gateway showcase end-to-end.

## Where things stand

| PR | Status | What it shipped |
|---|---|---|
| #690 | **Merged** | `rsFilter` introspection fix (wrong PingOne client-auth method) |
| #691 | **Merged** | `baseURI` decorator misplacement + regex-as-prefix `UriPathRewriteFilter` bug — root cause of weather's original 502 |
| #713 | **Merged** | Wired `get_weather` into the real AI agent chat (LLM + heuristic paths); admin-configurable Agent Gateway scope (Texas/Michigan/Any) via `ff_weather_mcp_allowed_state`, inline dropdown on the Capability Tour card |
| #714 | **Open, not yet merged** | `POST /api/admin/reset-demo` now resets the two weather flags to defaults; new `UC32` demonstrating the live-reconfigurability itself |

**If you're picking this up fresh: merge #714 first** (`gh pr merge 714 --merge --admin --delete-branch=false` — this repo's GitHub Actions is billing-blocked so the remote checks show red; the local pre-push hook already ran the real CI and passed, that's authoritative). After merging, sync whatever checkout you're working from to `origin/main`.

## What actually works right now (all verified live, not just unit-tested)

- Real chat message → LLM or heuristic tool-call → `get_weather` → `ping-gateway`
  `/mcp/weather` → real third-party `weather-mcp` backend. Confirmed in the gateway's own
  `access.audit.json`, not just app-level logs.
- Texas-only scope enforcement, entirely at the gateway (`ping-gateway/scripts/groovy/tx-weather-scope.groovy`) — the backend has zero awareness of the restriction.
- Live-configurable scope: an admin dropdown (Texas / Michigan / Any — no restriction) on
  `/agent-gateway-capabilities`'s "Scope a third-party MCP server" card, backed by
  `ff_weather_mcp_allowed_state`. Changes take effect on the *next* request, no gateway
  restart — verified by flipping the same "weather in Miami" chat query from denied to
  allowed live.
- `ff_weather_mcp_showcase` (master on/off) confirmed independent of the allowed-state flag
  — OFF always 403s regardless of state.
- `POST /api/admin/reset-demo` resets both weather flags back to defaults (PR #714).
- Use cases UC30 (Texas permit), UC31 (out-of-scope deny), UC32 (the configurability itself,
  link-type, points at the Capability Tour) — all in `demo_api_server/config/useCases.js`.

## Known gaps / deliberately not done

- **`01-mcp-olb.json` (the main banking OLB route) has the identical `baseURI`-nested-in-`config` bug** that caused weather's 502 (see PR #691's REGRESSION_PLAN entry). It was *not* fixed there — real OLB traffic appeared unaffected in casual testing, but this was never rigorously verified with a real delegated (non-client-credentials) token reaching its actual `ReverseProxyHandler` stage. Flagged, not fixed. If you pick this up: mint a real user-delegated token (client_credentials + RFC 8693 alone won't get past PingOne Authorize's `UserId` requirement on that route — see REGRESSION_PLAN's "P1AZ Actor-ID Drift" history) and test whether `01-mcp-olb.json`'s reverse-proxy stage actually works.
- **`demo_mcp_gateway` (the Node gateway) has no weather-mcp equivalent.** `get_weather` chat routing is PingGateway-only (`mcpGatewayClient.js`'s `WEATHER_TOOLS` set only fires when `isIgBase`). If the demo ever runs on the Node gateway path by default, this tool silently falls through to `/mcp` with no handler.
- **No automated test for `tx-weather-scope.groovy` itself** — no framework in this repo reaches Groovy directly. Every change to that file needs live verification (mint a token, curl the real gateway) — see REGRESSION_PLAN's "Verify" sections on the relevant entries for the exact recipe.
- `mcp-weather`'s own `ENABLED_TOOLS` config doesn't include `get_weather` — every successful gateway-level PERMIT still gets `{"isError":true,"text":"Tool 'get_weather' is not enabled..."}` from the actual backend. This is the third-party backend's own config, not a gateway/chat bug — the gateway-level PERMIT/DENY behavior is what's being demoed, not the backend's tool availability. If a fuller demo needs a real weather response, that backend config needs a separate look.

## How to get this running on a new machine

This repo's live stack needs secrets/certs that aren't in git (`demo_api_server/.env`,
`ping-gateway/.env`, mkcert certs under `certs/`, `demo_api_ui/.env`). There's no shortcut
around provisioning those on a genuinely new machine — follow the repo's own `docs/SETUP.md` /
`README.md` bootstrap flow first. Once a working checkout exists (even just the main branch,
no worktree needed after #714 merges), the feature works out of the box — nothing about it
needs the specific worktree paths mentioned below; those were this session's *verification*
mechanism, not a deployment requirement.

**Only relevant if you're resuming an unmerged worktree specifically** (i.e., #714 isn't
merged yet and you want this exact worktree, not a fresh `main` checkout): a fresh
`git worktree add` won't carry over gitignored files. From an existing checkout that already
has them:
```bash
ln -sf <existing-checkout>/demo_api_server/.env demo_api_server/.env
ln -sf <existing-checkout>/ping-gateway/.env ping-gateway/.env
ln -sf <existing-checkout>/demo_api_ui/.env demo_api_ui/.env
ln -sf <existing-checkout>/demo_api_server/node_modules demo_api_server/node_modules
# certs/ must be COPIED, not symlinked, if anything here runs via Docker bind-mount
# (a symlink pointing outside the mounted directory doesn't resolve inside the container's
# mount namespace) — plain `cp`, not `ln -sf`, for anything under certs/:
cp <existing-checkout>/certs/*.pem certs/
```

## Gotchas learned this session (worth knowing before touching this area again)

- **`git worktree` + Docker bind mounts:** `docker compose up -d` from a worktree directory
  does NOT reliably rebind an *already-existing* container to that worktree's files — Compose
  sometimes decides "no config change" and leaves the container bound to whatever directory it
  was last created from (often the main checkout). Always use `--force-recreate` when you need
  to be certain a container reflects a specific worktree, and verify with
  `docker inspect <container> --format '{{json .Mounts}}'` before trusting it.
- **jest from a worktree:** the default `testPathIgnorePatterns` excludes any path containing
  `.claude/worktrees/` — running jest from inside a worktree with no override sees 0 test
  files. Always pass:
  `--testPathIgnorePatterns="/node_modules/|\.claude/worktrees/(?!<this-worktree-name>)|/\.kilo/worktrees/|/tests/real/"`
- **This machine's test suite flakes under heavy concurrent load** (many docker containers +
  vite dev servers + repeated full jest runs in one long session) — 30-second-timeout
  failures in files completely unrelated to whatever you're changing are very likely
  environmental, not real regressions. Confirmed multiple times this session: the *same* full
  suite ran clean (550/551, 0 failures) moments after a run that showed 2-3 unrelated timeout
  failures, with a *different* random set of files failing each time.
- **Cookies don't cross `api.ping.demo` ↔ `local.ping-devops.com`** — they're different
  origins. Sign-in only works on `local.ping-devops.com` (passkey/WebAuthn `rp.id`
  constraint). If you spin up a temporary dev server on another port for worktree testing
  (`PORT=4443 npx vite` from `demo_api_ui/` — the `--port` CLI flag does NOT work, the config
  only reads `process.env.PORT`), browse it via `https://local.ping-devops.com:4443`, not
  `api.ping.demo:4443`, or you'll get 401s despite having a valid session elsewhere.
- **`use-cases:check` (a pre-push gate) fails after adding/editing any `useCases.js` entry**
  until you run `npm run use-cases:gen` (from `demo_api_server/`) — it regenerates
  `docs/use-cases/audit-table.md`, one markdown file per use case, `README.md`'s index, and
  `demo-runbook.md`. Forgetting this is the single most common reason a push gets rejected
  after a `useCases.js` change.
- **Another concurrent session was working directly in the main checkout** on an unrelated
  CIBA/step-up/PAR feature for most of this session. At one point its uncommitted, in-progress
  code accidentally ended up inside a commit on this branch (via a `git add` of `useCases.js`
  that picked up contaminated working-tree content, not this branch's own edits). Caught by
  noticing `grep -c UC30 useCases.js` returned 0 right after a commit that was supposed to add
  it — a plain diffstat count wouldn't have surfaced this, since the contaminating commit's
  insertion/deletion counts looked entirely plausible on their own. Fixed with a dedicated
  revert commit (`80d69c84f`). If you see main checkout has unrelated dirty files again, don't
  assume it's yours — check `git diff` content, not just `git status`, before touching
  anything there.
