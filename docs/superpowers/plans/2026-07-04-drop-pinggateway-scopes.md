# Drop Demo-Invented PingGateway Scopes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the demo-invented `pinggateway:invoke` and `banking:mcp:invoke` scopes from the PingGateway (Agent Gateway / IG) exchange path so the whole chain carries the real `mcp:invoke` scope, with resource binding done by the RFC 8707 audience (`https://api.ping.demo:3036/mcp`) — matching how the real Ping Agent Gateway product actually works.

**Architecture:** The PingGateway path is a parallel route to the working Node-gateway path, gated by `ff_mcp_gateway_pinggateway`. Today the BFF mints a special `pinggateway:invoke` scope for RFC 8693 Exchange #2 (audience `:3036/mcp`), the IG validates `banking:mcp:invoke` inbound and requests `banking:mcp:invoke` on its own Exchange #3, and `scope-topology.json` carries a dead `aliases{}` block to keep the drift-gate quiet. We replace all three demo-invented scope strings with `mcp:invoke` (already a first-class scope in the SoT) and delete the alias block. The real product requires only a valid bearer + RFC 8707 resource-indicator match + a configurable coarse scope — never a gateway-specific scope name (see `references/curated/agent-gateway-mcp.md`, McpProtectionFilter).

**Tech Stack:** Node.js BFF (`demo_api_server`), PingOne Management API (worker app `89ad8921`, direct REST — the `pingone` MCP connector is unauthenticated this session), PingGateway 2026.x (`ai-demo-ping-gateway` container, ForgeRock IG routes + Groovy), `scope-topology.json` source-of-truth + `topology:verify` drift gate.

## Global Constraints

- **Work only in this worktree** (`worktree-fix-drop-pinggateway-scopes`). Stage files explicitly (`git add <files>`), never `git add -A`. Verify `git branch --show-current` before each commit.
- **PingOne edge quirks (from prior sessions):** `PATCH` on resources is rejected with a bogus `Invalid key=value in Authorization header` 403 — use `PUT` full-object or `POST` sub-resource instead. Mint the worker token *inside* the `ai-demo-api-server` container so the secret never leaves it.
- **Reversibility:** All PingOne scope changes are additive first (add `mcp:invoke`), destructive last (remove `pinggateway:invoke`). Do not remove `pinggateway:invoke` until the empirical gate (Task 2) and the config changes (Tasks 3–5) are proven.
- **Audience is canonical `:3036/mcp`** everywhere (already hardened by PR #141). Do not reintroduce `:3006`.
- **Do NOT touch** the working Node-gateway path (`effectiveToolScopes` branch) — only the `usePingGatewayForExchange === true` branch.
- **HARD GATE:** If Task 2's exchange test shows `mcp:invoke` + `audience=:3036/mcp` does NOT select resource `6635cfb8` (i.e. the returned token's `aud` is `mcpgateway.ping.demo` or the request errors `May not request scopes for multiple resources`), STOP. Do not proceed to Tasks 3–6. Report the finding — the demo-invented scope may be the only working disambiguator, which changes the design.

---

## Environment / reusable snippets

**Mint a worker token + set Management API base (run inside the api-server container):**

```bash
# All PingOne steps run through this helper. ENV/creds come from the container's env.
docker exec ai-demo-api-server sh -lc '
  ENV="$PINGONE_ENVIRONMENT_ID"
  TOK=$(curl -s -X POST "https://auth.pingone.com/$ENV/as/token" \
    -u "$PINGONE_WORKER_CLIENT_ID:$PINGONE_WORKER_CLIENT_SECRET" \
    -d grant_type=client_credentials | node -e "let s=\"\";process.stdin.on(\"data\",d=>s+=d).on(\"end\",()=>console.log(JSON.parse(s).access_token))")
  echo "TOKEN_LEN=${#TOK}"   # sanity: non-zero means auth worked
'
```

