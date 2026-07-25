# Actions Dropdown Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the AIAgent "Actions" dropdown (`BankingChips.jsx` + `SecurityShowcasePanel.jsx`) after covering every gap it leaves behind, so `/use-cases` plus two small targeted surfaces become the only place these actions are reachable.

**Architecture:** Three new/changed surfaces absorb the dropdown's content — `RAW_USE_CASES` gains 3 entries (My mortgage, 2 AI-reasoning chips) that surface automatically in `/use-cases`'s existing grid; a new small `Admin ▾` header popout (same pattern as the existing `DemoStepsDropdown`) replaces the 14 admin/PingOne-admin chips; a "Run" button on `CustomChipsTab.js` replaces the "My Actions" custom-chip launcher. `/use-cases` page code itself is not touched. Once all three land, `BankingChips.jsx` and `SecurityShowcasePanel.jsx` are deleted along with the Actions trigger/popout in `AIAgent.js`, and the header's utility controls (scope toggle, clear progress) move inline.

**Tech Stack:** Node/Express (demo_api_server), React (demo_api_ui, Vitest + React Testing Library on the frontend, Jest + supertest on the backend).

## Global Constraints

- Emoji allowlist only: `⚠️` `✅` `❌` `🔐` `✕` `✓` `👤` `🔑` `🪟` `📚` — everything else stays plain text/CSS.
- Work happens only in this worktree (`.claude/worktrees/actions-dropdown-removal-spec`), one branch, never the main checkout.
- Stage files explicitly (`git add <files>`), never `git add -A`.
- Frontend tests use **Vitest** (`vi.mock`, `vi.fn`, `import ... from 'vitest'`), not Jest — confirmed via `DemoStepsDropdown.test.jsx`.
- Backend route tests use **Jest + supertest**, mocking `../middleware/auth` — confirmed via `adminAgentRestrictions.test.js`.
- Every `RAW_USE_CASES` entry with `trigger.type === 'chip'` must either declare a real `primaryTool` that exists in the tool registry, or be named in an explicit exemption set in `useCases.primaryTool.test.js` — this is an enforced drift gate, not a suggestion.
- Design spec of record: `docs/superpowers/specs/2026-07-24-actions-dropdown-removal-design.md`.

---

## File Structure

**Create:**
- `demo_api_server/config/adminTools.js` — `ADMIN_TOOLS` list (14 items: 8 banking customer-CRUD, 6 PingOne platform ops)
- `demo_api_server/routes/adminTools.js` — `GET /api/admin-tools?vertical=`
- `demo_api_server/tests/adminTools.route.test.js`
- `demo_api_ui/src/components/AdminToolsDropdown.jsx` — small admin-only header popout, mirrors `DemoStepsDropdown.jsx`
- `demo_api_ui/src/components/__tests__/AdminToolsDropdown.test.jsx`

**Modify:**
- `demo_api_server/config/useCases.js` — add UC33, UC34, UC35
- `demo_api_server/tests/useCases.primaryTool.test.js` — add `LLM_ANALYSIS_UNROUTABLE` exemption
- `demo_api_server/server.js` — mount the new route
- `demo_api_ui/src/components/AIAgent.js` — remove Actions trigger + popout + `BankingChips` mount + free-text search box; add `AdminToolsDropdown` mount; move `ScopePicker`/"Clear progress" inline into the header row
- `demo_api_ui/src/components/CustomChipsTab.js` — add a "Run" button per chip row

**Delete:**
- `demo_api_ui/src/components/BankingChips.jsx`
- `demo_api_ui/src/components/BankingChips.css`
- `demo_api_ui/src/components/SecurityShowcasePanel.jsx`
- `demo_api_ui/src/components/SecurityShowcasePanel.css`

**Check and fix (Task 9):**
- e2e Playwright specs referencing `.ba-actions-trigger` / `.ba-actions-popout`

---

### Task 1: Catalog gaps — UC33/UC34/UC35 + drift-gate exemption

**Files:**
- Modify: `demo_api_server/config/useCases.js` (insert after UC20, before the `// --- CONTROLS ---` comment, currently around line 305)
- Modify: `demo_api_server/tests/useCases.primaryTool.test.js`
- Test: same two files (this task is data + a test-contract change, verified by running the existing suite)

**Interfaces:**
- Produces: catalog entries `UC33` (`useCaseId: 'mortgage-delegated-access'`), `UC34` (`useCaseId: 'ai-spot-unusual-patterns'`), `UC35` (`useCaseId: 'ai-explain-last-denial'`), each with `track: 'foundations'` — later tasks don't depend on these.

- [ ] **Step 1: Add UC33, UC34, UC35 to `RAW_USE_CASES`**

Insert immediately after UC20's closing `},` (the entry ending `perVertical: READ_PER_VERTICAL,\n  },` right before the `// --- CONTROLS ---` comment):

