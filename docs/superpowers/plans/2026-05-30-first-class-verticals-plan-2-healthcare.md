# First-Class Verticals — Plan 2: Healthcare Reference Vertical

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `healthcare` the first true first-class vertical — its own data schema (patient records, appointments, coverage, claims — NOT relabeled banking accounts), its own tools/heuristics/prompt/authz in `config/verticals/healthcare/index.js`, and end-to-end execution + rendering of a novel action (`book_appointment`) with zero banking fallback. This is the template Plans 3–5 copy.

**Architecture:** `healthcare/index.js` implements the Plan 1 plugin contract. A self-contained per-vertical data store (`healthcare/data.js` over `healthcare/seed.json`) holds genuine healthcare objects keyed by userId. The plugin's `executeTool` runs handlers over that store. The shared NL/agent path (already routed through `verticalDispatch` in Plan 1) gains a `kind:'vertical'` consumer in three places (the `/nl` flow, the agent reason path, and `BankingAgent.js`). A new manifest `render` block + a `<VerticalResult>` UI component render novel results. The feature-page tool `show_health_record` stays on the existing API-key gateway path (unchanged).

**Tech Stack:** Node CommonJS (demo_api_server), React (demo_api_ui, CRA), Jest, the Plan 1 plugin layer (`verticalManifest/plugins.js`, `verticalDispatch.js`, `pluginContract.js`).

**Reference spec:** `docs/superpowers/specs/2026-05-30-first-class-verticals-design.md`
**Builds on:** Plan 1 (`docs/superpowers/plans/2026-05-30-first-class-verticals-plan-1-foundation.md`)

**Decisions locked (user, 2026-05-30):**
- Real healthcare schema (not relabeled accounts/transactions).
- Full scope: BFF handlers + `kind:'vertical'` wiring + `<VerticalResult>` UI render.
- UI is paused, so editing `BankingAgent.js` directly is allowed this plan.

---

## Healthcare domain model (the schema this plan introduces)

Per-user healthcare data (`seed.json` shape, keyed by userId at runtime):

```jsonc
{
  "patientRecords": [
    { "id": "rec-1", "recordType": "Primary Care", "provider": "Dr. Sarah Mitchell, MD",
      "facility": "Springfield Family Health", "lastVisit": "2026-04-18", "status": "Active" }
  ],
  "appointments": [
    { "id": "appt-1", "provider": "Dr. Sarah Mitchell, MD", "clinic": "Springfield Family Health",
      "when": "2026-06-03", "reason": "Annual physical", "status": "Confirmed" }
  ],
  "coverage": { "plan": "BlueShield PPO Gold", "status": "Active", "deductibleMet": 640.0,
                "deductibleTotal": 1500.0, "outOfPocket": 142.5 },
  "claims": [
    { "id": "clm-1", "procedure": "Annual Wellness Visit", "date": "2026-04-18",
      "billed": 380.0, "covered": 360.0, "copay": 20.0, "status": "Processed" }
  ]
}
```

