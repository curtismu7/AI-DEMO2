# Customer Dashboard 2026 — Finish the Token Chain Redesign

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the four remaining pieces of the approved Customer Dashboard 2026 design — a step-detail panel, a consolidated toolbar, pop-out chain views, and the demo-track band — all inside the Token Chain rail, without editing `TraceStepCard`.

**Architecture:** Everything lands in `demo_api_ui/src/components/`, as new sibling components consumed by `TokenChainTraceRail.jsx`. The rail already resolves a `steps` array and owns `activeStepId`; every new component is a pure renderer over that same array. No new data plumbing, no new API calls, no feature flag.

**Tech Stack:** React 19.2, Vite 8, **vitest** (not jest), Testing Library, plain JS/JSX (no TypeScript sources), plain CSS.

---

## Where things stand

Merged to `main` already — do not redo:

| PR | What |
|---|---|
| #1470 | split3 stacks on mobile (grid + shell) |
| #1474 | deleted the dead `components/dashboard/` directory |
| #1480 | chain map (`TokenChainNodeRail`), Run/speed/Replay walk-through, Present mode (`TokenChainPresenter`) |

**Open, merge before starting:** **#1485** — fixes six code-review defects in #1480 (the `active` status collision, `headline()` claiming "done", document-wide card lookup, stale `presenting`, interval teardown, missing `STATUS_TEXT.active`). Build 0, 321 files / 2784 tests green. **Task 0 below merges it.** Everything after assumes it is on main.

The approved visual reference is the mock at `~/Desktop/dashboard-final.html` (also published at `https://claude.ai/code/artifact/280da84d-a70c-4a36-a694-d18a22be3460`). Open it before starting. It is a mock, not a spec — where it disagrees with the constraints below, the constraints win.

---

## Global Constraints

Every task's requirements implicitly include this section. These are not style preferences; each one is a bug someone already shipped.

- **Work in a git worktree.** A hard-block hook denies `Write`/`Edit` in the main checkout. Stage explicitly (`git add <files>`), never `git add -A`. Verify `git branch --show-current` before each commit.
- **Invoke `regression-guard` before editing any file under `demo_api_ui/`.** State what you will not break, in one line, before you touch the code.
- **Never `@media (prefers-color-scheme: dark)`.** The rail shipped an OS-keyed dark palette with no control and had to be reverted (`REGRESSION_PLAN` §4, 2026-08-02). Dark styling is keyed to `:root[data-theme="dark"]` only.
- **No declaration below 11px** anywhere in the rail. The same §4 entry raised the floor from 9px because it was unreadable in a demo.
- **`active` is a real step status.** `buildTraceSteps.js` assigns it to an in-flight exchange (line 551), an authorize awaiting a decision (634), and a step-up awaiting approval (672). Never treat an unknown status as success. Never name a CSS modifier `--active` for anything other than that status.
- **Never decide which steps exist.** Consume the `steps` array `TokenChainTraceRail` already resolved (line ~257). Live mode shows only observed hops; Classic shows the fixed catalog (`REGRESSION_PLAN` §4, 2026-08-05).
- **Scope DOM queries to the rail**, via the existing `railRef`. `FloatingTokenChainPanel` can mount a second rail over a dashboard that already has one.
- **Any full-screen overlay must be portalled to `document.body`.** The rail renders inside a `.section`, and `.section h2 { font-size: 1.15rem }` (0,1,1) out-specifies a plain class (0,1,0) — this silently rendered the presenter headline at 18px instead of 52px.
- **Emoji allowlist only:** `⚠️` `✅` `❌` `🔐` `✕` `✓` `👤` `🔑` `🪟` `📚`. Everything else is plain text, CSS, or inline SVG.
- **Modals use `DraggableModal`** (`demo_api_ui/CLAUDE.md`). The one existing exception is `TokenChainPresenter`, a deliberately full-bleed projector view; it carries its own focus trap instead. Do not add a second exception without the same justification.
- **If a new CSS file uses `monospace`**, add it to the allowlist in `demo_api_ui/src/__tests__/uiRegression.test.js` (~line 247) with a one-line reason, as `TokenChainTraceRail.css` and `TokenChainPresenter.css` already are. The test will fail otherwise.
- **Gates, both required, every task:** `cd demo_api_ui && npm run build` must exit 0, and `npm run test:unit` must pass. A green test run alone is not enough.
- **Do not edit `TraceStepCard.jsx`.** It is the protected renderer for step cards. Task 1 exists specifically to avoid it.

