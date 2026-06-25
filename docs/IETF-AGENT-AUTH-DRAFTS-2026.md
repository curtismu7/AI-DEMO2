# IETF Agent Authentication & Authorization Drafts — Research Document

**Status:** Research snapshot — April 2026. All documents referenced here are Internet-Drafts
and subject to change. None are published RFCs; none should be treated as stable specifications
for production use without verification against the IETF Datatracker.

---

## Naming Corrections

Before diving in, two corrections to commonly cited draft names:

| Name as Commonly Cited | What Is Actually on the IETF Tracker | Notes |
|---|---|---|
| draft-oauth-transaction-tokens-for-agents-**06** | Latest confirmed: **-04** | Active individual draft |
| draft-**singla**-agent-identity-protocol-00 | No "singla" author found; two competing AIP drafts exist (see §3) | Unverified name |

The remaining two names (`draft-ietf-oauth-transaction-tokens-08` and `draft-klrc-aiagent-auth-00`)
match the IETF Datatracker exactly.

---

## 1. draft-ietf-oauth-transaction-tokens-08 — Transaction Tokens (Txn-Tokens)

**Track:** IETF OAuth Working Group (oauth-wg). Standards Track.  
**Status as of April 2026:** WG Last Call ended **2026-04-10**. Progressing toward RFC publication.  
**Expires:** 3 September 2026.  
**Datatracker:** https://datatracker.ietf.org/doc/draft-ietf-oauth-transaction-tokens/

### What It Is

Txn-Tokens are a mechanism for propagating **user identity, workload identity, and authorization
context** across the internal call chain of a distributed system — microservice to microservice —
within a single trust domain. They are not designed for cross-domain federation and are not
specific to AI agents.

The motivating problem: when an external API request enters a system and fans out to multiple
internal services, each downstream service has no verifiable proof of who the original caller was
or what the original request authorized. Txn-Tokens solve this by creating a short-lived,
immutable, signed token that travels with the request.

### Core Architecture

**Trust Domain** — a logical grouping of workloads sharing a common security boundary. Each trust
domain using Txn-Tokens must have exactly one logical **Transaction Token Service (TTS)**.

**Workload** — any running software instance: a containerized microservice, a monolith, a managed
database. Not a user; not an agent specifically.

**Flow:**

```
External Request
      │
      ▼
  API Gateway ──(requests Txn-Token)──► Transaction Token Service (TTS)
      │                                          │
      │          ◄──(issues Txn-Token)───────────┘
      │
      ├──(Txn-Token attached)──► Service A
      ├──(Txn-Token attached)──► Service B
      └──(Txn-Token attached)──► Service C
```

The Txn-Token is **immutable** once issued — no service can modify it. If a downstream service
attempted to escalate privileges, it cannot alter the token that subsequent services receive.

### Required and Optional Claims

| Claim | Required? | Meaning |
|-------|-----------|---------|
| `iss` | REQUIRED | Issuing TTS |
| `iat` | REQUIRED | Issued-at time |
| `exp` | REQUIRED | Expiry (SHOULD be short-lived: seconds to minutes) |
| `txn` | REQUIRED | Unique transaction identifier |
| `sub` | REQUIRED | Subject of the original external request |
| `purp` | REQUIRED | Purpose string — specific intent of this transaction (e.g., `"trade.stocks"`) |
| `req_wl` | REQUIRED | Requesting workload that initiated the internal call |
| `rctx` | OPTIONAL | Request context — environmental values (IP, geolocation, device) |
| `tctx` | OPTIONAL | Transaction context — immutable business data for this transaction |
| `azd` | OPTIONAL | Authorization details — remains constant through the call chain |

### Relationship to RFC 8693

RFC 8693 is how you **get** a token from a user context to an agent context (delegation).
Txn-Tokens are how that context **travels internally** once inside the trust domain. They are
complementary, not competing: a Txn-Token may be minted from an RFC 8693 exchanged token, with
the `sub` and actor information carried forward.

### What It Does Not Address

- Cross-domain federation (the trust domain boundary is intentional)
- Agent-specific identity (no notion of AI agent vs. human; the for-agents extension adds this)
- First-party token exchange (that remains RFC 8693)

---

## 2. draft-oauth-transaction-tokens-for-agents-04 — Transaction Tokens For Agents

**Track:** Individual Submission (not yet adopted by a WG).  
**Confirmed latest version:** -04. Version -06 could not be verified on the IETF tracker as of
April 2026.  
**Datatracker:** https://datatracker.ietf.org/doc/draft-oauth-transaction-tokens-for-agents/

### What It Is

An extension to the base Txn-Token spec (§1) that adds **AI agent context** to the token. The
base spec treats all workloads uniformly; this extension acknowledges that an AI agent calling a
service on behalf of a user is a distinct identity pattern that needs explicit representation.