- Management API base: `https://api.pingone.com/v1/environments/$ENV`
- IG resource (Demo PingGateway MCP): id `6635cfb8`, aud `https://api.ping.demo:3036/mcp`
- Exchanger app (Demo AI App - Token Exchanger): client `f4dd707d-f78d-4417-ba56-dc8707d10a1f`

---

### Task 1: Discover current PingOne state + add `mcp:invoke` to the IG resource (additive, reversible)

**Files:** none (PingOne Management API only).

**Interfaces:**
- Produces (for later tasks): confirmed scope id for `mcp:invoke` on resource `6635cfb8`; confirmed the exchanger app's grant object id for that resource; a recorded rollback note (the `pinggateway:invoke` scope id, to remove in Task 6).

- [ ] **Step 1: Read the IG resource's current scopes**

```bash
docker exec ai-demo-api-server sh -lc '
  ENV="$PINGONE_ENVIRONMENT_ID"
  TOK=$(curl -s -X POST "https://auth.pingone.com/$ENV/as/token" -u "$PINGONE_WORKER_CLIENT_ID:$PINGONE_WORKER_CLIENT_SECRET" -d grant_type=client_credentials | node -pe "JSON.parse(require(\"fs\").readFileSync(0)).access_token")
  curl -s "https://api.pingone.com/v1/environments/$ENV/resources/6635cfb8/scopes" -H "Authorization: Bearer $TOK" | node -pe "JSON.parse(require(\"fs\").readFileSync(0))._embedded.scopes.map(s=>s.id+\"  \"+s.name).join(\"\n\")"
'
```

Expected: lists `pinggateway:invoke` (record its scope id as the Task 6 rollback target). Note whether `mcp:invoke` already exists.

- [ ] **Step 2: Add the `mcp:invoke` scope to resource `6635cfb8` (skip if Step 1 already showed it)**

```bash
docker exec ai-demo-api-server sh -lc '
  ENV="$PINGONE_ENVIRONMENT_ID"
  TOK=$(curl -s -X POST "https://auth.pingone.com/$ENV/as/token" -u "$PINGONE_WORKER_CLIENT_ID:$PINGONE_WORKER_CLIENT_SECRET" -d grant_type=client_credentials | node -pe "JSON.parse(require(\"fs\").readFileSync(0)).access_token")
  curl -s -X POST "https://api.pingone.com/v1/environments/$ENV/resources/6635cfb8/scopes" -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" -d "{\"name\":\"mcp:invoke\",\"description\":\"Invoke MCP tools via the PingGateway MCP route (RFC 8693 exchange)\"}" | node -pe "let j=JSON.parse(require(\"fs\").readFileSync(0)); j.id?(\"CREATED \"+j.id):JSON.stringify(j)"
'
```

Expected: `CREATED <scopeId>` (or a `UNIQUENESS_VIOLATION` if it already exists — acceptable).

- [ ] **Step 3: Find the exchanger app's grant for resource `6635cfb8` and add `mcp:invoke` to it**

```bash
docker exec ai-demo-api-server sh -lc '
  ENV="$PINGONE_ENVIRONMENT_ID"; APP="f4dd707d-f78d-4417-ba56-dc8707d10a1f"
  TOK=$(curl -s -X POST "https://auth.pingone.com/$ENV/as/token" -u "$PINGONE_WORKER_CLIENT_ID:$PINGONE_WORKER_CLIENT_SECRET" -d grant_type=client_credentials | node -pe "JSON.parse(require(\"fs\").readFileSync(0)).access_token")
  curl -s "https://api.pingone.com/v1/environments/$ENV/applications/$APP/grants" -H "Authorization: Bearer $TOK" | node -pe "JSON.parse(require(\"fs\").readFileSync(0))._embedded.grants.map(g=>g.id+\"  resource=\"+(g.resource&&g.resource.id)+\"  scopes=\"+(g.scopes||[]).map(s=>s.id).join(\",\")).join(\"\n\")"
'
```

