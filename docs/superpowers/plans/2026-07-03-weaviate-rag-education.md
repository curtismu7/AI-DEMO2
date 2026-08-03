# Weaviate RAG Education + Demo Guide + Log Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Learning Hub education page on Weaviate/vector search, add a Code Search scenario to the Agent Demo Guide, and make the Weaviate container's Raft/log cadence configurable so it stops spamming "attempting to join".

**Architecture:** Pure additions to the existing React education-panel system (EDU id → panel component registered in a host map → opened via `openEdu()`) plus one new scenario object in the Agent Demo Guide's `DEMO_SCENARIOS` array, plus an env-only change to the `weaviate` service in `docker-compose.yml`. No backend code.

**Tech Stack:** React + Vite, **vitest** (NOT jest) + Testing Library, TypeScript for `LearningHub.tsx`, plain JS for education panels, Docker Compose.

## Global Constraints

- Work in the git worktree on branch `worktree-weaviate-rag-education`. Stage files explicitly (`git add <files>`), never `git add -A`. Verify `git branch --show-current` before each commit.
- Content must be factually consistent with this repo: Weaviate is **bring-your-own-vectors** (`DEFAULT_VECTORIZER_MODULE: none`), does **no** embedding itself; embeddings come from the llama.cpp `nomic-embed-text-v1.5` service; Weaviate is **internal-only** (no host port), reachable at `http://weaviate:8080`. Do **not** imply a hosted/OpenAI vectorizer.
- Education panels are static content components using the shared `EducationDrawer` (see `demo_api_ui/src/components/education/GleanPanel.js` as the reference pattern). The real `EducationDrawer` API is `{ isOpen, onClose, title, tabs, initialTabId }` where each tab is `{ id, label, content: <JSX> }`; it returns `null` when `!isOpen` and renders only the active tab.
- **Frontend tests run under vitest, NOT jest.** Run with `cd demo_api_ui && CI=true npx vitest run <path>`. Use `vi.mock` / `vi.fn` (not `jest.*`); `vi`, `test`, `expect` are globals (no import needed). Any `npx jest` in a step is a typo for `npx vitest run`.
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

- `demo_api_ui/src/components/education/educationIds.js` — add `VECTOR_RAG` id (modify).
- `demo_api_ui/src/components/education/WeaviateRagPanel.js` — new 4-tab education panel (create).
- `demo_api_ui/src/components/education/EducationPanelsHost.js` — import + register the panel (modify).
- `demo_api_ui/src/components/LearningHub.tsx` — add the card + its action under "AI Ecosystem" (modify).
- `demo_api_ui/src/components/AgentDemoGuide.jsx` — add one scenario to `DEMO_SCENARIOS` (modify).
- `docker-compose.yml` — `weaviate` service env knobs (modify).
- Tests: `demo_api_ui/src/components/education/__tests__/WeaviateRagPanel.test.js` (create), and an assertion added to a LearningHub/AgentDemoGuide test as described.

---

## Task 1: Register the `VECTOR_RAG` education id

**Files:**
- Modify: `demo_api_ui/src/components/education/educationIds.js`

**Interfaces:**
- Produces: `EDU.VECTOR_RAG === "vector-rag"` (used by Tasks 2–4).

- [ ] **Step 1: Read the current EDU map**

Run: `grep -n "GLEAN\|LANGCHAIN\|export const EDU" demo_api_ui/src/components/education/educationIds.js`
Confirm the shape is `KEY: "value",` entries inside an exported `EDU` object.

- [ ] **Step 2: Add the id**

Add this line alongside the other entries (e.g. right after the `GLEAN` line) in the `EDU` object:

```js
  VECTOR_RAG: "vector-rag",
```

- [ ] **Step 3: Verify it parses**

Run: `cd demo_api_ui && node -e "const p=require('@babel/core');" 2>/dev/null; grep -n "VECTOR_RAG" src/components/education/educationIds.js`
Expected: the new line prints.

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/components/education/educationIds.js
git commit -m "feat(edu): add VECTOR_RAG education id

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Create the WeaviateRagPanel education component

**Files:**
- Create: `demo_api_ui/src/components/education/WeaviateRagPanel.js`
- Test: `demo_api_ui/src/components/education/__tests__/WeaviateRagPanel.test.js`

