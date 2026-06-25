# First-Class Verticals — Plan 3: Retail, Sporting-Goods, Workforce

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Checkbox steps. Each vertical mirrors the proven `healthcare` plugin (Plan 2).

**Goal:** Convert retail, sporting-goods, and workforce into first-class plugins, each with its own data schema, tools (including a novel action), heuristics, authz, and render descriptors — applying the healthcare template. After this, 4 of 5 verticals are first-class (banking remains legacy until Plan 6).

**Architecture:** Identical to healthcare (Plan 2). Each vertical gets `config/verticals/<id>/{seed.json,data.js,tools.js,index.js}` implementing the Plan 1 plugin contract, a manifest `render` block, and tests. All shared infrastructure (verticalDispatch, plugin discovery, render schema, `<VerticalResult>`, the `kind:'vertical'` wiring in the agent path + /nl flow + BankingAgent.js, agent-runtime parity) is ALREADY DONE — these verticals plug straight in. The moment each ships an `index.js`, `verticalDispatch.hasPlugin(id)` flips it from legacy to plugin.

**Template to copy (read these first):**
- `demo_api_server/config/verticals/healthcare/{seed.json,data.js,tools.js,index.js}`
- `demo_api_server/config/verticals/healthcare/manifest.json` (the `render` block)
- The healthcare tests: `healthcareData.test.js`, `healthcareTools.test.js`, `healthcarePlugin.contract.test.js`, `healthcareNoFallback.test.js`

**Reference:** spec `2026-05-30-first-class-verticals-design.md`; Plan 2 `2026-05-30-first-class-verticals-plan-2-healthcare.md`.

---

## Per-vertical domain models (real schemas, NOT relabeled banking)

### retail (Great Buy)
```jsonc
// seed.json
{
  "orders": [
    { "id": "o1", "product": "AirPods Pro", "sku": "BB-APP3", "amount": 249, "status": "Delivered", "date": "2026-04-20" },
    { "id": "o2", "product": "MacBook Pro 14\"", "sku": "BB-MBP14", "amount": 1999, "status": "Shipped", "date": "2026-04-22" },
    { "id": "o3", "product": "Bose SoundLink", "sku": "BB-BOSE-SL", "amount": 149, "status": "Processing", "date": "2026-04-23" }
  ],
  "rewards": { "points": 4820, "tier": "Gold", "storeCredit": 150.0 },
  "wishlist": [ { "id": "p9", "product": "iPhone 16 Pro", "price": 999 } ]
}
```
Tools: `list_orders` (table), `order_status` (card — novel: takes orderId), `rewards_balance` (fieldList), `checkout` (card, **write**, authz `{consent:true}` — novel), `show_large_purchase` (API-key, unchanged).

### sporting-goods (Super Sports)
```jsonc
{
  "orders": [
    { "id": "o1", "product": "Nike Pegasus 41", "sku": "SS-NK-RUN", "amount": 140, "status": "Delivered", "date": "2026-04-18" },
    { "id": "o2", "product": "Garmin Forerunner 265", "sku": "SS-GRM-WCH", "amount": 449, "status": "Shipped", "date": "2026-04-25" }
  ],
  "rentals": [
    { "id": "r1", "item": "Trek Marlin 8 Mountain Bike", "sku": "SS-TREK-MB8", "dueDate": "2026-05-30", "dailyRate": 45, "status": "Active" },
    { "id": "r2", "item": "Rossignol Ski Set", "sku": "SS-RS-SKI", "dueDate": "2026-06-01", "dailyRate": 60, "status": "Active" }
  ],
  "loyalty": { "points": 4500, "tier": "Gold" }
}
```
Tools: `list_gear` (table — orders), `list_rentals` (table — **novel**, sporting-goods-only), `gear_order_status` (card, novel — orderId), `loyalty_balance` (fieldList), `extend_rental` (card, **write**, authz `{consent:true}` — novel: rentalId), `show_gear_order` (API-key).

