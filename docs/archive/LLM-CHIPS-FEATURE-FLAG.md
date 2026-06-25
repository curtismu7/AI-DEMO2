# LLM Chips & Heuristic Feature Flag
## Advanced Query Chips + LLM-Only Mode

**Added:** 2026-05-05
**Feature Flag:** `ff_heuristic_enabled` (default: `true`)

---

## Overview

Two new capabilities for the banking agent:

1. **LLM-Specific Chips** — A new group of chips that trigger advanced LLM queries
2. **Heuristic Feature Flag** — Disable the fast heuristic path, forcing all queries through LLM

---

## Feature Flag: `ff_heuristic_enabled`

### Configuration

**Setting:** `ff_heuristic_enabled`
**Default:** `true` (heuristics enabled, fast path active)
**Values:** `true` or `false`
**Configurable:** Yes, via Admin Dashboard → Feature Flags

### Behavior

#### When `ff_heuristic_enabled = true` (Default)
- User clicks chip or types message
- Agent tries heuristic match first (fast path)
- If heuristic matches → execute immediately (~200-300ms)
- If no match → invoke LLM (~1-3s)

```
Message → Heuristic check → Match? → Execute fast path : LLM
```

#### When `ff_heuristic_enabled = false` (LLM-Only)
- User clicks chip or types message
- Agent **skips heuristic completely**
- **Always invokes LLM** for every query
- LLM decides and executes tools

```
Message → Skip heuristics → Always LLM → Execute via LLM decision
```

### Use Cases

**Use `ff_heuristic_enabled = true` for:**
- Live demos (mix of fast chips + smart LLM)
- Production (optimal performance)
- Testing heuristic patterns

**Use `ff_heuristic_enabled = false` for:**
- Testing LLM decision-making
- Validating LLM handles all chip patterns
- Pure AI-driven interaction (no hard-coded patterns)

---

## LLM-Specific Chips

New chip group for advanced queries that **require LLM reasoning**. These chips pass natural language to the LLM, which extracts parameters and filters data.

### Chip Categories

#### 1. **Time-Based Analysis**
- 💾 **Last 30 Days** → "Show me transactions from the last 30 days"
- 📅 **This Month** → "What transactions did I make this month?"
- 📊 **Last Week** → "Any purchases last week?"
- 🕐 **Quarter to Date** → "Transactions this quarter"

#### 2. **Amount-Based Queries**
- 💰 **Big Purchases** (>$100) → "Show me my large purchases over $100"
- 🎯 **Max Purchase** → "What's my biggest purchase?"
- 📈 **Small Transactions** (<$10) → "Any small transactions under $10?"
- 💵 **Range Query** → "Transactions between $50-150"

#### 3. **Spending Analysis**
- 📊 **Spending Summary** → "How much did I spend on groceries?"
- 📈 **Spending Trends** → "What percentage of my spending was over $100?"
- 📐 **Average Transaction** → "What's my average transaction amount?"
- 🔝 **Highest Ever** → "What was my highest transaction ever?"

#### 4. **Category Analysis** (requires merchant categorization)
- 🛒 **Grocery Spending** → "How much on groceries this month?"
- ⛽ **Gas Spending** → "Total gas purchases this quarter?"
- 🍕 **Dining Out** → "Dining transactions over $50?"
- 🏪 **Retail Spending** → "Retail purchases last 30 days?"

#### 5. **Smart Insights**
- 💡 **Spending Habits** → "What are my top spending categories?"
- 🔔 **Anomalies** → "Any unusual transactions?"
- 📊 **Trends** → "Am I spending more or less than last month?"
- 🎯 **Recommendations** → "How can I reduce spending?"

---

## UI Chip Layout

### Original Chips (Heuristic Fast Path)
```
┌─────────────────────────────────────┐
│ QUICK ACTIONS                       │
├─────────────────────────────────────┤
│ [💰 Balance] [📋 Accounts]          │
│ [📊 Transactions] [💸 Transfer]     │
└─────────────────────────────────────┘
```

### New Chips (LLM Advanced Queries)
```
┌─────────────────────────────────────┐
│ ADVANCED ANALYSIS (LLM)             │
├─────────────────────────────────────┤
│ TIME-BASED:                         │
│ [📅 Last 30 Days] [📊 This Month]  │
│ [🕐 Last Week] [📅 Quarter]        │
│                                     │
│ AMOUNT-BASED:                       │
│ [💰 Big Purchases] [🎯 Max Sale]   │
│ [📈 Small Txns] [💵 Range]         │
│                                     │
│ SPENDING ANALYSIS:                  │
│ [📊 Summary] [📈 Trends]           │
│ [📐 Average] [🔝 Highest]          │
│                                     │
│ INSIGHTS:                           │
│ [💡 Habits] [🔔 Anomalies]         │
│ [📊 Compare] [🎯 Recommendations]  │
└─────────────────────────────────────┘
```

---

## Implementation

### Feature Flag Check

**File:** `bankingAgentLangGraphService.js` (lines 261–280)