**Interfaces:**
- Consumes: `EDU.VECTOR_RAG` (Task 1); shared `EducationDrawer` component.
- Produces: default export `WeaviateRagPanel` React component with tabs `what | here | flow | try` (registered in Task 3).

- [ ] **Step 1: Confirm the EducationDrawer tab API**

Run: `sed -n '1,40p' demo_api_ui/src/components/education/GleanPanel.js`
Note how `EducationDrawer` is imported and how tabs are passed (match this exact prop shape in the new panel — do not invent a new API).

- [ ] **Step 2: Write the failing render test**

Create `demo_api_ui/src/components/education/__tests__/WeaviateRagPanel.test.js`:

```jsx
import React from "react";
import { render, screen } from "@testing-library/react";
import WeaviateRagPanel from "../WeaviateRagPanel";

test("renders the Weaviate panel with accurate, repo-specific facts", () => {
  render(<WeaviateRagPanel />);
  // Concept
  expect(screen.getAllByText(/vector/i).length).toBeGreaterThan(0);
  // Repo-specific truth: BYO vectors + nomic embedder + internal-only
  expect(screen.getByText(/bring your own vectors/i)).toBeInTheDocument();
  expect(screen.getByText(/nomic-embed-text/i)).toBeInTheDocument();
  expect(screen.getByText(/CodeChunk/)).toBeInTheDocument();
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd demo_api_ui && CI=true npx vitest run src/components/education/__tests__/WeaviateRagPanel.test.js`
Expected: FAIL — cannot find module `../WeaviateRagPanel`.

- [ ] **Step 4: Implement the panel**

Create `demo_api_ui/src/components/education/WeaviateRagPanel.js`. Match the `EducationDrawer` usage from `GleanPanel.js` (Step 1). Tabs and content:

```jsx
// demo_api_ui/src/components/education/WeaviateRagPanel.js
import React from "react";
import EducationDrawer from "../shared/EducationDrawer";

function WhatTab() {
  return (
    <div>
      <h3 style={{ marginTop: 0 }}>What is a vector database?</h3>
      <p>
        A <strong>vector database</strong> stores each item alongside an{" "}
        <strong>embedding</strong> — a list of numbers that captures the item's
        meaning. Instead of matching exact keywords, it finds items whose vectors
        are <em>closest</em> in that meaning-space (approximate nearest-neighbor
        search, ANN). So a search for "auth logic" can surface code about{" "}
        <code>login</code>, <code>PKCE</code>, and <code>token</code> even when
        those exact words never appear in the query.
      </p>
      <p>
        <strong>Weaviate</strong> is the open-source vector database used in this
        demo. It stores vectors and does the nearest-neighbor search; it is the
        retrieval layer, not the model.
      </p>
    </div>
  );
}

function HereTab() {
  return (
    <div>
      <h3 style={{ marginTop: 0 }}>How it's wired in this demo</h3>
      <p>
        Weaviate here is the store behind the <strong>Code Search</strong> page
        (<code>/code-search</code>). It runs in <strong>bring your own vectors</strong>{" "}
        mode (<code>DEFAULT_VECTORIZER_MODULE: none</code>) — it does{" "}
        <strong>no embedding itself</strong>. Embeddings come from a separate
        llama.cpp service running <code>nomic-embed-text-v1.5</code>.
      </p>
      <pre className="edu-code">{`
  Code Search page  ──HTTP──▶  code-search service
                                  │  1. chunk files
                                  │  2. embed each chunk
                                  ▼        (nomic-embed-text-v1.5, 768-dim)
                              embeddings (llama.cpp)
                                  │
                                  ▼  3. store vectors
                              Weaviate  (class: CodeChunk, vectorizer: none)
                                  ▲
                                  └── 4. query: embed question, nearest-neighbor`}</pre>
      <ul>
        <li><strong>Internal-only:</strong> Weaviate publishes no host port; it is reachable only as <code>http://weaviate:8080</code> on the compose network.</li>
        <li><strong>One class, <code>CodeChunk</code>:</strong> every chunk carries its <code>codebase_id</code>, <code>file</code>, line range, and <code>snippet</code>; searches filter by <code>codebase_id</code>.</li>
        <li><strong>Bring your own vectors:</strong> the code-search service supplies the embeddings, so Weaviate needs no vectorizer module.</li>
      </ul>
    </div>
  );
}

function FlowTab() {
  return (
    <div>
      <h3 style={{ marginTop: 0 }}>Index &amp; search</h3>
      <h4>Indexing (<code>POST /index</code>)</h4>
      <ol>
        <li>Split each file into overlapping line windows (chunks).</li>
        <li>Embed every chunk with <code>nomic-embed-text-v1.5</code> → a 768-dim vector.</li>
        <li>Upsert each chunk + its vector into the <code>CodeChunk</code> class.</li>
      </ol>
      <h4>Searching (<code>POST /search</code>)</h4>
      <ol>
        <li>Embed the query with the <em>same</em> model (so it lands in the same space).</li>
        <li>Ask Weaviate for the nearest vectors (HNSW ANN), filtered by <code>codebase_id</code>.</li>
        <li>Return the matching chunks, ranked by similarity, with file + line range.</li>
      </ol>
      <p>
        Using the <em>same</em> embedding model for indexing and querying is not
        optional — mismatched models put the query in a different space and the
        results become meaningless.
      </p>
    </div>
  );
}

function TryTab() {
  return (
    <div>
      <h3 style={{ marginTop: 0 }}>Try it</h3>
      <p>
        Open the <strong>Code Search</strong> page to see this in action: upload
        or pick a codebase, then ask for something by meaning (e.g.{" "}
        <em>"find authentication logic"</em>) and watch semantically-related code
        come back even when the words differ.
      </p>
      <p>
        <a href="/code-search">Go to Code Search →</a>
      </p>
    </div>
  );
}

const TABS = [
  { id: "what", label: "What it is", render: () => <WhatTab /> },
  { id: "here", label: "How it's wired here", render: () => <HereTab /> },
  { id: "flow", label: "Index & search", render: () => <FlowTab /> },
  { id: "try", label: "Try it", render: () => <TryTab /> },
];

export default function WeaviateRagPanel(props) {
  return (
    <EducationDrawer
      title="Vector Search & RAG (Weaviate)"
      tabs={TABS}
      {...props}
    />
  );
}
```

