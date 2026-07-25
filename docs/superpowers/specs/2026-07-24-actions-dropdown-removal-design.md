# Actions Dropdown Removal — Design

**Date:** 2026-07-24
**Status:** Approved (chat), spec written for review

## Problem

The AIAgent "Actions" dropdown (`demo_api_ui/src/components/BankingChips.jsx`, mounted
in `AIAgent.js`) duplicates a large share of `/use-cases` catalog content, plus holds
several items the catalog doesn't cover at all. Maintaining two separate chip-launch
surfaces (Actions popout + `/use-cases`) means every new chip has to be wired twice and
the two can silently drift. Goal: delete the Actions dropdown, make `/use-cases` the
single chip-launch surface, and cover every gap first so nothing is lost.

## Current state (as audited)

**Actions dropdown contents** (`BankingChips.jsx`, embeds `SecurityShowcasePanel.jsx`):

- Admin Actions (8, admin role): lookup/view-transactions/profile/accounts, freeze,
  adjust-balance, reset-password, delete-customer — banking customer CRUD
- PingOne Admin (6, admin role): list-apps, list-envs, services-enabled,
  identity-count, ai-agent-config, verify-apps
- Banking Actions primary rail (10) + "More demos" (5) — mostly already mapped to
  catalog UC ids
- Security Showcase tabs: Defenses (5), AI Reasoning (2), Attacks (6, subset of the
  catalog's 11 attack sims), PingOne Admin (6, duplicate of the section above)
- "My Actions" — user-saved custom chips (`useCustomChips` hook)
- Non-chip controls: free-text ask box, Read/Write `ScopePicker`, "Clear progress"

**`/use-cases` catalog** (`demo_api_server/config/useCases.js`, `RAW_USE_CASES`, 47
entries) already covers most of the rail/showcase/attack items. Confirmed gaps with no
catalog entry: "My mortgage" chip, the 2 AI Reasoning chips, and all 14
Admin/PingOne-Admin ops (verified against `RAW_USE_CASES`' `UseCase` typedef, which
requires `buyerStory`/`expectedOutcome`/`owasp` — fields that don't apply to plain
admin CRUD or platform ops. Confirmed by `demo_api_server/config/admin/demoSteps.js`'s
own header comment: PingOne-admin steps are deliberately kept out of this catalog
because they have "no consent/HITL gate or tokenChain evidence narrative to attach.")

## Decisions

1. **Admin Actions (8) + PingOne Admin (6)** → new lightweight list, same shape as
   `ADMIN_DEMO_STEPS` (`{id, title, trigger}`, no security-narrative fields), not
   squeezed into the `UseCase` schema.
2. **"My mortgage", 2 AI Reasoning chips** → 3 new full `UseCase` entries (UC33-35,
   track `foundations`).
3. **"My Actions" (custom chips)** → gets its own small section on `/use-cases`,
   reusing the existing `useCustomChips` hook — no new backend.
4. **Utility controls** (ask box, scope toggle, clear-progress) move out of the popout
   into the always-visible AIAgent header row. The ask box specifically is redundant
   and gets deleted outright — the main chat compose box (`ba-input-row`,
   `AIAgent.js:10278`) already does free-text dispatch.
5. **Actions dropdown removed entirely** once 1-4 are live and verified reachable.

## New content

### A. `RAW_USE_CASES` additions (`demo_api_server/config/useCases.js`)

| id   | title                  | track       | trigger                                                                             |
| ---- | ---------------------- | ----------- | ------------------------------------------------------------------------------------ |
| UC33 | My mortgage            | foundations | chip, mirrors UC1's shape (simple delegated-access read)                             |
| UC34 | Spot unusual patterns  | foundations | chip, LLM analysis of recent activity, evidence = activity log                       |
| UC35 | Why was that blocked?  | foundations | chip, LLM explains the last denial from the live token chain, evidence = tokenChain   |

Each gets full `buyerStory`/`pingOneSolution`/`expectedOutcome`/`evidence`/`owasp`/
`whatToSay` per the existing `UseCase` typedef, drafted at implementation time by
following the nearest existing `foundations` entry's structure and tone (UC1 for
UC33; UC20 "Audit trail" for UC34/35, since both are evidence/tokenChain-driven).

### B. Admin Tools list (new)

New file `demo_api_server/config/adminTools.js`, mirroring
`demo_api_server/config/admin/demoSteps.js`:

