# Architecture diagram with token overlay — design spec

**Date:** 2026-05-29
**Status:** Shipped — interactive HTML lives in the served UI; mermaid companion lives in docs.
**Outputs:**
- **Interactive HTML (canonical):** `demo_api_ui/public/architecture/token-flow.html` → served by demo_api_ui at `/architecture/token-flow.html`. Linked from the admin sidebar (Diagrams → "Token Flow (Interactive)") and embedded in README.
- **Mermaid (static companion):** `docs/architecture-token-flow.mmd` — boxes + edges + transport labels only; no scenarios, no layers, no token cards. Embedded inline in README.

## Goal

Produce one HTML mockup that conveys both the **system architecture** of AI-Demo and the **token flow** through it, in the visual style of the reference image the user provided (the "NotFlux" P1AZ token-flow diagram) and the existing `option-2b-refined.html` aesthetic.

The diagram answers two questions at once:

1. **What services exist, what ports they bind, what transport connects each hop.**
2. **Which token is in transit at each hop, including RFC 8693 exchange points and `act`/`may_act` claims.**

## Visual style

- Inherits the palette + typography from `docs/mockups/agent-ui-redesign/option-2b-refined.html`:
  - Teal-led palette (`--teal: #0d6760`), warm whites, indigo retired.
  - Fonts: Inter (UI), JetBrains Mono (token captions/payloads), Crimson Pro (headers).
- Layout mirrors the reference image:
  - Sticky **layer-toggle panel** at the top (see "Layers" section).
  - Numbered narrative steps (1–8) across the top, each prefixed with a coloured numeric badge that matches the wire colour for that step.
  - System diagram in the middle, left-to-right flow, on a fixed-size 2280 × 1080 px stage. The diagram container scrolls horizontally on narrower viewports rather than crushing the lanes.
  - Four JWT payload cards along the bottom — visually reordered (via CSS `order`) to align under their issuing node so the token-issue connector lines don't cross.
  - **Token-issue connector lines** (toggleable) drawn from each card up to the node that mints it.

## Boxes (services)

Grouped into 5 swim-lanes, left to right:

| Lane | Boxes |
|---|---|
| **Client** | `demo_api_ui :4000` (React SPA, cookie session via `bffAxios`) |
| **BFF** | `demo_api_server :3001` — Express, token custodian (`agentMcpTokenService.js`). Two attached sub-boxes: `Session Store: LMDB` and `Banking Data: in-memory store.js`. |
| **Agent runtimes** | `demo_agent_service :3006` (AG-UI runner) in front, with four sibling runtimes behind `resolveAgentTarget`: `langchain_agent :8888/:8889/:8890`, `openai_agent :8891`, `mastra_agent :8892`, `pydantic_agent :8893`. |
| **Gateway + HITL** | `demo_mcp_gateway :3005` and `demo_hitl_service :3009`. |
| **MCP servers** | `demo_mcp_server :8080` (banking), `demo_mcp_invest :8081`, `demo_mortgage_service :8082`. |
| **PingOne** | `PingOne OAuth/AS` (authorize, token, RFC 8693, introspect) and `PingOne AAM / Authorize` (policy decisions) anchored on the right. |

## Edges (transports)

| Style | Transport | Examples |
|---|---|---|
| Teal solid | HTTPS REST + cookie | Browser → BFF |
| Teal dashed | HTTPS REST | BFF → PingOne, BFF → MCP Gateway (token exchange/introspect), Gateway → Mortgage `:8082` (API-key conversion at the gateway), Gateway ↔ HITL, MCP server → BFF `/api/...` for banking data callback |
| Indigo solid | WebSocket / JSON-RPC | BFF ↔ MCP Gateway, Gateway ↔ Banking MCP, Gateway ↔ Invest MCP |
| Indigo dashed | WebSocket (chat) | Browser ↔ LangChain `:8889` (when used directly) |
| Gold | SSE `text/event-stream` (AG-UI) | `demo_agent_service /run` → BFF → Browser (token-chain events, `STATE_DELTA`) |
| Rose dashed | HITL hold | Gateway → HITL `/challenges` → poll loop → Dashboard `POST /respond` |
| Orange | PingOne policy decision | Gateway → PingOne AAM (introspection + authorize) |

