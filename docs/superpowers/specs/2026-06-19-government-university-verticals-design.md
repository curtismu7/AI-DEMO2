# Design: Government + University Verticals

**Date:** 2026-06-19
**Status:** Approved (brand names + tier scope confirmed)
**Branch:** `worktree-gov-university-verticals`

## Summary

Add two new industry verticals to the AI-Demo: **Government (Permits & Licensing)** and
**University (Registrar & Enrollment)**. Both are *skins* over the demo's fixed five banking
primitives (`accounts`, `balance`, `transactions`, `transfer`, `feature`). The identical AI-agent
IAM security pipeline — RFC 8693 token exchange → MCP gateway → PingOne Authorize → HITL consent /
MFA step-up — runs unchanged underneath. Only configuration and domain vocabulary change.

Verticals are discovered by scanning `demo_api_server/config/verticals/<id>/`. There is **no**
hardcoded vertical-ID list anywhere; a new on-disk manifest is picked up at the next server
`init()`. The full touchpoint checklist lives in the `add-vertical` skill / `/new-vertical` command;
this spec records the *design decisions* for these two specific verticals.

## Non-Goals

- No change to the security core (token chain, gateway, Authorize policy, HITL/MFA).
- No new vertical-ID arrays or switch statements (there are none — do not add any).
- Banking baseline is untouched; it is the default, not a configurable vertical.

---

## Vertical A — Government · CivicPermit

| Slot | Decision |
|---|---|
| `id` | `government` |
| Brand (`identity.displayName`) | **CivicPermit** |
| Persona (`agent.persona`) | **Liberty** (Permit Assistant) |
| Theme | Civic navy / steel-blue + gold accent (distinct from banking-red, healthcare-teal) |
| `accounts` | **Permits & Licenses** — types: Building, Business, Professional |
| `balance` | **Fees Owed** |
| `transactions` | **Filing History** — types: Application, Inspection, Renewal, Records Release |
| `transfer` (HITL high-value) | **Release Permit Record** — sensitive record release to a third party |
| `feature` page | **Permit Status** → `show_permit`, `featureScope: permits:read` |

**Tagline:** "AI-Powered Citizen Permitting Demo"
**Greeting flavor:** Liberty helps a resident view permits/licenses, check fees owed, review filing
history, and request a permit-record release with the consent flow surfaced.

## Vertical B — University · Super University

| Slot | Decision |
|---|---|
| `id` | `university` |
| Brand (`identity.displayName`) | **Super University** (mirrors the "Super Banking" naming) |
| Persona (`agent.persona`) | **Scholar** (Registrar Assistant) |
| Theme | Collegiate indigo / violet + gold accent |
| `accounts` | **Enrolled Courses** — types: Core, Elective, Lab |
| `balance` | **Credit Standing / Holds** |
| `transactions` | **Enrollment History** — types: Registration, Drop, Grade Posted, Transcript Release |
| `transfer` (HITL high-value) | **Release Transcript** — official transcript release to a third party |
| `feature` page | **Enrollment Status** → `show_enrollment`, `featureScope: transcript:read` |

**Tagline:** "AI-Powered Campus Registrar Demo"
**Greeting flavor:** Scholar helps a student view enrolled courses, check credit standing / holds,
review enrollment history, and request a transcript release with the consent flow surfaced.

---

## Tiered scope

### Tier 1 — Standalone, config-only (the core deliverable)

Ships per vertical with no other service rebuilt:

1. `demo_api_server/config/verticals/<id>/manifest.json` — schemaVersion 3. Required: `id`,
   `identity.displayName`, `theme.cssVars` (≥1), `agent.persona`. Plus: `terminology`, 5 `chips`
   (`balance`, `accounts`, `transactions`, `transfer`, `feature`), `hero.cards` (4), `llmChipGroups`,
   `scopes` (`read`/`write`/`transfer`/`featureScope`), `featurePage`, `demoUsers`.
2. `demo_api_server/config/verticals/<id>/mock-data.json` — at minimum a `heroStats` block feeding
   the hero `dataKey`s, plus accounts + transactions mock arrays.
3. `demo_api_server/services/nlIntentParser.js` — add a `THEME_VOCAB.<id>` entry. **Ordering is
   load-bearing:** most-specific regex first (e.g. "release transcript → transfer" MUST precede
   "transcript → accounts"). Transfer `$NNN` amount extraction is automatic.
4. `docs/HELIX_AGENT_DIRECTIVES.json` — add a `<id>` key under `"themes"` (terminology map + chip
   vocabulary + narrow refusal). `docs/HELIX_AGENT_DIRECTIVES_CONSOLE.md` — append the plain-text
   copy-paste version.