---

## File Structure

| File | Responsibility |
|---|---|
| `demo_api_ui/src/components/StepDetailPanel.jsx` | **New.** Renders one step's full detail: what happened, what changed, request, response, claims. |
| `demo_api_ui/src/components/StepDetailPanel.css` | **New.** Its styles. Uses monospace → needs the allowlist entry. |
| `demo_api_ui/src/components/__tests__/StepDetailPanel.test.jsx` | **New.** |
| `demo_api_ui/src/components/ChainViewMenu.jsx` | **New.** The "Views" menu; opens each chain view in its own window. |
| `demo_api_ui/src/components/ChainViewMenu.css` | **New.** |
| `demo_api_ui/src/components/__tests__/ChainViewMenu.test.jsx` | **New.** |
| `demo_api_ui/src/components/DemoTrackBand.jsx` | **New.** The 9-step presenter script band. |
| `demo_api_ui/src/components/DemoTrackBand.css` | **New.** |
| `demo_api_ui/src/components/__tests__/DemoTrackBand.test.jsx` | **New.** |
| `demo_api_ui/src/components/TokenChainTraceRail.jsx` | **Modify.** Wire the four new pieces in. Additive only. |
| `demo_api_ui/src/components/TokenChainTraceRail.css` | **Modify.** Toolbar consolidation only. |
| `demo_api_ui/src/__tests__/uiRegression.test.js` | **Modify.** Monospace allowlist entry for `StepDetailPanel.css`. |

---

## Task 0: Merge the open review-fix PR

**Files:** none.

- [ ] **Step 1: Confirm CI is green on the exact head commit**

```bash
gh pr view 1485 --json headRefOid,state,mergeStateStatus,statusCheckRollup \
  --jq '"head=\(.headRefOid) state=\(.state) mergeState=\(.mergeStateStatus)\n" + ([.statusCheckRollup[]? | "\(.name): \(.conclusion // .status)"] | join("\n"))'
```

Expected: `mergeState=CLEAN`, no `FAILURE`. If any check failed, stop and fix it — do not merge with `--admin`.

- [ ] **Step 2: Merge**

```bash
gh pr merge 1485 --squash
```

- [ ] **Step 3: Verify it is actually on main** (a "merged" message is not proof)

```bash
git fetch origin && git log origin/main --oneline -3
```

Expected: the squash commit for #1485 is at or near the top.

- [ ] **Step 4: Sync the shared checkout** — Docker bind-mounts it, so the demo serves stale code until this runs

```bash
cd /Users/cmuir/Development/AI-DEMO2 && ./scripts/sync-main-checkout.sh
```

Expected: `fast-forwarded <old> -> <new>`. If it reports "unexpected dirty files", that is someone else's uncommitted work — report it, do not force.

---

## Task 1: StepDetailPanel — full request, response and changes

The mock's biggest gain. `TraceStepCard` already renders this data but orders it payload-first and collapsed; this panel puts **what happened** and **what changed** above the payloads. It is a new component precisely so `TraceStepCard` stays untouched.

**Files:**
- Create: `demo_api_ui/src/components/StepDetailPanel.jsx`
- Create: `demo_api_ui/src/components/StepDetailPanel.css`
- Test: `demo_api_ui/src/components/__tests__/StepDetailPanel.test.jsx`
- Modify: `demo_api_ui/src/__tests__/uiRegression.test.js` (~line 247)

**Interfaces:**
- Consumes: a `step` object from the rail's `steps` array — `{ id, title, lane, status, detail }` where `detail` may carry `{ narrative, kv, request: {title,text}, response: {title,text}, rfcs, beforeAfter }`. Shapes come from `demo_api_ui/src/services/tokenChainTrace/buildTraceSteps.js`; read `makeStep` (line 383) before writing code.
- Produces: `export default function StepDetailPanel({ step, onInspect })`. `onInspect` is the rail's existing claim-modal opener — pass `onInspect` straight through from `TokenChainTraceRail`.

