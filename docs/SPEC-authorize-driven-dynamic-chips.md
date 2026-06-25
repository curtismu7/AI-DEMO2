# Authorize-Driven Dynamic Agent Chips

**Status:** ✅ Implemented on branch `worktree-fix-gateway-upstream-fallback` (14 commits, pushed). All phases A–G complete; G2 intentionally skipped. The only part not covered by automated tests is the live UI greying/hiding — verify in the running app (see [Verification](#verification-end-to-end)).

**Goal:** Make the MCP tool list — and therefore the agent's action chips — authoritative and Authorize-driven. Tools are filtered by **vertical** (a banking session never sees healthcare tools) and by **scope** (write tools grey out when the session lacks `write`). Scope-denied chips render greyed with a message explaining why; vertical-foreign chips simply don't appear.

---

## Why

Before this change, agent chips were hardcoded React arrays (`BankingChips.jsx`) plus a static `chips10` list per vertical manifest. They were **not** connected to the real MCP `tools/list` response, so:

- The UI could advertise a tool the user couldn't actually call.
- There was no way to *show* Authorize filtering — which is the point of the demo.
- Filtering logic was spread across three uncoordinated layers: an MCP-server scope filter, a gateway vertical filter, and the BFF's global `active_vertical`.

A 502 on `view_records` exposed the mess: vertical tools were BFF-local handlers, and when the gateway routed them to the MCP server it returned "unknown tool" → 502. A band-aid (treat `gateway_upstream_error` as a local-fallback trigger) hid the architecture instead of fixing it.

**Target (achieved):** one coherent, MCP-spec-aligned flow where **Authorize decides, the gateway enforces, and the UI reflects the decision visibly.**

---

## Architecture

```
Browser (AIAgent.js)
  │  on login / vertical switch / scope-toggle flip:
  │  POST /api/demo-agent/tools { vertical, allowWrite }
  ▼
BFF  (demo_api_server)
  │  resolveAvailableTools(req, { vertical, allowWrite })
  │    1. resolveAgentScopes(vertical, allowWrite) → scope set (write toggle)
  │    2. agentTokenCache.get(session, vertical, scopeSet)  ── reuse …
  │       └ miss → agentCCTokenService.getAgentCCToken({ scope, vertical }) → cache.set
  │    3. agentGatewayClient.listAvailableTools(req, token, { vertical, userSub })
  │         └ mcpWebSocketClient.mcpListTools(token, userSub, cid, { vertical })  ── WS
  ▼
MCP Gateway  (demo_mcp_gateway)  ← sole policy enforcement point
  │  validateInboundToken → introspect → runWsAuthorizationPipeline (D-05 anti-bypass)
  │  proxy tools/list to backends (olb + invest), merge + append gateway-owned tools
  │  guardToolsList(decoded, config, activeVertical, candidateNames)
  │     → POST {pingAuthorize}/…/decision  (mock: demo_authz_server)
  │     → { decision:'PERMIT', advice:[ AllowedVertical, PermittedTools, DeniedTools ] }
  │  drop vertical-foreign tools · split permitted (tools[]) vs scope-denied (_meta)
  ▼
MCP Server  (demo_mcp_server)  ← pure executor, no list-time filtering
  │  tools/list → getAvailableTools()  (ALL tools; scope enforced only at tools/call)
  ▼
(tools/call only) gateway → MCP server → BFF /api/path/vertical-tool → vertical store
```

### Wire shapes

**Gateway → Authorize decision request** (`parameters`), added/used by this work:
```json
{ "DecisionContext": "McpToolsList", "ClientId": "<user sub>", "ActClientId": "<agent>",
  "TokenAudience": "mcpgateway.ping.demo", "TokenScopes": "records:read",
  "ActiveVertical": "healthcare", "Vertical": "healthcare",
  "CandidateTools": "[\"view_records\",\"book_appointment\",…]" }
```

**Authorize → gateway decision response** (mock, `permitWithAdvice`):
```json
{ "decision": "PERMIT", "advice": [
  { "name": "AllowedVertical", "value": "healthcare" },
  { "name": "PermittedTools", "value": "[\"view_records\"]" },
  { "name": "DeniedTools", "value": "[{\"name\":\"book_appointment\",\"reason\":\"insufficient_scope: requires write\"}]" }
] }
```

**Gateway → BFF `tools/list` result** (MCP-spec aligned):
```jsonc
{ "tools": [ { "name": "view_records", "vertical": "healthcare", … } ],   // permitted only (callable)
  "_meta": {
    "deniedTools": [ { "name": "book_appointment", "permitted": false,
                       "deniedReason": "insufficient_scope: requires write", … } ]
  } }                                                                      // vertical-foreign omitted entirely
```

**BFF → browser** (`POST /api/demo-agent/tools`):
```jsonc
{ "vertical": "healthcare", "allowWrite": false,
  "availableTools": [
    { "name": "view_records",     "permitted": true },
    { "name": "book_appointment", "permitted": false, "deniedReason": "insufficient_scope: requires write" }
  ],
  "tokenEvents": [ … ] }
```

The UI joins `availableTools` with the vertical manifest's `chips10` (presentation SoT) keyed by `chip.tool`: present + permitted → active chip; present + denied → greyed chip with reason; **absent → no chip**.

---

## Key decisions (and why)

- **Scope control = in-agent picker, modeled as a *write toggle*** ("Read only" vs "Read + Write"). The SoT (`scope-topology.json`) uses vertical-specific read scopes — healthcare reads need `records:read`, sporting-goods `gear:read`, banking/retail `read` — so a literal `['read']` set would wrongly deny non-banking *read* tools. Instead `resolveAgentScopes(vertical, allowWrite)` always grants the active vertical's read scopes (union of the vertical's tools' non-write `requiredScopes`) and adds the vertical's write-ish scopes (`write`, plus `transfer` for banking) only when the toggle is on. Frontend sends only `{ vertical, allowWrite }`; the scope set is resolved server-side. *(This refinement was made during implementation — see [Corrections](#corrections-made-during-implementation).)*
- **Vertical conveyed both ways:** a `vertical` parameter on the agent-token grant **and** the `X-Active-Vertical` header (server-to-server, set per-call by `mcpWebSocketClient`). Authorize reads `Vertical`; the header drives the gateway's vertical scoping.
- **Token cache key = `(vertical, scopeSet)`**, stored at `req.session.agentTokens["<vertical>::<sorted space-joined scopes>"]` with a 60 s safety margin on `expires_at`. Reused within a combo; a vertical switch or toggle flip is a deliberate cache miss (re-mint + re-list) — the visible Authorize moment. Cleared on logout for free by `req.session.destroy()` (`demo_api_server/server.js`).
- **MCP-spec compliance:** `result.tools[]` = callable (permitted) only; scope-denied tools live in `result._meta.deniedTools`; vertical-foreign tools are omitted entirely.
- **Discovery goes through the WS gateway path**, not the legacy HTTP `agentGatewayClient.getAvailableTools` (which posted to `<url>/tools/list`, a route the gateway doesn't serve — it bypassed Authorize). *(Discovered + corrected during implementation.)*
- **Mock parity rule:** every change to Authorize decision params/contexts/response shape lands in `demo_authz_server` in the same change (the mock is a drop-in for real PingOne Authorize). See memory `feedback_authz_mock_parity` / skill `authz-server-parity`.

---

## Component design & implementation touchpoints

### MCP Gateway (`demo_mcp_gateway/src/`)
- **`pingAuthorizeGuard.ts`** — `AuthzDecision` gained `permittedTools?: string[]` and `deniedTools?: {name,reason}[]`. `guardToolsList(decoded, config, activeVertical, candidateTools?)` now sends `TokenScopes` + `Vertical` + `CandidateTools` and parses the advice array (`getAdvice('PermittedTools'|'DeniedTools'|'AllowedVertical')`, JSON-parsed). `guardToolCall(…, vertical?)` threads the vertical through.
- **`auth/PingOneAuthorizeClient.ts`** — `buildAuthorizeParameters(…, vertical?)` adds `Vertical` to the `parameters` block (shared by the HTTP `evaluate` and WS `guardToolCall` transports, so both stay in lock-step).
- **`index.ts`** (`tools/list` branch, ~L385–470) — the guard now runs **after** the backend merge (it needs the merged tool names as `candidateNames`). Post-decision: (1) drop tools whose `vertical` tag ≠ `allowedVertical`; (2) split the remainder into `permittedOut` (→ `tools[]`) and `deniedOut` (→ `_meta.deniedTools`, each `{...tool, permitted:false, deniedReason}`); HI-04 `partialResults`/`failedBackends` `_meta` preserved.

### Mock Authorize (`demo_authz_server/`)
- **`routes/decision.js`** (`McpToolsList` branch, ~L169–186) — when `CandidateTools` is present, evaluate each tool's `scopeTopology.requiredScopesForTool(name)` against the token's `grantedScopes` and return `permitWithAdvice(res, …, [AllowedVertical, PermittedTools, DeniedTools])`. Unknown tool → denied with `unknown_tool`. Absent `CandidateTools` → legacy single `permit(...)` (back-compat; existing tests untouched). New helper `permitWithAdvice(res, reason, advice)` added beside `permit/deny/indeterminate`.

### MCP Server (`demo_mcp_server/src/`)
- **`server/MCPMessageHandler.ts`** (`handleListTools`, ~L207) — calls `toolProvider.getAvailableTools()` (full set) instead of `getAvailableToolsForToken(scopes)`. Scope/vertical filtering is the gateway's job; the server still enforces scope at `tools/call` time (`toolScopeFilter.regression` stays green). Removed the now-dead `decodeScopesFromToken` helper.

### BFF (`demo_api_server/`)
- **`services/agentCCTokenService.js`** — `getAgentCCToken(req, { scope, vertical })`: sends `vertical` on the token request body and echoes `scope` + `vertical` on the result for the cache key.
- **`services/agentTokenCache.js`** *(new)* — `keyFor(vertical, scopes)` (sorted, space-joined), `get(session, vertical, scopes)` (null if absent/expired), `set(session, vertical, scopes, tokenResult)` (60 s margin). Operates on `req.session.agentTokens`.
- **`services/agentScopes.js`** *(new)* — `resolveAgentScopes(vertical, allowWrite)`: reads `scope-topology.json` × `verticalManifest.plugins.get(vertical).getTools()`; read scopes always granted, write-ish (`write`/`transfer`/`admin*`) only when `allowWrite`; always includes `mcp:invoke`; unknown vertical falls back to `['read','mcp:invoke']`.
- **`services/agentToolsResolver.js`** *(new)* — `resolveAvailableTools(req, { vertical, allowWrite })`: scopes → cache get/mint → `listAvailableTools` → `{ availableTools, tokenEvents, scopes }`.
- **`services/agentGatewayClient.js`** — `normalizeGatewayTools(result)` (pure: merges `tools` + `_meta.deniedTools` → flat list with `permitted`/`deniedReason`) and `listAvailableTools(req, agentToken, { vertical, userSub })` (discovery via `mcpWebSocketClient.mcpListTools`). Legacy HTTP `getAvailableTools` retained as a fallback but no longer on the chip path.
- **`services/mcpWebSocketClient.js`** — `mcpRpc(…, opts)` / `mcpListTools(token, userSub, cid, opts)` accept `opts.vertical`, which sets the `X-Active-Vertical` upgrade header (falling back to global `active_vertical`).
- **`routes/demoAgentRoutes.js`** — new `POST /api/demo-agent/tools { vertical, allowWrite }` (mounted at `/api/demo-agent`) wraps `resolveAvailableTools`; defaults `allowWrite=true`, vertical from body or `active_vertical`. `/init` left on its legacy path; the chip flow uses `/tools` exclusively.

### Frontend (`demo_api_ui/src/`)
- **`components/ScopePicker.jsx`** *(new)* — `<select>` "Read + Write" / "Read only"; `value/onChange(allowWrite:boolean)/disabled` props.
- **`services/demoAgentService.js`** — `fetchAgentTools({ vertical, allowWrite })` → `POST /api/demo-agent/tools`, returns `{ availableTools, vertical, allowWrite }` (empty list + `error` on non-OK).
- **`components/AIAgent.js`** — state `availableTools`, `agentAllowWrite` (default true), `agentToolsLoading`; `toolPermissions` `useMemo` (name → tool); a stale-guarded `useEffect` re-fetches on `[isLoggedIn, activeVerticalId, agentAllowWrite]`; renders `<ScopePicker>` above `<BankingChips>` and passes `toolPermissions` + `onDeniedChip` (pushes a user echo + an assistant denial message via `addMessage`).
- **`components/BankingChips.jsx`** — new props `toolPermissions={}`, `onDeniedChip`. `chipPermState(chip)`: no `tool` or perms-not-loaded → show & active (no regression); tool absent → hide; present & `permitted:false` → greyed (`--denied` class, lock affordance, still clickable → `onDeniedChip`). `BankingChips.css` adds `.banking-chips-dropdown__button--denied`.
- **Manifests + `services/verticalManifest/schema.js`** — `ChipSchema` gains optional `tool`. Tool-backed `chips10` entries across healthcare/retail/workforce/sporting-goods reference their MCP tool (LLM/soft chips left toolless → always shown).

---

## Commit log (branch `worktree-fix-gateway-upstream-fallback`)

| Commit | Phase | Summary |
|--------|-------|---------|
| `feat(authz-mock)` | A1 | per-tool advice for `McpToolsList` |
| `feat(gateway)` | A2 | guard parses advice; `Vertical` param |
| `feat(gateway)` | B1 | `tools/list` permitted + `_meta.deniedTools`, drop vertical-foreign |
| `refactor(mcp-server)` | C1 | `tools/list` returns all tools |
| `feat(bff)` | D1 | token issuance accepts scope + vertical |
| `docs` | — | shareable spec (this file) |
| `feat(bff)` | D2 | session token cache + `resolveAgentScopes` |
| `feat(bff)` | E1 | discover via WS gateway path; merge permitted + denied |
| `feat(bff)` | E2 | `resolveAvailableTools` + `POST /api/demo-agent/tools` |
| `feat(manifests)` | F1 | chips carry `tool` reference |
| `revert(mcp)` | G1 | drop `gateway_upstream_error` band-aid |
| `feat(ui)` | F2+F3 | scope picker + greyable chips |
| `docs` | — | progress updates |

---

## Progress

| Phase | Description | Status | Tests |
|------|-------------|--------|-------|
| A1 | Mock Authorize: per-tool advice for `McpToolsList` | ✅ | `demo_authz_server/decision.toolsList.test.js` (3) |
| A2 | Gateway guard parses advice; `Vertical` param added | ✅ | `demo_mcp_gateway/tests/guardToolsList.test.ts` (3) |
| B1 | Gateway `tools/list` returns permitted + `_meta.deniedTools`; drops vertical-foreign | ✅ | build + suite |
| C1 | MCP server `tools/list` returns all tools (no scope filter) | ✅ | `…/__tests__/toolsListNoScopeFilter.test.ts` (1) + `toolScopeFilter.regression` |
| D1 | `agentCCTokenService` accepts scope + vertical | ✅ | `agentCCTokenService.scopeVertical.test.js` (2) |
| D2 | Session token cache + `resolveAgentScopes` (write toggle) | ✅ | `agentTokenCache.test.js` (5), `agentScopes.test.js` (6) |
| E1 | Discover via WS gateway path; merge permitted + denied | ✅ | `agentGatewayClient.denied.test.js` (3) |
| E2 | `resolveAvailableTools` + `POST /api/demo-agent/tools` | ✅ | `agentToolsResolver.test.js` (3) |
| F1 | Manifest chips carry `tool` reference | ✅ | `chips10Schema.test.js` (4) |
| F2 | Scope picker + store `availableTools` | ✅ | JSX parse-validated (`@babel/parser`) |
| F3 | `BankingChips` greys denied chips + reason | ✅ | JSX parse-validated |
| G1 | Revert `gateway_upstream_error` band-aid | ✅ | pipeline suite (no new failures) |
| G2 | Remove dead static chip arrays | ✅ | parse-validated — removed `HEURISTIC_CHIPS`, `LLM_CHIPS`, the `!chips10` legacy fallback block + unused locals (−245 lines). All 5 dropdown verticals have `chips10`. **Kept** `ADMIN_CHIPS`/`PINGONE_ADMIN_CHIPS` (live admin overlay, edited by a separate effort) and `applyChipLabels` (exported + unit-tested) |

Each phase was done TDD-style (failing test → implement → green → commit), one commit per phase.

---

## Corrections made during implementation

These deviated from the original plan and were confirmed with the owner before proceeding:

1. **Write-toggle scope model (not literal `['read']`/`['read','write']`).** The SoT uses vertical-specific read scopes, so the picker became a boolean write toggle and the BFF derives the read scope set per vertical (`resolveAgentScopes`). Without this, healthcare/sporting-goods read chips would have wrongly greyed out.
2. **Discovery moved to the WS gateway path.** `/init` originally used `agentGatewayClient.getAvailableTools` (HTTP `POST <url>/tools/list`) — but the gateway only serves `/mcp` over HTTP, so that path bypassed Authorize. The chip flow now uses `mcpWebSocketClient.mcpListTools` (WS → gateway → Authorize). The new `POST /api/demo-agent/tools` is the single discovery entry point for chips.
3. **`/init` left on its legacy path.** Rather than risk its delicate CC-token error UX, the new chip flow uses `/tools` exclusively; init-time chips are Authorize-filtered because the UI fetches via `/tools` on login.
4. **G2 skipped.** The static chip arrays are still referenced (legacy fallback + admin overlay), so removing them would regress; left in place.

---

## Verification (end-to-end)

The UI greying/hiding is the only behavior **not** covered by automated tests — verify it live.

Run the stack with `./run.sh` (requires `VAULT_PASSWORD`; see memory `feedback_run_sh`/`project_vault`); ensure the mock authz server is up and `MCP_GW_P1AZ_ENABLED=true`.

1. **Vertical isolation:** switch banking → healthcare; the agent re-fetches (`POST /api/demo-agent/tools`) and chips swap to the new vertical only. Gateway log shows `tools/list vertical='healthcare': N/M after vertical filter`.
2. **Scope greying (the demo moment):** with the picker on **Read + Write**, write chips (Book appointment, Release records, Checkout, Transfer) are active. Switch to **Read only** → those chips grey (dashed border + 🔒) and clicking one posts an inline assistant message: *"This action was denied by PingOne Authorize: … Switch the Agent scope to 'Read + Write' to enable it."* Switch back → re-enabled.
3. **Token cache:** repeated calls in the same `(vertical, allowWrite)` reuse the cached token (no new issuance in the Token Chain panel / BFF logs); a switch or flip mints once. Logout clears the cache.
4. **No 502:** a healthcare chip executes through gateway → MCP server → BFF `/api/path/vertical-tool` with no `gateway upstream error (HTTP 502)`.

### Automated test commands
```bash
# Mock Authorize
cd demo_authz_server && node --test decision.toolsList.test.js decision.ruleStore.test.js

# Gateway (build + guard/tools-list)
cd demo_mcp_gateway && npm run build && npx jest guardToolsList

# MCP server (list change + call-time enforcement intact)
cd demo_mcp_server && npm run build && npx jest toolsListNoScopeFilter toolScopeFilter

# BFF (worktree-ignore override required — see memory reference_jest_worktree_ignore)
cd demo_api_server && npx jest --testPathIgnorePatterns=/node_modules/ \
  --testPathPattern 'agentCCTokenService.scopeVertical|agentTokenCache|agentScopes|agentGatewayClient.denied|agentToolsResolver'
```

> **Pre-existing failures unrelated to this work** (fail identically on the pre-feature base commit, environmental — the worktree lacks `PINGAUTHORIZE_ENDPOINT` / reads real `.env`): gateway `mortgageDispatch` "no-PA mode" (3) and BFF `mcpToolPipelineSseRequest.regression` (6). See memory `project_flaky_integration_tests`.

---

## Post-review fixes applied

A high-effort multi-angle code review ran on the branch; these were fixed (one commit each):

1. **Banking chips were untagged** → the greying feature was inert in the default vertical. Tagged banking's read + write chips (`fix #1`).
2. **Gateway-owned tools denied** — `special_offers`/`user_profile_card` (no scope-topology entry) were reported as `unknown_tool` on every `tools/list`. Exempted tools with a `credentialPath` from `CandidateTools` (`fix #2`).
3. **`ChipAuthorization` null-handling** PERMITted unknown tools while other contexts DENY → aligned to DENY (`fix #3`).
4. **`agentScopes` duplicated the SoT reader** → routed through `services/scopeTopology.js` `toolScopes()` (`fix #9`).
5. **Dead `permittedTools` advice field** parsed but unused → removed (`fix #10`).

Second review pass — the remaining findings were then addressed too:

6. **Fail-open on `/tools` fetch failure** → the effect keeps the last-known-good list and raises `agentToolsError`; tool-backed chips render **disabled/"unverified"** (not freely clickable) when perms can't be loaded (`fix #4`).
7. **Vertical dual-carrier had no defined precedence** → both `tools/list` and `tools/call` now resolve `decoded.vertical ?? activeVertical` (token claim wins, else header), so the claim is consumed and precedence is explicit (`fix #6`).
8. **`isWriteIsh` string heuristic** → now derived from the SoT per-scope `riskLevel` (high/critical = gated), fixing `users:manage` (was missed) and `admin:read` (was wrongly gated) (`fix #7`).
9. **Real-PingOne scope-subset limitation** → not code-fixable (CC grant returns the client's configured scopes), but `agentCCTokenService` now **warns** when the minted token carries scopes beyond the requested set, so an operator can tell a tenant-config issue from a bug (`fix #5`).

10. **Guard ran after the backend proxy** (#8) → added a pre-proxy overall permit/deny gate so a disabled/discovery-denied user fails closed before any upstream round-trip; the per-tool greying refinement still runs post-merge. Costs one extra Authorize round-trip on the permit path — explicitly accepted by the owner (agents are latency-dominated anyway).

Chips still show active during the **brief initial load** (intentional no-regression; only the *error* path is gated). The real-PingOne scope-subset constraint (#5) remains a deployment/grant-type decision, surfaced via the operator warning.

---

## Follow-ups / not in scope

- **Real PingOne Authorize policy** must be authored to return the same `advice` shape (`AllowedVertical` / `PermittedTools` / `DeniedTools`) the mock now emits. Until then, run with the mock (`MCP_GW_P1AZ_ENABLED=true` → `demo_authz_server`).
- **Agent CC app scopes:** the picker selects a subset of scopes the CC app already allows; for the real path the app must permit `read`/`write`/the vertical read scopes. With the mock, requested scopes are honored directly.
- **Migrate `/init`** onto `resolveAvailableTools` if/when its CC-token error UX is reworked (currently the chip flow already bypasses `/init` via `/tools`).
