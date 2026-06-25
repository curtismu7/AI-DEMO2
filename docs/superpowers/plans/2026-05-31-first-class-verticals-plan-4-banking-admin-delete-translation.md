# First-Class Verticals — Plan 4: Banking Plugin + Generic Admin Overlay + Delete Translation

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Checkbox steps. BFF-only — touches ZERO dashboard/UI render files (the dashboard-native migration is a separate, UI-blocked plan).

**Goal:** (1) Convert **banking** into a first-class plugin (hybrid: own prompt/heuristics/authz/render/chips, but `executeTool` delegates to the existing MCP banking path). (2) Replace the separate `admin-console` vertical with a **generic cross-vertical admin role-overlay** that works in ANY vertical for admin-role users, with its own curated 10 chips. (3) DELETE the now-dead NL/agent translation code. Completes the agent-side "no banking substrate" + "admin is a role, not a vertical" goals.

**Decisions (user, 2026-05-31):**
- Convert banking + retire admin-console as a vertical, now (risk accepted).
- **Admin = generic role overlay, not a vertical.** When `req.user.role==='admin'` in ANY active vertical, the shared layer grants generic admin tools/chips/authz on top of that vertical. See [[project_admin_overlay]].
- **Admin gets exactly 10 curated chips** (same model as the verticals: 7 heuristic + 3 LLM-only).
- Model tiering for agents: haiku=easy, sonnet=medium, opus=hard — set on EVERY agent.

**KEEP (NOT deleted — vertical-agnostic infra / dashboard-coupled, gated by the separate dashboard-native plan):** `reseedAllCustomersForVertical`, `SEED_PROFILES`, the `accounts.js` mismatch block, `demo_mcp_gateway/src/router.ts` maps, the admin MCP tools (lookup_customer/freeze_account/etc. — already scope-gated and orthogonal; the overlay REUSES them).

**Ground-truth facts (audited 2026-05-31):**
- Banking's 4 tools (get_my_accounts/create_transfer/create_deposit/create_withdrawal) are MCP-served via `executeBffTool`. Banking's heuristic vocabulary (parseBanking) uses ACTION names accounts/balance/transactions/transfer/deposit/withdraw/mortgage_demo/spending_summary/biggest_purchase/mcp_tools — banking's plugin must preserve this exactly (extract executeHeuristicBanking's per-action dispatch into a shared fn the plugin reuses).
- Admin tools already exist + are scope-gated in BankingToolRegistry (lookup_customer, get_customer_profile, get_customer_accounts, get_customer_transactions, freeze_account, reset_customer_password, adjust_balance, delete_customer) with `admin:read`/`admin:write`/`users:manage`. Role set in auth.js when token carries ADMIN scope. Execution gates by token scope — works cross-vertical already.
- admin-console is HIDDEN_IDS + resolved as adminManifest in scope.js when isAdmin. `THEME_VOCAB['admin']` + admin THEME_OVERRIDE drive its agent phrasing today.

---

## Phase A — Banking plugin

### Task A1 — extract shared banking action dispatch (sonnet — touches §1 logic)
**Files:** Modify `demo_api_server/services/demoAgentLangGraphService.js`; Test: extend an agent test.
- [ ] Extract `executeHeuristicBanking`'s per-action switch (accounts/balance/transactions/transfer/deposit/withdraw/mortgage_demo/spending_summary/biggest_purchase) into a reusable `dispatchBankingAction(action, params, ctx)` that both `executeHeuristicBanking` (unchanged callers) AND the banking plugin's executeTool call. Behavior byte-identical (read ~lines 99-340). Keep the isAdmin phrasing branches.
- [ ] State REGRESSION_PLAN §1 do-not-break (transfer HITL, accounts cold-start) before editing. Run `npx jest hitl transactions accounts oauthStatus demoAgentLangGraph --no-coverage` → green.
- [ ] Commit `refactor(verticals): extract dispatchBankingAction for reuse by banking plugin`.

