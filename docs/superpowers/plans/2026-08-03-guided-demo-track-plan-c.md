# Guided Demo Track — Plan C: Agent Header Dropdown (Embedded + Floating)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spec surface 3 — a `Demo Track: Step N of 9 ▾` control in the shared agent header (covers both the floating and embedded agent, which are the same `BankingAgent` component in `mode="float"|"inline"`), opening a DraggableModal step picker; picking a step posts the active step, drops a track banner into the chat, and swaps the chip row to that step's green/red chips plus "why was that blocked?".

**Architecture:** All track logic lives in a new `DemoTrackAgentControl.jsx` (header button + DraggableModal picker, polls `/api/demo-track` every 5s via apiClient). `AIAgent.js` receives three additive insertions: (1) render the control inside `ba-header-tools`, (2) a `trackStep` state + `onTrackStepPick` handler that calls `addMessage("assistant", banner)`, (3) a conditional track chip row rendered before the normal action groups when `trackStep` is set, dispatching through the existing `handleChipActivate({ id, label, message })` path (`message` → `sendAsNl` → real NL pipeline). Mock: `docs/superpowers/specs/assets/2026-08-03-guided-demo-track/demo-track-agent-mock.html`.

**Tech Stack:** React 19 + vitest (NOT jest). HTTP via `services/apiClient`. `DraggableModal` (standing modal rule).

**Regression guard (REGRESSION_PLAN §1, stated before editing):** will NOT touch `liveAccounts` state, `banking-agent-fab` classes, float resize caps (`MAX_W`/`MAX_H`), agent-mode taxonomy, consent gating (`consentBlocked`), the NL pipeline, or any auth/session/server code. AIAgent.js edits are additive-only at three named points.

## Global Constraints

- Emoji allowlist: `✓` `✕` only in new UI text (`▾ ▸ ↗ ›` are established text glyphs).
- Worktree branch `worktree-demo-track-agent`; stage explicitly, never `git add -A`.
- UI tests: `cd demo_api_ui && npx vitest run <file>` — vitest, never jest.
- Zero server changes — Plan A's `/api/demo-track` API is complete for this surface.
- Deferred (unchanged from Plan A/B residuals): mini token-chain strips in chat, verdict pills on agent replies, auto-takeaway + "Next step" injection on slot completion (needs slot-completion push events; polling the modal is Plan D material). This plan delivers: header control, picker, banner, chip swap.

---

### Task 1: DemoTrackAgentControl component

**Files:**
- Create: `demo_api_ui/src/components/DemoTrackAgentControl.jsx`
- Create: `demo_api_ui/src/components/DemoTrackAgentControl.css`
- Test: `demo_api_ui/src/components/__tests__/DemoTrackAgentControl.test.jsx`

**Interfaces:**
- Consumes: `apiClient.get('/api/demo-track')`, `apiClient.post('/api/demo-track/active-step', { stepId })`, `DraggableModal` (props: `title`, `onClose`, `children` — match existing usages), `stepComplete` logic copied from Plan B (same slot semantics).
- Produces: default export `DemoTrackAgentControl({ onPickStep })`. Calls `onPickStep({ step, index, total })` after a successful active-step POST. Renders `null` while `/api/demo-track` has not loaded (agent header must never break if the API is down).

- [ ] **Step 1: Write the failing test**

