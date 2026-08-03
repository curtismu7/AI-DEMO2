# Gateway MCP Validation + Token Exchange Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the two partial Agent Gateway capabilities — full MCP request validation (both gateways) and RFC 8693 token transformation (both Node transports) — per the approved spec `docs/superpowers/specs/2026-07-02-agent-gateway-validation-and-ws-exchange-design.md`.

**Architecture:** A generated repo-root `mcp-tool-schemas.json` artifact drives Ajv validation in the Node gateway (`demo_mcp_gateway`, both WS and HTTP transports) and a Groovy subset-validator in the IG gateway (`ping-gateway`). Token exchange is fixed by switching `McpTokenExchangeClient` from the ignored `audience=` param to RFC 8707 `resource=` + explicit `scope`, provisioning the missing invest resource server via `scope-topology.json` + the startup reconciler, and then wiring exchange into both Node transports fail-closed. Backends accept a comma-separated audience list during rollout.

**Tech Stack:** TypeScript (Node 20, jest/ts-jest), Ajv v8, IG Groovy ScriptableFilter, PingOne Management API (reconciler), docker-compose.

## Global Constraints

- Work happens in this worktree (`worktree-gateway-validation-ws-exchange`); stage files explicitly (`git add <files>`), never `git add -A`; verify `git branch --show-current` before each commit.
- Fail closed everywhere: exchange failure → JSON-RPC `-32500` + `data.error: 'token_exchange_failed'` (HTTP transport: status 502, same body); unknown tool → `-32602`; schema failure → `-32602` + `data.validationErrors`.
- Method allow-list (both gateways): exactly `initialize`, `notifications/initialized`, `tools/list`, `tools/call`.
- Never rotate PingOne secrets or edit `.env` credentials (standing user rule). The reconciler heals via the existing worker credentials.
- Do NOT touch dispatch paths A/B/C (`apikey` / `dualtoken` / `bankingdata`) — only the olb/invest MCP proxy paths gain exchange.
- Task 8 is a HARD GATE: if the live exchange verification fails, STOP and report — do not proceed to Tasks 9-12.
- `demo_mcp_gateway` tests run with `cd demo_mcp_gateway && npx jest tests/<file> --forceExit`; typecheck with `npm run typecheck`.
- All paths below are relative to the worktree root.

---

### Task 1: Extract gateway-owned tool descriptors into a shared module

The `gatewayTools` array is defined inline inside the WS `tools/list` handler. The schema generator (Task 2) and validation module (Task 3) need it importable.

**Files:**
- Create: `demo_mcp_gateway/src/gatewayTools.ts`
- Modify: `demo_mcp_gateway/src/index.ts` (the `const gatewayTools = [...]` block inside the `tools/list` branch, ~lines 438-495)
- Test: `demo_mcp_gateway/tests/gatewayTools.test.ts`

**Interfaces:**
- Produces: `export interface GatewayToolDescriptor { name: string; description: string; inputSchema: Record<string, unknown>; credentialPath: string; }` and `export const GATEWAY_TOOLS: GatewayToolDescriptor[]` from `src/gatewayTools.ts`. Task 2 and Task 3 import `GATEWAY_TOOLS`.

- [ ] **Step 1: Write the failing test**

```typescript
// demo_mcp_gateway/tests/gatewayTools.test.ts
'use strict';
import { GATEWAY_TOOLS } from '../src/gatewayTools';

describe('GATEWAY_TOOLS', () => {
  it('exports the gateway-owned tool descriptors', () => {
    const names = GATEWAY_TOOLS.map((t) => t.name);
    expect(names).toContain('special_offers');
    expect(names).toContain('user_profile_card');
    expect(names).toContain('show_health_record');
    // every descriptor has a JSON-Schema object inputSchema
    for (const t of GATEWAY_TOOLS) {
      expect(typeof t.name).toBe('string');
      expect(t.inputSchema).toMatchObject({ type: 'object' });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_mcp_gateway && npx jest tests/gatewayTools.test.ts --forceExit`
Expected: FAIL — `Cannot find module '../src/gatewayTools'`

- [ ] **Step 3: Create the module by MOVING the array**

Create `demo_mcp_gateway/src/gatewayTools.ts`. Cut the ENTIRE `const gatewayTools = [ ... ]` array literal out of `index.ts` (content-preserving — do not retype entries; there are ~9: `special_offers`, `user_profile_card`, and the `show_*` per-vertical tools) and paste it as the exported constant:

```typescript
'use strict';

/**
 * gatewayTools.ts — descriptors for tools the GATEWAY itself owns and
 * dispatches (api_key / dual_token credential paths). Single source shared by
 * the WS tools/list handler, the schema-artifact generator, and request
 * validation. Moved verbatim from index.ts (Phase 266/267 definitions).
 */

export interface GatewayToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  credentialPath: string;
}

export const GATEWAY_TOOLS: GatewayToolDescriptor[] = [
  // <the exact array contents moved from index.ts — unchanged>
];
```

In `index.ts`: add `import { GATEWAY_TOOLS } from './gatewayTools';` and replace the removed literal with `const gatewayTools = GATEWAY_TOOLS;` (the rest of the handler — `allTools.push(...gatewayTools)`, `gatewayOwnedNames` — is untouched).

- [ ] **Step 4: Run test + typecheck to verify pass**

Run: `cd demo_mcp_gateway && npx jest tests/gatewayTools.test.ts --forceExit && npm run typecheck`
Expected: PASS, no type errors

- [ ] **Step 5: Commit**

```bash
git add demo_mcp_gateway/src/gatewayTools.ts demo_mcp_gateway/src/index.ts demo_mcp_gateway/tests/gatewayTools.test.ts
git commit -m "refactor(gateway): extract GATEWAY_TOOLS descriptors into shared module"
```

---

### Task 2: Schema artifact generator + `mcp-tool-schemas.json` + drift test

**Files:**
- Create: `demo_mcp_gateway/scripts/genToolSchemas.ts`
- Create: `mcp-tool-schemas.json` (repo root — generated output, committed)
- Modify: `demo_mcp_gateway/package.json` (add `gen:tool-schemas` script)
- Modify: `demo_mcp_gateway/tsconfig.json` (ensure `scripts/` is excluded from the build if an `include`/`exclude` conflict arises — only if `npm run typecheck` complains)
- Test: `demo_mcp_gateway/tests/toolSchemaDrift.test.ts`

**Interfaces:**
- Consumes: `GATEWAY_TOOLS` (Task 1); `BankingToolRegistry.getAllTools()` from `demo_mcp_server/src/tools/BankingToolRegistry.ts` (each entry has `name` and `inputSchema`); `INVEST_TOOLS` from `demo_mcp_resource_server/src/tools/investTools.ts` (each entry has `name` and `inputSchema`); router sets from `demo_mcp_gateway/src/router.ts`.
- Produces: `mcp-tool-schemas.json` with shape `{ "version": 1, "tools": { "<name>": { "source": "olb"|"invest"|"gateway", "inputSchema": {...} } } }`; `buildToolSchemas()` exported from the generator (the drift test and generator share it).

- [ ] **Step 1: Write the generator with an exported pure builder**

```typescript
// demo_mcp_gateway/scripts/genToolSchemas.ts
'use strict';

/**
 * genToolSchemas — regenerates the repo-root mcp-tool-schemas.json artifact
 * from the three tool-definition sources. Run: npm run gen:tool-schemas
 * The drift test (tests/toolSchemaDrift.test.ts) fails when the committed
 * artifact differs from a fresh build.
 */

import * as fs from 'fs';
import * as path from 'path';
import { BankingToolRegistry } from '../../demo_mcp_server/src/tools/BankingToolRegistry';
import { INVEST_TOOLS } from '../../demo_mcp_resource_server/src/tools/investTools';
import { GATEWAY_TOOLS } from '../src/gatewayTools';

export interface ToolSchemaEntry {
  source: 'olb' | 'invest' | 'gateway';
  inputSchema: Record<string, unknown>;
}
export interface ToolSchemaArtifact {
  version: number;
  tools: Record<string, ToolSchemaEntry>;
}

// Gateway-routed demo tools with no descriptor source: they take no arguments.
const EMPTY_OBJECT_SCHEMA = { type: 'object', properties: {}, additionalProperties: false };
const EXTRA_GATEWAY_TOOLS = ['show_mortgage', 'demo_show_accounts', 'demo_show_transactions'];

export function buildToolSchemas(): ToolSchemaArtifact {
  const tools: Record<string, ToolSchemaEntry> = {};
  for (const t of BankingToolRegistry.getAllTools()) {
    tools[t.name] = { source: 'olb', inputSchema: t.inputSchema as Record<string, unknown> };
  }
  for (const t of INVEST_TOOLS) {
    tools[t.name] = { source: 'invest', inputSchema: t.inputSchema };
  }
  for (const t of GATEWAY_TOOLS) {
    tools[t.name] = { source: 'gateway', inputSchema: t.inputSchema };
  }
  for (const name of EXTRA_GATEWAY_TOOLS) {
    if (!tools[name]) tools[name] = { source: 'gateway', inputSchema: { ...EMPTY_OBJECT_SCHEMA } };
  }
  // Deterministic key order so regenerate-and-diff is stable.
  const sorted: Record<string, ToolSchemaEntry> = {};
  for (const k of Object.keys(tools).sort()) sorted[k] = tools[k];
  return { version: 1, tools: sorted };
}

if (require.main === module) {
  const outPath = path.resolve(__dirname, '../../mcp-tool-schemas.json');
  fs.writeFileSync(outPath, JSON.stringify(buildToolSchemas(), null, 2) + '\n');
  console.log(`Wrote ${outPath} (${Object.keys(buildToolSchemas().tools).length} tools)`);
}
```

