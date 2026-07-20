# PingOne Authorize — Capability Showcase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a standalone `/pingone-authorize-capabilities` tour page that shows PingOne Authorize's 8 real capabilities (audited against `pingOneAuthorizeService.js`), plus an additive "PingOne Authorize" group on `/use-cases` — built on new generic, reusable showcase components rather than a one-off.

**Architecture:** One new config file (`pingOneAuthorizeCapabilities.js`) is the single source of truth for the ledger data. Two new generic components (`CapabilityShowcasePage`, `CapabilityCallout`) consume any ledger of that shape — PingOne Authorize is the first, not the only, consumer. A thin page wrapper mounts the tour at a new route with a nav entry. A new additive strip section on `/use-cases`, filtered by the ledger's `allRelatedUCIds()`, follows the exact existing "Happy Paths" strip pattern with zero changes to any use case's existing `track`.

**Tech Stack:** React (`demo_api_ui`), React Router, Vitest + React Testing Library, Playwright (smoke test).

## Global Constraints

- No edits to `demo_api_ui/src/components/PingOneAuthorizePage.jsx` or any other file touched by the locked `worktree-pingone-authorize-inspector-shell` branch (per the approved design's "Why not extend the existing page" section).
- No `CapabilityCallout` wired into any existing panel in this plan — component is built and tested standalone only.
- No changes to `demo_api_server/services/pingOneAuthorizeService.js`, `authorizeObligations.js`, or any enforcement/decision logic.
- Emoji allowlist only if any UI copy needs one: `⚠️` `✅` `❌` `🔐` `✕` `✓` `👤` `🔑` `🪟` `📚` (project `CLAUDE.md` §0). Prefer no emoji.
- Working directory for all tasks: this git worktree (`.claude/worktrees/pingone-authorize-capability-showcase`), branch `worktree-pingone-authorize-capability-showcase`. Never edit the main checkout.
- Test runner: `demo_api_ui` uses Vitest — `npx vitest run <path>`, not Jest.

---

## Task 1: Capability Ledger config

**Files:**
- Create: `demo_api_ui/src/config/capabilityLedgers/pingOneAuthorizeCapabilities.js`
- Test: `demo_api_ui/src/config/capabilityLedgers/__tests__/pingOneAuthorizeCapabilities.test.js`

**Interfaces:**
- Produces: `PINGONE_AUTHORIZE_CAPABILITIES` (array of 8 objects, shape below), `PINGONE_AUTHORIZE_GROUPS` (array of 3 `{id, label}` objects in display order), `allRelatedUCIds()` (function, returns deduped flat array of every `relatedUCIds` entry across all 8 capabilities — used by Task 5).

- [x] **Step 1: Write the failing test**

```js
// demo_api_ui/src/config/capabilityLedgers/__tests__/pingOneAuthorizeCapabilities.test.js
import { describe, it, expect } from 'vitest';
import {
  PINGONE_AUTHORIZE_CAPABILITIES,
  PINGONE_AUTHORIZE_GROUPS,
  allRelatedUCIds,
} from '../pingOneAuthorizeCapabilities';

describe('pingOneAuthorizeCapabilities', () => {
  it('has exactly 8 capabilities', () => {
    expect(PINGONE_AUTHORIZE_CAPABILITIES).toHaveLength(8);
  });

  it('every capability has a unique id, a known group, a one-liner, and evidence', () => {
    const groupIds = PINGONE_AUTHORIZE_GROUPS.map((g) => g.id);
    const ids = new Set();
    for (const cap of PINGONE_AUTHORIZE_CAPABILITIES) {
      expect(ids.has(cap.id)).toBe(false);
      ids.add(cap.id);
      expect(groupIds).toContain(cap.group);
      expect(cap.oneLiner).toEqual(expect.any(String));
      expect(cap.oneLiner.length).toBeGreaterThan(0);
      expect(cap.evidence.code).toEqual(expect.any(String));
      expect(Array.isArray(cap.relatedUCIds)).toBe(true);
      expect(cap.relatedUCIds.length).toBeGreaterThan(0);
    }
  });

  it('groups split 3/3/2 across realtime-decisioning, fine-grained-policy, operations-audit', () => {
    const counts = PINGONE_AUTHORIZE_GROUPS.map(
      (g) => PINGONE_AUTHORIZE_CAPABILITIES.filter((c) => c.group === g.id).length,
    );
    expect(counts).toEqual([3, 3, 2]);
  });

  it('the mcp-first-tool-gate capability is the literal "Contextual Runtime Authorization" claim', () => {
    const cap = PINGONE_AUTHORIZE_CAPABILITIES.find((c) => c.id === 'mcp-first-tool-gate');
    expect(cap.group).toBe('realtime-decisioning');
    expect(cap.relatedUCIds).toEqual(expect.arrayContaining(['UC1']));
  });

  it('allRelatedUCIds returns a deduped union of every relatedUCIds', () => {
    const ids = allRelatedUCIds();
    expect(ids).toEqual(expect.arrayContaining(['UC1', 'UC6', 'UC14b']));
    expect(new Set(ids).size).toBe(ids.length);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/config/capabilityLedgers/__tests__/pingOneAuthorizeCapabilities.test.js`
Expected: FAIL with "Cannot find module '../pingOneAuthorizeCapabilities'"

- [x] **Step 3: Write the ledger**

```js
// demo_api_ui/src/config/capabilityLedgers/pingOneAuthorizeCapabilities.js
/**
 * Single source of truth for the PingOne Authorize capability showcase: the
 * standalone tour page and the /use-cases "PingOne Authorize" group both read
 * from here. Ledger shape is generic — see CapabilityShowcasePage — so it can
 * be reused by other product showcases later without rework.
 */

export const PINGONE_AUTHORIZE_GROUPS = [
  { id: 'realtime-decisioning', label: 'Real-time, contextual decisions' },
  { id: 'fine-grained-policy', label: 'Fine-grained, attribute-driven policy' },
  { id: 'operations-audit', label: 'Operations & audit' },
];

export const PINGONE_AUTHORIZE_CAPABILITIES = [
  {
    id: 'decision-endpoints',
    group: 'realtime-decisioning',
    title: 'Real-time decision evaluation',
    oneLiner: 'Every transaction/tool call is evaluated live against PingOne Authorize — PERMIT, DENY, or INDETERMINATE, never assumed.',
    evidence: { code: 'demo_api_server/services/pingOneAuthorizeService.js — evaluateTransaction (L676-704), _postDecisionEndpoint (L380-412)' },
    relatedUCIds: ['UC1', 'UC6'],
  },
  {
    id: 'mcp-first-tool-gate',
    group: 'realtime-decisioning',
    title: 'Dynamic least-privilege for agent tool calls',
    oneLiner: 'The literal "Contextual Runtime Authorization" claim: DecisionContext=McpFirstTool grants/denies each MCP tool call dynamically, not via a static scope grant.',
    evidence: { code: 'demo_api_server/services/pingOneAuthorizeService.js — evaluateMcpToolDelegation (L455-599)' },
    relatedUCIds: ['UC1', 'UC10', 'UC13'],
  },
  {
    id: 'fail-closed-resilience',
    group: 'realtime-decisioning',
    title: 'Fail-closed resilience',
    oneLiner: 'Circuit breaker + bounded retry + effect normalization: an unrecognized or errored response collapses to DENY, never a silent PERMIT.',
    evidence: { code: 'demo_api_server/services/pingOneAuthorizeService.js — _evaluateWithBreaker (L275-294), _normalizeDecision (L347-352)' },
    relatedUCIds: ['UC6'],
  },
  {
    id: 'trust-framework-attributes',
    group: 'fine-grained-policy',
    title: 'Attribute-driven least privilege',
    oneLiner: 'RAR amount/payee ceiling, entitlement tier, group membership, and resource-owner binding all flow into the same decision as named Trust Framework attributes.',
    evidence: { code: 'demo_api_server/services/pingOneAuthorizeService.js — evaluateMcpToolDelegation parameters (L483-594)' },
    relatedUCIds: ['UC14b', 'UC9', 'UC21'],
  },
  {
    id: 'policy-tree-visibility',
    group: 'fine-grained-policy',
    title: 'Policy tree visibility',
    oneLiner: 'Policy Set → Policy → Rule, fetched live or from the repo’s import snapshot when the worker token can’t reach the policy-editor API.',
    evidence: { code: 'demo_api_server/services/pingOneAuthorizeService.js — getAuthorizationPolicies (L846-868), getAuthorizationPoliciesFromSnapshot (L884-930)' },
    relatedUCIds: ['UC6'],
  },
  {
    id: 'obligations-response-shaping',
    group: 'fine-grained-policy',
    title: 'Obligations shape the response, not just permit/deny',
    oneLiner: 'A decision can carry step-up, HITL, or consent obligations — the runtime context changes what happens next, not only whether it happens.',
    evidence: { code: 'demo_api_server/services/authorizeObligations.js — classifyObligations (L81)' },
    relatedUCIds: ['UC7', 'UC8'],
  },
  {
    id: 'recent-decisions-audit',
    group: 'operations-audit',
    title: 'Recent-decisions audit trail',
    oneLiner: 'The last 20 decisions on a configured endpoint are queryable directly from PingOne — an independent verification surface, not just app-side logs.',
    evidence: { code: 'demo_api_server/services/pingOneAuthorizeService.js — getRecentDecisions (L760-786)' },
    relatedUCIds: ['UC20'],
  },
  {
    id: 'coarse-fine-split',
    group: 'operations-audit',
    title: 'One engine, two enforcement points',
    oneLiner: 'The same PingOne Authorize engine backs both the Agent Gateway’s coarse allow/deny gate and this BFF’s fine-grained per-tool gate — not two competing systems.',
    evidence: { code: 'demo_mcp_gateway/src/auth/PingOneAuthorizeClient.ts (coarse) + demo_api_server/services/pingOneAuthorizeService.js evaluateMcpToolDelegation (fine)' },
    relatedUCIds: ['UC1'],
  },
];

export function allRelatedUCIds() {
  const seen = new Set();
  for (const cap of PINGONE_AUTHORIZE_CAPABILITIES) {
    for (const id of cap.relatedUCIds) seen.add(id);
  }
  return Array.from(seen);
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/config/capabilityLedgers/__tests__/pingOneAuthorizeCapabilities.test.js`
Expected: PASS (5 tests)

- [x] **Step 5: Commit**

```bash
git add demo_api_ui/src/config/capabilityLedgers/pingOneAuthorizeCapabilities.js demo_api_ui/src/config/capabilityLedgers/__tests__/pingOneAuthorizeCapabilities.test.js
git commit -m "feat(pingone-authorize): add capability ledger config"
```

---

## Task 2: CapabilityShowcasePage generic component

**Files:**
- Create: `demo_api_ui/src/components/CapabilityShowcasePage.jsx`
- Create: `demo_api_ui/src/components/CapabilityShowcasePage.css`
- Test: `demo_api_ui/src/components/__tests__/CapabilityShowcasePage.test.jsx`

**Interfaces:**
- Consumes: nothing from Task 1 directly — the test imports the real ledger from Task 1 as its fixture, but the component itself takes only generic props: `{ title: string, intro: string, ledger: Array<{id,group,title,oneLiner,evidence}>, groups: Array<{id,label}> }`.
- Produces: default export `CapabilityShowcasePage`, rendering one `<article data-testid="cap-card-{id}">` per ledger entry grouped under its `groups` label, in `groups` order.

- [x] **Step 1: Write the failing test**

```jsx
// demo_api_ui/src/components/__tests__/CapabilityShowcasePage.test.jsx
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import CapabilityShowcasePage from '../CapabilityShowcasePage';

const GROUPS = [
  { id: 'a', label: 'Group A' },
  { id: 'b', label: 'Group B' },
];
const LEDGER = [
  { id: 'cap-1', group: 'a', title: 'Capability One', oneLiner: 'Does thing one.', evidence: { code: 'file.js:1' } },
  { id: 'cap-2', group: 'b', title: 'Capability Two', oneLiner: 'Does thing two.', evidence: { code: 'file.js:2' } },
  { id: 'cap-3', group: 'a', title: 'Capability Three', oneLiner: 'Does thing three.', evidence: { code: 'file.js:3' } },
];

describe('CapabilityShowcasePage', () => {
  it('renders the title and intro', () => {
    render(<CapabilityShowcasePage title="Test Product" intro="Test intro copy." ledger={LEDGER} groups={GROUPS} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Test Product' })).toBeInTheDocument();
    expect(screen.getByText('Test intro copy.')).toBeInTheDocument();
  });

  it('renders one card per ledger entry', () => {
    render(<CapabilityShowcasePage title="Test Product" intro="Test intro copy." ledger={LEDGER} groups={GROUPS} />);
    expect(screen.getByTestId('cap-card-cap-1')).toBeInTheDocument();
    expect(screen.getByTestId('cap-card-cap-2')).toBeInTheDocument();
    expect(screen.getByTestId('cap-card-cap-3')).toBeInTheDocument();
  });

  it('groups cards under the correct heading in group order', () => {
    render(<CapabilityShowcasePage title="Test Product" intro="Test intro copy." ledger={LEDGER} groups={GROUPS} />);
    const groupA = screen.getByText('Group A').closest('section');
    const groupB = screen.getByText('Group B').closest('section');
    expect(within(groupA).getByText('Capability One')).toBeInTheDocument();
    expect(within(groupA).getByText('Capability Three')).toBeInTheDocument();
    expect(within(groupA).queryByText('Capability Two')).not.toBeInTheDocument();
    expect(within(groupB).getByText('Capability Two')).toBeInTheDocument();
  });

  it('renders each card’s one-liner and evidence citation', () => {
    render(<CapabilityShowcasePage title="Test Product" intro="Test intro copy." ledger={LEDGER} groups={GROUPS} />);
    expect(screen.getByText('Does thing one.')).toBeInTheDocument();
    expect(screen.getByText('file.js:1')).toBeInTheDocument();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/CapabilityShowcasePage.test.jsx`
Expected: FAIL with "Cannot find module '../CapabilityShowcasePage'"

- [x] **Step 3: Write the component**

```jsx
// demo_api_ui/src/components/CapabilityShowcasePage.jsx
import React from 'react';
import './CapabilityShowcasePage.css';

/**
 * Generic capability tour page — renders any ledger of the shared shape
 * ({id, group, title, oneLiner, evidence}) grouped under `groups`, in order.
 * PingOne Authorize is the first consumer; not specific to it.
 *
 * @param {object} props
 * @param {string} props.title
 * @param {string} props.intro
 * @param {Array<{id:string,group:string,title:string,oneLiner:string,evidence:{code:string}}>} props.ledger
 * @param {Array<{id:string,label:string}>} props.groups
 */
export default function CapabilityShowcasePage({ title, intro, ledger, groups }) {
  return (
    <div className="cap-showcase">
      <header className="cap-showcase__header">
        <h1>{title}</h1>
        <p className="cap-showcase__intro">{intro}</p>
      </header>
      {groups.map((g) => (
        <section key={g.id} className="cap-showcase__group">
          <h2 className="cap-showcase__group-heading">{g.label}</h2>
          <div className="cap-showcase__grid">
            {ledger
              .filter((cap) => cap.group === g.id)
              .map((cap) => (
                <article key={cap.id} className="cap-card" data-testid={`cap-card-${cap.id}`}>
                  <h3 className="cap-card__title">{cap.title}</h3>
                  <p className="cap-card__one-liner">{cap.oneLiner}</p>
                  <code className="cap-card__evidence">{cap.evidence.code}</code>
                </article>
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}
```

```css
/* demo_api_ui/src/components/CapabilityShowcasePage.css */
.cap-showcase { padding: 24px; max-width: 1100px; margin: 0 auto; }
.cap-showcase__header { margin-bottom: 24px; }
.cap-showcase__intro { color: var(--text-muted, #666); }
.cap-showcase__group { margin-bottom: 32px; }
.cap-showcase__group-heading { font-size: 1.1rem; margin-bottom: 12px; }
.cap-showcase__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
.cap-card { border: 1px solid var(--border, #ddd); border-radius: 8px; padding: 16px; }
.cap-card__title { margin: 0 0 8px; font-size: 1rem; }
.cap-card__one-liner { margin: 0 0 12px; font-size: 0.9rem; }
.cap-card__evidence { display: block; font-size: 0.75rem; word-break: break-word; color: var(--text-muted, #666); }
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/CapabilityShowcasePage.test.jsx`
Expected: PASS (4 tests)

- [x] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/CapabilityShowcasePage.jsx demo_api_ui/src/components/CapabilityShowcasePage.css demo_api_ui/src/components/__tests__/CapabilityShowcasePage.test.jsx
git commit -m "feat(capability-showcase): add generic CapabilityShowcasePage component"
```

---

## Task 3: CapabilityCallout generic component

**Files:**
- Create: `demo_api_ui/src/components/CapabilityCallout.jsx`
- Test: `demo_api_ui/src/components/__tests__/CapabilityCallout.test.jsx`

**Interfaces:**
- Produces: default export `CapabilityCallout`, props `{ capability: {id,title,oneLiner} | null | undefined, to?: string }`. Not wired into any existing panel by this plan (Global Constraints) — built and tested standalone so it is ready for a future panel integration.

- [x] **Step 1: Write the failing test**

```jsx
// demo_api_ui/src/components/__tests__/CapabilityCallout.test.jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CapabilityCallout from '../CapabilityCallout';

const CAP = { id: 'cap-1', title: 'Capability One', oneLiner: 'Does thing one.' };

describe('CapabilityCallout', () => {
  it('renders a link with the capability title and one-liner as its title attribute', () => {
    render(<CapabilityCallout capability={CAP} to="/some-tour" />);
    const link = screen.getByRole('link', { name: /Capability One/ });
    expect(link).toHaveAttribute('href', '/some-tour');
    expect(link).toHaveAttribute('title', 'Does thing one.');
  });

  it('defaults href to /pingone-authorize-capabilities when `to` is omitted', () => {
    render(<CapabilityCallout capability={CAP} />);
    expect(screen.getByRole('link')).toHaveAttribute('href', '/pingone-authorize-capabilities');
  });

  it('renders nothing for a null capability', () => {
    const { container } = render(<CapabilityCallout capability={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for an undefined capability', () => {
    const { container } = render(<CapabilityCallout />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/CapabilityCallout.test.jsx`
Expected: FAIL with "Cannot find module '../CapabilityCallout'"

- [x] **Step 3: Write the component**

```jsx
// demo_api_ui/src/components/CapabilityCallout.jsx
import React from 'react';

const DEFAULT_TOUR_PATH = '/pingone-authorize-capabilities';

/**
 * Small link-out chip pointing at a capability's entry on a
 * CapabilityShowcasePage tour. Takes the capability object directly (no
 * ledger-id registry lookup) — the caller already has it from its own ledger
 * import. Not wired into any existing panel yet; standalone and tested.
 *
 * @param {object} props
 * @param {{id:string,title:string,oneLiner:string}|null|undefined} props.capability
 * @param {string} [props.to] - defaults to the PingOne Authorize tour page
 */
export default function CapabilityCallout({ capability, to = DEFAULT_TOUR_PATH }) {
  if (!capability) return null;
  return (
    <a className="cap-callout" href={to} title={capability.oneLiner}>
      {capability.title} →
    </a>
  );
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/components/__tests__/CapabilityCallout.test.jsx`
Expected: PASS (4 tests)

- [x] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/CapabilityCallout.jsx demo_api_ui/src/components/__tests__/CapabilityCallout.test.jsx
git commit -m "feat(capability-showcase): add generic CapabilityCallout component"
```

---

## Task 4: PingOneAuthorizeCapabilitiesPage + route + nav

**Files:**
- Create: `demo_api_ui/src/pages/PingOneAuthorizeCapabilitiesPage.jsx`
- Test: `demo_api_ui/src/pages/__tests__/PingOneAuthorizeCapabilitiesPage.test.jsx`
- Modify: `demo_api_ui/src/App.js` (import block near line 70, route block near lines 971-974)
- Modify: `demo_api_ui/src/components/AdminSideNav.jsx` (paths array at line 153, nav entry at line 570)
- Modify: `demo_api_ui/tests/e2e/url-smoke.spec.js` (`ADMIN_ROUTES` array, line ~248)

**Interfaces:**
- Consumes: `PINGONE_AUTHORIZE_CAPABILITIES`, `PINGONE_AUTHORIZE_GROUPS` from `../config/capabilityLedgers/pingOneAuthorizeCapabilities` (Task 1); `CapabilityShowcasePage` from `../components/CapabilityShowcasePage` (Task 2).

- [x] **Step 1: Write the failing test**

```jsx
// demo_api_ui/src/pages/__tests__/PingOneAuthorizeCapabilitiesPage.test.jsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import PingOneAuthorizeCapabilitiesPage from '../PingOneAuthorizeCapabilitiesPage';

describe('PingOneAuthorizeCapabilitiesPage', () => {
  it('renders the PingOne Authorize title and all 8 capability cards without any network call', () => {
    render(<PingOneAuthorizeCapabilitiesPage />);
    expect(screen.getByRole('heading', { level: 1, name: /PingOne Authorize/ })).toBeInTheDocument();
    expect(screen.getByTestId('cap-card-decision-endpoints')).toBeInTheDocument();
    expect(screen.getByTestId('cap-card-mcp-first-tool-gate')).toBeInTheDocument();
    expect(screen.getByTestId('cap-card-fail-closed-resilience')).toBeInTheDocument();
    expect(screen.getByTestId('cap-card-trust-framework-attributes')).toBeInTheDocument();
    expect(screen.getByTestId('cap-card-policy-tree-visibility')).toBeInTheDocument();
    expect(screen.getByTestId('cap-card-obligations-response-shaping')).toBeInTheDocument();
    expect(screen.getByTestId('cap-card-recent-decisions-audit')).toBeInTheDocument();
    expect(screen.getByTestId('cap-card-coarse-fine-split')).toBeInTheDocument();
  });

  it('states the Contextual Runtime Authorization claim in the intro copy', () => {
    render(<PingOneAuthorizeCapabilitiesPage />);
    expect(screen.getByText(/Contextual Runtime Authorization/i)).toBeInTheDocument();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/PingOneAuthorizeCapabilitiesPage.test.jsx`
Expected: FAIL with "Cannot find module '../PingOneAuthorizeCapabilitiesPage'"

- [x] **Step 3: Write the page**

```jsx
// demo_api_ui/src/pages/PingOneAuthorizeCapabilitiesPage.jsx
import React from 'react';
import CapabilityShowcasePage from '../components/CapabilityShowcasePage';
import {
  PINGONE_AUTHORIZE_CAPABILITIES,
  PINGONE_AUTHORIZE_GROUPS,
} from '../config/capabilityLedgers/pingOneAuthorizeCapabilities';

const INTRO =
  'Contextual Runtime Authorization: PingOne Authorize grants dynamic, ' +
  'least-privilege permissions in real time. Every capability below cites ' +
  'the exact code in this repo that implements it.';

export default function PingOneAuthorizeCapabilitiesPage() {
  return (
    <CapabilityShowcasePage
      title="PingOne Authorize"
      intro={INTRO}
      ledger={PINGONE_AUTHORIZE_CAPABILITIES}
      groups={PINGONE_AUTHORIZE_GROUPS}
    />
  );
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/PingOneAuthorizeCapabilitiesPage.test.jsx`
Expected: PASS (2 tests)

- [x] **Step 5: Wire the route**

In `demo_api_ui/src/App.js`, add the import near the existing `PingOneAuthorizePage` import (line 70):

```js
import PingOneAuthorizeCapabilitiesPage from "./pages/PingOneAuthorizeCapabilitiesPage";
```

Add the route immediately after the existing `/pingone-authorize` route (lines 971-974):

```jsx
                            <Route
                              path="/pingone-authorize"
                              element={<PingOneAuthorizePage />}
                            />
                            <Route
                              path="/pingone-authorize-capabilities"
                              element={<PingOneAuthorizeCapabilitiesPage />}
                            />
```

- [x] **Step 6: Wire the nav entry**

In `demo_api_ui/src/components/AdminSideNav.jsx`, add the new path to the "authorize" section's path list (line 153):

```js
  { id: "authorize", paths: ["/pingone-authorize", "/pingone-authorize-capabilities", "/policy-decision-trace", "/authz-test", "/scope-audit", "/scope-reference"] },
```

Add the nav entry immediately after "PingOne Authorize" in the same section's `children` (line 570):

```js
        { label: "PingOne Authorize", path: "/pingone-authorize", icon: "pol" },
        { label: "Authorize Capabilities", path: "/pingone-authorize-capabilities", icon: "pol" },
```

- [x] **Step 7: Add to the route smoke test**

In `demo_api_ui/tests/e2e/url-smoke.spec.js`, add the new path to `ADMIN_ROUTES` (line ~248) immediately after `'/pingone-authorize'`:

```js
  '/pingone-authorize',
  '/pingone-authorize-capabilities',
```

- [x] **Step 8: Run the full component test suite to check for regressions**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/PingOneAuthorizeCapabilitiesPage.test.jsx`
Expected: PASS (2 tests, unchanged from Step 4)

- [x] **Step 9: Commit**

```bash
git add demo_api_ui/src/pages/PingOneAuthorizeCapabilitiesPage.jsx demo_api_ui/src/pages/__tests__/PingOneAuthorizeCapabilitiesPage.test.jsx demo_api_ui/src/App.js demo_api_ui/src/components/AdminSideNav.jsx demo_api_ui/tests/e2e/url-smoke.spec.js
git commit -m "feat(pingone-authorize): add /pingone-authorize-capabilities tour page, route, and nav entry"
```

---

## Task 5: "PingOne Authorize" group on `/use-cases`

**Files:**
- Modify: `demo_api_ui/src/pages/UseCaseLauncherPage.js` (imports near line 35, constants near lines 48-49, derivation near lines 866-884, render block near lines 984-1008)
- Modify: `demo_api_ui/src/__tests__/UseCaseLauncherPage.test.js` (`MOCK_USE_CASES` fixture at line 59, new test near the existing Happy-Path-section test)

**Interfaces:**
- Consumes: `allRelatedUCIds()` from `../config/capabilityLedgers/pingOneAuthorizeCapabilities` (Task 1).

**Note:** This is an ADDITIVE strip section, following the exact existing pattern used for the "Happy Paths" strip (filters `useCases` by an id set, renders as its own `<section>` before the track-grouped grid, no `stepNumber` prop). It does not reassign any UC's existing `track` field.

**Note:** `MOCK_USE_CASES` (line 59) currently has `UC1` and `UC11` but not `UC6` — the fixture needs a `UC6` entry added since `decision-endpoints` (Task 1) lists `['UC1', 'UC6']`. `renderPage()` (line 195), `beforeEach` (line 204, mocks `apiClient.get` to resolve `{ data: { vertical: 'banking', useCases: MOCK_USE_CASES } }`), and `screen`/`within` imports (line 22) already exist — mirrors the existing Happy-Path-section test.

- [x] **Step 1: Write the failing test**

Add a `UC6` entry to `MOCK_USE_CASES` in `demo_api_ui/src/__tests__/UseCaseLauncherPage.test.js`, immediately after the existing `UC1` entry (after line 75):

```js
  {
    id: 'UC6',
    useCaseId: 'authz-denied',
    track: 'controls',
    title: 'Authz denied',
    buyerStory: 'Buyer story for UC6.',
    pingOneSolution: 'PingOne denies.',
    trigger: { type: 'chip', text: 'transfer $75000' },
    expectedOutcome: 'DENY',
    evidence: {},
    codeRefs: [],
    maturity: 'works',
    owasp: { threats: ['T3'], sections: ['§6'] },
    whatToSay: 'The policy denied it.',
    advanced: false,
  },
```

Add the test itself near the existing Happy-Path-section test (line 481):

```js
  it('renders a PingOne Authorize section containing UC1 and UC6', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText(/PingOne Authorize/i)).toBeInTheDocument());
    const section = screen.getByText(/PingOne Authorize/i).closest('section');
    expect(within(section).getAllByText('Delegated access with proof').length).toBeGreaterThan(0); // UC1
    expect(within(section).getAllByText('Authz denied').length).toBeGreaterThan(0); // UC6
  });
```

- [x] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/__tests__/UseCaseLauncherPage.test.js -t "PingOne Authorize section"`
Expected: FAIL — no "PingOne Authorize" text/section exists yet.

- [x] **Step 3: Add the label and import**

In `demo_api_ui/src/pages/UseCaseLauncherPage.js`, near the existing `HAPPY_PATH_LABEL`/`DEMO_LABEL` constants (lines 48-49):

```js
const PINGONE_AUTHORIZE_LABEL = 'PingOne Authorize — contextual runtime decisions, cited against the running code';
```

Add the import at the top of the file, after the existing `demoUseCaseSteps` import (line 35):

```js
import { allRelatedUCIds } from '../config/capabilityLedgers/pingOneAuthorizeCapabilities';
```

- [x] **Step 4: Derive the filtered list**

Near the existing `happyPathIds`/`happyPath` derivation (lines 866-870), add:

```js
  const authorizeIds = new Set(allRelatedUCIds());
  const authorizeAll = useCases.filter((uc) => authorizeIds.has(uc.id));
  const authorizeVisible = authorizeAll.filter((uc) => matchesQuery(uc, query));
```

- [x] **Step 5: Render the strip section**

Immediately after the existing Happy Paths `</section>` (after line 1008, before the track-grouped grid render), add:

```jsx
      {authorizeVisible.length > 0 && (
        <section className="uc-track uc-track--pingone-authorize">
          <h2 className="uc-track__heading">{PINGONE_AUTHORIZE_LABEL}</h2>
          <div className="uc-track__grid">
            {authorizeVisible.map((uc) => (
              <UseCaseCard
                key={uc.id}
                uc={uc}
                completed={completedIds.has(uc.id)}
                onRun={handleRun}
                onRunAttack={handleRunAttack}
                onExplain={setExplainUc}
                onOpen={handleOpen}
                attackState={attackStates[uc.id]}
                chipRunning={chipRun?.id === uc.id && chipRun.state === 'running'}
                chipRunError={chipRun?.id === uc.id && chipRun.state === 'error' ? chipRun.msg : null}
                flagMap={flagMap}
                flagsLoading={flagsLoading}
                setFlag={setFlag}
              />
            ))}
          </div>
        </section>
      )}
```

(Mirrors the Happy Paths strip block exactly — same `UseCaseCard` props, no `stepNumber` prop since this is not a numbered walkthrough.)

- [x] **Step 6: Update `hasAnyResults` if needed**

Check the existing `hasAnyResults` derivation (line ~890-893). If it does not already account for every visible strip, add `authorizeVisible.length > 0 ||` to the disjunction so an authorize-only search match is not reported as "no results":

```js
  const hasAnyResults =
    demoVisible.length > 0 ||
    happyPath.length > 0 ||
    authorizeVisible.length > 0 ||
    grouped.some(({ track, items }) => getDisplayItems(track, items).length > 0);
```

- [x] **Step 7: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run src/__tests__/UseCaseLauncherPage.test.js`
Expected: PASS — including the new test and all pre-existing ones in this file (a UC now appearing in two sections — its original track/Happy-Path AND this new strip — must not break any test asserting an exact total card count; if one does, update that test's expected count, since the design is intentionally additive, not exclusive).

- [x] **Step 8: Commit**

```bash
git add demo_api_ui/src/pages/UseCaseLauncherPage.js demo_api_ui/src/__tests__/UseCaseLauncherPage.test.js
git commit -m "feat(pingone-authorize): add PingOne Authorize strip section to /use-cases"
```

---

## Final verification

- [x] Run the full frontend unit suite: `cd demo_api_ui && npm run test:unit`
- [x] Manual: sign in as admin at `local.ping-devops.com:4000`, open `/pingone-authorize-capabilities`, confirm all 8 cards render grouped 3/3/2 with evidence citations.
- [x] Manual: visit `/use-cases`, confirm the new "PingOne Authorize" strip appears above the track-grouped grid, above or alongside the Happy Paths strip, with the expected use cases (UC1, UC6, UC7, UC8, UC9, UC10, UC13, UC14b, UC20, UC21).
- [x] Manual: confirm the AdminSideNav "Authorize" section shows both "PingOne Authorize" and "Authorize Capabilities" links, and both stay highlighted-active correctly.
- [x] Confirm `git diff --stat` against `main` touches no file also touched by `worktree-pingone-authorize-inspector-shell` (`git diff --stat main...worktree-pingone-authorize-inspector-shell -- demo_api_ui/src/components/PingOneAuthorizePage.jsx` should show no overlap with this branch's changed files).

---

## Execution record (2026-07-20)

Executed via superpowers:subagent-driven-development — 5 tasks, each implemented by a fresh implementer subagent, task-reviewed (spec compliance + code quality) by an independent reviewer subagent, plus a final whole-branch review. Tasks 1 and 2 each needed one fix round for spec-text fidelity (implementers silently substituted ASCII punctuation for the brief's Unicode characters, backed by a false "parse error" justification each time — caught by review, fixed, re-reviewed clean). Tasks 3-5 passed review clean on the first pass. Final whole-branch review: 0 Critical, 0 Important, 6 Minor (all deferred/forward-looking, e.g. missing CSS accent on the new `/use-cases` strip, `CapabilityCallout`'s unguarded `evidence.code` access). Merged via PR #662.