```jsx
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import DemoTrackAgentControl from "../DemoTrackAgentControl";
import apiClient from "../../services/apiClient";

vi.mock("../../services/apiClient", () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

const TRACK = {
  steps: [
    { stepId: "delegated-access", act: 1, title: "Delegated access", ucIds: ["UC1"], buyerStory: "story-1",
      slots: { green: { chipText: "show my balance" }, red: { label: "replayed token" } },
      proved: { green: "g", red: "r", sayThis: "s" } },
    { stepId: "fine-grained-authz", act: 1, title: "Fine-grained authz", ucIds: ["UC6"], buyerStory: "story-3",
      slots: { green: { chipText: "transfer $200 to savings" }, red: { chipText: "transfer $6,000 to savings" } },
      proved: { green: "g", red: "r", sayThis: "s" } },
    { stepId: "pingone-mcp-admin", act: 2, title: "PingOne MCP admin", ucIds: ["UC-LEARN2"], buyerStory: "story-8",
      slots: { green: { chipText: "admin task" }, red: { chipText: "denied task" } },
      proved: { green: "g", red: "r", sayThis: "s" } },
  ],
  gauntletSims: [],
};
const RUN = {
  runId: "run-1", activeStepId: "fine-grained-authz",
  slots: {
    "delegated-access:green": { verdict: "PERMIT", at: "2026-08-03T10:00:00Z" },
    "delegated-access:red": { verdict: "DENY", at: "2026-08-03T10:01:00Z" },
  },
  gauntlet: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  apiClient.get.mockResolvedValue({ data: { track: TRACK, run: RUN } });
  apiClient.post.mockResolvedValue({ data: {} });
});

describe("DemoTrackAgentControl", () => {
  it("shows the active step position in the header button", async () => {
    render(<DemoTrackAgentControl onPickStep={() => {}} />);
    expect(await screen.findByText(/Demo Track:/)).toBeInTheDocument();
    expect(screen.getByText(/Step 2 of 3/)).toBeInTheDocument();
  });

  it("opens the picker with act labels, done marks, and full-page link", async () => {
    render(<DemoTrackAgentControl onPickStep={() => {}} />);
    fireEvent.click(await screen.findByText(/Demo Track:/));
    expect(await screen.findByText("ACT 1 · THE CUSTOMER AGENT")).toBeInTheDocument();
    expect(screen.getByText("ACT 2 · SAME RAILS GOVERN THE ADMINS")).toBeInTheDocument();
    expect(screen.getByText("Delegated access").closest("button").textContent).toContain("✓");
    const link = screen.getByText(/Open full track page/);
    expect(link.closest("a")).toHaveAttribute("href", "/demo-track");
  });

  it("picking a step posts active-step and calls onPickStep with step and position", async () => {
    const onPickStep = vi.fn();
    render(<DemoTrackAgentControl onPickStep={onPickStep} />);
    fireEvent.click(await screen.findByText(/Demo Track:/));
    fireEvent.click(await screen.findByText("PingOne MCP admin"));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/api/demo-track/active-step", { stepId: "pingone-mcp-admin" })
    );
    await waitFor(() => expect(onPickStep).toHaveBeenCalled());
    const arg = onPickStep.mock.calls[0][0];
    expect(arg.step.stepId).toBe("pingone-mcp-admin");
    expect(arg.index).toBe(2);
    expect(arg.total).toBe(3);
  });

  it("renders nothing until the track has loaded", () => {
    apiClient.get.mockReturnValue(new Promise(() => {}));
    const { container } = render(<DemoTrackAgentControl onPickStep={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run test — expect module-not-found FAIL**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/DemoTrackAgentControl.test.jsx`

- [ ] **Step 3: Implement the component**

```jsx
// Demo Track header control — shared by the floating and embedded agent
// (both are BankingAgent). Button shows the active step position; the picker
// is a DraggableModal per the standing modal rule.
import React, { useCallback, useEffect, useState } from "react";
import apiClient from "../services/apiClient";
import DraggableModal from "./DraggableModal";
import "./DemoTrackAgentControl.css";

const POLL_MS = 5000;
const ACT_LABELS = { 1: "ACT 1 · THE CUSTOMER AGENT", 2: "ACT 2 · SAME RAILS GOVERN THE ADMINS" };

function stepComplete(step, run, gauntletSims) {
  if (step.stepId === "attack-gauntlet") {
    return gauntletSims.length > 0 && gauntletSims.every((g) => run.gauntlet?.[g.sim]?.blocked);
  }
  const green = !step.slots.green || run.slots[`${step.stepId}:green`];
  const red = !step.slots.red || run.slots[`${step.stepId}:red`];
  return Boolean(green && red);
}

export default function DemoTrackAgentControl({ onPickStep }) {
  const [state, setState] = useState(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get("/api/demo-track");
      setState(res.data);
    } catch { /* header control is best-effort; next poll retries */ }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const pick = useCallback(async (step, index, total) => {
    setOpen(false);
    try {
      await apiClient.post("/api/demo-track/active-step", { stepId: step.stepId });
    } catch { /* still hand off — chips work without server ack */ }
    onPickStep?.({ step, index, total });
    load();
  }, [onPickStep, load]);

  if (!state) return null;
  const { track, run } = state;
  const { steps, gauntletSims } = track;
  const activeIdx = Math.max(0, steps.findIndex((s) => s.stepId === run.activeStepId));

  return (
    <>
      <button type="button" className="dta-trigger" onClick={() => setOpen(true)}>
        Demo Track: <b>Step {activeIdx + 1} of {steps.length}</b> ▾
      </button>
      {open && (
        <DraggableModal title="Guided Demo Track" onClose={() => setOpen(false)}>
          <div className="dta-menu">
            {[1, 2].map((act) => (
              <React.Fragment key={act}>
                <div className="dta-act">{ACT_LABELS[act]}</div>
                {steps.filter((s) => s.act === act).map((s) => {
                  const i = steps.indexOf(s);
                  const done = stepComplete(s, run, gauntletSims);
                  const current = run.activeStepId === s.stepId;
                  return (
                    <button
                      key={s.stepId}
                      type="button"
                      className={`dta-item${done ? " dta-item--done" : ""}${current ? " dta-item--current" : ""}`}
                      onClick={() => pick(s, i, steps.length)}
                    >
                      <span className="dta-n">{done ? "✓" : i + 1}</span>
                      <span className="dta-title">{s.title}</span>
                      <span className="dta-ucs">{s.ucIds.join("·")}</span>
                    </button>
                  );
                })}
              </React.Fragment>
            ))}
            <a className="dta-foot" href="/demo-track">Open full track page ↗</a>
          </div>
        </DraggableModal>
      )}
    </>
  );
}
```

