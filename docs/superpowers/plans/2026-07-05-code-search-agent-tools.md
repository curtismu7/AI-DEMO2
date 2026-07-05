# Code Search Agent Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the indexed codebase to agents as three scoped MCP tools (`code_search`, `get_code`, `list_codebases`) on `demo_mcp_server`, routed through the RFC 8693 gateway with a new `code:search` scope.

**Architecture:** No new services. The three tools register on `demo_mcp_server` (all agent frameworks inherit them); their handlers call the existing `demo-mcp-code-search` HTTP service (`:8095`), which already talks to Weaviate + embeddings. Authorization reuses the banking pipeline: the gateway enforces `code:search` via the manifest-derived tool→scope map, and the startup reconciler provisions the scope + grants from `scope-topology.json`.

**Tech Stack:** TypeScript (service + MCP server, `tsc` + `jest`), Node/Express, Weaviate GraphQL client, `scope-topology.json` SSOT, PingOne provisioning scripts.

## Global Constraints

- **SSOT:** `scope-topology.json` is the single source of truth. Never hand-edit derived maps (`demo_mcp_gateway/src/auth/toolScopes.ts`, `verify-scope-configuration.js` `EXPECTED_SCOPES`) — edit the manifest.
- **Tool names must match** between `BankingToolRegistry` and the manifest `tools` map, or `npm run topology:verify` fails (drift).
- **`resourceScopes(resource) = resource.scopes ∪ resource.mirroredScopes`** — to provision a scope on a chain resource, add it to that resource's `scopes` or `mirroredScopes`.
- **Emoji allowlist** (repo §0): only `⚠️ ✅ ❌ 🔐 ✕ ✓` in code/UI/docs.
- **Minimal diff** — name the component, change only that.
- **Worktree discipline** — stage explicit files (`git add <files>`), never `git add -A`.
- Default codebase id is `ai-demo2`.
- The `demo-mcp-code-search` service is a **built image** — rebuild + restart after service edits (`docker compose build demo-mcp-code-search && docker compose up -d demo-mcp-code-search`). BFF/UI hot-reload; the MCP server is also a built image (rebuild after its edits).

---

## File Structure

- `demo_mcp_code_search/src/weaviateStore.ts` — add `getCode()` to `Store` + impl.
- `demo_mcp_code_search/src/server.ts` — add `POST /code` route.
- `demo_mcp_code_search/src/weaviateStore.test.ts`, `server.test.ts` — tests.
- `demo_mcp_server/src/tools/handlers/codeSearchHandlers.ts` — **new**: 3 handlers.
- `demo_mcp_server/src/tools/handlers/index.ts` — register handlers in `handlerMap`.
- `demo_mcp_server/src/tools/BankingToolRegistry.ts` — add 3 tool defs.
- `demo_mcp_server/src/tools/__tests__/` — handler + registry tests.
- `docker-compose.yml` — `MCP_CODE_SEARCH_URL` on the MCP server service.
- `scope-topology.json` — scope, mirroredScopes, tools, app grant.
- `demo_api_server/scripts/generate-scope-doc.js` output — regenerate.

---

## Task 1: Service — `getCode` line-range reconstruction

**Files:**
- Modify: `demo_mcp_code_search/src/weaviateStore.ts` (`Store` interface + `createStore` return)
- Test: `demo_mcp_code_search/src/weaviateStore.test.ts`

**Interfaces:**
- Produces: `interface CodeRange { file: string; line_start: number; line_end: number; code: string }` and `Store.getCode(opts: { codebaseId: string; file: string; lineStart: number; lineEnd: number }): Promise<CodeRange | null>` (null when no chunk covers the file).

- [ ] **Step 1: Write the failing test** (append to `weaviateStore.test.ts` — it already unit-tests `mapHits`; add a stitch test that does not need a live client by testing a pure helper). Add an exported pure helper `stitchRange` to plan for testability:

