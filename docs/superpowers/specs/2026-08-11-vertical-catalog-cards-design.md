# Vertical catalog cards — design

Status: pass 1 shipped 2026-08-11 — sporting-goods (product grid + real
cart write via `add_to_cart`/`store.addToCart`), airlines (real seat chart,
read-only/client-side selection — no reservation write), and locations
(fixed for all 11 catalog verticals via `branch_hours`). Deferred:
airlines' seat-reservation write path, and product/seat catalogs for the
other 14 verticals.

Two regressions surfaced and fixed during Task 7 verification, both now
resolved and covered by `topology:verify` (all 8 steps green):
1. `services/verticalManifest/schema.js`'s render-type enum was missing
   `'seatMap'` (added when the airlines manifest gained
   `render.check_seat_availability.type: "seatMap"`), which crashed
   manifest loading for every vertical, not just airlines — fixed.
2. `scope-topology.json`/`intent-topology.json`/`mcp-tool-schemas.json`/
   `docs/scope-topology.md`/`verticalTools.generated.ts` had never been
   regenerated after Task 3 added `add_to_cart`/`browse_gear` — fixed via
   `verticals:gen`/`intents:gen`/`scopes:doc`/`gen:tool-schemas`.

## Problem

The AI Demo Assistant chat has no "browse and pick" response shape. Every
existing chip reply is a table, field list, or plain text (`VerticalResult.jsx`).
A prompt like "I need hiking gear" or "find me a seat" currently has nowhere
good to land. We're adding a shopping-style card-grid reply, matching the
approved mockup: https://claude.ai/code/artifact/883849ca-48f3-43cf-a971-a3a353be5da4

## Render pipeline (existing, reused as-is)

Tool `execute()` returns `{ result, render: '<key>' }` → the manifest's
`render[key]` block supplies a descriptor → `VerticalResult.jsx` switches on
`descriptor.type` to pick a component. This pass adds two new descriptor
types to that switch: `productGrid` and `seatMap`. Everything upstream
(chip dispatch, MCP tool execution, `AIAgent.js` message rendering) is
untouched.

## New descriptor types

**`productGrid`** (sporting-goods products — tool-driven, per the render
pipeline above):
```json
{
  "type": "productGrid",
  "title": "Gear for Your Next Hike",
  "action": { "label": "Add to Cart", "tool": "add_to_cart" },
  "fields": { "image": "icon", "price": "price", "priceWas": "priceWas",
              "title": "name", "meta": ["rating", "stock"] }
}
```

**Locations (branches/clinics/stores/…) — corrected scope, found during
implementation planning:** this is NOT new backend data. `demo_api_server/data/publicBranchCatalog.js`
already has location lists for 11 verticals (banking, healthcare, retail,
abercrombie-fitch, government, university, workforce, sporting-goods,
manufacturing, investment, airlines), served through `dispatchBankingAction`'s
`branch_hours` action (`demoAgentLangGraphService.js:298-311`) — vertical-scoped
already (`demoAgentLangGraphService.js:756-761`), catalogued cross-vertical in
`config/useCases.js:786-818` (UC24 progressive-trust Act 1).

**It's also currently broken**: the NL heuristic parser matches "branches near
me" / "clinics near me" / etc. to `action: "branch_hours"`
(`nlIntentParser.js:998-1017`), but `AIAgent.js`'s `runAction` switch has no
`branch_hours` case, so it falls to `default` and throws `Unknown action:
branch_hours` (`AIAgent.js:4461`) — every version of this prompt errors today
in every vertical. Fixing the dispatch and adding card rendering are the same
piece of work, and because the data and vertical-scoping already exist for 11
verticals, **this fix is not scoped to 3 verticals — it lands for all 11 at
once**, as a side effect of there being exactly one shared code path. Building
a version that artificially only works for airlines/sporting-goods/banking
would mean adding code to restrict it, not less code — not done.

This does NOT use the descriptor/manifest pipeline above (no tool, no
`render` key) — it's a legacy ad-hoc "extra" on the chat message object,
following the existing `verticalResult` convention
(`AIAgent.js:2898-2915`, consumed at `AIAgent.js:10825-10830`). Plan:
1. Wire `branch_hours` in `runAction`, mirroring the existing `weather`
   action's dispatch (`AIAgent.js:6395-6421`) — call `sendAgentMessage` +
   `handleNlResumeResponse` instead of falling to `default`.
