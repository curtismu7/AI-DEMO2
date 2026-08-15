# Admin Support Console — design

**Date:** 2026-08-08
**Status:** approved, ready for implementation planning
**Branch:** `worktree-support-console-spec`

## Problem

`/admin` is not a customer-support console. It is a platform/dev-ops home wearing
the word "admin": a token-chain rail, a PingOne group-membership toggle, banking-only
KPIs, a 24-hour HTTP activity log, and Export seed / Save seed / Reset demo buttons.
The embedded agent on that route is hard-forced to the `pingone-admin` vertical.

A customer-support console does exist — `VerticalOpsConsole` at
`/admin/<vertical>` — but it was sidelined behind a sub-nav section, covers 5 of the
14 verticals, and has none of what makes support work believable: no identity
verification of the caller, no statement of what the operator is allowed to do, no
case notes, no audit of what the operator did.

The demo's central claim is that an operator acts **on behalf of** a customer under a
delegated, provable token (RFC 8693 `act`). The support desk is the most natural
place in the product to show that, and today it shows none of it.

## Decisions taken

| Decision | Choice |
|---|---|
| UI shape | **Option A — Case Workspace**: queue rail, customer 360, identity-evidence rail |
| Routing | `/admin` **becomes** the support console; platform admin moves to `/admin/pingone` |
| Phase 0 deletions | Delete the 4 unrouted components; **keep** the duplicate lookup block until Phase 3 |
| Identity gate | **Enforced server-side**, not cosmetic |

## Current state — verified findings

### Routes and components

- `/admin` renders `demo_api_ui/src/components/Dashboard.js` (`App.js:994`).
- The global `<AIAgent>` receives `forceVertical: "pingone-admin"` when
  `isPingOneAdminAgentRoute(pathname)` is true; that helper returns true for
  exactly `/admin` (`demo_api_ui/src/utils/embeddedAgentFabVisibility.js:20`).
- `/admin/banking`, `/admin/healthcare`, `/admin/retail`, `/admin/sporting-goods`,
  `/admin/workforce` render `VerticalOpsConsole` through five one-line wrappers
  (`BankingAdminOps.js` and siblings), linked from `AdminSideNav.jsx:707`.
- Those five routes are **not** wrapped in `RequireAdminLogin`
  (`App.js:1001-1045`); `/admin`, `/admin/vault` and `/admin/verticals` are.

### Duplication and dead code

| Item | Location |
|---|---|
| Two customer lookups on one page | `<AdminCustomerPanel>` (`Dashboard.js:654`) and an inline "Customer lookup" section (`Dashboard.js:655-1000`, ~345 lines) — both search a user and render profile, accounts, transactions |
| Unrouted, zero importers | `Admin.jsx` + `Admin.css`, `OAuthHealthDashboard.jsx`, `AdminConfigValidationPanel.jsx` + `.css` |
| Vertical parity | 5 ops consoles against 14 directories in `demo_api_server/config/verticals/` — missing airlines, investment, university, government, manufacturing, abercrombie-fitch |
| Emoji outside the REGRESSION_PLAN §0 allowlist | ~24 in `verticalOpsConfig.js` |
| Inline style objects | ~200 lines in `Dashboard.js` |

### Reusable primitives already in the repo

- `routes/adminVerticals.js` — per-vertical `GET /<vertical>/lookup?q=` returning
  `{ user, query, vertical, data }`, plus write actions guarded by `ADMIN_WRITE`.
- `req.session.stepUpVerified` — an expiry timestamp set on MFA completion in
  `routes/mfa.js` and `routes/ciba.js`, consumed single-use in `routes/transactions.js`.
- `routes/ciba.js` — push-to-the-customer's-device approval.
- `routes/agentAuthorization.js` — grant/revoke the PingOne `mayAct` attribute that
  makes PingOne emit the `act` claim during token exchange.
- `TokenChainTraceRail.jsx`, `TokenChainContext.js`, `OtpStepUpModal.js`,
  `DraggableModal`, `bffAxios`, `appToast`.

## Target architecture

`VerticalOpsConsole` grows into the Case Workspace rather than being rewritten — it
already owns lookup, per-vertical actions and the record drawer. New home:
`demo_api_ui/src/components/supportConsole/`.

### Components