## Layers (toggle panel)

A sticky toolbar above the frame exposes 9 checkboxes. Unchecking a box adds a `hide-<name>` class to `<body>`; CSS hides the matching SVG `<g>` or HTML node.

| Toggle | Hides |
|---|---|
| Transport labels | All pill-style transport labels on arrows (`<g class="layer-label">`) |
| RFC 8693 / token exchange | The BFF→PingOne arc and its label (`layer-rfc`) |
| PingOne AAM (authorize) | The Gateway→PingOne AAM arrow and label (`layer-aam`) |
| HITL path | The Gateway↔HITL line and label (`layer-hitl`) |
| AG-UI / SSE | The BFF→demo_agent_service arrow and label (`layer-agui`) |
| MCP → BFF callback | The MCP banking → BFF top arc (`layer-callback`) |
| Optional direct WS | The Browser→LangChain `:8889` faint arc (`layer-optional`) |
| JWT payload cards | The whole bottom-strip JWT card section (`layer-tokens`) |
| Port chips | The port chips inside each node (`:3001`, `:8080`, …) |
| Token issue lines | The four connector lines drawn from cards up to issuers (`issued-lines`) |

Toggles are independent and can be combined for screenshot variants (e.g., "structure only" = uncheck labels + ports + issue lines).

## Token overlay — bottom row JWT payload cards

Four cards in the bottom strip, JetBrains Mono, matching the reference's payload boxes.

**Each card carries:**