### workforce (WX Workforce)
```jsonc
{
  "pto": { "balance": 14, "sickLeave": 6, "accruedYtd": 18 },
  "benefits": [
    { "id": "ben1", "name": "Medical", "planType": "PPO", "enrollmentStatus": "Enrolled", "coverageTier": "Employee + Family" },
    { "id": "ben2", "name": "Dental", "planType": "DPPO", "enrollmentStatus": "Enrolled", "coverageTier": "Employee Only" },
    { "id": "ben3", "name": "401(k)", "planType": "Roth", "enrollmentStatus": "Enrolled", "coverageTier": "6% contribution" }
  ],
  "expenses": [
    { "id": "exp1", "category": "Travel", "description": "Q2 Sales Summit", "amount": 1847.5, "status": "Approved", "submittedDate": "2026-05-02" }
  ]
}
```
Tools: `view_benefits` (table), `pto_balance` (fieldList), `list_expenses` (table), `submit_expense` (card, **write**, authz `{stepUp:true, consent:true}` — novel: category+amount), `request_time_off` (card, **write**, authz `{consent:true}` — novel: days), `show_expense_report` (API-key).

---

## Task group A — Retail (Tasks A1–A4)

### Task A1 — retail data store
**Files:** Create `demo_api_server/config/verticals/retail/seed.json` (the retail object above), `demo_api_server/config/verticals/retail/data.js`, test `demo_api_server/src/__tests__/retailData.test.js`.

Mirror `healthcare/data.js` exactly, renaming to `createRetailStore()` with methods over the retail schema: `get(userId)` (deep-clone seed), `checkout(userId, {product, amount})` (appends an order with status 'Processing', returns it). 

- [ ] **Step 1:** Write `seed.json`.
- [ ] **Step 2:** Write the failing test (copy `healthcareData.test.js`, adapt): clone independence; `checkout` appends an order with a generated id + status 'Processing' and returns it.
- [ ] **Step 3:** Run → FAIL.
- [ ] **Step 4:** Write `data.js` (copy healthcare/data.js shape; `createRetailStore`, `get`, `checkout(userId, {product, amount})` → `{ id: 'ord-new-N', product, amount, status: 'Processing', date: <from seed or static> }` pushed to `orders`). NOTE: `Date.now()`/`new Date()` are fine in app code (not a workflow script) — but prefer a static date string or a monotonic counter for the id to keep tests deterministic; use `ord-new-${seq}`.
- [ ] **Step 5:** Run → PASS.
- [ ] **Step 6:** Commit: `git add demo_api_server/config/verticals/retail/seed.json demo_api_server/config/verticals/retail/data.js demo_api_server/src/__tests__/retailData.test.js && git commit --no-verify -m "feat(verticals): retail per-vertical data store (orders/rewards/wishlist)"`

### Task A2 — retail tools + handlers
**Files:** Create `demo_api_server/config/verticals/retail/tools.js`, test `demo_api_server/src/__tests__/retailTools.test.js`.

Mirror `healthcare/tools.js`. `buildRetailTools(store)` → `{ tools, execute }`. Tools:
```javascript
const tools = [
  { name: 'list_orders',  description: 'List the customer\'s orders.', inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
  { name: 'order_status', description: 'Show the status of a specific order.', inputSchema: { type: 'object', properties: { orderId: { type: 'string' } }, required: ['orderId'] }, scopes: ['read'], authz: {} },
  { name: 'rewards_balance', description: 'Show the customer\'s reward points and store credit.', inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
  { name: 'checkout', description: 'Place an order (checkout). Requires confirmation.', inputSchema: { type: 'object', properties: { product: { type: 'string' }, amount: { type: 'number' } }, required: ['product', 'amount'] }, scopes: ['write'], authz: { consent: true } },
];
```
`execute(name, params, ctx)` returns `{ result, render }`: `list_orders` → `{ orders }` render 'list_orders'; `order_status` → the matching order (or `{error:'order not found'}` render 'text') render 'order_status'; `rewards_balance` → `store.get(userId).rewards` render 'rewards_balance'; `checkout` → `store.checkout(...)` render 'checkout'; default → `{error: 'unknown tool: '+name}` render 'text'.

- [ ] Steps mirror Plan 2 Task 3 (write failing test asserting own action names, scopes from generic set + 'largepurchase:read', order_status by id, checkout writes + authz `{consent:true}`, unknown-tool error). Run RED→GREEN. Commit: `feat(verticals): retail tools + handlers (list_orders/order_status/rewards_balance/checkout)`.