> If `EducationDrawer` expects a different tab prop shape than `tabs`/`render` (check Step 1), adapt the `TABS` shape and the `EducationDrawer` props to match the existing panels exactly. The tab **content** above stays the same.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd demo_api_ui && CI=true npx vitest run src/components/education/__tests__/WeaviateRagPanel.test.js`
Expected: PASS. If it fails because `EducationDrawer` only renders the active tab, adjust the test to click through tabs (use the same query the other panel tests use) — keep the four factual assertions.

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/components/education/WeaviateRagPanel.js demo_api_ui/src/components/education/__tests__/WeaviateRagPanel.test.js
git commit -m "feat(edu): add Weaviate/vector-search education panel

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Register the panel in the education host

**Files:**
- Modify: `demo_api_ui/src/components/education/EducationPanelsHost.js`

**Interfaces:**
- Consumes: `WeaviateRagPanel` (Task 2), `EDU.VECTOR_RAG` (Task 1).
- Produces: `openEdu(EDU.VECTOR_RAG, ...)` now renders `WeaviateRagPanel` (used by Task 4).

- [ ] **Step 1: Add the import**

Near the other panel imports (alphabetical-ish, after `LlmLandscapePanel`), add:

```js
import WeaviateRagPanel from "./WeaviateRagPanel";
```

- [ ] **Step 2: Register in the id→panel map**

In the registry object (the `[EDU.X]: Panel,` block), add:

```js
  [EDU.VECTOR_RAG]: WeaviateRagPanel,
```

- [ ] **Step 3: Verify the wiring**

Run: `grep -n "VECTOR_RAG\|WeaviateRagPanel" demo_api_ui/src/components/education/EducationPanelsHost.js`
Expected: both the import and the registry entry print.

- [ ] **Step 4: Commit**

```bash
git add demo_api_ui/src/components/education/EducationPanelsHost.js
git commit -m "feat(edu): register WeaviateRagPanel in education host

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Add the Learning Hub card under "AI Ecosystem"

**Files:**
- Modify: `demo_api_ui/src/components/LearningHub.tsx`
- Test: add an assertion to the existing LearningHub test if one exists; otherwise create `demo_api_ui/src/components/__tests__/LearningHub.vectorrag.test.tsx`.

**Interfaces:**
- Consumes: `EDU.VECTOR_RAG` (Task 1), `openEdu` (existing).

