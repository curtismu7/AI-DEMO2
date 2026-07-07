# Dev on One Mac, Test on Another (Same LAN)

Develop on your daily Mac; push or sync to a larger test Mac (64GB) on the same network. The test Mac always runs the **full Docker stack** — every compose service, RAG, alternate agents, tracing, and demo-auth.

## Prerequisites

### Test Mac (one time)

1. Run the installer (Docker mode recommended):

   ```bash
   curl -fsSL https://raw.githubusercontent.com/curtismu7/AI-demo/main/install.sh | bash
   ```

2. Clone the repo (or move an existing install):

   ```bash
   mkdir -p ~/Development
   git clone https://github.com/curtismu7/AI-DEMO2.git ~/Development/AI-demo-test
   ```

   Already cloned at `~/AI-demo-test`?

   ```bash
   mkdir -p ~/Development
   mv ~/AI-demo-test ~/Development/AI-demo-test
   ```

3. Enable **Remote Login** (System Settings → General → Sharing).

4. Copy secrets from your dev Mac (not via git):

   ```bash
   # Run on dev Mac
   scp demo_api_server/.env testmac:~/Development/AI-demo-test/demo_api_server/.env
   scp -r certs/ testmac:~/Development/AI-demo-test/
   ```

### Dev Mac (one time)

1. Add both Macs to `/etc/hosts`:

   ```bash
   echo '127.0.0.1  api.ping.demo' | sudo tee -a /etc/hosts
   ```

2. Configure SSH (`~/.ssh/config`):

   ```
   Host testmac
     HostName Studio-Mac.local
     User your-username
     IdentityFile ~/.ssh/id_ed25519
   ```

3. Copy your SSH key:

   ```bash
   ssh-copy-id testmac
   ```

4. Verify the full stack starts:

   ```bash
   ssh testmac 'cd ~/Development/AI-demo-test && ./run-docker.sh start full && ./run-docker.sh status'
   ```

## Daily workflow

### Committed work (recommended)

```bash
# Fast gate on dev Mac
./run-tests.sh unit

# Push branch and deploy full Docker stack on test Mac
./scripts/push-to-test.sh

# Run heavy tests remotely
./scripts/run-remote-tests.sh all

# Browse the remote stack from dev Mac
./scripts/open-test-ui.sh
```

### Uncommitted WIP (LAN rsync)

```bash
./scripts/sync-wip-to-test.sh
./scripts/open-test-ui.sh
```

Prefer git push for anything you want to keep — rsync is for quick experiments only.

## Scripts

| Script | Purpose |
| --- | --- |
| `scripts/push-to-test.sh [branch] [host]` | `git push` + remote pull, build, `start full` |
| `scripts/sync-wip-to-test.sh [host] [--no-restart]` | Rsync WIP (no secrets) + restart hot-reload services |
| `scripts/run-remote-tests.sh [unit\|api\|e2e\|all] [host]` | Run `./run-tests.sh` on test Mac |
| `scripts/open-test-ui.sh [host]` | SSH tunnel + open `https://api.ping.demo:4000` |

### What starts on the test Mac

`push-to-test.sh` always runs `./run-docker.sh start full`, which includes:

- Core banking stack (BFF, UI, MCP servers, PingGateway, agents, HITL, LLM proxy)
- RAG / Code Search (Weaviate, embeddings, llamaindex-agent)
- Alternate agent frameworks (OpenAI, Mastra, Pydantic)
- Jaeger tracing
- Demo authz + demo MCP gateway (via `demo-sync` after start)

No lean/smoke profile — the 64GB test machine is expected to run everything.

### Environment overrides

| Variable | Default | Meaning |
| --- | --- | --- |
| `REMOTE_DIR` | `~/Development/AI-demo-test` | Repo path on test Mac |
| `SKIP_PUSH=1` | — | Skip `git push` (branch already on remote) |
| `SKIP_BUILD=1` | — | Skip `docker` image rebuild on test Mac |

## Troubleshooting

**SSH fails**

- Confirm Remote Login is on and `ssh testmac` works without a password.
- Try the LAN IP instead of `.local` in `~/.ssh/config`.

**Browser cert warning**

- Copy `certs/` from the test Mac (or regenerate with mkcert there).
- Use `./scripts/open-test-ui.sh` — it tunnels to localhost so the cert matches.

**Tests fail with stack not running**

- Deploy first: `./scripts/push-to-test.sh`
- Check status: `ssh testmac 'cd ~/Development/AI-demo-test && ./run-docker.sh status'`

**Stop SSH tunnel**

```bash
./scripts/open-test-ui.sh --stop
```

**Refresh PingOne env on test Mac**

```bash
ssh testmac 'cd ~/Development/AI-demo-test/demo_api_server && npm run pingone:refresh-envs'
```

## What not to sync

Never commit or rsync these — keep a one-time copy on the test Mac:

- `demo_api_server/.env`
- `secrets.vault`
- `demo_api_server/data/` (LMDB runtime state)
- `node_modules/`
