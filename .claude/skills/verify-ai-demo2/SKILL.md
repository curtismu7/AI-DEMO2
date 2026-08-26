---
name: verify-ai-demo2
description: >-
  Use when running or verifying tests from a git worktree under
  .claude/worktrees/ in this repo, when confirming a code/env change actually
  took effect in the running AI-DEMO2 Docker stack, or BEFORE instrumenting a
  code path you have only read. Covers the repeat failure where a feature is
  correct, tested, merged and inert because the code sits where the request
  never goes; proving a code path runs from container logs; proving a new guard
  fails without its fix; jest "No tests found" and missing node_modules in a
  fresh worktree; npx pulling the wrong jest/vitest; restart-vs-recreate for
  Docker changes; verifying by content rather than by a stamp or a success line;
  the jest-vs-vitest expect() signature split; and the shared deploy lock, deploy
  stamp and stash stack when several agent sessions run on one machine.
---

# Verify AI-DEMO2

Operational gotchas for building/testing/verifying changes in this repo that
aren't documented anywhere else. Confirmed via live baseline testing against
the real stack and a fresh worktree (2026-07-11).

## Testing from a worktree

A fresh worktree under `.claude/worktrees/` has no `node_modules` — every
`package-lock.json` in this repo is gitignored, so worktrees never inherit
installed deps. **Fix: `bash scripts/bootstrap-worktree.sh` from inside the
worktree** — it symlinks every Node service's `node_modules` from the main
checkout AND verifies every dep the worktree's package.json declares resolves
through the link, naming the `npm --prefix <main-svc> install` to run when the
main tree predates a new dependency. Do NOT hand-symlink per service: one
session's `ls … | head -1 || ln -s …` one-liner had its failure swallowed by
the pipe, the link was never created, and a full suite "failed" on
MODULE_NOT_FOUND that read as a code problem; its first real run also caught
five services whose main node_modules were missing newly-declared deps
(dotenvx, the OpenTelemetry trio, posthog-node) — five latent build breaks.
`--check` verifies without changing anything.

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

### Image-built services: restart keeps OLD code, and looks healthy (2026-08-26)

**Only `demo-api-server` and `ui` bind-mount source.** Every other service gets
its CODE from a built image, so `./run-docker.sh restart <svc>` recreates the
container from the EXISTING image.

**Code and config are separate questions.** A service can take its code from an
image and its config from a live mount, so the right verb depends on which one
your change touched — see the ping-gateway row below.

The reason this costs a session rather than a minute is not that restart
doesn't rebuild — everyone knows that abstractly. It is that the container
comes up **healthy** and logs a **clean startup**, so every signal you would
normally trust says the deploy worked. Nothing anywhere reports staleness.

| service | how it gets code | to deploy a change |
|---|---|---|
| `demo-api-server`, `ui` | bind mount | `scripts/deploy-live.sh` |
| `mcp-server` (dir `oauth-mcp`) | **image** | `./run-docker.sh build mcp-server` |
| `authz-server` (dir `demo_authz_server`) | **image**, and it BAKES `scope-topology.json` (build context is the repo root) | `./run-docker.sh build authz-server` |
| `mcp-gateway` | image, plus a `/repo` mount for `dist` | check before assuming |
| `ping-gateway` | image for code, but **`ping-gateway/config` is a live directory mount** — its `scope-topology.json` comes from the checkout | `./run-docker.sh restart ping-gateway` (rebuilding is wasted work) |

**The asymmetry that catches people:** one change to `scope-topology.json`
needs *two different verbs*, because `authz-server` bakes it into the image
while `ping-gateway` mounts it from the checkout:

```bash
./run-docker.sh build   authz-server    # topology BAKED  (build context = repo root)
./run-docker.sh restart ping-gateway    # topology MOUNTED (ping-gateway/config)
```

Rebuild both and you waste a build; restart both and you ship half the change —
and per the paragraph above, both containers report healthy either way.

Use the **compose service name**, not the directory: `authz-server`, never
`demo_authz_server`. `authz-server` and `mcp-gateway` also sit behind
`profiles: ["demo-auth"]`, which the default core+rag set does not start — a
missing container after a plain restart is that, **not a crash**.
`deploy-live.sh` brings them up.

**Verify by content, in-container, AFTER the build:**

```bash
docker exec ai-demo-authz-server grep -c '<marker from YOUR OWN diff>' /repo/scope-topology.json
```