```js
  {
    id: 'UC33',
    useCaseId: 'mortgage-delegated-access',
    track: 'foundations',
    title: 'My mortgage',
    buyerStory: "Delegated-access proof can't be special-cased per tool — every account type the agent touches needs the same chain of custody, not just the everyday balance check.",
    pingOneSolution: 'The same RFC 8693 delegated token (act={agent}) authorizes every tool call, including less-common products like a mortgage — one token exchange covers the whole tool surface.',
    trigger: { type: 'chip', text: 'show my mortgage' },
    expectedOutcome: 'PERMIT',
    evidence: { tokenChain: ['user-token', 'token-exchange', 'authorize-decision', 'tool-dispatched'], activity: ['token', 'authorize', 'mcp'] },
    codeRefs: ['demo_api_server/services/agentMcpTokenService.js', 'demo_mcp_gateway/src/auth/GatewayTokenPolicy.ts'],
    maturity: 'works',
    owasp: { threats: ['T8', 'T9'], sections: ['§4.1.1', '§3.3.3', '§8'] },
    whatToSay: 'Same delegated token, a different tool — the act claim proves the agent all the way to a mortgage lookup, not just a balance check.',
    advanced: false,
    whatLong: "Delegated-access proof isn't special-cased per tool. This scenario runs the identical RFC 8693 chain from UC1 — user token, act={agent}, gateway validation, Authorize decision — against a less-common tool (mortgage lookup) to show the proof travels with every call the agent makes, not just the common ones.",
    businessValue: "Attribution coverage doesn't shrink as the agent's tool surface grows. Adding a new tool never means adding new attribution plumbing — every call already carries the same proof.",
    productRoles: {
      idp:   'Mints the same delegated token regardless of which tool the agent calls next.',
      gw:    'Validates the token identically no matter which tool it is routed to.',
      authz: 'Evaluates the same act-claim policy for every tool in scope.',
    },
    primaryTool: 'show_mortgage',
    // Mortgage is a banking-only product — other verticals fall back to their own
    // read chip/tool (same convention as UC28) so the routing gate holds everywhere.
    perVertical: READ_PER_VERTICAL,
  },
  {
    id: 'UC34',
    useCaseId: 'ai-spot-unusual-patterns',
    track: 'foundations',
    title: 'Spot unusual patterns',
    buyerStory: 'A security-aware agent should be able to reason over live activity, not just execute fixed lookups — and that reasoning has to run through the same governed pipeline as everything else.',
    pingOneSolution: 'The free-form LLM path runs through the identical RFC 8693 → gateway → Authorize legs as a heuristic chip — reasoning is not a shortcut around the policy chain.',
    trigger: { type: 'chip', text: 'Check for unusual patterns in my recent activity' },
    expectedOutcome: 'PERMIT',
    evidence: { tokenChain: ['user-token', 'token-exchange', 'authorize-decision', 'tool-dispatched'], activity: ['token', 'authorize', 'mcp'] },
    codeRefs: ['demo_api_server/services/demoAgentLangGraphService.js'],
    maturity: 'works',
    owasp: { threats: ['T8'], sections: ['§3.3.3'] },
    whatToSay: 'The analysis path runs the full pipeline — same RFC 8693 → gateway → Authorize legs as a heuristic chip, no shortcut.',
    advanced: false,
    whatLong: 'Not every useful agent action is a fixed lookup. This scenario asks the agent to reason freely over recent activity for anything unusual — the LLM decides what to look at and how to summarize it, but every underlying tool call it makes still goes through the same token-exchange and Authorize legs as a deterministic chip.',
    businessValue: 'Free-form reasoning does not create a policy gap. Whatever the agent decides to look at, every tool call it actually makes is still attributed and authorized — reasoning changes what runs, never whether it is governed.',
    productRoles: {
      llm: 'Reasons over the request and issues whichever tool calls it decides are relevant.',
      gw: 'Validates and routes every tool call the reasoning step issues, same as any other call.',
      authz: 'Evaluates each resulting tool call independently — freeform intent grants no special access.',
    },
    // Free-form LLM analysis — no single deterministic tool to declare (see
    // LLM_ANALYSIS_UNROUTABLE in useCases.primaryTool.test.js). Same shape as the
    // banking manifest's own bk8 chip, which is deliberately kept out of the
    // catalog for the same reason; this entry exists instead so the demo stays
    // reachable from /use-cases after the Actions dropdown is removed.
  },
  {
    id: 'UC35',
    useCaseId: 'ai-explain-last-denial',
    track: 'foundations',
    title: 'Why was that blocked?',
    buyerStory: 'When a control fires, the person watching the demo should be able to ask the agent to explain itself in plain language — backed by the real evidence, not a canned line.',
    pingOneSolution: "The agent explains its own security posture by reading the live token-chain events, not a scripted explanation — the explanation is only as good as the evidence PingOne actually produced.",
    trigger: { type: 'chip', text: 'Explain why my last blocked action was denied and walk me through the token chain' },
    expectedOutcome: 'PERMIT',
    evidence: { tokenChain: ['user-token', 'token-exchange', 'authorize-decision'], activity: ['token', 'authorize'] },
    codeRefs: ['demo_api_server/services/demoAgentLangGraphService.js', 'demo_api_server/services/appEventService.js'],
    maturity: 'works',
    owasp: { threats: ['T8'], sections: ['§3.3.3', '§8'] },
    whatToSay: 'The agent explained its own security posture from the live token-chain events — useful for teaching why a control fired.',
    advanced: false,
    whatLong: "After a control fires (a DENY, a step-up, a consent gate), the agent can be asked to explain what just happened. It reads the real token-chain events from the run — not a canned script — and narrates the decision in plain language, teaching the audience why the control triggered.",
    businessValue: 'Every enforcement decision is self-explaining. Support and audit teams get a plain-language narration of what PingOne decided and why, sourced from the same evidence an auditor would pull, not a separate explanation system that can drift from reality.',
    productRoles: {
      llm: "Narrates the live token-chain evidence in plain language — it explains PingOne's decision, it doesn't make one.",
      authz: 'Recorded the original PERMIT/DENY/STEP_UP decision the explanation is built from.',
    },
    // Free-form LLM explanation — no single deterministic tool (see UC34's note
    // and LLM_ANALYSIS_UNROUTABLE in useCases.primaryTool.test.js).
  },
```