The existing Txn-Token framework does not provide adequate information about the AI agent's
identity or its initiating entity, limiting transaction traceability. With this extension,
Txn-Tokens carry agent identity information enabling better traceability for AI agent actions
across distributed service graphs.

### The Two New Top-Level Claims

**`actor`** — Identifies the AI agent performing the action. Contains:
- `agent_id` — the agent's identifier
- `version` — the agent's version string
- `deployment` — the deployment context (environment, region)

**`principal`** — Identifies the human or system entity on whose behalf the agent acts.
For fully autonomous agents operating without a delegating user, this field MAY be omitted.

**`agentic_ctx`** — Optional claim for additional agent-specific context.

### Example Token Body

```json
{
  "txn": "c2dc3992-2d65-483a-93b5-2dd9f02c276e",
  "sub": "api-gw.trust-domain.example",
  "aud": "https://trading.trust-domain.example/stocks",
  "iss": "https://txn-svc.trust-domain.example",
  "iat": 1697059200,
  "exp": 1697059500,
  "purp": "trade.stocks",
  "req_wl": "apigateway.trust-domain.example",
  "tctx": {
    "action": "BUY",
    "ticker": "MSFT",
    "quantity": "100"
  },
  "actor": {
    "agent_id": "agent-1234",
    "version": "v2.1.0",
    "deployment": "prod-us-east-1"
  },
  "principal": "user:alice@example.com"
}
```

### How This Differs From RFC 8693's `act` Claim

| Claim | Standard | Records |
|-------|----------|---------|
| `act` | RFC 8693 | Who performed the **token exchange** (actor at the delegation boundary) |
| `actor` | This draft | Which **agent instance** is executing this specific transaction |

These can be different entities and serve different audit purposes:
- `act` answers: who was authorized to act on the user's behalf at the OAuth layer?
- `actor` answers: which agent instance is currently executing this specific transaction?

### Maturity Concerns

As an individual draft not yet adopted by any working group, this extension is early-stage.
The base spec (§1) is far more stable. Claim names may change before standardization.
Implementations should treat this extension as experimental.

---

## 3. AIP — Agent Identity Protocol (Two Competing Drafts)

**Name as commonly cited:** draft-singla-agent-identity-protocol-00. This draft name could not
be confirmed on the IETF tracker. Two distinct Agent Identity Protocol drafts exist with
overlapping names and acronyms but different authors, approaches, and track statuses.

---

### 3a. draft-prakash-aip-00 — AIP: Verifiable Delegation for AI Agent Systems

**Author:** S. Prakash. Individual Submission. Informational intent.  
**Date:** 27 March 2026. Expires 28 September 2026.  
**Datatracker:** https://datatracker.ietf.org/doc/draft-prakash-aip/  
**Companion paper:** arXiv:2603.24775

#### What It Is

A protocol for verifiable, delegable identity for AI agents operating across MCP and A2A
protocols. The motivating observation (backed by a scan of approximately 2,000 MCP servers):
**all lacked authentication**. OAuth 2.1, recently added to MCP, covers single-hop
client-to-server auth but does not address multi-hop delegation chains. AIP fills this gap.

#### Invocation-Bound Capability Tokens (IBCTs)

The core artifact. An IBCT binds four properties into a single cryptographic token:

1. **Identity** — who the agent is
2. **Authorization** — what it is allowed to do
3. **Scope constraints** — limits that cannot be exceeded at any hop
4. **Provenance** — the full chain of delegation that led to this invocation

#### Two Token Modes

**Compact mode** — JWT with Ed25519 signatures. Designed for **single-hop** interactions
(one agent, one tool server). Efficient; standard JWT tooling applies.

**Chained mode** — Biscuit tokens with append-only blocks and Datalog policy evaluation.
Designed for **multi-hop delegation chains** (orchestrator → sub-agent → tool). Each hop
appends a block that can only attenuate — never expand — the permissions granted by the
previous block. The receiving party validates the entire chain.

#### Protocol Bindings

- **MCP**: IBCT transported in a designated HTTP header on tool call requests
- **A2A**: IBCT transported in the `metadata.aip_token` field of task submissions; the calling
  agent appends a delegation block with attenuated scope before sending
- **Generic HTTP**: Authorization header or custom header

#### Four Questions AIP Answers for Every Tool Call

1. Who authorized this action?
2. Through which delegation chain?
3. With what constraints at each hop?
4. What was the outcome?

---

### 3b. draft-aip-agent-identity-protocol-00 — AIP: Agentic Authentication and Authorized Policy Enforcement

**Authors:** Cao & Arango Gutierrez (NVIDIA). Standards Track intent.  
**Date:** 16 March 2026. Expires 17 September 2026.  
**Datatracker:** https://datatracker.ietf.org/doc/draft-aip-agent-identity-protocol/

