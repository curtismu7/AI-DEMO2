# Env var canonicalization + client-secret rotation

Branch: `worktree-env-var-canonicalization`
Status: **awaiting sign-off on the canonical name table (§3)** — no edits made yet.

## §0 — Scope decisions (from the user, 2026-07-28)

| Decision | Choice |
|---|---|
| Cleanup depth | **Full rename refactor** — collapse alias groups, rewrite all consumers |
| Secret reuse (`SESSION_SECRET`==`INTENT_TOKEN_SECRET`, etc.) | Fold into the rotation pass |
| Rotation cutover | **Staged, per-app with verify gates** |
| Worker `89ad8921` | **Excluded** — it is the credential performing the rotation |

Supersedes the standing `feedback-do-not-rotate-secrets` memory (to be updated on completion).

## §1 — Measured scope

Inventory across 11 live `.env` files: **154 distinct keys, zero with no code consumer.**
There are no free deletions; every rename must carry its consumers.

Full rename touches **235 production files** (+ ~150 test files):

| Directory | Prod files |
|---|---|
| `demo_api_server` | 93 |
| `demo_api_ui` | 33 |
| `demo_mcp_server` | 16 |
| `k8s` | 13 |
| `demo_authz_server` | 11 |
| `langchain_agent` | 10 |
| `demo_mcp_gateway` | 8 |
| `scripts` | 8 |
| `ping-gateway` | 7 |
| `docs` | 6 |
| everything else | 30 |

Largest single group: the 6-way MCP resource URI alias — **76 prod files**.

### REGRESSION_PLAN §1 files in the blast radius

- `demo_api_server/.env` (OAuth admin login row)
- `services/configStore.js` + `routes/adminConfig.js` (configStore / Config UI row)
- `routes/oauth.js`, `routes/oauthUser.js`, `config/oauth.js`, `config/oauthUser.js`
- `middleware/auth.js` (token audience check — "never hardcode `aud` defaults")
- `demo_api_ui/.env` (CRA proxy setup row)

**Invariants this refactor will NOT break** (regression-guard step 2):
1. No change to the 4-signal admin role check in `routes/oauthUser.js` — variable names only.
2. No change to `requireNotAdmin` behavior on `/my` endpoints; admin tokens still 403.
3. No change to `req.session.save()` ordering or `sessionStore.js` callback discipline.
4. No hardcoded `aud` default introduced in `middleware/auth.js` — the value source moves name, not semantics.
5. No `localhost` hardcodes introduced into OAuth redirect origins.
6. Every rename is value-preserving: same string reaches the same consumer.

## §2 — Defects found by the inventory

Ranked. These are behavior bugs, independent of the renaming.

### D-1 — D-05 upstream-audience check is inert (**highest severity**)

`demo_mcp_server/src/auth/lastHopAuthorization.ts:87-95`:

```ts
upstreamAudience:
  process.env.MCP_UPSTREAM_RESOURCE_URI ||
  process.env.MCP_AUDIENCE ||
  process.env.PINGONE_RESOURCE_MCP_URI,
gatewayAudience: process.env.MCP_GW_RESOURCE_URI,
```

**None of those three `upstreamAudience` names is set in any `.env` file in the repo**, and
nothing else in the codebase references them. So `upstreamAudience` is always `undefined`,
and `enforceUpstreamContract` Rule 2 ("token aud MUST include the upstream audience") is
skipped on every request — including the live path at
`demo_mcp_server/src/server/HttpMCPTransport.ts:495`.

The file's own comment (line 51) names `MCP_SERVER_RESOURCE_URI` as the driving variable.
That var *is* set — to `mcpgateway.ping.demo`, the **gateway** value, while
`PINGONE_RESOURCE_MCP_SERVER_URI=mcpserver.ping.demo` holds what looks like the correct one.

Scope of the gap: Rule 1 (D-05 gateway anti-bypass, driven by `MCP_GW_RESOURCE_URI`) **does**
fire. This is partial enforcement, not absent enforcement.

**RESOLVED (user, 2026-07-28): wire `upstreamAudience` to `PINGONE_RESOURCE_MCP_SERVER_URI`
(= `mcpserver.ping.demo`), keeping `gatewayAudience` on the gateway URI.** This turns Rule 2
on for the first time.

Consequence for §3: the 6-way group is **not** a 6→1 merge. It becomes a 6→2 split —
gateway audience and upstream audience stay permanently distinct names, because they are the
two poles of the D-05 control.

**Pre-flight evidence (captured 2026-07-28, live stack):**

```
docker logs ai-demo-mcp-server --tail 3000 | grep -oE '"aud":(\[[^]]*\]|"[^"]*")' | sort | uniq -c
    152 "aud":["mcpserver.ping.demo"]
```

152 of 152 tokens at this hop carry `mcpserver.ping.demo` — exactly the value
`PINGONE_RESOURCE_MCP_SERVER_URI` already holds. Enabling Rule 2 against it matches all
observed live traffic; it will reject only tokens missing that audience, which is the intent.

