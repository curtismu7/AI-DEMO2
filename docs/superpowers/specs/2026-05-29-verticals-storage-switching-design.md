# Verticals Storage and Live Switching — Design

**Date:** 2026-05-29
**Status:** Approved, ready for implementation plan
**Scope:** Cycle 1 of a two-cycle vertical-system rewrite. This cycle rewrites *storage, switching, and admin editing*. Cycle 2 (separate spec) rewrites *per-vertical UI, chip catalog, and mock-data editor*.

---

## Why

The existing verticals system has four overlapping problems that cumulatively make the system painful to live with:

1. **Editing is a chore.** Each vertical is a single ~130-line JSON blob bundling identity, theme, terminology, agent persona, dashboard, chips, mock data, scopes, feature page, and demo users. No validation. No admin UI. Edits require finding the right block and a restart.
2. **Switching is janky.** Dual `ThemeContext` + `VerticalContext` on the client; consumers often read at mount; switching can leave the page in a half-applied state.
3. **Shape is inconsistent.** Verticals drift from each other; `schemaVersion` exists but isn't enforced; redundant accent fields and ad-hoc structure.
4. **Adding a new vertical is heavy.** Requires touching the JSON file plus theme CSS plus, in practice, several other places.

This rewrite is a clean-sheet redesign of how verticals are stored, validated, switched, edited, and propagated to all connected browsers — without touching the chip and dashboard *content rendering* (that is Cycle 2's job).

---

## Decisions log

The 11 questions answered during brainstorming, captured for traceability:

| # | Decision | Key consequence |
|---|---|---|
| Q1 | Solve all four problems above in one rewrite | Clean-sheet, not a patch |
| Q2 | File-on-disk as seed + configStore as runtime overlay | Edits survive restart, no DB |
| Q3 | One folder per vertical, two files: `manifest.json` + `mock-data.json` | Mock data isolated from config |
| Q4 | Field-level overlay (deep-merge) with `vertical.overlay.<id>` keys | Admin UI surfaces per-field overrides + reset |
| Q5 | Server-Sent Events on `/api/verticals/stream` | Instant propagation; works on Vercel |
| Q6 | Global active vertical; two SSE event types (`vertical-switched`, `vertical-edited`) | Same scenario for all viewers; matches demo use case |
| Q7 | Hybrid theming: structural CSS file + manifest `cssVars` overrides on `:root` | Delete the per-theme CSS files |
| Q8 | Monaco JSON editor with Zod-derived schema validation (Cycle 1); investigate hand-built tabs (Cycle 2 TODO) | Fastest to ship; matches developer-admin user |
| Q9 | Two-scope resolver: `pageManifest` + `agentManifest`. `agentManifest = admin-console manifest` when `role === 'admin' && pathname.startsWith('/admin')`, else `pageManifest` | Admin agent persona/chips independent of page vertical |
| Q10 | Single SSE event, every client refetches `/me`; no per-scope channels | YAGNI for demo scale |
| Q11 | Hardcoded manifest schema (code change to add fields) + mock-data is free-form `z.record` + Cycle 2 builds an ergonomic mock-data shape editor | Discourages escape-hatch sprawl |

Reset/snapshot model (sub-decision under Q11): one snapshot slot per admin (`vertical.snapshot.<userId>`), "Save state" / "Restore state" buttons. Plus "Reset this vertical to seed" and "Reset all verticals to seed" buttons.

---

## Implementation approach

**Approach 2 — clean room, hard cutover.** Build the new system in fresh modules. Migrate all 6 verticals in one script. Delete the old system in the same PR. No dual-read, no flag, no parallel code paths. Justified because this is a demo platform, not production banking — the safety net of a flag-gated rollout costs more than it saves, and a strangler-fig approach would carry forward exactly the architectural mistakes this rewrite exists to fix.

---

## Section 1 — Architecture overview

### New module structure

```
demo_api_server/
  config/verticals/
    admin-console/
      manifest.json
      mock-data.json
    banking/
      manifest.json
      mock-data.json
    healthcare/
      manifest.json
      mock-data.json
    retail/
      manifest.json
      mock-data.json
    sporting-goods/
      manifest.json
      mock-data.json
    workforce/
      manifest.json
      mock-data.json

  services/verticalManifest/
    schema.ts         # Zod schema; source of truth for manifest shape
    loader.ts         # boot-time seed cache (in-memory)
    overlay.ts        # configStore read/write for field-level overrides
    resolver.ts       # deep-merges seed + overlay; result-caches per (id, overlayVersion)
    scope.ts          # given (req.user, req.path), returns the page/agent split
    events.ts         # in-process SSE event bus

  routes/verticalManifest.js   # the HTTP surface (table below)

demo_api_ui/src/vertical/
  VerticalProvider.jsx         # opens SSE, owns reactive state
  useVertical.js               # hook: { pageManifest, agentManifest, activeId, isAdminScope }
  applyThemeTokens.js          # writes manifest.theme.cssVars to documentElement
  AdminEditor/
    VerticalEditorPage.jsx     # Monaco-based merged-view editor
    OverlayBadge.jsx           # "n fields overridden" with per-field reset
```

### Deletions in the same PR

- `demo_api_server/services/verticalConfigService.js`
- `demo_api_server/routes/verticalConfig.js`
- `demo_api_server/config/verticals/*.json` (replaced by folders)
- `demo_api_server/config/verticalPrimaryTypes.js` (after grep confirms no other consumers)
- `demo_api_ui/src/context/VerticalContext.js`
- `demo_api_ui/src/context/ThemeContext.js`
- `demo_api_ui/src/components/ThemePicker.js` and `.css`
- `demo_api_ui/src/styles/chase-theme.css`
- `demo_api_ui/src/styles/dashboard-theme.css`

### Untouched (or minimally touched)

`BankingChips.jsx`, `VerticalSwitcher.js`, `VerticalFeaturePage.jsx`, `VerticalHero.jsx` receive only the import-swap from old contexts to `useVertical()`. Their rendering logic is Cycle 2's job. OAuth, MCP, agent runtimes, banking data routes — all unchanged.

### Boundary contract after Cycle 1

- Every UI consumer reads vertical state from exactly one hook: `useVertical()`.
- Every server reader resolves vertical state from exactly one service: `scope.resolveForRequest(req)`.
- No other paths to vertical state exist.

---

## Section 2 — Manifest schema

The Zod schema in `schema.ts` is the source of truth for the manifest shape. The literal version is `3`; the resolver rejects any other value.

```ts
const ChipSchema = z.object({
  id: z.string(),
  label: z.string(),
  message: z.string(),
  group: z.string().optional(),
  scope: z.string().optional(),
});

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
      .refine(v => Object.keys(v).length > 0, 'at least one cssVar required'),
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
        format: z.enum(['money', 'count', 'date', 'text', 'percent']),
      })),
    }),
    llmChipGroups: z.record(z.string(), z.array(ChipSchema)),
  }).optional(),

  scopes: z.object({
    read: z.string().default('read'),
    write: z.string().default('write'),
    transfer: z.string().default('transfer'),
    featureScope: z.string().optional(),
  }).optional(),

  featurePage: z.object({
    mcpTool: z.string(),
    pageTitle: z.string(),
    badgeLabel: z.string().optional(),
    accentColor: z.string().optional(),
    dataKey: z.string(),
    fields: z.array(z.object({
      label: z.string(),
      path: z.string(),
      format: z.enum(['money', 'count', 'date', 'text', 'percent']).optional(),
      accent: z.boolean().optional(),
    })),
    sectionTitle: z.string().optional(),
    emptyPrompt: z.string().optional(),
    scopeError: z.string().optional(),
  }).optional(),

  demoUsers: z.object({
    customer: z.object({ hint: z.string(), passwordHint: z.string() }).optional(),
    admin:    z.object({ hint: z.string(), passwordHint: z.string() }).optional(),
  }).optional(),
});

const MockDataSchema = z.record(z.string(), z.unknown());
```

### Minimum valid manifest

A vertical is valid with only: `id`, `schemaVersion: 3`, `identity.displayName`, `theme.cssVars` (≥1 entry), `agent.persona`. The `admin-console` manifest may legally omit `dashboard`, `featurePage`, `terminology` — its consumers (the agent surface) don't read those fields.

### Key schema decisions

1. **`schemaVersion: 3` is hardcoded literal, not a range.** Forces every reader to assume the new shape; no version-branching in the runtime.
2. **Required fields are deliberately minimal.** Maximizes the surface a clone or hand-written minimal vertical can succeed against.
3. **Mock data is `z.record(z.string(), z.unknown())`.** Each vertical's mock-data shape is different; typing it would either bloat the schema or weaken it. The contract is: `dashboard.hero.cards[].dataKey` and `featurePage.dataKey` are dotted paths into mock data, and rendering tolerates missing paths.
4. **`format` is a closed enum** of `money | count | date | text | percent`. Bounds the dashboard renderer to 5 cases.
5. **Old `accentBg | accentLight | accentCode | accentText | accentAccentText` are dropped.** Derived at render time in Cycle 2 (lighten/darken/alpha of `accentColor`).
6. **`featurePage.dataKey` is a single root path; `fields[].path` walks relative to it.** Eliminates the old schema's "where do these field paths root from" ambiguity.
7. **`ChipSchema` is shared between `dashboard.chips` and `dashboard.llmChipGroups`.** Both have `id + label + message`.
8. **Resolver-supplied defaults are explicit (`.default('read')`)**, not implicit. Defaults are filled at read time; overlays never store default values.

### Schema evolution policy

- **Adding a mock-data field** (e.g., `patientId` on a patient record) needs no code change. Mock data is free-form; the manifest references it via a `dataKey`/`path`. Cycle 2 adds an ergonomic mock-data shape editor.
- **Adding a manifest field** (e.g., a new `compliance` section) requires a Zod schema update, a resolver default if needed, and a UI consumer change. Documented as a code change, intentionally. No `extensions` escape hatch — keeps the contract explicit.

---

## Section 3 — Resolver and scope

The runtime is six small layers, each with a narrow responsibility.

### Layer 1 — `loader.ts` (boot-time seed cache)

```ts
loader.loadAll(): Map<verticalId, { manifest, mockData }>
loader.get(id): { manifest, mockData } | null
loader.list(): Array<{ id, displayName }>
loader.reload(id): void  // re-parses one folder; used after clone
```

- Reads `config/verticals/*/manifest.json` and `config/verticals/*/mock-data.json` once at boot.
- Each manifest validated through `ManifestSchema`; boot fails loudly on validation error.
- In-memory cache; never re-reads disk per request.

### Layer 2 — `overlay.ts` (configStore field overrides)

configStore key shape: `vertical.overlay.<id>` holds a deep-partial of the manifest.

```ts
overlay.get(id): DeepPartial<Manifest>          // {} when absent
overlay.setField(id, path, value): void
overlay.clearField(id, path): void
overlay.clearAll(id): void
overlay.list(id): Array<string>                 // field paths currently overridden
overlay.setBatch(id, entries): void             // { path: value }[] in one transaction
```

- Validates the resulting overlay against `ManifestSchema.deepPartial()`.
- Also re-validates the merged result (seed + new overlay) against `ManifestSchema`. Refuses writes whose merged manifest would be invalid.
- Emits `vertical-edited` via `events.ts` on every successful write.
- `setBatch` fires exactly one `vertical-edited` for the whole batch.

### Layer 3 — `resolver.ts` (the merged manifest)

```ts
resolver.resolve(id): Manifest                  // seed + overlay, validated, cached
resolver.activeId(): string
resolver.setActive(id): void                    // writes configStore key vertical.activeId; emits vertical-switched
```

- Merge semantics: `lodash.mergeWith(seed, overlay, customizer)` where the customizer returns the overlay value verbatim for any array source. Result: objects deep-merge; arrays are **replaced wholesale**, never item-merged. Editing one chip rewrites the whole `dashboard.chips` array in the overlay. (Stock `lodash.merge` would merge arrays index-by-index, which is wrong for this use case.)
- Zod `.default(…)` values applied **after** merge.
- Cache key is `(id, overlayVersion)`. `overlayVersion` is a per-id counter bumped on every overlay write. Cache invalidates on `loader.reload(id)`.
- Active vertical is stored at configStore key `vertical.activeId`. Defaults to `banking` if absent. Survives restart.

### Layer 4 — `scope.ts` (the page/agent split)

```ts
scope.resolveForRequest(req): {
  activeId:      string
  pageManifest:  Manifest
  adminManifest: Manifest | null        // present only if req.user?.role === 'admin'
  isAdmin:       boolean
}
```

Rule (single source of truth):

```ts
const activeId = resolver.activeId();
const pageManifest = resolver.resolve(activeId);
const isAdmin = req.user?.role === 'admin';
const adminManifest = isAdmin ? resolver.resolve('admin-console') : null;
return { activeId, pageManifest, adminManifest, isAdmin };
```

The client derives `agentManifest` and `isAdminScope` from its own pathname at render time:

```ts
const isAdminScope = isAdmin && location.pathname.startsWith('/admin');
const agentManifest = isAdminScope ? adminManifest : pageManifest;
```

This means route changes do **not** trigger a `/me` refetch. The server is unaware of the client's current path.

### Layer 5 — `events.ts` (SSE bus)

```ts
events.onClient(req, res): void          // sets SSE headers, registers writer, removes on close
events.emit(type, payload): void
```

Event types and payloads:

| Event | Payload | Fires on |
|---|---|---|
| `vertical-switched` | `{ activeId }` | `resolver.setActive(id)` |
| `vertical-edited` | `{ id }` | any overlay write (including admin-console) |
| `vertical-list-changed` | `{ ids: string[] }` | clone or delete |

- Heartbeat: SSE comment line every 25 seconds to keep proxies alive.
- No history/replay. Clients refetch `/me` on any event, so missed events self-heal on the next event.
- New connections receive one initial `vertical-switched` with the current `activeId` — lets the client skip a separate `GET /me` on mount.

### Layer 6 — HTTP routes

| Route | Auth | Behavior |
|---|---|---|
| `GET /api/verticals/me` | session | Returns `scope.resolveForRequest(req)` |
| `GET /api/verticals/list` | session | Returns `loader.list()` minus ids in `HIDDEN_IDS = ['admin-console']` |
| `GET /api/verticals/stream` | session | SSE: forwards events to client; sends initial `vertical-switched` |
| `POST /api/verticals/active` | admin | Body `{ id }` → `resolver.setActive(id)` |
| `POST /api/verticals/:id/overlay` | admin | Body `{ path, value }` → `overlay.setField(...)` |
| `POST /api/verticals/:id/overlay/batch` | admin | Body `{ entries: { path, value }[] }` → `overlay.setBatch(...)` |
| `DELETE /api/verticals/:id/overlay` | admin | Body `{ path? }` → `clearField` if path given, else `clearAll` |
| `POST /api/verticals/reset-all` | admin | Iterates `clearAll` over every overlay |
| `POST /api/verticals/:sourceId/clone` | admin | Body `{ newId, displayName }` → writes seed folder, `loader.reload`, emits `vertical-list-changed` |
| `DELETE /api/verticals/:id` | admin | Removes seed folder + overlay; protected ids (`admin-console`, `banking`) → 403; currently-active → 409; emits `vertical-list-changed` |
| `POST /api/verticals/snapshot` | admin | Captures `{ activeId, overlays }` to `vertical.snapshot.<userId>`; returns timestamp |
| `POST /api/verticals/snapshot/restore` | admin | Restores from `vertical.snapshot.<userId>`; emits events for each affected id |
| `DELETE /api/verticals/snapshot` | admin | Clears `vertical.snapshot.<userId>` |

### Key resolver decisions

1. **Resolver is pure given `(id, seed, overlay)`.** No request context leaks in. The page/agent split lives entirely in `scope.ts`. Lets the editor preview "what does this manifest look like merged" be called from anywhere.
2. **Active vertical and overlays both live in configStore.** Same path, same SSE channel, same admin-only mutation surface.
3. **Admin checks use the existing role gate** (`req.user.role === 'admin'`). No new auth concept.
4. **SSE is per-session.** Requires session cookie. Anonymous clients don't get a stream and don't need one.
5. **Initial `vertical-switched` on stream connect is a hydration optimization** — saves one HTTP request per page load.
6. **Array merge is "full replacement," not item-by-item.** Matches Q4's overlay-at-field-granularity decision.
7. **`overlay.list(id)` powers the "n fields overridden" badge.** No separate audit log needed.

---

## Section 4 — SSE, editing flow, admin UI

### End-to-end edit sequence

```
Admin Browser              BFF                                  Other Browsers
─────────────              ─────                                ──────────────
1. Edit JSON in Monaco
2. Click Save
3. POST /api/verticals/healthcare/overlay/batch
     { entries: [{ path, value }, ...] }
                      ───► overlay.setBatch(...)
                           - deepPartial validation
                           - merged-result validation
                           - configStore.set('vertical.overlay.healthcare', ...)
                           - overlayVersion++
                           - events.emit('vertical-edited', { id: 'healthcare' })
                      ◄─── 204 No Content
4. Editor shows "Saved"        │
   (no client-side refetch     │
    — SSE will trigger it       │
    like everyone else)        │
                                ▼
                      SSE: data: {"type":"vertical-edited","id":"healthcare"}
                          ────────────────────────────────────────────────────►
                                                            5. EventSource fires
                                                            6. Provider refetches /me
                                                            7. State updates → re-render
                                                               - terminology swaps
                                                               - applyThemeTokens rewrites :root vars
                                                               - chip labels update
                                                               - document.title updates
```

### `VerticalProvider.jsx`

```jsx
function VerticalProvider({ children }) {
  const [state, setState] = useState(null);

  const refetch = useThrottledCallback(async () => {
    const res = await bffAxios.get('/api/verticals/me');
    setState(res.data);
    applyThemeTokens(res.data.pageManifest.theme.cssVars);
    document.title = res.data.pageManifest.identity.documentTitle
                  ?? `${res.data.pageManifest.identity.displayName} · PingOne AI`;
  }, 250);  // trailing throttle: bursts of SSE events produce one /me call

  useEffect(() => {
    const es = new EventSource('/api/verticals/stream', { withCredentials: true });
    es.addEventListener('vertical-switched', refetch);
    es.addEventListener('vertical-edited', refetch);
    es.addEventListener('vertical-list-changed',
      () => window.dispatchEvent(new CustomEvent('vertical-list-changed')));
    return () => es.close();
  }, [refetch]);

  if (!state) return null;   // first paint waits for initial hydration event
  return <VerticalContext.Provider value={{ ...state, refetch }}>{children}</VerticalContext.Provider>;
}
```

### `useVertical` hook

```ts
function useVertical() {
  const ctx = useContext(VerticalContext);
  const location = useLocation();
  const isAdminScope = ctx.isAdmin && location.pathname.startsWith('/admin');
  const agentManifest = isAdminScope ? ctx.adminManifest : ctx.pageManifest;
  return {
    activeId: ctx.activeId,
    pageManifest: ctx.pageManifest,
    agentManifest,
    isAdminScope,
    refetch: ctx.refetch,
  };
}
```

### Admin editor — `VerticalEditorPage.jsx`

Lives at `/admin/verticals`. Single-page layout:

```
┌─ /admin/verticals ─────────────────────────────────────────────────┐
│ [Active: Healthcare ▾]  [+ Clone vertical] [Delete]                │
│ [Reset this vertical to seed]  [Reset all verticals to seed]       │
│ [Save state]  [Restore saved state · May 29, 14:22]                │
├────────────────────────────────────────────────────────────────────┤
│ [Manifest] [Mock data]                                             │
│                                                                    │
│ Overrides (3 fields):           ┌─────────────────────────────┐    │
│  • identity.tagline             │  Monaco editor              │    │
│  • dashboard.chips[2]           │  - JSON syntax highlighting │    │
│  • theme.cssVars                │  - Live Zod validation      │    │
│ [Reset selected]                │  - Shows MERGED view        │    │
│                                 │    (seed + overlay)         │    │
│ [Save]  [Discard]               │                             │    │
│                                 └─────────────────────────────┘    │
└────────────────────────────────────────────────────────────────────┘
```

### UX rules

1. **Editor shows the merged manifest, not the raw overlay.** That is what "the current state of this vertical" actually means.
2. **Save = diff-and-overlay.** Client computes `diff(seed, edited)` and posts the resulting `{ path, value }` entries to `/overlay/batch`. The server stores only what differs from seed; defaults and unchanged fields are never overlaid.
3. **Validation is live.** Zod schema converted to JSON Schema via `zod-to-json-schema` and wired into Monaco. Save disabled when invalid.
4. **Overrides panel** lists current field paths from `overlay.list(id)`. Clicking a path jumps Monaco's cursor to that field. "Reset selected" deletes those overlay keys.
5. **Save does not optimistically update local state.** The admin's browser receives the same SSE event as everyone else and refetches like everyone else. Guarantees the editor view stays in sync with what the server actually persisted.
6. **Mock-data tab uses the same Monaco approach in Cycle 1.** Cycle 2 builds the ergonomic shape editor.
7. **Clone modal:** source dropdown (prefilled with current), new id (regex-validated, must not exist), new display name. Success navigates to editing the clone.
8. **Delete button hidden for protected ids** (`admin-console`, `banking`) and for the currently-active vertical.
9. **No undo stack in Cycle 1.** Last-write-wins. "Reset" handles the common case.

### Reset / snapshot model

- **Reset this vertical to seed:** `DELETE /api/verticals/:id/overlay` with no path.
- **Reset all verticals to seed:** `POST /api/verticals/reset-all`.
- **Save state:** `POST /api/verticals/snapshot` — overwrites the admin's single snapshot slot with the current `{ activeId, overlays }`. Shows timestamp.
- **Restore saved state:** `POST /api/verticals/snapshot/restore` — applies the snapshot's overlays + activeId. Confirm dialog. Button disabled when no snapshot exists.

Snapshots are per-admin. One slot per user. Survives sessions but doesn't cross users.

### Key editing decisions

1. **No optimistic update on save.** All clients (including the admin's own) hydrate via SSE. One code path, no drift.
2. **SSE reconnect is automatic and silent.** Native `EventSource` backoff. The initial `vertical-switched` on reconnect triggers `refetch` and self-heals any missed events.
3. **`applyThemeTokens` is the only DOM mutation outside React.** Writes new `cssVars` to `documentElement.style`, clears keys not present in the new vars. No class toggling, no CSS file swapping, no FOUC.
4. **Refetch is throttled to 250 ms trailing.** Cheap insurance against future burst-event scenarios.
5. **First paint blocks on hydration.** Trades a one-roundtrip first-paint delay for a category of "flicker of wrong terminology" bug guarantees. The initial SSE event arrives immediately on stream connect, so the delay is small.
6. **No CSRF protection beyond existing session middleware.** Admin routes opt into the same middleware as other admin endpoints.

---

## Section 5 — Migration and cutover

### Migration script — `demo_api_server/scripts/migrateVerticalsV3.js`

One-shot Node script. Runs once in the migration PR; the script itself is deleted before merge.

Per-vertical steps:

1. Read the old monolithic JSON (`config/verticals/<id>.json`).
2. Set `schemaVersion: 3` (replacing `2`).
3. Rename `admin` → `admin-console` (id and folder).
4. Move everything under `dashboard.mockData` into a separate `mock-data.json` file. The manifest's `dashboard` keeps `kind`, `chips`, `hero`, `llmChipGroups`.
5. Drop redundant accent variants from `featurePage`: `accentBg`, `accentLight`, `accentCode`, `accentText`, `accentAccentText`. Keep `accentColor`.
6. Validate the new manifest against `ManifestSchema`. Print Zod error path on failure.
7. **All-or-nothing.** Script does not write any output file until *every* vertical validates. If any fails, exit non-zero with the error path.
8. Write `manifest.json` and `mock-data.json` to the new folder.
9. After all 6 succeed, delete the 6 old `*.json` files.
10. Print summary: "Migrated 6 verticals (banking, healthcare, retail, sporting-goods, workforce, admin-console)."

### Migration PR commit order

A single PR; the diff is structured so reviewers can read it in this order:

1. Add `schema.ts`, `loader.ts`, `overlay.ts`, `resolver.ts`, `scope.ts`, `events.ts`.
2. Add `routes/verticalManifest.js`.
3. Add `VerticalProvider.jsx`, `useVertical.js`, `applyThemeTokens.js`.
4. Add `AdminEditor/` (Monaco editor + supporting components).
5. Add `migrateVerticalsV3.js`.
6. Run the script. Commit the resulting `verticals/<id>/manifest.json` + `mock-data.json` files.
7. Delete the old `verticals/*.json` files.
8. Delete `verticalConfigService.js`, `routes/verticalConfig.js`, `VerticalContext.js`, `ThemeContext.js`, `ThemePicker.*`, `chase-theme.css`, `dashboard-theme.css`, `verticalPrimaryTypes.js`.
9. Update consumers to use `useVertical()` — exhaustive grep-driven list at PR time.
10. Delete the migration script.

### Consumer migration checklist

(Final list assembled by grep during implementation; this is the seed.)

- `App.js` — provider wiring (single `<VerticalProvider>` replaces `<VerticalProvider>` + `<ThemeProvider>`).
- `BankingChips.jsx` — read chips from `useVertical().pageManifest.dashboard.chips`.
- `VerticalSwitcher.js` — read list + active id; POST to `/api/verticals/active` on selection.
- `VerticalFeaturePage.jsx` — read feature page config + mock data.
- `VerticalHero.jsx` — read hero card definitions + mock data.
- Anything currently calling `useTheme()` — read `useVertical().pageManifest.theme` instead (mostly nothing post-cutover; theming is CSS-var-driven).
- Tests importing old context modules.

### Bootstrap script update

`pingone:bootstrap` reads `demoUsers` per vertical. New layout: glob `config/verticals/*/manifest.json` instead of `config/verticals/*.json`. Same data, different path. One-line change, included in the migration PR.

### configStore migration

None required. No `vertical.overlay.*` keys exist pre-migration; the new system starts with zero overlays. `vertical.activeId` is a new key; defaults to `banking` on first read.

### Documented behavior changes

1. **Theme is token-driven, not class-driven.** Any custom CSS using `[class*="theme-"]` selectors stops working. The grep determines whether this matters; if yes, rewrite to use CSS variables.
2. **The `admin` vertical id is now `admin-console`.** String literals matching `'admin'` as a vertical id break; rename them. (Unrelated to the user role `admin`, which stays the same.)
3. **`featurePage.accent*` variants dropped.** Visual delta in the feature page until Cycle 2 derives them from `accentColor`. Accepted interim state.
4. **`schemaVersion: 2` no longer parses.** No external tool reads these files, so this is internal-only.

### Rollback

The migration is `git revert`-able until it lands on `main` and someone restarts with new configStore writes active. After that, `git revert` restores code but leaves any `vertical.overlay.*` keys orphaned (harmless — old code doesn't read them). Clean revert after-the-fact: revert + `configStore.delete('vertical.*')`.

### Demo data parity check

Before declaring migration complete: `./run.sh`, hit each vertical via the switcher, confirm dashboard renders, confirm a chip works, confirm the feature page renders. Cycle 2 is allowed to intentionally change UI; Cycle 1 must preserve behavior.

### Key migration decisions

1. **No dual-read fallback.** Same-PR consumer updates mean no code on `main` reads the old format after merge.
2. **Script is one-shot.** Not idempotent-as-a-feature. Runs once locally, produces committed output, dies.
3. **All-or-nothing validation.** Forces seed cleanup *before* cutover, not during.
4. **Bootstrap update is in the same PR.** Demo must reprovision after merge.

---

## Section 6 — Testing and verification

### Risk classes this design is uniquely exposed to

1. **Stale-context bugs.** Live switching means every consumer must re-render on change. Tests exercise that.
2. **Overlay merge bugs.** Field-level overlay + Zod validation + deep-merge produces subtle edge cases around arrays, defaults, and "delete this field."
3. **Scope-resolution drift.** The page/agent rule lives in two places (server `scope.ts`, client `useVertical`). Tests assert both.

### Server-side unit tests

```
schema.test.js
  ✓ minimum valid manifest passes
  ✓ missing required field rejected with path
  ✓ schemaVersion: 2 rejected
  ✓ schemaVersion: 3 + unknown top-level keys rejected (strict mode)
  ✓ empty cssVars rejected
  ✓ chip schema: id/label/message required
  ✓ format enum: 'money' accepted, 'currency' rejected

resolver.test.js
  ✓ resolve(id) with no overlay returns seed
  ✓ resolve(id) with one-field overlay returns deep-merged
  ✓ resolve(id) with array overlay: array replaced wholesale
  ✓ cache invalidates on overlay write
  ✓ cache invalidates on loader.reload(id)
  ✓ Zod defaults applied AFTER merge
  ✓ overlay producing invalid merged manifest rejected at write time

scope.test.js
  ✓ unauthenticated → pageManifest = active, adminManifest = null
  ✓ admin on /dashboard → agentManifest derives to pageManifest
  ✓ admin on /admin → agentManifest derives to admin-console
  ✓ admin on /admin/verticals → agentManifest derives to admin-console
  ✓ non-admin on /admin (defensive) → agentManifest = pageManifest

events.test.js
  ✓ overlay write fires vertical-edited once with correct id
  ✓ setActive fires vertical-switched once
  ✓ clone fires vertical-list-changed once
  ✓ delete fires vertical-list-changed once
  ✓ batch overlay write fires one vertical-edited, not N

overlay.test.js
  ✓ setField writes path; deepPartial-validates
  ✓ setField on array-leaf replaces entire array
  ✓ clearField removes only that path
  ✓ clearField on absent path is a no-op
  ✓ clearAll wipes all overlays for that id
  ✓ setField rejected if merged manifest fails validation

snapshot.test.js
  ✓ snapshot captures activeId + all current overlays
  ✓ restore writes overlays back, sets activeId, fires events for each affected vertical
  ✓ restore is idempotent
  ✓ snapshot is per-user
```

### Route tests

Following the project's regression-vs-integration split (per `CLAUDE.md`):

```
verticalManifestRoute.regression.test.js  (mocks configStore)
  ✓ GET /me unauthenticated → 401
  ✓ GET /me as customer → pageManifest only, adminManifest null, isAdmin false
  ✓ GET /me as admin → both manifests, isAdmin true
  ✓ POST /active as non-admin → 403
  ✓ POST /active as admin → 204, fires vertical-switched
  ✓ POST /:id/overlay as admin → 204, fires vertical-edited
  ✓ POST /:sourceId/clone with existing newId → 409
  ✓ POST /:sourceId/clone with invalid newId regex → 400
  ✓ DELETE /:id of protected id (banking, admin-console) → 403
  ✓ DELETE /:id of currently-active id → 409
  ✓ SSE /stream sends initial vertical-switched on connect

verticalManifestRoute.integration.test.js  (real configStore, mocks data layer)
  ✓ end-to-end: clone → edit overlay → switch active → restore snapshot all work
```

### UI tests

```
VerticalProvider.test.js
  ✓ no render until first manifest hydration
  ✓ SSE vertical-switched triggers refetch
  ✓ SSE vertical-edited triggers refetch
  ✓ SSE vertical-list-changed dispatches window event
  ✓ EventSource disconnect cleans up listener
  ✓ refetch throttled to 250ms trailing

useVertical.test.js
  ✓ agentManifest = pageManifest when not admin
  ✓ agentManifest = adminManifest when isAdmin && pathname startsWith /admin
  ✓ agentManifest = pageManifest when isAdmin but pathname is /dashboard
  ✓ agentManifest reactive to route changes (no refetch)

applyThemeTokens.test.js
  ✓ writes each cssVar to document.documentElement.style
  ✓ clears previously-set vars not present in new manifest
  ✓ runs whenever pageManifest.theme.cssVars changes
```

### Editor tests

```
VerticalEditorPage.test.js
  ✓ shows merged view (seed + overlay) in Monaco
  ✓ overrides panel lists current overlay field paths
  ✓ save computes diff against seed, posts batch overlay
  ✓ save disabled when Zod validation fails
  ✓ clone modal: invalid id regex disables submit
  ✓ delete button hidden for protected ids
  ✓ Save state / Restore state buttons present for admin
```

### End-to-end test (one)

```
demo_api_ui/tests/e2e/verticals.live-switch.e2e.spec.js
  Scenario: admin in tab A switches active from banking → healthcare.
            Tab B (logged in as customer, on /dashboard) updates within 2 seconds.
  Asserts:
    - tab B's header title changes to healthcare displayName
    - tab B's --theme-accent CSS variable matches healthcare manifest
    - tab B's chips render healthcare labels
    - no full-page reload in tab B
```

### Existing tests that must stay green

- `all-chips-pipeline.real.spec.js` — must pass post-cutover. Skill `skip-proof-pipeline-tests` is explicit that this test is not allowed to skip.
- `App.structure` tests in `demo_api_ui/` per CLAUDE.md §8.

### Manual smoke checklist (before merge)

1. `./run.sh` from clean — all services start.
2. Login as customer (default vertical `banking`): dashboard renders, chips work, transfer flow works.
3. Switch to `healthcare` via switcher: terminology, theme, chips update; no full reload.
4. Switch to `retail`, `sporting-goods`, `workforce`: each renders.
5. Login as admin, navigate to `/admin/verticals`: editor renders, current vertical pre-selected.
6. Edit a chip label, save: customer tab updates within 2 s.
7. "Reset this vertical to seed": reverted in customer tab within 2 s.
8. Clone `healthcare` → `test-clone`: appears in switcher, editor opens on new vertical.
9. Delete `test-clone`: gone from switcher.
10. "Save state" → tweak something → "Restore state": tweaks reverted.

### Key testing decisions

1. **Scope rule is unit-tested in both places** (server `scope.ts`, client `useVertical`). Same test cases, intentional duplication, surfaces drift.
2. **Overlay tests assert on the merged result**, not the overlay shape. Storage representation can change; resolver output is the contract.
3. **E2E asserts on CSS variable values**, not on computed pixel colors. Stable across rendering implementations.
4. **Test data is in-memory fixtures injected into the loader.** Tests are self-contained; CI doesn't need the seed directory.

---

## Cycle 2 TODOs (deferred, not in this spec)

- **Investigate hand-built per-section editor** (Q8 option B) as a Cycle 2 alternative to the Monaco JSON editor.
- **AI-augmented vertical generation** (Q11 follow-up): per-section "regenerate with brief" actions using Helix, plus a true from-scratch entry point.
- **Ergonomic mock-data shape editor** — add/remove fields from records visually, instead of editing JSON.
- **Derive `featurePage.accent*` variants** at render time from `accentColor` (Section 5 behavior change).
- **Rebuild chip catalog, dashboard layout, feature page UI** — the actual visual rewrite per vertical.
- **Setup-page "Themes" tab** — new tab in the install/setup wizard letting the operator pick (a) the **boot-time default vertical** (what `activeId` is set to on fresh install if unset) and (b) the **reset-target vertical** (what `POST /reset-all` returns to instead of hard-coded `banking`). User request 2026-05-29. Mechanically: add a new configStore key for the reset target, change the `POST /reset-all` route handler to read it, and add a section to the setup wizard that POSTs both values. Independent of the Cycle 2 visual rewrite; can be done first.

---

## Open questions for plan stage

- Throttle library choice (`lodash.throttle`, `use-debounce`, custom) — pick during plan.
- Exact JSON-schema-from-Zod toolchain (`zod-to-json-schema`) — confirm Monaco integration during plan.
- Default `activeId` if `vertical.activeId` is absent and `banking` doesn't exist (edge case) — fall back to first vertical in `loader.list()`; document during plan.
