# Code Search v2 — Default Index + Folder Ingest + LlamaIndex Agent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/code-search` usable out of the box (this demo's own source pre-indexed), let users index any local folder via a browser folder picker, and add a true LlamaIndex tool-calling agent that answers questions over the Weaviate `CodeChunk` index with citations.

**Architecture:** Three independent slices over the existing code-search stack. **A** adds a read-only repo mount + a bounded, idempotent background indexer in the BFF that writes into the existing `CodeChunk` Weaviate class. **B** is a browser-side folder picker that filters + uploads through the existing multi-file `/index` route. **C** is a new standalone Python `llamaindex-agent` service that reads the same `CodeChunk` class natively via `WeaviateVectorStore` (pinned to the same `nomic-embed-text-v1.5` embedder), wrapped as a `FunctionAgent` tool, fronted by a thin BFF `/ask` proxy. Build order A → B → C (A and B independent; C needs an index).

**Tech Stack:** Node/Express (BFF), React (CRA/Jest), Docker Compose, Python 3.11 + FastAPI + LlamaIndex (`llama-index-vector-stores-weaviate`, `llama-index-llms-openai-like`, `llama-index-embeddings-openai-like`) + `weaviate-client` v4, llama.cpp `:8090` (LLM) and embeddings service (`nomic-embed-text-v1.5`).

## Global Constraints

- Work in the git worktree on branch `code-search-v2`. Stage files explicitly (`git add <files>`), never `git add -A`. Verify `git branch --show-current` before each commit.
- **Test runners differ per package — this is verified, not assumed:**
  - `demo_api_server` (BFF) uses **jest**. Backend test files MUST live under `demo_api_server/tests/` (jest `testMatch` is `**/tests/**/*.test.js` and `**/src/__tests__/**`; colocated `services/*.test.js` / `routes/*.test.js` are NOT picked up). From a test in `tests/`, import siblings as `../services/…`, `../routes/…`, `../src/services/…`.
  - **jest ignores `.claude/worktrees/`** (`testPathIgnorePatterns`), so inside this worktree jest finds 0 tests by default. Run backend tests as: `cd demo_api_server && npx jest tests/<file>.test.js --testPathIgnorePatterns=/node_modules/ --testPathIgnorePatterns=/tests/real/` (positional file FIRST, then the two `=`-form overrides — this drops only the worktree-ignore and runs exactly that file). `supertest` is available.
  - `demo_api_ui` (frontend) uses **vitest** (not jest): `cd demo_api_ui && CI=true npx vitest run <path>`; use `vi.*` not `jest.*` (`vi`/`test`/`expect` are globals). Colocated `*.test.js`/`*.test.jsx` are fine.
  - `llamaindex_agent` (new) uses **pytest**: `cd llamaindex_agent && python -m pytest <path> -q`.
- **Embedding-space match is a correctness gate.** Everything that queries Weaviate MUST embed with `nomic-embed-text-v1.5` (768-dim) against the class **`CodeChunk`** (props: `codebase_id`, `codebase_name`, `file`, `line_start`, `line_end`, `snippet`; `vectorizer: none`). A mismatched embedder returns plausible-but-wrong results — every retrieval task ends with a *known-query-returns-expected-file* test, not just "non-empty".
- **Bounded embedder load.** The default indexer (A) and the agent (C) must cap work: curated source roots, per-file + total-file caps, batched embeds, one-time idempotent index, and a max-tool-iteration cap. No sustained embedder traffic at idle.
- **Never index secrets or vendored/generated trees.** The A walker and B filter must exclude `.claude`, `node_modules`, `.git`, `dist`, `build`, `coverage`, `data`, `logs`, `.next`, `.env*`, `certs/`, `*.pem`, `*.key`, `*.p12`, lockfiles, and non-text/binary extensions.
- **Landing note:** the new `.:/repo:ro` mount and the new `llamaindex-agent` service require `docker compose up -d --build` (a `node --watch` reload does not apply a new volume/service).
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

**Feature A (default index):**
- `docker-compose.yml` — add `- .:/repo:ro` to `demo-api-server` volumes; add `CODE_SEARCH_DEFAULT_INDEX` env (modify).
- `demo_api_server/services/defaultCodebaseIndexer.js` — walker + ignore rules + caps + batching + idempotency + status (create).
- `demo_api_server/tests/defaultCodebaseIndexer.test.js` — unit tests for filter/caps (create; MUST be under `tests/` for jest to find it).
- `demo_api_server/routes/codeSearch.js` — add `GET /default-status`; kick off the indexer (modify).
- `demo_api_ui/src/pages/CodeSearchPage.jsx` — seed the default codebase + poll status (modify).

**Feature B (folder ingest):**
- `demo_api_ui/src/components/CodebaseUploader.jsx` (or its real filename) — add a folder picker + client filter (modify).
- `demo_api_ui/src/services/codeSearchAPI.js` — add `indexFolderFiles(files, name)` (modify).
- `demo_api_ui/src/services/codeSearchAPI.folder.test.js` — filter/caps tests (create).

**Feature C (agent):**
- `llamaindex_agent/` — new Python service: `app.py`, `agent.py`, `retriever.py`, `requirements.txt`, `Dockerfile`, `tests/test_retriever.py`, `tests/test_app.py` (create).
- `docker-compose.yml` — add `llamaindex-agent` service (modify).
- `demo_api_server/routes/codeSearch.js` — add `POST /ask` proxy (modify).
- `demo_api_ui/src/pages/CodeSearchPage.jsx` — Ask/Search tabs (modify).
- `demo_api_ui/src/components/CodeSearchAsk.jsx` — Ask panel + Sources (create).

---

## Feature A — Default index of this demo's source

### Task A1: Repo mount + indexer config

**Files:**
- Modify: `docker-compose.yml` (`demo-api-server` service)

**Interfaces:**
- Produces: `/repo` (read-only repo root) available inside the BFF container; env `CODE_SEARCH_DEFAULT_INDEX` (default `true`), `CODE_SEARCH_REPO_ROOT` (default `/repo`).

- [ ] **Step 1: Read the current demo-api-server volumes**

Run: `sed -n '41,145p' docker-compose.yml | grep -n "volumes:\|- \./\|- /app\|environment:"`
Confirm `demo-api-server` has a `volumes:` list including `- ./demo_api_server:/app` and `- /app/node_modules`.

- [ ] **Step 2: Add the read-only repo mount**

In the `demo-api-server` `volumes:` list, add (after the existing `- ./demo_api_server:/app` / `- /app/node_modules` lines):

```yaml
      - .:/repo:ro   # read-only repo root for the default code-search index
```

- [ ] **Step 3: Add the indexer env**

In the `demo-api-server` `environment:` block, add:

```yaml
      CODE_SEARCH_DEFAULT_INDEX: ${CODE_SEARCH_DEFAULT_INDEX:-true}
      CODE_SEARCH_REPO_ROOT: /repo
```

- [ ] **Step 4: Verify compose parses**

