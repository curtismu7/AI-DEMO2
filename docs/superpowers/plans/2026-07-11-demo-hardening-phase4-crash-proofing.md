# Demo Hardening Phase 4 — Crash-Proofing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A crash or hang in any LLM-path service self-recovers without killing a live demo — and the presenter can see trouble before the audience does.

**Architecture:** Small, surgical changes at verified crash points: a `CRASH_GUARD` escape hatch for the BFF's dev-mode `unhandledRejection` hard-exit (the SE k8s cluster deliberately runs the BFF with `NODE_ENV=development`, so today one stray rejection restarts the pod mid-demo), a self-mending prompt store with health surfacing, an extended `/api/health/services` aggregate (llama-proxy probe + prompt status), a presenter-only health dot in AgentDemoGuide's existing presenter mode, and a Dockerfile HEALTHCHECK for the one LLM-path image missing one.

**Tech Stack:** Node.js CommonJS (BFF), TypeScript + jest (agent service), React + vitest (UI), YAML (k8s/compose).

**Spec:** `docs/superpowers/specs/2026-07-11-demo-hardening-design.md` (Phase 4 section).

**Documented deviations from the spec (verified against current code):**
1. **run.sh respawn supervisor + watchdog: DEFERRED.** The primary demo runtime is now the Ping SE AWS k8s cluster, where liveness/readiness probes already exist on the LLM-path deployments (e.g. `k8s/20-api-server-deployment.yaml:92-105`) and restart dead *and hung* pods; Docker gets the same from `restart: unless-stopped` + Dockerfile HEALTHCHECKs. A native run.sh supervisor would require refactoring 12 inline launch blocks (`run.sh:1326-1575`) on the primary local launcher — high regression risk for the now-secondary runtime. run.sh gets only the `CRASH_GUARD` env (Task 2). Revisit if native-launch demos become primary again.
2. **Docker compose healthchecks: mostly already exist.** `demo_agent_service/Dockerfile:30` and `demo_mcp_gateway/Dockerfile:48` already declare HEALTHCHECK instructions (compose honors them); `demo_api_server/Dockerfile:65` and compose `demo-api-server` (docker-compose.yml:239-245) both have them. Only `demo_llm_proxy` lacks one (Task 6).
3. **Aggregate endpoint reuses `GET /api/health/services`** (`demo_api_server/routes/health.js:484-524`) instead of creating a new `/api/demo/health` — it already probes 4 of the needed services, is unauthenticated, has no current UI consumers (additive changes are safe), and `/api/health/*` is already excluded from API-Explorer tracking (`server.js:607-610` — `req.path` under the `/api` mount starts with `/health`).

## Global Constraints

- Emoji allowlist (REGRESSION_PLAN §0): only `⚠️` `✅` `❌` `🔐` `✕` `✓` in skills, commands, code, and UI text.
- Minimal diff: name the component, name the element, change only that.
- Work in the worktree; stage explicitly (`git add <files>`, never `-A`); verify `git branch --show-current` before each commit.
- No OAuth/permission scope changes.
- BFF jest runs from `demo_api_server/`; in a `.claude/worktrees/` checkout EVERY jest command must append `--testPathIgnorePatterns='/node_modules/'` (repo config ignores worktree paths; 0 matches is NOT a pass). Agent-service jest runs from `demo_agent_service/` (same flag rule). UI tests: `cd demo_api_ui && npx vitest run <file>`.
- `demo_api_ui` is a REGRESSION_PLAN §1 protected area — the UI task (Task 5) touches only the two new files plus a 2-line mount in AgentDemoGuide.jsx; invoke the repo's `regression-guard` skill before editing it.
- Do not change the existing behavior of `/api/health/services` for its current fields — additions only.
- `uncaughtException` handling stays exactly as-is (`process.exit(1)`) — supervision (k8s/Docker) owns recovery for corrupted-state crashes.

---

### Task 1: `crashGuard` helper + BFF `unhandledRejection` wiring

**Files:**
- Create: `demo_api_server/utils/crashGuard.js`
- Modify: `demo_api_server/server.js:2048-2056` (the `unhandledRejection` handler block only; `uncaughtException` below it stays untouched)
- Test: `demo_api_server/src/__tests__/crashGuard.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `shouldHardExitOnUnhandledRejection(env = process.env) => boolean` — false when `env.NODE_ENV === 'production'` OR `env.CRASH_GUARD === '1'`; true otherwise. Task 2 sets `CRASH_GUARD=1` in the demo runtimes.

- [ ] **Step 1: Write the failing test**

```js
// demo_api_server/src/__tests__/crashGuard.test.js
'use strict';

