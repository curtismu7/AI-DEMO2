# /mcp-tools Live Page — Design

**Date:** 2026-06-12
**Status:** Approved in discussion; spec for implementation planning
**FINAL DISPOSITION (2026-06-12, supersedes the body below):** no new page.
Per user decision ("option 3"), the genuinely new ideas — real JSON-RPC
frame capture and the token-exchange chain — were folded into the EXISTING
`/mcp-inspector` page instead, since it already did live tools/list + invoke
for the banking MCP server. Implemented same day:
`mcpListToolsWithFrames` / `mcpCallToolWithFrames`
(`services/mcpWebSocketClient.js`), frames + `tokenEvents` on
`GET /api/mcp/inspector/tools` and `POST /api/mcp/inspector/invoke`
(including the 502 error body), and collapsible frame/token-chain panels on
`McpInspector.js`. `/mcp-tools` (education) and `/pingone-mcp-inspector`
are untouched. The `/mcp-tools-live` page, `McpInspectorKit` extraction,
and catalog-merge design below were NOT built.

**Amended:** 2026-06-12 — (1) UI aligned with the shipped PingOne MCP
Inspector patterns; (2) split into two pages; (3) redirected into
`/mcp-inspector` per the final disposition above.
**Owner pages (historical):** `/mcp-tools`, `/mcp-tools-live`; **actual:**
`/mcp-inspector`

## Goal

Give the banking MCP server a real, interactive tools page: a NEW
`/mcp-tools-live` page drives its tool catalog from a live MCP `tools/list`,
lets the user run every tool against the real MCP server, and shows the
**actual JSON-RPC request and response frames** that went over the wire.
Today's `/mcp-tools` education page is untouched and remains the static
teaching reference; the live page links to it (and vice versa). When the MCP
server is down or the session has no usable token, the live page renders the
static catalog as a clearly-badged fallback so it never goes blank.

## Background (current state)

- `/mcp-tools` renders `demo_api_ui/src/components/MCPToolsEducation.tsx` —
  100% hardcoded: a static `TOOL_CATEGORIES` catalog, fabricated sample
  requests (`buildSampleRequest`) and canned `exampleResponse` strings, plus
  education sections (chips mapping table, coverage matrix, MCP elicitation
  explainer).
- A real MCP path already exists and is reused, not duplicated:
  - `GET /api/mcp/inspector/tools` (`demo_api_server/routes/mcpInspector.js`)
    — live `tools/list` via RFC 7662 introspection → RFC 8693 exchange →
    WebSocket JSON-RPC to the MCP server, with a graceful fallback ladder
    (no session bearer → local catalog; exchange rejected → local catalog;
    MCP unreachable → local catalog), reported via `_source` /
    `_localCatalogReason`.
  - `POST /api/mcp/inspector/invoke` — real `tools/call` through the same
    token exchange and gateway, falling back to the in-process local handler
    (`_localFallback: true`) when the MCP server is unreachable.
  - `demo_api_server/services/mcpWebSocketClient.js` (`mcpRpc`) builds the
    exact JSON-RPC frames (`initialize` → `notifications/initialized` →
    `tools/list` / `tools/call`) but discards them after resolving
    `msg.result`.

## Decisions (from design discussion)

