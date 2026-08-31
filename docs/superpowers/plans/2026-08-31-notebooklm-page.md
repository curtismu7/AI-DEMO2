# NotebookLM Docs-Oracle Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin-only page that lists NotebookLM notebooks and their sources, asks a question, and renders the answer with citations linked back to real `docs.pingidentity.com` pages.

**Architecture:** A `notebooklm` sidecar container runs `notebooklm-py`'s REST server on the internal compose network, holding the host's Google cookies via a bind mount and never publishing a port. The BFF proxies three read-only endpoints to it and resolves each citation's `cited_text` back to a source URL by searching the bundle file. The UI page is built on the existing `InspectorShell` three-column layout.

**Tech Stack:** Express 4.18 (CommonJS), axios, jest + supertest, React 19.2, Vitest 3.2, Docker Compose, Python 3.14 (`notebooklm-py[server]`) in the sidecar only.

**Spec:** `docs/superpowers/specs/2026-08-31-notebooklm-page-design.md`

## Global Constraints

- **Worktree required.** All edits on a branch in an isolated worktree. Stage explicitly with `git add <files>` — **never `git add -A`** (a BFF jest run regenerates 443 files).
- **BFF is CommonJS.** `'use strict';` + `require`. Not ESM. Node >= 22.
- **BFF error shape is `{ error }`**, never `{ message }`. Extra flags go alongside: `{ error, reason }`.
- **Upstream failures go through `normalizeAxiosError(err, { label, timeoutMs })`** from `../utils/normalizeAxiosError`. It returns an `Error` with `.code` (`UPSTREAM_TIMEOUT` | `UPSTREAM_UNREACHABLE` | `UPSTREAM_HTTP_ERROR`) and `.httpStatus`. Never put a raw axios error in a response — it carries bearer tokens.
- **BFF tests live in `tests/`** (not `__tests__/`, which is legacy). `CI=true` is **mandatory** — without it supertest suites flake and green proves nothing.
- **UI uses Vitest, not jest.** Plain JSX, no TypeScript sources.
- **UI HTTP goes through `apiClient`** (`src/services/apiClient`), never `axios` directly.
- **UI theming:** colours/backgrounds/font-sizes come from `--th-*` tokens in the stylesheet. No `color`/`background`/`fontSize` in inline `style={{ }}`. Font-size floor is 10px (`--font-size-3xs`). Dark mode is `:root[data-theme="dark"]` only — **never** `prefers-color-scheme`.
- **Emoji allowlist only.** Use plain text, CSS, or semantic HTML instead of new glyphs.
- **A new page touches three nav SoTs plus the route guard**, and `navStructureCatalog.drift.test.js` fails the build if they disagree.
- **Secrets:** `NOTEBOOKLM_SERVER_TOKEN` is delivered via `env_file`, **never** a compose `environment:` entry (that overrides `env_file` for the same key even when absent — the failure the compose-env-shadow hygiene check exists to catch).

---

### Task 1: Citation resolver service

Pure logic, no network. Built first because it is the highest-risk part of the feature and is fully testable in isolation.

**Files:**
- Create: `demo_api_server/services/notebooklmCitations.js`
- Test: `demo_api_server/tests/notebooklmCitations.test.js`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `buildIndex(bundleText: string) => { norm: string, rawAt: number[], headers: Array<{rawOffset: number, url: string}> }`
  - `resolveCitation(citedText: string, index) => string | null`
  - `loadIndexes(dir: string) => Array<index>` — reads `*.md` from a directory
  - `resolveAgainst(citedText: string, indexes: Array<index>) => string | null`

**Why the probe is 120 characters and must be unique:** measured against the live notebook, exact substring matching resolved 0 of 3 citations (NotebookLM collapses whitespace in `cited_text`), whitespace-normalised resolved 2 of 3, and alphanumeric-normalised at 120 characters resolved 3 of 3 with exactly one match each. Full `cited_text` matched zero times for 2 of 3, because an excerpt can span a page boundary in the bundle — so resolving on the *first* 120 characters attributes the citation to the page where the excerpt begins, which is the correct answer.

- [ ] **Step 1: Write the failing test**

Create `demo_api_server/tests/notebooklmCitations.test.js`:

```js
'use strict';

/**
 * Citations from NotebookLM carry no page URL — only `cited_text` and a
 * source_id that is the whole uploaded bundle. The bundle written by
 * ping-docs-notebook.sh carries a `# source: <url>` header above every page,
 * so the URL is recovered by locating the excerpt and walking back.
 *
 * NotebookLM collapses whitespace in cited_text, so exact matching finds
 * nothing; normalisation to lowercase alphanumerics is what makes it work.
 */

const {
  buildIndex,
  resolveCitation,
  resolveAgainst,
} = require('../services/notebooklmCitations');

const BUNDLE = [
  '',
  '---',
  '# source: https://docs.pingidentity.com/privilege/getting-started/key-concepts.md',
  '',
  'The agentless model is ideal for organizations seeking a fast rollout.',
  'Users access resources using the PingOne Privilege CLI (PCLI) shell utility.',
  '',
  '---',
  '# source: https://docs.pingidentity.com/privilege/agent-privilege/mcp-gateway.md',
  '',
  'The MCP gateway brokers tool calls and enforces policy on every request.',
  '',
].join('\n');

