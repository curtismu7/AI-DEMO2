---
name: privilege-admin-config-ui
description: >-
  Recipe for building a new Privilege-facing admin or config page in this
  repo — an LMDB-backed config store, a thin Express route, and a themed
  React component wired into an existing page. Use this whenever the task
  is to add setup/configuration UI for PingOne Privilege or an MCP server
  it fronts (an OAuth/auth config form, a registration status panel, a
  settings tab on /privilege-demo or a similar hub) — even if the request
  just says "add a page for X" or "build a UI to configure Y." Points out
  to privilege/SE1-Privilege-Shared-Demo.md for onboarding/setup steps and
  privilege/CURRENT-CONFIGURATION.md for what's actually live on the
  Privilege gateway today, rather than duplicating either.
---

# Privilege Admin/Config UI

A repeatable shape for "give this a settings page" work in the Privilege
corner of this repo, distilled from building the illustrative OAuth config
tab on `/privilege-demo` for `banking-mcp` (PR that added
`demo_api_server/routes/mcpOAuthConfig.js` and
`demo_api_ui/src/components/privilege/PrivilegeMcpOAuthConfig.jsx`).

## Before writing any code

1. **Read `privilege/CURRENT-CONFIGURATION.md`** for what's actually live —
   which Agentic Apps exist, their Auth Mode, and any platform blockers
   already proven (don't re-attempt something that document says is
   disproven; a page can still show the config shape without pretending
   the wiring works today). This doc is the source of truth for Privilege
   state — this skill and any page it produces should point to it, never
   copy it.
2. **Read `privilege/SE1-Privilege-Shared-Demo.md`** if the task touches
   onboarding/setup steps (VM prep, PingOne console clicks, agent install,
   MFA, snapshotting). Link out to it; don't rebuild it in-app. An earlier
   version of `/privilege-demo` duplicated this doc as an in-app checklist
   and it drifted stale — the fix was deleting the duplicate, not fixing it.
3. **Check `demo_api_ui/src/config/privilegeDemoConfig.js`** — persona
   info, console URLs, and the SE1 guide link (`se1GuideUrl`) already live
   there. Reuse it instead of hardcoding URLs/IDs again.

## The recipe

Four pieces, each small and independently testable — write each with a
failing test first (TDD is the norm in this repo, see
`superpowers:test-driven-development`):

1. **Store** — `demo_api_server/services/<name>Store.js` + a matching
   `services/lmdb/<name>Store.lmdb.js` (copy `mcpOAuthConfigStore.js` /
   `mcpOAuthConfigStore.lmdb.js` as the template — ~20 lines of LMDB
   wrapper, one named DB). If the record holds a secret, mask it: never
   return the raw value from a `get`, only a `hasX: true/false` flag, and
   let a blank field on save mean "keep what's already there" rather than
   wiping it.
2. **Route** — `demo_api_server/routes/<name>.js`, mounted in `server.js`
   next to its siblings (`grep "app.use('/api/privilege" server.js` to
   find the pattern). Keep handlers thin — no business logic beyond
   validating input and calling the store. If the page needs to prove a
   live call works (a "Test Connection" button), make the real call and
   report the real upstream status/body — don't fake success, and don't
   swallow an expected failure as a 500. A documented platform blocker
   showing up as a live 401 is the honest, correct result.
3. **Component** — `demo_api_ui/src/components/privilege/<Name>.jsx` +
   `.css`. Theme with `--th-*` / `--font-size-*` / `--radius-*` tokens per
   `THEMING.md` — **grep the actual token names out of `src/index.css`
   before using one** (`--th-status-warning-bg`, `--th-status-success`,
   `--radius-lg`, etc.); don't guess a plausible-sounding token name, the
   theming-ratchet test (`src/components/__tests__/themingRatchet.test.js`)
   will catch both a literal `px` radius and a themed background with no
   explicit ink color on the same rule. Go through `fetch` with
   `credentials: 'include'` against `${API_BASE}/api/...` (see
   `McpGatewayConfig.jsx` for the established pattern) rather than
   inventing a new HTTP convention.
4. **Wire it in** — add the component to whatever page hosts it. If that
   page has a tab bar, prefer adding a tab over a new route; if the page
   only has one real section left, consider dropping the tab bar entirely
   rather than keeping a one-tab strip.

## Verify

- `cd demo_api_server && CI=true npx jest <new test paths> --forceExit`
- `cd demo_api_ui && npm run test:unit && npm run build` — the build is the
  real gate; a green test run alone doesn't catch a theming-ratchet or
  emoji-allowlist regression.

## Why it's shaped this way

The store/route/component split mirrors every other small admin surface in
`demo_api_server`/`demo_api_ui` (see `mcpProfileStore.js` for a second,
slightly richer example) — following it means the next person reading the
diff already knows where to look. Pointing out to the two `privilege/*.md`
docs instead of re-explaining their content is what keeps this skill short
and keeps setup/status information in exactly one place, so it can't drift
out of sync with itself the way the old in-app Setup checklist did.
