# Vertical Rich Content Design

**Date:** 2026-05-27
**Status:** Approved
**Scope:** All 5 public verticals (banking, healthcare, retail, sporting-goods, workforce)

---

## Problem

All five verticals share the same dashboard shape with swapped labels and colors. The chips, result panels, and LLM chip groups feel "samey" — a healthcare prospect sees banking UI with medical words painted over it. The differentiation is cosmetic, not experiential.

## Goal

Make each vertical feel genuinely built for its domain — distinct hero content, domain-authentic result panels, and industry-specific AI chip scenarios. The change must impress a prospect immediately and let an SE demonstrate the technical depth underneath.

---

## Approach: Domain Dashboard Sections

Three layers of change, all working together:

1. **Vertical Hero Widget** — domain summary bar above chips
2. **Result Panel Renderer Registry** — vertical-aware result components
3. **Per-Vertical LLM Chip Groups** — fully rewritten, domain-authentic scenarios

Mock data underpins all three layers via `manifest.dashboard.mockData`.

---

## Section 1 — Vertical Hero Widget

### What it is

A `VerticalHero` React component renders between the page header and chip grid. It displays 3–4 stat cards, each populated from `manifest.dashboard.hero.cards` + `manifest.dashboard.mockData.heroStats`.

### Manifest schema addition

Under `manifest.dashboard`:

```json
"hero": {
  "cards": [
    { "label": "Display Label", "dataKey": "heroStats.keyName", "format": "date|money|count|text|tier" }
  ]
}
```

Supported formats:
- `date` — renders as localized short date
- `money` — renders with `$` prefix, 2 decimal places
- `count` — renders as integer
- `text` — renders verbatim
- `tier` — renders as colored badge (Gold / Silver / Bronze)

### Per-vertical hero cards

| Vertical | Card 1 | Card 2 | Card 3 | Card 4 |
|---|---|---|---|---|
| Banking | Net Worth (`money`) | Monthly Spend (`money`) | Savings Rate (`text`) | Credit Score (`count`) |
| Healthcare | Next Appointment (`date`) | Active Prescriptions (`count`) | Outstanding Balance (`money`) | Coverage Status (`text`) |
| Retail | Cart Value (`money`) | Pending Orders (`count`) | Reward Points (`count`) | Last Order (`date`) |
| Sporting Goods | Gear Value (`money`) | Active Rentals (`count`) | Loyalty Tier (`tier`) | Last Purchase (`date`) |
| Workforce | Next Pay Date (`date`) | PTO Balance (`count`) | Open Enrollments (`count`) | Team Size (`count`) |

### Component

**New file:** `demo_api_ui/src/components/VerticalHero.jsx`

- Reads `manifest.dashboard.hero.cards` from `useTheme()`
- Reads `manifest.dashboard.mockData.heroStats` for values
- Renders a horizontal strip of stat cards
- Gracefully hidden if `hero` is absent from manifest (backward compatible)
- No vertical-specific logic inside the component

### Integration point

**Modified file:** `demo_api_ui/src/components/BankingAgent.js`

Insert `<VerticalHero />` immediately above the `<BankingChips />` render (line ~6940). This places the hero bar between the chat/header area and the chip grid.

---

## Section 2 — Result Panel Renderer Registry

### What it is

A registry maps `(verticalId, resultType)` to a specialized React component. `BankingAgent.js` `formatResult()` consults the registry before falling back to the existing generic panel.

### Registry

**New file:** `demo_api_ui/src/components/resultPanels/registry.js`

```js
import HealthcarePatientRecordsPanel from './HealthcarePatientRecordsPanel';
import HealthcareBillingPanel from './HealthcareBillingPanel';
import RetailOrdersPanel from './RetailOrdersPanel';
import RetailPurchaseHistoryPanel from './RetailPurchaseHistoryPanel';
import WorkforceBenefitsPanel from './WorkforceBenefitsPanel';
import WorkforcePayrollPanel from './WorkforcePayrollPanel';

export const RESULT_RENDERERS = {
  healthcare: {
    accounts: HealthcarePatientRecordsPanel,
    transactions: HealthcareBillingPanel,
  },
  retail: {
    accounts: RetailOrdersPanel,
    transactions: RetailPurchaseHistoryPanel,
  },
  workforce: {
    accounts: WorkforceBenefitsPanel,
    transactions: WorkforcePayrollPanel,
  },
};

export function getRenderer(verticalId, resultType) {
  return RESULT_RENDERERS[verticalId]?.[resultType] ?? null;
}
```

Banking and sporting-goods fall through to existing generic panels — no new components needed for them initially.

### Lookup in BankingAgent.js

In `formatResult()`:

```js
const SpecializedPanel = getRenderer(themeId, resultType);
if (SpecializedPanel) {
  return <SpecializedPanel data={result} terminology={terminology} />;
}
// existing generic render path
```