```js
const ADMIN_TOOLS = [
  // banking customer CRUD (8) — normal MCP tool chips, no special routing
  { id: 'ADMTOOL1', title: 'Look up customer', trigger: { type: 'chip', text: '...' } },
  // ... view-transactions, view-profile, view-accounts, freeze-account,
  //     adjust-balance, reset-password, delete-customer
  // PingOne platform ops (6) — routed to the isolated admin agent, see below
  { id: 'ADMTOOL9', title: 'List all apps', trigger: { type: 'chip', text: '...' }, adminAgent: true },
  // ... list-envs, services-enabled, identity-count, ai-agent-config, verify-apps
];
```

New route `GET /api/admin-tools?vertical=` (separate from `/api/use-cases` — different
shape, role-gated).

### C. My Actions section

`/use-cases` renders a small section from `useCustomChips()`, same data BankingChips
already reads, no backend change.

## UI wiring

### Dispatch consolidation (the actual risk in this change)

Three dispatch paths exist today:

- `handleDemoStepSelect` (`AIAgent.js:6290`) — drives `DemoStepsDropdown`, handles
  chip/attack/edu/link triggers generically.
- `/use-cases`'s own inline dispatch — `POST /api/use-cases/demo/run` then
  `navigate('/dashboard', {state:{triggerText, useCaseId}})`; AIAgent.js consumes this
  via the `location.state` effect at `AIAgent.js:1063-1070`, which resumes into the
  generic NL pipeline.
- The Actions popout's `onChipClick` (`AIAgent.js:7961+`) — the **only** path with
  admin-agent routing: `PINGONE_ADMIN_CHIP_IDS.has(chipId)` → `POST
  /api/admin-agent/message` (`AIAgent.js:8305-8330`).

Removing the popout removes that admin-agent branch unless ported. Fix: extend the
`location.state` consumer effect to accept an `isAdminAgent` flag and branch to
`/api/admin-agent/message` before falling into the generic NL-resume path, porting the
~25-line block at `8305-8330`. The 8 banking Admin Actions need no new plumbing — they
resolve like any other MCP-tool chip via the existing `triggerText` resume path.

### Component removal

`BankingChips.jsx` and `SecurityShowcasePanel.jsx` are used nowhere outside the Actions
popout (verified via repo-wide grep) — delete both once their content is migrated:

- Primary rail (10) + More-demos (5) + Defenses tab (5): plan-phase task audits each
  chip's `useCaseId`/`USE_CASE_TO_DEMO_STEP` wiring against the catalog before deletion,
  fixing any that resolve to the wrong entry.
- Attacks tab (6): already a subset of the catalog's 11 attack-sim entries.
- AI Reasoning (2) / PingOne Admin (6) tabs: covered by UC34/35 and the new Admin
  Tools list respectively.

### Header controls

In `AIAgent.js`'s header row (~7754-7796): delete the `Actions` trigger button and the
`ba-actions-popout` block (7850-7939) including its free-text search box. Keep
`ScopePicker` and "Clear progress" as permanent inline controls in the same row, styled
as **Option A1 — labeled buttons** (matches the existing `Guide`/`Demo steps` button
style exactly; see mockup, option A3 "grouped pill" was the runner-up if A1 reads too
busy once built).

### Page layout

`UseCaseLauncherPage.js` gets two more entries in the existing per-track grid —
**Option B2 — tracks in the grid**: "Admin Tools" (role-gated) and "My Actions" render
as two more sections in the same list every other track (`foundations`/`controls`/
`attacks`/etc.) already uses. No new section component, no new visual language; Admin
Tools naturally sorts near the bottom since it's role-gated. `LiveUseCaseWorkbenchPage.js`
is unchanged — it's the technical live-run view, not the discovery surface, and doesn't
need the admin/custom sections.

## Verification

- `useCases.primaryTool.test.js` drift gate passes for UC33-35
- New unit tests: `adminTools.js` list shape, `/api/admin-tools` route (403 for
  non-admin)
- Manual: every former Actions-dropdown chip reachable and dispatches correctly from
  `/use-cases`, especially the 6 PingOne-Admin ones hitting `/api/admin-agent/message`
  and not falling into the generic NL path
- `npm run topology:verify` (chip routing is part of the drift gate)
- Update or remove e2e Playwright specs that reference `.ba-actions-trigger` /
  `.ba-actions-popout`

## Out of scope

- Redesigning the `/use-cases` page beyond the two new grid sections
- Changing the `DemoStepsDropdown` ("Demo steps ▾") — it is a separate control from
  Actions and is not being touched
- Any change to the 6 attack sims not currently surfaced in the Showcase tab
  (cross-owner-account, rar-exceeded, tampered-intent-token, rate-limit-burst,
  introspection-down) — pre-existing gap, unrelated to this change
