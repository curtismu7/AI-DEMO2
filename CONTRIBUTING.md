# Contributing to AI-DEMO2

Thanks for helping improve the demo. This guide covers how to get set up,
how work flows, and the rules that keep deploys safe.

## Getting set up

Pick your run tier from the README's **Ways to run** section (shared demo →
own SE namespace → laptop). Full install guide:
[docs/runbooks/install-ai-demo.pdf](docs/runbooks/install-ai-demo.pdf).

After cloning:

```bash
npm install                      # in demo_api_server, demo_api_ui, oauth-mcp
cp demo_api_server/.env.example demo_api_server/.env   # then fill PINGONE_*
```

PingOne bootstrap (creates apps, redirect URIs, populates `.env`):

```bash
cd demo_api_server && npm run pingone:bootstrap
```

## How work flows

1. **Branch from `main`.** One branch per change; keep names descriptive
   (`feat/…`, `fix/…`, `docs/…`, `worktree-…` for session worktrees).
2. **Open a PR early.** CI runs on every PR: hygiene gates, Jest (API server),
   Vitest (UI), and service/Python suites depending on what changed. All
   required checks must pass — `main` is protected (force-push and deletion
   blocked).
3. **Merge via PR** — merge commits, squash both happen; PRs keep the
   regression trail.
4. **Deploy** from your own namespace first (`./run-pingaws.sh start` for SE,
   `./run-k8.sh` for laptop). The shared demo at `ai-demo.ping-devops.com` is
   owned by specific namespaces — coordinate before deploying there.

## Repo rules

- **Never commit secrets.** `.env`, `certs/`, and `secrets.vault` are
  gitignored; push protection is on. Tokens in tests/docs are demo fixtures —
  don't replace them with real ones.
- **AI assistants/agents:** follow [CLAUDE.md](CLAUDE.md) (repo conventions,
  regression guard, verification).
- **Demo data** under `demo_api_server/data/` is demo-state, not config —
  expect churn there without needing a PR review.
- **Docs that face customers** (e.g. `docs/personal-agent/`) need owner
  approval before content changes.

## Finding things

- Full deployment guide: [k8s/README.md](k8s/README.md)
- Local Docker run: [DOCKER_STARTUP.md](DOCKER_STARTUP.md)
- New-machine gaps: [NEW-MACHINE.md](NEW-MACHINE.md)
- Architecture: README's Architecture section + the interactive token-flow
  diagram served by the UI

## Reporting issues

Open a GitHub issue with the demo step, expected vs. actual, and the relevant
`kubectl logs` output (redact tokens — they're demo tokens, but keep the
habit).
