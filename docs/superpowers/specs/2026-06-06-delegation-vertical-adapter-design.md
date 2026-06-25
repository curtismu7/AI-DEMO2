# Delegation Vertical Adapter — Design Spec

**Date:** 2026-06-06
**Status:** Approved

## Problem

The `/delegation` and `/delegated-access` pages use hard-coded banking terminology ("family member", "View Accounts", "Transfer Funds", etc.). When a presenter is running CareConnect or Super Sports, the delegation page breaks the vertical illusion — scopes read like banking regardless of the active theme.

## Goal

Make both delegation pages terminology-aware: they read the active vertical's `delegation` config block and adapt all copy (page title, grantee label, scope labels) without any navigation or reload. A dropdown lets the user override the auto-detected vertical for demo flexibility.

---

## Scope

| In scope | Out of scope |
|---|---|
| Add `delegation` block to 5 vertical manifests | New vertical manifest / new `/delegation` route |
| Extend Zod schema with optional `delegation` field | Changes to the underlying `VALID_SCOPES` in `delegationService.js` |
| New `useDelegationConfig` hook | Changes to RFC 8693 token exchange logic |
| Vertical selector on `DelegationPage.js` | New PingOne provisioning flows |
| Vertical selector + full API wiring on `DelegatedAccessPage.js` | Feature-page chip wiring in vertical manifests |
| New `GET /api/delegation/granted-to-me` BFF endpoint | |

---

## Architecture

```
VerticalContext (auto-detected)
        │
        ▼
useDelegationConfig(verticalId)
  • fetches /api/verticals (list with delegation blocks)
  • returns { pageTitle, pageDescription, granteeLabel, scopeLabels }
        │
        ├──▶ DelegationPage.js  (grant/revoke, /delegation)
        └──▶ DelegatedAccessPage.js  (delegate view, /delegated-access)
```

The vertical selector dropdown overrides the auto-detected vertical **locally** (component state only — it does not change the active vertical for the rest of the app).

---

## Change 1 — Manifest schema (`verticalManifest/schema.js`)

Add an optional `delegation` field:

```js
const ScopeLabelSchema = z.object({
  label: z.string(),
  description: z.string(),
});

const DelegationSchema = z.object({
  pageTitle: z.string(),
  pageDescription: z.string(),
  granteeLabel: z.string(),
  scopeLabels: z.object({
    view_accounts:    ScopeLabelSchema,
    view_balances:    ScopeLabelSchema,
    create_deposit:   ScopeLabelSchema,
    create_withdrawal: ScopeLabelSchema,
    create_transfer:  ScopeLabelSchema,
  }),
}).optional();
```

Add `delegation: DelegationSchema` to the root manifest schema.

---

## Change 2 — Per-vertical `delegation` blocks

Add to each of the 5 customer vertical manifests:

### Super Banking (`banking`)
```json
"delegation": {
  "pageTitle": "Family Delegation",
  "pageDescription": "Grant family members scoped access to your accounts — powered by RFC 8693 token exchange and PingOne",
  "granteeLabel": "family member",
  "scopeLabels": {
    "view_accounts":    { "label": "View Accounts",    "description": "See account list and details" },
    "view_balances":    { "label": "View Balances",    "description": "See account balances" },
    "create_deposit":   { "label": "Make Deposits",    "description": "Deposit funds into accounts" },
    "create_withdrawal":{ "label": "Make Withdrawals", "description": "Withdraw funds from accounts" },
    "create_transfer":  { "label": "Transfer Funds",   "description": "Transfer between accounts" }
  }
}
```

### CareConnect (`healthcare`)
```json
"delegation": {
  "pageTitle": "Proxy Access",
  "pageDescription": "Authorize a caregiver or family member to access your health records — powered by RFC 8693 token exchange",
  "granteeLabel": "caregiver or family member",
  "scopeLabels": {
    "view_accounts":    { "label": "View Patient Records",  "description": "See record list and details" },
    "view_balances":    { "label": "View Coverage",         "description": "See insurance coverage details" },
    "create_deposit":   { "label": "Schedule Appointments", "description": "Book new appointments" },
    "create_withdrawal":{ "label": "Cancel Appointments",   "description": "Cancel existing appointments" },
    "create_transfer":  { "label": "Release Records",       "description": "Authorize records release to providers" }
  }
}
```

