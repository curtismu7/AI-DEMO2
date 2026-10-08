# Muse & Friends as the User's Agent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the demo presenter's own agent — Muse, LibreChat, LM Studio, or ChatGPT — connect to the demo and run the demo steps as the user's real agent, in two lanes: the standard flow (agent → Agent Gateway → Authorize → tool) and an AI Gateway lane (agent → MCP facade `privilege-gateway` door → PingOne Privilege AI Gateway → tool). Muse acts, Ping governs — and the story generalizes to *any* agent the customer already has.

**Architecture:** The demo already has two external-agent entry points, and each maps to one lane:

- **Standard lane** — the MCP external door (`docs/EXTERNAL_DOOR_MCP_FLOW.md`): RFC 9728 discovery, OAuth 2.1 AS with DCR + CIMD, PKCE, PingGateway :3036 enforcement (token exchange, P1AZ decision, HITL, step-up). Any spec-compliant MCP client walks in unregistered.
- **AI Gateway lane** — the MCP facade's `privilege-gateway` door (`demo_api_server/routes/mcpFacade.js:240`): `/mcp-facade/privilege-gateway/<app>/mcp`. The client's OAuth (against the demo's durable broker) also establishes the BFF's server-side leg to the PingOne Privilege AI Gateway (`ownsUpstreamAuth` — the caller's bearer is replaced on the upstream hop; per-user policy enforced by the gateway). This is the proven LM Studio link (`docs/superpowers/specs/2026-09-11-lmstudio-privilege-gateway-link-design.md`), with the restart-durable client registry that door was built for.

Muse/LibreChat/LM Studio/ChatGPT are all spec-compliant MCP clients with remote-server + OAuth support, so both lanes are **verify + document + diagram**, not build. The demo steps gain new use cases (UC-MUSE1 standard lane, UC-MUSE2 AI Gateway lane) authored as use-case diagram configs — external agents do NOT prevent use-case registration (see "Use-case feasibility" below).

**Tech Stack:** Muse Code CLI (Meta, macOS: `curl -fsSL https://dev.meta.ai/install.sh | sh`), LibreChat (already in repo, `librechat/`), LM Studio (proven precedent), ChatGPT (connector MCP + OAuth), oauth-mcp external door (unchanged), MCP facade doors (unchanged), PingOne Privilege AI Gateway (SE/Privilege tenant, unchanged), demo_api_ui lesson catalog + use-case diagram configs (existing patterns).

**Spec:** the agreed in-chat design in this session (2026-10-08), extended by the user on the same day: all agents run two use cases (standard flow + AI Gateway); detailed diagrams in the docs; demo-step use cases where feasible. Companion reading: `docs/EXTERNAL_DOOR_MCP_FLOW.md`, `docs/superpowers/specs/2026-09-11-lmstudio-privilege-gateway-link-design.md`, `docs/use-case-diagram-standards.md`.

## Use-case feasibility (the "does the external agent prevent this?" question)

**No — with one structural note.** A use-case diagram config is presentation-layer: `{ id, NODES, EDGES, walk }` in `demo_api_ui/src/config/useCaseDiagrams/`, registered in `index.js`, driven by the drift test. Nothing in that contract requires the agent to run *inside* the web UI. What the drift test DOES require (`useCaseDiagrams.drift.test.js:27-31`) is that every authored config has an entry in `DEMO_STEP_GUIDES` and a presenter number — i.e., it must be a *demo step*, not just a diagram.

So the external agents become demo steps by adding UC ids to `DEMO_PRIMARY_USE_CASE_IDS` (`demoUseCaseSteps.js`) with `kind: 'agent'` destinations that **instruct the presenter to act in the external client** (like UC46's "opens page" pattern, but for an external surface): the step card says "Run this in Muse / LM Studio / ChatGPT per the runbook," while the reel walks the wire-level flow (discovery → DCR → PKCE → exchange → gateway → Authorize → tool). The audience watches the token chain on the dashboard while the agent acts on the presenter's machine — exactly the story.

## Global Constraints

- This plan does **not** modify `oauth-mcp`, `ping-gateway`, `mcpFacade.js` doors, token exchange, sessions, or authorization. Read-only verification of those services only.
- `demo_api_server/config/auth-requirements.json` is generated — the plan touches it only through the package script `npm run authz:verify` if topology/auth routes change; never hand-edit (AGENTS.md rule).
- UI changes require `cd demo_api_ui && npm run build` to pass; preserve the project emoji allowlist.
- The canonical local browser origin is `local.ping-devops.com:4000`; no hardcoded `localhost` OAuth redirects.
- Deployment policy: local Docker only. The Privilege AI Gateway lane additionally requires the Privilege tenant wiring (SE cluster credentials); locally it degrades to the facade's local broker with the gateway leg unconfigured — the runbook says which lane runs where.
- Diagram configs follow `docs/use-case-diagram-standards.md` exactly: palette groups only, x-grid 40/340/640/940/1240, walk covers every edge exactly once, `tech[]` tags only `API|TOKEN|A2A|POLICY`, `c ≤ 90` chars.
- Node >= 22 for Node services; run `npm ci` in a service before testing it.
- Muse is the presenter's install (Meta build); LibreChat ships in-repo; LM Studio and ChatGPT are presenter-side installs. We never pin any of them in the repo.

## Review Focus

1. **Muse's OAuth discovery URL shape** — Muse must construct `/.well-known/oauth-protected-resource/mcp` (path-inserted, per RFC 9728 §3.1), not the bare document. The door's bug history shows clients getting this wrong die in discovery. Expect: a failed discovery is client-side misconfiguration, not a door defect — Task 1's verification log pins it per client.
2. **Per-client OAuth quirks** — LM Studio historically fell back to SSE on any non-`UnauthorizedError` (the facade's deliberate 405); ChatGPT connectors require a publicly-reachable URL (local demo needs the SE host or a tunnel); Muse/LibreChat are expected clean. Expect: the verification matrix (Task 1) records what each client actually sends — discovery URL, auth method, redirect shape — so demos aren't surprises.
3. **AI Gateway lane restart durability** — the `privilege-gateway` door's client registers with the durable demo broker, but the BFF's upstream gateway leg is session-held (`privilegeGatewaySession`); a BFF recreate mid-demo drops it. Expect: the runbook's failure playbook includes "re-authenticate the door" as the first response, and the verification matrix proves re-auth works without touching client config (the door's design goal).
4. **HITL visibility in both lanes** — when an agent's tool call triggers human approval, the approval surfaces in the demo web UI, not in the agent's terminal. Expect: the runbook tells the presenter to keep the dashboard open; the training page calls this out ("the agent pauses; the human approves elsewhere"). Standard lane: HITL via PingGateway/P1AZ. AI Gateway lane: policy denial surfaces as the gateway's own decision — verify which and record it.
5. **Diagram drift ratchet** — new UC ids in `DEMO_PRIMARY_USE_CASE_IDS` without authored configs fail `useCaseDiagrams.drift.test.js` (PENDING is empty and live). Expect: config + guides entry + diagram land in the same task; the ratchet test is the gate.

---

### Task 1: Verify both doors accept each client (no code; evidence recorded)

**Files:**
- Create: `docs/superpowers/plans/2026-10-08-agent-doors-verification.md` (verification matrix only)

**Interfaces:**
- Consumes: running local stack (`./run-docker.sh`), Muse CLI installed (`muse --version`), LM Studio installed, ChatGPT Plus/Team (connector support), LibreChat running from `librechat/`.
- Produces: a filled verification matrix proving/disproving door↔client compatibility per lane. Tasks 2–5 assume success here; if a cell fails, stop and file the gap for that cell only.

The matrix — every cell gets a row in the log:

| Client | Standard lane (external door :3036) | AI Gateway lane (facade `privilege-gateway` door) |
|---|---|---|
| Muse | connect + read + governed write | connect + read |
| LM Studio | connect + read | connect + read (proven 2026-09-11; re-verify) |
| LibreChat | connect + read | connect + read |
| ChatGPT | connect + read (needs reachable host — record what works locally vs SE) | connect + read |

- [ ] **Step 1: Start the local stack**

Run: `./run-docker.sh` (repo root; OrbStack context — never Docker Desktop)
Expected: core services up; `https://api.ping.demo:3036/mcp` and `http://localhost:3001/mcp-facade/privilege-gateway/mcp` reachable.

- [ ] **Step 2: Confirm both doors' discovery documents**

```bash
curl -s https://api.ping.demo:3036/.well-known/oauth-protected-resource/mcp | head -20
curl -s https://api.ping.demo:3036/.well-known/oauth-authorization-server | head -20
curl -s http://localhost:3001/mcp-facade/privilege-gateway/mcp -X POST \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}' | head -20
```
Expected: external door returns the RFC 9728 + RFC 8414 documents from `EXTERNAL_DOOR_MCP_FLOW.md`; the facade door answers `initialize` and its 401 carries the facade's challenge.

- [ ] **Step 3: Configure each client, both lanes**

Standard lane (same config for every client — it's their native remote-MCP URL field):
`https://api.ping.demo:3036/mcp` (Muse `mcp_servers` block with `transport: "streamable_http"`, `mode: "optional"`; LM Studio/LibreChat/ChatGPT: their remote-MCP connector UI).

AI Gateway lane: `http://localhost:3001/mcp-facade/privilege-gateway/mcp` (or `https://local.ping-devops.com:4000/mcp-facade/privilege-gateway/mcp` for TLS-strict clients — record which works per client).

- [ ] **Step 4: Connect + OAuth per client, per lane; record the wire behavior**

For each client: complete its OAuth flow, then run one read tool (`list accounts`). Record in the matrix: discovery URL constructed, DCR body fields, token-endpoint auth method, redirect URI shape, any SSE-vs-streamable fallback, error text on failure.

- [ ] **Step 5: Standard lane governed write (Muse only)**

In Muse, run a funds transfer. Expected: P1AZ evaluates → HITL pending surfaces on the dashboard → approve → tool runs. (Read-path verification suffices for the other three clients; Muse demonstrates the full governance story.)

- [ ] **Step 6: Record results**

Write `docs/superpowers/plans/2026-10-08-agent-doors-verification.md`: filled matrix + per-cell notes (what each client sent, what broke, what the runbook must warn about).
If any cell failed: **stop that cell**; the gap becomes a new investigation — do not patch either door in this plan.

- [ ] **Step 7: Commit the verification log**

```bash
git add docs/superpowers/plans/2026-10-08-agent-doors-verification.md
git commit -m "docs: record agent-doors verification matrix (Muse/LM Studio/LibreChat/ChatGPT)"
```

### Task 2: Use-case diagrams + demo steps for the two lanes (UC-MUSE1, UC-MUSE2)

**Files:**
- Create: `demo_api_ui/src/config/useCaseDiagrams/UC-MUSE1.js` (standard lane)
- Create: `demo_api_ui/src/config/useCaseDiagrams/UC-MUSE2.js` (AI Gateway lane)
- Create: `demo_api_ui/src/config/useCaseDiagrams/__tests__/UC-MUSE1.test.js`
- Create: `demo_api_ui/src/config/useCaseDiagrams/__tests__/UC-MUSE2.test.js`
- Modify: `demo_api_ui/src/config/useCaseDiagrams/index.js` (register both)
- Modify: `demo_api_ui/src/config/demoUseCaseSteps.js` (add ids + destinations)
- Modify: `demo_api_ui/src/config/demoStepGuides.js` (guide data — the drift test requires it)

**Interfaces:**
- Consumes: `PARTICIPANT_GROUPS` from `palette.js`; `validateConfig` contract from `docs/use-case-diagram-standards.md`; `DEMO_PRIMARY_USE_CASE_IDS`, `DEMO_STEP_DESTINATIONS`, `DEMO_STEP_GUIDES`, `demoStepNumber` shapes.
- Produces: `getConfig('UC-MUSE1')` / `getConfig('UC-MUSE2')` returning valid configs; two new presenter demo steps. Task 3's training page links these diagram routes (`useCaseDiagramPath('UC-MUSE1')`).

- [ ] **Step 1: Write the failing config tests** (mirror `UC6.test.js` shape)

`demo_api_ui/src/config/useCaseDiagrams/__tests__/UC-MUSE1.test.js`:

```js
import { describe, expect, it } from "vitest";
import UC_MUSE1 from "../UC-MUSE1";
import { validateConfig } from "../validate";
import { PARTICIPANT_GROUPS } from "../palette";

describe("UC-MUSE1 config", () => {
  it("passes structural validation", () => {
    expect(validateConfig(UC_MUSE1).errors).toEqual([]);
  });
  it("uses only shared palette groups", () => {
    for (const n of UC_MUSE1.NODES) expect(PARTICIPANT_GROUPS[n.group]).toBeTruthy();
  });
  it("walk covers every edge exactly once", () => {
    const flat = UC_MUSE1.walk.flatMap((w) => w.edges);
    expect(new Set(flat).size).toBe(flat.length);
    expect(new Set(flat).size).toBe(UC_MUSE1.EDGES.length);
  });
});
```

Create `UC-MUSE2.test.js` identically, importing `UC-MUSE2`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd demo_api_ui && npx vitest run src/config/useCaseDiagrams/__tests__/UC-MUSE1.test.js src/config/useCaseDiagrams/__tests__/UC-MUSE2.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Author UC-MUSE1 (standard lane diagram)**

`demo_api_ui/src/config/useCaseDiagrams/UC-MUSE1.js` — the standard flow: agent → external door → PingGateway → Authorize → tool:

```js
/**
 * UC-MUSE1 — External agent (Muse et al.) standard lane. The user's own
 * agent discovers the door (RFC 9728), self-registers (DCR), logs in (PKCE),
 * and calls tools through PingGateway with a delegated token — sub=user,
 * act=agent on every hop. The agent runs on the user's machine; governance
 * is entirely Ping.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "user", group: "user", label: "Alice (user)", sub: ["owns the agent"], x: 40, y: 150, detail: "Runs Muse on her machine and asks it for her balance — the agent is hers, not the bank's." },
  { id: "agent", group: "external", label: "Muse agent", sub: ["user's machine"], x: 340, y: 150, detail: "Any spec-compliant MCP client. Discovers the door, self-registers, holds no keys of its own." },
  { id: "door", group: "gateway", label: "MCP door", sub: ["RFC 9728 + DCR"], x: 640, y: 150, detail: "PingGateway external door: discovery, DCR, PKCE login, then enforcement on every /mcp call." },
  { id: "p1", group: "pingone", label: "PingOne", sub: ["exchange + policy"], x: 940, y: 150, detail: "Mints the delegated token (sub=alice, act=muse client) and evaluates policy (P1AZ) per tool call." },
  { id: "tool", group: "resource", label: "Bank tools", sub: ["behind the gateway"], x: 1240, y: 150, detail: "Tools execute only after the gateway's P1AZ decision; every hop is audited." },
];

const EDGES = [
  ["user", "agent", "asks for balance", { detail: "Natural language in Muse; the agent picks the tool." }],
  ["agent", "door", "discovers + registers", { detail: "RFC 9728 metadata -> RFC 7591 DCR -> PKCE login in Alice's browser." }],
  ["door", "p1", "exchange + decide", { detail: "RFC 8693 mints sub=alice, act=muse; P1AZ evaluates the call." }],
  ["p1", "tool", "PERMIT + dispatch", { detail: "Delegated token stamped on the call; the tool runs." }],
  ["tool", "user", "answer", { detail: "Balance lands in Muse; the chain is on the record." }],
];

const walk = [
  {
    title: "The user's agent asks", label: "Muse on Alice's Mac",
    nodes: ["user", "agent"], edges: [0],
    lines: [{ who: "Alice", text: "Show my checking balance — asked in Muse, not the bank's app." }],
    tech: [{ t: "API", c: "Muse -> POST /mcp tools/call get_banking_account" }],
  },
  {
    title: "Door onboarding", label: "Discover, register, log in",
    nodes: ["agent", "door"], edges: [1],
    lines: [{ who: "Door", text: "Never seen this client. RFC 9728 tells it where to register; DCR takes it from there." }],
    tech: [
      { t: "API", c: "GET /.well-known/oauth-protected-resource/mcp -> authorization_servers" },
      { t: "API", c: "POST /register (RFC 7591 DCR) -> client_id issued" },
      { t: "POLICY", c: "PKCE authorization code + browser login (no pre-registration)" },
    ],
  },
  {
    title: "Authority minted", label: "sub=alice, act=muse",
    nodes: ["door", "p1"], edges: [2],
    lines: [{ who: "PingOne", text: "The agent never holds Alice's password or a long-lived key — authority is minted per call." }],
    tech: [
      { t: "TOKEN", c: "RFC 8693 exchange -> AT: sub=alice, act={sub:muse-client}" },
      { t: "POLICY", c: "P1AZ decision: PERMIT (scope accounts:read)" },
    ],
  },
  {
    title: "Tool runs", label: "Behind the gateway",
    nodes: ["p1", "tool"], edges: [3],
    lines: [{ who: "Gateway", text: "Every hop audited: who, which agent, which tool, decision." }],
    tech: [{ t: "API", c: "gateway -> tool dispatch with delegated AT (aud=mcp-gw)" }],
  },
  {
    title: "Answer on the record", label: "Chain visible",
    nodes: ["tool", "user"], edges: [4],
    lines: [{ who: "Presenter", text: "Same governance as our own agent — because the trust layer never cared whose agent it was." }],
    tech: [{ t: "POLICY", c: "audit: sub=alice act=muse tool=get_banking_account decision=PERMIT" }],
  },
];

export default {
  id: "UC-MUSE1",
  result: { label: "PERMIT", tone: "ok" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
```

- [ ] **Step 4: Author UC-MUSE2 (AI Gateway lane diagram)**

`demo_api_ui/src/config/useCaseDiagrams/UC-MUSE2.js` — same actor, second lane via the facade's `privilege-gateway` door:

```js
/**
 * UC-MUSE2 — External agent, AI Gateway lane. The same agent connects to the
 * facade's privilege-gateway door: OAuth against the durable demo broker
 * doubles as the sign-in that establishes the BFF's server-side leg to the
 * PingOne Privilege AI Gateway (ownsUpstreamAuth swaps the bearer on the
 * upstream hop). Per-user policy is enforced by the AI Gateway.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "user", group: "user", label: "Alice (user)", sub: ["signs in once"], x: 40, y: 150, detail: "Her OAuth sign-in is what establishes the gateway leg — one login, both sides." },
  { id: "agent", group: "external", label: "Muse agent", sub: ["user's machine"], x: 340, y: 150, detail: "Same agent, different door: the facade's privilege-gateway MCP endpoint." },
  { id: "facade", group: "gateway", label: "MCP facade", sub: ["durable broker"], x: 640, y: 150, detail: "Registers the client durably and holds the upstream gateway leg server-side — client config survives gateway restarts." },
  { id: "aigw", group: "pingone", label: "AI Gateway", sub: ["Privilege"], x: 940, y: 150, detail: "PingOne Privilege AI Gateway: per-user policy on the upstream call; the caller's bearer is replaced." },
  { id: "tool", group: "resource", label: "Registered app", sub: ["Agentic App"], x: 1240, y: 150, detail: "The app registered in Privilege (e.g. banking MCP server) serves the tools." },
];

const EDGES = [
  ["user", "agent", "same ask, lane 2", { detail: "Same natural-language request; the presenter points the agent at the other door." }],
  ["agent", "facade", "OAuth + connect", { detail: "DCR against the demo broker; the sign-in also establishes the gateway leg." }],
  ["facade", "aigw", "call with own credential", { detail: "ownsUpstreamAuth: the caller's bearer is swapped for the operator's gateway token." }],
  ["aigw", "tool", "per-user policy", { detail: "Privilege evaluates the human's policy, not a service identity, then dispatches." }],
  ["tool", "user", "answer", { detail: "Result returns through the facade to Muse." }],
];

const walk = [
  {
    title: "Same agent, other door", label: "Lane 2",
    nodes: ["user", "agent"], edges: [0],
    lines: [{ who: "Alice", text: "Same request — what changes is which Ping product stands in front." }],
    tech: [{ t: "API", c: "Muse -> POST /mcp-facade/privilege-gateway/mcp tools/call" }],
  },
  {
    title: "Durable onboarding", label: "Broker + gateway leg",
    nodes: ["agent", "facade"], edges: [1],
    lines: [{ who: "Facade", text: "The client registers with our broker — restart-proof — and the sign-in raises the upstream leg." }],
    tech: [
      { t: "API", c: "POST /register -> durable client_id (survives gateway restart)" },
      { t: "POLICY", c: "sign-in establishes privilegeGatewaySession (server-side)" },
    ],
  },
  {
    title: "Credential swap", label: "ownsUpstreamAuth",
    nodes: ["facade", "aigw"], edges: [2],
    lines: [{ who: "Facade", text: "Anonymous traffic never rides the operator's session — the bearer is replaced on the way up." }],
    tech: [{ t: "TOKEN", c: "caller bearer -> operator gateway token (upstream hop only)" }],
  },
  {
    title: "Per-user policy", label: "Privilege decides",
    nodes: ["aigw", "tool"], edges: [3],
    lines: [{ who: "AI Gateway", text: "Policy evaluates the human who signed in — identity travels, not just a service credential." }],
    tech: [{ t: "POLICY", c: "Privilege per-user policy -> dispatch to registered Agentic App" }],
  },
  {
    title: "Answer", label: "Back to Muse",
    nodes: ["tool", "user"], edges: [4],
    lines: [{ who: "Presenter", text: "Two doors, one story: whichever Ping gateway you run, the external agent is governed." }],
    tech: [{ t: "API", c: "facade -> Muse (tool result)" }],
  },
];

export default {
  id: "UC-MUSE2",
  result: { label: "PERMIT", tone: "ok" },
  GROUPS: G,
  NODES,
  EDGES,
  walk,
};
```

- [ ] **Step 5: Run config tests to verify they pass**

Run: `cd demo_api_ui && npx vitest run src/config/useCaseDiagrams/__tests__/UC-MUSE1.test.js src/config/useCaseDiagrams/__tests__/UC-MUSE2.test.js`
Expected: PASS.

- [ ] **Step 6: Register configs + demo steps + guides**

`demo_api_ui/src/config/useCaseDiagrams/index.js` — add:

```js
import UC_MUSE1 from "./UC-MUSE1";
import UC_MUSE2 from "./UC-MUSE2";
```
and append both to `CONFIGS`.

`demo_api_ui/src/config/demoUseCaseSteps.js` — append to `DEMO_PRIMARY_USE_CASE_IDS`:

```js
  'UC-MUSE1', // External agent standard lane — user's agent -> door -> gateway -> Authorize
  'UC-MUSE2', // External agent AI Gateway lane — user's agent -> facade -> Privilege AI Gateway
```
and add destinations:

```js
  UC_MUSE1: {
    kind: 'agent',
    label: 'Runs in your agent',
    title: 'Runs in YOUR agent (Muse/LM Studio/LibreChat/ChatGPT) — follow docs/MUSE_RUNBOOK.md; the reel here walks the wire. Keep the dashboard open: the token chain shows there.',
  },
  UC_MUSE2: {
    kind: 'agent',
    label: 'Runs in your agent',
    title: 'Same agent, AI Gateway lane: point it at /mcp-facade/privilege-gateway/mcp per docs/MUSE_RUNBOOK.md. The reel walks the credential-swap hop.',
  },
```
Note: match the exact export shape used by the existing `DEMO_STEP_DESTINATIONS` entries (UC46/UC46A) — key style there is the bare UC id (`UC46:`); use `UC-MUSE1:` / `UC-MUSE2:` quoted keys for these hyphenated ids.

`demo_api_ui/src/config/demoStepGuides.js` — add `UC-MUSE1` / `UC-MUSE2` entries mirroring an existing external-agent guide (title, description, business value; the diagram page imports these). Keep titles ≤ a sentence, e.g. `"Your agent, our gateway"` and `"Your agent, the AI Gateway"`.

- [ ] **Step 7: Run the drift ratchet**

Run: `cd demo_api_ui && npx vitest run src/config/useCaseDiagrams/__tests__/useCaseDiagrams.drift.test.js`
Expected: PASS — every primary UC authored (PENDING stays empty; never widen it).

- [ ] **Step 8: Build + full diagram tests**

Run: `cd demo_api_ui && npm run test:unit -- src/config/useCaseDiagrams && npm run build`
Expected: diagram suites green; build exit 0.

- [ ] **Step 9: Commit**

```bash
git add demo_api_ui/src/config/useCaseDiagrams/UC-MUSE1.js \
        demo_api_ui/src/config/useCaseDiagrams/UC-MUSE2.js \
        demo_api_ui/src/config/useCaseDiagrams/__tests__/UC-MUSE1.test.js \
        demo_api_ui/src/config/useCaseDiagrams/__tests__/UC-MUSE2.test.js \
        demo_api_ui/src/config/useCaseDiagrams/index.js \
        demo_api_ui/src/config/demoUseCaseSteps.js demo_api_ui/src/config/demoStepGuides.js
git commit -m "feat: UC-MUSE1/MUSE2 external-agent lanes as demo steps + diagrams"
```

### Task 3: Learning-hub training page (route + lesson catalog entry)

**Files:**
- Create: `demo_api_ui/src/pages/MuseAgentLessonPage.jsx` (+ `.css` if styling diverges from an existing lesson page's stylesheet pattern)
- Modify: `demo_api_ui/src/App.js` (route registration, near the other `*-learning` routes at `App.js:863-896`)
- Modify: `demo_api_ui/src/learning/lessonCatalog.js` (new lesson entry)
- Modify: `demo_api_server/config/auth-requirements.json` — only if the route is non-public; the sibling pattern (`/personal-agent`, `/learning`) is `"public"`, so most likely no change. Check, don't assume.
- Test: `demo_api_ui/src/pages/__tests__/MuseAgentLessonPage.test.jsx`

**Interfaces:**
- Consumes: `lessonCatalog` conventions (`lesson()` factory, `MATURITY_STAGES`, `PROVENANCE`, `REDACTED_RESULT`), `AppShell` routing pattern.
- Produces: route `/muse-agent-learning`; lesson id `"muse-agent"` resolvable by `getLesson("muse-agent")`.

- [ ] **Step 1: Write the failing test**

```jsx
import { render, screen } from '@testing-library/react';
import MuseAgentLessonPage from '../MuseAgentLessonPage';
import { lessonCatalog, getLesson } from '../../learning/lessonCatalog';

describe('MuseAgentLessonPage', () => {
  it('registers the muse-agent lesson in the catalog', () => {
    const entry = getLesson('muse-agent');
    expect(entry).toBeTruthy();
    expect(entry.title).toContain('Muse');
    expect(entry.route).toBe('/muse-agent-learning');
  });

  it('renders the connection walkthrough', () => {
    render(<MuseAgentLessonPage />);
    expect(screen.getByText(/api\.ping\.demo:3036\/mcp/)).toBeInTheDocument();
    expect(screen.getByText(/privilege-gateway/i)).toBeInTheDocument();
  });

  it('renders the governance teaching points', () => {
    render(<MuseAgentLessonPage />);
    expect(screen.getByText(/token exchange/i)).toBeInTheDocument();
    expect(screen.getByText(/human approval/i)).toBeInTheDocument();
  });

  it('links both lane diagrams', () => {
    render(<MuseAgentLessonPage />);
    expect(screen.getByRole('link', { name: /standard lane \(UC-MUSE1\)/i })).toHaveAttribute('href', '/use-case-diagrams/UC-MUSE1');
    expect(screen.getByRole('link', { name: /AI Gateway lane \(UC-MUSE2\)/i })).toHaveAttribute('href', '/use-case-diagrams/UC-MUSE2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/MuseAgentLessonPage.test.jsx`
Expected: FAIL — module not found.

- [ ] TDD note: the catalog entry and page go in the same task because the test asserts both together; the catalog entry alone would leave the route dead and the page alone would leave `getLesson` undefined.

- [ ] **Step 3: Add the lesson catalog entry**

In `demo_api_ui/src/learning/lessonCatalog.js`, add inside `lessonCatalog` (after the `consumer-agent` entry):

```js
  lesson({
    id: "muse-agent",
    title: "Muse as the user's agent",
    audience: "Sales engineers and customer architects",
    category: "Personal Agents",
    route: "/muse-agent-learning",
    standaloneRoute: "/muse-agent-learning",
    run: { action: "mcp-discovery", exposesRawBearerToken: false, result: REDACTED_RESULT },
    evidence: { events: ["agent-detection", "client-metadata", "consent", "tool-authentication"], result: REDACTED_RESULT },
    fallback: { provenance: PROVENANCE.SIMULATED, label: "Simulated external-agent connection" },
    maturityStages: [MATURITY_STAGES.DISCOVER, MATURITY_STAGES.REGISTER, MATURITY_STAGES.AUTHENTICATE, MATURITY_STAGES.AUTHORIZE],
    agentCategory: "Consumer & Partner Agent",
    productRoles: ["PingOne", "Agent Gateway / Broker", "Agent Authorize"],
    talkingPoints: [
      "The user's own agent — Muse, LM Studio, LibreChat, ChatGPT — connects to the bank's MCP endpoint; Ping governs every hop.",
      "Two lanes, one trust layer: the Agent Gateway door (RFC 8693 chain, P1AZ, HITL) or the Privilege AI Gateway door (per-user policy, credential swap).",
      "RFC 9728 discovery, DCR, PKCE login: any spec-compliant agent can onboard without pre-registration.",
      "The agent pauses for human approval on sensitive actions; approval happens in the bank's surfaces, not the agent's.",
    ],
  }),
```

- [ ] **Step 4: Create the lesson page**

`demo_api_ui/src/pages/MuseAgentLessonPage.jsx`:

```jsx
import React from 'react';
import { getLesson } from '../learning/lessonCatalog';
import { useCaseDiagramPath } from '../config/useCaseDiagrams';
import './AgentGatewayAuthorizationLessonPage.css'; // reuse existing lesson-page styling

const STEPS = [
  {
    title: '1. The story',
    body: 'You already have an agent — Muse, LM Studio, LibreChat, or ChatGPT. Point it at the bank’s MCP endpoint and watch Ping govern it: discovery, registration, login, token exchange, policy, human-in-the-loop, audit. The agent is yours; the trust layer is entirely Ping.',
  },
  {
    title: '2. Point the agent at the bank (standard lane)',
    body: 'Any client’s remote-MCP field: https://api.ping.demo:3036/mcp. First tool use triggers OAuth: the RFC 9728 challenge names the authorization server, the client self-registers via DCR, your browser opens for the PingOne login, the callback lands on 127.0.0.1.',
  },
  {
    title: '3. Read path: token chain',
    body: 'Account lookup → gateway validates the token minted by RFC 8693 exchange (sub: user, act: agent client id). Visible in the dashboard token-chain panel.',
  },
  {
    title: '4. Governed path: HITL',
    body: 'Funds transfer → PingOne Authorize requires human approval. The agent pauses; you approve in the bank’s dashboard — the trust boundary is Ping, not the agent.',
  },
  {
    title: '5. Second lane: the AI Gateway',
    body: 'Same agent, different door: /mcp-facade/privilege-gateway/mcp. Your OAuth sign-in doubles as the gateway-leg sign-in; the facade swaps credentials on the upstream hop and the PingOne Privilege AI Gateway enforces per-user policy.',
  },
  {
    title: '6. Audit: every hop recorded',
    body: 'Gateway audit trail shows each call: who (sub), what agent (act), which tool, decision, correlation id — in both lanes.',
  },
];

export default function MuseAgentLessonPage() {
  const lesson = getLesson('muse-agent');
  return (
    <div className="lesson-page">
      <h1>{lesson ? lesson.title : "Muse as the user's agent"}</h1>
      <p className="lesson-audience">
        {lesson ? lesson.audience : 'Sales engineers and customer architects'}
      </p>
      <p>
        The demo story: <strong>you already have an agent</strong>. Point it at the
        bank&apos;s MCP endpoint and watch Ping govern it — discovery, registration,
        login, token exchange, policy, human-in-the-loop, audit. The agent is
        yours (Muse, LM Studio, LibreChat, ChatGPT); the trust layer is entirely Ping.
      </p>
      <p>
        Walk the wire:{' '}
        <a href={useCaseDiagramPath('UC-MUSE1')}>standard lane (UC-MUSE1)</a>
        {' · '}
        <a href={useCaseDiagramPath('UC-MUSE2')}>AI Gateway lane (UC-MUSE2)</a>
      </p>
      <ol className="lesson-steps">
        {STEPS.map((s) => (
          <li key={s.title}>
            <h2>{s.title}</h2>
            <p>{s.body}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
```

- [ ] **Step 5: Register the route**

In `demo_api_ui/src/App.js`, near the other learning routes (~line 882):

```jsx
<Route
  path="/muse-agent-learning"
  element={
    <AppShell user={user} logout={logout}>
      <MuseAgentLessonPage />
    </AppShell>
  }
/>
```

plus the import near `App.js:234`:

```js
import MuseAgentLessonPage from './pages/MuseAgentLessonPage';
```

- [ ] **Step 6: Check auth-requirements for the new route**

Run: `cd demo_api_server && node -e "const r=require('./config/auth-requirements.json'); console.log(JSON.stringify(Object.entries(r).find(([k])=>JSON.stringify(k).includes('muse-agent-learning'))))"`
Expected: no entry (check how siblings get picked up) — if `npm run authz:verify` fails after adding the route, run the package script that regenerates `auth-requirements.json` and add `/muse-agent-learning: "public"` per the sibling pattern, then re-verify.

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/MuseAgentLessonPage.test.jsx`
Expected: PASS.

- [ ] **Step 8: Build and full unit suite**

Run: `cd demo_api_ui && npm run build && npm run test:unit`
Expected: build exit 0; full UI unit suite green.

- [ ] **Step 9: Commit**

```bash
git add demo_api_ui/src/pages/MuseAgentLessonPage.jsx \
        demo_api_ui/src/pages/__tests__/MuseAgentLessonPage.test.jsx \
        demo_api_ui/src/App.js demo_api_ui/src/learning/lessonCatalog.js
git commit -m "feat: Muse user-agent lesson page in learning hub"
```

### Task 4: Runbook (all four agents, both lanes) and drift guard

**Files:**
- Create: `docs/MUSE_RUNBOOK.md` (covers Muse, LM Studio, LibreChat, ChatGPT; both lanes)
- Modify: `demo_api_ui/src/pages/__tests__/MuseAgentLessonPage.test.jsx` (add drift-guard test)

**Interfaces:**
- Consumes: Task 1's verification matrix (actual per-client behaviors), Task 2's UC-MUSE ids and diagram routes, Task 3's lesson entry.
- Produces: presenter runbook; a test pinning the runbook's URLs to the lesson-page copy so they can't drift apart.

- [ ] **Step 1: Write the runbook** — `docs/MUSE_RUNBOOK.md`:

````markdown
# External-agent demo runbook — Muse, LM Studio, LibreChat, ChatGPT

**Story:** "You already have an agent. Point it at our bank's MCP endpoint.
Watch Ping govern it." The agent is the presenter's own install; every
governance surface is ours. Two lanes, same agent:

- **Standard lane** — agent → external door (:3036) → PingGateway → PingOne Authorize → tool
- **AI Gateway lane** — agent → facade `privilege-gateway` door → PingOne Privilege AI Gateway → registered app

## The two doors

| Lane | URL (any MCP client's remote-server field) | Governed by |
|---|---|---|
| Standard | `https://api.ping.demo:3036/mcp` | PingGateway + PingOne Authorize (RFC 8693 chain, P1AZ, HITL, step-up) |
| AI Gateway | `http://localhost:3001/mcp-facade/privilege-gateway/mcp` (TLS-strict clients: `https://local.ping-devops.com:4000/mcp-facade/privilege-gateway/mcp`) | PingOne Privilege AI Gateway (per-user policy; credential swapped at the facade) |

## Before the demo (once)

1. Stack up: `./run-docker.sh` (OrbStack, not Docker Desktop)
2. Sanity: `curl -s https://api.ping.demo:3036/.well-known/oauth-protected-resource/mcp` returns the RFC 9728 document.
3. Standard lane works from the local stack as-is. AI Gateway lane needs the
   Privilege tenant wiring (SE credentials) — without it the door's broker
   still runs but the upstream leg is unconfigured; know which lane you're
   demoing before you're on stage.

## Per-client connection notes (fill from the verification matrix)

### Muse
- Install: `curl -fsSL https://dev.meta.ai/install.sh | sh`
- Settings → mcp_servers:
```json
{ "mcp_servers": { "demo-bank": {
    "transport": "streamable_http",
    "url": "https://api.ping.demo:3036/mcp",
    "mode": "optional" } } }
```
- First tool use triggers OAuth: browser opens, PingOne login, callback to 127.0.0.1.
- Verified behaviors (from Task 1 matrix): [paste discovery URL, auth method, redirect shape observed]

### LM Studio
- Connectors → Add MCP → remote URL (standard lane URL above).
- Known quirk: LM Studio falls back to SSE on any non-`UnauthorizedError` — the
  doors answer GET deliberately, so use POST-based connect.
- Verified behaviors: [paste]

### LibreChat
- `librechat/` in-repo; add the door as a remote MCP server in `librechat.yaml`:
```yaml
mcpServers:
  demo-bank:
    type: streamable_http
    url: https://api.ping.demo:3036/mcp
```
- Verified behaviors: [paste]

### ChatGPT
- Connectors require a publicly reachable URL: locally this needs the SE host
  or a tunnel; record in the matrix which works. [paste verified setup]

## Demo steps (map to demo use cases)

| Step | You say/type in the agent | What the audience sees | Surface |
|---|---|---|---|
| Onboard | first tool use in any client | Browser opens: PingOne login → consent | Browser |
| Read (UC-MUSE1) | "Show my checking account balance" | Token chain: RFC 8693 exchange (sub=user, act=agent) → gateway → tool | Dashboard token-chain panel |
| Governed write (Muse only) | "Transfer $500 to savings" | P1AZ evaluates → HITL pending → approve in dashboard → tool runs | Dashboard HITL panel |
| Lane 2 (UC-MUSE2) | Same read, pointed at the privilege-gateway door | Credential swap at the facade; per-user policy at the AI Gateway | Dashboard + Privilege console |
| Step-up | Trigger MFA step-up case | Agent paused until MFA completes | Dashboard step-up surface |
| Audit | Any call | Correlation id, decision, sub/act in the audit trail | Dashboard audit panel |

## Talking points

- "Any spec-compliant agent works — we didn't pre-register any of them. DCR did it live."
- "The agent has no keys of its own. Its authority is minted per call by RFC 8693."
- "Two lanes, one trust layer: our gateway or the AI Gateway — the external agent is governed either way."
- "When the action is sensitive, the agent stops. The human approves in the bank's UI — the trust boundary is Ping, not the agent."
- "Kill the agent's token in Agent Governance and the same tool call is denied — governance outlives the agent."

## Failure playbook

| Symptom | Cause | Fix |
|---|---|---|
| Client shows not connected | Stack down or TLS not trusted | `./run-docker.sh`; trust mkcert root CA |
| Browser login loops | Callback port blocked | Re-run the client's OAuth (LM Studio: remove + re-add connector) |
| AI Gateway lane 503 after BFF restart | Gateway leg dropped with the session | Re-authenticate the door from the client (config unchanged — by design) |
| Tool call 401s mid-demo | Token expired | Clients auto-refresh; if not, reconnect the connector |
| HITL approval never appears | HITL service down | `docker logs` the hitl service; restart it |
````

- [ ] **Step 2: Add the drift-guard test** — append to `demo_api_ui/src/pages/__tests__/MuseAgentLessonPage.test.jsx`:

```jsx
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('runbook/lesson drift guard', () => {
  it('runbook URLs match the lesson page URLs', () => {
    const runbook = readFileSync(
      join(__dirname, '../../../../docs/MUSE_RUNBOOK.md'), 'utf8');
    expect(runbook).toContain('https://api.ping.demo:3036/mcp');
    expect(runbook).toContain('/mcp-facade/privilege-gateway/mcp');
    expect(runbook).toContain('UC-MUSE1');
    expect(runbook).toContain('UC-MUSE2');
  });
});
```

- [ ] **Step 3: Run tests**

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/MuseAgentLessonPage.test.jsx`
Expected: PASS (both describes).

- [ ] **Step 4: Full verification**

Run: `./run-tests.sh unit` (repo root; refuses missing deps intentionally — `npm ci` per service first if needed)
Expected: unit suites pass across services.

- [ ] **Step 5: Commit**

```bash
git add docs/MUSE_RUNBOOK.md demo_api_ui/src/pages/__tests__/MuseAgentLessonPage.test.jsx
git commit -m "docs: external-agent runbook (4 clients, 2 lanes) + drift guard"
```