- [ ] **Step 2: Add the `LLM_ANALYSIS_UNROUTABLE` exemption to the drift-gate test**

In `demo_api_server/tests/useCases.primaryTool.test.js`, next to the existing `A2A_UNROUTABLE` constant (currently `const A2A_UNROUTABLE = /specialist/i;`), add:

```js
/** UC34/UC35 are free-form LLM analysis chips with no single deterministic tool — the
 *  only other sanctioned exception besides A2A "specialist" handoffs. */
const LLM_ANALYSIS_UNROUTABLE = new Set(['UC34', 'UC35']);
```

Then update both filter sites to also skip these ids. In `chipEntries()`:

```js
      if (t.type !== 'chip' || !t.text) continue;
      if (A2A_UNROUTABLE.test(t.text) || LLM_ANALYSIS_UNROUTABLE.has(u.id)) continue;
```

And in the `'every chip DECLARES a primaryTool'` test body:

```js
        if (t.type !== 'chip' || !t.text || A2A_UNROUTABLE.test(t.text) || LLM_ANALYSIS_UNROUTABLE.has(u.id)) continue;
```

- [ ] **Step 3: Run the drift-gate suite and the vertical-coverage suite**

Run: `cd demo_api_server && npx jest tests/useCases.primaryTool.test.js tests/useCases.verticalChipCoverage.test.js`
Expected: all tests PASS. If the vertical-coverage suite fails on UC33/34/35, read its failure message (it names the vertical/id) and adjust — most likely UC33 needs no change (it inherits `READ_PER_VERTICAL` like UC28), UC34/35 should already be exempt via the same `useCaseId` pattern that suite uses for A2A specialist chips (check its own exemption mechanism if it fails; it is a sibling file, not covered by this plan's earlier reads).

- [ ] **Step 4: Commit**

```bash
git add demo_api_server/config/useCases.js demo_api_server/tests/useCases.primaryTool.test.js
git commit -m "feat: add UC33-35 catalog entries (mortgage, AI reasoning gaps)"
```

---

### Task 2: `ADMIN_TOOLS` config data

**Files:**
- Create: `demo_api_server/config/adminTools.js`
- Test: `demo_api_server/tests/adminTools.route.test.js` (shape assertions only in this task; route behavior is Task 3)

**Interfaces:**
- Produces: `ADMIN_TOOLS` — array of `{ id: string, title: string, trigger: {type:'chip', text:string}, adminAgent?: true }`, exported from `demo_api_server/config/adminTools.js`. Task 3 imports this directly.

- [ ] **Step 1: Write the failing shape test**

Create `demo_api_server/tests/adminTools.route.test.js`:

```js
'use strict';

const { ADMIN_TOOLS } = require('../config/adminTools');

describe('ADMIN_TOOLS data shape', () => {
  test('has 14 entries: 8 banking CRUD + 6 PingOne platform ops', () => {
    expect(ADMIN_TOOLS).toHaveLength(14);
    const adminAgentCount = ADMIN_TOOLS.filter((t) => t.adminAgent === true).length;
    expect(adminAgentCount).toBe(6);
  });

  test('every entry has a unique id, a title, and a chip trigger with text', () => {
    const ids = new Set();
    for (const tool of ADMIN_TOOLS) {
      expect(typeof tool.id).toBe('string');
      expect(ids.has(tool.id)).toBe(false);
      ids.add(tool.id);
      expect(typeof tool.title).toBe('string');
      expect(tool.title.length).toBeGreaterThan(0);
      expect(tool.trigger).toEqual({ type: 'chip', text: expect.any(String) });
      expect(tool.trigger.text.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest tests/adminTools.route.test.js`
Expected: FAIL with `Cannot find module '../config/adminTools'`

- [ ] **Step 3: Write `ADMIN_TOOLS`**

Create `demo_api_server/config/adminTools.js`:

```js
'use strict';

/**
 * Admin Tools — customer-CRUD (banking, admin role) + PingOne platform ops
 * (worker client_credentials via the isolated admin agent). Deliberately NOT
 * part of the useCases.js trust-ladder catalog — same reasoning as
 * config/admin/demoSteps.js: no consent/HITL gate or tokenChain evidence
 * narrative to attach, just plain NL prompts. `adminAgent: true` marks the
 * 6 entries that must route through /api/admin-agent/message instead of the
 * normal MCP-tool chip pipeline.
 */
const ADMIN_TOOLS = [
  // --- Banking customer CRUD (8) — normal MCP-tool chips, no special routing ---
  { id: 'lookup_customer', title: 'Look Up Customer', trigger: { type: 'chip', text: 'look up a customer' } },
  { id: 'get_customer_transactions', title: 'View Transactions', trigger: { type: 'chip', text: 'show last 5 transactions for this customer' } },
  { id: 'get_customer_profile', title: 'View Profile', trigger: { type: 'chip', text: 'show full profile for this customer' } },
  { id: 'get_customer_accounts', title: 'View Accounts', trigger: { type: 'chip', text: 'show all accounts for this customer' } },
  { id: 'freeze_account', title: 'Freeze Account', trigger: { type: 'chip', text: 'freeze this account' } },
  { id: 'adjust_balance', title: 'Adjust Balance', trigger: { type: 'chip', text: 'adjust account balance' } },
  { id: 'reset_customer_password', title: 'Reset Password', trigger: { type: 'chip', text: 'reset password for this customer' } },
  { id: 'delete_customer', title: 'Delete Customer', trigger: { type: 'chip', text: 'delete this customer' } },
  // --- PingOne platform ops (6) — routed to the isolated admin agent ---
  { id: 'p1_list_apps', title: 'List all apps', trigger: { type: 'chip', text: 'List all applications in our PingOne environment' }, adminAgent: true },
  { id: 'p1_list_envs', title: 'List environments', trigger: { type: 'chip', text: 'Show all environments I have access to in PingOne' }, adminAgent: true },
  { id: 'p1_services_enabled', title: 'What services are enabled?', trigger: { type: 'chip', text: 'What services are enabled in our PingOne environment?' }, adminAgent: true },
  { id: 'p1_identity_count', title: 'Identity count this week', trigger: { type: 'chip', text: 'How many identities are in our PingOne environment?' }, adminAgent: true },
  { id: 'p1_ai_agent_config', title: 'Show Demo AI Agent config', trigger: { type: 'chip', text: 'Get the configuration for the Demo AI Agent application in PingOne' }, adminAgent: true },
  { id: 'p1_verify_apps', title: 'Verify all 8 demo apps', trigger: { type: 'chip', text: 'Confirm all 8 demo apps exist in PingOne: Demo Admin App, Demo User App, Demo MCP Server, Demo Worker, Demo MCP Exchanger, Demo MCP Gateway, Demo Agent, Demo AI Agent' }, adminAgent: true },
];

module.exports = { ADMIN_TOOLS };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && npx jest tests/adminTools.route.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/config/adminTools.js demo_api_server/tests/adminTools.route.test.js
git commit -m "feat: add ADMIN_TOOLS config data"
```

---

### Task 3: `GET /api/admin-tools` route

**Files:**
- Create: `demo_api_server/routes/adminTools.js`
- Modify: `demo_api_server/server.js` (mount, next to the `/api/use-cases` mount at the line reading `app.use('/api/use-cases', authenticateToken, require('./routes/useCases'));`)
- Test: `demo_api_server/tests/adminTools.route.test.js` (extend from Task 2)

**Interfaces:**
- Consumes: `ADMIN_TOOLS` from `../config/adminTools` (Task 2).
- Produces: `GET /api/admin-tools` → `200 { tools: ADMIN_TOOLS }` for an admin session, `403` otherwise. Task 4 (`AdminToolsDropdown.jsx`) calls this endpoint.

- [ ] **Step 1: Write the failing route test**

Append to `demo_api_server/tests/adminTools.route.test.js`:

```js
describe('GET /api/admin-tools', () => {
  jest.mock('../middleware/auth', () => ({
    authenticateToken: (req, res, next) => next(),
    requireAdmin: jest.fn((req, res, next) => {
      if (req.session?.user?.role === 'admin') return next();
      return res.status(403).json({ error: 'admin_required' });
    }),
  }));

  const request = require('supertest');
  const express = require('express');

  function buildApp(role) {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
      req.session = { user: { role } };
      next();
    });
    app.use('/api/admin-tools', require('../routes/adminTools'));
    return app;
  }

  test('returns all 14 tools for an admin session', async () => {
    const res = await request(buildApp('admin')).get('/api/admin-tools');
    expect(res.status).toBe(200);
    expect(res.body.tools).toHaveLength(14);
  });

  test('returns 403 for a non-admin session', async () => {
    const res = await request(buildApp('user')).get('/api/admin-tools');
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && npx jest tests/adminTools.route.test.js`
Expected: FAIL with `Cannot find module '../routes/adminTools'`

- [ ] **Step 3: Write the route**

Create `demo_api_server/routes/adminTools.js`:

```js
'use strict';

/**
 * Admin Tools API (read-only) — GET /api/admin-tools → the 14 admin/PingOne-admin
 * ops formerly in the Actions dropdown's "Admin Actions" / "PingOne Admin"
 * sections. Source of truth: config/adminTools.js.
 */

const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/auth');
const { ADMIN_TOOLS } = require('../config/adminTools');

router.get('/', requireAdmin, (req, res) => {
  res.set({ 'Cache-Control': 'private, max-age=60' });
  res.json({ tools: ADMIN_TOOLS });
});

module.exports = router;
```

- [ ] **Step 4: Mount the route**

In `demo_api_server/server.js`, immediately after the line:

```js
app.use('/api/use-cases', authenticateToken, require('./routes/useCases'));
```

add:

```js
app.use('/api/admin-tools', authenticateToken, require('./routes/adminTools'));
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd demo_api_server && npx jest tests/adminTools.route.test.js`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/routes/adminTools.js demo_api_server/server.js demo_api_server/tests/adminTools.route.test.js
git commit -m "feat: add GET /api/admin-tools route"
```

---

### Task 4: `AdminToolsDropdown.jsx` component

**Files:**
- Create: `demo_api_ui/src/components/AdminToolsDropdown.jsx`
- Test: `demo_api_ui/src/components/__tests__/AdminToolsDropdown.test.jsx`

**Interfaces:**
- Consumes: `GET /api/admin-tools` via `apiClient` (`demo_api_ui/src/services/apiClient.js`, same client `DemoStepsDropdown.jsx` uses).
- Produces: default export `AdminToolsDropdown({ open, onOpenChange, onSelect })` — `onSelect(tool)` fires with one `ADMIN_TOOLS` entry (`{id, title, trigger, adminAgent?}`) on click. Task 5 wires `onSelect` into the dispatch logic.

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/components/__tests__/AdminToolsDropdown.test.jsx`:

```jsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import AdminToolsDropdown from '../AdminToolsDropdown';
import apiClient from '../../services/apiClient';

vi.mock('../../services/apiClient', () => ({
  default: { get: vi.fn() },
}));

const TOOLS = [
  { id: 'lookup_customer', title: 'Look Up Customer', trigger: { type: 'chip', text: 'look up a customer' } },
  { id: 'p1_list_apps', title: 'List all apps', trigger: { type: 'chip', text: 'List all applications in our PingOne environment' }, adminAgent: true },
];

describe('AdminToolsDropdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiClient.get.mockResolvedValue({ data: { tools: TOOLS } });
  });

  it('renders the Admin trigger', () => {
    render(<AdminToolsDropdown open={false} onOpenChange={() => {}} onSelect={() => {}} />);
    expect(screen.getByTestId('admin-tools-trigger')).toHaveTextContent(/Admin/);
  });

  it('loads and lists tools when open', async () => {
    render(<AdminToolsDropdown open onOpenChange={() => {}} onSelect={() => {}} />);
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/api/admin-tools', expect.any(Object)));
    expect(await screen.findByText('Look Up Customer')).toBeInTheDocument();
    expect(screen.getByText('List all apps')).toBeInTheDocument();
  });

  it('calls onSelect with the clicked tool', async () => {
    const onSelect = vi.fn();
    render(<AdminToolsDropdown open onOpenChange={() => {}} onSelect={onSelect} />);
    const button = await screen.findByText('Look Up Customer');
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledWith(TOOLS[0]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/AdminToolsDropdown.test.jsx`
Expected: FAIL — cannot resolve `../AdminToolsDropdown`

- [ ] **Step 3: Write the component**

Create `demo_api_ui/src/components/AdminToolsDropdown.jsx`, modeled on `DemoStepsDropdown.jsx`'s trigger+`FloatingPanel` pattern but simplified (no primary/advanced split, no explain modal, no progress tracking):

```jsx
/**
 * AdminToolsDropdown — small admin-only header popout replacing the old
 * Actions dropdown's "Admin Actions" + "PingOne Admin" sections. Same
 * trigger+FloatingPanel pattern as DemoStepsDropdown, flat list only.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import FloatingPanel from './FloatingPanel';
import apiClient from '../services/apiClient';

/**
 * @param {object} props
 * @param {boolean} [props.open]
 * @param {(open: boolean) => void} props.onOpenChange
 * @param {(tool: object) => void} props.onSelect
 */
export default function AdminToolsDropdown({ open = false, onOpenChange, onSelect }) {
  const triggerRef = useRef(null);
  const panelPosRef = useRef({ x: 0, y: 0 });
  const [tools, setTools] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const loadTools = useCallback(() => {
    setLoading(true);
    setError(null);
    apiClient
      .get('/api/admin-tools', { _silent: true })
      .then(({ data }) => setTools(data.tools || []))
      .catch((err) => {
        setError(err.message || 'Failed to load admin tools');
        setTools([]);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (open) loadTools();
  }, [open, loadTools]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  function handleToggle() {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const panelWidth = 420;
      let x = rect.right - panelWidth;
      if (x < 8) x = 8;
      panelPosRef.current = { x, y: rect.bottom + 6 };
    }
    onOpenChange(!open);
  }

  function handleSelect(tool) {
    onOpenChange(false);
    onSelect(tool);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`ba-actions-trigger${open ? ' active' : ''}`}
        title="Admin tools — customer lookups and PingOne platform ops"
        onClick={handleToggle}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-testid="admin-tools-trigger"
      >
        Admin {open ? '▴' : '▾'}
      </button>
      {open && (
        <FloatingPanel
          title="Admin Tools"
          defaultX={panelPosRef.current.x}
          defaultY={panelPosRef.current.y}
          defaultWidth={420}
          defaultHeight={360}
          minWidth={280}
          minHeight={200}
          onClose={() => onOpenChange(false)}
          className="ba-admin-tools-float"
        >
          {loading && <p className="ba-demo-steps-popout__status">Loading…</p>}
          {error && (
            <p className="ba-demo-steps-popout__status ba-demo-steps-popout__status--error">
              {error}
            </p>
          )}
          {!loading && !error && tools.length === 0 && (
            <p className="ba-demo-steps-popout__status">No admin tools available.</p>
          )}
          <ul className="ba-demo-steps-popout__grid">
            {tools.map((tool) => (
              <li key={tool.id} className="ba-demo-steps-popout__card-item">
                <button
                  type="button"
                  className="banking-chips-dropdown__button banking-chips-dropdown__button--heuristic"
                  onClick={() => handleSelect(tool)}
                  title={tool.trigger.text}
                  data-testid={`admin-tool-${tool.id}`}
                >
                  {tool.title}
                </button>
              </li>
            ))}
          </ul>
        </FloatingPanel>
      )}
    </>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/AdminToolsDropdown.test.jsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/AdminToolsDropdown.jsx demo_api_ui/src/components/__tests__/AdminToolsDropdown.test.jsx
git commit -m "feat: add AdminToolsDropdown component"
```

---

### Task 5: Wire `AdminToolsDropdown` into `AIAgent.js`, port admin-agent dispatch

**Files:**
- Modify: `demo_api_ui/src/components/AIAgent.js`

**Interfaces:**
- Consumes: `AdminToolsDropdown` (Task 4), existing `addMessage`, `setNlLoading`, `tokenChain`, `adminCustomerContext`, `setNlResumeAfterAuth`, `pendingUcIdRef` (all already defined in `AIAgent.js`).
- Produces: nothing new consumed by later tasks — this task's dispatch logic is self-contained.

This task adds `AdminToolsDropdown` next to the existing `DemoStepsDropdown` in the header (both stay side by side with the old Actions trigger for now — Task 7 removes the Actions trigger). This ordering keeps every step independently testable: after this task, admins have a working `Admin ▾` menu whether or not the old Actions dropdown has been deleted yet.

- [ ] **Step 1: Add state and import**

In `AIAgent.js`, near the existing `const [showDemoSteps, setShowDemoSteps] = useState(...)`-style state (search for `showDiscovery` state, which is the old Actions-popout toggle — add a sibling, do not touch `showDiscovery` yet), add:

```js
const [showAdminTools, setShowAdminTools] = useState(false);
```

Add the import near the top with the other component imports (next to `import DemoStepsDropdown from "./DemoStepsDropdown";` if present, otherwise alongside other sibling component imports):

```js
import AdminToolsDropdown from "./AdminToolsDropdown";
```

- [ ] **Step 2: Write the dispatch handler**

Add a new function near `handleDemoStepSelect` (around line 6290), following the same shape:

```js
  /** Dispatch a clicked Admin Tools item — PingOne ops go to the isolated admin
   *  agent, banking customer-CRUD ops resolve like any other MCP-tool chip. */
  async function handleAdminToolSelect(tool) {
    if (!tool) return;
    setShowAdminTools(false);
    const message = tool.trigger?.text;
    if (!message) return;
    addMessage("user", tool.title);
    if (tool.adminAgent) {
      setNlLoading(true);
      try {
        const res = await fetch("/api/admin-agent/message", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message,
            customer: adminCustomerContext.get(),
          }),
          signal: AbortSignal.timeout(30000),
        });
        const data = await res
          .json()
          .catch(() => ({ reply: "Admin agent request failed.", success: false }));
        if (tokenChain && Array.isArray(data?.tokenEvents)) {
          tokenChain.setTokenEvents("admin-agent", data.tokenEvents);
        }
        addMessage("assistant", `[ADMIN AGENT - LangGraph]\n${data?.reply || "Admin agent: no response."}`, null);
      } catch (err) {
        reportNlFailure(err);
      } finally {
        setNlLoading(false);
      }
      return;
    }
    // Banking customer-CRUD ops resolve through the normal chip pipeline —
    // same fallthrough these messages already used inside the old Actions
    // popout's onChipClick (no useCaseId, so forceHeuristic stays false and
    // freeform text still reaches the LLM if the heuristic parser has no
    // match for it).
    pendingUcIdRef.current = null;
    setNlResumeAfterAuth(message);
  }
```

- [ ] **Step 3: Mount the trigger in the header row**

In the header row JSX (around line 7762-7774, right after the existing `<DemoStepsDropdown ... />` block and before the `{/* Actions trigger ... */}` comment), add:

```jsx
                {/* Admin Tools — customer CRUD + PingOne platform ops, admin-only */}
                {user?.role === 'admin' && (
                  <AdminToolsDropdown
                    open={showAdminTools}
                    onOpenChange={(next) => {
                      setShowAdminTools(next);
                      if (next) setShowDemoSteps(false);
                    }}
                    onSelect={handleAdminToolSelect}
                  />
                )}
```

- [ ] **Step 4: Manual verification**

Run: `./run-docker.sh` (or the project's existing dev-stack command), sign in as an admin user, open the agent, click `Admin ▾`, confirm the 14 tools list, click "List all apps" and confirm a `[ADMIN AGENT - LangGraph]` reply appears, click "Look Up Customer" and confirm it resolves through the normal chat pipeline (not the admin-agent branch).

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/AIAgent.js
git commit -m "feat: wire AdminToolsDropdown into AIAgent header"
```

---

### Task 6: Header controls — inline ScopePicker + Clear progress (Option A1)

**Files:**
- Modify: `demo_api_ui/src/components/AIAgent.js`

**Interfaces:**
- Consumes: existing `ScopePicker` component, existing `agentAllowWrite`/`setAgentAllowWrite` state, existing `clearCompletedUseCases` (already imported for the popout's clear-progress button).
- Produces: nothing new — this task only relocates existing controls within the same file.

- [ ] **Step 1: Add the two controls to the header row**

In the header row JSX, immediately before the `{/* Expand/restore — float mode only (unchanged) */}` block (around line 7797), add:

```jsx
                {/* Session controls — moved inline from the old Actions popout (Option A1) */}
                {isLoggedIn && (
                  <ScopePicker
                    allowWrite={agentAllowWrite}
                    disabled={agentToolsLoading}
                    onChange={setAgentAllowWrite}
                  />
                )}
                <button
                  type="button"
                  className="ba-actions-trigger ba-header-toggle-label"
                  onClick={() => clearCompletedUseCases()}
                  title="Clear checkmarks for a fresh demo pass"
                  data-testid="header-clear-progress"
                >
                  Clear progress
                </button>
```

- [ ] **Step 2: Manual verification**

Run: dev stack up, sign in, confirm "Read only"/"Read + Write" toggle and "Clear progress" both render inline in the header (same button style as Guide/Demo steps), confirm toggling scope still gates write chips the same as before, confirm Clear progress still resets demo-step checkmarks.

- [ ] **Step 3: Commit**

```bash
git add demo_api_ui/src/components/AIAgent.js
git commit -m "feat: move ScopePicker and Clear progress inline into agent header"
```

---

### Task 7: Delete the Actions dropdown

**Files:**
- Modify: `demo_api_ui/src/components/AIAgent.js` (remove the trigger, the popout block, and now-unused imports/state)
- Delete: `demo_api_ui/src/components/BankingChips.jsx`
- Delete: `demo_api_ui/src/components/BankingChips.css`
- Delete: `demo_api_ui/src/components/SecurityShowcasePanel.jsx`
- Delete: `demo_api_ui/src/components/SecurityShowcasePanel.css`

This is the task that actually removes the dropdown — it must run after Tasks 1-6 so nothing it deletes is still the only way to reach something.

- [ ] **Step 1: Remove the Actions trigger button**

In `AIAgent.js`, delete the block (originally lines 7775-7796):

```jsx
                {/* Actions trigger — float + dashboard inline agents (D-01, D-02) */}
                {useActionsPopout && (
                  <button
                    ref={discoveryTriggerRef}
                    type="button"
                    className={
                      "ba-actions-trigger" + (showDiscovery ? " active" : "")
                    }
                    onClick={() => {
                      setShowDiscovery((v) => {
                        const next = !v;
                        if (next) setShowDemoSteps(false);
                        return next;
                      });
                    }}
                    disabled={consentBlocked}
                    aria-expanded={showDiscovery}
                    aria-haspopup="dialog"
                  >
                    Actions {showDiscovery ? "▴" : "▾"}
                  </button>
                )}
```

- [ ] **Step 2: Remove the Actions popout block**

Delete the entire `{showDiscovery && (...)}` block (originally lines 7849-7975, the `ba-actions-popout` `<div>` through its closing `)}`) — this includes the free-text search box, the `ScopePicker` that Task 6 already duplicated inline (this copy is now dead), the degraded-authz badge, and the `<BankingChips ...>` mount with its `onChipClick` handler.

Before deleting, grep the file for every identifier that only appears inside this block, so orphaned declarations get removed too:

Run: `grep -n "discoveryTriggerRef\|discoverySearch\|setDiscoverySearch\|showDiscovery\|setShowDiscovery\|BX_AGENT_PENDING_NL_KEY\|dispatchNlResult\|actionsPopoutRef\|customChips\b\|degradedAuthz" demo_api_ui/src/components/AIAgent.js`

For each identifier that no longer has any reference outside the deleted block, remove its declaration (`useState`, `useRef`, etc.) too. Keep any identifier still referenced elsewhere (e.g. `customChips` — check whether Task 8's usage of `useCustomChips` lives in this file or only in `CustomChipsTab.js`; if `AIAgent.js`'s own `const { chips: customChips, groups: customGroups } = useCustomChips();` call has no remaining reader after this deletion, remove it too).

- [ ] **Step 3: Remove the `BankingChips` import and its `PINGONE_ADMIN_CHIP_IDS` re-export use**

Remove:

```js
import BankingChips, { PINGONE_ADMIN_CHIP_IDS } from "./BankingChips";
```

Search for any remaining use of `PINGONE_ADMIN_CHIP_IDS` in the file (`grep -n "PINGONE_ADMIN_CHIP_IDS" demo_api_ui/src/components/AIAgent.js`) — Task 5's `handleAdminToolSelect` uses `tool.adminAgent` instead, so the only remaining reference should be inside the now-deleted popout's `onChipClick` branch (already removed in Step 2). If any reference survives, it is dead code from this same deletion and should be removed too.

- [ ] **Step 4: Delete the four files**

```bash
git rm demo_api_ui/src/components/BankingChips.jsx demo_api_ui/src/components/BankingChips.css demo_api_ui/src/components/SecurityShowcasePanel.jsx demo_api_ui/src/components/SecurityShowcasePanel.css
```

- [ ] **Step 5: Build and run the existing suite**

Run: `cd demo_api_ui && npm run build`
Expected: build succeeds — no lingering import of the deleted files.

Run: `cd demo_api_ui && npx vitest run`
Expected: no failures newly caused by this deletion (any pre-existing failures unrelated to `AIAgent.js`/`BankingChips.jsx`/`SecurityShowcasePanel.jsx` are out of scope for this task — do not fix them here).

- [ ] **Step 6: Manual verification**

Run the dev stack, confirm: no "Actions ▾" button anywhere in the header; `Admin ▾` (admin only), `Demo steps ▾`, scope toggle, and "Clear progress" all still work; the main chat input still dispatches free text exactly as before.

- [ ] **Step 7: Commit**

```bash
git add -u demo_api_ui/src/components/AIAgent.js
git commit -m "feat: remove the Actions dropdown (BankingChips + SecurityShowcasePanel)"
```

---

### Task 8: "My Actions" — Run button on `CustomChipsTab.js`

**Files:**
- Modify: `demo_api_ui/src/components/CustomChipsTab.js`
- Test: create `demo_api_ui/src/components/__tests__/CustomChipsTab.test.jsx` if no test file exists yet for this component (check first: `ls demo_api_ui/src/components/__tests__/CustomChipsTab*`)

**Interfaces:**
- Consumes: existing `useCustomChips()` hook (`chips`), `useNavigate` from `react-router-dom`.
- Produces: nothing consumed by later tasks.

`CustomChipsTab.js` is rendered inside `UnifiedConfigurationPage.tsx`, a separate settings page — it has no access to `AIAgent.js`'s internal dispatch closures. The Run button reuses the same cross-page mechanism `/use-cases` already relies on: `navigate('/dashboard', { state: { triggerText } })`, consumed by the existing `location.state.triggerText` effect in `AIAgent.js` (around line 1063-1070). This does not force LLM routing the way the old in-popout dispatch did for `llm`-type custom chips — those chips still work, they just go through the default provider-classification path instead of a forced-LLM override. This is an accepted, documented behavior change (see the design spec), not a regression relative to how every other catalog-driven trigger already works.

- [ ] **Step 1: Write the failing test**

```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CustomChipsTab from '../CustomChipsTab';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('../../hooks/useCustomChips', () => ({
  useCustomChips: () => ({
    chips: [{ id: 'custom_fraud_check_1', label: 'Fraud Check', prompt: 'Analyze recent transactions for suspicious patterns', type: 'llm', groupId: 'custom' }],
    groups: [],
    addChip: vi.fn(),
    removeChip: vi.fn(),
    addGroup: vi.fn(),
    removeGroup: vi.fn(),
  }),
}));

