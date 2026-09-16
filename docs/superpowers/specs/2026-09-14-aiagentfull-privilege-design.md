# AIAgentFull — Privilege-Capable Agent Widget

**Goal:** Add a second, full-featured chat widget (`AIAgentFull`) alongside the
existing `AIAgent.js`, selectable per route, that carries over `AIAgent.js`'s
existing capabilities verbatim (Demo Steps picker, LLM mode selector including
Privilege LLM lanes) and additionally offers a Privilege MCP Gateway transport
for tool calls. Privilege A2A is stubbed for a later phase.

## Background

- `AIAgent.js` (`demo_api_ui/src/components/AIAgent.js`, ~10k lines) is the
  single real chat widget, mounted once in `App.js`, rendered as floating FAB /
  bottom-dock / inline depending on route (`embeddedAgentFabVisibility.js`
  predicates + `AgentUiModeContext`).
- It already has: `DemoStepsDropdown` (demo step picker, `DemoStepsDropdown.jsx:44`,
  rendered `AIAgent.js:10144`) and `AgentModeSelector` (LLM mode picker,
  rendered `AIAgent.js:9809`), whose mode table already includes
  `privilege_llm` / `privilege_claude` — Gemini/Claude routed through a
  Privilege virtual-key LLM lane (`demo_api_server/services/agentModeResolver.js`,
  mirrored client-side in `demo_api_ui/src/config/agentModes.js`). Both
  capabilities are carried over unmodified by a full duplicate — no new work.
- It does **not** have any way to route MCP tool calls
  (`demoAgentService.callMcpTool` → `POST /api/mcp/tool` →
  `demo_api_server/services/mcpToolPipeline.js`) through the PingOne Privilege
  AI Gateway. `mcpToolPipeline.js` is the protected core of the banking demo —
  RFC 8693 token exchange, the PingOne Authorize gate, the kill-switch, HITL
  challenges, introspection — `REGRESSION_PLAN.md` §1 territory.
- A separate, already-working, standalone endpoint
  `POST /api/privilege-mcp-simple/tools/call`
  (`demo_api_server/routes/privilegeMcpSimple.js`) exercises the same MCP
  server through the Privilege AI Gateway using its own `client_credentials`
  grant — no browser session, and none of the banking consent/HITL/kill-switch
  layer.
- Privilege A2A is out of scope for this plan — deferred.

## Decisions

1. **`AIAgent.js` is never modified.** `AIAgentFull.js` is a full duplicate —
   same features, same code — plus the additions below.
2. **Toggle:** a route-keyed predicate (new function in
   `embeddedAgentFabVisibility.js`, following that file's existing convention)
   decides which of `AIAgent` / `AIAgentFull` mounts at the single JSX call
   site in `App.js`. Default: `AIAgent` — behavior is unchanged everywhere
   unless a route opts in.
3. **Demo Steps, LLM lane:** no new work. Inherited verbatim from the
   duplicated code (`DemoStepsDropdown`, `AgentModeSelector` are already
   present and working in `AIAgent.js`).
4. **MCP transport (new):** `AIAgentFull` gets a "Direct / Via Privilege
   Gateway" selector. Selecting "Via Privilege Gateway" makes its tool calls
   go to the standalone `/api/privilege-mcp-simple/tools/call` endpoint
   instead of `/api/mcp/tool` — **additive only, zero changes to
   `mcpToolPipeline.js` or `/api/mcp/tool`.** The UI must label that this path
   is *not* covered by the banking demo's consent/HITL/kill-switch layer —
   Privilege's own policy is the only enforcement on this path. Full pipeline
   integration (Privilege as a third transport inside `mcpToolPipeline.js`, on
   equal footing with PingGateway, threaded through Authorize/HITL/kill-switch)
   is explicitly deferred — a `TECH_DEBT.md` entry, not part of this plan.
5. **A2A:** a disabled UI row reading "Privilege A2A — coming later." No
   backend work.

## Interfaces (verified in-repo)

- `demoAgentService.callMcpTool(tool, params, {signal, useCaseId, vertical,
  onTokenEvent}) → {result, tokenEvents}` (`demo_api_ui/src/services/demoAgentService.js:168`),
  POSTs `/api/mcp/tool`. ~40 call sites throughout `AIAgent.js`'s body all use
  this exact signature and destructure `.result` / `.tokenEvents` from the
  return value.
- `privilegeMcpSimple.js` `POST /tools/call` (line 274): body `{name,
  arguments}` → the raw MCP JSON-RPC result. Auth is server-side
  `client_credentials` (`getAccessToken()` line 120); no browser session
  needed, so the frontend can call it directly.
- `AGENT_MODES` tables (`demo_api_server/services/agentModeResolver.js`,
  `demo_api_ui/src/config/agentModes.js`) already list `privilege_llm` /
  `privilege_claude`; `AgentModeSelector` is the picker UI. No change needed.
- `DemoStepsDropdown` (`demo_api_ui/src/components/DemoStepsDropdown.jsx:44`):
  props `{vertical='banking', disabled=false, open=false, onOpenChange,
  onSelect, onStopAgentClick}`. No change needed.
- `App.js`: single `<AIAgent>` mount (~line 1992-2007), fed
  `singleAgentSurfaceProps` (~602-615) and gated by `shouldMountSingleAgent`
  (~591-596); route predicates live in `embeddedAgentFabVisibility.js`.

## Implementation approach for the MCP transport switch

Rather than editing ~40 call sites, `AIAgentFull.js` shadows the module-level
`callMcpTool` import with a component-scoped dispatcher of the identical
signature, closing over new `mcpTransport` state (`"direct" | "privilege"`).
Every existing call site in the duplicated body resolves to this local shadow
via ordinary JS lexical scoping — zero other lines in the ~10k-line body need
to change.

A new service, `demo_api_ui/src/services/privilegeMcpService.js`, exports
`callMcpToolViaPrivilege(tool, params, opts)`. It POSTs
`/api/privilege-mcp-simple/tools/call` with `{name: tool, arguments: params}`
and wraps the raw MCP result as `{result: <raw>, tokenEvents: []}` to match
`callMcpTool`'s contract exactly, so the ~40 call sites need no changes.

## Out of scope

- Full `mcpToolPipeline.js` integration of Privilege as an Authorize/HITL-aware
  transport (tracked as follow-up work, not this plan).
- Privilege A2A implementation.
- Any change to `AIAgent.js`, `demoAgentService.js`, `agentModeResolver.js`,
  `agentModes.js`, or `mcpToolPipeline.js`.
