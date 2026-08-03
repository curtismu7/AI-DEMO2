# Guided Demo Track — Design

Date: 2026-08-03
Status: approved in brainstorming (mocks reviewed in browser)

## Goal

A curated, ordered demo track over the existing use-case catalog so that every demo step ends with an unmistakable statement of what was just demoed / proved / taught. Mixed exec-friendly audience: story first, protocol proof on drill-down. The catalog (`demo_api_server/config/useCases.js`) stays as-is — the track is a curation + presentation layer on top.

Core pattern: **every step ends green AND red.** Each step pairs a permitted flow with its matching denial (bad aud, invalid token, over-limit, bypass attempt…), so "we are protecting" lands on every step, not parked in one.

## The track — 2 acts, 9 steps

### Act 1 — The Customer Agent
*"One user, one agent, real money — prove every action is governed."*

| # | Step | Green (permit) | Red (paired deny) | Backing UCs |
|---|------|----------------|-------------------|-------------|
| 1 | Delegated access — token exchange (RFC 8693, `act` claim) | Delegated call succeeds | Stolen/replayed token, bad `aud` rejected at gateway | UC1, UC3, UC12 |
| 2 | A2A delegation — nested `act` chain | Specialist handoff works, scope narrowed | Confused-deputy actor injection blocked | UC2, UC2.5, UC13 |
| 3 | Fine-grained authz — PingOne Authorize | Transfer under limit permitted | Over-limit denied + "why was that blocked?" explainability (red is the star) | UC6, UC35 |
| 4 | Step-up authentication | Transfer completes after MFA | Attempt without step-up = 428 challenge (deny inherent) | UC7 |
| 5 | HITL / CIBA out-of-band approval | Human approves on second device | Agent bypass attempt fails | UC8, UC22, UC27 |
| 6 | MCP Gateway — third-party MCP protection | External MCP scoped at gateway | Out-of-scope call denied; live policy reconfig flips behavior on stage | UC30, UC31, UC32 |
| 7 | **Attack gauntlet** (Act 1 finale) | — | Rapid-fire batch: overscoped (UC4), wrong scope (UC5), cross-owner (UC10), bad client (UC11), impersonation (UC16), introspection outage fail-closed (UC29). Live verdicts via UC26 proof-of-enforcement. | UC4, 5, 10, 11, 16, 29, 26 |

### Act 2 — Same Rails Govern the Admins
*"The AI that manages your identity platform is itself governed by it."*

| # | Step | Green | Red | Backing UCs |
|---|------|-------|-----|-------------|
| 8 | PingOne MCP server — admin agent | Admin agent does real admin task via Ping's hosted MCP | Out-of-scope admin call denied | UC-LEARN2, admin vertical |
| 9 | Agent lifecycle + kill switch (closing beat) | Agent provisioned like workforce identity, working | Kill switch — agent revoked mid-task, next call dies | UC19 |

Cut from headline (stay in catalog): PAR/RAR intent (UC14/14b/15 — foldable into step 4 or 7), ID-JAG / enterprise MCP (UC25/LEARN8/9), audit trail (UC20 — woven into every takeaway card instead of its own step).

## Three surfaces, one shared live track state

All three read/write the same server-side track state, so the presenter can hop between them mid-demo.

### 1. Standalone page (side nav: "Guided Demo Track")
Full presenter view — mock: `demo-track-mock.html`.
- Progress dots grouped by act in a sticky top bar.
- Act banners as labeled breaks.
- Step cards: buyer story, green run row, red run row, then a **"WHAT THIS PROVED"** takeaway card.
- Step 7 renders as a gauntlet grid (6 attack tiles, "Run all", live BLOCKED verdicts, running score).
- Collapsed steps show a one-line green·red summary — track scans in ~10 seconds.
- **History:** page shows the latest track run and lets you go back to previous runs (run picker). This is the review-after-the-demo surface.
- Finish state: summary card — 9 capabilities, permits + denials each with decision evidence. Printable leave-behind.