- [ ] **Step 4: CSS**

```css
/* Demo Track agent header control + picker (mock: demo-track-agent-mock.html) */
.dta-trigger {
  font-size: 11px; border: 1px solid #e3e7eb; border-radius: 999px;
  background: #fff; padding: 4px 10px; cursor: pointer; color: #16324f; white-space: nowrap;
}
.dta-trigger b { font-weight: 700; }
.dta-menu { display: flex; flex-direction: column; min-width: 280px; padding: 4px; }
.dta-act {
  font-size: 9.5px; font-weight: 800; letter-spacing: .08em; color: #5f6b76;
  margin: 8px 6px 4px;
}
.dta-item {
  display: flex; align-items: center; gap: 8px; padding: 7px 8px; border: none;
  background: none; cursor: pointer; border-radius: 6px; text-align: left; font: inherit;
  font-size: 12.5px; color: #1a1d21;
}
.dta-item:hover { background: #f6f7f9; }
.dta-item--current { background: #fdeeee; }
.dta-item--done .dta-n { background: #1e7b34; border-color: #1e7b34; color: #fff; }
.dta-n {
  width: 20px; height: 20px; border-radius: 50%; flex: none; font-size: 10.5px; font-weight: 700;
  display: inline-flex; align-items: center; justify-content: center;
  border: 1.5px solid #e3e7eb; color: #5f6b76; background: #fff;
}
.dta-title { flex: 1; }
.dta-ucs { font-size: 10px; color: #5f6b76; white-space: nowrap; }
.dta-foot {
  margin: 6px 6px 4px; padding-top: 7px; border-top: 1px solid #e3e7eb;
  font-size: 11.5px; color: #16324f; text-decoration: none; text-align: center;
}
.dta-foot:hover { text-decoration: underline; }
```

- [ ] **Step 5: Run test — expect PASS. Commit**

```bash
git add demo_api_ui/src/components/DemoTrackAgentControl.jsx demo_api_ui/src/components/DemoTrackAgentControl.css demo_api_ui/src/components/__tests__/DemoTrackAgentControl.test.jsx
git commit -m "feat(demo-track): agent header Demo Track control with DraggableModal picker"
```

---

### Task 2: Wire into BankingAgent (additive, three insertion points)

