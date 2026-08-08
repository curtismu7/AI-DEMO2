# Admin Support Console — Phase 2 design (vertical parity)

Extends [`2026-08-08-admin-support-console-design.md`](2026-08-08-admin-support-console-design.md).
Phase 1 shipped in PR #1473; this phase adds verticals to the console it built.

## Scope

Five verticals gain a support console: **university, government, manufacturing,
investment, abercrombie-fitch**. Super Sports stays the default demo vertical.

**Airlines is deferred to its own phase.** Its plugin header states it "owns NO
local data store" — its four tools are answered by `demo_mcp_resource_server`
out of SQLite, over BFF → mcp-gateway (RFC 8693 exchange) → resource server.
`lookupAction` is built on `plugin.getDataStore().get(userId)` and cannot reach
it. Giving airlines a console means an MCP-mediated lookup that crosses the
token-exchange chain — a different problem from adding a config entry, and it
touches protected auth territory. It gets its own spec.

## What already works

No plugin changes are needed. All five verticals expose `getDataStore()` — four
via `shared/createVerticalPlugin.js:35`, abercrombie-fitch directly — and every
store answers `.get(userId)` with slice keys. This phase is config, route
registration and page wrappers only; no new server machinery.

## Per-vertical surface

Existing consoles render five category cards. University and government seed
fourteen slices each, so the sets below are curated to what a support operator
would act on, not a dump of the seed.

| Vertical | Cards | Actions (scope, gate) |
|---|---|---|
| university | `courses`, `billing`, `holds`, `financial_aid`, `enrollmentHistory` | none — read-only |
| government | `permits`, `payments`, `filings`, `inspections`, `recordsRequests` | Release record (`sensitive:read`, approval) |
| manufacturing | `workOrders`, `maintenanceTickets`, `shipments`, `qualityInspections`, `purchaseOrders` | Release work order (`general:write`, verified) |
| investment | `portfolios`, `holdings`, `trades`, `dividends` | none — read-only |
| abercrombie-fitch | `orders`, `returns`, `support_tickets`, `rewards`, `gift_cards` | none — read-only |

Investment's `profile` slice becomes the customer summary rather than a card.

### Only array-valued slices are cards

`government.fees` and `manufacturing.inventory` are objects, not lists, and
render nothing useful in a row list. They are replaced by `payments` and
`purchaseOrders`. Every one of the 24 slice keys above was verified against the
live store before being written into config.

### Why only two write actions

`writeAction` calls `store[method](userId, rowId)`. The Phase 1 verticals define
mutators to match — `cancelAppointment(userId, appointmentId)`. The Phase 2
stores are built on `createSeedStore`, whose mutators are shaped
`(data, optionsObject)`, and only two of them take a bare id:

| Mutator | Signature | Exposed |
|---|---|---|
| `government.releaseRecord` | `(data, permitId)` | yes |
| `manufacturing.releaseWorkOrder` | `(data, orderId)` | yes |
| `university.registerCourse` | `(data, { course, title })` | no |
| `university.releaseTranscript` | `(data, { recipient })` | no |
| `government.payFee` | `(data, { amount, permitId })` | no |
| `manufacturing.scheduleRun` | `(data, { workOrder, when })` | no |

The four unexposed ones would receive the row id where they expect an options
object, destructure `undefined`, silently fall back to a default row, and report
success for an action the operator did not ask for. A button that acts on the
wrong record is worse than no button. Exposing them needs a parameter contract
between config and `writeAction` — its own change, not this one.

That leaves university read-only despite having mutators.

### Why investment and abercrombie-fitch are read-only

Abercrombie-fitch has no choice: `createSeedStore` is called with no mutator
map, so the store exposes nothing to write.

Investment does have mutators — `buySecurity`, `sellSecurity`, `deposit`,
`withdraw`, `largeTrade`, `rebalancePortfolio` — and every one of them is a
trade. A support operator executing a withdrawal or a buy on a customer's
account is a different risk class from cancelling an order, and nothing in this
console is designed to authorise it. Exposing them behind `gate: 'approval'`
was considered and rejected: it ships buttons the console can never complete,
which is worse than not offering them.

### Gates on the two exposed actions

`Release record` hands over a government record itself, so it carries
`sensitive:read` + `gate: 'approval'` — matching healthcare's `Release`, the one
Phase 1 action with that posture. `Release work order` is an ordinary shop-floor
operation and takes `general:write` + `gate: 'verified'`.

Every scope name above comes from `demo_api_server/config/scopes.js`. The
vocabulary is coarse and cannot distinguish "release transcript" from "register
course" — `gate` carries that distinction, and a config test fails on any
invented scope.

## Routing

Five new `/admin/<vertical>` routes, each wrapped in `RequireAdminLogin`, plus a
thin page wrapper per vertical matching the existing five.

Side-nav and the `/admin` repoint stay in Phase 3, as the parent spec has them.
The interim state is therefore ten admin console routes reachable by URL but not
advertised in nav. That is deliberate: pulling nav forward would entangle this
phase with Phase 3's `/admin` repoint, and each phase is meant to ship
independently.

## Server

For each of the five: a `GET /<vertical>/lookup` and the existing
`/<vertical>/users` registration, both behind `requireAdmin`. Government and
manufacturing also register their one write route each behind `ADMIN_WRITE`
(`requireAdmin` + `requireCustomerVerified`), so the customer-verification gate
from Phase 1 applies to them unchanged.

The other three register no write routes at all — not a disabled route, no
route. A test asserts the unexposed mutators 404 rather than silently acting.

## Testing

The Phase 1 config test already enforces, for every vertical in
`VERTICAL_ORDER`: no emoji outside the allowlist, icon tokens of one or two
uppercase letters, every declared scope in the real vocabulary, every declared
action carrying a permission entry, and `identityActions` + `caseSource`
present. Those cover the new entries for free once `VERTICAL_ORDER` grows.

Changes needed:

- `has all five verticals in order` becomes ten, in a defined order.
- Server route tests gain lookup coverage for the five, and a case asserting the
  read-only pair register no write routes.
- A case asserting each new vertical's cards match slice keys its store actually
  returns — a typo'd slice key renders an empty card silently, which is the most
  likely mistake in a change shaped like this one.

## Out of scope

- Airlines (above).
- Side-nav, `/admin` repoint, queue and evidence rails — Phase 3.
- Agent persona — Phase 4.
- Any new store mutators. If a vertical's store cannot do it, the console does
  not offer it.
