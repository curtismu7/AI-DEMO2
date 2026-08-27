# Privilege agentless banking client — handoff for a fresh session

> Written 2026-08-24, end of a very long session, to let a fresh agent pick
> up in under a minute. Companion doc:
> `2026-08-23-external-door-token-chain-bridge.md` (the oauth-mcp
> external-door investigation this session started from — separate, mostly
> resolved scope, read only if picking that thread back up specifically).

## TL;DR — where things stand

The banking demo's external-door MCP flow now works **two independent
ways**, both proven live with real account data for a real PingOne user:

1. **Direct** (`oauth-mcp`'s own embedded AS) — MCP Inspector or `curl` →
   `https://cmuir-mcp.ping-devops.com/mcp`. Fully fixed and merged (see the
   companion doc).
2. **Through PingOne Privilege** (agentless gateway, policy-enforced) — the
   BFF's own Privilege MCP client (`/privilege-mcp-client`, "Agentless
   gateway — banking (external)" preset) → Privilege → `oauth-mcp`'s
   `mcp-server`. **This is the new work tonight** and the subject of this
   doc. MCP Inspector does **not** work against this path (documented,
   understood, not a bug worth chasing further — see below).

**Everything is on one branch, one open PR:**
`worktree-external-door-well-known-suffix-routing` → **PR #2324** (open,
mergeable, 16 commits — the list looks long because GitHub still shows
already-squash-merged history from PRs #2296/#2310; the actual unmerged
diff is small: `privilegeMcpClient.js` + its test, `AGENTLESS-CONFIGURATION.md`,
and `ToolsTable.{jsx,css,test.jsx}`). Check CI and merge when ready — same
process used all night: `gh pr checks 2324 --watch`, confirm `mergeStateStatus:
CLEAN`, `gh pr merge 2324 --squash --delete-branch=false`, then
`scripts/sync-main-checkout.sh`.

## What's deployed right now, and what isn't

