# AGENTS.md

Canonical instructions for AI coding agents live in **[CLAUDE.md](./CLAUDE.md)**.

1. Read the **Agent behavior** section in `CLAUDE.md` first (don't assume, minimum
   change, surgical diffs, verify until done).
2. Before protected areas (auth, token exchange, BFF session, UI), read
   [REGRESSION_PLAN.md](./REGRESSION_PLAN.md) §0–§1 and invoke `regression-guard`.
3. Opt-in AI-DLC only when the user says `Using AI-DLC,` — see `.aidlc/README.md`.
   Repo do-not-break rules still win.

## Cursor Cloud specific instructions

The Cursor Cloud VM has **no Docker, no `mkcert`, and no PingOne credentials** by
default. `./run.sh` / `./run-docker.sh` assume all three, so the full end-to-end
demo (PingGateway `:3036`, Jaeger, and PingOne OAuth login) does **not** run here.
Node 20+/22 and Python 3.12 are present; the update script `npm install`s the core
Node services. Standard commands live in `README.md`/`CLAUDE.md`/`package.json`.

Scope that works in the cloud VM = the **core banking services in plain-HTTP
localhost dev mode** (BFF + UI + MCP server), plus all unit tests, lint, and builds.

Non-obvious caveats (discovered during setup):

- **Vault fail-fast:** a tracked `secrets.vault` at the repo root makes the BFF,
  MCP server, agent-service, and gateway **refuse to start** unless `VAULT_PASSWORD`
  is set. We don't have that password. Bypass by pointing `VAULT_PATH` at a
  nonexistent file (e.g. `VAULT_PATH=/tmp/no-vault.vault`) so `vaultLoader` falls
  back to `.env`/`configStore`.
- **BFF (`demo_api_server`, :3001):** `server.js` serves plain HTTP when no TLS cert
  exists (none here), so no `mkcert` needed. Needs a local `demo_api_server/.env`
  with `PUBLIC_APP_URL=http://localhost:3001`, `SESSION_SECRET`, `VAULT_PATH=/tmp/no-vault.vault`,
  and `TOPOLOGY_GUARD=warn` (the LMDB `configStore` carries stale deployment URLs
  from prior runs that otherwise trip a fatal startup topology guard). Start: `npm start`.
- **UI (`demo_api_ui`, :4000):** `PORT=4000 HTTPS=false REACT_APP_API_URL=http://localhost:3001 REACT_APP_API_PORT=3001 REACT_APP_API_HTTPS=false REACT_APP_CLIENT_URL=http://localhost:4000 DANGEROUSLY_DISABLE_HOST_CHECK=true npm start`.
- **MCP server (`demo_mcp_server`, :8080):** config validation requires PingOne
  vars that **must be `https://` URLs** plus a 64-char `ENCRYPTION_KEY`. Use
  placeholder `https://localhost:9001/...` values in `demo_mcp_server/.env` and start
  with `npm run start:dev` (dev mode; `npm start` runs production which is stricter),
  again with the `VAULT_PATH` bypass. Introspection fails without real PingOne, but
  the server boots and `/health` is 200.
- **Auth without PingOne:** OAuth login (the UI "Sign In" button) is unavailable.
  The BFF's local seed-user password login (`POST /api/auth/login`) and
  `POST /api/auth/register` still work and grant a real server-side session. Seed
  users: `john.doe`/`password123`, `admin`/`admin123` (override via
  `SEED_CUSTOMER_PASSWORD`/`SEED_ADMIN_PASSWORD`). **Banking data-plane routes
  (`/api/accounts`, `/api/transactions`) require a real OAuth Bearer token**
  (`authenticateToken`), so they are not reachable without PingOne; a local session
  alone is not enough.
- **langchain_agent (Python, default agent):** venv setup needs the system
  `python3-venv` package (already installed in the snapshot). Recreate/refresh with
  `python3 -m venv langchain_agent/.venv` then
  `langchain_agent/.venv/bin/pip install -r langchain_agent/requirements.txt`.
  It is kept out of the auto update script to keep startup low-risk.
- **Tests/lint baseline:** `npm run test:api-server` and `npm run test:mcp-server`
  run, with a few **pre-existing** failures unrelated to the environment
  (BFF: `transaction-flows`, `authorize-gate`; MCP: `TratClaimsExtractor` and a
  couple others). `cd demo_api_server && npm run lint` (biome) runs but the repo has
  many pre-existing lint findings. Treat these as baseline, not regressions.
- TypeScript services (`demo_mcp_server`, `demo_agent_service`, `demo_mcp_gateway`)
  need `npm run build` before `node dist/...`; `run.sh` builds them automatically,
  but when starting a service manually run its `build` first.
- The `.env` files above are gitignored (a pre-commit hook blocks committing `.env`),
  so they are not in git — recreate them from the values above if missing.