describe('notebooklmCitations', () => {
  const index = buildIndex(BUNDLE);

  it('resolves an excerpt whose whitespace NotebookLM collapsed', () => {
    const cited = 'Usersaccess resources using thePingOne Privilege CLI(PCLI)shell utility.';
    expect(resolveCitation(cited, index)).toBe(
      'https://docs.pingidentity.com/privilege/getting-started/key-concepts.md',
    );
  });

  it('attributes the excerpt to the page it starts in', () => {
    const cited = 'The MCP gateway brokers tool calls and enforces policy on every request.';
    expect(resolveCitation(cited, index)).toBe(
      'https://docs.pingidentity.com/privilege/agent-privilege/mcp-gateway.md',
    );
  });

  it('returns null when the excerpt is not in the bundle', () => {
    expect(resolveCitation('nothing like this appears anywhere in the bundle at all', index)).toBeNull();
  });

  it('returns null rather than guessing when the excerpt is too short to be unique', () => {
    expect(resolveCitation('the', index)).toBeNull();
  });

  it('returns null when the probe matches more than one place', () => {
    const dupe = buildIndex(
      [
        '# source: https://docs.pingidentity.com/a.md',
        'Repeated boilerplate sentence that appears verbatim in two different pages here.',
        '# source: https://docs.pingidentity.com/b.md',
        'Repeated boilerplate sentence that appears verbatim in two different pages here.',
      ].join('\n'),
    );
    const cited = 'Repeated boilerplate sentence that appears verbatim in two different pages here.';
    expect(resolveCitation(cited, dupe)).toBeNull();
  });

  it('searches across multiple bundle indexes', () => {
    const other = buildIndex(
      ['# source: https://docs.pingidentity.com/other.md', 'Completely different content lives in this second bundle file.'].join('\n'),
    );
    const cited = 'Completely different content lives in this second bundle file.';
    expect(resolveAgainst(cited, [index, other])).toBe('https://docs.pingidentity.com/other.md');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd demo_api_server && CI=true npx jest tests/notebooklmCitations.test.js --forceExit
```

Expected: FAIL — `Cannot find module '../services/notebooklmCitations'`.

- [ ] **Step 3: Write the implementation**

Create `demo_api_server/services/notebooklmCitations.js`:

```js
'use strict';
/**
 * Resolve a NotebookLM citation back to the docs page it came from.
 *
 * `ask` returns references as { source_id, citation_number, cited_text }. The
 * source_id is the uploaded bundle, identical for every citation, so it says
 * nothing about which page was cited. ping-docs-notebook.sh writes a
 * `# source: <url>` header above every page it bundles; this module locates the
 * excerpt in the bundle and walks back to the nearest preceding header.
 *
 * Matching is on lowercase alphanumerics only. NotebookLM collapses whitespace
 * in cited_text, so exact substring matching resolves nothing at all.
 */
const fs = require('fs');
const path = require('path');

/** Probe length, in normalised characters. Measured unique at 60 and 120. */
const PROBE_LEN = 120;
/** Below this, a probe is too generic to attribute safely. */
const MIN_PROBE_LEN = 40;

/** Strip markdown link syntax, then reduce to lowercase alphanumerics. */
function normalize(text) {
  return String(text == null ? '' : text)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[^0-9a-zA-Z]/g, '')
    .toLowerCase();
}

/**
 * Index one bundle: its normalised text, a map from normalised offset back to
 * raw offset, and the byte offset of every `# source:` header.
 */
function buildIndex(bundleText) {
  const text = String(bundleText == null ? '' : bundleText).replace(
    /\[([^\]]*)\]\([^)]*\)/g,
    '$1',
  );

  const headers = [];
  const headerRe = /^# source: (\S+)[ \t]*$/gm;
  let m;
  while ((m = headerRe.exec(text)) !== null) {
    headers.push({ rawOffset: m.index, url: m[1] });
  }

  let norm = '';
  const rawAt = [];
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if ((c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) {
      norm += c.toLowerCase();
      rawAt.push(i);
    }
  }
  return { norm, rawAt, headers };
}

/** The url of the last `# source:` header at or before a raw offset. */
function urlAt(index, rawOffset) {
  let url = null;
  for (const h of index.headers) {
    if (h.rawOffset <= rawOffset) url = h.url;
    else break;
  }
  return url;
}

/**
 * Resolve one citation against one bundle index.
 * Returns null on no match, an ambiguous match, or too short a probe — a wrong
 * docs URL is worse than none.
 */
function resolveCitation(citedText, index) {
  const probe = normalize(citedText).slice(0, PROBE_LEN);
  if (probe.length < MIN_PROBE_LEN) return null;

  const first = index.norm.indexOf(probe);
  if (first === -1) return null;
  if (index.norm.indexOf(probe, first + 1) !== -1) return null;

  return urlAt(index, index.rawAt[first]);
}

/** Resolve against several bundles; a hit in more than one bundle is ambiguous. */
function resolveAgainst(citedText, indexes) {
  const hits = [];
  for (const idx of indexes) {
    const url = resolveCitation(citedText, idx);
    if (url) hits.push(url);
  }
  return hits.length === 1 ? hits[0] : null;
}

/** Read and index every *.md in a directory tree. Missing dir -> []. */
function loadIndexes(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...loadIndexes(full));
    else if (e.isFile() && e.name.endsWith('.md')) {
      try {
        out.push(buildIndex(fs.readFileSync(full, 'utf8')));
      } catch {
        // An unreadable bundle must not take the route down.
      }
    }
  }
  return out;
}

