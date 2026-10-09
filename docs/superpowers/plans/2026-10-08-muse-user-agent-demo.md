# Muse & Friends as the User's Agent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the demo presenter's own agent — Muse, Grok, LibreChat, LM Studio, or ChatGPT — connect to the demo and run the demo steps as the user's real agent, in two lanes: the standard flow (agent → Agent Gateway → Authorize → tool) and an AI Gateway lane (agent → MCP facade `privilege-gateway` door → PingOne Privilege AI Gateway → tool). The agent acts, Ping governs — and the story generalizes to *any* agent the customer already has.

**Architecture:** The demo already has two external-agent entry points, and each maps to one lane:

- **Standard lane** — the MCP external door (`docs/EXTERNAL_DOOR_MCP_FLOW.md`): RFC 9728 discovery, OAuth 2.1 AS with DCR + CIMD, PKCE, PingGateway :3036 enforcement (token exchange, P1AZ decision, HITL, step-up). Any spec-compliant MCP client walks in unregistered.
- **AI Gateway lane** — the MCP facade's `privilege-gateway` door (`demo_api_server/routes/mcpFacade.js:240`): `/mcp-facade/privilege-gateway/<app>/mcp`. The client's OAuth (against the demo's durable broker) also establishes the BFF's server-side leg to the PingOne Privilege AI Gateway (`ownsUpstreamAuth` — the caller's bearer is replaced on the upstream hop; per-user policy enforced by the gateway). This is the proven LM Studio link (`docs/superpowers/specs/2026-09-11-lmstudio-privilege-gateway-link-design.md`), with the restart-durable client registry that door was built for.

Muse/Grok/LibreChat/LM Studio/ChatGPT are all spec-compliant MCP clients with remote-server + OAuth support, so both lanes are **verify + document + diagram**, not build. The demo steps gain new use cases (UC-MUSE1 standard lane, UC-MUSE2 AI Gateway lane) authored as use-case diagram configs — external agents do NOT prevent use-case registration (see "Use-case feasibility" below).

**Tech Stack:** Muse (Meta: consumer app iOS/Android/web/iPad + Muse Code CLI for macOS/Linux/Windows), Grok (xAI: Grok app custom connectors + Grok Bot + Grok CLI), LibreChat (already in repo, `librechat/`), LM Studio (proven precedent), ChatGPT (connector MCP + OAuth), oauth-mcp external door (unchanged), MCP facade doors (unchanged), PingOne Privilege AI Gateway (SE/Privilege tenant, unchanged), demo_api_ui lesson catalog + use-case diagram configs (existing patterns).

**Spec:** the agreed in-chat design in this session (2026-10-08), extended by the user on the same day: all agents run two use cases (standard flow + AI Gateway); detailed diagrams in the docs; demo-step use cases where feasible. Companion reading: `docs/EXTERNAL_DOOR_MCP_FLOW.md`, `docs/superpowers/specs/2026-09-11-lmstudio-privilege-gateway-link-design.md`, `docs/use-case-diagram-standards.md`.

## The agent families (what each product actually is)

Names here are deliberately precise — two vendors ship multiple products under one brand, and the demo story differs per surface.

| Product | Vendor / surface | MCP client? | Auth to custom endpoints | Runs where | Demo fit |
|---|---|---|---|---|---|
| **Muse** (consumer) | Meta; iOS, Android, web, iPad (launched 2026-09-08; iPad 2026-10-07) | Custom connectors to **hosted** MCP (streamable HTTP) | Muse-managed credential flow ("Sentinel" issues surrogate credentials; approvals scoped per action) | Meta cloud VM — cannot reach localhost/private DNS | The "real customer, real phone" story on the SE cluster. OAuth-discovery compatibility is the open cell |
| **Muse Code** | Meta; macOS/Linux/Windows CLI (`curl -fsSL https://dev.meta.ai/install.sh \| sh`) | Native `mcp_servers` block, `streamable_http`, OAuth 2.1 + `muse mcp login`, `${VAR}` interpolation | Full OAuth 2.1 with browser login; token refresh automatic | Presenter's machine | Local demos, full standard-lane flow including governed write |
| **Grok app** (consumer chat) | xAI; web/desktop/mobile apps | **Custom connectors**: Grok → Connectors → New Connector → Custom; public URL required; Streamable HTTP/SSE | OAuth if the server requires it (browser flow); xAI does not document DCR support — verify; static Bearer as fallback | xAI cloud | Strong candidate: connector UI is self-serve, same cloud-VM reachability constraint as Muse |
| **Grok Bot** | xAI; desktop + iOS beta (SuperGrok/Cursor tiers) | Not documented as MCP-native — Bots drive a cloud computer (browser + filesystem + terminal); connectors feed the underlying Grok app | Browser sign-in / connector OAuth via the shared cloud computer | xAI cloud computer (account-scoped, shared across all of a user's Bots) | The "agent that keeps working" narrative; MCP path runs through the Grok app connector layer, not the Bot itself |
| **Grok CLI** | xAI; terminal | Remote HTTP MCP with browser OAuth on first use; creds in `~/.grok/mcp_credentials.json` | Full OAuth browser flow | Presenter's machine | Local terminal-based demo, Muse Code's counterpart |
| **LibreChat** | open source; in-repo `librechat/` | `mcpServers` in `librechat.yaml` (`type: streamable_http`) | Per config (headers/Bearer/OAuth where supported) | Presenter's machine or docker | The open-source/dev-agent story |
| **LM Studio** | local app | Remote MCP connectors | OAuth browser flow (proven against our facade door 2026-09-11) | Presenter's machine | The proven precedent for both lanes |
| **ChatGPT** | OpenAI; connectors (dev mode) | Remote MCP connectors | OAuth; **publicly reachable URL required** — local stack needs SE host or tunnel | OpenAI cloud | Same reachability constraint as Muse/Grok |

**Shared constraint for all cloud-hosted agents (Muse app, Grok, ChatGPT):** the endpoint must be publicly reachable — the SE cluster host `https://cmuir-mcp.ping-devops.com` works; the local Docker stack's `api.ping.demo:3036` (an /etc/hosts entry) does not. Local demos use Muse Code / Grok CLI / LM Studio / LibreChat; cloud-agent demos run against the SE cluster.

**Grok specifics worth knowing before the demo:**
- Custom connector flow: **Grok → Connectors → New Connector → Custom**, paste the MCP URL, complete the auth flow. Server must answer on the public internet.
- xAI's docs confirm OAuth *browser* flows happen when the server requires them (CLI docs are explicit; connector docs are implicit) but **never mention RFC 7591 DCR**. Our door advertises `registration_endpoint`, so Grok should self-register — but this is exactly the kind of claim Task 1's matrix exists to prove, not assume. Fallback if DCR is unsupported: pre-register a client, hand Grok the fixed credentials if its UI accepts them, or demo with a static Bearer minted from a pre-registered client (governance story intact; login shown out-of-band).
- xAI's hosted **Remote MCP Tools API** (`tools:[{type:"mcp", server_url, allowed_tools, authorization}]`) is a separate developer surface — useful for the "customer builds their own agent on xAI's API" talking point, and it takes a **static bearer token**, which maps cleanly to a pre-registered client on our door.
- **Grok Bot's shared cloud computer** (one account-scoped workspace for all of a user's Bots) is itself a governance talking point: contrast Meta's per-action scoped approvals with xAI's shared-workspace model, and show that Ping governs the *resource* side identically regardless of which agent architecture calls.

## Live verification (2026-10-08, SE cluster — pre-fills part of Task 1's matrix)

Cluster state was brought current first: `mcp-server` was running an image older than the array-scope fix (#984) — rolled; `ping-gateway` ConfigMaps dated Sep 11 with 4 drifted groovy filters (`p1az-decision`, `olb-token-exchange`, `jwks-token-validation`, `invest-dispatch`) — synced from repo and rolled. Post-sync door health:

| Check | Result |
|---|---|
| RFC 9728 `/.well-known/oauth-protected-resource/mcp` | 200, correct document |
| RFC 8414 AS metadata | 200; issuer, DCR endpoint, `client_id_metadata_document_supported: true` |
| DCR (RFC 7591) | **Live-verified**: 3 clients registered via curl, client_id/secret minted |
| `/authorize` | 302 → PingOne with PKCE + `resource=` bound, `max_age=1800` |
| MCP streamable HTTP handshake | initialize → session → `tools/list` = 9 tools (curation active); requires `MCP-Protocol-Version` header |
| Scope governance (service token) | `client_credentials` token gets `mcp:invoke read` but is **refused `accounts:read`** — `get_my_accounts` returns clean `Insufficient scope` error. User data requires the browser-login delegated-token path; the token-chain teaching point is structural, not staged |
| `create_transfer` array-scope fix (#984) | Deployed (pod rolled past the fix) |

**Open cells for Task 1** (need the real apps): Muse consumer-app connector OAuth compatibility; Grok custom-connector DCR-vs-fixed-client behavior; ChatGPT reachable-host setup; Muse Code / Grok CLI / LibreChat local runs.

## Use-case feasibility (the "does the external agent prevent this?" question)

**No — with one structural note.** A use-case diagram config is presentation-layer: `{ id, NODES, EDGES, walk }` in `demo_api_ui/src/config/useCaseDiagrams/`, registered in `index.js`, driven by the drift test. Nothing in that contract requires the agent to run *inside* the web UI. What the drift test DOES require (`useCaseDiagrams.drift.test.js:27-31`) is that every authored config has an entry in `DEMO_STEP_GUIDES` and a presenter number — i.e., it must be a *demo step*, not just a diagram.

So the external agents become demo steps by adding UC ids to `DEMO_PRIMARY_USE_CASE_IDS` (`demoUseCaseSteps.js`) with `kind: 'agent'` destinations that **instruct the presenter to act in the external client** (like UC46's "opens page" pattern, but for an external surface): the step card says "Run this in Muse / LM Studio / ChatGPT per the runbook," while the reel walks the wire-level flow (discovery → DCR → PKCE → exchange → gateway → Authorize → tool). The audience watches the token chain on the dashboard while the agent acts on the presenter's machine — exactly the story.

## Use-case coverage by agent

Use cases down the side, agents across the top. ✅ = the agent runs that use case in the demo; ❌ = structurally out of scope for that surface (reason in the notes below).

| Use case (demo step) | Muse app (cloud) | Muse Code (CLI) | Grok app (cloud) | Grok CLI | LM Studio | LibreChat | ChatGPT (cloud) |
|---|---|---|---|---|---|---|---|
| **Onboard** — RFC 9728 discovery → DCR → PKCE login (the "never seen this client" moment) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **UC-MUSE1: delegated read** — "show my balance", full RFC 8693 chain (sub=user, act=agent) on the dashboard | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Governed write + HITL** — "transfer $500", P1AZ → human approval in the dashboard → tool runs | ❌ (a) | ✅ (b) | ❌ | ✅ (b) | ✅ (b) | ✅ (b) | ❌ |
| **UC-MUSE2: AI Gateway lane** — credential swap at the facade, per-user policy at Privilege | ❌ (c) | ✅ (c) | ❌ (c) | ✅ | ✅ (proven) | ✅ | ❌ (c) |
| **Step-up / MFA** — login-time MFA at PingOne; policy step-up on the sensitive action | login MFA | login MFA + policy step-up | login MFA | login MFA + policy step-up | login MFA + policy step-up | login MFA + policy step-up | login MFA |
| **Audit trail** — every call shows sub/act/tool/decision | ✅ (any call) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Deny paths** (scope refusal, service-token governance) — already proven live with curl | n/a | ✅ | n/a | ✅ | ✅ | ✅ | n/a |

Notes:

- **(a) Cloud read-only by design for the phone demo.** The HITL transfer is the most orchestration-heavy moment (dashboard open, approval click, agent waiting); the consumer apps demonstrate the full read-path chain, which carries the same teaching point.
- **(b) Governed-write is a two-agent show minimum.** Muse Code leads (presenter's Mac, most reliable); Grok CLI / LM Studio / LibreChat can run it too — a runbook line each, not code.
- **(c) Cloud agents reach lane 2 only via the SE facade exposure** (see the next section). Until that ingress lands, lane 2 is a local-client demo. ngrok is the stopgap; the permanent answer is already deployed in the cluster (nothing needs to move — only ingress paths are missing).

The narrative split: **cloud agents** (Muse app, Grok, ChatGPT) tell the *"your customer's real agent, on their phone"* story against the SE cluster; **local agents** (Muse Code, Grok CLI, LM Studio, LibreChat) run the *full two-lane governance* story including HITL and the AI Gateway. Same doors, same Ping products, two demo registers.

## SE facade exposure (the ngrok alternative — nothing needs to move)

Verified live on the SE cluster (2026-10-08): the **facade is already deployed** in `ping-devops-cmuir`. The `demo-api-server` image ships `routes/mcpFacade.js`, and an in-cluster probe of `https://demo-api-server:3001/mcp-facade/privilege-gateway/mcp` answered a correct RFC 9728 401 challenge. Two facts make this nearly free:

1. The challenge's `resource_metadata` URL is derived from the request's `Host` header (`facadeBase()` in `mcpFacade.js`) — so through a public ingress host it advertises the public host automatically. No code change.
2. The `ai-demo-ingress` currently routes everything except `/grafana` to `frontend`, whose OAuth wall 302s `/mcp-facade/*` to a browser login an MCP client cannot complete (verified: `HTTP 302 → /api/auth/hosted-access/login?return_to=/mcp-facade/...`).

What remains (ingress + env, no code):

- Add ingress path rules on `ai-demo.ping-devops.com` (or a dedicated host): `/mcp-facade/` → `demo-api-server:3001` (TLS passthrough — the BFF serves TLS on 3001, port is named `https`).
- Route `/oauth/` for the facade's AS to the broker service (`mcp-gateway`), mirroring the SE agentless deployment's proven nginx pattern (`/oauth/* is routed to mcp-gateway` — see the `facadeBase` comment in `mcpFacade.js`).
- Point `MCP_FACADE_AGENT_GATEWAY_AS` at the in-cluster broker URL in the `demo-api-server` deployment env.
- ngrok stays the stopgap for ad-hoc demos; this ingress is the permanent path and also unlocks the AI Gateway lane for Muse app / Grok / ChatGPT (row (c) above flips to ✅).

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

The matrix — every cell gets a row in the log. Cells marked ✅ are pre-verified (see "Live verification" above); the rest need the real app:

| Client | Standard lane (external door, SE host) | AI Gateway lane (facade `privilege-gateway` door) |
|---|---|---|
| Door itself (curl probes) | ✅ DCR + authorize + handshake + scope governance verified | (facade probes pending) |
| Muse (consumer app) | connect + read — **OAuth-discovery compatibility is the open question** | connect + read |
| Muse Code (CLI, local Mac) | connect + read + governed write | connect + read |
| Grok (app custom connector) | connect + read — **DCR-vs-fixed-client is the open question** | connect + read |
| Grok CLI (local) | connect + read | connect + read |
| LM Studio | connect + read (re-verify vs 2026-09-11) | connect + read (proven 2026-09-11; re-verify) |
| LibreChat | connect + read | connect + read |
| ChatGPT | connect + read (needs reachable host — record what works locally vs SE) | connect + read |

Cloud-hosted agents (Muse app, Grok app, ChatGPT) test against `https://cmuir-mcp.ping-devops.com` only — they cannot reach the local stack. Local clients (Muse Code, Grok CLI, LM Studio, LibreChat) can test both lanes.

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
- Produces: `getConfig('UC-MUSE1')` / `getConfig('UC-MUSE2')` returning valid configs; two new presenter demo steps. Task 3's per-agent pages link these diagram routes (`useCaseDiagramPath('UC-MUSE1')`).

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

### Task 3: Learning-hub per-agent pages (7 agents, one data module, one route)

**Files:**
- Create: `demo_api_ui/src/config/externalAgents.js` (single data module: per-agent identity, setup steps, both doors' connection config, use-case coverage row, failure playbook)
- Create: `demo_api_ui/src/pages/ExternalAgentLessonPage.jsx` (renders from the data module by `:agentId`)
- Modify: `demo_api_ui/src/App.js` (route `/external-agents/:agentId`, near the other `*-learning` routes at `App.js:863-896`)
- Modify: `demo_api_ui/src/learning/lessonCatalog.js` (7 lesson entries: `muse-app`, `muse-code`, `grok-app`, `grok-cli`, `lm-studio`, `librechat`, `chatgpt` — all routing to `/external-agents/<id>`)
- Modify: `demo_api_server/config/auth-requirements.json` — only if `npm run authz:verify` demands it; sibling learning routes are `"public"`. Check, don't assume.
- Test: `demo_api_ui/src/config/__tests__/externalAgents.test.js`

**Interfaces:**
- Consumes: `lessonCatalog` conventions (`lesson()` factory, `MATURITY_STAGES`, `PROVENANCE`, `REDACTED_RESULT`), `AppShell` routing, `useCaseDiagramPath` from Task 2.
- Produces: routes `/external-agents/:agentId` for the 7 ids above; lesson ids resolvable by `getLesson(id)`; `externalAgents.js` exports `EXTERNAL_AGENTS` (array) and `getExternalAgent(id)` — Task 4's drift-guard test reads the SE host and door paths from here.

- [ ] **Step 1: Write the failing data-module test**

```js
import { describe, expect, it } from 'vitest';
import { EXTERNAL_AGENTS, getExternalAgent } from '../externalAgents';
import { lessonCatalog, getLesson } from '../../learning/lessonCatalog';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const IDS = ['muse-app', 'muse-code', 'grok-app', 'grok-cli', 'lm-studio', 'librechat', 'chatgpt'];

describe('externalAgents data module', () => {
  it('has an entry per agent id, with complete content', () => {
    expect(EXTERNAL_AGENTS.map((a) => a.id)).toEqual(IDS);
    for (const a of EXTERNAL_AGENTS) {
      expect(a.name).toBeTruthy();
      expect(a.runsWhere).toMatch(/cloud|your machine/i);
      expect(a.setup.length).toBeGreaterThan(0);
      expect(a.doors.standard).toContain('cmuir-mcp.ping-devops.com');
      expect(a.coverage).toEqual(expect.arrayContaining(['onboard', 'read']));
      expect(a.failurePlaybook.length).toBeGreaterThan(0);
    }
  });

  it('governed-write coverage matches the plan matrix (Muse Code leads; local clients can too)', () => {
    const canWrite = EXTERNAL_AGENTS.filter((a) => a.coverage.includes('governed-write')).map((a) => a.id);
    expect(canWrite).toEqual(['muse-code', 'grok-cli', 'lm-studio', 'librechat']);
  });

  it('every agent has a lesson-catalog entry with a matching route', () => {
    for (const id of IDS) {
      const lesson = getLesson(id);
      expect(lesson, id).toBeTruthy();
      expect(lesson.route).toBe(`/external-agents/${id}`);
    }
  });

  it('drift guard: door URLs in the data module match the plan doc', () => {
    const plan = readFileSync(join(__dirname, '../../../../docs/superpowers/plans/2026-10-08-muse-user-agent-demo.md'), 'utf8');
    expect(plan).toContain('https://cmuir-mcp.ping-devops.com');
    expect(plan).toContain('/mcp-facade/privilege-gateway/mcp');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run src/config/__tests__/externalAgents.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the data module**

`demo_api_ui/src/config/externalAgents.js` — one entry per agent, content sourced from the plan's "Agent families" table, runbook setup notes, and coverage matrix:

```js
// Single source of truth for the external-agent lesson pages. Content mirrors
// docs/superpowers/plans/2026-10-08-muse-user-agent-demo.md (Agent families,
// coverage matrix, runbook setup). The drift-guard test keeps them in sync.
export const STANDARD_DOOR = 'https://cmuir-mcp.ping-devops.com/mcp';
export const AI_GATEWAY_DOOR = '/mcp-facade/privilege-gateway/mcp';

export const EXTERNAL_AGENTS = [
  {
    id: 'muse-app',
    name: 'Muse (consumer app)',
    vendor: 'Meta',
    runsWhere: "Meta's cloud — iOS, Android, web, iPad. Cannot reach the local stack; demos against the SE host.",
    setup: [
      { title: 'Open Muse and ask for the connector', body: 'Prompt: "Build a custom integration. Its MCP server is https://cmuir-mcp.ping-devops.com/mcp, transport streamable HTTP. Connect, inspect the tools, request credentials through the secure credential flow, and keep approval required for anything that writes or spends."' },
      { title: 'Complete the login', body: "The OAuth browser step opens on the phone/web. Sign in with the demo customer (PingOne). Muse's Sentinel handles credential custody — Muse never sees raw secrets." },
      { title: 'Run the read', body: '"Show my checking account balance." Watch the dashboard token-chain panel: sub=user, act=Muse.' },
    ],
    doors: { standard: STANDARD_DOOR, aiGateway: null },
    coverage: ['onboard', 'read', 'audit'],
    stepUp: 'Login MFA only (phone demo is read-path).',
    failurePlaybook: [
      ['Connector cannot reach the URL', 'Meta cloud cannot resolve private DNS', 'Use the SE host, never localhost/api.ping.demo'],
      ['OAuth step stalls', 'Discovery/PKCE compatibility is the open matrix cell', 'Fallback: pre-minted Bearer via the credential flow (governance intact; login out-of-band)'],
    ],
  },
  {
    id: 'muse-code',
    name: 'Muse Code (CLI)',
    vendor: 'Meta',
    runsWhere: "Your machine — macOS/Linux/Windows. Install: curl -fsSL https://dev.meta.ai/install.sh | sh. The full two-lane agent.",
    setup: [
      { title: 'Install', body: 'curl -fsSL https://dev.meta.ai/install.sh | sh, then muse --version.' },
      { title: 'Point at the standard door', body: 'Settings > mcp_servers: {"mcp_servers": {"demo-bank": {"transport": "streamable_http", "url": "https://cmuir-mcp.ping-devops.com/mcp", "mode": "optional"}}}. First tool use triggers OAuth: browser opens, PingOne login, callback to 127.0.0.1.' },
      { title: 'Governed write', body: 'Keep the dashboard open. "Transfer $500 to savings" -> P1AZ -> HITL pending on the dashboard -> approve -> tool runs.' },
      { title: 'Lane 2 (local BFF)', body: 'Add a second server entry with url http://localhost:3001/mcp-facade/privilege-gateway/mcp (or the https://local.ping-devops.com:4000 form) to walk the AI Gateway lane.' },
    ],
    doors: { standard: STANDARD_DOOR, aiGateway: AI_GATEWAY_DOOR },
    coverage: ['onboard', 'read', 'governed-write', 'ai-gateway', 'step-up', 'audit', 'deny'],
    stepUp: 'Login MFA + policy step-up on the sensitive action.',
    failurePlaybook: [
      ['demo-bank not connected', 'Stack down or TLS not trusted', 'Start the stack; trust the mkcert root CA'],
      ['Browser login loops', 'Callback port blocked', 'Re-run the client connect'],
      ['Tool call 401s mid-demo', 'Token expired', 'Muse auto-refreshes; if not, reconnect via /mcp'],
    ],
  },
  {
    id: 'grok-app',
    name: 'Grok (custom connector)',
    vendor: 'xAI',
    runsWhere: "xAI cloud — Grok web/desktop/mobile. Public URL required; demos against the SE host.",
    setup: [
      { title: 'Create the connector', body: 'Grok > Connectors > New Connector > Custom. Paste the MCP URL: https://cmuir-mcp.ping-devops.com/mcp. Complete the auth flow (browser OAuth).' },
      { title: 'If DCR is unsupported', body: 'xAI does not document RFC 7591 DCR. Fallback: pre-register a client (curl -X POST https://cmuir-mcp.ping-devops.com/register ...) and use fixed credentials if the UI accepts them, or mint a Bearer from a pre-registered client and use xAI\'s Remote MCP API shape (authorization: "Bearer ...").' },
      { title: 'Run the read', body: '"Show my checking account balance." Token chain on the dashboard.' },
    ],
    doors: { standard: STANDARD_DOOR, aiGateway: null },
    coverage: ['onboard', 'read', 'audit'],
    stepUp: 'Login MFA only.',
    failurePlaybook: [
      ['Connector rejected the URL', 'Not publicly reachable', 'SE host only — local stack is unreachable from xAI cloud'],
      ['Registration fails', 'DCR unsupported', 'Pre-registered client or static Bearer fallback'],
    ],
  },
  {
    id: 'grok-cli',
    name: 'Grok CLI',
    vendor: 'xAI',
    runsWhere: 'Your machine — terminal. Remote HTTP MCP with browser OAuth on first use; credentials persist in ~/.grok/mcp_credentials.json.',
    setup: [
      { title: 'Add the remote server', body: 'Configure the remote MCP server with the standard-door URL. First use opens the browser for the PingOne login.' },
      { title: 'Governed write', body: 'Same as Muse Code: dashboard open, transfer prompt, approve in the HITL panel.' },
    ],
    doors: { standard: STANDARD_DOOR, aiGateway: AI_GATEWAY_DOOR },
    coverage: ['onboard', 'read', 'governed-write', 'ai-gateway', 'step-up', 'audit', 'deny'],
    stepUp: 'Login MFA + policy step-up on the sensitive action.',
    failurePlaybook: [
      ['Stale credentials', 'Cached token expired', 'Delete ~/.grok/mcp_credentials.json and reconnect'],
    ],
  },
  {
    id: 'lm-studio',
    name: 'LM Studio',
    vendor: 'local app',
    runsWhere: 'Your machine. The proven precedent: connected to the facade privilege-gateway door 2026-09-11.',
    setup: [
      { title: 'Add the connector', body: 'Connectors > Add MCP > remote URL. Standard lane: https://cmuir-mcp.ping-devops.com/mcp. Lane 2 (local): /mcp-facade/privilege-gateway/mcp on the local BFF.' },
      { title: 'Known quirk', body: 'LM Studio falls back to SSE on any non-UnauthorizedError — the doors answer GET deliberately, so use POST-based connect.' },
    ],
    doors: { standard: STANDARD_DOOR, aiGateway: AI_GATEWAY_DOOR },
    coverage: ['onboard', 'read', 'governed-write', 'ai-gateway', 'step-up', 'audit', 'deny'],
    stepUp: 'Login MFA + policy step-up on the sensitive action.',
    failurePlaybook: [
      ['SSE fallback error', 'Non-401 on GET', 'Use POST-based connect; do not rely on GET /mcp'],
    ],
  },
  {
    id: 'librechat',
    name: 'LibreChat',
    vendor: 'open source (in-repo)',
    runsWhere: 'Your machine or docker (librechat/ in this repo).',
    setup: [
      { title: 'Configure mcpServers', body: 'librechat.yaml: mcpServers: { demo-bank: { type: streamable_http, url: https://cmuir-mcp.ping-devops.com/mcp } }. Lane 2: add a second entry pointing at the facade door.' },
      { title: 'Run the flows', body: 'Same demo script as Muse Code — read, governed write, lane 2.' },
    ],
    doors: { standard: STANDARD_DOOR, aiGateway: AI_GATEWAY_DOOR },
    coverage: ['onboard', 'read', 'governed-write', 'ai-gateway', 'step-up', 'audit', 'deny'],
    stepUp: 'Login MFA + policy step-up on the sensitive action.',
    failurePlaybook: [
      ['Server not listed', 'YAML syntax or transport type wrong', 'type: streamable_http exactly; check librechat logs'],
    ],
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT (connectors)',
    vendor: 'OpenAI',
    runsWhere: "OpenAI cloud — connector dev mode. Publicly reachable URL required; local stack needs the SE host or a tunnel.",
    setup: [
      { title: 'Add the MCP connector', body: 'Settings > Connectors > add the MCP URL (SE host). Complete OAuth in the browser.' },
      { title: 'Run the read', body: '"Show my checking account balance." Token chain on the dashboard.' },
    ],
    doors: { standard: STANDARD_DOOR, aiGateway: null },
    coverage: ['onboard', 'read', 'audit'],
    stepUp: 'Login MFA only.',
    failurePlaybook: [
      ['Connector cannot validate the URL', 'Host not publicly reachable', 'SE host or tunnel; record what works in the verification matrix'],
    ],
  },
];

export function getExternalAgent(id) {
  return EXTERNAL_AGENTS.find((a) => a.id === id) || null;
}
```

- [ ] **Step 4: Run data tests to verify they pass**

Run: `cd demo_api_ui && npx vitest run src/config/__tests__/externalAgents.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing page test, then the page**

`demo_api_ui/src/pages/__tests__/ExternalAgentLessonPage.test.jsx`:

```jsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ExternalAgentLessonPage from '../ExternalAgentLessonPage';
import { EXTERNAL_AGENTS } from '../../config/externalAgents';

describe('ExternalAgentLessonPage', () => {
  it('renders per-agent content from the route param', () => {
    render(
      <MemoryRouter initialEntries={['/external-agents/muse-code']}>
        <ExternalAgentLessonPage />
      </MemoryRouter>
    );
    expect(screen.getByRole('heading', { name: /Muse Code/i })).toBeInTheDocument();
    expect(screen.getByText(/streamable_http/i)).toBeInTheDocument();
    expect(screen.getByText(/transfer/i)).toBeInTheDocument();
  });

  it('renders the coverage list and diagram links for every agent', () => {
    for (const a of EXTERNAL_AGENTS) {
      const { unmount } = render(
        <MemoryRouter initialEntries={[`/external-agents/${a.id}`]}>
          <ExternalAgentLessonPage />
        </MemoryRouter>
      );
      expect(screen.getByRole('link', { name: /standard lane \(UC-MUSE1\)/i })).toHaveAttribute('href', '/use-case-diagrams/UC-MUSE1');
      unmount();
    }
  });

  it('unknown agent renders a not-found state', () => {
    render(
      <MemoryRouter initialEntries={['/external-agents/nope']}>
        <ExternalAgentLessonPage />
      </MemoryRouter>
    );
    expect(screen.getByText(/unknown agent/i)).toBeInTheDocument();
  });
});
```

Run: `cd demo_api_ui && npx vitest run src/pages/__tests__/ExternalAgentLessonPage.test.jsx`
Expected: FAIL — module not found.

`demo_api_ui/src/pages/ExternalAgentLessonPage.jsx`:

```jsx
import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { getExternalAgent } from '../config/externalAgents';
import { useCaseDiagramPath } from '../config/useCaseDiagrams';
import './AgentGatewayAuthorizationLessonPage.css';

const COVERAGE_LABELS = {
  'onboard': 'Onboard (discovery, DCR, PKCE)',
  'read': 'UC-MUSE1 delegated read',
  'governed-write': 'Governed write + HITL',
  'ai-gateway': 'UC-MUSE2 AI Gateway lane',
  'step-up': 'Step-up / MFA',
  'audit': 'Audit trail',
  'deny': 'Deny paths',
};

const COVERAGE_ORDER = ['onboard', 'read', 'governed-write', 'ai-gateway', 'step-up', 'audit', 'deny'];

export default function ExternalAgentLessonPage() {
  const { agentId } = useParams();
  const agent = getExternalAgent(agentId);
  if (!agent) {
    return (
      <div className="lesson-page">
        <h1>Unknown agent</h1>
        <p>No external agent &ldquo;{agentId}&rdquo; is configured for this demo.</p>
      </div>
    );
  }
  return (
    <div className="lesson-page">
      <h1>{agent.name}</h1>
      <p className="lesson-audience">{agent.vendor} &middot; {agent.runsWhere}</p>
      <p>
        Walk the wire:{' '}
        <a href={useCaseDiagramPath('UC-MUSE1')}>standard lane (UC-MUSE1)</a>
        {' \u00b7 '}
        <a href={useCaseDiagramPath('UC-MUSE2')}>AI Gateway lane (UC-MUSE2)</a>
      </p>

      <h2>Set it up to demo</h2>
      <ol className="lesson-steps">
        {agent.setup.map((s) => (
          <li key={s.title}>
            <h3>{s.title}</h3>
            <p>{s.body}</p>
          </li>
        ))}
      </ol>

      <h2>Doors</h2>
      <ul>
        <li>Standard lane: <code>{agent.doors.standard}</code></li>
        <li>
          AI Gateway lane:{' '}
          {agent.doors.aiGateway
            ? <code>{agent.doors.aiGateway}</code>
            : 'not available for this agent (cloud reachability)'}
        </li>
      </ul>

      <h2>Use cases this agent covers</h2>
      <ul>
        {COVERAGE_ORDER.map((c) => (
          <li key={c}>
            {agent.coverage.includes(c) ? '\u2705' : '\u274c'} {COVERAGE_LABELS[c]}
          </li>
        ))}
      </ul>
      <p>Step-up: {agent.stepUp}</p>

      <h2>If something breaks</h2>
      <table>
        <thead><tr><th>Symptom</th><th>Cause</th><th>Fix</th></tr></thead>
        <tbody>
          {agent.failurePlaybook.map(([symptom, cause, fix]) => (
            <tr key={symptom}><td>{symptom}</td><td>{cause}</td><td>{fix}</td></tr>
          ))}
        </tbody>
      </table>

      <p><Link to="/learning">Back to the learning hub</Link></p>
    </div>
  );
}
```

Run the page test again: PASS.

- [ ] **Step 6: Register the route + 7 lesson entries**

`demo_api_ui/src/App.js`, near the other learning routes (~line 882):

```jsx
<Route
  path="/external-agents/:agentId"
  element={
    <AppShell user={user} logout={logout}>
      <ExternalAgentLessonPage />
    </AppShell>
  }
/>
```
plus the import near `App.js:234`.

`demo_api_ui/src/learning/lessonCatalog.js` — 7 entries. The `lesson()` factory requires `run`/`evidence`/`fallback`; mirror the existing shape (from the earlier Task 3 sketch, one per agent):

```js
  lesson({
    id: "muse-app",
    title: "Muse (consumer app) as the user's agent",
    audience: "Sales engineers and customer architects",
    category: "Personal Agents",
    route: "/external-agents/muse-app",
    standaloneRoute: "/external-agents/muse-app",
    run: { action: "mcp-discovery", exposesRawBearerToken: false, result: REDACTED_RESULT },
    evidence: { events: ["agent-detection", "client-metadata", "consent", "tool-authentication"], result: REDACTED_RESULT },
    fallback: { provenance: PROVENANCE.SIMULATED, label: "Simulated external-agent connection" },
    maturityStages: [MATURITY_STAGES.DISCOVER, MATURITY_STAGES.REGISTER, MATURITY_STAGES.AUTHENTICATE, MATURITY_STAGES.AUTHORIZE],
    agentCategory: "Consumer & Partner Agent",
    productRoles: ["PingOne", "Agent Gateway / Broker", "Agent Authorize"],
    talkingPoints: [
      "The user's own agent on their phone — Meta's Muse connects to the bank's MCP endpoint; Ping governs every hop.",
      "Sentinel keeps credentials out of the agent's hands; approvals are scoped per action.",
      "User data requires the real delegated-token path — a service token is refused accounts:read.",
    ],
  }),
  // ...6 more, same shape: muse-code, grok-app, grok-cli, lm-studio, librechat, chatgpt.
  // id = the agent id; route + standaloneRoute = /external-agents/<id>;
  // talkingPoints = 2-3 lines from the plan's agent-families table + coverage matrix.
```
Author all seven entries for real (title/audience/talkingPoints per agent from the plan doc — muse-code emphasizes two lanes + governed write; grok-app the connector UI + DCR fallback; grok-cli the terminal flow; lm-studio the proven precedent; librechat the open-source story; chatgpt the reachable-host constraint).

- [ ] **Step 7: Check auth-requirements for the new route**

Run: `cd demo_api_server && npm run authz:verify 2>&1 | tail -5` (after `npm ci` if needed)
Expected: PASS. If it demands an entry for `/external-agents/:agentId`, run the package script that regenerates `auth-requirements.json` with `"public"` (sibling pattern) and re-verify. Never hand-edit the file.

- [ ] **Step 8: Build + full unit suite**

Run: `cd demo_api_ui && npm run build && npm run test:unit`
Expected: build exit 0; full UI unit suite green.

- [ ] **Step 9: Commit**

```bash
git add demo_api_ui/src/config/externalAgents.js \
        demo_api_ui/src/config/__tests__/externalAgents.test.js \
        demo_api_ui/src/pages/ExternalAgentLessonPage.jsx \
        demo_api_ui/src/pages/__tests__/ExternalAgentLessonPage.test.jsx \
        demo_api_ui/src/App.js demo_api_ui/src/learning/lessonCatalog.js
git commit -m "feat: per-agent learning-hub pages (7 external agents) with demo setup"
```

### Task 4: Runbook (all agents, both lanes) and drift guard

**Files:**
- Create: `docs/MUSE_RUNBOOK.md` (covers Muse, LM Studio, LibreChat, ChatGPT; both lanes)
- Modify: `demo_api_ui/src/config/__tests__/externalAgents.test.js` (add runbook drift-guard test)

**Interfaces:**
- Consumes: Task 1's verification matrix (actual per-client behaviors), Task 2's UC-MUSE ids and diagram routes, Task 3's `externalAgents.js` data module.
- Produces: presenter runbook; a test pinning the runbook's URLs to the lesson-page copy so they can't drift apart.

- [ ] **Step 1: Write the runbook** — `docs/MUSE_RUNBOOK.md`:

````markdown
# External-agent demo runbook — Muse, Grok, LM Studio, LibreChat, ChatGPT

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

### Muse Code (CLI, local)
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

### Muse (consumer app — cloud)
- Runs in Meta's cloud; **cannot reach the local stack**. Use the SE host.
- In Muse, prompt (custom connector): "Build a custom integration. Its MCP
  server is `https://cmuir-mcp.ping-devops.com/mcp`, transport streamable HTTP.
  Connect, inspect the tools, request credentials through the secure credential
  flow, and keep approval required for anything that writes or spends."
- The OAuth browser step opens on the phone/web; whether Muse completes our
  RFC 9728 + DCR + PKCE dance is the open matrix cell. Fallback: pre-minted
  Bearer via the credential flow (governance intact; login out-of-band).
- Verified behaviors: [paste]

### LM Studio
- Connectors → Add MCP → remote URL (standard lane URL above).
- Known quirk: LM Studio falls back to SSE on any non-`UnauthorizedError` — the
  doors answer GET deliberately, so use POST-based connect.
- Verified behaviors: [paste]

### Grok (app custom connector)
- Grok → Connectors → New Connector → Custom → paste the MCP URL → complete
  the auth flow (browser OAuth). Public URL required: use the SE host, not the
  local stack.
- If DCR is unsupported (xAI does not document it): pre-register a client via
  `curl -X POST https://cmuir-mcp.ping-devops.com/register ...` and hand the
  fixed client_id/secret to the connector UI, or mint a Bearer from a
  pre-registered client and use xAI's Remote MCP API shape
  (`authorization: "Bearer ..."`).
- Verified behaviors: [paste]

### Grok CLI (local)
- Remote HTTP MCP with browser OAuth on first use; credentials persist in
  `~/.grok/mcp_credentials.json`.
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

- [ ] **Step 2: Add the drift-guard test** — append to `demo_api_ui/src/config/__tests__/externalAgents.test.js`:

```jsx
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('runbook/lesson drift guard', () => {
  it('runbook URLs match the lesson page URLs', () => {
    const runbook = readFileSync(
      join(__dirname, '../../../../docs/MUSE_RUNBOOK.md'), 'utf8');
    expect(runbook).toContain('https://cmuir-mcp.ping-devops.com/mcp');
    expect(runbook).toContain('/mcp-facade/privilege-gateway/mcp');
    expect(runbook).toContain('UC-MUSE1');
    expect(runbook).toContain('UC-MUSE2');
  });
});
```

- [ ] **Step 3: Run tests**

Run: `cd demo_api_ui && npx vitest run src/config/__tests__/externalAgents.test.js`
Expected: PASS (both describes).

- [ ] **Step 4: Full verification**

Run: `./run-tests.sh unit` (repo root; refuses missing deps intentionally — `npm ci` per service first if needed)
Expected: unit suites pass across services.

- [ ] **Step 5: Commit**

```bash
git add docs/MUSE_RUNBOOK.md demo_api_ui/src/config/__tests__/externalAgents.test.js
git commit -m "docs: external-agent runbook (4 clients, 2 lanes) + drift guard"
```
