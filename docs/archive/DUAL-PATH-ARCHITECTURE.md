# Dual-Path Agent Architecture
## Heuristic Fast Path (Chips) vs. LLM Path (Natural Language)

**Updated:** 2026-05-05
**Diagram:** i4ai-ref-arch.mmd (updated with alt/else blocks)

---

## Overview

The agent now supports two execution paths optimized for different use cases:

### Path A: Heuristic Fast Path (Chips) ⚡
- **Trigger:** User clicks a UI chip/button (e.g., "Check Balance", "Get Accounts")
- **Processing:** Agent recognizes action via keyword heuristic (instant)
- **LLM:** Skipped (no delay)
- **Result:** Fast response (demo-friendly)
- **Use case:** Quick actions, button-driven navigation

### Path B: LLM Path (Natural Language) 🧠
- **Trigger:** User types free-form natural language query
- **Processing:** Agent tries heuristic first, then invokes LLM if no match
- **LLM:** Invoked when heuristic doesn't recognize intent
- **Result:** Intelligent response to complex queries
- **Use case:** "What are my largest transactions?", "How much did I spend on groceries?"

---

## Implementation Details

### Heuristic Fast Path Flow

```
1. User clicks chip: "Check Balance"
2. Chatbot sends: { message: "balance", source: "chip" }
3. Agent.processAgentMessage()
4. parseHeuristic() matches "balance" → { kind: 'banking', action: 'balance' }
5. executeHeuristicBanking() called (instant)
6. Phase 2: Try tool with CC token
7. Result returned immediately (no LLM)
8. Chatbot displays: "Your balance is $2,450.32"
```

**Time:** ~200-300ms (network + token validation)

### LLM Path Flow

```
1. User types: "What's my current balance and recent transactions?"
2. Chatbot sends: { message: "What's my current balance...", source: "NL" }
3. Agent.processAgentMessage()
4. parseHeuristic() tries to match → kind: 'none' (no heuristic match)
5. createBankingAgent() invoked → LangGraph setup
6. LLM analyzes message + tool list
7. LLM decides: use get_account_balance + get_my_transactions
8. Tools executed (with Phase 2-3 token exchange as needed)
9. LLM synthesizes results into natural language
10. Chatbot displays: "Your checking account balance is $2,450.32. Recent transactions: ..."
```

**Time:** ~1-3s (network + LLM latency)

---

## Code Architecture

### Heuristic Recognition (`bankingAgentLangGraphService.js`)

```javascript
// Early-exit heuristic parsing
const heuristic = parseHeuristic(message);
if (heuristic && heuristic.kind === 'banking') {
  const heuristicResult = await executeHeuristicBanking(heuristic, userId, userToken, req, subjectToken);
  if (heuristicResult) {
    console.log('Heuristic matched:', heuristic.banking.action, '— skipping LLM');
    return heuristicResult; // ← Fast return, no LLM
  }
}

// Falls through to LLM only if heuristic returns null or can't execute
const { graph, initialState } = await createBankingAgent({...});
```

### Heuristic Patterns (`nlIntentParser.js`)

Recognizes:
- "balance", "check balance", "my balance" → action: `balance`
- "accounts", "my accounts", "show accounts" → action: `accounts`
- "transactions", "recent", "history" → action: `transactions`
- "transfer", "send money" → action: `transfer` (requires HITL consent)

### Tool Execution with Token Exchange (`agentToolExecutor.js`)

Both paths use the same tool executor which handles:
- **Phase 2:** Try with CC token only
- **Phase 2 Result:** If 403 requiresUserContext, return error
- **Phase 3:** If subject token provided, exchange via RFC 8693
- **Phase 3 Result:** Retry with delegated TX token

---

## Frontend Integration: Chips

### Chip Component

```jsx
<button onClick={() => {
  sendToAgent({
    message: "balance",  // Heuristic-recognizable keyword
    source: "chip",      // Optional: for logging
    chipAction: "check_balance"
  });
}}>
  💰 Check Balance
</button>
```

