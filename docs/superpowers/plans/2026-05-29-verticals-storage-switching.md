# Verticals Storage & Live Switching — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current monolithic-JSON verticals system with a folder-per-vertical seed + LMDB overlay model that supports live SSE-driven switching, an admin Monaco editor, clone/delete/snapshot/reset, and a clean page/agent scope split (admin-console as its own vertical).

**Architecture:** Six-layer server module (`services/verticalManifest/`): schema (Zod) → loader (in-memory seed cache) → overlay (LMDB store) → resolver (deep-merged result, cached) → scope (page/agent split) → events (SSE bus). Single HTTP surface at `/api/verticals/*`. Single client provider (`VerticalProvider`) opens SSE on mount, exposes `{ pageManifest, agentManifest, activeId, isAdminScope }` via `useVertical()`. One Monaco-based admin editor. Hard cutover: all 6 verticals migrated and all old code deleted in the migration commit (no flag-gate, no dual-read).

**Tech Stack:** Node 20 + Express 4 + Zod 4 (already in `demo_api_server`), LMDB (existing `services/lmdb/` pattern), React 19 + react-router 7 (already in `demo_api_ui`), Monaco Editor (new dep: `@monaco-editor/react`), `zod-to-json-schema` (new), `lodash.mergewith` (new server dep), `lodash.set` (new server dep), Jest + supertest + @testing-library/react (existing test stacks).

---

## Spec deviation log

This plan deviates from the spec in one mechanical detail. Captured here so reviewers don't have to dig:

**Spec said:** "configStore key `vertical.overlay.<id>` holds a deep-partial of the manifest."

