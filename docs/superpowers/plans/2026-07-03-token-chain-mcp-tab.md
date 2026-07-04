# Token Chain MCP Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Token Chain | MCP" tab strip to `TokenChainTraceRail`; the MCP tab shows the delegated token, the FULL MCP tool execution (complete request + response + raw payload), and the exchange→gateway→mcp→api steps expanded by default so the full API call is visible — all from existing client-side trace data.

**Architecture:** Purely presentational. `TokenChainTraceRail` gains local tab state and branches its body. A new pure component `TraceMcpPanel` filters the existing `steps` array and reads `trace.mcpResult`. `TraceTokenSummary` gains an `only` prop and `TraceStepCard` gains a `defaultOpen` prop — both backward compatible. No backend, store, or data-flow changes.

**Tech Stack:** React (function components, hooks), Vitest + @testing-library/react, plain CSS.

## Global Constraints

- No backend changes; no new store fields or fetches. Data source stays `tokenChainTraceStore.getState()` → `{ steps, trace }`.
- Default (Token Chain) tab must render byte-for-byte today's behavior; `only`/`defaultOpen` props default to today's behavior.
- All JSON rendered in full via `JSON.stringify(v, null, 2)` — no truncation or slicing anywhere in the MCP tab.
- Follow existing `tctr-` CSS namespace and the navy/slate palette in `TokenChainTraceRail.css`.
- Tests are Vitest (`vi.mock`, `test`, `expect`), run from `demo_api_ui/`.
- Reuse `TraceStepCard` and `TraceTokenSummary` — do not duplicate their markup.

---

### Task 1: `only` prop on `TraceTokenSummary`

**Files:**
- Modify: `demo_api_ui/src/components/TraceTokenSummary.jsx`
- Test: `demo_api_ui/src/components/__tests__/TraceTokenSummary.only.test.jsx` (create)