- [ ] **Step 1: Write the failing test**

```jsx
// demo_api_ui/src/components/__tests__/StepDetailPanel.test.jsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import StepDetailPanel from "../StepDetailPanel";

const STEP = {
  id: "exchange",
  title: "Token exchange — delegation",
  lane: "BFF",
  status: "done",
  detail: {
    narrative: "Subject plus actor are exchanged for one delegated token.",
    kv: [["scope", "write"], ["act", "agent-001"]],
    request: { title: "Exchange request", text: "POST /as/token\ngrant_type=...token-exchange" },
    response: { title: "Delegated token", text: "200 OK\n{ \"scope\": \"write\" }" },
    rfcs: ["RFC 8693"],
  },
};

describe("StepDetailPanel", () => {
  it("puts what happened above the payloads", () => {
    render(<StepDetailPanel step={STEP} />);
    const order = Array.from(document.querySelectorAll(".sdp-section-label")).map((e) => e.textContent);
    expect(order).toEqual(["What happened", "What changed", "Request", "Response"]);
  });

  it("renders request and response uncollapsed", () => {
    render(<StepDetailPanel step={STEP} />);
    expect(screen.getByText(/grant_type=\.\.\.token-exchange/)).toBeVisible();
    expect(screen.getByText(/"scope": "write"/)).toBeVisible();
    expect(document.querySelector("details")).toBeNull();
  });

  it("omits sections the step has no data for, rather than showing empty ones", () => {
    render(<StepDetailPanel step={{ id: "prompt", title: "Prompt", lane: "CHAT", status: "done", detail: {} }} />);
    expect(screen.queryByText("Request")).toBeNull();
    expect(screen.queryByText("What changed")).toBeNull();
  });

  it("never reports an in-flight step as complete", () => {
    render(<StepDetailPanel step={{ ...STEP, status: "active" }} />);
    expect(screen.getByText("In flight")).toBeInTheDocument();
    expect(screen.queryByText("Completed")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd demo_api_ui && npx vitest run src/components/__tests__/StepDetailPanel.test.jsx
```

Expected: FAIL — `Cannot find module '../StepDetailPanel'`.

- [ ] **Step 3: Write the component**

```jsx
// demo_api_ui/src/components/StepDetailPanel.jsx
//
// One step's full detail, ordered so the claim comes before the evidence:
// what happened, what changed, then the raw request and response. TraceStepCard
// renders the same data payload-first and collapsed; this is the presenter's
// view of it and is deliberately a separate component so that card is untouched.
import React from "react";
import "./StepDetailPanel.css";

const STATUS_TEXT = {
  done: "Completed",
  active: "In flight",
  pending: "Not yet run",
  notinpath: "Not in this path",
  denied: "Denied",
  error: "Error",
};

function Section({ label, children }) {
  return (
    <div className="sdp-section">
      <div className="sdp-section-label">{label}</div>
      {children}
    </div>
  );
}

export default function StepDetailPanel({ step, onInspect }) {
  if (!step) return null;
  const d = step.detail || {};
  const kv = Array.isArray(d.kv) ? d.kv : [];
  const rfcs = Array.isArray(d.rfcs) ? d.rfcs : [];

  return (
    <div className="sdp">
      <div className="sdp-head">
        <h3 className="sdp-title">{step.title}</h3>
        <span className="sdp-lane">{step.lane}</span>
        <span className={`sdp-status sdp-status--${step.status || "pending"}`}>
          {STATUS_TEXT[step.status] || String(step.status || "")}
        </span>
      </div>

      {d.narrative ? (
        <Section label="What happened">
          <p className="sdp-narrative">{d.narrative}</p>
        </Section>
      ) : null}

      {kv.length > 0 ? (
        <Section label="What changed">
          <dl className="sdp-kv">
            {kv.map(([k, v]) => (
              <div className="sdp-kv-row" key={k}>
                <dt>{k}</dt>
                <dd>{String(v)}</dd>
              </div>
            ))}
          </dl>
        </Section>
      ) : null}

      {d.request?.text ? (
        <Section label="Request">
          <pre className="sdp-pre">{d.request.text}</pre>
        </Section>
      ) : null}

      {d.response?.text ? (
        <Section label="Response">
          <pre className="sdp-pre">{d.response.text}</pre>
        </Section>
      ) : null}

      {rfcs.length > 0 ? (
        <div className="sdp-rfcs">
          {rfcs.map((r) => (
            <span className="sdp-rfc" key={typeof r === "string" ? r : r.label}>
              {typeof r === "string" ? r : r.label}
            </span>
          ))}
        </div>
      ) : null}

      {typeof onInspect === "function" && d.tokenEvent ? (
        <button type="button" className="sdp-inspect" onClick={() => onInspect(step.id)}>
          Inspect token claims
        </button>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Write the CSS**

Create `StepDetailPanel.css`. Nothing below 11px. Dark rules keyed to `:root[data-theme="dark"]` only. `.sdp-pre` and `.sdp-kv-row` use `font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;` and `.sdp-pre` gets `max-height: 260px; overflow: auto;` so a long payload cannot push the rest of the rail off screen.

- [ ] **Step 5: Add the monospace allowlist entry**

In `demo_api_ui/src/__tests__/uiRegression.test.js`, beside the existing `TokenChainPresenter.css` line:

```js
        f.includes("StepDetailPanel.css") ||     // step request/response/claims display (intentional)
