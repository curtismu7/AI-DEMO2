# Intent-Based Authorization Guide

## Overview

Intent-based authorization is a 3D risk gating system for AI agent actions in banking. Before the agent executes any tool, the system:

1. **Extracts intent** from the user's prompt (what action they want: transfer, balance, etc.)
2. **Scores confidence** based on natural language matching (0–1, higher = clearer intent)
3. **Scores risk** based on action type + transaction amount
4. **Checks authority** via agent delegation rules
5. **Makes a decision**: PERMIT (auto-approve), REQUIRES_CONSENT (ask user), or DENY (block)

This prevents accidental or confused agent executions that could move money without user understanding.

---

## Quick Start (Users)

### What You'll See

When you send a request to the agent:

- **High confidence + low risk**: ✅ Agent executes immediately, shows the result
- **Low confidence OR high amount**: ⚠️ Consent dialog appears with authorization details
- **Denied**: ❌ Agent refuses and explains why

### Example: Transfer Request

**You say:** "Transfer $100 from checking to savings"

1. System extracts: `intent: transfer, confidence: 0.95`
2. System scores: `risk: 0.2 (small amount), authority: 0.9 (you own both accounts)`
3. System decides: ✅ PERMIT (confidence 0.95 > 0.85 threshold, risk low, authority ok)
4. Agent executes immediately

**Consent Modal (if needed):**
```
Authorize Transfer

Amount: $100.00
From: Checking
To: Savings

────────────────────────────────────
Intent Authorization Analysis
Confidence: 92%  Risk: 35%  Authority: 95%

Decision: ⚠️ CONSENT REQUIRED
Reason: Low confidence on intent parsing; 
human verification recommended.
────────────────────────────────────

□ I have reviewed and authorize this action
```

---

## Configuration (Admins)

### Feature Flag

Toggle the entire feature on/off from the Config page:

```
Admin → Config → ff_intent_authorization_enabled: true
```

- **true** (default): Intent extraction + 3D gating active
- **false**: Intent extraction happens (for logging) but all intents auto-approved

### Thresholds

Customize the decision boundaries in Config:

| Setting | Default | Meaning |
|---------|---------|---------|
| `intent_min_confidence` | `0.85` | Min confidence to bypass consent. Below this → REQUIRES_CONSENT |
| `intent_requires_consent` | `transfer` | Comma-separated intent list that always requires consent (e.g. `transfer,withdraw`) |
| `intent_max_amount_low_confidence` | `100` | Max amount allowed without high confidence (high-confidence txns can be larger) |

**Example:** To require consent for all transfers regardless of confidence:

```
intent_requires_consent: transfer
```

To allow high-confidence transfers up to $500 without consent, but low-confidence only up to $50:

```
intent_min_confidence: 0.85
intent_max_amount_low_confidence: 50
```

(High-confidence transfer of $500 → PERMIT; low-confidence transfer of $500 → REQUIRES_CONSENT; low-confidence transfer of $50 → PERMIT)

---

## Architecture

### Three Dimensions of Authorization

#### 1. **Confidence** (Intent Understanding)
- **What it measures:** How clearly the system understood the user's intent
- **How it works:**
  - Semantic pattern matching on the prompt text
  - Transfer patterns: `"transfer $[amount] from [acct] to [acct]"` → high confidence
  - Balance queries: `"what is my balance"` → high confidence
  - Ambiguous: `"transfer"` alone → low confidence
- **Score:** 0–1, with semantic scoring (transfer match → 0.95, balance match → 0.85, unknown → 0.30)

#### 2. **Risk** (Transaction Profile)
- **What it measures:** How risky the transaction itself is
- **How it works:**
  - Amount-based: larger amounts = higher risk
  - Action-based: transfers = high-risk, balance queries = no risk
  - Velocity-based (future): repeated actions in short time = higher risk
- **Score:** 0–1, computed by `intentRiskScorer.scoreRisk(amount, type)`

#### 3. **Authority** (Agent Delegation)
- **What it measures:** Whether the agent has permission to act
- **How it works:**
  - Agent delegation chain: user → browser session → agent → MCP tool
  - Checks `may_act` claims in OAuth tokens
  - Verifies agent is authorized for this tool
- **Score:** 0–1, computed by `intentRiskScorer.scoreAuthorityBinding(agent, tool)`

### Decision Logic

The system combines all three into a verdict:

```javascript
// Pseudo-code
if (confidence > 0.85 && riskScore < 0.7 && authorityScore > 0.9) {
  decision = "PERMIT";  // ✅ Auto-approve
} else if (confidence < 0.85 || riskScore > 0.7 || (intent in requiresConsentList)) {
  decision = "REQUIRES_CONSENT";  // ⚠️ Ask the user
} else {
  decision = "DENY";  // ❌ Block the action
}
```

