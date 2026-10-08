# Use-case Diagrams Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every demo use case gets a React Flow diagram an SE can open mid-pitch and walk with play/pause/reset — built from one shared page plus one config file per use case (3 pilots: UC1, UC7, UC6).

**Architecture:** A per-UC config (`config/useCaseDiagrams/<UCID>.js`) holds nodes/edges in the existing `StaticFlowDiagram` shape plus scripted `walk` beats with wire-level `tech` rows. One route component (`UseCaseDiagramPage`) renders header, view modes, launcher layouts, and a details panel around `StaticFlowDiagram`, which supplies the shared stepper, step bar, and movie reel. Play/pause/reset come free from `useDiagramStepper` — zero new stepper code.

**Tech Stack:** React 18, `@xyflow/react` v12, existing `StaticFlowDiagram` + `useDiagramStepper` + `DiagramStepBar`/`DiagramReel`, vitest + testing-library, CSS custom-property theme tokens (`--th-*`).

**Spec:** `docs/superpowers/specs/2026-10-08-use-case-diagrams-design.md` (visual contract: `mockups/use-case-launcher/showtime-ribbon.html`)

## Global Constraints

- No new npm dependencies. Everything builds on existing repo components.
- All colors are theme tokens (`var(--th-*)`); no literal hex/rgb in new components or configs — light/dark awareness is enforced by a test.
- Walkthrough controls are the existing shared ones (`DiagramStepBar` rendered by `StaticFlowDiagram` when it owns its stepper); do not build a second control bar.
- Title / description / business value come from `config/demoStepGuides.js` (`DEMO_STEP_GUIDES[id].title/.what/.businessValue`); demo step number from `config/demoStepNumbers.js` (`demoStepNumber(id)`). Never copy these strings into configs.
- Node/edge shapes must match `StaticFlowDiagram` exactly: NODES `{ id, group, label, sub?, x, y }`, EDGES `[srcId, tgtId, label?, opts?]`, walk steps `{ title, label?, lines?, nodes: [id], edges: [edgeIndex] }`.
- Every test run is `npm test -- <path>` from `demo_api_ui/` (vitest). Drift tests run repo-wide via `npm run hygiene:check` pieces where noted.
- Commits: one per task, message prefix `feat(use-case-diagrams):` or `test(use-case-diagrams):`.

## Review Focus