- A `data-issuer="<node-id>"` attribute pointing to the node that mints it.
- A `data-issue-step="<n>"` attribute naming the step in the narrative where it's issued.
- A row of **step-number badges** above the JSON payload, naming every step where the token appears (e.g., Token #3 = "④ output of RFC 8693", "⑤ WS to Gateway", "⑥ introspect at AAM"). Badge background colour matches the wire colour for that hop.
- A one-line **hop description** ("Rides the BFF→Gateway WebSocket as the bearer…") with a coloured dot to anchor the eye.

**Card visual order** (via CSS `order`, HTML order unchanged):

| Visual position | Token | Issuer | Reason |
|---|---|---|---|
| 1 (leftmost) | **Token #3** — MCP Gateway token | `demo_api_server` (BFF) | aligns under BFF column |
| 2 | **Token #4** — Per-MCP server token | `demo_mcp_gateway` | aligns under Gateway column |
| 3 | **Token #1** — User token | `PingOne OAuth / AS` | aligns under PingOne column |
| 4 (rightmost) | **Token #2** — Agent actor token | `PingOne OAuth / AS` | also under PingOne (right of #1) |

Numeric labels and step badges preserve chronology; the visual order makes connector lines run roughly vertically.

## Token-issue connector lines

A page-level `<svg class="issued-lines">` overlay draws four dashed Bezier curves from each card's top-center anchor up to the bottom edge of its issuing node. A small numbered circle at the issuer-side terminus shows the step (① ④ ④ ⑧).

- Colour-coded per token: Token #1 teal, Token #2 indigo, Token #3 orange, Token #4 moss.
- When N>1 cards share an issuer (Tokens #1 and #2 both → PingOne OAuth), JS fans the anchor points across the issuer's bottom edge (25% / 75%) so the lines stay parallel.
- Re-drawn on `window.resize` and whenever a layer toggle fires (since hiding layers can shift card positions).

## JWT payload contents

1. **User token** (issued to BFF after login)
   - `aud: bff`
   - `scope: openid banking ai_agent`
   - `sub: <user_id>`
   - `may_act: { sub: <agent_client_id> }`

2. **Agent actor token** (client_credentials, optional — `USE_AGENT_ACTOR_FOR_MCP=true`)
   - `client_id: <agent_client_id>`
   - `aud: pingone`
   - `scope: use_agent`

3. **MCP Gateway token** (after RFC 8693 at BFF)
   - `aud: mcp_gateway_resource_uri`
   - `sub: <user_id>`
   - `act: { sub: <agent_client_id> }`
   - `scope: read write`

4. **Per-MCP server token** (after RFC 8693 at Gateway)
   - `aud: mcp_banking_resource_uri | mcp_invest_resource_uri | mortgage_api`
   - `sub: <user_id>`
   - `act: { sub: <agent_client_id> }`
   - `scope: read write`

## Numbered narrative (top strip, steps 1–8)

Each `<li>` has a `data-step="<n>"` attribute; CSS generates a numbered circle whose background colour matches the wire colour for that hop. Token references inline so the eye links narrative ↔ card ↔ wire.

1. User authenticates → PingOne issues **User token (Token #1)**; browser only receives the `connect.sid` session cookie.
2. User opens chat → BFF's `resolveAgentTarget` selects the active runtime (LangChain / OpenAI / Mastra / Pydantic) from `configStore.llm_framework`.
3. Agent reasons via `demo_agent_service /run` → emits `STATE_DELTA` over AG-UI SSE → BFF → Browser.
4. Agent decides to call an MCP tool → BFF (optionally with **Token #2** actor token) performs **RFC 8693** → **MCP Gateway token (Token #3)**.
5. BFF opens JSON-RPC over WebSocket to `demo_mcp_gateway` carrying Token #3.
6. Gateway introspects Token #3 → calls PingOne AAM (authorize policy): **PERMIT / DENY / INDETERMINATE**.
7. INDETERMINATE → Gateway POSTs to `demo_hitl_service /challenges` and polls until a human decision arrives from the dashboard.
8. PERMIT → Gateway performs another **RFC 8693** → **per-MCP server token (Token #4)** → executes tool. MCP servers call back to the BFF's banking API for data.

## Mermaid companion

`docs/architecture-token-flow.mmd` is a static mermaid version of the same diagram, embeddable in README / GitHub / runbooks.

**Includes:** all 14 nodes + transport-labeled edges grouped into the same 5 subgraphs (Client / BFF / Agents / Gateway+HITL / MCP / PingOne), plus the External agent box and the PKCE redirect arc.

**Does NOT include:** layer toggles, scenario highlighting, JWT payload cards, token-issue connector lines, step badges, or the AG-UI SSE return path. Mermaid can't express these.

The interactive HTML is the canonical version; the mermaid file is a quick-reference snapshot.

## Implementation notes

- **Stage**: fixed-size 2280 × 1080 px container with absolutely-positioned `.nbox` nodes and a sibling `<svg class="wires">` overlay at `inset:0`. Coordinates are stage-local pixels (no responsive grid).
- **Wires**: each transport is a `<g class="layer-…">` containing a `<path>` and a `<g class="layer-label">` (label pill + text) centred on the path's actual midpoint.
- **Arrow markers**: six colour-specific `<marker>` defs (`ar-teal`, `ar-indigo`, `ar-gold`, `ar-rose`, `ar-orange`, `ar-moss`).
- **JS** (vanilla, inline): two responsibilities — toggle body classes on layer-toggle change, and compute/draw the token-issue connector lines after layout and on resize.

## Non-goals

- Not an interactive explorer beyond the layer toggles and resize-aware connector lines. No clickable nodes, no live data, no animation timeline.
- Not a replacement for `architecture.mmd` (which stays as the version-controlled mermaid source).
- Does not document the admin client-credentials path, OAuth callback details, or bootstrap flows.

## Success criteria

- Single self-contained HTML file (Google Fonts CDN; no framework, no build).
- Visually consistent with `option-2b-refined.html` (same fonts, palette, density).
- Every box labels its port; every edge labels its transport, centred on the path.
- Four JWT payload cards along the bottom, each cross-referenced to the narrative steps via numeric badges and a connector line up to its issuer.
- All nine layer toggles operate independently with no flicker.
- Renders correctly in Chrome/Safari; diagram scrolls horizontally rather than crushing on viewports narrower than the 2280 px stage.