Run: `docker compose config >/dev/null && echo OK`
Expected: `OK` (no YAML error).

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml
git commit -m "feat(code-search): mount repo read-only into BFF for default index

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task A2: The default-codebase indexer module

**Files:**
- Create: `demo_api_server/services/defaultCodebaseIndexer.js`
- Test: `demo_api_server/tests/defaultCodebaseIndexer.test.js`

**Interfaces:**
- Consumes: `mcpCodeSearchClient` (`getClient().index(...)`, `.search(...)`) at `demo_api_server/src/services/mcpCodeSearchClient.js`.
- Produces:
  - `DEFAULT_CODEBASE_ID = 'ai-demo2-default'`, `DEFAULT_CODEBASE_NAME = 'This demo (AI-DEMO2)'`
  - `collectFiles(rootDir) -> Array<{ path, content }>` (pure, testable: applies ignore rules + caps)
  - `getStatus() -> { state, filesIndexed, chunksCreated, skipped, error }`
  - `startDefaultIndex({ client, rootDir }) -> Promise<void>` (idempotent, background-safe)

- [ ] **Step 1: Write failing unit tests for the file collector**

Create `demo_api_server/tests/defaultCodebaseIndexer.test.js`:

```js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { collectFiles } = require('../services/defaultCodebaseIndexer');

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-'));
  const w = (p, c) => {
    fs.mkdirSync(path.join(dir, path.dirname(p)), { recursive: true });
    fs.writeFileSync(path.join(dir, p), c);
  };
  w('demo_api_server/a.js', 'const x = 1;\n');
  w('demo_api_ui/src/b.jsx', 'export const B = 2;\n');
  w('demo_api_server/node_modules/dep/index.js', 'IGNORE ME');
  w('.claude/worktrees/copy/demo_api_server/c.js', 'IGNORE ME');
  w('demo_api_server/.env', 'SECRET=nope');
  w('demo_api_server/certs/ca.pem', 'PEM');
  w('demo_api_server/logo.png', 'PNGBYTES');
  return dir;
}

test('collectFiles includes first-party source, excludes vendored/secrets/binaries', () => {
  const dir = tmpRepo();
  const files = collectFiles(dir);
  const paths = files.map((f) => f.path);
  expect(paths).toContain('demo_api_server/a.js');
  expect(paths).toContain('demo_api_ui/src/b.jsx');
  expect(paths.some((p) => p.includes('node_modules'))).toBe(false);
  expect(paths.some((p) => p.includes('.claude'))).toBe(false);
  expect(paths.some((p) => p.endsWith('.env'))).toBe(false);
  expect(paths.some((p) => p.endsWith('.pem'))).toBe(false);
  expect(paths.some((p) => p.endsWith('.png'))).toBe(false);
});

test('collectFiles enforces a per-file size cap', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-'));
  fs.mkdirSync(path.join(dir, 'demo_api_server'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'demo_api_server/big.js'), 'x'.repeat(300 * 1024));
  fs.writeFileSync(path.join(dir, 'demo_api_server/small.js'), 'ok');
  const paths = collectFiles(dir).map((f) => f.path);
  expect(paths).toContain('demo_api_server/small.js');
  expect(paths).not.toContain('demo_api_server/big.js');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd demo_api_server && npx jest tests/defaultCodebaseIndexer.test.js --testPathIgnorePatterns=/node_modules/ --testPathIgnorePatterns=/tests/real/`
Expected: FAIL — cannot find module `./defaultCodebaseIndexer`.

- [ ] **Step 3: Implement the indexer**

Create `demo_api_server/services/defaultCodebaseIndexer.js`:

```js
'use strict';
const fs = require('fs');
const path = require('path');

const DEFAULT_CODEBASE_ID = 'ai-demo2-default';
const DEFAULT_CODEBASE_NAME = 'This demo (AI-DEMO2)';

// Curated first-party source roots. Widen by editing this list.
const SOURCE_ROOTS = [
  'demo_api_server',
  'demo_api_ui/src',
  'demo_mcp_code_search/src',
  'langchain_agent',
  'demo_llm_proxy',
  'llamaindex_agent',
];

const IGNORE_DIR = new Set([
  'node_modules', '.git', '.claude', 'dist', 'build', 'coverage',
  'data', 'logs', '.next', '__pycache__', '.venv', 'venv',
]);
const IGNORE_FILE_RE = /(^|\/)(\.env(\..*)?|.*\.min\.(js|css)|package-lock\.json|yarn\.lock|.*\.pem|.*\.key|.*\.p12|.*\.crt)$/i;
const ALLOW_EXT = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.py', '.json', '.md', '.css', '.scss',
  '.yml', '.yaml', '.sh', '.go', '.java', '.rb', '.rs', '.txt', '.html',
]);

const MAX_FILE_BYTES = 256 * 1024;
const MAX_FILES = 3000;

function walk(absDir, repoRoot, acc, skipped) {
  let entries;
  try { entries = fs.readdirSync(absDir, { withFileTypes: true }); }
  catch { return; }
  for (const e of entries) {
    if (acc.length >= MAX_FILES) return;
    const abs = path.join(absDir, e.name);
    const rel = path.relative(repoRoot, abs).split(path.sep).join('/');
    if (e.isDirectory()) {
      if (IGNORE_DIR.has(e.name)) { continue; }
      walk(abs, repoRoot, acc, skipped);
    } else if (e.isFile()) {
      const ext = path.extname(e.name).toLowerCase();
      if (!ALLOW_EXT.has(ext) || IGNORE_FILE_RE.test(rel)) { skipped.count++; continue; }
      let stat;
      try { stat = fs.statSync(abs); } catch { skipped.count++; continue; }
      if (stat.size > MAX_FILE_BYTES) { skipped.count++; continue; }
      let content;
      try { content = fs.readFileSync(abs, 'utf8'); } catch { skipped.count++; continue; }
      acc.push({ path: rel, content });
    }
  }
}

/** Pure: collect first-party source files under repoRoot, applying ignore + caps. */
function collectFiles(repoRoot) {
  const acc = [];
  const skipped = { count: 0 };
  for (const root of SOURCE_ROOTS) {
    const abs = path.join(repoRoot, root);
    if (fs.existsSync(abs)) walk(abs, repoRoot, acc, skipped);
  }
  acc._skipped = skipped.count; // stashed for the caller's status
  return acc;
}

const status = { state: 'idle', filesIndexed: 0, chunksCreated: 0, skipped: 0, error: null };
function getStatus() { return { ...status }; }

/** Idempotent background index of the repo into the default codebase. */
async function startDefaultIndex({ client, rootDir }) {
  if (status.state === 'indexing' || status.state === 'ready') return;
  status.state = 'indexing';
  try {
    // Idempotency: if the default codebase already has chunks, skip.
    try {
      const probe = await client.search({
        query: 'function', codebase_id: DEFAULT_CODEBASE_ID, limit: 1,
      });
      if (probe && Array.isArray(probe.results) && probe.results.length > 0) {
        status.state = 'ready';
        return;
      }
    } catch (_) { /* embedder/weaviate not ready yet — fall through to index */ }

    const files = collectFiles(rootDir);
    status.skipped = files._skipped || 0;

    // Batch to respect the code-search 60MB body limit (~400 files/batch).
    const BATCH = 400;
    let chunks = 0;
    for (let i = 0; i < files.length; i += BATCH) {
      const batch = files.slice(i, i + BATCH);
      const res = await client.index({
        files: batch,
        codebase_id: DEFAULT_CODEBASE_ID,
        codebase_name: DEFAULT_CODEBASE_NAME,
        chunk_strategy: 'line-based',
      });
      chunks += (res && res.chunks_created) || 0;
    }
    status.filesIndexed = files.length;
    status.chunksCreated = chunks;
    status.state = 'ready';
    console.log(`[default-index] ready: ${files.length} files, ${chunks} chunks, ${status.skipped} skipped`);
  } catch (err) {
    status.state = 'error';
    status.error = err.message;
    console.error('[default-index] failed:', err.message);
  }
}

module.exports = {
  DEFAULT_CODEBASE_ID, DEFAULT_CODEBASE_NAME, SOURCE_ROOTS,
  collectFiles, getStatus, startDefaultIndex,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd demo_api_server && npx jest tests/defaultCodebaseIndexer.test.js --testPathIgnorePatterns=/node_modules/ --testPathIgnorePatterns=/tests/real/`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/defaultCodebaseIndexer.js demo_api_server/tests/defaultCodebaseIndexer.test.js
