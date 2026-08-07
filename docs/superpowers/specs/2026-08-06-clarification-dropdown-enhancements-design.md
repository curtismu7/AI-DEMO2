# Clarification Dropdown Enhancements Design

**Date:** 2026-08-06  
**Status:** Approved  
**Scope:** `demo_api_ui`, `demo_api_server` (investment + shared vertical tools)

## Background

PR #1433 shipped clickable pill buttons for clarification prompts. Buttons show account type strings (e.g. "Checking", "Brokerage") sourced from `liveAccounts`. This spec covers four follow-on enhancements.

---

## Enhancement 1: Smarter Options — Type + Masked Number

### Goal
Replace bare type strings with `"Checking ••6789"` so users can distinguish multiple accounts of the same type.

### Data
`liveAccounts` items already carry `accountNumber` (e.g. `"1001-2345-6789"`) — stored in the `setLiveAccounts` normalization at `AIAgent.js:1730`. Last 4 digits are extracted for masking.

### Design

**`ClarifyOptions` component (`agentChrome.js`):**
- Accept `options` as either `string[]` (legacy, for non-account verticals) or `{ label: string, value: string }[]` (rich)
- Render rich items as `"Type ••NNNN"` where `label = "Checking ••6789"` and `value = "checking"` (the string `sendAsNl` receives)
- Backward-compatible: plain strings render as today

**`AIAgent.js` — banking clarification path (line ~6405):**
- Build `clarifyOptions` as `{ label: cap(type) + (acctNum ? ' ••' + last4(acctNum) : ''), value: type }[]` from `liveAccounts`
- `last4(n)` = last 4 chars of `n.replace(/\D/g, '')` (strips dashes)

**Vertical `needsParams` path:**
- Continue passing plain type strings from `liveAccounts` — account numbers aren't meaningful for non-banking portfolios (investment types are "Brokerage", "Retirement", "Trust" — no numbers)

**`parseClarificationReply`:**
- No change needed — it already matches on account type keywords. `sendAsNl(value)` sends the type string.

---

## Enhancement 2: Amount Quick-Picks

### Goal
After "how much?" questions, show preset amount buttons so users don't have to type.

### Design

**Vertical manifests — new `amountPresets` field:**
```json
"amountPresets": [100, 500, 1000, 2500]
```
- Banking manifest: `[100, 500, 1000, 2500]`
- Investment manifest: `[500, 1000, 5000, 10000]`
- Other verticals: omit (no amount clarification today)

**`ClarifyOptions` — new `amountOptions` prop:**
- Rendered as a second row of buttons below account options: `$100 · $500 · $1,000 · $2,500`
- Clicking sends `"$500"` through `sendAsNl` — existing `parseClarificationReply` amount extraction handles it
- Only shown when the pending action has an amount slot (`deposit`, `withdraw`, `transfer`, `pay_bill`, etc.)

**`AIAgent.js`:**
- Pass `amountOptions: terminology?.amountPresets || []` alongside `clarifyOptions` when action is amount-bearing
- `terminology` is already loaded from the manifest; add `amountPresets` to the manifest read path

**Actions that get amount buttons:**
- Banking: `deposit`, `withdraw`, `transfer`
- Investment: `deposit`, `withdraw`

---

## Enhancement 3: All-Vertical Coverage via Schema Enums

### Goal
Every vertical tool with a finite option set shows dropdowns, not just account-type params.

### Design

**Vertical `tools.js` — add `enum` to relevant properties:**

| Vertical | Tool | Param | Enum values |
|---|---|---|---|
| Healthcare | `book_appointment` | `provider` | derive from live data at call time |
| Government | `schedule_inspection` | `type` | `["Building", "Electrical", "Plumbing", "Fire"]` |
| Airlines | `get_seat_upgrade` | `cabinClass` | `["Economy Plus", "United First", "United Polaris"]` |

Where options are dynamic (e.g. provider names from live data), skip enum and rely on the `liveAccounts`-type fallback — don't fake static lists.

**`demoAgentLangGraphService.js` — `needsParams` handler (line ~1329):**
- For each missing param, check `toolDef.inputSchema.properties[param].enum`
- If present, add `choices: { [param]: enumValues }` to the `needsParams` response payload

**`AIAgent.js` — vertical `needsParams` handler:**
- When `response.needsParams.choices` exists, use `choices[missing[0]]` as `clarifyOptions` instead of the `liveAccounts` type fallback
- Fall back to `liveAccounts` types only when no choices provided

**Scope limit:** Only add `enum` to params where the set is genuinely static and bounded. Dynamic IDs (appointmentId, orderId) never get dropdowns — those require typing or a different UX.

---

## Enhancement 4: UX Polish

### Animations
- Button row fades in: CSS `@keyframes clarify-fadein` (opacity 0→1, translateY 4px→0, 150ms ease-out)
- After selection: chosen button gets `.clarify-options__btn--selected` (brief highlight, 200ms), then row fades out via `clarify-fadeout` keyframe (150ms)
- Implemented entirely in CSS + a React state flag `selectedOpt` in `ClarifyOptions`

### Keyboard Navigation
- `ClarifyOptions` manages focus when `active=true`
- Arrow keys (left/right) cycle button focus within the row
- `Enter` selects the focused button
- `Escape` dismisses (calls `onDismiss` prop), focuses the NL text input
- `role="listbox"` on container, `role="option"` + `aria-selected` on each button

### Implementation notes
- All keyboard logic lives inside `ClarifyOptions` via `onKeyDown` on each button
- `onDismiss` prop wired in `AIAgent.js` to call `nlInputRef.current?.focus()`

---

## File Change Summary

| File | Change |
|---|---|
| `demo_api_ui/src/components/agentChrome.js` | `ClarifyOptions`: rich label format, `amountOptions` prop, keyboard nav, animations |
| `demo_api_ui/src/components/AIAgent.css` | Fade-in/out keyframes, selected state, light-mode variants |
| `demo_api_ui/src/components/AIAgent.js` | Pass rich account objects, `amountOptions`, prefer `needsParams.choices`, wire `onDismiss` |
| `demo_api_server/config/verticals/banking/manifest.json` | Add `amountPresets: [100, 500, 1000, 2500]` |
| `demo_api_server/config/verticals/investment/manifest.json` | Add `amountPresets: [500, 1000, 5000, 10000]` |
| `demo_api_server/config/verticals/government/tools.js` | Add `enum` to `schedule_inspection.type` |
| `demo_api_server/config/verticals/airlines/tools.js` | Add `enum` to cabin class param if applicable |
| `demo_api_server/services/demoAgentLangGraphService.js` | Extract `enum` choices into `needsParams.choices` |

---

## Success Criteria

1. Banking "check balance" → buttons show "Checking ••6789 / Savings ••4521" (not bare type)
2. Banking "transfer" → account buttons + amount row ($100 / $500 / $1,000 / $2,500)
3. Investment "deposit $500" → portfolio buttons (Brokerage / Retirement / Trust) + amount row
4. Government "schedule inspection" → type dropdown from enum (Building / Electrical / Plumbing / Fire)
5. All button rows animate in, selected button highlights briefly, row fades after selection
6. Keyboard: arrows cycle, Enter selects, Escape returns focus to text input
7. Build passes · unit tests green · no regressions on existing clarification flows

---

## Out of Scope

- Dynamic option lists (provider names, appointment IDs) — require separate data-fetch design
- Multi-slot clarification in a single turn (still handled sequentially)
- LLM-mode clarification path (uses free-form text, not the slot-fill parser)
