# Admin Banking Chips Configuration
## Heuristic & LLM Chip Management

**Added:** 2026-05-05
**Audience:** Admin Dashboard, Feature Management
**Related:** DUAL-PATH-ARCHITECTURE.md, LLM-CHIPS-FEATURE-FLAG.md

---

## Overview

Two categories of banking chips that admins can configure:

1. **Heuristic Banking Chips** — Fast, pattern-matched responses (~200-300ms)
2. **LLM Banking Chips** — AI-powered analysis with parameter extraction (~1-3s)

---

## Heuristic Banking Chips

### Purpose
Direct, instant execution using keyword pattern matching. No LLM latency.

### Available Chips

| Chip | Trigger Phrase | Tool Called | Response Time |
|------|---|---|---|
| **Check Balance** | "balance", "my balance" | `get_account_balance` | ~200-300ms |
| **My Accounts** | "accounts", "my accounts" | `get_my_accounts` | ~200-300ms |
| **Recent Transactions** | "transactions", "recent" | `get_my_transactions` (last 10) | ~200-300ms |
| **Transfer Funds** | "transfer", "send money" | `transfer_funds` | ~200-300ms (+ HITL) |

### Implementation

**Pattern Matching:** `nlIntentParser.js`
```javascript
const heuristic = parseHeuristic(message);
// Matches: "balance" → { kind: 'banking', action: 'balance' }
//          "accounts" → { kind: 'banking', action: 'accounts' }
//          "transactions" → { kind: 'banking', action: 'transactions' }
//          "transfer" → { kind: 'banking', action: 'transfer' }
```

**Execution:** `bankingAgentLangGraphService.js`
```javascript
if (heuristicEnabled) {
  const heuristic = parseHeuristic(message);
  if (heuristic && heuristic.kind === 'banking') {
    return executeHeuristicBanking(heuristic, ...);
  }
}
```

### Admin Control

**Feature Flag:** `ff_heuristic_enabled`

**Admin Dashboard Location:**
```
Settings → Feature Flags → Agent Configuration
├─ ff_heuristic_enabled
│  ├─ [ON/OFF] Toggle
│  ├─ Current: true
│  └─ When OFF: All queries use LLM (pure AI mode)
```

### Adding New Heuristic Chips

To add a new heuristic chip (e.g., "Deposit"):

1. **Update `nlIntentParser.js`**
   ```javascript
   if (text.match(/deposit|make.*deposit|add.*money/i)) {
     return { kind: 'banking', banking: { action: 'deposit', params: {} } };
   }
   ```

2. **Update `bankingAgentLangGraphService.js`**
   ```javascript
   if (action === 'deposit') {
     // Call deposit tool
   }
   ```

3. **Add UI Button**
   ```jsx
   <button onClick={() => sendToAgent({ message: "deposit" })}>
     💸 Make Deposit
   </button>
   ```

---

## LLM Banking Chips

### Purpose
Advanced analysis requiring natural language reasoning, parameter extraction, and synthesis.

### Chip Groups

#### Group 1: Time-Based Analysis
| Chip | Query | Tool Parameters | Processing |
|------|-------|---|---|
| **Last 30 Days** | "Transactions from last 30 days" | startDate, endDate | LLM extracts dates |
| **This Month** | "What transactions this month?" | startDate (1st), endDate (today) | LLM calculates month |
| **Last Week** | "Purchases last week?" | startDate (-7d), endDate | LLM calculates week |
| **Quarter to Date** | "Q2 transactions?" | startDate (Q start), endDate | LLM calculates quarter |

#### Group 2: Amount-Based Queries
| Chip | Query | Tool Parameters | Processing |
|------|-------|---|---|
| **Big Purchases** | "Large purchases over $100" | minAmount: 100 | LLM filters by amount |
| **Max Purchase** | "What's my biggest purchase?" | limit: 100 | LLM analyzes, finds max |
| **Small Transactions** | "Transactions under $10?" | maxAmount: 10 | LLM filters amount |
| **Range Query** | "Between $50-150?" | minAmount: 50, maxAmount: 150 | LLM filters range |

#### Group 3: Spending Analysis
| Chip | Query | Tool Parameters | Processing |
|------|-------|---|---|
| **Spending Summary** | "Grocery spending this month?" | startDate, category filter | LLM synthesizes category |
| **Spending Trends** | "Spending % over $100?" | multiple filters | LLM calculates ratio |
| **Average Transaction** | "Average transaction amount?" | limit: 50 | LLM calculates average |
| **Highest Ever** | "Biggest transaction?" | limit: 100 | LLM finds superlative |