**Files:**
- Modify: `demo_api_ui/src/components/AIAgent.js` (import block; `ba-header-tools` div ~L8317; chip-row area near `renderActionGroups` usage)
- Modify: `demo_api_ui/src/components/AIAgent.css` (track chip row styles, appended)
- Test: extend `demo_api_ui/src/components/__tests__/DemoTrackAgentControl.test.jsx` is NOT enough — AIAgent has no cheap unit harness; wiring is covered by the build gate + live smoke (AIAgent's own test files are heavy integration suites; adding one for this row is out of scope).

**Interfaces:**
- Consumes: `DemoTrackAgentControl` (Task 1), existing `addMessage(role, content)`, `handleChipActivate(action)`, `sendAsNl` (via handleChipActivate `message`).
- Produces: `trackStep` state `{ step, index, total } | null`.

- [ ] **Step 1: Insertions**

Import (with the other component imports):

```jsx
import DemoTrackAgentControl from "./DemoTrackAgentControl";
```

State + handler (near other UI state, e.g. after the popout state block):

```jsx
// Guided Demo Track (Plan C): picked step drives a banner + swapped chip row.
const [trackStep, setTrackStep] = useState(null); // { step, index, total } | null
const handleTrackStepPick = useCallback(({ step, index, total }) => {
  setTrackStep({ step, index, total });
  addMessage(
    "assistant",
    `Step ${index + 1} — ${step.title}\n"${step.buyerStory}"`,
  );
}, [addMessage]);
```

(If `addMessage` is not useCallback-stable, drop it from the dep array and reference it directly — match the file's existing patterns.)

Header control, inside the `ba-header-tools` div (before the existing buttons):

```jsx
<DemoTrackAgentControl onPickStep={handleTrackStepPick} />
```

Track chip row — immediately above the existing action-groups/suggestions render:

```jsx
{trackStep && (
  <div className="ba-track-chips">
    {trackStep.step.slots.green?.chipText && (
      <button type="button" className="ba-track-chip ba-track-chip--g"
        onClick={() => handleChipActivate({ id: `track-${trackStep.step.stepId}-green`, label: trackStep.step.slots.green.chipText, message: trackStep.step.slots.green.chipText })}>
        ✓ {trackStep.step.slots.green.chipText}
      </button>
    )}
    {(trackStep.step.slots.red?.chipText) && (
      <button type="button" className="ba-track-chip ba-track-chip--r"
        onClick={() => handleChipActivate({ id: `track-${trackStep.step.stepId}-red`, label: trackStep.step.slots.red.chipText, message: trackStep.step.slots.red.chipText })}>
        ✕ {trackStep.step.slots.red.chipText}
      </button>
    )}
    <button type="button" className="ba-track-chip"
      onClick={() => handleChipActivate({ id: "track-why-blocked", label: "why was that blocked?", message: "why was that blocked?" })}>
      why was that blocked?
    </button>
    <button type="button" className="ba-track-chip ba-track-chip--exit" onClick={() => setTrackStep(null)}>
      exit track
    </button>
  </div>
)}
```

Red slots with only a `label` (sim-sourced, e.g. gauntlet) get no red chip — sims run from the launcher; the row still shows green + why + exit.

CSS appended to `AIAgent.css`:

```css
/* Guided Demo Track chip row (Plan C) */
.ba-track-chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 6px 10px; }
.ba-track-chip { font-size: 11.5px; border-radius: 999px; padding: 5px 11px; cursor: pointer; border: 1px solid #e3e7eb; background: #fff; }
.ba-track-chip--g { border-color: #bfe3c8; background: #ecf7ef; color: #1e7b34; font-weight: 600; }
.ba-track-chip--r { border-color: #f2c6c6; background: #fdeeee; color: #c62828; font-weight: 600; }
.ba-track-chip--exit { color: #5f6b76; }
```

- [ ] **Step 2: Build gate**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/DemoTrackAgentControl.test.jsx && npm run build`
Expected: tests PASS, build exit 0.

- [ ] **Step 3: Commit**

```bash
git add demo_api_ui/src/components/AIAgent.js demo_api_ui/src/components/AIAgent.css
git commit -m "feat(demo-track): wire Demo Track control into the shared agent header"
```

---

### Task 3: Verification gate

- [ ] **Step 1:** `cd demo_api_ui && npm run test:unit && npm run build` — build must exit 0; unit failures must be exactly the known 5-file pre-existing set (fail-on-new only).
- [ ] **Step 2:** Live smoke: floating agent header shows `Demo Track: Step N of 9 ▾` (dashboard); picker opens as DraggableModal (drag + resize + pop-out work); picking Step 3 posts active-step (Token Chain tab active-step highlight follows), drops the banner into chat, chip row shows `✓ transfer $200… / ✕ transfer $6,000… / why was that blocked? / exit track`; chips dispatch through the real agent.
- [ ] **Step 3:** Report ✅/❌ lines; then push + PR.

## Self-review notes

- Spec coverage (surface 3): header control ✓, DraggableModal picker with acts/done/link ✓, banner into chat ✓, chip-row swap with green/red + why-blocked ✓, runs go through the real agent ✓ (handleChipActivate → sendAsNl). Deferred explicitly: inline mini-takeaway + "Next: Step N+1" auto-injection on completion (needs completion detection in AIAgent — Plan D with the UC16/UC2 fixes), mini token-chain strips.
- Consistency: `stepComplete` copied verbatim from Plan B; slot/gauntlet shapes match Plan A service.
- AIAgent risk containment: three named insertion points, no existing line modified, control renders `null` on API failure so the header never breaks.
