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

**The non-obvious trap, and why the old fix is now the bigger hazard.**
`jest.config.js`'s `testPathIgnorePatterns` excludes any path containing
`.claude/worktrees/` — a guard so the main repo's run doesn't double-execute
suites inside agent worktrees. Running jest *from inside* such a worktree used
to mean every file's own path matched, and jest reported:

```
No tests found, exiting with code 1
```

**This is fixed. Do NOT pass `--testPathIgnorePatterns`.** Since PR #950,
`demo_api_server/jest.config.js` (see the worktree self-detect block, ~L59-65)
drops the worktree excludes when `__dirname` is already inside a worktree. The
plain command works:

```
cd demo_api_server && CI=true npm test -- --forceExit --maxWorkers=4
```

Passing the override now makes things **worse**, because the flag REPLACES the
list rather than appending to it — so any override omitting `/tests/real/` drags
the real suites back in. Confirmed harmful 2026-08-02: an agent passed
`--testPathIgnorePatterns="/node_modules/"` out of habit and ran 13 live-stack
suites against the running demo.

If you ever genuinely need an override, `/tests/real/` must stay in it. Real
suites are meant to run deliberately:
`npx jest --config jest.real.config.js`, live stack plus credentials.

`--maxWorkers=4` matters separately: under parallel load this suite flakes with a
*different disjoint set* of suites failing each run. Re-run any failure in
isolation before calling it a regression, and compare against a stashed baseline.

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
| jest: "No tests found, exiting with code 1" run from a `.claude/worktrees/*` path | Fixed in PR #950 — the config self-detects worktrees | Run plain `CI=true npm test -- --forceExit --maxWorkers=4`. Do **not** pass `--testPathIgnorePatterns`; it replaces the list and drags `/tests/real/` against the live stack |
| Different disjoint suites fail on each run of the same code | Parallel-load contention, not a regression | `--maxWorkers=4`, re-run the failing suite in isolation, compare to a stashed baseline |
| `topology:verify` fails at step 6/7, `sh: jest: command not found` | Worktree has no `demo_mcp_gateway/node_modules` | Symlink it from the main checkout — this is a worktree gap, not drift |
| `graphify query` errors in a worktree | `graphify-out/graph.json` (~44MB) exists only in the main checkout | Use grep/Read and say so; run `graphify update .` in the main checkout after merge |
| jest can't find `node_modules` in a worktree | worktrees don't inherit installed deps (lockfiles are gitignored repo-wide) | `npm install` in the service dir, or symlink to the main checkout's `node_modules` |
| `.env` change doesn't take effect after `docker compose restart` | env vars are baked in at container creation | `docker compose up -d <service>` (recreate, not restart) |
| commit touching `configStore.js` regenerates an unrelated file | pre-commit hook | expected on commit — don't fight it |
