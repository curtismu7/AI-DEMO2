# Functional footprint skins — shared shell session

## Goal
Claude Terminal, Visual Studio Code and Claude Desktop skins (`/demo/:shellSlug`) accept a typed prompt, run the real Privilege agent, and render the reply and tool steps in that product's idiom. The conversation survives a skin switch. Cursor (`/privilege-mcp-client`) is the reference and is not modified.

## Facts the design rests on
- All footprint skins share one route, `/demo/:shellSlug` (`App.js`), so `FootprintLiveShellPage` stays mounted when the skin changes; only `category`/`variant` change.
- Today's skins are chrome (`ChromeFrames.jsx`) around one `PrivilegeShellPanel` (sign in, list tools, run a tool). No chat, no agent.
- Cursor's chat is a single `POST /api/privilege-mcp/chat` returning `{reply, steps, decision, execution, policy, tools, authUrl}` (`PrivilegeMcpClientPage.jsx` `sendChat`). Not streaming; "terminal lines" are rendered from the finished `steps`.

## Design
1. **`usePrivilegeShellSession`** (new, `components/aiFootprintMocks/`). Owns what `PrivilegeShellPanel` owns now (`phase`, `tools`, `scopes`, `latestCall`, `notice`, connect/retry/signOut/runTool) plus `messages`, `thinking`, `send(prompt)`. `send` posts `/chat` and normalizes into `{role, content, steps, decision, execution}`. Handles `authUrl` (open sign-in) and 401 (return to signed-out phase).
2. **Mounted in `FootprintLiveShellPage`**, passed to the panel as a prop, so state survives switches. Assumes the saved gateway config is already valid (the panel never posts `/config` today).
3. **Three presentation adapters** replace the single panel body, selected by `category`:
   - Terminal (`coding`): prompt line; steps and tool output as lines.
   - VS Code (`vscode`): chat side-panel plus tool-output terminal drawer.
   - Claude Desktop: message thread with tool-call cards.
   - `ToolsTable` stays for run-a-tool. `chatgpt` and `saas` skins keep the current panel body.
4. **Out of scope:** modifying the Cursor page, gateway-mode/LLM-path switching, settings, a cross-skin event bus, a simulated file explorer or `code_search`/`get_code` editor view (no data source). Cursor/shell duplication goes in `TECH_DEBT.md`.

## Success criteria
- Prompt typed in each of the three skins hits `/chat` and renders reply and steps (vitest, mocked `apiClient`).
- Switching skin mid-session keeps transcript; a pending reply still lands (vitest + live drive on `local.ping-devops.com:4000`, pinned with `stack:generation`).
- `cd demo_api_ui && npm run test:unit && npm run build` green.
- Touched stylesheets meet THEMING.md (`--th-*`, no inline colour/font-size, 10px floor); emoji allowlist respected; `skinPicker` tests still pass.