const { shouldHardExitOnUnhandledRejection } = require('../../utils/crashGuard');

describe('shouldHardExitOnUnhandledRejection', () => {
  it('does not exit in production (WR-21, unchanged behavior)', () => {
    expect(shouldHardExitOnUnhandledRejection({ NODE_ENV: 'production' })).toBe(false);
  });

  it('does not exit when CRASH_GUARD=1 (demo runs in development mode)', () => {
    expect(shouldHardExitOnUnhandledRejection({ NODE_ENV: 'development', CRASH_GUARD: '1' })).toBe(false);
    expect(shouldHardExitOnUnhandledRejection({ CRASH_GUARD: '1' })).toBe(false);
  });

  it('exits in dev/test without the flag (bugs still surface loudly)', () => {
    expect(shouldHardExitOnUnhandledRejection({ NODE_ENV: 'development' })).toBe(true);
    expect(shouldHardExitOnUnhandledRejection({ NODE_ENV: 'test' })).toBe(true);
    expect(shouldHardExitOnUnhandledRejection({})).toBe(true);
  });

  it('only the exact string "1" arms the guard', () => {
    expect(shouldHardExitOnUnhandledRejection({ CRASH_GUARD: 'true' })).toBe(true);
    expect(shouldHardExitOnUnhandledRejection({ CRASH_GUARD: '' })).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest --forceExit --testPathPattern=crashGuard --testPathIgnorePatterns='/node_modules/'`
Expected: FAIL with "Cannot find module '../../utils/crashGuard'"

- [ ] **Step 3: Write the implementation**

```js
// demo_api_server/utils/crashGuard.js
/**
 * WR-21 + demo-hardening Phase 4: decide whether an unhandledRejection should
 * hard-exit the BFF. Production always logs-and-continues. CRASH_GUARD=1 gives
 * demo runs the same resilience — required because every demo runtime (run.sh,
 * docker-compose, SE k8s) deliberately runs NODE_ENV=development so the
 * simulated Authorize service loads (see k8s/20-api-server-deployment.yaml).
 * Dev/test without the flag keeps the hard exit so bugs surface loudly.
 */
'use strict';

function shouldHardExitOnUnhandledRejection(env = process.env) {
  if (env.NODE_ENV === 'production') return false;
  if (env.CRASH_GUARD === '1') return false;
  return true;
}

module.exports = { shouldHardExitOnUnhandledRejection };
```

- [ ] **Step 4: Wire it into server.js**

Replace the current handler (`demo_api_server/server.js:2048-2056`):

```js
// WR-21: In production, transient background rejections (startup validators,
// audit loggers, etc.) must not crash the server. Log and continue.
// In development/test keep the hard exit so bugs surface loudly.
process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', reason);
    if (process.env.NODE_ENV !== 'production') {
        process.exit(1);
    }
});
```

with:

```js
// WR-21: In production, transient background rejections (startup validators,
// audit loggers, etc.) must not crash the server. Log and continue.
// Demo runtimes run NODE_ENV=development (simulated Authorize requires it) and
// set CRASH_GUARD=1 to get the same log-and-continue — otherwise one stray
// rejection restarts the BFF mid-demo. Dev/test without the flag keep the hard
// exit so bugs surface loudly. Decision logic: utils/crashGuard.js.
const { shouldHardExitOnUnhandledRejection } = require('./utils/crashGuard');
process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', reason);
    if (shouldHardExitOnUnhandledRejection()) {
        process.exit(1);
    }
});
```

- [ ] **Step 5: Run tests**

Run: `cd demo_api_server && npx jest --forceExit --testPathPattern=crashGuard --testPathIgnorePatterns='/node_modules/'`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/utils/crashGuard.js demo_api_server/src/__tests__/crashGuard.test.js demo_api_server/server.js
git commit -m "feat(bff): CRASH_GUARD keeps demo runs alive through unhandled rejections"
```

---

### Task 2: Set `CRASH_GUARD=1` in all three demo runtimes

