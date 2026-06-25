# ChatGPT / Claude as the Agent — Design

**Date:** 2026-05-18
**Status:** Approved (design); implementation plan to follow
**Author:** Curtis Muir (with Claude Code)
**Goal:** Teach the identity/token-custody tradeoff of handing agent control to a third party.

---

## 1. Problem & Goal

Question raised: *"Could we use ChatGPT or Claude as the agent for our app? What would we lose (first token exchange, for example)?"*

The driving goal is **pedagogical**, not adoption: the demo's value is showing
exactly which identity and security guarantees are forfeited as you hand more of
the agent loop to a third-party platform. The comparison itself is the
deliverable.

## 2. Core Insight

The Super Banking architecture has a clean seam: **reasoning is separate from
identity**.

- The **LLM brain** picks which MCP tool to call from chat text
  (Helix→Claude / Ollama / instant heuristic). It never touches a token.
- The **BFF** is sole token custodian. It performs the RFC 8693 exchange
  (user = `subject_token`, agent = optional `actor_token`, narrowed `aud` +
  scope), enforces the PingAuthorize gate, and surfaces every step in the
  **Token Chain UI panel**.

"Use ChatGPT/Claude as the agent" is really three different shapes, each of
which moves that seam to a different place. The migration of the boundary *is*
the lesson.

## 3. The Three Shapes

### Option A — Swap the LLM brain only (the real path)

Replace Helix/Ollama with a direct OpenAI or Anthropic API call **for tool
routing only**, behind the existing `llmProviderResolver.js` single resolution
point (ARCHITECTURE-TRUTHS T-3). Heuristic still runs first (T-3 safety floor).
BFF still does the full RFC 8693 exchange.

- **Lost:** essentially nothing. Token chain, `act` claim, narrowed `aud`/scope,
  PingAuthorize gate — all intact.
- **Consistent with:** T-3 (single resolver, no inline defaults), T-4 (PingOne
  mints; services only request).
- **Note:** partially exists already — Helix wraps Claude Sonnet 4.6.

### Option B — Hosted agent platform (instrumented downgrade demo)

Hand the conversation loop to OpenAI's Responses API (or an Anthropic agent
loop) with the Super Banking MCP server registered as a tool. The platform
orchestrates tool calls; the app becomes a tool provider.

- **Lost — and this is the headline answer to "first token exchange":** the
  per-tool RFC 8693 exchange. Per OpenAI's docs, you pass an `authorization`
  value on **every** Responses API request and OpenAI deliberately does **not**
  store it — there is no place for a per-tool, narrowed, actor-stamped token.
  You hand one broad bearer token to a third party.
- **Specifically forfeited:** the `act` delegation claim; per-tool scope
  narrowing; single-resource audience discipline (T-10); the Token Chain panel
  goes dark exactly where it is most instructive.
- **Also:** tool args + results enter OpenAI's model context ("a malicious
  server can exfiltrate… anything that enters the model's context").

### Option C — ChatGPT/Claude.ai as the MCP client (optional extreme demo)

Expose Super Banking tools as a remote MCP server users connect to *from*
ChatGPT or Claude.ai directly. The app's UI/BFF is not in the loop.

- **Lost:** custody entirely. Anthropic's cloud performs OAuth 2.1 + PKCE
  (DCR/CIMD/Anthropic-held creds), and **stores + refreshes** the token
  (reactive on 401, proactive ~5 min before expiry) across all Claude surfaces.
  The server receives one connector-scoped token; Anthropic's docs are silent
  on downstream RFC 8693. BFF/Token-Chain story is entirely absent.
- **Gained:** users where they are.

## 4. Comparison Table

| | A. Swap LLM brain | B. Hosted agent platform | C. Platform as client |
|---|---|---|---|
| User token held by | BFF (unchanged) | BFF, but handed to OpenAI per request | Anthropic/OpenAI cloud |
| RFC 8693 exchange | Intact | Lost at agent boundary | Lost |
| `act` / delegation claim | Preserved | Gone | Gone |
| Per-tool scope narrowing | Preserved | Gone | Gone |
| Token Chain UI panel | Fully works | Goes dark past BFF→OpenAI | N/A (UI not in loop) |
| Sees tool args/results | Your infra + chosen API | OpenAI infra | Platform cloud |
| Token refresh owner | You | You (per-request, not stored) | Platform |
| Ops burden delta | Lowest | Medium | Run hardened public MCP server |

