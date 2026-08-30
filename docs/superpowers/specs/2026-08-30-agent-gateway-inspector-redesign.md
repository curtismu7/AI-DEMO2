# Agent Gateway Inspector Redesign — Architectural Spec

**Date:** 2026-08-30  
**Status:** Draft  
**Scope:** Full-page redesign using 3-pane clean layout pattern

## Executive Summary

Redesign the Agent Gateway Inspector page (currently `AgentGatewayCapabilitiesPage.jsx`) to adopt the 3-pane clean layout pattern established by the PingOne Authorize console redesign. The new design provides a unified, modern interface for testing and debugging MCP tools via the Agent Gateway.

Additionally, implement a light/dark mode toggle in the header on **both** Agent Gateway Inspector and PingOne Authorize console pages to provide consistent theme control across the platform.

---

## Architecture

### Page Structure

The redesigned page uses a fixed 3-pane layout with header and footer:

```
┌─────────────────────────────────────────────────────┐
│ Header: Title | Status Bar | [🌙 Dark Mode Toggle] │
├──────────────┬───────────────────┬─────────────────┤
│   LEFT       │     MIDDLE        │      RIGHT      │
│   (240px)    │   (flex: 1)       │   (320px)       │
│              │                   │                 │
│ • Gateway    │ • Tool Selection  │ Output Tabs:    │
│   Selector   │ • Single/Chain    │ • Response      │
│              │   Toggle          │ • Request       │
│ • Capability │ • Parameter Form  │ • Trace         │
│   Filters    │ • Execute Button  │ • Logs          │
│   (checkbox) │                   │ • Performance   │
│              │                   │ • Diff          │
│              │                   │ • (scrollable)  │
│              │                   │                 │
├──────────────┴───────────────────┴─────────────────┤
│ Movie Reel: Last 4 invocations (horizontal scroll) │
└─────────────────────────────────────────────────────┘
```

### Component Hierarchy

```
AgentGatewayInspectorClean (new main component)
├── Header (reuse inspector-clean-header)
│   └── Light/Dark Toggle (new, shared with P1AZ)
├── Left Panel (GatewayFilters)
│   ├── Gateway Selector (dropdown)
│   └── Capability Filters (checkbox list)
├── Middle Panel (ToolInvocationForm)
│   ├── Single/Chain Toggle
│   ├── Tool Selector (dropdown)
│   ├── Parameter Form (dynamic fields)
│   └── Execute Button
├── Right Panel (OutputTabs)
│   ├── Tab Buttons (Response, Request, Trace, Logs, Performance, Diff)
│   └── Tab Content (scrollable JSON/text)
└── MovieReel (HistoryReel)
    └── Recent Invocations (clickable frames)
```

### Hook: useAgentGatewayInspector

Unified state management hook (mirrors `usePingOneAuthorizeConsole` pattern):

```javascript
const {
  // Gateway/capability selection
  selectedGateway,
  setSelectedGateway,
  selectedCapabilities,
  toggleCapability,
  
  // Tool invocation
  selectedTool,
  setSelectedTool,
  isChainMode,
  setIsChainMode,
  parameters,
  updateParameter,
  
  // Execution
  running,
  result,
  error,
  lastParameters,
  lastTrace,
  
  // Output tabs
  outputTab,
  setOutputTab,
  
  // Movie reel history
  invocationHistory,
  activeReelId,
  selectReelEntry,
  
  // Theme
  darkMode,
  toggleDarkMode,
} = useAgentGatewayInspector({ gatewayId })
```

---

## Left Panel: Gateway & Capability Filters

**Components:**
- `GatewaySelector` — Dropdown to choose MCP gateway
- `CapabilityFilters` — Checkbox list of available tools/capabilities

**Behavior:**
- Selecting a gateway fetches available capabilities
- Checking capabilities pre-filters what tools can be invoked
- Filtering is client-side (for speed); server validates on execution

**Data Source:**
- Gateways: `/api/agent-gateway/gateways`
- Capabilities: `/api/agent-gateway/capabilities?gatewayId={id}`

---

## Middle Panel: Tool Invocation Form

**Components:**
- `ToolInvocationForm` — Main form container
- `SingleToolMode` — Single tool execution
- `ToolChainMode` — Sequential tool execution (uses prior output as input)
- `SingleToolMode/ChainMode` — Toggle between modes
- `ParameterForm` — Dynamic fields based on selected tool schema

**Single Tool Flow:**
1. User selects tool from dropdown
2. Form renders dynamic parameter fields (based on tool schema)
3. User fills parameters
4. User clicks Execute
5. POST to `/api/agent-gateway/invoke` with { gatewayId, tool, parameters }
6. Result goes to right panel

**Tool Chain Flow:**
1. User selects first tool
2. Fills parameters
3. "Add to chain" button adds it to a list
4. User selects second tool (optionally uses `$.output` for previous result)
5. Repeats until satisfied
6. "Execute Chain" runs sequentially, feeding each output to next
7. Final result shown in right panel

---

## Right Panel: Output Tabs

**Tab Structure:**

| Tab | Content | Source |
|-----|---------|--------|
| **Response** | Full JSON response from tool | `result.response` |
| **Request** | HTTP request sent (method, URL, body) | `result.request` |
| **Trace** | Execution trace (timing, decisions, errors) | `result.trace` |
| **Logs** | Server logs for this invocation | `result.logs` |
| **Performance** | Latency breakdown (gateway, tool, parsing) | `result.performance` |
| **Diff** | Compare last two invocations (side-by-side) | `invocationHistory` |

