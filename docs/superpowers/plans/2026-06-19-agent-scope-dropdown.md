# Agent Scope Dropdown + Authorize Resilience — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the agent "Actions" popout legible and trustworthy — styled/explained scope control, non-clipping popout, three distinct chip grey-states — and stop spurious greying via discovery resilience plus a real→demo-authz gateway failover, with a once-per-session "using the demo authorize server" modal.

**Architecture:** Frontend changes are CSS + small component edits in `demo_api_ui`. Discovery resilience adds a retry + local-catalog degraded fallback in the BFF (`demo_api_server`) surfaced to the UI as a `degraded` flag. Gateway failover adds real→mock retry in the Node gateway (`demo_mcp_gateway`, TypeScript) and the PingGateway Groovy filter. A shared modal/badge fires once per session whenever the session is degraded or on `mock-failover`.

**Tech Stack:** React (vitest + @testing-library/react), Node/Express (jest), TypeScript gateway (jest/tsc), Groovy (PingGateway/IG — verified by integration, no unit harness).

## Global Constraints

- **No emojis in code/source** except the existing chip affordance glyphs already used in `BankingChips.css` (🔒) and the new ⚠ affordance for the unverified state — these are UI affordances, not decorative. (REGRESSION_PLAN §0.)
- **No low-contrast/muted hint text** in modals or helper text — solid high-contrast colors only.
- **Keep the chip→routing→MCP pipeline invariant** — never change chip `id` or `message` (skip-proof contract). Only labels/styling/permission-state may change.
- **Do not change the Authorize decision request/response contract** — failover reroutes on error only; the `parameters` payload and decision shape stay identical (`authz-server-parity`).
- **UI build gate:** `cd demo_api_ui && npm run build` must exit 0.
- **Keep option labels `Read only` / `Read + Write`** (teaching vocabulary) — add an explainer line, do not rename.
- **Stage files explicitly** (`git add <files>`), never `git add -A`. Verify `git branch --show-current` is `worktree-agent-scope-dropdown` before each commit. Commit with `--no-verify` only for docs; code commits run the hooks.

---

## Phase A — Actions popout UX (frontend, shippable on its own)

### Task 1: Scope control — explainer line + styling

**Files:**
- Modify: `demo_api_ui/src/components/ScopePicker.jsx`
- Modify: `demo_api_ui/src/components/BankingChips.css` (append scope-control styles)
- Test: `demo_api_ui/src/components/__tests__/ScopePicker.test.jsx` (create)

**Interfaces:**
- Consumes: nothing new.
- Produces: `ScopePicker` still calls `onChange(boolean)`; adds DOM nodes with classes `.agent-scope-picker-row`, `.scope-picker__hint`.

- [ ] **Step 1: Write the failing test**

```jsx
// demo_api_ui/src/components/__tests__/ScopePicker.test.jsx
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import ScopePicker from "../ScopePicker";

describe("ScopePicker", () => {
  it("keeps the Read only / Read + Write labels", () => {
    render(<ScopePicker allowWrite onChange={() => {}} />);
    expect(screen.getByRole("option", { name: "Read + Write" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Read only" })).toBeInTheDocument();
  });

  it("renders the explainer hint", () => {
    render(<ScopePicker allowWrite onChange={() => {}} />);
    expect(screen.getByText(/greys out write actions via PingOne Authorize/i)).toBeInTheDocument();
  });

  it("emits a boolean on change", () => {
    const onChange = vi.fn();
    render(<ScopePicker allowWrite onChange={onChange} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "ro" } });
    expect(onChange).toHaveBeenCalledWith(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/ScopePicker.test.jsx`
Expected: FAIL on the hint test ("Unable to find an element with the text … greys out write actions").

- [ ] **Step 3: Add the explainer line to the component**

Replace the body of `demo_api_ui/src/components/ScopePicker.jsx` (keep the file header comment) with:

```jsx
export default function ScopePicker({ allowWrite, onChange, disabled = false }) {
  return (
    <div className="agent-scope-picker-row">
      <label className="scope-picker" title="Controls the scopes the agent token requests. Read-only greys out write-action chips via PingOne Authorize.">
        <span className="scope-picker__label">Agent scope</span>
        <select
          className="scope-picker__select"
          value={allowWrite ? "rw" : "ro"}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value === "rw")}
        >
          <option value="rw">Read + Write</option>
          <option value="ro">Read only</option>
        </select>
      </label>
      <p className="scope-picker__hint">
        Controls the OAuth scopes in the agent&apos;s token. &ldquo;Read only&rdquo; greys out write actions via PingOne Authorize.
      </p>
    </div>
  );
}
```

Note: the `.agent-scope-picker-row` wrapper currently lives in `AIAgent.js` around `<ScopePicker>`. Move it into the component as above and remove the wrapping `<div className="agent-scope-picker-row">` in `AIAgent.js` (the JSX at the `{isLoggedIn && (<div className="agent-scope-picker-row"><ScopePicker …/></div>)}` block becomes `{isLoggedIn && (<ScopePicker allowWrite={agentAllowWrite} disabled={agentToolsLoading} onChange={setAgentAllowWrite} />)}`).

- [ ] **Step 4: Add the CSS**