module.exports = { buildIndex, resolveCitation, resolveAgainst, loadIndexes, normalize };
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd demo_api_server && CI=true npx jest tests/notebooklmCitations.test.js --forceExit
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/notebooklmCitations.js demo_api_server/tests/notebooklmCitations.test.js
git commit -m "feat(notebooklm): resolve citations back to docs.pingidentity.com URLs"
```

---

### Task 2: BFF proxy route

**Files:**
- Create: `demo_api_server/routes/notebooklmRoutes.js`
- Test: `demo_api_server/tests/notebooklmRoutes.test.js`
- Modify: `demo_api_server/server.js` (add one `app.use` beside the other `/api/*` mounts, e.g. near line 1061)

**Interfaces:**
- Consumes: `resolveAgainst`, `loadIndexes` from Task 1.
- Produces three endpoints:
  - `GET /api/notebooklm/notebooks` → `{ notebooks: [{ id, title }] }`
  - `GET /api/notebooklm/notebooks/:id/sources` → `{ sources: [{ id, title }] }`
  - `POST /api/notebooklm/ask` body `{ notebookId, question }` → `{ answer, references: [{ citationNumber, citedText, url }] }` where `url` may be `null`
  - All three on failure → `503 { error, reason }`, `reason` ∈ `sidecar_unreachable` | `auth_expired` | `upstream_timeout` | `upstream_error`

- [ ] **Step 1: Write the failing test**

Create `demo_api_server/tests/notebooklmRoutes.test.js`:

```js
'use strict';

/**
 * /api/notebooklm/* — read-only proxy to the notebooklm sidecar.
 *
 * Unavailability is the expected steady state anywhere but a developer laptop
 * (the sidecar holds host Google cookies), so the reason code matters as much
 * as the status: the page names the cause instead of spinning forever.
 */

const request = require('supertest');
const express = require('express');

jest.mock('axios');
const axios = require('axios');

jest.mock('../services/notebooklmCitations', () => ({
  loadIndexes: jest.fn(() => []),
  resolveAgainst: jest.fn(() => null),
}));
const citations = require('../services/notebooklmCitations');

const notebooklmRoutes = require('../routes/notebooklmRoutes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/notebooklm', notebooklmRoutes);
  return app;
}

function axiosError(code, status) {
  const err = new Error('boom');
  if (code) err.code = code;
  if (status) err.response = { status, data: {} };
  return err;
}

beforeEach(() => {
  jest.clearAllMocks();
  citations.loadIndexes.mockReturnValue([]);
  citations.resolveAgainst.mockReturnValue(null);
});

describe('GET /api/notebooklm/notebooks', () => {
  it('returns the notebook list from the sidecar', async () => {
    axios.mockResolvedValue({ data: { notebooks: [{ id: 'nb1', title: 'Ping Docs' }] } });
    const res = await request(buildApp()).get('/api/notebooklm/notebooks');
    expect(res.status).toBe(200);
    expect(res.body.notebooks).toEqual([{ id: 'nb1', title: 'Ping Docs' }]);
  });

  it('reports sidecar_unreachable when the container is down', async () => {
    axios.mockRejectedValue(axiosError('ECONNREFUSED'));
    const res = await request(buildApp()).get('/api/notebooklm/notebooks');
    expect(res.status).toBe(503);
    expect(res.body.reason).toBe('sidecar_unreachable');
    expect(res.body.error).toBeDefined();
  });

  it('reports auth_expired when the sidecar rejects the session', async () => {
    axios.mockRejectedValue(axiosError(null, 401));
    const res = await request(buildApp()).get('/api/notebooklm/notebooks');
    expect(res.status).toBe(503);
    expect(res.body.reason).toBe('auth_expired');
  });

  it('never leaks the raw upstream error object', async () => {
    const err = axiosError(null, 500);
    err.config = { headers: { Authorization: 'Bearer super-secret' } };
    axios.mockRejectedValue(err);
    const res = await request(buildApp()).get('/api/notebooklm/notebooks');
    expect(JSON.stringify(res.body)).not.toContain('super-secret');
  });
});

