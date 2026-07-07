# Dev on One Mac, Test on Another (Same LAN)

Develop on your daily Mac; push or sync to a larger test Mac (64GB) on the same network for full-stack runs, E2E, and memory-heavy profiles.

## Prerequisites

### Test Mac (one time)

1. Run the installer (Docker mode recommended):

   ```bash
   curl -fsSL https://raw.githubusercontent.com/curtismu7/AI-demo/main/install.sh | bash
   ```

2. Clone the repo:

   ```bash
   git clone <your-remote-url> ~/AI-demo-test
   ```

3. Enable **Remote Login** (System Settings → General → Sharing).

4. Copy secrets from your dev Mac (not via git):

   ```bash
   # Run on dev Mac
   scp demo_api_server/.env testmac:~/AI-demo-test/demo_api_server/.env
   scp -r certs/ testmac:~/AI-demo-test/
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

4. Verify:

   ```bash
   ssh testmac 'cd ~/AI-demo-test && ./run-docker.sh status'
   ```

## Daily workflow

### Committed work (recommended)

```bash
# Fast gate on dev Mac
./run-tests.sh unit

# Push branch and deploy on test Mac
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
| `scripts/push-to-test.sh [branch] [host] [profile]` | `git push` + remote pull, build, start |
| `scripts/sync-wip-to-test.sh [host] [--no-restart]` | Rsync WIP (no secrets) + restart key services |
| `scripts/run-remote-tests.sh [unit\|api\|e2e\|all] [host]` | Run `./run-tests.sh` on test Mac |
| `scripts/open-test-ui.sh [host]` | SSH tunnel + open `https://api.ping.demo:4000` |

### Deploy profiles

| Profile | What starts |
| --- | --- |
| `smoke` | Core stack only (`./run-docker.sh start`, ~750MB) |
| `full` | Every compose service (default) |
| `max` | Full + RAG + alternate agent frameworks |

```bash
./scripts/push-to-test.sh my-branch testmac smoke
./scripts/push-to-test.sh my-branch testmac max
```

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
