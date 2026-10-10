---
name: docker-local-deploy
description: Use when building, running, rebuilding, or troubleshooting the AI-DEMO2 Docker stack locally (OrbStack) — run-docker.sh builds, compose up/down, container restarts, healthcheck failures, "wrong version number" TLS errors, containers that won't start from a fresh or worktree checkout, PROD_MODE vs dev mode, or anything mentioning the ai-demo compose project, ui/demo-api-server/mcp-server services, certs/, or the .env files. Trigger even if the user just says "deploy locally", "rebuild the containers", or "the stack is down".
---

# Docker Local Deploy (OrbStack)

This stack runs via OrbStack — never Docker Desktop, never `docker context use desktop-linux`. Context must be `orbstack`; if Docker isn't running, any `docker` command auto-starts OrbStack.

## Canonical commands

```bash
./run-docker.sh build ui          # build a service (PROD_MODE builds the nginx stage)
docker compose -p ai-demo up -d ui demo-api-server
docker compose -p ai-demo build mcp-server
```

- Project name is pinned: `-p ai-demo`. Service names are `ui`, `demo-api-server`, `mcp-server` — there is no `api-server` service.
- The compose `ui` service defaults to a **Vite dev container** (bind-mounted src). `PROD_MODE=1` builds the nginx production stage. If the user says "deploy", they usually mean PROD_MODE; if they say "dev", don't add it.
- Prefer `./run-docker.sh` over hand-rolling compose invocations — it handles the flags. From a git worktree, `ALLOW_WORKTREE_PROJECT_DIR=1` is required.

## Fresh checkout / fresh worktree: the three silent failures

`certs/` and both `.env` files are **gitignored**, so every fresh checkout or `.claude/worktrees/<name>` is missing them. Before any `up` from a fresh tree, run one copy pass from the previous deploy worktree or repo root:

1. **`certs/`** — copy `*.pem` + `ca-bundle-with-mkcert.pem`. Without them, api-server boots plaintext on 3001 and the healthcheck `https://localhost:3001/api/healthz` fails with **"wrong version number"**. That error is TLS-vs-plaintext mismatch, not a code bug — don't debug the server, copy the certs.
2. **`demo_api_server/.env`** — compose `up` errors outright without it.
3. **`oauth-mcp/.env`** — this one is **baked into the mcp-server image** (no bind mount; the container reads `/app/.env` at runtime). Copying the file does nothing until you rebuild: copy into `oauth-mcp/`, then `docker compose -p ai-demo build mcp-server`, then `up -d`.

## Troubleshooting quick map

| Symptom | Cause | Fix |
|---|---|---|
| healthz "wrong version number" | certs/ missing → plaintext on 3001 | copy certs, restart |
| compose up errors immediately | `demo_api_server/.env` missing | copy .env |
| MCP server has stale config | oauth-mcp/.env changed but image not rebuilt | rebuild mcp-server |
| UI changes not showing | running dev container, expected PROD_MODE (or vice versa) | check PROD_MODE |

## Building from a dirty main checkout

Never build from a main checkout dirty with other sessions' WIP — `COPY demo_api_ui/ .` bakes uncommitted changes into the image. Point a worktree at the target commit (`git checkout <sha>` in a worktree), copy the gitignored files in, build from there. `scripts/sync-main-checkout.sh` and `scripts/deploy-live.sh` back off on dirty trees for this reason.
