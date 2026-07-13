# Token Exchange: Complete Learning Series

**Start here if you're new to token exchange in AI-DEMO2.**

---

## 📚 The Four Training Documents

### 1. [TOKEN_EXCHANGE_ARCHITECTURE.md](TOKEN_EXCHANGE_ARCHITECTURE.md)
**Deep-dive technical guide • 15-20 minutes**

For: Everyone who wants to understand the complete picture  
Read if: You're implementing features, reviewing PRs, or doing security audits

**Contains:**
- The problem we're solving (insecure vs secure patterns)
- 5-layer security model with diagrams
- Step-by-step code walkthrough with line numbers
- Role-specific guidance (security, developers, product, architects)
- Common mistakes to avoid
- Testing & verification procedures

**Key Takeaway:** User tokens are exchanged at the BFF layer, not at agent level.

---

### 2. [TOKEN_EXCHANGE_QUICK_REFERENCE.md](TOKEN_EXCHANGE_QUICK_REFERENCE.md)
**Quick lookup guide • 5 minutes**

For: Daily reference, troubleshooting, quick answers  
Bookmark this — you'll use it often

**Contains:**
- 30-second summary
- Visual flow diagrams
- Token comparison (user vs delegated)
- Code locations with exact line numbers
- Decision tree ("Is this secure?")
- Verification checklist
- Troubleshooting solutions
- Configuration options

**Key Takeaway:** Quick answers without having to re-read the full guide.

---

### 3. [TOKEN_EXCHANGE_DIAGRAM.md](TOKEN_EXCHANGE_DIAGRAM.md)
**Visual explanations • Mermaid diagrams**

For: Visual learners, presentations, documentation  
All diagrams are copy-paste ready

**Contains 9 diagrams:**
1. Simple flow overview
2. Detailed sequence diagram
3. Token comparison
4. Security layers model
5. Insecure vs secure patterns
6. Request/response flow
7. Permission model
8. Timeline visualization
9. Configuration decision tree

**Key Takeaway:** See the complete flow visually.

---

### 4. [TOKEN_EXCHANGE_ONBOARDING.md](TOKEN_EXCHANGE_ONBOARDING.md)
**Structured learning checklist • 1-2 hours**

For: New team members, comprehensive learning  
Complete all phases to become an expert

**Contains:**
- 6 learning phases (conceptual → implementation → testing)
- Role-specific deep dives (security, developers, product, architects)
- Knowledge check quiz
- Getting help guide
- What's next recommendations

**Key Takeaway:** Structured path from beginner to expert.

---

## 🎯 How to Use This Series

**Choose your path:**

