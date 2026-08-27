# External-door multi-vertical MCP tools — design (not yet built)

> Scoping doc only. No code changes from this doc — see "Open questions" before
> anyone starts implementing.

## Context

`00-mcp-external-door.json` (ping-gateway, host `cmuir-mcp.ping-devops.com`)
lets real external MCP clients (LM Studio, Claude Desktop, ...) self-register
via DCR and call the banking MCP server directly. `external-door-tools-filter.groovy`
trims `tools/list` to a curated 9-tool banking set so the response fits small
local-model context windows (the full ~44-tool catalog ran ~18K tokens, which
blew past LM Studio's default 8192-token window).

The ask: let the external door serve a **different** vertical's tools — driven
by whatever vertical is selected on Personal Agent Studio (the demo's own test
page) — instead of always banking.

## The blocker this doc exists to flag

**Checked live**: `oauth-mcp/src/tools/BankingToolRegistry.ts` (the only tool
registry `mcp-server:8080` — the external door's sole backend — actually
serves) has **no non-banking vertical tools**. The only `vertical:` tag present
is `'admin'`. `demo_api_server/utils/mcpToolRegistry.js` (the BFF's own
LangChain wrappers) don't add vertical tools either — they wrap the same
banking MCP calls plus generic utilities (`explainTopic`, Brave search).

The other 7 verticals (retail, healthcare, government, manufacturing,
workforce, airlines, mortgage/investment) exist in this demo as **frontend
mock data + BFF-internal dispatch**, never as MCP protocol tools. There is
nothing for a vertical-aware filter to select *from* today.

**This means "return the right vertical's tools" is blocked on "build that
vertical's tools as real MCP tools" first** — filtering logic alone (what
`external-door-tools-filter.groovy` already does for banking) is the easy
10% once the tools exist.

## What building this for real would require

1. **New tool implementations per vertical**, in `BankingToolRegistry.ts` (or
   a sibling registry file per vertical, still served by the same `mcp-server`
   process) — mirroring the existing banking tools' shape: `name`, `title`,
   `description`, `inputSchema`, `requiredScopes`, `readOnly`, handler logic
   reading each vertical's existing mock/SQLite data (per
   `project-all-verticals-sqlite-migration.md` / `project-sqlite-migration-all-8-verticals-2026-08-17.md`
   — the SQLite read-path already exists per vertical, just not exposed as MCP
   tools). This is the bulk of the work and needs one real design pass per
   vertical (what actions actually make sense as agent-callable tools).

2. **A curated allowlist per vertical**, matching the existing
   `publicAccess`/`restrictedAccess` split pattern already used for banking
   (`.well-known/mcp-server`, `README.md` "AI Client Setup") — small enough to
   fit a local model's context window, same reasoning as the current 9-tool
   banking set.

3. **A signal telling the external door which vertical to serve.** Per the
   confirmed direction: driven by Personal Agent Studio's vertical picker, not
   a per-client config or URL param. Concretely this means:
   - The BFF needs an endpoint the gateway can poll or be pushed to (e.g.
     `configStore` already holds cross-cutting demo state — a new key like
     `personal_agent_studio_vertical` is the natural fit, mirroring how other
     `ff_*`/demo-state toggles already flow from UI → BFF → `configStore`).
   - `external-door-tools-filter.groovy` (or a renamed, vertical-aware
     successor) would need to read that value — likely via an HTTP call to a
     new BFF endpoint (`GET /api/admin/personal-agent-studio/vertical` or
     similar), cached briefly, since Groovy scripts can't read `configStore`
     directly (it's a BFF-side Node module).
   - **Open design question**: is "whatever the demo operator last clicked on
     Personal Agent Studio" an acceptable signal for a *specific external
     agent's* tool list? It's shared, global, single-value state — two people
     driving two different LM Studio instances against the same demo
     environment would silently step on each other's vertical selection. Fine
     for a single-operator demo; worth flagging explicitly before building.

4. **Testing the context-size math again per vertical** — a vertical with more
   or chattier tools than banking's 9 could blow the budget again; the 9-tool
   banking list itself was arrived at empirically (tested live against LM
   Studio's 8192-token window), not derived from a formula.

## Suggested next step (when picked back up)

Start with **one** additional vertical (pick whichever has the simplest,
most demo-relevant read-only actions — retail is a reasonable first choice,
matching the "Super Sports" default vertical convention) end-to-end: 3-5 new
tools in the registry, the curated allowlist, and the vertical-selection
plumbing — before generalizing to all 8. That validates the whole mechanism
(tool build → allowlist → vertical signal → gateway filter) on one vertical
rather than building 8x speculative surface area up front.

## Related, already-shipped this session (for context)

- `ping-gateway/scripts/groovy/external-door-tools-filter.groovy` — the
  banking curated-list filter this design extends.
- `ping-gateway/scripts/groovy/p1az-decision.groovy` — D-05 exemption +
  `HasValidMcpAudience`/actor-chain gates a new vertical's tools would need to
  clear too (already generically applicable, not banking-specific — no
  changes needed there for a new vertical, only for genuinely new resource
  identities).
- `p1az-import.snapshot` — the live PingOne Authorize policy export with the
  external-door fixes applied; a new vertical's tools don't need new P1AZ
  policy changes unless they introduce a new MCP resource audience.