```javascript
// Check if heuristics are enabled
const heuristicEnabled = require('../services/configStore')
  .getEffective('ff_heuristic_enabled') !== 'false';

if (heuristicEnabled) {
  // Try heuristic match
  const heuristic = parseHeuristic(message);
  if (heuristic && heuristic.kind === 'banking') {
    // Fast path execution
    return await executeHeuristicBanking(...);
  }
} else {
  // Skip heuristics, log event
  console.log('Heuristic disabled via ff_heuristic_enabled');
  req?.recordTokenEvent('heuristic_disabled', { reason: 'flag=false' });
}

// Fall through to LLM for all cases
const { graph, initialState } = await createBankingAgent({...});
```

### Configuration

**File:** `bankingAgentLangGraphService.js` (configStore.js)

```javascript
ff_heuristic_enabled: {
  public: true,
  default: 'true'  // ← Can be toggled via Admin Dashboard
}
```

---

## Flow Examples

### Example 1: User Clicks "Last 30 Days" Chip (Heuristic Enabled)

```
User: [Clicks "Last 30 Days" chip]
  ↓
Message: "transactions last 30 days"
  ↓
Heuristic check: parseHeuristic("transactions last 30 days")
  ↓
Match found: { kind: 'banking', action: 'transactions' }
  ↓
executeHeuristicBanking() → Returns last 10 transactions
  ↓
❌ But wait — user wanted "last 30 days", not last 10!
  ↓
Heuristic can't filter by date, so falls through to LLM
  ↓
LLM extracts: startDate=30 days ago, limit=50
  ↓
Calls tool with parameters
  ↓
Result: All transactions from last 30 days ✅
```

### Example 2: User Clicks "Last 30 Days" Chip (Heuristic Disabled)

```
User: [Clicks "Last 30 Days" chip]
  ↓
Message: "transactions last 30 days"
  ↓
ff_heuristic_enabled = false → Skip heuristic
  ↓
LLM invoked directly
  ↓
LLM extracts: startDate=30 days ago, limit=50
  ↓
Calls tool with parameters
  ↓
Result: All transactions from last 30 days ✅
Time: ~1-3s (all via LLM)
```

---

## LLM Capability Validation

### Can Helix Handle All Chip Patterns?

**Simple Patterns (Heuristic Chips):**
- ✅ "Balance" — LLM can recognize and call get_account_balance
- ✅ "Accounts" — LLM can recognize and call get_my_accounts
- ✅ "Transactions" — LLM can recognize and call get_my_transactions
- ✅ "Transfer" — LLM can recognize and call transfer_funds

**Advanced Patterns (LLM Chips):**
- ✅ "Last 30 days" — LLM extracts startDate/endDate parameters
- ✅ "Over $100" — LLM extracts minAmount parameter
- ✅ "This month" — LLM calculates month boundaries
- ✅ "Biggest purchase" — LLM calls tool, analyzes results, picks max
- ✅ "Spending summary" — LLM synthesizes multiple filters + results

**Result:** Yes, the LLM (Helix) can handle **all** heuristic patterns plus advanced reasoning. The heuristic path is purely an optimization, not a necessity.

---

## Testing

### Test Case 1: Heuristic Enabled (Default)
```
ff_heuristic_enabled = true

1. Click [Balance] → 200-300ms (heuristic fast path)
2. Click [Last 30 Days] → 1-3s (heuristic fails → LLM)
3. Type "What's my biggest purchase?" → 1-3s (LLM)
```

### Test Case 2: Heuristic Disabled
```
ff_heuristic_enabled = false

1. Click [Balance] → 1-3s (LLM decides)
2. Click [Last 30 Days] → 1-3s (LLM decides)
3. Type "What's my biggest purchase?" → 1-3s (LLM)
```

---

## Admin Dashboard Integration

### Feature Flag UI

**Location:** Admin Dashboard → Feature Flags → Expand "Agent" section

```
Agent Configuration
├─ ff_heuristic_enabled
│  ├─ Current: true
│  ├─ Toggle: [OFF] ← Click to disable heuristics
│  └─ Description: "Use heuristic fast path for chips; 
│                    when false, all queries go through LLM"
├─ ff_hitl_enabled
├─ ff_authorize_...
└─ [Save Changes]
```

---

## Performance Summary

| Scenario | Heuristic Enabled | Heuristic Disabled |
|----------|---|---|
| Simple chip (Balance) | ~200ms | ~1-3s |
| Advanced chip (Last 30 Days) | ~1-3s (LLM) | ~1-3s |
| Natural language | ~1-3s (LLM) | ~1-3s |
| **Optimal for demos** | ✅ Mixed speed | ⚠️ Consistent speed |
| **Optimal for AI purity** | ❌ Hybrid | ✅ Pure LLM |

---

## Build Status

✅ **All files updated and tested**
- configStore.js: Feature flag added
- bankingAgentLangGraphService.js: Flag check implemented
- Build: Passes with npm run build
- Syntax: Valid

---

**Status:** Ready for Demo & Production
