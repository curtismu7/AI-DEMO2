# Great Buy (Retail) — Real E2E Chip Pipeline Report — 2026-06-12

**Tested by:** Claude Code, authenticated as `demoUser` via **real PingOne OAuth**
(env `d02d2305-…`, password flow) against the **live k8s BFF** at
`https://api.ping.demo:3001` (svc/banking-api-server, namespace `ai-demo`).
**Auth:** session cookie (`connect.sid`); admin corroboration as `demoAdmin`.

## What "full path" means here

Each `both`-mode chip was driven end-to-end:

1. **Routing** — `POST /api/banking-agent/nl` (`provider:heuristic`) → `{source, result.kind, result.action}`.
2. **Full pipeline** — `POST /api/agent/invoke` → executes the vertical tool through
   **RFC 8693 token exchange → MCP gateway → MCP server → vertical handler**, returning
   `toolsCalled`, `tokenEvents` (the token chain), and the rendered reply.
3. **Corroboration** — admin `GET /api/admin/app-events` confirms `agent` / `token_exchange`
   pipeline categories in the chip's time window.

`llm`-mode chips were driven via `/api/banking-agent/nl` with `provider:auto` (heuristic
returns `kind:none`, so Helix routes them) — this is the real UI's chip path
(`BankingAgent.js` → `/api/banking-agent/nl`).

`hasExchange` = an RFC 8693 exchange event is present in the token chain (skip-proof:
proves the BFF actually drove the pipeline, not a canned reply).

---

## Great Buy results — 10 chips

### `both`-mode (routing + full MCP pipeline)

| ID | Label | Message | Routed action | Tool executed | Exchange | Result | Verdict |
|---|---|---|---|---|---|---|---|
| rt1 | List my orders | `list my orders` | `list_orders` | `list_orders` | ✅ | "Here are your Activity (6 total)." | ✅ PASS |
| rt2 | Where's my order? | `order status` | `order_status` | — | ❌ | "To order status, I need: Order ID…" | ❌ **F1** |
| rt3 | My reward points | `my reward points` | `rewards_balance` | `rewards_balance` | ✅ | "Your Balance: 4820" | ✅ PASS |
| rt4 | Checkout | `checkout` | `checkout` | — | ❌ | "To checkout, I need: Product, Amount…" | ⚠️ F3 (write, by-design) |
| rt5 | Order history | `order history` | `list_orders` | `list_orders` | ✅ | "Here are your Activity (6 total)." | ✅ PASS |
| rt6 | Track my order | `track my order` | `order_status` | — | ❌ | "To order status, I need: Order ID…" | ❌ **F1** |
| rt7 | Store credit balance | `store credit balance` | `rewards_balance` | `rewards_balance` | ✅ | "Your Balance: 4820" | ✅ PASS |

### `llm`-mode (Helix routing)

| ID | Label | Message | Source | Reply | Verdict |
|---|---|---|---|---|---|
| rt8 | What should I buy with my points? | (same) | `helix_fallback` | Helix advisory answer (non-empty) | ✅ PASS |
| rt9 | Compare my last two orders | `Compare my recent purchases side by side` | `helix` | (see F2) | ⚠️ F2 |
| rt10 | Any deals on what I viewed? | (same) | `helix` (kind:banking) | **empty string** — chip renders blank | ❌ **F2** |

**Score:** routing 10/10 ✅ · full-pipeline execution 4/7 `both` chips ✅
(3 blocked: rt2/rt6 by F1, rt4 by-design) · `llm` 1–2/3 depending on Helix output.

---

## Findings

### F1 — `order_status` one-click chips dead-end demanding an Order ID  · **Severity: High · Shared (cross-vertical)**

