# Vertical Rich Content Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each of the 5 public verticals feel genuinely distinct — a domain hero widget above chips, vertical-aware result panel renderers, and fully rewritten per-vertical LLM chip groups.

**Architecture:** A single `VerticalHero` component reads `manifest.dashboard.hero` + `manifest.dashboard.mockData.heroStats` from `ThemeContext` and renders a stat-card strip. A `resultPanels/registry.js` module maps `(verticalId, resultType)` to a specialized component; `BankingAgent.js` consults this registry before falling back to its existing generic path. All five vertical JSON manifests gain `hero`, `mockData`, and rewritten `llmChipGroups`.

**Tech Stack:** React (CRA, JSX in `.js`/`.jsx`), ES modules, existing CSS class conventions from `BankingAgent.js`, vertical JSON manifests in `demo_api_server/config/verticals/`

---

## File Map

| Status | Path | Responsibility |
|---|---|---|
| Create | `demo_api_ui/src/components/VerticalHero.jsx` | Stat-card strip — reads hero config + heroStats from ThemeContext |
| Create | `demo_api_ui/src/components/resultPanels/registry.js` | `getRenderer(verticalId, resultType)` lookup |
| Create | `demo_api_ui/src/components/resultPanels/HealthcarePatientRecordsPanel.jsx` | Patient record cards for healthcare accounts result |
| Create | `demo_api_ui/src/components/resultPanels/HealthcareBillingPanel.jsx` | Billing rows for healthcare transactions result |
| Create | `demo_api_ui/src/components/resultPanels/RetailOrdersPanel.jsx` | Order cards for retail accounts result |
| Create | `demo_api_ui/src/components/resultPanels/RetailPurchaseHistoryPanel.jsx` | Line-item rows for retail transactions result |
| Create | `demo_api_ui/src/components/resultPanels/WorkforceBenefitsPanel.jsx` | Benefits cards for workforce accounts result |
| Create | `demo_api_ui/src/components/resultPanels/WorkforcePayrollPanel.jsx` | Payroll rows for workforce transactions result |
| Modify | `demo_api_ui/src/components/BankingAgent.js` | Import VerticalHero + registry; insert hero above chips; hook registry into result panel render |
| Modify | `demo_api_server/config/verticals/banking.json` | Add `hero`, `mockData.heroStats`, rewrite `llmChipGroups` |
| Modify | `demo_api_server/config/verticals/healthcare.json` | Add `hero`, `mockData` (heroStats + patientRecords + billingHistory), rewrite `llmChipGroups` |
| Modify | `demo_api_server/config/verticals/retail.json` | Add `hero`, expand `mockData` (heroStats + orders + lineItems), rewrite `llmChipGroups` |
| Modify | `demo_api_server/config/verticals/sporting-goods.json` | Add `hero`, expand `mockData` (heroStats + rentals), rewrite `llmChipGroups` |
| Modify | `demo_api_server/config/verticals/workforce.json` | Add `hero`, `mockData` (heroStats + benefits + payrollHistory), rewrite `llmChipGroups` |

---

## Task 1: VerticalHero component

**Files:**
- Create: `demo_api_ui/src/components/VerticalHero.jsx`

- [ ] **Step 1: Write the component**

```jsx
// demo_api_ui/src/components/VerticalHero.jsx
import React from "react";
import { useTheme } from "../context/ThemeContext";

function formatValue(value, format) {
  if (value === null || value === undefined) return "—";
  switch (format) {
    case "money":
      return "$" + Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case "count":
      return String(Math.round(Number(value)));
    case "date":
      return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    case "tier": {
      const tier = String(value).toLowerCase();
      const color = tier === "gold" ? "#b45309" : tier === "silver" ? "#6b7280" : "#92400e";
      return <span style={{ color, fontWeight: 700 }}>{value}</span>;
    }
    case "text":
    default:
      return String(value);
  }
}

function resolveValue(dataKey, heroStats) {
  if (!heroStats) return undefined;
  // dataKey is like "heroStats.nextAppointment" — strip the "heroStats." prefix
  const key = dataKey.startsWith("heroStats.") ? dataKey.slice("heroStats.".length) : dataKey;
  return heroStats[key];
}

export default function VerticalHero() {
  const { dashboard } = useTheme();
  if (!dashboard?.hero?.cards) return null;

  const heroStats = dashboard.mockData?.heroStats || {};

  return (
    <div className="vertical-hero">
      {dashboard.hero.cards.map((card) => (
        <div key={card.dataKey} className="vertical-hero-card">
          <span className="vertical-hero-label">{card.label}</span>
          <span className="vertical-hero-value">
            {formatValue(resolveValue(card.dataKey, heroStats), card.format)}
          </span>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Add CSS for the hero strip**

Open `demo_api_ui/src/App.css` (or wherever global component styles live — check with `grep -rn "\.bar-rp-" demo_api_ui/src/ --include="*.css" -l` first). Add at the end of whichever CSS file contains `.bar-rp-*` rules:

```css
.vertical-hero {
  display: flex;
  gap: 12px;
  padding: 12px 16px;
  background: rgba(0, 0, 0, 0.04);
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  flex-wrap: wrap;
}

.vertical-hero-card {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 120px;
  padding: 10px 14px;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
}

.vertical-hero-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #6b7280;
  font-weight: 600;
}

.vertical-hero-value {
  font-size: 18px;
  font-weight: 700;
  color: #111827;
}
```

- [ ] **Step 3: Verify the component builds (no vertical data yet — just ensure no import errors)**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -20
```