**Interfaces:**
- Produces: `TraceTokenSummary({ tokenEvents, onInspect, only })` — when `only` is a token `cls` string (`"user"`|`"agent"`|`"mcp"`), render only cards whose `TOKEN_META[id].cls === only`. When `only` is undefined, render all (today's behavior).

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/components/__tests__/TraceTokenSummary.only.test.jsx`:

```jsx
import { render, screen, fireEvent } from "@testing-library/react";
import TraceTokenSummary from "../TraceTokenSummary";

const EVENTS = [
  { id: "user-token", label: "User Token", claims: { sub: "u1", scope: "read" } },
  { id: "exchanged-token", label: "Delegated Token",
    claims: { sub: "u1", scope: "write", act: { sub: "agent-001" } } },
];

test("only='mcp' renders just the delegated token card", () => {
  render(<TraceTokenSummary tokenEvents={EVENTS} onInspect={() => {}} only="mcp" />);
  fireEvent.click(screen.getByText(/Token Summary/).closest("summary"));
  expect(screen.getByText("Delegated Token")).toBeInTheDocument();
  expect(screen.queryByText("User Token")).not.toBeInTheDocument();
  expect(screen.getByText(/Token Summary/).closest("details").querySelector(".tctr-count").textContent).toBe("1");
});

test("no 'only' renders all cards (default behavior)", () => {
  render(<TraceTokenSummary tokenEvents={EVENTS} onInspect={() => {}} />);
  fireEvent.click(screen.getByText(/Token Summary/).closest("summary"));
  expect(screen.getByText("User Token")).toBeInTheDocument();
  expect(screen.getByText("Delegated Token")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/TraceTokenSummary.only.test.jsx`
Expected: FAIL — first test finds "User Token" present.

- [ ] **Step 3: Implement the `only` filter**

In `TraceTokenSummary.jsx`, change the signature and the `tokens` derivation:

```jsx
export default function TraceTokenSummary({ tokenEvents, onInspect, only }) {
  const byId = Object.fromEntries((tokenEvents || []).map((e) => [e.id, e]));
  const tokens = Object.keys(TOKEN_META)
    .filter((id) => !only || TOKEN_META[id].cls === only)
    .map((id) => byId[id] && { id, evt: byId[id] })
    .filter(Boolean);
  if (!tokens.length) return null;
```

(Rest of the component unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/TraceTokenSummary.only.test.jsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/TraceTokenSummary.jsx \
        demo_api_ui/src/components/__tests__/TraceTokenSummary.only.test.jsx
git commit -m "feat(trace-rail): add optional 'only' filter to TraceTokenSummary"
```

---

### Task 2: `defaultOpen` prop on `TraceStepCard`

**Files:**
- Modify: `demo_api_ui/src/components/TraceStepCard.jsx`
- Test: `demo_api_ui/src/components/__tests__/TraceStepCard.defaultOpen.test.jsx` (create)

**Interfaces:**
- Produces: `TraceStepCard({ step, onInspect, defaultOpen })` — passes `defaultOpen` to the underlying `<details open={defaultOpen}>`. Default `false` (today's behavior: collapsed).

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/components/__tests__/TraceStepCard.defaultOpen.test.jsx`:

```jsx
import { render } from "@testing-library/react";
import TraceStepCard from "../TraceStepCard";

const STEP = { id: "mcp", title: "MCP server — tool executes", lane: "MCP",
  status: "done", detail: { narrative: "did a thing" } };

test("defaultOpen renders the card expanded", () => {
  const { container } = render(<TraceStepCard step={STEP} onInspect={() => {}} defaultOpen />);
  expect(container.querySelector("details.tctr-step")).toHaveAttribute("open");
});

test("without defaultOpen the card is collapsed", () => {
  const { container } = render(<TraceStepCard step={STEP} onInspect={() => {}} />);
  expect(container.querySelector("details.tctr-step")).not.toHaveAttribute("open");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/TraceStepCard.defaultOpen.test.jsx`
Expected: FAIL — first test: `details` has no `open` attribute.

- [ ] **Step 3: Implement the prop**

In `TraceStepCard.jsx`, change the signature and the `<details>` tag:

```jsx
export default function TraceStepCard({ step, onInspect, defaultOpen = false }) {
  const d = step.detail || {};
  return (
    <details className="tctr-step" data-status={step.status} open={defaultOpen}>
```

(Rest of the component unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/TraceStepCard.defaultOpen.test.jsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Verify the rail's default-collapsed test still passes**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/TokenChainTraceRail.test.jsx`
Expected: PASS — `details.tctr-step[open]` count still 0 by default.

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/components/TraceStepCard.jsx \
        demo_api_ui/src/components/__tests__/TraceStepCard.defaultOpen.test.jsx
git commit -m "feat(trace-rail): add defaultOpen prop to TraceStepCard"
```

---

### Task 3: `TraceMcpPanel` component + styles

**Files:**
- Create: `demo_api_ui/src/components/TraceMcpPanel.jsx`
- Modify: `demo_api_ui/src/components/TokenChainTraceRail.css`
- Test: `demo_api_ui/src/components/__tests__/TraceMcpPanel.test.jsx` (create)

**Interfaces:**
- Consumes: `TraceStepCard` (`{ step, onInspect, defaultOpen }` from Task 2), `TraceTokenSummary` (`{ tokenEvents, onInspect, only }` from Task 1).
- Produces:
  - `export const MCP_STEP_IDS = ["exchange", "gateway", "mcp", "api"]`
  - `export default function TraceMcpPanel({ steps, trace, onInspect })` — pure. Renders: delegated-token card (`only="mcp"`), the FULL tool execution from `trace.mcpResult` (metadata + full request + full response + raw payload dump, or empty state when null), and the `MCP_STEP_IDS` step cards rendered with `defaultOpen`.

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/components/__tests__/TraceMcpPanel.test.jsx`:

```jsx
import { render, screen } from "@testing-library/react";
import TraceMcpPanel from "../TraceMcpPanel";

const STEPS = [
  { id: "signin", title: "Sign-in", lane: "PINGONE", status: "done", detail: {} },
  { id: "exchange", title: "Token exchange — delegation", lane: "BFF", status: "done", detail: {} },
  { id: "gateway", title: "Agent Gateway — token validated", lane: "GATEWAY", status: "done", detail: {} },
  { id: "mcp", title: "MCP server — tool executes", lane: "MCP", status: "done", detail: {} },
  { id: "api", title: "Resource server — API call", lane: "API", status: "pending", detail: {} },
  { id: "reply", title: "LLM composes reply", lane: "LLM", status: "pending", detail: {} },
];

test("renders only the exchange/gateway/mcp/api steps, expanded", () => {
  const { container } = render(
    <TraceMcpPanel steps={STEPS} trace={{ tokenEvents: [], mcpResult: null }} onInspect={() => {}} />
  );
  expect(screen.getByText(/Token exchange — delegation/)).toBeInTheDocument();
  expect(screen.getByText(/Agent Gateway — token validated/)).toBeInTheDocument();
  expect(screen.getByText(/MCP server — tool executes/)).toBeInTheDocument();
  expect(screen.getByText(/Resource server — API call/)).toBeInTheDocument();
  expect(screen.queryByText(/Sign-in/)).not.toBeInTheDocument();
  expect(screen.queryByText(/LLM composes reply/)).not.toBeInTheDocument();
  // all MCP step cards expanded by default
  expect(container.querySelectorAll("details.tctr-step[open]")).toHaveLength(4);
});

test("shows empty state when no tool call yet", () => {
  render(<TraceMcpPanel steps={STEPS} trace={{ tokenEvents: [], mcpResult: null }} onInspect={() => {}} />);
  expect(screen.getByText(/No MCP tool call yet/i)).toBeInTheDocument();
});

test("renders the FULL request, response and raw payload from mcpResult", () => {
  const trace = {
    tokenEvents: [],
    mcpResult: { toolName: "get_balance", status: "success", duration: 42,
      isDelegated: true, scopes: ["accounts:read"],
      requestJson: { name: "get_balance", arguments: { account: "chk-001" } },
      resultJson: { balance: 1234, currency: "USD" } },
  };
  render(<TraceMcpPanel steps={STEPS} trace={trace} onInspect={() => {}} />);
  // metadata
  expect(screen.getByText(/get_balance/)).toBeInTheDocument();
  expect(screen.getByText(/42 ms/)).toBeInTheDocument();
  // full request + response present (not truncated)
  expect(screen.getByText(/chk-001/)).toBeInTheDocument();
  expect(screen.getByText(/"currency": "USD"/)).toBeInTheDocument();
  // section headers
  expect(screen.getByText(/^Request$/)).toBeInTheDocument();
  expect(screen.getByText(/^Response$/)).toBeInTheDocument();
  expect(screen.getByText(/Raw payload/)).toBeInTheDocument();
});

test("renders the delegated token card", () => {
  const trace = {
    tokenEvents: [{ id: "exchanged-token", label: "Delegated Token",
      claims: { sub: "u1", scope: "write", act: { sub: "agent-001" } } }],
    mcpResult: null,
  };
  render(<TraceMcpPanel steps={STEPS} trace={trace} onInspect={() => {}} />);
  expect(screen.getByText(/Delegated Token/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/TraceMcpPanel.test.jsx`
Expected: FAIL — `Cannot find module '../TraceMcpPanel'`.

- [ ] **Step 3: Create the component**

Create `demo_api_ui/src/components/TraceMcpPanel.jsx`:

```jsx
// MCP-focused view for the Token Chain rail's "MCP" tab. Pure component:
// filters the pipeline steps to the delegation-to-MCP portion and surfaces the
// delegated token plus the FULL tool execution (request + response + raw
// payload, untruncated). No store access.
import React from "react";
import TraceStepCard from "./TraceStepCard";
import TraceTokenSummary from "./TraceTokenSummary";

export const MCP_STEP_IDS = ["exchange", "gateway", "mcp", "api"];

const asJson = (v) => { try { return JSON.stringify(v, null, 2); } catch { return String(v); } };

export default function TraceMcpPanel({ steps, trace, onInspect }) {
  const mcpSteps = MCP_STEP_IDS
    .map((id) => (steps || []).find((s) => s.id === id))
    .filter(Boolean);
  const mcp = trace && trace.mcpResult;

  const toolName = mcp && (mcp.toolName || mcp.tool);
  const durationMs = mcp && (mcp.durationMs != null ? mcp.durationMs : mcp.duration);
  const response = mcp && (mcp.resultJson != null ? mcp.resultJson
    : mcp.result != null ? mcp.result : mcp.resultSummary);

  return (
    <div className="tctr-mcp">
      <div className="tctr-sec-label">Delegated token</div>
      <TraceTokenSummary tokenEvents={trace.tokenEvents} onInspect={onInspect} only="mcp" />

      <div className="tctr-sec-label">Tool execution</div>
      {mcp ? (
        <div className="tctr-step-body">
          <div className="tctr-kv">
            {toolName != null && (<><span className="tctr-kv-k">tool</span><span className="tctr-kv-v">{toolName}</span></>)}
            {mcp.status != null && (<><span className="tctr-kv-k">status</span><span className="tctr-kv-v">{String(mcp.status)}</span></>)}
            {durationMs != null && (<><span className="tctr-kv-k">duration</span><span className="tctr-kv-v">{durationMs} ms</span></>)}
            {mcp.isDelegated != null && (<><span className="tctr-kv-k">delegated</span><span className="tctr-kv-v">{String(mcp.isDelegated)}</span></>)}
            {Array.isArray(mcp.scopes) && (<><span className="tctr-kv-k">scopes</span><span className="tctr-kv-v">{mcp.scopes.join(" ")}</span></>)}
          </div>
          <h4>Request</h4>
          <pre className="tctr-code">{asJson(mcp.requestJson || { name: toolName })}</pre>
          <h4>Response</h4>
          <pre className="tctr-code">{response != null ? asJson(response) : "(no response body)"}</pre>
          <h4>Raw payload</h4>
          <pre className="tctr-code">{asJson(mcp)}</pre>
        </div>
      ) : (
        <div className="tctr-mcp-empty">No MCP tool call yet.</div>
      )}

      <div className="tctr-sec-label">MCP pipeline steps</div>
      {mcpSteps.map((step) => (
        <TraceStepCard key={step.id} step={step} onInspect={onInspect} defaultOpen />
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/TraceMcpPanel.test.jsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Add panel styles**

Append to `demo_api_ui/src/components/TokenChainTraceRail.css`:

```css
/* MCP tab panel */
.tctr-mcp .tctr-sec-label { padding-top: 12px; }
.tctr-mcp-empty {
  padding: 10px 12px; font-size: 12px; color: #64748b; font-style: italic;
}
```

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/components/TraceMcpPanel.jsx \
        demo_api_ui/src/components/__tests__/TraceMcpPanel.test.jsx \
        demo_api_ui/src/components/TokenChainTraceRail.css
git commit -m "feat(trace-rail): add TraceMcpPanel with full request/response/raw + expanded steps"
```

---

### Task 4: Tab bar in `TokenChainTraceRail`

**Files:**
- Modify: `demo_api_ui/src/components/TokenChainTraceRail.jsx`
- Modify: `demo_api_ui/src/components/TokenChainTraceRail.css`
- Test: `demo_api_ui/src/components/__tests__/TokenChainTraceRail.test.jsx` (extend)

**Interfaces:**
- Consumes: `TraceMcpPanel` and `MCP_STEP_IDS` from Task 3.
- Produces: rail with `const [tab, setTab] = useState("chain")`. A `.tctr-tabs` strip with two buttons: "Token Chain" and "MCP" + `.tctr-tab-count` badge = count of `MCP_STEP_IDS` steps with status `done`. When `tab==="mcp"`, chain line stays; section label / step list / summary / Exchange Mode Details accordion are replaced by `<TraceMcpPanel steps={steps} trace={trace} onInspect={onInspect} />`.

- [ ] **Step 1: Write the failing test**

Append to `demo_api_ui/src/components/__tests__/TokenChainTraceRail.test.jsx`:

```jsx
test("MCP tab shows the MCP panel and hides the full step list; chain line stays", () => {
  render(<TokenChainTraceRail />);
  fireEvent.click(screen.getByRole("button", { name: /^MCP/ }));
  expect(screen.getByText(/MCP server — tool executes/)).toBeInTheDocument();
  expect(screen.queryByText(/Sign-in — User Token acquired/)).not.toBeInTheDocument();
  expect(screen.queryByText(/LLM composes reply/)).not.toBeInTheDocument();
  expect(screen.getByText("CHAINED")).toBeInTheDocument();
  expect(screen.getByText(/No MCP tool call yet/i)).toBeInTheDocument();
});

test("Token Chain tab remains the default and shows all steps", () => {
  render(<TokenChainTraceRail />);
  expect(screen.getByText(/Sign-in — User Token acquired/)).toBeInTheDocument();
  expect(screen.getByText(/Exchange Mode Details/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/TokenChainTraceRail.test.jsx`
Expected: FAIL — no button named "MCP"; "Sign-in" still present after click.

- [ ] **Step 3: Add the import and tab state**

In `TokenChainTraceRail.jsx`, add after the `TraceTokenSummary` import:

```jsx
import TraceMcpPanel, { MCP_STEP_IDS } from "./TraceMcpPanel";
```

Add tab state with the other `useState` calls:

```jsx
  const [tab, setTab] = useState("chain");
```

After `const { steps, trace } = snap;` add:

```jsx
  const mcpDone = steps.filter((s) => MCP_STEP_IDS.includes(s.id) && s.status === "done").length;
```

- [ ] **Step 4: Add the tab strip and branch the body**

Insert the tab strip immediately after the closing `</div>` of `tctr-chain-line` (before `tctr-sec-label`):

```jsx
      <div className="tctr-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "chain"}
          className={`tctr-tab${tab === "chain" ? " tctr-tab--active" : ""}`}
          onClick={() => setTab("chain")}>
          Token Chain
        </button>
        <button type="button" role="tab" aria-selected={tab === "mcp"}
          className={`tctr-tab${tab === "mcp" ? " tctr-tab--active" : ""}`}
          onClick={() => setTab("mcp")}>
          MCP <span className="tctr-tab-count">{mcpDone}</span>
        </button>
      </div>
```

Replace the block from the `tctr-sec-label` div through the closing `</details>` of Exchange Mode Details with:

```jsx
      {tab === "chain" ? (
        <>
          <div className="tctr-sec-label">
            {trace.prompt ? `Pipeline — "${trace.prompt.message}"` : "Pipeline — awaiting agent action"}
          </div>

          {steps.map((step) => (
            <TraceStepCard key={step.id} step={step} onInspect={onInspect} />
          ))}

          <TraceTokenSummary tokenEvents={trace.tokenEvents} onInspect={onInspect} />

          {/* Role reference table — content that left ExchangeModeToggle (hideTable) */}
          <details className="tctr-acc">
            <summary><span className="tctr-chev">▶</span> Exchange Mode Details</summary>
            <div className="tctr-acc-body">
              <div className="tctr-kv" style={{ gridTemplateColumns: "70px 1fr" }}>
                <span className="tctr-kv-k" style={{ color: "#be185d" }}>User</span>
                <span className="tctr-kv-v">PingOne OIDC login → subject_token (RFC 8693 §1.1)</span>
                <span className="tctr-kv-k" style={{ color: "#7e22ce" }}>Agent</span>
                <span className="tctr-kv-v">client credentials → actor_token (RFC 8693 §1.1)</span>
                <span className="tctr-kv-k" style={{ color: "#047857" }}>MCP</span>
                <span className="tctr-kv-v">RFC 8693 exchange → delegated token with nested act claim</span>
              </div>
            </div>
          </details>
        </>
      ) : (
        <TraceMcpPanel steps={steps} trace={trace} onInspect={onInspect} />
      )}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/TokenChainTraceRail.test.jsx`
Expected: PASS (6 tests — 4 original + 2 new).

- [ ] **Step 6: Add the tab-strip styles**

Append to `demo_api_ui/src/components/TokenChainTraceRail.css`:

```css
/* Tab strip */
.tctr-tabs {
  display: flex; gap: 4px; padding: 8px 12px 0; border-bottom: 1px solid #e8eef7;
}
.tctr-tab {
  background: none; border: none; border-bottom: 2px solid transparent;
  padding: 6px 10px; font-size: 12px; font-weight: 600; color: #64748b;
  cursor: pointer; display: flex; align-items: center; gap: 5px;
}
.tctr-tab:hover { color: #16325c; }
.tctr-tab--active { color: #16325c; border-bottom-color: #16325c; }
.tctr-tab-count {
  font-size: 10.5px; font-weight: 700; color: #64748b;
  background: #eef2f9; border-radius: 999px; padding: 0 6px;
}
.tctr-tab--active .tctr-tab-count { background: #dbe4f0; color: #16325c; }
```

- [ ] **Step 7: Run all four suites once more**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/TokenChainTraceRail.test.jsx src/components/__tests__/TraceMcpPanel.test.jsx src/components/__tests__/TraceTokenSummary.only.test.jsx src/components/__tests__/TraceStepCard.defaultOpen.test.jsx`
Expected: PASS (all green).

- [ ] **Step 8: Commit**

```bash
git add demo_api_ui/src/components/TokenChainTraceRail.jsx \
        demo_api_ui/src/components/TokenChainTraceRail.css \
        demo_api_ui/src/components/__tests__/TokenChainTraceRail.test.jsx
git commit -m "feat(trace-rail): add Token Chain | MCP tab strip"
```

---

## Self-Review

**Spec coverage:**
- Tab bar under header (Token Chain | MCP) → Task 4.
- Default = today's behavior → Task 4 (chain branch verbatim) + "default" test; `only`/`defaultOpen` default off → Tasks 1, 2.
- MCP view keeps chain line → Task 4 (chain line outside the branch).
- Delegated-token card → Task 3 (`only="mcp"`) on Task 1.
- FULL tool execution: request + response + raw payload, untruncated → Task 3 (full `asJson`, no slicing).
- exchange→gateway→mcp→api steps expanded by default → Task 3 (`defaultOpen` from Task 2), asserted by `[open]` count = 4.
- Empty state → Task 3.
- Count badge (0 before completion) → Task 4 (`mcpDone`).
- Tests: `only`, `defaultOpen`, step filter, full request/response/raw, empty state, tab switch → Tasks 1–4.
- No backend changes → only UI files touched.

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `TraceMcpPanel({ steps, trace, onInspect })` + `MCP_STEP_IDS` defined Task 3, consumed Task 4. `TraceTokenSummary({ tokenEvents, onInspect, only })` defined Task 1, used Task 3. `TraceStepCard({ step, onInspect, defaultOpen })` defined Task 2, used Task 3. `trace.mcpResult` fields handle both SSE shape (`toolName`/`duration`/`resultJson`) and normalized shape (`tool`/`durationMs`/`result`) via fallbacks in Task 3.