describe('POST /api/notebooklm/ask', () => {
  it('rejects a missing question with 400 and the { error } shape', async () => {
    const res = await request(buildApp()).post('/api/notebooklm/ask').send({ notebookId: 'nb1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('attaches a resolved url to each reference', async () => {
    axios.mockResolvedValue({
      data: {
        answer: 'PCLI is the agentless CLI [1].',
        references: [{ citation_number: 1, cited_text: 'the excerpt', source_id: 's1' }],
      },
    });
    citations.resolveAgainst.mockReturnValue('https://docs.pingidentity.com/privilege/x.md');

    const res = await request(buildApp())
      .post('/api/notebooklm/ask')
      .send({ notebookId: 'nb1', question: 'what is pcli?' });

    expect(res.status).toBe(200);
    expect(res.body.answer).toContain('PCLI');
    expect(res.body.references).toEqual([
      {
        citationNumber: 1,
        citedText: 'the excerpt',
        url: 'https://docs.pingidentity.com/privilege/x.md',
      },
    ]);
  });

  it('returns url null when the citation cannot be attributed', async () => {
    axios.mockResolvedValue({
      data: { answer: 'a', references: [{ citation_number: 1, cited_text: 'x', source_id: 's1' }] },
    });
    citations.resolveAgainst.mockReturnValue(null);
    const res = await request(buildApp())
      .post('/api/notebooklm/ask')
      .send({ notebookId: 'nb1', question: 'q' });
    expect(res.body.references[0].url).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd demo_api_server && CI=true npx jest tests/notebooklmRoutes.test.js --forceExit
```

Expected: FAIL — `Cannot find module '../routes/notebooklmRoutes'`.

- [ ] **Step 3: Write the implementation**

Create `demo_api_server/routes/notebooklmRoutes.js`:

```js
'use strict';
/**
 * /api/notebooklm/* — read-only proxy to the notebooklm sidecar.
 *
 * Read-only is a security property, not just a scope cut: no write endpoint is
 * proxied, so an expired or hijacked Google session cannot mutate the user's
 * NotebookLM data through this page.
 *
 * The sidecar holds live Google cookies and is reachable only on the internal
 * compose network. It is absent on the SE cluster by design, so every failure
 * carries a machine-readable `reason` the page renders as a named empty state.
 */
const express = require('express');
const axios = require('axios');
const { normalizeAxiosError } = require('../utils/normalizeAxiosError');
const { loadIndexes, resolveAgainst } = require('../services/notebooklmCitations');

const router = express.Router();

const BASE_URL = process.env.NOTEBOOKLM_URL || 'http://notebooklm:8000';
const BUNDLE_DIR = process.env.PING_DOCS_BUNDLE_DIR || '/bundles';
const TIMEOUT_MS = 60_000;

// Bundles are static once mounted; index them once rather than per request.
let cachedIndexes = null;
function indexes() {
  if (cachedIndexes === null) cachedIndexes = loadIndexes(BUNDLE_DIR);
  return cachedIndexes;
}

function callSidecar(urlPath, { method = 'GET', data } = {}) {
  const headers = {};
  if (process.env.NOTEBOOKLM_SERVER_TOKEN) {
    headers.Authorization = `Bearer ${process.env.NOTEBOOKLM_SERVER_TOKEN}`;
  }
  return axios({ method, url: `${BASE_URL}${urlPath}`, data, headers, timeout: TIMEOUT_MS });
}

/** Map a normalized upstream error onto the reason codes the page renders. */
function failureReason(normalized) {
  if (normalized.code === 'UPSTREAM_UNREACHABLE') return 'sidecar_unreachable';
  if (normalized.code === 'UPSTREAM_TIMEOUT') return 'upstream_timeout';
  if (normalized.upstreamStatus === 401 || normalized.upstreamStatus === 403) return 'auth_expired';
  return 'upstream_error';
}

function sendFailure(res, err) {
  const normalized = normalizeAxiosError(err, { label: 'NotebookLM', timeoutMs: TIMEOUT_MS });
  return res.status(503).json({
    error: 'NotebookLM unavailable',
    reason: failureReason(normalized),
  });
}

router.get('/notebooks', async (_req, res) => {
  try {
    const upstream = await callSidecar('/notebooks');
    const list = (upstream.data && upstream.data.notebooks) || [];
    return res.json({ notebooks: list.map((n) => ({ id: n.id, title: n.title })) });
  } catch (err) {
    return sendFailure(res, err);
  }
});

router.get('/notebooks/:id/sources', async (req, res) => {
  try {
    const upstream = await callSidecar(`/notebooks/${encodeURIComponent(req.params.id)}/sources`);
    const list = (upstream.data && upstream.data.sources) || [];
    return res.json({ sources: list.map((s) => ({ id: s.id, title: s.title })) });
  } catch (err) {
    return sendFailure(res, err);
  }
});

router.post('/ask', async (req, res) => {
  const { notebookId, question } = req.body || {};
  if (!notebookId || typeof notebookId !== 'string') {
    return res.status(400).json({ error: 'notebookId is required' });
  }
  if (!question || typeof question !== 'string' || !question.trim()) {
    return res.status(400).json({ error: 'question is required' });
  }

  try {
    const upstream = await callSidecar('/ask', {
      method: 'POST',
      data: { notebook_id: notebookId, question },
    });
    const body = upstream.data || {};
    const refs = Array.isArray(body.references) ? body.references : [];
    return res.json({
      answer: body.answer || '',
      references: refs.map((r) => ({
        citationNumber: r.citation_number,
        citedText: r.cited_text,
        url: resolveAgainst(r.cited_text, indexes()),
      })),
    });
  } catch (err) {
    return sendFailure(res, err);
  }
});

module.exports = router;
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd demo_api_server && CI=true npx jest tests/notebooklmRoutes.test.js --forceExit
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Mount the router in `server.js`**

Add beside the other authenticated `/api/*` mounts (near line 1061):

```js
app.use('/api/notebooklm', authenticateToken, require('./routes/notebooklmRoutes'));
```

- [ ] **Step 6: Re-run both suites**

```bash
cd demo_api_server && CI=true npx jest tests/notebooklmRoutes.test.js tests/notebooklmCitations.test.js --forceExit
```

Expected: PASS, 13 tests total.

- [ ] **Step 7: Commit**

```bash
git add demo_api_server/routes/notebooklmRoutes.js demo_api_server/tests/notebooklmRoutes.test.js demo_api_server/server.js
git commit -m "feat(notebooklm): read-only BFF proxy with named failure reasons"
```

---

### Task 3: `notebooklm` sidecar

**Files:**
- Create: `docker/notebooklm/Dockerfile`
- Modify: `docker-compose.yml` (new service)
- Modify: `demo_api_server/.env.example` (document the three new vars — the file exists and is the discoverability path for anyone provisioning a fresh checkout)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: a service named `notebooklm` reachable at `http://notebooklm:8000` on the compose network, which Task 2's `BASE_URL` default already points at.

- [ ] **Step 1: Write the Dockerfile**

Create `docker/notebooklm/Dockerfile`:

```dockerfile
# notebooklm-py REST server. Holds the host's Google session cookies via a bind
# mount, so it is never published to the host — internal compose network only.
FROM python:3.14-slim

RUN pip install --no-cache-dir 'notebooklm-py[server]==0.8.1'

# The server refuses to bind beyond loopback without this explicit opt-in.
ENV NOTEBOOKLM_SERVER_HOST=0.0.0.0 \
    NOTEBOOKLM_SERVER_PORT=8000 \
    NOTEBOOKLM_SERVER_ALLOW_EXTERNAL_BIND=1

EXPOSE 8000
CMD ["notebooklm-server"]
```

- [ ] **Step 2: Add the compose service**

In `docker-compose.yml`, alongside the other services:

```yaml
  notebooklm:
    build:
      context: .
      dockerfile: docker/notebooklm/Dockerfile
    container_name: ai-demo-notebooklm
    # NO ports: stanza. This container holds live Google session cookies and is
    # reachable only on the internal compose network.
    volumes:
      # rw — the keepalive rotates __Secure-1PSIDTS and must persist the jar.
      - ${HOME}/.notebooklm:/root/.notebooklm
      # ro — bundle text, needed only to resolve citations back to doc URLs.
      - ${HOME}/.cache/ping-docs:/bundles:ro
    env_file:
      # NOTEBOOKLM_SERVER_TOKEN lives here, never in an `environment:` entry —
      # `environment:` overrides env_file for the same key even when absent.
      - path: ./demo_api_server/.env
        required: true
    restart: unless-stopped
```

- [ ] **Step 3: Give the BFF the sidecar's address and token**

Add to the `demo-api-server` service's existing `env_file` target (`demo_api_server/.env`):

```bash
NOTEBOOKLM_URL=http://notebooklm:8000
PING_DOCS_BUNDLE_DIR=/bundles
NOTEBOOKLM_SERVER_TOKEN=<generate: openssl rand -hex 32>
```

Also mount the bundles read-only into `demo-api-server` so the BFF can resolve citations — add to its `volumes:`:

```yaml
      - ${HOME}/.cache/ping-docs:/bundles:ro
```

- [ ] **Step 4: Build and verify the sidecar is reachable, and NOT published**

```bash
docker compose up -d --build notebooklm
docker compose ps notebooklm
# Reachable from inside the network:
docker exec ai-demo-api-server node -e "fetch('http://notebooklm:8000/notebooks',{headers:{Authorization:'Bearer '+process.env.NOTEBOOKLM_SERVER_TOKEN}}).then(r=>console.log('status',r.status)).catch(e=>console.log('ERR',e.message))"
# NOT reachable from the host — this MUST fail:
curl -sS --max-time 5 http://localhost:8000/notebooks; echo "exit=$?"
```

Expected: the `docker exec` prints a status (200, or 401 if the token is wrong). The `curl` **must** fail to connect — if it succeeds, a `ports:` stanza leaked in and the cookie-holding container is exposed. Fix before continuing.

- [ ] **Step 5: Commit**

```bash
git add docker/notebooklm/Dockerfile docker-compose.yml
git commit -m "feat(notebooklm): internal-only sidecar running the notebooklm REST server"
```

---

### Task 4: The page

**Files:**
- Create: `demo_api_ui/src/pages/NotebookLmPage.jsx`
- Create: `demo_api_ui/src/pages/NotebookLmPage.css`
- Test: `demo_api_ui/src/pages/__tests__/NotebookLmPage.test.jsx`

**Interfaces:**
- Consumes: the three endpoints from Task 2.
- Produces: default-exported `NotebookLmPage` component, used by Task 5's route.

`InspectorShell` (from `../components/shared/InspectorShell`) takes props `{ title, statusOn, statusText, actions, fullHeight, banner, left, middle, right }` and owns only the column widths — the page manages its own selection, form, and tab state.

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/pages/__tests__/NotebookLmPage.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import NotebookLmPage from '../NotebookLmPage';

vi.mock('../../services/apiClient', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));
import apiClient from '../../services/apiClient';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('NotebookLmPage', () => {
  it('lists notebooks returned by the BFF', async () => {
    apiClient.get.mockResolvedValue({ data: { notebooks: [{ id: 'nb1', title: 'Ping Docs' }] } });
    render(<NotebookLmPage />);
    await waitFor(() => expect(screen.getByText('Ping Docs')).toBeInTheDocument());
  });

  it('names the cause when the sidecar is down instead of spinning', async () => {
    apiClient.get.mockRejectedValue({
      response: { status: 503, data: { error: 'NotebookLM unavailable', reason: 'sidecar_unreachable' } },
    });
    render(<NotebookLmPage />);
    await waitFor(() => expect(screen.getByText(/sidecar is not running/i)).toBeInTheDocument());
  });

  it('tells the user to sign in again when host auth expired', async () => {
    apiClient.get.mockRejectedValue({
      response: { status: 503, data: { error: 'NotebookLM unavailable', reason: 'auth_expired' } },
    });
    render(<NotebookLmPage />);
    await waitFor(() => expect(screen.getByText(/host auth expired/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd demo_api_ui && npx vitest run src/pages/__tests__/NotebookLmPage.test.jsx
```

Expected: FAIL — cannot resolve `../NotebookLmPage`.

- [ ] **Step 3: Write the page**

Create `demo_api_ui/src/pages/NotebookLmPage.jsx`:

```jsx
import React, { useCallback, useEffect, useState } from 'react';
import InspectorShell from '../components/shared/InspectorShell';
import apiClient from '../services/apiClient';
import './NotebookLmPage.css';

/**
 * NotebookLM docs oracle — read-only.
 *
 * The sidecar that backs this page holds host-local Google cookies, so it is
 * absent everywhere except a developer laptop. Unavailability is a normal
 * state, not an error: every failure names its cause rather than spinning.
 */

const REASON_TEXT = {
  sidecar_unreachable: 'The NotebookLM sidecar is not running.',
  auth_expired: 'Host auth expired — run `notebooklm login --browser chrome` on the host.',
  upstream_timeout: 'NotebookLM timed out.',
  upstream_error: 'NotebookLM returned an error.',
};

function reasonFor(err) {
  const reason = err && err.response && err.response.data && err.response.data.reason;
  return REASON_TEXT[reason] || 'NotebookLM is unavailable.';
}

export default function NotebookLmPage() {
  const [notebooks, setNotebooks] = useState([]);
  const [selected, setSelected] = useState(null);
  const [sources, setSources] = useState([]);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState(null);
  const [tab, setTab] = useState('answer');
  const [unavailable, setUnavailable] = useState(null);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get('/api/notebooklm/notebooks')
      .then((res) => {
        if (cancelled) return;
        setNotebooks((res.data && res.data.notebooks) || []);
        setUnavailable(null);
      })
      .catch((err) => {
        if (!cancelled) setUnavailable(reasonFor(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectNotebook = useCallback((nb) => {
    setSelected(nb);
    setSources([]);
    apiClient
      .get(`/api/notebooklm/notebooks/${encodeURIComponent(nb.id)}/sources`)
      .then((res) => setSources((res.data && res.data.sources) || []))
      .catch((err) => setUnavailable(reasonFor(err)));
  }, []);

  const ask = useCallback(
    (event) => {
      event.preventDefault();
      if (!selected || !question.trim()) return;
      setAsking(true);
      setAnswer(null);
      apiClient
        .post('/api/notebooklm/ask', { notebookId: selected.id, question })
        .then((res) => {
          setAnswer(res.data);
          setTab('answer');
          setUnavailable(null);
        })
        .catch((err) => setUnavailable(reasonFor(err)))
        .finally(() => setAsking(false));
    },
    [selected, question],
  );

  const left = (
    <nav className="nlm-tree" aria-label="Notebooks">
      {notebooks.map((nb) => (
        <button
          key={nb.id}
          type="button"
          className={`nlm-tree-item${selected && selected.id === nb.id ? ' is-selected' : ''}`}
          onClick={() => selectNotebook(nb)}
        >
          {nb.title}
        </button>
      ))}
      {selected && sources.length > 0 && (
        <ul className="nlm-sources">
          {sources.map((s) => (
            <li key={s.id}>{s.title}</li>
          ))}
        </ul>
      )}
    </nav>
  );

  const middle = (
    <form className="nlm-ask" onSubmit={ask}>
      <label className="nlm-label" htmlFor="nlm-question">
        Question
      </label>
      <textarea
        id="nlm-question"
        className="nlm-input"
        rows={5}
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="What is the agentless MCP gateway?"
      />
      <button type="submit" className="nlm-submit" disabled={!selected || asking}>
        {asking ? 'Asking…' : 'Ask'}
      </button>
    </form>
  );

  const right = (
    <div className="nlm-output">
      <div className="nlm-tabs" role="tablist">
        {['answer', 'sources', 'raw'].map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            className={`nlm-tab${tab === name ? ' is-active' : ''}`}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </div>

      {tab === 'answer' && answer && (
        <div className="nlm-answer">
          <p className="nlm-answer-text">{answer.answer}</p>
          <ol className="nlm-refs">
            {(answer.references || []).map((r) => (
              <li key={r.citationNumber}>
                {r.url ? (
                  <a href={r.url} target="_blank" rel="noreferrer">
                    {r.url}
                  </a>
                ) : (
                  <span className="nlm-ref-unresolved">source page not identified</span>
                )}
                <span className="nlm-ref-excerpt">{r.citedText}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {tab === 'sources' && (
        <ul className="nlm-source-list">
          {sources.map((s) => (
            <li key={s.id}>{s.title}</li>
          ))}
        </ul>
      )}

      {tab === 'raw' && <pre className="nlm-raw">{JSON.stringify(answer, null, 2)}</pre>}
    </div>
  );

  return (
    <InspectorShell
      title="NotebookLM Docs Oracle"
      statusOn={!unavailable}
      statusText={unavailable ? 'Unavailable' : 'Connected'}
      banner={unavailable ? <div className="nlm-unavailable">{unavailable}</div> : null}
      left={left}
      middle={middle}
      right={right}
    />
  );
}
```

- [ ] **Step 4: Write the stylesheet**

Create `demo_api_ui/src/pages/NotebookLmPage.css`. Every colour is a `--th-*` token, dark mode is `:root[data-theme="dark"]` only, and no font-size goes below the 10px floor:

Every token below was checked against the tokens this repo actually defines.
The families are `--th-text*`, `--th-bg-*`, `--th-border*`, `--th-code-*`, and
`--th-status-{error,info,success,warning}` with `-bg`/`-border`/`-text` variants.
There is no `--th-accent`, `--th-link`, or `--th-surface-N` in this codebase —
`--th-status-info` and `--th-bg-*` carry those roles.

```css
/* NotebookLM docs oracle. Tokens only — no literals, no prefers-color-scheme. */
.nlm-tree { display: flex; flex-direction: column; gap: 2px; }

.nlm-tree-item {
  text-align: left;
  padding: 6px 10px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--th-text);
  font-size: var(--font-size-sm);
  cursor: pointer;
}
.nlm-tree-item:hover { background: var(--th-bg-hover); }
.nlm-tree-item.is-selected { background: var(--th-bg-emphasis); color: var(--th-text-on-emphasis); }

.nlm-sources { margin: 6px 0 0 10px; padding-left: 12px; color: var(--th-text-muted); font-size: var(--font-size-xs); }

.nlm-ask { display: flex; flex-direction: column; gap: 8px; padding: 12px; }
.nlm-label { color: var(--th-text-muted); font-size: var(--font-size-xs); }
.nlm-input {
  width: 100%;
  padding: 8px;
  border: 1px solid var(--th-border);
  border-radius: 4px;
  background: var(--th-bg-card);
  color: var(--th-text);
  font-size: var(--font-size-sm);
}
.nlm-submit {
  align-self: flex-start;
  padding: 6px 14px;
  border: 1px solid var(--th-border-strong);
  border-radius: 4px;
  background: var(--th-bg-emphasis);
  color: var(--th-text-on-emphasis);
  font-size: var(--font-size-sm);
  cursor: pointer;
}
.nlm-submit:disabled { opacity: 0.5; cursor: not-allowed; }

.nlm-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--th-border); }
.nlm-tab {
  padding: 6px 12px;
  border: none;
  background: transparent;
  color: var(--th-text-muted);
  font-size: var(--font-size-xs);
  cursor: pointer;
}
.nlm-tab.is-active { color: var(--th-text); border-bottom: 2px solid var(--th-status-info); }

.nlm-answer { padding: 12px; }
.nlm-answer-text { color: var(--th-text); font-size: var(--font-size-sm); white-space: pre-wrap; }
.nlm-refs { margin-top: 12px; padding-left: 18px; color: var(--th-text-muted); font-size: var(--font-size-xs); }
.nlm-refs a { color: var(--th-status-info); }
.nlm-ref-unresolved { color: var(--th-text-faint); font-style: italic; }
.nlm-ref-excerpt { display: block; margin-top: 2px; color: var(--th-text-muted); font-size: var(--font-size-2xs); }

.nlm-raw {
  padding: 12px;
  overflow-x: auto;
  color: var(--th-code-text);
  background: var(--th-code-bg);
  font-size: var(--font-size-xs);
}

.nlm-unavailable {
  padding: 8px 12px;
  border: 1px solid var(--th-status-warning-border);
  border-radius: 4px;
  background: var(--th-status-warning-bg);
  color: var(--th-status-warning-text);
  font-size: var(--font-size-sm);
}
```

Re-confirm before committing (all should print OK; the smallest font-size used
is `--font-size-2xs`, safely above the 10px `--font-size-3xs` floor):

```bash
cd demo_api_ui/src && for t in th-text th-text-muted th-text-faint th-text-on-emphasis th-bg-card th-bg-hover th-bg-emphasis th-border th-border-strong th-code-bg th-code-text th-status-info th-status-warning-bg th-status-warning-border th-status-warning-text font-size-2xs font-size-xs font-size-sm; do
  printf '%-26s ' "$t"; grep -rqs -- "--$t:" . && echo OK || echo MISSING; done
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd demo_api_ui && npx vitest run src/pages/__tests__/NotebookLmPage.test.jsx
```

Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/pages/NotebookLmPage.jsx demo_api_ui/src/pages/NotebookLmPage.css demo_api_ui/src/pages/__tests__/NotebookLmPage.test.jsx
git commit -m "feat(notebooklm): docs-oracle page on InspectorShell"
```

---

### Task 5: Nav wiring — all three SoTs plus the route guard

Adding a page touches three files that must agree. `navStructureCatalog.drift.test.js` fails the build if they do not, and `npm run authz:verify` fails if the route is missing from `auth-requirements.json`.

**Files:**
- Modify: `demo_api_server/config/auth-requirements.json` (`routes` object)
- Modify: `demo_api_ui/src/config/navStructureCatalog.js`
- Modify: `demo_api_ui/src/components/AdminSideNav.jsx`
- Modify: `demo_api_ui/src/App.js`

**Interfaces:**
- Consumes: `NotebookLmPage` from Task 4.
- Produces: the route `/notebooklm`, admin-gated.

- [ ] **Step 1: Add the route to the authorization SoT**

In `demo_api_server/config/auth-requirements.json`, add to the `routes` object (keys are sorted — place it alphabetically):

```json
    "/notebooklm": "admin",
```

- [ ] **Step 2: Add the label to the nav catalog**

In `demo_api_ui/src/config/navStructureCatalog.js`, add to the `AI Flows` group's `children` array:

```js
      "NotebookLM Docs Oracle",
```

- [ ] **Step 3: Add the rendered nav entry**

In `demo_api_ui/src/components/AdminSideNav.jsx`, inside the `AI Flows` group's `children` (near line 523), add an entry matching the surrounding `{ label, path, icon }` shape. The `label` must match Step 2's string exactly or the drift test fails:

```jsx
        {
          label: "NotebookLM Docs Oracle",
          path: "/notebooklm",
          icon: "agt",
        },
```

- [ ] **Step 4: Add the guarded route**

In `demo_api_ui/src/App.js`, add the import beside the other page imports (near line 142):

```jsx
import NotebookLmPage from "./pages/NotebookLmPage";
```

and the route beside the other guarded routes (the `/control-plane` block near line 828 is the pattern):

```jsx
                {/* NotebookLM Docs Oracle — admin only; backed by a host-local sidecar. */}
                <Route
                  path="/notebooklm"
                  element={
                    loading ? null : user ? (
                      <>
                        <TopNav user={user} onLogout={logout} />
                        <main className="main-content">
                          <NotebookLmPage />
                        </main>
                      </>
                    ) : (
                      <SignInRequired />
                    )
                  }
                />
```

- [ ] **Step 5: Run the guards that enforce agreement**

```bash
cd demo_api_ui && npx vitest run src/config/__tests__/navStructureCatalog.drift.test.js
cd .. && npm run authz:verify
```

Expected: both PASS. A drift failure names the SoT that disagrees — fix the label rather than editing the test.

- [ ] **Step 6: Run the full scoped verification**

```bash
cd demo_api_ui && npm run test:unit && npm run build
cd ../demo_api_server && CI=true npx jest tests/notebooklmRoutes.test.js tests/notebooklmCitations.test.js --forceExit
cd .. && npm run authz:verify
```

Expected: UI unit suite green, **`npm run build` green — the build is the gate, a green test run is not enough**, BFF 13 tests pass, authz verify passes.

- [ ] **Step 7: Commit**

```bash
git add demo_api_server/config/auth-requirements.json demo_api_ui/src/config/navStructureCatalog.js demo_api_ui/src/components/AdminSideNav.jsx demo_api_ui/src/App.js
git commit -m "feat(notebooklm): add admin-gated /notebooklm route to all three nav SoTs"
```

---

## Definition of done

From the spec, verified manually against the running stack after Task 5:

1. `/notebooklm` lists the `Ping Docs — privilege` notebook and its source.
2. Asking "what is the agentless MCP gateway?" returns an answer with at least one citation linking to a real `docs.pingidentity.com` URL.
3. `docker compose stop notebooklm` makes the page render **"The NotebookLM sidecar is not running."** — not a spinner, not fabricated data.
4. `curl http://localhost:8000/notebooks` from the host fails to connect.

Pin the stack generation around any live UI drive, or another session recreating the containers mid-run will look like an application bug:

```bash
gen="$(npm run -s stack:generation)"   # … drive the UI …
npm run -s stack:generation -- --check "$gen"
```

## Deferred

Running this on the SE cluster needs the Google cookies as a Kubernetes secret plus a keepalive CronJob. Out of scope — the sidecar shape was chosen over a host-only bridge specifically to keep that path open.