```ts
// in weaviateStore.test.ts
import { stitchRange } from './weaviateStore';

describe('stitchRange', () => {
  const chunks = [
    { line_start: 1, line_end: 3, snippet: 'a\nb\nc' },
    { line_start: 3, line_end: 5, snippet: 'c\nd\ne' }, // overlaps line 3
  ];
  test('reconstructs a range across overlapping chunks', () => {
    expect(stitchRange(chunks, 2, 4)).toBe('b\nc\nd');
  });
  test('clamps to available lines', () => {
    expect(stitchRange(chunks, 4, 99)).toBe('d\ne');
  });
  test('returns null when no chunk data', () => {
    expect(stitchRange([], 1, 5)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_mcp_code_search && npx jest weaviateStore -t stitchRange`
Expected: FAIL — `stitchRange is not a function`.

- [ ] **Step 3: Implement `stitchRange` + `getCode`** in `weaviateStore.ts`.

Add the exported pure helper (near `mapHits`):

```ts
export interface CodeRange {
  file: string;
  line_start: number;
  line_end: number;
  code: string;
}

interface RawChunk { line_start: number; line_end: number; snippet: string }

/** Rebuild lines [from..to] from overlapping 40-line chunks. Null if empty. */
export function stitchRange(chunks: RawChunk[], from: number, to: number): string | null {
  if (!chunks.length) return null;
  const byLine = new Map<number, string>();
  for (const c of chunks) {
    const lines = c.snippet.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const ln = c.line_start + i;
      if (ln <= c.line_end && !byLine.has(ln)) byLine.set(ln, lines[i]);
    }
  }
  const present = [...byLine.keys()];
  if (!present.length) return null;
  const lo = Math.max(from, Math.min(...present));
  const hi = Math.min(to, Math.max(...present));
  const out: string[] = [];
  for (let ln = lo; ln <= hi; ln++) if (byLine.has(ln)) out.push(byLine.get(ln)!);
  return out.length ? out.join('\n') : null;
}
```

Add to the `Store` interface (after `listCodebases`):

```ts
  getCode(opts: { codebaseId: string; file: string; lineStart: number; lineEnd: number }): Promise<CodeRange | null>;
```

Add to the `createStore` return object (after `listCodebases`):

```ts
    async getCode(opts): Promise<CodeRange | null> {
      const res = await client.graphql
        .get()
        .withClassName(CLASS_NAME)
        .withFields('line_start line_end snippet')
        .withWhere({
          operator: 'And',
          operands: [
            { path: ['codebase_id'], operator: 'Equal', valueText: opts.codebaseId },
            { path: ['file'], operator: 'Equal', valueText: opts.file },
          ],
        })
        .withLimit(500)
        .do();
      const chunks = (res?.data?.Get?.[CLASS_NAME] ?? []) as RawChunk[];
      const code = stitchRange(chunks, opts.lineStart, opts.lineEnd);
      if (code === null) return null;
      return { file: opts.file, line_start: opts.lineStart, line_end: opts.lineEnd, code };
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_mcp_code_search && npx jest weaviateStore`
Expected: PASS (all suites, including the 3 new `stitchRange` cases).

- [ ] **Step 5: Commit**

```bash
git add demo_mcp_code_search/src/weaviateStore.ts demo_mcp_code_search/src/weaviateStore.test.ts
git commit -m "feat(code-search): getCode line-range reconstruction from indexed chunks"
```

---

## Task 2: Service — `POST /code` route

**Files:**
- Modify: `demo_mcp_code_search/src/server.ts`
- Test: `demo_mcp_code_search/src/server.test.ts`

**Interfaces:**
- Consumes: `Store.getCode` (Task 1).
- Produces: `POST /code` — request `{ codebase_id, file, line_start, line_end }`; `200 { file, line_start, line_end, code }`, `404 { error: 'not_found' }`, `400` on missing args, `503` on connectivity.

- [ ] **Step 1: Write the failing test** (add to `server.test.ts`; extend `fakeStore` first).

In `fakeStore`, add after `listCodebases`:

```ts
    async getCode(opts: any) {
      if (opts.file === 'missing.ts') return null;
      return { file: opts.file, line_start: opts.lineStart, line_end: opts.lineEnd, code: 'line2\nline3' };
    },
```

Add a new describe block:

```ts
describe('POST /code', () => {
  test('returns reconstructed code', async () => {
    const app = createServer({ embedder: fakeEmbedder(), store: fakeStore() });
    const res = await request(app).post('/code')
      .send({ codebase_id: 'cb1', file: 'a.ts', line_start: 2, line_end: 3 }).expect(200);
    expect(res.body).toEqual({ file: 'a.ts', line_start: 2, line_end: 3, code: 'line2\nline3' });
  });
  test('404 when file has no chunks', async () => {
    const app = createServer({ embedder: fakeEmbedder(), store: fakeStore() });
    await request(app).post('/code')
      .send({ codebase_id: 'cb1', file: 'missing.ts', line_start: 1, line_end: 5 }).expect(404);
  });
  test('400 when args missing', async () => {
    const app = createServer({ embedder: fakeEmbedder(), store: fakeStore() });
    await request(app).post('/code').send({ codebase_id: 'cb1' }).expect(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_mcp_code_search && npx jest server -t "POST /code"`
Expected: FAIL — 404 route (`Cannot POST /code`).

- [ ] **Step 3: Implement the route** in `server.ts` (after the `/search` handler, before `return app`):

```ts
  app.post('/code', async (req: Request, res: Response) => {
    const { codebase_id, file, line_start, line_end } = req.body as {
      codebase_id?: string; file?: string; line_start?: number; line_end?: number;
    };
    if (!codebase_id || !file || typeof line_start !== 'number' || typeof line_end !== 'number') {
      return res.status(400).json({ error: 'missing_args', message: 'codebase_id, file, line_start, line_end are required' });
    }
    try {
      const range = await deps.store.getCode({ codebaseId: codebase_id, file, lineStart: line_start, lineEnd: line_end });
      if (!range) return res.status(404).json({ error: 'not_found', message: `No indexed content for ${file}` });
      return res.status(200).json(range);
    } catch (err) {
      return failure(res, err, 'get_code_failed');
    }
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_mcp_code_search && npx jest server && npm run build`
Expected: PASS; `tsc` exits 0.

- [ ] **Step 5: Commit + rebuild the service image**

```bash
git add demo_mcp_code_search/src/server.ts demo_mcp_code_search/src/server.test.ts
git commit -m "feat(code-search): POST /code endpoint for line-range fetch"
```

Note (execution-time, not committed): after landing to the main checkout, `docker compose build demo-mcp-code-search && docker compose up -d demo-mcp-code-search`, then verify `curl -s localhost:8095/code -H 'content-type: application/json' -d '{"codebase_id":"ai-demo2","file":"demo_mcp_code_search/src/weaviateStore.ts","line_start":90,"line_end":95}'` returns code.

---

## Task 3: MCP server — code-search tool handlers

**Files:**
- Create: `demo_mcp_server/src/tools/handlers/codeSearchHandlers.ts`
- Modify: `demo_mcp_server/src/tools/handlers/index.ts`
- Test: `demo_mcp_server/src/tools/handlers/__tests__/codeSearchHandlers.test.ts`

**Interfaces:**
- Consumes: `HandlerFn = (deps: HandlerDeps, token: string, params: any) => Promise<BankingToolResult>`; `HandlerDeps = { apiClient, logger }`; `BankingToolResult = { type: 'text'; text: string; success?: boolean; error?: string; structuredContent?: Record<string, any> }`. Handlers call the service via global `fetch` + `process.env.MCP_CODE_SEARCH_URL` (default `http://demo-mcp-code-search:8095`).
- Produces: `executeCodeSearch`, `executeGetCode`, `executeListCodebases` (all `HandlerFn`).

- [ ] **Step 1: Write the failing test** (`__tests__/codeSearchHandlers.test.ts`). Mock `fetch`:

```ts
import { executeCodeSearch, executeGetCode, executeListCodebases } from '../codeSearchHandlers';

const deps: any = { apiClient: {}, logger: { debug() {}, info() {}, warn() {}, error() {} } };
const okFetch = (body: any) => jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });

describe('code-search handlers', () => {
  afterEach(() => { (global as any).fetch = undefined; });

  test('code_search returns ranked results as text + structuredContent', async () => {
    (global as any).fetch = okFetch({ results: [{ file: 'a.ts', line_start: 1, line_end: 5, relevance: 0.9, snippet: 'x' }] });
    const r = await executeCodeSearch(deps, 'tok', { query: 'find x', limit: 5 });
    expect(r.type).toBe('text');
    expect(r.structuredContent!.results).toHaveLength(1);
    expect(r.text).toContain('a.ts');
  });

  test('get_code returns the code range', async () => {
    (global as any).fetch = okFetch({ file: 'a.ts', line_start: 1, line_end: 3, code: 'l1\nl2\nl3' });
    const r = await executeGetCode(deps, 'tok', { file: 'a.ts', line_start: 1, line_end: 3 });
    expect(r.text).toContain('l2');
  });

  test('list_codebases lists indexed codebases', async () => {
    (global as any).fetch = okFetch({ codebases: [{ id: 'ai-demo2', name: 'AI-DEMO2', chunks: 100 }] });
    const r = await executeListCodebases(deps, 'tok', {});
    expect(r.text).toContain('AI-DEMO2');
  });

  test('service 503 surfaces as an error result', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: false, status: 503, text: async () => '{"error":"service_unavailable"}' });
    const r = await executeCodeSearch(deps, 'tok', { query: 'x' });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/unavailable/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_mcp_server && npx jest codeSearchHandlers`
Expected: FAIL — cannot find module `../codeSearchHandlers`.

- [ ] **Step 3: Implement `codeSearchHandlers.ts`:**

```ts
import type { HandlerFn } from './types';

const BASE = () => process.env.MCP_CODE_SEARCH_URL || 'http://demo-mcp-code-search:8095';
const CODEBASE_ID = 'ai-demo2';

async function call(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${BASE()}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const text = await res.text();
  if (res.status === 503) throw new Error('code-search service unavailable');
  if (!res.ok) throw new Error(`code-search ${res.status}: ${text.slice(0, 160)}`);
  return text ? JSON.parse(text) : {};
}

function errorResult(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return { type: 'text' as const, text: `Code search error: ${msg}`, success: false, error: msg };
}

export const executeCodeSearch: HandlerFn = async (_deps, _token, params) => {
  try {
    const data = await call('/search', { query: params.query, codebase_id: CODEBASE_ID, limit: params.limit || 10 });
    const results = data.results || [];
    const text = results.length
      ? results.map((r: any) => `${r.file}:${r.line_start}-${r.line_end} (${Math.round((r.relevance || 0) * 100)}%)\n${r.snippet}`).join('\n\n---\n\n')
      : 'No matches found.';
    return { type: 'text', text, success: true, structuredContent: { results } };
  } catch (err) { return errorResult(err); }
};

export const executeGetCode: HandlerFn = async (_deps, _token, params) => {
  try {
    const data = await call('/code', {
      codebase_id: CODEBASE_ID, file: params.file, line_start: params.line_start, line_end: params.line_end,
    });
    return { type: 'text', text: data.code ?? '', success: true, structuredContent: data };
  } catch (err) { return errorResult(err); }
};

export const executeListCodebases: HandlerFn = async (_deps, _token, _params) => {
  try {
    const res = await fetch(`${BASE()}/codebases`);
    if (!res.ok) throw new Error(`code-search ${res.status}`);
    const data = await res.json();
    const list = data.codebases || [];
    const text = list.map((c: any) => `${c.name} (${c.id}) — ${c.chunks} chunks`).join('\n') || 'No codebases indexed.';
    return { type: 'text', text, success: true, structuredContent: { codebases: list } };
  } catch (err) { return errorResult(err); }
};
```