- [ ] **Step 1: Write the failing test**

Create `demo_api_ui/src/components/__tests__/LearningHub.vectorrag.test.tsx` (adjust the mock imports to whatever the existing LearningHub tests use — check `grep -rl "LearningHub" demo_api_ui/src/**/__tests__ 2>/dev/null` first and mirror it):

```tsx
import React from "react";
import { render, screen } from "@testing-library/react";
import LearningHub from "../LearningHub";

vi.mock("../../context/EducationUIContext", () => ({
  useEducationUI: () => ({ open: vi.fn() }),
}));
vi.mock("../../context/DemoTourContext", () => ({
  useDemoTour: () => ({ start: vi.fn() }),
}));

test("Learning Hub lists the Weaviate vector-search card", () => {
  render(<LearningHub />);
  expect(
    screen.getByText(/Vector Search & RAG \(Weaviate\)/i)
  ).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd demo_api_ui && CI=true npx vitest run src/components/__tests__/LearningHub.vectorrag.test.tsx`
Expected: FAIL — card text not found.

- [ ] **Step 3: Add the card to the `ai-ecosystem` category**

In `LEARNING_CATEGORIES`, inside the object with `id: "ai-ecosystem"`, add to its `items` array:

```tsx
      {
        label: "Vector Search & RAG (Weaviate)",
        description: "How semantic code search stores and finds embeddings",
        icon: "🧬",
        action: () => {},
      },
```

- [ ] **Step 4: Wire the action**

In `categoryActionMap`, inside the `"ai-ecosystem": { ... }` object, add:

```tsx
      "Vector Search & RAG (Weaviate)": () => openEdu(EDU.VECTOR_RAG, "what"),
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd demo_api_ui && CI=true npx vitest run src/components/__tests__/LearningHub.vectorrag.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add demo_api_ui/src/components/LearningHub.tsx demo_api_ui/src/components/__tests__/LearningHub.vectorrag.test.tsx
git commit -m "feat(edu): add Vector Search & RAG card to Learning Hub

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Add the Code Search scenario to the Agent Demo Guide

**Files:**
- Modify: `demo_api_ui/src/components/AgentDemoGuide.jsx`
- Test: create `demo_api_ui/src/components/__tests__/AgentDemoGuide.codesearch.test.jsx`

**Interfaces:**
- Consumes: existing `DEMO_SCENARIOS` array and scenario object shape (`id`, `title`, `description`, `applicableSteps`, `steps[]` with `action`/`prompt`/`explanation`/`watch[]`).

- [ ] **Step 1: Confirm the current highest scenario number**

Run: `grep -n "title: \"1[0-9]\.\|title: \"[0-9]\." demo_api_ui/src/components/AgentDemoGuide.jsx | tail -3`
Expected: highest is "13." — so the new one is "14.". If it differs, use the next integer.

- [ ] **Step 2: Write the failing test**

Create `demo_api_ui/src/components/__tests__/AgentDemoGuide.codesearch.test.jsx`:

```jsx
import { DEMO_SCENARIOS } from "../AgentDemoGuide";

