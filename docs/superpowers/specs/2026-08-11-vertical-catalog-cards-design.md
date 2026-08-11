# Vertical catalog cards — design

Status: approved (visual mockup + scope + button semantics confirmed by user
2026-08-11). Scope of THIS pass: **airlines, sporting-goods, banking only**.
The remaining 13 verticals reuse the same component and get their own
chip/tool/seed wiring in follow-up passes — not part of this plan.

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

**`seatMap`**: fixed shape, not field-driven — cabin bands
(business/premium/economy), 3-3 seat grid per row, seat states
(available/selected/occupied), legend, and a summary bar with the
`select_seat` action. One React component (`SeatMapPanel.jsx`), no generic
descriptor fields, because a seat chart isn't a list of items — it's a fixed
layout that colors itself from the tool's row/seat data.

## Frontend

Two new components under `demo_api_ui/src/components/`, styled from the
approved mockup (small square cards, hand-drawn line icons per item type,
`Fraunces`/`Inter`/`IBM Plex Mono` — matching `v2-global-theme.css` tokens
rather than the mockup's standalone palette):

- **`ProductCardGrid.jsx`** — takes `descriptor` + `data` (array), renders
  the square-card grid, calls the vertical's tool (or renders the link) on
  the card button. Shared by sporting-goods and banking.
- **`SeatMapPanel.jsx`** — takes the seat-map result shape, renders the
  chart + summary bar, calls `select_seat` on the summary button.

`VerticalResult.jsx` grows two branches (`productGrid`, `seatMap`) alongside
its existing `card`/`fieldList`/`table`/`token` branches.

## Backend — one new tool + one mutating tool per vertical (products/seats only)

Following the existing `execute()` switch + per-user store pattern
(`sporting-goods/data.js` today has orders/rentals/loyalty; this adds a
sibling collection, not a rename of those). Locations/branches need no new
backend tool — see above, it's a dispatch fix + render wiring on data that
already exists.

| Vertical | Store addition | Read tool | Write tool | Write effect |
|---|---|---|---|---|
| sporting-goods | `products` (seed), `cart` (per-user) | `browse_gear(category?)` | `add_to_cart(productId)` | pushes into `cart[]` |
| airlines | `seats` (seed, per-flight) | `browse_seats(flightId?)` | `select_seat(seatId)` | flips that seat to `status:'selected'`, clears any other `selected` seat for the user |

Airlines currently has no `data.js`/store — this pass adds a minimal one
(`createAirlinesStore`), same shape as sporting-goods', scoped to only what
seat selection needs. It does not touch airlines' existing manifest/index
wiring beyond registering the new tools.

Chip entries: one new fallback-chip for sporting-goods
(`fallback-chips/sporting-goods.js` already exists, add one entry) and one
for airlines (new `fallback-chips/airlines.js`, registered in `loader.js`).
Locations needs no chip — it's reached by typing (e.g. "branches near me",
"clinics near me"), matching the existing NL-only UC24 design.

## Mock data

Small, hand-written seed lists (6 items each), matching the mockup's exact
sample content:
- sporting-goods: the 6 products from the mockup (boots, backpack, poles,
  bottle, tent, base layer) with price/rating/stock.
- airlines: one flight, 8 rows × 6 seats (2 business + 1 premium row + 5
  economy rows), matching the mockup's seed pattern (a couple pre-occupied).
- locations: none needed — `publicBranchCatalog.js` already has real seed
  data for all 11 verticals.

## Testing

- Vitest: one render test per new component (`ProductCardGrid` in both
  `kind="products"` and `kind="locations"` modes, `SeatMapPanel`) asserting
  card/seat content renders and the action button fires the right tool call
  or link; one test covering the `branch_hours` `runAction` wiring (mirrors
  the existing `weather`-action test, if one exists — check
  `AIAgent.*.test.js` for a `weather` case to follow) so "Unknown action:
  branch_hours" can't regress silently.
- Jest (`demo_api_server`): one test per new/changed tool (`browse_gear`,
  `add_to_cart`, `browse_seats`, `select_seat`) covering the happy path and
  the "not found" error path, following the existing cancel_order-style test
  pattern for that vertical.
- Manual: exercise the sporting-goods and airlines chips, and type "branches
  near me" while on banking/healthcare/sporting-goods to confirm the fix
  covers more than one vertical; confirm cards render at the sizes/icons
  from the approved mockup and the seat chart's summary bar updates on
  click.

## Out of scope (this pass)

- Product/seat catalogs for the other 14 verticals (locations already covers
  11 of them for free, per above).
- Real photography (icons stay hand-drawn SVG, per the mockup).
- A real shopping cart UI (the `cart` store just needs to exist and be
  mutated — no cart page/checkout).
- Any change to how the manifest render pipeline, chip dispatch, or MCP tool
  execution works — this only adds leaves to those existing systems.
