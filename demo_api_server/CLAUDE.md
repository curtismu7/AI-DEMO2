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