test("Agent Demo Guide includes a semantic code-search scenario", () => {
  const s = DEMO_SCENARIOS.find((x) => x.id === "code-search-rag");
  expect(s).toBeTruthy();
  // Honest compliance mapping: retrieval only exercises LLM intent reasoning.
  expect(s.applicableSteps).toEqual(["agent-llm-reasoning"]);
  // Multi-step walkthrough: index -> search -> interpret.
  expect(s.steps.length).toBe(3);
});
```

If `DEMO_SCENARIOS` is not currently exported, add `export ` to its declaration (`export const DEMO_SCENARIOS = [`) as part of this task — it is otherwise module-private.

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd demo_api_ui && CI=true npx vitest run src/components/__tests__/AgentDemoGuide.codesearch.test.jsx`
Expected: FAIL — either `DEMO_SCENARIOS` undefined (not exported) or scenario not found.

- [ ] **Step 4: Export the array (if needed) and add the scenario**

Ensure the array is exported: `export const DEMO_SCENARIOS = [`.

Add this object as the last element of `DEMO_SCENARIOS` (after the "13." scenario):

```jsx
  {
    id: "code-search-rag",
    title: "14. Semantic Code Search (RAG over Weaviate)",
    description:
      "A retrieval capability, not an authorization flow: the agent recognizes a 'find code' intent and uses semantic code search backed by Weaviate. No token exchange — it is an internal read-only tool.",
    applicableSteps: ["agent-llm-reasoning"],
    steps: [
      {
        action: "Open Code Search and index a codebase",
        prompt: 'Nav → "Code Search" (/code-search), then upload or pick a folder',
        explanation:
          "Each file is split into chunks; every chunk is embedded by the llama.cpp nomic-embed-text-v1.5 service and its 768-dim vector is stored in Weaviate's CodeChunk class (bring-your-own-vectors — Weaviate does no embedding itself).",
        watch: [
          "The codebase appears under 'Indexed Codebases'",
          "This demo's own source is available by default (no upload needed)",
        ],
      },
      {
        action: "Ask by meaning, not keywords",
        prompt: 'Select the codebase, enter e.g. "find authentication logic"',
        explanation:
          "The query is embedded with the SAME model, then Weaviate returns the nearest vectors (HNSW approximate nearest-neighbor), filtered by codebase_id. No exact keyword match is required.",
        watch: [
          "Results come back even when the exact words differ",
          "Semantic matches: 'auth logic' surfaces login / PKCE / token code",
        ],
      },
      {
        action: "Interpret the ranked results",
        prompt: "Read the returned chunks and their file:line ranges",
        explanation:
          "Ordering is by vector similarity (cosine over the nomic embedding space), which is why conceptually-related code ranks first. The same index also powers the 'Ask' agent, which retrieves these chunks to answer questions with citations.",
        watch: [
          "Each result shows file + line range for context",
          "Relevance ranking, not alphabetical / keyword-count",
        ],
      },
    ],
  },
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd demo_api_ui && CI=true npx vitest run src/components/__tests__/AgentDemoGuide.codesearch.test.jsx`
Expected: PASS.

- [ ] **Step 6: Sanity-check the guide still renders**

Run: `cd demo_api_ui && CI=true npx vitest run src/components/__tests__ -t "AgentDemoGuide" 2>/dev/null || echo "no existing AgentDemoGuide render test — skip"`
Expected: existing guide tests (if any) still pass; the compliance panel tolerates a single-step `applicableSteps` (scenario 1 already uses a partial subset).

- [ ] **Step 7: Commit**

```bash
git add demo_api_ui/src/components/AgentDemoGuide.jsx demo_api_ui/src/components/__tests__/AgentDemoGuide.codesearch.test.jsx
git commit -m "feat(guide): add semantic code-search scenario to Agent Demo Guide

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Make the Weaviate Raft/log cadence configurable (stop the join spam)

**Files:**
- Modify: `docker-compose.yml` (the `weaviate:` service, ~line 615)

**Interfaces:**
- No code interface. Config-only.

- [ ] **Step 1: Read the current weaviate service env**

Run: `sed -n '615,640p' docker-compose.yml`
Confirm the `environment:` block currently has `QUERY_DEFAULTS_LIMIT`, `AUTHENTICATION_APIKEY_ENABLED`, `PERSISTENCE_DATA_PATH`, `DEFAULT_VECTORIZER_MODULE`, `ENABLE_MODULES`.

- [ ] **Step 2: Add the single-node Raft identity + configurable cadence knobs**

In the `weaviate:` service `environment:` block, add these keys (values via `${VAR:-default}` so they are tunable from `.env` without editing the service). Keep the existing keys:

```yaml
      # ── Single-node Raft identity ─────────────────────────────────────────
      # Without a stable node identity, v1.25+ Raft never converges and logs
      # "attempting to join" once per second. These three pin a one-node cluster.
      CLUSTER_HOSTNAME: node1
      RAFT_JOIN: node1
      RAFT_BOOTSTRAP_EXPECT: 1
      # ── Configurable cadence / verbosity ──────────────────────────────────
      # LOG_LEVEL is the primary "how often do I see it" knob: `info` (default)
      # shows join/gossip chatter; `warning` keeps only warnings + errors.
      LOG_LEVEL: ${WEAVIATE_LOG_LEVEL:-warning}
```

Rationale confirmed against Weaviate docs: a founding single member uses `RAFT_JOIN=<hostname>` and `RAFT_BOOTSTRAP_EXPECT=1`; `CLUSTER_HOSTNAME` fixes the node name so restarts reuse the same Raft identity.

- [ ] **Step 3: Document the knob in `.env.example` if the project keeps one**

Run: `ls .env.example 2>/dev/null && grep -n "WEAVIATE" .env.example || echo "no .env.example — skip"`
If it exists, append:

```bash
# Weaviate log verbosity: info (default upstream) | warning | error
WEAVIATE_LOG_LEVEL=warning
```

- [ ] **Step 4: Persistence caution — decide on the data volume**

The `weaviate-data` volume may hold a Raft state dir under the *old* auto-generated node name. If, after Step 5, the container logs a Raft node-id mismatch or fails to become leader, the volume must be reset (it only holds re-indexable code-search vectors — nothing authoritative):

```bash
# ai-demo_ prefix, NOT ai-demo2_ — docker-compose.yml sets `name: ai-demo`, so
# Compose does not use the directory name. BOTH volumes exist on this machine
# (ai-demo2_weaviate-data is a pre-`name:` leftover), so the old command deleted
# the stale one, left the live data untouched, and looked like it had worked.
docker compose stop weaviate && docker volume rm ai-demo_weaviate-data
```

Do NOT run this unless the restart in Step 5 fails to converge. Call it out to the user before doing it.

- [ ] **Step 5: Verify the join spam stops**

Run:
```bash
docker compose up -d weaviate
sleep 20
docker logs ai-demo-weaviate --since 15s 2>&1 | grep -c "attempting to join" || true
docker logs ai-demo-weaviate --since 15s 2>&1 | tail -20
```
Expected: the `attempting to join` count is `0` (or a small one-time bootstrap burst that then stops), and the log shows a healthy leader state. Then confirm health:
```bash
docker exec ai-demo-weaviate wget -qO- http://localhost:8080/v1/meta | head -c 200
```
Expected: JSON `/v1/meta` (version 1.38.x).

- [ ] **Step 6: Verify the cadence is tunable**

Run: `WEAVIATE_LOG_LEVEL=info docker compose up -d weaviate && sleep 10 && docker logs ai-demo-weaviate --since 8s 2>&1 | wc -l`
Expected: noticeably more log lines than with `warning` — proving `LOG_LEVEL` controls verbosity. Then restore: `docker compose up -d weaviate` (uses the `warning` default).

- [ ] **Step 7: Commit**

```bash
git add docker-compose.yml .env.example 2>/dev/null; git add docker-compose.yml
git commit -m "fix(weaviate): pin single-node Raft identity + configurable log cadence

Stops the once-per-second 'attempting to join' spam (CLUSTER_HOSTNAME +
RAFT_JOIN=node1 + RAFT_BOOTSTRAP_EXPECT=1) and exposes LOG_LEVEL via
WEAVIATE_LOG_LEVEL so verbosity/cadence is tunable, not hard-silenced.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Full build + suite verification

**Files:** none (verification only).

- [ ] **Step 1: Run the touched test files**

Run:
```bash
cd demo_api_ui && CI=true npx vitest run \
  src/components/education/__tests__/WeaviateRagPanel.test.js \
  src/components/__tests__/LearningHub.vectorrag.test.tsx \
  src/components/__tests__/AgentDemoGuide.codesearch.test.jsx
```
Expected: all PASS.

- [ ] **Step 2: Type/compile check**

Run: `cd demo_api_ui && npx tsc --noEmit 2>&1 | grep -i "LearningHub\|VECTOR_RAG" || echo "no type errors in touched files"`
Expected: no errors referencing the touched files. (If the project has no `tsc` script, run `CI=true npm run build 2>&1 | tail -20` and confirm it compiles.)

- [ ] **Step 3: Confirm no unrelated files changed**

Run: `git status --porcelain`
Expected: only the files listed in this plan appear.

---

## Self-Review (completed by plan author)

- **Spec coverage:** Learning Hub page (Tasks 1–4), Agent Demo Guide scenario (Task 5), configurable log fix (Task 6) — all three spec sections covered. Verification criteria mapped in Task 7.
- **Placeholder scan:** no TBD/TODO; all code and commands are concrete. The one adapt-if-needed note (EducationDrawer tab prop shape) points to a concrete reference file to copy from, not a placeholder.
- **Type consistency:** `EDU.VECTOR_RAG` / `"vector-rag"`, panel default export `WeaviateRagPanel`, scenario id `"code-search-rag"`, and env keys are used identically across tasks.
