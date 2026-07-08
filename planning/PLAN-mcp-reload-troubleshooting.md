# Plan: MCP Server Reload and Troubleshooting

This plan covers reloading MCP servers in Cursor and restoring the servers configured for the AI-DEMO2 workspace.

## Goal

All MCP servers needed for local development are connected, authenticated, and exposing tools to the agent session.

## Current State (2026-07-08)

### Session catalog (agent-visible)

| Server | Status | Notes |
|--------|--------|-------|
| cursor-app-control | ready | Built-in Cursor control |
| cursor-ide-browser | ready | Built-in browser automation |
| user-codegraph | ready | Project code intelligence |
| plugin-context7-context7 | error | Tool discovery failed |
| plugin-github-github | error | Tool discovery failed |
| plugin-playwright-playwright | error | Tool discovery failed |

### Workspace config (`.cursor/mcp.json`)

| Server | Type | Endpoint / command |
|--------|------|--------------------|
| pingone | URL + OAuth | `https://api.pingone.com/v1/environments/.../mcp` |
| codegraph | stdio | `codegraph serve --mcp --path ${workspaceFolder}` |
| github | stdio (Docker) | `ghcr.io/github/github-mcp-server` via `gh auth token` |
| banking-dev | stdio | `dev_mcp/banking-dev/dist/index.js` |
| banking-gateway | URL | `https://api.ping.demo:3005/mcp` |
| banking-mcp | URL | `http://localhost:8080/mcp` |

Not all workspace-configured servers appear in the agent session catalog until Cursor reloads MCP connections or the stack is running.

## Constraints

- There is **no programmatic reload API** for agents (`cursor-app-control` has no reload tool).
- Cursor CLI supports `agent mcp list|enable|disable|login` only — no `reload` subcommand.
- No documented `cursor://` or `vscode://` URI triggers a global MCP reload.

## Phase 1 — Reload MCP connections

### Step 1.1 — Primary reload (IDE)

1. Open Command Palette: **Cmd+Shift+P**
2. Run **MCP: Reload Servers**
3. Wait for MCP status indicators to settle

### Step 1.2 — Fallback reload options

If **MCP: Reload Servers** is unavailable:

| Option | Action |
|--------|--------|
| Per-server restart | **MCP: List Servers** → select server → **Restart** |
| Full window reload | **Developer: Reload Window** |
| Settings toggle | **Cmd+Shift+J** → **Tools & MCP** → toggle server off/on |
| Config touch | Save `.cursor/mcp.json` (some builds re-read on save) |

### Step 1.3 — Verify reload

After reload, confirm in a new agent message or via **MCP: List Servers**:

- [ ] `user-codegraph` still **ready**
- [ ] Workspace servers from `.cursor/mcp.json` appear when applicable
- [ ] Plugin servers no longer show **error** (or errors are understood)

## Phase 2 — Fix errored plugin servers

Three marketplace plugin MCPs failed during live tool discovery.

### Step 2.1 — Context7 (`plugin-context7-context7`)

1. Open **Settings → Tools & MCP**
2. Locate **Context7** plugin server
3. If status is error, click **Reconnect** or toggle off/on
4. If auth is required, complete OAuth via **MCP: Authenticate** or plugin prompt
5. Re-run reload from Phase 1

### Step 2.2 — GitHub (`plugin-github-github`)

1. Confirm `gh auth status` succeeds locally
2. Confirm Docker is running (workspace `github` server uses Docker; plugin may differ)
3. In **Tools & MCP**, reconnect GitHub plugin
4. Complete GitHub OAuth / PAT if prompted
5. Re-run reload

### Step 2.3 — Playwright (`plugin-playwright-playwright`)

1. Confirm Playwright MCP plugin is enabled in Cursor marketplace
2. Reconnect in **Tools & MCP**
3. If browser binaries are missing, install per plugin docs
4. Re-run reload

### Step 2.4 — Decide plugin vs project GitHub server

The repo defines a **project-level** `github` MCP via Docker + `gh auth token`. The **plugin** GitHub MCP is separate. Pick one primary GitHub MCP for agents to avoid duplicate/conflicting tool names:

- **Prefer plugin** when using Cursor dashboard automations (dashboard-eligible)
- **Prefer project `mcp.json`** when Docker + `gh` token is already wired for this repo

Document the choice in team notes if both remain enabled.

## Phase 3 — Restore workspace MCP servers

These depend on local services and build artifacts.

### Step 3.1 — codegraph

- [ ] `codegraph` CLI on PATH
- [ ] Server shows **ready** after reload

### Step 3.2 — github (project config)

- [ ] Docker daemon running
- [ ] `gh auth token` returns a valid token
- [ ] Test: `docker run -i --rm -e GITHUB_PERSONAL_ACCESS_TOKEN="$(gh auth token)" ghcr.io/github/github-mcp-server` starts without error

### Step 3.3 — banking-dev

- [ ] Build exists: `dev_mcp/banking-dev/dist/index.js`
- [ ] If missing: `npm run build` (or package-specific build) in `dev_mcp/banking-dev`

### Step 3.4 — banking-gateway

- [ ] Demo stack running (`./run.sh` or `./run-docker.sh`)
- [ ] `https://api.ping.demo:3005/mcp` reachable (hosts + mkcert)

### Step 3.5 — banking-mcp

- [ ] MCP server on `localhost:8080`
- [ ] Start stack if not running

### Step 3.6 — pingone

- [ ] OAuth client configured (`CLIENT_ID` in `.cursor/mcp.json`)
- [ ] Complete PingOne MCP auth when prompted
- [ ] Environment ID matches active PingOne env

## Phase 4 — Validate end-to-end

Run these checks after Phases 1–3:

1. **Agent tool catalog** — start a fresh agent turn; confirm expected servers are **ready**
2. **codegraph** — run `codegraph_status` or ask agent to explore a known symbol
3. **banking-mcp** — confirm tools appear when stack is up
4. **pingone** — list environments or a read-only PingOne tool
5. **github** — list repos or run a harmless read (e.g. `gh repo view`)

## Troubleshooting matrix

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Server stuck on **error** after reload | Plugin crash, auth, or missing binary | Reconnect in Tools & MCP; check extension logs |
| Workspace server missing from catalog | Config not re-read | Reload window; verify `.cursor/mcp.json` syntax |
| URL server unreachable | Stack down or TLS/hosts | Start `./run.sh`; verify `/etc/hosts` + mkcert |
| stdio server exits immediately | Missing build or bad command | Build artifact; run command manually in terminal |
| Docker github fails | Docker off or expired `gh` token | Start Docker; `gh auth login` |
| Duplicate GitHub tools | Plugin + project both enabled | Disable one (Phase 2.4) |

## Success criteria

- [ ] **MCP: Reload Servers** (or equivalent) completes without IDE errors
- [ ] All required servers for current work show **ready**
- [ ] Agent can invoke at least one tool from each required server
- [ ] No unexplained **error** states on plugin MCPs used day-to-day

## Out of scope

- Changing MCP server definitions (separate change to `.cursor/mcp.json`)
- PingOne provisioning or bootstrap scripts
- Automations editor MCP prefill (dashboard-only servers)

## References

- Workspace MCP config: `.cursor/mcp.json`
- Example config: `.cursor/mcp.json.example`
- Repo launcher: `./run.sh`, `./run-docker.sh`
- Cursor docs: [cursor.com/docs/mcp](https://cursor.com/docs/mcp)