#### What It Is

A layered architecture addressing the problem of AI agents operating with **unbounded
permissions** — running as the user, inheriting full API key access, with no verifiable identity
boundary between human and non-human actors.

#### Two-Layer Architecture

**Layer 1 — Identity:** Every agent receives a unique identifier and a key pair, registered with
an **AIP Registry**. This gives each agent workload a stable, verifiable identity independent of
which user session it is running within.

**Layer 2 — Enforcement:** An AIP Proxy interposes between the AI client and every tool server.
Before any tool call reaches the tool: the proxy verifies the agent's signature, evaluates a
declarative policy, and issues one of three decisions: **allow**, **deny**, or **hold** (hold
meaning: escalate to human-in-the-loop).

#### Key Difference from the Prakash Draft

| Property | Prakash (draft-prakash-aip-00) | NVIDIA (draft-aip-agent-identity-protocol-00) |
|---|---|---|
| Security mechanism | Self-contained cryptographic token chain | Infrastructure: registry + proxy |
| Verification model | Tool server verifies IBCT directly (no external calls) | Proxy is the enforcement point; tool trusts proxy decision |
| Primary alignment | MCP/A2A ecosystem | Zero-trust network architecture |
| Token format | JWT (single-hop) / Biscuit (multi-hop) | Registry-issued credential |

---

### AIP Summary: Which Draft Is "The" AIP?

As of April 2026, neither has been adopted by an IETF working group, and the naming collision
between the two is unresolved. Organizations evaluating either should track both. The Prakash
approach aligns more naturally with the existing MCP/A2A ecosystem; the NVIDIA approach aligns
more naturally with zero-trust network architecture patterns.

---

## 4. draft-klrc-aiagent-auth-00 / -01 — AI Agent Authentication and Authorization (AIMS)

**Authors:** Defakto Security, AWS, Zscaler, Ping Identity.  
**Published:** 2 March 2026. Updated to -01 subsequently.  
**Track:** Individual Submission. Informational intent.  
**Datatracker:** https://datatracker.ietf.org/doc/draft-klrc-aiagent-auth/  
**Full text:** https://www.ietf.org/archive/id/draft-klrc-aiagent-auth-00.html

### What It Is

AIMS (Agent Identity Management System) is a **conceptual framework**, not a new protocol. It
describes the functions required to establish, maintain, and evaluate the identity and permissions
of an agent workload — and maps those functions to **existing, deployed standards** (WIMSE,
SPIFFE, OAuth 2.0). The explicit goal is to guide future standardization rather than define new
wire protocols.

### The AIMS Definition

> "The right Agent has access to the right resources and tools at the right time for the right reason."

AIMS may be implemented as a single component or distributed across: identity providers,
attestation services, authorization servers, policy engines, and runtime enforcement points.

### WIMSE and SPIFFE — The Identity Foundation

**WIMSE (Workload Identity in Multi-System Environments)** defines a URI that uniquely identifies
a workload within a trust domain. Every agent participating in the AIMS framework MUST be
assigned exactly one WIMSE identifier.

**SPIFFE** is the primary deployed implementation of the WIMSE model. A SPIFFE ID takes the form:

```
spiffe://<trust-domain>/<path>
```

For example: `spiffe://banking.example.com/agent/transfer-processor`

This gives each agent a stable, infrastructure-anchored identity that exists independently of any
OAuth session or user token.

**WIMSE Credentials** — the two primary credential types:

| Type | Format | Best Suited For |
|------|--------|-----------------|
| X.509-SVID | X.509 certificate | mTLS between workloads |
| JWT-SVID / WIT | JWT-based Workload Identity Token | HTTP Bearer token flows |

### Composition With OAuth 2.0

The draft does not replace RFC 8693. Rather, it describes how WIMSE/SPIFFE identities interact
with the OAuth layer: an agent presents its SPIFFE SVID credential to an authorization server,
which uses it to issue OAuth tokens scoped to that workload's identity. The agent's SPIFFE ID
becomes the OAuth `client_id` anchor.

### What the Draft Explicitly Does Not Do

It does not define new protocols, wire formats, or claim schemas. It explicitly positions itself
as "a framework within which to use existing standards and guide future standardization efforts."
This is its strength (it maps to real deployed infrastructure) and its limitation (it does not
resolve the open questions about agent-specific claims or multi-hop delegation).

### WG Reaction

OAuth-WG mailing list discussion on this draft was active in March 2026. Key feedback themes:
the WIMSE/SPIFFE foundation is well-regarded; the mapping to agentic-specific scenarios (tool
calls, HITL interrupts, consent) is acknowledged as underspecified in -00. The -01 revision was
released to address some of these gaps.

---

## Cross-Draft Comparison

