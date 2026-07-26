# demo_mcp_gateway — MCP gateway / token exchange proxy

Inherits the root [CLAUDE.md](../CLAUDE.md) and `REGRESSION_PLAN.md` §0–§1.
Everything below is additive and gateway-only.

## Stack

- Node >= 22, **TypeScript 5** compiled with `tsc` — `dist/index.js` is the
  build output, never edit it, edit `src/`
- Jest 29.7 + ts-jest · specs live in `tests/`, not colocated with `src/`

## Layout

Flat `src/` — no route-per-file split like the BFF. Key files:

```text
src/index.ts               entrypoint + request routing
src/router.ts               MCP method dispatch
src/gatewayTools.ts          tool schema surface — see "Generated artifacts" below
src/tokenValidator.ts        aud / scope checks on inbound tokens
src/pingAuthorizeGuard.ts   P1AZ decision-point calls
src/dualTokenDispatch.ts     two-exchange (mirroredScopes) path
src/config.ts                env-driven config (20K+ — read before adding a flag)
```

## Verify before claiming done

```bash
npm run build   # tsc — a passing test run does not catch type errors
npm test         # jest --forceExit
```

## Generated artifacts — you likely need to regenerate

`src/gatewayTools.ts` feeds root-level `mcp-tool-schemas.json` via
`npm run gen:tool-schemas` (`ts-node scripts/genToolSchemas.ts`). Changing a
tool's shape here without regenerating breaks the schema the BFF and agents
consume. See `demo_api_server/CLAUDE.md` — `.husky/pre-commit` gates this file
and **silently skips inside a worktree** (no `ts-node`/`node_modules`); rerun
`npm run gen:tool-schemas` and `npm run topology:verify` in the main checkout
before merging.

## Two-exchange / mirroredScopes

A chip greying out in the UI with no error is usually a missing
`mirroredScopes` entry on the Agent Gateway app, not a gateway bug — a startup
reconciler self-heals this in the running stack. Check PingOne app config
before debugging `dualTokenDispatch.ts`.