git commit -m "feat(code-search): bounded idempotent default-codebase indexer

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task A3: Wire the indexer + status route

**Files:**
- Modify: `demo_api_server/routes/codeSearch.js`

**Interfaces:**
- Consumes: `defaultCodebaseIndexer` (Task A2), `getClient()` (existing in `codeSearch.js`).
- Produces: `GET /api/code-search/default-status` → `getStatus()` JSON; background index kicked off once with embedder-readiness retry.

- [ ] **Step 1: Write the failing route test**

Create `demo_api_server/tests/codeSearch.defaultStatus.test.js`:

```js
const express = require('express');
const request = require('supertest');

jest.mock('../src/services/mcpCodeSearchClient');

test('GET /default-status returns the indexer status shape', async () => {
  const router = require('../routes/codeSearch');
  const app = express();
  app.use('/api/code-search', router);
  const res = await request(app).get('/api/code-search/default-status');
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('state');
  expect(['idle', 'indexing', 'ready', 'error']).toContain(res.body.state);
});
```

(If the project has no `supertest`, add it: `cd demo_api_server && npm i -D supertest`.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd demo_api_server && npx jest tests/codeSearch.defaultStatus.test.js --testPathIgnorePatterns=/node_modules/ --testPathIgnorePatterns=/tests/real/`
Expected: FAIL — route 404 / not defined.

- [ ] **Step 3: Add the route + startup trigger**

In `demo_api_server/routes/codeSearch.js`, near the top add:

```js
const {
  getStatus: getDefaultIndexStatus,
  startDefaultIndex,
} = require('../services/defaultCodebaseIndexer');
```

Add the status route (next to the other routes):

```js
/** GET /api/code-search/default-status — background default-index progress. */
router.get('/default-status', (_req, res) => {
  res.status(200).json(getDefaultIndexStatus());
});
```

At the bottom of the module (before `module.exports = router;`), add a one-time, embedder-gated background kickoff:

```js
// Kick off the default index once, in the background, gated on the embedder.
if (process.env.CODE_SEARCH_DEFAULT_INDEX !== 'false' && !global.__defaultIndexStarted) {
  global.__defaultIndexStarted = true;
  const rootDir = process.env.CODE_SEARCH_REPO_ROOT || '/repo';
  const tryStart = async (attempt = 0) => {
    try {
      await startDefaultIndex({ client: getClient(), rootDir });
    } catch (err) {
      if (attempt < 30) {
        setTimeout(() => tryStart(attempt + 1), 10000); // retry until embedder is up
      } else {
        console.error('[default-index] gave up after retries:', err.message);
      }
    }
  };
  // Delay first attempt so the server finishes booting first.
  setTimeout(() => tryStart(), 5000);
}
```

> `getClient()` already exists in this file (used by `/index` and `/search`). Reuse it — do not create a second client.

- [ ] **Step 4: Run to verify it passes**

Run: `cd demo_api_server && npx jest tests/codeSearch.defaultStatus.test.js --testPathIgnorePatterns=/node_modules/ --testPathIgnorePatterns=/tests/real/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/routes/codeSearch.js demo_api_server/tests/codeSearch.defaultStatus.test.js
git commit -m "feat(code-search): default-status route + gated background index kickoff

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task A4: Seed the default codebase in the UI + poll status

**Files:**
- Modify: `demo_api_ui/src/pages/CodeSearchPage.jsx`

**Interfaces:**
- Consumes: `GET /api/code-search/default-status`.
- Produces: the default codebase always present + selected on first load; an "indexing…" chip until ready.

- [ ] **Step 1: Read the current codebase state init**

Run: `sed -n '1,45p' demo_api_ui/src/pages/CodeSearchPage.jsx`
Confirm `codebases` state loads from `localStorage` on mount and `selectedCodebaseId` defaults to the first.

- [ ] **Step 2: Prepend the default codebase + poll status**

Add a constant near the top of the component file:

```jsx
const DEFAULT_CODEBASE = {
  id: 'ai-demo2-default',
  name: 'This demo (AI-DEMO2)',
  isDefault: true,
  uploadedAt: new Date(0).toISOString(),
};
```

In the mount `useEffect` that loads from `localStorage`, ensure the default is always present and selected when nothing else is:

```jsx
  useEffect(() => {
    let stored = [];
    try { stored = JSON.parse(localStorage.getItem('codeSearchCodebases') || '[]'); } catch {}
    const withDefault = [DEFAULT_CODEBASE, ...stored.filter((c) => c.id !== DEFAULT_CODEBASE.id)];
    setCodebases(withDefault);
    setSelectedCodebaseId((prev) => prev || DEFAULT_CODEBASE.id);
  }, []);
```

Add a status poll:

```jsx
  const [defaultStatus, setDefaultStatus] = useState('idle');
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch('/api/code-search/default-status');
        if (!alive) return;
        const s = await r.json();
        setDefaultStatus(s.state);
        if (s.state === 'indexing') setTimeout(poll, 4000);
      } catch { if (alive) setTimeout(poll, 8000); }
    };
    poll();
    return () => { alive = false; };
  }, []);
```

Guard the `localStorage` persistence effect so it never writes the default entry back:

```jsx
  useEffect(() => {
    const persistable = codebases.filter((c) => !c.isDefault);
    localStorage.setItem('codeSearchCodebases', JSON.stringify(persistable));
  }, [codebases]);
```

- [ ] **Step 3: Show the indexing chip**

Where each codebase item renders its `codebase-meta`, append for the default entry:

```jsx
                      {codebase.isDefault && defaultStatus === 'indexing' && (
                        <span className="codebase-chip"> indexing…</span>
                      )}
                      {codebase.isDefault && defaultStatus === 'error' && (
                        <span className="codebase-chip codebase-chip--error"> index failed</span>
                      )}
```

- [ ] **Step 4: Manual smoke (build)**

Run: `cd demo_api_ui && CI=true npm run build 2>&1 | tail -5`
Expected: compiles with no error in `CodeSearchPage.jsx`.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/pages/CodeSearchPage.jsx
git commit -m "feat(code-search): seed default codebase + poll index status in UI

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Feature B — Folder picker ingest

### Task B1: Client-side folder filter + upload helper

**Files:**
- Modify: `demo_api_ui/src/services/codeSearchAPI.js`
- Test: `demo_api_ui/src/services/codeSearchAPI.folder.test.js`

**Interfaces:**
- Produces:
  - `filterFolderFiles(fileList) -> { accepted: File[], skipped: number }` (pure, testable)
  - `indexFolderFiles(files, codebaseName) -> Promise<{codebase_id, files_indexed, chunks_created}>`

- [ ] **Step 1: Write the failing filter test**

Create `demo_api_ui/src/services/codeSearchAPI.folder.test.js`:

```js
import { filterFolderFiles } from './codeSearchAPI';

function fakeFile(relPath, size = 10) {
  return { name: relPath.split('/').pop(), webkitRelativePath: relPath, size };
}

test('filterFolderFiles keeps code, drops vendored/binary/oversize', () => {
  const list = [
    fakeFile('proj/src/a.js'),
    fakeFile('proj/node_modules/dep/i.js'),
    fakeFile('proj/img.png'),
    fakeFile('proj/big.ts', 300 * 1024),
    fakeFile('proj/README.md'),
  ];
  const { accepted, skipped } = filterFolderFiles(list);
  const names = accepted.map((f) => f.webkitRelativePath);
  expect(names).toContain('proj/src/a.js');
  expect(names).toContain('proj/README.md');
  expect(names.some((p) => p.includes('node_modules'))).toBe(false);
  expect(names.some((p) => p.endsWith('.png'))).toBe(false);
  expect(names.some((p) => p.endsWith('big.ts'))).toBe(false);
  expect(skipped).toBe(3);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd demo_api_ui && CI=true npx vitest run src/services/codeSearchAPI.folder.test.js`
Expected: FAIL — `filterFolderFiles` not exported.

- [ ] **Step 3: Implement filter + upload helper**

Append to `demo_api_ui/src/services/codeSearchAPI.js`:

```js
const FOLDER_ALLOW_EXT = new Set([
  'js','jsx','ts','tsx','py','json','md','css','scss','yml','yaml','sh',
  'go','java','rb','rs','txt','html',
]);
const FOLDER_IGNORE_RE = /(^|\/)(node_modules|\.git|dist|build|\.next|coverage)(\/|$)/i;
const FOLDER_MAX_FILE_BYTES = 256 * 1024;
const FOLDER_MAX_FILES = 2000;

/** Pure: split a picked folder's FileList into accepted code files + skipped count. */
export function filterFolderFiles(fileList) {
  const accepted = [];
  let skipped = 0;
  for (const f of Array.from(fileList)) {
    const rel = f.webkitRelativePath || f.name;
    const ext = (rel.split('.').pop() || '').toLowerCase();
    if (
      accepted.length >= FOLDER_MAX_FILES ||
      FOLDER_IGNORE_RE.test(rel) ||
      !FOLDER_ALLOW_EXT.has(ext) ||
      f.size > FOLDER_MAX_FILE_BYTES
    ) { skipped++; continue; }
    accepted.push(f);
  }
  return { accepted, skipped };
}

/** Upload picked folder files through the existing multi-file /index route. */
export async function indexFolderFiles(files, codebaseName) {
  const formData = new FormData();
  formData.append('codebase_name', codebaseName);
  for (const f of files) formData.append('file', f, f.webkitRelativePath || f.name);
  const response = await fetch(`${API_BASE}/index`, { method: 'POST', body: formData });
  if (!response.ok) {
    const e = await response.json().catch(() => ({}));
    throw new Error(e.error || e.message || `Index failed (${response.status})`);
  }
  return response.json();
}
```

> `API_BASE` is already defined at the top of this file (`const API_BASE = '/api/code-search';`). Reuse it.

- [ ] **Step 4: Run to verify it passes**

Run: `cd demo_api_ui && CI=true npx vitest run src/services/codeSearchAPI.folder.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/services/codeSearchAPI.js demo_api_ui/src/services/codeSearchAPI.folder.test.js
git commit -m "feat(code-search): client-side folder filter + folder upload helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task B2: Folder picker UI

**Files:**
- Modify: the codebase uploader component. First find it: `grep -rln "CodebaseUploader\|onUpload" demo_api_ui/src/components | head`.

**Interfaces:**
- Consumes: `filterFolderFiles`, `indexFolderFiles` (Task B1).
- Produces: a "Pick a folder" control that indexes any local folder and reports skipped counts.

- [ ] **Step 1: Read the uploader component**

Run: `sed -n '1,80p' demo_api_ui/src/components/CodebaseUploader.jsx` (use the real path from the grep above).
Note how it currently calls `onUpload`/`indexCodebase` and shows loading.

- [ ] **Step 2: Add a hidden folder input + handler**

Add near the existing upload UI:

```jsx
      <input
        type="file"
        webkitdirectory=""
        directory=""
        multiple
        style={{ display: 'none' }}
        ref={folderInputRef}
        onChange={handleFolderPicked}
      />
      <button type="button" className="upload-folder-btn" onClick={() => folderInputRef.current?.click()}>
        📁 Index a folder from your computer
      </button>
      {folderSkipped != null && (
        <div className="folder-skip-note">
          Indexed {folderIndexed} files, skipped {folderSkipped} (binary / too large / vendored).
        </div>
      )}
```

Add the imports/state/handler in the component:

```jsx
import { filterFolderFiles, indexFolderFiles } from '../services/codeSearchAPI';
// ...
  const folderInputRef = useRef(null);
  const [folderSkipped, setFolderSkipped] = useState(null);
  const [folderIndexed, setFolderIndexed] = useState(0);

  const handleFolderPicked = async (e) => {
    const list = e.target.files;
    if (!list || list.length === 0) return;
    const { accepted, skipped } = filterFolderFiles(list);
    const topFolder = (accepted[0]?.webkitRelativePath || 'folder').split('/')[0];
    setFolderSkipped(skipped);
    setFolderIndexed(0);
    // Client-batched upload to stay under body limits.
    const BATCH = 300;
    let indexed = 0;
    for (let i = 0; i < accepted.length; i += BATCH) {
      const batch = accepted.slice(i, i + BATCH);
      const res = await indexFolderFiles(batch, topFolder);
      indexed += (res && res.files_indexed) || batch.length;
      setFolderIndexed(indexed);
    }
    // Let the page know a new codebase exists (parent adds it to the list).
    if (typeof onFolderIndexed === 'function') {
      onFolderIndexed({ name: topFolder });
    }
    e.target.value = '';
  };
```

Accept `onFolderIndexed` as a prop (destructure it alongside the existing props). In `CodeSearchPage.jsx`, pass `onFolderIndexed={(cb) => setCodebases((prev) => [{ id: `codebase-${Date.now()}`, name: cb.name, uploadedAt: new Date().toISOString() }, ...prev])}` to the uploader.

> `webkitdirectory`/`directory` as string attributes is the correct React way to enable folder selection.

- [ ] **Step 3: Manual smoke (build)**

Run: `cd demo_api_ui && CI=true npm run build 2>&1 | tail -5`
Expected: compiles.

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/components/CodebaseUploader.jsx demo_api_ui/src/pages/CodeSearchPage.jsx
git commit -m "feat(code-search): folder picker ingest with skipped-file reporting

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Feature C — LlamaIndex agent over the CodeChunk index

### Task C1: Scaffold the llamaindex-agent service

**Files:**
- Create: `llamaindex_agent/requirements.txt`, `llamaindex_agent/Dockerfile`, `llamaindex_agent/app.py`, `llamaindex_agent/tests/test_app.py`

**Interfaces:**
- Produces: FastAPI app with `GET /health` → `{"status":"ok"}` and `POST /ask` (implemented in C3). Runs on `:8894`.

- [ ] **Step 1: requirements.txt**

Create `llamaindex_agent/requirements.txt` (pin majors; the weaviate integration needs `weaviate-client` v4):

```txt
fastapi==0.115.*
uvicorn[standard]==0.30.*
pydantic==2.*
llama-index-core==0.11.*
llama-index-vector-stores-weaviate==1.1.*
llama-index-llms-openai-like==0.2.*
llama-index-embeddings-openai-like==0.2.*
weaviate-client==4.*
httpx==0.27.*
```

- [ ] **Step 2: Write the failing health test**

Create `llamaindex_agent/tests/test_app.py`:

```python
from fastapi.testclient import TestClient
from app import app

client = TestClient(app)

def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd llamaindex_agent && python -m pytest tests/test_app.py -q`
Expected: FAIL — `app` import error (no `app.py`).

- [ ] **Step 4: Minimal app.py**

Create `llamaindex_agent/app.py`:

```python
import os
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="llamaindex-agent")