### Backend Recognition

The agent recognizes keywords and triggers heuristic fast path:

```javascript
const heuristic = parseHeuristic("balance");
// Returns: { kind: 'banking', banking: { action: 'balance', params: {} } }
```

---

## Demo Optimization

For live demos:

1. **Use chips for fast actions**
   - "Check Balance" chip → instant result
   - "Get Accounts" chip → instant result
   - "Recent Transactions" chip → instant result

2. **Natural language for complexity**
   - "Show me my largest transactions" → LLM synthesis
   - "How much did I spend last month?" → LLM calculation

3. **Authorization flows**
   - Both paths handle Phase 2-3 token exchange identically
   - Demo can show "Authorize" button when 403 requiresUserContext is returned

---

## Response Examples

### Heuristic Path Response (Fast)

```json
{
  "success": true,
  "reply": "Here are your accounts:\n\n• **Checking** (****5678) — **$2,450.32** USD\n• **Savings** (****9012) — **$10,500.00** USD",
  "toolsCalled": ["get_my_accounts"],
  "tokenEvents": [
    { "type": "tool_call_request_started", "toolName": "get_my_accounts" },
    { "type": "agent_authorization_check", "decision": "PERMIT" },
    { "type": "tool_call_success", "toolName": "get_my_accounts" }
  ]
}
```

### LLM Path Response (Synthesized)

```json
{
  "success": true,
  "reply": "You have two accounts: a Checking account with $2,450.32 and a Savings account with $10,500. Combined, you have $12,950.32 across both accounts.",
  "toolsCalled": ["get_my_accounts"],
  "tokenEvents": [
    { "type": "heuristic_no_match" },
    { "type": "llm_invoke", "model": "ollama/llama3.2" },
    { "type": "tool_call_request_started", "toolName": "get_my_accounts" },
    { "type": "agent_authorization_check", "decision": "PERMIT" },
    { "type": "tool_call_success", "toolName": "get_my_accounts" },
    { "type": "llm_synthesis", "inputTokens": 150, "outputTokens": 45 }
  ]
}
```

---

## Performance Characteristics

| Metric | Heuristic Path | LLM Path |
|--------|---|---|
| Response time | 200-300ms | 1-3s |
| Latency source | Network + auth | Network + LLM |
| Consistency | 100% (same result every time) | Variable (depends on LLM) |
| Complexity | Simple patterns only | Complex reasoning |
| Demo-friendly | ✅ Yes (fast, reliable) | ⚠️ Yes (intelligent, but slower) |

---

## LLM Prompts (Natural Language Examples)

With enhanced tools supporting date ranges and amount filtering, Helix can now handle these sophisticated queries:

### Date Range Queries

**"Show me transactions from the last 30 days"**
```
Helix extracts:
  - startDate: [30 days ago]
  - endDate: [today]
  - limit: 50

Response: "You had 12 transactions over the last 30 days:
  - May 3: Salary deposit +$2,500
  - May 1: Starbucks -$5.42
  - Apr 28: Target -$34.99
  - Apr 25: Gas station -$52.00
  ..."
```

**"What transactions did I make this month?"**
```
Helix extracts:
  - startDate: [first day of current month]
  - endDate: [today]

Response: Lists all May transactions with synthesis
```

**"Any purchases last week?"**
```
Helix extracts:
  - startDate: [7 days ago]
  - endDate: [today]

Response: Summarizes last week's activity
```

### Amount-Based Queries

**"Show me my large purchases over $100"**
```
Helix extracts:
  - minAmount: 100
  - limit: 50

Response: "You had 8 purchases over $100:
  - Electronics store: -$349.99 (May 3)
  - Grocery store: -$127.50 (Apr 30)
  - Restaurant: -$115.00 (Apr 28)
  ..."
```

**"What's my biggest purchase this month?"**
```
Helix extracts:
  - startDate: [first day of month]
  - limit: 50

Response: Analyzes and returns largest transaction:
"Your biggest purchase this month is Electronics store 
for $349.99 on May 3"
```