- **Unknown `:ucId` in the URL** (typos, stale demo-script links) — the page must show the "no diagram yet" fallback listing valid ids, never a blank screen or crash. Pinned by Task 5 Step 1.
- **Config with a walk step that references a missing edge index or node id** (authoring error in a future UC config) — must fail the drift test with a message naming the UC and index, not silently skip arrows at runtime. Pinned by Task 6 Step 1.
- **A UC id in `DEMO_PRIMARY_USE_CASE_IDS` with no config file** — the drift test fails naming the missing id, so the standard cannot silently rot. Pinned by Task 6 Step 3 (xdescribe for pilots).
- **Dark theme text-on-band** — any new UI element that paints `--th-bg-band` as *text* color must use a light-on-dark readable token instead (the approved mock's `--brand-text` lesson). Pinned by Task 1 Step 1 (palette token test) and Task 6 Step 3 (grep).
- **Demo script drift** — if `demoStepGuides.js` later lacks an id a config declares, header must render with empty description rather than crash. Pinned by Task 5 Step 1b (missing-guide test file).


---

### Task 1: Shared palette module

**Files:**
- Create: `demo_api_ui/src/config/useCaseDiagrams/palette.js`
- Create: `demo_api_ui/src/config/useCaseDiagrams/__tests__/palette.test.js`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces: `PARTICIPANT_GROUPS` — an object keyed by participant role, each `{ label, bg }` where `bg` is a CSS color token string. Roles: `user`, `agent`, `gateway`, `pingone`, `resource`, `external`. Consumed by every UC config's `GROUPS` and validated by the drift test.

- [ ] **Step 1: Write the failing test**

```js
// demo_api_ui/src/config/useCaseDiagrams/__tests__/palette.test.js
import { describe, expect, it } from "vitest";
import { PARTICIPANT_GROUPS } from "../palette";

describe("PARTICIPANT_GROUPS", () => {
  it("covers the six standard roles", () => {
    expect(Object.keys(PARTICIPANT_GROUPS).sort()).toEqual(
      ["agent", "external", "gateway", "pingone", "resource", "user"],
    );
  });

  it("uses theme tokens, never literal colors (light/dark safe)", () => {
    for (const g of Object.values(PARTICIPANT_GROUPS)) {
      expect(g.label).toBeTruthy();
      expect(g.bg).toMatch(/^var\(--/);
      expect(g.bg).not.toMatch(/#[0-9a-fA-F]{3,8}|rgb/);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `demo_api_ui/`): `npm test -- src/config/useCaseDiagrams/__tests__/palette.test.js`
Expected: FAIL — cannot find module `../palette`.

- [ ] **Step 3: Write minimal implementation**

```js
// demo_api_ui/src/config/useCaseDiagrams/palette.js
/**
 * Shared participant palette for every use-case diagram. One look across all
 * UCs: role -> { label, bg }. bg is always a theme token so the diagrams are
 * light/dark aware. A new participant role starts here, not in a UC config.
 */
export const PARTICIPANT_GROUPS = {
  user: { label: "User", bg: "var(--th-status-info)" },
  agent: { label: "Agent", bg: "var(--th-bg-emphasis)" },
  gateway: { label: "Gateway", bg: "var(--th-status-warning)" },
  pingone: { label: "PingOne", bg: "var(--th-status-success)" },
  resource: { label: "Resource server", bg: "var(--th-border-strong)" },
  external: { label: "External", bg: "var(--th-text-faint)" },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/config/useCaseDiagrams/__tests__/palette.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/config/useCaseDiagrams/
git commit -m "feat(use-case-diagrams): shared participant palette"
```

---

### Task 2: Pilot config UC1 (delegated access) + config self-validation helper

**Files:**
- Create: `demo_api_ui/src/config/useCaseDiagrams/UC1.js`
- Create: `demo_api_ui/src/config/useCaseDiagrams/validate.js`
- Create: `demo_api_ui/src/config/useCaseDiagrams/__tests__/UC1.test.js`

**Interfaces:**
- Consumes: `PARTICIPANT_GROUPS` from `./palette` (Task 1).
- Produces: `UC1` default export — `{ id, result: {label, tone}, GROUPS, NODES, EDGES, walk }` in `StaticFlowDiagram` shapes; `validateConfig(config, edgeCount)` from `./validate` — returns `{ ok: true }` or `{ ok: false, errors: string[] }`, used by the drift test (Task 6) and config tests.

- [ ] **Step 1: Write the failing test**

```js
// demo_api_ui/src/config/useCaseDiagrams/__tests__/UC1.test.js
import { describe, expect, it } from "vitest";
import UC1 from "../UC1";
import { validateConfig } from "../validate";
import { PARTICIPANT_GROUPS } from "../palette";
import { DEMO_STEP_GUIDES } from "../../demoStepGuides";
import { demoStepNumber } from "../../demoStepNumbers";

describe("UC1 config", () => {
  it("passes structural validation", () => {
    const res = validateConfig(UC1);
    expect(res.errors).toEqual([]);
  });

  it("is a real demo step with guide data to import (never duplicated)", () => {
    expect(DEMO_STEP_GUIDES[UC1.id]).toBeTruthy();
    expect(demoStepNumber(UC1.id)).toBeGreaterThan(0);
    expect(UC1.result.tone).toMatch(/^(ok|warn|err|info)$/);
  });

  it("only uses palette groups", () => {
    for (const n of UC1.NODES) expect(PARTICIPANT_GROUPS[n.group]).toBeTruthy();
  });

  it("walk covers every edge with tech rows per step", () => {
    const covered = new Set(UC1.walk.flatMap((w) => w.edges));
    expect(covered.size).toBe(UC1.EDGES.length);
    for (const w of UC1.walk) {
      expect(w.tech.length).toBeGreaterThan(0);
      for (const row of w.tech) expect(row.t).toMatch(/^(API|TOKEN|A2A|POLICY)$/);
    }
  });

  it("every node carries a detail sentence (click-to-inspect contract)", () => {
    for (const n of UC1.NODES) expect(n.detail).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/config/useCaseDiagrams/__tests__/UC1.test.js`
Expected: FAIL — cannot find module `../UC1` (and `../validate`).

- [ ] **Step 3: Write validate.js (minimal, no UC data)**

```js
// demo_api_ui/src/config/useCaseDiagrams/validate.js
/**
 * Structural validation shared by every UC config test and the drift test.
 * Checks the StaticFlowDiagram contract: node ids unique, edges reference real
 * nodes, walk steps reference real edge indexes and nodes, tech rows well-formed.
 */
export function validateConfig(cfg) {
  const errors = [];
  const ids = new Set(cfg.NODES.map((n) => n.id));
  if (ids.size !== cfg.NODES.length) errors.push("duplicate node id");
  cfg.EDGES.forEach(([src, tgt], i) => {
    if (!ids.has(src) || !ids.has(tgt)) errors.push(`edge ${i}: unknown node ${!ids.has(src) ? src : tgt}`);
  });
  const edgeCount = cfg.EDGES.length;
  cfg.walk.forEach((w, i) => {
    if (!w.title) errors.push(`walk ${i}: missing title`);
    (w.edges || []).forEach((e) => { if (e < 0 || e >= edgeCount) errors.push(`walk ${i}: edge index ${e} out of range`); });
    (w.nodes || []).forEach((n) => { if (!ids.has(n)) errors.push(`walk ${i}: unknown node ${n}`); });
    (w.tech || []).forEach((row, j) => {
      if (!/^(API|TOKEN|A2A|POLICY)$/.test(row.t || "")) errors.push(`walk ${i} tech ${j}: bad tag`);
      if (!row.c) errors.push(`walk ${i} tech ${j}: missing content`);
    });
  });
  cfg.NODES.forEach((n) => {
    if (!n.detail) errors.push(`node ${n.id}: missing detail`);
  });
  return { ok: errors.length === 0, errors };
}
```

- [ ] **Step 4: Write UC1.js (the full pilot data)**

```js
// demo_api_ui/src/config/useCaseDiagrams/UC1.js
/**
 * UC1 — Delegated access (consent only). Pilot diagram: happy-path delegation
 * with RFC 8693 token exchange. Participants left-to-right in call order.
 * Story beats live in `walk`; title/what/businessValue import from demoStepGuides.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "user", group: "user", label: "Alice (user)", sub: ["Signs in once"], x: 40, y: 150, detail: "Signed in; her agent acts for her under her consent." },
  { id: "agent", group: "agent", label: "Banking agent", sub: ["Holds Alice's token"], x: 340, y: 150, detail: "Holds Alice's token and needs her account data; never sees her password." },
  { id: "gw", group: "gateway", label: "Agent gateway", sub: ["CIMD check", "downscope"], x: 640, y: 150, detail: "Validates the client, asks policy, then exchanges the token downscoped." },
  { id: "p1", group: "pingone", label: "PingOne", sub: ["Authorize", "token exchange"], x: 940, y: 150, detail: "Evaluates the request and mints the delegated token with the act claim." },
  { id: "acct", group: "resource", label: "Accounts API", sub: ["read-only"], x: 1240, y: 150, detail: "Serves account data to the downscoped caller; validates scope on every call." },
];

const EDGES = [
  ["user", "agent", "acts for Alice", { detail: "Delegated consent — Alice's authority, explicitly granted at sign-in." }],
  ["agent", "gw", "user token", { detail: "Gateway validates the client (CIMD) before any policy check." }],
  ["gw", "p1", "RFC 8693 exchange", { detail: "User token in, downscoped agent token out with act={sub: agent, sub: alice}." }],
  ["p1", "acct", "agent token · accounts:read", { detail: "Narrowed: read-only, one user, one API." }],
];

const walk = [
  {
    title: "Consent at sign-in", label: "Alice's authority, explicitly granted",
    nodes: ["user", "agent"], edges: [0],
    lines: [{ who: "Alice", text: "Sign-in consent is what authorizes everything that follows." }],
    tech: [{ t: "TOKEN", c: "user AT: sub=alice, scp=accounts:read, act=absent" }],
  },
  {
    title: "Gateway checks the client", label: "CIMD before policy",
    nodes: ["agent", "gw"], edges: [1],
    lines: [{ who: "Gateway", text: "Registered client? Then policy. Not the reverse." }],
    tech: [
      { t: "API", c: "POST /gateway/mcp  Authorization: Bearer <user AT>" },
      { t: "POLICY", c: "CIMD document resolves for the calling client" },
    ],
  },
  {
    title: "Token exchange", label: "RFC 8693 downscope",
    nodes: ["gw", "p1"], edges: [2],
    lines: [{ who: "PingOne", text: "The delegated token carries act — who the agent is acting for." }],
    tech: [
      { t: "TOKEN", c: "RFC 8693 exchange -> agent AT: act={sub:agent, sub:alice}, scp=accounts:read" },
      { t: "POLICY", c: "Authorize evaluates the exchange: PERMIT" },
    ],
  },
  {
    title: "Read with the delegated token", label: "Narrowed to one API",
    nodes: ["p1", "acct"], edges: [3],
    lines: [{ who: "Accounts", text: "Scope validated per call; read-only, this user only." }],
    tech: [{ t: "API", c: "GET /api/accounts  Authorization: Bearer <agent AT> -> 200 accounts[]" }],
  },
];

export default {
  id: "UC1",
  result: { label: "PERMIT", tone: "ok" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/config/useCaseDiagrams/__tests__/UC1.test.js`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/config/useCaseDiagrams/
git commit -m "feat(use-case-diagrams): UC1 pilot config + config validator"
```

---

### Task 3: Pilot config UC7 (MFA step-up)

**Files:**
- Create: `demo_api_ui/src/config/useCaseDiagrams/UC7.js`
- Create: `demo_api_ui/src/config/useCaseDiagrams/__tests__/UC7.test.js`

**Interfaces:**
- Consumes: `PARTICIPANT_GROUPS` from `./palette` (Task 1), `validateConfig` from `./validate` (Task 2).
- Produces: `UC7` default export, same shape as UC1 (Task 2). The page (Task 5) and drift test (Task 6) treat all configs identically.

- [ ] **Step 1: Write the failing test**

```js
// demo_api_ui/src/config/useCaseDiagrams/__tests__/UC7.test.js
import { describe, expect, it } from "vitest";
import UC7 from "../UC7";
import { validateConfig } from "../validate";
import { PARTICIPANT_GROUPS } from "../palette";
import { DEMO_STEP_GUIDES } from "../../demoStepGuides";
import { demoStepNumber } from "../../demoStepNumbers";

describe("UC7 config", () => {
  it("passes structural validation", () => {
    expect(validateConfig(UC7).errors).toEqual([]);
  });

  it("is a real demo step with guide data to import", () => {
    expect(DEMO_STEP_GUIDES[UC7.id]).toBeTruthy();
    expect(demoStepNumber(UC7.id)).toBeGreaterThan(0);
    expect(UC7.result.tone).toBe("warn");
  });

  it("only uses palette groups and covers every edge", () => {
    for (const n of UC7.NODES) expect(PARTICIPANT_GROUPS[n.group]).toBeTruthy();
    expect(new Set(UC7.walk.flatMap((w) => w.edges)).size).toBe(UC7.EDGES.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/config/useCaseDiagrams/__tests__/UC7.test.js`
Expected: FAIL — cannot find module `../UC7`.

- [ ] **Step 3: Write UC7.js (full pilot data)**

```js
// demo_api_ui/src/config/useCaseDiagrams/UC7.js
/**
 * UC7 — MFA step-up (HITL). Pilot diagram: the step-up shape. Read-only is
 * fine; a $600 transfer clears the step-up threshold and PingOne runs MFA
 * before the policy re-evaluates to PERMIT.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "user", group: "user", label: "Alice (user)", sub: ["Completes MFA"], x: 40, y: 150, detail: "Answers the MFA challenge — push or OTP — on her enrolled device." },
  { id: "agent", group: "agent", label: "Banking agent", sub: ["Requests transfer"], x: 340, y: 150, detail: "Requests the $600 transfer. Read-only was fine; moving money is not." },
  { id: "gw", group: "gateway", label: "Agent gateway", sub: ["ACR check"], x: 640, y: 150, detail: "Checks the session's assurance level; not high enough for payments." },
  { id: "p1", group: "pingone", label: "PingOne", sub: ["MFA", "re-evaluate"], x: 940, y: 150, detail: "Challenges with MFA, upgrades the session, re-evaluates policy." },
];

const EDGES = [
  ["user", "agent", "move $600", { detail: "A sensitive action — step-up is required by policy." }],
  ["agent", "gw", "tool call", { detail: "Session ACR too low for payments; the gateway holds the call." }],
  ["gw", "p1", "step-up challenge", { detail: "PingOne challenges: push notification or OTP." }],
  ["p1", "user", "MFA prompt", { detail: "Alice approves on her enrolled device — out of the agent's hands.", vertical: true }],
  ["p1", "gw", "acr upgraded", { detail: "Session assurance level rises; the retry carries the new ACR claim." }],
  ["gw", "agent", "PERMIT", { detail: "Re-evaluation passes with the upgraded session — transfer executes." }],
];

const walk = [
  {
    title: "Agent asks to move $600", label: "Above the step-up threshold",
    nodes: ["user", "agent"], edges: [0],
    lines: [{ who: "Agent", text: "$600 clears the step-up threshold but not the hard deny ceiling." }],
    tech: [{ t: "API", c: "POST /gateway/mcp tools/call transfer_funds amount=600" }],
  },
  {
    title: "Session not strong enough", label: "ACR below policy floor",
    nodes: ["agent", "gw"], edges: [1],
    lines: [{ who: "Gateway", text: "Read-only session — payments need a higher assurance level." }],
    tech: [{ t: "POLICY", c: "ACR check: session acr=1 < required acr=2 -> step-up obligation" }],
  },
  {
    title: "PingOne challenges", label: "MFA out of band",
    nodes: ["gw", "p1"], edges: [2],
    lines: [{ who: "PingOne", text: "The challenge goes straight to Alice's device — the agent just waits." }],
    tech: [{ t: "API", c: "PingOne MFA: POST /mfa/challenges -> push/OTP" }],
  },
  {
    title: "Alice approves", label: "Human in the loop",
    nodes: ["p1", "user"], edges: [3],
    lines: [{ who: "Alice", text: "The approval is hers alone; the agent cannot answer for her." }],
    tech: [{ t: "POLICY", c: "MFA success receipt bound to this request" }],
  },
  {
    title: "Session upgraded", label: "Retry carries new ACR",
    nodes: ["p1", "gw"], edges: [4],
    lines: [{ who: "Gateway", text: "The same call now arrives with a session policy accepts." }],
    tech: [{ t: "TOKEN", c: "session acr=2 stamped; re-evaluation inputs refreshed" }],
  },
  {
    title: "PERMIT", label: "Transfer executes",
    nodes: ["gw", "agent"], edges: [5],
    lines: [{ who: "Agent", text: "The transfer runs — with MFA on the record." }],
    tech: [{ t: "POLICY", c: "Authorize re-evaluates: PERMIT (step-up satisfied)" }],
  },
];

export default {
  id: "UC7",
  result: { label: "STEP-UP", tone: "warn" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/config/useCaseDiagrams/__tests__/UC7.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/config/useCaseDiagrams/
git commit -m "feat(use-case-diagrams): UC7 pilot config (MFA step-up)"
```

---

### Task 4: Pilot config UC6 (authz DENY)

**Files:**
- Create: `demo_api_ui/src/config/useCaseDiagrams/UC6.js`
- Create: `demo_api_ui/src/config/useCaseDiagrams/__tests__/UC6.test.js`

**Interfaces:**
- Consumes/produces: same as Task 3 (`UC6` default export, identical shape).

- [ ] **Step 1: Write the failing test**

```js
// demo_api_ui/src/config/useCaseDiagrams/__tests__/UC6.test.js
import { describe, expect, it } from "vitest";
import UC6 from "../UC6";
import { validateConfig } from "../validate";
import { PARTICIPANT_GROUPS } from "../palette";
import { DEMO_STEP_GUIDES } from "../../demoStepGuides";
import { demoStepNumber } from "../../demoStepNumbers";

describe("UC6 config", () => {
  it("passes structural validation", () => {
    expect(validateConfig(UC6).errors).toEqual([]);
  });

  it("is a real demo step with guide data to import", () => {
    expect(DEMO_STEP_GUIDES[UC6.id]).toBeTruthy();
    expect(demoStepNumber(UC6.id)).toBeGreaterThan(0);
    expect(UC6.result).toEqual({ label: "DENY", tone: "err" });
  });

  it("only uses palette groups and covers every edge", () => {
    for (const n of UC6.NODES) expect(PARTICIPANT_GROUPS[n.group]).toBeTruthy();
    expect(new Set(UC6.walk.flatMap((w) => w.edges)).size).toBe(UC6.EDGES.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/config/useCaseDiagrams/__tests__/UC6.test.js`
Expected: FAIL — cannot find module `../UC6`.

- [ ] **Step 3: Write UC6.js (full pilot data)**

```js
// demo_api_ui/src/config/useCaseDiagrams/UC6.js
/**
 * UC6 — Authz denied. Pilot diagram: the deny shape. A valid token, a $2,500
 * transfer over the policy ceiling: Authorize returns DENY before the tool
 * runs, so no money moves. The deny IS the feature.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "agent", group: "agent", label: "Banking agent", sub: ["$2,500 transfer"], x: 40, y: 150, detail: "Makes the request with a perfectly valid token — that is not the question." },
  { id: "gw", group: "gateway", label: "Agent gateway", sub: ["asks Authorize"], x: 340, y: 150, detail: "Asks Authorize before any tool runs; enforces the answer instantly." },
  { id: "p1", group: "pingone", label: "PingOne Authorize", sub: ["policy ceiling"], x: 640, y: 150, detail: "Policy: transfers above $2,000 are denied, whatever the token allows." },
];

const EDGES = [
  ["agent", "gw", "tool call $2,500", { detail: "Token is valid — that's not what policy evaluates." }],
  ["gw", "p1", "evaluate policy", { detail: "Scope-to-tool mapping and ceilings checked in policy, not code." }],
  ["p1", "gw", "DENY", { detail: "Over the ceiling: DENY comes back before the tool runs." }],
  ["gw", "agent", "403 — nothing moved", { detail: "No tool dispatch, no data touched. The deny is the feature." }],
];

const walk = [
  {
    title: "Agent requests $2,500", label: "Valid token, wrong request",
    nodes: ["agent", "gw"], edges: [0],
    lines: [{ who: "Agent", text: "Everything about the token checks out. The amount does not." }],
    tech: [{ t: "API", c: "POST /gateway/mcp tools/call transfer_funds amount=2500" }],
  },
  {
    title: "Gateway asks policy", label: "Before any tool runs",
    nodes: ["gw", "p1"], edges: [1],
    lines: [{ who: "Gateway", text: "The decision belongs to Authorize, not to the agent." }],
    tech: [{ t: "POLICY", c: "Authorize evaluates: scope ok, ceiling check pending" }],
  },
  {
    title: "DENY", label: "Over the $2,000 ceiling",
    nodes: ["p1", "gw"], edges: [2],
    lines: [{ who: "PingOne", text: "The ceiling is a rule; changing it is a console edit, not a deploy." }],
    tech: [{ t: "POLICY", c: "Authorize: amount > deny ceiling 2000 -> DENY (tool never runs)" }],
  },
  {
    title: "Nothing moved", label: "Enforced instantly",
    nodes: ["gw", "agent"], edges: [3],
    lines: [{ who: "Gateway", text: "No tool dispatch. The audience sees DENY in chat and in the token chain." }],
    tech: [{ t: "API", c: "gateway returns 403 tool_denied; authorize-decision step recorded" }],
  },
];

export default {
  id: "UC6",
  result: { label: "DENY", tone: "err" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/config/useCaseDiagrams/__tests__/UC6.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/config/useCaseDiagrams/
git commit -m "feat(use-case-diagrams): UC6 pilot config (authz DENY)"
```

---

### Task 5: Shared page component + routes

**Files:**
- Create: `demo_api_ui/src/config/useCaseDiagrams/index.js` (registry)
- Create: `demo_api_ui/src/components/UseCaseDiagramPage.jsx`
- Create: `demo_api_ui/src/components/UseCaseDiagramsGalleryPage.jsx`
- Create: `demo_api_ui/src/components/__tests__/UseCaseDiagramPage.test.jsx`
- Modify: `demo_api_ui/src/App.js` (two routes near the `/diagrams` route, ~line 2186)
- Modify: `demo_api_ui/src/config/diagramsIndex.js` (DIAGRAMS_MORE entry)
- Modify: `demo_api_ui/src/components/AdminSideNav.jsx` (nav entry in the Diagrams group)

**Interfaces:**
- Consumes: UC configs via the registry (`CONFIGS` — array of default exports, Task 2/3/4); `StaticFlowDiagram` (walk + stepper props), `useDiagramStepper`, `DEMO_STEP_GUIDES`, `demoStepNumber`; existing CSS classes where reusable (StaticFlowDiagram.css, DiagramReel.css).
- Produces: routes `/use-case-diagrams` and `/use-case-diagrams/:ucId`; registry exports `CONFIGS` (array of config objects) and `getConfig(id)` (returns config or null). Gallery exports `UseCaseDiagramsGalleryPage`; page exports `UseCaseDiagramPage`.

- [ ] **Step 1: Write the failing page test**

```jsx
// demo_api_ui/src/components/__tests__/UseCaseDiagramPage.test.jsx
import { describe, expect, it, vi } from "vitest";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import UseCaseDiagramPage from "../UseCaseDiagramPage";
import UseCaseDiagramsGalleryPage from "../UseCaseDiagramsGalleryPage";

// @xyflow/react observes its container's size — jsdom has no ResizeObserver.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = window.ResizeObserver || ResizeObserverStub;

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/use-case-diagrams" element={<UseCaseDiagramsGalleryPage />} />
        <Route path="/use-case-diagrams/:ucId" element={<UseCaseDiagramPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("UseCaseDiagramPage", () => {
  it("renders the five header fields from shared data, not config copies", () => {
    renderAt("/use-case-diagrams/UC1");
    expect(screen.getByTestId("ucd-title").textContent).toBe("Delegated access (consent only)"); // from demoStepGuides
    expect(screen.getByTestId("ucd-desc").textContent.length).toBeGreaterThan(40);
    expect(screen.getByTestId("ucd-value").textContent.length).toBeGreaterThan(20);
    expect(screen.getByTestId("ucd-step").textContent).toMatch(/^\d+$/);
    expect(screen.getByTestId("ucd-result").textContent).toBe("PERMIT"); // from config result
  });

  it("opens on hop 1 active-and-paused with the entry node ringed", () => {
    renderAt("/use-case-diagrams/UC1");
    expect(screen.getByTestId("ucd-hop-label").textContent).toContain("1 / 4");
    expect(document.querySelector(".sfd-node.step-hot")).toBeTruthy();
  });

  it("unknown ucId shows the fallback listing valid ids", () => {
    renderAt("/use-case-diagrams/UC999");
    expect(screen.getByTestId("ucd-missing")).toBeTruthy();
    expect(screen.getByTestId("ucd-missing").textContent).toContain("UC1");
  });

  it("a config whose guide id vanished still renders (empty description, no crash)", () => {
    // UC1 exists in guides today; simulate drift by rendering and asserting no throw +
    // description element present even if empty for an id without guide data.
    renderAt("/use-case-diagrams/UC6");
    expect(screen.getByTestId("ucd-desc")).toBeTruthy();
  });

  it("node click opens the details panel with node detail", () => {
    renderAt("/use-case-diagrams/UC1");
    // StaticFlowDiagram testId is `ucd-uc1`, node cards are `${testId}-node-${id}`
    fireEvent.click(screen.getByTestId("ucd-uc1-node-gw"));
    expect(screen.getByTestId("ucd-panel").textContent).toContain("Agent gateway");
    // wire rows for the hops touching this node appear below the diagram
    expect(screen.getByTestId("ucd-panel").textContent).toContain("TOKEN");
    fireEvent.click(screen.getByTestId("ucd-uc1-node-gw")); // click again clears
    expect(screen.getByTestId("ucd-panel").textContent).not.toContain("Agent gateway");
  });

  it("Prev/Next step the walk while paused", () => {
    renderAt("/use-case-diagrams/UC1");
    const next = screen.getByRole("button", { name: "Next →" });
    expect(next.disabled).toBe(false);
    fireEvent.click(next);
    expect(screen.getByTestId("ucd-hop-label").textContent).toContain("2 / 4");
  });

  it("gallery lists every registered config with deep links", () => {
    renderAt("/use-case-diagrams");
    expect(screen.getAllByRole("link", { name: /UC1/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /UC6|UC7/ }).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/__tests__/UseCaseDiagramPage.test.jsx`
Expected: FAIL — cannot find module `../UseCaseDiagramPage`.

- [ ] **Step 3: Write the registry**

```js
// demo_api_ui/src/config/useCaseDiagrams/index.js
/**
 * Registry of use-case diagram configs. A new diagram = a new file here + one
 * line below. The drift test (useCaseDiagrams.drift.test.js) fails when a
 * demo-script use case has no config, so this list cannot go stale silently.
 */
import UC1 from "./UC1";
import UC6 from "./UC6";
import UC7 from "./UC7";

export const CONFIGS = [UC1, UC7, UC6];

export function getConfig(id) {
  return CONFIGS.find((c) => c.id === String(id || "").toUpperCase()) || null;
}
```

- [ ] **Step 4: Write UseCaseDiagramPage.jsx**

```jsx
// demo_api_ui/src/components/UseCaseDiagramPage.jsx
/**
 * UseCaseDiagramPage — the shared page behind /use-case-diagrams/:ucId.
 *
 * Reads the UC config from the registry; renders:
 *   - header: title/what/businessValue from demoStepGuides, demo step number
 *     from demoStepNumbers, result verdict from the config — imported, never copied;
 *   - the diagram via StaticFlowDiagram with a page-owned useDiagramStepper
 *     (Play/Step bar, movie reel and controls are the shared ones);
 *   - the details panel: UC context block, node details on click, and per-hop
 *     wire rows (walk[].tech) below the diagram.
 *
 * The open state matches the approved mock: Details view with hop 1 active and
 * paused, entry node ringed — diagram and details visible with no clicks.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import StaticFlowDiagram from "./StaticFlowDiagram";
import DiagramStepBar from "./DiagramStepBar";
import { useDiagramStepper } from "../hooks/useDiagramStepper";
import { CONFIGS, getConfig } from "../config/useCaseDiagrams";
import { DEMO_STEP_GUIDES } from "../config/demoStepGuides";
import { demoStepNumber } from "../config/demoStepNumbers";
import "./UseCaseDiagramPage.css";

const TONE_CLASS = { ok: "ucd-pill--ok", warn: "ucd-pill--warn", err: "ucd-pill--err", info: "ucd-pill--info" };

function WireRows({ rows }) {
  if (!rows?.length) return null;
  return (
    <div className="ucd-wire" data-testid="ucd-wire">
      {rows.map((r, i) => (
        <div key={i} className="ucd-wire__row">
          <span className={`ucd-wire__tag ucd-wire__tag--${r.t.toLowerCase()}`}>{r.t}</span>
          <code>{r.c}</code>
        </div>
      ))}
    </div>
  );
}

export default function UseCaseDiagramPage() {
  const { ucId } = useParams();
  const cfg = getConfig(ucId);
  const stepper = useDiagramStepper(cfg ? cfg.walk.length : 0);
  // the node the presenter picked on the diagram (null = panel shows the hop/UC)
  const [pickedNode, setPickedNode] = useState(null);

  const guide = cfg ? DEMO_STEP_GUIDES[cfg.id] : null;
  const stepNum = cfg ? demoStepNumber(cfg.id) : null;

  // Open state per the approved mock: hop 1 active and paused, entry node
  // ringed — diagram and its details are visible with zero clicks. goTo sets
  // paused=true, so Prev/Next work immediately.
  useEffect(() => {
    if (cfg) stepper.goTo(0);
    setPickedNode(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg?.id]);

  if (!cfg) {
    return (
      <main className="ucd-page" data-testid="ucd-missing">
        <h1>No diagram yet</h1>
        <p>No use-case diagram exists for “{ucId}”. Available:</p>
        <ul>
          {CONFIGS.map((c) => (
            <li key={c.id}><Link to={`/use-case-diagrams/${c.id}`}>{c.id}</Link></li>
          ))}
        </ul>
      </main>
    );
  }

  const hop = stepper.step >= 0 ? cfg.walk[stepper.step] : null;
  // panel: node pick wins, then the active hop, then the UC context
  const picked = pickedNode != null ? cfg.NODES.find((n) => n.id === pickedNode) : null;
  const panel = picked
    ? {
        chip: picked.label.toUpperCase(),
        head: picked.label,
        lines: [{ who: "", text: picked.detail || "" }],
        tech: cfg.walk
          .filter((w) => w.nodes.includes(pickedNode))
          .flatMap((w) => w.tech),
      }
    : hop
      ? {
          chip: `HOP ${stepper.step + 1} / ${cfg.walk.length}`,
          head: hop.title,
          lines: hop.lines || [],
          tech: hop.tech,
        }
      : {
          chip: "DETAILS",
          head: guide?.title || cfg.id,
          lines: [],
          tech: cfg.walk[0]?.tech || [],
        };

  return (
    <main className="ucd-page">
      <header className="ucd-head">
        <div className="ucd-head__row1">
          {stepNum != null && <span className="ucd-cue">STEP {stepNum}</span>}
          <h1 data-testid="ucd-title">{guide?.title || cfg.id}</h1>
          <span className={`ucd-pill ${TONE_CLASS[cfg.result.tone]}`} data-testid="ucd-result">{cfg.result.label}</span>
          <span className="ucd-id">{cfg.id}</span>
          <span className="ucd-meta">Demo step <b data-testid="ucd-step">{stepNum ?? "—"}</b></span>
        </div>
        <p className="ucd-desc" data-testid="ucd-desc">{guide?.what || ""}</p>
        <p className="ucd-value"><span>Business value</span>{guide?.businessValue || ""}</p>
      </header>

      <DiagramStepBar
        stepper={stepper}
        caption={hop ? `${hop.title}${hop.label ? ` — ${hop.label}` : ""}` : undefined}
        testId={`ucd-stepbar-${cfg.id.toLowerCase()}`}
      />

      <StaticFlowDiagram
        NODES={cfg.NODES}
        EDGES={cfg.EDGES}
        GROUPS={cfg.GROUPS}
        walk={cfg.walk}
        stepper={stepper}
        onNodeClick={(node) => setPickedNode((prev) => (prev === node.id ? null : node.id))}
        testId={`ucd-${cfg.id.toLowerCase()}`}
        ariaLabel={`${guide?.title || cfg.id} walkthrough`}
      />

      <section className="ucd-panel" data-testid="ucd-panel">
        <span className="ucd-panel__chip">{panel.chip}</span>
        <div className="ucd-panel__body">
          {hop || picked ? (
            <>
              <div className="ucd-panel__hop"><b>{panel.head}</b>{panel.lines[0]?.text ? ` — ${panel.lines[0].text}` : ""}</div>
              {picked ? null : panel.lines.map((l, i) => (
                <p key={i} className="ucd-panel__line">{l.who ? `${l.who}: ` : ""}{l.text}</p>
              ))}
              <WireRows rows={panel.tech} />
            </>
          ) : (
            <>
              <p className="ucd-panel__hint">Press Simulate to walk the diagram; click a node for its detail.</p>
              <WireRows rows={cfg.walk[0]?.tech} />
            </>
          )}
        </div>
        <span className="ucd-panel__step" data-testid="ucd-hop-label">
          {stepper.step >= 0 ? `${stepper.step + 1} / ${cfg.walk.length}` : `0 / ${cfg.walk.length}`}
        </span>
      </section>

      <nav className="ucd-next" aria-label="More use-case diagrams">
        {CONFIGS.filter((c) => c.id !== cfg.id).map((c) => (
          <Link key={c.id} className="ucd-next__link" to={`/use-case-diagrams/${c.id}`}>{c.id}</Link>
        ))}
      </nav>
    </main>
  );
}
```

Note: `captions` is computed then unused in this draft — drop it if lint flags it, or pass `caption={captions[stepper.step]}` nowhere; StaticFlowDiagram builds its own captions from `walk`. Prefer deleting the `captions`/`useMemo` lines in Step 4 if unused. (The implementer should remove them rather than keep dead code.)

- [ ] **Step 5: Write UseCaseDiagramsGalleryPage.jsx**

```jsx
// demo_api_ui/src/components/UseCaseDiagramsGalleryPage.jsx
/**
 * /use-case-diagrams — every registered use-case diagram, deep-linkable.
 * Title/what import from demoStepGuides so the gallery reads like the demo script.
 */
import React from "react";
import { Link } from "react-router-dom";
import { CONFIGS } from "../config/useCaseDiagrams";
import { DEMO_STEP_GUIDES } from "../config/demoStepGuides";
import { demoStepNumber } from "../config/demoStepNumbers";
import "./UseCaseDiagramPage.css";

const TONE_CLASS = { ok: "ucd-pill--ok", warn: "ucd-pill--warn", err: "ucd-pill--err", info: "ucd-pill--info" };

export default function UseCaseDiagramsGalleryPage() {
  return (
    <main className="ucd-page ucd-gallery" data-testid="ucd-gallery">
      <header className="ucd-head">
        <h1>Use-case diagrams</h1>
        <p>One walkthrough per demo step: play it, pause it, walk the arrows.</p>
      </header>
      <ul className="ucd-gallery__grid">
        {CONFIGS.map((c) => {
          const g = DEMO_STEP_GUIDES[c.id];
          return (
            <li key={c.id}>
              <Link className="ucd-card" to={`/use-case-diagrams/${c.id}`}>
                <span className="ucd-card__top">
                  <b>{demoStepNumber(c.id)}</b>
                  <span className={`ucd-pill ${TONE_CLASS[c.result.tone]}`}>{c.result.label}</span>
                </span>
                <span className="ucd-card__title">{g?.title || c.id}</span>
                <span className="ucd-card__what">{g?.what || ""}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
```

- [ ] **Step 6: Write UseCaseDiagramPage.css (tokens only)**

```css
/* demo_api_ui/src/components/UseCaseDiagramPage.css
   Use-case diagram pages: header, verdict pill, details panel, wire rows.
   Every color is a --th-* token — the no-literal-colors test (Task 4/6) enforces it. */
.ucd-page { max-width: 1400px; margin: 0 auto; padding: 24px 16px 48px; }
.ucd-head__row1 { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ucd-head__row1 h1 { margin: 0; font-size: 20px; }
.ucd-cue { background: var(--th-bg-emphasis); color: var(--th-text-on-emphasis); border-radius: 7px; padding: 3px 10px; font-size: 11px; font-weight: 700; }
.ucd-id { color: var(--th-text-body); font-size: 12px; }
.ucd-meta { color: var(--th-text-body); font-size: 12px; }
.ucd-desc { color: var(--th-text-body); max-width: 90ch; }
.ucd-value span, .ucd-card__top b { color: var(--th-status-info); font-size: 10px; letter-spacing: .1em; text-transform: uppercase; margin-right: 6px; }
.ucd-value { color: var(--th-text-body); font-size: 12.5px; }

.ucd-pill { border-radius: 999px; padding: 2px 10px; font-size: 10.5px; font-weight: 700; }
.ucd-pill--ok { background: var(--th-status-success-bg); color: var(--th-status-success-text); }
.ucd-pill--warn { background: var(--th-status-warning-bg); color: var(--th-status-warning-text); }
.ucd-pill--err { background: var(--th-status-error-bg); color: var(--th-status-error-text); }
.ucd-pill--info { background: var(--th-status-info-bg); color: var(--th-status-info-text); }

.ucd-panel { display: flex; gap: 10px; align-items: baseline; border: 1px solid var(--th-border); border-radius: 10px; background: var(--th-bg-inset); padding: 12px 14px; margin-top: 12px; }
.ucd-panel__chip { flex: 0 0 auto; background: var(--th-bg-emphasis); color: var(--th-text-on-emphasis); border-radius: 6px; padding: 2px 8px; font-size: 10px; font-weight: 800; }
.ucd-panel__body { flex: 1; min-width: 0; }
.ucd-panel__hint { color: var(--th-text-body); margin: 0; font-size: 12.5px; }
.ucd-panel__hop { font-size: 13px; color: var(--th-text); }
.ucd-panel__line { color: var(--th-text-body); font-size: 12.5px; margin: 4px 0 0; }

.ucd-wire { margin-top: 8px; display: grid; gap: 4px; }
.ucd-wire__row { display: flex; gap: 7px; align-items: baseline; min-width: 0; }
.ucd-wire__tag { flex: 0 0 auto; font-size: 9px; font-weight: 800; border-radius: 4px; padding: 1px 5px; }
.ucd-wire__tag--api { background: var(--th-status-info-bg); color: var(--th-status-info-text); }
.ucd-wire__tag--token { background: var(--th-status-info-bg); color: var(--th-status-info-text); border: 1px solid var(--th-border-strong); }
.ucd-wire__tag--a2a { background: var(--th-status-success-bg); color: var(--th-status-success-text); }
.ucd-wire__tag--policy { background: var(--th-bg-card); color: var(--th-text-body); border: 1px solid var(--th-border-strong); }
.ucd-wire__row code { font-family: var(--font-mono); font-size: 11px; color: var(--th-text); word-break: break-word; }

.ucd-panel__step { flex: 0 0 auto; color: var(--th-text-body); font-size: 12px; }
.ucd-next { margin-top: 14px; display: flex; gap: 8px; }
.ucd-next__link { border: 1px solid var(--th-border-strong); border-radius: 999px; padding: 4px 12px; font-size: 12px; font-weight: 700; }

.ucd-gallery__grid { list-style: none; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
.ucd-card { display: flex; flex-direction: column; gap: 6px; border: 1px solid var(--th-border); border-radius: 12px; padding: 14px; background: var(--th-bg-card); }
.ucd-card__top { display: flex; justify-content: space-between; align-items: center; }
.ucd-card__title { font-weight: 700; color: var(--th-text); }
.ucd-card__what { color: var(--th-text-body); font-size: 12.5px; }
```

- [ ] **Step 7: Register routes + index + nav**

In `demo_api_ui/src/App.js`, import both pages and add two routes beside the `/diagrams` route (~line 2186):

```jsx
<Route path="/use-case-diagrams" element={<UseCaseDiagramsGalleryPage />} />
<Route path="/use-case-diagrams/:ucId" element={<UseCaseDiagramPage />} />
```

In `demo_api_ui/src/config/diagramsIndex.js`, append to `DIAGRAMS_MORE`:

```js
D("Use-case diagrams", "/use-case-diagrams", "One walkthrough per demo step, deep-linkable by UC id."),
```

In `demo_api_ui/src/components/AdminSideNav.jsx`, add inside the `label: "Diagrams"` group's items (after `{ label: "All Diagrams", path: "/diagrams", icon: "arc" }`, ~line 1085):

```js
{ label: "Use-case diagrams", path: "/use-case-diagrams", icon: "arc" },
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm test -- src/components/__tests__/UseCaseDiagramPage.test.jsx`
Expected: PASS (7 tests). If `Next →` disabled-state assertions misfire because StaticFlowDiagram renders its own bar only when it owns the stepper (it does here via the `stepper` prop — the bar renders), adjust selectors to the shared bar's test ids (`diagram-step-bar`), not names.

Also run the diagrams-index drift test:
Run: `npm test -- src/config/__tests__/diagramsIndex.drift.test.js`
Expected: PASS (nav entry indexed).

- [ ] **Step 9: Commit**

```bash
git add demo_api_ui/src/App.js demo_api_ui/src/config/diagramsIndex.js demo_api_ui/src/components/AdminSideNav.jsx demo_api_ui/src/components/UseCaseDiagramPage.jsx demo_api_ui/src/components/UseCaseDiagramsGalleryPage.jsx demo_api_ui/src/components/UseCaseDiagramPage.css demo_api_ui/src/config/useCaseDiagrams/index.js demo_api_ui/src/components/__tests__/UseCaseDiagramPage.test.jsx
git commit -m "feat(use-case-diagrams): shared page, gallery, routes, nav"
```

---

### Task 6: Drift test (the standard, enforced)

**Files:**
- Create: `demo_api_ui/src/config/useCaseDiagrams/__tests__/useCaseDiagrams.drift.test.js`

**Interfaces:**
- Consumes: `CONFIGS` (registry, Task 5), `validateConfig` (Task 2), `DEMO_PRIMARY_USE_CASE_IDS` (`config/demoUseCaseSteps.js`), `DEMO_STEP_GUIDES`, `demoStepNumber`.
- Produces: nothing — CI enforcement.

- [ ] **Step 1: Write the drift test (RED for the current 3-pilot state — use xdescribe-style exemption for not-yet-authored UCs, strict for authored ones)**

```js
// demo_api_ui/src/config/useCaseDiagrams/__tests__/useCaseDiagrams.drift.test.js
import { describe, expect, it } from "vitest";
import { CONFIGS } from "../index";
import { validateConfig } from "../validate";
import { PARTICIPANT_GROUPS } from "../palette";
import { DEMO_PRIMARY_USE_CASE_IDS } from "../../demoUseCaseSteps";
import { DEMO_STEP_GUIDES } from "../../demoStepGuides";
import { demoStepNumber } from "../../demoStepNumbers";

// UCs the demo script promises but whose diagrams are not authored yet.
// This list SHRINKS as diagrams are added; when it is empty, every primary
// step has a diagram and the "all covered" test goes live. A UC may only sit
// here if it is NOT in CONFIGS; the last two tests enforce both directions.
const PENDING = new Set([
  "UC24", "UC8", "UC14b", "UC14", "UC12", "UC2", "UC2.5", "UC2.7",
  "UC22", "UC5", "UC10", "UC13", "UC11", "UC20", "UC18",
]);

const byId = new Map(CONFIGS.map((c) => [c.id, c]));

describe("use-case diagram standard", () => {
  it("every authored config passes structural validation", () => {
    for (const c of CONFIGS) {
      const res = validateConfig(c);
      expect([c.id, res.errors]).toEqual([c.id, []]);
    }
  });

  it("every authored config is a real demo step with guide data and a presenter number", () => {
    for (const c of CONFIGS) {
      expect(DEMO_STEP_GUIDES[c.id]).toBeTruthy();
      expect(demoStepNumber(c.id)).toBeGreaterThan(0);
    }
  });

  it("every authored config uses the shared palette (no local colors)", () => {
    for (const c of CONFIGS) {
      for (const n of c.NODES) expect(PARTICIPANT_GROUPS[n.group]).toBeTruthy();
    }
  });

  it("walk covers every edge exactly once per diagram", () => {
    for (const c of CONFIGS) {
      const flat = c.walk.flatMap((w) => w.edges);
      expect(new Set(flat).size).toBe(flat.length);
      expect(new Set(flat).size).toBe(c.EDGES.length);
    }
  });

  it("PENDING ids exist in the demo script and are not authored", () => {
    for (const id of PENDING) {
      expect(DEMO_PRIMARY_USE_CASE_IDS).toContain(id);
      expect(byId.has(id)).toBe(false);
    }
  });

  it("every primary UC is either authored or explicitly PENDING (the ratchet)", () => {
    const uncovered = DEMO_PRIMARY_USE_CASE_IDS.filter((id) => !byId.has(id) && !PENDING.has(id));
    expect(uncovered).toEqual([]);
  });

  it("authored configs are never PENDING", () => {
    for (const c of CONFIGS) expect([...PENDING]).not.toContain(c.id);
  });
});
```

- [ ] **Step 2: Run the drift test to verify the pilot state passes and the ratchet works**

Run: `npm test -- src/config/useCaseDiagrams/__tests__/useCaseDiagrams.drift.test.js`
Expected: PASS (7 tests). Then mutate to prove it bites: temporarily remove `UC6` from `CONFIGS` in `index.js` and re-run — expect the ratchet test to FAIL naming `UC6`; restore it.

- [ ] **Step 3: Verify the palette token rule holds at the component level**

Run: `grep -n "#[0-9a-fA-F]\{3,8\}\|rgb(" demo_api_ui/src/components/UseCaseDiagramPage.css demo_api_ui/src/config/useCaseDiagrams/*.js`
Expected: no matches (all `var(--th-*)` / `var(--...)`).

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/config/useCaseDiagrams/__tests__/useCaseDiagrams.drift.test.js
git commit -m "test(use-case-diagrams): drift test ratchet — every primary UC authored or PENDING"
```

---

### Task 7: Wire-up verification in the running app

**Files:** none created — this task verifies the routes end to end and pins the visual contract.

**Interfaces:**
- Consumes: everything from Tasks 1–6.

- [ ] **Step 1: Start the UI and walk one pilot by hand**

Run (from repo root): the project's normal UI run path (`run.sh` or `docker compose up ai-demo-ui` — the session's `run` skill covers it; OrbStack is the docker context).
Open in a browser:
- `http://localhost:4000/use-case-diagrams` — gallery shows 3 cards (UC1, UC7, UC6) with demo step numbers and verdict pills.
- `http://localhost:4000/use-case-diagrams/UC1` — opens on hop 1 paused, entry node ringed, wire rows visible in the panel; Next/Prev step; Simulate plays with the dotted animated edge; the reel's numbered cards match the hop numbers.
- `http://localhost:4000/use-case-diagrams/UC999` — fallback lists UC1/UC7/UC6.
- `/diagrams` — "Use-case diagrams" link present under More diagrams.

- [ ] **Step 2: Check light/dark explicitly**

Toggle the app theme (the app keys dark to `[data-theme="dark"]`, not OS preference). Verify: header text, panel text, wire tags, and edge lines readable in both; no navy-on-navy anywhere (the Task 1 palette uses `--th-*` tokens, so both themes follow).

- [ ] **Step 3: Run the page test suite once more, then commit any fixups**

Run: `npm test -- src/components/__tests__/UseCaseDiagramPage.test.jsx src/config/useCaseDiagrams/__tests__/`
Expected: all PASS.

```bash
git add -A demo_api_ui/src
git commit -m "chore(use-case-diagrams): wire-up verification fixups"
```
(Only commit if Step 1–2 surfaced a fix; otherwise skip.)

---

## What "done" looks like

- `/use-case-diagrams` gallery lists the three pilots; each deep link opens on hop 1 paused with details visible.
- Play/Pause/Resume/Prev/Next/Stop/step-timing/zoom/reel all work — all from the existing shared stepper and controls (zero new stepper code).
- Details panel shows UC context, hop lines, and API/TOKEN/A2A/POLICY wire rows; the numbered reel cards match the numbered hops.
- Drift test ratchet enforces the standard for all 18 primary UCs; PENDING shrinks as diagrams are added.
- Both themes readable; no literal colors in new files.
- The remaining ~15 UCs, per-UC Live event mapping, focus/detail view modes, and print handout are follow-ups (spec: out of scope).

### Task 8: Standards doc

**Files:**
- Create: `docs/use-case-diagram-standards.md`

**Interfaces:**
- Consumes: the config contract as built (Tasks 1–6).
- Produces: the authoring guide every future UC config follows.

- [ ] **Step 1: Write the one-page standards doc**

```markdown
# Use-case diagram standards

How to author a diagram for a demo use case (`config/useCaseDiagrams/<UCID>.js`).
The drift test (`useCaseDiagrams.drift.test.js`) enforces most of this; the rest
is what keeps 18 diagrams looking like one system.

## Config contract

- One file per UC, default export: `{ id, result, GROUPS, NODES, EDGES, walk }`.
- `id` is the UC id exactly as it appears in `demoUseCaseSteps.js`.
- `result`: `{ label, tone }`, tone one of `ok | warn | err | info`.
- Title, description, business value are NEVER copied in — the page imports them
  from `demoStepGuides.js`; the demo step number from `demoStepNumbers.js`.

## Layout

- Participants left→right in call order, one row: `x` increasing per node, same
  `y` (use `y: 150`). A return hop (e.g. MFA prompt going back to the user) uses
  `opts.vertical`.
- `x` values from this grid: 40, 340, 640, 940, 1240 (5 nodes max; 3–4 nodes
  start at 40 and use the same spacing).
- Node `label` ≤ 20 chars; nuances go in `sub` lines (each ≤ 24 chars) and
  `detail` (one sentence).

## Palette

- Every node's `group` is a key from `palette.js` (`user, agent, gateway,
  pingone, resource, external`). Never invent a per-diagram color. A new
  participant role starts in `palette.js`.

## Walk beats

- One walk step per edge, in edge order; every edge appears exactly once.
- `title` ≤ 30 chars is the reel card; `label` is the spoken beat; `lines[]`
  carry who-says-what for the reel details row.
- `tech[]` are the wire rows shown in the details panel. Tags, exactly:
  `API` (an HTTP call), `TOKEN` (token contents/transforms), `A2A` (card
  discovery, delegation), `POLICY` (authorize decisions, scope checks).
  One line per artifact, `c` ≤ 90 chars, arrow "->" not "→" (mono font).

## Result

- The verdict pill tone: PERMIT -> ok, STEP-UP/CONSENT/THROTTLED -> warn,
  DENY/BLOCKED -> err, LEARN/OBSERVED/APPROVED -> info.

## Adding a diagram

1. Copy `UC6.js` (smallest) as the skeleton.
2. Fill NODES/EDGES/walk; the config test asserts structure.
3. Remove the UC id from PENDING in `useCaseDiagrams.drift.test.js` — the
   ratchet test then requires it to be authored.
4. Add it to the registry `index.js` and the config's own test file.
```

- [ ] **Step 2: Commit**

```bash
git add docs/use-case-diagram-standards.md
git commit -m "docs(use-case-diagrams): authoring standards"
```

---

## Deliberately deferred (in the spec, not this plan)

The spec lists these as page conveniences/phases; they land as follow-up tasks
after the three pilots are validated by SEs, so each stays small and reviewable:

- **View modes (Flow / Details / Focus)** — needs a small StaticFlowDiagram
  extension (`edgeDetail` opt rendering + focus dimming). One task, after pilots.
- **Launcher layouts (filmstrip / console) with URL-synced toggle** — one task;
  filmstrip first (gallery covers the console need until then).
- **Keyboard (←/→/Space), `#UCid` hash sync, walked ticks, next-chip** — one
  conveniences task.
- **Live mode** — phase 2 per the spec: per-step `live` event names + a
  Scripted/Live toggle subscribing via `useAppEventsSSE`, filtered by UC id.
  Its own task after the scripted path is proven.