vi.mock('../../vertical/useVertical', () => ({
  useVertical: () => ({ pageManifest: { id: 'banking' } }),
}));

describe('CustomChipsTab — Run button', () => {
  it('navigates to /dashboard with the chip prompt as triggerText', () => {
    render(<MemoryRouter><CustomChipsTab /></MemoryRouter>);
    fireEvent.click(screen.getByTestId('run-chip-custom_fraud_check_1'));
    expect(mockNavigate).toHaveBeenCalledWith('/dashboard', {
      state: { triggerText: 'Analyze recent transactions for suspicious patterns' },
    });
  });
});
```

Save as `demo_api_ui/src/components/__tests__/CustomChipsTab.test.jsx`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/CustomChipsTab.test.jsx`
Expected: FAIL — `getByTestId('run-chip-custom_fraud_check_1')` not found.

- [ ] **Step 3: Add the Run button**

In `CustomChipsTab.js`, add the import:

```js
import { useNavigate } from "react-router-dom";
```

Inside `export default function CustomChipsTab()`, add:

```js
  const navigate = useNavigate();

  function handleRunChip(chip) {
    navigate('/dashboard', { state: { triggerText: chip.prompt } });
  }
```

In the chip row rendering (inside the `groupChips.map((chip) => (...))` block), add a Run button before the existing Remove button:

```jsx
                  <button
                    type="button"
                    style={{ ...s.btn, background: '#0369a1', color: '#fff' }}
                    onClick={() => handleRunChip(chip)}
                    data-testid={`run-chip-${chip.id}`}
                  >
                    Run
                  </button>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/CustomChipsTab.test.jsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/CustomChipsTab.js demo_api_ui/src/components/__tests__/CustomChipsTab.test.jsx
git commit -m "feat: add Run button to CustomChipsTab (My Actions replacement)"
```

---

### Task 9: Update e2e specs referencing removed selectors

**Files:**
- Modify or none, depending on findings (this task starts with a search, not a known file list)

**Interfaces:**
- None — this task only touches test files, nothing downstream depends on it.

- [ ] **Step 1: Find every e2e reference to the removed selectors**

Run: `grep -rln "ba-actions-trigger\|ba-actions-popout\|actions-clear-progress" e2e/ 2>/dev/null; grep -rln "ba-actions-trigger\|ba-actions-popout\|actions-clear-progress" demo_api_ui/e2e 2>/dev/null; grep -rln "ba-actions-trigger\|ba-actions-popout\|actions-clear-progress" tests/e2e 2>/dev/null`

(Try all three — the plan's exploration didn't pin down the e2e directory location; run each and use whichever returns matches.)