**"Any small transactions under $10?"**
```
Helix extracts:
  - maxAmount: 10
  - limit: 50

Response: "You had 5 transactions under $10:
  - Coffee shop: -$5.42
  - Vending machine: -$2.00
  ..."
```

### Combined Filters

**"Transactions between $50-150 last week?"**
```
Helix extracts:
  - startDate: [7 days ago]
  - minAmount: 50
  - maxAmount: 150
  - limit: 50

Response: Lists transactions in that range for that period
```

**"Show me all grocery spending over $50 in April"**
```
Helix extracts:
  - startDate: 2026-04-01
  - endDate: 2026-04-30
  - minAmount: 50

Response: Filters to grocery-related transactions (description 
based) over $50 in April
```

### Spending Analysis

**"How much did I spend on groceries last month?"**
```
Helix extracts:
  - startDate: [first day of previous month]
  - endDate: [last day of previous month]
  - limit: 50 (get all April transactions)

Response: Analyzes all April transactions, filters by merchant 
type, synthesizes: "You spent $287.50 on groceries in April 
across 8 purchases"
```

**"What was my highest transaction ever?"**
```
Helix extracts:
  - maxAmount: [high value]
  - limit: 100 (get all transactions)

Response: "Your largest transaction is Electronics store 
for $349.99 on May 3"
```

**"How many transactions over $100 this quarter?"**
```
Helix extracts:
  - startDate: [Q2 start]
  - minAmount: 100
  - limit: 50

Response: "You had 8 high-value transactions over $100 
in Q2 2026"
```

### Advanced Synthesis

**"When was my last large purchase?"**
```
Helix extracts:
  - minAmount: 100 (or context-based)
  - limit: 1 (most recent)

Response: "Your most recent large purchase was Electronics 
store for $349.99 on May 3"
```

**"What percentage of my spending last month was over $100?"**
```
Helix extracts:
  - startDate: [first of previous month]
  - endDate: [last of previous month]
  - limit: 50

Response: Analyzes all transactions, calculates percentage:
"42% of your April spending ($1,200 out of $2,857) was 
on purchases over $100"
```

**"What's my average transaction amount?"**
```
Helix extracts:
  - limit: 50 (get recent transactions)

Response: "Your average transaction is $87.50 across 
your last 50 transactions"
```

### Demo-Friendly Queries

Use these in live demos to show LLM intelligence:

```
1. "Last 30 days" (temporal reasoning)
2. "Over $100" (amount filtering)
3. "Last week's spending" (date math + synthesis)
4. "Biggest purchase ever" (superlative analysis)
5. "Spending between $50-150 last month" (complex filters)
6. "How much on groceries?" (category + analysis)
7. "My highest transaction" (value extraction)
8. "Transactions this month" (relative date parsing)
```

---

## Future Enhancements

1. **Chip customization:** Admin UI to add/remove chips based on available tools
2. **Heuristic learning:** Train patterns from user NL queries that should be chips
3. **Hybrid responses:** LLM synthesis of multiple heuristic tool results
4. **Caching:** Cache LLM decisions for similar queries to reduce latency
5. **Fallback:** If LLM is down, gracefully degrade to heuristic path only

---

## Diagram: Dual Path (i4ai-ref-arch.mmd)

```
alt Heuristic Fast Path (Chips)
    U->>CB: Click "Check Balance" chip
    CB->>A: Invoke check_balance directly (via heuristic)
    Note over A: Agent recognizes: action=balance
                No LLM needed — instant execution
else Natural Language Path
    U->>CB: "What is my current account balance and recent transactions?"
    CB->>A: Process user request via Agent
    Note over A: Agent parses heuristic first
                If no match: invoke LLM for decision
end
```

The diagram now clearly shows both paths, with the agent deciding which to take based on input type.

---

**Status:** ✅ Implemented and tested
**Code Files:** bankingAgentLangGraphService.js, nlIntentParser.js, agentToolExecutor.js
**Build:** Passing with npm run build
