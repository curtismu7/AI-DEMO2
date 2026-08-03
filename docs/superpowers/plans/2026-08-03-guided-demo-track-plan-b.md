# Guided Demo Track — Plan B: Standalone Page + Run History

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The standalone "Guided Demo Track" presenter page (side-nav surface 1 of the spec) with progress dots, act banners, expandable step cards, gauntlet grid, takeaway cards, run history picker, and a finish summary — plus the "Open full track page ↗" footer link on the existing Token Chain tab.

**Architecture:** Pure UI over the Plan A API — zero server changes. `DemoTrackPage.jsx` (route `/demo-track`) polls `GET /api/demo-track` every 5s for the live run, fetches `GET /api/demo-track/runs` for history, and renders either the active run (live) or a selected historical run (static snapshot). Slot/gauntlet rendering logic mirrors `TokenChainDemoTrackTab.jsx`; layout/copy mirrors the approved mock `docs/superpowers/specs/assets/2026-08-03-guided-demo-track/demo-track-mock.html`.

**Tech Stack:** React 19 + Vite 8, vitest (NOT jest), plain JSX, CSS file per page. HTTP via `services/apiClient` (UI convention — the tab's raw `fetch` predates this plan; do not copy it).

**Spec:** `docs/superpowers/specs/2026-08-03-guided-demo-track-design.md` §"Standalone page". Plan A (merged, PR #1319) provides the whole API surface:
- `GET /api/demo-track` → `{ track: { steps, gauntletSims }, run }`
- `GET /api/demo-track/runs` → `{ runs: [run, …] }` (newest first, each with `endedAt`)
- `POST /api/demo-track/runs` → `{ run }` (archives current, starts fresh)
- `POST /api/demo-track/active-step` body `{ stepId }` → `{ run }`

Run shape: `{ runId, startedAt, activeStepId, slots: { "<stepId>:green"|"<stepId>:red": { verdict, decisionId, via, at } }, gauntlet: { [sim]: { blocked, status, errorCode, decisionId, at } } }`.
Step shape (from `demo_api_server/config/demoTrack.js`): `{ stepId, act, title, capability, ucIds, buyerStory, slots: { green?, red? }, proved: { green, red, sayThis } }`; slot: `{ source, chipText?|label?, match, expected }`. Gauntlet sim: `{ sim, ucId, label }`.

## Global Constraints

- Emoji allowlist (REGRESSION_PLAN §0): only `⚠️ ✅ ❌ 🔐 ✕ ✓ 👤 🔑 🪟 📚` — this plan uses `✓` and `✕` only. `▸ ▾ ↗` are text glyphs already used across the UI (AuditPage, HistoryModal) and are allowed.
- Worktree branch `worktree-demo-track-page`; stage explicitly (`git add <file>`), never `git add -A`.
- UI tests: `cd demo_api_ui && npx vitest run <file>` — vitest, never jest.
- HTTP via `import apiClient from "../services/apiClient"` — no raw `fetch`/`axios` in the new page.
- No server changes. No changes to auth/session code. `TokenChainDemoTrackTab.jsx` gets ONE additive footer link only.
- No new modals (page surface only — DraggableModal rule not triggered).

---

### Task 1: DemoTrackPage component + CSS

**Files:**
- Create: `demo_api_ui/src/pages/DemoTrackPage.jsx`
- Create: `demo_api_ui/src/pages/DemoTrackPage.css`
- Test: `demo_api_ui/src/pages/__tests__/DemoTrackPage.test.jsx`

**Interfaces:**
- Consumes: `apiClient.get('/api/demo-track')`, `apiClient.get('/api/demo-track/runs')`, `apiClient.post('/api/demo-track/runs')`, `apiClient.post('/api/demo-track/active-step', { stepId })`.
- Produces: default export `DemoTrackPage` (no props) — Task 2 imports it in `App.js`.

- [ ] **Step 1: Write the failing test**

`demo_api_ui/src/pages/__tests__/DemoTrackPage.test.jsx`:

```jsx
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import DemoTrackPage from "../DemoTrackPage";
import apiClient from "../../services/apiClient";

vi.mock("../../services/apiClient", () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

const STEP = (stepId, act, title, extra = {}) => ({
  stepId, act, title,
  capability: "cap", ucIds: ["UC1"],
  buyerStory: "story",
  slots: {
    green: { source: "tool", chipText: "green chip", match: { tools: ["t"] }, expected: ["PERMIT"] },
    red: { source: "tool", chipText: "red chip", match: { tools: ["t"] }, expected: ["DENY"] },
  },
  proved: { green: "green proved", red: "red proved", sayThis: "say this line" },
  ...extra,
});

const TRACK = {
  steps: [
    STEP("delegated-access", 1, "Delegated access"),
    STEP("attack-gauntlet", 1, "Attack gauntlet", {
      slots: { red: { source: "sim", label: "six attacks", match: { sims: ["s1", "s2"] }, expected: ["BLOCKED"] } },
      proved: { green: null, red: "gauntlet proved", sayThis: "attack line" },
    }),
    STEP("pingone-mcp-admin", 2, "PingOne MCP admin"),
  ],
  gauntletSims: [
    { sim: "s1", ucId: "UC5", label: "Wrong scope" },
    { sim: "s2", ucId: "UC10", label: "Cross-owner" },
  ],
};

const ACTIVE_RUN = {
  runId: "run-1", startedAt: "2026-08-03T10:00:00Z", activeStepId: "delegated-access",
  slots: { "delegated-access:green": { verdict: "PERMIT", decisionId: null, via: "t", at: "2026-08-03T10:01:00Z" } },
  gauntlet: { s1: { blocked: true, status: 403, errorCode: null, decisionId: "d-1", at: "2026-08-03T10:02:00Z" } },
};

const OLD_RUN = {
  runId: "run-0", startedAt: "2026-08-02T09:00:00Z", endedAt: "2026-08-02T10:00:00Z",
  activeStepId: "pingone-mcp-admin",
  slots: {
    "delegated-access:green": { verdict: "PERMIT", decisionId: null, via: "t", at: "2026-08-02T09:10:00Z" },
    "delegated-access:red": { verdict: "DENY", decisionId: "d-9", via: "t", at: "2026-08-02T09:11:00Z" },
  },
  gauntlet: {},
};

function mockApi() {
  apiClient.get.mockImplementation((url) => {
    if (url === "/api/demo-track") return Promise.resolve({ data: { track: TRACK, run: ACTIVE_RUN } });
    if (url === "/api/demo-track/runs") return Promise.resolve({ data: { runs: [OLD_RUN] } });
    return Promise.reject(new Error(`unexpected ${url}`));
  });
  apiClient.post.mockResolvedValue({ data: {} });
}

describe("DemoTrackPage", () => {
  beforeEach(() => { vi.clearAllMocks(); mockApi(); });

  it("renders acts, steps, progress dots and the filled slot from the live run", async () => {
    render(<DemoTrackPage />);
    expect(await screen.findByText("ACT 1 — THE CUSTOMER AGENT")).toBeInTheDocument();
    expect(screen.getByText("ACT 2 — SAME RAILS GOVERN THE ADMINS")).toBeInTheDocument();
    expect(screen.getByText("Delegated access")).toBeInTheDocument();
    // active step is expanded: buyer story + green verdict stamp visible
    expect(screen.getAllByText(/story/).length).toBeGreaterThan(0);
    expect(screen.getByText(/PERMIT/)).toBeInTheDocument();
    // gauntlet score 1/2 from run.gauntlet
    expect(screen.getByText(/1 \/ 2 blocked/)).toBeInTheDocument();
  });

  it("expands a step on click and shows its takeaway when both slots filled (history run)", async () => {
    render(<DemoTrackPage />);
    await screen.findByText("Delegated access");
    // switch to the previous run via the history picker
    fireEvent.change(screen.getByLabelText("Run"), { target: { value: "run-0" } });
    await waitFor(() => expect(screen.getByText("WHAT THIS PROVED")).toBeInTheDocument());
    expect(screen.getByText("green proved")).toBeInTheDocument();
    expect(screen.getByText("red proved")).toBeInTheDocument();
    expect(screen.getByText(/say this line/)).toBeInTheDocument();
    // viewing history: mutation controls hidden
    expect(screen.queryByText("Start new run")).not.toBeInTheDocument();
  });

  it("starts a new run via POST and re-polls", async () => {
    render(<DemoTrackPage />);
    await screen.findByText("Delegated access");
    fireEvent.click(screen.getByText("Start new run"));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/api/demo-track/runs"));
  });

  it("sets the active step when a step header is clicked on the live run", async () => {
    render(<DemoTrackPage />);
    await screen.findByText("PingOne MCP admin");
    fireEvent.click(screen.getByText("PingOne MCP admin"));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/api/demo-track/active-step", { stepId: "pingone-mcp-admin" })
    );
  });

  it("shows the finish summary only when every step is complete", async () => {
    const doneRun = {
      ...OLD_RUN, runId: "run-done",
      slots: {
        "delegated-access:green": OLD_RUN.slots["delegated-access:green"],
        "delegated-access:red": OLD_RUN.slots["delegated-access:red"],
        "pingone-mcp-admin:green": { verdict: "PERMIT", decisionId: null, via: "t", at: "2026-08-02T09:20:00Z" },
        "pingone-mcp-admin:red": { verdict: "DENY", decisionId: "d-8", via: "t", at: "2026-08-02T09:21:00Z" },
      },
      gauntlet: {
        s1: { blocked: true, status: 403, errorCode: null, decisionId: null, at: "2026-08-02T09:30:00Z" },
        s2: { blocked: true, status: 403, errorCode: null, decisionId: null, at: "2026-08-02T09:31:00Z" },
      },
    };
    apiClient.get.mockImplementation((url) => {
      if (url === "/api/demo-track") return Promise.resolve({ data: { track: TRACK, run: ACTIVE_RUN } });
      if (url === "/api/demo-track/runs") return Promise.resolve({ data: { runs: [doneRun] } });
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    render(<DemoTrackPage />);
    await screen.findByText("Delegated access");
    expect(screen.queryByText(/Track complete/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Run"), { target: { value: "run-done" } });
    await waitFor(() => expect(screen.getByText(/Track complete/)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/DemoTrackPage.test.jsx`
Expected: FAIL — `Cannot find module '../DemoTrackPage'`.

- [ ] **Step 3: Write the component**

`demo_api_ui/src/pages/DemoTrackPage.jsx`:

```jsx
// Guided Demo Track — standalone presenter page (spec surface 1).
// Live view polls /api/demo-track; the run picker swaps in an archived
// run from /api/demo-track/runs as a static snapshot (no polling, no mutation).
import React, { useCallback, useEffect, useMemo, useState } from "react";
import apiClient from "../services/apiClient";
import "./DemoTrackPage.css";

const POLL_MS = 5000;
const ACT_META = {
  1: { label: "ACT 1 — THE CUSTOMER AGENT", tagline: "One user, one agent, real money — prove every action is governed." },
  2: { label: "ACT 2 — SAME RAILS GOVERN THE ADMINS", tagline: "The AI that manages your identity platform is itself governed by it." },
};

function fmtTime(iso) {
  return iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
}

function stepComplete(step, run, gauntletSims) {
  if (step.stepId === "attack-gauntlet") {
    return gauntletSims.length > 0 && gauntletSims.every((g) => run.gauntlet?.[g.sim]?.blocked);
  }
  const green = !step.slots.green || run.slots[`${step.stepId}:green`];
  const red = !step.slots.red || run.slots[`${step.stepId}:red`];
  return Boolean(green && red);
}

function SlotRow({ tag, slot, stamp }) {
  const verdictCls =
    stamp && (stamp.verdict === "PERMIT" ? "dtp-verdict--permit" : stamp.verdict === "STEP_UP" ? "dtp-verdict--stepup" : "dtp-verdict--deny");
  return (
    <div className="dtp-run-row">
      <span className={`dtp-run-tag dtp-run-tag--${tag === "GREEN" ? "g" : "r"}`}>{tag}</span>
      <span className="dtp-chip">{slot.chipText || slot.label}</span>
      {stamp ? (
        <span className={`dtp-verdict ${verdictCls}`}>
          {stamp.verdict} {stamp.verdict === "PERMIT" ? "✓" : "✕"} {fmtTime(stamp.at)}
          {stamp.decisionId ? ` · ${stamp.decisionId}` : ""}
        </span>
      ) : (
        <span className="dtp-run-note">waiting for a matching run</span>
      )}
    </div>
  );
}

export default function DemoTrackPage() {
  const [state, setState] = useState(null); // { track, run } (live)
  const [history, setHistory] = useState([]);
  const [viewRunId, setViewRunId] = useState("live");
  const [expanded, setExpanded] = useState(null); // stepId | null — manual expand overlay
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const [stateRes, runsRes] = await Promise.all([
        apiClient.get("/api/demo-track"),
        apiClient.get("/api/demo-track/runs"),
      ]);
      setState(stateRes.data);
      setHistory(runsRes.data.runs || []);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const isLive = viewRunId === "live";
  const run = useMemo(() => {
    if (!state) return null;
    if (isLive) return state.run;
    return history.find((r) => r.runId === viewRunId) || state.run;
  }, [state, history, viewRunId, isLive]);

  const startRun = useCallback(async () => {
    try {
      await apiClient.post("/api/demo-track/runs");
      load();
    } catch { /* next poll recovers */ }
  }, [load]);

  const onStepClick = useCallback(async (stepId) => {
    setExpanded((cur) => (cur === stepId ? null : stepId));
    if (!isLive) return;
    try {
      await apiClient.post("/api/demo-track/active-step", { stepId });
      load();
    } catch { /* next poll recovers */ }
  }, [isLive, load]);

  if (error) return <div className="dtp-error">Demo Track unavailable — {error}</div>;
  if (!state || !run) return <div className="dtp-loading">Loading demo track…</div>;

  const { track } = state;
  const { steps, gauntletSims } = track;
  const gauntletBlocked = gauntletSims.filter((g) => run.gauntlet?.[g.sim]?.blocked).length;
  const allDone = steps.every((s) => stepComplete(s, run, gauntletSims));
  const doneCount = steps.filter((s) => stepComplete(s, run, gauntletSims)).length;

  const renderStep = (step, idx) => {
    const complete = stepComplete(step, run, gauntletSims);
    const isActive = isLive && run.activeStepId === step.stepId;
    const isOpen = expanded ? expanded === step.stepId : isActive;
    const green = run.slots[`${step.stepId}:green`];
    const red = run.slots[`${step.stepId}:red`];
    const isGauntlet = step.stepId === "attack-gauntlet";
    return (
      <div key={step.stepId} className={`dtp-step${complete ? " dtp-step--done" : ""}${isActive ? " dtp-step--active" : ""}`}>
        <button type="button" className="dtp-step-head" onClick={() => onStepClick(step.stepId)}>
          <span className="dtp-step-num">{complete ? "✓" : idx + 1}</span>
          <span className="dtp-step-title">{step.title}</span>
          <span className="dtp-step-cap">{step.capability}</span>
          <span className="dtp-step-ucs">{step.ucIds.join(" · ")}</span>
          {complete && <span className="dtp-step-status">PROVED</span>}
          <span className="dtp-chev">{isOpen ? "▾" : "▸"}</span>
        </button>
        {!isOpen && (
          <div className="dtp-collapsed-note">
            {step.slots.green && <span>✓ {green ? step.proved.green : step.slots.green.chipText}</span>}
            {step.slots.green && step.slots.red && <span> · </span>}
            {step.slots.red && <span>✕ {red ? step.proved.red : step.slots.red.chipText || step.slots.red.label}</span>}
          </div>
        )}
        {isOpen && (
          <div className="dtp-step-body">
            <div className="dtp-buyer-story">{step.buyerStory}</div>
            {isGauntlet ? (
              <>
                <div className="dtp-gauntlet-bar">
                  <span className="dtp-gauntlet-score">{gauntletBlocked} / {gauntletSims.length} blocked</span>
                </div>
                <div className="dtp-gauntlet">
                  {gauntletSims.map((g) => {
                    const tile = run.gauntlet?.[g.sim];
                    return (
                      <div key={g.sim} className="dtp-g-tile">
                        <div className="dtp-g-name">{g.label}</div>
                        <div className="dtp-g-uc">{g.ucId}</div>
                        <span className={`dtp-g-verdict${tile?.blocked ? " dtp-g-verdict--blocked" : ""}`}>
                          {tile?.blocked ? "BLOCKED ✓" : "pending"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <>
                {step.slots.green && <SlotRow tag="GREEN" slot={step.slots.green} stamp={green} />}
                {step.slots.red && <SlotRow tag="RED" slot={step.slots.red} stamp={red} />}
              </>
            )}
            {complete && (
              <div className="dtp-takeaway">
                <h4>WHAT THIS PROVED</h4>
                {step.proved.green && (
                  <div className="dtp-takeaway-line"><span className="dtp-mark dtp-mark--g">✓</span><span>{step.proved.green}</span></div>
                )}
                {step.proved.red && (
                  <div className="dtp-takeaway-line"><span className="dtp-mark dtp-mark--r">✕</span><span>{step.proved.red}</span></div>
                )}
                <div className="dtp-talk-track"><b>SAY THIS:</b> {step.proved.sayThis}</div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="dtp-root">
      <div className="dtp-topbar">
        <div>
          <div className="dtp-brand">🔐 Guided Demo Track</div>
          <div className="dtp-subtitle">Two acts · {steps.length} steps · every step ends with a permit AND a deny</div>
        </div>
        <div className="dtp-progress">
          {steps.map((s, i) => {
            const complete = stepComplete(s, run, gauntletSims);
            const active = isLive && run.activeStepId === s.stepId;
            return (
              <span key={s.stepId} className={`dtp-dot${complete ? " dtp-dot--done" : ""}${active ? " dtp-dot--active" : ""}`}>
                {complete ? "✓" : i + 1}
              </span>
            );
          })}
        </div>
        <div className="dtp-controls">
          <label className="dtp-run-picker">
            Run
            <select aria-label="Run" value={viewRunId} onChange={(e) => setViewRunId(e.target.value)}>
              <option value="live">Live · started {fmtTime(state.run.startedAt)}</option>
              {history.map((r) => (
                <option key={r.runId} value={r.runId}>
                  {new Date(r.startedAt).toLocaleString()} — {Object.keys(r.slots).length} slots
                </option>
              ))}
            </select>
          </label>
          {isLive && (
            <button type="button" className="dtp-newrun" onClick={startRun}>Start new run</button>
          )}
          {!isLive && <span className="dtp-history-badge">Viewing history — read-only</span>}
        </div>
      </div>

      <div className="dtp-wrap">
        {[1, 2].map((act) => (
          <React.Fragment key={act}>
            <div className="dtp-act-banner">
              <span className="dtp-act-label">{ACT_META[act].label}</span>
              <span className="dtp-act-tagline">{ACT_META[act].tagline}</span>
              <span className="dtp-act-rule" />
            </div>
            {steps.filter((s) => s.act === act).map((s) => renderStep(s, steps.indexOf(s)))}
          </React.Fragment>
        ))}

        {allDone ? (
          <div className="dtp-finish dtp-finish--done">
            <b>Track complete</b> — {steps.length} capabilities proved: {doneCount} permits and denials with decision evidence. Print this page as the leave-behind.
          </div>
        ) : (
          <div className="dtp-finish">
            {doneCount} of {steps.length} steps proved so far — run the remaining steps from the agent or the use-case launcher.
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Write the CSS**

`demo_api_ui/src/pages/DemoTrackPage.css` — port of the mock's stylesheet onto `dtp-` classnames (values verbatim from `demo-track-mock.html`):

```css
/* Guided Demo Track — standalone page. Palette from the approved mock. */
.dtp-root {
  --dtp-red: #b3282d; --dtp-ink: #1a1d21; --dtp-muted: #5f6b76;
  --dtp-line: #e3e7eb; --dtp-bg: #f6f7f9; --dtp-card: #ffffff;
  --dtp-green: #1e7b34; --dtp-green-bg: #ecf7ef;
  --dtp-deny: #c62828; --dtp-deny-bg: #fdeeee;
  --dtp-amber: #9a6700; --dtp-amber-bg: #fff8e6; --dtp-navy: #16324f;
  background: var(--dtp-bg); color: var(--dtp-ink); min-height: 100%;
  line-height: 1.45;
}
.dtp-topbar {
  background: var(--dtp-card); border-bottom: 1px solid var(--dtp-line);
  padding: 14px 28px; display: flex; align-items: center; gap: 18px;
  position: sticky; top: 0; z-index: 10; flex-wrap: wrap;
}
.dtp-brand { font-weight: 700; font-size: 15px; }
.dtp-subtitle { color: var(--dtp-muted); font-size: 13px; }
.dtp-progress { margin-left: auto; display: flex; align-items: center; gap: 6px; }
.dtp-dot {
  width: 22px; height: 22px; border-radius: 50%; font-size: 11px; font-weight: 700;
  display: inline-flex; align-items: center; justify-content: center;
  border: 2px solid var(--dtp-line); color: var(--dtp-muted); background: var(--dtp-card);
}
.dtp-dot--done { background: var(--dtp-green); border-color: var(--dtp-green); color: #fff; }
.dtp-dot--active { border-color: var(--dtp-red); color: var(--dtp-red); }
.dtp-controls { display: flex; align-items: center; gap: 10px; }
.dtp-run-picker { font-size: 12.5px; color: var(--dtp-muted); display: flex; align-items: center; gap: 6px; }
.dtp-run-picker select { font-size: 12.5px; padding: 4px 6px; border: 1px solid var(--dtp-line); border-radius: 6px; }
.dtp-newrun {
  font-size: 12.5px; font-weight: 600; color: #fff; background: var(--dtp-navy);
  border: none; border-radius: 6px; padding: 7px 14px; cursor: pointer;
}
.dtp-history-badge { font-size: 12px; font-weight: 700; color: var(--dtp-amber); background: var(--dtp-amber-bg); padding: 4px 10px; border-radius: 6px; }
.dtp-wrap { max-width: 880px; margin: 0 auto; padding: 26px 20px 80px; }
.dtp-act-banner { display: flex; align-items: center; gap: 14px; margin: 30px 0 18px; }
.dtp-act-label {
  background: var(--dtp-navy); color: #fff; font-size: 12px; font-weight: 700;
  letter-spacing: .08em; padding: 6px 14px; border-radius: 4px; white-space: nowrap;
}
.dtp-act-tagline { color: var(--dtp-muted); font-size: 14px; font-style: italic; }
.dtp-act-rule { flex: 1; border-top: 1px solid var(--dtp-line); }
.dtp-step {
  background: var(--dtp-card); border: 1px solid var(--dtp-line); border-radius: 10px;
  margin-bottom: 14px; overflow: hidden;
}
.dtp-step--active { border-color: var(--dtp-red); }
.dtp-step-head {
  display: flex; align-items: center; gap: 14px; padding: 14px 18px; cursor: pointer;
  width: 100%; background: none; border: none; text-align: left; font: inherit; color: inherit;
}
.dtp-step-num {
  width: 30px; height: 30px; border-radius: 50%; flex: none;
  display: inline-flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: 14px; background: var(--dtp-bg); color: var(--dtp-muted);
  border: 2px solid var(--dtp-line);
}
.dtp-step--done .dtp-step-num { background: var(--dtp-green); border-color: var(--dtp-green); color: #fff; }
.dtp-step--active .dtp-step-num { border-color: var(--dtp-red); color: var(--dtp-red); background: #fff; }
.dtp-step-title { font-weight: 700; font-size: 15px; }
.dtp-step-cap {
  font-size: 11px; font-weight: 600; color: var(--dtp-navy); background: #eaf1f8;
  padding: 3px 9px; border-radius: 999px; white-space: nowrap;
}
.dtp-step-ucs { margin-left: auto; color: var(--dtp-muted); font-size: 12px; white-space: nowrap; }
.dtp-step-status { font-size: 12px; font-weight: 700; color: var(--dtp-green); white-space: nowrap; }
.dtp-chev { color: var(--dtp-muted); font-size: 12px; }
.dtp-collapsed-note { padding: 0 18px 12px 62px; color: var(--dtp-muted); font-size: 12.5px; }
.dtp-step-body { border-top: 1px solid var(--dtp-line); padding: 18px; }
.dtp-buyer-story {
  color: var(--dtp-muted); font-size: 13.5px; margin-bottom: 14px;
  border-left: 3px solid var(--dtp-line); padding-left: 12px; font-style: italic;
}
.dtp-run-row {
  display: flex; align-items: center; gap: 12px; padding: 10px 12px;
  border: 1px solid var(--dtp-line); border-radius: 8px; margin-bottom: 8px; background: #fbfcfd;
}
.dtp-run-tag {
  font-size: 10px; font-weight: 800; letter-spacing: .06em; padding: 3px 8px;
  border-radius: 4px; flex: none; width: 64px; text-align: center;
}
.dtp-run-tag--g { background: var(--dtp-green-bg); color: var(--dtp-green); }
.dtp-run-tag--r { background: var(--dtp-deny-bg); color: var(--dtp-deny); }
.dtp-chip {
  font-size: 13px; background: #fff; border: 1px solid var(--dtp-line);
  border-radius: 999px; padding: 5px 13px;
}
.dtp-run-note { color: var(--dtp-muted); font-size: 12px; }
.dtp-verdict { margin-left: auto; font-size: 12px; font-weight: 800; padding: 5px 11px; border-radius: 6px; }
.dtp-verdict--permit { background: var(--dtp-green-bg); color: var(--dtp-green); }
.dtp-verdict--deny { background: var(--dtp-deny-bg); color: var(--dtp-deny); }
.dtp-verdict--stepup { background: var(--dtp-amber-bg); color: var(--dtp-amber); }
.dtp-takeaway {
  margin-top: 14px; border: 1.5px solid var(--dtp-navy); border-radius: 10px;
  background: linear-gradient(180deg, #f4f8fc 0%, #fff 100%); padding: 16px 18px;
}
.dtp-takeaway h4 { font-size: 11px; letter-spacing: .1em; color: var(--dtp-navy); margin: 0 0 10px; }
.dtp-takeaway-line { display: flex; gap: 10px; font-size: 13.5px; margin-bottom: 7px; }
.dtp-mark { font-weight: 800; flex: none; width: 16px; text-align: center; }
.dtp-mark--g { color: var(--dtp-green); }
.dtp-mark--r { color: var(--dtp-deny); }
.dtp-talk-track {
  margin-top: 10px; font-size: 13px; background: var(--dtp-amber-bg);
  border-radius: 6px; padding: 9px 12px;
}
.dtp-talk-track b { color: var(--dtp-amber); font-size: 11px; letter-spacing: .06em; }
.dtp-gauntlet-bar { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.dtp-gauntlet-score { font-size: 13px; font-weight: 700; color: var(--dtp-green); }
.dtp-gauntlet { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 4px; }
.dtp-g-tile { border: 1px solid var(--dtp-line); border-radius: 8px; padding: 11px 12px; background: #fbfcfd; }
.dtp-g-name { font-size: 12.5px; font-weight: 600; margin-bottom: 2px; }
.dtp-g-uc { font-size: 11px; color: var(--dtp-muted); margin-bottom: 8px; }
.dtp-g-verdict {
  font-size: 11px; font-weight: 800; padding: 3px 8px; border-radius: 5px; display: inline-block;
  background: var(--dtp-bg); color: var(--dtp-muted);
}
.dtp-g-verdict--blocked { background: var(--dtp-green-bg); color: var(--dtp-green); }
.dtp-finish {
  border: 2px dashed var(--dtp-line); border-radius: 10px; padding: 18px; text-align: center;
  color: var(--dtp-muted); font-size: 13.5px; margin-top: 26px; background: var(--dtp-card);
}
.dtp-finish--done { border-style: solid; border-color: var(--dtp-green); }
.dtp-finish b { color: var(--dtp-ink); }
.dtp-error, .dtp-loading { padding: 40px; text-align: center; color: #5f6b76; }
@media (max-width: 760px) {
  .dtp-gauntlet { grid-template-columns: 1fr; }
  .dtp-step-ucs { display: none; }
}
@media print {
  .dtp-controls, .dtp-newrun { display: none; }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/DemoTrackPage.test.jsx`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/pages/DemoTrackPage.jsx demo_api_ui/src/pages/DemoTrackPage.css demo_api_ui/src/pages/__tests__/DemoTrackPage.test.jsx
git commit -m "feat(demo-track): standalone Guided Demo Track page with run history"
```

---

### Task 2: Route + side-nav link + tab footer link

**Files:**
- Modify: `demo_api_ui/src/App.js` (import near line 27; route near line 1252)
- Modify: `demo_api_ui/src/components/AdminSideNav.jsx` (after the "Use Cases (Live)" entry, ~line 461)
- Modify: `demo_api_ui/src/components/TokenChainDemoTrackTab.jsx` (footer link)
- Test: `demo_api_ui/src/components/__tests__/TokenChainDemoTrackTab.test.jsx` (extend)

**Interfaces:**
- Consumes: `DemoTrackPage` default export from Task 1.
- Produces: route `/demo-track`; nav entry `{ label: "Guided Demo Track", path: "/demo-track", icon: "demo" }`.

- [ ] **Step 1: Extend the tab test (failing)**

Append to `demo_api_ui/src/components/__tests__/TokenChainDemoTrackTab.test.jsx` a case inside the existing describe, matching that file's existing mock/render helpers:

```jsx
it("links to the full track page", async () => {
  render(<TokenChainDemoTrackTab />);
  const link = await screen.findByText(/Open full track page/);
  expect(link.closest("a")).toHaveAttribute("href", "/demo-track");
});
```

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/TokenChainDemoTrackTab.test.jsx`
Expected: new case FAILS (link absent), existing cases pass.

- [ ] **Step 2: Add the footer link to the tab**

In `TokenChainDemoTrackTab.jsx`, inside the `tct-toolbar` div after the Start-new-run button:

```jsx
<a className="tct-open-page" href="/demo-track">Open full track page ↗</a>
```

And in `TokenChainDemoTrackTab.css`:

```css
.tct-open-page { font-size: 11px; margin-left: 8px; color: #16324f; text-decoration: none; }
.tct-open-page:hover { text-decoration: underline; }
```

- [ ] **Step 3: Register route and nav entry**

`App.js` — with the other page imports (~line 27):

```jsx
import DemoTrackPage from "./pages/DemoTrackPage";
```

Next to the `/privilege-mcp-diagrams` route (~line 1252):

```jsx
<Route
  path="/demo-track"
  element={<DemoTrackPage />}
/>
```

`AdminSideNav.jsx` — directly after the `Use Cases (Live)` entry:

```jsx
{ label: "Guided Demo Track", path: "/demo-track", icon: "demo" },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/TokenChainDemoTrackTab.test.jsx src/pages/__tests__/DemoTrackPage.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/App.js demo_api_ui/src/components/AdminSideNav.jsx demo_api_ui/src/components/TokenChainDemoTrackTab.jsx demo_api_ui/src/components/TokenChainDemoTrackTab.css demo_api_ui/src/components/__tests__/TokenChainDemoTrackTab.test.jsx
git commit -m "feat(demo-track): /demo-track route, side-nav link, tab footer link"
```

---

### Task 3: Verification gate

- [ ] **Step 1: UI suite + build**

Run: `cd demo_api_ui && npm run test:unit && npm run build`
Expected: build green; test:unit — the 10 pre-existing failures in 5 files (uiRegression monospace, ArchitectureDiagram completeness, ResourceServerPage dualView, UserDashboard canary, spinnerService) are known-red on main as of 2026-08-03; any NEW failure is this plan's to fix.

- [ ] **Step 2: Live smoke (stack running)**

Signed in at `https://local.ping-devops.com:4000`: side nav shows "Guided Demo Track"; `/demo-track` renders both acts and 9 steps; run picker lists archived runs; "Start new run" archives the current run into the picker; Token Chain tab shows "Open full track page ↗".

- [ ] **Step 3: Report**

Report result lines with ✅/❌ per repo rules.

## Self-review notes

- Spec coverage (surface 1): progress dots ✓, act banners ✓, step cards with buyer story + green/red rows + takeaway ✓, gauntlet grid with score ✓, collapsed one-line green·red summary ✓, run history picker ✓ (read-only snapshot), finish summary ✓ (print CSS hides controls), "Open full track page" tab footer ✓ (spec surface-2 footer item).
- Deferred (unchanged from Plan A residuals): mini token-chain strips per run line, decision-ID deep link into token detail views, tab live-dot, per-step drill-down JSON (spec lists drill-down for page + tab; needs a decision-evidence API that doesn't exist yet — carry to Plan C/D). "Run"/"Run all" buttons on the page dispatch nothing in Plan B — runs come from the agent/launcher; buttons omitted rather than dead.
- Type consistency: slot stamp `{ verdict, decisionId, via, at }` and gauntlet tile `{ blocked, status, errorCode, decisionId, at }` match Plan A's service/route/tab exactly; `stepComplete` mirrors `_stepComplete` semantics (green/red presence-gated, gauntlet = all sims blocked).
