# Progressive Trust Demo — catalog slim + strip references existing UCs

**Date:** 2026-07-08  
**Status:** Implemented  
**Audience:** 1:1 buyer / SE calls (B) and internal enablement (C)  
**Related:** [PLAN-progressive-trust-demo.md](../../../planning/PLAN-progressive-trust-demo.md)

## Problem

The progressive trust demo added **UC25–UC28** in the `demo` track. They duplicate
behavior that already exists elsewhere:

| Duplicate (demo track) | Existing source UC | Same chip / behavior |
|---|---|---|
| UC25 `progressive-trust-authenticated-access` | UC1 `delegated-access-with-proof` | balances / exchange |
| UC26 `progressive-trust-hitl-consent` | UC8 `hitl-consent` | `transfer $300 to savings` |
| UC27 `progressive-trust-ciba-approval` | UC22 `ciba-out-of-band-approval` | `transfer $600` + CIBA (FF) |
| UC28 `progressive-trust-policy-deny` | UC6 `authz-denied` | `transfer $2500 to savings` |

Only **Act 1** (`get_branch_hours` / UC24) was net-new capability. Maintaining six
demo-track catalog rows inflates docs, tests, and confuses presenters ("which $600 is
MFA vs CIBA?").

**UC7** `step-up-required` already covers **`transfer $600` → MFA step-up** (always
`works`). **UC22** covers the same chip text with **CIBA** when `ciba_enabled` is on.
Both must remain distinct; the progressive trust ladder should not imply CIBA is the
only $600 path.

## Goal

1. **Remove** catalog duplicates UC25–UC28.  
2. Keep **UC23** (presenter guide) and **UC24** (Act 1 public catalog — only new tool).  
3. **Strip references existing UCs** by id/slug for Run + Explain.  
4. **Act 4A:** Act 4 = UC7 MFA always; optional **Act 4b** = UC22 CIBA when FF on.  
5. **Demo flow:** Act 1 from launcher; Acts 2–5 on dashboard with panels open (launcher
   Explain + Act 1 Run only; no return-to-launcher between Acts 2–5).

## Non-goals

- PingOne policy / threshold changes (Phase 4 Option A stays).  
- New MCP tools or auth pipeline changes.  
- Removing UC7, UC8, UC22, or UC6 from their home tracks.

---

## Design

### Act map (strip SSOT — UI config)

Replace `PROGRESSIVE_TRUST_ACT_SLUGS` (slug list) with an explicit map:

| Act | Label (presenter) | `sourceId` | `useCaseId` (POST /demo/run) | Notes |
|---|---|---|---|---|
| 1 | Act 1 — Public catalog access | UC24 | `progressive-trust-public-access` | Only net-new act |
| 2 | Act 2 — Authenticated access | UC1 | `delegated-access-with-proof` | Display chip may say "Show my account balances"; run uses UC1 trigger |
| 3 | Act 3 — In-app HITL consent | UC8 | `hitl-consent` | |
| 4 | Act 4 — MFA step-up | UC7 | `step-up-required` | Always shown |
| 4b | Act 4b — CIBA (Ping blog parity) | UC22 | `ciba-out-of-band-approval` | Shown only when `ciba_enabled`; flag gate + inline toggle |
| 5 | Act 5 — Policy hard deny | UC6 | `authz-denied` | |

Optional presenter one-liners (`whatToSay` for the strip) live in the map as
`presenterLine` — sourced from PLAN demo script, not duplicated full UC rows.

**Run act:** resolve `useCaseId` from map → existing `POST /api/use-cases/demo/run`
(no backend route changes).

**Explain:** open `UseCaseExplainModal` for the **source** UC (lookup by `sourceId` in
loaded catalog).

### Catalog changes (`demo_api_server/config/useCases.js`)

- **Delete** entries UC25, UC26, UC27, UC28 (four objects).  
- **Keep** UC23, UC24 unchanged in `demo` track.  
- **Update** UC23 `whatLong` / `whatToSay` to document the act map (Acts 2–5 → UC1/8/7/6,
  optional 4b → UC22).  
- Catalog count: **39 → 35** entries (verify with tests after regen).

### Generated docs

- Run `npm run use-cases:docs:gen` from `demo_api_server`.  
- Removes four `docs/use-cases/progressive-trust-*.md` files (authenticated, hitl, ciba,
  deny); keeps `progressive-trust-demo.md` and `progressive-trust-public-access.md`.  
- README track section under Demo updates automatically.

### UI (`UseCaseLauncherPage.js` / `.css`)

- **`PROGRESSIVE_TRUST_STRIP_IDS`:** shrink to `UC24` only (hide Act 1 from grid if still
  desired; UC23 stays in grid).  
- **`ProgressiveTrustDemoStrip`:** iterate act map; for each step resolve source UC from
  `useCases` prop; render flag gate only on 4b (UC22 / `ff_ciba` alias).  
- **Act 4 + 4b layout:** Act 4 (UC7) always listed; Act 4b nested or sub-row when
  `ciba_enabled` — visually "optional encore", not a replacement for MFA.  
- **Multi-LLM showcase:** unchanged below strip.  
- **Banner copy:** clarify Act 4 = MFA; Act 4b = CIBA when FF on.

### Plan doc (`PLAN-progressive-trust-demo.md`)

- Journey table: Acts 2–5 reference UC1 / UC8 / UC7 (+ UC22 optional) / UC6.  
- Note UC25–28 removed; strip is narrative shell only.  
- Demo script Act 4: split MFA (default) vs CIBA encore (FF).

### Tests

- `useCases.config.test.js` / `useCases.route.test.js`: update expected catalog count.  
- `UseCaseLauncherPage.test.js`: if demo-track mock needed, act strip resolves UC8 by id.  
- `npm run use-cases:docs:check` must pass.

### Error handling

- If map `sourceId` missing from API response (vertical filter): omit that act step +
  console warn in dev; strip still renders other acts.  
- Flag-gated 4b: same `FlagGate` behavior as today for UC27.

---

## Demo run-of-show (B + C)

**Setup:** `./run.sh`, login, Token Chain + Activity open, agent mode Helix.

1. **`/use-cases` → Progressive Trust Demo** — narrate big picture (5 trust levels).  
2. **Act 1 — Run act** (UC24) → dashboard, public branches, empty/minimal chain.  
3. **Acts 2–5 on dashboard** — use same chips from agent/chips (or re-run from strip
   once if preferred); do not require returning to launcher.  
4. **Act 4** — UC7 MFA on $600; call out policy-driven step-up.  
5. **Act 4b (optional)** — enable `ciba_enabled`, rerun $600, show CIBA panel / Ping blog
   parity.  
6. **Act 5** — UC6 DENY $2500.  
7. **Encore (optional)** — Multi-LLM showcase: swap brain, rerun Act 2.

---

## Approaches considered

| Approach | Verdict |
|---|---|
| Strip map only, remove UC25–28 | **Selected** |
| UC23 holds map in catalog JSON field | Rejected — extra API parsing for no gain |
| Keep UC25–28 as alias rows | Rejected — still duplicates docs/tests |

**Act 4 decision:** **A** — UC7 MFA always; UC22 optional 4b when FF on.

---

## Regression guard

- REGRESSION_PLAN §0 emoji rule; §1 before auth/UI edits.  
- Minimal diff: catalog deletion + strip map + docs regen + test counts.  
- No changes to gateway, exchange, HITL, or CIBA services.

---

## Success criteria

- [x] Catalog has no UC25–UC28; docs/check pass.  
- [x] Strip Run/Explain uses UC1, UC8, UC7, UC6, UC24; 4b uses UC22 when FF on.  
- [x] Presenter can run full ladder with CIBA off (Acts 1–3, 4 MFA, 5).  
- [x] Presenter can add Act 4b without conflating MFA and CIBA.