### Specialized panel specs

**HealthcarePatientRecordsPanel** — cards with: patient name, DOB, provider, coverage type, coverage status badge

**HealthcareBillingPanel** — rows with: procedure code, date, insurer, amount billed, status (Paid / Pending / Denied)

**RetailOrdersPanel** — cards with: order ID, status badge (Delivered / Shipped / Processing), item count, order total, order date

**RetailPurchaseHistoryPanel** — rows with: product name, SKU, quantity, unit price, purchase date

**WorkforceBenefitsPanel** — cards with: benefit name, plan type, enrollment status badge, coverage tier, next renewal date

**WorkforcePayrollPanel** — rows with: pay period, gross pay, deductions, net pay, payment method

Each component: ~60–100 lines, accepts `{ data, terminology }` props, uses existing CSS class patterns from the repo.

---

## Section 3 — Per-Vertical LLM Chip Groups

Full rewrite of `llmChipGroups` in each manifest. Groups and messages are domain-authentic — written for the vertical's industry, not as banking analogies.

### Banking (polish existing)

```json
"llmChipGroups": {
  "Account Insights": [
    { "id": "bank_high_yield", "label": "Highest-yield account?", "message": "What's my highest-yield account right now?" },
    { "id": "bank_overdraft", "label": "Overdraft risk", "message": "Show me accounts approaching overdraft" }
  ],
  "Spend Analysis": [
    { "id": "bank_top_spend", "label": "Top spend category", "message": "Where did I spend most last month?" },
    { "id": "bank_unusual", "label": "Unusual transactions", "message": "Flag any unusual transactions this month" }
  ],
  "Smart Actions": [
    { "id": "bank_scheduled", "label": "Scheduled transfers", "message": "What transfers are scheduled?" },
    { "id": "bank_savings", "label": "Savings goal check", "message": "Am I on track for my savings goal?" }
  ]
}
```

### Healthcare — CareConnect

```json
"llmChipGroups": {
  "Appointments": [
    { "id": "hc_next_appt", "label": "Next appointment", "message": "When is my next appointment?" },
    { "id": "hc_specialists", "label": "Specialist visits", "message": "Show upcoming specialist visits" }
  ],
  "Prescriptions": [
    { "id": "hc_active_rx", "label": "Active prescriptions", "message": "List my active prescriptions" },
    { "id": "hc_refills", "label": "Refills due", "message": "What prescription refills are due this week?" }
  ],
  "Billing": [
    { "id": "hc_balance", "label": "What do I owe?", "message": "What do I owe from my last visit?" },
    { "id": "hc_pending", "label": "Pending claims", "message": "Show claims pending insurance review" }
  ],
  "Coverage": [
    { "id": "hc_deductible", "label": "Deductible status", "message": "What's my deductible status this year?" },
    { "id": "hc_covered", "label": "Is this covered?", "message": "Is a specialist referral covered under my plan?" }
  ]
}
```

### Retail — Great Buy

```json
"llmChipGroups": {
  "Orders": [
    { "id": "ret_recent", "label": "Recent order status", "message": "Where is my most recent order?" },
    { "id": "ret_30day", "label": "Last 30 days", "message": "Show orders placed in the last 30 days" }
  ],
  "Products": [
    { "id": "ret_wishlist", "label": "My wishlist", "message": "What's on my wishlist?" },
    { "id": "ret_viewed", "label": "Recently viewed", "message": "Show items I've viewed recently" }
  ],
  "Returns": [
    { "id": "ret_start_return", "label": "Start a return", "message": "Start a return for my last order" },
    { "id": "ret_policy", "label": "Return policy", "message": "What's the return policy on electronics?" }
  ],
  "Rewards": [
    { "id": "ret_points", "label": "My points", "message": "How many reward points do I have?" },
    { "id": "ret_redeem", "label": "Redeem rewards", "message": "What rewards can I redeem today?" }
  ]
}
```

### Sporting Goods — Super Sports

```json
"llmChipGroups": {
  "Gear": [
    { "id": "sg_rentals", "label": "Active rentals", "message": "Show my active equipment rentals" },
    { "id": "sg_due", "label": "Due back this week", "message": "What gear is due back this week?" }
  ],
  "Purchases": [
    { "id": "sg_last_season", "label": "Last season buys", "message": "What did I buy last season?" },
    { "id": "sg_top_sport", "label": "Top sport category", "message": "Show my most purchased sport category" }
  ],
  "Loyalty": [
    { "id": "sg_tier", "label": "My loyalty tier", "message": "What's my current loyalty tier?" },
    { "id": "sg_next_reward", "label": "Next reward level", "message": "How far am I from the next reward level?" }
  ],
  "Recommendations": [
    { "id": "sg_match", "label": "Gear matches", "message": "What gear matches my recent purchases?" },
    { "id": "sg_trail", "label": "Trail-ready gear", "message": "Show trail-ready equipment for this season" }
  ]
}
```

