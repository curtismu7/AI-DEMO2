# Prompt Flow Inspector — UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/prompt-flow-inspector`, a standalone admin page that correlates one AI prompt flow (Agent → LLM → Agent Gateway → P1AZ → Backend) into a single 3-pane view built on the shared `InspectorShell`.

**Architecture:** One page component, `demo_api_ui/src/pages/PromptFlowInspector.jsx`, composes `InspectorShell` directly (per `inspector-template` skill's Path 2 — scaffold from scratch, not copied from an existing page's file): left column is a manually-refreshed run list from `GET /api/prompt-flow`; middle column is the selected run's hops rendered as a layer-color-striped timeline fetched from `GET /api/prompt-flow/:correlationId`; right column is `InspectorTabs` (Details / Raw JSON) driven by the selected hop and the full run response. A small pure utility, `src/utils/promptFlowLayers.js`, maps a hop's `service` field to one of 5 layers (Agent/LLM/Gateway/P1AZ/Backend) and a run's rollup `status` to a pill style — kept separate so the color/status logic is unit-testable without mounting the page. Routing and nav wiring follow the existing `AgentFlowInspectorRoute` / "Inspectors" nav-group conventions exactly.

**Tech Stack:** React 19 + Vite + vitest (jsdom, `@testing-library/react`), `InspectorShell`/`InspectorTabs`/`JsonHighlight` from `src/components/shared/`.

**Spec:** `docs/superpowers/specs/2026-08-16-prompt-flow-inspector-design.md`

## Global Constraints

