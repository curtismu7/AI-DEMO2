# Transaction Tokens and Access Tokens — Two-Token Model

Summary of Patrick Harding's architecture guidance from SE Office Hours (July 7, 2026), based on customer patterns at Autodesk, Hong Kong Jockey Club, and CBA.

## The Core Idea

Most people conflate two separate problems. The clean model uses **two tokens on every hop**, each with a different job.

| | **Access Token (AT)** | **Transaction Token (TX)** |
|---|---|---|
| **Header** | `Authorization: Bearer …` | Separate header defined by the TX spec (`Transaction-Token`) |
| **Represents** | **Workload identity** — "who is calling?" | **On-behalf-of context** — "which user, which agent, what were they trying to do?" |
| **Purpose** | Workload-to-workload access control | User/agent authorization context passed downstream |
| **Changes per hop?** | Workload AT as each service calls the next | **Same TX** across the whole chain |
| **Replaces** | Client-secret workload auth many shops already do | Untrusted user-context HTTP headers |

Campbell's "mullet" analogy from the call: **business in the front** (AT = workload identity at the edge), **party in the back** (TX = on-behalf-of context through the backend).

## How They Flow Together

```
User logs in / consents (subject token available)
        │
        ▼
Agent ──token exchange──► IdP ──► TX + workload AT
        │
        ▼
Agent ──► MCP Gateway     AT (who: agent) + TX (on behalf of: user)
        │
        ▼
MCP Gateway ──► MCP Server   Same TX + gateway's workload AT
        │
        ▼
MCP Server ──► API           Same TX + server's workload AT
        │
        ▼
API ──► API                  Same TX + API's workload AT

TX unchanged — no re-exchange at each hop
```

**Access token:** "This MCP server workload is allowed to call this API gateway" (Kong/OPA style policy).

**Transaction token:** "Agent A is acting on behalf of User X for this specific task/prompt."

Autodesk's pattern (as Patrick described it): they **already** had workload AT + Kong enforcing "frontend workload A can reach backends B/C/D but not E." They added TX to replace passing user identity in a plain HTTP header.

## What a Transaction Token Actually Is

TX is **not a separate protocol** — it is **token exchange (RFC 8693) with a specific requested token type**, plus extra claims, carried in its own header.

It includes:

- **`act` / on-behalf-of chain** (like classic token exchange)
- **Optional RAR / user-defined authorization data** from original consent
- **Optional original user prompt** (for drift checks)

Creation requires a real **subject token** the agent cannot forge — ID token, access token, or session artifact, depending on how the app holds the user session. The user **must** have been involved at kickoff.

## When the TX Changes vs Stays the Same

**Same TX (no new exchange):**

```
Agent → MCP Gateway → MCP Server → API → API
```

Same agent, same user intent — nothing probabilistic changed.

**New exchange (TX gets decorated):**

```
User → Agent A → Agent B → …
```

A second **probabilistic** actor appears. TX becomes something like: *Agent B acting on behalf of Agent A acting on behalf of User*.

Patrick explicitly said **deterministic hops** (MCP gateway, MCP server) do **not** need to appear in the TX chain — only probabilistic actors (users, agents).

## Authorization: Who Decides?

Patrick's stance:

- The **IdP issues** the TX with context; it should **not** decide authorization for every downstream API.
- Each resource **can** evaluate TX claims locally **or** send them to **PingOne Authorize** (or similar). Central authz is fine — the spec does not force per-service policy logic.

## Lifetimes

Rough guidance from the call: think **web-session length**, often **5–10 minutes** per user prompt/transaction — long enough for an agent run, not seconds. Mid-flight refresh is an open operational question (same class of problem as session expiry).

## Domain Boundaries

- **TX + workload AT:** single domain, single IdP (Ping Federate / AIC).
- **ID-JAG:** when the downstream MCP/API lives in a **different domain** with its own authorization server. Work is underway to map TX ↔ ID-JAG for that case.

## Contrast with What Many People Assume

| Common assumption | Patrick's model |
|---|---|
| One token does everything | Two tokens, two layers |
| Token exchange at every hop | One TX minted once, passed through |
| Put on-behalf-of in the access token | Keep AT for workload; put user/agent context in TX |
| IdP decides all authz | Resources (or Authorize) decide using TX claims |

