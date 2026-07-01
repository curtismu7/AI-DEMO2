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

> **Implementation note (revised during build):** The original draft proposed a new
> `launch` trigger type and a frontend-only static array. On inspecting current
> `origin/main` we found the mechanism already exists: a **`link`** trigger type
> (`{ type: 'link', path, label }`) with an "Open" button + `handleOpen` navigation, and
> a 5th **`tools`** ("Developer Tools") track whose cards are sourced from the **backend
> catalog** (`config/useCases.js`) — including an existing `oauth-academy` link card.
> The design below reflects what was actually built: reuse the `link` type and the
> catalog-driven pattern rather than inventing a parallel one.

### Key decision: reuse the existing `link` trigger + backend catalog

Link cards already live in the backend catalog and render via the existing `isLink`
branch. Adding Learn cards is therefore **data + one track label**, not new UI plumbing.
We add a `learn` track to the catalog and register it in the frontend's track list.

### Catalog changes ([config/useCases.js](../../../demo_api_server/config/useCases.js))

- **Relocate** the existing `oauth-academy` card from `track: 'tools'` → `track: 'learn'`
  (renumbered `UC-TOOL3` → `UC-LEARN1`; no external refs to the old id). This dedups —
  OAuth Academy belongs with the learning material, not Developer Tools.
- **Add 5 new `link` cards** in a new `// --- LEARN ---` section, following the existing
  link-card shape exactly:

  | id | useCaseId | path | title |
  |---|---|---|---|
  | UC-LEARN2 | pingone-mcp-inspector | `/pingone-mcp-inspector` | PingOne MCP Inspector |
  | UC-LEARN3 | demo-mcp-inspector | `/mcp-inspector` | Demo MCP Inspector |
  | UC-LEARN4 | mcp-tools | `/mcp-tools` | MCP Tools |
  | UC-LEARN5 | learning-hub | `/learning` | Learning Hub |
  | UC-LEARN6 | token-flow | `/architecture/token-flow` | Token Flow (Interactive) |

- **Typedef** — extend the `Trigger` union to include the `link` variant and add
  `'tools'|'learn'` to the `track` property (both were already stale on main).

Result: Developer Tools keeps `code-search` + `code-explorer`; Learn holds the 6 cards.

### Frontend changes ([UseCaseLauncherPage.js](../../../demo_api_ui/src/pages/UseCaseLauncherPage.js))

- Add `'learn'` to `TRACK_ORDER` (positioned **before `tools`**, after `controls`) and a
  `TRACK_LABELS.learn` heading: `'Learn — explore the platform hands-on'`.
- No other changes — the `isLink` render branch, `handleOpen`, and the group-by-track
  loop already handle everything.

### CSS

None. Link cards reuse the existing `.uc-run-btn` styling already used by Developer Tools.

### Placement

`learn` renders after `controls` and before `tools`, so the two link-based tracks sit at
the end with learning material ahead of developer utilities. Reordering is a one-line
edit to `TRACK_ORDER`.

## Non-goals

- No embedding/iframing — cards navigate in the same tab.
- No new trigger type, no docs-generator changes.
- No changes to the target pages themselves.
- Not surfacing AI Attack Demos here.

## Success criteria

- `/use-cases` shows a "Learn" section with all 6 cards.
- Each "Open →" navigates to the correct existing page.
- Chip/attack cards are unchanged; no new backend requests are made by the Learn track.
- Manual click-through of all 6 routes passes (webapp-testing / Playwright).