- [ ] **Step 4: Register in `handlers/index.ts`** — add the import and spread into `handlerMap`:

```ts
import { executeCodeSearch, executeGetCode, executeListCodebases } from './codeSearchHandlers';
```
and inside the `handlerMap` object literal add:
```ts
  executeCodeSearch,
  executeGetCode,
  executeListCodebases,
```

- [ ] **Step 5: Run tests + typecheck**

Run: `cd demo_mcp_server && npx jest codeSearchHandlers && npm run build`
Expected: PASS; `tsc` exits 0.

- [ ] **Step 6: Commit**

```bash
git add demo_mcp_server/src/tools/handlers/codeSearchHandlers.ts demo_mcp_server/src/tools/handlers/index.ts demo_mcp_server/src/tools/handlers/__tests__/codeSearchHandlers.test.ts
git commit -m "feat(mcp): code-search tool handlers (search/get_code/list_codebases)"
```

---

## Task 4: MCP server — register the three tool definitions

**Files:**
- Modify: `demo_mcp_server/src/tools/BankingToolRegistry.ts`
- Test: `demo_mcp_server/src/tools/__tests__/codeSearchTools.test.ts`

**Interfaces:**
- Consumes: `BankingToolDefinition = { name, description, inputSchema, requiresUserAuth, requiredScopes, handler, readOnly, ... }`; `handler` is the `handlerMap` key from Task 3.
- Produces: `BankingToolRegistry.getAllTools()` includes `code_search`, `get_code`, `list_codebases` with `requiredScopes: ['code:search']`.

- [ ] **Step 1: Write the failing test** (`__tests__/codeSearchTools.test.ts`):

```ts
import { BankingToolRegistry } from '../BankingToolRegistry';

describe('code-search tool registration', () => {
  const names = BankingToolRegistry.getAllTools().map(t => t.name);
  test.each(['code_search', 'get_code', 'list_codebases'])('%s is registered', (n) => {
    expect(names).toContain(n);
  });
  test('all require code:search and are read-only', () => {
    for (const n of ['code_search', 'get_code', 'list_codebases']) {
      const t = BankingToolRegistry.getToolByName(n)!;
      expect(t.requiredScopes).toEqual(['code:search']);
      expect(t.readOnly).toBe(true);
      expect(t.requiresUserAuth).toBe(false);
    }
  });
});
```

