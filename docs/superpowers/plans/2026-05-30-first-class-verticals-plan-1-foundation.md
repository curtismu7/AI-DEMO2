# First-Class Verticals — Plan 1: Plugin Foundation & Vertical-Agnostic Dispatch

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a per-vertical plugin layer (`getPlugin(id)`) that the shared NL/agent dispatch consumes, so that when a vertical ships an `index.js` its tools/heuristics/prompt/authz/render come from that plugin — with a dual-mode fallback to today's manifest-only behavior for verticals that have no plugin yet. No vertical gains a full plugin in this plan; this builds the seam.

**Architecture:** Add a `plugins` factory to the `verticalManifest` module that scans `config/verticals/<id>/index.js`. The two NL entry points (`POST /api/banking-agent/nl` via `geminiNlIntent.parseNaturalLanguage`, and `processAgentMessage` in `demoAgentLangGraphService`) are refactored to resolve the active vertical's plugin and, **when present**, source heuristics / system prompt / tool schemas / tool dispatch / authz from it. When absent, they fall through to today's code paths unchanged. A `resolvePlugin(activeId)` helper is the single chokepoint both entry points use, so behavior is identical across them.

**Tech Stack:** Node.js CommonJS (`demo_api_server`), Jest, Zod (existing `ManifestSchema`), the existing `verticalManifest` loader/resolver module.

**Reference spec:** `docs/superpowers/specs/2026-05-30-first-class-verticals-design.md`

---

## File Structure

**Create:**
- `demo_api_server/services/verticalManifest/plugins.js` — the plugin discovery + contract-validation factory. Loads `config/verticals/<id>/index.js`, validates it exports the contract, caches by id. One responsibility: turn a vertical id into a validated plugin object (or `null` if no plugin file).
- `demo_api_server/services/verticalManifest/pluginContract.js` — pure description + validator of the plugin contract (the required method names + shapes). Kept separate so both `plugins.js` and the contract test import the same source of truth.
- `demo_api_server/services/verticalDispatch.js` — the shared chokepoint: `resolvePlugin(activeId)`, `hasPlugin(activeId)`, and thin pass-throughs the two NL entry points call (`heuristicsFor`, `systemPromptFor`, `toolSchemasFor`, `executeToolFor`, `authzFor`). Each falls back to legacy behavior when no plugin. One responsibility: be the single seam between shared code and plugins.
- `demo_api_server/src/__tests__/verticalPlugins.contract.test.js` — contract test: any `index.js` present must satisfy the contract.
- `demo_api_server/src/__tests__/verticalDispatch.fallback.test.js` — fallback test: with no plugin, dispatch returns legacy values; with a fake plugin, dispatch returns plugin values and never banking content.

**Modify:**
- `demo_api_server/services/verticalManifest/index.js:14-72` — add `const plugins = createPlugins(loader);` in `build()` and export `plugins`.
- `demo_api_server/services/geminiNlIntent.js:16-45` — route system-prompt + heuristic through `verticalDispatch` when a plugin exists.
- `demo_api_server/services/demoAgentLangGraphService.js:776-798` — route tool schemas + systemPrompt + executeTool through `verticalDispatch` when a plugin exists.

---

## Task 1: Define the plugin contract (pure module + validator)

**Files:**
- Create: `demo_api_server/services/verticalManifest/pluginContract.js`
- Test: `demo_api_server/src/__tests__/verticalPlugins.contract.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
// demo_api_server/src/__tests__/verticalPlugins.contract.test.js
const { REQUIRED_METHODS, validatePlugin } = require('../../services/verticalManifest/pluginContract');

describe('plugin contract', () => {
  const goodPlugin = {
    getManifest: () => ({ id: 'x' }),
    getTools: () => [{ name: 't', description: 'd', inputSchema: { type: 'object' }, scopes: ['read'], authz: {} }],
    getHeuristics: () => [{ re: /foo/, action: 't' }],
    getSystemPrompt: () => 'prompt',
    getDataStore: () => ({}),
    executeTool: async () => ({ result: {}, render: null }),
    getAuthz: () => ({ t: {} }),
  };

  it('lists every required method', () => {
    expect(REQUIRED_METHODS).toEqual([
      'getManifest', 'getTools', 'getHeuristics', 'getSystemPrompt',
      'getDataStore', 'executeTool', 'getAuthz',
    ]);
  });

  it('accepts a fully-formed plugin', () => {
    expect(validatePlugin('x', goodPlugin)).toEqual({ ok: true, errors: [] });
  });

  it('rejects a plugin missing a method', () => {
    const bad = { ...goodPlugin };
    delete bad.executeTool;
    const res = validatePlugin('x', bad);
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toMatch(/executeTool/);
  });

  it('rejects a heuristic action not present in getTools', () => {
    const bad = { ...goodPlugin, getHeuristics: () => [{ re: /foo/, action: 'not_a_tool' }] };
    const res = validatePlugin('x', bad);
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toMatch(/not_a_tool/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest verticalPlugins.contract --no-coverage`
Expected: FAIL — `Cannot find module '../../services/verticalManifest/pluginContract'`

- [ ] **Step 3: Write minimal implementation**