Invest traffic does not pass this check: `ai-demo-mcp-invest` runs the separate
`demo_mcp_invest` codebase, and `enforceUpstreamContract` / `lastHopAuthorization` appear
only under `demo_mcp_server/src`. A single-valued `upstreamAudience` is therefore safe.

Corollary: `MCP_SERVER_RESOURCE_URI=mcpgateway.ping.demo` in `.env` is simply **wrong** —
the correct value already exists, under the correctly-named `PINGONE_RESOURCE_MCP_SERVER_URI`.

### D-2 — `PINGONE_BASE_URL` holds two different meanings

- `demo_mcp_server/.env` → `https://auth.pingone.com/{envId}`
- `langchain_agent/.env` → `https://auth.pingone.com/{envId}/as`

One name, issuer base vs authorization-server base. Resolve by splitting into
`PINGONE_ISSUER_BASE_URL` and `PINGONE_AS_BASE_URL`, not by picking one value.

### D-3 — `MORTGAGE_SERVICE_API_KEY` mismatch

Root `.env` and `demo_mortgage_service/.env` hold different values. Matches the known
"backend rejected the service API key" symptom.

### D-4 — `langchain_agent` identity drift

`PINGONE_USER_CLIENT_ID` and `AGENT_CLIENT_ID` both = `71e878ea` (AI Agent Actor), while
`demo_api_server` sets the same names to `83572007` and `4069fee6`. Same name, three apps.

**RESOLVED (user, 2026-07-28): bug — align langchain_agent to the other services.** Point its
`PINGONE_USER_CLIENT_*` at `83572007` and `AGENT_CLIENT_*` at `4069fee6`.

Consequence for §3: once corrected, `PINGONE_USER_CLIENT_*` and `AGENT_CLIENT_*` are no longer
aliases of the actor app anywhere — they become distinct, correctly-named vars. The 52-file
"AI Agent Actor" group shrinks to just the genuine `PINGONE_AI_AGENT_ACTOR_CLIENT_*` uses.

**Pre-flight required:** confirm `83572007` and `4069fee6` carry the PingOne grants
langchain_agent needs. Changing which client it authenticates as can fail on missing grants
rather than on the code change. Live agent smoke test gates this.

### D-5 — Names that lie

| Var | Actually holds |
|---|---|
| `TE_CLIENT_ID` / `TE_CLIENT_SECRET` (ping-gateway) | MCP Gateway `6586d3de`, **not** the Token Exchanger |
| `P1AZ_WORKER_ID` | `1f9e9c71…` = the Authorize **decision endpoint** ID |
| `PG_GATEWAY_RESOURCE_ID` | a URI (`https://api.ping.demo:3036/mcp`) |
| `PINGONE_CLIENT_ID/SECRET` (demo_mcp_server) | Token Exchanger — unqualified name, 16 consumers |

### D-6 — Secret reuse (deferred to rotation per §0)

- `SESSION_SECRET` == `INTENT_TOKEN_SECRET`
- `ENCRYPTION_KEY` == `ENCRYPTION_MASTER_KEY` == `BFF_INTERNAL_SECRET[0:32]`
  (derived in `refresh-service-envs.js:295,343`)
- `DEMO_USER_PASSWORD` == `DEMO_ADMIN_PASSWORD`

### Downgraded — not a defect

`PINGONE_AI_AGENT_ACTOR_REDIRECT_URI` differing between `demo_api_server` and the 9 other
services is a stale-generation artifact: it is derived from `publicAppUrl`
(`configStore.js:73`, `pingoneProvisionService.js:1772`) and points at a placeholder
callback the client-credentials actor app never invokes.

## §3 — Canonical name table — NEEDS SIGN-OFF

Convention:
- OAuth clients → `PINGONE_<ROLE>_CLIENT_ID` / `_CLIENT_SECRET`
- PingOne resources/audiences → `PINGONE_RESOURCE_<NAME>_URI`
- PingOne endpoints → `PINGONE_<NAME>_ENDPOINT`
- Local service URLs keep service-local names (`BFF_BASE_URL`, `PUBLIC_APP_URL`)