@app.get("/health")
def health():
    return {"status": "ok"}


class AskRequest(BaseModel):
    question: str
    codebase_id: str
    limit: int | None = None


# POST /ask is implemented in Task C3 (needs the agent from C2).
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd llamaindex_agent && python -m pytest tests/test_app.py -q`
Expected: PASS.

- [ ] **Step 6: Dockerfile**

Create `llamaindex_agent/Dockerfile`:

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8894
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8894"]
```

- [ ] **Step 7: Commit**

```bash
git add llamaindex_agent/requirements.txt llamaindex_agent/Dockerfile llamaindex_agent/app.py llamaindex_agent/tests/test_app.py
git commit -m "feat(llamaindex-agent): scaffold FastAPI service with health check

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task C2: Native Weaviate retrieval over the CodeChunk class

**Files:**
- Create: `llamaindex_agent/retriever.py`, `llamaindex_agent/tests/test_retriever.py`

**Interfaces:**
- Produces:
  - `connect_weaviate() -> weaviate.WeaviateClient`
  - `make_embed_model() -> BaseEmbedding` (pinned to the nomic embeddings service)
  - `build_index() -> VectorStoreIndex` (over existing `CodeChunk`, `text_key="snippet"`)
  - `retrieve(index, question, codebase_id, limit) -> list[dict]` (chunks with file/line/snippet), filtered by `codebase_id`

- [ ] **Step 1: Write the retrieval-correctness test (integration, gated)**

Create `llamaindex_agent/tests/test_retriever.py`. This is an integration test that only runs when Weaviate + embeddings are reachable (skips otherwise) and asserts a KNOWN query returns the EXPECTED file — the embedding-space + schema-mapping correctness gate:

```python
import os
import pytest

