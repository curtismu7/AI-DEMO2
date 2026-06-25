<!-- generated-by: gsd-doc-writer -->

# Getting Started with AI-Demo

Get the multi-vertical AI-agent-security demo running locally in 5 minutes. (The default vertical is "Super Banking"; this is a security demo, not a real bank.)

## Prerequisites

- **Node.js 20 or newer** (20, 22, or 24 LTS all work)
- **Git** (to clone the repository)
- **mkcert** (for local HTTPS certificates) — `brew install mkcert` on macOS
- **sudo access** (to add a line to `/etc/hosts`)

### Verify Node.js

```bash
node --version    # Should show v20.x, v22.x, or v24.x
npm --version     # Should show 9 or newer
```

If you don't have Node 20+ installed, follow the [Node.js setup](#node-version-setup) section below before proceeding.

## Node Version Setup

If `node --version` shows older than v20, install Node via nvm:

```bash
# Install nvm (one-time, if not already installed)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash

# Add nvm to your shell (append to ~/.zshrc or ~/.bashrc)
cat >> ~/.zshrc <<'EOF'
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
EOF

# Reload your shell and install Node
source ~/.zshrc
nvm install 20 && nvm use 20
```

Then verify: `node --version` should show `v20.x` or newer.

## One-Time Machine Setup

Run these commands **once per machine** (not per repository):

```bash
# 1. Install mkcert and trust the local CA
brew install mkcert
mkcert -install

# 2. Add api.ping.demo to /etc/hosts
echo '127.0.0.1  api.ping.demo' | sudo tee -a /etc/hosts
```

## Quick Start (5 Minutes)

### 1. Clone and enter the repo

```bash
git clone <repo-url>   <!-- TODO: confirm clone URL -->
cd AI-Demo
```

### 2. Start all services

```bash
./run.sh
```

This will:
- Generate TLS certificates automatically (if mkcert is installed)
- Install Node dependencies for all services
- Compile TypeScript services
- Launch the API server, UI, MCP server, and agent services
- Print the URLs where the app is running

**Wait for the output to stabilize** — you'll see log entries from each service. Proceed to verification when you see "All services healthy" or similar.

### 3. Open the app in your browser

```
https://api.ping.demo:4000
```

Accept the self-signed certificate warning (it's mkcert-issued and safe locally).

## First-Run Verification

### Verify services are running

In a new terminal, while `run.sh` is still running:

```bash
cd /path/to/AI-Demo
./run.sh status
```

The full stack is ~13 services. You want to see them marked as **healthy** or **running**:
- `demo_api_server` (3001) — BFF/API
- `demo_api_ui` (4000) — React frontend
- `demo_mcp_server` (8080) — MCP tool server
- `demo_mcp_gateway` (3005) — Security gateway
- `demo_agent_service` (host 3016) — Reasoning service
- `demo_hitl_service` (3009) — Consent service
- `demo_mcp_invest` (8081) — Investment tools
- `demo_mortgage_service` (8082) — Mortgage backend
- `demo_authz_server` (9001) — Authorize mock
- `langchain_agent` (8888/8889/8890) — Python LangChain/LangGraph agent
- `openai_agent` (8891) — OpenAI agent
- `mastra_agent` (8892) — Mastra agent
- `pydantic_agent` (8893) — Pydantic agent

### Sign in and explore

1. **Open** https://api.ping.demo:4000 in your browser
2. **Click "Sign In"** → You'll be prompted for PingOne credentials
3. **No credentials yet?** See the **[Configuration](#configuration-pingone-credentials)** section below

Once signed in, you should see:
- **Admin dashboard** (if signed in as admin) — with app configuration, user management, and test pages
- **Customer dashboard** (if signed in as a customer) — with accounts, transactions, and the AI agent sidebar

## Configuration: PingOne Credentials

The demo requires PingOne OAuth credentials. You have two options:

### Option A: Interactive Setup (Recommended)

Run this once after cloning:

```bash
npm run setup:fresh
```

This will:
1. Pop a browser form asking for your PingOne worker credentials (Environment ID, Region, Client ID, Client Secret)
2. Provision all PingOne resources automatically (apps, scopes, resource servers)
3. Create two demo users (`bankuser` / `bankadmin`)
4. Write credentials to `demo_api_server/.env`

> **Don't have PingOne credentials yet?** Create a free [PingOne tenant](https://www.pingidentity.com/en/platform/pingone/start-free.html), then create a worker app with the "Identity Data Admin" role.

### Option B: Manual Configuration

If you prefer to configure manually via the UI:

1. Run `./run.sh` (all services start, but auth is not configured yet)
2. Open https://api.ping.demo:4000/configure
3. Fill in your PingOne Environment ID and OAuth client credentials
4. Click **Save** — the config is persisted and survives restarts

For full environment variable details, see [ENV_VARS.md](ENV_VARS.md).

## Common First-Run Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| `zsh: command not found: nvm` | nvm isn't loaded in this shell | Run: `export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"` Then add those lines to `~/.zshrc` |
| `zsh: no such file or directory: ./run.sh` | You're not in the repo root | `cd /path/to/AI-Demo` first |
| `api.ping.demo` doesn't resolve | `/etc/hosts` entry missing | `echo '127.0.0.1 api.ping.demo' \| sudo tee -a /etc/hosts` |
| Browser shows certificate error | Certs not generated or CA not trusted | Run `mkcert -install` and `mkdir -p certs && cd certs && mkcert api.ping.demo localhost 127.0.0.1` |
| Services won't start (MODULE_NOT_FOUND) | Node version mismatch or missing build step | Verify `node --version` is v20+; try `./run.sh stop && ./run.sh` |
| `/configure` shows blank fields after import | `.env` encryption key mismatch | Re-run `npm run setup:fresh` with the same archive |
| `lmdb` binary error | Node version mismatch (binaries built for different Node major) | `nvm use 20 && cd demo_api_server && npm rebuild lmdb` |

## Stopping Services

```bash
./run.sh stop
```

Gracefully stops all services and cleans up process IDs.

## Next Steps

Now that you have AI-Demo running, explore:

1. **[README.md](../../README.md)** — Full feature matrix, component overview, and deployment instructions
2. **[ARCHITECTURE.md](../ARCHITECTURE.md)** — System design, token exchange flow, and major components
3. **[ENV_VARS.md](ENV_VARS.md)** — All environment variables and PingOne setup details
4. **[CLAUDE.md](../../CLAUDE.md)** — Development conventions, non-negotiables, and regression guard (if you plan to contribute)

### Learning Paths

- **OAuth & Token Exchange** — See `ARCHITECTURE.md` § Token Exchange Flow; then read docs/SETUP.md § PingOne Configuration
- **MCP Tools & Agent Integration** — Start with the agent sidebar in the customer dashboard; check `demo_mcp_server/src/tools/` for tool definitions
- **Testing** — Run `npm test` from the repo root to execute the full test suite across all services
- **Deployment** — See [deployment.md](deployment.md) for Docker Compose and Kubernetes deployment

## Support

For detailed setup troubleshooting, see:
- **[README.md § Troubleshooting](../../README.md#troubleshooting-new-machine-setup)** — Machine setup issues
- **[docs/SETUP.md](SETUP.md)** — Full PingOne configuration reference
- **[demo_api_server/.env.example](../../demo_api_server/.env.example)** — Complete environment variable documentation

