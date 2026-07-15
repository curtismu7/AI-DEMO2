# Tracing Page Explain UI — Design

**Date:** 2026-07-15  
**Status:** Draft (brainstorming complete; awaiting written-spec review)  
**Page:** `https://ai-demo.ping-devops.com/tracing` (`demo_api_ui/src/pages/TracingPage.jsx`)  
**Author:** Curtis Muir (with Cursor)

---

## 1. Problem

`/tracing` is an educational surface for distributed traces (Jaeger via BFF
proxy), but visitors often cannot tell what they are looking at in practice:

1. **Empty default** — UI defaults to `demo-api-server`, which frequently has
   no traces in the lookback while other services (e.g. `mcp-gateway`,
   `agent-service`) do. Table looks broken.
2. **Row / detail semantics** — Once traces appear, operation, span count,
   duration, and the waterfall are under-explained relative to the dense
   glossary already on the page.
3. **Relationship to Token Chain** — Traces show cross-service latency; Token
   Chain shows the OAuth / MCP token story. Presenters and solo explorers need
   that distinction in one sentence plus a link — not a second always-on panel.

Recent ops noise (BFF rollouts → nginx 502 / “socket hang up”) made empty vs
outage harder to distinguish and must be called out in error copy.

## 2. Goals

| Audience | Need |
|----------|------|
| SE / Ping eng presenting live | Land on a service that already has traces; talk to row/detail without hunting |
| Solo customer / prospect | Same UI; copy works without a presenter |

**Behavior rules (locked):**

- **First visit:** Prefer **auto-select** of a useful service (most recent traces
  in the current lookback; fallback: first entry from `/services`).
- **After the user picks a service manually:** Use the **explanatory empty
  state only** when that service returns zero traces. No permanent presenter
  notes / legend rail.
- Keep Jaeger “Open UI” / expand detail; do not re-instrument OTEL.

## 3. Non-goals

- Scenario chips (“Agent tool call”, “HITL”, …).
- Always-on legend / presenter notes panel.
- Changes to Jaeger itself or OTEL exporters.
- Production-hardening of Jaeger reliability (ops topic; only clearer client
  error distinction in this work).
- Rewriting the large “What am I looking at?” block wholesale — trim / retarget
  so it does not compete with contextual empty/detail help.

## 4. Approach (chosen)

**Smart defaults + contextual copy** (Approach 1 from brainstorming).

### 4.1 Service preference

- `localStorage` key: `tracing.selectedService`.
- **Absent** → first-visit auto-select path; treat selection as *auto* for that
  session until the user changes the dropdown.
- **Present** → honor stored value; any further dropdown change is *manual*.

### 4.2 Auto-select algorithm (v1, client-side)

After `/api/health/tracing/services` succeeds:

1. If stored service is in the list → use it (manual/prior preference).
2. Else, for a bounded set of candidates (all services, or cap ~8, prefer
   names known to emit demo traffic: `demo-api-server`, `mcp-gateway`,
   `agent-service`, `langchain-agent`, `mcp-server`, `hitl-service`):
   fetch `GET /api/health/tracing/traces?service=…&limit=5&lookback=<current>`
   in parallel (or short serial) and pick the service whose newest
   `startTime` is latest among non-empty results.
3. If all empty → first service in the API list (not a hardcoded dead default).
4. Then load the normal traces table for the chosen service.

Optional later: BFF “recommend service” endpoint if probe chatter is noisy.
**Out of scope for v1** unless implementation proves too chatty in review.

### 4.3 Empty states

| Condition | UI |
|-----------|----|
| Auto path, still zero traces | Light tip: generate traffic (sign-in, agent, transfer); optional Token Chain link. Not the full “why empty” explainer. |
| Manual service (or stored preference) + zero traces | Full explainer: wrong service / narrow window / no traffic yet; suggest another service, widen lookback, generate traffic; link to Token Chain. |
| Loading | Existing “Loading traces…” |
| Network / 5xx / socket hang up | Distinct from empty: “Backend briefly unavailable — retry” + Retry. Do not say “no traces.” |

### 4.4 List & detail captions

- Table column headers: short `title` tooltips (operation = entry span name;
  spans = steps across services; duration = end-to-end; start = wall clock).
- Expanded `TraceDetail`: one-line waterfall legend (service name · operation ·
  bar = relative time in this trace).
- Reduce always-on glossary weight (collapse by default or shorten subtitle +
  glossary) so contextual empty/detail copy is the primary teacher.

### 4.5 Token Chain bridge

- One persistent secondary link near filters or header to
  **`/monitoring/token-chain`** (existing `TokenChainDisplay` route — do not
  invent a new page; do not require opening the floating panel from this page).
- One sentence: *Traces show where time is spent across services; Token Chain
  shows the OAuth and MCP token hops for the same kinds of demo actions.*

## 5. Components & files

| Piece | Location |
|-------|----------|
| Page behavior + empty/auto logic | `demo_api_ui/src/pages/TracingPage.jsx` |
| Styles | `demo_api_ui/src/pages/TracingPage.css` |
| Tests | `demo_api_ui/src/pages/__tests__/TracingPage.test.jsx` (or colocated pattern the UI suite already uses) |
| BFF | No change for v1 |

## 6. Data flow

```
mount
  → loadStatus + loadServices
  → resolveService (storage | auto-probe | first)
  → loadTraces(service, lookback)
  → render table | light empty | full empty | error

service <select> onChange
  → persist localStorage
  → flag manual
  → loadTraces
  → full empty if zero

expand row
  → GET /api/health/tracing/traces/:id (unchanged)
  → TraceDetail + short legend
```

Refresh interval (15s) continues to reload traces for the **current** service
only; it must not re-run auto-select after the user has a resolved service.

## 7. Error handling

- Keep Jaeger connected / unreachable pill from `/status`.
- Map fetch failures (502 HTML from nginx, TypeError/network, non-OK JSON) to
  the retry banner; leave `traces` uncleared or clear with explicit outage copy
  so the UI does not look like a successful empty query.
- Do not special-case Jaeger pod flapping beyond clearer client messaging.

## 8. Testing

Mock `fetch` in unit tests:

1. No storage + services A/B where only B has traces → selects B.
2. Storage set to A → selects A even if B has newer traces.
3. Manual change to empty service → full explainer visible; auto-first empty
   does not show full explainer.
4. 502 / failed fetch → outage copy + Retry, not “No traces yet”.

No live Jaeger in CI.

## 9. Success criteria

- First load on a healthy SE demo with traffic in *some* service shows a
  non-empty table without the user changing the dropdown.
- After intentionally choosing a quiet service, the empty state explains what
  to do next and links Token Chain.
- SE can narrate operation / spans / duration / waterfall without opening
  docs.
- Transient BFF 502 is not mislabeled as “no traces.”

## 10. Implementation notes

- Minimal diff: name the page, change selection + empty/error + captions; avoid
  unrelated `/tracing` restyles.
- Emoji allowlist: no new decorative emojis.
- Work in a git worktree; stage named files only.
- REGRESSION_PLAN §0 applies to any UI copy/chrome changes on this page.