Expected: a grant whose `resource.id === 6635cfb8`. Record its grant id. Then `PUT` the full grant object back with the `mcp:invoke` scope id (from Task 1 Step 2) appended to its `scopes[]` array (PUT full-object — PATCH is rejected). Use the grant id and the existing scope-id list from this output; the PUT body is `{"resource":{"id":"6635cfb8"},"scopes":[{"id":"<pinggateway-scope-id>"},{"id":"<mcp-invoke-scope-id>"}]}`.

```bash
# Fill GRANT_ID / PGW_SCOPE_ID / MCP_SCOPE_ID from the prior steps, then:
docker exec ai-demo-api-server sh -lc '
  ENV="$PINGONE_ENVIRONMENT_ID"; APP="f4dd707d-f78d-4417-ba56-dc8707d10a1f"
  TOK=$(curl -s -X POST "https://auth.pingone.com/$ENV/as/token" -u "$PINGONE_WORKER_CLIENT_ID:$PINGONE_WORKER_CLIENT_SECRET" -d grant_type=client_credentials | node -pe "JSON.parse(require(\"fs\").readFileSync(0)).access_token")
  curl -s -X PUT "https://api.pingone.com/v1/environments/$ENV/applications/$APP/grants/GRANT_ID" -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" -d "{\"resource\":{\"id\":\"6635cfb8\"},\"scopes\":[{\"id\":\"PGW_SCOPE_ID\"},{\"id\":\"MCP_SCOPE_ID\"}]}" -o /dev/null -w "HTTP %{http_code}\n"
'
```

Expected: `HTTP 200`.

- [ ] **Step 4: Commit a discovery note (no source changes yet)**

```bash
git add docs/superpowers/plans/2026-07-04-drop-pinggateway-scopes.md
git commit -m "docs(pinggateway): plan to drop demo-invented scopes; record PingOne rollback ids"
```

---

### Task 2: Empirical GATE — prove `mcp:invoke` + `audience=:3036/mcp` selects resource `6635cfb8`

**Files:** none (live token-exchange probe).

**Interfaces:**
- Consumes: the additive `mcp:invoke` scope+grant from Task 1.
- Produces: a PASS/FAIL verdict that gates all remaining tasks.

- [ ] **Step 1: Reproduce Exchange #2 as the exchanger, requesting `mcp:invoke` + audience `:3036/mcp`**

Mint an agentgateway-scoped subject token and an `f4dd707d` actor token exactly as the prior session did (both apps are CLIENT_SECRET_POST), then call the token endpoint with `grant_type=urn:ietf:params:oauth:grant-type:token-exchange`, `scope=mcp:invoke`, `audience=https://api.ping.demo:3036/mcp`. Decode the returned `access_token`.

```bash
# Run the existing repro helper if present, else the raw exchange. The check that matters:
# decode the returned token and assert aud.
docker exec ai-demo-api-server sh -lc '
  # ... perform the two-leg exchange (subject=agentgateway CC token carrying may_act={sub:f4dd707d};
  #     actor=f4dd707d CC token) with scope=mcp:invoke audience=https://api.ping.demo:3036/mcp ...
  echo "$FINAL_TOKEN" | node -e "let t=require(\"fs\").readFileSync(0,\"utf8\").trim().split(\".\")[1];let c=JSON.parse(Buffer.from(t,\"base64\"));console.log(\"aud=\"+JSON.stringify(c.aud)+\" scope=\"+c.scope)"
'
```

- [ ] **Step 2: Evaluate the gate**

Expected PASS: `aud` includes `https://api.ping.demo:3036/mcp` (NOT `mcpgateway.ping.demo`) and `scope` includes `mcp:invoke`.

