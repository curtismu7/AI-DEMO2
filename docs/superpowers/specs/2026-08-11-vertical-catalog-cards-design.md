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

**`productGrid`** (sporting-goods products, banking branches — same shape,
different field semantics):
```json
{
  "type": "productGrid",
  "title": "Gear for Your Next Hike",
  "action": { "label": "Add to Cart", "tool": "add_to_cart" },
  "fields": { "image": "icon", "price": "price", "priceWas": "priceWas",
              "title": "name", "meta": ["rating", "stock"] }
}
```
Banking's branch grid uses the same type with `action.kind: "link"` instead
of a tool — the button is `<a href={branch.mapUrl}>` (fake Google Maps
search URL, `target="_blank" rel="noopener"`), not a store write. No
`priceWas`; the price slot shows open/closed status instead (already how the
mockup renders it).

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

## Backend — one new tool + one mutating tool per vertical

Following the existing `execute()` switch + per-user store pattern
(`sporting-goods/data.js` today has orders/rentals/loyalty; this adds a
sibling collection, not a rename of those).

| Vertical | Store addition | Read tool | Write tool | Write effect |
|---|---|---|---|---|
| sporting-goods | `products` (seed), `cart` (per-user) | `browse_gear(category?)` | `add_to_cart(productId)` | pushes into `cart[]` |
| airlines | `seats` (seed, per-flight) | `browse_seats(flightId?)` | `select_seat(seatId)` | flips that seat to `status:'selected'`, clears any other `selected` seat for the user |
| banking | `branches` (seed, static — not per-user) | `find_branches(zip?)` | — (link only, no write tool) | n/a |

Airlines currently has no `data.js`/store — this pass adds a minimal one
(`createAirlinesStore`), same shape as sporting-goods', scoped to only what
seat selection needs. It does not touch airlines' existing manifest/index
wiring beyond registering the new tools.

Chip entries: one new fallback-chip per vertical (`fallback-chips/sporting-goods.js`
already exists, add one entry; airlines and banking get theirs added the
same way), e.g. `{ label: 'Find hiking gear', message: 'I need gear for a
hiking trip', tool: 'browse_gear' }`. Mirrors the existing chip shape
exactly — no new chip infrastructure.

## Mock data

Small, hand-written seed lists (6 items each), matching the mockup's exact
sample content:
- sporting-goods: the 6 products from the mockup (boots, backpack, poles,
  bottle, tent, base layer) with price/rating/stock.
- airlines: one flight, 8 rows × 6 seats (2 business + 1 premium row + 5
  economy rows), matching the mockup's seed pattern (a couple pre-occupied).
- banking: the 6 branches from the mockup (name, address, distance, hours,
  fake maps URL built as `https://www.google.com/maps/search/?api=1&query=<encoded address>`).

## Testing

- Vitest: one render test per new component (`ProductCardGrid`, `SeatMapPanel`)
  asserting card/seat content renders and the action button fires the right
  tool call or link.
- Jest (`demo_api_server`): one test per new/changed tool (`browse_gear`,
  `add_to_cart`, `browse_seats`, `select_seat`, `find_branches`) covering the
  happy path and the "not found" error path, following the existing
  cancel_order-style test pattern for that vertical.
- Manual: exercise all three chips in the running demo, confirm cards render
  at the sizes/icons from the approved mockup and the seat chart's summary
  bar updates on click.

## Out of scope (this pass)

- The other 13 verticals.
- Real photography (icons stay hand-drawn SVG, per the mockup).
- A real shopping cart UI (the `cart` store just needs to exist and be
  mutated — no cart page/checkout).
- Any change to how the manifest render pipeline, chip dispatch, or MCP tool
  execution works — this only adds leaves to those existing systems.
