# AI Transaction Intent Binding & Drift Prevention — Research Report

**Date:** 2026-07-12
**Method:** Deep-research workflow (5 search angles → 22 sources fetched → 107 claims extracted → top 25 adversarially verified with 3-vote consensus) + a separate open-source-landscape sweep.
**Note on provenance:** the deep-research workflow's final auto-synthesis step returned malformed placeholder output (a bug — `"summary":"test"`, `"claim":"test claim"`). The underlying search/fetch/verify work (104 subagents, real sources, real 3-vote adversarial checks) completed correctly and is intact in the run's raw journal. This report was reconstructed by hand from that raw verified data — the 16 claims marked **Confirmed** below passed 3-0 or 2-1 adversarial verification against primary sources; the ones marked **Checked, not confirmed** were explicitly refuted (2+ of 3 votes) and are listed so they aren't mistakenly reused later. Claims from source clusters that weren't in the top-25 sampled for verification (Visa TAP / Mastercard Agent Pay specifics, most of the x402/ACP detail) are marked **Unverified in this pass** — well-documented publicly, but not independently fact-checked here.

---

## 1. Comparison table

| Approach | What "intent" is | Binding mechanism | Drift detection point | On mismatch | Standards basis | Open source? |
|---|---|---|---|---|---|---|
| **Google AP2** | A signed **Intent Mandate** (user's natural-language request or, for unattended tasks, explicit rules-of-engagement: price cap, timing, conditions) | **Verifiable Credential**, cryptographically signed; a **Cart Mandate** signed on user approval must chain back to it; a **Payment Mandate** derives a minimal hashed subset for the network | Structural — a tampered Cart/Payment Mandate fails signature/hash verification against the original Intent Mandate | Hard deny (signature/hash check fails) | No RFC; industry protocol (Google-led, 60+ partners incl. Mastercard, PayPal, Coinbase) | **Yes** — [github.com/google-agentic-commerce/AP2](https://github.com/google-agentic-commerce/AP2), reference SDK in Python/Go/Android |
| **OAuth Rich Authorization Requests (RFC 9396)** | A structured `authorization_details` JSON array (type, actions, locations, datatypes, identifier, privileges) — e.g. a `payment_initiation` object binding amount, currency, and creditor name | Requested at authorization time; RFC 9396 defines a worked payment-initiation example binding intent to specific transaction fields, not a generic scope string | At the resource server, by checking the token's bound `authorization_details` against the requested action | Spec-defined as a resource-server enforcement point; exact echo-back/binding guarantee **was not independently confirmed** in this pass (see caveats) | IETF RFC (standards-track) | Spec only — WG repo is draft text, no reference server |
| **OAuth Transaction Tokens (txn-token draft)** | A **`tctx`** (transaction context) claim carried in a short-lived, cryptographically signed (JWS) token | Must be passed **unmodified** through the downstream call chain — signature breaks if altered | Any hop that re-validates the JWS signature on the propagated token | Not confirmed in this pass — treat as spec detail requiring re-check | IETF draft (`draft-ietf-oauth-transaction-tokens`) — **not yet an RFC** | Spec only — no official reference implementation found |
| **Ping Identity's actual current model** | **Not** a natural-language purpose field or signed mandate. It's an **OAuth 2.0 Token Exchange (RFC 8693)** delegation token carrying `sub` (human), `act.sub` (agent), `scope`, `aud` | An agent gateway validates `act`, `sub`, `aud`, and checks the token carries the exact narrow `scope` (e.g. `account:read_balance`) needed for that specific action, before the backend executes it | **At the agent gateway**, per call, continuously (not one-time login auth) | Gateway denies if scope/aud/act don't match the requested action; separate human-in-the-loop step-up exists for actions Ping's platform classifies high-risk | RFC 8693 (Token Exchange) + Ping's own Runtime Identity product layer | Not open source (commercial product); conceptually close to what AI-DEMO2 already simulates |
| **Confused-deputy / prompt-injection framing** (CSA research) | N/A — this is the *problem statement*, not a solution | — | — | — | Security research, not a standard | — |

Two industry protocols (Visa Trusted Agent Protocol, x402) and one more (OpenAI/Stripe ACP) are covered in the open-source-landscape findings below but weren't in this pass's verified-claims sample — flagged as unverified-here, not as unreliable.

---

## 2. Confirmed findings (3-0 or 2-1 adversarial vote, from primary sources)

**AP2**
1. For real-time, human-present purchases, AP2 captures the user's natural-language request as an Intent Mandate; approving the resulting cart cryptographically signs a Cart Mandate creating an unchangeable record of exact items and price.
2. AP2 "Mandates" are tamper-proof, cryptographically-signed digital contracts (Verifiable Credentials) — the foundational evidence for every transaction.
3. For delegated/unattended tasks, the user signs a detailed Intent Mandate *upfront* specifying rules of engagement (price limits, timing, conditions); the agent can only auto-generate a Cart Mandate once those precise conditions are met. **Intent binding happens before execution and structurally constrains what the agent can autonomously do** — this is the core "no drift" guarantee.

**Transaction Tokens draft**
4. The token binds transaction context via a `tctx` claim that must be passed unmodified downstream through the call chain, JWS-signed to prevent tampering as it propagates across microservices.

**RFC 9396 (Rich Authorization Requests)**
5. Defines the `authorization_details` request parameter — a JSON array of structured objects (type, actions, locations, datatypes, identifier, privileges) — replacing/supplementing coarse scope strings.
6. Includes an explicit worked example for a `payment_initiation` type binding intent to a specific transaction amount, currency, and creditor name.

**Ping Identity's actual model**
7. Applies runtime (in-session) contextual authorization to *each agent action*, not one-time login auth — factoring in context, risk, and intent.
8. (Academic paper, not Ping) Proposes binding agent transaction intent via user-signed mandates with structured, quantifiable constraints (max amount, per-item cap, vendor, expiry) attached as proof-of-authorization at purchase time.
9. Ping's platform includes a human-in-the-loop step-up mechanism that dynamically triggers approval for actions it classifies high-risk/critical, embedded directly in agent workflows.
10. Ping's guidance recommends binding agent authorization to **scoped, temporary tokens** that explicitly define what the agent may do and on whose behalf — not broad/standing credentials.
11. Ping frames its agent monitoring as going beyond bot classification to continuously evaluate agent identity, behavior, *and intent*, to detect/block risky behavior in real time — a drift/anomaly-detection capability.
12. Ping's "Runtime Identity" extends identity/access controls past authentication into continuous authorization and enforcement.
13. **Ping's model does not bind "intent" as a natural-language field or signed mandate — it operationalizes intent as an OAuth 2.0 Token Exchange (RFC 8693) delegation token carrying `sub`, `act.sub`, `scope`, `aud`, validated by an agent gateway.**
14. **In Ping's own banking-chatbot worked example, drift/mismatch detection happens at the agent gateway**, which validates `act`, `sub`, `aud` and checks the token carries the exact narrow scope (e.g. `account:read_balance`) needed for that task, before the backend executes it.
15. Ping positions its offering as continuously verifying identity, context, and intent at every interaction — explicitly naming "intent" as a factor, but without defining it as a cryptographic artifact or bound mandate.

**Security framing**
16. Financial/authorization services face a "confused deputy" problem: they cannot verify an agent's request genuinely reflects human authorization rather than a hijacked/injected instruction. ([CSA research note](https://labs.cloudsecurityalliance.org/research/csa-research-note-ai-agent-confused-deputy-prompt-injection/))

## 3. Checked, not confirmed (explicitly refuted — do not reuse as fact)

- Transaction Tokens draft has an `agentic_ctx` claim describing high-level purpose (e.g. `"trade.stocks"`) — **refuted 0-3**.
- Transaction Token Service validates a `purp` claim as a logical subset of the original token's authority — **refuted 1-2**.
- Transaction Tokens define a required `scope` claim as the "closest analog to a verifiable intent artifact" — **refuted 0-3**.
- RFC 9396 requires the authorization server to cryptographically echo back/bind the exact granted `authorization_details` to the issued token — **refuted 0-3** (plausible-sounding but not what the verified sources support; treat the actual enforcement guarantee as an open question).
- The AP2-adjacent mandate-signing paper's on-chain smart-contract enforcement, and its "hard deny with no HITL" failure mode — both **refuted** (likely over-generalized from one paper).
- Ping's guide "prescribes CIBA or push step-up for high-risk actions" specifically — **refuted 0-3** (HITL step-up itself is confirmed at #9; the CIBA-specific framing is not).
- "Ping's drift detection is post-hoc/telemetry-based behavioral analytics" — **refuted 0-3** (contradicts #14 — Ping's actual mechanism is real-time gateway token validation, not post-hoc analytics).
- "Ping's official position: every agent is a first-class identity tied to a human owner" — **refuted 1-2** (directionally plausible, not well-corroborated as stated).

## 4. Open-source landscape (separate research pass)

| Project | Real OSS? | What "intent" means there | Fit |
|---|---|---|---|
| **AP2** — [github.com/google-agentic-commerce/AP2](https://github.com/google-agentic-commerce/AP2) | Yes, Apache-licensed samples + Python SDK | Signed Intent/Cart/Payment Mandate chain | **Best reference** for a mandate-chain pattern |
| **AgentWard** — [github.com/agentward-ai/agentward](https://github.com/agentward-ai/agentward) | Yes, small/active | LLM-judge checks tool-call args against the tool's declared purpose + session-level drift detection | Closest OSS for generic tool-call intent checking (not transaction-specific) |
| **MCP Gateway & Registry** — [github.com/agentic-community/mcp-gateway-registry](https://github.com/agentic-community/mcp-gateway-registry) | Yes, active (789★) | Coarse scope-based allow/deny at a gateway | Confirms "gateway as enforcement point" is a recognized OSS pattern, but no semantic intent matching |
| **Visa Trusted Agent Protocol** — [github.com/visa/trusted-agent-protocol](https://github.com/visa/trusted-agent-protocol) | Yes | Authenticates the *agent's identity* to merchants, not the transaction's purpose | Identity, not intent |
| **x402 (Coinbase)** | Yes | Signed payment authorization scoped to amount/payee (EIP-3009) | Published research shows signatures are context-agnostic — vulnerable to cross-request proof transplant; does not robustly prevent drift |
| RFC 9396 / GNAP / txn-tokens WG repos | No | — | Draft text only, no reference server |
| Mastercard Agent Pay | No | — | Closed spec; Mastercard has since joined AP2 |

## 5. Synthesis — what this means for AI-DEMO2

- **Ping's own real product already does something structurally similar to what AI-DEMO2 simulates**: an OAuth Token Exchange delegation token (`sub`/`act.sub`/`scope`/`aud`) validated at a gateway, per call, in real time — not a natural-language "intent" field. This is a strong argument for framing AI-DEMO2's new runtime work as **"here's how P1AZ + the MCP gateway implement this pattern"**, rather than inventing a novel mechanism.
- **Two credible, teachable models exist for the demo**, matching the requirement to cover at least two:
  - **AP2-style mandate chain** — a signed, structured intent object that constrains what can be constructed downstream (cart/payment must chain back to it). Best taught as "intent as a cryptographic constraint set up *before* execution."
  - **RFC 9396 Rich Authorization Requests** — `authorization_details` as a structured, transaction-scoped grant (e.g. `payment_initiation` with amount/currency/creditor), checked by the resource server at execution time. Best taught as "intent as fine-grained OAuth scope, checked at the gateway" — which maps directly onto AI-DEMO2's existing MCP gateway + P1AZ policy enforcement, and complements the existing Intent Bypass demo (which shows the DENY path when the gateway's intent→scope check fails).
- **The confused-deputy framing (#16)** is a good narrative hook for the learning page: explain *why* intent binding matters (an agent can be tricked into requesting something the human never asked for) before explaining *how* AP2/RAR/Ping's model solves it.
- **Caveat carried forward:** the RFC 9396 "server must echo back exact granted details" claim was refuted in this pass — don't assert that as a hard spec guarantee in the learning page without re-checking the RFC text directly.
