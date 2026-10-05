# Path / Door / Tools pickers in the footprint skins

Follows `2026-10-05-skin-shell-session-design.md` (merged, PR #794). That spec put gateway-mode and LLM-path switching out of scope; this one brings them in.

## Goal
In the Claude Terminal, VS Code and Claude Desktop skins (`/demo/:shellSlug`) the user can pick the **Path** (MCP: Direct / Privilege / Façade; LLM: Anthropic / Google / OpenAI), the **Door** (MCP backend preset) and a **tool** to run without typing. The choice is the same server-side state the Cursor page uses, so switching in a skin shows in Cursor and vice versa.

## Facts the design rests on
- Cursor's Path select (`PrivilegeMcpClientPage.jsx` ~L2180) holds one value: an MCP mode key or `llm:<provider>`. Choosing an LLM path only sets `llmPath` — no `/config` write, no re-auth. Choosing an MCP mode runs `switchGatewayMode`.
- Door options are `presets` (from `/state`) filtered by current mode; in `direct` mode only the door names `banking, opensearch, brave, pingone-admin` (`sameGatewayDoors`, ~L1365). Switching a door posts `/config` with the preset's `mcpUrl` + `clientId` (`switchDoor`, ~L1277).
- `switchGatewayMode` (~L975) mixes shared work (optimistic update of `gatewayMode`/`config`, keep the same door name across modes, POST `/config`, roll back on failure) with page-only work (sign-in modal, "switching" overlay, session flags, silent `prompt=none` re-auth, `selectedTool`, blocked-door modal). Only the shared work is extracted.
- LLM chat: `POST /api/privilege-mcp/llm/call {provider, prompt}`; a denial arrives with `code === "llm_policy_denied"` and a `reason`. Gateway URL from `GET /llm/config`.
- Skins talk through `apiClient` (axios); Cursor through its own fetch `api()` (errors carry `status`, `code`, `reason`).

## Design
1. **`components/privilege/privilegeRouting.js`** (new, pure): `doorName`, `GATEWAY_MODES`, `LLM_PATHS`, `doorsForMode(presets, mode)` — moved verbatim from the Cursor page (which imports them back). One definition for both consumers.
2. **`components/privilege/usePrivilegeRouting.js`** (new hook, `usePrivilegeRouting({ request })`): `request(path, {method, body}) -> Promise<data>` is injected so Cursor passes its `api` and skins pass an `apiClient` adapter. Owns `gatewayMode`, `config`, `gatewayConfigs`, `presets`, `llmPath`, `llmGatewayUrl`, `loaded`. Exposes:
   - `hydrate(state)` — sets the above from a `/state` response (Cursor calls it from its existing `/state` effect so it still fetches once; skins use `load()`).
   - `selectPath(key)` — `llm:` keys set `llmPath` only; MCP keys clear `llmPath`, apply the optimistic update (same-door-name preservation), POST `/config`, roll back on failure; returns `{ ok: true, saved }` or `{ ok: false, message }`.
   - `selectDoor(url)` — POST `/config` with the preset's `mcpUrl`/`clientId`; same return shape.
3. **Cursor adopts it, behaviour unchanged.** `switchGatewayMode` / `switchDoor` keep their page-only steps and call `selectPath` / `selectDoor` for the shared part; the local copies of `doorName`/`GATEWAY_MODES`/`LLM_PATHS` and the five state variables are removed. Own commit; the Cursor tests run on it and must pass unmodified.
4. **Skins**: `usePrivilegeShellSession` composes `usePrivilegeRouting`, exposes `routing`, and `send` posts `/llm/call` when `llmPath` is set (denial -> assistant line `Privilege denied this call. <reason>`), else `/chat`. After a path/door change that leaves the destination unauthenticated, the skin shows its existing "Sign in with Privilege" gate — no automatic redirect (Cursor's rule for a plain switch). `usePrivilegeShellSession` also clears `tools` on a switch.
5. **Shared UI in `ShellParts.jsx`**: `ShellRoutingBar` (two native `<select>`s, `aria-label="Connection path"` and `"MCP backend (door)"`, disabled while switching) and `ShellToolsList` (wraps `ToolsTable`, hidden on an LLM path with a one-line note "Tools apply to MCP paths"). Each view renders them in its idiom: VS Code puts the bar above the chat and opens Tools by default; Terminal puts the bar as a header line and Tools under the log; Desktop puts the bar in the thread header and Tools beside the composer. Terminal and Desktop also show `latestCall` (tool request/result), which they lack today.
6. **Out of scope:** silent `prompt=none` re-auth, the re-arm control, door probing, console/policy pickers, the force light/dark toggle (still in TECH_DEBT).

## Success criteria
- All three skins show Path, Door and the tool list without typing; selecting a door/path posts `/config` and a switch in a skin is reflected in `/state` (and so in Cursor).
- Hook tests: optimistic update + rollback on failed `/config`; same-door preservation across modes; LLM path sets no `/config` write; `llm_policy_denied` renders as a denial line; direct mode lists only the four direct door names.
- Cursor page: existing tests green and unmodified; `regression-guard` checklist passes; emoji allowlist and theming rules hold for touched stylesheets.
- `cd demo_api_ui && npm run test:unit && npm run build` green; after merge + `deploy-live --services=ui`, a live drive (Super Sports, `stack:generation` pinned) switches a door in a skin and sees it in Cursor.