Append to `demo_api_ui/src/components/BankingChips.css`:

```css
/* Agent scope control — sits above the chip sections inside the popout. */
.agent-scope-picker-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
  border-bottom: 1px solid var(--ba-border, #e5e7eb);
}
.scope-picker {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.scope-picker__label {
  font-size: 12px;
  font-weight: 600;
  color: var(--ba-text, #1f2937);
}
.scope-picker__select {
  flex: 0 0 auto;
  min-width: 130px;
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 500;
  color: var(--ba-text, #1f2937);
  background: var(--ba-bg, #ffffff);
  border: 1px solid var(--ba-border, #d1d5db);
  border-radius: 6px;
  cursor: pointer;
}
.scope-picker__select:focus {
  outline: none;
  border-color: #4169e1;
  box-shadow: 0 0 0 2px rgba(65, 105, 225, 0.3);
}
.scope-picker__select:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.scope-picker__hint {
  margin: 0;
  font-size: 11px;
  line-height: 1.4;
  color: var(--ba-text, #1f2937);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/ScopePicker.test.jsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Verify build + visual**

Run: `cd demo_api_ui && npm run build`
Expected: exit 0. Then visually confirm in the running app that the scope control is a styled row with the hint line (not a raw select).

- [ ] **Step 7: Commit**

```bash
git add demo_api_ui/src/components/ScopePicker.jsx demo_api_ui/src/components/BankingChips.css demo_api_ui/src/components/AIAgent.js demo_api_ui/src/components/__tests__/ScopePicker.test.jsx
git commit -m "feat(ui): style agent scope control + add explainer line"
```

---

### Task 2: Popout sizing — stop the clipping

**Files:**
- Modify: `demo_api_ui/src/components/AIAgent.css:4707-4712` (`.ba-actions-popout`)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing (CSS only).

CSS is not unit-tested; this task verifies by build + visual check.

- [ ] **Step 1: Widen + raise the popout**

In `demo_api_ui/src/components/AIAgent.css`, change `.ba-actions-popout`:

```css
.ba-actions-popout {
  position: fixed;
  /* top/left set dynamically by JS — escapes panel overflow:hidden */
  width: 360px;
  max-height: 70vh;
  overflow-y: auto;
  scrollbar-width: none;
  background: var(--ba-surface);
  border: 1px solid var(--ba-border);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(10, 20, 50, 0.45);
  z-index: 100061;
  animation: popout-slide-in 0.15s ease;
}
```

- [ ] **Step 2: Verify build**

Run: `cd demo_api_ui && npm run build`
Expected: exit 0.

- [ ] **Step 3: Visual check**

In the running app, open the Actions popout on the smallest supported viewport. Confirm the scope row + full chip grid + a bottom-edge chip tooltip are all visible with no clipping (scroll appears only when content truly exceeds 70vh).

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/components/AIAgent.css
git commit -m "fix(ui): widen actions popout + raise max-height so chips/tooltips don't clip"
```

---

### Task 3: Three distinct chip grey-states

**Files:**
- Modify: `demo_api_ui/src/components/BankingChips.jsx:160-173` (tooltip + class for `unverified`)
- Modify: `demo_api_ui/src/components/BankingChips.css` (append `--unverified` style)
- Test: `demo_api_ui/src/components/__tests__/BankingChips.states.test.jsx` (create)

**Interfaces:**
- Consumes: existing `chipPermState` results (`denied`, `unverified`), `llmDisabled`.
- Produces: chip buttons gain class `banking-chips-dropdown__button--unverified` when `perm.unverified`.

- [ ] **Step 1: Write the failing test**

```jsx
// demo_api_ui/src/components/__tests__/BankingChips.states.test.jsx
import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import BankingChips from "../BankingChips";

vi.mock("../../vertical/useVertical", () => ({
  useVertical: () => ({
    pageManifest: {
      identity: { displayName: "CareConnect" },
      dashboard: {
        chips10: [
          { id: "rec", label: "My records", message: "show my records", mode: "both", tool: "get_records" },
        ],
      },
    },
  }),
}));

describe("BankingChips grey states", () => {
  it("marks an unverified (Authorize-unreachable) chip with the --unverified class", () => {
    render(
      <BankingChips
        user={{ role: "user" }}
        toolPermissions={{}}
        toolsError
        onChipClick={() => {}}
      />,
    );
    const btn = screen.getByText("My records").closest("button");
    expect(btn.className).toContain("banking-chips-dropdown__button--unverified");
    expect(btn).toHaveAttribute(
      "title",
      expect.stringContaining("couldn't reach PingOne or the demo authorize server"),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/BankingChips.states.test.jsx`
Expected: FAIL (class `--unverified` absent; old tooltip text).

- [ ] **Step 3: Add the unverified class + reword tooltip**

In `demo_api_ui/src/components/BankingChips.jsx`, in the curated-chip `<button>` (the `chips10.map` block), update the `className` and the `unverified` tooltip branch:

```jsx
className={`banking-chips-dropdown__button banking-chips-dropdown__button--${isDirect ? "direct" : isLlm ? "llm" : "heuristic"}${perm.denied ? " banking-chips-dropdown__button--denied" : ""}${perm.unverified ? " banking-chips-dropdown__button--unverified" : ""}`}
```

