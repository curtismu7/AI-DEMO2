# PingGateway Exchange Mode — Completion & Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `ff_mcp_gateway_pinggateway=true` (route MCP traffic through PingGateway/IG) work end-to-end — agent chip discovery *and* tool invocation — and harden the delegation chain so this class of failure self-heals instead of silently greying out every chip.

**Architecture:** The agent chip flow uses an RFC 8693 chain: BFF Exchange #1 (user → Agent Gateway) → BFF Exchange #2 (→ **PingGateway resource**, scope `pinggateway:invoke`) → IG validates `aud` and runs P1AZ → IG Exchange #3 (`f4dd707d` → `mcpserver.ping.demo`) → backend `mcp-server` executes the tool. PingGateway mode is currently *half-provisioned*: the flag is on but the PingGateway PingOne resource was missing (recreated in this investigation) and the Exchange #3 leg is blocked by a PingOne constraint that forces a distinct scope namespace.

**Tech Stack:** Node.js BFF (`demo_api_server`), PingOne (Management API + AS token endpoint), ForgeRock/PingGateway IG (Groovy filters), TypeScript MCP backends (`demo_mcp_server`, `demo_mcp_invest`), LMDB config store, Docker Compose.

## Global Constraints

- PingOne env: `01d89b06-66d5-430e-9f28-65636843788b`, region `com`. **Never rotate the worker secret or demo `.env` creds** (running stack depends on them).
- **PingOne scope-name uniqueness (the core constraint):** the same scope *name* cannot be granted to one application on two different resources. `f4dd707d` already holds `read`, `write`, `records:read`, `mcp:invoke` on `mcpgateway.ping.demo` (b773bc8e), so it **cannot** hold those same names on `mcpserver.ping.demo` (637a1d2a). Any scope the IG path needs on `mcpserver` must use a **distinct name** (the `banking:*` namespace).
- **Work in a git worktree**, stage explicitly (`git add <files>`), never `git add -A`. The main checkout is Write/Edit hook-blocked.
- **Coordination:** another agent holds *uncommitted* changes to the scope surface (`scope-topology.json`, `scopeTopology.js`, its regression test, `docs/scope-topology.md`, `.husky/pre-commit`, new `scripts/topology-verify.sh` + `verify-pinggateway-parity.js`) on branch `fix/architectural-improvements`. Their `topology:verify` pre-commit gate blocks scope-surface commits that don't pass. **Any task here that edits `scope-topology.json` MUST be merged/rebased onto their work first** — do not fork the scope surface.
- Port note: the live IG validates `aud = https://api.ping.demo:3006/mcp` (`PG_GATEWAY_RESOURCE_ID`), but `scope-topology.json` deployment block says `:3036`. This plan standardizes on **`:3006`** (the live IG value) and reconciles the topology doc. Do not change one without the other.

## Current State (established by investigation 2026-07-03)

**Root cause of the greyout:** `POST /api/demo-agent/tools` returns 502 because BFF Exchange #2 requested `pinggateway:invoke` against a fallback audience `mcpgateway.ping.demo` (the PingGateway resource URI was unconfigured), which PingOne rejected with `invalid_scope: "At least one scope must be granted"`. Likely trigger: the env migration `d02d2305 → 01d89b06` dropped the PingGateway resource (the only chain resource not declared in `scope-topology.json`'s provisioned `resources`), while the `ff_mcp_gateway_pinggateway=true` LMDB override survived.

**Already done in this investigation (reusable — do NOT redo):**
- Created PingOne resource **`6635cfb8-caaa-432b-bf00-3201f74181ae`**, `name="Demo PingGateway MCP"`, `audience=https://api.ping.demo:3006/mcp`.
- Added scope **`pinggateway:invoke`** (`4b2917d1-5cba-47b3-8743-dcc366451e3d`) to it.
- Granted `pinggateway:invoke` to exchanger **`f4dd707d`** on that resource.
- Verified: BFF Exchange #1 + #2 now succeed (token issues with `scope=pinggateway:invoke`, `aud=https://api.ping.demo:3006/mcp`).
- Wrote a stray LMDB row `PINGONE_RESOURCE_PINGGATEWAY_URI=https://api.ping.demo:3006/mcp` (ignored by the server because the key is env-scoped — see Task 4).