| Component | Code state | SE cluster (`ping-devops-cmuir`) |
|---|---|---|
| `oauth-mcp` (`mcp-server`) | merged to `main` | deployed, live-verified |
| `demo_api_server` (BFF) — banking preset + Streamable HTTP fallback | committed, pushed, **not yet merged** (PR #2324) | **deployed directly from this branch** — live-verified working |
| `demo_api_ui` (`ToolsTable` enum dropdowns) | committed, pushed, **not yet merged** (PR #2324) | **NOT yet deployed** — this is the one loose end, see "Immediate next step" below |
| Privilege gateway config (`pingone.env` OIDC fields, `external` app) | N/A — live tenant/cluster config, not code | live, working |

## The two big things fixed tonight (full detail in `privilege/AGENTLESS-CONFIGURATION.md`'s "2026-08-24" section)

1. **The gateway's own OIDC config was empty.** `agentless-mcpgw-oidc-config`
   Secret's `pingone.env` had every `OIDC_*` field blank — not the
   historical "PingOne token wall" the `privilege-cloud-mcp` skill still
   documents (that's now stale/fixed, see
   `project-privilege-skill-stale-vs-docs` memory). Fixed by populating it
   from the same PingOne app (`a6219652-47af-4ed2-8dea-20e9940b3377`) the
   BFF's own `PRIVILEGE_SSO_*` config already uses.
2. **A new Privilege "Agentic App" named `external`** (separate from the
   pre-existing `cmuir`, which stays pointed at an unrelated backend) routes
   `https://cmuir-agentless-mcpgw.ping-devops.com/external/mcp` →
   `http://mcp-server.ping-devops-cmuir.svc.cluster.local:8080/mcp`. A first
   attempt (`http-external`, created by editing/repurposing an existing
   object instead of the console's dedicated "Add Application → MCP Server"
   flow) never got a working `FrontEndName` registered — if this happens
   again, recreate through that specific flow, don't debug the Graph nodes.

## Why MCP Inspector doesn't work here, but the BFF's own client does — root-caused, not a mystery

Confirmed by reading `demo_api_server/routes/privilegeMcpClient.js`'s
`fetchMcp`: the BFF issues every MCP call as an independent POST that reads
the full response and returns — it never opened a persistent `GET /mcp` SSE
stream, unlike MCP Inspector (which does, per the Streamable HTTP spec,
alongside its POSTs). That combination — concurrent POST + a held-open GET
on the same session — hangs against this specific gateway's own
response-rewriting proxy layer (`mcpfilter`). `curl` (fresh connection,
matches the BFF's shape) never hits it.

**Tonight this got tested for real, not just theorized:** added
`openMcpEventStream()` to the BFF (opens the same persistent GET stream
Inspector does, after the handshake) plus a timeout-guarded automatic
fallback in `fetchMcp` (if a POST hangs while that stream is open, abort,
permanently disable the stream for that session, retry POST-only). Deployed
and tested live — **the fuller mode worked cleanly, no fallback needed**:
`GET /mcp` opened, `tools/list` and `tools/call` both completed in
well under a second. So the BFF client now runs the *more* spec-complete
transport and it's fine; Inspector's specific implementation/timing is what
trips the gateway, not the transport shape in general. Worth a note if this
surfaces again elsewhere: it's the gateway's `mcpfilter` layer that's
fragile, not Streamable HTTP itself.

## The new banking preset

`demo_api_server/routes/privilegeMcpClient.js`'s `presets` array
(`GET /api/privilege-mcp/state`) gained a third, purely-additive entry:

```js
{
  label: 'Agentless gateway — banking (external)',
  mode: 'agentless',
  url: process.env.PRIVILEGE_AGENTLESS_MCPGW_URL_BANKING || '',
}
```

Env var is set on the SE cluster's `ai-demo-secrets` Secret (added, not
overwritten — the existing `PRIVILEGE_AGENTLESS_MCPGW_URL` for `cmuir` is
untouched). No UI changes needed — `PrivilegeMcpClientPage`'s preset
dropdown already renders generically off this array. **This is meant to
become the primary external-client demo path** (per direct user
instruction tonight), since it doesn't hit Inspector's proxy-interop
problem.

## Immediate next step: deploy the `ToolsTable` UI fix

The very last commit on the branch (`feat(demo_api_ui): dropdown for enum
tool params...`) is **tested (4/4 pass, `npm run build` green) but not yet
deployed** to the SE cluster's `frontend` service. It fixes a real bug
found live tonight: calling `get_my_accounts` with a blank `account_type`
silently sent `{"account_type":""}` instead of refusing to run. Now enum
params get a `<select>` dropdown wired straight into the same args-JSON
state, and Execute is disabled with an inline "Missing required: ..."
message when a required field is empty.

To deploy: same recipe used all night for `mcp-server`/`demo-api-server`,
but for the `frontend` compose service —

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/external-door-well-known-suffix-routing
COMPOSE_PARALLEL_LIMIT=1 docker compose -p ai-demo-k8 -f docker-compose.yml build frontend
docker tag ai-demo-k8-frontend:latest ghcr.io/curtismu7/ai-demo-frontend:latest   # confirm the actual GHCR image name first — check `kubectl get deployment frontend -n ping-devops-cmuir -o jsonpath='{.spec.template.spec.containers[0].image}'`
docker push ghcr.io/curtismu7/ai-demo-frontend:latest
kubectl rollout restart deployment/frontend -n ping-devops-cmuir
kubectl rollout status deployment/frontend -n ping-devops-cmuir --timeout=120s
```

Then verify: `/privilege-mcp-client` → banking preset → `get_my_accounts` →
confirm the `account_type` field renders as a dropdown, not a bare textarea.

## Known trap hit repeatedly tonight — read before touching MCP Inspector again

Every `mcp-server`/`agentless-mcpgw`/`demo-api-server` pod restart silently
orphans whatever OAuth session MCP Inspector (or the BFF client) was
holding — in-memory state (`TokenStore` on `oauth-mcp`, DCR client
registrations on the Privilege gateway) gets wiped, but the client's own
still-valid bearer token has no reason to re-authenticate, so it just
replays a token whose server-side stash is now empty. Symptom: identical
errors that don't seem to respond to fixes. Fix: kill the MCP Inspector
backend process (`pgrep -f mcp-inspector`, `kill <pid>`), clear
`~/.mcp-inspector/storage/{oauth.json,inspector-session-*.json}`, restart
(`nohup npx -y @modelcontextprotocol/inspector &`) — forces a genuinely
fresh DCR + login. `oauth-mcp`'s `TokenStore` now persists across restarts
(PR #2310, merged) so this specific instance of the trap is fixed for that
one path, but the general pattern (redeploy wipes in-memory state, client
doesn't know to re-auth) can still bite anywhere else it applies.

## Worktree setup note

This worktree had **no `node_modules`** for either `demo_api_server` or
`demo_api_ui` until tonight (first time either was touched here) — if a
fresh session hits "jest: command not found" or similar, that's why. Fix:
`npm install` in the relevant service directory (took ~1-3 min each,
backgrounded). `oauth-mcp` already had `node_modules` from earlier in the
night.