| Property | Txn-Tokens (-08) | Txn-Tokens for Agents (-04) | AIP (Prakash) | AIP (NVIDIA) | AIMS / KLRC |
|---|---|---|---|---|---|
| IETF Track | Standards (WG) | Individual | Individual | Individual | Individual |
| Maturity | WG Last Call | Early draft | Very early | Very early | Early draft |
| Problem scope | Microservice context propagation | Agent context in service meshes | Multi-hop MCP/A2A delegation | Unbounded agent permissions | Workload identity framework |
| New protocols? | Yes (Txn-Token format + TTS) | Extension to above | Yes (IBCTs, Biscuit chains) | Yes (AIP Registry, AIP Proxy) | No — composes existing |
| Agent identity mechanism | Workload URI (`req_wl`) | `actor` + `principal` claims | Invocation-Bound Capability Token | WIMSE ID + AIP Registry | SPIFFE SVID |
| Multi-hop support | Within trust domain only | Same as base spec | Yes (Biscuit chained mode) | Yes (via proxy chain) | Via WIMSE/SPIFFE |
| OAuth dependency | Complementary | Complementary | Gap-filling (multi-hop) | Not primarily OAuth-based | Extends OAuth 2.0 |
| Relation to RFC 8693 | Complementary | Complementary | Gap-filling (multi-hop) | Independent layer | Integrates |

---

## Key Open Questions (April 2026)

1. **Will Txn-Tokens for Agents be adopted by oauth-wg?** The base spec is near RFC; the agents
   extension is not yet a WG item. Adoption is uncertain.

2. **AIP naming collision is unresolved.** The IETF has not coordinated between the two AIP
   drafts. Implementers risk building against a draft that loses the name to the other.

3. **AIMS is a framework, not a spec** — it cannot be implemented directly. It will only be
   useful once downstream protocol work (in WIMSE WG or oauth-wg) produces concrete specs
   aligned to it.

4. **`actor` vs `act` interoperability is undefined.** The agents extension (`actor` claim from
   the Txn-Tokens extension) and RFC 8693 (`act` claim) serve related but distinct purposes with
   no defined interoperability mapping. How these compose in a system using both is an open
   question.

5. **`purp` has no registered vocabulary.** The base Txn-Token spec requires a `purp` claim but
   does not define a registry or vocabulary for purpose strings. Each trust domain defines its
   own, limiting interoperability across domains.

---

## Practical Status for Implementers

| Decision | Recommendation |
|---|---|
| Build on for production today | **RFC 8693** (stable RFC), **RFC 8707** (stable RFC) |
| Monitor actively | **Txn-Tokens -08** — WG Last Call complete, near RFC |
| Evaluate for future roadmap | **AIMS/KLRC** — conceptual WIMSE/SPIFFE alignment is sound |
| Treat as experimental | **Txn-Tokens for Agents** — unstable claim names, no WG adoption |
| Research only | **Both AIP drafts** — very early stage, naming conflict unresolved |

---

## Sources

- [draft-ietf-oauth-transaction-tokens-08 — IETF Datatracker](https://datatracker.ietf.org/doc/draft-ietf-oauth-transaction-tokens/)
- [WG Last Call announcement — oauth@ietf.org](http://www.mail-archive.com/oauth@ietf.org/msg25803.html)
- [oauth-wg/oauth-transaction-tokens — GitHub (draft source)](https://github.com/oauth-wg/oauth-transaction-tokens/blob/main/draft-ietf-oauth-transaction-tokens.md)
- [draft-oauth-transaction-tokens-for-agents-04 — IETF Datatracker](https://datatracker.ietf.org/doc/draft-oauth-transaction-tokens-for-agents/)
- [Transaction Tokens For Agents (v00 full text)](https://www.ietf.org/archive/id/draft-oauth-transaction-tokens-for-agents-00.html)
- [draft-klrc-aiagent-auth-00 — IETF Datatracker](https://datatracker.ietf.org/doc/draft-klrc-aiagent-auth/)
- [draft-klrc-aiagent-auth-00 full text — IETF Archive](https://www.ietf.org/archive/id/draft-klrc-aiagent-auth-00.html)
- [AIMS deep dive — DEV Community](https://dev.to/kanywst/ai-agent-authentication-authorization-deep-dive-reading-draft-klrc-aiagent-auth-00-5d1)
- [draft-prakash-aip-00 — IETF Datatracker](https://datatracker.ietf.org/doc/draft-prakash-aip/)
- [draft-prakash-aip-00 full text — IETF Archive](https://www.ietf.org/archive/id/draft-prakash-aip-00.html)
- [AIP arXiv companion paper (2603.24775)](https://arxiv.org/abs/2603.24775)
- [draft-aip-agent-identity-protocol-00 — IETF Datatracker](https://datatracker.ietf.org/doc/draft-aip-agent-identity-protocol/)
- [OAuth specs index — oauth.net](https://oauth.net/specs/)