- **Scope: `demo_api_ui` only.** This is 1 of 6 sibling plans (backend, gateway, P1AZ, LLM proxy, agent are separate plans/PRs). Do not touch `demo_api_server`, `demo_mcp_gateway`, `demo_authz_server`, `demo_llm_proxy`, or `langchain_agent`. The two backend endpoints this plan depends on (`GET /api/prompt-flow`, `GET /api/prompt-flow/:correlationId`) may not exist yet — every task builds and tests against a fixture matching the response shape defined in this plan's "Interfaces" sections, via `vi.mock('../../services/apiClient', ...)`, exactly like the existing `AgentFlowHistoryPage.test.jsx` pattern.
- **Spec §5 requirements** (verbatim intent, restated as acceptance criteria):
  - Left: run list from `GET /api/prompt-flow` — **manual refresh only, no live tail this iteration**.
  - Center: selected run's hops as an **ordered, layer-color-striped timeline** (Agent / LLM / Gateway / P1AZ / Backend).
  - Right: tabbed detail panel — **Details** (selected hop's full `details`, redaction clearly marked) / **Raw JSON** (full ledger response for the run).
  - New route + nav entry under the existing "Inspectors" group (`AdminSideNav.jsx`, `navStructureCatalog.js`), gated the same way as the closest reference page (`PolicyDecisionTracePage` — page itself ungated, backing data is admin-session-gated; route-level guest redirect copied from `AgentFlowInspectorRoute`'s `if (!user) return <Navigate to="/" replace />` pattern).
- **Spec §6 error handling relevant to this layer:** a missing/unknown `correlationId` returns an *empty* result from the read endpoint, not an error — the UI's "no hops" empty state (Task 3) covers this without needing special-case error handling.
- **Spec scope exclusions (explicitly out of scope this iteration):** live tail/streaming updates, and any pagination controls beyond consuming whatever array the list endpoint returns (spec says the endpoint itself is "paginated" but defines no query contract for it yet — do not invent one).
- **Colors, not tokens.** `InspectorShell.css` and `UnifiedTokenFlowInspector.jsx` (the two files named as this feature's styling precedent) both use hardcoded hex literals from a Tailwind-style palette — there is no `--th-*` custom-property system in this component family. Follow that same convention: the 5 layer colors and the OK/DENY/STEP-UP status-pill colors below are hardcoded hex, matching colors already in use elsewhere in this app (`#d97706` amber and `#0d9488` teal already appear in `UnifiedTokenFlowInspector.jsx`; the green/red/amber pill triad matches `AgentFlowHistoryPage.css`'s `.afh-status-badge--*`). Do not introduce a new token system for this one page.
- **Emoji allowlist** (`REGRESSION_PLAN.md` §0, root `CLAUDE.md`): `⚠️ ✅ ❌ 🔐 ✕ ✓ 👤 🔑 🪟 📚` only. This feature's copy uses none of them — all status/redaction indicators are plain text badges (`OK`, `DENY`, `STEP-UP`, `REDACTED`), not emoji or icons.
- **No modals** are introduced by this plan, so the `DraggableModal`-only rule doesn't apply here — noted for the Self-Review checklist.

---

### Task 1: `promptFlowLayers` utility — layer & status-pill mapping

**Files:**
- Create: `demo_api_ui/src/utils/promptFlowLayers.js`
- Test: `demo_api_ui/src/utils/__tests__/promptFlowLayers.test.js`

**Interfaces:**
- Consumes: a ledger hop object shaped like the real `transactionLedger.lmdb.js` stored hop (confirmed by reading `demo_mcp_gateway/src/gatewayAudit.ts`, `demo_authz_server/routes/decision.js`, `demo_api_server/services/lmdb/transactionLedger.lmdb.js`): `{ phase, service, op, identity, decision: { outcome, by, reason }, durationMs, status, details? }`. The `service` literals for the 3 pre-existing hop emitters are exactly `'mcp-gateway'`, `'authz-server'`, `'demo-api-server'`; the 2 new emitters this design adds (`langchain_agent`, `demo_llm_proxy`) are assumed to follow the same directory-derived kebab-case convention (`'langchain-agent'`, `'llm-proxy'`) until the backend plan lands — documented as an assumption in the module's own header comment.
- Produces: `LAYER_META` (object keyed `agent|llm|gateway|p1az|backend|other`, each `{ label, color, bg, text }`), `layerForHop(hop)` → one of those keys, `STATUS_PILL_META` (keyed `'OK'|'DENY'|'STEP-UP'`, each `{ label, bg, text }`), `statusPillMeta(status)` → a `{ label, bg, text }` object (falls back to a neutral gray pill for any other value). Tasks 2–4 import these directly.

- [ ] **Step 1: Write the failing test**

  Create `demo_api_ui/src/utils/__tests__/promptFlowLayers.test.js`:

  ```js
  import { LAYER_META, layerForHop, STATUS_PILL_META, statusPillMeta } from '../promptFlowLayers';

  describe('layerForHop', () => {
    it('maps each known service to its layer', () => {
      expect(layerForHop({ service: 'langchain-agent' })).toBe('agent');
      expect(layerForHop({ service: 'llm-proxy' })).toBe('llm');
      expect(layerForHop({ service: 'mcp-gateway' })).toBe('gateway');
      expect(layerForHop({ service: 'authz-server' })).toBe('p1az');
      expect(layerForHop({ service: 'demo-api-server' })).toBe('backend');
    });

    it('falls back to "other" for an unknown or missing service', () => {
      expect(layerForHop({ service: 'some-future-service' })).toBe('other');
      expect(layerForHop({})).toBe('other');
      expect(layerForHop(null)).toBe('other');
    });

    it('has a LAYER_META entry for every layer layerForHop can return', () => {
      ['agent', 'llm', 'gateway', 'p1az', 'backend', 'other'].forEach((key) => {
        expect(LAYER_META[key]).toBeDefined();
        expect(LAYER_META[key].label).toEqual(expect.any(String));
        expect(LAYER_META[key].color).toMatch(/^#[0-9a-f]{6}$/i);
      });
    });
  });

  describe('statusPillMeta', () => {
    it('returns the known meta for OK/DENY/STEP-UP', () => {
      expect(statusPillMeta('OK')).toBe(STATUS_PILL_META.OK);
      expect(statusPillMeta('DENY')).toBe(STATUS_PILL_META.DENY);
      expect(statusPillMeta('STEP-UP')).toBe(STATUS_PILL_META['STEP-UP']);
    });

    it('falls back to a neutral pill for an unknown status', () => {
      expect(statusPillMeta('WEIRD')).toEqual({ label: 'WEIRD', bg: '#f1f5f9', text: '#334155' });
    });

    it('labels a missing status as UNKNOWN', () => {
      expect(statusPillMeta(undefined)).toEqual({ label: 'UNKNOWN', bg: '#f1f5f9', text: '#334155' });
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```
  cd demo_api_ui && npx vitest run src/utils/__tests__/promptFlowLayers.test.js
  ```

  Expected: fails to resolve — `Error: Failed to load url ../promptFlowLayers (does not exist)` — because `src/utils/promptFlowLayers.js` has not been created yet.

- [ ] **Step 3: Write minimal implementation**

  Create `demo_api_ui/src/utils/promptFlowLayers.js`:

  ```js
  // demo_api_ui/src/utils/promptFlowLayers.js
  // Maps a Prompt Flow Inspector ledger hop to one of the 5 layers the
  // timeline color-codes (docs/superpowers/specs/2026-08-16-prompt-flow-inspector-design.md
  // §5). `service` literals for gateway/authz/backend hops are the existing
  // ones sent by demo_mcp_gateway/src/transactionHop.ts,
  // demo_authz_server/transactionHop.js, and
  // demo_api_server/services/transactionHop.js. The agent/llm-proxy
  // emitters are new (per the design's §2) — this assumes the same
  // directory-derived kebab-case convention until the backend plan lands.
  export const LAYER_META = {
    agent: { label: 'Agent', color: '#7c3aed', bg: '#ede9fe', text: '#5b21b6' },
    llm: { label: 'LLM', color: '#d97706', bg: '#fef3c7', text: '#92400e' },
    gateway: { label: 'Gateway', color: '#0d9488', bg: '#ccfbf1', text: '#115e59' },
    p1az: { label: 'P1AZ', color: '#e11d48', bg: '#ffe4e6', text: '#9f1239' },
    backend: { label: 'Backend', color: '#0284c7', bg: '#e0f2fe', text: '#075985' },
    other: { label: 'Other', color: '#64748b', bg: '#f1f5f9', text: '#334155' },
  };

  const SERVICE_TO_LAYER = {
    'langchain-agent': 'agent',
    'llm-proxy': 'llm',
    'mcp-gateway': 'gateway',
    'authz-server': 'p1az',
    'demo-api-server': 'backend',
  };

  export function layerForHop(hop) {
    return SERVICE_TO_LAYER[hop?.service] || 'other';
  }

  // Run-level rollup status shown as a pill in the run list — distinct from
  // a single hop's own `status` ('ok'|'error') or `decision.outcome`
  // ('permit'|'deny'|'n/a'); this is the whole-run summary the design's
  // approved mockup calls "OK/DENY/STEP-UP".
  export const STATUS_PILL_META = {
    OK: { label: 'OK', bg: '#dcfce7', text: '#166534' },
    DENY: { label: 'DENY', bg: '#fee2e2', text: '#991b1b' },
    'STEP-UP': { label: 'STEP-UP', bg: '#fef3c7', text: '#92400e' },
  };

  export function statusPillMeta(status) {
    return STATUS_PILL_META[status] || { label: status || 'UNKNOWN', bg: '#f1f5f9', text: '#334155' };
  }
  ```

- [ ] **Step 4: Run test to verify it passes**

  ```
  cd demo_api_ui && npx vitest run src/utils/__tests__/promptFlowLayers.test.js
  ```

  Expected: `Test Files  1 passed (1)` / `Tests  6 passed (6)`.

- [ ] **Step 5: Commit**

  ```
  git add demo_api_ui/src/utils/promptFlowLayers.js demo_api_ui/src/utils/__tests__/promptFlowLayers.test.js
  git commit -m "$(cat <<'EOF'
  Add promptFlowLayers utility for Prompt Flow Inspector layer/status colors

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 2: `PromptFlowInspector` skeleton — run list (left column)

**Files:**
- Create: `demo_api_ui/src/pages/PromptFlowInspector.jsx`
- Create: `demo_api_ui/src/pages/PromptFlowInspector.css`
- Create: `demo_api_ui/src/pages/__tests__/PromptFlowInspector.test.jsx`

**Interfaces:**
- Consumes: `GET /api/prompt-flow` → `{ runs: [{ correlationId, startedAt, vertical, status, hopCount }] }` (per spec §4: "distinct correlationId + latest timestamp + summary status + vertical"; `status` is one of `'OK'|'DENY'|'STEP-UP'`, `hopCount` mirrors the existing `GET /api/transaction-trace` list shape's `hopCount` field). Assumed newest-first, matching this app's existing `GET /api/agent-flow-history` convention.
- Produces: default export `PromptFlowInspector` (no props) rendering one `InspectorShell` instance with `title`, `statusText`, a `Refresh` action, and a populated `left` slot. `middle`/`right` are static empty-state placeholders in this task — filled in by Tasks 3–4.

- [ ] **Step 1: Write the failing test**

  Create `demo_api_ui/src/pages/__tests__/PromptFlowInspector.test.jsx`:

  ```jsx
  import React from 'react';
  import { render, screen, fireEvent, waitFor } from '@testing-library/react';
  import '@testing-library/jest-dom';
  import PromptFlowInspector from '../PromptFlowInspector';

  vi.mock('../PromptFlowInspector.css', () => ({}), { virtual: true });
  vi.mock('../../services/apiClient', () => ({
    default: { get: vi.fn() },
  }));

  import apiClient from '../../services/apiClient';

  export const RUNS = [
    { correlationId: 'corr_2', startedAt: '2026-08-16T10:00:00.000Z', vertical: 'sporting-goods', status: 'OK', hopCount: 5 },
    { correlationId: 'corr_1', startedAt: '2026-08-16T09:00:00.000Z', vertical: 'sporting-goods', status: 'DENY', hopCount: 3 },
  ];

  beforeEach(() => {
    apiClient.get.mockReset();
  });

  describe('PromptFlowInspector — run list', () => {
    it('shows a loading state, then an empty state when there is no history', async () => {
      apiClient.get.mockResolvedValue({ data: { runs: [] } });
      render(<PromptFlowInspector />);
      expect(screen.getByText(/Loading runs/)).toBeInTheDocument();
      await waitFor(() => expect(screen.getByText(/No prompt flow runs recorded yet/)).toBeInTheDocument());
    });

    it('shows an error state and a retry button when the list fetch fails', async () => {
      apiClient.get.mockRejectedValue(new Error('network down'));
      render(<PromptFlowInspector />);
      await waitFor(() => expect(screen.getByText(/Failed to load prompt flow runs/)).toBeInTheDocument());
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    });

    it('renders each run with its status pill, correlationId, and vertical', async () => {
      apiClient.get.mockResolvedValue({ data: { runs: RUNS } });
      render(<PromptFlowInspector />);
      await waitFor(() => expect(screen.getByText('corr_2')).toBeInTheDocument());
      expect(screen.getByText('corr_1')).toBeInTheDocument();
      expect(screen.getByText('OK')).toBeInTheDocument();
      expect(screen.getByText('DENY')).toBeInTheDocument();
    });

    it('the topbar Refresh button re-fetches the run list', async () => {
      apiClient.get.mockResolvedValue({ data: { runs: [] } });
      render(<PromptFlowInspector />);
      await waitFor(() => expect(screen.getByText(/No prompt flow runs recorded yet/)).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
      expect(apiClient.get).toHaveBeenCalledTimes(2);
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```
  cd demo_api_ui && npx vitest run src/pages/__tests__/PromptFlowInspector.test.jsx
  ```

  Expected: fails to resolve — `Error: Failed to load url ../PromptFlowInspector` — because `src/pages/PromptFlowInspector.jsx` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

  Create `demo_api_ui/src/pages/PromptFlowInspector.css`:

  ```css
  /* demo_api_ui/src/pages/PromptFlowInspector.css */
  .pfi-empty {
    padding: 24px 16px;
    font-size: 13px;
    color: #64748b;
    text-align: center;
  }
  .pfi-empty--error { color: #991b1b; }
  .pfi-retry-btn {
    font-size: 12px;
    padding: 3px 10px;
    border-radius: 4px;
    border: 1px solid #94a3b8;
    background: #ffffff;
    color: #334155;
    cursor: pointer;
  }
  .pfi-retry-btn:hover { background: #e2e8f0; }

  .pfi-run-item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 10px 14px;
    border: none;
    border-bottom: 1px solid #e2e8f0;
    background: none;
    cursor: pointer;
  }
  .pfi-run-item:hover { background: #e2e8f0; }
  .pfi-run-item--active { background: rgba(37, 99, 235, 0.08); }
  .pfi-run-item-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 4px;
  }
  .pfi-run-time { font-size: 11px; color: #64748b; }
  .pfi-run-item-mid {
    font-family: 'SF Mono', SFMono-Regular, monospace;
    font-size: 12px;
    color: #1e293b;
    margin-bottom: 2px;
  }
  .pfi-run-item-bottom { font-size: 11px; color: #64748b; }

  .pfi-status-pill {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;
  }
  ```

  Create `demo_api_ui/src/pages/PromptFlowInspector.jsx`:

  ```jsx
  // demo_api_ui/src/pages/PromptFlowInspector.jsx
  // /prompt-flow-inspector — admin page correlating one AI prompt flow across
  // all 5 layers (Agent, LLM, Agent Gateway, P1AZ, Backend) from
  // transactionLedger.lmdb, per
  // docs/superpowers/specs/2026-08-16-prompt-flow-inspector-design.md.
  // Left: run list (GET /api/prompt-flow, manual refresh — history-first, no
  // live tail this iteration). Center/right are wired in later tasks of the
  // same plan (timeline, Details/Raw JSON tabs).
  import React, { useCallback, useEffect, useState } from 'react';
  import apiClient from '../services/apiClient';
  import InspectorShell from '../components/shared/InspectorShell';
  import { statusPillMeta } from '../utils/promptFlowLayers';
  import './PromptFlowInspector.css';

  const PAGE_TITLE = 'Prompt Flow Inspector';

  function formatTimestamp(iso) {
    if (!iso) return 'Unknown time';
    const t = Date.parse(iso);
    return Number.isNaN(t) ? 'Unknown time' : new Date(t).toLocaleString();
  }

  export default function PromptFlowInspector() {
    const [runs, setRuns] = useState(null); // null = loading
    const [listError, setListError] = useState(null);

    const fetchRuns = useCallback(() => {
      setRuns(null);
      setListError(null);
      apiClient
        .get('/api/prompt-flow')
        .then((r) => setRuns(Array.isArray(r.data?.runs) ? r.data.runs : []))
        .catch(() => {
          setRuns([]);
          setListError('Failed to load prompt flow runs.');
        });
    }, []);

    useEffect(() => { fetchRuns(); }, [fetchRuns]);

    const left = (
      <div className="inspector-shell-tree-body">
        {runs === null && <div className="pfi-empty">Loading runs…</div>}
        {listError && (
          <div className="pfi-empty pfi-empty--error">
            {listError}{' '}
            <button type="button" className="pfi-retry-btn" onClick={fetchRuns}>Try again</button>
          </div>
        )}
        {runs && runs.length === 0 && !listError && (
          <div className="pfi-empty">No prompt flow runs recorded yet.</div>
        )}
        {runs && runs.map((run) => {
          const pill = statusPillMeta(run.status);
          return (
            <div className="pfi-run-item" key={run.correlationId}>
              <div className="pfi-run-item-top">
                <span className="pfi-status-pill" style={{ background: pill.bg, color: pill.text }}>
                  {pill.label}
                </span>
                <span className="pfi-run-time">{formatTimestamp(run.startedAt)}</span>
              </div>
              <div className="pfi-run-item-mid">{run.correlationId}</div>
              <div className="pfi-run-item-bottom">
                {run.vertical || 'unknown vertical'}
                {run.hopCount ? ` · ${run.hopCount} hop${run.hopCount === 1 ? '' : 's'}` : ''}
              </div>
            </div>
          );
        })}
      </div>
    );

    const middle = (
      <div className="inspector-shell-form-empty">Select a run from the list to inspect it.</div>
    );

    const right = (
      <div className="inspector-shell-output-empty">Select a run to see its details.</div>
    );

    return (
      <InspectorShell
        title={PAGE_TITLE}
        statusText={runs === null ? 'Loading…' : `${runs.length} run${runs.length === 1 ? '' : 's'}`}
        actions={
          <button type="button" className="inspector-shell-topbar__btn" onClick={fetchRuns} disabled={runs === null}>
            {runs === null ? 'Loading…' : 'Refresh'}
          </button>
        }
        left={left}
        middle={middle}
        right={right}
      />
    );
  }
  ```

- [ ] **Step 4: Run test to verify it passes**

  ```
  cd demo_api_ui && npx vitest run src/pages/__tests__/PromptFlowInspector.test.jsx
  ```

  Expected: `Test Files  1 passed (1)` / `Tests  4 passed (4)`.

- [ ] **Step 5: Commit**

  ```
  git add demo_api_ui/src/pages/PromptFlowInspector.jsx demo_api_ui/src/pages/PromptFlowInspector.css demo_api_ui/src/pages/__tests__/PromptFlowInspector.test.jsx
  git commit -m "$(cat <<'EOF'
  Add PromptFlowInspector run list (left column) on InspectorShell

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 3: Hop timeline (middle column) + run selection

**Files:**
- Modify: `demo_api_ui/src/pages/PromptFlowInspector.jsx` (Task 2's file)
- Modify: `demo_api_ui/src/pages/PromptFlowInspector.css` (append)
- Modify: `demo_api_ui/src/pages/__tests__/PromptFlowInspector.test.jsx` (append)

**Interfaces:**
- Consumes: `GET /api/prompt-flow/:correlationId` → `{ correlationId, startedAt, endedAt, vertical, status, hops: [...] }`, each hop shaped per Task 1's fixture (`{ seq, phase, service, ts, durationMs, status, decision: { outcome, by, reason }, details }`), ordered by timestamp ascending (matches the real `transactionAssembler.assemble()` re-sequencing behavior confirmed in `demo_api_server/services/transactionAssembler.js`).
- Produces: clicking a run row now selects it (`selectedId` state) and auto-selects the first (newest) run once the list loads; the middle column renders the fetched hops as a timeline, each item selectable (`selectedHopIndex` state) for Task 4's Details tab to consume.

- [ ] **Step 1: Write the failing test**

  Append to `demo_api_ui/src/pages/__tests__/PromptFlowInspector.test.jsx` (after the existing `describe('PromptFlowInspector — run list', ...)` block):

  ```jsx
  export const HOPS = [
    { seq: 1, phase: 'agent.step', service: 'langchain-agent', ts: '2026-08-16T10:00:00.100Z', durationMs: 40, status: 'ok', decision: { outcome: 'n/a', by: 'agent', reason: null }, details: { content: 'redacted prompt text' } },
    { seq: 2, phase: 'llm.call', service: 'llm-proxy', ts: '2026-08-16T10:00:00.200Z', durationMs: 900, status: 'ok', decision: { outcome: 'n/a', by: 'llm-proxy', reason: null }, details: { model: 'gpt-oss-20b', promptRedacted: 'redacted', completionRedacted: 'redacted' } },
    { seq: 3, phase: 'gateway.authorize', service: 'mcp-gateway', ts: '2026-08-16T10:00:01.000Z', durationMs: 15, status: 'ok', decision: { outcome: 'permit', by: 'gateway', reason: 'scopes ok' }, details: { httpStatus: 200 } },
    { seq: 4, phase: 'authz.decision', service: 'authz-server', ts: '2026-08-16T10:00:01.050Z', durationMs: 8, status: 'ok', decision: { outcome: 'permit', by: 'p1az', reason: 'PERMIT' }, details: { decision: 'PERMIT' } },
    { seq: 5, phase: 'backend.request', service: 'demo-api-server', ts: '2026-08-16T10:00:01.200Z', durationMs: 22, status: 'ok', decision: { outcome: 'n/a', by: 'backend', reason: null }, details: { endpoint: '/api/accounts' } },
  ];

  describe('PromptFlowInspector — timeline', () => {
    it('auto-selects the first run and renders its hops as a layer-labeled timeline', async () => {
      apiClient.get.mockImplementation((url) => {
        if (url === '/api/prompt-flow') return Promise.resolve({ data: { runs: RUNS } });
        return Promise.resolve({ data: { correlationId: 'corr_2', hops: HOPS } });
      });
      render(<PromptFlowInspector />);
      await waitFor(() => expect(screen.getByText('agent.step')).toBeInTheDocument());
      expect(screen.getByText('llm.call')).toBeInTheDocument();
      expect(screen.getByText('gateway.authorize')).toBeInTheDocument();
      expect(screen.getByText('authz.decision')).toBeInTheDocument();
      expect(screen.getByText('backend.request')).toBeInTheDocument();
      expect(screen.getByText('Agent')).toBeInTheDocument();
      expect(screen.getByText('LLM')).toBeInTheDocument();
      expect(screen.getByText('P1AZ')).toBeInTheDocument();
      expect(screen.getByText('Backend')).toBeInTheDocument();
    });

    it('shows a loading state for the run detail while it fetches', async () => {
      let resolveDetail;
      apiClient.get.mockImplementation((url) => {
        if (url === '/api/prompt-flow') return Promise.resolve({ data: { runs: RUNS } });
        return new Promise((resolve) => { resolveDetail = resolve; });
      });
      render(<PromptFlowInspector />);
      await waitFor(() => expect(screen.getByText('Loading run…')).toBeInTheDocument());
      resolveDetail({ data: { correlationId: 'corr_2', hops: HOPS } });
      await waitFor(() => expect(screen.getByText('agent.step')).toBeInTheDocument());
    });

    it('clicking a different run in the list re-fetches and re-renders its own hops', async () => {
      apiClient.get.mockImplementation((url) => {
        if (url === '/api/prompt-flow') return Promise.resolve({ data: { runs: RUNS } });
        if (url === '/api/prompt-flow/corr_2') return Promise.resolve({ data: { correlationId: 'corr_2', hops: HOPS } });
        return Promise.resolve({ data: { correlationId: 'corr_1', hops: [HOPS[0]] } });
      });
      render(<PromptFlowInspector />);
      await waitFor(() => expect(screen.getByText('backend.request')).toBeInTheDocument());
      fireEvent.click(screen.getByText('corr_1'));
      await waitFor(() => expect(screen.queryByText('backend.request')).not.toBeInTheDocument());
      expect(screen.getByText('agent.step')).toBeInTheDocument();
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```
  cd demo_api_ui && npx vitest run src/pages/__tests__/PromptFlowInspector.test.jsx
  ```

  Expected: the 3 new tests in `PromptFlowInspector — timeline` fail — `Unable to find an element with the text: agent.step` — because clicking a run doesn't yet select it and the middle column still renders the static Task 2 placeholder.

- [ ] **Step 3: Write minimal implementation**

  In `demo_api_ui/src/pages/PromptFlowInspector.jsx`, apply these edits:

  Edit 1 — import the layer mapping:

  ```js
  // old
  import InspectorShell from '../components/shared/InspectorShell';
  import { statusPillMeta } from '../utils/promptFlowLayers';
  ```
  ```js
  // new
  import InspectorShell from '../components/shared/InspectorShell';
  import { LAYER_META, layerForHop, statusPillMeta } from '../utils/promptFlowLayers';
  ```

  Edit 2 — add selection + detail-fetch state, right after the mount-fetch effect:

  ```js
  // old
    useEffect(() => { fetchRuns(); }, [fetchRuns]);

    const left = (
  ```
  ```js
  // new
    useEffect(() => { fetchRuns(); }, [fetchRuns]);

    const [selectedId, setSelectedId] = useState(null);
    const [runDetail, setRunDetail] = useState(null); // null = none loaded/loading
    const [detailError, setDetailError] = useState(null);
    const [selectedHopIndex, setSelectedHopIndex] = useState(0);

    // Default to the latest run once the list loads (mirrors AgentFlowHistoryPage).
    useEffect(() => {
      if (runs && runs.length && selectedId == null) {
        setSelectedId(runs[0].correlationId);
      }
    }, [runs, selectedId]);

    useEffect(() => {
      if (!selectedId) { setRunDetail(null); return; }
      setRunDetail(null);
      setDetailError(null);
      setSelectedHopIndex(0);
      apiClient
        .get(`/api/prompt-flow/${encodeURIComponent(selectedId)}`)
        .then((r) => setRunDetail(r.data || null))
        .catch(() => {
          setRunDetail({ hops: [] });
          setDetailError('Failed to load this run.');
        });
    }, [selectedId]);

    const hops = runDetail?.hops || [];

    const left = (
  ```

  Edit 3 — make run rows selectable (replace the static `<div>` row with a `<button>`):

  ```jsx
  // old
        {runs && runs.map((run) => {
          const pill = statusPillMeta(run.status);
          return (
            <div className="pfi-run-item" key={run.correlationId}>
              <div className="pfi-run-item-top">
                <span className="pfi-status-pill" style={{ background: pill.bg, color: pill.text }}>
                  {pill.label}
                </span>
                <span className="pfi-run-time">{formatTimestamp(run.startedAt)}</span>
              </div>
              <div className="pfi-run-item-mid">{run.correlationId}</div>
              <div className="pfi-run-item-bottom">
                {run.vertical || 'unknown vertical'}
                {run.hopCount ? ` · ${run.hopCount} hop${run.hopCount === 1 ? '' : 's'}` : ''}
              </div>
            </div>
          );
        })}
  ```
  ```jsx
  // new
        {runs && runs.map((run) => {
          const pill = statusPillMeta(run.status);
          const active = run.correlationId === selectedId;
          return (
            <button
              type="button"
              key={run.correlationId}
              className={`pfi-run-item${active ? ' pfi-run-item--active' : ''}`}
              onClick={() => setSelectedId(run.correlationId)}
              aria-current={active}
            >
              <div className="pfi-run-item-top">
                <span className="pfi-status-pill" style={{ background: pill.bg, color: pill.text }}>
                  {pill.label}
                </span>
                <span className="pfi-run-time">{formatTimestamp(run.startedAt)}</span>
              </div>
              <div className="pfi-run-item-mid">{run.correlationId}</div>
              <div className="pfi-run-item-bottom">
                {run.vertical || 'unknown vertical'}
                {run.hopCount ? ` · ${run.hopCount} hop${run.hopCount === 1 ? '' : 's'}` : ''}
              </div>
            </button>
          );
        })}
  ```

  Edit 4 — replace the static middle placeholder with the real timeline:

  ```jsx
  // old
    const middle = (
      <div className="inspector-shell-form-empty">Select a run from the list to inspect it.</div>
    );
  ```
  ```jsx
  // new
    const middle = !selectedId ? (
      <div className="inspector-shell-form-empty">Select a run from the list to inspect it.</div>
    ) : runDetail === null ? (
      <div className="inspector-shell-form-empty">Loading run…</div>
    ) : detailError ? (
      <div className="inspector-shell-form-empty">{detailError}</div>
    ) : hops.length === 0 ? (
      <div className="inspector-shell-form-empty">This run has no recorded hops.</div>
    ) : (
      <div className="pfi-timeline">
        {hops.map((hop, i) => {
          const layer = LAYER_META[layerForHop(hop)];
          const active = i === selectedHopIndex;
          return (
            <button
              type="button"
              key={`${hop.phase}-${hop.seq ?? i}`}
              className={`pfi-timeline-item${active ? ' pfi-timeline-item--active' : ''}`}
              style={{ borderLeftColor: layer.color }}
              onClick={() => setSelectedHopIndex(i)}
            >
              <span className="pfi-timeline-spine-dot" style={{ background: layer.color }} />
              <div className="pfi-timeline-item-body">
                <div className="pfi-timeline-item-top">
                  <span className="pfi-layer-badge" style={{ background: layer.bg, color: layer.text }}>
                    {layer.label}
                  </span>
                  <span className="pfi-timeline-phase">{hop.phase}</span>
                  <span className={`pfi-hop-status pfi-hop-status--${hop.status || 'unknown'}`}>
                    {hop.status || 'unknown'}
                  </span>
                </div>
                <div className="pfi-timeline-item-bottom">
                  {hop.service || 'unknown service'}
                  {hop.durationMs != null ? ` · ${hop.durationMs}ms` : ''}
                  {hop.decision?.outcome && hop.decision.outcome !== 'n/a' ? ` · ${hop.decision.outcome}` : ''}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    );
  ```

  Append to `demo_api_ui/src/pages/PromptFlowInspector.css`:

  ```css
  .pfi-timeline {
    position: relative;
    padding: 16px 20px 16px 28px;
  }
  .pfi-timeline::before {
    content: '';
    position: absolute;
    left: 33px;
    top: 20px;
    bottom: 20px;
    width: 2px;
    background: #cbd5e1;
  }
  .pfi-timeline-item {
    position: relative;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    width: 100%;
    text-align: left;
    padding: 10px 12px;
    margin-bottom: 8px;
    border: 1px solid #e2e8f0;
    border-left-width: 4px;
    border-left-style: solid;
    border-radius: 6px;
    background: #ffffff;
    cursor: pointer;
  }
  .pfi-timeline-item:hover { background: #f1f5f9; }
  .pfi-timeline-item--active { box-shadow: 0 0 0 2px #2563eb inset; }
  .pfi-timeline-spine-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
    margin-top: 3px;
  }
  .pfi-timeline-item-body { flex: 1; min-width: 0; }
  .pfi-timeline-item-top {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }
  .pfi-layer-badge {
    font-size: 10px;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 4px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .pfi-timeline-phase {
    font-family: 'SF Mono', SFMono-Regular, monospace;
    font-size: 12px;
    color: #1e293b;
    font-weight: 600;
  }
  .pfi-hop-status {
    margin-left: auto;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
  }
  .pfi-hop-status--ok { color: #166534; }
  .pfi-hop-status--error { color: #991b1b; }
  .pfi-hop-status--unknown { color: #64748b; }
  .pfi-timeline-item-bottom { font-size: 11px; color: #64748b; }
  ```

- [ ] **Step 4: Run test to verify it passes**

  ```
  cd demo_api_ui && npx vitest run src/pages/__tests__/PromptFlowInspector.test.jsx
  ```

  Expected: `Test Files  1 passed (1)` / `Tests  7 passed (7)`.

- [ ] **Step 5: Commit**

  ```
  git add demo_api_ui/src/pages/PromptFlowInspector.jsx demo_api_ui/src/pages/PromptFlowInspector.css demo_api_ui/src/pages/__tests__/PromptFlowInspector.test.jsx
  git commit -m "$(cat <<'EOF'
  Add layer-color-striped hop timeline (middle column) to PromptFlowInspector

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 4: Detail panel (right column) — Details / Raw JSON tabs + redaction marking

**Files:**
- Modify: `demo_api_ui/src/pages/PromptFlowInspector.jsx` (Task 3's file)
- Modify: `demo_api_ui/src/pages/PromptFlowInspector.css` (append)
- Modify: `demo_api_ui/src/pages/__tests__/PromptFlowInspector.test.jsx` (append)

**Interfaces:**
- Consumes: the same `runDetail`/`hops`/`selectedHopIndex` state from Task 3 — no new network calls.
- Produces: `InspectorTabs` with `Details` (default) and `Raw JSON` tabs in the right column. Details shows the selected hop's `phase`/`service`/`status` plus every key in `hop.details`; any key in `{'content', 'promptRedacted', 'completionRedacted'}` (the fields the design spec §3 guarantees are pre-redacted before reaching the UI) renders a `REDACTED` badge next to its label. Raw JSON renders the full `runDetail` response via the shared `JsonHighlight` component, matching `UnifiedTokenFlowInspector.jsx`'s existing raw-tab convention (`<pre className="inspector-shell-output-code"><JsonHighlight value={...} /></pre>`).

- [ ] **Step 1: Write the failing test**

  Append to `demo_api_ui/src/pages/__tests__/PromptFlowInspector.test.jsx` (after the `describe('PromptFlowInspector — timeline', ...)` block):

  ```jsx
  describe('PromptFlowInspector — detail panel', () => {
    beforeEach(() => {
      apiClient.get.mockImplementation((url) => {
        if (url === '/api/prompt-flow') return Promise.resolve({ data: { runs: RUNS } });
        return Promise.resolve({ data: { correlationId: 'corr_2', hops: HOPS } });
      });
    });

    it('defaults to the Details tab, showing the first hop with its redacted fields flagged', async () => {
      render(<PromptFlowInspector />);
      await waitFor(() => expect(screen.getByText('agent.step')).toBeInTheDocument());
      expect(screen.getByText('Phase')).toBeInTheDocument();
      expect(screen.getByText('content')).toBeInTheDocument();
      expect(screen.getByText('REDACTED')).toBeInTheDocument();
    });

    it('clicking a different hop on the timeline updates the Details tab', async () => {
      render(<PromptFlowInspector />);
      await waitFor(() => expect(screen.getByText('llm.call')).toBeInTheDocument());
      fireEvent.click(screen.getByText('llm.call'));
      expect(screen.getByText('promptRedacted')).toBeInTheDocument();
      expect(screen.getByText('completionRedacted')).toBeInTheDocument();
    });

    it('the Raw JSON tab shows the full ledger response for the run', async () => {
      render(<PromptFlowInspector />);
      await waitFor(() => expect(screen.getByText('agent.step')).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: 'Raw JSON' }));
      expect(screen.getByText(/"correlationId"/)).toBeInTheDocument();
      expect(screen.getByText(/"backend.request"/)).toBeInTheDocument();
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```
  cd demo_api_ui && npx vitest run src/pages/__tests__/PromptFlowInspector.test.jsx
  ```

  Expected: the 3 new tests in `PromptFlowInspector — detail panel` fail — `Unable to find an element with the text: Phase` — because the right column is still Task 2's static placeholder with no tabs.

- [ ] **Step 3: Write minimal implementation**

  In `demo_api_ui/src/pages/PromptFlowInspector.jsx`, apply these edits:

  Edit 1 — import `InspectorTabs`/`JsonHighlight` and add the tab/redaction constants:

  ```js
  // old
  import InspectorShell from '../components/shared/InspectorShell';
  import { LAYER_META, layerForHop, statusPillMeta } from '../utils/promptFlowLayers';
  import './PromptFlowInspector.css';

  const PAGE_TITLE = 'Prompt Flow Inspector';
  ```
  ```js
  // new
  import InspectorShell from '../components/shared/InspectorShell';
  import InspectorTabs from '../components/shared/InspectorTabs';
  import JsonHighlight from '../components/shared/JsonHighlight';
  import { LAYER_META, layerForHop, statusPillMeta } from '../utils/promptFlowLayers';
  import './PromptFlowInspector.css';

  const PAGE_TITLE = 'Prompt Flow Inspector';
  const RIGHT_TABS = [
    { key: 'details', label: 'Details' },
    { key: 'raw', label: 'Raw JSON' },
  ];
  // Fields the backend has already redacted before this reaches the UI
  // (docs/superpowers/specs/2026-08-16-prompt-flow-inspector-design.md §3) —
  // always flagged in the Details tab regardless of content.
  const REDACTED_FIELD_KEYS = new Set(['content', 'promptRedacted', 'completionRedacted']);
  ```

  Edit 2 — derive the selected hop and add tab state:

  ```js
  // old
    const hops = runDetail?.hops || [];

    const left = (
  ```
  ```js
  // new
    const hops = runDetail?.hops || [];
    const selectedHop = hops[selectedHopIndex] || null;
    const [activeTab, setActiveTab] = useState('details');

    const left = (
  ```

  Edit 3 — replace the static right placeholder with the real tabbed panel:

  ```jsx
  // old
    const right = (
      <div className="inspector-shell-output-empty">Select a run to see its details.</div>
    );
  ```
  ```jsx
  // new
    const right = (
      <>
        <InspectorTabs tabs={RIGHT_TABS} activeKey={activeTab} onChange={setActiveTab} />
        <div className="inspector-shell-output-body">
          {activeTab === 'details' && (
            selectedHop ? (
              <div className="pfi-details">
                <div className="inspector-shell-field">
                  <label>Phase</label>
                  <div>{selectedHop.phase}</div>
                </div>
                <div className="inspector-shell-field">
                  <label>Service</label>
                  <div>{selectedHop.service || '—'}</div>
                </div>
                <div className="inspector-shell-field">
                  <label>Status</label>
                  <div>{selectedHop.status || '—'}</div>
                </div>
                {selectedHop.details && typeof selectedHop.details === 'object' ? (
                  Object.entries(selectedHop.details).map(([key, value]) => (
                    <div className="inspector-shell-field" key={key}>
                      <label>
                        {key}
                        {REDACTED_FIELD_KEYS.has(key) && (
                          <span className="pfi-redacted-badge">REDACTED</span>
                        )}
                      </label>
                      <div>
                        {typeof value === 'object' && value !== null ? (
                          <JsonHighlight value={value} />
                        ) : (
                          String(value)
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="inspector-shell-form-empty">No detail captured for this hop.</div>
                )}
              </div>
            ) : (
              <div className="inspector-shell-output-empty">Select a hop on the timeline to inspect it.</div>
            )
          )}
          {activeTab === 'raw' && (
            <pre className="inspector-shell-output-code">
              {runDetail ? <JsonHighlight value={runDetail} /> : 'Nothing loaded yet.'}
            </pre>
          )}
        </div>
      </>
    );
  ```

  Append to `demo_api_ui/src/pages/PromptFlowInspector.css`:

  ```css
  .pfi-details { padding-bottom: 8px; }
  .pfi-redacted-badge {
    display: inline-block;
    margin-left: 6px;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.04em;
    background: #fee2e2;
    color: #991b1b;
    vertical-align: middle;
  }
  ```

- [ ] **Step 4: Run test to verify it passes**

  ```
  cd demo_api_ui && npx vitest run src/pages/__tests__/PromptFlowInspector.test.jsx
  ```

  Expected: `Test Files  1 passed (1)` / `Tests  10 passed (10)`.

- [ ] **Step 5: Commit**

  ```
  git add demo_api_ui/src/pages/PromptFlowInspector.jsx demo_api_ui/src/pages/PromptFlowInspector.css demo_api_ui/src/pages/__tests__/PromptFlowInspector.test.jsx
  git commit -m "$(cat <<'EOF'
  Add Details/Raw JSON tabs with redaction marking to PromptFlowInspector

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 5: Route wiring — `PromptFlowInspectorRoute`

**Files:**
- Modify: `demo_api_ui/src/routes/MonitoringRoutes.js`
- Modify: `demo_api_ui/src/App.js`
- Modify: `demo_api_ui/src/__tests__/App.structure.test.js`

**Interfaces:**
- Consumes: `PromptFlowInspector` from Task 2–4.
- Produces: `PromptFlowInspectorRoute({ user })` exported from `MonitoringRoutes.js`, mounted at `/prompt-flow-inspector` in `App.js` — same guest-redirect pattern as `AgentFlowInspectorRoute` (`if (!user) return <Navigate to="/" replace />`), same "no nested AppShell" comment (the catch-all route tree already supplies chrome).

- [ ] **Step 1: Write the failing test**

  In `demo_api_ui/src/__tests__/App.structure.test.js`, apply these edits:

  Edit 1 — inside `describe("MonitoringRoutes.js — critical imports", ...)`, add a test right after the existing `"AgentFlowInspectorRoute does not wrap AppShell"` test:

  ```js
  // old
    test("AgentFlowInspectorRoute does not wrap AppShell", () => {
      const fn = src.match(
        /export function AgentFlowInspectorRoute[\s\S]*?\n\}/
      )?.[0];
      expect(fn).toBeTruthy();
      expect(fn).toContain("UnifiedTokenFlowInspector");
      expect(fn).not.toContain("AppShell");
    });

    test("no stale banking_api_ui paths", () => {
  ```
  ```js
  // new
    test("AgentFlowInspectorRoute does not wrap AppShell", () => {
      const fn = src.match(
        /export function AgentFlowInspectorRoute[\s\S]*?\n\}/
      )?.[0];
      expect(fn).toBeTruthy();
      expect(fn).toContain("UnifiedTokenFlowInspector");
      expect(fn).not.toContain("AppShell");
    });

    test("PromptFlowInspectorRoute redirects guests like AgentFlowInspectorRoute", () => {
      const fn = src.match(
        /export function PromptFlowInspectorRoute[\s\S]*?\n\}/
      )?.[0];
      expect(fn).toBeTruthy();
      expect(fn).toContain('Navigate to="/" replace');
      expect(fn).toContain("PromptFlowInspector");
    });

    test("no stale banking_api_ui paths", () => {
  ```

  Edit 2 — inside `describe("App.js — critical JSX placements", ...)`, add a test right after `"EmbeddedAgentDock is rendered at App level"`:

  ```js
  // old
    test("EmbeddedAgentDock is rendered at App level", () => {
      expect(appSrc).toContain("<EmbeddedAgentDock");
    });
  ```
  ```js
  // new
    test("EmbeddedAgentDock is rendered at App level", () => {
      expect(appSrc).toContain("<EmbeddedAgentDock");
    });

    test("/prompt-flow-inspector route mounts PromptFlowInspectorRoute", () => {
      expect(appSrc).toContain('path="/prompt-flow-inspector"');
      expect(appSrc).toContain("<PromptFlowInspectorRoute");
    });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```
  cd demo_api_ui && npx vitest run src/__tests__/App.structure.test.js
  ```

  Expected: the 2 new tests fail — `expect(fn).toBeTruthy()` fails with `fn` = `undefined` (no `PromptFlowInspectorRoute` export yet), and `expect(appSrc).toContain('path="/prompt-flow-inspector"')` fails (route not yet registered).

- [ ] **Step 3: Write minimal implementation**

  In `demo_api_ui/src/routes/MonitoringRoutes.js`, apply these edits:

  Edit 1 — import the new page:

  ```js
  // old
  import AgentFlowHistoryPage from "../pages/AgentFlowHistoryPage";
  ```
  ```js
  // new
  import AgentFlowHistoryPage from "../pages/AgentFlowHistoryPage";
  import PromptFlowInspector from "../pages/PromptFlowInspector";
  ```

  Edit 2 — add the route wrapper right after `AgentFlowInspectorRoute`:

  ```jsx
  // old
  export function AgentFlowInspectorRoute({ user }) {
    if (!user) return <Navigate to="/" replace />;
    // Mounted under App.js catch-all which already supplies TopNav + main-content
    // (+ side nav). Do not nest another shell — a second .main-content also got
    // the sidebar width offset and left empty space on the right.
    // History view — UnifiedTokenFlowInspector (live execution) stays reachable
    // as a floating overlay via DevToolsRoute; this page reviews past runs.
    return <AgentFlowHistoryPage />;
  }
  ```
  ```jsx
  // new
  export function AgentFlowInspectorRoute({ user }) {
    if (!user) return <Navigate to="/" replace />;
    // Mounted under App.js catch-all which already supplies TopNav + main-content
    // (+ side nav). Do not nest another shell — a second .main-content also got
    // the sidebar width offset and left empty space on the right.
    // History view — UnifiedTokenFlowInspector (live execution) stays reachable
    // as a floating overlay via DevToolsRoute; this page reviews past runs.
    return <AgentFlowHistoryPage />;
  }

  export function PromptFlowInspectorRoute({ user }) {
    if (!user) return <Navigate to="/" replace />;
    // Same catch-all-supplies-chrome pattern as AgentFlowInspectorRoute above —
    // PromptFlowInspector renders its own InspectorShell, not AppShell.
    return <PromptFlowInspector />;
  }
  ```

  In `demo_api_ui/src/App.js`, apply these edits:

  Edit 1 — add the import:

  ```js
  // old
  import MonitoringRoutes, {
    AgentFlowInspectorRoute,
    ApiTrafficRoute,
    LogsRoute,
    McpTrafficRoute,
    NewRelicRoute,
    P1AzRoute,
    PingOneEventsRoute,
    SequenceDiagramRoute,
    TokenExchangeRoute,
  } from "./routes/MonitoringRoutes";
  ```
  ```js
  // new
  import MonitoringRoutes, {
    AgentFlowInspectorRoute,
    ApiTrafficRoute,
    LogsRoute,
    McpTrafficRoute,
    NewRelicRoute,
    P1AzRoute,
    PingOneEventsRoute,
    PromptFlowInspectorRoute,
    SequenceDiagramRoute,
    TokenExchangeRoute,
  } from "./routes/MonitoringRoutes";
  ```

  Edit 2 — register the route right after `/agent-flow-inspector`:

  ```jsx
  // old
                              <Route
                                path="/agent-flow-inspector"
                                element={
                                  <AgentFlowInspectorRoute
                                    user={user}
                                    logout={logout}
                                  />
                                }
                              />
  ```
  ```jsx
  // new
                              <Route
                                path="/agent-flow-inspector"
                                element={
                                  <AgentFlowInspectorRoute
                                    user={user}
                                    logout={logout}
                                  />
                                }
                              />
                              <Route
                                path="/prompt-flow-inspector"
                                element={
                                  <PromptFlowInspectorRoute
                                    user={user}
                                    logout={logout}
                                  />
                                }
                              />
  ```

- [ ] **Step 4: Run test to verify it passes**

  ```
  cd demo_api_ui && npx vitest run src/__tests__/App.structure.test.js
  ```

  Expected: all tests in the file pass, including the 2 new ones.

- [ ] **Step 5: Commit**

  ```
  git add demo_api_ui/src/routes/MonitoringRoutes.js demo_api_ui/src/App.js demo_api_ui/src/__tests__/App.structure.test.js
  git commit -m "$(cat <<'EOF'
  Wire /prompt-flow-inspector route with guest-redirect gating

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

### Task 6: Nav wiring — "Inspectors" group entry

**Files:**
- Modify: `demo_api_ui/src/components/AdminSideNav.jsx`
- Modify: `demo_api_ui/src/config/navStructureCatalog.js`
- Modify: `demo_api_ui/src/config/__tests__/navStructureCatalog.test.js`
- Create: `demo_api_ui/src/components/__tests__/AdminSideNav.promptFlow.test.jsx`

**Interfaces:**
- Consumes: the `/prompt-flow-inspector` route from Task 5.
- Produces: a "Prompt Flow Inspector" entry visible in the sidebar's "Inspectors" group, alongside "MCP Inspector" / "Agent Gateway Inspector" / "P1AZ Inspector", auto-expanding that group when the route is active.

- [ ] **Step 1: Write the failing test**

  In `demo_api_ui/src/config/__tests__/navStructureCatalog.test.js`, apply this edit:

  ```js
  // old
  import { applyChildOrder } from "../navStructureCatalog";
  ```
  ```js
  // new
  import { applyChildOrder, NAV_STRUCTURE_CATALOG } from "../navStructureCatalog";
  ```

  Then append at the end of the file:

  ```js
  describe("NAV_STRUCTURE_CATALOG — Inspectors group", () => {
    it("lists Prompt Flow Inspector beside the other inspectors", () => {
      const inspectors = NAV_STRUCTURE_CATALOG.find((g) => g.label === "Inspectors");
      expect(inspectors.children).toContain("Prompt Flow Inspector");
    });
  });
  ```

  Create `demo_api_ui/src/components/__tests__/AdminSideNav.promptFlow.test.jsx` (mirrors the existing `AdminSideNav.telemetry.test.jsx` convention exactly):

  ```jsx
  import { render, screen } from "@testing-library/react";
  import { MemoryRouter } from "react-router-dom";
  import { describe, expect, it, vi } from "vitest";

  // AdminSideNav pulls in several contexts/services; mock them to their minimal
  // used shape so we can render the nav in isolation. Same convention as
  // adminSideNav.test.jsx / AdminSideNav.telemetry.test.jsx in this directory.
  vi.mock("../../context/AgentUiModeContext", () => ({
    useAgentUiMode: () => ({ placement: "none", fab: false, setAgentUi: vi.fn() }),
  }));
  vi.mock("../../context/EducationUIContext", () => ({
    useEducationUI: () => ({ open: vi.fn() }),
  }));
  vi.mock("../../vertical/useVertical", () => ({
    useVertical: () => ({ activeId: "banking" }),
  }));
  vi.mock("../../services/demoScenarioService", () => ({ persistAgentUi: vi.fn() }));
  vi.mock("../../services/logout", () => ({ performLogout: vi.fn() }));
  vi.mock("../../utils/authUi", () => ({ requestSilentReauth: vi.fn() }));
  vi.mock("../../utils/dashboardLayout", () => ({ setDashboardLayout: vi.fn() }));
  vi.mock("../../utils/roleSwitch", () => ({ startRoleSwitch: vi.fn() }));
  vi.mock("../ConfirmModal", () => ({ default: () => null }));
  vi.mock("../ControlPlaneIntroModal", () => ({ default: () => null }));
  vi.mock("../KillSwitchConfirmModal", () => ({ default: () => null }));

  import AdminSideNav from "../AdminSideNav";

  beforeEach(() => {
    try { window.localStorage.setItem("adminSideNav.collapsed", "false"); } catch { /* jsdom always has it */ }
  });

  window.matchMedia =
    window.matchMedia ||
    (() => ({
      matches: false,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
    }));

  function renderAt(path) {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <AdminSideNav user={{ id: "4", username: "demoAdmin", role: "admin" }} />
      </MemoryRouter>,
    );
  }

  describe("AdminSideNav Inspectors group", () => {
    it("lists Prompt Flow Inspector beside MCP Inspector and P1AZ Inspector", async () => {
      renderAt("/prompt-flow-inspector");
      expect(await screen.findByText("Prompt Flow Inspector")).toBeInTheDocument();
      expect(screen.getByText("MCP Inspector")).toBeInTheDocument();
      expect(screen.getByText("P1AZ Inspector")).toBeInTheDocument();
    });

    it("links Prompt Flow Inspector to /prompt-flow-inspector", async () => {
      renderAt("/prompt-flow-inspector");
      const link = (await screen.findByText("Prompt Flow Inspector")).closest("a");
      expect(link.getAttribute("href")).toBe("/prompt-flow-inspector");
    });

    it("auto-expands Inspectors when the route is /prompt-flow-inspector", async () => {
      renderAt("/prompt-flow-inspector");
      expect(await screen.findByText("Prompt Flow Inspector")).toBeVisible();
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  ```
  cd demo_api_ui && npx vitest run src/config/__tests__/navStructureCatalog.test.js src/components/__tests__/AdminSideNav.promptFlow.test.jsx
  ```

  Expected: the `navStructureCatalog` test fails (`inspectors.children` doesn't contain `"Prompt Flow Inspector"`), and all 3 `AdminSideNav.promptFlow.test.jsx` tests fail — `Unable to find an element with the text: Prompt Flow Inspector`.

- [ ] **Step 3: Write minimal implementation**

  In `demo_api_ui/src/components/AdminSideNav.jsx`, apply these edits:

  Edit 1 — add the new path to the "authorize" auto-expand group's neighbor, as its own entry (the "Inspectors" nav group currently has no `AUTO_EXPAND_SECTIONS` id of its own — its other 3 children each auto-expand via a *different* group that also lists their path, e.g. `/pingone-authorize` via `"authorize"`; `/prompt-flow-inspector` isn't cross-listed anywhere else, so it needs its own minimal entry):

  ```js
  // old
    { id: "authorize", paths: ["/pingone-authorize", "/pingone-authorize-capabilities", "/policy-decision-trace", "/authz-test", "/scope-audit", "/scope-reference"] },
  ```
  ```js
  // new
    { id: "authorize", paths: ["/pingone-authorize", "/pingone-authorize-capabilities", "/policy-decision-trace", "/authz-test", "/scope-audit", "/scope-reference"] },
    { id: "inspectors", paths: ["/prompt-flow-inspector"] },
  ```

  Edit 2 — add the nav item to the "Inspectors" group's children:

  ```js
  // old
      {
        label: "Inspectors",
        icon: "dbg",
        children: [
          { label: "MCP Inspector", path: "/pingone-mcp-inspector", icon: "dbg" },
          { label: "Agent Gateway Inspector", path: "/agent-gateway-inspector", icon: "rte" },
          { label: "P1AZ Inspector", path: "/pingone-authorize", icon: "pol", searchAlias: "PingOne Authorize" },
        ],
      },
  ```
  ```js
  // new
      {
        label: "Inspectors",
        icon: "dbg",
        children: [
          { label: "MCP Inspector", path: "/pingone-mcp-inspector", icon: "dbg" },
          { label: "Agent Gateway Inspector", path: "/agent-gateway-inspector", icon: "rte" },
          { label: "P1AZ Inspector", path: "/pingone-authorize", icon: "pol", searchAlias: "PingOne Authorize" },
          { label: "Prompt Flow Inspector", path: "/prompt-flow-inspector", icon: "flw" },
        ],
      },
  ```

  In `demo_api_ui/src/config/navStructureCatalog.js`, apply this edit:

  ```js
  // old
    {
      label: "Inspectors",
      children: ["MCP Inspector", "Agent Gateway Inspector", "P1AZ Inspector"],
    },
  ```
  ```js
  // new
    {
      label: "Inspectors",
      children: ["MCP Inspector", "Agent Gateway Inspector", "P1AZ Inspector", "Prompt Flow Inspector"],
    },
  ```

- [ ] **Step 4: Run test to verify it passes**

  ```
  cd demo_api_ui && npx vitest run src/config/__tests__/navStructureCatalog.test.js src/components/__tests__/AdminSideNav.promptFlow.test.jsx
  ```

  Expected: `Test Files  2 passed (2)` / all tests passing.

- [ ] **Step 5: Commit**

  ```
  git add demo_api_ui/src/components/AdminSideNav.jsx demo_api_ui/src/config/navStructureCatalog.js demo_api_ui/src/config/__tests__/navStructureCatalog.test.js demo_api_ui/src/components/__tests__/AdminSideNav.promptFlow.test.jsx
  git commit -m "$(cat <<'EOF'
  Add Prompt Flow Inspector nav entry under Inspectors group

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Final verification (after Task 6)

Per `demo_api_ui/CLAUDE.md` and `REGRESSION_PLAN.md` §0's UI build gate — run the full suite and the build, not just the scoped tests above:

```
cd demo_api_ui && npm run test:unit && npm run build
```

Both must exit `0` before this feature is considered done.

## Self-Review

- **Spec §5 coverage:** Left run list, manual refresh, no live tail (Task 2) ✓. Center ordered layer-color-striped timeline covering all 5 layers — Agent/LLM/Gateway/P1AZ/Backend (Task 3) ✓. Right Details tab (full hop `details`, redaction clearly marked via `REDACTED` badges on `content`/`promptRedacted`/`completionRedacted`) and Raw JSON tab (full ledger response) (Task 4) ✓. New route gated like `AgentFlowInspectorRoute`'s guest redirect, page-level admin gating matching `PolicyDecisionTracePage`'s pattern of ungated route + admin-session-gated backing data (Task 5) ✓. Nav entry under the existing "Inspectors" group in both `AdminSideNav.jsx` and `navStructureCatalog.js` (Task 6) ✓.
- **No placeholders:** every task's Step 3 is complete, real JSX/CSS/JS — no `TBD`, no `// add appropriate error handling`, no test described-but-unwritten. Each task's tests are fully written runnable vitest/RTL code.
- **Naming consistency:** page-owned CSS/class prefix is `pfi-` throughout (`.pfi-run-item`, `.pfi-timeline`, `.pfi-status-pill`, `.pfi-redacted-badge`), matching the established per-page prefix convention already used by `AgentFlowHistoryPage.css` (`afh-`) and `UnifiedTokenFlowInspector.css` (`utfi-`). Component name `PromptFlowInspector`, route name `PromptFlowInspectorRoute`, utility module `promptFlowLayers.js` — all trace directly to the spec's own naming (`PromptFlowInspector.jsx`, `GET /api/prompt-flow`).
- **REGRESSION_PLAN.md §0 compliance:** no emoji used anywhere in this feature's code or copy (status/redaction indicators are plain text: `OK`, `DENY`, `STEP-UP`, `REDACTED`) — allowlist not needed, nothing to check against it. No modals introduced, so the DraggableModal-only rule doesn't apply. Colors are hardcoded hex literals consistent with `InspectorShell.css`/`UnifiedTokenFlowInspector.jsx`'s established convention, not invented ad hoc (each new color is documented against where its sibling hex value already exists in the codebase, or as a same-family Tailwind-palette extension).
- **Scope discipline:** all 6 tasks touch only `demo_api_ui/`. No backend/gateway/P1AZ/LLM-proxy/agent files were read for anything beyond confirming the existing hop-record shape (read-only research, cited in Task 1's Interfaces) — no sibling-plan files are modified.
