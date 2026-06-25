# Quickstart

Get the whole demo stack running locally. After the one-time setup, it's a
single command: `./run.sh`.

> **Platform.** `run.sh` targets **macOS** (uses Homebrew + `mkcert`). On Linux,
> install `mkcert` and Node yourself; the script's auto-install steps are
> macOS-specific.

---

## 1. One-time setup (once per machine)

**a. Map the demo host to localhost** (the demo runs on `api.ping.demo` over HTTPS):

```bash
echo '127.0.0.1  api.ping.demo' | sudo tee -a /etc/hosts
```

**b. Trust a local HTTPS CA** (`run.sh` installs `mkcert` via Homebrew if missing,
but the CA install needs sudo once):

```bash
mkcert -install
```

**c. Node 20+.** `node --version` should be `v20` or newer (`package.json` requires
`node >=20`, `npm >=9`). If you use `nvm`, `run.sh` will try to `nvm use 20` for you.

You do **not** need to run `npm install` — `run.sh` installs each service's
dependencies (and builds the TypeScript services) automatically on first run.

---

## 2. Start everything

```bash
./run.sh
```

First run is slower (it installs dependencies and builds); subsequent runs are
fast. When it finishes, open the UI:

- **UI** → <https://api.ping.demo:4000>
- **BFF API** → <https://api.ping.demo:3001> (health: `/api/health`)

Other services it launches: MCP server (`localhost:8080`), MCP gateway
(`https://api.ping.demo:3005`), Authorization Server, HITL service, agent
service, and the Python LangChain agent (`8888`–`8890`).

> **Not included:** `agent_token_service` (port 8097) — the PingOne agent-token broker for Microsoft Copilot Studio — is a separate optional service and is **not** started by `./run.sh` or docker compose. It is only needed for the Copilot Studio integration. See [`docs/COPILOT_PART3_RUNBOOK.md`](docs/COPILOT_PART3_RUNBOOK.md).
>
> **Use `./run.sh`, not `./run-bank.sh`.** `run.sh` is the primary launcher.

---

## 3. Secrets / vault (only if you have one)

The platform uses an optional encrypted vault (`secrets.vault`) for real
credentials:

- **No `secrets.vault` file?** The BFF starts in **env-only** mode — it reads
  config from `.env` / `.env.example` defaults. Nothing extra to do to boot.
- **You have a `secrets.vault` file?** You **must** provide `VAULT_PASSWORD` or the
  BFF refuses to start (fail-fast, by design). Easiest: put it in your `.env` —
  `run.sh` auto-loads `VAULT_PASSWORD` from `.env` at startup.
  ```bash
  echo 'VAULT_PASSWORD=<your-vault-password>' >> .env
  ```

The vault holds secrets only; non-secret config comes from `.env` + the configStore
(LMDB-backed, `data/persistent/lmdb/`). See the [vault skill](.claude/skills/vault/SKILL.md)
and [incident-response/vault-secret-exposure.md](docs/incident-response/vault-secret-exposure.md)
for details.

---

## 4. Everyday commands

```bash
./run.sh status      # live health check of every service
./run.sh tail        # pick a log to follow (or 'all')
./run.sh restart     # stop then start
./run.sh stop        # stop all services
./run.sh test        # run the full test suite
./run.sh help        # full usage
```

Logs are written to `logs/` while services run.

---

## 5. What you get vs. full setup

`./run.sh` gives you the **stack running locally**. To exercise the full OAuth /
token-exchange / agent flows you also need **PingOne** wired up (client ids,
resource audiences, `may_act` rules). That's a separate configuration step:

The authorization engine is selected by `AUTHORIZE_MODE` (or `authorize_mode` in the configStore). The Docker default is `pingone` (strict — no simulated fallback). Set to `simulated` to run fully offline, or `pingone-with-fallback` to fall back to the mock when PingOne Authorize is unreachable.

- Configure via the in-app **`/setup`** wizard, or
- See [`docs/PINGONE_APP_CONFIG.md`](docs/PINGONE_APP_CONFIG.md) for the full
  client / resource / scope reference.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Browser TLS warning on `api.ping.demo` | `mkcert -install` wasn't run, or the CA isn't trusted in your browser — re-run it and restart the browser. |
| `secrets.vault exists but VAULT_PASSWORD not set — refusing to start` | Set `VAULT_PASSWORD` (step 3). |
| `Node 20+ required` | Install/select Node 20+ (`nvm use 20`). |
| A service shows unhealthy in `./run.sh status` | `./run.sh tail` that service's log; first-run dependency install/build may still be finishing. |
| Port already in use | `./run.sh stop` (clears process trees + listeners), then `./run.sh`. |