WEAVIATE_URL = os.getenv("WEAVIATE_URL", "http://localhost:8080")

def _reachable():
    import httpx
    try:
        return httpx.get(f"{WEAVIATE_URL}/v1/meta", timeout=2).status_code == 200
    except Exception:
        return False

@pytest.mark.skipif(not _reachable(), reason="Weaviate not reachable")
def test_known_query_returns_expected_file():
    from retriever import build_index, retrieve
    index = build_index()
    # After the default index exists, a query about the embedder must surface
    # the embeddings config. Adjust the expected token to a file known to exist.
    hits = retrieve(index, "nomic embedding model configuration",
                    codebase_id="ai-demo2-default", limit=5)
    assert len(hits) > 0
    assert all("file" in h and "snippet" in h for h in hits)
    # Correctness gate: results are about embeddings, not random files.
    assert any("embed" in h["file"].lower() or "embed" in h["snippet"].lower()
               for h in hits)
```

- [ ] **Step 2: Run to verify it fails (or skips)**

Run: `cd llamaindex_agent && python -m pytest tests/test_retriever.py -q`
Expected: FAIL (no `retriever` module) — or SKIP if Weaviate unreachable. Either way, not PASS yet.

- [ ] **Step 3: Implement retriever.py**

Create `llamaindex_agent/retriever.py`:

```python
"""Native LlamaIndex retrieval over the existing Weaviate `CodeChunk` class.

Correctness gates:
  * query embeddings MUST use the same nomic-embed-text-v1.5 model that
    code-search used to write vectors (768-dim), or ANN is meaningless.
  * `CodeChunk` was created by the code-search service, not LlamaIndex, so we
    pin index_name + text_key and reconstruct nodes from the text field.
"""
import os
from urllib.parse import urlparse

import weaviate
from llama_index.core import VectorStoreIndex
from llama_index.core.vector_stores.types import (
    MetadataFilters, MetadataFilter, FilterOperator,
)
from llama_index.embeddings.openai_like import OpenAILikeEmbedding
from llama_index.vector_stores.weaviate import WeaviateVectorStore

CLASS_NAME = "CodeChunk"
TEXT_KEY = "snippet"


def connect_weaviate() -> "weaviate.WeaviateClient":
    url = os.getenv("WEAVIATE_URL", "http://weaviate:8080")
    p = urlparse(url)
    host = p.hostname or "weaviate"
    http_port = p.port or 8080
    # weaviate-client v4 needs gRPC too (default 50051, internal to the network).
    grpc_port = int(os.getenv("WEAVIATE_GRPC_PORT", "50051"))
    client = weaviate.connect_to_custom(
        http_host=host, http_port=http_port, http_secure=False,
        grpc_host=host, grpc_port=grpc_port, grpc_secure=False,
        skip_init_checks=True,
    )
    return client


