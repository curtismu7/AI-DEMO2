# Dot Workbench Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Work in a git worktree off `origin/main`; commit by explicit path; the pre-commit hook must pass (no `--no-verify`).

**Goal:** A new in-shell page at `/personal-agent/dot` that shows the Dot personal agent as an A2A-style workbench: persona card, chat with PERMIT/DENY/CONSENT tool-call cards, Dot's memory, and a "What Ping governs" panel.

**Architecture:** One page component owns chat state and calls the existing `POST /api/agent/invoke`. A pure mapper (`dotChat.js`) turns each invoke response into message items (the only logic worth unit-testing); small presentational components render them. No backend change. The page reuses `DotMemoryPanel`, `PageAgentModeToggle`/`usePageAgentMode`, and the A2A page's `cur-*` workbench CSS.

**Tech Stack:** React (CRA, `.jsx`), vitest + @testing-library/react, react-router. Tests: `cd demo_api_ui && npx vitest run <file>`.

**Spec:** `docs/superpowers/specs/2026-10-15-dot-workbench-design.md` (approved; merged in #1343).

**Spec delta (found while planning, from the live route):** a gateway/PingOne denial comes back as **HTTP 200 with `success:false`, `toolsCalled:[tool]` and `reply:"❌ …"`** (plus `mcpAuthorizeEvaluation.decision:"DENY"`), not as a 403. The 403 `intent_not_authorized` and 428 consent cases from the spec still exist (pre-execution gates). The verdict rule below covers all three. Persona facts come from `GET /api/agent-builder/state` (`{ user, agent, resources[].granted }`), which needs a session (401 signed out).

## Global Constraints
- No backend changes; no new dependencies.
- Persona values come from real data or show "—"; never fake values (the mock's `carol.nguyen` / `dot-agent-7f3a` / scopes are illustrative only).
- A tool-call card shows a request/response `<details>` only when the response carries that data.
- Fail-closed UI: if verdict cannot be determined, show no verdict pill rather than PERMIT.
- Existing pop-out (`/personal-agent/client`) behavior is unchanged.
- Diagram/demo/Learning Hub trio: the "Dots" lesson must be checked for sync in the last task.
- New public SPA route: add `auth-requirements.json` entry (`npm run authz:verify` gate). `k8s/aws/se-ingress.yaml` lists only API bypass paths and has no `/personal-agent*` entry, so no ingress change is expected (verified in Task 6 by a post-deploy 200). e2e storageState already seeds `demo_welcome_seen` per origin; nothing per-route.

## Review Focus
- Signed-out visitor sends a message: 401 → styled sign-in panel, no card, no crash.
- Deny delivered as 200 + `success:false` (gateway) must render DENY, not PERMIT.
- Reply with `dotMemories` must show the chip **and** refresh the memory panel.
- `/api/agent-builder/state` 401 or no registered agent: persona shows "—", no scopes pill, no placeholder values.
- Network/5xx during send: error bubble, input re-enabled, no half-rendered card.

## File Structure
- Create `demo_api_ui/src/utils/dotChat.js` — `mapInvokeResult(status, body)`; pure.
- Create `demo_api_ui/src/config/dotSuggestions.js` — shared `DOT_SUGGESTIONS`.
- Create `demo_api_ui/src/components/dot/DotToolCard.jsx`, `DotPersonaCard.jsx`, `DotGovernsPanel.jsx`, `useDotPersona.js`, `DotWorkbench.css`.
- Create `demo_api_ui/src/pages/DotWorkbenchPage.jsx`.
- Modify `demo_api_ui/src/pages/PersonalAgentClientWindow.jsx` (import shared suggestions), `demo_api_ui/src/App.js` (route), `demo_api_server/config/auth-requirements.json`, `demo_api_ui/src/config/personalAgentClients.js` (Dot card link).
- Tests beside each (`__tests__/`).

---

### Task 1: Pure response mapper + shared suggestions

**Files:**
- Create: `demo_api_ui/src/utils/dotChat.js`, `demo_api_ui/src/config/dotSuggestions.js`
- Modify: `demo_api_ui/src/pages/PersonalAgentClientWindow.jsx` (replace local `DOT_SUGGESTIONS` const with the import)
- Test: `demo_api_ui/src/utils/__tests__/dotChat.test.js`

**Interfaces:**
- Produces: `mapInvokeResult(status: number, body: object) → { signedOut: boolean, items: Item[], memories: string[] }` where `Item` is `{ kind: 'dot', text }` | `{ kind: 'tool', name, verdict: 'PERMIT'|'DENY'|'CONSENT', reason?, request?, response? }` | `{ kind: 'error', text }`; and `DOT_SUGGESTIONS: string[]`.

- [ ] **Step 1: Write the failing test** — `demo_api_ui/src/utils/__tests__/dotChat.test.js`

```js
import { describe, expect, it } from 'vitest';
import { mapInvokeResult } from '../dotChat';

describe('mapInvokeResult', () => {
  it('successful reply: dot bubble + PERMIT card per tool, memories passed through', () => {
    const r = mapInvokeResult(200, { reply: 'Booked.', success: true, toolsCalled: ['book_flight'], dotMemories: ['aisle seats'] });
    expect(r.signedOut).toBe(false);
    expect(r.items).toEqual([
      { kind: 'tool', name: 'book_flight', verdict: 'PERMIT' },
      { kind: 'dot', text: 'Booked.' },
    ]);
    expect(r.memories).toEqual(['aisle seats']);
  });

  it('gateway deny arrives as 200 + success:false: DENY, with the reply as the reason (not PERMIT)', () => {
    const r = mapInvokeResult(200, { reply: '❌ access_denied', success: false, toolsCalled: ['get_my_accounts'], mcpAuthorizeEvaluation: { decision: 'DENY' } });
    expect(r.items[0]).toMatchObject({ kind: 'tool', name: 'get_my_accounts', verdict: 'DENY', reason: '❌ access_denied' });
    expect(r.items.some((i) => i.kind === 'dot')).toBe(false);
  });

  it('403 intent_not_authorized: DENY card with the server message', () => {
    const r = mapInvokeResult(403, { error: 'intent_not_authorized', message: 'Transfers are not delegated to Dot.', intent: 'transfer_miles' });
    expect(r.items).toEqual([{ kind: 'tool', name: 'transfer_miles', verdict: 'DENY', reason: 'Transfers are not delegated to Dot.' }]);
  });

  it('428 requiresConsent: CONSENT card naming the action', () => {
    const r = mapInvokeResult(428, { requiresConsent: true, action: 'book_flight', message: 'Approve this booking.' });
    expect(r.items).toEqual([{ kind: 'tool', name: 'book_flight', verdict: 'CONSENT', reason: 'Approve this booking.' }]);
  });

  it('401: signedOut, no items', () => {
    expect(mapInvokeResult(401, { error: 'authentication_required' })).toEqual({ signedOut: true, items: [], memories: [] });
  });

  it('5xx / unreadable body: one error bubble, never a verdict', () => {
    expect(mapInvokeResult(502, {}).items).toEqual([{ kind: 'error', text: 'Dot could not complete that request.' }]);
    expect(mapInvokeResult(200, null).items).toEqual([{ kind: 'error', text: 'Dot could not complete that request.' }]);
  });

  it('reply with no toolsCalled: just the dot bubble', () => {
    expect(mapInvokeResult(200, { reply: 'Hi.', success: true, toolsCalled: [] }).items).toEqual([{ kind: 'dot', text: 'Hi.' }]);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `cd demo_api_ui && npx vitest run src/utils/__tests__/dotChat.test.js` → FAIL (module not found).

- [ ] **Step 3: Implement** — `demo_api_ui/src/utils/dotChat.js`

```js
// Maps one /api/agent/invoke response to the items the Dot workbench renders.
// Verdicts come only from what the route returns; if a verdict can't be
// determined no card is shown (fail closed in the UI).
const FAILED = { kind: 'error', text: 'Dot could not complete that request.' };

export function mapInvokeResult(status, body) {
  if (status === 401) return { signedOut: true, items: [], memories: [] };
  if (status === 403 && body?.error === 'intent_not_authorized') {
    return { signedOut: false, memories: [], items: [{ kind: 'tool', name: body.intent || 'request', verdict: 'DENY', reason: body.message }] };
  }
  if (status === 428 && body?.requiresConsent) {
    return { signedOut: false, memories: [], items: [{ kind: 'tool', name: body.action || 'request', verdict: 'CONSENT', reason: body.message }] };
  }
  if (status >= 400 || !body || typeof body !== 'object') return { signedOut: false, memories: [], items: [FAILED] };

  const tools = Array.isArray(body.toolsCalled) ? body.toolsCalled : [];
  const denied = body.success === false || body.mcpAuthorizeEvaluation?.decision === 'DENY';
  if (denied && tools.length) {
    return { signedOut: false, memories: [], items: tools.map((name) => ({ kind: 'tool', name, verdict: 'DENY', reason: body.reply })) };
  }
  const items = tools.map((name) => ({ kind: 'tool', name, verdict: 'PERMIT' }));
  if (body.reply) items.push({ kind: 'dot', text: body.reply });
  return { signedOut: false, items, memories: Array.isArray(body.dotMemories) ? body.dotMemories : [] };
}
```

`demo_api_ui/src/config/dotSuggestions.js`:

```js
// Prompts that show what Dot does: preference sentences it saves, plus a recall question.
export const DOT_SUGGESTIONS = [
  'Always book me an aisle seat',
  'Never put me on a red-eye',
  'Call me Sam',
  'What do you remember about me?',
];
```

In `PersonalAgentClientWindow.jsx`: delete the local `DOT_SUGGESTIONS` block and its comment, add `import { DOT_SUGGESTIONS } from '../config/dotSuggestions';`.

- [ ] **Step 4: Run tests** — `npx vitest run src/utils/__tests__/dotChat.test.js src/pages/__tests__/PersonalAgentClientWindow.test.jsx` → all PASS.

- [ ] **Step 5: Commit**
```bash
git add demo_api_ui/src/utils/dotChat.js demo_api_ui/src/utils/__tests__/dotChat.test.js demo_api_ui/src/config/dotSuggestions.js demo_api_ui/src/pages/PersonalAgentClientWindow.jsx
git commit -m "feat(dot): invoke-response mapper and shared suggestions"
```

---

### Task 2: Tool card, governs panel, persona card

**Files:**
- Create: `demo_api_ui/src/components/dot/DotToolCard.jsx`, `DotGovernsPanel.jsx`, `DotPersonaCard.jsx`, `useDotPersona.js`
- Test: `demo_api_ui/src/components/dot/__tests__/dotComponents.test.jsx`

**Interfaces:**
- Consumes: `Item` (Task 1).
- Produces: `<DotToolCard item verdictOnly? />` (props: `item: {name, verdict, reason?, request?, response?}`); `<DotGovernsPanel cards persona mode />` (`cards`: tool items, `persona`: result of `useDotPersona`, `mode`: `'heuristics'|'llm'`); `<DotPersonaCard persona identity />`; `useDotPersona() → { agentName: string|null, agentId: string|null, scopes: string[], loaded: boolean }`.

- [ ] **Step 1: Write the failing test** — `dotComponents.test.jsx`

```jsx
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import DotToolCard from '../DotToolCard';
import DotGovernsPanel from '../DotGovernsPanel';
import DotPersonaCard from '../DotPersonaCard';

afterEach(cleanup);

describe('DotToolCard', () => {
  it('shows the tool name and verdict pill; details only when data exists', () => {
    const { rerender } = render(<DotToolCard item={{ name: 'book_flight', verdict: 'PERMIT' }} />);
    expect(screen.getByText('book_flight')).toBeTruthy();
    expect(screen.getByText('PERMIT')).toBeTruthy();
    expect(document.querySelector('details')).toBeNull();
    rerender(<DotToolCard item={{ name: 'transfer_miles', verdict: 'DENY', reason: 'Not delegated.' }} />);
    expect(screen.getByText('DENY')).toBeTruthy();
    expect(screen.getByText('Not delegated.')).toBeTruthy();
    expect(document.querySelector('details')).toBeTruthy();
  });
  it('renders no pill for an unknown verdict', () => {
    render(<DotToolCard item={{ name: 'x', verdict: undefined }} />);
    expect(screen.queryByText('PERMIT')).toBeNull();
  });
});

describe('DotGovernsPanel', () => {
  const persona = { agentName: 'Dot', agentId: 'abc', scopes: ['miles:read'], loaded: true };
  it('tallies the last three calls and shows mode', () => {
    const cards = [{ verdict: 'PERMIT' }, { verdict: 'PERMIT' }, { verdict: 'DENY' }, { verdict: 'PERMIT' }];
    render(<DotGovernsPanel cards={cards} persona={persona} mode="heuristics" />);
    expect(screen.getByText('2 PERMIT · 1 DENY')).toBeTruthy(); // last three of four: PERMIT, DENY, PERMIT
    expect(screen.getByText(/Heuristics/)).toBeTruthy();
  });
  it('says no calls yet when empty', () => {
    render(<DotGovernsPanel cards={[]} persona={persona} mode="llm" />);
    expect(screen.getByText('No calls yet')).toBeTruthy();
  });
});

describe('DotPersonaCard', () => {
  it('shows real values', () => {
    render(<DotPersonaCard identity="a@b.com" persona={{ agentName: 'Dot', agentId: 'ag-1', scopes: ['miles:read', 'flights:book'], loaded: true }} />);
    expect(screen.getByText('a@b.com')).toBeTruthy();
    expect(screen.getByText('ag-1')).toBeTruthy();
    expect(screen.getByText('miles:read · flights:book')).toBeTruthy();
  });
  it('never invents values: missing data shows a dash and no scopes pill', () => {
    render(<DotPersonaCard identity="" persona={{ agentName: null, agentId: null, scopes: [], loaded: true }} />);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Scopes/)).toBeNull();
    expect(screen.queryByText(/carol|7f3a/i)).toBeNull();
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run src/components/dot/__tests__/dotComponents.test.jsx` → FAIL (modules missing).

- [ ] **Step 3: Implement**

`DotToolCard.jsx`:
```jsx
import React from 'react';

const PILL = { PERMIT: 'dot-verdict--permit', DENY: 'dot-verdict--deny', CONSENT: 'dot-verdict--consent' };

export default function DotToolCard({ item }) {
  const { name, verdict, reason, request, response } = item;
  const hasDetails = reason || request || response;
  return (
    <div className="dot-tool">
      <div className="dot-tool__row">
        <strong>{name}</strong>
        {PILL[verdict] && <span className={`dot-verdict ${PILL[verdict]}`}>{verdict}</span>}
      </div>
      {hasDetails && (
        <details open={verdict === 'DENY'}>
          <summary>{verdict === 'DENY' ? 'Why it was refused' : 'Request and response'}</summary>
          <pre>{[reason, request && JSON.stringify(request), response && JSON.stringify(response)].filter(Boolean).join('\n')}</pre>
        </details>
      )}
    </div>
  );
}
```

`DotGovernsPanel.jsx`:
```jsx
import React from 'react';

export default function DotGovernsPanel({ cards, persona, mode }) {
  const last3 = cards.slice(-3);
  const count = (v) => last3.filter((c) => c.verdict === v).length;
  const tally = last3.length
    ? [`${count('PERMIT')} PERMIT`, count('DENY') && `${count('DENY')} DENY`, count('CONSENT') && `${count('CONSENT')} CONSENT`].filter(Boolean).join(' · ')
    : 'No calls yet';
  return (
    <section className="dot-card" aria-label="What Ping governs">
      <h3>What Ping governs</h3>
      <p className="dot-sub">Every tool call, checked live.</p>
      <div className="dot-gov">
        <div><span>Identity</span><span>{persona.agentName ? `${persona.agentName} has its own agent identity` : '—'}</span></div>
        <div><span>Delegation</span><span>{persona.scopes.length ? `${persona.scopes.length} scope${persona.scopes.length === 1 ? '' : 's'}` : '—'}</span></div>
        <div><span>Last 3 calls</span><span>{tally}</span></div>
        <div><span>Mode</span><span>{mode === 'heuristics' ? 'Heuristics (no model call)' : 'llama.cpp (model routes)'}</span></div>
      </div>
    </section>
  );
}
```
(The "Last 3 calls" assertion in the test expects `2 PERMIT · 1 DENY`; the code above yields exactly that.)

`DotPersonaCard.jsx`:
```jsx
import React from 'react';

export default function DotPersonaCard({ persona, identity }) {
  return (
    <div className="dot-card dot-persona">
      <div className="dot-avatar" aria-hidden="true" />
      <div>
        <h2>{persona.agentName || 'Dot'} <span className="dot-muted">· your always-on persona agent</span></h2>
        <p>Remembers how you like things done. Ping governs every tool call, never its memory.</p>
      </div>
      <div className="dot-pills">
        <span className="dot-pill">Acts as <b>{identity || '—'}</b></span>
        <span className="dot-pill">Agent identity <b>{persona.agentId || '—'}</b></span>
        {persona.scopes.length > 0 && <span className="dot-pill">Scopes <b>{persona.scopes.join(' · ')}</b></span>}
      </div>
    </div>
  );
}
```

`useDotPersona.js`:
```js
import { useEffect, useState } from 'react';

const EMPTY = { agentName: null, agentId: null, scopes: [], loaded: false };

/** The signed-in user's registered personal agent, from /api/agent-builder/state. Signed out or unregistered: stays empty. */
export function useDotPersona() {
  const [persona, setPersona] = useState(EMPTY);
  useEffect(() => {
    let live = true;
    fetch('/api/agent-builder/state', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (!live) return;
        const scopes = [...new Set((s?.resources || []).flatMap((r) => r.granted || []))];
        setPersona({ agentName: s?.agent?.name || null, agentId: s?.agent?.id || null, scopes, loaded: true });
      })
      .catch(() => { if (live) setPersona({ ...EMPTY, loaded: true }); });
    return () => { live = false; };
  }, []);
  return persona;
}
```

- [ ] **Step 4: Run** — same vitest command → PASS.
- [ ] **Step 5: Commit** — `git add demo_api_ui/src/components/dot` then `git commit -m "feat(dot): tool card, persona card, governs panel"`.

---

### Task 3: Styles

**Files:** Create `demo_api_ui/src/components/dot/DotWorkbench.css`

Tokens and rules lifted from the mock (teal `--dot: #2bb3a3`; dark/light via the page's `data-cur-theme`). No test (visual); verified in the Task 6 browser check.

- [ ] **Step 1: Write the CSS** — scope everything under `.dot-wb`:

```css
.dot-wb { --dot:#2bb3a3; --dot-soft:rgba(43,179,163,.15); --ok:#34d399; --deny:#f87171; --warn:#fbbf24;
  --bg:#151719; --panel:#1e2123; --panel2:#272b2e; --ink:#ecefef; --muted:#98a2a3; --line:#343a3c; color:var(--ink); background:var(--bg); }
.dot-wb[data-cur-theme="light"] { --bg:#f3f5f5; --panel:#fff; --panel2:#ecf0f0; --ink:#1c2123; --muted:#5f6b6d; --line:#d6dddd; --dot-soft:rgba(43,179,163,.10); }
.dot-wb__main { display:grid; grid-template-columns:minmax(0,1fr) 340px; gap:16px; padding:16px 20px; max-width:1280px; margin:0 auto; }
@media (max-width:900px) { .dot-wb__main { grid-template-columns:1fr; } }
.dot-card { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:14px 16px; }
.dot-persona { display:flex; gap:14px; align-items:center; margin-bottom:16px; flex-wrap:wrap; }
.dot-avatar { width:52px; height:52px; border-radius:50%; flex:none; box-shadow:0 0 0 4px var(--dot-soft);
  background:radial-gradient(circle at 35% 30%, #8ee6da, var(--dot) 60%, #12766b); }
.dot-persona h2 { margin:0; font-size:17px; } .dot-persona p { margin:2px 0 0; color:var(--muted); font-size:12.5px; }
.dot-muted { font-weight:400; color:var(--muted); }
.dot-pills { display:flex; flex-wrap:wrap; gap:6px; margin-left:auto; }
.dot-pill { padding:3px 10px; border-radius:999px; background:var(--panel2); border:1px solid var(--line); font-size:11.5px; color:var(--muted); }
.dot-pill b { color:var(--ink); font-weight:600; }
.dot-chat { display:flex; flex-direction:column; min-height:520px; padding:0; }
.dot-msgs { flex:1; padding:16px; display:flex; flex-direction:column; gap:14px; }
.dot-m { max-width:82%; padding:10px 14px; border-radius:14px; }
.dot-m--user { align-self:flex-end; background:var(--panel2); border-bottom-right-radius:4px; }
.dot-m--dot { align-self:flex-start; background:var(--dot-soft); border:1px solid color-mix(in srgb, var(--dot) 40%, transparent); border-bottom-left-radius:4px; }
.dot-m--error { align-self:flex-start; color:var(--deny); border:1px solid var(--deny); }
.dot-remembered { display:inline-block; margin:8px 6px 0 0; padding:2px 10px; border-radius:999px; background:var(--dot); color:#04211e; font-size:11.5px; }
.dot-tool { align-self:flex-start; width:82%; border:1px solid var(--line); border-radius:10px; background:var(--panel2); padding:10px 12px; font-size:12.5px; }
.dot-tool__row { display:flex; align-items:center; gap:8px; }
.dot-tool details { margin-top:6px; color:var(--muted); } .dot-tool pre { margin:6px 0 0; padding:8px; border-radius:6px; background:var(--bg); overflow:auto; font-size:11.5px; white-space:pre-wrap; }
.dot-verdict { margin-left:auto; padding:2px 10px; border-radius:999px; font-size:11px; font-weight:700; }
.dot-verdict--permit { background:rgba(52,211,153,.16); color:var(--ok); }
.dot-verdict--deny { background:rgba(248,113,113,.16); color:var(--deny); }
.dot-verdict--consent { background:rgba(251,191,36,.16); color:var(--warn); }
.dot-chips { display:flex; flex-wrap:wrap; gap:6px; padding:0 16px 10px; }
.dot-chip { padding:4px 12px; border:1px solid var(--line); border-radius:999px; background:none; color:var(--ink); font:inherit; font-size:12.5px; cursor:pointer; }
.dot-composer { display:flex; gap:8px; padding:12px 16px; border-top:1px solid var(--line); }
.dot-composer input { flex:1; padding:9px 12px; border:1px solid var(--line); border-radius:8px; background:var(--bg); color:var(--ink); font:inherit; }
.dot-composer button { padding:9px 18px; border:0; border-radius:8px; background:var(--dot); color:#04211e; font:inherit; font-weight:600; cursor:pointer; }
.dot-composer button:disabled { opacity:.5; cursor:default; }
.dot-aside { display:flex; flex-direction:column; gap:16px; }
.dot-aside h3 { margin:0 0 4px; font-size:13px; } .dot-sub { margin:0 0 10px; color:var(--muted); font-size:12px; }
.dot-gov { display:grid; gap:8px; font-size:12.5px; } .dot-gov > div { display:flex; justify-content:space-between; gap:8px; }
.dot-gov span:first-child { color:var(--muted); }
.dot-signin { margin:16px; padding:16px; border:1px solid var(--line); border-radius:10px; background:var(--panel2); }
.dot-signin h3 { margin:0 0 6px; } .dot-signin p { margin:0 0 10px; color:var(--muted); font-size:13px; }
```

- [ ] **Step 2: Commit** — `git add demo_api_ui/src/components/dot/DotWorkbench.css && git commit -m "feat(dot): workbench styles"`.

---

### Task 4: The page

**Files:**
- Create: `demo_api_ui/src/pages/DotWorkbenchPage.jsx`
- Test: `demo_api_ui/src/pages/__tests__/DotWorkbenchPage.test.jsx`

**Interfaces:**
- Consumes: `mapInvokeResult` (Task 1), `DOT_SUGGESTIONS`, `DotToolCard`/`DotPersonaCard`/`DotGovernsPanel`/`useDotPersona` (Task 2), `DotMemoryPanel({ refreshNonce })`, `usePageAgentMode('personal-agent')` → `[mode, setMode]`, `PageAgentModeToggle({ mode, onChange })`, `openSignIn` from `utils/signInService`.
- Produces: default export `DotWorkbenchPage({ user })`.

- [ ] **Step 1: Write the failing test**

```jsx
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/signInService', () => ({ openSignIn: vi.fn() }));
vi.mock('../../components/DotMemoryPanel', () => ({ default: ({ refreshNonce }) => <div data-testid="memory" data-nonce={refreshNonce}>memory</div> }));
import { openSignIn } from '../../utils/signInService';
import DotWorkbenchPage from '../DotWorkbenchPage';

const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
function mockFetch(invoke) {
  global.fetch = vi.fn(async (url) => {
    if (String(url).includes('/api/agent-builder/state')) {
      return json(200, { agent: { id: 'ag-9', name: 'Dot' }, resources: [{ granted: ['miles:read'] }] });
    }
    return invoke();
  });
}
const renderPage = () => render(<MemoryRouter><DotWorkbenchPage user={{ email: 'sam@x.com' }} /></MemoryRouter>);
const send = (text) => {
  fireEvent.change(screen.getByRole('textbox', { name: /message dot/i }), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
};

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('DotWorkbenchPage', () => {
  it('renders persona (real values), chat, memory and governs panels', async () => {
    mockFetch(() => json(200, {}));
    renderPage();
    expect(await screen.findByText('ag-9')).toBeTruthy();
    expect(screen.getByText('sam@x.com')).toBeTruthy();
    expect(screen.getByTestId('memory')).toBeTruthy();
    expect(screen.getByLabelText('What Ping governs')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Suggested prompts' })).toBeTruthy();
  });

  it('a permitted tool call renders a PERMIT card and Dot reply; memories bump the memory panel', async () => {
    mockFetch(() => json(200, { reply: 'Got it.', success: true, toolsCalled: ['book_flight'], dotMemories: ['aisle seats'] }));
    renderPage();
    send('Always book me an aisle seat');
    expect(await screen.findByText('PERMIT')).toBeTruthy();
    expect(screen.getByText('Got it.')).toBeTruthy();
    expect(screen.getByText(/remembered: aisle seats/)).toBeTruthy();
    expect(screen.getByTestId('memory').dataset.nonce).toBe('1');
  });

  it('a gateway deny (200 + success:false) renders DENY, not PERMIT', async () => {
    mockFetch(() => json(200, { reply: '❌ access_denied', success: false, toolsCalled: ['transfer_miles'] }));
    renderPage();
    send('Transfer 20000 miles');
    expect(await screen.findByText('DENY')).toBeTruthy();
    expect(screen.queryByText('PERMIT')).toBeNull();
  });

  it('401 shows the sign-in panel and no card; its button opens sign-in', async () => {
    mockFetch(() => json(401, { error: 'authentication_required' }));
    renderPage();
    send('hello');
    const btn = await screen.findByRole('button', { name: /sign in/i });
    expect(screen.queryByText('PERMIT')).toBeNull();
    fireEvent.click(btn);
    expect(openSignIn).toHaveBeenCalled();
  });

  it('a network failure shows an error bubble and re-enables Send', async () => {
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes('agent-builder')) return json(401, {});
      throw new Error('net');
    });
    renderPage();
    send('hi');
    expect(await screen.findByText('Dot could not complete that request.')).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('textbox', { name: /message dot/i }).value).toBe(''));
  });

  it('chips send their prompt and disappear after the first message', async () => {
    mockFetch(() => json(200, { reply: 'ok', success: true, toolsCalled: [] }));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Call me Sam' }));
    await screen.findByText('ok');
    expect(screen.queryByRole('group', { name: 'Suggested prompts' })).toBeNull();
  });

  it('skin tabs link to the Studio; theme button toggles', () => {
    mockFetch(() => json(200, {}));
    renderPage();
    expect(screen.getByRole('link', { name: 'Claude' }).getAttribute('href')).toContain('/personal-agent?skin=claude');
    fireEvent.click(screen.getByRole('button', { name: /light|dark/i }));
    expect(document.querySelector('[data-cur-theme]').getAttribute('data-cur-theme')).toBe('light');
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run src/pages/__tests__/DotWorkbenchPage.test.jsx` → FAIL (module missing).

- [ ] **Step 3: Implement** `DotWorkbenchPage.jsx`

```jsx
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import DotMemoryPanel from '../components/DotMemoryPanel';
import PageAgentModeToggle, { usePageAgentMode } from '../components/shared/PageAgentModeToggle';
import DotToolCard from '../components/dot/DotToolCard';
import DotPersonaCard from '../components/dot/DotPersonaCard';
import DotGovernsPanel from '../components/dot/DotGovernsPanel';
import { useDotPersona } from '../components/dot/useDotPersona';
import { mapInvokeResult } from '../utils/dotChat';
import { DOT_SUGGESTIONS } from '../config/dotSuggestions';
import { openSignIn } from '../utils/signInService';
// Same workbench shell sheet as /privilege-a2a (cur-ide / cur-titlebar), plus Dot's own.
import './PrivilegeMcpClientPage.css';
import '../components/dot/DotWorkbench.css';

const SKINS = [['privilege', 'Privilege'], ['claude', 'Claude'], ['gpt', 'ChatGPT'], ['gemini', 'Gemini']];

export default function DotWorkbenchPage({ user }) {
  const persona = useDotPersona();
  const [agentMode, setAgentMode] = usePageAgentMode('personal-agent');
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('cur_priv_theme') || 'dark'; } catch { return 'dark'; }
  });
  const [items, setItems] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [memNonce, setMemNonce] = useState(0);
  const identity = user?.email || user?.username || user?.name || '';

  const flipTheme = () => setTheme((t) => {
    const next = t === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('cur_priv_theme', next); } catch { /* storage disabled */ }
    return next;
  });

  async function send(text) {
    const prompt = (text ?? input).trim();
    if (!prompt || busy) return;
    setInput('');
    setBusy(true);
    setSignedOut(false);
    setItems((prev) => [...prev, { kind: 'user', text: prompt }]);
    let mapped;
    try {
      const res = await fetch('/api/agent/invoke', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, vertical: 'airlines', agentMode }),
      });
      mapped = mapInvokeResult(res.status, await res.json().catch(() => null));
    } catch {
      mapped = mapInvokeResult(0, null);
    }
    if (mapped.signedOut) setSignedOut(true);
    // dotMemories ride on the Dot bubble so the chip sits under the reply that learned it.
    const withMemories = mapped.items.map((i) => (i.kind === 'dot' && mapped.memories.length ? { ...i, memories: mapped.memories } : i));
    setItems((prev) => [...prev, ...withMemories]);
    if (mapped.memories.length) setMemNonce((n) => n + 1);
    setBusy(false);
  }

  const cards = items.filter((i) => i.kind === 'tool');
  return (
    <div className="cur-ide dot-wb" data-cur-theme={theme} data-testid="dot-workbench-page" style={{ minHeight: 0 }}>
      <header className="cur-titlebar">
        <div className="cur-titlebar-left"><span className="cur-titlebar-title">Digital Assistant</span></div>
        <nav className="cur-titlebar-center" aria-label="Agent skins">
          {SKINS.map(([id, label]) => <Link key={id} className="cur-flow-trigger" to={`/personal-agent?skin=${id}`}>{label}</Link>)}
          <span className="cur-flow-trigger" aria-current="page">Persona Agent (Dot)</span>
        </nav>
        <div className="cur-titlebar-right">
          <PageAgentModeToggle mode={agentMode} onChange={setAgentMode} />
          <button type="button" className="cur-flow-trigger" onClick={flipTheme}>{theme === 'dark' ? 'Light' : 'Dark'}</button>
        </div>
      </header>

      <main className="dot-wb__main">
        <div>
          <DotPersonaCard persona={persona} identity={identity} />
          <div className="dot-card dot-chat">
            <div className="dot-msgs" aria-live="polite">
              {items.map((i, n) => {
                if (i.kind === 'tool') return <DotToolCard key={n} item={i} />;
                if (i.kind === 'user') return <div key={n} className="dot-m dot-m--user">{i.text}</div>;
                if (i.kind === 'error') return <div key={n} className="dot-m dot-m--error">{i.text}</div>;
                return (
                  <div key={n} className="dot-m dot-m--dot">
                    {i.text}
                    {i.memories?.length > 0 && <div>{i.memories.map((m) => <span key={m} className="dot-remembered">remembered: {m}</span>)}</div>}
                  </div>
                );
              })}
            </div>
            {signedOut && (
              <div className="dot-signin" role="alert">
                <h3>Sign in to use Dot</h3>
                <p>Dot acts on your behalf under your own identity, so it needs you signed in first.</p>
                <button type="button" className="dot-chip" onClick={() => openSignIn({ returnTo: '/personal-agent/dot' })}>Sign in</button>
              </div>
            )}
            {items.length === 0 && (
              <div className="dot-chips" role="group" aria-label="Suggested prompts">
                {DOT_SUGGESTIONS.map((s) => <button key={s} type="button" className="dot-chip" onClick={() => send(s)}>{s}</button>)}
              </div>
            )}
            <form className="dot-composer" onSubmit={(e) => { e.preventDefault(); send(); }}>
              <input aria-label="Message Dot" placeholder="Ask Dot anything about your account…" value={input} onChange={(e) => setInput(e.target.value)} />
              <button type="submit" disabled={busy || !input.trim()}>Send</button>
            </form>
          </div>
        </div>
        <aside className="dot-aside">
          <section className="dot-card"><DotMemoryPanel refreshNonce={memNonce} /></section>
          <DotGovernsPanel cards={cards} persona={persona} mode={agentMode} />
        </aside>
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Run** — `npx vitest run src/pages/__tests__/DotWorkbenchPage.test.jsx` → all PASS. If a case fails on markup detail (e.g. role of the toggle), adjust the **component**, not the assertion's intent.
- [ ] **Step 5: Commit** — `git add demo_api_ui/src/pages/DotWorkbenchPage.jsx demo_api_ui/src/pages/__tests__/DotWorkbenchPage.test.jsx && git commit -m "feat(dot): workbench page"`.

---

### Task 5: Route, auth requirement, Studio link

**Files:**
- Modify: `demo_api_ui/src/App.js` (import + `<Route path="/personal-agent/dot" …>` next to `/personal-agent/client`), `demo_api_server/config/auth-requirements.json` (add `"/personal-agent/dot": "public"` after `"/personal-agent/client"`), `demo_api_ui/src/config/personalAgentClients.js` (Dot card `setupPath` → `/personal-agent/dot`, `actionLabel` → `"Open the Dot workbench"`)
- Test: `demo_api_ui/src/config/__tests__/personalAgentClients.test.js` (update any assertion on the old Dot `setupPath`/label)

**Interfaces:** Consumes `DotWorkbenchPage({ user })`. Route element: `<AppShell user={user} logout={logout}><DotWorkbenchPage user={user} /></AppShell>` (same wrapper as `/personal-agent`).

- [ ] **Step 1:** Run `npm run authz:verify` from repo root first. Expected: FAIL (route in App.js without an `auth-requirements.json` entry) once the route is added in step 2 — do step 2 then re-run to see it red, then add the JSON entry.
- [ ] **Step 2:** Add the import and Route to `App.js`.
- [ ] **Step 3:** Add the `auth-requirements.json` line; run `npm run authz:verify` → PASS; `node --test scripts/check-auth-requirements.test.js` → PASS.
- [ ] **Step 4:** Update the Dot card in `personalAgentClients.js`; run `npx vitest run src/config/__tests__/personalAgentClients.test.js src/components/learning/__tests__/PersonalAgentClientCards.test.jsx` and fix only assertions that hard-code the old Dot path/label.
- [ ] **Step 5:** Commit — `git add demo_api_ui/src/App.js demo_api_server/config/auth-requirements.json demo_api_ui/src/config/personalAgentClients.js demo_api_ui/src/config/__tests__/personalAgentClients.test.js` (+ any updated card test) then `git commit -m "feat(dot): route /personal-agent/dot, public; Studio links to it"`.

---

### Task 6: Verify, PR, deploy, check

- [ ] **Step 1: Full local checks** (from `demo_api_ui`): `npx vitest run src/pages src/components/dot src/utils src/config` → 0 failures; `npm run build` succeeds. From repo root: `npm run hygiene:check` and `npm run authz:verify` pass.
- [ ] **Step 2: Learning Hub / diagram sync.** Read the "Dots" lesson in `lessonCatalog` and the Dot copy in the Learning Hub; if either describes the Dot UI (pop-out only), add one sentence pointing at the workbench; keep `REQUIRED_IDS` test passing (do not add lesson ids).
- [ ] **Step 3: PR** — push the branch, `gh pr create`; wait for CI (`gh pr checks <n> --watch`); hand the user `gh pr merge <n> --merge`; verify `MERGED` before any cleanup.
- [ ] **Step 4: Deploy (focused, frontend only)** — find the merge sha's frontend image with `docker buildx imagetools inspect ghcr.io/cmuir_pingcorp/ai-demo-frontend:sha-<sha>` (CI builds only changed services: if that sha has no frontend image, use the newest main sha that does and contains the merge). Then, in a script with `set -euo pipefail` and NO piping of the promote: `SE_NAMESPACE=ping-devops-cmuir SE_ALLOW_WORKTREE=1 ./se-update-code.sh --promote <sha> frontend`, `kubectl set image deployment/frontend frontend=ghcr.io/cmuir_pingcorp/ai-demo-frontend:sha-<sha> -n ping-devops-cmuir`, `kubectl rollout status`.
- [ ] **Step 5: Verify live** — `curl -sk -o /dev/null -w "%{http_code}" https://ai-demo.ping-devops.com/personal-agent/dot` → 200; grep the served bundle for `Persona Agent (Dot)`; then a headless Playwright script (separate from the MCP browser) loads the page signed out, confirms persona card, skin tabs, chips, the theme toggle, and that sending a message shows the sign-in panel (no card). Signed-in behaviour (PERMIT/DENY cards, memory refresh) is checked by the user or with the promptfoo auth helper's cookie (`demo_api_server/promptfoo/auth-cookie.js`, local stack only; AIC login must be off).
- [ ] **Step 6: Clean up** only after `gh pr view` shows `MERGED`: remove the worktree, delete the local and remote branch.

---

## Self-review
- **Spec coverage:** layout/title bar/skin tabs/mode toggle/theme (Task 4), persona card with real-or-dash values (Tasks 2, 4), tool cards + verdict rules (Tasks 1, 2), memory + refresh nonce (Task 4), governs panel (Task 2), signed-out panel (Task 4), chips reuse (Tasks 1, 4), route + auth-requirements (Task 5), Learning Hub sync + deploy + browser check (Task 6). Spec's "403→DENY / 428→CONSENT / 401→panel" is Task 1; the plan adds the 200+`success:false` DENY found in the live route (spec delta above).
- **Placeholders:** none; every code step is complete. Task 5 Step 4 edits assertions "only if they hard-code the old path" because that test's content wasn't read during planning; the executor must read it first.
- **Type consistency:** `mapInvokeResult` → `{signedOut, items, memories}` and `Item` kinds (`dot|tool|error`; `user` is added by the page only) are used identically in Tasks 1, 2, 4; `useDotPersona` shape `{agentName, agentId, scopes, loaded}` matches both consumers.