```javascript
// demo_api_server/services/verticalManifest/pluginContract.js
'use strict';

const REQUIRED_METHODS = [
  'getManifest', 'getTools', 'getHeuristics', 'getSystemPrompt',
  'getDataStore', 'executeTool', 'getAuthz',
];

/**
 * Validate a loaded plugin object against the contract.
 * Pure — no I/O. Returns { ok, errors }.
 */
function validatePlugin(id, plugin) {
  const errors = [];
  if (!plugin || typeof plugin !== 'object') {
    return { ok: false, errors: [`plugin for "${id}" is not an object`] };
  }
  for (const m of REQUIRED_METHODS) {
    if (typeof plugin[m] !== 'function') {
      errors.push(`plugin "${id}" is missing required method ${m}()`);
    }
  }
  // Cross-check: every heuristic action must be a declared tool name.
  if (typeof plugin.getTools === 'function' && typeof plugin.getHeuristics === 'function') {
    let toolNames = [];
    let heuristics = [];
    try { toolNames = plugin.getTools().map((t) => t && t.name); } catch (e) { errors.push(`plugin "${id}" getTools() threw: ${e.message}`); }
    try { heuristics = plugin.getHeuristics(); } catch (e) { errors.push(`plugin "${id}" getHeuristics() threw: ${e.message}`); }
    for (const h of heuristics) {
      if (h && h.action && !toolNames.includes(h.action)) {
        errors.push(`plugin "${id}" heuristic action "${h.action}" is not a declared tool name`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

module.exports = { REQUIRED_METHODS, validatePlugin };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && npx jest verticalPlugins.contract --no-coverage`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/verticalManifest/pluginContract.js demo_api_server/src/__tests__/verticalPlugins.contract.test.js
git commit -m "feat(verticals): plugin contract definition + validator"
```

---

## Task 2: Plugin discovery factory (`createPlugins`)

**Files:**
- Create: `demo_api_server/services/verticalManifest/plugins.js`
- Modify: `demo_api_server/services/verticalManifest/index.js:14-72`
- Test: extend `demo_api_server/src/__tests__/verticalPlugins.contract.test.js`

- [ ] **Step 1: Write the failing test (append to existing file)**

```javascript
// append to demo_api_server/src/__tests__/verticalPlugins.contract.test.js
const path = require('path');
const fs = require('fs');
const os = require('os');
const { createPlugins } = require('../../services/verticalManifest/plugins');