## Gaps Called Out on the Call

- **Kill switch:** revoking a user+agent relationship requires state (which TX IDs are dead) — token exchange today is largely stateless; no product story yet for "disable this person using this agent."
- **Product support:** Ping Federate can customize today (custom token processor); first-class TX support is the direction.
- **Not ratified yet** — but customers (Autodesk, Jockey Club, CBA) are already building this way.

## Bottom Line

**AT** answers *"Is this workload allowed to talk to that workload?"*

**TX** answers *"Under what user/agent context is this call happening, and what did the user authorize?"*

Pass **both** on every service-to-service call; re-exchange TX only when the probabilistic actor chain changes (e.g. agent-to-agent), not at every infrastructure hop.

## Related Topics from the Same Call

- **EMA (Enterprise Managed Authorization):** enterprise policy pushed into tokens for MCP — IT sets consent, not the developer clicking "yes" to everything.
- **ID-JAG:** cross-domain SSO for MCP servers (e.g. Claude Code → Jira MCP without per-server user consent).
- **OAuth Resource Metadata:** MCP servers advertise supported grants/scopes to agents — currently oriented toward personal agents, not enterprise digital assistants.

## What Is a Workload? (Simple Explanation)

A **workload** is a program running on a computer that does a job for you.

It is not a person. It is not you. It is a **service** — like a robot helper that only knows how to do one kind of work.

### Examples from the banking demo

| Workload | What it is (plain English) |
|---|---|
| **AI Agent** | The chat bot that talks to you |
| **MCP Gateway** | The door guard between agents and tools |
| **MCP Server** | The tool box (check balance, transfer money) |
| **Banking API** | The vault that actually holds account data |

Each one is its own **workload** — its own program, its own identity.

### Why it matters for tokens

When Agent A calls the Gateway, the Gateway asks:

> "Which robot is knocking? Are you allowed to talk to me?"

That is the **workload access token (AT)** — like an **employee badge** that says "I'm Agent A, and I'm allowed in this building."

Separately, the **transaction token (TX)** says:

> "Agent A is doing this for Curtis, and Curtis asked to check his balance."

### Analogy: school field trip

- **You** = the user
- **Your teacher** = the agent acting on your behalf
- **The bus driver** = a workload (gateway)
- **The museum** = another workload (API)

**TX:** "Curtis's class is here to see the dinosaur exhibit."

