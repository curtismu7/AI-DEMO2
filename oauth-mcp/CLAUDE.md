# oauth-mcp — banking MCP tool server

Inherits the root [CLAUDE.md](../CLAUDE.md) and `REGRESSION_PLAN.md` §0–§1.
Everything below is additive and mcp-server-only.

## Stack

- Node >= 22, **TypeScript 5**, `dist/index.js` build output via `tsc` —
  never edit `dist/`, edit `src/`
- Jest 29.5 + ts-jest, ESLint (`typescript-eslint` 8)

## Layout

```text
src/tools/BankingToolRegistry.ts   the tool catalog — 53.8K, read before adding a tool
src/tools/BankingToolProvider.ts   tool dispatch/execution
src/tools/BankingToolValidator.ts  input validation per tool
src/tools/handlers/                per-tool handler classes (AuthorizationChallenge, TokenChain, …)
src/auth/ src/services/ src/storage/
tests/                              integration + cross-cutting specs
src/**/__tests__/                   colocated unit specs — both patterns are live, match the nearest sibling
```

## Verify before claiming done

```bash
npm run build              # tsc
npm run test:unit          # fast — excludes tests/integration
npm run test:integration    # NODE_ENV=test jest --testPathPattern=integration
```

## Tool registry — the shape agents depend on

Adding or changing a tool means updating `BankingToolRegistry.ts` **and**
regenerating anything downstream that mirrors its schema (root
`mcp-tool-schemas.json`, gateway `gatewayTools.ts` topology — see
`demo_mcp_gateway/CLAUDE.md`). A tool defined only here and not reflected in
`scope-topology.json` fails `npm run topology:verify`.

## Token chain

`TokenChainAuditor.ts` / `TokenResolver.ts` implement the RFC 8693 nested-`act`
identity chain — this is distinct from the Linux Foundation A2A wire protocol
used elsewhere in the repo (`@a2a-js/sdk`). Don't conflate the two when
touching delegation code.
