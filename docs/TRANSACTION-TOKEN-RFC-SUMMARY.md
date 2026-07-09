# Transaction Token Drafts — Summary

**Status:** Not an RFC yet. These are **Internet-Drafts** (work in progress). Do not cite as finished standards.

| Document | Draft ID | Track | Latest seen |
|---|---|---|---|
| **Base spec** | [draft-ietf-oauth-transaction-tokens](https://datatracker.ietf.org/doc/draft-ietf-oauth-transaction-tokens/) | IETF OAuth WG — intended **Standards Track** | `-09` (check datatracker for current) |
| **Agents extension** | [draft-araut-oauth-transaction-tokens-for-agents](https://datatracker.ietf.org/doc/draft-araut-oauth-transaction-tokens-for-agents/) | Individual — **Informational** | `-02` (May 2026) |

Related: [TX-AT-TOKEN-MODEL.md](./TX-AT-TOKEN-MODEL.md) (Patrick Harding / customer architecture notes).

---

## The Problem

Modern apps are many small services (workloads) calling each other. Inside a trusted network, bad or compromised code can:

- Call internal services with no real user request behind it
- Pretend to be a different user
- Change parameters mid-flight
- Steal and reuse OAuth access tokens passed between services

Today many shops pass **user identity in HTTP headers** (like Autodesk’s User ID header). That is easy to forward but **not cryptographically enforced**.

---

## The Idea

A **Transaction Token (Txn-Token)** is a **short-lived signed JWT** that says:

> “This chain of service calls is one real transaction. Here is **who** it is for, **what** it is allowed to do, and **context** that must not change.”

It rides **alongside** normal workload authentication — it does **not** replace the access token used for service-to-service auth.

---

## Two Layers on Every Hop (matches Patrick’s TX + AT model)

The base draft is explicit: **do not put the Txn-Token in `Authorization`.**

| HTTP header | Carries | Purpose |
|---|---|---|
| **`Authorization: Bearer …`** | Workload **access token** | “Which service is calling?” (service-to-service auth) |
| **`Txn-Token: …`** | **Transaction token** JWT | “Who is this transaction for, and what is the immutable context?” |

Example shape from the draft:

```http
POST /api/check-risk HTTP/1.1
Host: risk-service.example
Content-Type: application/json
Authorization: Bearer <workload-access-token>
Txn-Token: eyJhbGciOiJSUzI1NiIsInR5cCI6InR4bnRva2VuK2p3dCJ9...

{"order_id": "ord-12345"}
```

This is exactly the **two-token model** in [TX-AT-TOKEN-MODEL.md](./TX-AT-TOKEN-MODEL.md). Patrick called the header “transaction token header”; the spec names it **`Txn-Token`**.

---

## How You Get One

1. A request hits an **external endpoint** (API gateway, agent entry point) with normal OAuth (e.g. user access token).
2. The entry workload calls the **Transaction Token Service (TTS)** — one logical issuer per **trust domain**.
3. The request uses **RFC 8693 token exchange** with a dedicated token type:

```
grant_type=urn:ietf:params:oauth:grant-type:token-exchange
requested_token_type=urn:ietf:params:oauth:token-type:txn_token
audience=<trust-domain>
scope=<narrow transaction purpose>
subject_token=<token representing the subject>
subject_token_type=...
```

4. TTS returns a signed Txn-Token.
5. The caller passes that **same Txn-Token** (in the `Txn-Token` header) to downstream workloads in the **call chain**.
6. Each downstream workload **validates** the JWT independently (signature, `aud`, `exp`, claims).

Optional inputs to TTS include **request context** (IP, auth method) and **transaction details** (action parameters that must stay tamper-proof).

---

## Token Format (base draft)

**JWT header**

- `typ` MUST be `txntoken+jwt`
- Signed (e.g. RS256); `kid` for key rotation

**Key JWT body claims**

| Claim | Required? | Meaning |
|---|---|---|
| `sub` | REQUIRED | **Principal** of the transaction (usually the user) |
| `aud` | REQUIRED | **Trust domain** where this token is valid |
| `exp` / `iat` | REQUIRED | Short lifetime (draft: **minutes or less**) |
| `txn` | REQUIRED | Unique **transaction ID** (replay detection) |
| `scope` | REQUIRED | **Narrow purpose** of this transaction (TTS decides; may differ from outer OAuth scope) |
| `req_wl` | REQUIRED | Workload that **requested** this token (chain of requesters may append) |
| `tctx` | OPTIONAL | **Transaction context** — immutable authorization details (e.g. action, amount, ticker) |
| `rctx` | OPTIONAL | **Requester context** — environment (e.g. `req_ip`, `authn` method) |

**Important security note from the draft:** Txn-Tokens are **not authentication credentials** for workloads. They carry **authorization context** for a transaction. Workloads still authenticate with their own access tokens.

---

## Passing Through the Call Chain

Within one transaction:

- The **same Txn-Token** is forwarded on each internal hop (in `Txn-Token`).
- Each service uses its **own access token** in `Authorization`.
- Services **must not** silently trust the previous hop — they re-validate the Txn-Token.

The TTS may also support **replacement** tokens in some cases (e.g. updating `req_wl` as the chain grows). The agents extension adds richer **replacement at agent boundaries** (see below).

---

## Agents Extension (`draft-araut-oauth-transaction-tokens-for-agents-02`)

Extends the base Txn-Token for **AI agent** workloads. Does **not** define new grant types — uses existing TTS issuance and replacement.

### Two layers inside the token

| Layer | Claims | Rule |
|---|---|---|
| **Identity** | `sub`, `act` | **Immutable** for the life of the transaction |
| **Context** | `agentic_ctx` | Updated on **agent transitions**; tracks chain metadata |

- **`sub`** — principal (user), from `subject_token` rules in base spec. For fully autonomous agents with no human, `sub` may be the agent itself.
- **`act`** — copied from the inbound access token if present (RFC 8693 delegation). Identifies the agent acting on behalf of the user.
- **`agentic_ctx`** — new JSON object for multi-agent integrity:

| Field | Meaning |
|---|---|
| `current_actor` | Agent executing **now** (updated on replacement) |
| `originator` | Agent that **started** the chain (never changes) |
| `chain_metadata.hop_count` | Number of agent hops (starts at 1, increments) |

TTS may use an **Agent Registry** to tell agents from ordinary workloads.

### Single-agent vs multi-agent

- **Single agent, user-initiated:** one Txn-Token minted; `sub` = user, `act` = agent, pass through infra hops.
- **Multi-agent:** at each **agent handoff**, TTS issues a **replacement** Txn-Token — `sub` and `act` stay the same; `agentic_ctx` updates (`current_actor`, `hop_count`). This matches Patrick’s “decorate at A2A boundary, not at gateway/MCP hops.”

### Flows covered

1. **Subject-initiated** — user invokes agent; agent has OAuth access token with `sub` (+ optional `act`); external endpoint exchanges to Txn-Token via TTS.
2. **Autonomous** — agent starts from schedule/event; no human principal (different `sub` rules).

---

## Lifetimes and Refresh

- Txn-Tokens are **short-lived** (minutes or less).
- Bound to one transaction (`txn` claim).
- Draft discusses replay risk; long batch jobs still get short-lived tokens (not open-ended sessions).
- Refresh of mid-flight tokens is a deployment/policy question (same class of problem as web session expiry).

---

## How This Maps to Our Docs and Demo

| Spec concept | [TX-AT-TOKEN-MODEL.md](./TX-AT-TOKEN-MODEL.md) | Banking demo (`ff_trat_mode`) |
|---|---|---|
| Txn-Token header | “Transaction-Token header” | Simulated via `X-TraT-Context` + bearer today |
| Workload AT | `Authorization` access token | Agent CC at exchange; not separate per hop yet |
| `sub` / `act` | TX on-behalf-of | RFC 8693 exchanged bearer |
| `tctx` | RAR / user prompt / intent | `azd`, RAR via `ff_rar` |
| `rctx` | Request environment | `rctx` in TraT shim |
| `txn` | Transaction ID / kill switch | Partial (`killSwitchService`) |
| `agentic_ctx` | A2A decoration | Nested `act` chain in `a2aDelegationService` |
| TTS | IdP / PingOne token endpoint | PingOne RFC 8693 exchange |

Demo claim names (`reqctx`, `purp`, `azd`, `rctx`) are a **PingOne / teaching shim** — conceptually aligned with `tctx`, `rctx`, and agents `agentic_ctx`, but not identical to draft claim names.

---

## What Is Still Open (draft status)

- Base draft is active in **IETF OAuth WG** but not published as RFC.
- Agents extension is a **separate individual draft** (Amazon author); may merge or diverge.
- Exact replacement rules, Agent Registry, and cross–trust-domain use (compare **ID-JAG** in our notes) are still evolving.
- Product support (Ping Federate custom processor, PingOne native TraT) is ahead of full standards ratification.

---

## Explain Like I’m in 5th Grade

Imagine a **field trip**:

- **You** are the user.
- **Your teacher** is the AI agent helping you.
- The trip goes through several **stops**: bus → museum desk → exhibit room → gift shop.

**Problem:** At each stop, someone could lie and say “Curtis said I could do this” with no proof.

**Transaction token = the permission slip for the whole trip**

One signed slip says:

- “This trip is for **Curtis**.”
- “**Ms. Johnson’s class** is in charge.”
- “They may **look at dinosaurs**, not buy everything in the gift shop.”
- “Trip ID #48291 — only good for this visit, expires in 20 minutes.”

Every stop reads the **same slip**. Nobody can change “Curtis” to someone else or swap “dinosaurs” for “buy 100 toys.”

**Access token = each driver’s badge**

- The **bus driver** shows a badge: “I’m allowed to use the bus lane.”
- The **museum guide** shows a different badge: “I’m allowed inside the staff door.”

Badges answer: **“Is this the right worker on the right road?”**

The permission slip answers: **“Who is this trip for, and what were they allowed to do?”**

You need **both** at every stop — badge **and** slip — because they answer different questions.

**When another teacher joins** (agent talks to agent), you get a **new slip** that still says the trip is for Curtis, but now lists **both teachers** and adds “stop #2 on the tour.” You do **not** get a brand-new slip every time you walk through a hallway — only when a **new person in charge** shows up.

That is what the transaction token drafts are trying to standardize — a **tamper-proof trip slip** (`Txn-Token` header) plus **employee badges** (`Authorization` header) for every robot service in the chain.

---

## References

- Base: https://datatracker.ietf.org/doc/draft-ietf-oauth-transaction-tokens/
- Agents: https://datatracker.ietf.org/doc/draft-araut-oauth-transaction-tokens-for-agents/
- RFC 8693 (Token Exchange): https://datatracker.ietf.org/doc/html/rfc8693
- Related internal note: [TX-AT-TOKEN-MODEL.md](./TX-AT-TOKEN-MODEL.md)
