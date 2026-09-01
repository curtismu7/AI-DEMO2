# demo_api_server — BFF / API

Inherits the root [CLAUDE.md](../CLAUDE.md) and `REGRESSION_PLAN.md` §0–§1.
Everything below is additive and server-only.

## Stack

- Node >= 22, **CommonJS** (`'use strict'` + `require`) — not ESM
- Express 4.18 · `express-session` + `connect-redis` · LMDB (`lmdb`) for persistence
- Jest 29.7 + supertest · Zod 4 · Biome (`npm run lint`)

## Layout

```text
routes/       130 express Routers, one per feature; mounted in server.js
services/     231 business logic + PingOne / MCP / agent calls
middleware/   session, agent context, authorize gates
utils/        cross-cutting (logger, money, normalizeAxiosError, tokenUtils)
config/       static config + manifests
scripts/      provisioning + verification CLIs (mutate live PingOne — read first)
tests/        jest specs — put new specs here (__tests__/ is legacy, 1 file)
data/         LMDB + JSON fixtures — generated; regenerate, never hand-edit
```

## Environment Setup

See **[docs/ENV.md](../../docs/ENV.md)** for the canonical reference of all PingOne app → env var mappings, resource URI configurations, and instructions for adding new apps.

## Verify before claiming done

```bash
CI=true npm test -- --forceExit          # full suite
CI=true npm run test:unit                # core regression, fastest
```

**Add `--runInBand` for a full local run.** Measured 2026-08-31 on this 16-core
host: `--maxWorkers=4` failed ~2 of 11,000 tests on roughly half of all runs,
`--maxWorkers=2` still failed, and `--runInBand` passed 929/929 clean. The
failures land in a DIFFERENT random suite each time and are connection-level
(`ECONNRESET`, `connect ETIMEDOUT`, socket hang up) or a stray `401` — never the
same test twice, always green in isolation. They are host contention between
parallel worker processes, not defects, and chasing one wastes an hour. In-band
costs ~3 extra minutes (454s vs 259s). CI runs on a clean runner, so
`jest.config.js` keeps 4 workers there deliberately — do not lower it.

**It is NOT the Docker stack** — measured 2026-09-01, correcting the first
version of this note. All 25 containers together draw **0.13 of 16 cores**
(busiest: `ai-demo-api-server`, 2.76% of one core). Stopping the demo to get a
clean test run buys nothing. The real floor is I/O, not CPU: the idle host sits
at load ~12 with only ~17% CPU and 1,200–3,500 disk transactions/sec, because
Code42 backup, Jamf/JamfProtect/ManagedClient and Spotlight (`mds`) scan the
filesystem continuously. Load average counts those blocked threads, which is why
a machine that looks busy is mostly waiting. Disk and memory are fine (71% used,
59% free) — this is not the 2026-07 disk-full problem.

**`CI=true` is mandatory.** Without it supertest suites flake and a green run
proves nothing. Running jest from a worktree needs **no** flags — `jest.config.js`
detects a worktree and drops its own excludes (PR #950). Do **not** pass
`--testPathIgnorePatterns`: it REPLACES the ignore list rather than adding to it,
so an override that omits `/tests/real/` runs the live-stack suites against the
running demo. See the `verify-ai-demo2` skill.

## Error responses — `{ error }`

- ❌ `res.status(400).json({ message: 'bad amount' })`
- ✅ `res.status(400).json({ error: 'bad amount' })`

614 error responses in `routes/` use `{ error }`. Add extra flags alongside it
(`{ error, need_auth: true }`), never instead of it.

## Upstream failures — normalize, don't leak

- ❌ `catch (err) { res.status(500).json({ error: err.message }) }`
- ✅ `const { normalizeAxiosError } = require('../utils/normalizeAxiosError')`

Raw axios errors carry request headers and bearer tokens into the response body
and the log. `normalizeAxiosError(err, { label, timeoutMs })` strips them.

## Generated artifacts

`scopes`, `feature-data`, `vertical-tools`, `use-cases` and the step-verification
ledger are code-generated. After changing their sources run the matching
`npm run *:gen`, then `npm run *:check`. Never hand-edit a generated file to make
a check pass.

Only scope-topology and `mcp-tool-schemas.json` are gated by `.husky/pre-commit`,
and **that gate silently skips inside a worktree** (no `node_modules`, no
`ts-node`) — it prints a warning and lets the commit through. Run
`npm run topology:verify` in the main checkout before merging.