"Where's my order?" (rt2) and "Track my order" (rt6) are one-click chips, but both
route to `order_status`, whose input schema marks `orderId` **required**. The
parameter-gatherer ([`demoAgentLangGraphService.js:680`](../demo_api_server/services/demoAgentLangGraphService.js#L680))
sees `orderId` missing and replies *"To order status, I need: Order ID. Please provide
this detail."* — so the chip never executes a tool and never drives the pipeline.

Every other **read** chip in the vertical (`list_orders`, `rewards_balance`) one-click
executes. `order_status` is the lone read action that demands typed input — an
inconsistency, and a poor demo experience for a chip literally labeled "Track my order".

**Root cause — two source-of-truth copies, both `required:['orderId']`:**
- BFF tool def: [`config/verticals/retail/tools.js:12`](../demo_api_server/config/verticals/retail/tools.js#L12) + handler L25–28
- MCP registry mirror: [`demo_mcp_server/src/tools/handlers/verticalHandlers.ts:57`](../demo_mcp_server/src/tools/handlers/verticalHandlers.ts#L57)

**Same bug in another vertical (the "fix in other verticals" case):**
Sporting Goods `gear_order_status` is identical —
[`config/verticals/sporting-goods/tools.js:30`](../demo_api_server/config/verticals/sporting-goods/tools.js#L30) (`required:['orderId']`)
and [`verticalHandlers.ts:64`](../demo_mcp_server/src/tools/handlers/verticalHandlers.ts#L64).
Its chip "Track my order" (sg4) dead-ends the same way.

**Fix (two parts):**
1. Make `orderId` optional; when absent, default to the customer's most recent order
   (retail + sporting-goods handlers, mirrored in the MCP registry).
2. Exposed sub-bug: the reply summarizer lumped the single-order **card** render in
   with the `list_orders` **table** and counted it as a collection → "…(0 total)".
   Gave `order_status`/`gear_order_status` their own single-order summary
   ([`demoAgentLangGraphService.js:549`](../demo_api_server/services/demoAgentLangGraphService.js#L549)).
   (Latent before this fix — chips never reached execution to expose it.)

**Live verification (after deploy to k8s `ai-demo`):**
| Chip | Before | After (live) |
|---|---|---|
| rt2 "Where's my order?" | "To order status, I need: Order ID…" (no tool) | **"Your AirPods Pro is Delivered."** · `order_status` executed · RFC 8693 exchange ✅ |
| rt6 "Track my order" | same dead-end | **"Your AirPods Pro is Delivered."** ✅ |
| sg4 "Order status" (sporting) | dead-end | **"Your Nike Pegasus 41 is Delivered."** · `gear_order_status` executed ✅ |

### F2 — empty agent bubble on conversational LLM answers  · **Severity: Low · Mostly a harness artifact**

**Correction after deeper testing:** the empty reply I first saw came from driving the
chip via `/api/agent/invoke` *without a provider* — **not** the UI's chip path. On the
real path (`/api/banking-agent/nl` + `auto`), "Any deals on what I viewed?" routes
correctly every time — across 6 runs: `web_search` (×2), `list_orders` (×1), and an
`education` answer with text (×3); **never an empty bubble**. So F2 as originally
written is not a reproducible user-facing bug.

**Residual real risk (guarded):** the conversational helpers
(`answerWithHelix/Claude/LmStudio`) return their result whenever `if (answer)` is
truthy — but a whitespace-only answer (`"  "`, `"\n"`) is truthy and renders as a
**blank bubble**. Added a defensive normalizer `ensureRenderableAnswer`
([`geminiNlIntent.js`](../demo_api_server/services/geminiNlIntent.js)): an `education`
result with empty/whitespace `message` is replaced with a friendly fallback. It never
touches actionable (`banking`/`vertical`) results or non-empty answers. Unit-tested
(6 cases). Not redeployed on its own (the empty path can't be triggered live to
verify); ships with the next banking-api-server deploy.

### F3 — `checkout` chip asks for Product + Amount  · **Severity: Low · By-design**

"Checkout" (rt4) routes to `checkout` (a `write` action with `consent:true`) and asks
for Product + Amount. Asking for parameters on a write/consent action is correct
behavior; noted only as weak one-click demo UX (a pre-filled sample cart would demo
better). **No change.**

---

## Non-findings / confirmed-correct

- RFC 8693 token exchange fires for every executing read chip (`tokenEvents` ≈ 18 events,
  `hasExchange:true`) — full pipeline confirmed live, not canned.
- Vertical switch to `retail` returns 204 and `/api/verticals/me` resolves Great Buy.
- The banking-only "I can help with…" fallback menu only appears via `/api/agent/invoke`
  with no LLM routing — **not** the UI's chip path, so it is not user-facing here.

## Cross-vertical context (for the shared fix)

Across banking/healthcare/retail/sporting-goods/workforce, the only **read** chips that
dead-end on a required param are `order_status` (retail) and `gear_order_status`
(sporting-goods). All other no-tool chips are `write`/consent actions (transfer,
deposit, withdraw, checkout, book_appointment, submit_expense, request_time_off) where
parameter-gathering is correct.

## Fixes applied

See branch `worktree-fix+order-status-chip-no-id`. F1 fixed in retail + sporting-goods
(BFF tool defs + handlers) and mirrored in the MCP server registry.

> **Live verification caveat:** the BFF and MCP server run in k8s; this fix is verified
> by unit tests + TS build locally. Re-running the live e2e against the cluster requires
> redeploying the `banking-api-server` and `mcp-server` images.
