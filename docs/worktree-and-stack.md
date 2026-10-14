# Worktree, sync and stack operations

Detail for the worktree and shared-stack rules summarised in CLAUDE.md. Moved here from CLAUDE.md verbatim; CLAUDE.md keeps the rules.

## Syncing the main checkout

**After any PR merges, sync the shared main checkout:** `scripts/sync-main-checkout.sh` from repo root. Docker (`ai-demo-ui`/`ai-demo-api-server`) bind-mounts that checkout's files directly — a merge on GitHub does not update them, so the running demo silently serves stale code until something pulls. The script fast-forwards only; it backs off untouched if anything unexpected is dirty. A launchd job also runs it every 15 min to catch merges that land outside any agent session.

## Trying worktree code in the running stack

**To try your worktree's code in the running stack:** `npm run serve:worktree here` (status with no argument; `main` hands it back). It moves only the two source mounts — `ui` and `demo-api-server` are the only services that bind-mount source — and keeps `--project-directory` on the main checkout, so all 37 `env_file` entries still resolve. Never `docker compose up` from a worktree: it repoints the shared containers *and* starves every service of its `.env` (a worktree carries no gitignored files, and each entry is `required: false`, so Compose skips it silently). One stack, one owner — the status line names which checkout is being served.

## UI mode

**UI mode: dev server or built bundle.** `npm run ui:mode` shows it; `npm run ui:mode built` serves the nginx production bundle (about 1,300 fewer requests at boot and no StrictMode double-run — the faster way to demo), `npm run ui:mode dev` brings back Vite HMR. Built bakes the source in: `deploy-live.sh` will not restart it (it would keep serving the old code) and `serve:worktree` refuses — re-run `ui:mode built` after a merge, or switch to `dev` first.

## When sync backs off

**When sync backs off:** `npm run sync:status` says whether the checkout is stale and names the files blocking it (silent staleness is the failure mode — the launchd job logs where nobody looks). `npm run sync:unblock` (`scripts/park-main-edits.sh`) moves stray main-checkout edits onto a `wip/main-<timestamp>` branch and then syncs — nothing stashed, nothing discarded, recover with `git switch wip/main-<timestamp>`. Untracked top-level `.claude/*.md` notes no longer block sync at all. A `SessionStart` hook (`.claude/hooks/warn-stale-main-checkout.sh`) fetches and runs `sync-status.sh` at the top of every session, so a stale or blocked checkout announces itself instead of being discovered hours later; it is silent when in sync and never blocks.

