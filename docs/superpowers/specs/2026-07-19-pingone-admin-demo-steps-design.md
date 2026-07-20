# PingOne Admin — Demo Steps

## Problem

`GET /api/use-cases?vertical=pingone-admin` 400s (`unknown_vertical`) because
`config/useCases.js`'s `VERTICALS` list only covers the 9 banking-domain
verticals sharing one 22-use-case trust-ladder catalog. The PingOne Admin AI
Agent's "Demo steps" button hits this and fails with a raw 400. The admin
vertical has no scripted walkthrough.

## Why not reuse the 22-use-case catalog

Each `USE_CASES` entry is a heavyweight trust-ladder demo object (tokenChain
evidence, OWASP threat mapping, codeRefs, business narrative, `perVertical`
overrides — ~15 fields) built to drive the evidence/token-chain UI for
protocol concepts (delegated access, step-up, CIBA, confused deputy, etc.).
Retrofitting admin actions (list apps, look up a user, reset a password) into
that shape means fabricating evidence/OWASP/narrative fields that don't
apply. Not minimal.

## Design

Reuse the existing generic plumbing, skip the heavy catalog:

- `DemoStepsDropdown` already just calls `GET /api/use-cases?vertical=X` and
  renders whatever list comes back — no changes needed there beyond picking
  the right step-id list per vertical.
- Selecting a `{type:'chip', text}` step ([AIAgent.js:6190](../../../demo_api_ui/src/components/AIAgent.js#L6190))
  just sends `text` as a normal agent chat message — no other execution path
  to build.
- Admin agent ([adminAgentService.js](../../../demo_api_server/services/adminAgentService.js))
  is fully LLM-driven against a dynamically-discovered PingOne MCP tool list,
  so plain NL prompts work without needing to match fixed heuristic phrases.

### Backend

- New file `demo_api_server/config/admin/demoSteps.js` exporting a small
  array of lightweight entries: `{ id, title, trigger: { type: 'chip', text } }`.
  Four steps:
  1. "List all PingOne applications in this environment"
  2. "Look up the user demouser"
  3. "List populations in this environment"
  4. "Reset the password for demouser"
- `demo_api_server/routes/useCases.js`: in the `GET /` handler, branch before
  `pickVertical` — if `req.query.vertical === 'pingone-admin'`, return
  `{ vertical: 'pingone-admin', useCases: ADMIN_DEMO_STEPS }` directly. The
  22-UC catalog, `VERTICALS` list, and `pickVertical` are untouched for every
  other vertical.

### Frontend

- `demo_api_ui/src/config/demoUseCaseSteps.js`: add
  `ADMIN_PRIMARY_USE_CASE_IDS` (the 4 new ids). No advanced group — 4 steps is
  the whole script.
- `DemoStepsDropdown.jsx`: pick `ADMIN_PRIMARY_USE_CASE_IDS` instead of
  `DEMO_PRIMARY_USE_CASE_IDS` when `vertical === 'pingone-admin'`.

## Out of scope

- No tokenChain/evidence/OWASP metadata for these steps (the admin agent
  doesn't have a consent/HITL gate to demo anyway — `requiresConsent` is
  always `false` in `adminAgentService.js`).
- No "advanced" step group.
- Not touching the 22-use-case banking catalog or its `VERTICALS` list.

## Testing

- `curl .../api/use-cases?vertical=pingone-admin` returns 200 with 4 steps
  (currently 400).
- Manual: open PingOne Admin agent on `local.ping-devops.com:4000/admin`,
  click "Demo steps", run all 4 — each sends its NL prompt and gets a real
  tool-backed reply (not "unknown action").
