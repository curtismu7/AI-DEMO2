---
name: regression-guard
description: >-
  Enforce the Super Banking demo's do-not-break contract before and during code
  changes. Use this whenever you are about to edit OAuth/login, RFC 8693 token
  exchange, BFF session handling, admin/customer role enforcement, HITL transfer
  consent, ports/hosts, or the banking UI (demo_api_ui) — or any file listed in
  REGRESSION_PLAN.md §1 — even if the change looks like a one-liner. It makes you
  state what you will NOT break, keep a minimal diff, follow the hard UI style
  rules, and run the UI build gate before calling the work done.
---

# Regression Guard

This skill is the discipline layer for **[REGRESSION_PLAN.md](../../../REGRESSION_PLAN.md)**,
the canonical do-not-break contract for the Super Banking demo. The plan is the
source of truth; this skill is how you apply it while editing. If this skill and
the plan ever disagree, the plan wins.

Small changes to auth, sessions, and role enforcement have silently broken the
demo before (see the plan's §4 bug log). The point of this skill is to slow down
just enough at those exact spots to avoid re-introducing a fixed bug.

## When this applies

Before editing, ask: does the target file touch a protected area? The plan's
`§1` table is authoritative, but the high-risk surfaces are:

- **Auth / OAuth** — `routes/oauth*.js`, `config/oauth*.js`, admin vs user login,
  the 4-signal admin role check, redirect origins (no `localhost` hardcodes).
- **Token exchange / audience** — RFC 8693 flows, `middleware/auth.js` (`aud`
  checks, `requireNotAdmin`), customer-only `/my` endpoints (admin tokens 403).
- **BFF session** — `server.js`, `req.session.save()`, `services/lmdb/sessionStore.js`
  (must call `cb(err)` on every store op).
- **HITL transfer consent** — `services/transactionConsentChallenge.js`,
  `routes/transactions.js` (428 enforcement).
- **Banking UI** — `demo_api_ui/` layout/dock/FAB state, TopNav session actions.
- **Ports / hosts** — see `§3`; `api.ping.demo` is canonical, don't hardcode ports.

If your change is nowhere near these, you don't need this skill — proceed normally.

## The routine

1. **Read the relevant `§1` row(s)** for every file you're about to change. If a
   file appears there, its listed invariant is what you must preserve.
2. **State what you will NOT break** — one line, concretely (e.g. "won't change
   the `requireNotAdmin` guard on `/my`; only adding a log line"). This is the
   whole point: name the invariant before you touch the code.
3. **Make a minimal diff** (`§0`). Name the component, name the element, change
   only that. No "while I'm here" cleanup of adjacent code — that's how
   unrelated regressions sneak in.
4. **Follow the hard UI rules** (`§0`) for any UI/text change:
   - Emoji allowlist — the ONLY emojis permitted in skills, commands, code, and
     UI text are `⚠️` `✅` `❌` `🔐` `✕` (close) `✓` (check) `👤` (HITL consent)
     `🔑` (step-up / MFA) `🪟` (pop out to new window) `📚` (knowledge
     grounding) `🔧` (MCP tool marker). Everything else is plain text or CSS /
     semantic icons. `REGRESSION_PLAN.md` §0 is the source of truth — this list
     had drifted to six and must be kept equal to it.
   - No muted modal text — modals use solid high-contrast colors, never
     low-contrast gray hint text.
5. **Run the UI build gate** — after any `demo_api_ui/` change, the work is not
   complete until `cd demo_api_ui && npm run build` exits `0`. Run it and report
   the result before claiming done.
6. **Log the fix** — for a real bug fix (not a trivial edit), add a reverse-chron
   entry to the plan's `§4` with Files changed / What was broken / What was fixed
   / Do not break / Verify. This is what makes the next agent's `§1` accurate.

## Why it's shaped this way

Stating the invariant out loud (step 2) is cheap and catches the "I'll just
tweak this route" edits that quietly drop a role guard. The build gate (step 5)
exists because UI regressions don't show up in unit tests. Keep the ceremony
proportional — a doc typo doesn't need all six steps; a change to `routes/oauth.js`
does.