2. At `AIAgent.js:6894` (inside `addReplyRespectingGrounding`, the call site
   `handleNlResumeResponse`'s success path reaches), add a
   `locationCardsExtra(response)` helper (parallel to `verticalResultExtra`)
   that returns `{ locationCards: response.branches, locationVertical: response.vertical }`
   when `response.branches` is present.
3. Render `{msg.locationCards && <ProductCardGrid kind="locations" items={msg.locationCards} .../>}`
   near `AIAgent.js:10825`, alongside the existing `msg.verticalResult` block.
4. `ProductCardGrid` gets a `kind` prop (`"products"` | `"locations"`) since
   the two need different field mapping and the locations kind needs no
   `descriptor` (it builds its own card fields from the raw branch shape:
   `name`, `address`, `hours`, `atm`). The maps link is built client-side:
   `` `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(branch.address)}` ``,
   `target="_blank" rel="noopener"` — no backend change for the URL.

**`seatMap`**: fixed shape, not field-driven — cabin bands, 3-3 seat grid per
row, seat states (available/selected/occupied), legend, and a summary bar.
One React component (`SeatMapPanel.jsx`), no generic descriptor fields,
because a seat chart isn't a list of items — it's a fixed layout that colors
itself from the tool's row/seat data.

**Corrected scope, found during implementation planning:** airlines is not a
local-store vertical like sporting-goods — its data is real, in
`demo_mcp_resource_server`'s SQLite `seats` table (`airlinesDb.ts:125-130`,
`listSeats()` at `airlinesDb.ts:312`), reached through the full BFF → gateway
(RFC 8693 exchange) → resource server chain (`airlines/index.js:1-14`
explains this explicitly). The chip ("Available seats" →
`check_seat_availability`, `airlines/manifest.json:117-124`) and the tool
already exist and already return real per-flight seat data — **this pillar
needs no new tool, no new store, no new chip.** The only gap is how the
result renders (today: whatever the generic MCP-result fallback does — to be
confirmed as the first step of that task). Cabin/class (business vs.
premium vs. economy) isn't in the current `Seat` shape (`cabin`, `available`
only per `airlinesDb.ts:47-48`) — `SeatMapPanel` bands seats by whatever
`cabin` values the data actually returns, not the mockup's invented
business/premium/economy split, confirmed against real data in the task
below.

There is no reservation/write function in `airlinesDb.ts` today — adding one
means extending a separate TypeScript service's SQLite schema and MCP tool
surface, confirmed out of proportion for this pass. **Decision: "Select
Seat" is client-side-only for now** — clicking a seat updates the chart/
summary bar in the browser; nothing is persisted. A real
`reserve_seat`/write path is a follow-up, not part of this plan.

## Frontend

Two new components under `demo_api_ui/src/components/`, styled from the
approved mockup (small square cards, hand-drawn line icons per item type,
`Fraunces`/`Inter`/`IBM Plex Mono` — matching `v2-global-theme.css` tokens
rather than the mockup's standalone palette):

- **`ProductCardGrid.jsx`** — takes `descriptor` + `data` (array), renders
  the square-card grid, calls the vertical's tool (or renders the link) on
  the card button. Shared by sporting-goods and banking.
- **`SeatMapPanel.jsx`** — takes the real `check_seat_availability` result
  shape, renders the chart + summary bar. Selecting a seat is local
  component state only (no tool call — see below).

`VerticalResult.jsx` grows two branches (`productGrid`, `seatMap`) alongside
its existing `card`/`fieldList`/`table`/`token` branches.

## Backend — sporting-goods only

Airlines needs zero backend work (chip, tool, real data all already exist —
see above). Locations needs zero new backend work (data already exists; the
fix is frontend dispatch + rendering — see above). Only sporting-goods gets
new backend surface, following the existing `execute()` switch + per-user
store pattern (`sporting-goods/data.js` today has orders/rentals/loyalty;
this adds a sibling collection, not a rename of those):

| Store addition | Read tool | Write tool | Write effect |
|---|---|---|---|
| `products` (seed), `cart` (per-user) | `browse_gear(category?)` | `add_to_cart(productId)` | pushes into `cart[]` |

Chip entry: one new entry in sporting-goods' `chips10`
(`sporting-goods/manifest.json:71`, same array `sg1`/`sg2`/etc. live in) —
e.g. `{ "id": "sg-gear", "label": "Shop hiking gear", "message": "I need
gear for a hiking trip", "tool": "browse_gear", ... }`. No new chip
infrastructure; `fallback-chips/*.js` is a different system (no-match
suggestion chips) and isn't touched.

## Mock data

Sporting-goods only — the 6 products from the mockup (boots, backpack,
poles, bottle, tent, base layer) with price/rating/stock, hand-written into
`seed.json`. Airlines and locations use real existing data, no mock seed
needed.

## Testing

- Vitest: render tests for `ProductCardGrid` (`kind="products"` and
  `kind="locations"` modes) and `SeatMapPanel`, asserting card/seat content
  renders and the action button fires the right tool call, link, or local
  selection; one test covering the `branch_hours` `runAction` wiring (mirror
  the existing `weather`-action test if one exists — check
  `AIAgent.*.test.js` for a `weather` case to follow) so "Unknown action:
  branch_hours" can't regress silently.
- Jest (`demo_api_server`): one test per new sporting-goods tool
  (`browse_gear`, `add_to_cart`) covering the happy path and the "not found"
  error path, following the existing cancel_order-style test pattern for
  that vertical.
- Manual: exercise the new sporting-goods chip and the existing "Available
  seats" airlines chip; type "branches near me" while on banking/healthcare/
  sporting-goods to confirm the locations fix covers more than one vertical;
  confirm cards/seat chart render at the sizes/icons from the approved
  mockup.

## Out of scope (this pass)

- Product/seat catalogs for the other 14 verticals (locations already covers
  11 of them for free, per above).
- Real photography (icons stay hand-drawn SVG, per the mockup).
- A real shopping cart UI (the `cart` store just needs to exist and be
  mutated — no cart page/checkout).
- Any change to how the manifest render pipeline, chip dispatch, or MCP tool
  execution works — this only adds leaves to those existing systems.