### Great Buy (`retail`)
```json
"delegation": {
  "pageTitle": "Family Account Sharing",
  "pageDescription": "Share your Great Buy account with a family member — powered by RFC 8693 token exchange",
  "granteeLabel": "family member",
  "scopeLabels": {
    "view_accounts":    { "label": "View Account",         "description": "See account details and saved items" },
    "view_balances":    { "label": "View Balance",         "description": "See store credit and rewards balance" },
    "create_deposit":   { "label": "Make Purchases",       "description": "Buy items on this account" },
    "create_withdrawal":{ "label": "Process Returns",      "description": "Return or exchange items" },
    "create_transfer":  { "label": "Transfer Store Credit","description": "Move store credit to another account" }
  }
}
```

### Super Sports (`sporting-goods`)
```json
"delegation": {
  "pageTitle": "Share Loyalty Access",
  "pageDescription": "Share your Super Sports loyalty account with a family member or team member",
  "granteeLabel": "family member or team member",
  "scopeLabels": {
    "view_accounts":    { "label": "View Loyalty Accounts","description": "See loyalty account details" },
    "view_balances":    { "label": "View Reward Points",   "description": "See reward point balances" },
    "create_deposit":   { "label": "Make Purchases",       "description": "Make purchases on the loyalty account" },
    "create_withdrawal":{ "label": "Process Returns",      "description": "Return or exchange gear" },
    "create_transfer":  { "label": "Place Team Orders",    "description": "Submit team equipment orders" }
  }
}
```

### WX Workforce (`workforce`)
```json
"delegation": {
  "pageTitle": "Delegate Access",
  "pageDescription": "Delegate workspace access to a colleague or team member",
  "granteeLabel": "colleague or delegate",
  "scopeLabels": {
    "view_accounts":    { "label": "View Accounts",    "description": "See workspace accounts and budgets" },
    "view_balances":    { "label": "View Balance",     "description": "See available budget and allowances" },
    "create_deposit":   { "label": "Submit Requests",  "description": "Submit time-off or expense requests" },
    "create_withdrawal":{ "label": "Cancel Requests",  "description": "Cancel pending requests" },
    "create_transfer":  { "label": "Approve Expenses", "description": "Approve high-value expense reports" }
  }
}
```

---

## Change 3 — New BFF endpoint

**`GET /api/delegation/granted-to-me`**

Returns active delegation records where `delegate_email === req.user.email`.

- Route: `demo_api_server/routes/delegation.js` — declare **before** `/:id` to avoid Express matching `granted-to-me` as an `:id`
- Service: new `getDelegationsGrantedToMe(delegateEmail)` in `delegationService.js`
- Implementation: full scan of LMDB delegations DB, filter by `delegate_email` (lowercased) and `status === 'active'`, sort descending by `granted_at`
- Auth: same `requireAuth` middleware as other delegation routes
- Response: `{ ok: true, delegations: DelegationRecord[] }`

```js
async function getDelegationsGrantedToMe(delegateEmail) {
  const results = [];
  for (const { value } of _db().getRange()) {
    const rec = toRecord(value);
    if (rec.delegate_email === delegateEmail.toLowerCase() && rec.status === 'active')
      results.push(rec);
  }
  return results.sort((a, b) => b.granted_at.localeCompare(a.granted_at));
}
```

---

## Change 4 — `useDelegationConfig` hook (new file)

**`demo_api_ui/src/hooks/useDelegationConfig.js`**

```js
// Returns delegation config for the given verticalId.
// Falls back to banking defaults if the vertical has no delegation block.
export function useDelegationConfig(verticalId) { ... }
```

- Fetches `GET /api/verticals/list` (existing route, `requireSession`) to get all vertical manifests including their `delegation` blocks
- Falls back to banking defaults when unauthenticated or when a manifest has no `delegation` block (future-proofs new verticals)
- Returns `{ pageTitle, pageDescription, granteeLabel, scopeLabels, headerGradient }` where `headerGradient` is `{ start, end }` derived from the vertical's `cssVars['--brand-dashboard-header-start/end']`
- Memoised by `verticalId`