## 4a. How ChatGPT Actually Talks to the Gateway (Option B, concrete)

ChatGPT's Responses API connects to a remote MCP server given a `server_url`
plus an `authorization` token, and re-sends that token on every request
(OpenAI does **not** store it). The Super Banking gateway already speaks this
protocol — no gateway changes are needed for the transport itself:

- `POST /mcp` Streamable HTTP entrypoint —
  `banking_mcp_gateway/src/server/GatewayServer.ts:152`
- RFC 9728 discovery at `/.well-known/oauth-protected-resource`, advertising
  the PingOne authorization server — `GatewayServer.ts:135`
- `401` + `WWW-Authenticate` with `resource_metadata` pointer —
  `GatewayServer.ts:565`

Request shape:

```
POST https://banking-gateway.<host>/mcp
Authorization: Bearer <PingOne token, aud = MCP_GW_RESOURCE_URI>
{ "jsonrpc":"2.0", "method":"tools/call", "params":{ "name":"...", "arguments":{...} } }
```

### The Authorize engine survives the agent swap (key finding)

The PingAuthorize decision is bound to the **inbound request**, not to who
originated it. So with ChatGPT driving, the gateway still enforces, in order:

1. `validateInboundToken(token, gatewayResourceUri)` — fail-closed `aud` check
   (`banking_mcp_gateway/src/tokenValidator.ts:31`)
2. **D-05 anti-bypass** — rejects any token whose `aud` targets an upstream MCP
   server (`banking_mcp_gateway/src/auth/GatewayTokenPolicy.ts:48`)
3. **PingAuthorize `/decision`** per `tools/call` with `ToolName`,
   `TransactionAmount`, `ClientId`, `ActClientId`; acts on
   PERMIT / DENY / INDETERMINATE(HITL)
   (`banking_mcp_gateway/src/auth/PingOneAuthorizeClient.ts:89`)
4. RFC 8693 re-exchange to the backend MCP audience
   (`banking_mcp_gateway/src/credentialSwap.ts:60`)

**Conclusion:** "use our authorize engine?" → **yes, fully.** ChatGPT cannot
route around the gateway policy enforcement point. The strong demo line is:
*the agent changed; the policy gate did not.*

### What is lost is upstream of the gateway

The loss is the **per-tool narrowed RFC 8693 exchange and the `act` delegation
claim** that the BFF agent performs. ChatGPT arrives holding **one broad
gateway-audience bearer token**; the `subject_token → actor_token →
narrowed aud` chain that lights up the Token Chain panel never happens because
ChatGPT, not the BFF, is the caller.

### The real gap: who mints the gateway-audience token for ChatGPT

OpenAI's Responses API runs no OAuth flow for you. There is **no DCR endpoint
on the gateway** — PingOne clients must be pre-registered (the BFF's
`/api/oauth/clients/register`, `routes/oauthClients.js:70`, is
`client_credentials` machine-to-machine, not user-delegated). Three bridges,
documented as a spectrum (no build commitment yet):

| Bridge | Custody holder | Per-tool exchange | Token Chain visible | Demo honesty |
|---|---|---|---|---|
| **B1: BFF mints, injects into Responses API per call** | BFF | ❌ one broad gateway-aud token | Partial (BFF→ChatGPT hop only) | Best — custody handoff is explicit and annotatable |
| **B2: ChatGPT App SDK OAuth (DCR/PKCE)** | OpenAI cloud | ❌ | None | Maximal loss — closest to Option C; needs PingOne pre-registration |
| **B3: Dev token pasted into Responses API call** | Manual / none | ❌ | None | Fastest for a talk; explicitly labeled non-representative |

All three lose the per-tool exchange and `act` claim; they differ only in
*where custody goes* and *how visible the loss is*. The talk can walk the
spectrum B3 → B1 → B2 as escalating custody loss, with the BFF agent (Option A)
as the intact baseline.

## 4b. How Claude Talks to the Gateway (Option B/C, concrete)

