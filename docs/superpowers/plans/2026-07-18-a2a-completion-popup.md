# A2A Delegation Teaching Popup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After an A2A delegation demo step (UC2/UC2.5) completes successfully, auto-open the existing `UseCaseExplainModal` with an A2A teaching section (static prose + live values from the run's `a2a-*` token events); the same content is also reachable via the Demo Steps explain `(i)` icon.

**Architecture:** UI-only, three units. A pure selector `extractA2aFacts(tokenEvents)` maps the four `a2a-*` events to display facts. `UseCaseExplainModal` gains an A2A section (renders only for A2A use cases) fed by a new `a2aTokenEvents` prop. `AIAgent.js` detects A2A-step success in its resume handler and auto-opens the modal with the run's events; `DemoStepsDropdown` (explain-icon path) feeds the last run's events from `tokenChainTraceStore`.

**Tech Stack:** React, vitest + @testing-library/react, existing `DraggableModal` / `UseCaseExplainModal` / `tokenChainTraceStore`.

## Global Constraints

- UI-only. No BFF/server changes, no new routes or token-chain plumbing.
- Do not modify the token-chain rendering — it already renders the full A2A flow.
- Emoji allowlist only: `⚠️` `✅` `❌` `🔐` `✕` `✓` `👤` `🔑` `🪟` `📚`. Everything else plain text / CSS.
- A2A use case = `uc.id === 'UC2' || uc.id === 'UC2.5'`.
- Auto-open only on delegation **success**: reply matches `/Delegation complete/i` AND `tokenEvents` contains an `a2a-exchange2` event AND contains no `a2a-exchange-failed` event.
- Test runner: `cd demo_api_ui && npx vitest run <path>`.
- Work in the git worktree; stage explicit files; verify `git branch --show-current` before each commit.
- After all tasks: `cd demo_api_ui && npm run build` must exit 0 (REGRESSION_PLAN §0 gate).

### Token event reference (produced by `demo_api_server/services/a2aDelegationService.js`)

Each event: `{ id, label, status, timestamp, alg, claims, explanation, ...extra }`.

- `a2a-agent1-actor` — generalist actor token. `claims.sub`/`claims.client_id` = generalist. extra: `{ a2aRole:'agent1-actor', vertical }`.
- `a2a-exchange1` — User → Agent 1 delegated token. `claims.aud` = intermediate audience; `claims.act = { sub: agent1 }`. extra: `{ a2aRole:'exchange1', actPresent, a2aSubtask, vertical }`.
- `a2a-agent2-actor` — specialist actor token. extra: `{ a2aRole:'agent2-actor', vertical, specialist }` (`specialist` = specialist display name).
- `a2a-exchange2` — nested act. `claims.aud` = A2A gateway audience; `claims.act = { sub: agent2, act: { sub: agent1 } }`; `claims.scope` = specialist scope. extra: `{ a2aRole:'exchange2', actPresent, actChainDepth, a2aTool, scope, vertical, specialist }`.
- `a2a-exchange-failed` — present only on failure.

---

### Task 1: `extractA2aFacts` selector

**Files:**
- Create: `demo_api_ui/src/utils/a2aFacts.js`
- Test: `demo_api_ui/src/utils/__tests__/a2aFacts.test.js`

**Interfaces:**
- Produces:
  - `isA2aUseCase(uc): boolean`
  - `extractA2aFacts(tokenEvents): { present: boolean, generalist: string|null, specialist: string|null, intermediateAud: string|null, gatewayAud: string|null, scope: string|null, actChainDepth: number|null, tool: string|null, actChain: string[]|null }`

- [ ] **Step 1: Write the failing test**

