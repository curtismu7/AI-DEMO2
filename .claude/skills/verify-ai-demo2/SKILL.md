---
name: verify-ai-demo2
description: >-
  Use when running or verifying jest tests from inside a git worktree under
  .claude/worktrees/ in this repo, or when confirming a code/env change took
  effect in the running AI-DEMO2 Docker Compose stack (demo-api-server and
  friends). Covers jest reporting "No tests found, exiting with code 1" with
  no other explanation, missing node_modules in a fresh worktree, and
  restart-vs-recreate for Docker service changes.
---

# Verify AI-DEMO2

Operational gotchas for building/testing/verifying changes in this repo that
aren't documented anywhere else. Confirmed via live baseline testing against
the real stack and a fresh worktree (2026-07-11).

## Testing from a worktree

A fresh worktree under `.claude/worktrees/` has no `node_modules` — every
`package-lock.json` in this repo is gitignored, so worktrees never inherit
installed deps. Fix: `npm install` in the relevant service directory (e.g.
`demo_api_server`), or symlink `node_modules` back to the main checkout if one
already exists elsewhere (faster, and how the existing worktrees do it).

**The non-obvious trap:** `jest.config.js`'s `testPathIgnorePatterns` excludes
any path containing `.claude/worktrees/` — a guard so the main repo's test run
doesn't double-execute suites it walks into inside agent worktrees. Running
jest *from inside* such a worktree means every file's own path matches that
pattern, so jest reports:

```
No tests found, exiting with code 1
```

with nothing indicating the real cause is "your cwd is excluded," not a
missing or misnamed test. Fix: override the pattern on the CLI (this replaces,
not merges with, the config array):

```
npx jest <path-to-test> --testPathIgnorePatterns="/node_modules/"
```

## Docker service changes

Check the service's block in `docker-compose.yml` before assuming a rebuild
is needed — several services (e.g. `demo-api-server`) bind-mount source with
a "Hot reload" comment, so `docker compose restart` alone picks up code
changes. `.env` values are baked in at container creation and are **not**
re-read on `restart`; use `docker compose up -d <service>` to recreate the
container so env changes take effect too. Confirm with
`docker compose logs <service> --since <window>` rather than assuming.

## Known gotcha not re-verified in this pass

Staging `services/configStore.js` (or files that touch it) can trigger a
pre-commit hook that regenerates `mcp-tool-schemas.json` on `git commit` —
expect it, don't fight it. (`git add` alone does not trigger it — confirmed
live.)

## Quick Reference

| Symptom | Cause | Fix |
|---|---|---|
| jest: "No tests found, exiting with code 1" run from a `.claude/worktrees/*` path | `testPathIgnorePatterns` excludes worktree paths | `--testPathIgnorePatterns="/node_modules/"` on the CLI |
| jest can't find `node_modules` in a worktree | worktrees don't inherit installed deps (lockfiles are gitignored repo-wide) | `npm install` in the service dir, or symlink to the main checkout's `node_modules` |
| `.env` change doesn't take effect after `docker compose restart` | env vars are baked in at container creation | `docker compose up -d <service>` (recreate, not restart) |
| commit touching `configStore.js` regenerates an unrelated file | pre-commit hook | expected on commit — don't fight it |