Add to `demo_mcp_gateway/package.json` scripts:

```json
"gen:tool-schemas": "ts-node --transpile-only scripts/genToolSchemas.ts"
```

- [ ] **Step 2: Write the drift test**

```typescript
// demo_mcp_gateway/tests/toolSchemaDrift.test.ts
'use strict';
import * as fs from 'fs';
import * as path from 'path';
import { buildToolSchemas } from '../scripts/genToolSchemas';

describe('mcp-tool-schemas.json drift', () => {
  it('committed artifact matches a fresh regeneration (run: npm run gen:tool-schemas)', () => {
    const artifactPath = path.resolve(__dirname, '../../mcp-tool-schemas.json');
    const committed = JSON.parse(fs.readFileSync(artifactPath, 'utf-8'));
    expect(committed).toEqual(buildToolSchemas());
  });

  it('covers every tool the router knows about', () => {
    const { tools } = buildToolSchemas();
    for (const name of ['get_my_accounts', 'create_transfer', 'get_investment_balance',
                        'special_offers', 'user_profile_card', 'show_mortgage',
                        'demo_show_accounts', 'sequential_think']) {
      expect(tools[name]).toBeDefined();
    }
  });
});
```

- [ ] **Step 3: Run drift test to verify it fails** (artifact does not exist yet)

Run: `cd demo_mcp_gateway && npx jest tests/toolSchemaDrift.test.ts --forceExit`
Expected: FAIL — ENOENT on `mcp-tool-schemas.json`

- [ ] **Step 4: Generate the artifact, re-run test**

Run: `cd demo_mcp_gateway && npm run gen:tool-schemas && npx jest tests/toolSchemaDrift.test.ts --forceExit && npm run typecheck`
Expected: artifact written; both tests PASS; typecheck clean. If typecheck pulls `scripts/` or cross-package files into the build, add `"exclude": ["scripts", "../demo_mcp_server", "../demo_mcp_resource_server"]` entries to `demo_mcp_gateway/tsconfig.json` (the generator runs under `--transpile-only`, it does not need to compile in the main build).

- [ ] **Step 5: Commit**

```bash
git add demo_mcp_gateway/scripts/genToolSchemas.ts mcp-tool-schemas.json demo_mcp_gateway/package.json demo_mcp_gateway/tests/toolSchemaDrift.test.ts
git commit -m "feat(gateway): generated mcp-tool-schemas.json artifact + drift test"
```

(Include `demo_mcp_gateway/tsconfig.json` in the add list if it was modified.)

---

### Task 3: Node validation module (`mcpRequestValidation.ts`)

**Files:**
- Create: `demo_mcp_gateway/src/validation/mcpRequestValidation.ts`
- Modify: `demo_mcp_gateway/package.json` (add dependency `"ajv": "^8.17.0"`; run `npm install`)
- Test: `demo_mcp_gateway/tests/mcpRequestValidation.test.ts`

**Interfaces:**
- Consumes: `mcp-tool-schemas.json` (Task 2).
- Produces (Tasks 4, 5 import these):

```typescript
export const ALLOWED_METHODS: ReadonlySet<string>; // initialize, notifications/initialized, tools/list, tools/call
export interface ValidationFailure { code: number; message: string; data?: Record<string, unknown>; }
/** null = valid. Checks method allow-list + tools/call params shape. */
export function validateMethodAndShape(method: unknown, params: unknown): ValidationFailure | null;
/** null = valid. Ajv per-tool argument validation; unknown tool fails closed. */
export function validateToolArgs(toolName: string, args: Record<string, unknown>): ValidationFailure | null;
```

- [ ] **Step 1: Write the failing tests**

```typescript
// demo_mcp_gateway/tests/mcpRequestValidation.test.ts
'use strict';
import { validateMethodAndShape, validateToolArgs, ALLOWED_METHODS } from '../src/validation/mcpRequestValidation';

describe('validateMethodAndShape', () => {
  it('allows the four MCP methods', () => {
    for (const m of ['initialize', 'notifications/initialized', 'tools/list']) {
      expect(validateMethodAndShape(m, undefined)).toBeNull();
    }
    expect(validateMethodAndShape('tools/call', { name: 'get_my_accounts', arguments: {} })).toBeNull();
  });
  it('rejects unknown methods with -32601', () => {
    const f = validateMethodAndShape('resources/list', undefined);
    expect(f).toMatchObject({ code: -32601 });
  });
  it('rejects tools/call without a non-empty string name', () => {
    expect(validateMethodAndShape('tools/call', {})).toMatchObject({ code: -32602 });
    expect(validateMethodAndShape('tools/call', { name: '' })).toMatchObject({ code: -32602 });
    expect(validateMethodAndShape('tools/call', { name: 42 })).toMatchObject({ code: -32602 });
  });
  it('rejects tools/call when arguments is not an object', () => {
    expect(validateMethodAndShape('tools/call', { name: 'x', arguments: 'nope' })).toMatchObject({ code: -32602 });
    expect(validateMethodAndShape('tools/call', { name: 'x', arguments: [1] })).toMatchObject({ code: -32602 });
  });
});

describe('validateToolArgs', () => {
  it('accepts valid args for a real tool', () => {
    expect(validateToolArgs('get_my_accounts', {})).toBeNull();
  });
  it('rejects schema-violating args with -32602 and validationErrors', () => {
    // special_offers schema is additionalProperties:false — any extra key violates it
    const f = validateToolArgs('special_offers', { bogus: true });
    expect(f).toMatchObject({ code: -32602 });
    expect(Array.isArray(f?.data?.validationErrors)).toBe(true);
  });
  it('fails closed on unknown tool names', () => {
    expect(validateToolArgs('not_a_real_tool', {})).toMatchObject({ code: -32602 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd demo_mcp_gateway && npx jest tests/mcpRequestValidation.test.ts --forceExit`
Expected: FAIL — module not found

- [ ] **Step 3: Install ajv and implement**

Run: `cd demo_mcp_gateway && npm install ajv@^8.17.0`

```typescript
// demo_mcp_gateway/src/validation/mcpRequestValidation.ts
'use strict';

/**
 * mcpRequestValidation — gateway-side MCP request validation (spec §2).
 * Shared by the WS handler (index.ts) and HTTP middleware
 * (authorizeMcpRequest.ts). Validators are compiled once at module load from
 * the repo-root mcp-tool-schemas.json artifact (drift-tested against the
 * backend tool definitions). Unknown tools fail closed.
 */

import Ajv, { ValidateFunction } from 'ajv';
import artifact from '../../../mcp-tool-schemas.json';

export const ALLOWED_METHODS: ReadonlySet<string> = new Set([
  'initialize',
  'notifications/initialized',
  'tools/list',
  'tools/call',
]);

export interface ValidationFailure {
  code: number;
  message: string;
  data?: Record<string, unknown>;
}

const ajv = new Ajv({ allErrors: true, strict: false });
const validators = new Map<string, ValidateFunction>();
for (const [name, entry] of Object.entries(
  (artifact as { tools: Record<string, { inputSchema: Record<string, unknown> }> }).tools,
)) {
  validators.set(name, ajv.compile(entry.inputSchema));
}

export function validateMethodAndShape(method: unknown, params: unknown): ValidationFailure | null {
  if (typeof method !== 'string' || !ALLOWED_METHODS.has(method)) {
    return { code: -32601, message: `Method not found: ${String(method)}` };
  }
  if (method !== 'tools/call') return null;
  const p = params as { name?: unknown; arguments?: unknown } | undefined;
  if (!p || typeof p.name !== 'string' || p.name.length === 0) {
    return { code: -32602, message: 'Invalid params: tools/call requires a non-empty string params.name' };
  }
  if (p.arguments !== undefined
      && (typeof p.arguments !== 'object' || p.arguments === null || Array.isArray(p.arguments))) {
    return { code: -32602, message: 'Invalid params: params.arguments must be an object' };
  }
  return null;
}

export function validateToolArgs(toolName: string, args: Record<string, unknown>): ValidationFailure | null {
  const validate = validators.get(toolName);
  if (!validate) {
    // Fail closed — the drift test guarantees the artifact covers every real tool.
    return { code: -32602, message: `Unknown tool: ${toolName}`, data: { unknownTool: true } };
  }
  if (validate(args)) return null;
  const validationErrors = (validate.errors || []).map((e) => ({
    path: e.instancePath || '/',
    message: e.message || 'invalid',
  }));
  return {
    code: -32602,
    message: `Invalid arguments for tool ${toolName}`,
    data: { validationErrors },
  };
}
```