And the tooltip `unverified` branch:

```jsx
perm.unverified
  ? "Authorize unavailable — couldn't reach PingOne or the demo authorize server. Retry shortly."
```

(Leave the `denied` and `llmDisabled` branches as-is — they are already distinct.)

- [ ] **Step 4: Add the ⚠ affordance CSS**

Append to `demo_api_ui/src/components/BankingChips.css`:

```css
/* Authorize-unreachable chip (both backends down): distinct from scope-denied (🔒).
   Warning affordance, label stays high-contrast. */
.banking-chips-dropdown__button--unverified {
  border-style: dashed;
  border-color: #c0600a;
  color: var(--ba-text, #1f2937);
  position: relative;
}
.banking-chips-dropdown__button--unverified::before {
  content: "⚠";
  margin-right: 4px;
  font-size: 11px;
  color: #c0600a;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/BankingChips.states.test.jsx`
Expected: PASS.

- [ ] **Step 6: Build**

Run: `cd demo_api_ui && npm run build`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add demo_api_ui/src/components/BankingChips.jsx demo_api_ui/src/components/BankingChips.css demo_api_ui/src/components/__tests__/BankingChips.states.test.jsx
git commit -m "feat(ui): distinct affordance + tooltip for the Authorize-unreachable chip state"
```

---

## Phase B — Discovery resilience (BFF + UI)

### Task 4: BFF retry-once + local-catalog degraded fallback

**Files:**
- Modify: `demo_api_server/services/agentToolsResolver.js`
- Modify: `demo_api_server/routes/demoAgentRoutes.js:124-147` (pass `degraded` through)
- Test: `demo_api_server/src/__tests__/agentToolsResolver.degraded.test.js` (create)

**Interfaces:**
- Consumes: `agentGatewayClient.listAvailableTools`, `agentGatewayClient.getLocalToolsCatalog`.
- Produces: `resolveAvailableTools` returns `{ availableTools, tokenEvents, scopes, degraded?: boolean, degradedReason?: string }`. The `/tools` route includes `degraded`, `degradedReason` in its JSON.

- [ ] **Step 1: Write the failing test**

```js
// demo_api_server/src/__tests__/agentToolsResolver.degraded.test.js
jest.mock('../../services/agentScopes', () => ({ resolveAgentScopes: () => ['read'] }));
jest.mock('../../services/agentTokenCache', () => ({
  get: () => ({ access_token: 'tok', expires_in: 600 }),
  set: () => {},
}));
jest.mock('../../services/agentMcpTokenService', () => ({
  resolveMcpAccessTokenWithEvents: jest.fn(),
}));
jest.mock('../../services/agentGatewayClient', () => ({
  listAvailableTools: jest.fn(),
  getLocalToolsCatalog: () => [
    { name: 'get_my_accounts', requiredScopes: ['read'], readOnly: true },
  ],
}));

const gw = require('../../services/agentGatewayClient');
const { resolveAvailableTools } = require('../../services/agentToolsResolver');

const req = { session: {}, agentContext: { userId: 'u1' }, tokenEvents: [] };

