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

**The random `ECONNRESET` was NOT host contention** — that was the standing
explanation here until 2026-09-09 and it is wrong, which matters because it
sends you to `--runInBand`, where the failures still happen. Instrumenting one
full run to capture a creation stack per failing socket found **4,072 real
outbound connection attempts** (1,801 `ENOTFOUND`, 1,991 `UND_ERR_SOCKET`, 185
`ECONNABORTED`), almost all from `services/mcpChallengeProbe.js` and
`services/rfc9728ComplianceAuditService.js` dialling hosts like `gw.local:443`
that do not resolve. Those errors resolve AFTER the test that started them has
finished, so jest pins them on whichever test is running when they land — a
different suite every run, always green in isolation, and independent of worker
count. The DNS timeouts also blew wall-clock budgets:
`rfc9728-integration-verification` took 39.4s and FAILED its own `<5000ms`
assertion.

`src/__tests__/setup.js` now blocks outbound network from unit tests (loopback
allowed, by RESOLVED address — `/etc/hosts` maps `api.ping.demo` here — and
`ALLOW_TEST_NETWORK=1` opts out). Suites over 1s went 38 → 11 and their combined
time 380.9s → ~93-149s; the 39.4s failure became 0.5s green.
`tests/testNetworkGuard.test.js` pins the two things that were silently wrong on
the first attempt.

**Flakiness is REDUCED, NOT GONE.** Two full in-band runs after the guard still
failed 1 and 2 suites — different ones each time, all green in isolation, and
the guard's own error appears in none of them. Residual causes: LMDB
`MDB_READERS_FULL: Environment maxreaders limit reached` (took out 5 suites in
one run) and loopback-level `read ECONNRESET` between supertest and the
ephemeral server it starts per request. Still worth `--runInBand` locally for a
quieter signal, but do not read a lone red suite as a regression — re-run it
alone first. CI runs on a clean runner, so `jest.config.js` keeps 4 workers
there deliberately — do not lower it.

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