**Files:**
- Modify: `k8s/20-api-server-deployment.yaml:38-40` (env list, right after the `NODE_ENV: development` entry)
- Modify: `docker-compose.yml:79-80` (the `demo-api-server` service's `environment:` map, next to `NODE_ENV: development`)
- Modify: `run.sh:1341` (the BFF launch env block, next to `BFF_DEV`)

**Interfaces:**
- Consumes: `CRASH_GUARD === '1'` semantics from Task 1.
- Produces: all three runtimes launch the BFF with `CRASH_GUARD=1`.

- [ ] **Step 1: k8s deployment**

In `k8s/20-api-server-deployment.yaml`, the env list currently starts:

```yaml
        env:
        - name: NODE_ENV
          value: "development"
```

Add immediately after the `NODE_ENV` entry:

```yaml
        # Demo hardening Phase 4: with NODE_ENV=development (required by the
        # simulated Authorize service), CRASH_GUARD=1 makes unhandled rejections
        # log-and-continue instead of restarting the pod mid-demo.
        # Decision logic: demo_api_server/utils/crashGuard.js.
        - name: CRASH_GUARD
          value: "1"
```

- [ ] **Step 2: docker-compose**

In `docker-compose.yml`, the `demo-api-server` service's `environment:` map currently starts:

```yaml
    environment:
      NODE_ENV: development
```

Add immediately after the `NODE_ENV: development` line:

```yaml
      # Phase 4 crash guard: unhandled rejections log-and-continue in demo runs
      # (see demo_api_server/utils/crashGuard.js).
      CRASH_GUARD: "1"
```

- [ ] **Step 3: run.sh**

In the BFF launch block (`run.sh` around line 1341), the env assignments end with:

```bash
  VAULT_PASSWORD="${VAULT_PASSWORD:-}" \
  VAULT_PATH="${VAULT_PATH:-}" \
  BFF_DEV="${BFF_DEV:-0}" \
  nohup bash -c 'if [[ "${BFF_DEV:-0}" == "1" ]]; then exec npm run dev; else exec npm start; fi' > "${LOG_API}" 2>&1
```

Add one line before `BFF_DEV`:

```bash
  CRASH_GUARD="${CRASH_GUARD:-1}" \
```

(`:-1` default keeps the guard on for demos while letting a developer run `CRASH_GUARD=0 ./run.sh` to get loud exits while debugging.)

- [ ] **Step 4: Verify all three**

```bash
grep -A1 'name: CRASH_GUARD' k8s/20-api-server-deployment.yaml
docker compose config 2>/dev/null | grep -A1 'CRASH_GUARD' | head -3
bash -n run.sh && grep -n 'CRASH_GUARD' run.sh
```

Expected: k8s shows `value: "1"`; compose config renders `CRASH_GUARD: "1"` under demo-api-server; `bash -n` exits 0 and grep shows the new line. (If `docker compose config` fails because the env_file `demo_api_server/.env` is absent in the worktree, note it and validate with `python3 -c "import yaml,sys; yaml.safe_load(open('docker-compose.yml'))"` instead.)

- [ ] **Step 5: Commit**

```bash
git add k8s/20-api-server-deployment.yaml docker-compose.yml run.sh
git commit -m "feat(runtimes): arm CRASH_GUARD=1 for the BFF in k8s, compose, and run.sh"
```

---

### Task 3: promptStore self-mend + status surfaced in agent-service health

**Files:**
- Modify: `demo_agent_service/src/promptStore.ts` (add src-fallback tier + status tracking)
- Modify: `demo_agent_service/src/index.ts:83-92` (health route `checks`)
- Test: `demo_agent_service/src/__tests__/promptStore.fallback.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `getPromptStoreStatus() => { source: 'primary' | 'src_fallback' | 'inline_fallback' }` exported from `promptStore.ts`; agent-service `GET /health` gains `checks.prompts` with that source string. Task 4 passes `checks` through the BFF aggregate.

**Why:** today a `tsc`-only build (no `copy:assets`) silently drops `dist/prompts/` — the agent loses its curated guardrail prompt and runs on a one-line inline prompt, with only a console.error to show for it (`promptStore.ts:75-81`). This task makes it self-mend by reading `src/prompts/` directly, and makes the degradation visible to health checks.

- [ ] **Step 1: Write the failing test**

Module-level state (`_cache`, worst-seen source) requires a fresh module per test — use `jest.isolateModules` + `jest.mock('fs')`.

```ts
// demo_agent_service/src/__tests__/promptStore.fallback.test.ts
jest.mock('fs');

import { existsSync, readFileSync } from 'fs';

const mockExists = existsSync as jest.MockedFunction<typeof existsSync>;
const mockRead = readFileSync as jest.MockedFunction<typeof readFileSync>;

// Load a fresh promptStore instance (fresh cache + status) per test.
function freshStore() {
  let store: typeof import('../promptStore');
  jest.isolateModules(() => {
    store = require('../promptStore');
  });
  return store!;
}

describe('promptStore fallback ladder', () => {
  beforeEach(() => {
    mockExists.mockReset();
    mockRead.mockReset();
  });

  it('primary: reads from dist prompts dir and reports source primary', () => {
    mockExists.mockImplementation((p) => String(p).endsWith('default.json'));
    mockRead.mockReturnValue(JSON.stringify({ system: 'curated' }) as never);
    const store = freshStore();
    expect(store.getPrompt('default').system).toBe('curated');
    expect(store.getPromptStoreStatus().source).toBe('primary');
  });

  it('src_fallback: dist prompts missing, self-mends from src/prompts and reports it', () => {
    // Nothing under the compiled prompts dir; the src fallback dir has default.json.
    mockExists.mockImplementation((p) => {
      const s = String(p);
      return s.includes(`${'src'}`) && s.endsWith('default.json') && s.includes('prompts');
    });
    mockRead.mockReturnValue(JSON.stringify({ system: 'curated-from-src' }) as never);
    const store = freshStore();
    expect(store.getPrompt('default').system).toBe('curated-from-src');
    expect(store.getPromptStoreStatus().source).toBe('src_fallback');
  });

  it('inline_fallback: nothing anywhere — minimal prompt, status inline_fallback', () => {
    mockExists.mockReturnValue(false);
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const store = freshStore();
    expect(store.getPrompt('default').system).toBe('You are a helpful banking assistant.');
    expect(store.getPromptStoreStatus().source).toBe('inline_fallback');
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('status is worst-seen: a later primary hit does not clear a degraded status', () => {
    mockExists.mockReturnValue(false);
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const store = freshStore();
    store.getPrompt('default'); // inline_fallback
    mockExists.mockImplementation((p) => String(p).endsWith('banking.json'));
    mockRead.mockReturnValue(JSON.stringify({ system: 'x' }) as never);
    store.getPrompt('banking'); // primary hit
    expect(store.getPromptStoreStatus().source).toBe('inline_fallback');
    errSpy.mockRestore();
  });
});
```

Note for the implementer: the `src_fallback` test's `existsSync` mock must return true ONLY for paths inside the src fallback dir. If the path predicate above is too loose against the real constants (both dirs end in `prompts/default.json` under ts-jest where `__dirname` is already `src/`), adjust the predicate to key off the exact constants: the primary dir is `join(__dirname, 'prompts')` from the module's perspective, and the src fallback dir is `resolve(join(__dirname, '..', 'src', 'prompts'))`. Under ts-jest both resolve to the same directory — in that case have the mock return false for the FIRST TWO existsSync calls (useCase + default in primary dir) and true for the third (first src-fallback probe), which is deterministic regardless of path text:

```ts
    let calls = 0;
    mockExists.mockImplementation(() => { calls += 1; return calls >= 3; });
```

Use whichever variant makes the test deterministic; assert the returned prompt text and the `src_fallback` status either way.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_agent_service && npx jest --forceExit --testPathPattern=promptStore.fallback --testPathIgnorePatterns='/node_modules/'`
Expected: FAIL — `getPromptStoreStatus` is not exported (and the src-fallback case returns the inline prompt).

- [ ] **Step 3: Implement in promptStore.ts**

Add after the `RESOLVED_PROMPTS_DIR` constant (`promptStore.ts:21`):

```ts
// Phase 4 self-mend: when dist/prompts is missing (tsc-only build skipped
// copy:assets), read the repo source prompts directly so the curated
// guardrails survive. From dist/ this resolves to <pkg>/src/prompts; under
// ts-node/ts-jest (__dirname = src/) it harmlessly equals PROMPTS_DIR.
const SRC_FALLBACK_DIR = resolve(join(__dirname, '..', 'src', 'prompts'));

type PromptSource = 'primary' | 'src_fallback' | 'inline_fallback';
const SOURCE_RANK: Record<PromptSource, number> = { primary: 0, src_fallback: 1, inline_fallback: 2 };
let _worstSource: PromptSource = 'primary';

function noteSource(s: PromptSource): void {
  if (SOURCE_RANK[s] > SOURCE_RANK[_worstSource]) _worstSource = s;
}

/** Worst prompt source seen since boot — surfaced via GET /health checks.prompts. */
export function getPromptStoreStatus(): { source: PromptSource } {
  return { source: _worstSource };
}
```

Then insert the self-mend tier between the `default.json` miss and the inline fallback — i.e. immediately before the existing `console.error` block (`promptStore.ts:71-81`):

```ts
  // Self-mend: dist/prompts missing — read the repo source prompts directly
  // so the curated guardrails survive; mark status degraded for health checks.
  for (const name of [`${useCase}.json`, 'default.json']) {
    const srcPath = join(SRC_FALLBACK_DIR, name);
    if (existsSync(srcPath)) {
      console.warn(
        `[promptStore] ⚠️  dist/prompts missing — self-mended from ${srcPath}. ` +
          `Run 'npm run build' (copy:assets) to restore the packaged prompts.`,
      );
      noteSource('src_fallback');
      const def: PromptDefinition = JSON.parse(readFileSync(srcPath, 'utf8'));
      _cache.set(useCase, def);
      return def;
    }
  }
```

Finally add `noteSource('inline_fallback');` on the line immediately before the existing `return { system: 'You are a helpful banking assistant.' };` at the end of `getPrompt`.

- [ ] **Step 4: Surface in the health route**

In `demo_agent_service/src/index.ts`, add to the existing promptStore import (or add an import if none exists in that file):

```ts
import { getPromptStoreStatus } from './promptStore';
```

and change the health route's `checks` (currently `checks: { env: 'ok' }` at `index.ts:88-90`):

```ts
    checks: {
      env: 'ok',
      prompts: getPromptStoreStatus().source,
    },
```

- [ ] **Step 5: Run the agent-service suite**

Run: `cd demo_agent_service && npx jest --forceExit --testPathIgnorePatterns='/node_modules/'`
Expected: PASS — new fallback tests plus all existing suites (config, agentRunHandler.disconnect, correlationContext, googleProvider, greatBuyChips, etc.). Then `npx tsc --noEmit` — clean.

- [ ] **Step 6: Commit**

```bash
git add demo_agent_service/src/promptStore.ts demo_agent_service/src/index.ts demo_agent_service/src/__tests__/promptStore.fallback.test.ts
git commit -m "feat(agent): promptStore self-mends from src/prompts and reports status via /health"
```

---

### Task 4: Extend `GET /api/health/services` — llm-proxy probe + agent checks passthrough

**Files:**
- Modify: `demo_api_server/routes/health.js:484-524` (the `/services` route only)
- Test: `demo_api_server/routes/__tests__/healthServices.test.js`

**Interfaces:**
- Consumes: agent-service `checks.prompts` from Task 3 (tolerates its absence — older agent builds simply omit it).
- Produces: response `services` gains `llm_proxy: { up, error? }`; `services.agent_service` gains `checks` (the agent's `/health` checks object) when available. Existing fields unchanged; route still always returns 200. Task 5 consumes this shape.

- [ ] **Step 1: Write the failing test**

```js
// demo_api_server/routes/__tests__/healthServices.test.js
'use strict';

jest.mock('axios');
const axios = require('axios');
const request = require('supertest');
const express = require('express');
const router = require('../health');

const app = express();
app.use('/api/health', router);

describe('GET /api/health/services', () => {
  beforeEach(() => axios.get.mockReset());

  it('reports llm_proxy up and passes agent checks through', async () => {
    axios.get.mockImplementation(async (url) => {
      if (url.startsWith('http://localhost:3006')) {
        return { data: { status: 'ok', checks: { env: 'ok', prompts: 'primary' } } };
      }
      return { data: { status: 'ok' } };
    });

    const res = await request(app).get('/api/health/services').expect(200);
    expect(res.body.services.llm_proxy).toEqual({ up: true });
    expect(res.body.services.agent_service.up).toBe(true);
    expect(res.body.services.agent_service.checks).toEqual({ env: 'ok', prompts: 'primary' });
    // Pre-existing fields unchanged
    expect(res.body.services.mcp_gateway.up).toBe(true);
    expect(res.body.services.mcp_server.up).toBe(true);
    expect(res.body.services.hitl_service.up).toBe(true);
  });

  it('reports llm_proxy down without failing the request', async () => {
    axios.get.mockImplementation(async (url) => {
      if (url.includes(':8090')) {
        const err = new Error('connect ECONNREFUSED');
        err.code = 'ECONNREFUSED';
        throw err;
      }
      return { data: { status: 'ok' } };
    });

    const res = await request(app).get('/api/health/services').expect(200);
    expect(res.body.services.llm_proxy.up).toBe(false);
    expect(res.body.services.llm_proxy.error).toBe('ECONNREFUSED');
  });

  it('tolerates an agent health payload without checks (older builds)', async () => {
    axios.get.mockResolvedValue({ data: { status: 'ok' } });
    const res = await request(app).get('/api/health/services').expect(200);
    expect(res.body.services.agent_service.up).toBe(true);
    expect(res.body.services.agent_service.checks).toBeUndefined();
  });
});
```

Note: the mocked `axios.get` rejects with a plain error, so the probe's http→https fallback fires for `http://` URLs — mock accordingly (the implementation retries `https://…:8090/health` once; make the `:8090` matcher cover both schemes, as `url.includes(':8090')` does).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest --forceExit --testPathPattern=healthServices --testPathIgnorePatterns='/node_modules/'`
Expected: FAIL — `services.llm_proxy` undefined, `agent_service.checks` undefined.

- [ ] **Step 3: Implement**

In `demo_api_server/routes/health.js`, modify the `/services` route. Change the `probe` helper to optionally capture the target's `checks` (both success branches):

```js
  // Probe a base URL's /health, trying https as a fallback for mkcert dev TLS.
  // withChecks: include the target's health `checks` object in the result
  // (used for the agent service's prompt-store status).
  const probe = async (baseUrl, { withChecks = false } = {}) => {
    if (!baseUrl) return { up: false, error: 'not_configured' };
    const base = baseUrl
      .replace(/^ws:\/\//, 'http://')
      .replace(/^wss:\/\//, 'https://')
      .replace(/\/$/, '');
    const ok = (resp) => (withChecks && resp?.data?.checks)
      ? { up: true, checks: resp.data.checks }
      : { up: true };
    try {
      const resp = await axios.get(`${base}/health`, { timeout: 2500, httpsAgent: _devHttpsAgent });
      return ok(resp);
    } catch (e) {
      if (base.startsWith('http://')) {
        try {
          const resp = await axios.get(`${base.replace('http://', 'https://')}/health`, { timeout: 2500, httpsAgent: _devHttpsAgent });
          return ok(resp);
        } catch (e2) {
          return { up: false, error: e2.code || e2.message };
        }
      }
      return { up: false, error: e.code || e.message };
    }
  };
```

Extend the probe fan-out and response (llm-proxy origin mirrors the BFF's LLM plumbing env: `LLAMACPP_BASE_URL`, default `http://localhost:8090` — same default as `demo_api_server/services/llamacppLlmService.js`):

```js
  const [mcpGateway, mcpServer, hitl, agent, llmProxy] = await Promise.all([
    probe(process.env.MCP_GATEWAY_HTTP_URL || 'http://localhost:3005'),
    probe((process.env.MCP_SERVER_URL || 'http://localhost:8080')),
    probe(process.env.HITL_SERVICE_URL || 'http://localhost:3009'),
    probe(process.env.AGENT_SERVICE_URL || 'http://localhost:3006', { withChecks: true }),
    probe(process.env.LLM_PROXY_URL || process.env.LLAMACPP_BASE_URL || 'http://localhost:8090'),
  ]);

  return res.status(200).json({
    services: {
      mcp_gateway: mcpGateway,
      mcp_server: mcpServer,
      hitl_service: hitl,
      agent_service: agent,
      llm_proxy: llmProxy,
    },
    timestamp: new Date().toISOString(),
  });
```

- [ ] **Step 4: Run the tests**

Run: `cd demo_api_server && npx jest --forceExit --testPathPattern='healthServices|health' --testPathIgnorePatterns='/node_modules/'`
Expected: PASS (new suite plus any existing health-related suites).

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/routes/health.js demo_api_server/routes/__tests__/healthServices.test.js
git commit -m "feat(health): /api/health/services probes llm-proxy and surfaces agent prompt status"
```

---

### Task 5: Presenter-only health dot in AgentDemoGuide presenter mode

**Files:**
- Create: `demo_api_ui/src/components/PresenterHealthDot.jsx`
- Create: `demo_api_ui/src/components/PresenterHealthDot.css`
- Modify: `demo_api_ui/src/components/AgentDemoGuide.jsx:1177` (the `adg-header-controls` div — 2-line mount)
- Test: `demo_api_ui/src/components/PresenterHealthDot.test.jsx`

**Interfaces:**
- Consumes: `GET /api/health/services` shape from Task 4, via `getCachedStatus` from `demo_api_ui/src/services/cachedStatusService.js` (3s TTL + dedup — the repo's idiomatic status-polling helper).
- Produces: `<PresenterHealthDot />` — a small colored dot with a tooltip; rendered only in presenter mode.

**Rules for this task:** `demo_api_ui` is a REGRESSION_PLAN §1 protected area — invoke the repo's `regression-guard` skill first; minimal diff; no emoji beyond the allowlist (this task uses none); the dot must be presenter-only per the locked spec decision (silent fallback — the audience-facing chat UI gets nothing).

**Status levels:** `err` (red) when any of `agent_service`, `mcp_server`, `mcp_gateway`, `llm_proxy` is down; `warn` (amber) when those are up but `hitl_service` is down or `agent_service.checks.prompts` is present and not `'primary'`; `ok` (green) otherwise. Poll every 10s. On fetch failure (BFF itself unreachable), show `err` — the presenter should know first.

- [ ] **Step 1: Write the failing test**

```jsx
// demo_api_ui/src/components/PresenterHealthDot.test.jsx
import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/cachedStatusService', () => ({
  getCachedStatus: vi.fn(),
}));

import { getCachedStatus } from '../services/cachedStatusService';
import PresenterHealthDot from './PresenterHealthDot';

const allUp = {
  services: {
    mcp_gateway: { up: true },
    mcp_server: { up: true },
    hitl_service: { up: true },
    agent_service: { up: true, checks: { env: 'ok', prompts: 'primary' } },
    llm_proxy: { up: true },
  },
};

describe('PresenterHealthDot', () => {
  beforeEach(() => getCachedStatus.mockReset());

  it('renders green when all services are healthy', async () => {
    getCachedStatus.mockResolvedValue(allUp);
    const { container } = render(<PresenterHealthDot />);
    await waitFor(() => expect(container.querySelector('.phd-dot.phd-ok')).toBeTruthy());
  });

  it('renders red when an LLM-path service is down', async () => {
    getCachedStatus.mockResolvedValue({
      services: { ...allUp.services, llm_proxy: { up: false, error: 'ECONNREFUSED' } },
    });
    const { container } = render(<PresenterHealthDot />);
    await waitFor(() => expect(container.querySelector('.phd-dot.phd-err')).toBeTruthy());
    expect(container.querySelector('.phd-dot').title).toContain('llm_proxy');
  });

  it('renders amber when prompts are degraded', async () => {
    getCachedStatus.mockResolvedValue({
      services: {
        ...allUp.services,
        agent_service: { up: true, checks: { env: 'ok', prompts: 'inline_fallback' } },
      },
    });
    const { container } = render(<PresenterHealthDot />);
    await waitFor(() => expect(container.querySelector('.phd-dot.phd-warn')).toBeTruthy());
  });

  it('renders red when the status endpoint itself is unreachable', async () => {
    getCachedStatus.mockRejectedValue(new Error('network'));
    const { container } = render(<PresenterHealthDot />);
    await waitFor(() => expect(container.querySelector('.phd-dot.phd-err')).toBeTruthy());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/PresenterHealthDot.test.jsx`
Expected: FAIL — module `./PresenterHealthDot` not found.

- [ ] **Step 3: Implement the component**

```jsx
// demo_api_ui/src/components/PresenterHealthDot.jsx
/**
 * Presenter-only stack-health dot (demo hardening Phase 4). Polls the BFF's
 * /api/health/services aggregate and shows green/amber/red. Rendered only in
 * AgentDemoGuide presenter mode — the audience-facing chat UI never shows
 * degradation (locked spec decision: silent fallback).
 */
import React, { useEffect, useState } from 'react';
import { getCachedStatus } from '../services/cachedStatusService';
import './PresenterHealthDot.css';

const LLM_PATH = ['agent_service', 'mcp_server', 'mcp_gateway', 'llm_proxy'];
const POLL_MS = 10000;

function classify(payload) {
  const services = payload?.services || {};
  const down = LLM_PATH.filter((k) => !services[k]?.up);
  if (down.length) return { level: 'err', detail: `Down: ${down.join(', ')}` };
  const prompts = services.agent_service?.checks?.prompts;
  if (prompts && prompts !== 'primary') return { level: 'warn', detail: `Agent prompts degraded: ${prompts}` };
  if (!services.hitl_service?.up) return { level: 'warn', detail: 'Down: hitl_service' };
  return { level: 'ok', detail: 'All demo services healthy' };
}

export default function PresenterHealthDot() {
  const [state, setState] = useState({ level: 'warn', detail: 'Checking…' });

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const payload = await getCachedStatus('/api/health/services');
        if (!cancelled) setState(classify(payload));
      } catch (_e) {
        if (!cancelled) setState({ level: 'err', detail: 'Health endpoint unreachable' });
      }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return (
    <span
      className={`phd-dot phd-${state.level}`}
      title={state.detail}
      aria-label={`Stack health: ${state.level} — ${state.detail}`}
    />
  );
}
```

```css
/* demo_api_ui/src/components/PresenterHealthDot.css */
.phd-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  align-self: center;
  flex: 0 0 auto;
}
.phd-ok { background: #22c55e; }
.phd-warn { background: #f59e0b; }
.phd-err { background: #ef4444; }
```

Check `getCachedStatus`'s return contract before wiring: if it returns a `fetch` Response (not parsed JSON), adapt the `tick` to `const res = await getCachedStatus(...); const payload = await res.json();` — mirror how existing callers in the repo consume it, and keep the test's mock consistent with the real contract.

- [ ] **Step 4: Mount in presenter mode**

In `demo_api_ui/src/components/AgentDemoGuide.jsx`, add the import next to the other component imports at the top of the file:

```jsx
import PresenterHealthDot from "./PresenterHealthDot";
```

and inside `<div className="adg-header-controls">` (line ~1177), as the FIRST child before `<div className="adg-view-toggle">`:

```jsx
          {viewMode === "presenter" && <PresenterHealthDot />}
```

No other changes to AgentDemoGuide.jsx.

- [ ] **Step 5: Run tests + build gate**

Run: `cd demo_api_ui && npx vitest run src/components/PresenterHealthDot.test.jsx && npm run build 2>&1 | tail -3`
Expected: 4 tests pass; vite build succeeds (the repo's UI build gate).

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/components/PresenterHealthDot.jsx demo_api_ui/src/components/PresenterHealthDot.css demo_api_ui/src/components/PresenterHealthDot.test.jsx demo_api_ui/src/components/AgentDemoGuide.jsx
git commit -m "feat(ui): presenter-only stack-health dot in AgentDemoGuide presenter mode"
```

---

### Task 6: Dockerfile HEALTHCHECK for demo_llm_proxy

**Files:**
- Modify: `demo_llm_proxy/Dockerfile` (append HEALTHCHECK; the image is `node:20-alpine`, which ships busybox `wget` — same pattern as `demo_agent_service/Dockerfile:30` and `demo_mcp_gateway/Dockerfile:48`)

**Interfaces:**
- Consumes: llm-proxy's existing `GET /health` (`demo_llm_proxy/router.js` — returns 200 healthy / 503 degraded).
- Produces: container-level health status for the `llm-proxy` compose service (docker-compose.yml:969), matching its sibling services.

- [ ] **Step 1: Append the HEALTHCHECK**

At the end of `demo_llm_proxy/Dockerfile` (after the existing CMD/EXPOSE lines — place it immediately before `CMD` if the file ends with CMD, matching the sibling Dockerfiles' placement):

```dockerfile
# Mirrors demo_agent_service/demo_mcp_gateway healthchecks. /health returns 503
# while the model tier is degraded, so Docker shows unhealthy during real trouble
# but healthy through normal tier swaps (start-period covers cold boot).
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8090/health || exit 1
```

If the proxy's listen port in the compose service differs from 8090 (check `docker-compose.yml:969-1000` env for a PORT/PROXY_PORT override), use that port instead and note it in the commit message.

- [ ] **Step 2: Verify**

```bash
docker build -q -f demo_llm_proxy/Dockerfile demo_llm_proxy >/dev/null && echo build-ok
grep -n "HEALTHCHECK" demo_llm_proxy/Dockerfile
```

Expected: `build-ok` (if Docker is unavailable in the environment, fall back to `grep` + a note in the report; the syntax is identical to the two sibling Dockerfiles).

- [ ] **Step 3: Commit**

```bash
git add demo_llm_proxy/Dockerfile
git commit -m "feat(llm-proxy): container HEALTHCHECK on /health"
```

---

### Task 7: Verification gate

**Files:** none (verification only; REGRESSION_LOG entry not needed — no user-visible bug fixed, this is hardening).

- [ ] **Step 1: Full BFF suite**

Run: `cd demo_api_server && npx jest --forceExit --testPathIgnorePatterns='/node_modules/|/tests/real/'`
Expected: no NEW failures vs the known baseline (pre-existing PingOne env-reconcile/connectivity failures and parallel-run flakes are documented in `.superpowers/sdd/task-6-report.md` from Phase 1; list any failures by name and classify).

- [ ] **Step 2: Agent-service suite + typecheck**

Run: `cd demo_agent_service && npx jest --forceExit --testPathIgnorePatterns='/node_modules/' && npx tsc --noEmit`
Expected: PASS, clean typecheck.

- [ ] **Step 3: UI tests + build**

Run: `cd demo_api_ui && npx vitest run && npm run build 2>&1 | tail -3`
Expected: PASS (note any pre-existing vitest failures by name), build succeeds.

- [ ] **Step 4: Crash-guard live probe (optional, if the local stack is running)**

With the stack up via `./run.sh`: `kill -0 $(cat /tmp/demo-api.pid)` to confirm the BFF PID, then hit any endpoint that logs an async error and confirm the BFF process survives and logs `[unhandledRejection]` without exiting (check `/tmp/demo-api.log`). If the stack is not running, note "not run — CRASH_GUARD covered by unit tests" in the report.