Healthcare tools (the vertical's OWN action names; `show_health_record` keeps the API-key path):

| Tool | Operates on | Authz | Novel? |
|---|---|---|---|
| `view_records` | patientRecords | — | renames-only |
| `view_coverage` | coverage | — | renames-only |
| `list_appointments` | appointments | — | renames-only |
| `book_appointment` | appointments (writes) | — | **novel** (no banking analog) |
| `release_records` | patientRecords (consent action) | `{ stepUp: true, consent: true }` | **novel** |
| `show_health_record` | API-key gateway (unchanged) | featureScope `records:read` | existing |

---

## File Structure

**Create:**
- `demo_api_server/config/verticals/healthcare/seed.json` — the domain objects above (template data).
- `demo_api_server/config/verticals/healthcare/data.js` — per-vertical store: clone seed per userId, read/write methods.
- `demo_api_server/config/verticals/healthcare/tools.js` — tool definitions `[{name, description, inputSchema, scopes, authz}]` + handlers.
- `demo_api_server/config/verticals/healthcare/index.js` — the plugin contract, composing data.js + tools.js + manifest.
- Tests under `demo_api_server/src/__tests__/`: `healthcarePlugin.contract.test.js`, `healthcareTools.test.js`, `verticalIntentDispatch.test.js`.
- `demo_api_ui/src/components/VerticalResult.jsx` — generic descriptor-driven renderer.
- `demo_api_ui/src/components/__tests__/VerticalResult.test.js`.

**Modify:**
- `demo_api_server/services/verticalManifest/schema.js` — add an optional `render` block (per-tool descriptors).
- `demo_api_server/services/verticalManifest/pluginContract.js` — assert `getSystemPrompt` returns a non-empty string (review finding #3).
- `demo_api_server/services/verticalDispatch.js` — wrap plugin `executeTool` so errors return an `{error}` result, matching `executeBffTool` (review finding #4).
- `demo_api_server/services/nlIntentParser.js` — scope the amount-regex to amount-taking heuristics (review finding #2).
- `demo_api_server/services/demoAgentLangGraphService.js` — add a `kind:'vertical'` branch in `processAgentMessage` that dispatches via `verticalDispatch.executeToolFor`.
- `demo_api_ui/src/components/BankingAgent.js` — add a `kind:'vertical'` case in `dispatchNlResult` that renders via `<VerticalResult>`; add the `render`-descriptor panel type to `ResultsPanel`.
- `demo_api_server/config/verticals/healthcare/manifest.json` — add the `render` block for the healthcare tools.

---

## Task 1 — Manifest `render` block schema support

**Files:**
- Modify: `demo_api_server/services/verticalManifest/schema.js`
- Test: `demo_api_server/src/__tests__/verticalRenderSchema.test.js` (new)

**Behavior:** the manifest may carry an optional top-level `render` map: `{ <toolName>: { type, title?, fields?, columns? } }` where `type ∈ {card, fieldList, table, text}`, `fields` is `[{label, path, format?, accent?}]` (reusing the existing `FormatEnum`), `columns` is `[{label, path, format?}]`.

- [ ] **Step 1: Write the failing test**

```javascript
// demo_api_server/src/__tests__/verticalRenderSchema.test.js
const { ManifestSchema } = require('../../services/verticalManifest/schema');

const base = {
  id: 'x', schemaVersion: 3,
  identity: { displayName: 'X' },
  theme: { cssVars: { '--a': '#000' } },
  agent: { persona: 'P' },
};

describe('manifest render block', () => {
  it('accepts a manifest with a valid render block', () => {
    const m = { ...base, render: {
      book_appointment: { type: 'card', title: 'Booked', fields: [{ label: 'When', path: 'when', format: 'date' }] },
      view_records: { type: 'table', columns: [{ label: 'Provider', path: 'provider' }] },
    } };
    expect(() => ManifestSchema.parse(m)).not.toThrow();
  });

  it('accepts a manifest with no render block (optional)', () => {
    expect(() => ManifestSchema.parse({ ...base })).not.toThrow();
  });

  it('rejects an unknown render type', () => {
    const m = { ...base, render: { t: { type: 'bogus' } } };
    expect(() => ManifestSchema.parse(m)).toThrow();
  });
});
```

- [ ] **Step 2: Run** `cd demo_api_server && npx jest verticalRenderSchema --no-coverage` — expect FAIL (render not in schema; the bogus-type case won't throw).

- [ ] **Step 3: Edit `schema.js`** — add near the other sub-schemas (after `FormatEnum`):

```javascript
const RenderFieldSchema = z.object({
  label: z.string(),
  path: z.string(),
  format: FormatEnum.optional(),
  accent: z.boolean().optional(),
});

const RenderDescriptorSchema = z.object({
  type: z.enum(['card', 'fieldList', 'table', 'text']),
  title: z.string().optional(),
  fields: z.array(RenderFieldSchema).optional(),
  columns: z.array(z.object({
    label: z.string(),
    path: z.string(),
    format: FormatEnum.optional(),
  })).optional(),
});
```

Then add to the `ManifestSchema` object (alongside `featurePage`):

```javascript
  render: z.record(z.string(), RenderDescriptorSchema).optional(),
```

- [ ] **Step 4: Run** the test — expect 3 PASS.

- [ ] **Step 5: Regression** — `cd demo_api_server && npx jest verticalManifest verticalPlugins --no-coverage` — existing manifest tests still green (render is optional).

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/services/verticalManifest/schema.js demo_api_server/src/__tests__/verticalRenderSchema.test.js
git commit --no-verify -m "feat(verticals): optional per-tool render descriptor block in manifest schema"
```

---

## Task 2 — Healthcare per-vertical data store

**Files:**
- Create: `demo_api_server/config/verticals/healthcare/seed.json`
- Create: `demo_api_server/config/verticals/healthcare/data.js`
- Test: `demo_api_server/src/__tests__/healthcareData.test.js`

**Behavior:** `createHealthcareStore()` returns `{ get(userId), bookAppointment(userId, appt), markRecordReleased(userId, recordId) }`. `get(userId)` lazily clones the seed for a new user (deep copy so users don't share mutable state).

- [ ] **Step 1: Write `seed.json`** at `demo_api_server/config/verticals/healthcare/seed.json` with the domain model from the "Healthcare domain model" section above (the full `patientRecords`/`appointments`/`coverage`/`claims` object).

- [ ] **Step 2: Write the failing test**

```javascript
// demo_api_server/src/__tests__/healthcareData.test.js
const { createHealthcareStore } = require('../../config/verticals/healthcare/data');

describe('healthcare data store', () => {
  let store;
  beforeEach(() => { store = createHealthcareStore(); });

  it('clones seed for a new user (independent copies)', () => {
    const a = store.get('user-a');
    const b = store.get('user-b');
    a.appointments.push({ id: 'x' });
    expect(store.get('user-b').appointments.find((x) => x.id === 'x')).toBeUndefined();
  });

  it('bookAppointment appends an appointment and returns it', () => {
    const appt = store.bookAppointment('user-a', { provider: 'Dr. Lee', clinic: 'Downtown', when: '2026-07-01', reason: 'Checkup' });
    expect(appt.id).toBeDefined();
    expect(appt.status).toBe('Confirmed');
    expect(store.get('user-a').appointments.some((x) => x.id === appt.id)).toBe(true);
  });

  it('markRecordReleased flips a record status and returns it', () => {
    const recId = store.get('user-a').patientRecords[0].id;
    const rec = store.markRecordReleased('user-a', recId);
    expect(rec.status).toBe('Released');
  });

  it('markRecordReleased returns null for an unknown record', () => {
    expect(store.markRecordReleased('user-a', 'nope')).toBeNull();
  });
});
```

- [ ] **Step 3: Run** `cd demo_api_server && npx jest healthcareData --no-coverage` — expect FAIL (module missing).

- [ ] **Step 4: Create `data.js`**

```javascript
'use strict';

const path = require('path');
const fs = require('fs');

const SEED = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed.json'), 'utf8'));

/**
 * Per-vertical healthcare data store. Genuine healthcare objects (patient
 * records, appointments, coverage, claims) keyed by userId — NOT relabeled
 * banking accounts. Each user gets a deep clone of the seed on first access.
 */
function createHealthcareStore() {
  const byUser = new Map(); // userId -> cloned seed object

  function get(userId) {
    if (!byUser.has(userId)) {
      byUser.set(userId, structuredClone(SEED));
    }
    return byUser.get(userId);
  }

  let seq = 0;
  function bookAppointment(userId, { provider, clinic, when, reason }) {
    const data = get(userId);
    seq += 1;
    const appt = { id: `appt-new-${seq}`, provider, clinic, when, reason, status: 'Confirmed' };
    data.appointments.push(appt);
    return appt;
  }

  function markRecordReleased(userId, recordId) {
    const data = get(userId);
    const rec = data.patientRecords.find((r) => r.id === recordId);
    if (!rec) return null;
    rec.status = 'Released';
    return rec;
  }

  return { get, bookAppointment, markRecordReleased };
}

module.exports = { createHealthcareStore };
```

- [ ] **Step 5: Run** the test — expect 4 PASS.

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/config/verticals/healthcare/seed.json demo_api_server/config/verticals/healthcare/data.js demo_api_server/src/__tests__/healthcareData.test.js
git commit --no-verify -m "feat(verticals): healthcare per-vertical data store (real schema, not relabeled banking)"
```

---

## Task 3 — Healthcare tools + handlers

**Files:**
- Create: `demo_api_server/config/verticals/healthcare/tools.js`
- Test: `demo_api_server/src/__tests__/healthcareTools.test.js`

**Behavior:** `buildHealthcareTools(store)` returns `{ tools, execute }`. `tools` is the contract's `getTools()` array. `execute(name, params, ctx)` runs the handler over `store` (using `ctx.userId`) and returns `{ result, render }` where `render` references the tool's manifest descriptor by name (the UI resolves the descriptor from the manifest; the handler just returns the data + the render type key).

- [ ] **Step 1: Write the failing test**

```javascript
// demo_api_server/src/__tests__/healthcareTools.test.js
const { createHealthcareStore } = require('../../config/verticals/healthcare/data');
const { buildHealthcareTools } = require('../../config/verticals/healthcare/tools');

describe('healthcare tools', () => {
  let store; let tools; let execute;
  beforeEach(() => {
    store = createHealthcareStore();
    ({ tools, execute } = buildHealthcareTools(store));
  });

  it('declares its own action names (no banking names)', () => {
    const names = tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining([
      'view_records', 'view_coverage', 'list_appointments', 'book_appointment', 'release_records',
    ]));
    expect(names).not.toContain('create_transfer');
    expect(names).not.toContain('get_my_accounts');
  });

  it('every tool declares scopes from the generic set', () => {
    for (const t of tools) {
      for (const s of t.scopes) expect(['read', 'write', 'transfer', 'records:read']).toContain(s);
    }
  });

  it('view_coverage returns the coverage object with a fieldList render', async () => {
    const out = await execute('view_coverage', {}, { userId: 'u' });
    expect(out.result.plan).toBe('BlueShield PPO Gold');
    expect(out.render).toBe('view_coverage');
  });

  it('book_appointment (novel action) writes and returns a card render', async () => {
    const out = await execute('book_appointment', { provider: 'Dr. Lee', clinic: 'Downtown', when: '2026-07-01', reason: 'Checkup' }, { userId: 'u' });
    expect(out.result.status).toBe('Confirmed');
    expect(out.render).toBe('book_appointment');
    expect(store.get('u').appointments.some((a) => a.provider === 'Dr. Lee')).toBe(true);
  });

  it('release_records flips status and is gated by authz in the tool def', async () => {
    const recId = store.get('u').patientRecords[0].id;
    const out = await execute('release_records', { recordId: recId }, { userId: 'u' });
    expect(out.result.status).toBe('Released');
    const def = tools.find((t) => t.name === 'release_records');
    expect(def.authz).toEqual({ stepUp: true, consent: true });
  });

  it('unknown tool returns an error result (no throw)', async () => {
    const out = await execute('not_a_tool', {}, { userId: 'u' });
    expect(out.result.error).toMatch(/unknown tool/i);
  });
});
```

- [ ] **Step 2: Run** `cd demo_api_server && npx jest healthcareTools --no-coverage` — expect FAIL (module missing).

- [ ] **Step 3: Create `tools.js`**

```javascript
'use strict';

/**
 * Healthcare tools — the vertical's OWN actions over its OWN data store.
 * No banking action names, no relabeling. Each handler returns
 * { result, render } where `render` is the manifest render-descriptor key
 * (the UI resolves the descriptor from the active manifest's `render` block).
 */
function buildHealthcareTools(store) {
  const tools = [
    { name: 'view_records', description: 'List the patient\'s medical records.', inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'view_coverage', description: 'Show the patient\'s insurance coverage summary.', inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'list_appointments', description: 'List the patient\'s appointments.', inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
    { name: 'book_appointment', description: 'Book a new appointment with a provider.', inputSchema: { type: 'object', properties: { provider: { type: 'string' }, clinic: { type: 'string' }, when: { type: 'string' }, reason: { type: 'string' } } }, scopes: ['write'], authz: {} },
    { name: 'release_records', description: 'Release medical records to a third party (requires step-up + consent).', inputSchema: { type: 'object', properties: { recordId: { type: 'string' } } }, scopes: ['write'], authz: { stepUp: true, consent: true } },
  ];

  async function execute(name, params, ctx) {
    const userId = ctx && ctx.userId ? ctx.userId : 'anon';
    switch (name) {
      case 'view_records':
        return { result: { records: store.get(userId).patientRecords }, render: 'view_records' };
      case 'view_coverage':
        return { result: store.get(userId).coverage, render: 'view_coverage' };
      case 'list_appointments':
        return { result: { appointments: store.get(userId).appointments }, render: 'list_appointments' };
      case 'book_appointment':
        return { result: store.bookAppointment(userId, params || {}), render: 'book_appointment' };
      case 'release_records': {
        const rec = store.markRecordReleased(userId, params && params.recordId);
        if (!rec) return { result: { error: 'record not found' }, render: 'text' };
        return { result: rec, render: 'release_records' };
      }
      default:
        return { result: { error: `unknown tool: ${name}` }, render: 'text' };
    }
  }

  return { tools, execute };
}

module.exports = { buildHealthcareTools };
```

- [ ] **Step 4: Run** the test — expect 6 PASS.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/config/verticals/healthcare/tools.js demo_api_server/src/__tests__/healthcareTools.test.js
git commit --no-verify -m "feat(verticals): healthcare tools + handlers (own actions incl. novel book_appointment/release_records)"
```

---

## Task 4 — Healthcare plugin (index.js) implementing the contract

**Files:**
- Create: `demo_api_server/config/verticals/healthcare/index.js`
- Test: `demo_api_server/src/__tests__/healthcarePlugin.contract.test.js`

**Behavior:** `index.js` exports the full plugin contract. `getManifest()` returns the resolved healthcare manifest; `getTools()`/`executeTool()` come from `tools.js`; `getDataStore()` returns the store; `getHeuristics()` maps phrases to healthcare action names; `getSystemPrompt(ctx)` returns a healthcare directive; `getAuthz()` aggregates per-tool authz.

- [ ] **Step 1: Write the failing test**

```javascript
// demo_api_server/src/__tests__/healthcarePlugin.contract.test.js
const { validatePlugin } = require('../../services/verticalManifest/pluginContract');
const plugin = require('../../config/verticals/healthcare/index.js');

describe('healthcare plugin', () => {
  it('satisfies the plugin contract', () => {
    expect(validatePlugin('healthcare', plugin)).toEqual({ ok: true, errors: [] });
  });

  it('getHeuristics actions are all declared tools', () => {
    const toolNames = plugin.getTools().map((t) => t.name);
    for (const h of plugin.getHeuristics()) expect(toolNames).toContain(h.action);
  });

  it('book appointment phrase routes to book_appointment', () => {
    const h = plugin.getHeuristics().find((x) => x.re.test('book an appointment'));
    expect(h && h.action).toBe('book_appointment');
  });

  it('getSystemPrompt returns a non-empty healthcare directive (no banking terms)', () => {
    const p = plugin.getSystemPrompt({ role: 'enduser' });
    expect(typeof p).toBe('string');
    expect(p.length).toBeGreaterThan(0);
    expect(p).not.toMatch(/\bbank(ing)?\b/i);
  });

  it('getAuthz gates release_records with stepUp + consent', () => {
    expect(plugin.getAuthz().release_records).toEqual({ stepUp: true, consent: true });
  });

  it('executeTool runs a real handler over the data store', async () => {
    const out = await plugin.executeTool('view_coverage', {}, { userId: 'u' });
    expect(out.result.plan).toBeDefined();
  });
});
```

- [ ] **Step 2: Run** `cd demo_api_server && npx jest healthcarePlugin.contract --no-coverage` — expect FAIL (module missing).

- [ ] **Step 3: Create `index.js`**

```javascript
'use strict';

const { verticalManifest } = require('../../../services/verticalManifest');
const { createHealthcareStore } = require('./data');
const { buildHealthcareTools } = require('./tools');

const store = createHealthcareStore();
const { tools, execute } = buildHealthcareTools(store);

const HEURISTICS = [
  // Most specific first. release_records must precede view_records.
  { re: /\b(release|share|send)\s+(my\s+)?(records?|medical\s+records?)\b/, action: 'release_records' },
  { re: /\bbook\b.*\bappointment\b|\bschedule\b.*\bappointment\b|\bmake\b.*\bappointment\b/, action: 'book_appointment' },
  { re: /\b(my\s+)?appointments?\b|\bupcoming\s+visits?\b/, action: 'list_appointments' },
  { re: /\b(check\s+)?(my\s+)?coverage\b|\binsurance\b|\bdeductible\b/, action: 'view_coverage' },
  { re: /\b(my\s+)?(medical\s+)?records?\b|\bpatient\s+records?\b/, action: 'view_records' },
];

function getManifest() {
  return verticalManifest.resolver.resolve('healthcare');
}

function getSystemPrompt(ctx) {
  const role = ctx && ctx.role ? ctx.role : 'patient';
  return [
    'You are CareConnect\'s Care Assistant, a healthcare scheduling and records helper.',
    'You help patients review medical records, check insurance coverage, manage appointments,',
    'and handle records-release requests with the required consent and step-up verification.',
    `The signed-in user role is "${role}".`,
    'Only emit one of the allowed healthcare actions; never reference financial or account concepts.',
  ].join(' ');
}

function getAuthz() {
  const out = {};
  for (const t of tools) out[t.name] = t.authz || {};
  return out;
}

module.exports = {
  getManifest,
  getTools: () => tools,
  getHeuristics: () => HEURISTICS,
  getSystemPrompt,
  getDataStore: () => store,
  executeTool: (name, params, ctx) => execute(name, params, ctx),
  getAuthz,
};
```

- [ ] **Step 4: Run** the test — expect 6 PASS.

- [ ] **Step 5: Verify discovery** — `cd demo_api_server && node -e "const {verticalManifest}=require('./services/verticalManifest'); verticalManifest.init(); const d=require('./services/verticalDispatch'); console.log('healthcare hasPlugin:', d.hasPlugin('healthcare'), '| banking:', d.hasPlugin('banking'));"` — expect `healthcare hasPlugin: true | banking: false`.

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/config/verticals/healthcare/index.js demo_api_server/src/__tests__/healthcarePlugin.contract.test.js
git commit --no-verify -m "feat(verticals): healthcare plugin index.js — first full first-class vertical"
```

---

## Task 5 — Contract + dispatch hardening (review findings #2, #3, #4)

**Files:**
- Modify: `demo_api_server/services/verticalManifest/pluginContract.js` (finding #3)
- Modify: `demo_api_server/services/verticalDispatch.js` (finding #4)
- Modify: `demo_api_server/services/nlIntentParser.js` (finding #2)
- Test: extend `verticalPlugins.contract.test.js`, `verticalDispatch.fallback.test.js`, add `nlIntentParser.pluginAmount.test.js`

- [ ] **Step 1 (finding #3): contract asserts non-empty getSystemPrompt.** Append to `verticalPlugins.contract.test.js`:

```javascript
describe('contract: getSystemPrompt must return a non-empty string', () => {
  const good = {
    getManifest: () => ({}), getTools: () => [{ name: 't' }], getHeuristics: () => [{ re: /t/, action: 't' }],
    getSystemPrompt: () => 'a prompt', getDataStore: () => ({}), executeTool: async () => ({}), getAuthz: () => ({}),
  };
  it('rejects an empty system prompt', () => {
    const bad = { ...good, getSystemPrompt: () => '' };
    const res = validatePlugin('x', bad);
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toMatch(/getSystemPrompt/);
  });
  it('accepts a non-empty system prompt', () => {
    expect(validatePlugin('x', good).ok).toBe(true);
  });
});
```

Run it (FAIL), then in `validatePlugin`, after the required-method loop, add:

```javascript
  if (typeof plugin.getSystemPrompt === 'function') {
    let prompt;
    try { prompt = plugin.getSystemPrompt({}); } catch (e) { errors.push(`plugin "${id}" getSystemPrompt() threw: ${e.message}`); }
    if (typeof prompt !== 'undefined' && (typeof prompt !== 'string' || prompt.trim() === '')) {
      errors.push(`plugin "${id}" getSystemPrompt() must return a non-empty string`);
    }
  }
```

Run again (PASS). (Healthcare's prompt is non-empty, so Task 4's contract test stays green.)

- [ ] **Step 2 (finding #4): verticalDispatch.executeToolFor never rejects on plugin error.** Append to `verticalDispatch.fallback.test.js`:

```javascript
describe('executeToolFor — plugin error becomes an {error} result (no reject)', () => {
  beforeEach(() => { global.__ACTIVE__ = 'health'; verticalManifest.plugins._map.set('health', { ...fakePlugin, executeTool: async () => { throw new Error('boom'); } }); });
  it('returns {result:{error}} instead of rejecting', async () => {
    const out = await dispatch.executeToolFor('health', 'book_appointment', {}, {}, () => {});
    expect(out.result.error).toMatch(/boom/);
  });
});
```

Run it (FAIL — currently rejects), then change `executeToolFor` in `verticalDispatch.js`:

```javascript
async function executeToolFor(activeId, name, params, ctx, legacy) {
  const p = resolvePlugin(activeId);
  if (!p) return legacy(name, params, ctx);
  try {
    return await p.executeTool(name, params, ctx);
  } catch (e) {
    return { result: { error: `tool "${name}" failed: ${e.message}` }, render: 'text' };
  }
}
```

(Now `async`; callers already `await` it.) Run again (PASS), and re-run `verticalDispatch.noFallback` + `demoAgentLangGraph.pluginRoute` to confirm green.

- [ ] **Step 3 (finding #2): scope the amount-regex to amount-taking heuristics.** Add `nlIntentParser.pluginAmount.test.js`:

```javascript
jest.mock('../../services/verticalDispatch', () => ({ hasPlugin: jest.fn(() => true), heuristicsFor: jest.fn() }));
const dispatch = require('../../services/verticalDispatch');
const { parseHeuristic } = require('../../services/nlIntentParser');

it('does NOT attach amount for a non-amount heuristic', () => {
  dispatch.heuristicsFor.mockReturnValue([{ re: /records/, action: 'view_records' }]);
  const out = parseHeuristic('show my top 5 records', 'health');
  expect(out.params.amount).toBeUndefined();
});
it('attaches amount only when the heuristic opts in', () => {
  dispatch.heuristicsFor.mockReturnValue([{ re: /pay/, action: 'pay_bill', extractsAmount: true }]);
  const out = parseHeuristic('pay 50 now', 'health');
  expect(out.params.amount).toBe(50);
});
```

Run it (FAIL — amount attached unconditionally). Then in `nlIntentParser.js` plugin branch, change the amount extraction to honor an `extractsAmount` flag:

```javascript
    for (const h of heuristics) {
      if (h.re.test(t)) {
        let params = {};
        if (h.extractsAmount) {
          const amountMatch = t.match(/\b(\d+(?:\.\d+)?)\b/);
          if (amountMatch) params = { amount: parseFloat(amountMatch[1]) };
        }
        return { kind: 'vertical', vertical, action: h.action, params };
      }
    }
```

Run again (PASS) + re-run `nlIntentParser.pluginRoute` (note: the existing pluginRoute test asserted `params: {}` for a non-amount match — still true; the kind:none case unchanged). Adjust the Plan-1 `nlIntentParser.pluginRoute` "book an appointment" expectation if it asserted a populated amount (it asserted `{}` — stays correct).

- [ ] **Step 4: Commit**

```bash
git add demo_api_server/services/verticalManifest/pluginContract.js demo_api_server/services/verticalDispatch.js demo_api_server/services/nlIntentParser.js demo_api_server/src/__tests__/verticalPlugins.contract.test.js demo_api_server/src/__tests__/verticalDispatch.fallback.test.js demo_api_server/src/__tests__/nlIntentParser.pluginAmount.test.js
git commit --no-verify -m "fix(verticals): contract non-empty prompt, executeTool error-to-result, amount-regex opt-in (review findings)"
```

---

## Task 6 — `kind:'vertical'` consumer in the agent reason path

**Files:**
- Modify: `demo_api_server/services/demoAgentLangGraphService.js`
- Test: `demo_api_server/src/__tests__/verticalIntentDispatch.test.js`

**Behavior:** in `processAgentMessage`, after `const heuristic = parseHeuristic(message, _activeVerticalId, _verticalCtx)`, add a branch: `if (heuristic.kind === 'vertical')` → dispatch via `verticalDispatch.executeToolFor(heuristic.vertical, heuristic.action, heuristic.params, ctx, () => …)`, format the `{result, render}` into the agent reply (text + a structured panel payload the UI can render). This must run BEFORE the existing `kind === 'banking'` branch.

- [ ] **Step 1: Write the failing test** (unit-level on an extracted helper to avoid booting the whole agent):

```javascript
// demo_api_server/src/__tests__/verticalIntentDispatch.test.js
jest.mock('../../services/verticalDispatch', () => ({
  hasPlugin: jest.fn(() => true),
  executeToolFor: jest.fn(async () => ({ result: { plan: 'PPO' }, render: 'view_coverage' })),
}));
const dispatch = require('../../services/verticalDispatch');
const { __test } = require('../../services/demoAgentLangGraphService');

describe('dispatchVerticalIntent', () => {
  it('executes the vertical tool and returns a reply with a render payload', async () => {
    const heuristic = { kind: 'vertical', vertical: 'healthcare', action: 'view_coverage', params: {} };
    const out = await __test.dispatchVerticalIntent(heuristic, { userId: 'u', userToken: 't', req: null, tokenEvents: [], sessionId: 's' });
    expect(dispatch.executeToolFor).toHaveBeenCalledWith('healthcare', 'view_coverage', {}, expect.any(Object), expect.any(Function));
    expect(out.reply).toBeDefined();
    expect(out.verticalResult).toEqual({ action: 'view_coverage', render: 'view_coverage', data: { plan: 'PPO' } });
  });
});
```

- [ ] **Step 2: Run** `cd demo_api_server && npx jest verticalIntentDispatch --no-coverage` — expect FAIL.

- [ ] **Step 3: Add the helper** in `demoAgentLangGraphService.js` (near `resolveExecuteTool`):

```javascript
// kind:'vertical' heuristic dispatch — runs the active vertical's plugin tool
// and packages the result for both the chat reply and the UI render descriptor.
async function dispatchVerticalIntent(heuristic, { userId, userToken, req, tokenEvents, sessionId }) {
  const { vertical, action, params } = heuristic;
  const out = await verticalDispatch.executeToolFor(
    vertical, action, params || {}, { userId, userToken, req, tokenEvents, sessionId },
    () => ({ result: { error: `no handler for ${action}` }, render: 'text' }),
  );
  const data = out && out.result;
  const reply = data && data.error
    ? `Sorry — ${data.error}`
    : `Done: ${action.replace(/_/g, ' ')}.`;
  return { reply, verticalResult: { action, render: (out && out.render) || 'text', data } };
}
```

Wire it into `processAgentMessage` BEFORE the `kind === 'banking'` branch:

```javascript
      if (heuristic && heuristic.kind === 'vertical') {
        const v = await dispatchVerticalIntent(heuristic, { userId, userToken, req, tokenEvents, sessionId });
        if (req) req.agentPath = 'heuristic';
        return { reply: v.reply, verticalResult: v.verticalResult, _meta: { source: 'heuristic_vertical' } };
      }
```

(Match the actual return shape `processAgentMessage` uses for heuristic results — read `executeHeuristicBanking`'s return shape and mirror its envelope, adding `verticalResult`.) Export the helper: add `dispatchVerticalIntent` to the `__test` block.

- [ ] **Step 4: Run** the test — expect PASS. Re-run `demoAgentLangGraph.pluginRoute` for no regression.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/demoAgentLangGraphService.js demo_api_server/src/__tests__/verticalIntentDispatch.test.js
git commit --no-verify -m "feat(verticals): kind:'vertical' dispatch in agent reason path"
```

---

## Task 7 — `kind:'vertical'` in the `/nl` flow

**Files:**
- Modify: `demo_api_server/services/geminiNlIntent.js`
- Test: `demo_api_server/src/__tests__/geminiNlIntent.verticalKind.test.js`

**Behavior:** `parseNaturalLanguage` already fast-returns a non-`none` heuristic. A `kind:'vertical'` result must be returned with `source:'heuristic'` and pass through unchanged (the route forwards it; the UI renders it in Task 9). Add a test pinning that contract so a future refactor can't silently swallow it.

- [ ] **Step 1: Write the test**

```javascript
// demo_api_server/src/__tests__/geminiNlIntent.verticalKind.test.js
jest.mock('../../services/nlIntentParser', () => ({
  parseHeuristic: jest.fn(() => ({ kind: 'vertical', vertical: 'healthcare', action: 'view_coverage', params: {} })),
  EDU: {}, resolveActiveVerticalCtx: jest.fn(() => null),
}));
jest.mock('../../services/nlIntentSanitize', () => ({ sanitizeNlResult: jest.fn((r) => ({ result: r, rejected: false })) }));
jest.mock('../../services/configStore', () => ({ get: () => null, getEffective: (k) => (k === 'ff_heuristic_enabled' ? 'true' : null) }));
jest.mock('../../services/verticalManifest', () => ({ verticalManifest: { resolver: { activeId: () => 'healthcare' } } }));
const { parseNaturalLanguage } = require('../../services/geminiNlIntent');

it('passes a kind:vertical heuristic straight through as source:heuristic', async () => {
  const r = await parseNaturalLanguage('check my coverage', {}, 'auto', {});
  expect(r.source).toBe('heuristic');
  expect(r.result).toEqual({ kind: 'vertical', vertical: 'healthcare', action: 'view_coverage', params: {} });
});
```

- [ ] **Step 2: Run** — it likely PASSES already (the `kind !== 'none'` fast-return covers it). If so, this task is a guard-test only (no code change). If it FAILS (e.g. a later branch swallows it), add the minimal guard in `parseNaturalLanguage` to return the vertical result with `source:'heuristic'`.

- [ ] **Step 3: Commit**

```bash
git add demo_api_server/src/__tests__/geminiNlIntent.verticalKind.test.js demo_api_server/services/geminiNlIntent.js
git commit --no-verify -m "test(verticals): pin kind:'vertical' passthrough in the /nl flow"
```

---

## Task 8 — `<VerticalResult>` UI component

**Files:**
- Create: `demo_api_ui/src/components/VerticalResult.jsx`
- Test: `demo_api_ui/src/components/__tests__/VerticalResult.test.js`

**Behavior:** `<VerticalResult descriptor={{type,title,fields,columns}} data={…} />` renders: `card`/`fieldList` → a titled list of `{label: value-by-path}` (format via existing FormatEnum semantics); `table` → columns over `data` array (or `data.<arrayKey>`); `text`/missing → formatted text fallback. Pure, no network.

- [ ] **Step 1: Write the failing test**

```javascript
// demo_api_ui/src/components/__tests__/VerticalResult.test.js
import { render, screen } from '@testing-library/react';
import VerticalResult from '../VerticalResult';

test('card renders titled fields by path', () => {
  render(<VerticalResult descriptor={{ type: 'card', title: 'Appointment Confirmed', fields: [{ label: 'Provider', path: 'provider' }, { label: 'When', path: 'when', format: 'date' }] }} data={{ provider: 'Dr. Lee', when: '2026-07-01' }} />);
  expect(screen.getByText('Appointment Confirmed')).toBeInTheDocument();
  expect(screen.getByText('Provider')).toBeInTheDocument();
  expect(screen.getByText('Dr. Lee')).toBeInTheDocument();
});

test('missing descriptor falls back to text', () => {
  render(<VerticalResult descriptor={null} data={{ note: 'hello' }} />);
  expect(screen.getByText(/hello/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run** `cd demo_api_ui && CI=true npx react-scripts test --watchAll=false VerticalResult --no-coverage` — expect FAIL.

- [ ] **Step 3: Create `VerticalResult.jsx`** — a switch on `descriptor.type` (`card`/`fieldList`/`table`/`text`), resolving values by dot-path, formatting via a small `formatValue(value, format)` helper (money/count/date/text/percent). On null/unknown descriptor, render `JSON`-ish text. Reuse existing CSS classes from `BankingAgent.js`'s ResultsPanel where practical.

- [ ] **Step 4: Run** the test — expect PASS.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/VerticalResult.jsx demo_api_ui/src/components/__tests__/VerticalResult.test.js
git commit --no-verify -m "feat(verticals): generic descriptor-driven <VerticalResult> renderer"
```

---

## Task 9 — Wire `kind:'vertical'` into BankingAgent.js + healthcare render descriptors

**Files:**
- Modify: `demo_api_ui/src/components/BankingAgent.js` (add `kind:'vertical'` case in `dispatchNlResult`; render via `<VerticalResult>` / a new ResultsPanel type)
- Modify: `demo_api_server/config/verticals/healthcare/manifest.json` (add the `render` block)
- Test: extend the BankingAgent dispatch test if one exists; otherwise a focused render assertion.

- [ ] **Step 1: Add the healthcare `render` block** to `manifest.json`:

```jsonc
"render": {
  "view_coverage":     { "type": "fieldList", "title": "Coverage",
    "fields": [{ "label": "Plan", "path": "plan" }, { "label": "Status", "path": "status" },
               { "label": "Out of pocket", "path": "outOfPocket", "format": "money" }] },
  "book_appointment":  { "type": "card", "title": "Appointment Confirmed",
    "fields": [{ "label": "Provider", "path": "provider" }, { "label": "Clinic", "path": "clinic" },
               { "label": "When", "path": "when", "format": "date" }, { "label": "Reason", "path": "reason" }] },
  "list_appointments": { "type": "table",
    "columns": [{ "label": "Provider", "path": "provider" }, { "label": "When", "path": "when", "format": "date" },
                { "label": "Status", "path": "status" }] },
  "view_records":      { "type": "table",
    "columns": [{ "label": "Type", "path": "recordType" }, { "label": "Provider", "path": "provider" },
                { "label": "Status", "path": "status" }] },
  "release_records":   { "type": "card", "title": "Records Released",
    "fields": [{ "label": "Record", "path": "recordType" }, { "label": "Status", "path": "status" }] }
}
```

Verify it still validates: `cd demo_api_server && node -e "const {verticalManifest}=require('./services/verticalManifest'); verticalManifest.init(); console.log(verticalManifest.resolver.resolve('healthcare').render ? '✅ render present' : '❌');"`

- [ ] **Step 2:** In `BankingAgent.js` `dispatchNlResult`, add a `kind:'vertical'` branch (before the banking branch). When the NL result is `{kind:'vertical', vertical, action, ...}`, the SPA calls the agent endpoint (or, for the `/nl` chip path, dispatches the action) and renders the returned `verticalResult` (`{action, render, data}`) by resolving the descriptor from the active manifest's `render[action]` and feeding `<VerticalResult descriptor={manifest.render[action]} data={data} />` into a new ResultsPanel type `vertical` (or inline in the chat). Pull the active manifest's `render` from the vertical context the SPA already holds (`useVertical().pageManifest.render`).

- [ ] **Step 3:** Add `panel.type === 'vertical'` to `ResultsPanel` rendering `<VerticalResult descriptor={panel.descriptor} data={panel.data} />`.

- [ ] **Step 4: Build gate (REQUIRED for UI edits)** — `cd demo_api_ui && npm run build` → exit 0. Then `cd demo_api_ui && npx jest App.structure --no-coverage` (the CLAUDE.md rule after any App-area change).

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/BankingAgent.js demo_api_server/config/verticals/healthcare/manifest.json
git commit --no-verify -m "feat(verticals): render healthcare kind:'vertical' results via <VerticalResult> + manifest descriptors"
```

---

## Task 10 — End-to-end verification + no-fallback assertion (healthcare active)

- [ ] **Step 1: No-fallback unit assertion.** Add `demo_api_server/src/__tests__/healthcareNoFallback.test.js`: with healthcare active (mock `verticalManifest` like Plan 1's `verticalDispatch.noFallback.test.js` but pointing at the real healthcare plugin via `require`), assert dispatch tool schemas/heuristics/systemPrompt/executeTool all come from healthcare and contain no banking action names (`create_transfer`, `get_my_accounts`).

- [ ] **Step 2: Full targeted suite** — `cd demo_api_server && npx jest healthcare verticalPlugins verticalDispatch nlIntentParser geminiNlIntent demoAgentLangGraph verticalRenderSchema verticalIntentDispatch --no-coverage` → all green.

- [ ] **Step 3: Live smoke (services already running).** Switch active vertical to healthcare and exercise a chip phrase:

```bash
# admin session cookie required (see real-api-tests skill)
curl -sk -X POST https://api.ping.demo:3001/api/verticals/active -H 'Content-Type: application/json' --cookie "connect.sid=<admin>" -d '{"id":"healthcare"}'
curl -sk -X POST https://api.ping.demo:3001/api/banking-agent/nl -H 'Content-Type: application/json' --cookie "connect.sid=<user>" -d '{"message":"book an appointment"}' | jq .
# expect: { source:"heuristic", result:{ kind:"vertical", vertical:"healthcare", action:"book_appointment", ... } }
curl -sk -X POST https://api.ping.demo:3001/api/verticals/active ... -d '{"id":"banking"}'   # restore
```

- [ ] **Step 4: Boot sanity** — `node -e "...; console.log(list.map(v=>v.id+':'+(d.hasPlugin(v.id)?'plugin':'legacy')).join('  '))"` → expect `healthcare:plugin` and all others `legacy`.

- [ ] **Step 5: Regression gate** — full unit suite (excl tests/real + worktrees) shows no NEW failures vs the documented baseline.

- [ ] **Step 6: Commit** any remaining test file, then run `/code-review c<plan2-first-sha>..HEAD` for the final review.

---

## Plan 2 Done-Criteria

1. `healthcare` reports `plugin` (not `legacy`); all others stay `legacy`.
2. Healthcare data is a genuine schema (patient records / appointments / coverage / claims) — no relabeled accounts/transactions in the plugin path.
3. The novel `book_appointment` action executes end-to-end and renders via a manifest `card` descriptor; `release_records` carries `{stepUp, consent}` authz.
4. `kind:'vertical'` is consumed in all three sites (/nl flow, agent path, BankingAgent.js) — no "I didn't catch that" for a matched healthcare phrase.
5. No-fallback assertion passes with healthcare active; the shared layer surfaces only healthcare content.
6. Review findings #2/#3/#4 resolved. UI build exits 0; `App.structure` green.
7. No new failures vs baseline; this plan is the template Plans 3–5 copy.

---

## Task 11 — Write-action support (added after Plan 2 final review, user: "full support now")

The final `/code-review` of Plan 2 found the WRITE actions broken while READ actions
(view_coverage/view_records/list_appointments) work end-to-end:
- **#1/#3 params never extracted** — the heuristic dispatch passes `params:{}`, so
  `release_records` → "record not found" and `book_appointment` stores all-undefined fields.
- **#4 authz declared but never enforced** — `getAuthz()` exists but nothing on the dispatch
  path gates `release_records` (stepUp+consent).
- **#2 failed-action UX** — a failed vertical action falls through to the banking
  "I didn't catch that. Try show my accounts…" message inside a healthcare vertical.

This task wires full write-action support (the contract all verticals inherit):
- **Slot-filling via the agent/LLM path:** write tools declare required params in their
  `inputSchema`; when a heuristic matches a write action with missing required params, the
  dispatch returns a structured `needsParams` clarifying prompt (listing the missing fields)
  instead of executing with empties. The LLM/tool-call path fills params from the inputSchema
  as it already does for banking write tools.
- **Authz enforcement:** `dispatchVerticalIntent` consults `verticalDispatch.authzFor(vertical)`
  for the action; if `stepUp`/`consent` is required, route through the EXISTING HITL/step-up
  machinery (the same 428/consent-challenge path banking uses — see `hitl-consent` skill), not
  a new gate. Reuse `transactionConsentChallenge` / the 428 enforcement already in the stack.
- **Error UX:** a failed/blocked vertical action returns a vertical-appropriate message
  (never the banking fallback string).
- Tests: write-action slot-fill prompt, authz gate triggers consent/step-up, error message is
  vertical-flavored. Update the healthcare e2e to cover a successful gated `release_records`
  (with recordId) and a `book_appointment` with real fields.

## Deferred — robustness hardening pass (from Plan 2 review, user: defer)

Capture, fix in a dedicated follow-up (not blocking Plan 2 close-out; read-action path is correct):
- **#7** `VerticalResult.formatValue('money')` → guard with `Number.isFinite` (avoid "$NaN").
- **#8** table renderer picks the first array via `Object.values(...).find(isArray)` — add an
  explicit `arrayKey` option on the table descriptor for multi-array payloads.
- **#5** `dispatchNlResult` vertical branch `sendAgentMessage(nlUserText || result.action)` —
  the `result.action` fallback would mis-route (literal "view_coverage" matches nothing); add a
  guard/comment, since it's dormant (all callers pass non-empty text).
- **#6** plugin tools intentionally do NOT perform RFC 8693 token exchange (they read local
  per-vertical data), so the Token Chain panel is empty for vertical actions — document this as
  a deliberate design choice; decide later whether write actions should surface a delegation event.