Note: `tsconfig` already resolves JSON modules (`scopeTopology.ts` imports repo-root JSON the same way).

- [ ] **Step 4: Run tests to verify pass**

Run: `cd demo_mcp_gateway && npx jest tests/mcpRequestValidation.test.ts --forceExit && npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add demo_mcp_gateway/src/validation/mcpRequestValidation.ts demo_mcp_gateway/tests/mcpRequestValidation.test.ts demo_mcp_gateway/package.json demo_mcp_gateway/package-lock.json
git commit -m "feat(gateway): Ajv MCP request validation module from schema artifact"
```

---

### Task 4: Wire validation into the WS handler

**Files:**
- Modify: `demo_mcp_gateway/src/index.ts` (`handleMessage`)
- Test: manual WS check deferred to Task 12 (module behavior is unit-tested in Task 3; `handleMessage` is not exported)

**Interfaces:**
- Consumes: `validateMethodAndShape`, `validateToolArgs` (Task 3).

- [ ] **Step 1: Add the envelope/method gate**

In `handleMessage` (search: `send(jsonRpcError(null, -32700, 'Parse error'));`), immediately after `const { method, id } = msg;` add:

```typescript
  // Spec §2 — formal method allow-list + tools/call shape check (both transports).
  const shapeFailure = validateMethodAndShape(method, msg.params);
  if (shapeFailure) {
    send(jsonRpcError(id, shapeFailure.code, shapeFailure.message, shapeFailure.data));
    return;
  }
```

Add the import at the top of `index.ts`:

```typescript
import { validateMethodAndShape, validateToolArgs } from './validation/mcpRequestValidation';
```

- [ ] **Step 2: Add per-tool args validation in tools/call**

In the `tools/call` branch, AFTER the `_hitl_challenge_id` strip (search: `delete toolArgs._hitl_challenge_id;` and the `if (msgParams)` block that follows) and BEFORE the HITL receipt block (`let verification: ReceiptVerification | null = null;`), insert:

```typescript
    // Spec §2 — per-tool argument schema validation. Runs after the auth
    // pipeline (identity known, audit hook set) and before HITL/PingOne
    // Authorize so malformed calls never create challenges or burn a PDP call.
    const argsFailure = validateToolArgs(toolName, toolArgs);
    if (argsFailure) {
      send(jsonRpcError(id, argsFailure.code, argsFailure.message, argsFailure.data));
      return;
    }
```

Note: the WS handler's final `send(jsonRpcError(id, -32601, ...))` fallback for unknown methods is now unreachable (allow-list rejects earlier) — leave it as defense in depth.

- [ ] **Step 3: Typecheck + full gateway test suite**

Run: `cd demo_mcp_gateway && npm run typecheck && npx jest --forceExit`
Expected: clean typecheck; all existing tests still PASS (validation only rejects unknown methods/tools and schema violations, which no existing test exercises with valid flows)

- [ ] **Step 4: Commit**

```bash
git add demo_mcp_gateway/src/index.ts
git commit -m "feat(gateway): enforce MCP method allow-list + tool arg schemas on WS path"
```

---

### Task 5: Wire validation into the HTTP middleware

**Files:**
- Modify: `demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts`
- Test: `demo_mcp_gateway/tests/authorizeMcpRequest-validation.test.ts`

**Interfaces:**
- Consumes: `validateMethodAndShape`, `validateToolArgs` (Task 3); the deps-injection test pattern from `tests/authorizeMcpRequest-no-exchange.test.ts` (`buildAuthorizeMcpRequest(config, deps)` with stubbed `introspect`/`authorize`).

- [ ] **Step 1: Write the failing test**

```typescript
// demo_mcp_gateway/tests/authorizeMcpRequest-validation.test.ts
'use strict';
import { buildAuthorizeMcpRequest } from '../src/middleware/authorizeMcpRequest';
import type { GatewayConfig } from '../src/config';

const stubConfig = {
  devBypass: false,
  gatewayResourceUri: 'https://gateway.ping.demo',
  pingoneBaseUrl: 'https://auth.pingone.com/test/as',
  pingoneEnvironmentId: 'test-env',
  introspectionEndpoint: '',
  authorizeApplicationId: '',
  authorizeEnvironmentId: '',
} as unknown as GatewayConfig;

const deps = {
  introspect: async () => ({ active: true, sub: 'u1', exp: 9999999999 }),
  authorize: async () => ({ decision: 'PERMIT' as const }),
};

function makeRes() {
  const chunks: string[] = [];
  return {
    res: {
      writeHead: jest.fn(),
      end: jest.fn((s?: string) => { if (s) chunks.push(s); }),
      setHeader: jest.fn(),
    } as any,
    body: () => JSON.parse(chunks.join('') || '{}'),
  };
}

async function run(rpc: object) {
  const middleware = buildAuthorizeMcpRequest(stubConfig, deps);
  const forwarded: string[] = [];
  const { res, body } = makeRes();
  await middleware('tok', Buffer.from(JSON.stringify(rpc)), {} as any, res, async (t) => { forwarded.push(t); });
  return { forwarded, res, body };
}

describe('authorizeMcpRequest — request validation', () => {
  it('rejects unknown methods with -32601 and does not forward', async () => {
    const { forwarded, body } = await run({ jsonrpc: '2.0', id: 1, method: 'resources/list' });
    expect(forwarded).toHaveLength(0);
    expect(body().error.code).toBe(-32601);
  });
  it('rejects schema-violating tool args with -32602 and does not forward', async () => {
    const { forwarded, body } = await run({
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'special_offers', arguments: { bogus: true } },
    });
    expect(forwarded).toHaveLength(0);
    expect(body().error.code).toBe(-32602);
  });
  it('rejects unknown tools with -32602 (fail closed)', async () => {
    const { forwarded, body } = await run({
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'not_a_tool', arguments: {} },
    });
    expect(forwarded).toHaveLength(0);
    expect(body().error.code).toBe(-32602);
  });
  it('forwards valid tools/call untouched by validation', async () => {
    const { forwarded } = await run({
      jsonrpc: '2.0', id: 4, method: 'tools/call',
      params: { name: 'get_my_accounts', arguments: {} },
    });
    expect(forwarded).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_mcp_gateway && npx jest tests/authorizeMcpRequest-validation.test.ts --forceExit`
Expected: FAIL — unknown-method / bad-args requests are currently forwarded (or 200-dispatched), not rejected

- [ ] **Step 3: Implement in the middleware**

In `authorizeMcpRequest.ts`, import the module:

```typescript
import { validateMethodAndShape, validateToolArgs } from '../validation/mcpRequestValidation';
```

Locate where the parsed body's `method` and `toolName` are first derived from `parseJsonRpcBody` (search: `parseJsonRpcBody(body)`; the middleware assigns `method` and `params.name` shortly after the dev-bypass block). Immediately after those are available (before rate-limit/introspection/authorize), insert a helper + gate. Add near the top of the factory body:

```typescript
    const sendRpcError = (status: number, id: unknown, f: { code: number; message: string; data?: Record<string, unknown> }) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code: f.code, message: f.message, data: f.data } }));
    };
```

Then at the derivation point:

```typescript
    // Spec §2 — method allow-list + shape + per-tool schema validation, before
    // any introspection/PDP cost. HTTP transport returns 400 with a JSON-RPC body.
    const shapeFailure = validateMethodAndShape(parsedBody.method, parsedBody.params);
    if (shapeFailure) { sendRpcError(400, parsedBody.id, shapeFailure); return; }
    if (parsedBody.method === 'tools/call') {
      const rawArgs = { ...(parsedBody.params?.arguments || {}) };
      delete (rawArgs as Record<string, unknown>)._hitl_challenge_id;
      const argsFailure = validateToolArgs(parsedBody.params!.name!, rawArgs as Record<string, unknown>);
      if (argsFailure) { sendRpcError(400, parsedBody.id, argsFailure); return; }
    }
```