def make_embed_model() -> OpenAILikeEmbedding:
    base = os.getenv("EMBEDDING_URL", "http://embeddings:8080").rstrip("/")
    return OpenAILikeEmbedding(
        model_name=os.getenv("EMBEDDING_MODEL", "nomic-embed-text-v1.5"),
        api_base=f"{base}/v1",
        api_key="not-needed",
        embed_batch_size=16,
    )


def build_index() -> VectorStoreIndex:
    client = connect_weaviate()
    vector_store = WeaviateVectorStore(
        weaviate_client=client,
        index_name=CLASS_NAME,
        text_key=TEXT_KEY,
    )
    return VectorStoreIndex.from_vector_store(
        vector_store, embed_model=make_embed_model()
    )


def _codebase_filter(codebase_id: str) -> MetadataFilters:
    return MetadataFilters(filters=[
        MetadataFilter(key="codebase_id", value=codebase_id,
                       operator=FilterOperator.EQ),
    ])


def retrieve(index: VectorStoreIndex, question: str,
             codebase_id: str, limit: int = 8) -> list[dict]:
    retriever = index.as_retriever(
        similarity_top_k=limit, filters=_codebase_filter(codebase_id),
    )
    nodes = retriever.retrieve(question)
    out = []
    for n in nodes:
        md = n.node.metadata or {}
        out.append({
            "file": md.get("file", ""),
            "line_start": md.get("line_start"),
            "line_end": md.get("line_end"),
            "snippet": n.node.get_content(),
        })
    return out
```

> **Foreign-class fallback (only if Step 4 fails with empty results / `_node_content` errors):** replace `retrieve()` with a direct `weaviate` v4 query — `client.collections.get("CodeChunk").query.near_vector(make_embed_model().get_query_embedding(question), limit=limit, filters=Filter.by_property("codebase_id").equal(codebase_id), return_properties=["file","line_start","line_end","snippet"])` — and map rows to the same dict shape. Verify the exact v4 `Filter`/`near_vector` API via context7 before writing it. Keep the dict shape identical so C3 is unaffected.

- [ ] **Step 4: Run the integration test against a live stack**

Prereq: the stack is up and the default index (Feature A) is `ready`. Run:
```bash
cd llamaindex_agent && WEAVIATE_URL=http://localhost:8080 \
  EMBEDDING_URL=http://localhost:8084 python -m pytest tests/test_retriever.py -q
```
(Use the host-published embeddings port `:8084`; `EMBEDDING_MODEL=nomic-embed-text-v1.5`.)
Expected: PASS — a known embedding-related query returns embedding-related files. If it returns empty or unrelated files, apply the Step-3 fallback and re-run (this is the correctness gate — do not proceed to C3 until it passes).

- [ ] **Step 5: Commit**

```bash
git add llamaindex_agent/retriever.py llamaindex_agent/tests/test_retriever.py
git commit -m "feat(llamaindex-agent): native WeaviateVectorStore retrieval over CodeChunk

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task C3: The tool-calling agent + /ask endpoint

**Files:**
- Create: `llamaindex_agent/agent.py`
- Modify: `llamaindex_agent/app.py`
- Test: `llamaindex_agent/tests/test_app.py` (extend)

**Interfaces:**
- Consumes: `build_index`, `retrieve` (C2).
- Produces: `run_agent(question, codebase_id, limit) -> {answer, sources, toolCalls, mode}`; `POST /ask` returning that shape.

- [ ] **Step 1: Write the failing /ask contract test (mocked agent)**

Extend `llamaindex_agent/tests/test_app.py`:

```python
def test_ask_returns_grounded_shape(monkeypatch):
    import agent
    monkeypatch.setattr(agent, "run_agent", lambda q, cid, limit=8: {
        "answer": "Auth logic lives in auth.js.",
        "sources": [{"file": "auth.js", "line_start": 1, "line_end": 9, "snippet": "..."}],
        "toolCalls": 1,
        "mode": "agent",
    })
    r = client.post("/ask", json={"question": "where is auth?", "codebase_id": "ai-demo2-default"})
    assert r.status_code == 200
    body = r.json()
    assert body["answer"]
    assert body["sources"][0]["file"] == "auth.js"
    assert body["mode"] in ("agent", "single-shot")
    assert isinstance(body["toolCalls"], int)
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd llamaindex_agent && python -m pytest tests/test_app.py::test_ask_returns_grounded_shape -q`
Expected: FAIL — `/ask` not implemented.

- [ ] **Step 3: Implement agent.py**

Create `llamaindex_agent/agent.py`:

```python
"""LlamaIndex tool-calling agent over the CodeChunk index.

The LLM is given a `search_code` tool (native Weaviate retrieval, codebase_id
bound server-side) and decides when to call it. Bounded by AGENT_MAX_TOOL_CALLS.
Degrades to a single retrieval + answer when the model can't tool-call.
"""
import os

from llama_index.core.tools import FunctionTool
from llama_index.core.agent import ReActAgent
from llama_index.llms.openai_like import OpenAILike

from retriever import build_index, retrieve

_MAX_TOOLS = int(os.getenv("AGENT_MAX_TOOL_CALLS", "4"))

_index = None
def _get_index():
    global _index
    if _index is None:
        _index = build_index()
    return _index


def _make_llm() -> OpenAILike:
    base = os.getenv("LLAMACPP_BASE_URL", "http://llm-proxy:8090").rstrip("/")
    return OpenAILike(
        model=os.getenv("AGENT_MODEL", "local"),
        api_base=f"{base}/v1",
        api_key="not-needed",
        is_chat_model=True,
        is_function_calling_model=True,
        temperature=0.1,
        max_tokens=800,
    )


SYSTEM = (
    "You are a code-search agent. Use the search_code tool to find relevant "
    "code before answering. You may call it multiple times to refine. Answer "
    "ONLY from retrieved snippets; cite sources as path:line_start-line_end; "
    "if the code isn't found, say so — never invent code."
)


def run_agent(question: str, codebase_id: str, limit: int = 8) -> dict:
    index = _get_index()
    collected: list[dict] = []

    def search_code(query: str) -> str:
        hits = retrieve(index, query, codebase_id=codebase_id, limit=limit)
        collected.extend(hits)
        if not hits:
            return "No matching code found."
        return "\n\n".join(
            f"[{h['file']}:{h['line_start']}-{h['line_end']}]\n{h['snippet']}"
            for h in hits
        )

    tool = FunctionTool.from_defaults(
        fn=search_code, name="search_code",
        description="Semantic search over the indexed codebase. Args: query (str).",
    )

    def _dedup(rows):
        seen, out = set(), []
        for h in rows:
            k = (h["file"], h["line_start"], h["line_end"])
            if k not in seen:
                seen.add(k); out.append(h)
        return out

    try:
        agent = ReActAgent.from_tools(
            [tool], llm=_make_llm(), max_iterations=_MAX_TOOLS, verbose=False,
        )
        resp = agent.chat(f"{SYSTEM}\n\nQuestion: {question}")
        answer = str(resp)
        if collected:
            return {"answer": answer, "sources": _dedup(collected),
                    "toolCalls": max(1, len(collected) // max(1, limit)),
                    "mode": "agent"}
        # Model answered without calling the tool → force one retrieval (grounding).
    except Exception:
        pass

    # single-shot fallback: retrieve once, answer with the same LLM.
    hits = retrieve(index, question, codebase_id=codebase_id, limit=limit)
    context = "\n\n".join(
        f"[{h['file']}:{h['line_start']}-{h['line_end']}]\n{h['snippet']}"
        for h in hits
    ) or "No matching code found."
    llm = _make_llm()
    completion = llm.complete(
        f"{SYSTEM}\n\nSnippets:\n{context}\n\nQuestion: {question}\nAnswer:"
    )
    return {"answer": str(completion), "sources": _dedup(hits),
            "toolCalls": 1 if hits else 0, "mode": "single-shot"}
```

