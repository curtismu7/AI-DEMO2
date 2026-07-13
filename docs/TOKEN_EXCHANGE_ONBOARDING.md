# Token Exchange: Onboarding Checklist for New Team Members

> 📚 **Part of the Token Exchange Learning Series**  
> **Architecture Deep Dive?** [Full guide](TOKEN_EXCHANGE_ARCHITECTURE.md) • **Need Quick Ref?** [Quick reference](TOKEN_EXCHANGE_QUICK_REFERENCE.md) • **Visual Learner?** [See diagrams](TOKEN_EXCHANGE_DIAGRAM.md)

---

## Welcome! 🎉

This checklist helps new team members understand how token exchange works in AI-DEMO2 and why it's important for security. Expected time: **1-2 hours**.

---

## Phase 1: Conceptual Understanding (30 min)

- [ ] **Read:** [30-second summary](TOKEN_EXCHANGE_QUICK_REFERENCE.md#30-second-summary)
  - Goal: Understand the core principle
  - Check: Can you explain why agents don't get user tokens?

- [ ] **Watch:** Review the [simple flow diagram](TOKEN_EXCHANGE_DIAGRAM.md#simple-flow-diagram)
  - Goal: Visualize the complete flow
  - Check: Can you trace data from browser to agent?

- [ ] **Read:** [The Problem We're Solving](TOKEN_EXCHANGE_ARCHITECTURE.md#the-problem-were-solving)
  - Goal: Understand the security risk
  - Check: Why is the insecure pattern dangerous?

- [ ] **Read:** [The Secure Pattern](TOKEN_EXCHANGE_ARCHITECTURE.md#the-secure-pattern-token-exchange-at-the-bff)
  - Goal: See how we solved it
  - Check: Can you explain each layer?

---

## Phase 2: Deep Dive (45 min)

- [ ] **Read:** [Security Guarantees section](TOKEN_EXCHANGE_ARCHITECTURE.md#security-guarantees)
  - Goal: Understand what we protect
  - Check: List 3 things agents cannot do

- [ ] **Review:** [Token Comparison](TOKEN_EXCHANGE_QUICK_REFERENCE.md#key-tokens-explained)
  - Goal: Understand the difference between tokens
  - Check: What scopes does delegated token have?

- [ ] **Read:** [Step-by-Step section](TOKEN_EXCHANGE_ARCHITECTURE.md#how-it-works-step-by-step)
  - Goal: Understand the mechanics
  - Check: Where does token exchange happen?

- [ ] **Study:** [Concrete Example: "Get Accounts"](TOKEN_EXCHANGE_ARCHITECTURE.md#concrete-example-get-accounts-flow)
  - Goal: Trace a real request
  - Check: Can you describe each step in your own words?

- [ ] **Review:** [Code Locations](TOKEN_EXCHANGE_QUICK_REFERENCE.md#code-locations)
  - Goal: Know where to find the code
  - Check: Can you open each file and locate the functions?

---

## Phase 3: Technical Implementation (30 min)

- [ ] **Read:** [Browser-side code](TOKEN_EXCHANGE_ARCHITECTURE.md#step-2-browser-makes-tool-request)
  - File: `demo_api_ui/src/services/demoAgentService.js:280`
  - Check: Why does it use `credentials: "include"`?

- [ ] **Read:** [BFF handler](TOKEN_EXCHANGE_ARCHITECTURE.md#step-3-bff-receives-request--extracts-user-token)
  - File: `demo_api_server/server.js:1678`
  - Check: How does it extract the user token?

- [ ] **Read:** [Token exchange logic](TOKEN_EXCHANGE_ARCHITECTURE.md#step-4-bff-performs-rfc-8693-token-exchange)
  - File: `demo_api_server/services/agentMcpTokenService.js:953`
  - Check: What does `resolveMcpAccessTokenWithEvents()` return?

- [ ] **Read:** [Agent token handling](TOKEN_EXCHANGE_ARCHITECTURE.md#step-6-agent-receives-delegated-token)
  - File: `langchain_agent/src/agent/mcp_tool_provider.py`
  - Check: Does agent use user token or client credentials token?

---

## Phase 4: Security Review (15 min)

- [ ] **Review:** [Common Mistakes to Avoid](TOKEN_EXCHANGE_ARCHITECTURE.md#common-mistakes-to-avoid)
  - Goal: Learn what NOT to do
  - Check: Can you explain why each mistake is dangerous?

- [ ] **Read:** [Security Layers Diagram](TOKEN_EXCHANGE_DIAGRAM.md#security-layers-diagram)
  - Goal: Understand defense in depth
  - Check: What happens if one layer fails?

- [ ] **Understand:** [Permission Model](TOKEN_EXCHANGE_DIAGRAM.md#permission-model)
  - Goal: Know what BFF and Agent can/cannot do
  - Check: List 5 things agents cannot do

---

## Phase 5: Operational Knowledge (15 min)

- [ ] **Know:** [Default vs Bypass Modes](TOKEN_EXCHANGE_QUICK_REFERENCE.md#common-configurations)
  - Check: What configuration should production use?
  - Check: Why does bypass mode exist?

- [ ] **Learn:** [How to Verify Exchange](TOKEN_EXCHANGE_ARCHITECTURE.md#testing--verification)
  - Check: How would you confirm exchange is happening?
  - Check: Where would you find raw token leak evidence?

- [ ] **Review:** [Troubleshooting Guide](TOKEN_EXCHANGE_QUICK_REFERENCE.md#troubleshooting)
  - Goal: Know how to diagnose problems
  - Check: If agent has too much access, what's wrong?

---

## Phase 6: Role-Specific Deep Dives (10 min each)

**Pick your role(s):**

### 🔐 If You're a Security Engineer
- [ ] Read: [Security Guarantees](TOKEN_EXCHANGE_ARCHITECTURE.md#security-guarantees)
- [ ] Read: [Comparison: Insecure vs Secure](TOKEN_EXCHANGE_ARCHITECTURE.md#comparison-insecure-vs-secure)
- [ ] Review: [RFC 8693 spec](https://tools.ietf.org/html/rfc8693) (external link)
- [ ] Task: Audit current `ff_skip_token_exchange` config
- [ ] Check: Are delegated tokens being logged with raw JWTs?

### 👨‍💻 If You're a Backend Developer
- [ ] Read: [Code Locations](TOKEN_EXCHANGE_QUICK_REFERENCE.md#code-locations)
- [ ] Task: Open each file and trace one request
- [ ] Understand: How token exchange is called in the BFF
- [ ] Know: What `agentMcpTokenService.resolveMcpAccessTokenWithEvents()` does
- [ ] Review: Token event objects returned in responses

### 🎯 If You're a Product Manager
- [ ] Read: [Why Each Layer Matters](TOKEN_EXCHANGE_ARCHITECTURE.md#why-each-layer-matters)
- [ ] Understand: What users are protected from
- [ ] Know: Difference between user token and delegated token
- [ ] Review: Audit capabilities (act claim proving agent identity)

### 🏗️ If You're an Architect
- [ ] Read: [Design principle](TOKEN_EXCHANGE_ARCHITECTURE.md#the-core-principle)
- [ ] Study: [Layered security model](TOKEN_EXCHANGE_DIAGRAM.md#security-layers-diagram)
- [ ] Review: RFC 8693 standard compliance
- [ ] Understand: Defense-in-depth strategy
- [ ] Task: Map to your organization's security framework

---

## Testing Your Knowledge

### Quick Check (5 min)
Answer these without looking:

1. **Where is the user's token stored?**
   - Answer: BFF session (server-side), never sent to agent

2. **What token does the agent receive?**
   - Answer: Delegated token with narrowed scope and `act` claim

3. **Can an agent bypass the gateway?**
   - Answer: No, delegated token limits capabilities

4. **What does the `act` claim do?**
   - Answer: Proves which agent is acting, enables auditing

5. **How long is delegated token valid?**
   - Answer: ~5 minutes (short-lived to limit exposure)

**Scoring:**
- 5/5 ✅ Ready to work on auth flows
- 4/5 ✅ Ready with a mentor
- 3/5 or less 🔄 Review Phase 2-3 again

---

## Getting Help

### Questions?
- **"Is this secure?"** → Ask yourself: [Decision Tree](TOKEN_EXCHANGE_QUICK_REFERENCE.md#decision-tree-is-this-secure)
- **"Where's the code?"** → Check: [Code Locations](TOKEN_EXCHANGE_QUICK_REFERENCE.md#code-locations)
- **"How do I troubleshoot?"** → See: [Troubleshooting Guide](TOKEN_EXCHANGE_QUICK_REFERENCE.md#troubleshooting)
- **"What's the standard?"** → Read: [RFC 8693](https://tools.ietf.org/html/rfc8693)

### Still stuck?
- Ask your code-review buddy
- Open a discussion in #ai-demo2-dev
- Check the [Further Reading](TOKEN_EXCHANGE_ARCHITECTURE.md#further-reading) section

---

## What's Next?

After completing this checklist, you're ready to:

✅ Review PRs touching token exchange  
✅ Debug auth-related issues  
✅ Implement new token-dependent features  
✅ Audit security boundaries  
✅ Onboard the next team member (use this checklist!)

---

## Completion Checklist

- [ ] All 6 phases completed
- [ ] Can explain the flow in your own words
- [ ] Passed the Quick Check (≥3/5)
- [ ] Reviewed code for your role
- [ ] Bookmarked [Quick Reference](TOKEN_EXCHANGE_QUICK_REFERENCE.md) for daily use

**Congratulations!** 🎉 You're now part of the token exchange knowledge team.

---

## Keep Learning

**Next Topics:**
- Gateway authorization policies
- RFC 8693 advanced features
- Token chain tracing & debugging
- Compliance & audit logging
- Multi-agent orchestration

**Recommended Reading:**
- [Token Chain Trace Rail Documentation](../TOKEN_CHAIN_TRACE.md)
- [REGRESSION_PLAN.md §1](../REGRESSION_PLAN.md) - Protected token areas
- [RFC 8693](https://tools.ietf.org/html/rfc8693) - The standard
- [RFC 8707](https://tools.ietf.org/html/rfc8707) - Resource indicators

---

**Last Updated:** 2026-07-13  
**For questions:** See [Getting Help](#getting-help) section above
