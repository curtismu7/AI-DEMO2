# Dev on One Mac, Test on Another (Same LAN)

Develop on your daily Mac; push or sync to a larger test Mac (64GB) on the same network. The test Mac always runs the **full Docker stack** — every compose service, RAG, alternate agents, tracing, and demo-auth.

## Your environment

| | |
| --- | --- |
| Dev Mac | `Curtiss-MacBook-Air.local` |
| Test Mac (64GB) | `mac-Y4JYJ03X.local` |
| Dev repo | `~/Development/AI-DEMO2` |
| Test repo | `~/AI-demo-test` |
| GitHub | `https://github.com/curtismu7/AI-demo` |
| SSH alias | `testmac` → test Mac |
| User | `curtismuir` |

All commands below assume you run deploy/test scripts from `~/Development/AI-DEMO2`.

## Prerequisites

### Test Mac (one time)

1. Run the installer (Docker mode recommended):

   ```bash
   curl -fsSL https://raw.githubusercontent.com/curtismu7/AI-demo/main/install.sh | bash
   ```

2. Clone the repo on **mac-Y4JYJ03X**:

   ```bash
   git clone https://github.com/curtismu7/AI-demo.git ~/AI-demo-test
   cd ~/AI-demo-test
   git checkout feat/dev-remote-test-workflow
   ```

3. Enable **Remote Login** (System Settings → General → Sharing).

4. Copy secrets from **Curtiss-MacBook-Air** (not via git):

   ```bash
   cd ~/Development/AI-DEMO2
   scp demo_api_server/.env testmac:~/AI-demo-test/demo_api_server/.env
   scp -r certs/ testmac:~/AI-demo-test/
   ```

### Dev Mac (one time)

1. Add both Macs to `/etc/hosts`:

   ```bash
   echo '127.0.0.1  api.ping.demo' | sudo tee -a /etc/hosts
   ```

2. Configure SSH on **Curtiss-MacBook-Air** (`~/.ssh/config`):

   ```
   Host testmac
     HostName mac-Y4JYJ03X.local
     User curtismuir
     IdentityFile ~/.ssh/id_ed25519
   ```

3. Copy your SSH key:

   ```bash
   ssh-copy-id testmac
   ```

4. Verify the full stack starts:

   ```bash
   ssh testmac 'cd ~/AI-demo-test && ./run-docker.sh start full && ./run-docker.sh status'
   ```

## Daily workflow

Run everything from **Curtiss-MacBook-Air**:

```bash
cd ~/Development/AI-DEMO2
```

### Committed work (recommended)

```bash
cd ~/Development/AI-DEMO2

./run-tests.sh unit
./scripts/push-to-test.sh
./scripts/run-remote-tests.sh all
./scripts/open-test-ui.sh
```

### Uncommitted WIP (LAN rsync)

```bash
cd ~/Development/AI-DEMO2

./scripts/sync-wip-to-test.sh
./scripts/open-test-ui.sh
```

### Sync latest Docker files to mac-Y4JYJ03X

After docker-compose or Dockerfile changes on dev, push and rebuild on the test Mac:

```bash
cd ~/Development/AI-DEMO2
./scripts/push-to-test.sh
```

Or manually on the test Mac:

```bash
ssh testmac 'cd ~/AI-demo-test && git fetch origin && git pull --ff-only && ./run-docker.sh build && ./run-docker.sh start full && ./run-docker.sh demo-sync && ./run-docker.sh status'
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
| `REMOTE_DIR` | `~/AI-demo-test` | Repo path on test Mac |
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
- Check status: `ssh testmac 'cd ~/AI-demo-test && ./run-docker.sh status'`

**Stop SSH tunnel**

```bash
./scripts/open-test-ui.sh --stop
```

**Refresh PingOne env on test Mac**

```bash
ssh testmac 'cd ~/AI-demo-test/demo_api_server && npm run pingone:refresh-envs'
```

## What not to sync

Never commit or rsync these — keep a one-time copy on the test Mac:

- `demo_api_server/.env`
- `secrets.vault`
- `demo_api_server/data/` (LMDB runtime state)
- `node_modules/`