> Verify the current `ReActAgent.from_tools` / `FunctionTool.from_defaults` signatures against context7 (`/websites/developers_llamaindex_ai`) before running — LlamaIndex renamed agent APIs across 0.11/0.12. If `ReActAgent` moved, use the documented `FunctionAgent`/`AgentWorkflow` equivalent; keep `run_agent`'s return shape identical.

- [ ] **Step 4: Implement POST /ask in app.py**

Add to `llamaindex_agent/app.py`:

```python
from fastapi import HTTPException
import agent as agent_mod


@app.post("/ask")
def ask(req: AskRequest):
    try:
        return agent_mod.run_agent(
            req.question, req.codebase_id, limit=req.limit or 8
        )
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"assistant unavailable: {e}")
```

- [ ] **Step 5: Run the /ask contract test**

Run: `cd llamaindex_agent && python -m pytest tests/test_app.py -q`
Expected: PASS (health + ask-shape, agent mocked).

- [ ] **Step 6: Commit**

```bash
git add llamaindex_agent/agent.py llamaindex_agent/app.py llamaindex_agent/tests/test_app.py
git commit -m "feat(llamaindex-agent): tool-calling agent + /ask with single-shot fallback

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task C4: Compose service for llamaindex-agent

**Files:**
- Modify: `docker-compose.yml`

**Interfaces:**
- Produces: `llamaindex-agent` service on `:8894`, on `ai-demo`, depends on `weaviate` + `embeddings` + `llm-proxy`.

- [ ] **Step 1: Add the service**

After the `demo-mcp-code-search` service block, add:

```yaml
  llamaindex-agent:
    build:
      context: ./llamaindex_agent
      dockerfile: Dockerfile
    container_name: ai-demo-llamaindex-agent
    ports:
      - "8894:8894"
    environment:
      WEAVIATE_URL: http://weaviate:8080
      WEAVIATE_GRPC_PORT: "50051"
      EMBEDDING_URL: http://embeddings:8080
      EMBEDDING_MODEL: nomic-embed-text-v1.5
      LLAMACPP_BASE_URL: http://llm-proxy:8090
      AGENT_MAX_TOOL_CALLS: "4"
    networks:
      - ai-demo
    depends_on:
      weaviate:
        condition: service_healthy
      embeddings:
        condition: service_started
      llm-proxy:
        condition: service_started
    healthcheck:
      test: ["CMD-SHELL", "python -c \"import urllib.request;urllib.request.urlopen('http://localhost:8894/health')\" || exit 1"]
      interval: 15s
      timeout: 5s
      retries: 5
    restart: unless-stopped
```

- [ ] **Step 2: Verify compose parses + builds**

Run: `docker compose config >/dev/null && echo OK && docker compose build llamaindex-agent 2>&1 | tail -5`
Expected: `OK` then a successful image build.

- [ ] **Step 3: Bring it up + hit health**

Run: `docker compose up -d llamaindex-agent && sleep 15 && curl -s http://localhost:8894/health`
Expected: `{"status":"ok"}`.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml
git commit -m "feat(compose): add llamaindex-agent service on :8894

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task C5: BFF /ask proxy

**Files:**
- Modify: `demo_api_server/routes/codeSearch.js`
- Test: `demo_api_server/tests/codeSearch.ask.test.js`

**Interfaces:**
- Produces: `POST /api/code-search/ask` → forwards to `${LLAMAINDEX_AGENT_URL}/ask`, returns its JSON.

- [ ] **Step 1: Write the failing proxy test**

Create `demo_api_server/tests/codeSearch.ask.test.js`:

```js
const express = require('express');
const request = require('supertest');
jest.mock('../src/services/mcpCodeSearchClient');

beforeAll(() => {
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ answer: 'ok', sources: [], toolCalls: 0, mode: 'single-shot' }),
  }));
});

test('POST /ask proxies to the llamaindex agent', async () => {
  const app = express();
  app.use('/api/code-search', require('./codeSearch'));
  const res = await request(app)
    .post('/api/code-search/ask')
    .send({ question: 'where is auth?', codebase_id: 'ai-demo2-default' });
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('answer', 'ok');
  expect(res.body).toHaveProperty('mode');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd demo_api_server && npx jest tests/codeSearch.ask.test.js --testPathIgnorePatterns=/node_modules/ --testPathIgnorePatterns=/tests/real/`
Expected: FAIL — route not defined.

- [ ] **Step 3: Add the proxy route**

In `demo_api_server/routes/codeSearch.js`, add:

```js
const LLAMAINDEX_AGENT_URL =
  process.env.LLAMAINDEX_AGENT_URL || 'http://llamaindex-agent:8894';

/** POST /api/code-search/ask — proxy to the LlamaIndex agent. */
router.post('/ask', express.json(), async (req, res) => {
  const { question, codebase_id, limit } = req.body || {};
  if (!question) return res.status(400).json({ error: 'missing_question' });
  if (!codebase_id) return res.status(400).json({ error: 'missing_codebase_id' });
  try {
    const r = await fetch(`${LLAMAINDEX_AGENT_URL}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, codebase_id, limit }),
    });
    const body = await r.json().catch(() => ({}));
    return res.status(r.status).json(body);
  } catch (err) {
    return res.status(503).json({ error: 'agent_unavailable', message: err.message });
  }
});
```

Add `LLAMAINDEX_AGENT_URL: http://llamaindex-agent:8894` to the `demo-api-server` `environment:` block in `docker-compose.yml`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd demo_api_server && npx jest tests/codeSearch.ask.test.js --testPathIgnorePatterns=/node_modules/ --testPathIgnorePatterns=/tests/real/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/routes/codeSearch.js demo_api_server/tests/codeSearch.ask.test.js docker-compose.yml
git commit -m "feat(code-search): BFF /ask proxy to the LlamaIndex agent

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task C6: Ask/Search tabs + Ask panel