---

## Change 5 — `DelegationPage.js` (at `/delegation`)

### Vertical selector
- Sits between the gradient header and the "Grant Account Access" card
- Label: "Viewing as" + `<select>` populated from vertical list
- Initial value: `VerticalContext.activeId` (auto-detected); shows "(auto-detected)" hint
- On change: updates local state only; shows "(manually changed)" hint
- Selector is always visible — even if user isn't logged in (uses banking defaults when unauthenticated)

### Adapted copy
All of the following read from `useDelegationConfig(selectedVerticalId)`:
- Gradient header: `pageTitle` + `pageDescription`
- "Grant Account Access" card: description replaces "family member" with `granteeLabel`
- Email placeholder: `${granteeLabel}@example.com`
- Scope checkbox list: labels and descriptions from `scopeLabels[scope.key]`
- Active delegate cards: scope pills display `scopeLabels[scope].label` instead of raw key
- History table: Permissions column uses `scopeLabels[scope].label`

### What stays unchanged
- How It Works panel (RFC 8693 explanation is universal)
- Live Token Chain panel
- Demo Talk Track panel
- All API calls (`/api/delegation`, `/api/delegation/:id`)

---

## Change 6 — `DelegatedAccessPage.js` (at `/delegated-access`)

### Wire "Access I've Granted" tab to real API
Replace `DEMO_GRANTED_BY_ME` hard-coded data with:
- `GET /api/delegation` → active delegations I've granted
- `GET /api/delegation/history` → full history (active + revoked)
- Scope pills use `scopeLabels[scope].label` from `useDelegationConfig`

### Wire "Access Granted to Me" tab to real API
Replace `DEMO_GRANTED_TO_ME` hard-coded data with:
- `GET /api/delegation/granted-to-me` → new endpoint
- Shows delegator email, which accounts/scopes you can access, grant date

### Vertical selector
Same selector component as `DelegationPage.js` — same auto-detect + override behaviour.

### Token Exchange Simulator
Keep existing panel as-is (it's educational, not data-driven).

---

## Files touched

| File | Change |
|---|---|
| `demo_api_server/services/verticalManifest/schema.js` | Add optional `delegation` field to root schema |
| `demo_api_server/config/verticals/banking/manifest.json` | Add `delegation` block |
| `demo_api_server/config/verticals/healthcare/manifest.json` | Add `delegation` block |
| `demo_api_server/config/verticals/retail/manifest.json` | Add `delegation` block |
| `demo_api_server/config/verticals/sporting-goods/manifest.json` | Add `delegation` block |
| `demo_api_server/config/verticals/workforce/manifest.json` | Add `delegation` block |
| `demo_api_server/services/delegationService.js` | Add `getDelegationsGrantedToMe` export |
| `demo_api_server/routes/delegation.js` | Add `GET /granted-to-me` route (before `/:id`) |
| `demo_api_ui/src/hooks/useDelegationConfig.js` | New hook |
| `demo_api_ui/src/components/DelegationPage.js` | Vertical selector + adapted copy |
| `demo_api_ui/src/components/DelegatedAccessPage.js` | Vertical selector + real API wiring |

---

## Success criteria

1. On `/delegation` with banking vertical active: page shows "Family Delegation", scope labels are banking terms
2. Switch dropdown to CareConnect: title changes to "Proxy Access", scopes read "View Patient Records" / "Release Records" etc. — no page reload
3. Switch to WX Workforce: "Delegate Access", scopes read "Submit Requests" / "Approve Expenses"
4. Grant a delegation record; reload page — active delegate card scope pills show adapted labels
5. On `/delegated-access`: both tabs load real data from API (not hard-coded demo arrays)
6. "Access Granted to Me" tab shows real records from `GET /api/delegation/granted-to-me`
7. `npm run build` in `demo_api_ui/` exits 0
8. `npm run test:api-server` passes (no regression on delegation routes)
9. Manifest schema validation passes for all 5 updated manifests