```

- [ ] **Step 6: Run the tests**

```bash
npx vitest run src/components/__tests__/StepDetailPanel.test.jsx
```

Expected: PASS, 4 tests.

- [ ] **Step 7: Wire it into the rail**

In `TokenChainTraceRail.jsx`, render it directly under `<TokenChainNodeRail …>` for the selected step, and only when one is selected:

```jsx
{activeStepId ? (
  <StepDetailPanel
    step={steps.find((s) => s.id === activeStepId)}
    onInspect={onInspect}
  />
) : null}
```

Import it beside the other component imports. Do not remove the `steps.map(...)` cards below — the panel is a focused view of the selected step, and the cards remain the full list.

- [ ] **Step 8: Both gates**

```bash
npm run build && npm run test:unit
```

Expected: build exit 0; suite green.

- [ ] **Step 9: Commit**

```bash
git add demo_api_ui/src/components/StepDetailPanel.jsx \
        demo_api_ui/src/components/StepDetailPanel.css \
        demo_api_ui/src/components/__tests__/StepDetailPanel.test.jsx \
        demo_api_ui/src/components/TokenChainTraceRail.jsx \
        demo_api_ui/src/__tests__/uiRegression.test.js
git commit -m "feat(ui): step detail panel — what happened and what changed above the payloads"
```

---

## Task 2: ChainViewMenu — the six views as pop-outs

The rail's seven tabs (Token Chain, Tokens, MCP, Trust, Simple, Detailed, Demo Track) do not fit once the map and detail panel are present. Token Chain stays inline; the other six move into a menu that opens each in its own window.

**Files:**
- Create: `demo_api_ui/src/components/ChainViewMenu.jsx`
- Create: `demo_api_ui/src/components/ChainViewMenu.css`
- Test: `demo_api_ui/src/components/__tests__/ChainViewMenu.test.jsx`

**Interfaces:**
- Consumes: `steps` (the rail's resolved array).
- Produces: `export default function ChainViewMenu({ steps, onOpenView })`. `onOpenView(viewId)` is called with one of `"tokens" | "mcp" | "trust" | "simple" | "detailed" | "demoTrack"`. The rail decides what a view does; the menu only names them.

- [ ] **Step 1: Write the failing test**

```jsx
// demo_api_ui/src/components/__tests__/ChainViewMenu.test.jsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChainViewMenu from "../ChainViewMenu";

const STEPS = [{ id: "signin", title: "Sign-in", lane: "PINGONE", status: "done", detail: {} }];