(If `getToolByName` is not the exact accessor, use the one at `BankingToolRegistry.ts:973` confirmed during implementation.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_mcp_server && npx jest codeSearchTools`
Expected: FAIL — names do not contain `code_search`.

- [ ] **Step 3: Add the three defs** to the `TOOLS` record in `BankingToolRegistry.ts` (alongside the other `name:` entries):

```ts
    code_search: {
      name: 'code_search',
      title: 'Code Search',
      description: 'Semantic search over the indexed source code. Returns ranked snippets with file path and line range. Use when asked where something is implemented or how the code works.',
      inputSchema: { type: 'object', properties: {
        query: { type: 'string', description: 'Natural-language description of the code to find' },
        limit: { type: 'number', description: 'Max results (1-25, default 10)' },
      }, required: ['query'] },
      requiresUserAuth: false,
      requiredScopes: ['code:search'],
      handler: 'executeCodeSearch',
      readOnly: true,
    },
    get_code: {
      name: 'get_code',
      title: 'Get Code',
      description: 'Fetch the source lines for a file and line range (e.g. from a code_search hit).',
      inputSchema: { type: 'object', properties: {
        file: { type: 'string', description: 'Repo-relative file path' },
        line_start: { type: 'number' },
        line_end: { type: 'number' },
      }, required: ['file', 'line_start', 'line_end'] },
      requiresUserAuth: false,
      requiredScopes: ['code:search'],
      handler: 'executeGetCode',
      readOnly: true,
    },
    list_codebases: {
      name: 'list_codebases',
      title: 'List Codebases',
      description: 'List the codebases indexed in the code-search vector store.',
      inputSchema: { type: 'object', properties: {} },
      requiresUserAuth: false,
      requiredScopes: ['code:search'],
      handler: 'executeListCodebases',
      readOnly: true,
    },
```

- [ ] **Step 4: Run tests + typecheck**

Run: `cd demo_mcp_server && npx jest codeSearchTools && npm run build && npx jest`
Expected: PASS; full suite green (confirms no existing tool test broke).

- [ ] **Step 5: Commit**

```bash
git add demo_mcp_server/src/tools/BankingToolRegistry.ts demo_mcp_server/src/tools/__tests__/codeSearchTools.test.ts
git commit -m "feat(mcp): register code_search/get_code/list_codebases tools (code:search)"
```

---

## Task 5: Compose — MCP server service URL env

**Files:**
- Modify: `docker-compose.yml` (the `demo-mcp-server` service `environment:`)

**Interfaces:** none (config only).

- [ ] **Step 1: Add the env** to the `demo-mcp-server` service `environment:` block (mirror the BFF's `MCP_CODE_SEARCH_URL` comment):

```yaml
      # RAG code-search service — the code_search/get_code/list_codebases tool
      # handlers call this over compose DNS.
      MCP_CODE_SEARCH_URL: "http://demo-mcp-code-search:8095"
```

- [ ] **Step 2: Validate compose YAML**

Run: `python3 -c "import yaml; s=yaml.safe_load(open('docker-compose.yml'))['services']; print(s['demo-mcp-server']['environment'].get('MCP_CODE_SEARCH_URL'))"`
Expected: prints `http://demo-mcp-code-search:8095`.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "chore(mcp): MCP_CODE_SEARCH_URL for code-search tool handlers"
```

---

## Task 6: SSOT — `scope-topology.json` scope + tools + grants

**Files:**
- Modify: `scope-topology.json`

**Interfaces:** SSOT consumed by the gateway (`toolScopes`), reconciler, bootstrap, and verify gate.

- [ ] **Step 1: Add the scope** to the top-level `scopes` map:

```json
    "code:search": { "description": "Search and read the indexed source code (read-only)", "riskLevel": "low", "resource": "Super Banking MCP Server", "category": "infra" },
```

- [ ] **Step 2: Add it to the chain resources.** In `resources`:
  - `"Super Banking MCP Server"` → append `"code:search"` to its `scopes` array (home resource).
  - `"Super Banking MCP Gateway"` → append `"code:search"` to `mirroredScopes`.
  - `"Super Banking Agent Gateway"` → append `"code:search"` to `mirroredScopes`.

- [ ] **Step 3: Add the three tools** to the `tools` map:

```json
    "code_search": { "requiredScopes": ["code:search"], "surface": "gateway" },
    "get_code": { "requiredScopes": ["code:search"], "surface": "gateway" },
    "list_codebases": { "requiredScopes": ["code:search"], "surface": "gateway" },
```

- [ ] **Step 4: Grant to the user app.** In `apps` → `"Super Banking User App"` → append `"code:search"` to `grantedScopes`.

- [ ] **Step 5: Validate JSON + run the topology gate**

Run: `python3 -c "import json; json.load(open('scope-topology.json')); print('json ok')"`
Then: `npm run topology:verify`
Expected: `json ok`; topology verify exits 0 (running gateway tools now match the manifest, because Task 4 registered the same three names).

- [ ] **Step 6: Commit**

```bash
git add scope-topology.json
git commit -m "feat(topology): code:search scope + code-search tools + user grant"
```

---

## Task 7: Provisioning + hardening verification (live, reversible)

**Files:**
- Run: `demo_api_server/scripts/generate-scope-doc.js`, `verify-scope-configuration.js`
- No manifest edits (Task 6 covers them); this task provisions + verifies.

**Interfaces:** none new.

- [ ] **Step 1: Regenerate the scope doc**

Run: `cd demo_api_server && node scripts/generate-scope-doc.js`
Expected: the generated scope doc now lists `code:search`. Commit the regenerated file:
```bash
git add <regenerated scope doc path printed by the script>
git commit -m "docs(scope): regenerate scope doc with code:search"
```

- [ ] **Step 2: Provision via the startup reconciler.** Restart the BFF so `twoExchangeReconciler` runs against the live env (or run the reconciler entrypoint directly if exposed):

Run: `docker compose restart demo-api-server`
Then check logs: `docker logs --tail 40 ai-demo-api-server 2>&1 | grep -iE 'reconcile|code:search|scope'`
Expected: reconciler logs creating `code:search` on Agent Gateway / MCP Gateway / MCP Server and granting it to the AI Agent / Exchanger / Gateway apps (idempotent — safe to re-run).

- [ ] **Step 3: Grant `code:search` to the User App in PingOne.** The user-app grant comes from the manifest at bootstrap, not the reconciler. Apply it with the repo's grant path (prefer the hosted PingOne MCP tools; else the provisioning script). Verify the user login token then carries `code:search`.

- [ ] **Step 4: Run the live hardening gate**

Run: `npm run topology:verify:live`
Expected: exits 0 — `verify-scope-configuration --manifest-diff` reports live PingOne matches `scope-topology.json` (no missing `code:search` anywhere in the chain).

- [ ] **Step 5: Commit any config artifacts** produced (none expected beyond Step 1).

---

## Task 8: Live end-to-end verification through the token chain

**Files:** none (verification only).

- [ ] **Step 1: Rebuild + restart the two built images** with the landed code:

Run: `docker compose build demo-mcp-code-search demo-mcp-server && docker compose up -d demo-mcp-code-search demo-mcp-server`
Expected: both healthy.

- [ ] **Step 2: Confirm the tools list** (through the gateway path the agent uses):

Run: `curl -s localhost:8095/codebases` (sanity) and inspect the MCP tools list surface (MCP inspector UI or `tools/list`) for `code_search`, `get_code`, `list_codebases`.
Expected: all three present with `code:search` as required scope.

- [ ] **Step 3: Positive path — agent call.** With the scope granted, run an agent turn: "Search the codebase for where the Weaviate schema is created, then show me those lines."
Expected: `code_search` returns ranked hits (e.g. `weaviateStore.ts`), a follow-up `get_code` returns the lines; the hop appears in the token-chain inspector.

- [ ] **Step 4: Negative path — deny.** Temporarily revoke the `code:search` grant on the agent/user (PingOne), retry the agent turn.
Expected: clean `insufficient_scope` denial visible in the token chain; no crash. Restore the grant afterward.

- [ ] **Step 5: Final commit / PR.** Open the PR for the branch and merge after review (per repo flow).

```bash
gh pr create --base main --head feat/code-search-agent-tools --title "feat: code-search as scoped agent tools" --body "See docs/superpowers/specs/2026-07-04-code-search-agent-tools-design.md"
```

---

## Self-Review Notes

- **Spec coverage:** getCode/`POST /code` (Tasks 1-2) ✓; three tools + handlers (Tasks 3-4) ✓; `MCP_CODE_SEARCH_URL` (Task 5) ✓; SSOT scope+mirroredScopes+tools+grant (Task 6) ✓; reconciler/bootstrap/hardening verify (Task 7) ✓; live token-chain e2e both paths (Task 8) ✓; whole-app touch-points from the audit are all covered by Tasks 5-7.
- **Names:** handler keys `executeCodeSearch`/`executeGetCode`/`executeListCodebases` are identical in Task 3 (definition), `handlerMap` (Task 3 step 4), and the tool defs' `handler` field (Task 4). Tool names `code_search`/`get_code`/`list_codebases` are identical in Task 4 and the manifest `tools` (Task 6) — required for `topology:verify`.
- **YAGNI:** no full-file storage, no new resource server, no fine-grained PingAuthorize policy, no write/index tools.
