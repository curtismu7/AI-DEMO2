# Use Cases page — "Learn" track of launcher cards

**Date:** 2026-07-01
**Status:** Approved design, pending implementation plan

## Problem

The Use Cases page (`/use-cases`, [UseCaseLauncherPage.js](../../../demo_api_ui/src/pages/UseCaseLauncherPage.js))
is a launcher: cards grouped into 4 tracks (Foundations / Attacks / HITL / Controls),
each with a `trigger` of type `chip` or `attack` that **runs a scenario**.

Several existing pages in the side nav are self-contained *learning* experiences —
most notably the **PingOne MCP inspector**, which calls the hosted PingOne MCP server
live. Today they are reachable only via the side nav. We want to surface the best of
them on the Use Cases page as cards that, instead of running a scenario, just **launch
the existing page** so the Use Cases page becomes the single on-ramp for both "run a
demo" and "go learn X".

## Goal

Add a 5th track, **Learn**, to `/use-cases` containing launcher cards. Each card
navigates (same tab) to an existing educational page. No scenario execution.

### The six cards (routes confirmed against AdminSideNav.jsx)

| Card | Route | Rationale |
|---|---|---|
| PingOne MCP Inspector | `/pingone-mcp-inspector` | Named by the user — calls the hosted PingOne MCP server live |
| Demo MCP Inspector | `/mcp-inspector` | The demo's own banking MCP server; natural pair |
| MCP Tools | `/mcp-tools` | "What is MCP" education panel |
| OAuth Academy | `/oauth-academy` | OAuth teaching module |
| Learning Hub | `/learning` | Learning landing page |
| Token Flow (Interactive) | `/architecture/token-flow` | Visual explainer of the delegation/token chain |

Explicitly **out of scope**: the AI Attack Demos pages (they overlap the existing
Attacks track and would duplicate).

## Design

### Key decision: frontend-only, no backend

The existing runnable cards live in the backend catalog
([config/useCases.js](../../../demo_api_server/config/useCases.js)) because they need
vertical resolution, maturity/flag gating, and run endpoints. That catalog also feeds
the audit table and docs generator.

Launch cards need **none** of that — they are vertical-agnostic and simply navigate.
So they live entirely in the frontend and do **not** touch the backend catalog (which
would otherwise pollute the audit/docs consumers with non-runnable entries).

### New trigger type: `launch`

Extend the trigger union with `{ type: 'launch', route: string }`.

### Frontend changes (all in [UseCaseLauncherPage.js](../../../demo_api_ui/src/pages/UseCaseLauncherPage.js))

1. **`LEARN_CARDS` constant** — static array of 6 entries, inline in the page file
   (small enough not to warrant a separate module):

   ```js
   const LEARN_CARDS = [
     { id: 'L1', track: 'learn', title: 'PingOne MCP Inspector',
       buyerStory: 'Call the hosted PingOne MCP server live and inspect its tools.',
       trigger: { type: 'launch', route: '/pingone-mcp-inspector' } },
     // ...Demo MCP Inspector, MCP Tools, OAuth Academy, Learning Hub, Token Flow
   ];
   ```

2. **Track wiring** — add `'learn'` to `TRACK_ORDER` (last, after `controls`) and a
   `TRACK_LABELS.learn` heading (e.g. `'Learn — explore the platform hands-on'`).

3. **Merge into render** — `const allCases = [...useCases, ...LEARN_CARDS];` and group
   `allCases` (instead of `useCases`) by track. The existing group-by-track render loop
   then picks up the Learn section unchanged.

4. **`UseCaseCard` launch branch** —
   - `const isLaunch = uc.trigger?.type === 'launch';`
   - Render an **"Open →"** button that calls `onLaunch(uc)`.
   - Suppress the flag-gate, maturity label, and Explain button for launch cards
     (they have no maturity and no explain content).
   - Exclude `launch` from the `!isChip && !isAttack` "No trigger defined" fallback.

5. **`handleLaunch`** — `const handleLaunch = useCallback((uc) => navigate(uc.trigger.route), [navigate]);`
   Wire it through to `UseCaseCard` as `onLaunch`.

6. **Header copy** — the subtitle hardcodes "N security use cases … Click Run to launch
   a scenario." Adjust so it does not misrepresent the Learn cards (e.g. drop the fixed
   count or split the sentence).

### CSS ([UseCaseLauncherPage.css](../../../demo_api_ui/src/pages/UseCaseLauncherPage.css))

Optional, light. The "Open →" button can reuse the existing `.uc-run-btn`. Add a Learn
track heading style only if the default heading looks off. No new layout.

### Placement

The Learn track renders **last** (after Controls) so runnable scenarios stay the primary
focus. Changing the order is a one-line edit to `TRACK_ORDER` if desired later.

## Non-goals

- No embedding/iframing — cards navigate in the same tab.
- No backend catalog, route, or docs-generator changes.
- No changes to the target pages themselves.
- Not surfacing AI Attack Demos here.

## Success criteria

- `/use-cases` shows a "Learn" section with all 6 cards.
- Each "Open →" navigates to the correct existing page.
- Chip/attack cards are unchanged; no new backend requests are made by the Learn track.
- Manual click-through of all 6 routes passes (webapp-testing / Playwright).