**Conservative behavior:** Borderline cases (e.g. high confidence but missing authority) default to REQUIRES_CONSENT rather than auto-deny.

---

## Observability

### Event Logging

Every authorization decision is logged to the audit trail. View decisions via the Event Viewer:

```bash
Admin → Logs → Category: intent_auth
```

Each event includes:

```json
{
  "category": "intent_auth",
  "level": "info",
  "action": "authorize_intent",
  "details": {
    "intent": "transfer",
    "confidence": 0.95,
    "riskScore": 0.2,
    "authorityScore": 0.9,
    "decision": "PERMIT",
    "reason": "High confidence transfer, low risk, authority verified"
  },
  "timestamp": "2026-05-31T14:23:45Z"
}
```

### UI Display

When a user needs to approve a transaction via HITL consent:

1. Open the **Consent Modal** (appears on high-amount transfers)
2. Scroll down to **Intent Authorization Analysis** section
3. See three score badges:
   - **Confidence:** How clear the parsed intent was
   - **Risk:** How risky the transaction is
   - **Authority:** Whether the agent is permitted
4. **Decision reason** explains why consent is needed

---

## Troubleshooting

### "Agent seems slow or unresponsive"

Check if intent extraction is causing latency:

1. Go to Config and set `ff_intent_authorization_enabled: false`
2. Test the agent again
3. If it's faster: intent auth is working but may need tuning
4. If it's the same: problem is elsewhere

### "Transfer always requires consent, even small amounts"

Check these in order:

1. **Feature flag on?** → Config → `ff_intent_authorization_enabled: true`
2. **Confidence threshold too high?** → Config → try `intent_min_confidence: 0.75`
3. **Transfer in requires_consent list?** → Config → `intent_requires_consent: ` (remove "transfer" if it's there)
4. **Amount exceeds low-confidence threshold?** → Config → `intent_max_amount_low_confidence: 100` (try raising this)

### "I see 'intent: unknown' in the decision"

The system didn't recognize the user's prompt as a banking action. Examples:

- User said: "Do something with my account" (vague)
- System parsed: `intent: unknown, confidence: 0.30`
- Fix: Have the user be more specific ("Check my balance" / "Transfer $50")

---

## Implementation Details

### Files Involved

| File | Role |
|------|------|
| `demo_api_server/services/nlIntentParser.js` | Extracts intent from prompt text + semantic confidence scoring |
| `demo_api_server/services/intentRiskScorer.js` | Computes risk + authority scores |
| `demo_api_server/services/intentAuthService.js` | Combines all three scores into a decision |
| `demo_api_server/routes/agentInvokeRoute.js` | Entry point (`/api/agent/invoke`) — calls intent auth before agent runs |
| `demo_api_ui/src/components/IntentAuthDecisionDisplay.js` | UI component to show scores + reasoning in consent modal |

### Supported Intents

Currently recognized:

- `transfer` — move money between accounts
- `deposit` — add money to an account
- `withdraw` — remove money from an account
- `get_balance` — check account balance
- `get_transactions` — view transaction history
- `unknown` — prompt didn't match any pattern

Custom intents can be added by extending the pattern matching in `nlIntentParser.js`.

---

## Industry Standards

This implementation is inspired by industry best practices:

- **RFC 8693** — OAuth 2.0 Token Exchange (delegation chain)
- **RFC 9396** — Rich Authorization Requests (structured intent)
- **Google AP2** — Agent Payments Protocol (consent + delegation)
- **Mastercard Verifiable Intent** — Tokenized authorization of financial intent
- **Know Your Agent (KYA)** — Identity binding + runtime controls for agents
- **FIDO Alliance** — Agentic Commerce standards

For more, see **Admin → Learn → Intent Authorization Standards** in the app.

---

## Limitations & Future Work

### Current Limitations

1. **Confidence is pattern-based** — future versions will use LLM-generated confidence scores
2. **Risk scoring is simple** — no velocity detection, no behavioral anomaly scoring
3. **Authority is basic** — checks agent delegation chain but not per-tool fine-grained permissions
4. **No override mechanism** — admins cannot temporarily disable intent auth for a specific user

### Planned Enhancements

- [ ] LLM confidence: ask the LLM "how confident are you in this action?" post-inference
- [ ] W3C Verifiable Credentials: cryptographic proof of intent + authority
- [ ] KYA passport binding: agent identity verification + risk scoring
- [ ] Per-tool permission scopes: "agent A can transfer, but not withdraw"
- [ ] Behavioral scoring: detect out-of-pattern transactions (unusual amounts/recipients)
- [ ] Manual override: admin approval exception for specific transactions

---

## Questions?

See the **Learn panel** in the app (Admin → Learn → Intent Authorization Standards) for:
- RFC foundations
- Industry standards & examples
- Our 3D implementation approach
- Known gaps & enhancement roadmap