Use the actual local variable name for the parsed body in that file (it may be `parsedBody` or similar — match the existing code).

- [ ] **Step 4: Run new test + full suite**

Run: `cd demo_mcp_gateway && npx jest tests/authorizeMcpRequest-validation.test.ts --forceExit && npx jest --forceExit && npm run typecheck`
Expected: all PASS. If an existing middleware test calls a now-disallowed method or a tool absent from the artifact, fix THAT test's fixture to use a real tool name (e.g. `get_my_accounts`) — do not weaken validation.

- [ ] **Step 5: Commit**

```bash
git add demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts demo_mcp_gateway/tests/authorizeMcpRequest-validation.test.ts
git commit -m "feat(gateway): enforce MCP validation on HTTP path before introspection"
```

---

### Task 6: IG gateway validation filter (Groovy) + route wiring + mount

**Files:**
- Create: `ping-gateway/scripts/groovy/mcp-request-validation.groovy`
- Modify: `ping-gateway/config/routes/01-mcp-olb.json` (filters array, after `McpProtocol`, before `P1AZDecision`)
- Modify: `ping-gateway/config/routes/02-mcp-resource-server.json` (same position)
- Modify: `docker-compose.yml` (ping-gateway service: bind-mount `./mcp-tool-schemas.json:/var/gateway/config/mcp-tool-schemas.json:ro`) and `ping-gateway/docker-compose.yml` (same mount, path `../mcp-tool-schemas.json`)
- Test: manual curl (IG has no unit-test harness; verification commands below and in Task 12)

**Interfaces:**
- Consumes: `mcp-tool-schemas.json` (Task 2), mounted at `/var/gateway/config/mcp-tool-schemas.json`.

- [ ] **Step 1: Write the Groovy validator**

```groovy
// ping-gateway/scripts/groovy/mcp-request-validation.groovy
//
// Spec §3 — MCP request validation for the IG gateway. Mirrors the Node
// gateway's mcpRequestValidation.ts: method allow-list, tools/call shape,
// and a documented SUBSET of JSON Schema against the mounted artifact:
//   type:"object", required[], properties.<k>.type (string|number|integer|
//   boolean|object|array), additionalProperties:false.
// Failures return HTTP 400 with a JSON-RPC -32602/-32601 body.

import groovy.json.JsonSlurper
import groovy.json.JsonOutput
import org.forgerock.http.protocol.Response
import org.forgerock.http.protocol.Status
import static org.forgerock.util.promise.Promises.newResultPromise

def SCHEMAS_PATH = '/var/gateway/config/mcp-tool-schemas.json'
def ALLOWED_METHODS = ['initialize', 'notifications/initialized', 'tools/list', 'tools/call'] as Set

def rpcError = { Object id, int code, String message, Object data ->
    def resp = new Response(Status.BAD_REQUEST)
    def err = [code: code, message: message]
    if (data != null) err.data = data
    resp.entity = JsonOutput.toJson([jsonrpc: '2.0', id: id, error: err])
    resp.headers['Content-Type'] = 'application/json'
    return newResultPromise(resp)
}

def typeOk = { Object v, String t ->
    switch (t) {
        case 'string':  return v instanceof String
        case 'number':  return v instanceof Number
        case 'integer': return v instanceof Integer || v instanceof Long || v instanceof java.math.BigInteger
        case 'boolean': return v instanceof Boolean
        case 'object':  return v instanceof Map
        case 'array':   return v instanceof List
        default:        return true // unknown type keyword — do not enforce
    }
}

def body
try {
    body = new JsonSlurper().parseText(request.entity.string ?: '')
} catch (Exception e) {
    return rpcError(null, -32700, 'Parse error', null)
}
if (!(body instanceof Map)) return rpcError(null, -32700, 'Parse error', null)

def method = body.method
def id = body.containsKey('id') ? body.id : null
if (!(method instanceof String) || !ALLOWED_METHODS.contains(method)) {
    return rpcError(id, -32601, "Method not found: ${method}", null)
}

if (method == 'tools/call') {
    def params = body.params
    if (!(params instanceof Map) || !(params.name instanceof String) || ((String) params.name).isEmpty()) {
        return rpcError(id, -32602, 'Invalid params: tools/call requires a non-empty string params.name', null)
    }
    def args = params.arguments != null ? params.arguments : [:]
    if (!(args instanceof Map)) {
        return rpcError(id, -32602, 'Invalid params: params.arguments must be an object', null)
    }
    args = new LinkedHashMap(args)
    args.remove('_hitl_challenge_id') // gateway-internal HITL retry marker

    def artifact = new JsonSlurper().parse(new File(SCHEMAS_PATH))
    def entry = artifact.tools[params.name]
    if (entry == null) {
        return rpcError(id, -32602, "Unknown tool: ${params.name}", [unknownTool: true])
    }
    def schema = entry.inputSchema
    def errors = []
    (schema.required ?: []).each { req ->
        if (!args.containsKey(req)) errors << [path: "/${req}", message: 'required property missing']
    }
    def props = schema.properties ?: [:]
    args.each { k, v ->
        def prop = props[k]
        if (prop == null) {
            if (schema.additionalProperties == false) errors << [path: "/${k}", message: 'additional property not allowed']
        } else if (prop.type instanceof String && !typeOk(v, (String) prop.type)) {
            errors << [path: "/${k}", message: "expected type ${prop.type}"]
        }
    }
    if (!errors.isEmpty()) {
        return rpcError(id, -32602, "Invalid arguments for tool ${params.name}", [validationErrors: errors])
    }
}

return next.handle(context, request)
```

- [ ] **Step 2: Wire into both routes**

In `ping-gateway/config/routes/01-mcp-olb.json`, insert between the `McpProtocol` and `P1AZDecision` filter objects:

```json
        {
          "name": "McpRequestValidation",
          "type": "ScriptableFilter",
          "config": {
            "type": "application/x-groovy",
            "file": "mcp-request-validation.groovy"
          }
        },
```

Make the identical insertion in `ping-gateway/config/routes/02-mcp-resource-server.json` (between its `McpProtocol` and `P1AZDecision` entries).

- [ ] **Step 3: Add the artifact mount**

In the root `docker-compose.yml` ping-gateway service `volumes:` list add:

```yaml
      - ./mcp-tool-schemas.json:/var/gateway/config/mcp-tool-schemas.json:ro
```

In `ping-gateway/docker-compose.yml` (standalone) add the same with `../mcp-tool-schemas.json` as the source.

- [ ] **Step 4: Verify against a running IG container**

Note: the running stack serves the MAIN checkout, not this worktree (see memory `project-docker-serves-main-checkout.md`) — full stack verification happens after merge; here verify the standalone container from the worktree:

```bash
cd ping-gateway && COMPOSE_PROJECT_NAME=gw-validate docker compose up -d
# unknown method → 400/-32601 (auth may reject first with 401 if introspection
# is unreachable standalone — a 401 here means the filter ordering is intact;
# the validation behaviors are re-verified in-stack in Task 12)
curl -sk -X POST http://localhost:3036/mcp -H 'Authorization: Bearer x' -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"resources/list"}' | head -c 300
cd ping-gateway && COMPOSE_PROJECT_NAME=gw-validate docker compose down
```

Expected: JSON-RPC error body with code -32601 (or 401 from the upstream auth filter if standalone introspection is unavailable — record which)

- [ ] **Step 5: Commit**

```bash
git add ping-gateway/scripts/groovy/mcp-request-validation.groovy ping-gateway/config/routes/01-mcp-olb.json ping-gateway/config/routes/02-mcp-resource-server.json docker-compose.yml ping-gateway/docker-compose.yml
git commit -m "feat(ping-gateway): MCP request validation filter from schema artifact"
```

---

### Task 7: Fix `McpTokenExchangeClient` — RFC 8707 `resource` + explicit `scope` + per-backend API

The historical `invalid_scope` failure: PingOne ignores `audience=` and requires the RFC 8707 `resource` parameter to narrow to one resource server when the client has grants on several, plus an explicit `scope` limited to that resource (see `agentMcpTokenService.js` ~line 2130 comment — the proven pattern).

**Files:**
- Modify: `demo_mcp_gateway/src/auth/McpTokenExchangeClient.ts`
- Modify: `demo_mcp_gateway/src/auth/scopeTopology.ts` (add `resourceScopesForBackend`)
- Test: `demo_mcp_gateway/tests/mcpTokenExchangeClient.test.ts`

**Interfaces:**
- Consumes: `routeTool`, `backendResourceUri` (existing, `src/router.ts`); `scope-topology.json` `resources` section.
- Produces (Tasks 9, 10 consume):

