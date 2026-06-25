# Integration Handoff — Agent UI: Clinical Split (Option 2B refined)

**Status:** components built and persisted; integration glue paused due to conflict with a parallel verticals rewrite that keeps reverting edits to `UserDashboard.js` / `App.js` / `AgentUiModeContext.js`.

**Date paused:** 2026-05-29.
**Resume condition:** verticals rewrite is merged (or it's confirmed safe to edit the five integration files below).

**Read this in order:**

1. This file (handoff + 5 integration edits)
2. [2026-05-28-agent-ui-clinical-split.md](2026-05-28-agent-ui-clinical-split.md) — the full 8-phase plan with rationale, risks, resolved decisions
3. [option-2b-refined.html](../../mockups/agent-ui-redesign/option-2b-refined.html) — the visual target (14 scenes)

---

## 0 · What's already on disk

These survived the conflict and **DO NOT NEED REWRITING**:

```
demo_api_ui/src/components/agent-clinical/
├── AgentClinicalHost.jsx    # shell — owns active-tab state + keyboard shortcuts
├── AgentTabsRail.jsx        # 3-tab segmented control + brand + session pill
├── TalkPane.jsx             # chat-left / narration-right split
├── InspectPane.jsx          # stub (Phase 4)
├── ConfigurePane.jsx        # stub (Phase 5)
├── TokenAuditTimeline.jsx   # stub (Phase 3d)
└── clinical.css             # all design tokens + chrome styles, scoped under .agent-clinical-host

docs/superpowers/plans/2026-05-28-agent-ui-clinical-split.md
docs/mockups/agent-ui-redesign/option-2b-refined.html
```

The components are **dormant** — nothing imports them yet. Activating them is 5 surgical edits below.

---

## 1 · The 5 integration edits

Apply these in order. Each is small and self-contained. Verify build green (`cd demo_api_ui && npm run build` → exit 0) after #3 and again after #5.

### Edit 1 — Register the feature flag in configStore

**File:** [`demo_api_server/services/configStore.js`](../../../demo_api_server/services/configStore.js)
**Anchor:** find the `FIELD_DEFS` block, locate the line:

```js
ff_agui_enabled:           { public: true, default: 'true'  },
```

**Add directly below it:**

```js
ff_agent_clinical_split:   { public: true, default: 'false' }, // 2B refined clinical-split dashboard layout (chat-left, audit-timeline-right) behind feature flag
```

### Edit 2 — Register the feature flag in the routes registry

**File:** [`demo_api_server/routes/featureFlags.js`](../../../demo_api_server/routes/featureFlags.js)
**Anchor:** find the `FLAG_REGISTRY` array, locate the entry whose `id` is `'ff_agui_enabled'`. It looks like:

```js
{
  id:           'ff_agui_enabled',
  name:         'AG-UI Streaming Agent',
  category:     'UI / Dashboard',
  description:  '...',
  impact:       '...',
  type:         'boolean',
  defaultValue: false,
},
```

**Add directly after it (still inside FLAG_REGISTRY):**

```js
{
  id:           'ff_agent_clinical_split',
  name:         'Agent Clinical Split (2B refined)',
  category:     'UI / Dashboard',
  description:
    'When **ON**, /dashboard renders the 2B-refined clinical split layout ' +
    '(chat-left, audit-timeline-right) with a Talk · Inspect · Configure tab rail. ' +
    'Replaces the legacy split3 + token-display chrome. ' +
    'When **OFF** (default), the existing dashboard layout is unchanged.',
  impact:
    'OFF (default) = legacy dashboard chrome unchanged. ' +
    'ON = clinical split host renders; Theme/Middle-Float/Always-float toggle is hidden.',
  type:         'boolean',
  defaultValue: false,
},
```

### Edit 3 — Wire the flag gate into UserDashboard

**File:** [`demo_api_ui/src/components/UserDashboard.js`](../../../demo_api_ui/src/components/UserDashboard.js)

**Edit 3a:** add the import near the other `./components/...` imports (around line 38–42):

```js
import AgentClinicalHost from "./agent-clinical/AgentClinicalHost";
```

**Edit 3b:** add the flag state. Find the existing line:

```js
const [dashboardLayout, setDashboardLayoutState] = useState(() =>
  getDashboardLayout(),
);
```

**Insert directly after that block (before `const [user, setUser] = useState(propUser);`):**

```js
/**
 * ff_agent_clinical_split — when on, the dashboard renders the 2B-refined
 * clinical-split layout instead of the legacy split3 / token-display chrome.
 * Default off; flipped on via /api/admin/feature-flags or
 * `?ff_agent_clinical_split=on` (URL override for ad-hoc testing).
 */
const [clinicalSplitEnabled, setClinicalSplitEnabled] = useState(() => {
  try {
    const sp = new URLSearchParams(window.location.search);
    const v = sp.get('ff_agent_clinical_split');
    return v === 'on' || v === 'true' || v === '1';
  } catch (_) {
    return false;
  }
});
useEffect(() => {
  let cancelled = false;
  fetch('/api/admin/feature-flags', { credentials: 'include' })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (cancelled) return;
      const f = data?.flags?.find((x) => x.id === 'ff_agent_clinical_split');
      if (f != null) setClinicalSplitEnabled((cur) => cur || Boolean(f.value));
    })
    .catch(() => {});
  return () => { cancelled = true; };
}, []);
```

**Edit 3c:** add the early-return gate. Find the main `return (` (around line 2522) that begins with:

```js
return (
  <div
    className={`user-dashboard user-dashboard--2026${
      agentPlacement === "middle"
        ? " user-dashboard--split3"
        : ""
    }${agentPlacement === "none" ? " user-dashboard--float-fab-left" : ""}`}
  >
```

**Insert directly BEFORE that return (after the loading-check return):**

```js
// ff_agent_clinical_split — render the 2B-refined clinical split instead of
// the legacy split3 chrome. The clinical layout owns the whole dashboard
// area when on; legacy chrome remains unchanged when off.
if (clinicalSplitEnabled) {
  return (
    <div className="user-dashboard user-dashboard--clinical-split agent-clinical-host">
      <AgentClinicalHost />
    </div>
  );
}
```

### Edit 4 — Add clinicalSplit field to AgentUiModeContext

**File:** [`demo_api_ui/src/context/AgentUiModeContext.js`](../../../demo_api_ui/src/context/AgentUiModeContext.js)

**Edit 4a:** add the field defaults to the `createContext` call. Find:

```js
const AgentUiModeContext = createContext({
  placement: 'middle',
  fab: true,
  setAgentUi: () => {},
  webMcpLastResult: null,
  setWebMcpLastResult: () => {},
  surfaceHostEl: null,
  setSurfaceHostEl: () => {},
});
```

**Replace the closing `});` (last 3 lines of that block) with:**

```js
  // ff_agent_clinical_split: TalkPane sets true on mount so App.js renders
  // BankingAgent with mode="inline" + splitColumnChrome (existing
  // .ba-mode-inline styles); cleared on unmount so the legacy floating dock
  // returns elsewhere.
  clinicalSplit: false,
  setClinicalSplit: () => {},
});
```

**Edit 4b:** add the useState declaration. Find:

```js
const [surfaceHostEl, setSurfaceHostEl] = useState(null);
```

**Insert directly after:**

```js
const [clinicalSplit, setClinicalSplit] = useState(false);
```

**Edit 4c:** expose `clinicalSplit` + `setClinicalSplit` in the provider value. Find the `useMemo(() => ({ ... }), [...])` block and add `clinicalSplit` + `setClinicalSplit` to the returned object AND `clinicalSplit` to the dep array (do NOT add setters from `useState` to deps — they're stable refs and the `react-hooks/exhaustive-deps` rule will throw on them).

The final block should look like:

```js
const value = useMemo(
  () => ({
    placement: state.placement,
    fab: state.fab,
    setAgentUi,
    webMcpLastResult,
    setWebMcpLastResult,
    surfaceHostEl,
    setSurfaceHostEl,
    clinicalSplit,
    setClinicalSplit,
  }),
  // setters from useState are stable refs — excluded per react-hooks/exhaustive-deps
  [state.placement, state.fab, setAgentUi, webMcpLastResult, surfaceHostEl, clinicalSplit]
);
```

### Edit 5 — Route inline-mode props in App.js

**File:** [`demo_api_ui/src/App.js`](../../../demo_api_ui/src/App.js)

**Edit 5a:** add `clinicalSplit` to the existing destructure. Find:

```js
const { placement: agentPlacement, fab: agentFab, surfaceHostEl } = useAgentUiMode();
```

**Replace with:**

```js
const { placement: agentPlacement, fab: agentFab, surfaceHostEl, clinicalSplit } = useAgentUiMode();
```

**Edit 5b:** add the clinical branch to `singleAgentSurfaceProps`. Find:

```js
const singleAgentSurfaceProps = hasEmbeddedDockLayout
  ? { mode: "inline", embeddedDockBottom: true }
  : {};
```

**Replace with:**

```js
// clinicalSplit (set by TalkPane via AgentUiModeContext when ff_agent_clinical_split=on)
// takes precedence over hasEmbeddedDockLayout — it renders BankingAgent with
// splitColumnChrome so the existing .ba-mode-inline.ba-split-column styles apply.
let singleAgentSurfaceProps = {};
if (clinicalSplit) {
  singleAgentSurfaceProps = { mode: "inline", splitColumnChrome: true };
} else if (hasEmbeddedDockLayout) {
  singleAgentSurfaceProps = { mode: "inline", embeddedDockBottom: true };
}
```

---

## 2 · Verification after the 5 edits

```bash
cd demo_api_ui && npm run build       # must exit 0
```

Expected warnings (pre-existing, not from this work):
- `App.js:1` — `'axios' is defined but never used`
- `App.js:3` — `'useCallback' is defined but never used`
- `UserDashboard.js:144` — `'open' is assigned a value but never used`

If you see new warnings under `agent-clinical/` or under your 5 edited files, investigate.

```bash
./run.sh                              # start all services
```

**Then in a browser:**

1. `https://api.ping.demo:4000/dashboard` → legacy dashboard renders unchanged (flag default = false).
2. `https://api.ping.demo:4000/dashboard?ff_agent_clinical_split=on` → new clinical split renders:
   - 44-px rail at top: `Care*Connect*` brand (vertical-aware), three tabs (Talk · Inspect · Configure), session pill, DU avatar
   - Below: chat-left / narration-right split
   - Left column: BankingAgent rendered with `mode="inline"` + `splitColumnChrome` — chat fills the column edge-to-edge (no floating dock chrome)
   - Right column: narration header + 4 tabs (Token chain / MCP calls / Rules / Tools) + 3 placeholder timeline cards (subject / actor / delegated MCP)
   - Keyboard `1` / `2` / `3` switch tabs (skipped when focus is in an input)

If the right column is squeezed or the chat overflows the rail, check that Edit 5b's clinical branch fires correctly — `splitColumnChrome` must be true.

---

## 3 · Things that are out of scope for these 5 edits

The components are stubs/placeholders today. The phases below are still pending after these 5 integration edits land:

| Phase | What's missing | Effort |
|---|---|---|
| 3d | `TokenAuditTimeline` real wiring — extract the timeline-card renderer from `TokenChainDisplay`, subscribe to `TokenChainContext`, render real RFC 8693 events instead of placeholder cards | ~45 min |
| 3e | Real states — in-flight skeleton, HITL 428 inline card, token-error rose card, session-expired held-request preservation, multi-tool grouping | ~1.5 days |
| 4 | `InspectPane` — wrap `ActivityLogPanel` + filter chips + alert digest | ~3 hr |
| 5 | `ConfigurePane` + `AgentFabPopover` — form fields write to `configStore`; FAB popover gets Chat / Token-chain / Rules tab switcher for Float mode | ~5 hr |
| 6 | Mobile `@media (max-width: 768px)` — stacked layout, Chat ↔ Timeline view toggle | ~3 hr |
| 7 | Retirement — remove `AgentUiModeToggle` mounts from the dashboard toolbar, stub the component, update `App.structure.test.js` | ~2 hr |
| 8 | Cleanup PR (separate, after 1 release) — delete `AgentUiModeToggle.{js,css}`, remove `placement` from context entirely, prune legacy `.ba-mode-inline` dead CSS in `BankingAgent.css` | ~2 hr |

Full breakdown in [2026-05-28-agent-ui-clinical-split.md §4](2026-05-28-agent-ui-clinical-split.md).

---

## 4 · Resolved design decisions (DO NOT re-litigate)

These were reviewed against the mockup and confirmed by the user. Don't second-guess them:

1. **Placement is single-choice: Inline OR Floating, never both.** Mockup scene 13 (coexistence) was rejected as redundant.
2. **Toggle lives in the Configure tab → Agent placement.** No always-visible chrome control.
3. **Default = Inline** on first load; Floating is opt-in.
4. **In Floating mode, /dashboard reclaims the full page** (Option A from mockup scene 14). The FAB popover gets a 3-tab switcher: **Chat · Token chain · Rules**. Inspect lives only inline (switch placement to reach it). Configure is reachable from the FAB popover's ⋯ menu → "Open Configure" + "Switch to inline mode."
5. **Switch-back-to-inline affordance** is in the FAB popover ⋯ menu, not on the dashboard chrome.

---

## 5 · Known parallel-work conflict (this is why the integration paused)

A separate verticals rewrite is editing the same five files. When that branch merges, conflicts will hit `UserDashboard.js`, `App.js`, and `AgentUiModeContext.js`. Resolution strategy:

- **Take theirs for vertical wiring** (theme detection, brand name resolution, vertical-aware system prompts).
- **Keep mine for clinical-split wiring** (the `clinicalSplit` context field, the `clinicalSplitEnabled` UserDashboard state, the `splitColumnChrome` branch in App.js).

The two are mechanically additive — they don't touch the same lines — so a careful 3-way merge resolves cleanly. The `AgentClinicalHost` already pulls vertical brand via `useTheme()`:

```js
const { identity, terminology } = useTheme();
const brand = identity?.displayName || terminology?.brandName || 'CareConnect';
```

so vertical switching will Just Work as long as the verticals rewrite preserves the `useTheme` contract.

---

## 6 · Two open work items that aren't blocked by this conflict

Both are noted in the parent plan and can be investigated independently:

1. **Verify the UI works across all `llm_framework` values** (langchain / openai_agents / mastra / pydantic_ai). The UI never talks to a framework directly — it calls `/api/agent/run`. Visual should be identical for each. Spot-check this once `ConfigurePane` lands (Phase 5) by switching the framework and confirming chat + token chain render the same.
2. **Vertical-response bug:** user reports the agent replies in banking language even when active vertical is CareConnect / Great Buy / Super Sports. Likely in `nlIntentParser.js`, `HELIX_AGENT_DIRECTIVES.json`, or the server-side system-prompt assembly. **Out of clinical-split scope but blocks the vertical demo story** — worth a separate plan.

---

## 7 · Files that survived for sure (verify before assuming reverts)

Run this from the repo root before starting:

```bash
ls -la demo_api_ui/src/components/agent-clinical/  # should show 7 files
git status -s | grep "agent-clinical\|2026-05-2[89]-agent"
```

Expected output includes:
```
?? demo_api_ui/src/components/agent-clinical/
?? docs/superpowers/plans/2026-05-28-agent-ui-clinical-split.md
?? docs/superpowers/plans/2026-05-29-agent-clinical-split-integration-handoff.md
```

(Untracked = the components and plans are on disk but not yet committed. If `agent-clinical/` is missing, the work was lost — recreate from this plan + the parent plan.)