**AT (bus driver's badge):** "This bus is allowed to drop off at the museum loading dock — not the staff entrance."

The museum cares about **both**: who the trip is for (TX) and whether this bus is allowed on this road (AT).

### One line

A **workload** is any **running service** in your system. Each gets its own ID badge (AT) so you can control **which services can talk to which** — separate from **who the user is** or **what they asked the agent to do**.

## Autodesk Platform PDF Comparison

Source: `autodesk-platform (1).pdf` — **Autodesk Platform Architecture** (current-state reference deck).

**Key finding:** The PDF documents Autodesk's **as-is** platform. It does **not** describe Patrick's two-token TX/AT target model. The PDF is the **problem statement**; this doc (from the SE Office Hours call) is the **to-be** model Patrick said Autodesk moved toward.

### What the PDF covers

- Multi-account AWS mesh: boundary services, orchestrator, agent services, MCP servers, LLM, storage
- **Three token types today:** 3L (user OIDC), 2L (client credentials), OBO (RFC 8693 — infrequently used)
- **Two authorization servers:** standard REST AS + MCP AS
- **User context today:** `User ID header` with 2L tokens — *"expected but not enforced"*
- **Five flows:** standard user, cloud agent, desktop-embedded agent, public MCP on desktop, public MCP in cloud

The PDF has **no mention** of transaction tokens, a `Transaction-Token` header, TraT claims, or dual-token passthrough.

### Side-by-side

| Topic | Autodesk PDF (current) | This doc (Patrick's target) |
|---|---|---|
| **Service auth** | 2L access token per hop (client credentials) | Workload AT in `Authorization` |
| **User/agent context** | `User ID header` (untrusted propagation) | TX token (validated, separate header) |
| **Tokens per request** | One bearer (2L or 3L) + optional header | Two: AT + TX |
| **Exchange at every hop** | Each service gets its **own** 2L token | Same TX passed through; only AT changes per workload |
| **On-behalf-of in token** | OBO exists but **"infrequently used"** | TX is the primary on-behalf-of carrier |
| **MCP agent auth** | 2L MCP token (cloud agents) or 3L MCP token (public HTTP agents) | TX minted once for the agent task |
| **Authz enforcement** | Per-service; header forwarding not guaranteed | Kong/OPA workload ACL + resource/Authorize on TX claims |
| **Dual AS** | Standard AS + MCP AS (documented in detail) | Single IdP domain (Ping); ID-JAG for cross-domain |
| **Desktop / public MCP** | Four agent/MCP variants documented | Not covered in this doc |
| **A2A / multi-agent** | Orchestrator → agent via 2L + User ID header | TX decorated when new probabilistic actor appears |

### Where they agree (conceptually)

**2L per hop → workload AT seed:**

> PDF: *"Each service independently authenticates with Autodesk Identity (per-hop two-legged tokens)"*  
> This doc: *"Access token represents the identity of the workload"*

**User ID header → what TX replaces:**

> PDF: *"User identity propagation is expected but not enforced — passed via HTTP headers"*  
> This doc: *"Replacing that user identity in the HTTP header with an actual token"*

**OBO → precursor to TX:**

> PDF: *"OBO carries user context within the token itself… infrequently used"*  
> This doc: *"Transaction token is an extension of token exchange with act-as + extra claims"*

Patrick's Autodesk story on the call: they **already had** workload 2L + gateway ACL (Kong/OPA), then **added** TX on top. The PDF shows the **before** picture; this doc captures the **after** picture.

### Cloud agent flow comparison (PDF Section 2)

**PDF today:**

```
User (3L) → Boundary → Orchestrator (2L + User ID header)
  → Agent Service (2L MCP token + User ID header)
    → MCP Server (2L + User ID header)
      → Autodesk Services (2L + User ID header) … arbitrary depth
```

Each hop: **new 2L token**, **same header** (maybe).

**Patrick's model (this doc):**

```
User → Agent (exchange once) → TX + Agent workload AT
  → Gateway (same TX + gateway AT)
    → MCP Server (same TX + server AT)
      → API (same TX + API AT)
```

Each hop: **same TX**, **new workload AT only**.

### PDF content not in this doc

| PDF topic | Notes |
|---|---|
| Platform scale (multi-AWS-account, multi-VPC, polyglot stacks) | Generic "services" here |
| Boundary vs internal service tiers | Not distinguished |
| Orchestrator / Agent Service / LLM / MCP topology | Simplified agent → gateway → MCP → API |
| Two AS model (REST vs MCP) | Single IdP framing |
| Desktop-embedded MCP (no cloud auth) | Not covered |
| Public MCP (STDIO child process, OAuth 2.1 + PKCE for HTTP) | Not covered |
| 3L at boundary, 2L internally | Partially implied |

### This doc content not in the PDF

| This doc topic | Notes |
|---|---|
| Separate `Transaction-Token` header | Entire TX model absent from PDF |
| TX passthrough (no re-exchange on infra hops) | PDF re-mints 2L at every hop |
| TraT claims (RAR, prompt, drift) | Not in PDF |
| A2A TX decoration | PDF: orchestrator→agent still 2L + header |
| Authorize/PDP philosophy | Not in PDF |
| ID-JAG / EMA / kill switch gaps | Not in PDF |

### Banking demo position

The demo sits **between** the two documents:

| | Autodesk PDF | Banking demo | This doc (target) |
|---|---|---|---|
| User context | User ID header | RFC 8693 `act` in bearer | TX in separate header |
| Workload identity | 2L per hop | Agent CC at exchange; mTLS + `aud` checks | Workload AT every hop |
| Passthrough | Re-mint 2L each hop | Intended; some gateway paths re-exchange | Same TX, new AT only |
| Central authz | Not specified | PingOne Authorize | Authorize (or resource) on TX claims |