```typescript
export interface ExchangeResult { token: string; targetAud: string; cached: boolean; }
class McpTokenExchangeClient {
  /** Exchange for the backend that owns toolName (undefined → olb). */
  exchange(subjectToken: string, toolName?: string): Promise<ExchangeResult>;
  /** Exchange for an explicit backend — used by tools/list proxying. */
  exchangeForBackend(subjectToken: string, backend: 'olb' | 'invest'): Promise<ExchangeResult>;
}
```

- [ ] **Step 1: Add the scope accessor to `scopeTopology.ts`**

Append to `demo_mcp_gateway/src/auth/scopeTopology.ts`:

```typescript
interface ResourceEntry { uri: string; scopes?: string[]; mirroredScopes?: string[]; }
interface ManifestWithResources { resources: Record<string, ResourceEntry>; }

const BACKEND_RESOURCE_NAME: Record<'olb' | 'invest', string> = {
  olb: 'Super Banking MCP Server',
  invest: 'Super Banking MCP Invest',
};

/** All scopes (native + mirrored) registered on a backend's resource server. */
export function resourceScopesForBackend(backend: 'olb' | 'invest'): string[] {
  const r = (manifest as unknown as ManifestWithResources).resources[BACKEND_RESOURCE_NAME[backend]];
  return r ? [...(r.scopes || []), ...(r.mirroredScopes || [])] : [];
}
```

(`Super Banking MCP Invest` is added to the manifest in Task 8 — until then the function returns `[]` for invest, which the tests below cover via olb.)

- [ ] **Step 2: Write the failing tests**

```typescript
// demo_mcp_gateway/tests/mcpTokenExchangeClient.test.ts
'use strict';
import axios from 'axios';
import { McpTokenExchangeClient } from '../src/auth/McpTokenExchangeClient';
import type { GatewayConfig } from '../src/config';

jest.mock('axios');
const mockedPost = axios.post as jest.Mock;

const config = {
  tokenEndpoint: 'https://auth.example/as/token',
  tokenEndpointAuthMethod: 'post',
  clientId: 'gw-client',
  clientSecret: 'gw-secret',
  mcpOlbResourceUri: 'mcpserver.ping.demo',
  mcpResourceServerResourceUri: 'mcp-resource-server.ping.demo',
} as unknown as GatewayConfig;

// Subject token with scopes: read + invest:read + something foreign
const subjectToken = [
  Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'),
  Buffer.from(JSON.stringify({ sub: 'u1', scope: 'read invest:read mcp:invoke' })).toString('base64url'),
  '',
].join('.');

beforeEach(() => {
  mockedPost.mockReset();
  McpTokenExchangeClient.clearCache();
  mockedPost.mockResolvedValue({ data: { access_token: 'exchanged-tok', expires_in: 300 } });
});

describe('McpTokenExchangeClient', () => {
  it('sends RFC 8707 resource= (not audience=) and explicit scope filtered to the target resource', async () => {
    const client = new McpTokenExchangeClient(config);
    const result = await client.exchange(subjectToken, 'get_my_accounts');
    expect(result).toMatchObject({ token: 'exchanged-tok', targetAud: 'mcpserver.ping.demo', cached: false });
    const sentBody = String(mockedPost.mock.calls[0][1]);
    const params = new URLSearchParams(sentBody);
    expect(params.get('resource')).toBe('mcpserver.ping.demo');
    expect(params.get('audience')).toBeNull();
    const scopes = (params.get('scope') || '').split(' ');
    // Invariant: requested scope ⊆ (subject scopes ∩ target-resource scopes).
    // Per scope-topology.json, mcpserver.ping.demo carries mcp:invoke natively
    // and mirrors read + invest:read — all three subject scopes survive here.
    expect(scopes.sort()).toEqual(['invest:read', 'mcp:invoke', 'read']);
  });

  it('exchangeForBackend targets the requested backend audience', async () => {
    const client = new McpTokenExchangeClient(config);
    const result = await client.exchangeForBackend(subjectToken, 'olb');
    expect(result.targetAud).toBe('mcpserver.ping.demo');
  });

  it('returns cached=true on the second identical exchange', async () => {
    const client = new McpTokenExchangeClient(config);
    await client.exchange(subjectToken, 'get_my_accounts');
    const second = await client.exchange(subjectToken, 'get_my_accounts');
    expect(second.cached).toBe(true);
    expect(mockedPost).toHaveBeenCalledTimes(1);
  });

  it('propagates exchange failure (callers fail closed)', async () => {
    mockedPost.mockRejectedValue(new Error('invalid_scope'));
    const client = new McpTokenExchangeClient(config);
    await expect(client.exchange(subjectToken, 'get_my_accounts')).rejects.toThrow();
  });
});
```

Adjust the `invest:read` assertion after checking the real artifact: `Super Banking MCP Server`.mirroredScopes DOES include `invest:read`, so the correct expectation is `scopes).toContain('invest:read')`. Verify against `scope-topology.json` and assert accordingly — the invariant under test is "requested scope ⊆ (subject scopes ∩ target-resource scopes)".

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd demo_mcp_gateway && npx jest tests/mcpTokenExchangeClient.test.ts --forceExit`
Expected: FAIL — `cached` missing, `exchangeForBackend` missing, body sends `audience=` with no `scope`

- [ ] **Step 4: Implement**

Rewrite the class body of `McpTokenExchangeClient.ts` (keep the cache helpers/file header; update the header comment to describe resource+scope):

```typescript
import * as jwt from 'jsonwebtoken';
import { resourceScopesForBackend } from './scopeTopology';

export interface ExchangeResult {
  token: string;
  targetAud: string;
  cached: boolean;
}

export class McpTokenExchangeClient {
  constructor(private readonly config: GatewayConfig) {}

  async exchange(subjectToken: string, toolName?: string): Promise<ExchangeResult> {
    const target = toolName ? routeTool(toolName) : 'olb';
    const backend: 'olb' | 'invest' = target === 'invest' ? 'invest' : 'olb';
    return this.exchangeForBackend(subjectToken, backend);
  }

  async exchangeForBackend(subjectToken: string, backend: 'olb' | 'invest'): Promise<ExchangeResult> {
    const targetAud = backendResourceUri(backend, this.config);

    const key = cacheKey(subjectToken, targetAud);
    const cached = _cache.get(key);
    if (cached && cached.expiresAt > Date.now() + 5000) {
      return { token: cached.token, targetAud, cached: true };
    }

    // RFC 8707: PingOne requires `resource=` to narrow to ONE resource server
    // when the client has grants on several — `audience=` alone is silently
    // ignored ("May not request scopes for multiple resources"). The scope
    // must be explicit and single-resource: subject scopes ∩ target resource
    // scopes (native + mirroredScopes). Same pattern as the BFF's Exchange #1
    // (agentMcpTokenService.js).
    const decoded = jwt.decode(subjectToken) as { scope?: string } | null;
    const subjectScopes = (decoded?.scope || '').split(' ').filter(Boolean);
    const allowed = new Set(resourceScopesForBackend(backend));
    const requestScopes = subjectScopes.filter((s) => allowed.has(s));

    const params = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: subjectToken,
      subject_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      resource: targetAud,
    });
    if (requestScopes.length > 0) params.set('scope', requestScopes.join(' '));

    let exchangeHeaders: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    if (this.config.tokenEndpointAuthMethod === 'post') {
      params.set('client_id', this.config.clientId);
      params.set('client_secret', this.config.clientSecret);
    } else {
      const credentials = Buffer.from(
        `${this.config.clientId}:${this.config.clientSecret}`,
      ).toString('base64');
      exchangeHeaders['Authorization'] = `Basic ${credentials}`;
    }

    const response = await axios.post(this.config.tokenEndpoint, params.toString(), {
      headers: exchangeHeaders,
      timeout: 10000,
    });

    const { access_token, expires_in } = response.data as { access_token?: string; expires_in?: number };
    if (!access_token) {
      throw new Error('Token exchange response missing access_token');
    }

    _cacheInsertWithEviction(key, {
      token: access_token,
      expiresAt: Date.now() + (expires_in ?? 300) * 1000,
    });

    return { token: access_token, targetAud, cached: false };
  }

  static clearCache(): void {
    _cache.clear();
  }
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `cd demo_mcp_gateway && npx jest tests/mcpTokenExchangeClient.test.ts --forceExit && npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add demo_mcp_gateway/src/auth/McpTokenExchangeClient.ts demo_mcp_gateway/src/auth/scopeTopology.ts demo_mcp_gateway/tests/mcpTokenExchangeClient.test.ts
git commit -m "fix(gateway): RFC 8707 resource+scope token exchange, per-backend API"
```