Claude reaches the gateway two ways, and the difference between them is itself
a teaching point:

### Path 1 — Claude API `mcp_connector` (Option B analogue)

The Claude Messages API accepts an `mcp_servers` block (`url` +
`authorization_token`). Mechanically identical to ChatGPT's Responses API: the
gateway needs **no changes**, and the same three token bridges (B1/B2/B3 in
§4a) apply unchanged. Same loss profile — one broad gateway-aud token, no
per-tool exchange, no `act` claim.

### Path 2 — Claude.ai / Desktop custom connector (Option C, the extreme)

This is where Claude differs structurally from ChatGPT and the lesson sharpens.
Per Anthropic's connector docs, when a user adds the gateway as a custom
connector in Claude.ai/Desktop/mobile:

- **Anthropic's cloud performs the entire OAuth 2.1 + PKCE flow** (it sends a
  `code_challenge`, `code_challenge_method=S256` on every authorization
  request) — your app runs none of it.
- **Anthropic stores and refreshes the token**: reactive on `401`, proactive
  up to ~5 minutes before stored expiry, with refresh-token rotation for
  public clients. The token lives in Anthropic's infrastructure, not yours.
- Client registration uses DCR, CIMD, or Anthropic-held credentials. **The
  gateway has no DCR endpoint** (§4a), so this requires either standing up a
  DCR-capable registration endpoint in front of PingOne, or pre-registering a
  PingOne client and using the Anthropic-held-credentials mode.
- Anthropic's docs are **silent on whether the connector server may perform a
  downstream RFC 8693 exchange** — in practice the gateway receives one
  connector-scoped token and the BFF/Token-Chain story is entirely absent.

The gateway's Authorize engine, D-05 anti-bypass, and RFC 8693 re-exchange to
the backend **still fire** (same as §4a — they are bound to the inbound
request). What is gone is everything *before* the gateway: the user's token is
custodied by Anthropic, the BFF is not in the loop at all, and the Token Chain
panel does not exist for that session because the Super Banking UI is not
rendering it.

### Claude vs ChatGPT — the one difference worth teaching

| | ChatGPT (Responses API) | Claude API (`mcp_connector`) | Claude.ai connector |
|---|---|---|---|
| Who runs OAuth | You (bridges B1/B2/B3) | You (bridges B1/B2/B3) | **Anthropic cloud** |
| Token stored by | Nobody (per-request) | Nobody (per-request) | **Anthropic (refreshes it)** |
| Your UI in loop | Optional | Optional | **No** |
| Authorize engine fires | ✅ | ✅ | ✅ |
| `act` claim / per-tool exchange | ❌ | ❌ | ❌ |

**Teaching takeaway:** the API surfaces (ChatGPT Responses, Claude
`mcp_connector`) are *symmetric* — same wiring, same loss. The Claude.ai
**connector** is the qualitatively different one: it is the only path where a
third party becomes the **token custodian and refresher**, not just a relay.
That is the cleanest illustration of what "first token exchange" custody
actually buys you — and what its absence costs.

## 4c. The Teaching Narrative (how to present this)

This is intended as conference / dev-education material. The recommended
narrative arc, from intact to maximally degraded:

1. **Baseline (Option A):** BFF agent. Show the Token Chain panel lighting up:
   `subject_token → actor_token → narrowed aud → act claim`. "This is
   delegation done right — the user authorized *one* action, scoped and
   stamped with who acted on their behalf."
2. **Step down 1 (B3 dev token):** paste a token into ChatGPT/Claude API.
   Same gateway, same Authorize PERMIT/DENY — but the Token Chain panel has
   nothing to show before the gateway. "The policy gate held. But notice what
   we *can't* show anymore."
3. **Step down 2 (B1 BFF-minted):** the BFF hands a broad gateway-aud token to
   ChatGPT. Annotate the exact line where per-tool narrowing and the `act`
   claim are lost. "Custody is still ours — but delegation granularity is
   gone."
4. **Step down 3 (Claude.ai connector / B2):** Anthropic/OpenAI holds and
   refreshes the user's token. "We no longer custody the user's credential at
   all. The bank's Authorize engine is still the backstop — and now you see
   *why that backstop is non-negotiable*."