### Task A2 — banking plugin index.js (sonnet)
**Files:** Create `demo_api_server/config/verticals/banking/index.js` + `bankingPlugin.contract.test.js`.
- [ ] getManifest→resolve('banking'); getTools→banking tool schemas (the action vocabulary the UI/heuristic use); getHeuristics→banking phrase→action map (mirror parseBanking's regexes); getSystemPrompt→banking directive; getDataStore→`{ get: () => ({}) }` (MCP-backed, no local store — documented); executeTool→delegates to `dispatchBankingAction`; getAuthz→banking HITL rules (transfer/deposit/withdraw thresholds matching today).
- [ ] **Resolve the kind:'vertical' routing risk:** with banking a plugin, `parseHeuristic(msg,'banking')`→`kind:'vertical'`. The Plan-2 kind:'vertical' consumers (processAgentMessage dispatchVerticalIntent + BankingAgent.js) must render banking results. SPIKE this first: confirm banking chips + agent still work end-to-end, or thread banking's results through the existing render path. If integration breaks the live banking chips, STOP and report.
- [ ] Tests: contract valid; heuristics⊆tools; key phrases route; authz transfer gated; executeTool delegates (mock dispatchBankingAction). Commit `feat(verticals): banking plugin index.js (hybrid, MCP-delegating)`.

### Task A3 — banking manifest render block (haiku)
- [ ] Add `render` to banking manifest (accounts→table, balance→fieldList, transactions→table, transfer/deposit/withdraw→confirm/card, mortgage_demo→card). Validate. Commit.

---

## Phase B — Generic admin overlay (retire admin-console vertical)

### Task B1 — admin overlay module (sonnet)
**Files:** Create `demo_api_server/services/adminOverlay.js` + test.
- [ ] Define the generic admin surface ONCE (not per-vertical): `getAdminTools()` (the 8 admin MCP tools already in BankingToolRegistry — lookup_customer, get_customer_profile, get_customer_accounts, get_customer_transactions, freeze_account, reset_customer_password, adjust_balance, delete_customer), `getAdminHeuristics()` (generic phrase→admin-tool map: "look up customer"→lookup_customer, "freeze account"→freeze_account, etc. — vertical-agnostic), `getAdminChips10()` (10 curated admin chips: 7 heuristic + 3 LLM-only), `getAdminAuthz()` (destructive actions: freeze/reset/adjust/delete → `{ stepUp:true, consent:true }`), `getAdminSystemPromptAddon()` (the admin directive, moved inline from HELIX_AGENT_DIRECTIVES).
- [ ] Tests: tool list non-empty + scoped admin:*; heuristic actions ⊆ admin tools; 10 chips (7 both + 3 llm); destructive authz gated. Commit `feat(verticals): generic admin overlay module (cross-vertical)`.

### Task B2 — wire the overlay into the shared dispatch (sonnet)
**Files:** Modify `demo_api_server/services/verticalDispatch.js` + the NL/agent path.
- [ ] When `ctx.role==='admin'` (or req.user.role), the shared dispatch MERGES the admin overlay onto the active vertical: tool schemas = active vertical's tools + getAdminTools(); heuristics = vertical heuristics + getAdminHeuristics() (admin phrases match in any vertical); systemPrompt = vertical prompt + getAdminSystemPromptAddon(); chips = vertical chips10 + getAdminChips10() (or admin's 10 replace, per UX — default: admin's 10 shown when in admin scope). executeTool: admin tool names dispatch to the MCP admin tools (already scope-gated); others fall to the vertical.
- [ ] Pass role into the dispatch helpers (they currently take activeId; add an opts/role param or read it from a passed ctx). Keep non-admin behavior byte-identical.
- [ ] Tests: with role=admin active in healthcare, tool list includes BOTH healthcare tools AND admin tools; "look up customer" routes to lookup_customer; non-admin in healthcare sees only healthcare tools. Commit `feat(verticals): admin overlay merged into shared dispatch by role`.

### Task B3 — retire admin-console as a vertical (sonnet)
- [ ] scope.js: replace `adminManifest = resolve('admin-console')` with the overlay (adminManifest no longer a separate vertical resolve; the overlay provides admin chips/tools on top of the active vertical). Reconcile useVertical/UI consumption of adminManifest (the UI's agentManifest when isAdminScope — point it at active vertical + admin overlay chips). Remove admin-console from HIDDEN_IDS handling as a switchable vertical OR keep the manifest file but stop treating it as the admin source (decide; simplest: keep the directory for now, stop resolving it as adminManifest).
- [ ] Migrate the admin chipFull test block to the overlay model (admin heuristics → admin tool names). Commit `refactor(verticals): admin is a role overlay, not the admin-console vertical`.

---

## Phase C — Delete dead translation code (ONLY after A+B: every vertical is a plugin AND admin is an overlay)

**Pre-check:** boot sanity — banking + the 4 verticals all `hasPlugin`; admin handled by overlay; `parseTheme`/`THEME_VOCAB` unreachable from the live path.

- [ ] **C1 (haiku):** nlIntentParser.js — delete `THEME_VOCAB` + `parseTheme` + the legacy `if (vertical!=='banking'){parseTheme}` branch; remove from exports. (admin chipFull already migrated in B3.) Run nlIntent + chipFull suites.
- [ ] **C2 (haiku):** geminiNlIntent.js + HELIX_AGENT_DIRECTIVES.json — delete the `THEME_OVERRIDES`/`buildSystem` theme-append branch (every vertical has a plugin → always plugin prompt); delete the `themes` block (keep `base`). Run geminiNlIntent suites.
- [ ] **C3 (haiku):** demoAgentLangGraphService.js — delete `_buildVerticalToolDescription` + `buildToolSchemasForAgentForVertical` (resolveToolSchemas always hits the plugin branch now); keep executeBffTool + dispatchBankingAction. Remove from exports. Run agent suites.
- [ ] Each deletion its own commit.

---

## Phase D — Verify
- [ ] Boot sanity: banking + 4 verticals `plugin`; admin overlay active for admin role in any vertical.
- [ ] Full regression: no new failures vs baseline; banking real suites (transfers/hitl/accounts) green; admin real suite green (migrated to overlay).
- [ ] No-translation test: THEME_VOCAB/parseTheme/THEME_OVERRIDES gone; shared layer has no per-vertical translation map.
- [ ] REGRESSION_PLAN §4 entry + §1 reconciliation (translation entries removed; reseed infra KEPT for dashboard).
- [ ] `/code-review <first-sha>..HEAD`.

## Done-Criteria
1. Banking is a plugin (hybrid MCP-delegating); its agent/chip behavior preserved.
2. Admin is a generic cross-vertical role overlay with 10 curated chips; admin-console no longer a distinct vertical; admin works in ANY vertical.
3. THEME_VOCAB/parseTheme/THEME_OVERRIDES/_buildVerticalToolDescription/buildToolSchemasForAgentForVertical DELETED.
4. Reseed/relabel infra + router maps + admin MCP tools KEPT.
5. No new failures vs baseline.

## Highest risks (resolve in-task, escalate if needed)
- **A2 banking kind:'vertical' routing** — banking chips/agent are live + UI-coupled; spike before committing. If it breaks the live banking path, escalate (banking may stay legacy until dashboard-native).
- **B2/B3 admin overlay** — changing adminManifest resolution affects the UI's agentManifest; the dashboard-native plan (post-UI) will revisit admin dashboard rendering. Keep this plan's admin changes to the AGENT path; don't touch admin dashboard rendering (UI-blocked).