---

### Task 8: PingOne provisioning — invest resource in topology + reconciler exchange #3 healing + LIVE GATE

**Files:**
- Modify: `scope-topology.json` (add `Super Banking MCP Invest` resource)
- Modify: `demo_api_server/services/twoExchangeReconciler.js` (add exchange #3 pre-conditions)
- Create: `demo_mcp_gateway/scripts/verifyExchange.ts` (live verification spike)
- Test: live run of the spike (this is the gate)

**Interfaces:**
- Consumes: reconciler helpers `_reconcileResourceScopes`, `PingOneClient`, `_getWorkerToken` (existing in the file); `scopeTopology.resourceScopes(name)` from `demo_api_server/services/scopeTopology.js`.
- Produces: live PingOne state where the MCP Gateway app (`PINGONE_MCP_GATEWAY_CLIENT_ID`) can exchange to `mcpserver.ping.demo` and `mcp-resource-server.ping.demo` with scopes surviving.

- [ ] **Step 1: Add the invest resource to `scope-topology.json`**

In the `resources` object, after `"Super Banking MCP Server"`, add:

```json
    "Super Banking MCP Invest": {
      "uri": "mcp-resource-server.ping.demo",
      "scopes": ["mcp:invoke"],
      "mirroredScopes": ["invest:read", "read"]
    },
```

Also add `"Super Banking MCP Invest": "Demo MCP Invest"` to `provisioning.resourceNames`.

- [ ] **Step 2: Extend the reconciler**

In `twoExchangeReconciler.js`, following the existing pattern for pre-conditions 1-4 (find the main `reconcile()`/run function that calls `_reconcileResourceScopes` and the grant-healing helper), add exchange #3 pre-conditions:

```javascript
  //   Exchange #3 pre-conditions (Gateway token → backend MCP-server tokens):
  //     5. MCP Server resource has all mirroredScopes defined on it (usually
  //        already true — provisioned since Phase 243)
  //     6. MCP Invest resource EXISTS (create if missing), with scopes +
  //        mirroredScopes from the topology
  //     7. MCP Gateway app is granted all scopes on BOTH backend resources
```

Implementation notes for the subagent (follow the file's existing helpers — read them first):

- Resource lookup by name uses the provisioned display name (`resourceNames` mapping / `scopeTopology`) the same way pre-conditions 1-4 find `Super Banking Agent Gateway` / `Super Banking MCP Gateway`. Reuse that lookup.
- Creating a missing resource: `await client.post('/resources', { name: '<display name>', audience: 'mcp-resource-server.ping.demo', approvalRequired: false })` then `_reconcileResourceScopes(client, resource.id, 'Super Banking MCP Invest', 'MCP Invest')`.
- Granting the gateway app: reuse the existing grant-healing helper that pre-condition 2/4 uses (AI Agent → Agent Gateway, MCP Exchanger → MCP Gateway), with the app resolved from `PINGONE_MCP_GATEWAY_CLIENT_ID` (configStore) and the two backend resources.
- Log with the existing `TAG` (`[TwoExchangeReconciler]`) `OK` / `Healed [...]` convention so the memory-documented troubleshooting flow still works.

- [ ] **Step 3: Write the live verification spike**

```typescript
// demo_mcp_gateway/scripts/verifyExchange.ts
'use strict';

/**
 * Live RFC 8693 verification gate (spec §4). Exchanges a real gateway-audience
 * subject token for both backend audiences against the live PingOne env and
 * asserts scopes survive.
 *
 * Usage:
 *   SUBJECT_TOKEN=<gateway-aud access token> npx ts-node --transpile-only scripts/verifyExchange.ts
 *
 * Get a SUBJECT_TOKEN from the running demo: trigger any banking chip and copy
 * the "TX token" (aud=mcpgateway.ping.demo) from the Token Chain inspector, or
 * from BFF logs. Requires demo_mcp_gateway/.env for client creds + token endpoint.
 */

import 'dotenv/config';
import * as jwt from 'jsonwebtoken';
import { loadConfig } from '../src/config';
import { McpTokenExchangeClient } from '../src/auth/McpTokenExchangeClient';

async function main() {
  const subjectToken = process.env.SUBJECT_TOKEN;
  if (!subjectToken) { console.error('Set SUBJECT_TOKEN'); process.exit(2); }
  const config = loadConfig();
  const client = new McpTokenExchangeClient(config);
  let failed = false;
  for (const backend of ['olb', 'invest'] as const) {
    try {
      const r = await client.exchangeForBackend(subjectToken, backend);
      const claims = jwt.decode(r.token) as Record<string, unknown>;
      console.log(`[${backend}] OK aud=${JSON.stringify(claims.aud)} scope="${claims.scope}"`);
      if (!String(claims.scope || '').trim()) { console.error(`[${backend}] FAIL: no scopes survived`); failed = true; }
    } catch (err) {
      const detail = (err as { response?: { data?: unknown } }).response?.data;
      console.error(`[${backend}] FAIL:`, err instanceof Error ? err.message : err, detail ?? '');
      failed = true;
    }
  }
  process.exit(failed ? 1 : 0);
}
main();
```

If `src/config.ts` exports a differently-named loader (check: `grep -n "export function" demo_mcp_gateway/src/config.ts`), use that name.

- [ ] **Step 4: Run the reconciler + gate against the live env**

The reconciler runs at BFF startup in the main-checkout stack; from the worktree, run the healing + verification directly:

```bash
# 1. Copy the topology change to where the running BFF reads it? NO — instead run
#    the reconciler in-place from the worktree against the live env:
cd demo_api_server && node -e "require('./services/twoExchangeReconciler').run?.() || require('./services/twoExchangeReconciler')" 2>&1 | head -40
#    (invoke the module's exported entry — check `module.exports` at the bottom
#     of twoExchangeReconciler.js and call the actual export)
# 2. Obtain SUBJECT_TOKEN (see spike header), then:
cd ../demo_mcp_gateway && SUBJECT_TOKEN=<token> npx ts-node --transpile-only scripts/verifyExchange.ts
```

Expected: `[olb] OK ... scope="read ..."` and `[invest] OK ... scope="invest:read ..."`.

**HARD GATE:** If either backend FAILS after reconciler healing, STOP the plan here, capture the exact PingOne error body, and report back — Tasks 9-12 must not proceed on a broken exchange.

- [ ] **Step 5: Commit**

```bash
git add scope-topology.json demo_api_server/services/twoExchangeReconciler.js demo_mcp_gateway/scripts/verifyExchange.ts
git commit -m "feat(provisioning): MCP Invest resource + exchange #3 reconciler healing + live gate script"
```

---

### Task 9: Wire exchange into the WS path (fail closed) + honest Token Chain events

**Files:**
- Modify: `demo_mcp_gateway/src/index.ts` (olb/invest proxy branch ~line 960; `proxyToolsList` ~line 1051)
- Test: covered by Task 7 unit tests + Task 12 integration (handleMessage not exportable); full suite must stay green

**Interfaces:**
- Consumes: `McpTokenExchangeClient.exchange/exchangeForBackend` (Task 7). A module-level `const mcpExchangeClient = new McpTokenExchangeClient(config);` already-instantiated equivalent may not exist — create one near the top of `index.ts` after `config` is loaded.

- [ ] **Step 1: Replace the passthrough in the olb/invest branch**

Replace (at `// ----- Existing olb/invest path — WebSocket proxy -----`):

```typescript
    // Gateway forwards the original TX token unchanged — no RFC 8693 re-exchange.
    const backendToken: string = token;
```

with:

```typescript
    // Spec §4 (closes WR-02): RFC 8693 exchange to the backend audience.
    // Fail closed — the inbound gateway-audience token is never forwarded.
    let backendToken: string;
    let exchangeCached = false;
    let exchangeTargetAud = '';
    try {
      const ex = await mcpExchangeClient.exchange(token, toolName);
      backendToken = ex.token;
      exchangeCached = ex.cached;
      exchangeTargetAud = ex.targetAud;
    } catch (err) {
      console.error(`[GW] Token exchange failed for ${toolName}:`, err instanceof Error ? err.message : err);
      send(jsonRpcError(id, -32500, 'Token exchange failed', { error: 'token_exchange_failed' }));
      return;
    }
```

- [ ] **Step 2: Replace the passthrough Token Chain events**

Replace the `gwExchangeEvent` literal (`id: 'gw-passthrough'` block) with:

```typescript
    const gwExchangeEvent = {
      id: 'gw-exchange',
      label: `Gateway RFC 8693 exchange: TX token (aud=${config.gatewayResourceUri}) → backend token (aud=${exchangeTargetAud})${exchangeCached ? ' [cache hit]' : ''}.`,
      tokenType: 'access_token',
      credentialPath: 'oauth_bearer',
      status: 'ok',
      specRef: 'RFC 8693 §2.1 + RFC 8707 resource parameter',
    };
```

And in the `_meta` merge, replace `tokenExchangeCached: null,` with `tokenExchangeCached: exchangeCached,`.

- [ ] **Step 3: Exchange in `proxyToolsList`**

`proxyToolsList(target, inboundToken)` currently passes `inboundToken` to `proxyJsonRpc`. Change its body to exchange first:

```typescript
async function proxyToolsList(target: 'olb' | 'invest', inboundToken: string): Promise<JsonRpcResponse> {
  const wsUrl = backendWsUrl(target, config);
  const tlsOpts: MtlsOptions | undefined = gatewayCerts
    ? { cert: gatewayCerts.clientCert, key: gatewayCerts.clientKey }
    : undefined;
  // Spec §4: tools/list also crosses the trust boundary with a backend-audience token.
  const { token: backendToken } = await mcpExchangeClient.exchangeForBackend(inboundToken, target);
  return proxyJsonRpc(wsUrl, backendToken, {
    jsonrpc: '2.0',
    id: `gw-list-${target}`,
    method: 'tools/list',
    // ...rest unchanged
```

(A rejection propagates into the existing `Promise.allSettled` → the backend is reported in `_meta.failedBackends` — fail-closed with graceful partial-results UX already built.)

Add near the top of `index.ts` (after `config` is initialized): `const mcpExchangeClient = new McpTokenExchangeClient(config);` — the import already exists for `clearCache()`.

- [ ] **Step 4: Typecheck + full suite**

Run: `cd demo_mcp_gateway && npm run typecheck && npx jest --forceExit`
Expected: PASS (note: `gateway-passthrough.test.ts` concerns `MCP_GW_PASSTHROUGH_TO_MCP_SERVER` dev mode, not this path — if it asserts the forwarded token on the olb/invest branch, update it to mock the exchange client and assert the EXCHANGED token is forwarded)

- [ ] **Step 5: Commit**

```bash
git add demo_mcp_gateway/src/index.ts
git commit -m "feat(gateway): RFC 8693 exchange on WS proxy path, fail closed (WR-02)"
```

---

### Task 10: Wire exchange into the HTTP path; replace the no-exchange pinning test

**Files:**
- Modify: `demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts` (Step 4 forward block, ~line 658)
- Delete: `demo_mcp_gateway/tests/authorizeMcpRequest-no-exchange.test.ts`
- Create: `demo_mcp_gateway/tests/authorizeMcpRequest-exchange.test.ts`

**Interfaces:**
- Consumes: `McpTokenExchangeClient` (Task 7). Add an optional `exchange` member to `AuthorizeMcpRequestDeps` so tests inject a stub: `exchange?: (subjectToken: string, toolName?: string) => Promise<{ token: string; targetAud: string; cached: boolean }>`.

- [ ] **Step 1: Write the failing test**

```typescript
// demo_mcp_gateway/tests/authorizeMcpRequest-exchange.test.ts
'use strict';
import { buildAuthorizeMcpRequest } from '../src/middleware/authorizeMcpRequest';
import type { GatewayConfig } from '../src/config';

const stubConfig = {
  devBypass: false,
  gatewayResourceUri: 'https://gateway.ping.demo',
  pingoneBaseUrl: 'https://auth.pingone.com/test/as',
  pingoneEnvironmentId: 'test-env',
  introspectionEndpoint: '',
  authorizeApplicationId: '',
  authorizeEnvironmentId: '',
} as unknown as GatewayConfig;

const body = Buffer.from(JSON.stringify({
  jsonrpc: '2.0', id: 1, method: 'tools/call',
  params: { name: 'get_my_accounts', arguments: {} },
}));

describe('authorizeMcpRequest — RFC 8693 exchange before forward', () => {
  it('forwards the EXCHANGED token, not the inbound bearer', async () => {
    const forwarded: string[] = [];
    const middleware = buildAuthorizeMcpRequest(stubConfig, {
      introspect: async () => ({ active: true, sub: 'u1', exp: 9999999999 }),
      authorize: async () => ({ decision: 'PERMIT' as const }),
      exchange: async () => ({ token: 'exchanged-tok', targetAud: 'mcpserver.ping.demo', cached: false }),
    });
    const fakeRes = { writeHead: jest.fn(), end: jest.fn(), setHeader: jest.fn() } as any;
    await middleware('original-tx-token', body, {} as any, fakeRes, async (t) => { forwarded.push(t); });
    expect(forwarded).toEqual(['exchanged-tok']);
  });

  it('fails closed with 502 + token_exchange_failed when exchange throws', async () => {
    const forwarded: string[] = [];
    const chunks: string[] = [];
    const middleware = buildAuthorizeMcpRequest(stubConfig, {
      introspect: async () => ({ active: true, sub: 'u1', exp: 9999999999 }),
      authorize: async () => ({ decision: 'PERMIT' as const }),
      exchange: async () => { throw new Error('invalid_scope'); },
    });
    const fakeRes = {
      writeHead: jest.fn(),
      end: jest.fn((s?: string) => { if (s) chunks.push(s); }),
      setHeader: jest.fn(),
    } as any;
    await middleware('original-tx-token', body, {} as any, fakeRes, async (t) => { forwarded.push(t); });
    expect(forwarded).toHaveLength(0);
    expect(fakeRes.writeHead).toHaveBeenCalledWith(502, expect.anything());
    const rpc = JSON.parse(chunks.join(''));
    expect(rpc.error.code).toBe(-32500);
    expect(rpc.error.data.error).toBe('token_exchange_failed');
  });
});
```

- [ ] **Step 2: Run to verify failure, delete the pinning test**

Run: `cd demo_mcp_gateway && npx jest tests/authorizeMcpRequest-exchange.test.ts --forceExit`
Expected: FAIL (deps has no `exchange`; original token forwarded)

```bash
git rm demo_mcp_gateway/tests/authorizeMcpRequest-no-exchange.test.ts
```

- [ ] **Step 3: Implement**

In `authorizeMcpRequest.ts`:

1. Extend the deps interface:

```typescript
export interface AuthorizeMcpRequestDeps {
  introspect: (token: string) => Promise<{ active: boolean; sub?: string; exp?: number }>;
  authorize: (...): Promise<...>; // unchanged
  exchange?: (subjectToken: string, toolName?: string) => Promise<{ token: string; targetAud: string; cached: boolean }>;
}
```

2. In the factory, instantiate the real client: `const exchangeClient = new McpTokenExchangeClient(config);` and `const doExchange = deps?.exchange ?? ((t: string, n?: string) => exchangeClient.exchange(t, n));` (import `McpTokenExchangeClient` from `../auth/McpTokenExchangeClient`).

3. Replace the Step-4 forward block:

```typescript
    // ── Step 4: RFC 8693 exchange, then forward (spec §4) ──────────────────────────
    // The HTTP upstream is the OLB server (GatewayServer.upstreamMcpUrl), so the
    // exchange targets the olb audience via routeTool. Fail closed: on exchange
    // failure nothing is forwarded.
    auditTrail.mtls = config.mtlsEnabled
      ? { enabled: true, subject: 'banking-mcp-gateway' }
      : { enabled: false };
    setAuditHeader(res);
    teachLog.info('gateway audit trail', { gw_audit_trail: auditTrail });
    let upstreamToken: string;
    try {
      const ex = await doExchange(bearerToken, toolName);
      upstreamToken = ex.token;
    } catch (err) {
      teachLog.error('[GW] HTTP token exchange failed', err instanceof Error ? err : undefined, { tool: toolName });
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        id: parsedBody.id ?? null,
        error: { code: -32500, message: 'Token exchange failed', data: { error: 'token_exchange_failed' } },
      }));
      return;
    }
    await forward(upstreamToken, outBody);
```

Also update the file-header comment (lines ~12-20) — it currently documents "TX token forwarded unchanged"; rewrite those lines to describe the exchange. Keep `initialize`/`notifications/initialized`/`tools/list` behavior identical: `doExchange(bearerToken, toolName)` with `toolName === undefined` targets olb, which matches the single OLB HTTP upstream.

- [ ] **Step 4: Run new test + full suite + typecheck**

Run: `cd demo_mcp_gateway && npx jest --forceExit && npm run typecheck`
Expected: all PASS (any other test that asserted passthrough forwarding gets the same fix: inject the stub `exchange` dep and assert the exchanged token)

- [ ] **Step 5: Commit**

```bash
git add demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts demo_mcp_gateway/tests/authorizeMcpRequest-exchange.test.ts
git commit -m "feat(gateway): RFC 8693 exchange on HTTP path, fail closed; drop no-exchange pin"
```

---

### Task 11: Backends accept an audience list; compose rollout config

**Files:**
- Modify: `demo_mcp_server/src/auth/TokenIntrospector.ts` (~lines 155-173)
- Modify: `demo_mcp_resource_server/src/server/tokenValidator.ts` (`decodeAndValidate`, ~lines 79-85)
- Modify: `docker-compose.yml` (mcp-server + mcp-resource-server env)
- Test: `demo_mcp_resource_server/tests/tokenValidator-audience.test.ts` (create; check `demo_mcp_resource_server/package.json` for its jest setup first — if none exists, put the test in `demo_mcp_server`'s existing suite for the introspector and cover invest via Task 12 integration) and `demo_mcp_server/src/tools/__tests__/` conventions for the introspector test

**Interfaces:**
- Consumes: nothing new. Produces: both backends treat their audience env var as a comma-separated list.

- [ ] **Step 1: Write failing tests**

For `demo_mcp_server` (place the file following the existing test layout — check `ls demo_mcp_server/src/**/__tests__ demo_mcp_server/tests 2>/dev/null` and match; the test targets the exported audience-check behavior. If `TokenIntrospector`'s aud check is not separately exported, extract it as an exported pure function first — that refactor is part of this task):

```typescript
// audience list check — pure function extracted from TokenIntrospector
import { audienceAccepted } from '../auth/TokenIntrospector';

describe('audienceAccepted', () => {
  it('accepts any audience in the comma-separated env list', () => {
    expect(audienceAccepted(['mcpserver.ping.demo'], 'mcpserver.ping.demo,mcpgateway.ping.demo')).toBe(true);
    expect(audienceAccepted('mcpgateway.ping.demo', 'mcpserver.ping.demo,mcpgateway.ping.demo')).toBe(true);
  });
  it('rejects audiences not in the list', () => {
    expect(audienceAccepted(['other.ping.demo'], 'mcpserver.ping.demo,mcpgateway.ping.demo')).toBe(false);
  });
  it('handles whitespace around commas', () => {
    expect(audienceAccepted(['a'], ' a , b ')).toBe(true);
  });
});
```

- [ ] **Step 2: Implement in both validators**

`demo_mcp_server/src/auth/TokenIntrospector.ts` — add the exported helper and use it:

```typescript
/** MCP_SERVER_RESOURCE_URI may be a comma-separated list of accepted audiences
 *  (rollout: own backend URI + gateway URI while both token shapes are live). */
export function audienceAccepted(tokenAud: string | string[], resourceUriEnv: string): boolean {
  const accepted = resourceUriEnv.split(',').map((s) => s.trim()).filter(Boolean);
  const audList = Array.isArray(tokenAud) ? tokenAud : [String(tokenAud)];
  return audList.some((a) => accepted.includes(a));
}
```

In the existing check replace `if (!audList.includes(resourceUri))` with `if (!audienceAccepted(tokenInfo.aud, resourceUri))` (keep the missing-aud fail-closed branch as-is; keep log lines, updating `expected` to the list).

`demo_mcp_resource_server/src/server/tokenValidator.ts` — in `decodeAndValidate`, replace:

```typescript
  const audList = Array.isArray(decoded.aud) ? decoded.aud : [decoded.aud];
  if (!audList.includes(expectedAud)) {
```

with:

```typescript
  const accepted = expectedAud.split(',').map((s) => s.trim()).filter(Boolean);
  const audList = Array.isArray(decoded.aud) ? decoded.aud : [decoded.aud];
  if (!audList.some((a) => accepted.includes(a))) {
```

(and include the list in the error message).

- [ ] **Step 3: Compose env**

`docker-compose.yml`:
- mcp-server service: change `MCP_SERVER_RESOURCE_URI: "mcpgateway.ping.demo"` to `MCP_SERVER_RESOURCE_URI: "mcpserver.ping.demo,mcpgateway.ping.demo"` and UPDATE the adjacent comment (it currently documents the passthrough workaround — rewrite it to: gateway now exchanges via RFC 8707 resource param; gateway audience kept as transitional second entry).
- mcp-resource-server service: add to `environment:`: `MCP_SERVER_RESOURCE_URI: "mcp-resource-server.ping.demo,mcpgateway.ping.demo"` (compose env wins over the service's `.env` file).

Also check the startup config guard mentioned in `pingoneProvisionService.js generateEnvContent` (memory: it hard-fails when `MCP_SERVER_RESOURCE_URI` ≠ gateway aud — `grep -rn "MCP_SERVER_RESOURCE_URI" demo_api_server/services/configStore.js demo_mcp_server/src` and relax any equality assert to list-containment).

- [ ] **Step 4: Run backend test suites**

Run: `cd demo_mcp_server && npx jest --forceExit` (and the invest suite if one exists: `cd demo_mcp_resource_server && npx jest --forceExit 2>/dev/null || echo "no invest tests"`)
Expected: PASS including the new audience tests

- [ ] **Step 5: Commit**

```bash
git add demo_mcp_server/src/auth/TokenIntrospector.ts demo_mcp_resource_server/src/server/tokenValidator.ts docker-compose.yml
git commit -m "feat(backends): accept comma-separated audience list for exchange rollout"
```

(add the new test files and any config-guard change to the same commit)

---

### Task 12: Integration verification + regression

**Files:**
- No code changes expected; fixes discovered here go in scoped follow-up commits.

This task validates the full stack. **The running Docker stack serves the MAIN checkout, not this worktree** (memory: `project-docker-serves-main-checkout.md`). Integration therefore happens by merging the worktree branch to the main checkout's running state per that memory's landing procedure (UI=Vite HMR, BFF=node --watch; the gateway + backends + IG need container rebuild/restart: `COMPOSE_PROJECT_NAME=ai-demo docker compose up -d --build mcp-gateway mcp-server mcp-resource-server ping-gateway`). Coordinate with the user before touching the running stack if a demo may be live.

- [ ] **Step 1: Unit/typecheck sweep across touched packages**

```bash
cd demo_mcp_gateway && npm run typecheck && npx jest --forceExit
cd ../demo_mcp_server && npx jest --forceExit
```

Expected: all green.

- [ ] **Step 2: Node gateway validation behaviors (running stack)**

Via the demo UI agent or `wscat`/curl against the gateway (port 3005):

- `tools/call` with a bogus argument on a no-arg tool → `-32602` + `validationErrors`.
- `tools/call` with unknown tool name → `-32602`.
- Unknown method → `-32601`.
- A normal banking chip (e.g. get_my_accounts) → succeeds end-to-end.

- [ ] **Step 3: Exchange behaviors (running stack)**

- Token Chain UI for a banking chip shows the `gw-exchange` event with `aud=mcpserver.ping.demo` (not `gw-passthrough`).
- Invest chip works and shows `aud=mcp-resource-server.ping.demo`.
- BFF startup log shows `[TwoExchangeReconciler]` OK/Healed lines including the new exchange #3 checks.
- Negative: temporarily set an invalid `PINGONE_MCP_GATEWAY_CLIENT_ID` override on the gateway container env → chip fails with `token_exchange_failed`, backend receives nothing; revert.

- [ ] **Step 4: IG gateway (flag on)**

Enable `ff_mcp_gateway_pinggateway`, then repeat one valid call + one bad-args call through port 3036: valid succeeds; bad-args → HTTP 400 with `-32602` body. Flag back off afterwards.

- [ ] **Step 5: Regression scenarios**

Exercise: HITL approval flow (transfer above threshold → challenge → approve → retry), scope-denial greying (Scenario 4), tools/list vertical filter. All must behave as before.

- [ ] **Step 6: Record results + commit any fixes**

Write results to `test-results/<timestamp>-gateway-validation-exchange.md` (repo convention). Each discovered fix = its own scoped commit.

---

## Self-Review Notes (completed)

- Spec §1 artifact → Task 2; §2 Node validation → Tasks 1, 3, 4, 5; §3 IG → Task 6; §4 exchange → Tasks 7-11 (provisioning 8, WS 9, HTTP 10, backends 11); testing/success → per-task TDD + Task 12. No uncovered spec sections.
- The spec's "live verification gate before wiring" is honored: Task 8 (gate) precedes Tasks 9-11; Tasks 9-10 are mock-tested and would be safe to build first, but keep the order — the gate's failure mode changes what 9-11 should ship.
- Type consistency: `ExchangeResult { token, targetAud, cached }` (Task 7) matches usages in Tasks 9, 10; `ValidationFailure { code, message, data }` (Task 3) matches Tasks 4, 5, 6 (Groovy mirrors the shape in JSON).
