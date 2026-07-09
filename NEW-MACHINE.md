# Running this repo on a brand-new machine

A `git clone` gives you the **app and most of the Claude Code tooling**, but a few
things live **outside this repo** and must be set up per machine. This checklist
makes a fresh checkout boot cleanly via **Docker** or **`./run.sh`**, and explains
what `git clone` does and does **not** carry.

For the everyday run details (ports, commands, troubleshooting) see
[QUICKSTART.md](QUICKSTART.md). This file is specifically the *new-machine* gaps.

---

## 1. What `git clone` DOES carry

| Item | Path |
| --- | --- |
| Project agent skills | [.claude/skills/](.claude/skills/) |
| Slash commands | [.claude/commands/](.claude/commands/) |
| Workflows | [.claude/workflows/](.claude/workflows/) |
| Shared Claude settings | [.claude/settings.json](.claude/settings.json) (must stay secret-free; personal allowlists go in gitignored `settings.local.json`) |
| MCP server registry | `.air/mcp.json` (Claude Code, per-machine, gitignored — copy from [.air/mcp.json.example](.air/mcp.json.example)); `.cursor/mcp.json` (Cursor, per-machine, gitignored — copy from [.cursor/mcp.json.example](.cursor/mcp.json.example)) |
| Launchers | `run.sh`, `run-docker.sh`, `docker-compose.yml` |
| Env templates | `.env.example`, `.env.docker.example` |

## 2. What `git clone` does NOT carry (set up separately)

These are intentionally gitignored (secrets) or live in your **global** `~/.claude`
(not this repo):

### a. Global Claude Code skills & plugins — `~/.claude/`
The repo only ships **project** skills. Global skills/plugins are per-machine:
**superpowers, mgrep, graphify, GSD, find-skills, code-review**, the `tdd-guard`
plugin binary, etc. Install your global `~/.claude` toolkit on the new machine
(e.g. restore from your dotfiles / plugin install) — a clone of *this* repo will
not provide them. `mgrep` in particular is referenced by the harness rules.

### b. Secrets — never committed
- `.env` — copy a template and fill in PingOne credentials:
  - **Docker:** `cp .env.docker.example demo_api_server/.env` then fill `PINGONE_*`
  - **run.sh / local:** `cp .env.example .env` then fill `PINGONE_*`
- `secrets.vault` + `VAULT_PASSWORD` — **optional.** No vault → BFF runs in
  env-only mode (boots fine). If you copy a `secrets.vault` over, you **must** set
  `VAULT_PASSWORD` (add `VAULT_PASSWORD=...` to `.env`) or the BFF refuses to start.

### c. Host setup (run.sh path only — Docker skips this)
- `echo '127.0.0.1  api.ping.demo' | sudo tee -a /etc/hosts`
- `mkcert -install` (local HTTPS CA; `run.sh` installs `mkcert` via Homebrew on macOS)
- Node 20+ (`node --version` ≥ v20)
- **`run.sh` auto-install steps are macOS-only.** On Linux, prefer the Docker path,
  or install `mkcert`/Node manually.

## 3. Pick a run path

### Docker (most portable — recommended for a new machine)
```bash
cp .env.docker.example demo_api_server/.env   # then fill in PINGONE_* creds
docker compose up --build
# UI → http://localhost:4000
```
Containers talk over plain HTTP by service name, so you do **not** need
`/etc/hosts` or `mkcert`. Register the localhost redirect URIs in PingOne (see the
header of `.env.docker.example`).

### `./run.sh` (macOS local dev)
```bash
# one-time: /etc/hosts + mkcert -install (see §2c)
./run.sh
# UI → https://api.ping.demo:4000
```
First run installs deps + builds automatically; no manual `npm install` needed.

## 4. Claude Code / Cursor tooling notes (optional — not needed to run the demo)

The demo itself does not depend on these; they are dev conveniences in
[.air/mcp.json](.air/mcp.json) (Claude Code) and [.cursor/mcp.json](.cursor/mcp.json) (Cursor):

- **Cursor MCP** — copy [.cursor/mcp.json.example](.cursor/mcp.json.example) to `.cursor/mcp.json`, then run `npm run patch:cursor-mcp` to fill PingOne OAuth client ids from `demo_api_server/.env`. Uses **stdio** for `github` (Docker + `gh auth token`), `codegraph`, and `banking-dev` — disable Cursor's built-in plugin MCP servers (github/playwright/context7) in **Customize → MCP** if they show `net::ERR_FAILED`; use the project `github` entry instead. Remote OAuth servers (`pingone`, `banking-gateway`) need **Connect** in that same panel.

- **`banking-dev`** MCP server needs a one-time build (its `dist/` is gitignored).
  `install.sh` now builds it; otherwise run `cd dev_mcp/banking-dev && npm install &&
  npm run build`. Note: a **stale** `dist/` (e.g. from before the better-sqlite3 → LMDB
  migration) fails with `Cannot find module 'better-sqlite3'` — rebuild to fix.
- **`banking-gateway`** MCP server requires the stack running and a valid bearer token
  (`CLAUDE_BEARER_TOKEN`). Its URL **scheme is run-mode-dependent**: `https` for local
  native (`./run.sh`, mkcert), `http` for Docker/Kubernetes (plain HTTP on the forwarded
  `:3005`). `install.sh` sets the scheme to match; a mismatch shows as "Failed" in `/mcp`.
- **`pingone`** MCP server (PingOne admin / management tools) is **tenant-specific**, and is
  now **provisioned automatically**. Bootstrap creates the `PingOne MCP Server` OAuth client
  (NATIVE_APP, public/PKCE, redirects `http://localhost:7464/callback` + `http://127.0.0.1:7464/callback`),
  writes its id to `PINGONE_MCP_OAUTH_CLIENT_ID` in `demo_api_server/.env`, and `install.sh`
  patches the `pingone` entry's `url` (your env id) and `oauth.clientId` from those values — no
  prompt. The repo ships placeholders (`YOUR_PINGONE_ENV_ID`, `YOUR_PINGONE_MCP_CLIENT_ID`); on a
  manual clone (no installer), run `npm run pingone:bootstrap`, then patch `.mcp.json` from the
  `PINGONE_MCP_OAUTH_CLIENT_ID` it wrote. Then in Claude Code run **`/mcp` → pingone →
  Authenticate** (browser OAuth; the signing-in user needs PingOne admin roles). Note: because
  `.mcp.json` is tracked, your filled-in values show as a local modification — that's expected
  for this per-machine entry.
- `.mcp.json` paths use `${CLAUDE_PROJECT_DIR:-.}`. In a project-scoped `.mcp.json`,
  `CLAUDE_PROJECT_DIR` is **not** set in Claude Code's own environment at parse time,
  so the `:-.` default is required — it resolves to `.` (the directory Claude Code was
  launched from, i.e. the repo root). A bare `${CLAUDE_PROJECT_DIR}` with no default
  would make Claude Code fail to parse the whole config. If you launch `claude` from
  somewhere other than the repo root, set an absolute path for the `filesystem` and
  `banking-dev` entries instead.

## 5. Settings migration note (existing main machine only)

[.claude/settings.json](.claude/settings.json) is now **tracked** and intentionally
minimal (plugin enablement only — no hooks, no permissions). Anything machine-local
— your permission allowlist, personal hooks (e.g. a `/simplify` commit gate), and
secrets — belongs in **`.claude/settings.local.json`** (gitignored), which Claude
merges on top. On a machine that previously kept those in `settings.json`, move them
into `settings.local.json` before pulling this change, so git can take over the
shared `settings.json` without clobbering your local config.