#### Group 4: Category Analysis
| Chip | Query | Tool Parameters | Processing |
|------|-------|---|---|
| **Grocery Spending** | "How much on groceries?" | category: grocery | LLM filters by merchant |
| **Gas Spending** | "Gas purchases this quarter?" | category: fuel | LLM filters by category |
| **Dining Out** | "Dining over $50?" | category: dining, minAmount: 50 | LLM multi-filters |
| **Retail Spending** | "Retail last 30 days?" | category: retail, date range | LLM synthesizes |

#### Group 5: Smart Insights
| Chip | Query | Tool Parameters | Processing |
|------|-------|---|---|
| **Spending Habits** | "Top spending categories?" | analyze all | LLM categorizes, ranks |
| **Anomalies** | "Unusual transactions?" | analyze all | LLM detects outliers |
| **Trends** | "Spending vs. last month?" | date comparisons | LLM compares periods |
| **Recommendations** | "How reduce spending?" | analyze patterns | LLM suggests actions |

### Implementation

**Trigger:** `bankingAgentLangGraphService.js`
```javascript
// LLM chips use natural language
// User clicks: [Last 30 Days] chip
// Message sent: "transactions from the last 30 days"
//
// Heuristic: No match (heuristic can't parse date math)
// → Falls through to LLM
// → LLM extracts: startDate, endDate, limit
// → Calls get_my_transactions(startDate, endDate, limit)
// → Synthesizes result
```

### Admin Control

**Feature Flag:** `ff_heuristic_enabled`

When `ff_heuristic_enabled = true`:
- LLM chips trigger when heuristic doesn't match
- Optimal performance (fast chips + smart LLM)

When `ff_heuristic_enabled = false`:
- LLM chips always invoke LLM
- Pure AI-driven mode (all queries via LLM)

**Admin Dashboard:**
```
Settings → Feature Flags → Agent Configuration
├─ ff_heuristic_enabled
│  ├─ [ON] ← LLM chips use fallback path
│  ├─ [OFF] ← LLM chips use direct LLM path
│  └─ Description: When OFF, all queries go through LLM
```

### Adding New LLM Chips

New LLM chips require:

1. **Enhanced Tool Schema** (already done)
   - `get_my_transactions` supports: startDate, endDate, minAmount, maxAmount, limit
   - (Could extend: add category, merchant filters)

2. **UI Button**
   ```jsx
   <button onClick={() => sendToAgent({ 
     message: "Show transactions over $100 last month",
     chipType: "llm"  // Optional: for tracking
   })}>
     💰 Big Purchases
   </button>
   ```

3. **Optional: Chip Metadata** (future enhancement)
   ```javascript
   const llmChips = [
     {
       id: 'last_30_days',
       label: 'Last 30 Days',
       query: 'Show me transactions from the last 30 days',
       icon: '📅',
       category: 'time-based',
       requiresAuth: true,
       avgLatency: '1-3s',
       enabled: true
     },
     // ... more chips
   ];
   ```

---

## UI Layout: Admin Dashboard

### Chips Configuration Page

```
Banking Agent → Chips Management
├────────────────────────────────────────────────
│ HEURISTIC CHIPS (Fast Path ~200-300ms)
├────────────────────────────────────────────────
│ 
│ Quick Actions (Always Fast)
│ [Enable] [✓] Check Balance      Pattern: balance
│ [Enable] [✓] My Accounts        Pattern: accounts
│ [Enable] [✓] Transactions       Pattern: transactions
│ [Enable] [✓] Transfer           Pattern: transfer
│
│ Feature Flag: ff_heuristic_enabled
│ [ON/OFF Toggle] ← Master switch for all heuristics
│
├────────────────────────────────────────────────
│ LLM CHIPS (Smart Path ~1-3s)
├────────────────────────────────────────────────
│
│ TIME-BASED (Date reasoning)
│ [Enable] [✓] Last 30 Days       Query: last 30 days
│ [Enable] [✓] This Month         Query: this month
│ [Enable] [✓] Last Week          Query: last week
│ [Enable] [✓] Quarter to Date    Query: quarter
│
│ AMOUNT-BASED (Filtering)
│ [Enable] [✓] Big Purchases      Query: over $100
│ [Enable] [✓] Max Purchase       Query: biggest
│ [Enable] [✓] Small Txns         Query: under $10
│ [Enable] [✓] Range Query        Query: $50-150
│
│ SPENDING ANALYSIS (Synthesis)
│ [Enable] [✓] Summary            Query: how much on X
│ [Enable] [✓] Trends             Query: spending %
│ [Enable] [✓] Average            Query: average txn
│ [Enable] [✓] Highest            Query: biggest txn
│
│ CATEGORY ANALYSIS (Merchant-based)
│ [Enable] [✓] Grocery            Query: grocery spending
│ [Enable] [✓] Gas                Query: gas purchases
│ [Enable] [✓] Dining             Query: dining out
│ [Enable] [✓] Retail             Query: retail spending
│
│ INSIGHTS (AI-driven)
│ [Enable] [✓] Habits             Query: top categories
│ [Enable] [✓] Anomalies          Query: unusual txns
│ [Enable] [✓] Trends             Query: vs. last month
│ [Enable] [✓] Recommendations    Query: reduce spending
│
│ [Save Changes] [Reset Defaults]
│
└────────────────────────────────────────────────
```

