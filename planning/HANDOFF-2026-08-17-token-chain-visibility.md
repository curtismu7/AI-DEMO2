# Handoff — 2026-08-17: making the token chain show every call

Started from one question: *"in the MCP dance we call once for the tool list, get
401, then call again after authn — I don't see 2 calls."* That was correct, and
chasing it surfaced a class of bug worth understanding before touching this area.

Repo state at handoff: `main` = `3f7cf2628`, main checkout synced, Docker stack
deployed and serving it. PRs merged: #1935, #1938, #1939, #1946, #1948, #1949,
#1951, #1953, #1956, #1960, #1964, #1965, #1966, #1968, #1971.

**Follow-up session 2026-08-18** added #1975 (mastra abort), #1977 (gateway
handshake — merged but INERT, see Open items 2), #1982 (regression fix for
#1949). Open items amended accordingly.

---

## Read this first — the pattern that produced most of these bugs

**Five times in one day, a feature passed its tests, emitted correct data, and
was wrong or invisible on screen.** Every instance was found by hand, late, by
driving a browser. If you change the token chain, assume this will happen to you
too unless you check the rendered DOM.

| Shipped green | Actually true |
|---|---|
| Gateway filter stages (#1951) | Went into `TraceStepCard`, which focus mode never mounts |
| MCP handshake hops (#1953) | Only populate on the direct path; blank on the gateway path |
| Exchange "in flight" fix (#1965) | Test **set** `outcome:"ok"`; live runs leave it null, so nothing changed |
| Python CI suites (#1953) | `continue-on-error` reports `conclusion: "success"` — two suites were red |
| Scoped test run (#1946) | Grepped `tests/` and `__tests__/`, missed `src/__tests__/` |

The guard for this now exists:
`demo_api_ui/src/components/__tests__/FocusModeChainRenders.test.jsx`. It drives
the real store through the real focus-mode component tree and asserts the DOM. It
was verified to FAIL when the exchange fix is reverted — a guard nobody has
watched fail is a test that happens to pass.

**If you add a hop, add an assertion there.** A `buildTraceSteps` test proves the
model is right, not that anyone can see your work.

---

## Which component renders what (this cost four wrong guesses)

The dashboard runs in **split3 focus mode**:

```
SECTION.tcfs        TokenChainFilmstrip
  DIV.tcnr          TokenChainNodeRail      ← the numbered lane buttons
  DIV.sdp           StepDetailPanel         ← the detail sheet (SHARED)
```

`TokenChainTraceRail` (`.tctr-*`) and therefore `TraceStepCard` are **not
mounted** in this layout — `anyTctr: 0` in the live DOM. They belong to the
other rail layouts.

`StepDetailPanel` is rendered by BOTH rails, so step detail belongs there.

---

## What the chain now shows (was 1 box, is N calls)

| Hop | Before | After |
|---|---|---|
| `tools/list` | 1 | 401 challenge → authorized |
| `tools/call` | 1 | 401 challenge → authorized |
| Agent Gateway | 1 | 5 filter stages |
| **Authorize** | **1 visible** | **2 — the BFF's AND the gateway's own** |
| Token exchange | 1 card | 2 in two-exchange mode |

The second Authorize call is the one to point at in a demo: the gateway
independently asks PingOne again at its own perimeter, and they can disagree.

### The 401 probe is deliberate
`demo_api_server/services/mcpChallengeProbe.js` issues a credential-less request
on purpose so the challenge is real evidence, then follows the RFC 9728 pointer.
It is evidence-only: never let its result gate the authenticated call.

### Live gateway emits different filter names than the Node gateway
The IG route reports `McpValidationFilter`, `McpAuditFilter`,
`McpProtectionFilter`, `TokenIntrospection`, `P1AZDecision` — not the Node
gateway's `GatewayTokenPolicy`/`mTLS`/`BackendExchange`. Unknown stages render
under their raw name rather than being dropped; add labels to `GW_STAGE_META`.

---

## Bugs found that had nothing to do with the original question

1. **`recordTokenEvent` events never reached the client.** `agentRun.js` seeded
   from `buildSessionPreviewTokenEvents()`, a *different* array. Fixed with an
   allowlist merge — do not merge `req.tokenEvents` wholesale, the rest is
   internal bookkeeping that would render as cards.
2. **PingGateway advertised an unfetchable metadata URL.** `https://` on a
   plaintext port. `PG_GATEWAY_RESOURCE_ID` is a live token audience so it could
   not move; the listener moved to TLS instead (#1938). See `TECH_DEBT.md`.
3. **`agentRun` called an endpoint that does not exist.** `/tools/list` is served
   by nothing; `AGENT_GATEWAY_URL` was unset so it dialled the BFF itself.
   **The first fix (#1949) was itself wrong** — it passed the agent
   client-credentials token, which has no `sub`, so the gateway rejected it and
   discovery still fell back to the hardcoded BANKING catalog. Corrected in
   #1982 to reuse `agentToolsResolver`, which resolves a DELEGATED token.
   Confirmed live: `tools/list — tools permitted 20`.
4. **A `localStorage` spy that only worked on Node 26.** CI runs Node 22; the
   Storage methods live in different places. Never spy on `localStorage` — use
   `vi.stubGlobal`.
5. **launchd killed the LLM every 5 minutes.** No `AbandonProcessGroup`, so the
   model servers died with their launcher. 148 cycles, zero survivors. Fixed by
   detaching into a new session (#1956).
6. **Exchange hop stuck on "in flight" forever** on successful runs, with its
   evidence blanked (#1966).

---

## Test coverage added

**~1,076 previously-unrun tests now gate CI.** Ten services had suites no job ran
— the pattern `ci.yml` already documented three times, at a scale nobody had
measured.

- Blocking: `demo_agent_service` (133), `demo_mcp_code_search` (32),
  `agent_token_service` (11), `demo_hitl_service` (49),
  `demo_api_resource_server` (8), `langchain_agent` (834), `llamaindex_agent` (9)
- Non-blocking, known red: `mastra_agent` (3), `openai_agent` (1),
  `pydantic_agent` (8)

**Watch out:** a `continue-on-error` step that FAILS reports
`conclusion: "success"` in the jobs API *and* the job goes green. Read the log's
summary line, never the conclusion.

---

## Open items

> **Amended 2026-08-18.** Items 1 and 2 were worked after the original handoff.
> Item 1 is resolved. Item 2 turned out to be wrong about WHERE the fix belongs —
> read it before touching the handshake.

### 1. Three red agent suites — RESOLVED for mastra (#1975)

Not stale tests. One production bug: `handleRun` aborted from `req.on('close')`,
and Node emits that when the REQUEST BODY completes, not on client disconnect. So
the run aborted after a single stream part, no text reached the emitter, and the
`anyVisibleOutput` guard correctly reported "no usable response". Proven with a
print inside the loop:

```
[DIAG] req close -> abort            <- before the stream even starts
[DIAG] part 1 {"type":"tool-call",...}
[DIAG] BREAK: aborted after 1 parts
```

**The guard was right; the abort above it was wrong.** The tempting fix — relaxing
`anyVisibleOutput` — would have buried a live streaming bug. Fixed by listening on
`res` instead. `mastra_agent` 33/36 → 36/36 and is now a BLOCKING gate.

**Still open:** `openai_agent` (1) and `pydantic_agent` (8) fail the same way and
share the same guard, but they are FastAPI — the `req`/`res` close semantics do
NOT carry over. Deliberately not pattern-matched. Someone should diagnose them
directly.

### 2. Gateway upstream MCP handshake — ATTEMPTED, INERT (#1977). See TECH_DEBT.

The original text below was right about the goal and wrong about the target.
`X-Gw-Mcp-Handshake` was added to the **Node** gateway (`demo_mcp_gateway`), but
tool calls go to **PingGateway (IG)**:

```
[GW→PingGateway] REQUEST: url=http://ping-gateway:8080/mcp
MCP_GATEWAY_HTTP_URL=http://ping-gateway:8080
```

A live `list_orders` call returns the gateway and challenge events but no
`mcp-initialize` / `mcp-initialized`. The code is correct and tested; it simply
never runs in this configuration. **Do not delete it** — it is live support for
the non-default Node-gateway path.

The tell was already on screen: the filter stages that render are
`McpValidationFilter`, `McpAuditFilter`, `McpProtectionFilter` — IG names, which
we had even written labels for. Right code, wrong host; the same shape as the
`TraceStepCard` mistake above.

Full analysis and the two candidate fixes are in `TECH_DEBT.md` (2026-08-18).

### 3. A regression this session introduced and fixed — worth knowing about

#1949 switched agent-run discovery off a dead endpoint but passed the agent
CLIENT-CREDENTIALS token, which carries no `sub`. The gateway rejected it
("Empty or missing token payload") and every run silently fell back to the
hardcoded BANKING catalog — so in a non-banking vertical the model had nothing
relevant and often made no tool call at all. Fixed in #1982 by reusing
`agentToolsResolver`, which resolves a delegated token. Confirmed live:
`tools/list — tools permitted 20`.

**If you are reading agent behaviour recorded on 2026-08-17 between #1949 and
#1982, treat it as suspect.**

### 4. TECH_DEBT entries
- `PG_GATEWAY_RESOURCE_ID` is both the token audience and the metadata URL source
- `demo_agent_service` tests import across the package boundary into
  `demo_api_server/lib/vault` (needs the sibling's `argon2`)
- The handshake-on-the-wrong-gateway analysis (2026-08-18)
- No check proves a chain hop is reachable on the gateway actually in use
  (2026-08-18)

### 5. Not verified, and not claimed

The handshake hops have never been seen filling on the gateway path, for the
reason in item 2. Separately, the local model frequently answers "List my orders"
without invoking a tool even with 20 tools permitted and history cleared, so live
runs often do not exercise the tool path at all. Any live check here must
distinguish "feature broken" from "run never exercised it" — assert the hop ids in
the response `tokenEvents`, and treat a run with no `tools/call` hop as
inconclusive rather than as a failure.

---

## Environment notes

- **Host LLM is required** — Docker runs the proxy (:8090), the host runs
  `llama-server` (:8091, :8096) because `--n-gpu-layers` needs Metal, which
  Docker on macOS cannot pass through.
- After a `run-docker.sh restart ping-gateway`, the TLS listener binds a beat
  after the container reports started. Retry before concluding it is broken.
- `ping-gateway/config/admin.json`: `connectors[].port` must be a **scalar**. The
  PingGateway 2026 reference shows an array; `openig-core-2026.3.0` refuses to
  start on it.
- Driving the UI headless: the agent is inline on `/dashboard` (no FAB), and a
  `.dm-backdrop` modal will silently eat clicks — dismiss it first.
