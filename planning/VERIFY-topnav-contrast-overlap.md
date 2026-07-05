# Verification request — TopNav contrast + overlap fix (PR #179)

Audience: an independent agent session verifying work done 2026-07-05.
Everything needed to check the fix is in this file. Do not take the claims
below on trust — re-derive each one.

## What was changed

Merged to `main` in PR #179, merge commit `9272bf0f4`, fix commit `623c69744`.
CSS-only, three files, plus a `REGRESSION_PLAN.md` §4 log entry:

| File | Change | Claimed reason |
|---|---|---|
| `demo_api_ui/src/components/TopNav.css` | new rule `.topnav-right-scroll > * { flex-shrink: 0; }` | right-side nav row is an `overflow-x: auto` scroll container, but shrinkable items spilled their `nowrap` content over neighbors instead of making the row scroll |
| `demo_api_ui/src/components/AgentUiModeToggle.css` | `--config` variant label + fab checkbox: `#374151` → `var(--brand-topnav-text, #ffffff)` (2 declarations) | "Choose layout" / "Always float" were dark-gray-on-blue in the topnav, the variant's only mount |
| `demo_api_ui/src/components/QuickFlagsPill.css` | `.qfp-pill`: `color: inherit` → `var(--brand-topnav-text, #ffffff)` | pill inherited the dark app body color on the topnav |

Reported symptom (user screenshot, customer dashboard, Super Banking blue
skin): "Choose layout"/"Always float" nearly invisible, and the Reset Demo
button / ADMIN token pill / search icon painting over each other right of the
Controls button.

## Claims to verify

1. **C1 — overlap fixed, mechanism correct.** Below ~1100 px viewport width
   (signed out; wider when signed in) the pre-fix row overlapped elements;
   post-fix the row scrolls horizontally instead and no two items in
   `.topnav-right-scroll` intersect at any width.
2. **C2 — label contrast fixed.** `.agent-ui-mode-toggle--config` label and
   `__fab` text compute to the brand topnav text color (white on default and
   Super Banking skins), not `rgb(55, 65, 81)`.
3. **C3 — pill contrast fixed.** `.qfp-pill` computes to the brand topnav text
   color, not the inherited `rgb(61, 69, 77)`.
4. **No collateral damage.** The diff touches no JS/JSX; TopNav structure,
   session actions (Switch / Sign Out always visible outside the scroll area),
   AgentUiModeToggle behavior (placement persistence + reload), and QuickFlags
   dropdown behavior are unchanged. The `--config` toggle variant is mounted
   ONLY in `TopNav.js`, and `QuickFlagsPill` is mounted ONLY in `TopNav.js` —
   if either claim is false, the white text may regress a light-background
   surface somewhere else.
5. **Build gate.** `cd demo_api_ui && npm run build` exits 0.

## How to verify

Work in your own worktree; do not edit the shared main checkout.

### Static checks (fast)

```bash
git show 623c69744 --stat            # expect: 4 files, +26/-3, CSS + REGRESSION_PLAN.md only
git show 623c69744 -- demo_api_ui    # read the actual diff against the claims table above
grep -rn 'agent-ui-mode-toggle--config' demo_api_ui/src --include='*.js' --include='*.jsx'   # C4: variant class set only via AgentUiModeToggle.js; component used with variant="config" only in TopNav.js
grep -rn 'QuickFlagsPill' demo_api_ui/src --include='*.js' | grep -v test                    # C4: import + mount only in TopNav.js
```

### Behavioral checks (headless, no sign-in needed)

The running Docker stack serves the main checkout's working tree on
`https://api.ping.demo:4000` — **check `git -C /Users/cmuir/Development/AI-DEMO2
branch --show-current` and `git status` first**; if the main checkout has not
merged/pulled `main` past `9272bf0f4`, :4000 still serves the OLD css and is
useless for verifying the fix. In that case serve the code under test yourself
from your worktree (symlink `node_modules` from the main checkout's
`demo_api_ui`, symlink repo-root `certs`, provide a `demo_api_ui/.env` — without
it the app throws "process is not defined" and renders nothing):

```bash
cd <worktree>/demo_api_ui && npx vite --port 4573 --strictPort
```

Then run a geometry + color probe (playwright is available via
`demo_api_ui/node_modules` in the main checkout). Pass criteria at viewport
widths 1000, 1100, 1600 on `/dashboard`:

- zero intersecting bounding-box pairs among the children of
  `.topnav-right-scroll` and `.topnav-dashboard-controls`
  (>2 px overlap in both axes = fail);
- at 1000/1100 the row actually overflows (`scrollWidth > clientWidth`) —
  proves the no-shrink mechanism, not just "wide enough to fit";
- computed `color` of `.agent-ui-mode-toggle--config .agent-ui-mode-toggle__label`,
  `... .agent-ui-mode-toggle__fab`, and `.qfp-pill` is `rgb(255, 255, 255)`
  (default skin; more generally: equals resolved `--brand-topnav-text`).

Reference numbers from the original verification (2026-07-05, worktree UI):
pre-fix at 1100 px the search button overlapped Reset Demo by 36 px; at
1000 px two overlaps; post-fix zero overlaps at all three widths, row
scrollWidth 580 vs clientWidth 520/420.

### Build gate

```bash
cd <worktree>/demo_api_ui && npm run build   # must exit 0
```

### Worth eyeballing (not covered by the probes)

- Signed-in state (customer login) at ~1300–1500 px: token pill + Switch +
  Sign Out all visible, nothing overlapping; session actions must NOT scroll
  away (they sit outside the scroll row — REGRESSION_PLAN §1 TopNav row).
- Verticals other than Super Banking (VerticalSwitcher in the nav): any skin
  that sets a LIGHT `--brand-dashboard-header-*` needs `--brand-topnav-text`
  set dark, else the now-hardcoded-white fallback text washes out. At the time
  of the fix all skins used dark/blue headers with white text.
- `/setup` and admin pages also render TopNav (without the dashboard controls
  cluster) — QuickFlagsPill appears there too.

## Known pre-existing issues deliberately NOT touched (don't attribute to this fix)

- `QuickFlagsPill.js` uses 🔎/🔐 emoji in labels; 🔎 is outside the
  REGRESSION_PLAN §0 allowlist. Pre-dates this change.
- The "Introspect" pill renders at 0.55 opacity when muted (read-only /
  no admin session) — dimmed white is intended post-fix, not a regression.
- Main checkout working tree is dirty on `fix/architectural-improvements`
  (other sessions' work) — unrelated.

## Reporting

Record findings per claim (C1–C5: pass / fail with evidence). If anything
fails, do not patch it silently — file the discrepancy back to the user with
the failing command output. The fix's own log entry is in `REGRESSION_PLAN.md`
§4 ("TopNav: dark-on-blue labels and controls painting over each other");
if you confirm a regression, that entry's "Do not break" line is the contract
that was violated.