**Files:**
- Create: `demo_api_ui/src/components/CodeSearchAsk.jsx`
- Modify: `demo_api_ui/src/pages/CodeSearchPage.jsx`

**Interfaces:**
- Consumes: `POST /api/code-search/ask`.
- Produces: an **Ask** tab (agent chat + Sources) alongside the existing **Search** tab.

- [ ] **Step 1: Create the Ask panel**

Create `demo_api_ui/src/components/CodeSearchAsk.jsx`:

```jsx
import React, { useState } from 'react';

export default function CodeSearchAsk({ codebaseId }) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState(null);
  const [sources, setSources] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const ask = async () => {
    if (!question.trim()) return;
    setLoading(true); setError(''); setAnswer(null); setSources([]); setMeta(null);
    try {
      const r = await fetch('/api/code-search/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, codebase_id: codebaseId }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body.message || body.error || 'assistant unavailable');
      setAnswer(body.answer);
      setSources(body.sources || []);
      setMeta({ toolCalls: body.toolCalls, mode: body.mode });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="code-search-ask">
      <div className="ask-input-group">
        <input
          className="search-input"
          placeholder="Ask the agent about this codebase…"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ask()}
          disabled={loading}
        />
        <button className="search-button" onClick={ask} disabled={loading || !codebaseId}>
          {loading ? 'Thinking…' : 'Ask'}
        </button>
      </div>
      {error && <div className="search-error">{error}</div>}
      {answer && (
        <div className="ask-answer">
          <p style={{ whiteSpace: 'pre-wrap' }}>{answer}</p>
          {meta && (
            <div className="ask-meta">
              mode: {meta.mode} · tool calls: {meta.toolCalls}
            </div>
          )}
        </div>
      )}
      {sources.length > 0 && (
        <div className="ask-sources">
          <h4>Sources</h4>
          {sources.map((s, i) => (
            <div key={i} className="ask-source">
              <code>{s.file}:{s.line_start}-{s.line_end}</code>
              <pre className="edu-code">{s.snippet}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add the tabs to CodeSearchPage**

In `demo_api_ui/src/pages/CodeSearchPage.jsx`, import the panel and add a tab toggle on the right pane:

```jsx
import CodeSearchAsk from '../components/CodeSearchAsk';
// ...
  const [rightTab, setRightTab] = useState('ask'); // 'ask' | 'search'
```

Wrap the existing search form + results so it only shows when `rightTab === 'search'`, and add:

```jsx
        <div className="search-panel-right">
          <div className="cs-tabs">
            <button className={rightTab === 'ask' ? 'active' : ''} onClick={() => setRightTab('ask')}>Ask</button>
            <button className={rightTab === 'search' ? 'active' : ''} onClick={() => setRightTab('search')}>Search</button>
          </div>
          {rightTab === 'ask' ? (
            <CodeSearchAsk codebaseId={selectedCodebaseId} />
          ) : (
            <>
              {/* existing search-form + <SearchResults /> unchanged */}
            </>
          )}
        </div>
```

- [ ] **Step 3: Build smoke**

Run: `cd demo_api_ui && CI=true npm run build 2>&1 | tail -5`
Expected: compiles.

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/components/CodeSearchAsk.jsx demo_api_ui/src/pages/CodeSearchPage.jsx
git commit -m "feat(code-search): Ask/Search tabs with agent chat + Sources

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task V: End-to-end verification (live stack)

**Files:** none (verification only).

- [ ] **Step 1: Bring the whole stack up**

Run: `docker compose up -d --build weaviate embeddings demo-mcp-code-search llamaindex-agent demo-api-server`
Wait for health: `docker compose ps` shows all healthy (embeddings may take minutes on first model download).

- [ ] **Step 2: A — default index becomes ready**

Run: `curl -s http://localhost:3001/api/code-search/default-status` (adjust host/port to the BFF; via UI it's same-origin).
Expected: `state` transitions `indexing → ready`; `filesIndexed` > 0. Inspect the index does NOT contain worktrees:
`docker logs ai-demo-mcp-code-search 2>&1 | grep -c "\.claude/worktrees" || true` → expect `0`.

- [ ] **Step 3: A — search the default codebase**

In the UI at `/code-search`, with "This demo (AI-DEMO2)" selected, search "authentication logic" → first-party source chunks return.

- [ ] **Step 4: B — folder ingest**

Click "Index a folder", pick a small local project folder → it indexes, shows "skipped N", appears in the list, and searching it returns relevant chunks.

- [ ] **Step 5: C — agent answers with tool calls + sources**

On the **Ask** tab, ask "where is the OAuth token exchange handled?" → grounded answer with a **Sources** list; response `mode` is `agent` (or `single-shot` if the local model can't tool-call) and `toolCalls` ≥ 1 in `agent` mode. Ask an out-of-scope question ("what's the weather?") → "couldn't find it", no hallucinated code.

- [ ] **Step 6: Idempotency**

Run: `docker compose restart demo-api-server && sleep 30 && curl -s .../default-status`
Expected: `state` returns to `ready` WITHOUT re-indexing (the probe short-circuits) — confirm no new bulk embed traffic in `docker logs ai-demo-embeddings --since 30s`.

- [ ] **Step 7: Full unit suites**

Run:
```bash
cd demo_api_server && npx jest tests/defaultCodebaseIndexer.test.js tests/codeSearch.defaultStatus.test.js tests/codeSearch.ask.test.js --testPathIgnorePatterns=/node_modules/ --testPathIgnorePatterns=/tests/real/
cd ../demo_api_ui && CI=true npx vitest run src/services/codeSearchAPI.folder.test.js
cd ../llamaindex_agent && python -m pytest tests/test_app.py -q
```
Expected: all PASS.

---

## Self-Review (completed by plan author)

- **Spec coverage:** A (Tasks A1–A4: mount, indexer, status route, UI seed), B (B1–B2: filter/upload helper, picker UI), C (C1–C6: scaffold, native retrieval, agent+/ask, compose, BFF proxy, UI tabs). Verification maps every spec "done" criterion in Task V.
- **Placeholder scan:** no TBD/TODO. The two "verify via context7 before running" notes (LlamaIndex agent API names; v4 `Filter`/`near_vector` fallback) are concrete correctness gates with a named fallback, not missing content — they exist because the spec itself made these doc-verification gates and LlamaIndex APIs move between minor versions.
- **Type consistency:** `DEFAULT_CODEBASE_ID`/`'ai-demo2-default'`, `CodeChunk`/`text_key="snippet"`, the `{file,line_start,line_end,snippet}` chunk shape, and the `{answer,sources,toolCalls,mode}` response shape are used identically across retriever → agent → /ask → BFF proxy → UI.
- **Known residual risk (flagged, not a gap):** LlamaIndex native read of a foreign `CodeChunk` class and local-model tool-calling reliability — both have concrete fallbacks in the plan (custom v4 retriever; `single-shot` mode) and are gated by the C2 correctness test.