**Acceptance (Tier 1, per vertical):**
- Manifest validates against the Zod schema and is discoverable (the `verticalManifest.init()`
  one-liner lists the new id).
- Both docs files parse: `node -e "require('./docs/HELIX_AGENT_DIRECTIVES.json')"`.
- `npm run test:api-server` is green (no heuristic regressions).
- After switching to the vertical: chips render with themed labels, hero stats populate, agent
  greeting uses the new persona, and each chip phrase routes to the correct banking action via the
  heuristic **without** calling Helix/Ollama.

### Tier 2 — Full-fat richness to match healthcare (recommended, still config-only)

The shipped "complete" verticals (healthcare) carry extra manifest blocks beyond the minimum. Add
them to both new verticals for parity:

- `chips10` — the expanded chip rail (`mode`, `tool`, `hitlTrigger`, a `direct` MCP chip).
- `securityShowcase` — Defenses / AI Reasoning / Attacks / PingOne Admin tabs. Reuse the banking
  attack/defense chip set verbatim where domain-neutral; reword captions to the vertical's
  high-value action (Release Permit Record / Release Transcript).
- `delegation` — proxy-access page labels (e.g. Government: authorize an agent/representative;
  University: authorize a parent/advisor) mapping the five delegation scopes to themed labels.
- `render` — per-tool result renderers (`table` / `card` / `fieldList`).

**Acceptance (Tier 2):** manifest still Zod-valid; security-showcase tab renders; delegation page
shows themed labels; no schema-strip surprises (any new block must exist in
`services/verticalManifest/schema.js` or it is silently dropped).

### Tier 3 — Feature-page backend, FULLY WIRED (in scope)

The 5th chip (`show_permit` / `show_enrollment`) must return real data, not an empty state.
**The `/new-vertical` command / `add-vertical` skill does NOT automate this** — it only writes the
`featurePage` *manifest* block + placeholder chip and hands over the wiring checklist
(new-vertical.md:21, Step 9). The cross-service work below is therefore explicitly in scope. It
requires a multi-service rebuild + a PingOne bootstrap and touches REGRESSION_PLAN-protected files,
so it is sequenced as its own step *after* Tier 1–2 land (the chip degrades gracefully in between):

1. Backend endpoint on `demo_mortgage_service/server.js` (`GET /permit`, `GET /enrollment`),
   X-API-Key protected, returning `{ "<dataKey>": {…}, "source", "authMechanism" }`.
2. `demo_mcp_gateway/src/router.ts` — add the tool to `APIKEY_TOOLS` + `APIKEY_BACKEND_ROUTES`.
3. `demo_mcp_gateway/src/apiKeyDispatch.ts` — add to `TOOL_DISPLAY_NAMES`.
4. `demo_mcp_server/src/tools/BankingToolRegistry.ts` — add a visibility-only `show_*` entry with its
   `featureScope`.
5. Rebuild both gateway + MCP server, restart, provision `permits:read` / `transcript:read` in
   PingOne (`npm run pingone:bootstrap`).

This tier touches files under REGRESSION_PLAN protection — read the `mcp-gateway` / `mcp-server`
skills first.

---

## Risks / Watch-items

- **Schema strips unknown fields.** The Zod `ManifestSchema`/`ChipSchema` (`resolver.parse`) strips
  any key it does not know. Any block added in Tier 2 must already be modeled in
  `services/verticalManifest/schema.js`, or it never reaches the UI. Verify the schema supports
  `chips10` / `securityShowcase` / `delegation` / `render` before relying on them (healthcare uses
  them, so they should be modeled — confirm).
- **Heuristic ordering.** Regex order in `THEME_VOCAB` is load-bearing; the high-value "release"
  phrase must precede the generic noun.
- **Theme color collisions.** Pick hues distinct from existing verticals (banking-red,
  healthcare-teal, retail, sporting-goods) so the skin is visually unmistakable.
- **Logos optional.** `logoPath` may be `null` initially; no SVG asset is required to ship.

## Rollout

Sequenced in two PRs so the config-only work isn't blocked on the cross-service rebuild:

1. **PR 1 — Tier 1 + Tier 2 (both verticals), config-only.** Manifests, mock-data, heuristic vocab,
   Helix directives, full-fat blocks. Behind the existing vertical switcher; no feature flag needed.
   Ships independently; 5th chip shows the graceful empty state.
2. **PR 2 — Tier 3 (both verticals), fully wired.** Backend endpoints + gateway routing + MCP
   registry entries + `npm run pingone:bootstrap` to provision `permits:read` / `transcript:read`.
   Cross-service rebuild (gateway + MCP server) and REGRESSION_PLAN-protected files — its own task,
   verified end-to-end (chip returns real data; missing-scope path returns the `scopeError`).

Both verticals are fully wired (feature pages return real data) at the end of PR 2.