Expected: exits 0 (or same errors as before if any pre-exist — the new file should add none).

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/components/VerticalHero.jsx demo_api_ui/src/App.css
git commit -m "feat(verticals): add VerticalHero stat-card strip component"
```

---

## Task 2: Wire VerticalHero into BankingAgent

**Files:**
- Modify: `demo_api_ui/src/components/BankingAgent.js` (line ~53 imports, line ~6939 render)

- [ ] **Step 1: Add import at top of BankingAgent.js**

Find the existing BankingChips import (line ~53):
```js
import BankingChips, { PINGONE_ADMIN_CHIP_IDS } from "./BankingChips";
```

Add immediately after it:
```js
import VerticalHero from "./VerticalHero";
```

- [ ] **Step 2: Insert `<VerticalHero />` above `<BankingChips />`**

Find the render block at line ~6939:
```jsx
                {isLoggedIn && (
                  <BankingChips
```

Replace with:
```jsx
                {isLoggedIn && <VerticalHero />}
                {isLoggedIn && (
                  <BankingChips
```

- [ ] **Step 3: Build to confirm no errors**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -20
```

Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/components/BankingAgent.js
git commit -m "feat(verticals): wire VerticalHero above chip grid in BankingAgent"
```

---

## Task 3: Update banking.json — hero + heroStats + llmChipGroups

**Files:**
- Modify: `demo_api_server/config/verticals/banking.json`

- [ ] **Step 1: Replace the `dashboard` block**

Open `demo_api_server/config/verticals/banking.json`. Replace the entire `"dashboard"` key with:

```json
"dashboard": {
  "kind": "banking",
  "chips": [
    { "key": "balance", "label": "Check Balance" },
    { "key": "accounts", "label": "My Accounts" },
    { "key": "transactions", "label": "Transactions" },
    { "key": "transfer", "label": "Transfer Funds" },
    { "key": "feature", "label": "Show Mortgage Data" }
  ],
  "hero": {
    "cards": [
      { "label": "Net Worth",     "dataKey": "heroStats.netWorth",     "format": "money" },
      { "label": "Monthly Spend", "dataKey": "heroStats.monthlySpend", "format": "money" },
      { "label": "Savings Rate",  "dataKey": "heroStats.savingsRate",  "format": "text"  },
      { "label": "Credit Score",  "dataKey": "heroStats.creditScore",  "format": "count" }
    ]
  },
  "llmChipGroups": {
    "Account Insights": [
      { "id": "bank_high_yield", "label": "Highest-yield account?",   "message": "What's my highest-yield account right now?" },
      { "id": "bank_overdraft",  "label": "Overdraft risk",           "message": "Show me accounts approaching overdraft" }
    ],
    "Spend Analysis": [
      { "id": "bank_top_spend",  "label": "Top spend category",       "message": "Where did I spend most last month?" },
      { "id": "bank_unusual",    "label": "Unusual transactions",      "message": "Flag any unusual transactions this month" }
    ],
    "Smart Actions": [
      { "id": "bank_scheduled",  "label": "Scheduled transfers",      "message": "What transfers are scheduled?" },
      { "id": "bank_savings",    "label": "Savings goal check",       "message": "Am I on track for my savings goal?" }
    ]
  },
  "mockData": {
    "heroStats": {
      "netWorth": 47320.00,
      "monthlySpend": 2840.15,
      "savingsRate": "12.4%",
      "creditScore": 742
    }
  }
}
```

- [ ] **Step 2: Validate JSON is parseable**

```bash
node -e "const v = require('./demo_api_server/config/verticals/banking.json'); console.log('id:', v.id, '| hero cards:', v.dashboard.hero.cards.length)"
```

Expected: `id: banking | hero cards: 4`

- [ ] **Step 3: Commit**

```bash
git add demo_api_server/config/verticals/banking.json
git commit -m "feat(verticals): banking — add hero, heroStats, rewrite llmChipGroups"
```

---

## Task 4: Update healthcare.json — hero + mockData + llmChipGroups

**Files:**
- Modify: `demo_api_server/config/verticals/healthcare.json`

- [ ] **Step 1: Replace the `dashboard` block**

Replace the entire `"dashboard"` key in `demo_api_server/config/verticals/healthcare.json` with:

```json
"dashboard": {
  "kind": "healthcare",
  "chips": [
    { "key": "balance", "label": "Check Coverage" },
    { "key": "accounts", "label": "My Records" },
    { "key": "transactions", "label": "Appointments" },
    { "key": "transfer", "label": "Release Records" },
    { "key": "feature", "label": "Show Health Record" }
  ],
  "hero": {
    "cards": [
      { "label": "Next Appointment",       "dataKey": "heroStats.nextAppointment",      "format": "date"  },
      { "label": "Active Prescriptions",   "dataKey": "heroStats.activePrescriptions",  "format": "count" },
      { "label": "Outstanding Balance",    "dataKey": "heroStats.outstandingBalance",   "format": "money" },
      { "label": "Coverage Status",        "dataKey": "heroStats.coverageStatus",       "format": "text"  }
    ]
  },
  "llmChipGroups": {
    "Appointments": [
      { "id": "hc_next_appt",    "label": "Next appointment",     "message": "When is my next appointment?" },
      { "id": "hc_specialists",  "label": "Specialist visits",    "message": "Show upcoming specialist visits" }
    ],
    "Prescriptions": [
      { "id": "hc_active_rx",    "label": "Active prescriptions", "message": "List my active prescriptions" },
      { "id": "hc_refills",      "label": "Refills due",          "message": "What prescription refills are due this week?" }
    ],
    "Billing": [
      { "id": "hc_balance",      "label": "What do I owe?",       "message": "What do I owe from my last visit?" },
      { "id": "hc_pending",      "label": "Pending claims",       "message": "Show claims pending insurance review" }
    ],
    "Coverage": [
      { "id": "hc_deductible",   "label": "Deductible status",    "message": "What's my deductible status this year?" },
      { "id": "hc_covered",      "label": "Is this covered?",     "message": "Is a specialist referral covered under my plan?" }
    ]
  },
  "mockData": {
    "heroStats": {
      "nextAppointment":      "2026-06-03",
      "activePrescriptions":  3,
      "outstandingBalance":   142.50,
      "coverageStatus":       "Active"
    },
    "patientRecords": [
      { "id": "pr1", "name": "Alex Johnson",   "dob": "1985-04-12", "provider": "Dr. Sarah Chen",   "coverageType": "PPO",  "coverageStatus": "Active"   },
      { "id": "pr2", "name": "Alex Johnson",   "dob": "1985-04-12", "provider": "Dr. Marcus Webb",  "coverageType": "HMO",  "coverageStatus": "Active"   },
      { "id": "pr3", "name": "Alex Johnson",   "dob": "1985-04-12", "provider": "Dr. Priya Nair",   "coverageType": "PPO",  "coverageStatus": "Inactive" }
    ],
    "billingHistory": [
      { "id": "b1", "procedureCode": "99213", "date": "2026-04-10", "insurer": "BlueCross",   "amountBilled": 220.00, "status": "Paid"    },
      { "id": "b2", "procedureCode": "90837", "date": "2026-04-22", "insurer": "BlueCross",   "amountBilled": 180.00, "status": "Pending" },
      { "id": "b3", "procedureCode": "93000", "date": "2026-05-01", "insurer": "BlueCross",   "amountBilled": 95.00,  "status": "Denied"  }
    ]
  }
}
```

- [ ] **Step 2: Validate**

```bash
node -e "const v = require('./demo_api_server/config/verticals/healthcare.json'); console.log('id:', v.id, '| hero cards:', v.dashboard.hero.cards.length, '| patientRecords:', v.dashboard.mockData.patientRecords.length)"
```

Expected: `id: healthcare | hero cards: 4 | patientRecords: 3`

- [ ] **Step 3: Commit**

```bash
git add demo_api_server/config/verticals/healthcare.json
git commit -m "feat(verticals): healthcare — add hero, mockData (patient records + billing), rewrite llmChipGroups"
```

---

## Task 5: Update retail.json — hero + expanded mockData + llmChipGroups

**Files:**
- Modify: `demo_api_server/config/verticals/retail.json`

- [ ] **Step 1: Replace the `dashboard` block**

Replace the entire `"dashboard"` key in `demo_api_server/config/verticals/retail.json` with:

```json
"dashboard": {
  "kind": "retail",
  "chips": [
    { "key": "balance", "label": "Rewards Points" },
    { "key": "accounts", "label": "List My Orders" },
    { "key": "transactions", "label": "Purchase History" },
    { "key": "transfer", "label": "Checkout" },
    { "key": "feature", "label": "Show Large Purchase" }
  ],
  "hero": {
    "cards": [
      { "label": "Cart Value",     "dataKey": "heroStats.cartValue",     "format": "money" },
      { "label": "Pending Orders", "dataKey": "heroStats.pendingOrders", "format": "count" },
      { "label": "Reward Points",  "dataKey": "heroStats.rewardPoints",  "format": "count" },
      { "label": "Last Order",     "dataKey": "heroStats.lastOrder",     "format": "date"  }
    ]
  },
  "llmChipGroups": {
    "Orders": [
      { "id": "ret_recent",       "label": "Recent order status", "message": "Where is my most recent order?" },
      { "id": "ret_30day",        "label": "Last 30 days",        "message": "Show orders placed in the last 30 days" }
    ],
    "Products": [
      { "id": "ret_wishlist",     "label": "My wishlist",         "message": "What's on my wishlist?" },
      { "id": "ret_viewed",       "label": "Recently viewed",     "message": "Show items I've viewed recently" }
    ],
    "Returns": [
      { "id": "ret_start_return", "label": "Start a return",      "message": "Start a return for my last order" },
      { "id": "ret_policy",       "label": "Return policy",       "message": "What's the return policy on electronics?" }
    ],
    "Rewards": [
      { "id": "ret_points",       "label": "My points",           "message": "How many reward points do I have?" },
      { "id": "ret_redeem",       "label": "Redeem rewards",      "message": "What rewards can I redeem today?" }
    ]
  },
  "mockData": {
    "heroStats": {
      "cartValue":     349.99,
      "pendingOrders": 2,
      "rewardPoints":  4820,
      "lastOrder":     "2026-04-23"
    },
    "products": [
      { "id": "p1",  "sku": "BB-65QLED",  "name": "Samsung 65\" QLED TV",    "price": 1299, "stock": "In Stock",      "category": "TV"      },
      { "id": "p2",  "sku": "BB-MBP14",   "name": "MacBook Pro 14\"",         "price": 1999, "stock": "In Stock",      "category": "Laptop"  },
      { "id": "p3",  "sku": "BB-APP3",    "name": "AirPods Pro",              "price": 249,  "stock": "In Stock",      "category": "Audio"   },
      { "id": "p4",  "sku": "BB-WH1000",  "name": "Sony WH-1000XM5",          "price": 349,  "stock": "In Stock",      "category": "Audio"   },
      { "id": "p5",  "sku": "BB-PS5",     "name": "PlayStation 5",            "price": 499,  "stock": "Low Stock",     "category": "Gaming"  },
      { "id": "p6",  "sku": "BB-ROGLTOP", "name": "ASUS ROG Gaming Laptop",   "price": 1199, "stock": "In Stock",      "category": "Laptop"  },
      { "id": "p7",  "sku": "BB-BOSE-SL", "name": "Bose SoundLink Speaker",   "price": 149,  "stock": "In Stock",      "category": "Audio"   },
      { "id": "p8",  "sku": "BB-LG27",    "name": "LG 27\" 4K Monitor",       "price": 399,  "stock": "In Stock",      "category": "Monitor" },
      { "id": "p9",  "sku": "BB-IP16PRO", "name": "iPhone 16 Pro",            "price": 999,  "stock": "Limited Stock", "category": "Phone"   },
      { "id": "p10", "sku": "BB-GRM-F8",  "name": "Garmin Fenix 8",           "price": 799,  "stock": "In Stock",      "category": "Wearable"}
    ],
    "orders": [
      { "id": "o1", "product": "AirPods Pro",      "sku": "BB-APP3",    "amount": 249,  "status": "Delivered",  "date": "2026-04-20", "itemCount": 1 },
      { "id": "o2", "product": "MacBook Pro 14\"",  "sku": "BB-MBP14",   "amount": 1999, "status": "Shipped",    "date": "2026-04-22", "itemCount": 1 },
      { "id": "o3", "product": "Bose SoundLink",    "sku": "BB-BOSE-SL", "amount": 149,  "status": "Processing", "date": "2026-04-23", "itemCount": 1 }
    ],
    "lineItems": [
      { "id": "li1", "product": "AirPods Pro",     "sku": "BB-APP3",    "quantity": 1, "unitPrice": 249,  "purchaseDate": "2026-04-20" },
      { "id": "li2", "product": "MacBook Pro 14\"", "sku": "BB-MBP14",   "quantity": 1, "unitPrice": 1999, "purchaseDate": "2026-04-22" },
      { "id": "li3", "product": "Bose SoundLink",  "sku": "BB-BOSE-SL", "quantity": 1, "unitPrice": 149,  "purchaseDate": "2026-04-23" }
    ]
  }
}
```

- [ ] **Step 2: Validate**

```bash
node -e "const v = require('./demo_api_server/config/verticals/retail.json'); console.log('id:', v.id, '| hero cards:', v.dashboard.hero.cards.length, '| orders:', v.dashboard.mockData.orders.length)"
```

Expected: `id: retail | hero cards: 4 | orders: 3`

- [ ] **Step 3: Commit**

```bash
git add demo_api_server/config/verticals/retail.json
git commit -m "feat(verticals): retail — add hero, heroStats, lineItems mockData, rewrite llmChipGroups"
```

---

## Task 6: Update sporting-goods.json — hero + expanded mockData + llmChipGroups

**Files:**
- Modify: `demo_api_server/config/verticals/sporting-goods.json`

- [ ] **Step 1: Replace the `dashboard` block**

Replace the entire `"dashboard"` key in `demo_api_server/config/verticals/sporting-goods.json` with:

```json
"dashboard": {
  "kind": "sporting-goods",
  "chips": [
    { "key": "balance",      "label": "Reward Points"   },
    { "key": "accounts",     "label": "My Gear"         },
    { "key": "transactions", "label": "Purchase History"},
    { "key": "transfer",     "label": "Place Order"     },
    { "key": "feature",      "label": "Show Gear Order" }
  ],
  "hero": {
    "cards": [
      { "label": "Gear Value",     "dataKey": "heroStats.gearValue",     "format": "money" },
      { "label": "Active Rentals", "dataKey": "heroStats.activeRentals", "format": "count" },
      { "label": "Loyalty Tier",   "dataKey": "heroStats.loyaltyTier",   "format": "tier"  },
      { "label": "Last Purchase",  "dataKey": "heroStats.lastPurchase",  "format": "date"  }
    ]
  },
  "llmChipGroups": {
    "Gear": [
      { "id": "sg_rentals",     "label": "Active rentals",    "message": "Show my active equipment rentals" },
      { "id": "sg_due",         "label": "Due back this week","message": "What gear is due back this week?" }
    ],
    "Purchases": [
      { "id": "sg_last_season", "label": "Last season buys",  "message": "What did I buy last season?" },
      { "id": "sg_top_sport",   "label": "Top sport category","message": "Show my most purchased sport category" }
    ],
    "Loyalty": [
      { "id": "sg_tier",        "label": "My loyalty tier",   "message": "What's my current loyalty tier?" },
      { "id": "sg_next_reward", "label": "Next reward level", "message": "How far am I from the next reward level?" }
    ],
    "Recommendations": [
      { "id": "sg_match",       "label": "Gear matches",      "message": "What gear matches my recent purchases?" },
      { "id": "sg_trail",       "label": "Trail-ready gear",  "message": "Show trail-ready equipment for this season" }
    ]
  },
  "mockData": {
    "heroStats": {
      "gearValue":     644.00,
      "activeRentals": 2,
      "loyaltyTier":   "Gold",
      "lastPurchase":  "2026-04-27"
    },
    "products": [
      { "id": "p1", "sku": "SS-NK-RUN",  "name": "Nike Pegasus 41",        "price": 140, "stock": "In Stock",  "category": "Running"  },
      { "id": "p2", "sku": "SS-UA-HVY",  "name": "Under Armour Hoodie",    "price": 75,  "stock": "In Stock",  "category": "Apparel"  },
      { "id": "p3", "sku": "SS-TW-GOLF", "name": "Titleist Pro V1 (12)",   "price": 55,  "stock": "Low Stock", "category": "Golf"     },
      { "id": "p4", "sku": "SS-YNX-MAT", "name": "Yonex Badminton Racket", "price": 120, "stock": "In Stock",  "category": "Racket"   },
      { "id": "p5", "sku": "SS-GRM-WCH", "name": "Garmin Forerunner 265",  "price": 449, "stock": "In Stock",  "category": "Wearable" }
    ],
    "orders": [
      { "id": "o1", "product": "Nike Pegasus 41",        "sku": "SS-NK-RUN",  "amount": 140, "status": "Delivered",  "date": "2026-04-18" },
      { "id": "o2", "product": "Garmin Forerunner 265",  "sku": "SS-GRM-WCH", "amount": 449, "status": "Shipped",    "date": "2026-04-25" },
      { "id": "o3", "product": "Titleist Pro V1",        "sku": "SS-TW-GOLF", "amount": 55,  "status": "Processing", "date": "2026-04-27" }
    ],
    "rentals": [
      { "id": "r1", "item": "Trek Marlin 8 Mountain Bike", "sku": "SS-TREK-MB8", "dueDate": "2026-05-30", "dailyRate": 45.00, "status": "Active"   },
      { "id": "r2", "item": "Rossignol Ski Set",           "sku": "SS-RS-SKI",   "dueDate": "2026-06-01", "dailyRate": 60.00, "status": "Active"   }
    ]
  }
}
```

- [ ] **Step 2: Validate**

```bash
node -e "const v = require('./demo_api_server/config/verticals/sporting-goods.json'); console.log('id:', v.id, '| hero cards:', v.dashboard.hero.cards.length, '| rentals:', v.dashboard.mockData.rentals.length)"
```

Expected: `id: sporting-goods | hero cards: 4 | rentals: 2`

- [ ] **Step 3: Commit**

```bash
git add demo_api_server/config/verticals/sporting-goods.json
git commit -m "feat(verticals): sporting-goods — add hero, heroStats, rentals mockData, rewrite llmChipGroups"
```

---

## Task 7: Update workforce.json — hero + mockData + llmChipGroups

**Files:**
- Modify: `demo_api_server/config/verticals/workforce.json`

- [ ] **Step 1: Replace the `dashboard` block**

Replace the entire `"dashboard"` key in `demo_api_server/config/verticals/workforce.json` with:

```json
"dashboard": {
  "kind": "workforce",
  "chips": [
    { "key": "balance",      "label": "PTO Balance"         },
    { "key": "accounts",     "label": "My Benefits"         },
    { "key": "transactions", "label": "Request History"     },
    { "key": "transfer",     "label": "Submit Request"      },
    { "key": "feature",      "label": "Show Expense Report" }
  ],
  "hero": {
    "cards": [
      { "label": "Next Pay Date",     "dataKey": "heroStats.nextPayDate",      "format": "date"  },
      { "label": "PTO Balance",       "dataKey": "heroStats.ptoBalance",       "format": "count" },
      { "label": "Open Enrollments",  "dataKey": "heroStats.openEnrollments",  "format": "count" },
      { "label": "Team Size",         "dataKey": "heroStats.teamSize",         "format": "count" }
    ]
  },
  "llmChipGroups": {
    "Pay": [
      { "id": "wf_payday",    "label": "Next payday",       "message": "When is my next payday?" },
      { "id": "wf_paystubs",  "label": "Recent pay stubs",  "message": "Show my last 3 pay stubs" }
    ],
    "Benefits": [
      { "id": "wf_enrolled",  "label": "My benefits",       "message": "What benefits am I enrolled in?" },
      { "id": "wf_enrollment","label": "Open enrollment",   "message": "When does open enrollment close?" }
    ],
    "Time Off": [
      { "id": "wf_pto",       "label": "PTO balance",       "message": "How much PTO do I have left?" },
      { "id": "wf_pending",   "label": "Pending requests",  "message": "Show my pending time-off requests" }
    ],
    "Team": [
      { "id": "wf_schedules", "label": "Team schedules",    "message": "Show my direct reports' schedules" },
      { "id": "wf_out",       "label": "Who's out?",        "message": "Who is out of office this week?" }
    ]
  },
  "mockData": {
    "heroStats": {
      "nextPayDate":     "2026-06-06",
      "ptoBalance":      14,
      "openEnrollments": 2,
      "teamSize":        8
    },
    "benefits": [
      { "id": "ben1", "name": "Medical",        "planType": "PPO",      "enrollmentStatus": "Enrolled",     "coverageTier": "Employee + Family", "nextRenewal": "2027-01-01" },
      { "id": "ben2", "name": "Dental",         "planType": "DPPO",     "enrollmentStatus": "Enrolled",     "coverageTier": "Employee Only",     "nextRenewal": "2027-01-01" },
      { "id": "ben3", "name": "Vision",         "planType": "VSP",      "enrollmentStatus": "Not Enrolled", "coverageTier": "—",                 "nextRenewal": "2027-01-01" },
      { "id": "ben4", "name": "401(k)",         "planType": "Roth",     "enrollmentStatus": "Enrolled",     "coverageTier": "6% contribution",   "nextRenewal": "—"         }
    ],
    "payrollHistory": [
      { "id": "pay1", "payPeriod": "2026-05-01 – 2026-05-15", "grossPay": 4166.67, "deductions": 1041.67, "netPay": 3125.00, "paymentMethod": "Direct Deposit" },
      { "id": "pay2", "payPeriod": "2026-04-16 – 2026-04-30", "grossPay": 4166.67, "deductions": 1041.67, "netPay": 3125.00, "paymentMethod": "Direct Deposit" },
      { "id": "pay3", "payPeriod": "2026-04-01 – 2026-04-15", "grossPay": 4166.67, "deductions": 1041.67, "netPay": 3125.00, "paymentMethod": "Direct Deposit" }
    ]
  }
}
```

- [ ] **Step 2: Validate**

```bash
node -e "const v = require('./demo_api_server/config/verticals/workforce.json'); console.log('id:', v.id, '| hero cards:', v.dashboard.hero.cards.length, '| benefits:', v.dashboard.mockData.benefits.length)"
```

Expected: `id: workforce | hero cards: 4 | benefits: 4`

- [ ] **Step 3: Commit**

```bash
git add demo_api_server/config/verticals/workforce.json
git commit -m "feat(verticals): workforce — add hero, mockData (benefits + payroll), rewrite llmChipGroups"
```

---

## Task 8: Result panel registry + healthcare panels

**Files:**
- Create: `demo_api_ui/src/components/resultPanels/registry.js`
- Create: `demo_api_ui/src/components/resultPanels/HealthcarePatientRecordsPanel.jsx`
- Create: `demo_api_ui/src/components/resultPanels/HealthcareBillingPanel.jsx`

- [ ] **Step 1: Create the registry**

```js
// demo_api_ui/src/components/resultPanels/registry.js
import HealthcarePatientRecordsPanel from './HealthcarePatientRecordsPanel';
import HealthcareBillingPanel from './HealthcareBillingPanel';
import RetailOrdersPanel from './RetailOrdersPanel';
import RetailPurchaseHistoryPanel from './RetailPurchaseHistoryPanel';
import WorkforceBenefitsPanel from './WorkforceBenefitsPanel';
import WorkforcePayrollPanel from './WorkforcePayrollPanel';

const RESULT_RENDERERS = {
  healthcare: {
    accounts:     HealthcarePatientRecordsPanel,
    transactions: HealthcareBillingPanel,
  },
  retail: {
    accounts:     RetailOrdersPanel,
    transactions: RetailPurchaseHistoryPanel,
  },
  workforce: {
    accounts:     WorkforceBenefitsPanel,
    transactions: WorkforcePayrollPanel,
  },
};

export function getRenderer(verticalId, resultType) {
  return RESULT_RENDERERS[verticalId]?.[resultType] ?? null;
}
```

- [ ] **Step 2: Create HealthcarePatientRecordsPanel**

```jsx
// demo_api_ui/src/components/resultPanels/HealthcarePatientRecordsPanel.jsx
import React from "react";

export default function HealthcarePatientRecordsPanel({ data, terminology }) {
  const records = Array.isArray(data) ? data : (data?.patientRecords || []);
  if (!records.length) return <p className="bar-rp-empty">No patient records found.</p>;

  return (
    <div className="bar-rp-cards">
      {records.map((r) => (
        <div key={r.id} className="bar-rp-card">
          <div className="bar-rp-card-header">
            <span className="bar-rp-card-title">{r.name}</span>
            <span className={`bar-rp-badge bar-rp-badge--${r.coverageStatus === "Active" ? "green" : "gray"}`}>
              {r.coverageStatus}
            </span>
          </div>
          <div className="bar-rp-card-row"><span>DOB</span><span>{r.dob}</span></div>
          <div className="bar-rp-card-row"><span>Provider</span><span>{r.provider}</span></div>
          <div className="bar-rp-card-row"><span>Coverage</span><span>{r.coverageType}</span></div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Create HealthcareBillingPanel**

```jsx
// demo_api_ui/src/components/resultPanels/HealthcareBillingPanel.jsx
import React from "react";

const STATUS_CLASS = { Paid: "green", Pending: "yellow", Denied: "red" };

export default function HealthcareBillingPanel({ data, terminology }) {
  const rows = Array.isArray(data) ? data : (data?.billingHistory || []);
  if (!rows.length) return <p className="bar-rp-empty">No billing history found.</p>;

  return (
    <table className="bar-rp-table">
      <thead>
        <tr>
          <th>Code</th>
          <th>Date</th>
          <th>Insurer</th>
          <th>Billed</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td><code>{r.procedureCode}</code></td>
            <td>{new Date(r.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</td>
            <td>{r.insurer}</td>
            <td>${Number(r.amountBilled).toFixed(2)}</td>
            <td>
              <span className={`bar-rp-badge bar-rp-badge--${STATUS_CLASS[r.status] || "gray"}`}>
                {r.status}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 4: Build to confirm no errors**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -20
```

Expected: exits 0 (registry + panels compile; BankingAgent not yet wired).

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/resultPanels/
git commit -m "feat(verticals): add result panel registry + healthcare panels"
```

---

## Task 9: Retail and workforce result panels

**Files:**
- Create: `demo_api_ui/src/components/resultPanels/RetailOrdersPanel.jsx`
- Create: `demo_api_ui/src/components/resultPanels/RetailPurchaseHistoryPanel.jsx`
- Create: `demo_api_ui/src/components/resultPanels/WorkforceBenefitsPanel.jsx`
- Create: `demo_api_ui/src/components/resultPanels/WorkforcePayrollPanel.jsx`

- [ ] **Step 1: Create RetailOrdersPanel**

```jsx
// demo_api_ui/src/components/resultPanels/RetailOrdersPanel.jsx
import React from "react";

const STATUS_CLASS = { Delivered: "green", Shipped: "blue", Processing: "yellow" };

export default function RetailOrdersPanel({ data, terminology }) {
  const orders = Array.isArray(data) ? data : (data?.orders || []);
  if (!orders.length) return <p className="bar-rp-empty">No orders found.</p>;

  return (
    <div className="bar-rp-cards">
      {orders.map((o) => (
        <div key={o.id} className="bar-rp-card">
          <div className="bar-rp-card-header">
            <span className="bar-rp-card-title">{o.product}</span>
            <span className={`bar-rp-badge bar-rp-badge--${STATUS_CLASS[o.status] || "gray"}`}>
              {o.status}
            </span>
          </div>
          <div className="bar-rp-card-row"><span>Order ID</span><span>{o.id}</span></div>
          <div className="bar-rp-card-row"><span>SKU</span><span>{o.sku}</span></div>
          <div className="bar-rp-card-row"><span>Total</span><span>${Number(o.amount).toFixed(2)}</span></div>
          <div className="bar-rp-card-row"><span>Date</span><span>{new Date(o.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span></div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create RetailPurchaseHistoryPanel**

```jsx
// demo_api_ui/src/components/resultPanels/RetailPurchaseHistoryPanel.jsx
import React from "react";

export default function RetailPurchaseHistoryPanel({ data, terminology }) {
  const items = Array.isArray(data) ? data : (data?.lineItems || []);
  if (!items.length) return <p className="bar-rp-empty">No purchase history found.</p>;

  return (
    <table className="bar-rp-table">
      <thead>
        <tr>
          <th>Product</th>
          <th>SKU</th>
          <th>Qty</th>
          <th>Unit Price</th>
          <th>Date</th>
        </tr>
      </thead>
      <tbody>
        {items.map((i) => (
          <tr key={i.id}>
            <td>{i.product}</td>
            <td><code>{i.sku}</code></td>
            <td>{i.quantity}</td>
            <td>${Number(i.unitPrice).toFixed(2)}</td>
            <td>{new Date(i.purchaseDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 3: Create WorkforceBenefitsPanel**

```jsx
// demo_api_ui/src/components/resultPanels/WorkforceBenefitsPanel.jsx
import React from "react";

const STATUS_CLASS = { Enrolled: "green", "Not Enrolled": "gray" };

export default function WorkforceBenefitsPanel({ data, terminology }) {
  const benefits = Array.isArray(data) ? data : (data?.benefits || []);
  if (!benefits.length) return <p className="bar-rp-empty">No benefits found.</p>;

  return (
    <div className="bar-rp-cards">
      {benefits.map((b) => (
        <div key={b.id} className="bar-rp-card">
          <div className="bar-rp-card-header">
            <span className="bar-rp-card-title">{b.name}</span>
            <span className={`bar-rp-badge bar-rp-badge--${STATUS_CLASS[b.enrollmentStatus] || "gray"}`}>
              {b.enrollmentStatus}
            </span>
          </div>
          <div className="bar-rp-card-row"><span>Plan</span><span>{b.planType}</span></div>
          <div className="bar-rp-card-row"><span>Coverage</span><span>{b.coverageTier}</span></div>
          <div className="bar-rp-card-row"><span>Renewal</span><span>{b.nextRenewal}</span></div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Create WorkforcePayrollPanel**

```jsx
// demo_api_ui/src/components/resultPanels/WorkforcePayrollPanel.jsx
import React from "react";

export default function WorkforcePayrollPanel({ data, terminology }) {
  const rows = Array.isArray(data) ? data : (data?.payrollHistory || []);
  if (!rows.length) return <p className="bar-rp-empty">No payroll history found.</p>;

  return (
    <table className="bar-rp-table">
      <thead>
        <tr>
          <th>Pay Period</th>
          <th>Gross</th>
          <th>Deductions</th>
          <th>Net</th>
          <th>Method</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td>{r.payPeriod}</td>
            <td>${Number(r.grossPay).toFixed(2)}</td>
            <td>${Number(r.deductions).toFixed(2)}</td>
            <td><strong>${Number(r.netPay).toFixed(2)}</strong></td>
            <td>{r.paymentMethod}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 5: Build to confirm no errors**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -20
```

Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/components/resultPanels/
git commit -m "feat(verticals): add retail + workforce result panels"
```

---

## Task 10: Add CSS for result panel cards + badges

**Files:**
- Modify: same CSS file identified in Task 1 Step 2 (contains `.bar-rp-*` rules)

- [ ] **Step 1: Add card and badge styles**

Append to the same CSS file that contains `.bar-rp-*`:

```css
/* ── Vertical result panel cards ── */
.bar-rp-cards {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.bar-rp-card {
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 12px 14px;
}

.bar-rp-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.bar-rp-card-title {
  font-weight: 600;
  font-size: 14px;
  color: #111827;
}

.bar-rp-card-row {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  padding: 2px 0;
  color: #374151;
}

.bar-rp-card-row span:first-child {
  color: #6b7280;
  font-weight: 500;
}

/* ── Status badges ── */
.bar-rp-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.bar-rp-badge--green  { background: #dcfce7; color: #166534; }
.bar-rp-badge--yellow { background: #fef9c3; color: #713f12; }
.bar-rp-badge--red    { background: #fee2e2; color: #991b1b; }
.bar-rp-badge--blue   { background: #dbeafe; color: #1e40af; }
.bar-rp-badge--gray   { background: #f3f4f6; color: #374151; }

/* ── Result panel table (shared) ── */
.bar-rp-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.bar-rp-table th {
  text-align: left;
  padding: 6px 8px;
  border-bottom: 2px solid #e5e7eb;
  color: #6b7280;
  font-weight: 600;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.bar-rp-table td {
  padding: 8px 8px;
  border-bottom: 1px solid #f3f4f6;
  color: #374151;
}

.bar-rp-empty {
  color: #9ca3af;
  font-size: 13px;
  padding: 12px 0;
}
```

- [ ] **Step 2: Build**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -20
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add demo_api_ui/src/App.css
git commit -m "feat(verticals): add CSS for result panel cards, badges, and tables"
```

---

## Task 11: Wire registry into BankingAgent result panel render

**Files:**
- Modify: `demo_api_ui/src/components/BankingAgent.js`

- [ ] **Step 1: Add import**

At the top of `BankingAgent.js`, after the existing `BankingChips` and `VerticalHero` imports, add:

```js
import { getRenderer } from "./resultPanels/registry";
```

- [ ] **Step 2: Add `themeId` to the `useTheme()` destructure**

Find the existing `useTheme()` destructure at line ~1641:

```js
  const {
    theme: appTheme,
    toggleTheme,
    agentAppearance,
    setAgentAppearance,
    effectiveAgentTheme,
    agent: themeAgent,
    manifest: themeManifest,
    terminology,
  } = useTheme();
```

Add `themeId` to it:

```js
  const {
    theme: appTheme,
    toggleTheme,
    agentAppearance,
    setAgentAppearance,
    effectiveAgentTheme,
    agent: themeAgent,
    manifest: themeManifest,
    terminology,
    themeId,
  } = useTheme();
```

- [ ] **Step 3: Hook registry into the result panel render**

Find the result panel body render at line ~1467:

```jsx
      <div className="bar-rp-body">
        {panel.type === "accounts" && <AccountsTable accounts={panel.data} terminology={panel.terminology} />}
        {panel.type === "transactions" && (
          <TransactionsTable transactions={panel.data} terminology={panel.terminology} />
        )}
```

Replace with:

```jsx
      <div className="bar-rp-body">
        {panel.type === "accounts" && (() => {
          const SpecializedPanel = getRenderer(themeId, "accounts");
          return SpecializedPanel
            ? <SpecializedPanel data={panel.data} terminology={panel.terminology} />
            : <AccountsTable accounts={panel.data} terminology={panel.terminology} />;
        })()}
        {panel.type === "transactions" && (() => {
          const SpecializedPanel = getRenderer(themeId, "transactions");
          return SpecializedPanel
            ? <SpecializedPanel data={panel.data} terminology={panel.terminology} />
            : <TransactionsTable transactions={panel.data} terminology={panel.terminology} />;
        })()}
```

- [ ] **Step 4: Build**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -20
```

Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/BankingAgent.js
git commit -m "feat(verticals): wire result panel registry into BankingAgent — specialized panels for healthcare, retail, workforce"
```

---

## Task 12: Final verification

- [ ] **Step 1: Start the server**

```bash
./run.sh
```

Wait for all services to report healthy.

- [ ] **Step 2: Verify banking vertical (unchanged)**

1. Open `https://api.ping.demo:4000`, log in as `demoUser / Tigers7&`
2. Confirm hero strip shows: Net Worth, Monthly Spend, Savings Rate, Credit Score
3. Click "My Accounts" chip — result panel shows existing generic AccountsTable (not a specialized panel)
4. LLM chip groups show: "Account Insights", "Spend Analysis", "Smart Actions"

- [ ] **Step 3: Switch to Healthcare and verify**

1. Switch vertical to CareConnect
2. Confirm hero strip shows: Next Appointment (Jun 3 2026), Active Prescriptions (3), Outstanding Balance ($142.50), Coverage Status (Active)
3. Click "My Records" chip — result panel shows `HealthcarePatientRecordsPanel` with patient record cards (not generic account rows)
4. Click "Appointments" chip — result panel shows `HealthcareBillingPanel` with procedure code, insurer, status badge
5. LLM chip groups show: "Appointments", "Prescriptions", "Billing", "Coverage" (not "Time-Based")

- [ ] **Step 4: Switch to Retail and verify**

1. Switch vertical to Great Buy
2. Confirm hero strip: Cart Value ($349.99), Pending Orders (2), Reward Points (4820), Last Order (Apr 23 2026)
3. Click "List My Orders" chip — result panel shows `RetailOrdersPanel` with order cards + status badges
4. LLM chip groups show: "Orders", "Products", "Returns", "Rewards"

- [ ] **Step 5: Switch to Sporting Goods and verify**

1. Switch vertical to Super Sports
2. Confirm hero strip: Gear Value ($644.00), Active Rentals (2), Loyalty Tier (Gold — amber color), Last Purchase (Apr 27 2026)
3. LLM chip groups show: "Gear", "Purchases", "Loyalty", "Recommendations"

- [ ] **Step 6: Switch to Workforce and verify**

1. Switch vertical to WX Workforce
2. Confirm hero strip: Next Pay Date (Jun 6 2026), PTO Balance (14), Open Enrollments (2), Team Size (8)
3. Click "My Benefits" chip — result panel shows `WorkforceBenefitsPanel` with benefit cards + enrollment badges
4. LLM chip groups show: "Pay", "Benefits", "Time Off", "Team"

- [ ] **Step 7: Switch back to Banking**

1. Switch back to Super Banking
2. Confirm dashboard looks identical to before — hero strip present, generic AccountsTable renders for accounts, "Account Insights" chip group present

- [ ] **Step 8: Final build check**

```bash
cd demo_api_ui && npm run build 2>&1 | tail -5
```

Expected: `Successfully compiled.` and exit 0.