**Styling:**
- Tab buttons: active state highlighted
- Content area: scrollable, monospace font, JSON syntax highlight (optional)
- Empty state: "Execute a tool to see results"

---

## Movie Reel: Invocation History

**Behavior:**
- Displays last 4 invocations (horizontal scrollable)
- Each frame shows: tool name + outcome (success/error/denied) + duration
- Clicking a frame restores that invocation's state (parameters, result, tabs)
- Active frame highlighted

**Data:**
- Stored in component state (session only, not persisted)
- Frame structure: `{ id, tool, outcome, durationMs, timestamp, parameters, result }`

---

## Light/Dark Mode Toggle (Shared)

**Implementation:**
- Toggle button in header (top-right, next to status bar)
- Uses `data-theme` attribute on `:root` (per THEMING.md)
- Persisted to localStorage as `theme-preference`
- Applied to **all pages**: Agent Gateway Inspector + PingOne Authorize console
- CSS follows existing theme pattern: tokens at `:root`, dark overrides via `@media (prefers-color-scheme: dark)` + `[data-theme="dark"]`

**Files to update:**
- `PingOneAuthorizePage.jsx` — Add toggle to header
- `AgentGatewayInspectorClean.jsx` — Add toggle to header
- Both use shared theme context/hook

---

## Data Flow

### Invocation Lifecycle

```
User selects gateway/capabilities
  ↓
User selects tool
  ↓
Form renders dynamic parameters
  ↓
User fills parameters + clicks Execute
  ↓
POST /api/agent-gateway/invoke
  ↓
Server executes tool via gateway
  ↓
Response includes: response, request, trace, logs, performance
  ↓
Result displayed in right panel
  ↓
Frame added to movie reel
  ↓
User can click reel frame to restore state
```

### Error Handling

- **400 (Invalid params)**: Display in error banner + highlight field
- **401 (Not authorized)**: Show "Access denied" + suggest re-auth
- **500 (Server error)**: Show trace + logs tab auto-selected for debugging
- **Timeout (>30s)**: Kill execution, show elapsed time + partial trace if available

---

## Files to Create/Modify

**New Files:**
- `demo_api_ui/src/components/AgentGatewayInspectorClean.jsx` (240 lines)
- `demo_api_ui/src/components/AgentGatewayInspectorClean.css` (160 lines)
- `demo_api_ui/src/hooks/useAgentGatewayInspector.js` (290 lines)
- `demo_api_ui/src/hooks/useThemePreference.js` (new, shared theme hook)

**Modified Files:**
- `demo_api_ui/src/pages/AgentGatewayCapabilitiesPage.jsx` — Wire in new component + add toggle
- `demo_api_ui/src/components/PingOneAuthorizePage.jsx` — Add light/dark toggle to header
- Both header components to use shared `useThemePreference` hook

**BFF Changes (none):**
- Existing endpoints (`/api/agent-gateway/invoke`, etc.) already support all needed data

---

## Testing Strategy

**Unit Tests:**
- `useAgentGatewayInspector` hook
- Component rendering (left/middle/right panels)
- Theme toggle (localStorage persistence)

**Integration Tests:**
- Invoke single tool → verify output tabs populate
- Invoke tool chain → verify sequential execution
- Click reel frame → verify state restoration
- Theme toggle → verify CSS updates

**E2E Tests (Playwright):**
- Full flow: select gateway → select tool → fill params → execute → check results
- Reel click restores form + tabs
- Dark mode toggle persists across navigation

**Coverage Target:**
- Hook: 80%+
- Component: 70%+ (skip snapshot tests)
- Integration: 100% happy path

---

## Success Criteria

✅ Page renders 3-pane layout correctly (light + dark mode)  
✅ Gateway selector loads and filters capabilities  
✅ Single tool execution works (POST, response displayed)  
✅ Tool chain mode stacks tools with prior outputs  
✅ All 6 output tabs render correct data  
✅ Movie reel shows last 4 invocations + click restores state  
✅ Light/dark toggle appears on header + persists  
✅ Error handling for 400/401/500/timeout  
✅ Tests pass (unit + integration + E2E)  
✅ Deployed to SE AWS + live at `https://ai-demo.ping-devops.com/agent-gateway`

---

## Open Questions / Notes

- **Tool Chain Error Handling:** If tool 1 succeeds but tool 2 fails, show partial chain results? (Recommend: yes, with error badge)
- **Parameter Schema:** Tool schema from gateway `/describe` endpoint? (Assume: yes, already available)
- **Reel Limit:** Last 4 or configurable? (Recommend: 4, consistent with P1AZ)
- **Diff Tab:** Always compare to prior invocation, or allow selecting two runs? (Recommend: auto-compare to prior, simpler)

---

## Deployment Plan

1. **Phase 1:** Implement hook + components (1-2 days)
2. **Phase 2:** Wire into page + tests (1 day)
3. **Phase 3:** Theme toggle + both pages (0.5 days)
4. **Phase 4:** E2E tests + fix findings (1 day)
5. **Merge to main** → Deploy to SE AWS

**Deployment target:** Same k8s namespace + URL as live agent-gateway page