- **If PASS:** proceed to Task 3.
- **If FAIL** (aud is `mcpgateway.ping.demo`, or `invalid_scope: May not request scopes for multiple resources`): STOP. The audience alone does not disambiguate; `pinggateway:invoke` is load-bearing. Roll back Task 1 (Task 6 removal steps for `mcp:invoke`), then report to the user with the exact PingOne response — the design needs revisiting (e.g. keep a distinct real scope, or make the exchanger hold `mcp:invoke` on *only* the IG resource).

---

### Task 3: BFF — request `mcp:invoke` for the PingGateway leg instead of `pinggateway:invoke`

**Files:**
- Modify: `demo_api_server/services/agentMcpTokenService.js:2289-2296`

**Interfaces:**
- Consumes: `usePingGatewayForExchange` (bool, line 2265), `effectiveToolScopes` (string[]).
- Produces: `ex2Scopes` now `['mcp:invoke']` for the PingGateway leg.

- [ ] **Step 1: Replace the special-cased scope**

Change the block at [agentMcpTokenService.js:2289-2296](demo_api_server/services/agentMcpTokenService.js#L2289) from:

```js
    // When routing through PingGateway, send the unique pinggateway:invoke scope
    // so PingOne unambiguously selects the f2669dd9 (https://api.ping.demo:3036/mcp)
    // grant. Sending effectiveToolScopes (read, transfer, …) caused PingOne to fall
    // back to fb2d09cb (mcpgateway.ping.demo, which has read). Empty scopes also
    // fail: PingOne returns "May not request scopes for multiple resources" when the
    // exchanger has multiple RS grants and no scope narrows the selection.
    const pingGatewayInvokeScope = configStore.getEffective('pinggateway_invoke_scope') || 'pinggateway:invoke';
    const ex2Scopes = usePingGatewayForExchange ? [pingGatewayInvokeScope] : effectiveToolScopes;
```

to:

```js
    // PingGateway (Agent Gateway) binds the request to its MCP resource via the
    // RFC 8707 audience (https://api.ping.demo:3036/mcp), not a gateway-specific
    // scope. Request the real mcp:invoke scope — the audience narrows PingOne's
    // grant selection to the :3036 resource (verified 2026-07-04). No demo-invented
    // pinggateway:invoke / banking:* scope.
    const ex2Scopes = usePingGatewayForExchange ? ['mcp:invoke'] : effectiveToolScopes;
```

- [ ] **Step 2: Grep-verify no other references to the removed scope remain in the BFF**

Run: `grep -rn "pinggateway_invoke_scope\|pinggateway:invoke" demo_api_server/`
Expected: no matches (the config-key default and the string are both gone).

- [ ] **Step 3: Restart the BFF to pick up the change and confirm it boots**

Run: `docker restart ai-demo-api-server && sleep 5 && docker logs --tail 20 ai-demo-api-server`
Expected: server starts clean, no config-guard failure.

- [ ] **Step 4: Commit**

```bash
git add demo_api_server/services/agentMcpTokenService.js
git commit -m "fix(pinggateway): request real mcp:invoke on Exchange #2, drop pinggateway:invoke"
```

---

### Task 4: IG env — `PG_INBOUND_SCOPE` / `PG_OLB_SCOPE` → `mcp:invoke`

**Files:**
- Modify: `ping-gateway/.env` (live, gitignored) — lines `PG_INBOUND_SCOPE`, `PG_OLB_SCOPE`
- Modify: `ping-gateway/.env.example:52,72,85` — `PG_INBOUND_SCOPE`, `PG_OLB_SCOPE`, `PG_INVEST_SCOPE`

**Interfaces:**
- Consumes: the `mcp:invoke`-scoped inbound token now minted by Task 3.
- Produces: IG JWKS validation (`jwks-token-validation.groovy`, requires `PG_INBOUND_SCOPE`) and Exchange #3 (`olb-token-exchange.groovy`, requests `PG_OLB_SCOPE`) both keyed on `mcp:invoke`.

- [ ] **Step 1: Update the committed example (source of the value)**

In `ping-gateway/.env.example` set `PG_INBOUND_SCOPE=mcp:invoke`, `PG_OLB_SCOPE=mcp:invoke`, `PG_INVEST_SCOPE=mcp:invoke` (was `banking:mcp:invoke` on all three).

- [ ] **Step 2: Update the live env with a backup**

```bash
cd ping-gateway
cp .env .env.bak-bankingscope
sed -i '' 's/^PG_INBOUND_SCOPE=.*/PG_INBOUND_SCOPE=mcp:invoke/; s/^PG_OLB_SCOPE=.*/PG_OLB_SCOPE=mcp:invoke/; s/^PG_INVEST_SCOPE=.*/PG_INVEST_SCOPE=mcp:invoke/' .env
grep -E "PG_INBOUND_SCOPE|PG_OLB_SCOPE|PG_INVEST_SCOPE" .env
cd ..
```

Expected: all three now read `mcp:invoke`.

- [ ] **Step 3: Recreate the IG container so it re-reads env**

Run: `docker compose up -d --force-recreate ping-gateway && sleep 8 && docker logs --tail 30 ai-demo-ping-gateway`
Expected: routes load; no `insufficient_scope` on the `00-mcp-olb-jwks` route at boot.

- [ ] **Step 4: Commit the example (the live `.env` is gitignored)**

```bash
git add ping-gateway/.env.example
git commit -m "fix(pinggateway): IG inbound/olb/invest scope -> mcp:invoke (drop banking: prefix)"
```

---

### Task 5: SoT — delete the dead `aliases{}` block

**Files:**
- Modify: `scope-topology.json` (remove the `"aliases": { "banking:mcp:invoke": ..., "ai:agent": ... }` line)

**Interfaces:**
- Consumes: nothing (confirmed no runtime consumer of `aliases`).
- Produces: a topology with no demo-invented scope aliases; `topology:verify` still green.

- [ ] **Step 1: Confirm the alias block is still unreferenced**

Run: `grep -rn "\.aliases\|\[.aliases" demo_api_server --include=*.js | grep -v node_modules`
Expected: no code reads the topology `aliases` map. (If a NEW consumer appeared, stop and reassess.)

- [ ] **Step 2: Remove the `aliases` line from `scope-topology.json`**

Delete the line: `"aliases": { "banking:mcp:invoke": "mcp:invoke", "ai:agent": "ai:agent:read" },`
(If `ai:agent` is referenced elsewhere as a live alias, keep only that entry and drop `banking:mcp:invoke`. Verify with `grep -rn '"ai:agent"' demo_api_server --include=*.js | grep -v node_modules` first.)

- [ ] **Step 3: Run the drift gate**

Run: `npm run topology:verify`
Expected: PASS (5/5 green). If it flags `banking:mcp:invoke` as an unknown scope used by the IG env, that reference is the `.env.example` you already changed in Task 4 — re-run after Task 4 is applied.

- [ ] **Step 4: Commit**

```bash
git add scope-topology.json
git commit -m "chore(topology): drop dead banking:mcp:invoke alias block"
```

---

### Task 6: PingOne cleanup — remove the `pinggateway:invoke` scope + grant (destructive, last)

**Files:** none (PingOne Management API).

**Interfaces:**
- Consumes: proven-working `mcp:invoke` path (Tasks 2–5).
- Produces: no demo-invented scope left in PingOne.

- [ ] **Step 1: Remove `pinggateway:invoke` from the exchanger's grant (PUT full-object without it)**

Using the `GRANT_ID` and `MCP_SCOPE_ID` recorded in Task 1:

```bash
docker exec ai-demo-api-server sh -lc '
  ENV="$PINGONE_ENVIRONMENT_ID"; APP="f4dd707d-f78d-4417-ba56-dc8707d10a1f"
  TOK=$(curl -s -X POST "https://auth.pingone.com/$ENV/as/token" -u "$PINGONE_WORKER_CLIENT_ID:$PINGONE_WORKER_CLIENT_SECRET" -d grant_type=client_credentials | node -pe "JSON.parse(require(\"fs\").readFileSync(0)).access_token")
  curl -s -X PUT "https://api.pingone.com/v1/environments/$ENV/applications/$APP/grants/GRANT_ID" -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" -d "{\"resource\":{\"id\":\"6635cfb8\"},\"scopes\":[{\"id\":\"MCP_SCOPE_ID\"}]}" -o /dev/null -w "HTTP %{http_code}\n"
'
```

Expected: `HTTP 200`.

- [ ] **Step 2: Delete the `pinggateway:invoke` scope from resource `6635cfb8`**

Using the `PGW_SCOPE_ID` recorded in Task 1:

```bash
docker exec ai-demo-api-server sh -lc '
  ENV="$PINGONE_ENVIRONMENT_ID"
  TOK=$(curl -s -X POST "https://auth.pingone.com/$ENV/as/token" -u "$PINGONE_WORKER_CLIENT_ID:$PINGONE_WORKER_CLIENT_SECRET" -d grant_type=client_credentials | node -pe "JSON.parse(require(\"fs\").readFileSync(0)).access_token")
  curl -s -X DELETE "https://api.pingone.com/v1/environments/$ENV/resources/6635cfb8/scopes/PGW_SCOPE_ID" -H "Authorization: Bearer $TOK" -o /dev/null -w "HTTP %{http_code}\n"
'
```

Expected: `HTTP 204`.

---

### Task 7: End-to-end verification + memory update

**Files:**
- Modify: `~/.claude/projects/-Users-cmuir-Development-AI-DEMO2/memory/project-pinggateway-half-built.md` (append result)

**Interfaces:**
- Consumes: the fully-applied change.
- Produces: proof the PingGateway chip flow works with real scopes, and an updated memory.

- [ ] **Step 1: Confirm the feature flag is on for the PingGateway path**

Run: `docker exec ai-demo-api-server sh -lc 'curl -s localhost:3006/api/authorize/evaluation-status -H "Authorization: Bearer $SOME_BEARER"'` (or the project's status route) to confirm `ff_mcp_gateway_pinggateway=true` in the LIVE singleton (a cold require lies — see memory).

- [ ] **Step 2: Drive a tool-backed banking/CareConnect chip through the PingGateway path**

Use the existing real-mode e2e (`demo_api_ui` `test:e2e:real:careconnect:core`) or drive the chip in the UI. Watch `docker logs -f ai-demo-ping-gateway`:
- `[JWKS] validation` PASSES (no `insufficient_scope`),
- `[OlbExchange] REQUEST → ... scope=mcp:invoke`, `RESPONSE HTTP 200`,
- tool result returns to the BFF; the Token Chain rail shows the exchange steps.

Expected: chip is NOT greyed out; tool call succeeds end-to-end.

- [ ] **Step 3: Confirm no demo-invented scope remains anywhere**

Run: `grep -rniE "pinggateway:invoke|banking:mcp:invoke" demo_api_server ping-gateway scope-topology.json | grep -v node_modules | grep -v .env.bak`
Expected: no matches (only historical `.bak` backups may remain).

- [ ] **Step 4: Update the memory**

Append a dated entry to `project-pinggateway-half-built.md` recording: demo-invented scopes removed; chain now uses `mcp:invoke` bound by RFC 8707 audience `:3036`; the empirical gate result from Task 2; the removed PingOne scope/grant ids.

- [ ] **Step 5: Final commit + push**

```bash
git add docs/ scope-topology.json
git commit -m "docs(pinggateway): record real-scope migration + e2e verification"
git push -u origin worktree-fix-drop-pinggateway-scopes
```

Then open a PR to `main` summarizing: demo-invented `pinggateway:invoke`/`banking:*` scopes removed; product-aligned `mcp:invoke` + RFC 8707 audience binding; PingOne + IG + BFF + SoT all consistent.