```javascript
// demo_api_ui/src/utils/__tests__/a2aFacts.test.js
import { describe, it, expect } from 'vitest';
import { isA2aUseCase, extractA2aFacts } from '../a2aFacts';

const runEvents = [
  { id: 'a2a-agent1-actor', claims: { client_id: 'agent1-cid' }, vertical: 'banking' },
  { id: 'a2a-exchange1', claims: { aud: 'a2a-intermediate-investment.ping.demo', act: { sub: 'agent1-cid' } } },
  { id: 'a2a-agent2-actor', specialist: 'Investment Advisor', claims: { client_id: 'agent2-cid' } },
  {
    id: 'a2a-exchange2',
    specialist: 'Investment Advisor',
    scope: 'invest:read',
    actChainDepth: 2,
    a2aTool: 'get_portfolio_summary',
    claims: { aud: ['mcpgateway-a2a.ping.demo'], scope: 'invest:read', act: { sub: 'agent2-cid', act: { sub: 'agent1-cid' } } },
  },
];

describe('isA2aUseCase', () => {
  it('is true for UC2 and UC2.5, false otherwise', () => {
    expect(isA2aUseCase({ id: 'UC2' })).toBe(true);
    expect(isA2aUseCase({ id: 'UC2.5' })).toBe(true);
    expect(isA2aUseCase({ id: 'UC7' })).toBe(false);
    expect(isA2aUseCase(null)).toBe(false);
  });
});

describe('extractA2aFacts', () => {
  it('maps a full a2a run to facts', () => {
    const f = extractA2aFacts(runEvents);
    expect(f.present).toBe(true);
    expect(f.specialist).toBe('Investment Advisor');
    expect(f.intermediateAud).toBe('a2a-intermediate-investment.ping.demo');
    expect(f.gatewayAud).toBe('mcpgateway-a2a.ping.demo');
    expect(f.scope).toBe('invest:read');
    expect(f.actChainDepth).toBe(2);
    expect(f.tool).toBe('get_portfolio_summary');
    expect(f.actChain).toEqual(['agent2-cid', 'agent1-cid']);
  });

  it('returns present:false and nulls for empty/absent events without throwing', () => {
    const f = extractA2aFacts([]);
    expect(f.present).toBe(false);
    expect(f.specialist).toBeNull();
    expect(f.gatewayAud).toBeNull();
    expect(() => extractA2aFacts(undefined)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/utils/__tests__/a2aFacts.test.js`
Expected: FAIL — cannot resolve `../a2aFacts`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// demo_api_ui/src/utils/a2aFacts.js
'use strict';

/** A2A demo use cases (the only ones that render the A2A teaching section). */
export function isA2aUseCase(uc) {
  return !!uc && (uc.id === 'UC2' || uc.id === 'UC2.5');
}

function byId(events, id) {
  return (Array.isArray(events) ? events : []).find((e) => e && e.id === id) || null;
}

/** Flatten a nested act claim { sub, act:{ sub, … } } to ['sub','sub',…]. */
function flattenAct(act) {
  const chain = [];
  let node = act;
  let guard = 0;
  while (node && typeof node === 'object' && guard < 6) {
    if (node.sub) chain.push(String(node.sub));
    else if (node.client_id) chain.push(String(node.client_id));
    node = node.act;
    guard += 1;
  }
  return chain.length ? chain : null;
}

function flatAud(aud) {
  if (!aud) return null;
  return Array.isArray(aud) ? (aud[aud.length - 1] || null) : String(aud);
}

/**
 * Map the four a2a-* token events to display facts. Tolerates missing events
 * (returns nulls, never throws) so the modal can render an empty live-panel.
 */
