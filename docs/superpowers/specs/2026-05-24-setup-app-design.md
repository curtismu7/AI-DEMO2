# Setup App Design

**Date:** 2026-05-24  
**Audience:** Demo presenter / SE  
**Route:** Replaces `/setup` entirely  
**Status:** Design approved, awaiting implementation plan

---

## Goal

Replace the existing `/setup` page with a guided SE setup flow that walks a presenter through all four prerequisites before a demo: PingOne credentials, Helix/LLM configuration, PingOne bootstrap, and a final health check. The flow enforces order on first run, then unlocks free navigation for repeat visits.

---

## Architecture

### Page structure

Single React page at `/setup` (replaces `SetupPage.js`). Two regions:

1. **Left sidebar** (fixed width ~180px): step list with status badges, Download .env button in footer
2. **Main content area**: renders the active step's content

The sidebar step list shows four items:

| # | Step | Status states |
|---|---|---|
| 1 | PingOne Credentials | pending / active / ✅ done |
| 2 | Helix / LLM Setup | pending / active / ⚠️ incomplete / ✅ done |
| 3 | Bootstrap PingOne | pending / active / ✅ done |
| 4 | Verify & Go | pending / active / ✅ done |

### Lock/unlock behaviour

- **First run**: steps 3 and 4 are locked (greyed, non-clickable) until their predecessor completes. Step 3 unlocks after step 2. Step 4 unlocks after step 3.
- **After first full pass**: all four steps become freely clickable. SE can jump directly to Helix (step 2) to swap a key before a demo.
- Completion state is persisted in `configStore` — already-passing steps show ✅ on revisit without re-running validation.

### Reused components and logic

| Existing artifact | Reused for |
|---|---|
| `SetupWizard.js` PingOne credential validation | Step 1 validation logic |
| `SetupWizard.js` SSE bootstrap stream | Step 3 bootstrap execution |
| `SetupWizard.js` `.env` file generator | Step 4 Download .env (extended with `HELIX_*`) |
| `HelixPanel.jsx` JSON import handler | Step 2 key import |

---

## Step 1 — PingOne Credentials

Reuses the existing credential validation from `SetupWizard.js` (environment ID, region, worker client ID/secret). No new logic required. Step passes when validation returns success.

---

## Step 2 — Helix / LLM Setup

A five-sub-step mini wizard within the main step.

### Sub-steps

| # | Sub-step | What happens |
|---|---|---|
| 1 | Go to Helix console | Instructional — link to Helix console, "Click Next when you're in the console" |
| 2 | Publish the agent | Instructional checklist — confirm agent is published (not just saved). Explains that saving ≠ publishing. |
| 3 | Get agent-scoped API key | Instructions: Agents → ⋮ menu → Create API Key → download JSON. **Import Key JSON** button auto-fills `HELIX_API_KEY` and `HELIX_AGENT_ID`. Inline warning: do not use `LLM2.json` (env-admin scope, wrong type). |
| 4 | Fill remaining fields | Form for the 3 fields not in the key JSON: `HELIX_BASE_URL`, `HELIX_ENVIRONMENT_ID`, `HELIX_PROMPT_FIELD_ID`. Auto-filled fields (`HELIX_API_KEY`, `HELIX_AGENT_ID`) shown read-only with ✅ badge. Each field has inline hint explaining where to find the value. |
| 5 | Verify | Live connection test: create conversation, send test message, confirm non-null reply. Shows pass/fail per check. On pass: saves config and advances to step 3. |

### Key type guard

The `LLM2.json` warning must be visible on sub-step 3. The warning text:
> "Don't use `LLM2.json` — it's an env-admin key and won't work for agent invocation. The correct key JSON has `"scope": "agent"` and a non-empty `target`."

On JSON import, validate `target` is non-empty and `scope === "agent"`. If validation fails, show an inline error and block progression — do not let the SE reach sub-step 4 with the wrong key type. This is the exact silent failure the LLM2.json warning guards against.

### Backend API needed

`POST /api/admin/helix/verify` — takes the 5 Helix config values, runs a real Helix conversation test, returns `{ ok: true }` or `{ ok: false, error: "..." }`. Used by sub-step 5.

---

## Step 3 — Bootstrap PingOne

Reuses the existing SSE bootstrap stream from `SetupWizard.js`. No new logic. The step displays the streaming progress (step-by-step SSE events) and completes when `step: "complete"` is received.

---

## Step 4 — Verify & Go

Runs health checks across services and configuration. Calls existing `/api/admin/setup/status` (or equivalent) for each check.

### Check panels

**Services panel** (left):
- BFF `:3001`
- UI `:4000`
- MCP Server `:8080`
- MCP Gateway `:3005`

**Configuration panel** (right):
- PingOne credentials
- Helix / LLM connected
- PingOne apps bootstrapped
- OAuth redirect URIs

### States

- **All pass**: green "Demo ready" banner + Download .env button + "Open demo dashboard →" link
- **Partial fail**: red banner listing failed checks + `./run.sh status` hint + Re-run checks button + greyed Download .env (still clickable — SE may want the file regardless)

### Re-run

"Re-run checks" button re-executes all health checks without reloading the page.

---

## .env Download (step 4 footer + sidebar)

The Download .env button is available in two places:
1. **Sidebar footer** — always visible, generates whatever is currently configured
2. **Step 4 main content** — prominent after all checks pass

### New `HELIX_*` block

The `.env` generator in `SetupWizard.js` currently omits Helix vars. The updated generator appends:

```
# Helix LLM — generated by Setup Wizard
HELIX_BASE_URL=<value>
HELIX_API_KEY=<value>
HELIX_ENVIRONMENT_ID=<value>
HELIX_AGENT_ID=<value>
HELIX_PROMPT_FIELD_ID=<value>
```

Values read from `configStore` at download time. If any Helix var is unconfigured, include the key with an empty value and a `# TODO` comment.

---

## File changes

| File | Action |
|---|---|
| `demo_api_ui/src/components/SetupPage.js` | Replace entirely with new hybrid wizard |
| `demo_api_ui/src/components/SetupPage.css` | Update/replace for new layout |
| `demo_api_ui/src/components/SetupWizard.js` | Keep for credential validation + bootstrap SSE logic (extracted as utility or kept as-is and called from new SetupPage) |
| `demo_api_server/routes/admin.js` (or similar) | Add `POST /api/admin/helix/verify` endpoint |
| `demo_api_ui/src/App.js` | Route `/setup` unchanged (already points to `SetupPage`) |

### New files

| File | Purpose |
|---|---|
| `demo_api_ui/src/components/SetupStepHelix.jsx` | Helix mini wizard (5 sub-steps) |
| `demo_api_ui/src/components/SetupStepVerify.jsx` | Verify & Go health check panel |

---

## Out of scope

- Developer onboarding (full first-time clone setup) — different audience, different scope
- MCP Inspector setup wizard (`/setup/mcpinspector`) — separate page, untouched
- PingOne reference guide (`/setup/pingone`) — separate page, untouched
- Marketing pages — untouched
- Mobile layout — demo SE will always be on a laptop