`authz-server` has no source or topology bind mount (only `/certs` and
`/otel`) — which is *why* the restart is silent, there is no mounted file to
notice. The repo lands at `/repo` inside the image. Before a rebuild that grep
returns `0` with the container healthy.

Two traps, both hit on 2026-08-26:

- **Grep a marker from your OWN diff.** Checking one from somebody else's
  recently-merged PR passes whether or not your code is in the image — a check
  that proves nothing.
- **A currently-correct image does not track main.** It is current because a
  human rebuilt it after merging. Never infer "no rebuild needed here" from
  finding today's code in there.

## Known gotcha not re-verified in this pass

Staging `services/configStore.js` (or files that touch it) can trigger a
pre-commit hook that regenerates `mcp-tool-schemas.json` on `git commit` —
expect it, don't fight it. (`git add` alone does not trigger it — confirmed
live.)

## Code existing is not evidence it runs (2026-08-18)

The single most expensive mistake in this repo, measured across one day: reading
a file, seeing the code, and concluding the code executes. It produced three
merged-and-inert features and two wrong diagnoses, every one of which passed its
tests and a review.

| shipped green | actually true |
|---|---|
| gateway filter stages (#1951) | rendered into `TraceStepCard`, which focus mode never mounts |
| MCP handshake header (#1977) | put on the gateway's HTTP response; discovery arrives over a WebSocket |
| MCP handshake in Groovy (#2023) | `olb-token-exchange.groovy` never executes — `grep OlbExchange` in the gateway log returns 0 lines. **STALE as of 2026-08-19: it executes now.** Same grep returns 8 lines per agent tool call (`[OlbExchange] Sending MCP initialize` → `MCP session established` → `Forwarding tool call directly` → `MCP direct response HTTP 200` with real account data). Fixed sometime after this row was written. The row stays because the LESSON is what matters — but do not reuse the claim as a current fact; re-run the grep |
| "the chips restore affects the public route" | `PublicRoutes.AgentPageRoute` is exported and referenced nowhere |
| first `deploy-live` stamp fix | `filter_running` is called in `$(...)`, so its variable assignments never reached the parent |

**Before instrumenting anything, prove the code path runs.** One log line beats
any amount of reading:

```bash
docker logs ai-demo-<service> --since 5m | grep '<a marker from that function>'
```

If there is no marker, add one, drive the path, and look — do not infer. The
handshake was finally solved by driving each leg separately and counting
connections on the MCP server, which took ten minutes and contradicted two days
of source reading.

**Corollary — a passing test near the change proves nothing about reach.** All
three inert features had green unit tests. What they lacked was one live
assertion that the evidence appears in a real response. See
`demo_api_ui/tests/e2e/chain-hops-reachable.real.spec.js`.

**Corollary — prove the guard fails without the fix.** Revert the change, watch
the new test go red, restore. A test that has never failed is a guess. This
caught a stamp fix that was structurally incapable of firing.

## Verifying against the live stack

- **Wait after a deploy.** `deploy-live` returns as soon as containers restart;
  the BFF needs a moment. A live check run ~8s after a restart failed, then
  passed twice unchanged. Re-run once before believing a failure.
- **Verify by content, never by SHA or by a success line.** After
  `sync-main-checkout.sh`, grep the merged code in
  `/Users/cmuir/Development/AI-DEMO2` — a launchd sync, another agent session, or
  a half-finished deploy can all leave the stamp ahead of reality.
- **Never trust a piped exit code.** `cmd | tail` reports tail's status. Redirect
  to a file, echo `$?`, then grep the file.
- **The live specs need a live session.** `.ba-welcome` only renders with zero
  messages — conversation continuity keeps 30 per user+vertical — so a copy check
  must click `.ba-start-over-btn` first or it reads an empty array as "missing".

## Two assertion libraries, two runners

`demo_api_server` is jest; `demo_api_ui` is vitest; `tests/e2e` is playwright. The
failure text does not tell you which you are in.

- `expect(value, "message")` is vitest/playwright only. In jest it throws
  **"Expect takes at most one argument"**, which reads like a problem with the
  value. Put the diagnostic inside the assertion instead.
- Playwright's `expect.poll` prints the **source** of a function `message`, not
  its value — so the diagnostic written for the failing case is the one thing you
  cannot read. Use a static string and `console.log` the dynamic part as it
  arrives.

## Concurrent agent sessions share one machine

Several sessions run against one Docker project, one `.git/deploy-live.last`, and
one stash stack.

- `deploy-live` now takes a lock and refuses rather than racing. If it says
  another deploy is running, wait — do not work around it.
- **The lock stops two DEPLOYS racing. It does NOT stop a deploy racing someone's
  live UI/browser run** — and that failure is expensive because it looks exactly
  like a product bug. A deploy restarts `ui` (nginx: serves the SPA *and* proxies
  `/api`) and/or `demo-api-server` underneath whoever is driving the browser.
  Requests issued into that window die in front of the BFF: an inexplicable
  404/502, and **zero matching lines in `docker logs ai-demo-api-server`** —
  which reads as "the request never reached the server, so the fault is in
  routing / base-URL / the proxy."
  Observed 2026-08-19: a session spent an investigation on a HITL consent-confirm
  404 (concluding, reasonably, that it never reached the BFF) when
  `ai-demo-ui` had restarted at `03:06:10Z` and the failing run was ~03:06Z. The
  endpoint was fine — probing it afterwards through BOTH nginx `:4000` and the
  BFF `:3001` returned identical JSON 401s.
  **Before treating any live-run failure as a finding, check whether the ground
  moved under it:**
  ```bash
  docker inspect ai-demo-ui ai-demo-api-server \
    --format '{{.Name}} {{.State.StartedAt}}'   # before AND after the run
  ```
  If either timestamp moved during the run, the run is void — re-run it, do not
  log it. Announce a deploy to peers (`SendMessage`) when you know someone is
  driving, and prefer waiting to redeploying mid-drive.
- It will not stamp a range whose services are not up, so a failed deploy leaves
  the range for the next run. A `Created` container is a broken service, not an
  absent one.
- `deploy-live <old> <new>` still writes the stamp. Passing an explicit range for
  a one-off test corrupts it for everyone; capture the value first and restore it.
- The stash stack is shared. `git stash apply <sha>` then `drop`, never `pop`,
  and re-check the SHA before dropping.

## Quick Reference

| Symptom | Cause | Fix |
|---|---|---|
| jest: "No tests found, exiting with code 1" run from a `.claude/worktrees/*` path | Fixed in PR #950 — the config self-detects worktrees | Run plain `CI=true npm test -- --forceExit --maxWorkers=4`. Do **not** pass `--testPathIgnorePatterns`; it replaces the list and drags `/tests/real/` against the live stack |
| Different disjoint suites fail on each run of the same code | Parallel-load contention, not a regression | `--maxWorkers=4`, re-run the failing suite in isolation, compare to a stashed baseline |
| `topology:verify` fails at step 6/7, `sh: jest: command not found` | Worktree has no `demo_mcp_gateway/node_modules` | Symlink it from the main checkout — this is a worktree gap, not drift |
| `graphify query` errors in a worktree | `graphify-out/graph.json` (~44MB) exists only in the main checkout | Use grep/Read and say so; run `graphify update .` in the main checkout after merge |
| jest can't find `node_modules` in a worktree | worktrees don't inherit installed deps (lockfiles are gitignored repo-wide) | `bash scripts/bootstrap-worktree.sh` — links every service and verifies declared deps resolve |
| `.env` change doesn't take effect after `docker compose restart` | env vars are baked in at container creation | `docker compose up -d <service>` (recreate, not restart) |
| commit touching `configStore.js` regenerates an unrelated file | pre-commit hook | expected on commit — don't fight it |
| a feature is correct, tested, merged — and does nothing | the code sits on a path the request never takes | `docker logs <service> \| grep <marker>` before instrumenting; see "Code existing is not evidence it runs" |
| `npx jest` / `npx vitest` in a worktree runs a DIFFERENT version from `~/.npm/_npx` | worktree has no `node_modules` | symlink the service's `node_modules` from the main checkout and call `./node_modules/.bin/jest` directly |
| a live check fails seconds after `deploy-live`, passes on re-run | BFF still warming after the restart | re-run once; only investigate if it repeats |
| `expect(x, 'msg')` fails with "Expect takes at most one argument" | that form is vitest/playwright; this is jest | move the diagnostic into the assertion |
| deploy-live refuses with "another deploy is running" | another agent session holds the lock | wait for it; do not bypass |