### Workforce — WX Workforce

```json
"llmChipGroups": {
  "Pay": [
    { "id": "wf_payday", "label": "Next payday", "message": "When is my next payday?" },
    { "id": "wf_paystubs", "label": "Recent pay stubs", "message": "Show my last 3 pay stubs" }
  ],
  "Benefits": [
    { "id": "wf_enrolled", "label": "My benefits", "message": "What benefits am I enrolled in?" },
    { "id": "wf_enrollment", "label": "Open enrollment", "message": "When does open enrollment close?" }
  ],
  "Time Off": [
    { "id": "wf_pto", "label": "PTO balance", "message": "How much PTO do I have left?" },
    { "id": "wf_pending", "label": "Pending requests", "message": "Show my pending time-off requests" }
  ],
  "Team": [
    { "id": "wf_schedules", "label": "Team schedules", "message": "Show my direct reports' schedules" },
    { "id": "wf_out", "label": "Who's out?", "message": "Who is out of office this week?" }
  ]
}
```

---

## Section 4 — Mock Data per Vertical

Mock data lives in `manifest.dashboard.mockData`. Banking reuses existing `store.js` data. All others get domain records in the manifest.

### Schema

```json
"mockData": {
  "heroStats": { "key": "value" },
  "domainRecords": [...]
}
```

### Per-vertical mock data

**Banking** — `heroStats` only (domain records from `store.js`):
```json
"heroStats": {
  "netWorth": 47320.00,
  "monthlySpend": 2840.15,
  "savingsRate": "12.4%",
  "creditScore": 742
}
```

**Healthcare** — `heroStats` + `patientRecords[]` + `billingHistory[]`

**Retail** — `heroStats` + `orders[]` + `lineItems[]`

**Sporting Goods** — `heroStats` + existing `products[]` + new `rentals[]`

**Workforce** — `heroStats` + `benefits[]` + `payrollHistory[]`

Full mock data arrays defined during implementation with 3–5 realistic records each.

---

## Files Touched

### New files
- `demo_api_ui/src/components/VerticalHero.jsx`
- `demo_api_ui/src/components/resultPanels/registry.js`
- `demo_api_ui/src/components/resultPanels/HealthcarePatientRecordsPanel.jsx`
- `demo_api_ui/src/components/resultPanels/HealthcareBillingPanel.jsx`
- `demo_api_ui/src/components/resultPanels/RetailOrdersPanel.jsx`
- `demo_api_ui/src/components/resultPanels/RetailPurchaseHistoryPanel.jsx`
- `demo_api_ui/src/components/resultPanels/WorkforceBenefitsPanel.jsx`
- `demo_api_ui/src/components/resultPanels/WorkforcePayrollPanel.jsx`

### Modified files
- `demo_api_server/config/verticals/banking.json` — add `hero`, `mockData.heroStats`, rewrite `llmChipGroups`
- `demo_api_server/config/verticals/healthcare.json` — add `hero`, `mockData`, rewrite `llmChipGroups`
- `demo_api_server/config/verticals/retail.json` — add `hero`, `mockData`, rewrite `llmChipGroups`
- `demo_api_server/config/verticals/sporting-goods.json` — add `hero`, expand `mockData`, rewrite `llmChipGroups`
- `demo_api_server/config/verticals/workforce.json` — add `hero`, `mockData`, rewrite `llmChipGroups`
- `demo_api_ui/src/components/BankingAgent.js` — add registry lookup in `formatResult()`; insert `<VerticalHero />` above `<BankingChips />`

### Not touched
- `store.js` — banking data stays as-is
- `verticalConfigService.js` — no schema validation changes needed; `mockData` is already a free-form field
- Auth, OAuth, session, MCP, HITL — untouched

---

## Regression Guard

Per `REGRESSION_PLAN.md`:
- Hero widget must be absent (not render as empty) when `manifest.dashboard.hero` is undefined — backward safe
- Registry `getRenderer()` returning `null` must fall through to existing generic panel cleanly
- `npm run build` in `demo_api_ui/` must exit 0
- Banking dashboard must remain unchanged in appearance (it uses existing panels + new hero widget only)
- All existing chip routing keys (`balance`, `accounts`, `transactions`, `transfer`) must still route correctly

---

## Success Criteria

1. Switch to Healthcare — hero shows next appointment, active prescriptions, outstanding balance, coverage status
2. Ask "show my accounts" in Healthcare — renders `HealthcarePatientRecordsPanel` with patient record cards, not generic account rows
3. Switch to Retail — hero shows cart value, pending orders, reward points, last order date
4. LLM chip groups in each vertical show domain-specific groups (no "Account Insights" in healthcare)
5. Switch back to Banking — dashboard looks identical to before this change
6. `npm run build` exits 0