### I'm completely new
1. Start: [30-second summary](TOKEN_EXCHANGE_QUICK_REFERENCE.md#30-second-summary)
2. Watch: [Simple flow diagram](TOKEN_EXCHANGE_DIAGRAM.md#simple-flow-diagram)
3. Follow: [TOKEN_EXCHANGE_ONBOARDING.md](TOKEN_EXCHANGE_ONBOARDING.md) Phase 1-2
4. Deep dive: [TOKEN_EXCHANGE_ARCHITECTURE.md](TOKEN_EXCHANGE_ARCHITECTURE.md)

### I need to review a PR
1. Check: [Decision tree](TOKEN_EXCHANGE_QUICK_REFERENCE.md#decision-tree-is-this-secure)
2. Reference: [Code locations](TOKEN_EXCHANGE_QUICK_REFERENCE.md#code-locations)
3. Verify: [Verification checklist](TOKEN_EXCHANGE_QUICK_REFERENCE.md#checklist-token-exchange-verification)
4. Deep dive: [Architecture guide](TOKEN_EXCHANGE_ARCHITECTURE.md) as needed

### I'm debugging an issue
1. Check: [Troubleshooting guide](TOKEN_EXCHANGE_QUICK_REFERENCE.md#troubleshooting)
2. Reference: [Code locations](TOKEN_EXCHANGE_QUICK_REFERENCE.md#code-locations)
3. Read: [Common mistakes](TOKEN_EXCHANGE_ARCHITECTURE.md#common-mistakes-to-avoid)

### I'm onboarding a new team member
1. Share: [TOKEN_EXCHANGE_ONBOARDING.md](TOKEN_EXCHANGE_ONBOARDING.md)
2. Provide: [Quick reference](TOKEN_EXCHANGE_QUICK_REFERENCE.md) as bookmark
3. Guide them through all 6 phases
4. Check their knowledge with the quiz

### I'm doing a security audit
1. Read: [Security guarantees](TOKEN_EXCHANGE_ARCHITECTURE.md#security-guarantees)
2. Verify: [Testing procedures](TOKEN_EXCHANGE_ARCHITECTURE.md#testing--verification)
3. Review: [Common mistakes](TOKEN_EXCHANGE_ARCHITECTURE.md#common-mistakes-to-avoid)
4. Check: [Troubleshooting](TOKEN_EXCHANGE_QUICK_REFERENCE.md#troubleshooting)

---

## ⚡ The 30-Second Version

```
User logs in → Browser gets session cookie (no token in JS)
              ↓
           BFF receives request (extracts user token from session)
              ↓
        BFF exchanges token (RFC 8693) at PingOne
              ↓
      BFF gets delegated token (scoped, expires 5min)
              ↓
    BFF sends delegated token to MCP (user token stays at BFF)
              ↓
     Agent receives delegated token only (limited scopes)
              ↓
       Gateway validates before tool execution
              ↓
   All agent actions auditable via act claim
```

**Key principle:** User token stays server-side, agent gets scoped token.

---

## 📖 Reading Recommendations by Role

| Role | Read | Bookmark |
|------|------|----------|
| 🔐 Security Engineer | [Architecture](TOKEN_EXCHANGE_ARCHITECTURE.md) → [Guarantees section](TOKEN_EXCHANGE_ARCHITECTURE.md#security-guarantees) → [Verification](TOKEN_EXCHANGE_ARCHITECTURE.md#testing--verification) | [Quick Ref](TOKEN_EXCHANGE_QUICK_REFERENCE.md) |
| 👨‍💻 Backend Developer | [Code Locations](TOKEN_EXCHANGE_QUICK_REFERENCE.md#code-locations) → [Step-by-step](TOKEN_EXCHANGE_ARCHITECTURE.md#how-it-works-step-by-step) → [Concrete example](TOKEN_EXCHANGE_ARCHITECTURE.md#concrete-example-get-accounts-flow) | [Quick Ref](TOKEN_EXCHANGE_QUICK_REFERENCE.md) |
| 🎯 Product Manager | [Problem](TOKEN_EXCHANGE_ARCHITECTURE.md#the-problem-were-solving) → [Why it matters](TOKEN_EXCHANGE_ARCHITECTURE.md#why-each-layer-matters) → [Comparison](TOKEN_EXCHANGE_ARCHITECTURE.md#comparison-insecure-vs-secure) | [Diagrams](TOKEN_EXCHANGE_DIAGRAM.md) |
| 🏗️ Architect | [Design principle](TOKEN_EXCHANGE_ARCHITECTURE.md#the-core-principle) → [Security model](TOKEN_EXCHANGE_DIAGRAM.md#security-layers-diagram) → [RFC 8693](https://tools.ietf.org/html/rfc8693) | [Architecture](TOKEN_EXCHANGE_ARCHITECTURE.md) |
| 🎓 New Team Member | All [6 phases](TOKEN_EXCHANGE_ONBOARDING.md#phase-1-conceptual-understanding-30-min) | [Quick Ref](TOKEN_EXCHANGE_QUICK_REFERENCE.md) |

---

## 🔗 Cross-Document Links

All four documents link to each other at the top for easy navigation.

Each document includes links to:
- Full architecture guide
- Quick reference
- Diagrams
- Onboarding checklist

---

## 📋 Quick Fact Check

**Verify you understand the basics:**

1. Where does token exchange happen?
   - ✅ At the BFF layer (Backend-for-Frontend)

2. What token does the agent receive?
   - ✅ Delegated token (scoped, expires ~5 min)

3. Can agent see the user's original token?
   - ✅ No (stays server-side in BFF session)

4. What is the `act` claim used for?
   - ✅ Proving which agent performed the action (auditing)

5. How long is delegated token valid?
   - ✅ ~5 minutes (short-lived to limit exposure)

6. Can agent bypass the gateway?
   - ✅ No (delegated token limits capabilities)

**Scoring:**
- 6/6 ✅ You're an expert
- 4-5/5 ✅ You understand the key concepts
- 2-3/5 🔄 Review phases 1-2 of onboarding
- 0-1/5 🔄 Start with the 30-second summary

---

## 🚀 Next Steps

After completing this series, you're ready to:

- ✅ Review PRs touching token exchange
- ✅ Debug authentication issues
- ✅ Implement new auth-dependent features
- ✅ Conduct security audits
- ✅ Onboard new team members (use the checklist!)

---

## 📚 Related Documentation

For deeper context:
- [REGRESSION_PLAN.md §1](../REGRESSION_PLAN.md) — Protected token exchange areas
- [RFC 8693](https://tools.ietf.org/html/rfc8693) — Token exchange standard (external)
- [RFC 8707](https://tools.ietf.org/html/rfc8707) — Resource indicators (external)
- [Token Chain Trace Rail](../docs/TOKEN_CHAIN_TRACE.md) — How to debug token flows

---

## ❓ Common Questions

**Q: Why not let the agent do token exchange?**  
A: Agents might be compromised. BFF is controlled infrastructure, it's the trusted boundary.

**Q: What if agent needs broader scopes?**  
A: Scopes are requested at login. Can't change per-tool; must be re-authorized by user.

**Q: Can agent see the user's original token?**  
A: No. BFF performs exchange, agent only gets delegated token.

**Q: How do I know exchange is happening?**  
A: Check Token Chain UI in the demo app, or review logs for "Token Exchange" messages.

**Q: What happens if exchange fails?**  
A: Tool call is denied. Check troubleshooting guide for solutions.

---

## 📞 Getting Help

- **Quick answers:** Check [Quick Reference](TOKEN_EXCHANGE_QUICK_REFERENCE.md)
- **Still stuck?** Review [Troubleshooting](TOKEN_EXCHANGE_QUICK_REFERENCE.md#troubleshooting)
- **Deep questions?** Read relevant section in [Architecture guide](TOKEN_EXCHANGE_ARCHITECTURE.md)
- **Team discussion?** Ask in #ai-demo2-dev Slack channel

---

**Last Updated:** 2026-07-13  
**Series Version:** 1.0  
**Status:** Complete & verified against AI-DEMO2 codebase