| Component | Responsibility | Depends on |
|---|---|---|
| `SupportConsole.jsx` | Three-pane frame. Owns selected customer, active vertical, verification state, and the lookup call. | `supportConsoleConfig`, `bffAxios` |
| `SupportQueueRail.jsx` | Search box plus work queue list; selecting an item sets the console's customer. | `cfg.queue` |
| `CustomerSummary.jsx` | Name, tier, contact, stat row. Presentational. | `customer` prop |
| `IdentityGate.jsx` | Verified / not-verified strip. Starts customer verification, exposes `verifiedUntil`. | `OtpStepUpModal`, `/api/admin/<vertical>/verify/*` |
| `RecordTabs.jsx` | Overview / Records / Cases / Activity tab bar. Presentational. | — |
| `RecordCategoryCard.jsx` | One category card with rows and per-row action buttons; each button carries its permission state. | `cfg.permissions` |
| `CaseNotes.jsx` | Notes list plus composer. | `/api/admin/<vertical>/cases/:userId/notes` |
| `IdentityEvidenceRail.jsx` | Acting-as, Permitted actions, Token chain, Operator audit. | `TokenChainContext`, `/api/agent-authorization/status`, `/api/admin/<vertical>/audit` |
| `RecordDrawer.jsx` | Unchanged, moved with the directory. | — |
| `supportConsoleConfig.js` | `verticalOpsConfig.js` plus four new per-vertical keys. | — |

Each component takes props and returns markup; only `SupportConsole.jsx` holds state
and issues network calls, so the rest are unit-testable without mocking HTTP.

### Config contract

`supportConsoleConfig.js` keeps every existing key (`id`, `name`, `theme`,
`lookupPath`, `lookupPlaceholder`, `actions`, `adaptLookup`) and adds four. Paths
below are written for the sporting-goods entry; each vertical hardcodes its own, the
way `lookupPath` already does.

```js
queue: {
  path: '/api/admin/sporting-goods/queue',
  adapt: (resp) => [{ id, customerId, title, sub, tone, badge }],
},

identityActions: [
  { id: 'reset-password', label: 'Reset password', method: 'post',
    buildUrl: (c) => `/api/admin/sporting-goods/identity/${c.id}/reset-password`,
    permission: 'identity:write' },
  // unlock-account, remove-passkey follow the same shape
],

permissions: {
  'Refund':          { scope: 'orders:refund', gate: 'verified', limit: 250 },
  'Cancel order':    { scope: 'orders:write',  gate: 'verified' },
  'Reset password':  { scope: 'identity:write', gate: 'verified' },
  'View card number':{ scope: 'pan:read',      gate: 'never' },
},

caseSource: { path: '/api/admin/sporting-goods/cases' },
```

`gate` values: `'none'` (allowed whenever the scope is present), `'verified'`
(requires a live customer verification), `'approval'` (requires a supervisor or
customer approval), `'never'` (statically denied).

`'never'` is static config, not role-derived. The application has a single admin role
today (`user.role === 'admin'`); introducing operator tiers is a separate change, and
this spec does not assume one.

**Invariant:** every key in `cfg.permissions` must match a key in `cfg.actions` or an
`identityActions[].label`. An action with no permission entry is a bug, not an
implicit allow — the UI renders it disabled and a unit test enforces the match.

Adding a vertical means adding a config entry and the matching route slices — no new
components.

## Data flow

### Lookup — unchanged

`GET /api/admin/<vertical>/lookup?q=` → `cfg.adaptLookup(resp)` → `{ customer, categories }`.

### Queue — derived, no new store

`GET /api/admin/<vertical>/queue` is a projection over the vertical's existing
slices, not a new data source. Each vertical declares which record states count as
open work; the route walks the demo users it already lists in `listLookupUsers` and
emits one row per matching record:

| Vertical | Rows come from |
|---|---|
| sporting-goods | orders with a refund request, rentals past due, unresolved tickets |
| banking | accounts flagged for review, disputed transactions |
| healthcare | unpaid bills, medications needing refill, pending referrals |
| retail | pending returns, unresolved tickets |
| workforce | expenses awaiting approval, open IT tickets |

Consequence: the queue can never drift from the records, and a vertical with no open
records renders an honest empty queue rather than fixture noise.

### Identity verification — enforced

Verification is of the **customer**, not the operator. It is deliberately kept
distinct from `req.session.stepUpVerified`, which records that the *operator* passed
MFA — cross-crediting the two would let an operator's own MFA unlock writes against
any customer.