### 2. Token Chain panel tab ("Demo Track", live)
Mock: `demo-track-tokenchain-tab-mock.html`. 5th tab on the existing tab row in `TokenChainDisplay.jsx` (`current | mcp-results | history | trust | demo-track`).
- Pulsing live dot on the tab while a flow is in flight.
- Each step shows two **slots** (green/red). Slots fill *themselves* from real runs — no clicks: when a completed chain matches the step (see Matching), the slot stamps verdict + timestamp + decision-ID link into the existing token detail views.
- Current step expands: run lines with mini token-chain strips. Green: `user token → RFC 8693 (act) → P1AZ PERMIT → tool`. Red: chain **stops at the deny**, tool node struck through — never called.
- When both slots fill, the "STEP N PROVED" card fades in inline.
- Footer: running score + "Open full track page ↗".

### 3. Agent header dropdown (embedded AND floating agent)
Mock: `demo-track-agent-mock.html`. Both agent variants share the header component — one dropdown implementation covers both.
- Header control: `Demo Track: Step 3 of 9 ▾`.
- Step picker panel: 9 steps with act labels, done checkmarks, "Open full track page ↗".
- **The panel is a `DraggableModal`** (standing rule: all modals use DraggableModal) — which already provides drag, 8-direction resize, and pop-out to its own window (`DraggableModal.jsx`). No new modal plumbing.
- Picking a step: drops a track banner into the chat (step title + buyer story) and swaps the chip row to that step's **green chip / red chip** (color-coded ✓/✕) + "why was that blocked?".
- Runs go through the REAL customer-dashboard agent (LangGraph dispatch, real tools) — the token chain is the extra proof, rendered live in surface 2.
- After both runs: compact takeaway inline in chat + "Next: Step N+1 →" button, so the whole track can be walked without leaving the dashboard.

## Track state, matching, persistence

- **Track definition:** static config in `demo_api_server` (e.g. `config/demoTrack.js`): ordered steps, act, title, buyer story, green/red chip text, backing UC ids, takeaway copy ("proved" lines + SAY THIS talk track). Served via the existing use-cases API surface.
- **Matching:** reuse what `useCases.js` entries already carry — `match: { tool }`, `expectedOutcome`, triggers. A completed run (tool + verdict) that matches a step's green or red UC fills that slot. No new instrumentation of the agent path.
- **Run ledger:** server-side track-run record (start time, per-slot: verdict, timestamp, decision id, chain ref). Persisted alongside existing demo data (LMDB store like conversation history) so the standalone page can list previous runs. "Start new run" resets slots but keeps history.
- **Live updates:** the token-chain panel already live-updates as chains grow; the track tab subscribes to the same event source. Standalone page polls or shares the same feed.

## Takeaway card anatomy (all surfaces)

1. Header: `STEP N PROVED` / `WHAT THIS PROVED`.
2. ✓ line — what the permit proved (plain language, names the product doing the work).
3. ✕ line — what the deny proved, with decision ID.
4. **SAY THIS** talk track — one-sentence presenter line (from `whatToSay` lineage).
5. Drill-down (page + tab): decision evidence JSON, act chain, token claims — the technical layer for the mixed audience.

## Known gaps this commits us to fix

- UC16 impersonation sim false pass — missing `from_account_id` 400s before policy; must actually reach policy to be an honest gauntlet tile.
- UC2 A2A 502s in some verticals — step 2 green path must run clean.
- Step 8 red path (out-of-scope admin call denied) needs live verification.

## Non-goals

- No restructure of `useCases.js` / catalog pages.
- No new use cases — track only curates existing ones.
- No changes to auth, token exchange, or session handling (REGRESSION_PLAN §0/§1 protected areas; the track is read-only over existing flows).

## Success criteria

1. Presenter can run all 9 steps end-to-end from any surface; every step ends showing its takeaway card with a real decision ID for both green and red.
2. Track tab fills slots live with zero clicks while flows run from the agent.
3. Agent dropdown is draggable, resizable, and pops out (DraggableModal behaviors verified).
4. Standalone page shows the current run and at least the previous run's history.
5. Gauntlet shows 6/6 BLOCKED with live UC26 verdicts — including a fixed UC16.
6. UI build + unit gates green (`cd demo_api_ui && npm run test:unit && npm run build`); emoji allowlist respected.

## Mock references

Reviewed in-browser 2026-08-03, preserved under `assets/2026-08-03-guided-demo-track/`:
- `demo-track-mock.html` — standalone page
- `demo-track-agent-mock.html` — dashboard + floating agent dropdown + inline token-chain strips
- `demo-track-tokenchain-tab-mock.html` — live Token Chain tab