**Still broken:** Exchange #3 (IG → `mcpserver`) — `f4dd707d` isn't granted an invoke/read scope on `mcpserver` that it's *allowed* to hold (uniqueness), and the backend enforces per-tool scopes with no alias normalization.

**Key references:**
- BFF Ex#2 scope/audience logic: `demo_api_server/services/agentMcpTokenService.js:2260-2299`
- BFF discovery/degrade path: `demo_api_server/services/agentToolsResolver.js`
- Scope resolver: `demo_api_server/services/agentScopes.js`
- Config precedence + env-scoped key list: `demo_api_server/services/envReconcile.js:59-64` (`pingone_resource_pinggateway_uri`)
- Self-heal reconciler (defined, **never called**): `demo_api_server/services/twoExchangeReconciler.js`; startup tasks: `demo_api_server/server.js:2047-2173`
- IG inbound contract: `ping-gateway/config/routes/01-mcp-olb.json` (McpProtectionFilter `resourceId=${env['PG_GATEWAY_RESOURCE_ID']}`), `ping-gateway/scripts/groovy/olb-token-exchange.groovy` (Ex#3, uses `PG_OLB_SCOPE`), `ping-gateway/.env` (`PG_OLB_SCOPE=banking:mcp:invoke`, `PG_GATEWAY_RESOURCE_ID=https://api.ping.demo:3006/mcp`)
- Backend strict scope check: `demo_mcp_server/src/tools/TokenResolver.ts:178`; per-tool scopes: `demo_mcp_server/src/tools/BankingToolRegistry.ts` (`requiredScopes: ['read']|['write']|...`); gateway-contract enforcement: `demo_mcp_server/src/middleware/validateTokenAtGateway.js`

---

## Task 0: Design spike — choose the Exchange #3 authorization model (BLOCKING)

There are two viable ways to satisfy the backend after Exchange #3, and the choice determines the entire rest of the plan. Resolve this **first** with evidence, then implement only the chosen branch.

**Files (read-only investigation):**
- `demo_mcp_server/src/index.ts`, `demo_mcp_server/src/middleware/validateTokenAtGateway.js`, `demo_mcp_server/src/middleware/mcpScopeValidator.js`, `demo_mcp_server/src/tools/TokenResolver.ts`, `demo_mcp_server/src/tools/BankingToolProvider.ts`, `demo_mcp_server/src/tools/BankingToolValidator.ts`

- [ ] **Step 1: Trace the IG-forwarded request's auth path in the backend.** Determine whether a request arriving from the IG (bearer = Ex#3 token, `aud=mcpserver.ping.demo`) has its **per-tool `requiredScopes` enforced** (`TokenResolver`/`BankingToolValidator`) or whether the backend **trusts the gateway** (P1AZ already decided) and only checks a gateway/invoke scope + `enforceUpstreamContract`. Grep for where the streamable-HTTP `/mcp` handler is mounted and which middleware run on it.

Run:
```bash
cd demo_mcp_server && grep -rn "StreamableHTTP\|/mcp\|enforceUpstreamContract\|mcpScopeValidator\|BankingToolProvider\|validateToolParams\|requiredScopes" src --include="*.ts" --include="*.js" | grep -v __tests__
```

- [ ] **Step 2: Decide the model and record it at the top of this plan.**
  - **Approach A — Gateway trust (preferred if feasible):** the backend, for gateway-forwarded requests, authorizes on `banking:mcp:invoke` alone (the IG's P1AZ already made the per-tool decision). No `banking:read`/`banking:write` scopes, no per-tool token scopes. Smallest surface; matches the "gateway-first next-hop contract" already present in `validateTokenAtGateway.js`.
  - **Approach B — Full `banking:*` namespace:** provision `banking:read`/`banking:write`/`banking:records:read` (and every other per-tool read scope) on `mcpserver`/`mcp-invest`, grant them to `f4dd707d`, have the IG request them in Ex#3, and add backend normalization `banking:X → X` before the `requiredScopes` check. Larger; only needed if the backend genuinely re-authorizes per-tool on the gateway path and cannot be switched to trust mode.

- [ ] **Step 3: Confirm the invest path.** Determine whether the target verticals (banking, healthcare, etc.) route tools only through the OLB backend (`mcp-server`, `PG_OLB_*`) or also through `mcp-invest` (`PG_INVEST_*`). If invest tools are in scope, every backend/PingOne/IG step below must be mirrored for `mcp-invest.ping.demo` (b22b3d6d) with `PG_INVEST_SCOPE`.

- [ ] **Step 4: Commit the decision.**
```bash
git add docs/superpowers/plans/2026-07-03-pinggateway-mode-completion.md
git commit -m "docs(pinggateway): record Ex#3 authz model decision (Approach A/B)"
```

> **The task set below is written for Approach A (gateway trust).** If Step 2 selects Approach B, expand Task 3 into the `banking:read/write/records:read` provisioning + IG multi-scope request + backend normalization variant described inline in that task.

---

## Task 1: Hardening — wire the self-heal reconciler at startup

The reconciler exists but is **never called**, so grant/resource drift never self-heals. Wire it. This is independent of PingGateway and prevents the *mirrored-scopes* class of regression regardless of the flag.

**Files:**
- Modify: `demo_api_server/server.js` (inside `runBackgroundStartupTasks`, after the `pingoneStartupValidator` block ~`:2138`)
- Test: `demo_api_server/src/__tests__/twoExchangeReconciler.startup.test.js` (Create)

**Interfaces:**
- Consumes: `require('./services/twoExchangeReconciler').reconcileTwoExchangeGrants()` — async, non-throwing, logs `[TwoExchangeReconciler] ...`.
- Produces: startup side-effect only.

- [ ] **Step 1: Write the failing test** — assert `server.js` invokes `reconcileTwoExchangeGrants` during background startup (spy/mock the module, call the exported startup fn or assert the require+call wiring).

```js
// demo_api_server/src/__tests__/twoExchangeReconciler.startup.test.js
const path = require('path');
test('server startup wires the two-exchange reconciler', () => {
  const src = require('fs').readFileSync(path.join(__dirname, '../../server.js'), 'utf8');
  expect(src).toMatch(/reconcileTwoExchangeGrants\s*\(/);
  expect(src).toMatch(/TWO_EXCHANGE_RECONCILE_ON_STARTUP/);
});
```

- [ ] **Step 2: Run test, verify it FAILS**

Run: `cd demo_api_server && npx jest src/__tests__/twoExchangeReconciler.startup.test.js`
Expected: FAIL (no call site).

- [ ] **Step 3: Add the wiring** after the `runStartupValidation()` try/catch in `runBackgroundStartupTasks`:

```js
    // ── Two-exchange delegation self-heal ─────────────────────────────────────
    // Reconciles resource scopes + app grants (and the PingGateway resource, see
    // twoExchangeReconciler) from scope-topology.json so an env rebuild/migration
    // can't silently break the chip delegation chain. Non-fatal.
    // Opt out with TWO_EXCHANGE_RECONCILE_ON_STARTUP=false.
    if (process.env.TWO_EXCHANGE_RECONCILE_ON_STARTUP !== 'false') {
        try {
            const { reconcileTwoExchangeGrants } = require('./services/twoExchangeReconciler');
            await reconcileTwoExchangeGrants();
        } catch (err) {
            console.warn('[two-exchange-reconcile] error (non-fatal):', err.message);
        }
    }
```

- [ ] **Step 4: Run test, verify it PASSES**

Run: `cd demo_api_server && npx jest src/__tests__/twoExchangeReconciler.startup.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/server.js demo_api_server/src/__tests__/twoExchangeReconciler.startup.test.js
git commit -m "fix(startup): wire two-exchange self-heal reconciler (was defined but never called)"
```

---

## Task 2: Hardening — flag guard so PingGateway mode fails safe

Make `ff_mcp_gateway_pinggateway` take effect **only** when a PingGateway resource URI is configured; otherwise fall back to the working Node-gateway path and log loudly. This turns "silent 502 + all chips greyed" into "degrade gracefully + warn."

**Files:**
- Modify: `demo_api_server/services/agentMcpTokenService.js:2265-2268`
- Test: `demo_api_server/src/__tests__/agentMcpTokenService.pinggatewayGuard.test.js` (Create)

**Interfaces:**
- Consumes: `configStore.getEffective('ff_mcp_gateway_pinggateway')`, `process.env.PINGONE_RESOURCE_PINGGATEWAY_URI`, `configStore.getEffective('pingone_resource_pinggateway_uri')`.
- Produces: local `usePingGatewayForExchange` boolean (unchanged name).

- [ ] **Step 1: Write the failing test** — with the flag `'true'` but no resource URI (env unset + config `''`), `usePingGatewayForExchange` must be `false`. (Extract the guard into a tiny exported pure helper `shouldUsePingGatewayExchange(flag, envUri, cfgUri)` to test directly.)

```js
const { shouldUsePingGatewayExchange } = require('../../services/agentMcpTokenService');
test('pinggateway exchange requires a configured resource URI', () => {
  expect(shouldUsePingGatewayExchange('true', undefined, '')).toBe(false);
  expect(shouldUsePingGatewayExchange('true', 'https://api.ping.demo:3006/mcp', '')).toBe(true);
  expect(shouldUsePingGatewayExchange('false', 'https://api.ping.demo:3006/mcp', '')).toBe(false);
});
```

- [ ] **Step 2: Run test, verify it FAILS**

Run: `cd demo_api_server && npx jest src/__tests__/agentMcpTokenService.pinggatewayGuard.test.js`
Expected: FAIL (`shouldUsePingGatewayExchange` not exported).

- [ ] **Step 3: Implement the guard.** Add and export the helper, and use it:

```js
// near other helpers in agentMcpTokenService.js
function shouldUsePingGatewayExchange(flag, envUri, cfgUri) {
  return flag === 'true' && !!(envUri || cfgUri);
}
module.exports.shouldUsePingGatewayExchange = shouldUsePingGatewayExchange;
```
Replace line 2265:
```js
  const _pgFlag = configStore.getEffective('ff_mcp_gateway_pinggateway');
  const _pgEnvUri = process.env.PINGONE_RESOURCE_PINGGATEWAY_URI;
  const _pgCfgUri = configStore.getEffective('pingone_resource_pinggateway_uri');
  const usePingGatewayForExchange = shouldUsePingGatewayExchange(_pgFlag, _pgEnvUri, _pgCfgUri);
  if (_pgFlag === 'true' && !usePingGatewayForExchange) {
    console.warn('[two-exchange] ff_mcp_gateway_pinggateway is on but no PingGateway resource URI configured — falling back to Node MCP gateway path. Set PINGONE_RESOURCE_PINGGATEWAY_URI.');
  }
```

- [ ] **Step 4: Run test, verify it PASSES** — `npx jest src/__tests__/agentMcpTokenService.pinggatewayGuard.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/agentMcpTokenService.js demo_api_server/src/__tests__/agentMcpTokenService.pinggatewayGuard.test.js
git commit -m "fix(two-exchange): pinggateway flag only activates when resource URI configured; degrade+warn otherwise"
```

---

## Task 3: PingOne — provision the Exchange #3 grant (Approach A)

Grant `f4dd707d` a **uniquely-named** invoke scope on `mcpserver.ping.demo` that the IG will request in Ex#3. `banking:mcp:invoke` is collision-free (f4dd707d does not hold it elsewhere). The PingGateway resource + `pinggateway:invoke` from the investigation already exist — do not recreate.

**Files:**
- New: `demo_api_server/scripts/provision-pinggateway.js` (idempotent provisioner, reused by Task 6)

**Interfaces:**
- Consumes: worker creds from `process.env` (`PINGONE_ENVIRONMENT_ID`, `PINGONE_WORKER_CLIENT_ID/SECRET`, `PINGONE_REGION`).
- Produces: on `mcpserver.ping.demo` (637a1d2a): scope `banking:mcp:invoke` + grant to `f4dd707d`.

- [ ] **Step 1: Write the provisioner** `demo_api_server/scripts/provision-pinggateway.js` — idempotent: worker token → ensure PingGateway resource (`aud=https://api.ping.demo:3006/mcp`) exists → ensure `pinggateway:invoke` scope + `f4dd707d` grant → ensure `mcpserver` has `banking:mcp:invoke` scope + `f4dd707d` grant. Model the existence-check + PUT-full-scope-set pattern on `demo_api_server/services/twoExchangeReconciler.js:_reconcileAppGrants` (grants use PUT full replacement; check by scope **id** on the specific resource grant to avoid the name-uniqueness false-positive).

- [ ] **Step 2: Dry-run inspection** (report only, no writes):

Run (inside the running BFF container so it has live worker creds):
```bash
docker exec -w /app ai-demo-api-server node scripts/provision-pinggateway.js --dry-run
```
Expected: reports `mcpserver` missing `banking:mcp:invoke`; PingGateway resource + `pinggateway:invoke` already present.

- [ ] **Step 3: Apply**

Run:
```bash
docker exec -w /app ai-demo-api-server node scripts/provision-pinggateway.js
```
Expected: `CREATED scope banking:mcp:invoke on mcpserver`, `GRANTED banking:mcp:invoke to exchanger on mcpserver`.

- [ ] **Step 4: Verify the grant** — re-run `--dry-run`; expected: all green, no changes.

> **If Task 0 chose Approach B:** additionally create `banking:read`, `banking:write`, `banking:records:read` (+ every per-tool read scope in `BankingToolRegistry.ts`) on `mcpserver` (and `mcp-invest`), grant each to `f4dd707d`, and have Ex#3 (Task 5) request the full set. Then Task 7 must add backend normalization.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/scripts/provision-pinggateway.js
git commit -m "feat(pinggateway): idempotent provisioner for PingGateway resource + Ex#3 grant"
```

---

## Task 4: Config — deliver the PingGateway resource URI (env-scoped)

`pingone_resource_pinggateway_uri` is env-scoped (`envReconcile.js:62`), so `.env` is authoritative and overrides any LMDB write on restart. Set it in the file the container loads.

**Files:**
- Modify: `demo_api_server/.env` (add one line) — the compose `env_file` for `demo-api-server`.

- [ ] **Step 1: Add the line** to `demo_api_server/.env` (edit in the worktree; deliver to the served checkout separately — see "Landing to the running stack"):

```
PINGONE_RESOURCE_PINGGATEWAY_URI=https://api.ping.demo:3006/mcp
```

- [ ] **Step 2: Recreate the api-server so `env_file` is re-read** (a plain `docker restart` does NOT re-read `env_file`):

Run:
```bash
cd /Users/cmuir/Development/AI-DEMO2 && docker compose up -d --no-deps demo-api-server
```

- [ ] **Step 3: Verify it's live**

Run:
```bash
docker exec -w /app ai-demo-api-server node -e "const cs=require('./services/configStore'); setTimeout(()=>console.log(cs.getEffective('pingone_resource_pinggateway_uri')),500)"
```
Expected: `https://api.ping.demo:3006/mcp`.

- [ ] **Step 4: Commit**

```bash
git add demo_api_server/.env
git commit -m "config(pinggateway): set PINGONE_RESOURCE_PINGGATEWAY_URI for env 01d89b06"
```

---

## Task 5: IG — confirm/align the Exchange #3 request (Approach A)

For Approach A, the IG's existing `PG_OLB_SCOPE=banking:mcp:invoke` is already correct — no change needed once Task 3 grants that scope. Verify end-to-end; only touch the IG if Approach B (multi-scope) was chosen.

**Files:**
- Read: `ping-gateway/.env` (`PG_OLB_SCOPE`, `PG_GATEWAY_RESOURCE_ID`), `ping-gateway/scripts/groovy/olb-token-exchange.groovy`
- (Approach B only) Modify: `ping-gateway/.env` `PG_OLB_SCOPE` to the space-delimited banking scope set + recreate `ai-demo-ping-gateway`.

- [ ] **Step 1: Confirm IG env matches provisioning** — `PG_GATEWAY_RESOURCE_ID` must equal the PingGateway resource audience (`https://api.ping.demo:3006/mcp`) and `PG_OLB_SCOPE` must equal the scope granted in Task 3 (`banking:mcp:invoke`).

Run:
```bash
docker exec ai-demo-ping-gateway sh -c 'echo "$PG_GATEWAY_RESOURCE_ID | $PG_OLB_SCOPE"'
```
Expected: `https://api.ping.demo:3006/mcp | banking:mcp:invoke`.

- [ ] **Step 2 (Approach B only): update `PG_OLB_SCOPE`** to include the tool read/write banking scopes and recreate the IG:
```bash
cd /Users/cmuir/Development/AI-DEMO2 && docker compose up -d --no-deps ping-gateway
```

- [ ] **Step 3: Commit (Approach B only)**
```bash
git add ping-gateway/.env
git commit -m "config(pinggateway-ig): request banking:* tool scopes in Ex#3"
```

---

## Task 6: Extend the reconciler + topology so PingGateway self-heals (COORDINATE)

The root cause was that PingGateway is the one chain resource *not* declared in `scope-topology.json`'s provisioned `resources`, so a migration dropped it. Fix that so a rebuild recreates it.

**Files:**
- Modify: `scope-topology.json` — add a provisioned `Super Banking PingGateway` resource (`audience=https://api.ping.demo:3006/mcp`, scopes `[pinggateway:invoke]`) and reconcile the `:3036` deployment string to `:3006`. **⚠ COORDINATE:** rebase onto the other agent's uncommitted scope-topology work first; this edit must pass their `npm run topology:verify` gate.
- Modify: `demo_api_server/services/scopeTopology.js` — accessor support for the new resource if needed (follow their alias/accessor changes).
- Modify: `demo_api_server/services/twoExchangeReconciler.js` — add an Exchange-#2 pre-condition block that ensures the PingGateway resource exists (create if missing, mirroring `_resolveOrCreateResourceId`) with `pinggateway:invoke`, and grants it to the exchanger.
- Modify: `demo_api_server/scripts/verify-pinggateway-parity.js` (the other agent's new script) — extend to assert the PingGateway PingOne resource/scope parity.
- Test: `demo_api_server/src/__tests__/twoExchangeReconciler.pinggateway.test.js` (Create) — assert the reconciler creates the resource+scope+grant when absent (mock the PingOne client).

- [ ] **Step 1: Sync with the scope-surface branch.** Rebase this worktree onto the merged `scope-topology.json`/`scopeTopology.js`/parity-script state. Run `npm run topology:verify` and confirm green before editing.
- [ ] **Step 2: Write the failing reconciler test** (mock PingOne client; assert `POST /resources` for the PingGateway audience + scope + grant when the resource is absent).
- [ ] **Step 3: Run it, verify FAIL.**
- [ ] **Step 4: Add the PingGateway resource to `scope-topology.json`** and the reconciler block. Reconcile the `:3036`→`:3006` deployment string.
- [ ] **Step 5: Run the reconciler test + `npm run topology:verify` + the parity script — all PASS.**
- [ ] **Step 6: Commit** (single commit so the scope surface stays consistent under the pre-commit gate):
```bash
git add scope-topology.json demo_api_server/services/scopeTopology.js demo_api_server/services/twoExchangeReconciler.js demo_api_server/scripts/verify-pinggateway-parity.js demo_api_server/src/__tests__/twoExchangeReconciler.pinggateway.test.js
git commit -m "feat(pinggateway): declare PingGateway resource in topology + self-heal in reconciler"
```

---

## Task 7 (Approach B only): Backend `banking:*` scope normalization

Only if Task 0 chose Approach B. Make `mcp-server` (and `mcp-invest`) accept `banking:X` as satisfying a `requiredScopes: ['X']` check.

**Files:**
- Modify: `demo_mcp_server/src/tools/TokenResolver.ts:178` (and `BankingToolValidator.ts:236`) — normalize token scopes by stripping a configured `banking:` prefix before the `requiredScopes.every(...)` check.
- Test: `demo_mcp_server/src/tools/__tests__/TokenResolver.aliasScopes.test.ts` (Create)
- Mirror in `demo_mcp_invest` if invest tools are in scope (Task 0 Step 3).

- [ ] **Step 1: Write failing test** — a token with `['banking:read']` satisfies a tool requiring `['read']`.
- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement normalization** (single helper `normalizeGatewayScopes(scopes)` mapping `banking:X → X`, applied only for gateway-audience tokens).
- [ ] **Step 4: Run tests, verify PASS.**
- [ ] **Step 5: Rebuild + restart the backend containers**
```bash
cd /Users/cmuir/Development/AI-DEMO2 && docker compose up -d --build --no-deps mcp-server mcp-invest
```
- [ ] **Step 6: Commit.**

---

## Task 8: End-to-end verification

**Success criteria:** with `ff_mcp_gateway_pinggateway=true`, (a) `POST /api/demo-agent/tools` returns 200 with the correct vertical's tools (chips un-grey, not degraded), and (b) invoking a tool (e.g. healthcare `view_records`) completes through the IG.

- [ ] **Step 1: Discovery** — reproduce the real server's tool discovery for the affected session/vertical and assert non-degraded:
```bash
docker exec -w /app ai-demo-api-server node -e "/* load LmdbSessionStore, build req from the live session, call resolveAvailableTools({vertical:'healthcare',allowWrite:true}); assert !degraded and tools include view_records */"
```
Expected: `degraded=false`, healthcare tools present, none `permitted:false` for the granted scope set.

- [ ] **Step 2: UI** — in the running app, open the Actions panel for the healthcare vertical; confirm the previously-greyed chips (`My records`, `Check coverage`, …) are active.

- [ ] **Step 3: Tool invocation** — click a tool chip (or drive it via Playwright) and confirm a successful response through the IG. Tail `docker logs ai-demo-ping-gateway` for `[OlbExchange]` success and no `token_exchange_failed`.

- [ ] **Step 4: Token chain** — confirm a *failed* exchange now renders as a failed step in the Token Chain rail (the fix already staged: `agentMcpTokenService.js` attaches `tokenEvents` at the `delegation_chain_broken` throw; `routes/demoAgentRoutes.js` forwards them on the 502). Temporarily point the URI at a bad value to force a failure and observe the rail, then restore.

- [ ] **Step 5: Regression** — restart the api-server and confirm `[TwoExchangeReconciler]` logs `OK`/`Healed` (Task 1 wiring) and discovery still works.

---

## Interim restore (optional, reversible, decoupled from this plan)

If the demo must work before this plan lands, set `ff_mcp_gateway_pinggateway=false` (App Config UI, or LMDB flag). This routes Exchange #2/#3 through the Node MCP gateway (`mcpgateway.ping.demo`, `mcp:invoke`) — verified working end-to-end during investigation. Re-enable the flag once Tasks 3–8 are complete.

---

## Already-staged work (independent of PingGateway, keep)

The token-chain visibility fix is already implemented in this worktree and should be committed regardless of the PingGateway decision:
- `demo_api_server/services/agentMcpTokenService.js` — attach `err.tokenEvents = tokenEvents` at the `delegation_chain_broken` throw (~`:2399`).
- `demo_api_server/routes/demoAgentRoutes.js` — forward `error.tokenEvents ?? req.tokenEvents` on the `/tools` 502.

## Landing to the running stack

The stack mounts the **main checkout** (`demo_api_server` bind-mounted to `/app`; BFF runs `node --watch`). To make worktree changes live: land the branch into the served checkout per `[[project-docker-serves-main-checkout]]`, then `docker compose up -d --no-deps demo-api-server` for `.env`/`env_file` changes (watch alone won't re-read `env_file`). PingOne provisioning (Task 3) is independent of the checkout — it mutates PingOne directly.