1. **Separate live page** (supersedes the original "upgrade `/mcp-tools` in
   place" decision, per user direction 2026-06-12): the live experience is a
   NEW `/mcp-tools-live` page; `/mcp-tools` (MCPToolsEducation) is not
   modified. The BFF fallback ladder still gives the live page a static
   fallback rendering so it degrades gracefully when the MCP server is down.
2. **All tools runnable live**, including writes (`create_deposit`,
   `create_withdrawal`, `create_transfer`, `get_sensitive_account_details`).
   A >$500 transfer returning the genuine `hitl_required` JSON is teaching
   material, not a hazard; demo data is per-user and reseedable. No
   confirmation dialog.
3. **BFF echoes the real frames** — the UI must show what was actually sent,
   not a client-side reconstruction.
4. **Tokens:** no new acquisition work. The user's normal sign-in puts the
   PingOne user access token in the BFF session; every call runs the existing
   per-call RFC 8693 exchange to mint the MCP access token. Token visibility
   is intentional in this demo (teaching), so frames are returned as sent,
   including `agentToken`/`userSub` params. The exchange's existing
   `tokenEvents` (decoded header/claims per token) are surfaced alongside the
   frames.

## Design

### 1. BFF — `demo_api_server`

**`services/mcpWebSocketClient.js`** — opt-in frame capture in `mcpRpc`:

- Capture the follow request frame (`tools/list` or `tools/call`, exactly as
  serialized, including the `agentToken` / `userSub` / `correlationId` params
  added to `callParams`) and the raw response frame (`msg` as received,
  success or JSON-RPC error).
- Exposed as `mcpListToolsWithFrames(...)` / `mcpCallToolWithFrames(...)`
  returning `{ result, frames: { request, response } }`. Existing exports and
  all existing callers are untouched.

**`routes/mcpInspector.js`**:

- `GET /api/mcp/inspector/tools`: when `_source: 'mcp_server'`, add
  `frames: { request, response }` to the response body. Fallback responses
  are unchanged.
- `POST /api/mcp/inspector/invoke`: on the live path, add
  `frames: { request, response }` and `tokenEvents` (already produced by
  `resolveMcpAccessTokenWithEvents`; today returned only on error). The
  local-fallback shape (`_localFallback: true`, `inspector.phases`) is
  unchanged so existing consumers (McpInspector page) keep working.

No new endpoints. No change to the fallback ladder, MFA step-up gate, SSE
trace plumbing, or authorization pipeline.

### 2. UI — new `demo_api_ui/src/components/McpToolsLivePage.jsx`

A new page component at route `/mcp-tools-live` (login-gated like
`/mcp-tools`), registered in App.js and added to the sidebar's MCP group as
"MCP Tools Live" (nav arrays only — sidebar appearance is frozen). It links
to `/mcp-tools` ("Concepts & education") in its lead text; `/mcp-tools` may
gain at most a single reciprocal link line ("Try these live →"), no other
change. The static catalog metadata (`TOOL_CATEGORIES`, `sampleArg`,
category grouping) moves to — or is imported from — a shared module so both
pages read one source, not a copy.

**Catalog source.** On mount (and via a Refresh button), fetch
`GET /api/mcp/inspector/tools`:

- **Live mode** (`_source: 'mcp_server'`): banner
  "LIVE — catalog from banking_mcp_server via tools/list". Live tools are
  merged by `name` with the local education metadata (category grouping,
  `displayName`, `requiredScopes`, `readOnly`, params descriptions); live
  `description` / `inputSchema` win where present. Live tools with no local
  metadata render in an "Uncategorized" group. The real `tools/list`
  request/response frames are viewable in a collapsible section.
- **Fallback mode** (any other `_source`, or fetch error): banner
  "STATIC FALLBACK — <reason>" and the page renders exactly today's
  hardcoded catalog. This is the "MCP server down" experience.

**UI pattern alignment (added 2026-06-12, after the PingOne inspector
shipped).** `PingOneMcpInspector.js` + `PingOneMcpInspector.css` shipped the
presentation this page must match, so the two MCP pages feel like one family:

- **Collapsible sections** via the stateless `<details>`-based `Section`
  component (title + hint + chevron, `p1mcp-section` classes). Extract it —
  and the chip/param-form CSS — from `PingOneMcpInspector` into a shared
  module (e.g. `components/shared/McpInspectorKit.{js,css}`) rather than
  copying; with two consumers the extraction is now warranted. Tools open
  expanded; raw discovery request/response frames collapse by default.
- **Tool catalog as chips**, grouped by the existing local categories: each
  tool renders as a monospace pill chip (`p1mcp-chip`, active state when
  selected). Clicking a chip opens the tool card in place.
- **Schema-driven param form** instead of a raw JSON textarea: one labeled
  input per `inputSchema` property, required fields starred, declared type
  shown beside the field, values coerced to the schema type before sending
  (`coerceParam`). Prefill values from the existing `sampleArg` logic so a
  bare click still demonstrates the tool. A "JSON" escape hatch (toggle to
  the raw-arguments textarea) covers nested payloads the flat form can't
  express.

**Run live.** The tool card's "Run live" button posts to
`POST /api/mcp/inspector/invoke`. The result panel renders, each in its own
collapsible sub-section:

1. the real JSON-RPC request frame,
2. the real JSON-RPC response frame (including JSON-RPC errors, HITL
   `hitl_required`, and insufficient-scope responses as-is),
3. the token-exchange `tokenEvents` chain (user token → exchange → MCP token),
   reusing the existing `JsonField` shared component
   (`demo_api_ui/src/components/shared/JsonField.jsx`) for collapsible JSON.

A status line above the frames shows round-trip timing on success or the
error reason in red (`p1mcp-call-status` pattern). A `_localFallback: true`
result is badged "local handler (MCP server was unreachable)". A 401
(`authentication_required`) renders the BFF's message (sign out / sign in for
a cookie-only session).