- [ ] **Step 2: For each matching file, update the selector or remove the assertion**

For every match:
- If the spec clicks `.ba-actions-trigger` expecting the old mega-popout (chip rail, Security Showcase), update it to target the new `[data-testid="admin-tools-trigger"]` if it was testing admin content, or delete the assertion if it was testing content now reachable only via `/use-cases` (already covered by that page's own e2e specs).
- If the spec clicks `[data-testid="actions-clear-progress"]`, update the selector to `[data-testid="header-clear-progress"]` (Task 6).
- Do not delete a whole spec file for one broken selector — fix the specific assertion and leave the rest of the file's coverage intact.

- [ ] **Step 3: Run the updated e2e specs**

Run: `./run-tests.sh e2e` (or the project's documented e2e command from `CLAUDE.md`) scoped to the modified spec files if the runner supports a path filter, otherwise the full e2e suite.
Expected: the modified specs PASS. Pre-existing unrelated e2e failures are out of scope for this task.

- [ ] **Step 4: Commit**

```bash
git add <modified e2e spec files>
git commit -m "test(e2e): update specs for the removed Actions dropdown"
```

---

## Self-Review Notes

- **Spec coverage:** Every "Decisions" item in the design spec (UC33-35, Admin Tools popout, CustomChipsTab Run button, header controls A1, dropdown deletion, dispatch consolidation) maps to Tasks 1, 2-5, 8, 6, 7, and 5 respectively.
- **Type consistency:** `AdminToolsDropdown`'s `onSelect(tool)` payload (`{id, title, trigger, adminAgent?}`) matches `ADMIN_TOOLS`' shape (Task 2) exactly, and `handleAdminToolSelect` (Task 5) reads `tool.trigger.text`/`tool.adminAgent`/`tool.title` consistently with that shape.
- **Known accepted gap (documented, not a placeholder):** Task 8's Run button does not replicate the forced-LLM-provider override the old in-popout dispatch gave `llm`-type custom chips — flagged explicitly in Task 8's interface note rather than silently dropped.