describe('resolveAvailableTools degraded fallback', () => {
  beforeEach(() => jest.clearAllMocks());

  it('retries once then returns the local catalog with degraded=true', async () => {
    gw.listAvailableTools
      .mockRejectedValueOnce(new Error('ws closed'))
      .mockRejectedValueOnce(new Error('ws closed again'));
    const res = await resolveAvailableTools(req, { vertical: 'banking', allowWrite: true });
    expect(gw.listAvailableTools).toHaveBeenCalledTimes(2);
    expect(res.degraded).toBe(true);
    expect(res.degradedReason).toBe('discovery_unreachable');
    expect(res.availableTools.every((t) => t.permitted === true)).toBe(true);
    expect(res.availableTools[0].name).toBe('get_my_accounts');
  });

  it('does not fall back when discovery succeeds on retry', async () => {
    gw.listAvailableTools
      .mockRejectedValueOnce(new Error('blip'))
      .mockResolvedValueOnce({ tools: [{ name: 'x', permitted: true }] });
    const res = await resolveAvailableTools(req, { vertical: 'banking', allowWrite: true });
    expect(res.degraded).toBeFalsy();
    expect(res.availableTools[0].name).toBe('x');
  });

  it('rethrows a need_auth error without degrading', async () => {
    const e = new Error('Session expired'); e.code = 'need_auth'; e.httpStatus = 401;
    gw.listAvailableTools.mockRejectedValue(e);
    await expect(resolveAvailableTools(req, { vertical: 'banking', allowWrite: true }))
      .rejects.toMatchObject({ code: 'need_auth' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest src/__tests__/agentToolsResolver.degraded.test.js`
Expected: FAIL (`listAvailableTools` called once; no `degraded`).

- [ ] **Step 3: Implement retry + degraded fallback**

In `demo_api_server/services/agentToolsResolver.js`, replace the discovery call (line 66-73) with a retry-once + catalog fallback. The `need_auth` path from the token exchange (lines 55-61) is unchanged and still throws.

```js
  const userSub = (req.agentContext && req.agentContext.userId) || null;

  // Discovery can blip (WS to the Node gateway, or the gateway → authz hop).
  // Retry once; if it still fails for a non-auth reason, degrade to the local
  // catalog (all permitted) so chips stay usable rather than greying out.
  const listOnce = () =>
    agentGatewayClient.listAvailableTools(req, tok.access_token, { vertical, userSub });

  let result;
  try {
    result = await listOnce();
  } catch (firstErr) {
    if (firstErr && firstErr.code === 'need_auth') throw firstErr;
    await new Promise((r) => setTimeout(r, 400));
    try {
      result = await listOnce();
    } catch (secondErr) {
      if (secondErr && secondErr.code === 'need_auth') throw secondErr;
      const catalog = (agentGatewayClient.getLocalToolsCatalog() || []).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema || {},
        requiredScopes: t.requiredScopes || ['read'],
        readOnly: t.readOnly ?? true,
        permitted: true,
      }));
      return {
        availableTools: catalog,
        tokenEvents: (req.tokenEvents || []).slice(),
        scopes,
        degraded: true,
        degradedReason: 'discovery_unreachable',
      };
    }
  }

  return {
    availableTools: result.tools || [],
    tokenEvents: (req.tokenEvents || []).slice(),
    scopes,
  };
```

- [ ] **Step 4: Pass `degraded` through the route**

In `demo_api_server/routes/demoAgentRoutes.js`, in `POST /tools`, change the success return to forward the new fields:

```js
    const { availableTools, tokenEvents, degraded, degradedReason } = await resolveAvailableTools(req, { vertical, allowWrite });
    return res.json({ vertical, allowWrite, availableTools, tokenEvents, degraded: !!degraded, degradedReason: degradedReason || null });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd demo_api_server && npx jest src/__tests__/agentToolsResolver.degraded.test.js`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/services/agentToolsResolver.js demo_api_server/routes/demoAgentRoutes.js demo_api_server/src/__tests__/agentToolsResolver.degraded.test.js
git commit -m "feat(agent): retry-once + local-catalog degraded fallback for tool discovery"
```

---

### Task 5: UI degraded handling + once-per-session modal/badge

**Files:**
- Modify: `demo_api_ui/src/services/demoAgentService.js:78-95` (`fetchAgentTools` surfaces `degraded`)
- Create: `demo_api_ui/src/components/DemoAuthzFallbackModal.jsx`
- Create: `demo_api_ui/src/components/DemoAuthzFallbackModal.css`
- Modify: `demo_api_ui/src/components/AIAgent.js` (degraded state → modal + badge)
- Test: `demo_api_ui/src/services/__tests__/fetchAgentTools.degraded.test.js` (create)

**Interfaces:**
- Consumes: `/api/demo-agent/tools` JSON now has `degraded`, `degradedReason`.
- Produces: `fetchAgentTools` returns `{ availableTools, vertical, allowWrite, degraded, degradedReason, error? }`. `DemoAuthzFallbackModal` is a default export `({ open, onClose }) => JSX`.

- [ ] **Step 1: Write the failing test for fetchAgentTools**

```js
// demo_api_ui/src/services/__tests__/fetchAgentTools.degraded.test.js
import { fetchAgentTools } from "../demoAgentService";

describe("fetchAgentTools degraded passthrough", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("surfaces degraded + degradedReason from the response", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        availableTools: [{ name: "get_my_accounts", permitted: true }],
        vertical: "banking",
        allowWrite: true,
        degraded: true,
        degradedReason: "discovery_unreachable",
      }),
    });
    const res = await fetchAgentTools({ vertical: "banking", allowWrite: true });
    expect(res.degraded).toBe(true);
    expect(res.degradedReason).toBe("discovery_unreachable");
    expect(res.availableTools[0].name).toBe("get_my_accounts");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/services/__tests__/fetchAgentTools.degraded.test.js`
Expected: FAIL (`res.degraded` is undefined).

- [ ] **Step 3: Surface degraded in fetchAgentTools**

In `demo_api_ui/src/services/demoAgentService.js`, update the success return of `fetchAgentTools`:

```js
  const data = await res.json().catch(() => ({}));
  return {
    availableTools: Array.isArray(data.availableTools) ? data.availableTools : [],
    vertical: data.vertical ?? vertical,
    allowWrite: data.allowWrite ?? allowWrite,
    degraded: !!data.degraded,
    degradedReason: data.degradedReason || null,
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/services/__tests__/fetchAgentTools.degraded.test.js`
Expected: PASS.

- [ ] **Step 5: Create the modal component**

```jsx
// demo_api_ui/src/components/DemoAuthzFallbackModal.jsx
import React from "react";
import DraggableModal from "./DraggableModal";
import "./DemoAuthzFallbackModal.css";

/**
 * Shown once per session when authorization decisions fall back to the local
 * demo authorize server (PingOne Authorize / the discovery path was unreachable).
 */
export default function DemoAuthzFallbackModal({ open, onClose }) {
  if (!open) return null;
  return (
    <DraggableModal title="Using the demo authorize server" onClose={onClose}>
      <div className="demo-authz-fallback">
        <p className="demo-authz-fallback__body">
          PingOne Authorize was unreachable, so authorization decisions are being
          handled by the local demo authorize server. Functionality is unaffected;
          decisions may differ from production policy.
        </p>
        <button type="button" className="demo-authz-fallback__ok" onClick={onClose}>
          Got it
        </button>
      </div>
    </DraggableModal>
  );
}
```

```css
/* demo_api_ui/src/components/DemoAuthzFallbackModal.css */
.demo-authz-fallback {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.demo-authz-fallback__body {
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
  color: var(--ba-text, #1f2937);
}
.demo-authz-fallback__ok {
  align-self: flex-end;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 600;
  color: #ffffff;
  background: #4169e1;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}
.demo-authz-fallback__ok:hover {
  background: #3658c5;
}
```

Note: confirm `DraggableModal`'s prop names (`title`, `onClose`, children) by reading `demo_api_ui/src/components/DraggableModal.jsx` before wiring; adapt the prop names to match the existing component.

- [ ] **Step 6: Wire degraded state into AIAgent.js**

In `demo_api_ui/src/components/AIAgent.js`, near the existing tools-fetch state (around line 2831-2862):

Add state + a session-scoped "modal already shown" guard:

```js
  const [degradedAuthz, setDegradedAuthz] = useState(false);
  const [showAuthzFallbackModal, setShowAuthzFallbackModal] = useState(false);
  const authzFallbackShownRef = useRef(false);
```

In the `fetchAgentTools(...).then((res) => …)` handler, after `setAvailableTools(...)`, branch on degraded:

```js
        if (res && res.error) {
          setAgentToolsError(true);
        } else {
          setAvailableTools((res && res.availableTools) || []);
          setAgentToolsError(false);
          const isDegraded = !!(res && res.degraded);
          setDegradedAuthz(isDegraded);
          if (isDegraded && !authzFallbackShownRef.current) {
            authzFallbackShownRef.current = true;
            setShowAuthzFallbackModal(true);
          }
          if (!isDegraded) setDegradedAuthz(false);
        }
```

Render the modal (near the other agent modals) and a badge in the popout. Add the badge next to the scope row inside the `showDiscovery` popout:

```jsx
{degradedAuthz && (
  <div className="ba-authz-degraded-badge" title="PingOne Authorize unreachable — using the demo authorize server">
    Demo Authorize
  </div>
)}
```

```jsx
<DemoAuthzFallbackModal
  open={showAuthzFallbackModal}
  onClose={() => setShowAuthzFallbackModal(false)}
/>
```

Add the import at the top of `AIAgent.js`:

```js
import DemoAuthzFallbackModal from "./DemoAuthzFallbackModal";
```

Add the badge style to `demo_api_ui/src/components/AIAgent.css`:

```css
.ba-authz-degraded-badge {
  margin: 8px 12px 0;
  padding: 4px 8px;
  font-size: 11px;
  font-weight: 600;
  color: #c0600a;
  background: rgba(230, 126, 34, 0.12);
  border: 1px solid rgba(230, 126, 34, 0.3);
  border-radius: 6px;
  text-align: center;
}
```

- [ ] **Step 7: Build + verify**

Run: `cd demo_api_ui && npm run build`
Expected: exit 0.

Then run the full chips test file to confirm no regression:
Run: `cd demo_api_ui && npx vitest run src/components/__tests__/AIAgent.chips.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add demo_api_ui/src/services/demoAgentService.js demo_api_ui/src/components/DemoAuthzFallbackModal.jsx demo_api_ui/src/components/DemoAuthzFallbackModal.css demo_api_ui/src/components/AIAgent.js demo_api_ui/src/components/AIAgent.css demo_api_ui/src/services/__tests__/fetchAgentTools.degraded.test.js
git commit -m "feat(ui): degraded-authz badge + once-per-session demo-authorize modal"
```

---

## Phase C — Real→mock gateway failover

### Task 6: Node gateway PingOneAuthorizeClient failover

**Files:**
- Modify: `demo_mcp_gateway/src/auth/PingOneAuthorizeClient.ts:25-34` (`AuthzDecision` type), `:157-218` (`evaluate`)
- Modify: the `GatewayConfig` type + config loader to add `pingAuthorizeMockBase` (find via `grep -rn "pingAuthorizeEndpoint" demo_mcp_gateway/src`)
- Test: `demo_mcp_gateway/test/PingOneAuthorizeClient.failover.test.ts` (create; mirror the existing test dir convention — confirm with `find demo_mcp_gateway -name '*.test.ts' | head`)

**Interfaces:**
- Consumes: `axios`, `this.config.pingAuthorizeEndpoint`, new `this.config.pingAuthorizeMockBase`.
- Produces: `AuthzDecision` gains `engine?: 'real' | 'mock' | 'mock-failover'`. `evaluate()` returns `engine` on every path.

- [ ] **Step 1: Write the failing test**

```ts
// demo_mcp_gateway/test/PingOneAuthorizeClient.failover.test.ts
import axios from 'axios';
import { PingOneAuthorizeClient } from '../src/auth/PingOneAuthorizeClient';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const baseConfig: any = {
  pingAuthorizeEndpoint: 'https://real.example/authz',
  pingAuthorizeMockBase: 'http://authz-server:9001',
  pingAuthorizeWorkerId: 'mcp-gateway',
  gatewayResourceUri: 'mcpgateway.ping.demo',
  mcpGwP1azEnabled: true,
};
const decoded: any = { sub: 'u1', scope: 'read', act: { sub: 'agent' } };

describe('PingOneAuthorizeClient real->mock failover', () => {
  beforeEach(() => jest.clearAllMocks());

  it('fails over to the mock base when the real endpoint errors', async () => {
    mockedAxios.post
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))            // real
      .mockResolvedValueOnce({ data: { decision: 'PERMIT' } });    // mock
    const client = new PingOneAuthorizeClient(baseConfig);
    const d = await client.evaluate(decoded, 'tools/list');
    expect(d.decision).toBe('PERMIT');
    expect(d.engine).toBe('mock-failover');
    expect(mockedAxios.post).toHaveBeenLastCalledWith(
      expect.stringContaining('http://authz-server:9001/governance/'),
      expect.anything(),
      expect.anything(),
    );
  });

  it('does NOT fail over on a valid real DENY', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { decision: 'DENY' } });
    const client = new PingOneAuthorizeClient(baseConfig);
    const d = await client.evaluate(decoded, 'tools/list');
    expect(d.decision).toBe('DENY');
    expect(d.engine).toBe('real');
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  it('does NOT fail over when primary already equals the mock', async () => {
    mockedAxios.post.mockRejectedValueOnce(new Error('down'));
    const client = new PingOneAuthorizeClient({ ...baseConfig, pingAuthorizeEndpoint: 'http://authz-server:9001' });
    const d = await client.evaluate(decoded, 'tools/list');
    expect(d.decision).toBe('DENY');
    expect(d.engine).toBe('mock');
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_mcp_gateway && npx jest test/PingOneAuthorizeClient.failover.test.ts`
Expected: FAIL (`engine` undefined; no failover).

- [ ] **Step 3: Add `engine` to the type + `pingAuthorizeMockBase` to config**

In `demo_mcp_gateway/src/auth/PingOneAuthorizeClient.ts`, extend `AuthzDecision`:

```ts
export interface AuthzDecision {
  decision: AuthzDecisionOutcome;
  reason?: string;
  decisionId?: string;
  policyVersion?: string;
  traceId?: string;
  engine?: 'real' | 'mock' | 'mock-failover';
}
```

Add `pingAuthorizeMockBase?: string` to the `GatewayConfig` interface and read `process.env.PINGAUTHORIZE_MOCK_BASE` where the config is built (locate with the grep above; add the field next to `pingAuthorizeEndpoint`).

- [ ] **Step 4: Implement failover in evaluate()**

Replace the `try { … } catch { … }` block (lines ~191-217) with a helper that posts to a base + a failover wrapper:

```ts
    const postDecision = async (base: string) =>
      axios.post(
        `${base}/governance/pap/alpha/policy/${this.config.pingAuthorizeWorkerId}/decision`,
        body,
        { timeout: 5000, headers: { 'Content-Type': 'application/json' } },
      );

    const toDecision = (data: any, engine: AuthzDecision['engine']): AuthzDecision => {
      const outcome: string = data?.decision ?? 'DENY';
      const meta = {
        decisionId: (data?.decision_id ?? data?.decisionId) as string | undefined,
        policyVersion: (data?.policy_version ?? data?.policyVersion) as string | undefined,
        traceId: (data?.trace_id ?? data?.traceId) as string | undefined,
        engine,
      };
      if (outcome === 'PERMIT') return { decision: 'PERMIT', ...meta };
      if (outcome === 'INDETERMINATE') return { decision: 'INDETERMINATE', reason: 'HITL_REQUIRED', ...meta };
      return { decision: 'DENY', reason: `PingAuthorize decision: ${outcome}`, ...meta };
    };

    const primary = this.config.pingAuthorizeEndpoint;
    const mockBase = this.config.pingAuthorizeMockBase;
    const canFailover = !!mockBase && mockBase !== primary;
    const primaryEngine: AuthzDecision['engine'] = canFailover ? 'real' : 'mock';

    try {
      const response = await postDecision(primary);
      // A 5xx (axios throws by default) lands in catch; a 200 + DENY is a valid
      // decision and must NOT trigger failover.
      return toDecision(response.data, primaryEngine);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (canFailover) {
        try {
          const fb = await postDecision(mockBase as string);
          console.warn('[PingOneAuthorizeClient] real Authorize unreachable — failed over to mock:', msg);
          return toDecision(fb.data, 'mock-failover');
        } catch (fbErr) {
          const fbMsg = fbErr instanceof Error ? fbErr.message : String(fbErr);
          console.warn('[PingOneAuthorizeClient] mock failover also unreachable — failing closed:', fbMsg);
          return { decision: 'DENY', reason: 'Authorization service unavailable', engine: 'mock-failover' };
        }
      }
      console.warn('[PingOneAuthorizeClient] Authorize endpoint unavailable — failing closed:', msg);
      return { decision: 'DENY', reason: 'Authorization service unavailable', engine: primaryEngine };
    }
```

Also add `engine: primaryEngine` to the unconfigured-DENY early return (line ~175): `return { decision: 'DENY', reason: '… set PINGAUTHORIZE_ENDPOINT', engine: 'mock' };`

- [ ] **Step 5: Surface `engine` in the WS tools/list `_meta`**

Find where `evaluate()`'s result is attached to the `tools/list` response (`grep -rn "deniedTools\|_meta" demo_mcp_gateway/src`). Add the decision `engine` to the result `_meta` (e.g. `_meta.authzEngine = decision.engine`) so the BFF/UI can read it. If the discovery path does not currently carry `_meta.authzEngine`, add it minimally alongside `deniedTools`.

- [ ] **Step 6: Run test to verify it passes**

Run: `cd demo_mcp_gateway && npx jest test/PingOneAuthorizeClient.failover.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Typecheck/build**

Run: `cd demo_mcp_gateway && npm run build` (or `npx tsc --noEmit`)
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add demo_mcp_gateway/src/auth/PingOneAuthorizeClient.ts demo_mcp_gateway/test/PingOneAuthorizeClient.failover.test.ts
# plus the GatewayConfig + _meta files you touched
git commit -m "feat(gateway): real->mock Authorize failover with engine signal"
```

---

### Task 7: PingGateway Groovy real→mock failover

**Files:**
- Modify: `ping-gateway/scripts/groovy/p1az-decision.groovy:276-297` (decision call block)

**Interfaces:**
- Consumes: existing `httpPost`, `callDecision`, `mockBase`, `realBase`, `simulated`.
- Produces: audit trail `backend: 'mock-failover'` when failover occurs.

Groovy in IG has no unit harness here; verify by integration (Step 3).

- [ ] **Step 1: Add failover to the decision call**

In `ping-gateway/scripts/groovy/p1az-decision.groovy`, replace the decision `try { … } catch { … }` block (lines ~276-297) with a version that fails over to the mock base when the real backend is unreachable. Track a `failoverUsed` flag and a mutable `backendLabel`:

```groovy
def rawResponseBody = ''
def outcome = 'DENY'
def authorizeFullResponse = [:]
def failoverUsed = false
try {
    def bearer = simulated ? null : getWorkerToken()
    def r = callDecision(bearer)
    // REAL backend: on 401, refresh the worker token once and retry.
    if (!simulated && r.code == 401) {
        binding._p1azTokenCache = [token: null, expiresAt: 0L]
        bearer = fetchWorkerToken()
        r = callDecision(bearer)
    }
    // REAL backend connectivity failure (httpPost returns code 0) or 5xx → fail
    // over to the mock base. A 200 + DENY is a valid decision and is NOT a failure.
    if (!simulated && (r.code == 0 || r.code >= 500) && mockBase && mockBase != realBase) {
        logger.warn('[P1AZ] REAL backend unreachable (HTTP ' + r.code + ') — failing over to MOCK')
        def mockUrl = mockBase.replaceAll('/$', '') + '/governance/pap/alpha/policy/' + workerId + '/decision'
        def fb = httpPost(mockUrl, requestBody, ['Content-Type': 'application/json'])
        if (fb.code == 200) {
            failoverUsed = true
            r = fb
        }
    }
    rawResponseBody = r.body ?: ''
    logger.info('[P1AZ] RESPONSE HTTP ' + r.code + ' ← ' + (failoverUsed ? 'MOCK-FAILOVER' : (simulated ? 'MOCK' : 'REAL')) + ' | body=' + rawResponseBody)
    def parsed = rawResponseBody ? new JsonSlurper().parseText(rawResponseBody) : [:]
    authorizeFullResponse = parsed ?: [:]
    outcome = parsed?.decision ?: 'DENY'
} catch (Exception e) {
    logger.warn('[P1AZ] Decision call failed — failing closed: ' + e.message)
    outcome = 'DENY'
    authorizeFullResponse = [error: e.message]
}

def backendLabel = failoverUsed ? 'mock-failover' : (simulated ? 'mock' : 'real')
```

Then replace the two `backend : simulated ? 'mock' : 'real'` occurrences in the audit trail (line ~306) and the DENY response body (line ~338) with `backend : backendLabel`, and the DECISION log line (~299) to use `backendLabel`.

- [ ] **Step 2: Restart the gateway with the script**

Run: `docker restart ai-demo-ping-gateway` (the groovy is mounted; confirm with `docker exec ai-demo-ping-gateway ls /opt/ig/scripts/groovy` or the project's gateway redeploy step).

- [ ] **Step 3: Integration verify**

With `ff_authorize_simulated=false` (real mode) and `P1AZ_REAL_BASE` pointed at an unreachable host but `P1AZ_MOCK_BASE=http://authz-server:9001` healthy: issue a `tools/call` through the gateway (host port 3036) and confirm the `X-Gw-Audit-Trail` response header reports `backend: "mock-failover"` and the request is permitted. Then point `P1AZ_REAL_BASE` back to a healthy real endpoint and confirm `backend: "real"`. Confirm a real `DENY` still denies (no failover).

Check logs: `docker logs ai-demo-ping-gateway --since 5m 2>&1 | grep -i 'failing over\|MOCK-FAILOVER\|DECISION'`

- [ ] **Step 4: Commit**

```bash
git add ping-gateway/scripts/groovy/p1az-decision.groovy
git commit -m "feat(pinggateway): real->mock Authorize failover in p1az-decision filter"
```

---

## Phase D — Wire-through + regression

### Task 8: Surface gateway `engine: mock-failover` to the UI degraded state

**Files:**
- Modify: `demo_api_server/services/agentToolsResolver.js` (read `_meta.authzEngine` from the gateway result)
- Modify: `demo_api_server/routes/demoAgentRoutes.js` (already returns `degraded`; also return when engine is `mock-failover`)
- Test: extend `demo_api_server/src/__tests__/agentToolsResolver.degraded.test.js`

**Interfaces:**
- Consumes: `result._meta?.authzEngine` from `listAvailableTools` (added in Task 6 Step 5). Confirm `normalizeGatewayTools`/`listAvailableTools` forwards `_meta` — if it drops it, thread `authzEngine` out of `listAvailableTools`'s return as `{ tools, authzEngine }`.
- Produces: `resolveAvailableTools` sets `degraded: true, degradedReason: 'authz_failover'` when the gateway reports `mock-failover` (in addition to the discovery-unreachable case).

- [ ] **Step 1: Add the failing test case**

Append to `agentToolsResolver.degraded.test.js`:

```js
  it('marks degraded when the gateway reports a mock-failover engine', async () => {
    gw.listAvailableTools.mockResolvedValueOnce({
      tools: [{ name: 'x', permitted: true }],
      authzEngine: 'mock-failover',
    });
    const res = await resolveAvailableTools(req, { vertical: 'banking', allowWrite: true });
    expect(res.degraded).toBe(true);
    expect(res.degradedReason).toBe('authz_failover');
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd demo_api_server && npx jest src/__tests__/agentToolsResolver.degraded.test.js -t "mock-failover"`
Expected: FAIL.

- [ ] **Step 3: Read + forward the engine**

In `demo_api_server/services/agentGatewayClient.js` `listAvailableTools`, return `authzEngine` from the gateway result: `return { tools: normalizeGatewayTools(result), authzEngine: result?._meta?.authzEngine || null };`

In `resolveAvailableTools`, after a successful `result = await listOnce()`:

```js
  const degradedByFailover = result.authzEngine === 'mock-failover';
  return {
    availableTools: result.tools || [],
    tokenEvents: (req.tokenEvents || []).slice(),
    scopes,
    ...(degradedByFailover ? { degraded: true, degradedReason: 'authz_failover' } : {}),
  };
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd demo_api_server && npx jest src/__tests__/agentToolsResolver.degraded.test.js`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/agentToolsResolver.js demo_api_server/services/agentGatewayClient.js demo_api_server/src/__tests__/agentToolsResolver.degraded.test.js
git commit -m "feat(agent): map gateway mock-failover engine to the degraded UI state"
```

---

### Task 9: Full regression + CHANGELOG

**Files:**
- Modify: `CHANGELOG.md` (Unreleased)

- [ ] **Step 1: UI build + targeted tests**

Run: `cd demo_api_ui && npm run build && npx vitest run src/components/__tests__/ScopePicker.test.jsx src/components/__tests__/BankingChips.states.test.jsx src/services/__tests__/fetchAgentTools.degraded.test.js src/components/__tests__/AIAgent.chips.test.js`
Expected: build exit 0; all suites PASS.

- [ ] **Step 2: BFF + gateway tests**

Run: `cd demo_api_server && npx jest src/__tests__/agentToolsResolver.degraded.test.js`
Run: `cd demo_mcp_gateway && npx jest test/PingOneAuthorizeClient.failover.test.ts && npm run build`
Expected: PASS / exit 0.

- [ ] **Step 3: Add CHANGELOG entry**

Under `## [Unreleased]` in `CHANGELOG.md`, add:

```markdown
### Added
- Agent Actions popout: styled scope control with an explainer line, distinct chip grey-states, discovery resilience (retry + local-catalog fallback), and a once-per-session "using the demo authorize server" modal when PingOne Authorize is unreachable.

### Fixed
- Real→mock PingOne Authorize failover in both gateways so a cloud Authorize outage no longer fails closed (greying every agent chip) in real mode.
```

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: CHANGELOG for agent scope dropdown + Authorize resilience"
```

---

## Self-Review Notes (author)

- **Spec coverage:** Part 1→Task 1; Part 2→Task 2; Part 3 (grey states)→Task 3; Part 5a→Tasks 4–5; Part 5b→Tasks 6–7; Part 5c→Task 5 (+Task 8 wires the gateway-failover engine into the same modal/badge). Verification items 1–7 map to Tasks 1–8 + Task 9 regression.
- **Open confirmations for the implementer (called out inline, not placeholders):** exact `DraggableModal` prop names (Task 5 Step 5); `GatewayConfig` location + whether `_meta.authzEngine` already flows through the WS result (Task 6 Step 5 / Task 8 Step 3); the gateway's groovy mount path + redeploy command (Task 7 Step 2). Each step says how to find the answer.
- **Type consistency:** `degraded`/`degradedReason` used identically across BFF return, route JSON, `fetchAgentTools`, and AIAgent state. `engine: 'real' | 'mock' | 'mock-failover'` consistent across gateway type, evaluate() returns, and the BFF mapping (`authzEngine`).
