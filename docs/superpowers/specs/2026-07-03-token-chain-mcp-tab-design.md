# Token Chain — MCP Tab

**Date:** 2026-07-03
**Status:** Approved design (pending spec review)
**Component family:** `TokenChainTraceRail`

## Goal

Add a dedicated **MCP tab** to the Token Chain rail that surfaces only the
MCP-relevant portion of the delegation flow. MCP continues to appear in the
full chain as it does today — the tab is an additional, focused view, not a
removal.

## Motivation

The full pipeline has 11 steps across many lanes. The MCP-specific story —
which delegated token reaches the MCP server, what tool ran there, with what
arguments and result — is currently spread across the exchange step, the MCP
token card in the summary, and the MCP/API steps. A single MCP tab collects
that story in one place.

## Non-goals

- No backend changes. All data is already in the client-side trace.
- No change to the `getMCPToolCalls` audit fetch (the `/audit` 401 path is
  unrelated and out of scope).
- No change to the default (full-chain) view's behavior or layout.

## Data (already available, client-side)

From `tokenChainTraceStore.getState()` → `{ steps, trace }`:

- `trace.mcpResult` = `{ tool, requestJson, durationMs, result }` — the tool
  execution detail. May be `null` before a tool runs.
- The `mcp` token event (via `TraceTokenSummary` / `ClaimDetailsModal`,
  `inspectToken: "mcp"`) — delegated token claims, nested `act`, scope diff.
- `steps` — the ordered pipeline steps, each with a `lane`
  (`BFF` for `exchange`, `GATEWAY`, `MCP`, `API`) and an `id`
  (`exchange`, `gateway`, `mcp`, `api`).

No new fetch, store field, or backend route is introduced.

## UI design

### 1. Tab bar (in `TokenChainTraceRail.jsx`)

A two-tab strip rendered directly under the existing rail header:

```
Token Chain | MCP (n)
```

- Local state: `const [tab, setTab] = useState("chain")`.
- **Token Chain** tab (default): renders exactly today's body — chain line,
  section label, all steps, `TraceTokenSummary`, and the "Exchange Mode
  Details" accordion. Unchanged.
- **MCP** tab: keeps the chain line (User → Agent → MCP dots + `CHAINED`
  badge) at the top for continuity, then renders `<TraceMcpPanel>` in place of
  the section label / steps / summary / accordion.
- The MCP tab label shows a small count badge = number of MCP-scope steps
  (`exchange/gateway/mcp/api`) with status `done`. The badge always renders;
  its value is `0` before any MCP step completes.

### 2. `TraceMcpPanel.jsx` (new component)

Props: `{ steps, trace, onInspect }` — pure, no store access. Derives its data
by filtering the passed `steps`. Renders three stacked sections:

**a. Delegated token**
Reuse the existing MCP token card. `TraceMcpPanel` renders
`<TraceTokenSummary tokenEvents={trace.tokenEvents} onInspect={onInspect} />`
filtered to the `mcp` token, OR — to avoid changing `TraceTokenSummary`'s
public shape — a thin local render of the same mcp card markup. **Decision:**
add an optional `only` prop to `TraceTokenSummary` (e.g. `only="mcp"`) that
restricts which token cards it renders; default renders all (today's
behavior). This keeps one source of truth for the card markup.

**b. Tool execution**
Compact summary from `trace.mcpResult`:
- tool name, `durationMs` (if present)
- JSON-RPC request (`requestJson || { name: tool }`)
- result (`mcpResult.result`)
- Empty state when `mcpResult` is null: "No MCP tool call yet."

**c. MCP pipeline steps**
The existing `TraceStepCard`s, filtered to ids
`["exchange", "gateway", "mcp", "api"]`, in that order. Reuses the card
component verbatim, so expand/chevron/completed-shading/inspect all carry over.

### 3. Styling

Add tab-strip and `TraceMcpPanel` styles to `TokenChainTraceRail.css`, matching
the existing navy/slate palette. Section headers reuse the `.tctr-sec-label`
style. No new color system.

## Component boundaries

- `TokenChainTraceRail` — owns tab state; decides which body to render. Passes
  `steps`, `trace`, `onInspect` down. Unchanged data source.
- `TraceMcpPanel` — pure presentational; filters `steps` and reads `trace`.
  Independently testable with a mock `steps`/`trace`.
- `TraceTokenSummary` — gains an optional `only` prop (backward compatible).
- `TraceStepCard` — unchanged; reused.

## Testing

- Existing `TokenChainTraceRail.test.jsx` stays green (default tab = chain).
- New tests:
  - Clicking the MCP tab shows `TraceMcpPanel` and hides the full step list /
    summary; chain line remains.
  - `TraceMcpPanel` renders only the `exchange/gateway/mcp/api` steps given a
    mock `steps` array containing all lanes.
  - Tool-execution empty state when `trace.mcpResult` is null.
  - `TraceTokenSummary only="mcp"` renders just the mcp card.

## Files

- `demo_api_ui/src/components/TokenChainTraceRail.jsx` — add tab bar + branch.
- `demo_api_ui/src/components/TraceMcpPanel.jsx` — new.
- `demo_api_ui/src/components/TokenChainTraceRail.css` — tab + panel styles.
- `demo_api_ui/src/components/TraceTokenSummary.jsx` — optional `only` prop.
- `demo_api_ui/src/components/__tests__/TokenChainTraceRail.test.jsx` — extend.
- `demo_api_ui/src/components/__tests__/TraceMcpPanel.test.jsx` — new.

## Success criteria

1. A "Token Chain | MCP" tab strip appears under the rail header everywhere the
   rail renders (both dashboards + `TokenChainModal`).
2. Default view is byte-for-byte today's behavior.
3. MCP tab shows: chain line, delegated-token card (with Inspect), tool
   execution detail (or empty state), and the exchange→gateway→mcp→api steps.
4. MCP still appears in the full-chain tab.
5. All existing tests pass; new tests cover tab switch, step filter, empty
   state, and the `only` prop.