---

## Feature Flag Effects

### When `ff_heuristic_enabled = true` (Default)

```
User clicks chip
  ↓
Message sent to agent
  ↓
Heuristic check
  ├─ Match found (simple chip) → Execute immediately (~200-300ms)
  └─ No match (LLM chip) → Invoke LLM (~1-3s)
```

**Performance:**
- Simple chips: ~200-300ms
- LLM chips: ~1-3s
- Mixed experience (best for demos)

### When `ff_heuristic_enabled = false`

```
User clicks chip
  ↓
Message sent to agent
  ↓
Skip heuristic check
  ↓
Always invoke LLM (~1-3s)
```

**Performance:**
- All chips: ~1-3s
- Consistent experience
- Pure AI-driven (no hard-coded patterns)

---

## Admin Recommendations

### For Live Demos
- **Keep `ff_heuristic_enabled = true`**
- Enable both chip groups
- Mix of fast (heuristic) + smart (LLM) responses
- Shows both speed AND intelligence

**Best Chips for Demo:**
1. Click [Check Balance] (fast, ~200ms)
2. Click [Last 30 Days] (smart, ~1-3s)
3. Click [Big Purchases] (smart, ~1-3s)
4. Type "How much on groceries?" (smart, ~1-3s)

### For Production
- **Recommend: `ff_heuristic_enabled = true`**
- Optimal performance (fast path for simple queries)
- Enable all chips (users choose speed or intelligence)
- Monitor LLM latency for advanced chips

### For AI-Only Testing
- **Set `ff_heuristic_enabled = false`**
- All queries through LLM
- Test LLM comprehensiveness
- Validate LLM can handle all chip patterns

---

## Monitoring

### Metrics to Track

**Heuristic Path:**
- Number of heuristic matches per day
- Response time for heuristic queries
- Heuristic → LLM fallthrough rate

**LLM Path:**
- Number of LLM invocations
- Average LLM latency
- Tool parameters extracted by LLM
- LLM error rate

**Feature Flag:**
- Toggling frequency
- Impact on response times
- User satisfaction with each mode

### Admin Dashboard Metrics

```
Agent Performance → Chips Analytics
├─ Heuristic Matches: 1,234/day (35%)
├─ LLM Invocations: 2,266/day (65%)
├─ Heuristic Latency: 245ms (avg)
├─ LLM Latency: 1,850ms (avg)
├─ LLM → Heuristic Fallthrough: 89/day (8%)
└─ Feature Flag State: ff_heuristic_enabled = true
```

---

## Summary Table

| Aspect | Heuristic Chips | LLM Chips |
|--------|---|---|
| **Speed** | ~200-300ms | ~1-3s |
| **Path** | Pattern matching | AI reasoning |
| **Complexity** | Simple queries | Complex analysis |
| **Customization** | Hard-coded patterns | Parameter extraction |
| **Maintainability** | Easy (add pattern) | Easy (LLM handles it) |
| **AI Purity** | ❌ Hybrid | ✅ Pure AI |
| **Demo Impact** | Fast/snappy | Impressive/intelligent |
| **Count** | 4 chips | 20+ chips |

---

**Status:** ✅ Ready for Admin Configuration
**Build:** Passing
**Feature Flag:** Available in Admin Dashboard