describe("ChainViewMenu", () => {
  it("keeps the six views behind one control", async () => {
    render(<ChainViewMenu steps={STEPS} onOpenView={() => {}} />);
    expect(screen.queryByText("Tokens")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Views" }));
    for (const name of ["Tokens", "MCP", "Trust", "Simple", "Detailed", "Demo Track"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("reports which view was chosen and closes", async () => {
    const onOpenView = vi.fn();
    render(<ChainViewMenu steps={STEPS} onOpenView={onOpenView} />);
    await userEvent.click(screen.getByRole("button", { name: "Views" }));
    await userEvent.click(screen.getByRole("button", { name: "MCP" }));
    expect(onOpenView).toHaveBeenCalledWith("mcp");
    expect(screen.queryByRole("button", { name: "Tokens" })).toBeNull();
  });

  it("says where Token Chain lives, since it is not in the menu", async () => {
    render(<ChainViewMenu steps={STEPS} onOpenView={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "Views" }));
    expect(screen.getByText(/Token Chain runs inline/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/components/__tests__/ChainViewMenu.test.jsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the component**

Use a `useState` open flag and a real `<button>` trigger — not `<details>`, whose `open` attribute fights Testing Library's click semantics. Close on outside click and on Escape. Six items, each calling `onOpenView(id)` then closing. Include the footnote text `Token Chain runs inline, below.`

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/components/__tests__/ChainViewMenu.test.jsx
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Implement `onOpenView` in the rail**

In `TokenChainTraceRail.jsx`, map each view id to a `window.open` carrying that view's content, built from `steps`. Guard the null return (`if (!w) return;` — pop-up blockers). Write the document with an explicit `<meta charset="utf-8">`.

- [ ] **Step 6: Both gates, then commit**

```bash
npm run build && npm run test:unit
git add demo_api_ui/src/components/ChainViewMenu.jsx \
        demo_api_ui/src/components/ChainViewMenu.css \
        demo_api_ui/src/components/__tests__/ChainViewMenu.test.jsx \
        demo_api_ui/src/components/TokenChainTraceRail.jsx
git commit -m "feat(ui): chain views open in their own window from one Views menu"
```

---

## Task 3: Consolidate the rail toolbar to four controls

The rail header currently carries roughly twenty controls across two rows (measured on the running app: Live/Classic, seven tabs, A-/100%/A+, Clear, Legend, plus the map's Run/speed/density/Present). The design collapses the visible set to four: **Run**, speed, **Views**, **More**.

**Files:**
- Modify: `demo_api_ui/src/components/TokenChainTraceRail.jsx`
- Modify: `demo_api_ui/src/components/TokenChainTraceRail.css`

**Interfaces:**
- Consumes: `ChainViewMenu` from Task 2.
- Produces: no new exports. Everything moved must stay reachable.

- [ ] **Step 1: Inventory what exists, so nothing is lost**

```bash
grep -nE "tctr-(mode|zoom|clear|legend|tab)" demo_api_ui/src/components/TokenChainTraceRail.jsx
```

Write the list down. Each control must end up either visible, in the More menu, or in the Views menu. Nothing may be deleted.

- [ ] **Step 2: Write the failing test**

Add to `demo_api_ui/src/components/__tests__/TokenChainTraceRail.test.jsx`:

```jsx
it("keeps the visible toolbar to four controls with everything else reachable", async () => {
  render(<TokenChainTraceRail />);  // the suite renders it bare; there is no helper
  const bar = document.querySelector(".tctr-toolbar");
  const visible = Array.from(bar.querySelectorAll("button, select")).filter((e) => !e.closest(".tctr-more-pop"));
  expect(visible.length).toBeLessThanOrEqual(4);

  await userEvent.click(screen.getByRole("button", { name: /More/ }));
  for (const name of [/Live/, /Classic/, /Clear/, /Legend/]) {
    expect(screen.getByRole("button", { name })).toBeInTheDocument();
  }
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
npx vitest run src/components/__tests__/TokenChainTraceRail.test.jsx
```

Expected: FAIL — `.tctr-toolbar` is null.

- [ ] **Step 4: Restructure the header**

Wrap the controls in `.tctr-toolbar`. Leave visible: the Run button and speed select (already in `TokenChainNodeRail`), the Views trigger, and a More trigger. Move Live/Classic, zoom (A-/100%/A+), Clear and Legend into the More popover. Keep every existing `onClick` handler exactly as it is — this is a relocation, not a rewrite.

- [ ] **Step 5: Run the full rail suite**

```bash
npx vitest run src/components/__tests__/TokenChainTraceRail.test.jsx
```

Expected: PASS, including the 15 pre-existing cases. If a pre-existing test fails because a control moved, fix the **test's query**, not the control's behaviour — and say so in the commit.

- [ ] **Step 6: Both gates, then commit**

```bash
npm run build && npm run test:unit
git add demo_api_ui/src/components/TokenChainTraceRail.jsx \
        demo_api_ui/src/components/TokenChainTraceRail.css \
        demo_api_ui/src/components/__tests__/TokenChainTraceRail.test.jsx
git commit -m "feat(ui): rail toolbar down to four visible controls, rest behind More"
```

---

## Task 4: DemoTrackBand — the presenter's 9-step script

Distinct from the 16 technical hops: this is the ordered demo script, so whoever is presenting runs it in the right order and has a line to say. Source of truth is `demo_api_server/config/demoTrack.js` (`TRACK_STEPS`), nine steps across two acts, each with `stepId`, `act`, `title`, `capability`, `buyerStory`.

**Files:**
- Create: `demo_api_ui/src/components/DemoTrackBand.jsx`
- Create: `demo_api_ui/src/components/DemoTrackBand.css`
- Test: `demo_api_ui/src/components/__tests__/DemoTrackBand.test.jsx`
- Modify: `demo_api_ui/src/components/TokenChainTraceRail.jsx`

**Interfaces:**
- Consumes: `track` — an array of `{ n, act, title, capability, buyerStory }`. **Do not import the server config into the UI.** `TokenChainDemoTrackTab.jsx` already fetches it: `apiClient.get("/api/demo-track")` (line 55), and reports the presenter's position with `apiClient.post("/api/demo-track/active-step", { stepId })` (line 74). Reuse both — the band and that tab must not drift apart. Per `demo_api_ui/CLAUDE.md`, all HTTP goes through `apiClient`; never `axios` directly.
- Produces: `export default function DemoTrackBand({ track, activeIndex, onSelect })`.

- [ ] **Step 1: Read the existing fetch so the band and the tab share one source**

```bash
sed -n '45,90p' demo_api_ui/src/components/TokenChainDemoTrackTab.jsx
```

Note the response shape it maps into chips. The band consumes the same shape. If the band needs a field the endpoint does not return, add it server-side in `demo_api_server/config/demoTrack.js` — do not hardcode it in the UI.

- [ ] **Step 2: Write the failing test**

```jsx
// demo_api_ui/src/components/__tests__/DemoTrackBand.test.jsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DemoTrackBand from "../DemoTrackBand";

const TRACK = [
  { n: 1, act: 1, title: "Delegated access", capability: "RFC 8693", buyerStory: "Every agent action traces to a human." },
  { n: 2, act: 1, title: "A2A delegation", capability: "Nested act", buyerStory: "Proof carries through the chain." },
  { n: 8, act: 2, title: "PingOne MCP admin", capability: "Hosted MCP", buyerStory: "The AI managing identity is governed by it." },
];

describe("DemoTrackBand", () => {
  it("shows the steps in order, grouped by act", () => {
    render(<DemoTrackBand track={TRACK} activeIndex={0} onSelect={() => {}} />);
    expect(screen.getByText("Act 1")).toBeInTheDocument();
    expect(screen.getByText("Act 2")).toBeInTheDocument();
    expect(document.querySelectorAll(".dtb-chip")).toHaveLength(3);
  });

  it("gives the presenter the current step's line to say", () => {
    render(<DemoTrackBand track={TRACK} activeIndex={1} onSelect={() => {}} />);
    expect(screen.getByText(/Proof carries through the chain\./)).toBeInTheDocument();
    expect(screen.getByText("Nested act")).toBeInTheDocument();
  });

  it("marks completed steps distinctly from the current one", () => {
    render(<DemoTrackBand track={TRACK} activeIndex={2} onSelect={() => {}} />);
    expect(document.querySelectorAll(".dtb-chip--done")).toHaveLength(2);
    expect(document.querySelectorAll(".dtb-chip--on")).toHaveLength(1);
  });

  it("selects a step when clicked", async () => {
    const onSelect = vi.fn();
    render(<DemoTrackBand track={TRACK} activeIndex={0} onSelect={onSelect} />);
    await userEvent.click(screen.getByText("A2A delegation"));
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it("renders nothing when there is no track", () => {
    const { container } = render(<DemoTrackBand track={[]} activeIndex={0} onSelect={() => {}} />);
    expect(container.querySelector(".dtb")).toBeNull();
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
npx vitest run src/components/__tests__/DemoTrackBand.test.jsx
```

Expected: FAIL — module not found.

- [ ] **Step 4: Write the component and CSS**

Chips in order with an act label before each act's first chip; `--done` for indices below `activeIndex`, `--on` for the current; the current step's `capability` and `buyerStory` shown below the chips. Prev/Next buttons calling `onSelect(activeIndex ± 1)`, clamped. Nothing below 11px; dark via `:root[data-theme="dark"]`.

- [ ] **Step 5: Run the tests**

```bash
npx vitest run src/components/__tests__/DemoTrackBand.test.jsx
```

Expected: PASS, 5 tests.

- [ ] **Step 6: Wire it into the rail** above `TokenChainNodeRail`, with local `activeIndex` state.

- [ ] **Step 7: Both gates, then commit**

```bash
npm run build && npm run test:unit
git add demo_api_ui/src/components/DemoTrackBand.jsx \
        demo_api_ui/src/components/DemoTrackBand.css \
        demo_api_ui/src/components/__tests__/DemoTrackBand.test.jsx \
        demo_api_ui/src/components/TokenChainTraceRail.jsx
git commit -m "feat(ui): demo track band — the presenter's nine-step script above the chain"
```

---

## Task 5: Verify live, then open the PR

Unit tests do not catch layout regressions. This task is the one that would have caught the 18px headline.

- [ ] **Step 1: Serve the worktree**

```bash
ln -sfn /Users/cmuir/Development/AI-DEMO2/certs certs
cd demo_api_ui && PORT=4443 npm start
```

Sign-in only works on `local.ping-devops.com` — use `https://local.ping-devops.com:4443/dashboard`. Password: probe before trusting either candidate, see `project-demo-user-password-hint-is-stale`.

- [ ] **Step 2: Check the four pieces render**

Switch the rail to **Classic** (Live shows nothing until a run). Confirm: the demo track band shows 9 chips across 2 acts; the toolbar shows at most 4 visible controls; Views opens six items; selecting a node renders the detail panel with Request and Response uncollapsed.

- [ ] **Step 3: Check nothing shrank**

In DevTools console:

```js
Math.min(...[...document.querySelectorAll('.tctr *')].map(e => parseFloat(getComputedStyle(e).fontSize)).filter(Boolean))
```

Expected: `>= 11`.

- [ ] **Step 4: Check for OS-keyed dark rules**

```bash
grep -c prefers-color-scheme demo_api_ui/src/components/StepDetailPanel.css \
  demo_api_ui/src/components/ChainViewMenu.css \
  demo_api_ui/src/components/DemoTrackBand.css
```

Expected: `0` for each.

- [ ] **Step 5: Stop the server, remove the certs symlink, open the PR**

```bash
pkill -f vite; rm -f certs
gh pr create --base main --title "feat(ui): finish the Customer Dashboard 2026 token chain redesign" --body-file <path>
```

The PR body must carry the measured before/after numbers from Step 2 and Step 3, not assertions.

---

## Self-review notes

- **Spec coverage:** all four remaining mock features have a task (1 detail panel, 2 pop-out views, 3 toolbar, 4 demo track). Present mode and the chain map are already merged in #1480 and are deliberately absent.
- **Deliberate gap:** Task 4 Step 1 requires finding the UI's existing demo-track source rather than naming a file. `TokenChainDemoTrackTab.jsx` exists and already solves this; duplicating the server config into the UI would create a second source of truth for a nine-step script that changes.
- **Type consistency:** `onOpenView(viewId)` ids in Task 2 match the six menu labels; `onSelect(index)` in Task 4 is an index, while `onSelect(id)` in the existing `TokenChainNodeRail` is a step id — these are different components and different callbacks, and the tests assert each.