**Client:** `IdentityGate` calls `POST /api/admin/<vertical>/verify/initiate`
with `{ customerId, channel }`, then polls
`GET /api/admin/<vertical>/verify/status?customerId=`. The underlying challenge
reuses whatever `routes/ciba.js` already does in this environment; this spec adds no
new PingOne provisioning.

**Server:** on a completed challenge, `routes/adminVerticals.js` writes

```js
req.session.supportVerified = req.session.supportVerified || {};
req.session.supportVerified[customerId] = Date.now() + SUPPORT_VERIFY_TTL_MS;
```

`SUPPORT_VERIFY_TTL_MS` is 15 minutes, defined in `routes/adminVerticals.js`.

**Enforcement:** a new `requireCustomerVerified` middleware in
`demo_api_server/middleware/` is applied to every write route in
`adminVerticals.js` whose config `gate` is `'verified'`. It resolves the customer id
from the route params or body, and rejects with

```js
res.status(403).json({ error: 'customer_not_verified', customerId, need_verification: true });
```

when `req.session.supportVerified?.[customerId]` is absent or in the past. Unlike
`transactions.js`, verification is **not** consumed single-use — a support call
legitimately performs several writes inside one verified window; the TTL is the
bound.

The `403 / customer_not_verified` response is the revert-to-RED proof: disable the
middleware and the corresponding test must fail.

### Permitted actions

Derived, not fetched. `SupportConsole` reads the operator's session scopes from the
existing session-token context and crosses them with `cfg.permissions`. Each action
resolves to one of `allowed`, `verify-first`, `approval`, `denied`, which drives both
the button state and the rail's permission table. No new authorization endpoint in
this phase; the table states what the operator's token actually carries rather than
guessing at a policy decision.

### Acting as

`GET /api/agent-authorization/status` supplies the `mayAct` grant state.
`TokenChainContext` supplies the `act` claim, hop list and expiry already rendered by
`TokenChainTraceRail`. The rail composes both; it introduces no new network call.

### Case notes and operator audit

New in-memory store in `routes/adminVerticals.js`, keyed by `<vertical>:<customerId>`,
same lifetime as the other demo stores:

```text
GET  /api/admin/<vertical>/cases/:customerId/notes  -> { user, vertical, data: { notes } }
POST /api/admin/<vertical>/cases/:customerId/notes  -> { data: { note } }
GET  /api/admin/<vertical>/audit?customerId=        -> { data: { entries } }
```

Every write action already routed through `adminVerticals.js` appends an audit entry
`{ at, operator, action, customerId, outcome }`. Denied attempts are recorded with
`outcome: 'denied'` — a denial that leaves no trace is worse than no audit at all.

Responses use `{ error }` on failure, per the BFF convention.

## Routing

```text
/admin             -> SupportConsole, active vertical     [RequireAdminLogin]
/admin/pingone     -> today's Dashboard.js content        [RequireAdminLogin]
/admin/<vertical>  -> SupportConsole, vertical pinned     [RequireAdminLogin]
```

- `isPingOneAdminAgentRoute` returns true for `/admin/pingone` instead of `/admin`,
  carrying `forceVertical: "pingone-admin"` with it.
- `AdminSideNav.jsx` — the "Industry Verticals" section repoints at the console; a new
  "Platform Admin" entry targets `/admin/pingone`.
- `DashboardQuickNav.js:48` and `embeddedAgentFabVisibility.js:75` both hardcode
  `/admin/banking`; both are updated in the same change.
- New `<Route>` elements go inline in the existing admin block in `App.js` — React
  Router v6 requires them as direct children of `<Routes>`, per the comment at
  `App.js:983`.

## Conventions

Non-negotiable, inherited from the project instructions:

- `bffAxios` / `apiClient` for HTTP — never bare `axios`.
- `notifySuccess` / `notifyError` from `utils/appToast` — never `react-toastify` directly.
- `DraggableModal` for panels, `ConfirmModal` for yes/no — never a hand-rolled overlay.
- Emoji restricted to the REGRESSION_PLAN §0 allowlist: ⚠️ ✅ ❌ 🔐 ✕ ✓ 👤 🔑 🪟 📚.
  Everything else becomes CSS or semantic markup. This applies to the migrated
  `verticalOpsConfig.js` icons.
- Server code is CommonJS; error bodies are `{ error }`; upstream failures pass
  through `normalizeAxiosError`.