**Education content stays put.** The chips mapping table, coverage matrix,
elicitation section, and canned examples remain on `/mcp-tools`, unmodified —
the live page does not duplicate them; it links back instead.

### 3. Out of scope

- No behavior changes to `/mcp-inspector` or `/pingone-mcp-inspector`. The
  PingOne inspector (keychain fix + collapsible/chips/invoke UI) shipped
  separately on 2026-06-12; the ONLY permitted touch is mechanical — moving
  its `Section` component and chip/param CSS into the shared
  `McpInspectorKit` module and updating its imports, with zero visual or
  behavioral change.
- No changes to `/mcp-tools` (MCPToolsEducation) beyond the optional single
  "Try these live →" link line and importing the catalog metadata from the
  shared module.
- No changes to agent chat paths, the gateway, the MCP server, or the
  authorization pipeline.
- No tool-call history persistence beyond what `mcpCallStore` already does.

## Error handling summary

| Condition | Behavior |
| --- | --- |
| Not signed in / cookie-only session | Catalog: static fallback + reason; Invoke: 401 with actionable message |
| RFC 8693 exchange rejected | Catalog: static fallback + reason; Invoke: error JSON + tokenEvents |
| MCP server unreachable | Catalog: static fallback; Invoke: local handler result badged `_localFallback` |
| Tool returns JSON-RPC error / HITL 428 / scope denial | Rendered verbatim as the real response frame |

## Constraints

- All work in a dedicated git worktree; explicit `git add`; verify branch
  before each commit.
- REGRESSION_PLAN §0: no new emojis (existing ones in the file are left
  as-is); minimal diff; UI build gate `cd demo_api_ui && npm run build`
  exits 0.
- CHANGELOG entry under `[Unreleased]`.

## Success criteria ("done")

1. BFF jest test: a live `tools/call` response includes `frames.request` /
   `frames.response` matching what `mcpRpc` sent/received, and `tokenEvents`.
2. With the stack up and a signed-in session: `/mcp-tools-live` shows the
   LIVE banner, a chip catalog from the real `tools/list`, and running
   `get_my_accounts` renders real request/response frames with real data.
3. A >threshold `create_transfer` renders the genuine HITL JSON response.
4. With the MCP server stopped: `/mcp-tools-live` shows the STATIC FALLBACK
   banner and the shared static catalog; invoking falls back to the local
   handler with the fallback badge.
5. `/mcp-tools` renders exactly as today (modulo the optional link line);
   `/mcp-tools-live` appears in the sidebar MCP group.
6. `npm run build` (demo_api_ui) green; existing BFF tests green.