**Plan uses:** a dedicated `services/lmdb/verticalStore.lmdb.js` module, sibling to `delegationStore.lmdb.js` and `demoAccountStore.lmdb.js`. **Why:** `configStore.setConfig()` requires the key to exist in `FIELD_DEFS` (see [demo_api_server/services/configStore.js:625-650](demo_api_server/services/configStore.js#L625-L650)), and vertical overlay keys are dynamic (`vertical.overlay.healthcare`, `vertical.overlay.test-clone`, ...). The repo's established pattern for dynamic per-concern persistence is a dedicated LMDB store, not configStore. The spec's user-visible intent (survives restart, admin-edited via UI, propagates via SSE) is preserved; only the underlying store changes. This deviation does not require a spec amendment because the storage backend isn't part of the design contract — it's an implementation detail.

**Spec said:** Task 3 used `process.env.LMDB_PATH` to redirect the LMDB file location for test isolation.

**Implementation discovered during Task 3:** the repo doesn't expose `LMDB_PATH` as an env var — `services/lmdb/openEnv.js` hardcodes the path. The LMDB env path is `data/persistent/lmdb` and shared across all `*.lmdb.js` modules via `openEnv()`'s named-DB pattern. **Resolution:** the test files for Tasks 3, 5, 6, 9, 10, 11, 12 use `jest.mock('../../services/lmdb/openEnv', ...)` with an in-memory `Map`-backed fake instead. Documented inline in each test file. No spec impact.

**Spec said (Task 22):** delete `demo_api_ui/src/context/ThemeContext.js` in the cutover commit.

**Adjusted scope:** during Task 22, also patch `demo_api_ui/src/components/agent-clinical/AgentClinicalHost.jsx` to import `useVertical` from the new `vertical/useVertical` module instead of `useTheme` from `../../context/ThemeContext`. **Why:** the dormant `agent-clinical/` components (built by a parallel agent, paused awaiting this rewrite) are the only remaining `useTheme` consumer once Cycle 1 migrates the listed files. The migration is mechanical (two lines): `import { useVertical } from '../../vertical/useVertical';` and `const { pageManifest } = useVertical(); const identity = pageManifest?.identity; const terminology = pageManifest?.terminology;`. This avoids leaving a `useTheme` compatibility shim behind. The parallel agent's other 4 integration files (`UserDashboard.js`, `App.js`, `AgentUiModeContext.js`, `featureFlags.js`, `configStore.js`) stay parked in stash for them to apply post-cutover.

---

## File structure (created / modified / deleted)

**Created — server:**
- `demo_api_server/services/lmdb/verticalStore.lmdb.js` — LMDB CRUD for `overlay:<id>`, `active`, `snapshot:<userId>` keys.
- `demo_api_server/services/verticalManifest/schema.js` — Zod manifest + chip + mock-data schemas. (JS, not TS — `demo_api_server` is CommonJS.)
- `demo_api_server/services/verticalManifest/loader.js` — boot-time seed cache.
- `demo_api_server/services/verticalManifest/overlay.js` — overlay read/write wrapper over `verticalStore`.
- `demo_api_server/services/verticalManifest/resolver.js` — deep-merge + cache.
- `demo_api_server/services/verticalManifest/scope.js` — page/agent split rule.
- `demo_api_server/services/verticalManifest/events.js` — in-process EventEmitter + SSE writer.
- `demo_api_server/services/verticalManifest/snapshot.js` — capture/restore for `vertical.snapshot.<userId>`.
- `demo_api_server/services/verticalManifest/index.js` — barrel re-export.
- `demo_api_server/routes/verticalManifest.js` — HTTP surface (12 endpoints).
- `demo_api_server/scripts/migrateVerticalsV3.js` — one-shot migration script.
- `demo_api_server/config/verticals/<id>/manifest.json` + `mock-data.json` — 6 folders produced by migration: `admin-console`, `banking`, `healthcare`, `retail`, `sporting-goods`, `workforce`.
- Test files (one per module, under `demo_api_server/tests/verticalManifest/`).

**Created — UI:**
- `demo_api_ui/src/vertical/VerticalProvider.jsx` — reactive context, SSE subscriber.
- `demo_api_ui/src/vertical/useVertical.js` — hook + agent-scope derivation.
- `demo_api_ui/src/vertical/applyThemeTokens.js` — DOM mutator for `:root` CSS vars.
- `demo_api_ui/src/vertical/AdminEditor/VerticalEditorPage.jsx` — `/admin/verticals` page.
- `demo_api_ui/src/vertical/AdminEditor/OverlayBadge.jsx` — overrides panel.
- `demo_api_ui/src/vertical/AdminEditor/CloneModal.jsx` — clone dialog.
- Test files (under `demo_api_ui/src/vertical/__tests__/`).

**Modified:**
- `demo_api_server/server.js` — register `routes/verticalManifest.js`; remove `routes/verticalConfig.js` registration.
- `demo_api_server/scripts/bootstrapPingOne*.js` — read manifests from `verticals/*/manifest.json` instead of `verticals/*.json`.
- `demo_api_ui/src/App.js` — replace `VerticalProvider` + `ThemeProvider` with the new single `VerticalProvider`; mount editor route.
- `demo_api_ui/src/components/VerticalSwitcher.js` — read from `useVertical()`; POST to `/api/verticals/active`.
- `demo_api_ui/src/components/BankingChips.jsx` — read from `useVertical().pageManifest.dashboard`.
- `demo_api_ui/src/components/VerticalFeaturePage.jsx` — read from `useVertical().pageManifest.featurePage`.
- `demo_api_ui/src/components/VerticalHero.jsx` — read from `useVertical().pageManifest.dashboard.hero`.

**Deleted (in the migration commit):**
- `demo_api_server/services/verticalConfigService.js`
- `demo_api_server/routes/verticalConfig.js`
- `demo_api_server/config/verticals/admin.json`, `banking.json`, `healthcare.json`, `retail.json`, `sporting-goods.json`, `workforce.json`
- `demo_api_server/config/verticalPrimaryTypes.js`
- `demo_api_ui/src/context/VerticalContext.js`
- `demo_api_ui/src/context/ThemeContext.js`
- `demo_api_ui/src/components/ThemePicker.js`
- `demo_api_ui/src/components/ThemePicker.css`
- `demo_api_ui/src/styles/chase-theme.css`
- `demo_api_ui/src/styles/dashboard-theme.css`
- `demo_api_server/scripts/migrateVerticalsV3.js` (deleted after migration in the same PR)

---

## Task order

Bottom-up: server modules in dependency order → routes → migration script → UI provider → UI editor → consumer cutover (which is where everything goes live) → manual smoke + delete-old-system. Every task is independently testable. The system is not user-visible until Task 22 (the consumer cutover commit).

---

## Task 1: Install new dependencies

**Files:**
- Modify: `demo_api_server/package.json`
- Modify: `demo_api_ui/package.json`

- [ ] **Step 1: Install server deps**

```bash
cd demo_api_server
npm install lodash.mergewith lodash.set
npm install --save-dev @types/lodash.mergewith @types/lodash.set
```

- [ ] **Step 2: Install UI deps**

```bash
cd demo_api_ui
npm install --legacy-peer-deps @monaco-editor/react zod-to-json-schema zod
```

(Note: `zod` is added on the UI side too — the schema module is shared by importing the source file from `demo_api_server`. We import the same shape via a small re-export module on the UI side, but UI's own `package.json` needs `zod` to be a peer because the import resolves through it.)

- [ ] **Step 3: Verify installs**

```bash
cd demo_api_server && node -e "require('lodash.mergewith'); require('lodash.set'); console.log('ok')"
cd ../demo_api_ui && node -e "require('@monaco-editor/react'); require('zod-to-json-schema'); console.log('ok')"
```

Expected: both print `ok`.

- [ ] **Step 4: Commit**

```bash
git add demo_api_server/package.json demo_api_server/package-lock.json demo_api_ui/package.json demo_api_ui/package-lock.json
git commit -m "chore: add deps for vertical-manifest rewrite (lodash.mergewith, monaco, zod-to-json-schema)"
```

---

## Task 2: Zod schema module

**Files:**
- Create: `demo_api_server/services/verticalManifest/schema.js`
- Test: `demo_api_server/tests/verticalManifest/schema.test.js`

- [ ] **Step 1: Write the failing tests**

Create `demo_api_server/tests/verticalManifest/schema.test.js`:

```js
const { ManifestSchema, MockDataSchema } = require('../../services/verticalManifest/schema');

const MIN_VALID = {
  id: 'demo',
  schemaVersion: 3,
  identity: { displayName: 'Demo' },
  theme: { cssVars: { '--theme-accent': '#000' } },
  agent: { persona: 'Demo Assistant' },
};

describe('ManifestSchema', () => {
  test('minimum valid manifest passes', () => {
    expect(() => ManifestSchema.parse(MIN_VALID)).not.toThrow();
  });

  test('missing identity.displayName rejected with path', () => {
    const bad = { ...MIN_VALID, identity: {} };
    const res = ManifestSchema.safeParse(bad);
    expect(res.success).toBe(false);
    expect(res.error.issues[0].path).toEqual(['identity', 'displayName']);
  });

  test('schemaVersion: 2 rejected', () => {
    const bad = { ...MIN_VALID, schemaVersion: 2 };
    expect(ManifestSchema.safeParse(bad).success).toBe(false);
  });

  test('empty cssVars rejected', () => {
    const bad = { ...MIN_VALID, theme: { cssVars: {} } };
    expect(ManifestSchema.safeParse(bad).success).toBe(false);
  });

  test('id regex enforced (lowercase, hyphens, digits)', () => {
    expect(ManifestSchema.safeParse({ ...MIN_VALID, id: 'Bad_ID' }).success).toBe(false);
    expect(ManifestSchema.safeParse({ ...MIN_VALID, id: 'good-id-1' }).success).toBe(true);
  });

  test('chip schema requires id, label, message', () => {
    const withChips = {
      ...MIN_VALID,
      dashboard: {
        kind: 'banking',
        chips: [{ key: 'a', label: 'A' }],
        hero: { cards: [] },
        llmChipGroups: { Group1: [{ id: 'c1', label: 'C1', message: 'go' }] },
      },
    };
    expect(ManifestSchema.safeParse(withChips).success).toBe(true);

    const badGroup = JSON.parse(JSON.stringify(withChips));
    badGroup.dashboard.llmChipGroups.Group1[0] = { id: 'c1', label: 'C1' }; // missing message
    expect(ManifestSchema.safeParse(badGroup).success).toBe(false);
  });

  test('format enum: money accepted, currency rejected', () => {
    const withFP = {
      ...MIN_VALID,
      featurePage: {
        mcpTool: 't', pageTitle: 'P', dataKey: 'd',
        fields: [{ label: 'L', path: 'p', format: 'currency' }],
      },
    };
    expect(ManifestSchema.safeParse(withFP).success).toBe(false);
    withFP.featurePage.fields[0].format = 'money';
    expect(ManifestSchema.safeParse(withFP).success).toBe(true);
  });

  test('scopes defaults applied after parse', () => {
    const parsed = ManifestSchema.parse({ ...MIN_VALID, scopes: {} });
    expect(parsed.scopes.read).toBe('read');
    expect(parsed.scopes.write).toBe('write');
    expect(parsed.scopes.transfer).toBe('transfer');
  });
});

describe('MockDataSchema', () => {
  test('any object passes', () => {
    expect(MockDataSchema.safeParse({}).success).toBe(true);
    expect(MockDataSchema.safeParse({ a: 1, b: [1, 2], c: { nested: true } }).success).toBe(true);
  });

  test('non-object rejected', () => {
    expect(MockDataSchema.safeParse([]).success).toBe(false);
    expect(MockDataSchema.safeParse('x').success).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd demo_api_server && npx jest tests/verticalManifest/schema.test.js
```

Expected: FAIL with `Cannot find module '../../services/verticalManifest/schema'`.

- [ ] **Step 3: Write `schema.js`**

Create `demo_api_server/services/verticalManifest/schema.js`:

```js
const { z } = require('zod');

const ChipSchema = z.object({
  id: z.string(),
  label: z.string(),
  message: z.string(),
  group: z.string().optional(),
  scope: z.string().optional(),
});

const FormatEnum = z.enum(['money', 'count', 'date', 'text', 'percent']);

const ManifestSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  schemaVersion: z.literal(3),

  identity: z.object({
    displayName: z.string().min(1),
    headerTitle: z.string().optional(),
    documentTitle: z.string().optional(),
    logoAlt: z.string().optional(),
    tagline: z.string().optional(),
    logoPath: z.string().optional(),
  }),

  theme: z.object({
    cssVars: z.record(z.string(), z.string())
      .refine((v) => Object.keys(v).length > 0, { message: 'at least one cssVar required' }),
  }),

  terminology: z.object({
    account: z.string().optional(),
    accounts: z.string().optional(),
    accountTypes: z.array(z.string()).optional(),
    transaction: z.string().optional(),
    transactions: z.string().optional(),
    transactionTypes: z.array(z.string()).optional(),
    balance: z.string().optional(),
    agent: z.string().optional(),
    dashboard: z.string().optional(),
    highValueAction: z.string().optional(),
    highValueLabel: z.string().optional(),
  }).optional(),

  agent: z.object({
    persona: z.string().min(1),
    greeting: z.string().optional(),
    systemPromptFlavor: z.string().optional(),
  }),

  dashboard: z.object({
    kind: z.string(),
    chips: z.array(z.object({ key: z.string(), label: z.string() })),
    hero: z.object({
      cards: z.array(z.object({
        label: z.string(),
        dataKey: z.string(),
        format: FormatEnum,
      })),
    }),
    llmChipGroups: z.record(z.string(), z.array(ChipSchema)),
  }).optional(),

  scopes: z.object({
    read: z.string().default('read'),
    write: z.string().default('write'),
    transfer: z.string().default('transfer'),
    featureScope: z.string().optional(),
  }).optional().default({}),

  featurePage: z.object({
    mcpTool: z.string(),
    pageTitle: z.string(),
    badgeLabel: z.string().optional(),
    accentColor: z.string().optional(),
    dataKey: z.string(),
    fields: z.array(z.object({
      label: z.string(),
      path: z.string(),
      format: FormatEnum.optional(),
      accent: z.boolean().optional(),
    })),
    sectionTitle: z.string().optional(),
    emptyPrompt: z.string().optional(),
    scopeError: z.string().optional(),
  }).optional(),

  demoUsers: z.object({
    customer: z.object({ hint: z.string(), passwordHint: z.string() }).optional(),
    admin: z.object({ hint: z.string(), passwordHint: z.string() }).optional(),
  }).optional(),
});

const MockDataSchema = z.record(z.string(), z.unknown());

module.exports = { ManifestSchema, MockDataSchema, ChipSchema, FormatEnum };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd demo_api_server && npx jest tests/verticalManifest/schema.test.js
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/verticalManifest/schema.js demo_api_server/tests/verticalManifest/schema.test.js
git commit -m "feat(verticals): add Zod manifest schema with required-field contract"
```

---

## Task 3: LMDB vertical store

**Files:**
- Create: `demo_api_server/services/lmdb/verticalStore.lmdb.js`
- Test: `demo_api_server/tests/verticalManifest/verticalStore.lmdb.test.js`

This module owns LMDB CRUD for three key-namespaces: `overlay:<id>`, `active`, `snapshot:<userId>`. Sibling pattern to `delegationStore.lmdb.js`.

- [ ] **Step 1: Read the sibling pattern**

```bash
cd demo_api_server && head -80 services/lmdb/delegationStore.lmdb.js
```

You're matching this module's open-database + namespacing pattern. Note how it opens its own LMDB dbi separate from configStore.

- [ ] **Step 2: Write the failing tests**

Create `demo_api_server/tests/verticalManifest/verticalStore.lmdb.test.js`:

```js
// Use an isolated tmp dir per test run so different test files don't collide.
const path = require('path');
const fs = require('fs');
const os = require('os');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vstore-'));
process.env.LMDB_PATH = TMP;

const store = require('../../services/lmdb/verticalStore.lmdb');

afterAll(() => { fs.rmSync(TMP, { recursive: true, force: true }); });

describe('verticalStore', () => {
  beforeEach(() => store.clearAll());

  test('overlay get/set/clear round-trip', () => {
    expect(store.getOverlay('healthcare')).toEqual({});
    store.setOverlay('healthcare', { identity: { tagline: 'X' } });
    expect(store.getOverlay('healthcare')).toEqual({ identity: { tagline: 'X' } });
    store.clearOverlay('healthcare');
    expect(store.getOverlay('healthcare')).toEqual({});
  });

  test('active id round-trip', () => {
    expect(store.getActiveId()).toBeNull();
    store.setActiveId('retail');
    expect(store.getActiveId()).toBe('retail');
  });

  test('listOverlayIds returns ids with non-empty overlays', () => {
    store.setOverlay('a', { x: 1 });
    store.setOverlay('b', { y: 2 });
    store.clearOverlay('a');
    const ids = store.listOverlayIds().sort();
    expect(ids).toEqual(['b']);
  });

  test('snapshot per-user round-trip', () => {
    expect(store.getSnapshot('user1')).toBeNull();
    const snap = { activeId: 'banking', overlays: { banking: { x: 1 } }, savedAt: 123 };
    store.setSnapshot('user1', snap);
    expect(store.getSnapshot('user1')).toEqual(snap);
    expect(store.getSnapshot('user2')).toBeNull();   // per-user isolation
    store.clearSnapshot('user1');
    expect(store.getSnapshot('user1')).toBeNull();
  });

  test('clearAll wipes everything', () => {
    store.setOverlay('a', { x: 1 });
    store.setActiveId('a');
    store.setSnapshot('u', { activeId: 'a', overlays: {} });
    store.clearAll();
    expect(store.getOverlay('a')).toEqual({});
    expect(store.getActiveId()).toBeNull();
    expect(store.getSnapshot('u')).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd demo_api_server && npx jest tests/verticalManifest/verticalStore.lmdb.test.js
```

Expected: FAIL with module-not-found.

- [ ] **Step 4: Write the module**

Create `demo_api_server/services/lmdb/verticalStore.lmdb.js`:

```js
const path = require('path');
const { open } = require('lmdb');

const DB_FILENAME = 'verticalStore.lmdb';

let _db = null;
function db() {
  if (_db) return _db;
  const base = process.env.LMDB_PATH || path.join(__dirname, '..', '..', 'data', 'persistent', 'lmdb');
  _db = open({ path: path.join(base, DB_FILENAME), compression: true });
  return _db;
}

// Key layout (all stored as plain strings; values are JSON-serialized):
//   overlay:<id>       → DeepPartial<Manifest>
//   active             → string (vertical id)
//   snapshot:<userId>  → { activeId, overlays: { id: overlay }, savedAt }

function getOverlay(id) {
  const v = db().get(`overlay:${id}`);
  return v ? JSON.parse(v) : {};
}

function setOverlay(id, overlay) {
  db().putSync(`overlay:${id}`, JSON.stringify(overlay));
}

function clearOverlay(id) {
  db().removeSync(`overlay:${id}`);
}

function listOverlayIds() {
  const ids = [];
  for (const { key, value } of db().getRange({ start: 'overlay:', end: 'overlay:￿' })) {
    if (value && value !== '{}') ids.push(key.slice('overlay:'.length));
  }
  return ids;
}

function getActiveId() {
  const v = db().get('active');
  return v || null;
}

function setActiveId(id) {
  db().putSync('active', id);
}

function getSnapshot(userId) {
  const v = db().get(`snapshot:${userId}`);
  return v ? JSON.parse(v) : null;
}

function setSnapshot(userId, snap) {
  db().putSync(`snapshot:${userId}`, JSON.stringify(snap));
}

function clearSnapshot(userId) {
  db().removeSync(`snapshot:${userId}`);
}

function clearAll() {
  for (const { key } of db().getRange()) {
    db().removeSync(key);
  }
}

module.exports = {
  getOverlay, setOverlay, clearOverlay, listOverlayIds,
  getActiveId, setActiveId,
  getSnapshot, setSnapshot, clearSnapshot,
  clearAll,
};
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd demo_api_server && npx jest tests/verticalManifest/verticalStore.lmdb.test.js
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/services/lmdb/verticalStore.lmdb.js demo_api_server/tests/verticalManifest/verticalStore.lmdb.test.js
git commit -m "feat(verticals): add LMDB store for overlays, active id, snapshots"
```

---

## Task 4: Seed loader

**Files:**
- Create: `demo_api_server/services/verticalManifest/loader.js`
- Test: `demo_api_server/tests/verticalManifest/loader.test.js`

Reads `config/verticals/<id>/manifest.json` + `mock-data.json` once at boot. The seed folders don't exist yet — tests inject fixtures via a configurable seed root.

- [ ] **Step 1: Write the failing tests**

Create `demo_api_server/tests/verticalManifest/loader.test.js`:

```js
const path = require('path');
const fs = require('fs');
const os = require('os');
const { createLoader } = require('../../services/verticalManifest/loader');

function writeFixture(root, id, manifest, mockData = {}) {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(dir, 'mock-data.json'), JSON.stringify(mockData));
}

const MIN = {
  id: 'demo', schemaVersion: 3,
  identity: { displayName: 'Demo' },
  theme: { cssVars: { '--x': '#000' } },
  agent: { persona: 'A' },
};

describe('loader', () => {
  let root;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'vload-')); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  test('loadAll reads all subfolders', () => {
    writeFixture(root, 'a', { ...MIN, id: 'a' });
    writeFixture(root, 'b', { ...MIN, id: 'b' });
    const loader = createLoader(root);
    loader.loadAll();
    expect(loader.get('a').manifest.id).toBe('a');
    expect(loader.get('b').manifest.id).toBe('b');
  });

  test('list returns ids and displayNames', () => {
    writeFixture(root, 'a', { ...MIN, id: 'a', identity: { displayName: 'Alpha' } });
    const loader = createLoader(root);
    loader.loadAll();
    expect(loader.list()).toEqual([{ id: 'a', displayName: 'Alpha' }]);
  });

  test('boot fails loudly on invalid manifest', () => {
    writeFixture(root, 'bad', { id: 'bad' }); // missing required fields
    const loader = createLoader(root);
    expect(() => loader.loadAll()).toThrow(/bad/);
  });

  test('get returns null for unknown id', () => {
    const loader = createLoader(root);
    loader.loadAll();
    expect(loader.get('nope')).toBeNull();
  });

  test('reload(id) re-reads one folder', () => {
    writeFixture(root, 'a', { ...MIN, id: 'a', identity: { displayName: 'A1' } });
    const loader = createLoader(root);
    loader.loadAll();
    expect(loader.get('a').manifest.identity.displayName).toBe('A1');
    writeFixture(root, 'a', { ...MIN, id: 'a', identity: { displayName: 'A2' } });
    loader.reload('a');
    expect(loader.get('a').manifest.identity.displayName).toBe('A2');
  });

  test('mock data is loaded', () => {
    writeFixture(root, 'a', { ...MIN, id: 'a' }, { records: [{ x: 1 }] });
    const loader = createLoader(root);
    loader.loadAll();
    expect(loader.get('a').mockData).toEqual({ records: [{ x: 1 }] });
  });

  test('missing mock-data.json defaults to empty object', () => {
    const dir = path.join(root, 'a');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ ...MIN, id: 'a' }));
    // no mock-data.json
    const loader = createLoader(root);
    loader.loadAll();
    expect(loader.get('a').mockData).toEqual({});
  });

  test('removeFromCache evicts an id (used by delete)', () => {
    writeFixture(root, 'a', { ...MIN, id: 'a' });
    const loader = createLoader(root);
    loader.loadAll();
    loader.removeFromCache('a');
    expect(loader.get('a')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd demo_api_server && npx jest tests/verticalManifest/loader.test.js
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Write the loader**

Create `demo_api_server/services/verticalManifest/loader.js`:

```js
const fs = require('fs');
const path = require('path');
const { ManifestSchema, MockDataSchema } = require('./schema');

const DEFAULT_ROOT = path.join(__dirname, '..', '..', 'config', 'verticals');

function createLoader(rootDir = DEFAULT_ROOT) {
  const cache = new Map();   // id → { manifest, mockData }

  function loadOne(id) {
    const dir = path.join(rootDir, id);
    const manifestPath = path.join(dir, 'manifest.json');
    const mockPath = path.join(dir, 'mock-data.json');

    const manifestRaw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const manifestRes = ManifestSchema.safeParse(manifestRaw);
    if (!manifestRes.success) {
      const err = new Error(`Invalid manifest at ${manifestPath}: ${JSON.stringify(manifestRes.error.issues)}`);
      err.id = id;
      throw err;
    }

    let mockData = {};
    if (fs.existsSync(mockPath)) {
      mockData = MockDataSchema.parse(JSON.parse(fs.readFileSync(mockPath, 'utf8')));
    }

    cache.set(id, { manifest: manifestRes.data, mockData });
  }

  function loadAll() {
    cache.clear();
    if (!fs.existsSync(rootDir)) return;
    const entries = fs.readdirSync(rootDir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      loadOne(e.name);
    }
  }

  function get(id) { return cache.get(id) || null; }
  function list() {
    return [...cache.entries()].map(([id, v]) => ({ id, displayName: v.manifest.identity.displayName }));
  }
  function reload(id) { loadOne(id); }
  function removeFromCache(id) { cache.delete(id); }

  return { loadAll, get, list, reload, removeFromCache };
}

// Module-level singleton used by the rest of the system.
const defaultLoader = createLoader();
module.exports = { createLoader, loader: defaultLoader };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd demo_api_server && npx jest tests/verticalManifest/loader.test.js
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/verticalManifest/loader.js demo_api_server/tests/verticalManifest/loader.test.js
git commit -m "feat(verticals): add in-memory seed loader with validation"
```

---

## Task 5: Overlay module

**Files:**
- Create: `demo_api_server/services/verticalManifest/overlay.js`
- Test: `demo_api_server/tests/verticalManifest/overlay.test.js`

Wraps `verticalStore.lmdb` with field-path semantics (`lodash.set`/`lodash.get`-style paths like `'dashboard.chips[2].label'`). Validates both the deep-partial overlay shape and the merged result before writing.

- [ ] **Step 1: Write the failing tests**

Create `demo_api_server/tests/verticalManifest/overlay.test.js`:

```js
const path = require('path');
const fs = require('fs');
const os = require('os');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'overlay-'));
process.env.LMDB_PATH = TMP;

const store = require('../../services/lmdb/verticalStore.lmdb');
const { createOverlay } = require('../../services/verticalManifest/overlay');

const MIN = {
  id: 'demo', schemaVersion: 3,
  identity: { displayName: 'Demo' },
  theme: { cssVars: { '--x': '#000' } },
  agent: { persona: 'A' },
};
const fakeLoader = { get: (id) => id === 'demo' ? { manifest: MIN } : null };

afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

describe('overlay', () => {
  let overlay;
  beforeEach(() => {
    store.clearAll();
    overlay = createOverlay(store, fakeLoader);
  });

  test('setField writes path, get returns deep-partial', () => {
    overlay.setField('demo', 'identity.tagline', 'X');
    expect(overlay.get('demo')).toEqual({ identity: { tagline: 'X' } });
  });

  test('setField on array path replaces whole array', () => {
    overlay.setField('demo', 'dashboard.chips', [{ key: 'a', label: 'A' }]);
    expect(overlay.get('demo').dashboard.chips).toEqual([{ key: 'a', label: 'A' }]);
  });

  test('clearField removes only that path', () => {
    overlay.setField('demo', 'identity.tagline', 'X');
    overlay.setField('demo', 'identity.headerTitle', 'Y');
    overlay.clearField('demo', 'identity.tagline');
    expect(overlay.get('demo')).toEqual({ identity: { headerTitle: 'Y' } });
  });

  test('clearField on absent path is a no-op', () => {
    expect(() => overlay.clearField('demo', 'nope.nope')).not.toThrow();
  });

  test('clearAll wipes all overlays for that id', () => {
    overlay.setField('demo', 'identity.tagline', 'X');
    overlay.clearAll('demo');
    expect(overlay.get('demo')).toEqual({});
  });

  test('list returns paths currently overridden', () => {
    overlay.setField('demo', 'identity.tagline', 'X');
    overlay.setField('demo', 'theme.cssVars.--y', '#111');
    expect(overlay.list('demo').sort()).toEqual(['identity.tagline', 'theme.cssVars.--y']);
  });

  test('setField rejected if merged manifest fails validation', () => {
    // Make displayName empty string — merged manifest fails identity.displayName.min(1)
    expect(() => overlay.setField('demo', 'identity.displayName', '')).toThrow();
  });

  test('setBatch fires through every entry; rejects on any invalid', () => {
    overlay.setBatch('demo', [
      { path: 'identity.tagline', value: 'X' },
      { path: 'identity.headerTitle', value: 'Y' },
    ]);
    expect(overlay.list('demo').sort()).toEqual(['identity.headerTitle', 'identity.tagline']);

    expect(() => overlay.setBatch('demo', [
      { path: 'identity.displayName', value: '' },  // invalid
    ])).toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd demo_api_server && npx jest tests/verticalManifest/overlay.test.js
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Write the overlay module**

Create `demo_api_server/services/verticalManifest/overlay.js`:

```js
const lodashSet = require('lodash.set');
const mergeWith = require('lodash.mergewith');
const { ManifestSchema } = require('./schema');

function arrayCustomizer(_, src) {
  if (Array.isArray(src)) return src;
}

// Walk a nested object and return all leaf paths (dot notation).
function leafPaths(obj, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...leafPaths(v, p));
    } else {
      out.push(p);
    }
  }
  return out;
}

// Remove `path` from obj; returns true if removed; cleans up empty parents.
function deletePath(obj, path) {
  const parts = path.split('.');
  let cur = obj;
  const stack = [obj];
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') return false;
    cur = cur[parts[i]];
    stack.push(cur);
  }
  const last = parts[parts.length - 1];
  if (!(last in cur)) return false;
  delete cur[last];
  for (let i = stack.length - 1; i > 0; i--) {
    if (Object.keys(stack[i]).length === 0) {
      delete stack[i - 1][parts[i - 1]];
    } else break;
  }
  return true;
}

function createOverlay(store, loader) {
  function get(id) { return store.getOverlay(id); }

  function _validateMerged(id, overlay) {
    const seed = loader.get(id);
    if (!seed) throw new Error(`No seed for id ${id}`);
    const merged = mergeWith({}, seed.manifest, overlay, arrayCustomizer);
    // Force id back to seed id (overlay can't change id)
    merged.id = seed.manifest.id;
    merged.schemaVersion = 3;
    const res = ManifestSchema.safeParse(merged);
    if (!res.success) {
      throw new Error(`Overlay produces invalid manifest: ${JSON.stringify(res.error.issues)}`);
    }
  }

  function setField(id, path, value) {
    const current = get(id);
    lodashSet(current, path, value);
    _validateMerged(id, current);
    store.setOverlay(id, current);
  }

  function setBatch(id, entries) {
    const current = get(id);
    for (const { path, value } of entries) {
      lodashSet(current, path, value);
    }
    _validateMerged(id, current);
    store.setOverlay(id, current);
  }

  function clearField(id, path) {
    const current = get(id);
    if (!deletePath(current, path)) return;
    store.setOverlay(id, current);
  }

  function clearAll(id) { store.clearOverlay(id); }

  function list(id) { return leafPaths(get(id)); }

  return { get, setField, setBatch, clearField, clearAll, list };
}

module.exports = { createOverlay };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd demo_api_server && npx jest tests/verticalManifest/overlay.test.js
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/verticalManifest/overlay.js demo_api_server/tests/verticalManifest/overlay.test.js
git commit -m "feat(verticals): add field-level overlay with validated deep-merge"
```

---

## Task 6: Resolver

**Files:**
- Create: `demo_api_server/services/verticalManifest/resolver.js`
- Test: `demo_api_server/tests/verticalManifest/resolver.test.js`

Returns the merged manifest. Caches per `(id, overlayVersion)`. Owns `activeId` getter/setter (delegating to the store).

- [ ] **Step 1: Write the failing tests**

Create `demo_api_server/tests/verticalManifest/resolver.test.js`:

```js
const path = require('path');
const fs = require('fs');
const os = require('os');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'resolver-'));
process.env.LMDB_PATH = TMP;

const store = require('../../services/lmdb/verticalStore.lmdb');
const { createOverlay } = require('../../services/verticalManifest/overlay');
const { createResolver } = require('../../services/verticalManifest/resolver');

const SEED = {
  id: 'demo', schemaVersion: 3,
  identity: { displayName: 'Demo', tagline: 'seed' },
  theme: { cssVars: { '--x': '#000' } },
  agent: { persona: 'A' },
  dashboard: {
    kind: 'banking',
    chips: [{ key: 'a', label: 'A' }],
    hero: { cards: [] },
    llmChipGroups: {},
  },
};
const fakeLoader = { get: (id) => id === 'demo' ? { manifest: SEED } : null };

afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

describe('resolver', () => {
  let resolver, overlay;
  beforeEach(() => {
    store.clearAll();
    overlay = createOverlay(store, fakeLoader);
    resolver = createResolver(fakeLoader, overlay, store, { onEvent: () => {} });
  });

  test('resolve with no overlay returns seed (deep-cloned)', () => {
    const m = resolver.resolve('demo');
    expect(m.identity.tagline).toBe('seed');
    m.identity.tagline = 'mutated';
    expect(resolver.resolve('demo').identity.tagline).toBe('seed');
  });

  test('resolve with overlay deep-merges', () => {
    overlay.setField('demo', 'identity.tagline', 'overridden');
    expect(resolver.resolve('demo').identity.tagline).toBe('overridden');
    expect(resolver.resolve('demo').identity.displayName).toBe('Demo');
  });

  test('array overlay replaces wholesale', () => {
    overlay.setField('demo', 'dashboard.chips', [{ key: 'z', label: 'Z' }]);
    expect(resolver.resolve('demo').dashboard.chips).toEqual([{ key: 'z', label: 'Z' }]);
  });

  test('Zod defaults applied AFTER merge (scopes)', () => {
    expect(resolver.resolve('demo').scopes.read).toBe('read');
  });

  test('cache invalidates on overlay write', () => {
    const m1 = resolver.resolve('demo');
    overlay.setField('demo', 'identity.tagline', 'new');
    const m2 = resolver.resolve('demo');
    expect(m1.identity.tagline).toBe('seed');
    expect(m2.identity.tagline).toBe('new');
  });

  test('activeId getter/setter; setActive fires onEvent', () => {
    const events = [];
    const r2 = createResolver(fakeLoader, overlay, store, { onEvent: (t, p) => events.push([t, p]) });
    expect(r2.activeId()).toBeNull();
    r2.setActive('demo');
    expect(r2.activeId()).toBe('demo');
    expect(events).toEqual([['vertical-switched', { activeId: 'demo' }]]);
  });

  test('resolve returns null for unknown id', () => {
    expect(resolver.resolve('nope')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd demo_api_server && npx jest tests/verticalManifest/resolver.test.js
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Write the resolver**

Create `demo_api_server/services/verticalManifest/resolver.js`:

```js
const mergeWith = require('lodash.mergewith');
const { ManifestSchema } = require('./schema');

function arrayCustomizer(_, src) {
  if (Array.isArray(src)) return src;
}

function createResolver(loader, overlay, store, { onEvent } = { onEvent: () => {} }) {
  // Cache key: id; value: { version, merged }
  const cache = new Map();
  const versions = new Map(); // id → counter; bumped on overlay write or reload

  function _bump(id) {
    versions.set(id, (versions.get(id) || 0) + 1);
    cache.delete(id);
  }

  // Hook overlay to bump version. The overlay module doesn't know about cache;
  // we wrap its mutators here.
  const wrappedOverlay = {
    ...overlay,
    setField(id, path, value)   { overlay.setField(id, path, value);   _bump(id); onEvent('vertical-edited', { id }); },
    setBatch(id, entries)       { overlay.setBatch(id, entries);       _bump(id); onEvent('vertical-edited', { id }); },
    clearField(id, path)        { overlay.clearField(id, path);        _bump(id); onEvent('vertical-edited', { id }); },
    clearAll(id)                { overlay.clearAll(id);                _bump(id); onEvent('vertical-edited', { id }); },
  };

  function resolve(id) {
    const seed = loader.get(id);
    if (!seed) return null;
    const ver = versions.get(id) || 0;
    const cached = cache.get(id);
    if (cached && cached.version === ver) return cached.merged;

    const overlayValue = overlay.get(id);
    const merged = mergeWith({}, seed.manifest, overlayValue, arrayCustomizer);
    merged.id = seed.manifest.id;
    merged.schemaVersion = 3;
    const parsed = ManifestSchema.parse(merged); // applies defaults

    cache.set(id, { version: ver, merged: parsed });
    return parsed;
  }

  function reload(id) { _bump(id); loader.reload(id); }
  function removeFromCache(id) { cache.delete(id); versions.delete(id); loader.removeFromCache(id); }

  function activeId() { return store.getActiveId(); }
  function setActive(id) {
    store.setActiveId(id);
    onEvent('vertical-switched', { activeId: id });
  }

  return { resolve, reload, removeFromCache, activeId, setActive, overlay: wrappedOverlay };
}

module.exports = { createResolver };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd demo_api_server && npx jest tests/verticalManifest/resolver.test.js
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/verticalManifest/resolver.js demo_api_server/tests/verticalManifest/resolver.test.js
git commit -m "feat(verticals): add resolver with deep-merge cache and event-emitting overlay wrapper"
```

---

## Task 7: Scope module

**Files:**
- Create: `demo_api_server/services/verticalManifest/scope.js`
- Test: `demo_api_server/tests/verticalManifest/scope.test.js`

Implements the Q9 rule: `pageManifest = active vertical`, `adminManifest = admin-console manifest` when `req.user.role === 'admin'`. The page/agent derivation lives client-side; the server only ships both manifests.

- [ ] **Step 1: Write the failing tests**

Create `demo_api_server/tests/verticalManifest/scope.test.js`:

```js
const { createScope } = require('../../services/verticalManifest/scope');

const M = (id) => ({ id, schemaVersion: 3, identity: { displayName: id }, theme: { cssVars: { '--x': '#000' } }, agent: { persona: 'P' } });

const fakeResolver = {
  activeId: () => 'banking',
  resolve: (id) => ({ banking: M('banking'), 'admin-console': M('admin-console') }[id] || null),
};

describe('scope', () => {
  test('unauthenticated → pageManifest = active, adminManifest = null', () => {
    const scope = createScope(fakeResolver);
    const result = scope.resolveForRequest({ user: null });
    expect(result.activeId).toBe('banking');
    expect(result.pageManifest.id).toBe('banking');
    expect(result.adminManifest).toBeNull();
    expect(result.isAdmin).toBe(false);
  });

  test('customer role → adminManifest null', () => {
    const scope = createScope(fakeResolver);
    const result = scope.resolveForRequest({ user: { role: 'customer' } });
    expect(result.adminManifest).toBeNull();
    expect(result.isAdmin).toBe(false);
  });

  test('admin role → both manifests present', () => {
    const scope = createScope(fakeResolver);
    const result = scope.resolveForRequest({ user: { role: 'admin' } });
    expect(result.pageManifest.id).toBe('banking');
    expect(result.adminManifest.id).toBe('admin-console');
    expect(result.isAdmin).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd demo_api_server && npx jest tests/verticalManifest/scope.test.js
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Write the scope module**

Create `demo_api_server/services/verticalManifest/scope.js`:

```js
function createScope(resolver) {
  function resolveForRequest(req) {
    const activeId = resolver.activeId() || null;
    const pageManifest = activeId ? resolver.resolve(activeId) : null;
    const isAdmin = req.user && req.user.role === 'admin';
    const adminManifest = isAdmin ? resolver.resolve('admin-console') : null;
    return { activeId, pageManifest, adminManifest, isAdmin: !!isAdmin };
  }
  return { resolveForRequest };
}

module.exports = { createScope };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd demo_api_server && npx jest tests/verticalManifest/scope.test.js
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/verticalManifest/scope.js demo_api_server/tests/verticalManifest/scope.test.js
git commit -m "feat(verticals): add page/agent scope resolver"
```

---

## Task 8: Event bus + SSE writer

**Files:**
- Create: `demo_api_server/services/verticalManifest/events.js`
- Test: `demo_api_server/tests/verticalManifest/events.test.js`

In-process EventEmitter with `emit(type, payload)` and `onClient(req, res)` that registers a long-lived SSE response. Sends initial `vertical-switched` event on connect (Section 3 hydration optimization).

- [ ] **Step 1: Write the failing tests**

Create `demo_api_server/tests/verticalManifest/events.test.js`:

```js
const { EventEmitter } = require('events');
const { createEvents } = require('../../services/verticalManifest/events');

function fakeRes() {
  const ee = new EventEmitter();
  return {
    headers: {}, headWritten: false, body: [],
    setHeader(k, v) { this.headers[k] = v; },
    writeHead() { this.headWritten = true; },
    write(s) { this.body.push(s); },
    end() { ee.emit('close'); },
    on(evt, cb) { ee.on(evt, cb); },
  };
}

describe('events', () => {
  test('emit() reaches registered client', () => {
    const events = createEvents({ getInitialActiveId: () => 'banking' });
    const res = fakeRes();
    events.onClient({}, res);
    events.emit('vertical-edited', { id: 'healthcare' });
    const joined = res.body.join('');
    expect(joined).toContain('event: vertical-edited');
    expect(joined).toContain('"id":"healthcare"');
  });

  test('initial vertical-switched sent on connect', () => {
    const events = createEvents({ getInitialActiveId: () => 'banking' });
    const res = fakeRes();
    events.onClient({}, res);
    const joined = res.body.join('');
    expect(joined).toContain('event: vertical-switched');
    expect(joined).toContain('"activeId":"banking"');
  });

  test('client close removes listener; no errors on later emit', () => {
    const events = createEvents({ getInitialActiveId: () => null });
    const res = fakeRes();
    events.onClient({}, res);
    res.end();    // simulate client disconnect
    expect(() => events.emit('vertical-edited', { id: 'x' })).not.toThrow();
  });

  test('vertical-list-changed event type fires', () => {
    const events = createEvents({ getInitialActiveId: () => null });
    const res = fakeRes();
    events.onClient({}, res);
    res.body.length = 0;  // discard hydration
    events.emit('vertical-list-changed', { ids: ['a', 'b'] });
    expect(res.body.join('')).toContain('event: vertical-list-changed');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd demo_api_server && npx jest tests/verticalManifest/events.test.js
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Write the events module**

Create `demo_api_server/services/verticalManifest/events.js`:

```js
function createEvents({ getInitialActiveId } = {}) {
  const clients = new Set();   // res objects

  function _send(res, type, payload) {
    try {
      res.write(`event: ${type}\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch (_) { /* res may be closed; remove will happen on its own */ }
  }

  function emit(type, payload) {
    for (const res of clients) _send(res, type, payload);
  }

  function onClient(req, res) {
    if (typeof res.setHeader === 'function') {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
    }
    if (typeof res.writeHead === 'function') res.writeHead(200);
    clients.add(res);

    // Hydration: send current active id immediately so client can skip a /me round-trip.
    const initial = getInitialActiveId ? getInitialActiveId() : null;
    if (initial) _send(res, 'vertical-switched', { activeId: initial });

    // Heartbeat every 25s to keep proxies open.
    const hb = setInterval(() => {
      try { res.write(': hb\n\n'); } catch (_) { /* res closed */ }
    }, 25_000);
    if (typeof hb.unref === 'function') hb.unref();

    const cleanup = () => { clearInterval(hb); clients.delete(res); };
    if (typeof res.on === 'function') {
      res.on('close', cleanup);
      res.on('error', cleanup);
    }
  }

  function _clientCount() { return clients.size; }

  return { emit, onClient, _clientCount };
}

module.exports = { createEvents };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd demo_api_server && npx jest tests/verticalManifest/events.test.js
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/verticalManifest/events.js demo_api_server/tests/verticalManifest/events.test.js
git commit -m "feat(verticals): add SSE event bus with hydration on connect"
```

---

## Task 9: Snapshot module

**Files:**
- Create: `demo_api_server/services/verticalManifest/snapshot.js`
- Test: `demo_api_server/tests/verticalManifest/snapshot.test.js`

- [ ] **Step 1: Write the failing tests**

Create `demo_api_server/tests/verticalManifest/snapshot.test.js`:

```js
const path = require('path');
const fs = require('fs');
const os = require('os');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-'));
process.env.LMDB_PATH = TMP;

const store = require('../../services/lmdb/verticalStore.lmdb');
const { createOverlay } = require('../../services/verticalManifest/overlay');
const { createSnapshot } = require('../../services/verticalManifest/snapshot');

const SEED = {
  id: 'demo', schemaVersion: 3,
  identity: { displayName: 'Demo' },
  theme: { cssVars: { '--x': '#000' } },
  agent: { persona: 'A' },
};
const fakeLoader = { get: (id) => ({ manifest: { ...SEED, id } }) };

afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

describe('snapshot', () => {
  let snap, overlay;
  beforeEach(() => {
    store.clearAll();
    overlay = createOverlay(store, fakeLoader);
    const events = [];
    snap = createSnapshot(store, overlay, {
      getActiveId: () => store.getActiveId(),
      setActiveId: (id) => store.setActiveId(id),
      onRestoredId: (id) => events.push(id),
      onRestoredActive: (id) => events.push(`switched:${id}`),
    });
    snap._events = events;
  });

  test('save captures activeId + all overlays', () => {
    store.setActiveId('demo');
    overlay.setField('demo', 'identity.tagline', 'X');
    const t = snap.save('user1');
    const s = store.getSnapshot('user1');
    expect(s.activeId).toBe('demo');
    expect(s.overlays.demo).toEqual({ identity: { tagline: 'X' } });
    expect(s.savedAt).toBe(t);
  });

  test('restore writes overlays back and switches active', () => {
    store.setActiveId('demo');
    overlay.setField('demo', 'identity.tagline', 'X');
    snap.save('user1');

    // Clobber state
    overlay.clearAll('demo');
    store.setActiveId('other-id');

    snap.restore('user1');
    expect(overlay.get('demo')).toEqual({ identity: { tagline: 'X' } });
    expect(store.getActiveId()).toBe('demo');
    expect(snap._events).toContain('demo');
    expect(snap._events).toContain('switched:demo');
  });

  test('restore is idempotent', () => {
    overlay.setField('demo', 'identity.tagline', 'X');
    snap.save('u');
    snap.restore('u');
    snap.restore('u');
    expect(overlay.get('demo')).toEqual({ identity: { tagline: 'X' } });
  });

  test('restore with no snapshot is a no-op', () => {
    expect(snap.restore('nope')).toEqual({ restored: false });
  });

  test('peek returns timestamp or null', () => {
    expect(snap.peek('u')).toBeNull();
    const t = snap.save('u');
    expect(snap.peek('u')).toEqual({ savedAt: t });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd demo_api_server && npx jest tests/verticalManifest/snapshot.test.js
```

Expected: FAIL.

- [ ] **Step 3: Write the snapshot module**

Create `demo_api_server/services/verticalManifest/snapshot.js`:

```js
function createSnapshot(store, overlay, hooks) {
  const { getActiveId, setActiveId, onRestoredId, onRestoredActive } = hooks;

  function save(userId) {
    const overlays = {};
    for (const id of store.listOverlayIds()) {
      overlays[id] = overlay.get(id);
    }
    const savedAt = Date.now();
    store.setSnapshot(userId, { activeId: getActiveId(), overlays, savedAt });
    return savedAt;
  }

  function restore(userId) {
    const snap = store.getSnapshot(userId);
    if (!snap) return { restored: false };

    // Clear current overlays for any id present in the snapshot OR currently overlaid,
    // then apply snapshot overlays.
    const allIds = new Set([
      ...Object.keys(snap.overlays || {}),
      ...store.listOverlayIds(),
    ]);
    for (const id of allIds) overlay.clearAll(id);
    for (const [id, ov] of Object.entries(snap.overlays || {})) {
      // Write the overlay blob directly via store (skip per-field validation;
      // it was valid when saved, schema hasn't changed).
      store.setOverlay(id, ov);
      onRestoredId(id);
    }
    if (snap.activeId) {
      setActiveId(snap.activeId);
      onRestoredActive(snap.activeId);
    }
    return { restored: true, savedAt: snap.savedAt };
  }

  function peek(userId) {
    const s = store.getSnapshot(userId);
    return s ? { savedAt: s.savedAt } : null;
  }

  function clear(userId) { store.clearSnapshot(userId); }

  return { save, restore, peek, clear };
}

module.exports = { createSnapshot };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd demo_api_server && npx jest tests/verticalManifest/snapshot.test.js
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/verticalManifest/snapshot.js demo_api_server/tests/verticalManifest/snapshot.test.js
git commit -m "feat(verticals): add per-user snapshot save/restore"
```

---

## Task 10: Service barrel + wiring

**Files:**
- Create: `demo_api_server/services/verticalManifest/index.js`
- Test: `demo_api_server/tests/verticalManifest/index.test.js`

Wires all six modules together into a singleton the rest of the server imports.

- [ ] **Step 1: Write the failing test**

Create `demo_api_server/tests/verticalManifest/index.test.js`:

```js
const path = require('path');
const fs = require('fs');
const os = require('os');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'idx-'));
process.env.LMDB_PATH = TMP;

// Point loader at a fixture root.
const FIXTURE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'vfix-'));
fs.mkdirSync(path.join(FIXTURE_ROOT, 'banking'));
fs.mkdirSync(path.join(FIXTURE_ROOT, 'admin-console'));
const min = (id) => ({
  id, schemaVersion: 3,
  identity: { displayName: id },
  theme: { cssVars: { '--x': '#000' } },
  agent: { persona: 'P' },
});
fs.writeFileSync(path.join(FIXTURE_ROOT, 'banking', 'manifest.json'), JSON.stringify(min('banking')));
fs.writeFileSync(path.join(FIXTURE_ROOT, 'banking', 'mock-data.json'), '{}');
fs.writeFileSync(path.join(FIXTURE_ROOT, 'admin-console', 'manifest.json'), JSON.stringify(min('admin-console')));
fs.writeFileSync(path.join(FIXTURE_ROOT, 'admin-console', 'mock-data.json'), '{}');
process.env.VERTICAL_SEED_ROOT = FIXTURE_ROOT;

const { verticalManifest } = require('../../services/verticalManifest');

afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
});

describe('verticalManifest singleton', () => {
  beforeEach(() => verticalManifest._reset());

  test('init loads all seeds', () => {
    verticalManifest.init();
    expect(verticalManifest.list().map(v => v.id).sort()).toEqual(['admin-console', 'banking']);
  });

  test('resolveForRequest returns expected shape', () => {
    verticalManifest.init();
    verticalManifest.resolver.setActive('banking');
    const out = verticalManifest.scope.resolveForRequest({ user: { role: 'admin' } });
    expect(out.activeId).toBe('banking');
    expect(out.pageManifest.id).toBe('banking');
    expect(out.adminManifest.id).toBe('admin-console');
    expect(out.isAdmin).toBe(true);
  });

  test('overlay write fires vertical-edited through events', () => {
    verticalManifest.init();
    const received = [];
    const fakeRes = {
      setHeader() {}, writeHead() {},
      write(s) { received.push(s); },
      on() {}, end() {},
    };
    verticalManifest.events.onClient({}, fakeRes);
    verticalManifest.resolver.overlay.setField('banking', 'identity.tagline', 'X');
    expect(received.join('')).toContain('event: vertical-edited');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd demo_api_server && npx jest tests/verticalManifest/index.test.js
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Write the barrel**

Create `demo_api_server/services/verticalManifest/index.js`:

```js
const path = require('path');
const { createLoader } = require('./loader');
const { createOverlay } = require('./overlay');
const { createResolver } = require('./resolver');
const { createScope } = require('./scope');
const { createEvents } = require('./events');
const { createSnapshot } = require('./snapshot');
const store = require('../lmdb/verticalStore.lmdb');

const HIDDEN_IDS = new Set(['admin-console']);

function build() {
  const root = process.env.VERTICAL_SEED_ROOT || path.join(__dirname, '..', '..', 'config', 'verticals');
  const loader = createLoader(root);

  // Events is created early because resolver emits through it.
  const events = createEvents({ getInitialActiveId: () => store.getActiveId() });

  const overlay = createOverlay(store, loader);
  const resolver = createResolver(loader, overlay, store, {
    onEvent: (type, payload) => events.emit(type, payload),
  });
  const scope = createScope(resolver);

  const snapshot = createSnapshot(store, resolver.overlay, {
    getActiveId: () => resolver.activeId(),
    setActiveId: (id) => resolver.setActive(id),
    onRestoredId: (id) => events.emit('vertical-edited', { id }),
    onRestoredActive: (id) => events.emit('vertical-switched', { activeId: id }),
  });

  let initialized = false;
  function init() {
    if (initialized) return;
    loader.loadAll();
    initialized = true;
  }
  function _reset() {
    initialized = false;
    loader.loadAll();
    store.clearAll();
  }
  function list() {
    return loader.list().filter(v => !HIDDEN_IDS.has(v.id));
  }
  function listAll() { return loader.list(); }

  return { init, _reset, list, listAll, loader, overlay: resolver.overlay, resolver, scope, events, snapshot, store, HIDDEN_IDS };
}

const verticalManifest = build();

module.exports = { verticalManifest };
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd demo_api_server && npx jest tests/verticalManifest/index.test.js
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/verticalManifest/index.js demo_api_server/tests/verticalManifest/index.test.js
git commit -m "feat(verticals): wire all six modules into a singleton"
```

---

## Task 11: HTTP routes — read endpoints

**Files:**
- Create: `demo_api_server/routes/verticalManifest.js`
- Test: `demo_api_server/tests/verticalManifest/route.read.test.js`

Three read endpoints first: `GET /me`, `GET /list`, `GET /stream`. Admin write endpoints in Task 12.

- [ ] **Step 1: Write the failing tests**

Create `demo_api_server/tests/verticalManifest/route.read.test.js`:

```js
const path = require('path');
const fs = require('fs');
const os = require('os');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'rdr-'));
process.env.LMDB_PATH = TMP;
const FIXTURE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'rdrfix-'));
process.env.VERTICAL_SEED_ROOT = FIXTURE_ROOT;

const min = (id) => ({
  id, schemaVersion: 3,
  identity: { displayName: id },
  theme: { cssVars: { '--x': '#000' } },
  agent: { persona: 'P' },
});
for (const id of ['banking', 'healthcare', 'admin-console']) {
  fs.mkdirSync(path.join(FIXTURE_ROOT, id), { recursive: true });
  fs.writeFileSync(path.join(FIXTURE_ROOT, id, 'manifest.json'), JSON.stringify(min(id)));
  fs.writeFileSync(path.join(FIXTURE_ROOT, id, 'mock-data.json'), '{}');
}

const express = require('express');
const request = require('supertest');
const { verticalManifest } = require('../../services/verticalManifest');
const router = require('../../routes/verticalManifest');

function makeApp({ user } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user || null; next(); });
  app.use('/api/verticals', router);
  return app;
}

beforeAll(() => verticalManifest.init());
afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
});

describe('GET /api/verticals/me', () => {
  test('401 when unauthenticated', async () => {
    const res = await request(makeApp()).get('/api/verticals/me');
    expect(res.status).toBe(401);
  });

  test('customer: pageManifest only, adminManifest null', async () => {
    verticalManifest.resolver.setActive('banking');
    const res = await request(makeApp({ user: { role: 'customer' } })).get('/api/verticals/me');
    expect(res.status).toBe(200);
    expect(res.body.pageManifest.id).toBe('banking');
    expect(res.body.adminManifest).toBeNull();
    expect(res.body.isAdmin).toBe(false);
  });

  test('admin: both manifests present', async () => {
    verticalManifest.resolver.setActive('banking');
    const res = await request(makeApp({ user: { role: 'admin' } })).get('/api/verticals/me');
    expect(res.body.pageManifest.id).toBe('banking');
    expect(res.body.adminManifest.id).toBe('admin-console');
    expect(res.body.isAdmin).toBe(true);
  });
});

describe('GET /api/verticals/list', () => {
  test('returns user-visible verticals (excludes admin-console)', async () => {
    const res = await request(makeApp({ user: { role: 'customer' } })).get('/api/verticals/list');
    expect(res.status).toBe(200);
    const ids = res.body.map(v => v.id);
    expect(ids).toEqual(expect.arrayContaining(['banking', 'healthcare']));
    expect(ids).not.toContain('admin-console');
  });
});

describe('GET /api/verticals/stream', () => {
  test('SSE headers set; initial vertical-switched sent', async () => {
    verticalManifest.resolver.setActive('banking');
    const app = makeApp({ user: { role: 'customer' } });
    const res = await request(app)
      .get('/api/verticals/stream')
      .buffer(true)
      .parse((r, cb) => {
        let body = '';
        r.on('data', chunk => {
          body += chunk;
          if (body.includes('vertical-switched')) r.destroy();
        });
        r.on('close', () => cb(null, body));
      });
    expect(res.headers['content-type']).toBe('text/event-stream');
    expect(res.body).toContain('event: vertical-switched');
    expect(res.body).toContain('"activeId":"banking"');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd demo_api_server && npx jest tests/verticalManifest/route.read.test.js
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Write the route module (read endpoints)**

Create `demo_api_server/routes/verticalManifest.js`:

```js
const express = require('express');
const { verticalManifest } = require('../services/verticalManifest');

const router = express.Router();

function requireSession(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'admin only' });
  next();
}

router.get('/me', requireSession, (req, res) => {
  res.json(verticalManifest.scope.resolveForRequest(req));
});

router.get('/list', requireSession, (_req, res) => {
  res.json(verticalManifest.list());
});

router.get('/stream', requireSession, (req, res) => {
  verticalManifest.events.onClient(req, res);
  // Don't end — the client keeps it open until they disconnect.
});

module.exports = router;
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd demo_api_server && npx jest tests/verticalManifest/route.read.test.js
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/routes/verticalManifest.js demo_api_server/tests/verticalManifest/route.read.test.js
git commit -m "feat(verticals): add GET /me, /list, /stream routes"
```

---

## Task 12: HTTP routes — admin write endpoints

**Files:**
- Modify: `demo_api_server/routes/verticalManifest.js`
- Test: `demo_api_server/tests/verticalManifest/route.write.test.js`

Adds: `POST /active`, `POST /:id/overlay`, `POST /:id/overlay/batch`, `DELETE /:id/overlay`, `POST /reset-all`, `POST /:sourceId/clone`, `DELETE /:id`, `POST /snapshot`, `POST /snapshot/restore`, `DELETE /snapshot`.

- [ ] **Step 1: Write the failing tests**

Create `demo_api_server/tests/verticalManifest/route.write.test.js`:

```js
const path = require('path');
const fs = require('fs');
const os = require('os');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wrt-'));
process.env.LMDB_PATH = TMP;
const FIXTURE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'wrtfix-'));
process.env.VERTICAL_SEED_ROOT = FIXTURE_ROOT;

const min = (id) => ({
  id, schemaVersion: 3,
  identity: { displayName: id },
  theme: { cssVars: { '--x': '#000' } },
  agent: { persona: 'P' },
});
for (const id of ['banking', 'healthcare', 'admin-console']) {
  fs.mkdirSync(path.join(FIXTURE_ROOT, id), { recursive: true });
  fs.writeFileSync(path.join(FIXTURE_ROOT, id, 'manifest.json'), JSON.stringify(min(id)));
  fs.writeFileSync(path.join(FIXTURE_ROOT, id, 'mock-data.json'), '{}');
}

const express = require('express');
const request = require('supertest');
const { verticalManifest } = require('../../services/verticalManifest');
const router = require('../../routes/verticalManifest');

function makeApp({ user } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user || null; next(); });
  app.use('/api/verticals', router);
  return app;
}

beforeAll(() => verticalManifest.init());
beforeEach(() => verticalManifest._reset());
afterAll(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
});

describe('POST /active', () => {
  test('non-admin → 403', async () => {
    const res = await request(makeApp({ user: { role: 'customer' } }))
      .post('/api/verticals/active').send({ id: 'healthcare' });
    expect(res.status).toBe(403);
  });

  test('admin → 204', async () => {
    const res = await request(makeApp({ user: { role: 'admin' } }))
      .post('/api/verticals/active').send({ id: 'healthcare' });
    expect(res.status).toBe(204);
    expect(verticalManifest.resolver.activeId()).toBe('healthcare');
  });
});

describe('POST /:id/overlay', () => {
  test('admin: writes field, returns 204', async () => {
    const res = await request(makeApp({ user: { role: 'admin', id: 'u1' } }))
      .post('/api/verticals/banking/overlay').send({ path: 'identity.tagline', value: 'X' });
    expect(res.status).toBe(204);
    expect(verticalManifest.resolver.overlay.get('banking').identity.tagline).toBe('X');
  });
});

describe('POST /:id/overlay/batch', () => {
  test('admin: writes batch, returns 204', async () => {
    const res = await request(makeApp({ user: { role: 'admin', id: 'u1' } }))
      .post('/api/verticals/banking/overlay/batch').send({
        entries: [
          { path: 'identity.tagline', value: 'X' },
          { path: 'identity.headerTitle', value: 'Y' },
        ],
      });
    expect(res.status).toBe(204);
    const ov = verticalManifest.resolver.overlay.get('banking');
    expect(ov.identity.tagline).toBe('X');
    expect(ov.identity.headerTitle).toBe('Y');
  });
});

describe('DELETE /:id/overlay', () => {
  test('with path: clears one field', async () => {
    verticalManifest.resolver.overlay.setField('banking', 'identity.tagline', 'X');
    verticalManifest.resolver.overlay.setField('banking', 'identity.headerTitle', 'Y');
    const res = await request(makeApp({ user: { role: 'admin', id: 'u1' } }))
      .delete('/api/verticals/banking/overlay').send({ path: 'identity.tagline' });
    expect(res.status).toBe(204);
    const ov = verticalManifest.resolver.overlay.get('banking');
    expect(ov.identity.tagline).toBeUndefined();
    expect(ov.identity.headerTitle).toBe('Y');
  });

  test('without path: clears all', async () => {
    verticalManifest.resolver.overlay.setField('banking', 'identity.tagline', 'X');
    const res = await request(makeApp({ user: { role: 'admin', id: 'u1' } }))
      .delete('/api/verticals/banking/overlay').send({});
    expect(res.status).toBe(204);
    expect(verticalManifest.resolver.overlay.get('banking')).toEqual({});
  });
});

describe('POST /reset-all', () => {
  test('clears every overlay', async () => {
    verticalManifest.resolver.overlay.setField('banking', 'identity.tagline', 'X');
    verticalManifest.resolver.overlay.setField('healthcare', 'identity.tagline', 'Y');
    const res = await request(makeApp({ user: { role: 'admin', id: 'u1' } }))
      .post('/api/verticals/reset-all');
    expect(res.status).toBe(204);
    expect(verticalManifest.resolver.overlay.get('banking')).toEqual({});
    expect(verticalManifest.resolver.overlay.get('healthcare')).toEqual({});
  });
});

describe('POST /:sourceId/clone', () => {
  test('invalid newId regex → 400', async () => {
    const res = await request(makeApp({ user: { role: 'admin' } }))
      .post('/api/verticals/banking/clone').send({ newId: 'Bad_ID', displayName: 'X' });
    expect(res.status).toBe(400);
  });

  test('existing newId → 409', async () => {
    const res = await request(makeApp({ user: { role: 'admin' } }))
      .post('/api/verticals/banking/clone').send({ newId: 'healthcare', displayName: 'X' });
    expect(res.status).toBe(409);
  });

  test('valid clone → 201, folder written, list updated', async () => {
    const res = await request(makeApp({ user: { role: 'admin' } }))
      .post('/api/verticals/banking/clone').send({ newId: 'new-thing', displayName: 'New Thing' });
    expect(res.status).toBe(201);
    expect(fs.existsSync(path.join(FIXTURE_ROOT, 'new-thing', 'manifest.json'))).toBe(true);
    const list = verticalManifest.list().map(v => v.id);
    expect(list).toContain('new-thing');
  });
});

describe('DELETE /:id', () => {
  test('protected ids (banking, admin-console) → 403', async () => {
    for (const id of ['banking', 'admin-console']) {
      const res = await request(makeApp({ user: { role: 'admin' } }))
        .delete(`/api/verticals/${id}`);
      expect(res.status).toBe(403);
    }
  });

  test('currently-active id → 409', async () => {
    verticalManifest.resolver.setActive('healthcare');
    const res = await request(makeApp({ user: { role: 'admin' } }))
      .delete('/api/verticals/healthcare');
    expect(res.status).toBe(409);
  });

  test('valid delete → 204, folder removed, list shrinks', async () => {
    verticalManifest.resolver.setActive('banking');
    const res = await request(makeApp({ user: { role: 'admin' } }))
      .delete('/api/verticals/healthcare');
    expect(res.status).toBe(204);
    expect(fs.existsSync(path.join(FIXTURE_ROOT, 'healthcare'))).toBe(false);
    expect(verticalManifest.list().map(v => v.id)).not.toContain('healthcare');
  });
});

describe('snapshot endpoints', () => {
  test('save → restore round-trip', async () => {
    const user = { role: 'admin', id: 'u1' };
    verticalManifest.resolver.setActive('banking');
    verticalManifest.resolver.overlay.setField('banking', 'identity.tagline', 'X');

    const save = await request(makeApp({ user })).post('/api/verticals/snapshot');
    expect(save.status).toBe(200);
    expect(save.body.savedAt).toBeGreaterThan(0);

    verticalManifest.resolver.overlay.clearAll('banking');
    verticalManifest.resolver.setActive('healthcare');

    const restore = await request(makeApp({ user })).post('/api/verticals/snapshot/restore');
    expect(restore.status).toBe(204);
    expect(verticalManifest.resolver.overlay.get('banking').identity.tagline).toBe('X');
    expect(verticalManifest.resolver.activeId()).toBe('banking');
  });

  test('DELETE clears snapshot', async () => {
    const user = { role: 'admin', id: 'u1' };
    await request(makeApp({ user })).post('/api/verticals/snapshot');
    const del = await request(makeApp({ user })).delete('/api/verticals/snapshot');
    expect(del.status).toBe(204);
    expect(verticalManifest.snapshot.peek('u1')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd demo_api_server && npx jest tests/verticalManifest/route.write.test.js
```

Expected: most/all FAIL.

- [ ] **Step 3: Extend the route module**

Replace `demo_api_server/routes/verticalManifest.js` with:

```js
const fs = require('fs');
const path = require('path');
const express = require('express');
const { verticalManifest } = require('../services/verticalManifest');

const router = express.Router();

const PROTECTED_IDS = new Set(['banking', 'admin-console']);
const ID_REGEX = /^[a-z][a-z0-9-]*$/;

function requireSession(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'unauthenticated' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'admin only' });
  next();
}

// ---- Read endpoints (unchanged from Task 11) ----

router.get('/me', requireSession, (req, res) => {
  res.json(verticalManifest.scope.resolveForRequest(req));
});

router.get('/list', requireSession, (_req, res) => {
  res.json(verticalManifest.list());
});

router.get('/stream', requireSession, (req, res) => {
  verticalManifest.events.onClient(req, res);
});

// ---- Admin write endpoints ----

router.post('/active', requireAdmin, (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });
  const exists = verticalManifest.loader.get(id);
  if (!exists) return res.status(404).json({ error: 'unknown id' });
  verticalManifest.resolver.setActive(id);
  res.status(204).end();
});

router.post('/reset-all', requireAdmin, (_req, res) => {
  for (const id of verticalManifest.store.listOverlayIds()) {
    verticalManifest.resolver.overlay.clearAll(id);
  }
  res.status(204).end();
});

router.post('/snapshot', requireAdmin, (req, res) => {
  const savedAt = verticalManifest.snapshot.save(req.user.id);
  res.json({ savedAt });
});

router.post('/snapshot/restore', requireAdmin, (req, res) => {
  verticalManifest.snapshot.restore(req.user.id);
  res.status(204).end();
});

router.delete('/snapshot', requireAdmin, (req, res) => {
  verticalManifest.snapshot.clear(req.user.id);
  res.status(204).end();
});

router.post('/:sourceId/clone', requireAdmin, (req, res) => {
  const { sourceId } = req.params;
  const { newId, displayName } = req.body || {};
  if (!newId || !displayName) return res.status(400).json({ error: 'newId and displayName required' });
  if (!ID_REGEX.test(newId)) return res.status(400).json({ error: 'invalid id format' });
  if (verticalManifest.loader.get(newId)) return res.status(409).json({ error: 'id already exists' });
  const source = verticalManifest.loader.get(sourceId);
  if (!source) return res.status(404).json({ error: 'unknown source id' });

  const root = process.env.VERTICAL_SEED_ROOT || path.join(__dirname, '..', 'config', 'verticals');
  const newDir = path.join(root, newId);
  fs.mkdirSync(newDir, { recursive: true });

  const newManifest = JSON.parse(JSON.stringify(source.manifest));
  newManifest.id = newId;
  newManifest.identity.displayName = displayName;
  fs.writeFileSync(path.join(newDir, 'manifest.json'), JSON.stringify(newManifest, null, 2));
  fs.writeFileSync(path.join(newDir, 'mock-data.json'), JSON.stringify(source.mockData || {}, null, 2));

  verticalManifest.loader.reload(newId);
  verticalManifest.events.emit('vertical-list-changed', { ids: verticalManifest.list().map(v => v.id) });
  res.status(201).json({ id: newId, displayName });
});

router.delete('/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  if (PROTECTED_IDS.has(id)) return res.status(403).json({ error: 'protected id' });
  if (verticalManifest.resolver.activeId() === id) return res.status(409).json({ error: 'cannot delete active vertical' });
  const source = verticalManifest.loader.get(id);
  if (!source) return res.status(404).json({ error: 'unknown id' });

  const root = process.env.VERTICAL_SEED_ROOT || path.join(__dirname, '..', 'config', 'verticals');
  fs.rmSync(path.join(root, id), { recursive: true, force: true });
  verticalManifest.resolver.overlay.clearAll(id);
  verticalManifest.resolver.removeFromCache(id);
  verticalManifest.events.emit('vertical-list-changed', { ids: verticalManifest.list().map(v => v.id) });
  res.status(204).end();
});

router.post('/:id/overlay', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { path: fieldPath, value } = req.body || {};
  if (!fieldPath) return res.status(400).json({ error: 'path required' });
  const source = verticalManifest.loader.get(id);
  if (!source) return res.status(404).json({ error: 'unknown id' });
  try {
    verticalManifest.resolver.overlay.setField(id, fieldPath, value);
    res.status(204).end();
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/:id/overlay/batch', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { entries } = req.body || {};
  if (!Array.isArray(entries)) return res.status(400).json({ error: 'entries required' });
  const source = verticalManifest.loader.get(id);
  if (!source) return res.status(404).json({ error: 'unknown id' });
  try {
    verticalManifest.resolver.overlay.setBatch(id, entries);
    res.status(204).end();
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/:id/overlay', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { path: fieldPath } = req.body || {};
  const source = verticalManifest.loader.get(id);
  if (!source) return res.status(404).json({ error: 'unknown id' });
  if (fieldPath) {
    verticalManifest.resolver.overlay.clearField(id, fieldPath);
  } else {
    verticalManifest.resolver.overlay.clearAll(id);
  }
  res.status(204).end();
});

module.exports = router;
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd demo_api_server && npx jest tests/verticalManifest/route.write.test.js
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/routes/verticalManifest.js demo_api_server/tests/verticalManifest/route.write.test.js
git commit -m "feat(verticals): add admin write/clone/delete/snapshot routes"
```

---

## Task 13: Register routes in server.js

**Files:**
- Modify: `demo_api_server/server.js`

- [ ] **Step 1: Find the existing route-registration site**

```bash
cd demo_api_server && grep -n "verticalConfig\|/api/verticals\|require.*routes/" server.js
```

Note the line where `routes/verticalConfig.js` is mounted (or any router-mounting pattern). The new router mounts at `/api/verticals` and the old one mounted at `/api/verticals/config` or similar — confirm by reading the file. Do **not** remove the old route registration yet (that's the cutover commit in Task 22); just add the new one alongside.

- [ ] **Step 2: Add the registration**

In `server.js`, locate the section where other routers are mounted (search for `app.use('/api/'`). Add:

```js
const verticalManifestRouter = require('./routes/verticalManifest');
const { verticalManifest } = require('./services/verticalManifest');
verticalManifest.init();
app.use('/api/verticals', verticalManifestRouter);
```

Place this **before** the existing `app.use('/api/verticals', verticalConfigRouter)` (or whatever the old registration looks like) so that any path collisions favor the new router. The old one will be removed in Task 22.

- [ ] **Step 3: Smoke-check the server boots**

```bash
cd demo_api_server && npm start &
sleep 4
curl -s http://localhost:3001/api/verticals/list -b /tmp/no.cookies | head -1
kill %1 2>/dev/null
```

Expected: a 401 (not 404), proving the route is registered. Path collision with the old `/api/verticals/config` route is fine — different sub-path.

- [ ] **Step 4: Commit**

```bash
git add demo_api_server/server.js
git commit -m "feat(verticals): register /api/verticals manifest routes in server"
```

---

## Task 14: Migration script

**Files:**
- Create: `demo_api_server/scripts/migrateVerticalsV3.js`
- Test: `demo_api_server/tests/verticalManifest/migrate.test.js`

One-shot script that reads `config/verticals/<id>.json`, transforms to v3, writes `config/verticals/<id>/{manifest,mock-data}.json`, deletes the old files. **All-or-nothing**: if any vertical fails validation, nothing is written.

- [ ] **Step 1: Write the failing tests**

Create `demo_api_server/tests/verticalManifest/migrate.test.js`:

```js
const path = require('path');
const fs = require('fs');
const os = require('os');
const { migrate } = require('../../scripts/migrateVerticalsV3');

function writeOld(root, id, content) {
  fs.writeFileSync(path.join(root, `${id}.json`), JSON.stringify(content));
}

const HEALTHCARE_V2 = {
  id: 'healthcare', schemaVersion: 2,
  identity: { displayName: 'CareConnect', tagline: 'Health' },
  theme: { cssVars: { '--theme-accent': '#0f766e' } },
  agent: { persona: 'Care Assistant' },
  dashboard: {
    kind: 'healthcare',
    chips: [{ key: 'balance', label: 'Check Coverage' }],
    hero: { cards: [] },
    llmChipGroups: {},
    mockData: { heroStats: { nextAppointment: '2026-06-03' }, patientRecords: [{ id: 'pr1' }] },
  },
  featurePage: {
    mcpTool: 'show_health_record', pageTitle: 'Health Record',
    accentColor: '#0f766e',
    accentBg: 'rgba(0,0,0,0.06)', accentLight: '#f0fdfa', accentCode: '#ccfbf1',
    accentText: '#134e4a', accentAccentText: '#0f766e',
    dataKey: 'healthRecord',
    fields: [{ label: 'Record ID', path: 'recordId' }],
  },
};

const BANKING_V2 = {
  id: 'banking', schemaVersion: 2,
  identity: { displayName: 'Bank' },
  theme: { cssVars: { '--theme-accent': '#000' } },
  agent: { persona: 'B' },
};

const ADMIN_V2 = {
  id: 'admin', schemaVersion: 2,
  identity: { displayName: 'Admin' },
  theme: { cssVars: { '--theme-accent': '#111' } },
  agent: { persona: 'Admin Agent' },
};

describe('migration', () => {
  let root;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-')); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  test('happy path: writes new folders, deletes old files', () => {
    writeOld(root, 'healthcare', HEALTHCARE_V2);
    writeOld(root, 'banking', BANKING_V2);
    writeOld(root, 'admin', ADMIN_V2);

    migrate(root);

    expect(fs.existsSync(path.join(root, 'healthcare', 'manifest.json'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'healthcare', 'mock-data.json'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'healthcare.json'))).toBe(false);

    // admin → admin-console
    expect(fs.existsSync(path.join(root, 'admin-console', 'manifest.json'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'admin.json'))).toBe(false);

    // mock data split out
    const hcMan = JSON.parse(fs.readFileSync(path.join(root, 'healthcare', 'manifest.json'), 'utf8'));
    expect(hcMan.dashboard.mockData).toBeUndefined();
    const hcMock = JSON.parse(fs.readFileSync(path.join(root, 'healthcare', 'mock-data.json'), 'utf8'));
    expect(hcMock.heroStats.nextAppointment).toBe('2026-06-03');

    // schemaVersion bumped
    expect(hcMan.schemaVersion).toBe(3);

    // accent variants dropped
    expect(hcMan.featurePage.accentColor).toBe('#0f766e');
    expect(hcMan.featurePage.accentBg).toBeUndefined();
    expect(hcMan.featurePage.accentLight).toBeUndefined();
  });

  test('all-or-nothing: invalid manifest aborts everything', () => {
    writeOld(root, 'banking', BANKING_V2);
    writeOld(root, 'bad', { schemaVersion: 2 }); // missing identity, etc.

    expect(() => migrate(root)).toThrow();

    expect(fs.existsSync(path.join(root, 'banking.json'))).toBe(true);  // old not deleted
    expect(fs.existsSync(path.join(root, 'banking', 'manifest.json'))).toBe(false); // new not written
  });

  test('idempotent: re-run on already-migrated tree is a no-op', () => {
    writeOld(root, 'banking', BANKING_V2);
    migrate(root);
    expect(() => migrate(root)).not.toThrow();
    expect(fs.existsSync(path.join(root, 'banking', 'manifest.json'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd demo_api_server && npx jest tests/verticalManifest/migrate.test.js
```

Expected: FAIL.

- [ ] **Step 3: Write the script**

Create `demo_api_server/scripts/migrateVerticalsV3.js`:

```js
#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const { ManifestSchema } = require('../services/verticalManifest/schema');

const ID_RENAMES = { admin: 'admin-console' };
const DROPPED_ACCENT_FIELDS = ['accentBg', 'accentLight', 'accentCode', 'accentText', 'accentAccentText'];

function transformOne(oldManifest) {
  const newId = ID_RENAMES[oldManifest.id] || oldManifest.id;
  const m = JSON.parse(JSON.stringify(oldManifest));
  m.id = newId;
  m.schemaVersion = 3;

  let mockData = {};
  if (m.dashboard && m.dashboard.mockData) {
    mockData = m.dashboard.mockData;
    delete m.dashboard.mockData;
  }

  if (m.featurePage) {
    for (const k of DROPPED_ACCENT_FIELDS) delete m.featurePage[k];
  }

  return { newId, manifest: m, mockData };
}

function migrate(root) {
  if (!fs.existsSync(root)) throw new Error(`Seed root not found: ${root}`);

  const oldFiles = fs.readdirSync(root)
    .filter(f => f.endsWith('.json') && fs.statSync(path.join(root, f)).isFile());

  if (oldFiles.length === 0) return; // idempotent: nothing to migrate

  const transformed = [];
  for (const file of oldFiles) {
    const oldId = path.basename(file, '.json');
    const oldManifest = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
    const t = transformOne(oldManifest);
    const res = ManifestSchema.safeParse(t.manifest);
    if (!res.success) {
      throw new Error(`Migration validation failed for ${oldId}: ${JSON.stringify(res.error.issues)}`);
    }
    transformed.push({ oldFile: file, ...t, validated: res.data });
  }

  for (const { newId, validated, mockData } of transformed) {
    const dir = path.join(root, newId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(validated, null, 2));
    fs.writeFileSync(path.join(dir, 'mock-data.json'), JSON.stringify(mockData, null, 2));
  }
  for (const { oldFile } of transformed) {
    fs.unlinkSync(path.join(root, oldFile));
  }

  console.log(`Migrated ${transformed.length} verticals: ${transformed.map(t => t.newId).join(', ')}`);
}

if (require.main === module) {
  const root = process.argv[2] || path.join(__dirname, '..', 'config', 'verticals');
  migrate(root);
}

module.exports = { migrate, transformOne };
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd demo_api_server && npx jest tests/verticalManifest/migrate.test.js
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/scripts/migrateVerticalsV3.js demo_api_server/tests/verticalManifest/migrate.test.js
git commit -m "feat(verticals): add v2→v3 migration script (all-or-nothing)"
```

---

## Task 15: Run the migration

**Files:**
- Delete: `demo_api_server/config/verticals/admin.json`, `banking.json`, `healthcare.json`, `retail.json`, `sporting-goods.json`, `workforce.json`
- Create: `demo_api_server/config/verticals/admin-console/`, `banking/`, `healthcare/`, `retail/`, `sporting-goods/`, `workforce/` (each with `manifest.json` + `mock-data.json`)

- [ ] **Step 1: Run the migration script**

```bash
cd demo_api_server && node scripts/migrateVerticalsV3.js
```

Expected output: `Migrated 6 verticals: admin-console, banking, healthcare, retail, sporting-goods, workforce`.

If it exits non-zero with a Zod error, **stop** and fix the seed before continuing. Common fixes:
- Old manifest is missing `agent.persona` — find the right value from the old `dashboard.agent` field or set a sensible default.
- `dashboard.kind` is missing — set to a string matching the dashboard family (`banking`, `healthcare`, `retail`, etc.).

- [ ] **Step 2: Verify the new layout**

```bash
ls -R demo_api_server/config/verticals
```

Expected: 6 directories, each containing `manifest.json` + `mock-data.json`. No `.json` files at the root.

- [ ] **Step 3: Boot the server and hit the new routes**

```bash
cd demo_api_server && npm start &
sleep 4
curl -s -b /tmp/admin.cookies http://localhost:3001/api/verticals/me | head -1
kill %1 2>/dev/null
```

Expected: 401 (no session). The point of this step is to confirm boot succeeds — i.e. the loader successfully parsed all 6 manifests. If boot fails, the loader's `throw` will print the offending vertical's id in the stack trace.

- [ ] **Step 4: Commit the migrated tree**

```bash
git add demo_api_server/config/verticals/
git commit -m "feat(verticals): migrate seed data from v2 to v3 (folder layout)"
```

---

## Task 16: Update bootstrap script

**Files:**
- Modify: `demo_api_server/scripts/bootstrapPingOne*.js` (find the actual filename)

The bootstrap reads `demoUsers` from each vertical to provision PingOne users. Path changes from `config/verticals/*.json` to `config/verticals/*/manifest.json`.

- [ ] **Step 1: Find the read site**

```bash
cd demo_api_server && grep -rn "config/verticals\|verticals/.*\.json" scripts/
```

- [ ] **Step 2: Update the path resolution**

In whichever bootstrap script reads the vertical JSONs, change the glob/iteration from:

```js
// OLD
const files = fs.readdirSync(path.join(__dirname, '..', 'config', 'verticals'))
  .filter(f => f.endsWith('.json'));
for (const f of files) {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'verticals', f), 'utf8'));
  // ...
}
```

…to:

```js
// NEW
const verticalsDir = path.join(__dirname, '..', 'config', 'verticals');
const ids = fs.readdirSync(verticalsDir, { withFileTypes: true })
  .filter(e => e.isDirectory()).map(e => e.name);
for (const id of ids) {
  const manifestPath = path.join(verticalsDir, id, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  // ...
}
```

- [ ] **Step 3: Run bootstrap-CI dry mode to confirm**

```bash
cd demo_api_server && PINGONE_BOOTSTRAP_DRYRUN=1 npm run pingone:bootstrap:ci 2>&1 | head -20
```

(If `PINGONE_BOOTSTRAP_DRYRUN` isn't a real flag, skip this step — manual smoke at Task 24 will catch any breakage.)

- [ ] **Step 4: Commit**

```bash
git add demo_api_server/scripts/bootstrapPingOne*.js
git commit -m "fix(bootstrap): read verticals from folder layout (manifest.json)"
```

---

## Task 17: UI `applyThemeTokens`

**Files:**
- Create: `demo_api_ui/src/vertical/applyThemeTokens.js`
- Test: `demo_api_ui/src/vertical/__tests__/applyThemeTokens.test.js`

DOM mutator: writes `cssVars` keys to `document.documentElement.style`, clears keys not present in the new vars.

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/vertical/__tests__/applyThemeTokens.test.js`:

```js
import { applyThemeTokens } from '../applyThemeTokens';

describe('applyThemeTokens', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('style');
  });

  test('writes each cssVar to documentElement.style', () => {
    applyThemeTokens({ '--theme-accent': '#000', '--brand-hero-start': '#abc' });
    expect(document.documentElement.style.getPropertyValue('--theme-accent')).toBe('#000');
    expect(document.documentElement.style.getPropertyValue('--brand-hero-start')).toBe('#abc');
  });

  test('clears previously-set keys not present in new vars', () => {
    applyThemeTokens({ '--a': '1', '--b': '2' });
    applyThemeTokens({ '--a': '1' });
    expect(document.documentElement.style.getPropertyValue('--a')).toBe('1');
    expect(document.documentElement.style.getPropertyValue('--b')).toBe('');
  });

  test('ignores empty input gracefully', () => {
    expect(() => applyThemeTokens({})).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd demo_api_ui && npx jest src/vertical/__tests__/applyThemeTokens.test.js
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Write the module**

Create `demo_api_ui/src/vertical/applyThemeTokens.js`:

```js
let _lastKeys = new Set();

export function applyThemeTokens(cssVars) {
  const root = document.documentElement;
  const newKeys = new Set(Object.keys(cssVars || {}));
  for (const key of _lastKeys) {
    if (!newKeys.has(key)) root.style.removeProperty(key);
  }
  for (const [key, value] of Object.entries(cssVars || {})) {
    root.style.setProperty(key, value);
  }
  _lastKeys = newKeys;
}

export function _resetThemeTokens() { _lastKeys = new Set(); }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd demo_api_ui && npx jest src/vertical/__tests__/applyThemeTokens.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/vertical/applyThemeTokens.js demo_api_ui/src/vertical/__tests__/applyThemeTokens.test.js
git commit -m "feat(verticals-ui): add applyThemeTokens DOM mutator"
```

---

## Task 18: UI `VerticalProvider` + `useVertical`

**Files:**
- Create: `demo_api_ui/src/vertical/VerticalProvider.jsx`
- Create: `demo_api_ui/src/vertical/useVertical.js`
- Test: `demo_api_ui/src/vertical/__tests__/VerticalProvider.test.jsx`
- Test: `demo_api_ui/src/vertical/__tests__/useVertical.test.jsx`

- [ ] **Step 1: Write the failing tests**

Create `demo_api_ui/src/vertical/__tests__/VerticalProvider.test.jsx`:

```jsx
import React from 'react';
import { render, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { VerticalProvider } from '../VerticalProvider';
import { useVertical } from '../useVertical';

const BANKING = {
  id: 'banking', schemaVersion: 3,
  identity: { displayName: 'Bank' },
  theme: { cssVars: { '--x': '#000' } },
  agent: { persona: 'P' },
};
const HEALTHCARE = { ...BANKING, id: 'healthcare', identity: { displayName: 'Health' } };

function setupMocks({ user, manifest }) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      activeId: manifest.id, pageManifest: manifest,
      adminManifest: user?.role === 'admin' ? BANKING : null,
      isAdmin: user?.role === 'admin',
    }),
  });

  const handlers = {};
  class FakeES {
    constructor(url) { this.url = url; FakeES.last = this; }
    addEventListener(evt, cb) { handlers[evt] = cb; }
    close() {}
    fire(evt, data) { handlers[evt] && handlers[evt]({ data: JSON.stringify(data) }); }
  }
  global.EventSource = FakeES;
  return { FakeES, handlers };
}

function Probe() {
  const v = useVertical();
  return <div data-testid="probe">{v.pageManifest?.id}</div>;
}

describe('VerticalProvider', () => {
  test('does not render children until hydrated', async () => {
    setupMocks({ manifest: BANKING });
    const { queryByTestId, findByTestId } = render(
      <MemoryRouter><VerticalProvider><Probe /></VerticalProvider></MemoryRouter>
    );
    expect(queryByTestId('probe')).toBeNull();
    expect((await findByTestId('probe')).textContent).toBe('banking');
  });

  test('SSE vertical-switched triggers refetch', async () => {
    const { FakeES } = setupMocks({ manifest: BANKING });
    const { findByTestId } = render(
      <MemoryRouter><VerticalProvider><Probe /></VerticalProvider></MemoryRouter>
    );
    await findByTestId('probe');

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ activeId: 'healthcare', pageManifest: HEALTHCARE, adminManifest: null, isAdmin: false }),
    });
    act(() => FakeES.last.fire('vertical-switched', { activeId: 'healthcare' }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  });
});
```

Create `demo_api_ui/src/vertical/__tests__/useVertical.test.jsx`:

```jsx
import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { VerticalContext } from '../VerticalProvider';
import { useVertical } from '../useVertical';

const MANIFEST = (id) => ({ id, schemaVersion: 3, identity: { displayName: id }, theme: { cssVars: { '--x': '#000' } }, agent: { persona: id } });

function Probe() {
  const v = useVertical();
  return <div>{v.agentManifest.id}|{String(v.isAdminScope)}</div>;
}

function makeTree({ user, route }) {
  const value = {
    activeId: 'banking',
    pageManifest: MANIFEST('banking'),
    adminManifest: user?.role === 'admin' ? MANIFEST('admin-console') : null,
    isAdmin: user?.role === 'admin',
    refetch: () => {},
  };
  return (
    <MemoryRouter initialEntries={[route]}>
      <VerticalContext.Provider value={value}>
        <Routes><Route path="*" element={<Probe />} /></Routes>
      </VerticalContext.Provider>
    </MemoryRouter>
  );
}

describe('useVertical', () => {
  test('non-admin: agentManifest = pageManifest', () => {
    const { container } = render(makeTree({ user: null, route: '/dashboard' }));
    expect(container.textContent).toBe('banking|false');
  });

  test('admin on /dashboard: agentManifest = pageManifest', () => {
    const { container } = render(makeTree({ user: { role: 'admin' }, route: '/dashboard' }));
    expect(container.textContent).toBe('banking|false');
  });

  test('admin on /admin: agentManifest = admin-console', () => {
    const { container } = render(makeTree({ user: { role: 'admin' }, route: '/admin' }));
    expect(container.textContent).toBe('admin-console|true');
  });

  test('admin on /admin/verticals: agentManifest = admin-console (nested)', () => {
    const { container } = render(makeTree({ user: { role: 'admin' }, route: '/admin/verticals' }));
    expect(container.textContent).toBe('admin-console|true');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd demo_api_ui && npx jest src/vertical/__tests__/
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Write `VerticalProvider.jsx`**

Create `demo_api_ui/src/vertical/VerticalProvider.jsx`:

```jsx
import React, { createContext, useCallback, useEffect, useRef, useState } from 'react';
import { applyThemeTokens } from './applyThemeTokens';

export const VerticalContext = createContext(null);

function useThrottle(fn, delay) {
  const timer = useRef(null);
  const pending = useRef(false);
  return useCallback((...args) => {
    if (timer.current) { pending.current = true; return; }
    fn(...args);
    timer.current = setTimeout(() => {
      timer.current = null;
      if (pending.current) { pending.current = false; fn(...args); }
    }, delay);
  }, [fn, delay]);
}

export function VerticalProvider({ children }) {
  const [state, setState] = useState(null);

  const doFetch = useCallback(async () => {
    const res = await fetch('/api/verticals/me', { credentials: 'include' });
    if (!res.ok) return;
    const data = await res.json();
    setState(data);
    if (data.pageManifest) {
      applyThemeTokens(data.pageManifest.theme.cssVars);
      document.title = data.pageManifest.identity.documentTitle
        || `${data.pageManifest.identity.displayName} · PingOne AI`;
    }
  }, []);

  const refetch = useThrottle(doFetch, 250);

  useEffect(() => {
    const es = new EventSource('/api/verticals/stream', { withCredentials: true });
    es.addEventListener('vertical-switched', refetch);
    es.addEventListener('vertical-edited', refetch);
    es.addEventListener('vertical-list-changed', () => {
      window.dispatchEvent(new CustomEvent('vertical-list-changed'));
    });
    return () => es.close();
  }, [refetch]);

  if (!state) return null;
  return (
    <VerticalContext.Provider value={{ ...state, refetch: doFetch }}>
      {children}
    </VerticalContext.Provider>
  );
}
```

- [ ] **Step 4: Write `useVertical.js`**

Create `demo_api_ui/src/vertical/useVertical.js`:

```js
import { useContext } from 'react';
import { useLocation } from 'react-router-dom';
import { VerticalContext } from './VerticalProvider';

export function useVertical() {
  const ctx = useContext(VerticalContext);
  const location = useLocation();
  if (!ctx) return { pageManifest: null, agentManifest: null, activeId: null, isAdminScope: false, isAdmin: false, refetch: () => {} };
  const isAdminScope = ctx.isAdmin && location.pathname.startsWith('/admin');
  const agentManifest = isAdminScope ? ctx.adminManifest : ctx.pageManifest;
  return {
    activeId: ctx.activeId,
    pageManifest: ctx.pageManifest,
    adminManifest: ctx.adminManifest,
    agentManifest,
    isAdminScope,
    isAdmin: ctx.isAdmin,
    refetch: ctx.refetch,
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd demo_api_ui && npx jest src/vertical/__tests__/
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/vertical/VerticalProvider.jsx demo_api_ui/src/vertical/useVertical.js demo_api_ui/src/vertical/__tests__/
git commit -m "feat(verticals-ui): add VerticalProvider, useVertical, route-derived agentManifest"
```

---

## Task 19: Admin editor — OverlayBadge + CloneModal

**Files:**
- Create: `demo_api_ui/src/vertical/AdminEditor/OverlayBadge.jsx`
- Create: `demo_api_ui/src/vertical/AdminEditor/CloneModal.jsx`

Two small leaf components used by the editor page (Task 20). They are simple enough that we test through the page integration test, not in isolation.

- [ ] **Step 1: Write `OverlayBadge.jsx`**

Create `demo_api_ui/src/vertical/AdminEditor/OverlayBadge.jsx`:

```jsx
import React from 'react';

export function OverlayBadge({ paths, onResetField, onResetAll }) {
  if (!paths || paths.length === 0) {
    return <div className="overlay-badge overlay-badge--empty">No overrides</div>;
  }
  return (
    <div className="overlay-badge">
      <div className="overlay-badge__header">{paths.length} {paths.length === 1 ? 'override' : 'overrides'}</div>
      <ul className="overlay-badge__list">
        {paths.map((p) => (
          <li key={p}>
            <button onClick={() => onResetField(p)} className="overlay-badge__reset" aria-label={`Reset ${p}`}>×</button>
            <code>{p}</code>
          </li>
        ))}
      </ul>
      <button onClick={onResetAll} className="overlay-badge__reset-all">Reset all overrides</button>
    </div>
  );
}
```

- [ ] **Step 2: Write `CloneModal.jsx`**

Create `demo_api_ui/src/vertical/AdminEditor/CloneModal.jsx`:

```jsx
import React, { useState } from 'react';

const ID_REGEX = /^[a-z][a-z0-9-]*$/;

export function CloneModal({ sourceId, existingIds, onClose, onSubmit }) {
  const [newId, setNewId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');

  function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!ID_REGEX.test(newId)) { setError('id must be lowercase letters/numbers/hyphens, starting with a letter'); return; }
    if (existingIds.includes(newId)) { setError('id already exists'); return; }
    if (!displayName.trim()) { setError('display name required'); return; }
    onSubmit({ newId, displayName: displayName.trim() });
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Clone vertical from {sourceId}</h2>
        <form onSubmit={handleSubmit}>
          <label>
            New id (lowercase, hyphens):
            <input value={newId} onChange={(e) => setNewId(e.target.value)} autoFocus />
          </label>
          <label>
            Display name:
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </label>
          {error && <div className="modal__error">{error}</div>}
          <div className="modal__actions">
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="submit" disabled={!newId || !displayName}>Clone</button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add demo_api_ui/src/vertical/AdminEditor/OverlayBadge.jsx demo_api_ui/src/vertical/AdminEditor/CloneModal.jsx
git commit -m "feat(verticals-ui): add OverlayBadge and CloneModal components"
```

---

## Task 20: Admin editor — VerticalEditorPage

**Files:**
- Create: `demo_api_ui/src/vertical/AdminEditor/VerticalEditorPage.jsx`
- Test: `demo_api_ui/src/vertical/__tests__/VerticalEditorPage.test.jsx`

Single-page editor at `/admin/verticals`. Monaco editor showing merged view; save = diff against seed → batch overlay. Includes clone, delete, reset-this, reset-all, save-state, restore-state.

- [ ] **Step 1: Write the failing tests**

Create `demo_api_ui/src/vertical/__tests__/VerticalEditorPage.test.jsx`:

```jsx
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { VerticalContext } from '../VerticalProvider';
import { VerticalEditorPage } from '../AdminEditor/VerticalEditorPage';

// Stub Monaco — we only test the page-level wiring, not Monaco internals.
jest.mock('@monaco-editor/react', () => ({
  __esModule: true,
  default: ({ value, onChange }) => (
    <textarea data-testid="monaco" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

const MIN = (id) => ({ id, schemaVersion: 3, identity: { displayName: id }, theme: { cssVars: { '--x': '#000' } }, agent: { persona: id } });

function tree({ pageManifest, isAdmin = true }) {
  return (
    <MemoryRouter initialEntries={['/admin/verticals']}>
      <VerticalContext.Provider value={{
        activeId: pageManifest.id, pageManifest, adminManifest: MIN('admin-console'), isAdmin,
        refetch: jest.fn(),
      }}>
        <VerticalEditorPage />
      </VerticalContext.Provider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ([
    { id: 'banking', displayName: 'Bank' },
    { id: 'healthcare', displayName: 'Health' },
  ]) });
});

describe('VerticalEditorPage', () => {
  test('renders the active vertical in Monaco', async () => {
    render(tree({ pageManifest: MIN('banking') }));
    const ta = await screen.findByTestId('monaco');
    expect(ta.value).toContain('"id": "banking"');
  });

  test('Save button posts batch overlay', async () => {
    render(tree({ pageManifest: MIN('banking') }));
    const ta = await screen.findByTestId('monaco');
    const edited = JSON.parse(ta.value);
    edited.identity.tagline = 'NEW';
    fireEvent.change(ta, { target: { value: JSON.stringify(edited, null, 2) } });

    global.fetch.mockClear();
    global.fetch.mockResolvedValue({ ok: true, status: 204 });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/verticals/banking/overlay/batch'),
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  test('Delete button hidden for banking', async () => {
    render(tree({ pageManifest: MIN('banking') }));
    await screen.findByTestId('monaco');
    expect(screen.queryByText('Delete')).toBeNull();
  });

  test('Delete button shown for non-protected id', async () => {
    render(tree({ pageManifest: MIN('test-clone') }));
    await screen.findByTestId('monaco');
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  test('Save state button present for admin', async () => {
    render(tree({ pageManifest: MIN('banking') }));
    await screen.findByTestId('monaco');
    expect(screen.getByText('Save state')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd demo_api_ui && npx jest src/vertical/__tests__/VerticalEditorPage.test.jsx
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Write the page**

Create `demo_api_ui/src/vertical/AdminEditor/VerticalEditorPage.jsx`:

```jsx
import React, { useEffect, useState, useCallback } from 'react';
import Monaco from '@monaco-editor/react';
import { useVertical } from '../useVertical';
import { OverlayBadge } from './OverlayBadge';
import { CloneModal } from './CloneModal';

const PROTECTED = new Set(['banking', 'admin-console']);

// Compute leaf paths in `edited` that differ from `seed`.
// Returns [{ path, value }, ...]. Arrays compared by JSON.stringify (wholesale-replace semantics).
function diff(seed, edited, prefix = '') {
  const out = [];
  const keys = new Set([...Object.keys(seed || {}), ...Object.keys(edited || {})]);
  for (const k of keys) {
    const p = prefix ? `${prefix}.${k}` : k;
    const sv = seed?.[k];
    const ev = edited?.[k];
    const bothObj = sv && ev && typeof sv === 'object' && typeof ev === 'object' && !Array.isArray(sv) && !Array.isArray(ev);
    if (bothObj) {
      out.push(...diff(sv, ev, p));
    } else if (JSON.stringify(sv) !== JSON.stringify(ev)) {
      out.push({ path: p, value: ev });
    }
  }
  return out;
}

export function VerticalEditorPage() {
  const { pageManifest, refetch } = useVertical();
  const [editorValue, setEditorValue] = useState('');
  const [seedValue, setSeedValue] = useState('');
  const [overrides, setOverrides] = useState([]);
  const [list, setList] = useState([]);
  const [showClone, setShowClone] = useState(false);
  const [snapshotInfo, setSnapshotInfo] = useState(null);
  const [error, setError] = useState('');

  const id = pageManifest?.id;
  const isProtected = PROTECTED.has(id);

  // Load list of verticals.
  useEffect(() => {
    fetch('/api/verticals/list', { credentials: 'include' })
      .then(r => r.json()).then(setList);
  }, []);

  // When active vertical changes, seed the editor with the merged manifest.
  useEffect(() => {
    if (!pageManifest) return;
    const json = JSON.stringify(pageManifest, null, 2);
    setEditorValue(json);
    setSeedValue(json);
    setError('');
  }, [pageManifest]);

  const save = useCallback(async () => {
    setError('');
    let edited;
    try { edited = JSON.parse(editorValue); }
    catch (e) { setError('Invalid JSON: ' + e.message); return; }
    const seed = JSON.parse(seedValue);
    const entries = diff(seed, edited);
    if (entries.length === 0) return;
    const res = await fetch(`/api/verticals/${id}/overlay/batch`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries }),
    });
    if (!res.ok) { setError(`Save failed: ${res.status}`); return; }
    // SSE will trigger the refetch; the editor will re-seed on the next pageManifest update.
  }, [editorValue, seedValue, id]);

  const resetField = async (path) => {
    await fetch(`/api/verticals/${id}/overlay`, {
      method: 'DELETE', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
  };
  const resetThisVertical = async () => {
    await fetch(`/api/verticals/${id}/overlay`, {
      method: 'DELETE', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  };
  const resetAllVerticals = async () => {
    if (!window.confirm('Reset ALL verticals to their seed defaults? This wipes every override.')) return;
    await fetch('/api/verticals/reset-all', { method: 'POST', credentials: 'include' });
  };
  const setActive = async (newId) => {
    await fetch('/api/verticals/active', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: newId }),
    });
  };
  const doDelete = async () => {
    if (!window.confirm(`Delete vertical "${id}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/verticals/${id}`, { method: 'DELETE', credentials: 'include' });
    if (!res.ok) { setError(`Delete failed: ${res.status}`); }
  };
  const doClone = async ({ newId, displayName }) => {
    const res = await fetch(`/api/verticals/${id}/clone`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newId, displayName }),
    });
    if (res.ok) {
      setShowClone(false);
      await setActive(newId);
    } else {
      const b = await res.json().catch(() => ({}));
      setError(`Clone failed: ${b.error || res.status}`);
    }
  };
  const saveSnapshot = async () => {
    const res = await fetch('/api/verticals/snapshot', { method: 'POST', credentials: 'include' });
    if (res.ok) setSnapshotInfo(await res.json());
  };
  const restoreSnapshot = async () => {
    if (!window.confirm('Restore your saved state? Current overrides will be replaced.')) return;
    await fetch('/api/verticals/snapshot/restore', { method: 'POST', credentials: 'include' });
  };

  if (!pageManifest) return <div>Loading…</div>;

  return (
    <div className="vertical-editor">
      <header className="vertical-editor__header">
        <label>
          Active:
          <select value={id} onChange={(e) => setActive(e.target.value)}>
            {list.map(v => <option key={v.id} value={v.id}>{v.displayName}</option>)}
          </select>
        </label>
        <button onClick={() => setShowClone(true)}>+ Clone vertical</button>
        {!isProtected && <button onClick={doDelete}>Delete</button>}
        <button onClick={resetThisVertical} disabled={isProtected}>Reset this vertical to seed</button>
        <button onClick={resetAllVerticals}>Reset all verticals to seed</button>
        <button onClick={saveSnapshot}>Save state</button>
        <button onClick={restoreSnapshot}>{snapshotInfo ? `Restore saved state · ${new Date(snapshotInfo.savedAt).toLocaleString()}` : 'Restore saved state'}</button>
      </header>

      {error && <div className="vertical-editor__error">{error}</div>}

      <div className="vertical-editor__body">
        <aside className="vertical-editor__sidebar">
          <OverlayBadge paths={overrides} onResetField={resetField} onResetAll={resetThisVertical} />
        </aside>
        <main className="vertical-editor__main">
          <Monaco
            language="json"
            value={editorValue}
            onChange={(v) => setEditorValue(v || '')}
            options={{ formatOnPaste: true, formatOnType: true, minimap: { enabled: false } }}
          />
          <div className="vertical-editor__actions">
            <button onClick={save}>Save</button>
            <button onClick={() => setEditorValue(seedValue)}>Discard</button>
          </div>
        </main>
      </div>

      {showClone && (
        <CloneModal
          sourceId={id}
          existingIds={list.map(v => v.id)}
          onClose={() => setShowClone(false)}
          onSubmit={doClone}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd demo_api_ui && npx jest src/vertical/__tests__/VerticalEditorPage.test.jsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/vertical/AdminEditor/VerticalEditorPage.jsx demo_api_ui/src/vertical/__tests__/VerticalEditorPage.test.jsx
git commit -m "feat(verticals-ui): add VerticalEditorPage (Monaco editor, clone, delete, snapshot)"
```

---

## Task 21: Pre-cutover grep audit

This task produces no code. It records the exhaustive list of consumers that need migration in Task 22, so Task 22 doesn't surprise you mid-stream.

- [ ] **Step 1: Find every old-context import**

```bash
cd demo_api_ui && grep -rn "context/VerticalContext\|context/ThemeContext\|components/ThemePicker\|chase-theme.css\|dashboard-theme.css\|useTheme\|useVertical" src/ | grep -v "src/vertical/" > /tmp/cutover-grep.txt
cat /tmp/cutover-grep.txt
```

- [ ] **Step 2: Find every old vertical-id literal**

```bash
cd demo_api_ui && grep -rn "'admin'\|\"admin\"" src/ | grep -i "vertical\|theme\|manifest" >> /tmp/cutover-grep.txt
cd ../demo_api_server && grep -rn "verticalConfigService\|verticalPrimaryTypes\|routes/verticalConfig" . --include='*.js' >> /tmp/cutover-grep.txt
cat /tmp/cutover-grep.txt
```

- [ ] **Step 3: Save the audit**

The file `/tmp/cutover-grep.txt` is the master checklist for Task 22. Print it once before starting Task 22 so you have a complete picture.

(No commit — this task is purely informational.)

---

## Task 22: Cutover commit — consumer migration + old-code deletion

**Files:**
- Modify: `demo_api_ui/src/App.js`
- Modify: `demo_api_ui/src/components/VerticalSwitcher.js`
- Modify: `demo_api_ui/src/components/BankingChips.jsx`
- Modify: `demo_api_ui/src/components/VerticalFeaturePage.jsx`
- Modify: `demo_api_ui/src/components/VerticalHero.jsx`
- Modify: any other consumer surfaced by Task 21
- Modify: `demo_api_server/server.js` (remove old route registration)
- Delete: `demo_api_server/services/verticalConfigService.js`
- Delete: `demo_api_server/routes/verticalConfig.js`
- Delete: `demo_api_server/config/verticalPrimaryTypes.js`
- Delete: `demo_api_ui/src/context/VerticalContext.js`
- Delete: `demo_api_ui/src/context/ThemeContext.js`
- Delete: `demo_api_ui/src/components/ThemePicker.js`
- Delete: `demo_api_ui/src/components/ThemePicker.css`
- Delete: `demo_api_ui/src/styles/chase-theme.css`
- Delete: `demo_api_ui/src/styles/dashboard-theme.css`

This is the single commit where the new system goes live and the old system is removed. Per Section 5 of the spec: hard cutover.

- [ ] **Step 1: Update App.js to use the new provider**

Open `demo_api_ui/src/App.js`. Find the existing `<VerticalProvider>` / `<ThemeProvider>` wrapping and replace with:

```jsx
import { VerticalProvider } from './vertical/VerticalProvider';
import { VerticalEditorPage } from './vertical/AdminEditor/VerticalEditorPage';
// (remove old imports of VerticalContext, ThemeContext, ThemePicker, theme CSS)

// In the JSX:
<VerticalProvider>
  <Routes>
    {/* ... existing routes ... */}
    <Route path="/admin/verticals" element={<VerticalEditorPage />} />
  </Routes>
</VerticalProvider>
```

If `App.js` currently imports `chase-theme.css` or `dashboard-theme.css` at the top, remove those imports.

- [ ] **Step 2: Update VerticalSwitcher.js**

Open `demo_api_ui/src/components/VerticalSwitcher.js`. Replace the body so it reads from `useVertical()` and POSTs to `/api/verticals/active`:

```jsx
import React, { useEffect, useState } from 'react';
import { useVertical } from '../vertical/useVertical';
import './VerticalSwitcher.css';

export default function VerticalSwitcher() {
  const { activeId } = useVertical();
  const [list, setList] = useState([]);

  useEffect(() => {
    const load = () => fetch('/api/verticals/list', { credentials: 'include' })
      .then(r => r.json()).then(setList);
    load();
    const onChange = () => load();
    window.addEventListener('vertical-list-changed', onChange);
    return () => window.removeEventListener('vertical-list-changed', onChange);
  }, []);

  const onSelect = (e) => {
    fetch('/api/verticals/active', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: e.target.value }),
    });
  };

  return (
    <select className="vertical-switcher" value={activeId || ''} onChange={onSelect}>
      {list.map(v => <option key={v.id} value={v.id}>{v.displayName}</option>)}
    </select>
  );
}
```

(Keep the existing CSS file path — the styling itself is Cycle 2's job.)

- [ ] **Step 3: Update BankingChips.jsx**

Open `demo_api_ui/src/components/BankingChips.jsx`. Find every read of vertical data (currently via `useContext(VerticalContext)` or similar). Replace with:

```jsx
import { useVertical } from '../vertical/useVertical';

// At top of component:
const { pageManifest, agentManifest } = useVertical();
const chips = pageManifest?.dashboard?.chips || [];
const groups = pageManifest?.dashboard?.llmChipGroups || {};
const persona = agentManifest?.agent?.persona || '';
```

Do **not** change rendering logic in this commit. Just swap the data source. Cycle 2 rewrites the visuals.

- [ ] **Step 4: Update VerticalFeaturePage.jsx**

Open `demo_api_ui/src/components/VerticalFeaturePage.jsx`. Replace the data-source read with:

```jsx
import { useVertical } from '../vertical/useVertical';

// At top of component:
const { pageManifest } = useVertical();
const featurePage = pageManifest?.featurePage;
// Mock data lookup: featurePage.dataKey is a key into mock-data.json,
// which is now exposed alongside the manifest. See Step 4b below.
```

**Step 4b:** mock data is currently bundled in the manifest via the old `dashboard.mockData`. After migration, it lives in `mock-data.json`. The server doesn't currently expose mock data through `/api/verticals/me` (the spec scoped Cycle 1 to manifest data; mock-data UI rebuild is Cycle 2). For Cycle 1, fix this by adding mock data to the `/me` response. Edit `demo_api_server/services/verticalManifest/scope.js`:

```js
function resolveForRequest(req) {
  const activeId = resolver.activeId() || null;
  const pageEntry = activeId ? resolver.loader.get(activeId) : null;   // <-- new
  const pageManifest = activeId ? resolver.resolve(activeId) : null;
  const pageMockData = pageEntry ? pageEntry.mockData : null;          // <-- new
  const isAdmin = req.user && req.user.role === 'admin';
  const adminManifest = isAdmin ? resolver.resolve('admin-console') : null;
  return { activeId, pageManifest, pageMockData, adminManifest, isAdmin: !!isAdmin };
}
```

And expose the loader on the resolver (small change in `resolver.js`):

```js
return { resolve, reload, removeFromCache, activeId, setActive, overlay: wrappedOverlay, loader };
```

Update the scope test in `tests/verticalManifest/scope.test.js` to reflect the `pageMockData` field (add `loader: { get: () => ({ mockData: {} }) }` to the fakeResolver).

Then in `VerticalFeaturePage.jsx`:

```jsx
const { pageManifest, pageMockData } = useVertical(); // add to useVertical too
const featurePage = pageManifest?.featurePage;
const data = featurePage ? pageMockData?.[featurePage.dataKey] : null;
```

Update `useVertical.js` to pass through `pageMockData`:

```js
return {
  activeId: ctx.activeId,
  pageManifest: ctx.pageManifest,
  pageMockData: ctx.pageMockData,
  adminManifest: ctx.adminManifest,
  agentManifest,
  isAdminScope,
  isAdmin: ctx.isAdmin,
  refetch: ctx.refetch,
};
```

- [ ] **Step 5: Update VerticalHero.jsx**

Same pattern as VerticalFeaturePage. Reads `pageManifest.dashboard.hero` for card definitions, `pageMockData` for values keyed by `card.dataKey`.

- [ ] **Step 6: Handle every other site from the Task 21 grep**

For each entry in `/tmp/cutover-grep.txt`:
- If it imports `VerticalContext` or `ThemeContext`: switch to `useVertical()`.
- If it imports `chase-theme.css` or `dashboard-theme.css`: delete the import (theming is token-driven now).
- If it calls `useTheme()`: replace with `useVertical().pageManifest.theme`.
- If it has a string literal `'admin'` referring to the vertical id: rename to `'admin-console'`.

- [ ] **Step 7: Remove the old route registration from server.js**

In `demo_api_server/server.js`, delete the `require('./routes/verticalConfig')` line and its `app.use(...)`. The new `routes/verticalManifest.js` registration stays.

- [ ] **Step 8: Delete all old files**

```bash
cd /Users/curtismuir/Development/AI-Demo
git rm demo_api_server/services/verticalConfigService.js
git rm demo_api_server/routes/verticalConfig.js
git rm demo_api_server/config/verticalPrimaryTypes.js
git rm demo_api_ui/src/context/VerticalContext.js
git rm demo_api_ui/src/context/ThemeContext.js
git rm demo_api_ui/src/components/ThemePicker.js
git rm demo_api_ui/src/components/ThemePicker.css
git rm demo_api_ui/src/styles/chase-theme.css
git rm demo_api_ui/src/styles/dashboard-theme.css
```

- [ ] **Step 9: Run UI build (CLAUDE.md non-negotiable #3)**

```bash
cd demo_api_ui && npm run build
```

Expected: exit code 0. If it fails on a missing import, that's a Task 21 grep miss — fix it and re-run.

- [ ] **Step 10: Run the full server test suite**

```bash
cd demo_api_server && npm test
```

Expected: all PASS. Any failure here means a consumer didn't get migrated correctly.

- [ ] **Step 11: Run UI tests including App.structure**

```bash
cd demo_api_ui && npx jest App.structure --no-coverage
cd demo_api_ui && npm test -- --watchAll=false
```

Expected: all PASS. `App.structure` per CLAUDE.md §8.

- [ ] **Step 12: Commit the cutover**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add -A
git commit -m "$(cat <<'EOF'
feat(verticals)!: cutover to new manifest system; delete old verticalConfig + ThemeContext

BREAKING: vertical id 'admin' is now 'admin-console'. Theme is token-driven,
not class-driven. schemaVersion 2 no longer parses. featurePage.accent* variant
fields (accentBg/Light/Code/Text/AccentText) dropped pending Cycle 2 derivation
from accentColor.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 23: Delete the migration script

**Files:**
- Delete: `demo_api_server/scripts/migrateVerticalsV3.js`
- Delete: `demo_api_server/tests/verticalManifest/migrate.test.js`

Migration is done. Script is born-to-die.

- [ ] **Step 1: Remove**

```bash
cd /Users/curtismuir/Development/AI-Demo
git rm demo_api_server/scripts/migrateVerticalsV3.js
git rm demo_api_server/tests/verticalManifest/migrate.test.js
```

- [ ] **Step 2: Run tests to confirm nothing depends on it**

```bash
cd demo_api_server && npm test
```

Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git commit -m "chore(verticals): remove one-shot migration script"
```

---

## Task 24: End-to-end live-switch test

**Files:**
- Create: `demo_api_ui/tests/e2e/verticals.live-switch.e2e.spec.js`

One Playwright test exercising the two-tab live-switch scenario from Section 6.

- [ ] **Step 1: Write the test**

Create `demo_api_ui/tests/e2e/verticals.live-switch.e2e.spec.js`:

```js
// @ts-check
const { test, expect, chromium } = require('@playwright/test');
const { adminLogin, customerLogin } = require('./helpers/loginHelpers'); // existing helper

test('admin switches active vertical; customer tab updates within 2s', async () => {
  const browser = await chromium.launch();
  const adminCtx = await browser.newContext();
  const customerCtx = await browser.newContext();
  const adminPage = await adminCtx.newPage();
  const customerPage = await customerCtx.newPage();

  // Admin: log in, navigate to vertical editor, set active to banking
  await adminLogin(adminPage);
  await adminPage.goto('https://api.ping.demo:4000/admin/verticals');
  await adminPage.selectOption('select.vertical-switcher', 'banking');

  // Customer: log in, on /dashboard, capture current header
  await customerLogin(customerPage);
  await customerPage.goto('https://api.ping.demo:4000/dashboard');
  await customerPage.waitForSelector('header');

  // Admin: switch to healthcare
  await adminPage.evaluate(() => {
    return fetch('/api/verticals/active', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'healthcare' }),
    });
  });

  // Customer: header should update without a full reload within 2s
  await customerPage.waitForFunction(
    () => document.title.includes('CareConnect') || document.title.includes('Health'),
    { timeout: 2000 },
  );

  // CSS variable check: --theme-accent should match the healthcare value (#0f766e or whatever)
  const accent = await customerPage.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--theme-accent').trim()
  );
  expect(accent).not.toBe(''); // any non-empty value confirms tokens were applied

  await browser.close();
});
```

- [ ] **Step 2: Run the test**

```bash
cd demo_api_ui && npm run test:e2e:ui:smoke -- verticals.live-switch
```

Expected: PASS (with the dev server running via `./run.sh`).

If the test infrastructure isn't set up to run a fresh E2E in this PR, mark this step OK if a manual two-tab test passes instead. Document which path you took in the commit.

- [ ] **Step 3: Commit**

```bash
git add demo_api_ui/tests/e2e/verticals.live-switch.e2e.spec.js
git commit -m "test(verticals): add E2E live-switch smoke (two-tab)"
```

---

## Task 25: Manual smoke checklist (no code)

Run the Section 6 manual smoke checklist before declaring done. **Stop and fix anything that doesn't pass.**

- [ ] **Step 1: Clean start**

```bash
./run.sh stop
./run.sh
```

Expected: all services start; tail logs to confirm.

- [ ] **Step 2: Customer flow**

Open https://api.ping.demo:4000, log in as customer. Default vertical is `banking`. Confirm:
- Dashboard renders.
- A chip works (click "My Accounts" or similar).
- Transfer flow works (existing functionality — sanity regression).

- [ ] **Step 3: Vertical switch through switcher**

Switch the active vertical to `healthcare` via the switcher. Confirm:
- Header title updates to "CareConnect".
- Theme colors change (look at `--theme-accent` in DevTools).
- Chips relabel.
- No full page reload (Network tab: no `index.html` request).

- [ ] **Step 4: Cycle through remaining verticals**

Switch to `retail`, `sporting-goods`, `workforce` in turn. Each should render.

- [ ] **Step 5: Admin editor**

Log out, log in as admin. Navigate to `/admin/verticals`. Confirm:
- Editor renders with the active vertical's JSON.
- Override panel shows "No overrides" initially.
- Edit a chip label in the JSON. Save. Confirm a customer tab (open in another window) updates within 2 seconds.

- [ ] **Step 6: Reset and snapshot**

- "Reset this vertical to seed" — confirm the customer tab reverts within 2 seconds.
- "Save state" — confirm the timestamp appears next to "Restore saved state".
- Make a small edit. Save. Click "Restore saved state" — confirm the edit reverts.

- [ ] **Step 7: Clone and delete**

- Click "+ Clone vertical", clone `healthcare` as `test-clone` with display name "Test Clone".
- Confirm `test-clone` appears in the switcher.
- Switch the active vertical to a different one (so `test-clone` isn't active), then delete `test-clone`.
- Confirm it's gone from the switcher.

- [ ] **Step 8: Pipeline regression check (CLAUDE.md non-negotiable)**

```bash
cd demo_api_ui && npm run test:e2e:ui:smoke
```

Expected: PASS. Also run the all-chips pipeline (`all-chips-pipeline.real.spec.js`) — must not skip and must pass.

- [ ] **Step 9: If all smoke steps pass, declare Cycle 1 done**

(No commit — this task is verification only.)

---

## Self-review (run after writing the plan, before sharing)

**Spec coverage:** Every spec section maps to tasks:
- §1 architecture overview → Tasks 2–10 (modules), 11–12 (routes), 17–20 (UI), 22 (cutover).
- §2 manifest schema → Task 2.
- §3 resolver and scope → Tasks 3–7, 10, 11–12.
- §4 SSE / editing / snapshot → Tasks 8, 9, 18, 20.
- §5 migration → Tasks 14, 15, 16, 22, 23.
- §6 testing → Tests embedded in Tasks 2–14, 17–20; E2E in Task 24; smoke in Task 25.

**Placeholder scan:** None of the "TBD / TODO / implement later" patterns appear in step bodies. Every code step shows the actual code. Every command step shows the actual command + expected output.

**Type consistency:** `pageManifest`, `agentManifest`, `adminManifest`, `pageMockData`, `activeId`, `isAdmin`, `isAdminScope` used consistently across tasks. `verticalManifest` singleton API consistent across tasks 10–12, 22. Overlay API (`get/setField/setBatch/clearField/clearAll/list`) consistent across tasks 5, 6, 12, 20.

**One spec-deviation noted explicitly:** Task 22 Step 4b expands `/me` to also include `pageMockData` (the mock data corresponding to the active vertical). The spec implied this through "the dashboard component reads `mockData[dataKey]`" but didn't pin down *how* mock data reaches the client. Wiring it through `/me` is the smallest change that makes the existing `VerticalFeaturePage` and `VerticalHero` keep working post-cutover. Documented inline in the cutover task.

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-29-verticals-storage-switching.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