- Styling lives in a co-located `.css` file, not inline style objects.

## Error handling

| Case | Behaviour |
|---|---|
| Lookup 401 | `notifyError('Session expired — please sign in again.')`, clear result |
| Lookup miss | Empty state in the centre pane, queue rail unaffected |
| Write 403 `customer_not_verified` | Toast plus the identity strip flips to unverified and offers to re-verify |
| Write 403 other | Toast with the server's `error` string; audit entry recorded as denied |
| Verification timeout | Strip returns to unverified with a Retry action |
| Queue or audit fetch failure | That card shows an inline retry; the console stays usable |

## Testing

**UI — vitest** (`cd demo_api_ui && npm run test:unit`)

1. `SupportConsole` renders all three panes and calls the vertical's `lookupPath` once.
2. With `verifiedUntil` in the past, every action whose `gate` is `'verified'` renders
   disabled; with it in the future, they render enabled.
3. Actions whose `gate` is `'never'` render disabled in both states.
4. Permission resolution maps (scope present/absent × gate) to the four states.
5. Config parity: every id in `VERTICAL_ORDER` has `queue`, `identityActions`,
   `permissions` and `caseSource`.
6. Emoji allowlist check over `supportConsoleConfig.js`.
7. `App.structure.test.js` smoke for `/admin` and `/admin/pingone`.

**Server — jest** (`cd demo_api_server && CI=true npm test -- --forceExit`)

8. Extend `tests/adminVerticals.route.test.js`: a gated write without verification
   returns `403 customer_not_verified`; after a completed verification it succeeds;
   after `SUPPORT_VERIFY_TTL_MS` it returns 403 again.
9. Verifying customer A does not unlock writes against customer B.
10. `req.session.stepUpVerified` alone does not satisfy `requireCustomerVerified`.
11. Notes round-trip; audit records both a success and a denial.
12. The queue projection returns a row for a record in an open state and drops it once
    that record is actioned — proving the queue is derived, not a separate fixture.

**Revert-to-RED proof:** removing `requireCustomerVerified` from the write routes must
turn tests 8, 9 and 10 red. A green suite with the middleware removed means the gate
is cosmetic and the phase is not done.

**Gate before any phase is called complete:** `npm run test:unit && npm run build` in
`demo_api_ui`, and `CI=true npm test -- --forceExit` in `demo_api_server`, with the
result line pasted.

## Phases

Each phase is independently shippable and leaves `/admin` working.

**Phase 0 — cleanup, no behaviour change.**
Delete `Admin.jsx` + `Admin.css`, `OAuthHealthDashboard.jsx`,
`AdminConfigValidationPanel.jsx` + `.css`. Wrap the five vertical-ops routes in
`RequireAdminLogin`. Replace non-allowlist emoji with CSS or text marks. The
duplicate lookup block in `Dashboard.js` stays until Phase 3.

**Phase 1 — centre pane.**
Move `verticalOps/` to `supportConsole/`. Extract `RecordCategoryCard`,
`CustomerSummary`. Add `IdentityGate` plus the server-side `requireCustomerVerified`
enforcement, permission badges, the account-and-sign-in card, and `CaseNotes`.
Ships on `/admin/<vertical>` with no routing change.

**Phase 2 — vertical parity.**
Config entries and `adminVerticals.js` slices for airlines, investment, university,
government, manufacturing, abercrombie-fitch. Super Sports stays the default demo
vertical.

**Phase 3 — full Case Workspace.**
Add `SupportQueueRail` and `IdentityEvidenceRail`. Repoint `/admin`, create
`/admin/pingone`, move `forceVertical`, update `AdminSideNav`, `DashboardQuickNav`
and `embeddedAgentFabVisibility`. Delete the duplicate lookup block from
`Dashboard.js` — its replacement is live by this point.

**Phase 4 — agent persona.**
The embedded agent on `/admin` runs the active vertical as a support persona;
`pingone-admin` remains on `/admin/pingone`.

## Out of scope

- A real policy-decision endpoint behind the permission table (Phase 1 derives it
  from token scopes).
- New PingOne CIBA provisioning — verification reuses whatever `routes/ciba.js`
  already does in this environment.
- Persisting case notes or audit beyond process lifetime.
- Any change to customer-facing dashboards (`UserDashboard.js`,
  `UserDashboardPing2026.js`).