export function extractA2aFacts(tokenEvents) {
  const ex1 = byId(tokenEvents, 'a2a-exchange1');
  const ex2 = byId(tokenEvents, 'a2a-exchange2');
  const a1 = byId(tokenEvents, 'a2a-agent1-actor');
  const a2 = byId(tokenEvents, 'a2a-agent2-actor');
  const present = !!ex2;

  return {
    present,
    generalist: a1?.claims?.client_id || a1?.claims?.sub || null,
    specialist: ex2?.specialist || a2?.specialist || a2?.claims?.client_id || null,
    intermediateAud: flatAud(ex1?.claims?.aud),
    gatewayAud: flatAud(ex2?.claims?.aud),
    scope: ex2?.scope || ex2?.claims?.scope || null,
    actChainDepth: typeof ex2?.actChainDepth === 'number' ? ex2.actChainDepth : null,
    tool: ex2?.a2aTool || null,
    actChain: flattenAct(ex2?.claims?.act),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/utils/__tests__/a2aFacts.test.js`
Expected: PASS (5 assertions across 3 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/fix-a2a-gateway-pin
git add demo_api_ui/src/utils/a2aFacts.js demo_api_ui/src/utils/__tests__/a2aFacts.test.js
git commit -m "feat(a2a): extractA2aFacts selector for the teaching popup"
```

---

### Task 2: A2A teaching section in `UseCaseExplainModal`

**Files:**
- Modify: `demo_api_ui/src/components/UseCaseExplainModal.jsx` (signature at line 80; section inserted after the Section-2 block, before Section-3)
- Test: `demo_api_ui/src/components/__tests__/UseCaseExplainModal.a2a.test.jsx`

**Interfaces:**
- Consumes: `isA2aUseCase`, `extractA2aFacts` from `../utils/a2aFacts`.
- Produces: `UseCaseExplainModal` now accepts an optional `a2aTokenEvents` array prop (default `[]`). Existing props `{ uc, open, onClose }` unchanged.

- [ ] **Step 1: Write the failing test**

```jsx
// demo_api_ui/src/components/__tests__/UseCaseExplainModal.a2a.test.jsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom';

vi.mock('../UseCaseExplainModal.css', () => ({}), { virtual: true });
vi.mock('../../hooks/useExplainData', () => ({
  useExplainData: () => ({ rules: null, topology: null, loading: false }),
}));

import UseCaseExplainModal from '../UseCaseExplainModal';

const a2aEvents = [
  { id: 'a2a-agent1-actor', claims: { client_id: 'agent1-cid' } },
  { id: 'a2a-exchange1', claims: { aud: 'a2a-intermediate-investment.ping.demo', act: { sub: 'agent1-cid' } } },
  { id: 'a2a-agent2-actor', specialist: 'Investment Advisor', claims: { client_id: 'agent2-cid' } },
  { id: 'a2a-exchange2', specialist: 'Investment Advisor', scope: 'invest:read', actChainDepth: 2, a2aTool: 'get_portfolio_summary',
    claims: { aud: ['mcpgateway-a2a.ping.demo'], scope: 'invest:read', act: { sub: 'agent2-cid', act: { sub: 'agent1-cid' } } } },
];

const uc2 = { id: 'UC2', title: 'A2A delegation', whatLong: 'x', pingOneSolution: 'y' };
const uc7 = { id: 'UC7', title: 'Step-up required', whatLong: 'x', pingOneSolution: 'y' };

describe('UseCaseExplainModal A2A section', () => {
  it('renders the A2A section with live values for an A2A use case', () => {
    render(<UseCaseExplainModal uc={uc2} open a2aTokenEvents={a2aEvents} onClose={() => {}} />);
    expect(screen.getByText(/Agent-to-Agent delegation/i)).toBeInTheDocument();
    expect(screen.getByText(/Investment Advisor/)).toBeInTheDocument();
    expect(screen.getByText(/mcpgateway-a2a\.ping\.demo/)).toBeInTheDocument();
    expect(screen.getByText(/invest:read/)).toBeInTheDocument();
  });

  it('shows the empty-state live note when no A2A events are supplied', () => {
    render(<UseCaseExplainModal uc={uc2} open a2aTokenEvents={[]} onClose={() => {}} />);
    expect(screen.getByText(/Agent-to-Agent delegation/i)).toBeInTheDocument();
    expect(screen.getByText(/Run this step to see the live delegation values/i)).toBeInTheDocument();
  });

  it('does not render the A2A section for a non-A2A use case', () => {
    render(<UseCaseExplainModal uc={uc7} open a2aTokenEvents={[]} onClose={() => {}} />);
    expect(screen.queryByText(/Agent-to-Agent delegation/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/UseCaseExplainModal.a2a.test.jsx`
Expected: FAIL — "Agent-to-Agent delegation" heading not found (section not implemented).

- [ ] **Step 3: Write minimal implementation**

3a. Add the import at the top of `UseCaseExplainModal.jsx` (alongside the existing imports):

```jsx
import { isA2aUseCase, extractA2aFacts } from '../utils/a2aFacts';
```

3b. Add an `A2aSection` component just above `export default function UseCaseExplainModal`:

```jsx
function A2aFactRow({ k, v }) {
  return (
    <div className="ucem__live-rule">
      <span className="ucem__live-k">{k}</span>
      <span>{v || <em>—</em>}</span>
    </div>
  );
}

function A2aSection({ tokenEvents }) {
  const f = extractA2aFacts(tokenEvents);
  return (
    <>
      <p>
        Two agents act on the user&apos;s behalf. A <strong>generalist</strong> agent hands a
        narrow, sensitive read to a <strong>specialist</strong> agent. PingOne mints a nested
        RFC 8693 act chain — <code>act:&#123; specialist, act:&#123; generalist &#125; &#125;</code>,
        subject still the user — across two exchanges: Exchange&nbsp;#1 (user → generalist),
        Exchange&nbsp;#2 (generalist → specialist, nested). PingOne Authorize then decides over
        the chain: it PERMITs the depth-2 delegation and DENIES the generalist acting alone.
      </p>
      {f.present ? (
        <div className="ucem__live">
          <A2aFactRow k="specialist" v={f.specialist} />
          <A2aFactRow k="tool" v={f.tool} />
          <A2aFactRow k="act chain" v={f.actChain ? f.actChain.join(' → ') : null} />
          <A2aFactRow k="act depth" v={f.actChainDepth != null ? String(f.actChainDepth) : null} />
          <A2aFactRow k="exchange #1 aud" v={f.intermediateAud} />
          <A2aFactRow k="exchange #2 aud" v={f.gatewayAud} />
          <A2aFactRow k="scope" v={f.scope} />
        </div>
      ) : (
        <div className="ucem__live ucem__live--empty">
          Run this step to see the live delegation values (audiences, scopes, act chain).
        </div>
      )}
    </>
  );
}
```

3c. Change the function signature (line 80) to accept `a2aTokenEvents`:

```jsx
export default function UseCaseExplainModal({ uc, open, onClose, a2aTokenEvents = [] }) {
```

3d. Insert the A2A section inside the `ucem__body` div, immediately after the Section-2 ("How we stop it") block and before Section-3 ("Ping products…"):

```jsx
          {isA2aUseCase(uc) && (
            <div className="ucem__sec">
              <SectionHead num="A2A">Agent-to-Agent delegation</SectionHead>
              <A2aSection tokenEvents={a2aTokenEvents} />
            </div>
          )}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/UseCaseExplainModal.a2a.test.jsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/fix-a2a-gateway-pin
git add demo_api_ui/src/components/UseCaseExplainModal.jsx demo_api_ui/src/components/__tests__/UseCaseExplainModal.a2a.test.jsx
git commit -m "feat(a2a): A2A teaching section in UseCaseExplainModal (static prose + live values)"
```

---

### Task 3: Auto-open after an A2A step succeeds (`AIAgent.js`)

**Files:**
- Modify: `demo_api_ui/src/components/AIAgent.js` (state near line 866; success branch of the `nlResumeAfterAuth` handler ~line 6602; modal render near the other agent modals ~line 8960)
- Test: `demo_api_ui/src/components/__tests__/AIAgent.a2aExplain.test.js`

**Interfaces:**
- Consumes: `isA2aUseCase`, `extractA2aFacts` from `../utils/a2aFacts`; `UseCaseExplainModal`.
- Produces: a module-scope helper `shouldAutoOpenA2a(uc, response)` exported for test.

- [ ] **Step 1: Write the failing test**

```javascript
// demo_api_ui/src/components/__tests__/AIAgent.a2aExplain.test.js
import { describe, it, expect } from 'vitest';
import { shouldAutoOpenA2a } from '../a2aAutoOpen';

const okResponse = {
  reply: 'Delegation complete — Investment Advisor retrieved get portfolio summary…',
  tokenEvents: [{ id: 'a2a-exchange2' }],
};
const failResponse = {
  reply: '❌ Delegated to Investment Advisor, but get_portfolio_summary failed: mcp_error.',
  tokenEvents: [{ id: 'a2a-exchange2' }, { id: 'a2a-exchange-failed' }],
};

describe('shouldAutoOpenA2a', () => {
  it('opens for an A2A use case on a successful delegation', () => {
    expect(shouldAutoOpenA2a({ id: 'UC2' }, okResponse)).toBe(true);
    expect(shouldAutoOpenA2a({ id: 'UC2.5' }, okResponse)).toBe(true);
  });
  it('does not open on a failed delegation', () => {
    expect(shouldAutoOpenA2a({ id: 'UC2' }, failResponse)).toBe(false);
  });
  it('does not open for a non-A2A use case', () => {
    expect(shouldAutoOpenA2a({ id: 'UC7' }, okResponse)).toBe(false);
  });
  it('does not open when there is no a2a-exchange2 event', () => {
    expect(shouldAutoOpenA2a({ id: 'UC2' }, { reply: 'Delegation complete', tokenEvents: [] })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/AIAgent.a2aExplain.test.js`
Expected: FAIL — cannot resolve `../a2aAutoOpen`.

- [ ] **Step 3: Write minimal implementation**

3a. Create the pure helper (kept in its own module so it is importable without rendering `AIAgent`):

```javascript
// demo_api_ui/src/components/a2aAutoOpen.js
'use strict';
import { isA2aUseCase } from '../utils/a2aFacts';

/**
 * True when a completed demo step is an A2A use case whose delegation actually
 * succeeded — reply says "Delegation complete", an a2a-exchange2 event exists,
 * and no a2a-exchange-failed event is present.
 */
export function shouldAutoOpenA2a(uc, response) {
  if (!isA2aUseCase(uc) || !response) return false;
  const events = Array.isArray(response.tokenEvents) ? response.tokenEvents : [];
  const hasExchange2 = events.some((e) => e && e.id === 'a2a-exchange2');
  const failed = events.some((e) => e && e.id === 'a2a-exchange-failed');
  const replyOk = /Delegation complete/i.test(String(response.reply || ''));
  return replyOk && hasExchange2 && !failed;
}
```

3b. In `AIAgent.js`, add the imports (with the other component/util imports near the top):

```javascript
import { shouldAutoOpenA2a } from "./a2aAutoOpen";
import { isA2aUseCase } from "../utils/a2aFacts";
```

(`UseCaseExplainModal` is already imported via `DemoStepsDropdown`; add a direct import if not present: `import UseCaseExplainModal from "./UseCaseExplainModal";`)

3c. Add state near the other agent modal state (~line 866):

```javascript
  const [a2aExplainUc, setA2aExplainUc] = useState(null);
  const [a2aExplainEvents, setA2aExplainEvents] = useState([]);
```

3d. In the `nlResumeAfterAuth` success branch (the final `else` after the approval-gate and error branches, ~line 6602), immediately after the reply `addMessage(...)` for the success case, add the block below. It uses the **response** as the signal (reply text + `a2a-exchange2` event), so no catalog `uc.id` needs to be threaded through — `useCaseId` in this scope is the BFF slug, not `uc.id`, and is not used here. It builds a minimal `uc` object for the modal from the response.

```javascript
            // A2A teaching popup: auto-open after a successful A2A delegation,
            // mirroring how RAR auto-explains. The response is the signal, and
            // its own token events feed the modal's live values. Predicate must
            // match shouldAutoOpenA2a (a2aAutoOpen.js).
            {
              const a2aEvents = Array.isArray(response.tokenEvents) ? response.tokenEvents : [];
              const hasExchange2 = a2aEvents.some((e) => e && e.id === 'a2a-exchange2');
              const failed = a2aEvents.some((e) => e && e.id === 'a2a-exchange-failed');
              const replyOk = /Delegation complete/i.test(String(response.reply || ''));
              if (hasExchange2 && !failed && replyOk) {
                setA2aExplainUc({
                  id: 'UC2',
                  title: 'A2A delegation',
                  whatLong: response.reply,
                  pingOneSolution: 'PingOne mints a nested RFC 8693 act chain; Authorize decides PERMIT/DENY over the chain.',
                });
                setA2aExplainEvents(a2aEvents);
              }
            }
```

> The `shouldAutoOpenA2a` helper (unit-tested in Step 1) encodes the identical predicate — `reply matches /Delegation complete/i && has a2a-exchange2 && no a2a-exchange-failed`. Keep the two in sync.

3e. Render the modal near the other agent modals (~line 8960, alongside the OTP modal block):

```jsx
            <UseCaseExplainModal
              uc={a2aExplainUc}
              open={Boolean(a2aExplainUc)}
              a2aTokenEvents={a2aExplainEvents}
              onClose={() => { setA2aExplainUc(null); setA2aExplainEvents([]); }}
            />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/AIAgent.a2aExplain.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the existing AIAgent chip suite to confirm no regression**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/AIAgent.chips.test.js`
Expected: PASS (no new failures vs. baseline).

- [ ] **Step 6: Commit**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/fix-a2a-gateway-pin
git add demo_api_ui/src/components/a2aAutoOpen.js demo_api_ui/src/components/__tests__/AIAgent.a2aExplain.test.js demo_api_ui/src/components/AIAgent.js
git commit -m "feat(a2a): auto-open the A2A teaching popup after a successful delegation step"
```

---

### Task 4: Live values on the explain-icon path + build gate

**Files:**
- Modify: `demo_api_ui/src/components/DemoStepsDropdown.jsx` (import + the `UseCaseExplainModal` render at line 292)
- Test: `demo_api_ui/src/components/__tests__/DemoStepsDropdown.a2a.test.jsx`

**Interfaces:**
- Consumes: `tokenChainTraceStore` (`getState().tokenEvents`), `isA2aUseCase`, `UseCaseExplainModal`.

- [ ] **Step 1: Write the failing test**

```jsx
// demo_api_ui/src/components/__tests__/DemoStepsDropdown.a2a.test.jsx
import { describe, it, expect } from 'vitest';
import { a2aEventsForExplain } from '../demoStepsA2a';

describe('a2aEventsForExplain', () => {
  it('returns the last run a2a-* events for an A2A use case', () => {
    const store = { getState: () => ({ tokenEvents: [
      { id: 'user-token' },
      { id: 'a2a-exchange2', specialist: 'Investment Advisor' },
    ] }) };
    const out = a2aEventsForExplain({ id: 'UC2' }, store);
    expect(out.some((e) => e.id === 'a2a-exchange2')).toBe(true);
    expect(out.some((e) => e.id === 'user-token')).toBe(false);
  });
  it('returns [] for a non-A2A use case', () => {
    const store = { getState: () => ({ tokenEvents: [{ id: 'a2a-exchange2' }] }) };
    expect(a2aEventsForExplain({ id: 'UC7' }, store)).toEqual([]);
  });
  it('returns [] when the store has no trace', () => {
    const store = { getState: () => ({}) };
    expect(a2aEventsForExplain({ id: 'UC2' }, store)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/DemoStepsDropdown.a2a.test.jsx`
Expected: FAIL — cannot resolve `../demoStepsA2a`.

- [ ] **Step 3: Write minimal implementation**

3a. Create the selector:

```javascript
// demo_api_ui/src/components/demoStepsA2a.js
'use strict';
import { isA2aUseCase } from '../utils/a2aFacts';

/**
 * A2A token events for the explain-icon path: the last run's a2a-* events from
 * the token-chain trace store, but only for A2A use cases. Empty array
 * otherwise (icon opened before any run, or non-A2A step) — the modal renders
 * static prose + an empty live-panel in that case.
 */
export function a2aEventsForExplain(uc, store) {
  if (!isA2aUseCase(uc)) return [];
  const events = store?.getState?.()?.tokenEvents;
  if (!Array.isArray(events)) return [];
  return events.filter((e) => e && typeof e.id === 'string' && e.id.startsWith('a2a-'));
}
```

3b. In `DemoStepsDropdown.jsx`, add imports:

```jsx
import { tokenChainTraceStore } from '../services/tokenChainTrace/tokenChainTraceStore';
import { a2aEventsForExplain } from './demoStepsA2a';
```

3c. Pass the live events to the modal (replace the render at line 292):

```jsx
      <UseCaseExplainModal
        uc={explainUc}
        open={Boolean(explainUc)}
        a2aTokenEvents={a2aEventsForExplain(explainUc, tokenChainTraceStore)}
        onClose={() => setExplainUc(null)}
      />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/DemoStepsDropdown.a2a.test.jsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Full A2A test sweep**

Run: `cd demo_api_ui && npx vitest run src/utils/__tests__/a2aFacts.test.js src/components/__tests__/UseCaseExplainModal.a2a.test.jsx src/components/__tests__/AIAgent.a2aExplain.test.js src/components/__tests__/DemoStepsDropdown.a2a.test.jsx`
Expected: PASS (all).

- [ ] **Step 6: UI build gate (REGRESSION_PLAN §0)**

Run: `cd demo_api_ui && npm run build`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
cd /Users/cmuir/Development/AI-DEMO2/.claude/worktrees/fix-a2a-gateway-pin
git add demo_api_ui/src/components/demoStepsA2a.js demo_api_ui/src/components/__tests__/DemoStepsDropdown.a2a.test.jsx demo_api_ui/src/components/DemoStepsDropdown.jsx
git commit -m "feat(a2a): live delegation values on the Demo Steps explain icon"
```

---

## Live verification (after all tasks)

Reuse the harness from the A2A gateway fix (real login + PG flag on):

1. Ensure `mcp-gateway` + `authz-server` are up (demo-auth profile) and flags `ff_a2a_delegation=true`, `ff_heuristic_enabled=true`.
2. In the running UI (`https://local.ping-devops.com:4000`), run Demo step 7 (UC2). On "Delegation complete", the A2A teaching modal auto-opens showing the specialist, act chain `agent2 → agent1`, both exchange audiences, and `invest:read`.
3. Open the Demo Steps dropdown, click the explain `(i)` icon on UC2 — the same A2A section renders with the last run's live values (or the empty-state note if run fresh).

## Self-Review notes

- Spec coverage: static prose + live values (Task 2), auto-open on success only (Task 3), explain-icon reuse (Task 4), token-chain untouched (no task modifies it), emoji allowlist (only `❌`/`✓` may appear via data — no new decorative emoji added). All covered.
- The Task-3 `shouldAutoOpenA2a` predicate and the inline render-side block use the identical condition; keep them in sync (noted in 3d).
- `a2aTokenEvents` prop name is consistent across Tasks 2, 3, 4.