| Canonical | Value | Aliases to retire | Prod files |
|---|---|---|---|
| `PINGONE_TOKEN_EXCHANGER_CLIENT_ID/SECRET` | `f4dd707d` | `GW_INTROSPECTION_CLIENT_*`, `PINGONE_CLIENT_*`, `INTROSPECT_CLIENT_*` | 39 |
| `PINGONE_AI_AGENT_ACTOR_CLIENT_ID/SECRET` | `71e878ea` | `PINGONE_USER_CLIENT_*`†, `AGENT_CLIENT_*`† | 52 |
| `PINGONE_MCP_GATEWAY_CLIENT_ID/SECRET` | `6586d3de` | `MCP_GW_CLIENT_*`, `TE_CLIENT_*` | 27 |
| `PINGONE_WORKER_CLIENT_ID/SECRET` | `89ad8921` | `P1AZ_WORKER_CLIENT_*` | 41 |
| `PINGONE_AUTHORIZE_MCP_DECISION_ENDPOINT_ID` | `1f9e9c71` | `P1AZ_WORKER_ID` | 8 |
| `PINGONE_RESOURCE_MCP_GATEWAY_URI` | `mcpgateway.ping.demo` | `MCP_RESOURCE_URI`, `MCP_GW_RESOURCE_URI`‡, `MCP_SERVER_RESOURCE_URI`‡, `PINGONE_RESOURCE_TWO_EXCHANGE_URI`, `PG_GATEWAY_RESOURCE_URI` | 76 |
| `PINGONE_RESOURCE_MCP_SERVER_URI` | `mcpserver.ping.demo` | `PG_OLB_RESOURCE_URI` | 21 |
| `PINGONE_RESOURCE_AGENT_GATEWAY_URI` | — | `AI_AGENT_INTERMEDIATE_AUDIENCE` | 13 |
| `PINGONE_RESOURCE_BANKING_API_URI` | — | `ENDUSER_AUDIENCE`, `BANKING_API_RESOURCE_URI` | — |
| `PINGONE_RESOURCE_INVEST_URI` | — | `MCP_INVEST_AUDIENCE`, `PG_INVEST_RESOURCE_URI` | — |
| `PINGONE_RESOURCE_PINGGATEWAY_URI` | `api.ping.demo:3036/mcp` | `PG_GATEWAY_RESOURCE_ID` | 8 |
| `PINGONE_INTROSPECTION_ENDPOINT` | — | `GW_INTROSPECTION_ENDPOINT` | 14 |
| `PINGONE_PAR_ENDPOINT` | — | `OAUTH_PAR_ENDPOINT` | 2 |
| `BFF_BASE_URL` | — | `DEMO_API_BASE_URL` | 25 |
| `PUBLIC_APP_URL` | — | `PINGONE_PUBLIC_APP_URL`, `REACT_APP_CLIENT_URL` | 48 |
| `PINGONE_ISSUER_BASE_URL` + `PINGONE_AS_BASE_URL` | see D-2 | `PINGONE_BASE_URL`, `PINGONE_ISSUER_URI` | 32 |

† **Not a pure rename.** `PINGONE_USER_CLIENT_*` and `AGENT_CLIENT_*` alias the actor app
only in `langchain_agent/.env`; elsewhere they are distinct apps (`83572007`, `4069fee6`).
Retiring them requires resolving D-4 first — otherwise langchain_agent silently changes identity.

‡ **Blocked on D-1.** `MCP_GW_RESOURCE_URI` and `MCP_SERVER_RESOURCE_URI` are the two
opposing poles of the D-05 anti-bypass control. They currently hold the same value.
Collapsing them into one name would make the security control structurally incapable of
distinguishing gateway from upstream. Resolve D-1 before touching this group.

## §4 — Execution order

Rename before rotation: rotation writes values into names, so the names must be final first.

**Why service-by-service is safe.** Every `.env` file already carries all aliases, and
`refresh-service-envs.js` keeps writing them until phase 6. So a consumer migrated to the
canonical name still resolves, and a consumer not yet migrated still resolves too. Each phase
is independently green; nothing depends on a flag-day. Phase 6 (drop the aliases from the
generator) is the only irreversible step, and it runs last — after every consumer is migrated
and every gate is green.

| Phase | Work | Gate |
|---|---|---|
| 0 | Sign-off on §3; resolve D-1 and D-4 decisions | user |
| 1 | `demo_api_server` consumers (93 files) | `CI=true npm test -- --forceExit` |
| 2 | `demo_mcp_gateway` + `demo_mcp_server` TS (24) | each service's jest |
| 3 | `ping-gateway` JSON route configs (7) | gateway route smoke |
| 4 | `demo_api_ui` (33) + `langchain_agent` (10) | `npm run test:unit && npm run build`; pytest |
| 5 | `configStore.js` `envFallbackMap` — drop retired aliases (229 entries today) | BFF jest |
| 6 | `refresh-service-envs.js` — emit canonical names only | regenerate all 11 `.env`, diff-review |
| 7 | `k8s` (13) + `scripts` (8) + `snapshots` (3) | `npm run topology:verify` |
| 8 | Fix D-2, D-3, D-4 | live smoke |
| 9 | Staged per-app secret rotation, 16 apps, worker excluded | per-app smoke |

Rotation order within phase 9: 9 A2A specialists → MCP Exchanger → agent → AI Agent Actor →
MCP Gateway → **Token Exchanger last** (39-file fan-out).

Vault must be updated in the same step as `.env` for every rotated secret — the vault tier
outranks LMDB in `configStore._setCache` (`configStore.js:787-799`), so a `.env`-only update
leaves the BFF on the old value. Vault currently holds 8 of the affected secrets.

## §5 — Rollback

Snapshot all 11 `.env` files + `secrets.vault` outside the repo before phase 9. Note: a
PingOne secret regeneration is **not reversible** — rollback for phase 9 means re-running
`npm run pingone:refresh-envs` to re-pull current values, not restoring old ones.

Do **not** write snapshots as `demo_api_server/.env.pre-import-*` — ~390 of those already
exist and are a known stale-data source.