### Task A3 — retail plugin index.js
**Files:** Create `demo_api_server/config/verticals/retail/index.js`, test `demo_api_server/src/__tests__/retailPlugin.contract.test.js`.

Mirror `healthcare/index.js`. `getManifest()` → `resolve('retail')`; tools/execute from `buildRetailTools`; `getDataStore()` → store; `getSystemPrompt(ctx)` → a retail directive (shopping assistant, no banking terms); `getAuthz()` aggregates per-tool authz. HEURISTICS (retail's own actions — most specific first):
```javascript
const HEURISTICS = [
  { re: /\bcheckout\b|\bplace\s+(an?\s+)?order\b|\bbuy\s+now\b/, action: 'checkout' },
  { re: /\border\s+status\b|\bwhere\s+is\s+my\s+order\b|\btrack\s+(my\s+)?order\b/, action: 'order_status' },
  { re: /\b(my\s+|list\s+|show\s+)?orders?\b|\border\s+history\b/, action: 'list_orders' },
  { re: /\b(my\s+|check\s+)?(rewards?\s+points?|store\s+credit|point\s+balance)\b|\bhow\s+many\s+points\b/, action: 'rewards_balance' },
];
```
- [ ] Steps mirror Plan 2 Task 4 (contract valid; heuristic actions ⊆ tools; "place an order" → checkout; non-empty no-banking prompt; authz checkout `{consent:true}`; executeTool runs). Verify discovery prints `retail hasPlugin: true`. Commit: `feat(verticals): retail plugin index.js (first-class)`.

### Task A4 — retail manifest render block
**Files:** Modify `demo_api_server/config/verticals/retail/manifest.json`.
Add a `render` block (sibling of featurePage):
```jsonc
"render": {
  "list_orders":     { "type": "table", "columns": [ { "label": "Product", "path": "product" }, { "label": "Amount", "path": "amount", "format": "money" }, { "label": "Status", "path": "status" } ] },
  "order_status":    { "type": "card", "title": "Order Status", "fields": [ { "label": "Product", "path": "product" }, { "label": "Status", "path": "status" }, { "label": "Date", "path": "date", "format": "date" } ] },
  "rewards_balance": { "type": "fieldList", "title": "Rewards", "fields": [ { "label": "Points", "path": "points", "format": "count" }, { "label": "Tier", "path": "tier" }, { "label": "Store credit", "path": "storeCredit", "format": "money" } ] },
  "checkout":        { "type": "card", "title": "Order Placed", "fields": [ { "label": "Product", "path": "product" }, { "label": "Amount", "path": "amount", "format": "money" }, { "label": "Status", "path": "status" } ] }
}
```
- [ ] Verify it validates (`node -e "...resolve('retail').render..."` prints the keys). Commit: `feat(verticals): retail manifest render descriptors`. (Note: table render reads `orders` array from the list_orders result via VerticalResult's array-finding; `list_orders` returns `{orders:[...]}` so the table picks that array.)

---

## Task group B — Sporting-Goods (Tasks B1–B4)

Same 4-task structure as retail. Distinctives:
- **data.js** `createSportingGoodsStore()`: `get`, `extendRental(userId, {rentalId, days})` (find rental, push out dueDate or mark extended, return it; null if not found).
- **tools.js** `buildSportingGoodsTools`: `list_gear` (orders, table), `list_rentals` (rentals, table — **novel domain**), `gear_order_status` (card, orderId required), `loyalty_balance` (fieldList), `extend_rental` (write, authz `{consent:true}`, rentalId required).
- **index.js** HEURISTICS (most specific first):
```javascript
const HEURISTICS = [
  { re: /\bextend\b.*\brental\b|\brenew\b.*\brental\b/, action: 'extend_rental' },
  { re: /\b(my\s+)?rentals?\b|\bgear\s+rentals?\b|\bdue\s+back\b/, action: 'list_rentals' },
  { re: /\border\s+status\b|\btrack\s+(my\s+)?order\b/, action: 'gear_order_status' },
  { re: /\b(my\s+)?gear\b|\bmy\s+equipment\b|\border\s+history\b/, action: 'list_gear' },
  { re: /\b(my\s+|check\s+)?(rewards?\s+points?|loyalty|point\s+balance)\b/, action: 'loyalty_balance' },
];
```
- **manifest render**: `list_gear`/`list_rentals` → table; `gear_order_status`/`extend_rental` → card; `loyalty_balance` → fieldList. `list_rentals` columns: Item(path item), Due(path dueDate, date), Status(path status).
- Commits per task: `feat(verticals): sporting-goods data store / tools / plugin index.js / render descriptors`.

---

## Task group C — Workforce (Tasks C1–C4)

Same structure. Distinctives:
- **data.js** `createWorkforceStore()`: `get`, `submitExpense(userId, {category, amount})` (push to expenses, status 'Submitted', return it), `requestTimeOff(userId, {days})` (decrement pto.balance by days if available, return `{days, remaining}`; or return `{error}` if insufficient).
- **tools.js** `buildWorkforceTools`: `view_benefits` (table), `pto_balance` (fieldList), `list_expenses` (table), `submit_expense` (write, authz `{stepUp:true, consent:true}`, required category+amount), `request_time_off` (write, authz `{consent:true}`, required days).
- **index.js** HEURISTICS (most specific first):
```javascript
const HEURISTICS = [
  { re: /\bsubmit\b.*\bexpense\b|\bfile\b.*\bexpense\b|\bexpense\s+report\b.*\bsubmit\b/, action: 'submit_expense' },
  { re: /\brequest\b.*\btime\s+off\b|\brequest\b.*\bpto\b|\btake\s+(a\s+)?(vacation|day\s+off)\b/, action: 'request_time_off' },
  { re: /\b(my\s+)?expenses?\b|\bexpense\s+(history|reports?)\b/, action: 'list_expenses' },
  { re: /\b(check\s+|my\s+|how\s+much\s+)?(pto|time\s+off|vacation|sick\s+leave)\s*(balance|left|remaining)?\b/, action: 'pto_balance' },
  { re: /\b(my\s+)?benefits?\b|\benrollments?\b|\bmedical\b|\bdental\b/, action: 'view_benefits' },
];
```
- **manifest render**: `view_benefits`/`list_expenses` → table; `pto_balance` → fieldList (Balance path balance count, Sick leave path sickLeave count, Accrued YTD path accruedYtd count); `submit_expense`/`request_time_off` → card.
- Commits per task: `feat(verticals): workforce data store / tools / plugin index.js / render descriptors`.

---

## Task D — Per-vertical no-fallback assertions + boot sanity + suite

- [ ] **D1:** For each of retail/sporting-goods/workforce, add `<id>NoFallback.test.js` (copy `healthcareNoFallback.test.js`, point the mock at that plugin via `require('../../config/verticals/<id>/index.js')` and the global-plugin trick). Assert tool schemas/heuristics/systemPrompt/executeTool/authz come from the plugin, no banking action names.
- [ ] **D2:** Boot sanity: `node -e "...; console.log(list.map(v=>v.id+':'+(d.hasPlugin(v.id)?'plugin':'legacy')).join('  '))"` → expect `banking:legacy` and the other four all `:plugin`.
- [ ] **D3:** Targeted suite green: `cd demo_api_server && npx jest retail sporting workforce healthcare vertical --no-coverage --testPathIgnorePatterns='/.claude/worktrees/' 'tests/real'` → all pass.
- [ ] **D4:** Update `nlIntentParser.chipFull.test.js`: the retail / sporting-goods / admin describe blocks still assert legacy THEME_VOCAB `kind:'banking'` routing. Retail + sporting-goods are now PLUGINS, so their phrases route to `kind:'vertical'`. Update those two blocks the same way the healthcare block was updated in Plan 2 (assert `kind:'vertical'` + the vertical's own action names). Admin stays legacy (no plugin) — leave it. (Workforce had no chipFull block.) Run `npx jest nlIntentParser.chipFull` → green.
- [ ] **D5:** Full regression gate: no NEW failures vs baseline. Commit any stragglers.
- [ ] **D6:** `/code-review <first-plan3-sha>..HEAD` final review.

---

## Task E — Curated 10 chips per vertical (7 heuristic + 3 LLM-only)

**Decision (user, 2026-05-31):** each vertical exposes exactly **10 chips** — 7 backed by the
vertical's plugin heuristics (work in Heuristics mode AND LLM mode) + 3 **LLM-only** (Heuristics
mode skips them; they need real language understanding). Mechanism: a `mode` flag on the chip
(`'both'` default | `'llm'`); the 3 `llm` chips have NO matching `getHeuristics()` entry, so in
Heuristics mode they resolve to `kind:'none'` → the UI marks/gates them. Chips live in the manifest.
Approved chip sets below.

### E1 — chip schema + a single curated `chips10` manifest list

- [ ] Add `mode: z.enum(['both', 'llm']).optional().default('both')` to `ChipSchema` in
  `schema.js`. Add an optional manifest field `dashboard.chips10: z.array(ChipSchema).optional()`
  (a flat curated list; keeps legacy `chips`/`llmChipGroups` intact for back-compat during rollout).
  Test: a manifest with a `chips10` of `{id,label,message,mode}` validates; bad `mode` rejected.
- [ ] Commit: `feat(verticals): chip mode flag + curated chips10 manifest list`.

### E2 — populate `chips10` in all 5 manifests (approved sets)

Each chip: `{ id, label, message, mode }`. The 7 `both` chips' `message` must match the vertical's
`getHeuristics()` (verify each routes correctly); the 3 `llm` chips are freeform.

- [ ] **healthcare** (heuristics: view_records/view_coverage/list_appointments/book_appointment/release_records):
  both: "My records"(view records), "Check coverage"(check my coverage), "My appointments"(my appointments),
  "Book an appointment"(book an appointment), "Release my records"(release my records),
  "What's my deductible?"(check my coverage→view_coverage), "Upcoming visits"(my appointments→list_appointments).
  llm: "Which of my providers are in-network?", "Summarize my recent visits", "Do I need a referral for a specialist?".
- [ ] **retail** (checkout/order_status/list_orders/rewards_balance):
  both: "List my orders"(list my orders), "Where's my order?"(order status), "My reward points"(my reward points),
  "Checkout"(checkout), "Order history"(order history→list_orders), "Track my order"(track my order→order_status),
  "Store credit balance"(store credit→rewards_balance).
  llm: "What should I buy with my points?", "Compare my last two orders", "Any deals on what I viewed?".
- [ ] **sporting-goods** (list_gear/list_rentals/gear_order_status/loyalty_balance/extend_rental):
  both: "My gear"(my gear), "My rentals"(my rentals), "Extend my rental"(extend my rental),
  "Order status"(order status→gear_order_status), "My loyalty points"(my loyalty points→loyalty_balance),
  "What's due back?"(due back→list_rentals), "Order history"(order history→list_gear).
  llm: "What gear matches my recent buys?", "Am I close to the next loyalty tier?", "Recommend trail-ready equipment".
- [ ] **workforce** (view_benefits/pto_balance/list_expenses/submit_expense/request_time_off):
  both: "My benefits"(my benefits), "PTO balance"(pto balance), "My expenses"(my expenses),
  "Submit an expense"(submit an expense), "Request time off"(request time off),
  "Sick leave balance"(sick leave balance→pto_balance), "Expense history"(expense history→list_expenses).
  llm: "When should I use my remaining PTO?", "Am I enrolled in the right medical plan?", "Which expenses are still pending approval?".
- [ ] **banking** (legacy, no plugin — uses THEME_VOCAB/banking actions): pick 10 in the same shape
  (7 mapped to existing banking heuristic actions: accounts/balance/transactions/transfer/deposit/withdraw/mortgage;
  3 llm: spend-analysis style). `mode:'both'` for the 7, `'llm'` for the 3. Banking keeps working via THEME_VOCAB.
- [ ] For each: verify the 7 `both` messages route correctly. For plugin verticals,
  `parseHeuristic(msg, id)` → `kind:'vertical'` with the expected action. For the 3 `llm`, confirm
  `parseHeuristic(msg, id)` → `kind:'none'` (no heuristic match → LLM-only as intended).
- [ ] Commit per vertical: `feat(verticals): <id> curated 10 chips (7 heuristic + 3 LLM-only)`.

### E3 — UI renders the curated 10 + gates the LLM-only in Heuristics mode

- [ ] In `BankingChips.jsx`: when `pageManifest.dashboard.chips10` exists, render THOSE 10 (one
  section, themed) instead of the legacy HEURISTIC_CHIPS + llmChipGroups split. Read the current
  agent mode (via `useLangchainProvider()` — `heuristicRouting`/provider). When in Heuristics-only
  mode (`provider == null` / mode `heuristics`), render the `mode:'llm'` chips **disabled/greyed
  with a tooltip** ("Needs an LLM — switch to Helix/Claude mode"); in any LLM-enabled mode, render
  all 10 active. Click routing unchanged: `both` chips send `provider:'heuristic'` (LLM fallback
  still applies in mixed mode); `llm` chips send the active LLM provider.
- [ ] BUILD GATE: `cd demo_api_ui && npm run build` → 0; `npx jest App.structure` green.
- [ ] Test: a focused BankingChips test (or extend existing) — given a manifest with chips10
  incl. 3 `llm`, in heuristics mode the 3 are disabled; in LLM mode all 10 active.
- [ ] Commit: `feat(verticals): render curated 10 chips; gate LLM-only chips in heuristics mode`.

### E4 — user-added chips on the setup page (auto-wired as LLM-only)

**Decision (user, 2026-05-31):** the setup/verticals-admin page can add a chip (label + message) to
the active vertical's `chips10` — auto-wired as `mode:'llm'`. An LLM chip needs NO code (its message
goes to the LLM, which already has the vertical's tool schemas), so it renders + works immediately.
Heuristic (`both`) chips remain curated/code-defined (they need a `getHeuristics()` regex) — the form
does NOT offer to create those.

- [ ] Add a "verticalManifest overlay" write path for chips: the existing verticals-admin route
  (`/api/verticals/*` overlay edits via `verticalManifest.overlay.setField/replaceBatch`) gains the
  ability to append a chip to `dashboard.chips10`. New user chips are forced `mode:'llm'` server-side
  (a user cannot create a heuristic chip — it wouldn't work without code). Validate label+message
  non-empty; generate an id (`user_<n>`).
- [ ] Setup-page UI — **show the existing chips first, then the add form** (user, 2026-05-31):
  Above the "Add a chip" form, render a read-only list of the active vertical's existing `chips10`
  as **`label → message`** (the prompt text each sends), each tagged **heuristic** (`mode:'both'`)
  or **LLM-only** (`mode:'llm'`). This is "show them the ones that exist already and their response"
  = the prompt message each chip sends (NOT a live agent run — static reference so the author sees
  the pattern and avoids duplicating an existing prompt). Then the "Add a chip" form (label +
  message) posts to the route above; on success the SSE `vertical-edited` event refetches the
  manifest so both the existing-list and the dashboard chips update live. Cap user chips (e.g. ≤10
  extra); show user-added chips marked "LLM" alongside the curated 10. Optional future: a per-chip
  "Preview" button that runs the chip and shows the live response — deferred (needs session/LLM).
- [ ] Test: posting a user chip appends it to chips10 overlay with mode:'llm'; it has no heuristic so
  `parseHeuristic(message, vertical)` → kind:'none' (LLM-only, as intended). The existing-chips list
  renders each chip's label + message + mode tag. Build gate + App.structure.
- [ ] Commit: `feat(verticals): setup-page user chips — list existing (label→message) + add form, auto-wired LLM-only`.

### E5 — verify + tidy
- [ ] Confirm each vertical shows exactly 10 curated chips (+ any user-added LLM chips); the LLM-only
  chips are visually distinct/gated in Heuristics mode and active in LLM mode. Live smoke if a session.
- [ ] (Optional cleanup) once chips10 is the source, the legacy `llmChipGroups` can be removed from
  the 5 manifests — defer if risky; chips10 takes precedence in the UI regardless.

## Done-Criteria
1. retail, sporting-goods, workforce each report `plugin`; banking still `legacy`.
2. Each has a real domain schema (orders/rentals/benefits/expenses), own tools incl. a novel action, render descriptors, authz on write actions.
3. Per-vertical no-fallback assertions pass.
4. `nlIntentParser.chipFull` retail+sporting blocks updated to plugin routing; no banking leakage.
5. Each vertical exposes exactly 10 themed chips (7 heuristic-backed + 3 LLM-only); the 3 LLM-only
   are gated in Heuristics mode and the 7 route correctly to plugin actions.
6. No new failures vs baseline. UI build exits 0; `App.structure` green.