describe('createPlugins discovery', () => {
  let root;
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'verticals-'));
    // vertical "withplugin" — has index.js
    const wp = path.join(root, 'withplugin');
    fs.mkdirSync(wp, { recursive: true });
    fs.writeFileSync(path.join(wp, 'index.js'), `
      module.exports = {
        getManifest: () => ({ id: 'withplugin' }),
        getTools: () => [{ name: 'do_it', description: 'd', inputSchema: { type: 'object' }, scopes: ['read'], authz: {} }],
        getHeuristics: () => [{ re: /do it/, action: 'do_it' }],
        getSystemPrompt: () => 'wp prompt',
        getDataStore: () => ({}),
        executeTool: async () => ({ result: { ok: true }, render: null }),
        getAuthz: () => ({ do_it: {} }),
      };
    `);
    // vertical "noplugin" — manifest-only, no index.js
    fs.mkdirSync(path.join(root, 'noplugin'), { recursive: true });
  });

  it('returns a validated plugin for a vertical that has index.js', () => {
    const plugins = createPlugins(root);
    const p = plugins.get('withplugin');
    expect(p).not.toBeNull();
    expect(p.getSystemPrompt()).toBe('wp prompt');
  });

  it('returns null for a vertical with no index.js', () => {
    const plugins = createPlugins(root);
    expect(plugins.get('noplugin')).toBeNull();
  });

  it('has(id) reflects plugin presence', () => {
    const plugins = createPlugins(root);
    expect(plugins.has('withplugin')).toBe(true);
    expect(plugins.has('noplugin')).toBe(false);
  });

  it('throws a descriptive error when an index.js violates the contract', () => {
    const bad = path.join(root, 'badplugin');
    fs.mkdirSync(bad, { recursive: true });
    fs.writeFileSync(path.join(bad, 'index.js'), `module.exports = { getManifest: () => ({}) };`);
    const plugins = createPlugins(root);
    expect(() => plugins.get('badplugin')).toThrow(/badplugin.*missing required method/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest verticalPlugins.contract --no-coverage`
Expected: FAIL — `Cannot find module '../../services/verticalManifest/plugins'`

- [ ] **Step 3: Write minimal implementation**

```javascript
// demo_api_server/services/verticalManifest/plugins.js
'use strict';

const fs = require('fs');
const path = require('path');
const { validatePlugin } = require('./pluginContract');

const DEFAULT_ROOT = path.join(__dirname, '..', '..', 'config', 'verticals');

/**
 * Discovery factory: turns a vertical id into a validated plugin object,
 * or null when the vertical has no index.js (manifest-only / legacy mode).
 * Caches by id. Throws if an index.js exists but violates the contract —
 * a malformed plugin is a hard error, never a silent banking fallback.
 */
function createPlugins(rootDir = DEFAULT_ROOT) {
  const cache = new Map(); // id -> plugin | null

  function load(id) {
    const file = path.join(rootDir, id, 'index.js');
    if (!fs.existsSync(file)) {
      cache.set(id, null);
      return null;
    }
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const mod = require(file);
    const plugin = mod && mod.default ? mod.default : mod;
    const { ok, errors } = validatePlugin(id, plugin);
    if (!ok) {
      throw new Error(`Invalid vertical plugin "${id}": ${errors.join('; ')}`);
    }
    cache.set(id, plugin);
    return plugin;
  }

  function get(id) {
    if (cache.has(id)) return cache.get(id);
    return load(id);
  }

  function has(id) {
    return get(id) !== null;
  }

  function reload(id) {
    const file = path.join(rootDir, id, 'index.js');
    try { delete require.cache[require.resolve(file)]; } catch (_) { /* not loaded */ }
    cache.delete(id);
    return get(id);
  }

  return { get, has, reload };
}

module.exports = { createPlugins };
```

- [ ] **Step 4: Wire into index.js**

In `demo_api_server/services/verticalManifest/index.js`, add the require at the top alongside the other `require('./...')` lines:

```javascript
const { createPlugins } = require('./plugins');
```

Inside `build()`, after `const loader = createLoader(root);`, add:

```javascript
  const plugins = createPlugins(root);
```

In the `return { ... }` object of `build()`, add `plugins,` (e.g. right after `loader,`):

```javascript
  return {
    init, _reset,
    list, listAll,
    loader,
    plugins,
    overlay: resolver.overlay,
    resolver,
    scope,
    events,
    snapshot,
    store,
    HIDDEN_IDS,
  };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd demo_api_server && npx jest verticalPlugins.contract --no-coverage`
Expected: PASS (all tests, including the 4 from Task 1)

- [ ] **Step 6: Verify the module still loads (no regression to existing verticalManifest consumers)**

Run:
```bash
cd demo_api_server && node -e "const {verticalManifest}=require('./services/verticalManifest'); verticalManifest.init(); console.log('plugins api:', typeof verticalManifest.plugins.get, typeof verticalManifest.plugins.has); console.log('existing verticals:', verticalManifest.list().map(v=>v.id).join(', '));"
```
Expected: prints `plugins api: function function` and the existing vertical ids; **all `plugins.get(id)` for current verticals return null** because none has an `index.js` yet.

- [ ] **Step 7: Commit**

```bash
git add demo_api_server/services/verticalManifest/plugins.js demo_api_server/services/verticalManifest/index.js demo_api_server/src/__tests__/verticalPlugins.contract.test.js
git commit -m "feat(verticals): plugin discovery factory wired into verticalManifest"
```

---

## Task 3: Shared dispatch chokepoint with legacy fallback

**Files:**
- Create: `demo_api_server/services/verticalDispatch.js`
- Test: `demo_api_server/src/__tests__/verticalDispatch.fallback.test.js`

This module is the single seam. It exposes `resolvePlugin(activeId)` and helpers that
return **plugin-sourced values when a plugin exists**, else delegate to a `legacy`
callback the caller supplies. It never substitutes banking content itself.

- [ ] **Step 1: Write the failing test**

```javascript
// demo_api_server/src/__tests__/verticalDispatch.fallback.test.js
jest.mock('../../services/verticalManifest', () => {
  const plugins = { _map: new Map(), get(id) { return this._map.get(id) || null; }, has(id) { return !!this._map.get(id); } };
  return { verticalManifest: { plugins, resolver: { activeId: () => global.__ACTIVE__ } } };
});

const { verticalManifest } = require('../../services/verticalManifest');
const dispatch = require('../../services/verticalDispatch');

const fakePlugin = {
  getManifest: () => ({ id: 'health' }),
  getTools: () => [{ name: 'book_appointment', description: 'Book', inputSchema: { type: 'object' }, scopes: ['write'], authz: { stepUp: true } }],
  getHeuristics: () => [{ re: /book/, action: 'book_appointment' }],
  getSystemPrompt: (ctx) => `health prompt role=${ctx && ctx.role}`,
  getDataStore: () => ({}),
  executeTool: async (name) => ({ result: { booked: name }, render: { type: 'card' } }),
  getAuthz: () => ({ book_appointment: { stepUp: true } }),
};

beforeEach(() => { verticalManifest.plugins._map.clear(); });

describe('verticalDispatch — plugin present', () => {
  beforeEach(() => { global.__ACTIVE__ = 'health'; verticalManifest.plugins._map.set('health', fakePlugin); });

  it('hasPlugin true', () => { expect(dispatch.hasPlugin('health')).toBe(true); });

  it('heuristicsFor returns plugin heuristics, never the legacy callback', () => {
    const legacy = jest.fn(() => [{ re: /never/, action: 'banking_transfer' }]);
    const out = dispatch.heuristicsFor('health', legacy);
    expect(out).toEqual(fakePlugin.getHeuristics());
    expect(legacy).not.toHaveBeenCalled();
  });

  it('systemPromptFor returns plugin prompt, passing ctx', () => {
    const legacy = jest.fn(() => 'BANKING PROMPT');
    const out = dispatch.systemPromptFor('health', { role: 'admin' }, legacy);
    expect(out).toBe('health prompt role=admin');
    expect(legacy).not.toHaveBeenCalled();
  });

  it('toolSchemasFor returns plugin tools mapped to {name,description,inputSchema}', () => {
    const legacy = jest.fn(() => [{ name: 'create_transfer' }]);
    const out = dispatch.toolSchemasFor('health', legacy);
    expect(out).toEqual([{ name: 'book_appointment', description: 'Book', inputSchema: { type: 'object' } }]);
    expect(legacy).not.toHaveBeenCalled();
  });

  it('executeToolFor dispatches to plugin.executeTool', async () => {
    const legacy = jest.fn();
    const out = await dispatch.executeToolFor('health', 'book_appointment', {}, {}, legacy);
    expect(out).toEqual({ result: { booked: 'book_appointment' }, render: { type: 'card' } });
    expect(legacy).not.toHaveBeenCalled();
  });

  it('authzFor returns plugin authz', () => {
    const legacy = jest.fn(() => ({}));
    expect(dispatch.authzFor('health', legacy)).toEqual({ book_appointment: { stepUp: true } });
  });
});

describe('verticalDispatch — no plugin (legacy fallback)', () => {
  beforeEach(() => { global.__ACTIVE__ = 'retail'; /* no plugin registered */ });

  it('hasPlugin false', () => { expect(dispatch.hasPlugin('retail')).toBe(false); });

  it('heuristicsFor calls the legacy callback', () => {
    const legacy = jest.fn(() => 'LEGACY');
    expect(dispatch.heuristicsFor('retail', legacy)).toBe('LEGACY');
    expect(legacy).toHaveBeenCalledTimes(1);
  });

  it('systemPromptFor calls the legacy callback with ctx', () => {
    const legacy = jest.fn(() => 'LEGACY PROMPT');
    expect(dispatch.systemPromptFor('retail', { role: 'user' }, legacy)).toBe('LEGACY PROMPT');
    expect(legacy).toHaveBeenCalledWith({ role: 'user' });
  });

  it('executeToolFor calls the legacy callback', async () => {
    const legacy = jest.fn(async () => 'LEGACY RESULT');
    expect(await dispatch.executeToolFor('retail', 'create_transfer', { a: 1 }, {}, legacy)).toBe('LEGACY RESULT');
    expect(legacy).toHaveBeenCalledWith('create_transfer', { a: 1 }, {});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest verticalDispatch.fallback --no-coverage`
Expected: FAIL — `Cannot find module '../../services/verticalDispatch'`

- [ ] **Step 3: Write minimal implementation**

```javascript
// demo_api_server/services/verticalDispatch.js
'use strict';

const { verticalManifest } = require('./verticalManifest');

/**
 * Single seam between shared NL/agent code and per-vertical plugins.
 *
 * Each helper takes the active vertical id and a `legacy` callback. When the
 * active vertical has a plugin, the helper returns the plugin's value and the
 * legacy callback is NOT invoked. When there is no plugin, the helper invokes
 * `legacy` and returns its result. This module never produces banking/default
 * content itself — the only fallback is the caller's own legacy path, used
 * solely while a vertical has not yet shipped its index.js.
 */

function resolvePlugin(activeId) {
  if (!activeId) return null;
  return verticalManifest.plugins.get(activeId);
}

function hasPlugin(activeId) {
  return resolvePlugin(activeId) !== null;
}

function heuristicsFor(activeId, legacy) {
  const p = resolvePlugin(activeId);
  return p ? p.getHeuristics() : legacy();
}

function systemPromptFor(activeId, ctx, legacy) {
  const p = resolvePlugin(activeId);
  return p ? p.getSystemPrompt(ctx) : legacy(ctx);
}

function toolSchemasFor(activeId, legacy) {
  const p = resolvePlugin(activeId);
  if (!p) return legacy();
  return p.getTools().map((t) => ({
    name: t.name,
    description: t.description || '',
    inputSchema: t.inputSchema || { type: 'object', properties: {} },
  }));
}

function executeToolFor(activeId, name, params, ctx, legacy) {
  const p = resolvePlugin(activeId);
  return p ? p.executeTool(name, params, ctx) : legacy(name, params, ctx);
}

function authzFor(activeId, legacy) {
  const p = resolvePlugin(activeId);
  return p ? p.getAuthz() : legacy();
}

module.exports = {
  resolvePlugin, hasPlugin,
  heuristicsFor, systemPromptFor, toolSchemasFor, executeToolFor, authzFor,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && npx jest verticalDispatch.fallback --no-coverage`
Expected: PASS (all describe blocks)

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/verticalDispatch.js demo_api_server/src/__tests__/verticalDispatch.fallback.test.js
git commit -m "feat(verticals): shared dispatch chokepoint with legacy fallback"
```

---

## Task 4: Route the NL heuristic/prompt path through dispatch

**Files:**
- Modify: `demo_api_server/services/geminiNlIntent.js:16-45`
- Test: `demo_api_server/src/__tests__/geminiNlIntent.pluginRoute.test.js`

**Behavior:** `buildSystem(vertical)` must return the plugin's system prompt when the
active vertical has a plugin, else today's `SYSTEM_BASE + THEME_OVERRIDES[vertical]`.
This is the one place the LLM directive is assembled.

- [ ] **Step 1: Write the failing test**

```javascript
// demo_api_server/src/__tests__/geminiNlIntent.pluginRoute.test.js
jest.mock('../../services/verticalDispatch', () => ({
  hasPlugin: jest.fn(),
  systemPromptFor: jest.fn(),
}));
const dispatch = require('../../services/verticalDispatch');
const { __test } = require('../../services/geminiNlIntent');

describe('geminiNlIntent buildSystem plugin routing', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('uses the plugin system prompt when a plugin exists', () => {
    dispatch.hasPlugin.mockReturnValue(true);
    dispatch.systemPromptFor.mockReturnValue('PLUGIN SYSTEM PROMPT');
    const out = __test.buildSystem('health');
    expect(out).toBe('PLUGIN SYSTEM PROMPT');
    expect(dispatch.systemPromptFor).toHaveBeenCalled();
  });

  it('falls back to base+theme override when no plugin', () => {
    dispatch.hasPlugin.mockReturnValue(false);
    const out = __test.buildSystem('banking');
    // legacy path returns a non-empty string built from the directives JSON
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
    expect(dispatch.systemPromptFor).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest geminiNlIntent.pluginRoute --no-coverage`
Expected: FAIL — `__test` is undefined / `buildSystem` not exported.

- [ ] **Step 3: Modify `geminiNlIntent.js`**

At the top of `geminiNlIntent.js`, add the require near the other service requires:

```javascript
const verticalDispatch = require('./verticalDispatch');
```

Replace the existing `buildSystem` (lines ~26-29) with:

```javascript
function buildSystem(vertical) {
  // Plugin-first: a vertical with an index.js owns its full directive.
  if (verticalDispatch.hasPlugin(vertical)) {
    return verticalDispatch.systemPromptFor(vertical, {}, () => '');
  }
  // Legacy (no plugin yet): base + per-vertical theme override.
  const override = THEME_OVERRIDES[vertical] || '';
  return SYSTEM_BASE + override;
}
```

Note: `buildSystemWithCtx` already calls `buildSystem(vertical)` then appends role
context. Leave its body as-is — but make the plugin path receive ctx by replacing the
first line of `buildSystemWithCtx` (`const SYSTEM = buildSystem(vertical);`) with:

```javascript
  const SYSTEM = verticalDispatch.hasPlugin(vertical)
    ? verticalDispatch.systemPromptFor(vertical, context, () => '')
    : buildSystem(vertical);
```

This way, when a plugin exists, the plugin's `getSystemPrompt(ctx)` receives the role
context directly (the plugin owns role handling); when no plugin, today's behavior
(base+override then appended role note) is unchanged.

At the bottom, extend `module.exports` to expose the internals for testing:

```javascript
module.exports = {
  parseNaturalLanguage,
  EDU,
  __test: { buildSystem, buildSystemWithCtx },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && npx jest geminiNlIntent.pluginRoute --no-coverage`
Expected: PASS (2 tests)

- [ ] **Step 5: Run the existing geminiNlIntent suites to confirm no regression**

Run: `cd demo_api_server && npx jest geminiNlIntent --no-coverage`
Expected: PASS — the existing `geminiNlIntent.heuristic.test.js` and `geminiNlIntent.llmOnly.test.js` still pass (no plugin registered for any vertical, so the legacy path runs exactly as before).

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/services/geminiNlIntent.js demo_api_server/src/__tests__/geminiNlIntent.pluginRoute.test.js
git commit -m "feat(verticals): route NL system prompt through plugin dispatch (legacy fallback intact)"
```

---

## Task 5: Route heuristic intent through dispatch

**Files:**
- Modify: `demo_api_server/services/nlIntentParser.js:454-504` (the `parseHeuristic` theme branch)
- Test: `demo_api_server/src/__tests__/nlIntentParser.pluginRoute.test.js`

**Behavior:** When the active vertical has a plugin, `parseHeuristic` matches the
plugin's heuristics (its own action names) instead of `THEME_VOCAB`. When no plugin, the
existing `parseTheme(t, vertical)` runs unchanged.

- [ ] **Step 1: Write the failing test**

```javascript
// demo_api_server/src/__tests__/nlIntentParser.pluginRoute.test.js
jest.mock('../../services/verticalDispatch', () => ({
  hasPlugin: jest.fn(),
  heuristicsFor: jest.fn(),
}));
const dispatch = require('../../services/verticalDispatch');
const { parseHeuristic } = require('../../services/nlIntentParser');

describe('parseHeuristic plugin routing', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('uses plugin heuristics (own action names) when a plugin exists', () => {
    dispatch.hasPlugin.mockReturnValue(true);
    dispatch.heuristicsFor.mockReturnValue([{ re: /book.*appointment/, action: 'book_appointment' }]);
    const out = parseHeuristic('please book an appointment', 'health');
    expect(out).toEqual({ kind: 'vertical', vertical: 'health', action: 'book_appointment', params: {} });
  });

  it('returns kind:none when plugin has no match (no banking fallback)', () => {
    dispatch.hasPlugin.mockReturnValue(true);
    dispatch.heuristicsFor.mockReturnValue([{ re: /book.*appointment/, action: 'book_appointment' }]);
    const out = parseHeuristic('transfer 500 dollars', 'health');
    expect(out.kind).toBe('none');
  });

  it('falls back to legacy theme/banking routing when no plugin', () => {
    dispatch.hasPlugin.mockReturnValue(false);
    const out = parseHeuristic('show my accounts', 'banking');
    expect(out.kind).toBe('banking');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest nlIntentParser.pluginRoute --no-coverage`
Expected: FAIL — `parseHeuristic` returns banking/none shapes, not the new `kind:'vertical'` shape.

- [ ] **Step 3: Modify `nlIntentParser.js`**

Add the require near the top (after the existing requires):

```javascript
const verticalDispatch = require('./verticalDispatch');
```

In `parseHeuristic`, replace the existing theme branch:

```javascript
  // Theme-aware vocabulary — runs before banking/education
  if (vertical !== 'banking') {
    const themed = parseTheme(t, vertical);
    if (themed) return themed;
  }
```

with:

```javascript
  // Plugin-first: a vertical with a plugin matches its OWN heuristics/actions.
  // No banking fallback — a non-match returns kind:'none', never a banking action.
  if (verticalDispatch.hasPlugin(vertical)) {
    const heuristics = verticalDispatch.heuristicsFor(vertical, () => []);
    for (const { re, action } of heuristics) {
      if (re.test(t)) {
        const amountMatch = t.match(/\$?\s*(\d+(?:\.\d+)?)/);
        const params = amountMatch ? { amount: parseFloat(amountMatch[1]) } : {};
        return { kind: 'vertical', vertical, action, params };
      }
    }
    return { kind: 'none', message: buildCatalogMessage(verticalCtx) };
  }

  // Legacy theme-aware vocabulary (no plugin yet) — runs before banking/education
  if (vertical !== 'banking') {
    const themed = parseTheme(t, vertical);
    if (themed) return themed;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && npx jest nlIntentParser.pluginRoute --no-coverage`
Expected: PASS (3 tests)

- [ ] **Step 5: Run existing NL tests for no regression**

Run: `cd demo_api_server && npx jest nlIntent geminiNlIntent --no-coverage`
Expected: PASS — existing heuristic tests unaffected (no plugins registered).

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/services/nlIntentParser.js demo_api_server/src/__tests__/nlIntentParser.pluginRoute.test.js
git commit -m "feat(verticals): route heuristic intent through plugin dispatch (no banking fallback on miss)"
```

> **Downstream note (handled in Plan 2, not here):** this introduces a new intent
> result shape `{ kind: 'vertical', vertical, action, params }`. In Plan 1 **no vertical
> has a plugin**, so this branch never fires in production and no downstream consumer
> needs to handle it yet. Plan 2 (healthcare) adds the consumer: the `/api/banking-agent/nl`
> response path and the UI must learn to dispatch a `kind:'vertical'` result to the
> plugin's `executeTool` and render via the result descriptor. This is called out here so
> the gap is explicit, not discovered later.

---

## Task 6: Route agent tool schemas + execution through dispatch

**Files:**
- Modify: `demo_api_server/services/demoAgentLangGraphService.js:776-798`
- Test: `demo_api_server/src/__tests__/demoAgentLangGraph.pluginRoute.test.js`

**Behavior:** In the reason loop, when the active vertical has a plugin, `toolSchemas`
come from the plugin and `executeTool` dispatches to the plugin's `executeTool`. When no
plugin, today's `buildToolSchemasForAgentForVertical(activeManifest)` + `executeBffTool`
run unchanged.

- [ ] **Step 1: Write the failing test**

```javascript
// demo_api_server/src/__tests__/demoAgentLangGraph.pluginRoute.test.js
jest.mock('../../services/verticalDispatch', () => ({
  hasPlugin: jest.fn(),
  toolSchemasFor: jest.fn(),
  executeToolFor: jest.fn(),
}));
const dispatch = require('../../services/verticalDispatch');
const { __test } = require('../../services/demoAgentLangGraphService');

describe('agent reason-loop plugin routing helpers', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('resolveToolSchemas uses plugin schemas when plugin exists', () => {
    dispatch.hasPlugin.mockReturnValue(true);
    dispatch.toolSchemasFor.mockReturnValue([{ name: 'book_appointment', description: 'b', inputSchema: {} }]);
    const out = __test.resolveToolSchemas('health', { terminology: {} });
    expect(out).toEqual([{ name: 'book_appointment', description: 'b', inputSchema: {} }]);
  });

  it('resolveToolSchemas falls back to legacy builder when no plugin', () => {
    dispatch.hasPlugin.mockReturnValue(false);
    const out = __test.resolveToolSchemas('banking', { terminology: { accounts: 'accounts' } });
    expect(Array.isArray(out)).toBe(true);
    expect(out.some((t) => t.name === 'get_my_accounts')).toBe(true);
  });

  it('resolveExecuteTool dispatches to plugin executeTool when plugin exists', async () => {
    dispatch.hasPlugin.mockReturnValue(true);
    dispatch.executeToolFor.mockResolvedValue({ result: { ok: 1 }, render: null });
    const exec = __test.resolveExecuteTool('health', { userId: 'u', userToken: 't', req: null, tokenEvents: [], sessionId: 's' });
    const out = await exec('book_appointment', { when: 'tomorrow' });
    expect(dispatch.executeToolFor).toHaveBeenCalledWith('health', 'book_appointment', { when: 'tomorrow' }, expect.any(Object), expect.any(Function));
    expect(typeof out).toBe('string'); // reason loop expects a string result
    expect(JSON.parse(out)).toEqual({ result: { ok: 1 }, render: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest demoAgentLangGraph.pluginRoute --no-coverage`
Expected: FAIL — `__test` not exported / helpers undefined.

- [ ] **Step 3: Modify `demoAgentLangGraphService.js`**

Add the require near the top (after `const { verticalManifest } = require('./verticalManifest');`):

```javascript
const verticalDispatch = require('./verticalDispatch');
```

Add two helper functions above `processAgentMessage` (e.g. right after
`buildToolSchemasForAgentForVertical`):

```javascript
// Plugin-first tool schema resolution. Legacy builder is used only when the
// active vertical has no plugin yet.
function resolveToolSchemas(activeId, activeManifest) {
  return verticalDispatch.toolSchemasFor(activeId, () =>
    buildToolSchemasForAgentForVertical(activeManifest));
}

// Plugin-first executeTool. Returns a function with the reason-loop signature
// (name, args) => Promise<string>. Plugin results are JSON-stringified so the
// reason loop sees a string, matching executeBffTool's contract.
function resolveExecuteTool(activeId, { userId, userToken, req, tokenEvents, sessionId }) {
  return async (name, args) => {
    const out = await verticalDispatch.executeToolFor(
      activeId, name, args, { userId, userToken, req, tokenEvents, sessionId },
      (n, a) => executeBffTool({ name: n, args: a, userId, userToken, req, tokenEvents, sessionId }),
    );
    return typeof out === 'string' ? out : JSON.stringify(out);
  };
}
```

In the reason-loop section (lines ~776-798), replace:

```javascript
const activeManifest = verticalManifest.resolver.resolve(verticalManifest.resolver.activeId());
const toolSchemas = buildToolSchemasForAgentForVertical(activeManifest);
const systemPrompt = activeManifest?.agent?.systemPromptFlavor;
```

with:

```javascript
const activeId = verticalManifest.resolver.activeId();
const activeManifest = verticalManifest.resolver.resolve(activeId);
const toolSchemas = resolveToolSchemas(activeId, activeManifest);
const systemPrompt = verticalDispatch.hasPlugin(activeId)
  ? verticalDispatch.systemPromptFor(activeId, {}, () => activeManifest?.agent?.systemPromptFlavor)
  : activeManifest?.agent?.systemPromptFlavor;
```

and replace the `executeTool` arrow in the `runReasonLoop` call:

```javascript
  executeTool: async (name, args) =>
    executeBffTool({ name, args, userId, userToken, req, tokenEvents, sessionId }),
```

with:

```javascript
  executeTool: resolveExecuteTool(activeId, { userId, userToken, req, tokenEvents, sessionId }),
```

Extend `module.exports` at the bottom to expose the helpers for testing:

```javascript
module.exports = {
  processAgentMessage,
  buildToolSchemasForAgentForVertical,
  __test: { resolveToolSchemas, resolveExecuteTool },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && npx jest demoAgentLangGraph.pluginRoute --no-coverage`
Expected: PASS (3 tests)

- [ ] **Step 5: Run the broader API suite for no regression**

Run: `cd demo_api_server && npx jest --no-coverage 2>&1 | tail -20`
Expected: existing suites pass; no plugin registered so all live paths run legacy behavior. Investigate any new failure before proceeding.

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/services/demoAgentLangGraphService.js demo_api_server/src/__tests__/demoAgentLangGraph.pluginRoute.test.js
git commit -m "feat(verticals): route agent tool schemas + execution through plugin dispatch"
```

---

## Task 7: No-fallback guard test (spec invariant)

**Files:**
- Test: `demo_api_server/src/__tests__/verticalDispatch.noFallback.test.js`

This codifies the design's hard invariant: with a plugin active, nothing in the dispatch
seam yields banking/default content. It is a guard against regression, not new behavior.

- [ ] **Step 1: Write the test**

```javascript
// demo_api_server/src/__tests__/verticalDispatch.noFallback.test.js
jest.mock('../../services/verticalManifest', () => {
  const plugin = {
    getManifest: () => ({ id: 'health' }),
    getTools: () => [{ name: 'book_appointment', description: 'Book an appointment', inputSchema: { type: 'object' }, scopes: ['write'], authz: {} }],
    getHeuristics: () => [{ re: /book/, action: 'book_appointment' }],
    getSystemPrompt: () => 'You are a healthcare assistant. Never mention banking.',
    getDataStore: () => ({}),
    executeTool: async () => ({ result: { appointment: 'confirmed' }, render: { type: 'card' } }),
    getAuthz: () => ({ book_appointment: {} }),
  };
  const plugins = { get: (id) => (id === 'health' ? plugin : null), has: (id) => id === 'health' };
  return { verticalManifest: { plugins, resolver: { activeId: () => 'health' } } };
});

const dispatch = require('../../services/verticalDispatch');

const BANKING_TERMS = ['create_transfer', 'get_my_accounts', 'create_deposit', 'create_withdrawal', 'account', 'balance', 'transfer'];

describe('no banking fallback when a plugin is active', () => {
  it('tool schemas contain only the plugin tool names', () => {
    const legacy = () => { throw new Error('legacy must not be called'); };
    const schemas = dispatch.toolSchemasFor('health', legacy);
    expect(schemas.map((s) => s.name)).toEqual(['book_appointment']);
  });

  it('system prompt contains no banking action names', () => {
    const prompt = dispatch.systemPromptFor('health', {}, () => { throw new Error('legacy'); });
    for (const term of ['create_transfer', 'get_my_accounts']) {
      expect(prompt).not.toContain(term);
    }
  });

  it('heuristics map only to plugin actions', () => {
    const h = dispatch.heuristicsFor('health', () => { throw new Error('legacy'); });
    const actions = h.map((x) => x.action);
    for (const a of actions) expect(a).toBe('book_appointment');
  });

  it('executeTool returns the plugin result, never a banking shape', async () => {
    const out = await dispatch.executeToolFor('health', 'book_appointment', {}, {}, () => { throw new Error('legacy'); });
    expect(out.result).toEqual({ appointment: 'confirmed' });
    expect(JSON.stringify(out)).not.toMatch(/accountId|fromId|toId/);
  });
});
```

- [ ] **Step 2: Run test to verify it passes** (implementation already exists from Tasks 1-6)

Run: `cd demo_api_server && npx jest verticalDispatch.noFallback --no-coverage`
Expected: PASS (4 tests)

- [ ] **Step 3: Commit**

```bash
git add demo_api_server/src/__tests__/verticalDispatch.noFallback.test.js
git commit -m "test(verticals): no-banking-fallback invariant guard"
```

---

## Task 8: Full suite + sanity gate

- [ ] **Step 1: Run the full API-server suite**

Run: `cd demo_api_server && npx jest --no-coverage 2>&1 | tail -30`
Expected: all suites pass. The 5 existing verticals still run in legacy mode (none has an `index.js`), so live behavior is byte-for-byte unchanged.

- [ ] **Step 2: Boot sanity check**

Run:
```bash
cd demo_api_server && node -e "const {verticalManifest}=require('./services/verticalManifest'); verticalManifest.init(); const d=require('./services/verticalDispatch'); console.log(verticalManifest.list().map(v=>v.id+':'+(d.hasPlugin(v.id)?'plugin':'legacy')).join('  '));"
```
Expected: every vertical prints `…:legacy` (no plugins yet) — confirming the seam is installed and inert until Plan 2 ships the first `index.js`.

- [ ] **Step 3: Final commit (if any uncommitted changes)**

```bash
git add -A && git commit -m "chore(verticals): Plan 1 foundation complete — plugin seam installed, all verticals legacy"
```

---

## Plan 1 Done-Criteria

1. `verticalManifest.plugins.get(id)` / `.has(id)` exist and return `null`/`false` for all current verticals.
2. The NL heuristic, NL system prompt, and agent tool-schema/execution paths all consult `verticalDispatch` first.
3. With no plugin present, every path runs today's legacy behavior — full existing suite green.
4. The contract test, fallback test, and no-fallback guard test all pass.
5. The seam is provably inert in production (boot sanity check shows all verticals legacy).

---

# Roadmap — Plans 2–6 (written in full after Plan 1 executes)

Each subsequent plan ships one vertical's `index.js` (and `seed.json`), flipping it from
`legacy` to `plugin` mode. Because Plan 1's seam already exists, each is additive and
independently testable.

### Plan 2 — Healthcare reference vertical (first full plugin)
- Create `config/verticals/healthcare/index.js` implementing the contract: tools
  (`view_records`, `book_appointment`, `view_coverage`, `release_records`,
  `show_health_record`), `seed.json` (patient records, appointments, claims),
  `getSystemPrompt`, `getHeuristics`, `getAuthz` (`release_records` → stepUp+consent),
  and per-tool render descriptors in the manifest.
- Add per-tool render descriptor support to the manifest schema (`render` block) +
  `<VerticalResult>` UI component (extends existing `ResultsPanel` type switch).
- Prove the **novel-action** path end-to-end (`book_appointment` has no banking analog).
- Tests: healthcare plugin contract, heuristic routing to its own actions, authz gating,
  render descriptor resolution, and the no-fallback assertion with healthcare active.
- This plan establishes the **template** every other vertical copies.

**Carried over from Plan 1 `/code-review` (latent findings — they fire the moment a plugin
ships, so Plan 2 MUST resolve them as it brings healthcare online):**
1. **Wire the `kind:'vertical'` consumer (REQUIRED).** Plan 1's `parseHeuristic` now returns
   `{ kind:'vertical', vertical, action, params }` when a plugin matches, but NOTHING consumes
   it yet: `geminiNlIntent.parseNaturalLanguage` fast-returns it raw to `/nl`; the agent path in
   `demoAgentLangGraphService.processAgentMessage` only branches on `heuristic.kind === 'banking'`
   (so a `vertical` result silently escalates to the LLM instead of executing the tool); and
   `BankingAgent.js` `dispatchNlResult` has no `'vertical'` case (falls to the "I didn't catch
   that" default). Plan 2 must add `kind:'vertical'` handling in all three: the `/nl` route/agent
   loop dispatches it through `verticalDispatch.executeToolFor`, and the UI renders the result via
   the render descriptor (see #2 of §3). Until this is done, healthcare heuristic matches are dead.
2. **Scope the plugin amount-regex to amount-taking actions.** `parseHeuristic`'s plugin branch
   currently runs `/\$?\s*(\d+(?:\.\d+)?)/` for EVERY matched action, attaching a spurious
   `params.amount` to non-amount tools (e.g. "show my top 5 records" → `{amount:5}`). Legacy
   `parseTheme` only extracts an amount for transfer-like actions. Plan 2: let the plugin's tool/
   heuristic declare whether it takes an amount (e.g. an `extractsAmount` flag on the heuristic
   entry) and only extract then.
3. **Validate `getSystemPrompt` returns a non-empty string** in `pluginContract.validatePlugin`
   (today the contract only checks the method exists). An empty/undefined prompt would send an
   empty system message to the LLM. Add the assertion + a contract-test case.
4. **Align plugin `executeTool` error contract with `executeBffTool`.** `executeBffTool` returns
   `JSON.stringify({error})` for unknown tools / catches errors to a string; the plugin path in
   `verticalDispatch.executeToolFor` lets a throwing `executeTool` reject, aborting the reason-loop
   turn. Plan 2: wrap the plugin dispatch so a thrown error becomes an `{error}` string result the
   reason loop can feed back to the model (or document the rejection as intended and handle upstream).
- The `kind:'vertical'` UI/route wiring (#1) is the BankingAgent.js touch point — coordinate with
  the UI-redesign ownership rule ([[project_ui_verticals_parallel]]): UI is PAUSED until verticals
  is done, so verticals may now edit BankingAgent.js directly for the `<VerticalResult>` + the
  `kind:'vertical'` dispatch case.

### Plan 3 — Retail (`list_orders`, `order_status`, `checkout`, `rewards_balance`, `show_large_purchase`)
- Copy the healthcare template; orders/rewards/shipments `seed.json`.

### Plan 4 — Sporting-goods (`list_gear`, `gear_order_status`, `checkout`, `show_gear_order`)
- Copy the template; gear orders/inventory `seed.json`.

### Plan 5 — Workforce (`view_benefits`, `submit_expense`, `pto_balance`, `show_expense_report`)
- Copy the template; benefits/expenses/PTO `seed.json`.

### Plan 6 — Banking-last + deletions (riskiest; touches REGRESSION_PLAN §1)
- Create `config/verticals/banking/index.js` (accounts/transactions, the four banking
  tools, $500 HITL authz).
- Delete now-dead translation code: `THEME_VOCAB` + `parseTheme`, `THEME_OVERRIDES`
  branch + the `themes` block in `HELIX_AGENT_DIRECTIVES.json`,
  `_buildVerticalToolDescription` + `buildToolSchemasForAgentForVertical`,
  `reseedAllCustomersForVertical` + the vertical-mismatch reprovisioning block in
  `accounts.js` + `SEED_PROFILES` relabeling, and the `router.ts` routing maps replaced
  by active-vertical+tool lookup.
- Remove the legacy fallback branches added in Plan 1 (every vertical now has a plugin).
- Run the bootstrap/setup/migration audit (separate tracked todo) and apply its outcomes:
  `data:import`/`export`, `setup:fresh` seeding from per-vertical `seed.json`, and the
  fate of `demo_mortgage_service` feature-page backends.
- State the REGRESSION_PLAN §1 do-not-break list before editing; add §4 bug-log entries.
- Full regression: all banking suites green, `App.structure`, UI build clean.

**REGRESSION_PLAN §1 reconciliation (audited 2026-05-30 — precise list for this phase):**

*Protected §1 entries that will go STALE when the deletion targets are removed — must be
restated in per-vertical terms, NOT just deleted:*
- **"Extra accounts (investment etc.) lost on cold-start"** — names `accounts.js` +
  `demoScenarioStore` snapshot/restore ("restore before provision"). The vertical-mismatch
  reprovisioning block this protects is deleted in Plan 6. Restate as the per-vertical store
  snapshot/restore contract (or note reprovisioning is gone because data no longer relabels).
- **"DataStore backup/recovery"** — names `store.js` (`_atomicWrite`, `_tryRestoreFromBackup`,
  recovery chain runtimeData→backups→bootstrapData). After the data inversion, `store.js` keeps
  only users/sessions; per-vertical seed/data stores need their own equivalent backup/recovery
  guarantee. Restate so the contract covers shared store AND each vertical store independently.

*Protected §1 files the migration edits — "do not break" rules that still apply DURING migration:*
- `accounts.js` — also protected by **"Transfer HITL enforcement"** (Phase 170: keep the
  `if (v.normalized.type === 'transfer')` check before amount threshold + 428 enforcement).
  `transactionConsentChallenge.js` is NOT deleted, so that entry stays valid — but banking's
  `getAuthz()` must reproduce the action-type-aware, threshold-aware gate.
- `store.js`, `nlIntentParser.js`, `geminiNlIntent.js`, `demoAgentLangGraphService.js`,
  `router.ts` — edited/trimmed; preserve all unrelated behavior in each.

*Behaviors the new plugin model MUST preserve (from §4 bug-log patterns, promote to §1):*
- **Active-vertical drives ALL UI, zero banking fallback** (from 2026-05-28 "header/sidenav/
  feature page follow active theme" + "vertical-aware UI strings"). The old `ThemeContext`/
  `useTheme()` indirection is replaced by active-vertical → `getManifest()`, but the guarantee
  is identical and is already this design's hard invariant. Add as a §1 entry in plugin terms.
- **Scope topology SSOT** — scopes stay generic (`read`/`write`/`transfer`); runtime scope maps
  must keep *deriving* from the active plugin's `getTools()`, never be re-authored in shared
  code (`mcpWebSocketClient.js` `MCP_TOOL_SCOPES`, gateway `toolScopes.ts`). Compatible with the
  design; restate the SSOT source as the plugin rather than `scope-topology.json`.

*New §1 entries to ADD before deleting (protect the new load-bearing infra):*
1. "Per-vertical data store persistence" — backup/recovery for each vertical store.
2. "Active-vertical manifest drives all UI (no banking fallback)" — the invariant, in plugin terms.
3. "Per-vertical tool + authz dispatch; shared layer stays banking-blind" — `verticalDispatch`
   active-vertical→plugin lookup replaces `routeTool`/`APIKEY_TOOLS` without regressing routing.
4. "Vertical switching lifecycle" — if runtime switching is kept, define the per-vertical
   store snapshot/restore contract that replaces `reseedAllCustomersForVertical`.

### Cross-cutting (Plan 6 close-out)
- The **no-fallback assertion** test is extended per vertical as each ships.
- Once all 5 are plugins, the dual-mode fallback is removed and a test asserts
  `hasPlugin(id) === true` for every discovered vertical (no vertical may run legacy).