The single sentence the audience should leave with: **the policy enforcement
point (gateway + PingAuthorize + D-05) is what makes third-party agents
*safe to allow*; the BFF token exchange is what makes delegation *legible*.
You can give up the second only if you keep the first.**

## 5. Decision

**Build A as the baseline real path. Instrument B (and optionally C) as
deliberate "downgrade" demos.**

The lesson lands hardest when the audience watches the Token Chain panel light
up under the BFF agent (`subject_token → act claim → narrowed aud`), then
watches that *same panel go dark* when the loop is flipped to a third-party
platform. The contrast is the curriculum.

Concretely:

- **A** — add OpenAI/Anthropic as first-class providers in
  `llmProviderResolver` (token chain fully intact — the "right way").
- **B** — a demo route handing the loop to OpenAI's Responses API with the MCP
  server as a tool; Token Chain panel explicitly annotates "delegation lost
  here — third party holds a broad token."
- **C** — optional: a documented "connect from Claude.ai" path narrated as
  "zero custody, zero exchange visibility."

This converts "what would we lose" from a risk into the teaching material.

## 6. Constraints & Non-Negotiables

- ARCHITECTURE-TRUTHS T-3: single resolver point, no inline LLM defaults;
  heuristic always runs first.
- ARCHITECTURE-TRUTHS T-4: PingOne mints tokens; services only request.
- Token custody rule (CLAUDE.md): tokens never exposed to the browser for
  Option A. Options B/C are *explicitly demonstrating* the violation as a
  teaching device and must be clearly labeled as such in the UI/logs.
- REGRESSION_PLAN §1 protected files (llmProviderResolver, agentMcpTokenService,
  bankingAgentLangGraphService) — pre-read required before edits; minimal diff.
- No emojis except ⚠️ ✅ ❌.
- UI build must exit 0 after any `banking_api_ui` change.

## 7. Out of Scope

- Replacing the BFF token custody model for production (A keeps it).
- Removing Helix/Ollama (A adds providers alongside; does not remove).
- Real production adoption of B/C — they are instrumented teaching demos only.

## 8. Open Questions for Implementation Plan

**Build progress:** Slice **A** shipped (`llmProviderResolver` openai/anthropic
pass-through; commit `7bf1595f`). Slice **B3** shipped — dev-token stage prop
`banking_api_server/scripts/mint-gateway-token.js`: mints a real
gateway-audience RFC 8693 token and prints ChatGPT Responses API + Claude
`mcp_connector` snippets. Remaining: B1, C, the annotation overlay.

- Which provider first for A — Anthropic direct, OpenAI direct, or both?
  (A is provider-agnostic at the resolver; this is now a UI-selection question.)
- B1 (BFF-minted per-call handoff with degraded-mode annotation) is the next
  natural B step now that B3 proves the gateway-survives-swap claim.
- Claude.ai connector (Option C / §4b Path 2): documented-only for the first
  pass, or stand up the DCR-front / Anthropic-held-credentials registration?
- Where the "Token Chain goes dark / annotation" overlay lives — reuse the
  existing Token Chain panel with a degraded-mode banner, or a parallel
  comparison view for the talk?

---

## Sources

- [OpenAI – Remote MCP & connectors](https://platform.openai.com/docs/guides/tools-remote-mcp)
- [OpenAI – MCP and Connectors guide](https://developers.openai.com/api/docs/guides/tools-connectors-mcp)
- [Anthropic – Authentication for connectors](https://claude.com/docs/connectors/building/authentication)
- [Claude Help Center – Custom connectors via remote MCP](https://support.claude.com/en/articles/11503834-build-custom-connectors-via-remote-mcp-servers)
- [State of MCP 2026: AI Agents, OAuth, and Your Money](https://truthifi.com/education/state-of-mcp-2026-ai-agents-custom-connectors)
- [Anthropic – MCP connector (Claude API)](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector)
- Gateway wiring (in-repo): `banking_mcp_gateway/src/server/GatewayServer.ts`,
  `tokenValidator.ts`, `auth/GatewayTokenPolicy.ts`,
  `auth/PingOneAuthorizeClient.ts`, `credentialSwap.ts`;
  `banking_api_server/routes/oauthClients.js`
