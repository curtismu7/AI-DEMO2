# Super Banking — UI Quality Criteria

This document encodes the explicit, gradable standards for "professional banking UI" in Super Banking.
It is the authoritative source for `banking_api_ui/tests/e2e/ui-quality.spec.js`.

Inspired by: https://www.anthropic.com/engineering/harness-design-long-running-apps
> "Encode subjective criteria explicitly. Convert fuzzy requirements into concrete, gradable standards."

---

## How to use this document

Each criterion below has:
- **What**: the specific, measurable standard
- **Why**: the real regression or incident that motivated it
- **Test**: the matching test group in `ui-quality.spec.js`

When making UI changes, check each criterion applies. When adding new UI features, add a criterion here first, then write the test.

---

## Criterion 1 — Layout & Positioning

**What**: Interactive controls must be fully visible and non-overlapping.

| Rule | Threshold |
|------|-----------|
| FAB must be fully inside the viewport | 0px overflow on any edge |
| FAB bottom gap from viewport edge | ≥ 16px |
| FAB right gap from viewport edge | ≥ 16px |
| FAB must not overlap the logout button | Zero pixel intersection |
| FAB must not overlap the header nav | Zero pixel intersection |

**Why**: The FAB was positioned incorrectly on `/dashboard`, overlapping the logout control. Users could not click logout without first opening the agent panel. Commit `b19254e`.

**Test**: `Layout & Positioning` describe block in `ui-quality.spec.js`

---

## Criterion 2 — Data Quality

**What**: Real data must be formatted correctly; no raw values or placeholder text must reach the UI.

| Rule | Acceptable | Not acceptable |
|------|-----------|---------------|
| Currency values | `$1,500.00` | `1500`, `1500.0`, `1500.00` (no $ or comma) |
| Transaction dates | `Mar 1, 2026` or similar | `2026-03-01T10:00:00.000Z` |
| Greeting | User's actual first name | Generic text, "Hello," with no name |
| Visible text | Clean strings | `[object Object]`, `undefined`, `null` |

**Why**: Demo/placeholder data was displayed when the real API responded successfully. The `UserDashboard` showed ISO date strings when `createdAt` (camelCase) was replaced by `created_at` (snake_case) in mock fixtures. Commit `09ddac9`.

**Test**: `Data Quality` describe block in `ui-quality.spec.js`

---

## Criterion 3 — Error UX Quality

**What**: Errors must surface as friendly, actionable messages — never as stack traces, raw JSON, or JS error strings.

| Scenario | Acceptable | Not acceptable |
|----------|-----------|---------------|
| MCP server 502 | "MCP server unavailable, try again" | `Error: at Object.<anonymous> (BankingAgent.js:342)` |
| Scope 403 | Dashboard still loads with scoped content | Raw `{"error":"insufficient_scope"}` in the page body |
| Auth 401 | Redirect to login | White screen or unhandled exception |

**Why**: MCP errors were surfacing raw `mcp_error:` strings and in some cases JS stack traces in the chat messages panel. Unfamiliar error text damages trust in a banking product.

**Test**: `Error UX Quality` describe block in `ui-quality.spec.js`

---

## Criterion 4 — Notification Quality

**What**: Toast notifications must fire at most once per user-visible event; no toast storms on page load.

| Page | Max toasts on initial load |
|------|---------------------------|
| Landing (unauthenticated) | 0 |
| Customer dashboard | ≤ 1 |
| Post-agent-result confirm | ≤ 1 |

**Why**: Multiple auth state checks (admin status + user status) were each independently triggering "Signed in as…" toasts on page load, showing 2–3 identical notifications. Commit `2fb9d7a`.

**Test**: `Notification Quality` describe block in `ui-quality.spec.js`

---

## Criterion 5 — Brand & Professional Standards

**What**: Every page must present Super Banking branding consistently and contain no raw code artifacts.

| Rule | Standard |
|------|---------|
| Brand name | Exactly "Super Banking" (not "SuperBanking", "Super banking", etc.) |
| Dashboard sections | "Your Accounts" + "Recent Transactions" always present |
| Visible text | No HTML entities (`&lt;`, `&amp;`), no raw JSON key patterns |
| Images | No broken images (zero `img` with empty `src` or 0 natural width) |

**Why**: Banking products rely on brand trust. Any raw HTML, escaped entity, or missing section immediately reads as unprofessional and erodes confidence in the product.

**Test**: `Brand & Professional Standards` describe block in `ui-quality.spec.js`

---

## Criterion 6 — Console Health

**What**: Pages must load without JavaScript errors or unhandled promise rejections.

| Signal | Threshold |
|--------|-----------|
| `console.error` on page load | 0 (excluding WebSocket aborts in test env) |
| Unhandled `pageerror` events | 0 |

**Why**: Silent JS errors indicate broken state that may not be immediately visible in the UI. React key warnings and unhandled rejections compound over time into larger failures.

**Test**: `Console Health` describe block in `ui-quality.spec.js`

---

## Criterion 7 — Accessibility

**What**: No critical or serious WCAG 2.1 AA violations on the three primary pages. Checked with axe-core.

| Page | Scope | Rules |
|------|-------|-------|
| Landing (unauthenticated) | Full page | wcag2a, wcag2aa, wcag21aa |
| Customer dashboard | Full page | wcag2a, wcag2aa, wcag21aa |
| Banking agent panel | `.banking-agent-panel` only | wcag2a, wcag2aa, wcag21aa |

Excluded: `color-contrast` — depends on runtime theme and dynamic content; tracked separately.

Only `critical` and `serious` violations fail the check. `moderate` and `minor` are informational.

Common violations to watch for:
- Buttons without accessible names (`aria-label` or visible text)
- Form inputs without associated `<label>`
- Images without `alt` text
- Interactive elements unreachable by keyboard
- Invalid ARIA roles

**Why**: Banks have legal WCAG 2.1 AA obligations in most jurisdictions. Accessibility violations also indicate missing semantic structure that assistive technology users — and screen readers used by some testers — rely on.

**Scoring**: 10 points (4 landing + 3 dashboard + 3 agent panel). Total score is now **110 points**.

**Test**: `Accessibility` describe block in `ui-quality.spec.js`; Category 7 in `ui-score.spec.js`

---

## Regression index

| Commit | Symptom | Criterion |
|--------|---------|-----------|
| `b19254e` | FAB positioning on dashboard | 1 — Layout & Positioning |
| `09ddac9` | Demo data shown when real data available | 2 — Data Quality |
| `662297a` | Real data first, demo only on failure | 2 — Data Quality |
| `2fb9d7a` | Duplicate session toasts, 401 retries | 4 — Notification Quality |

---

## Adding new criteria

1. Identify the fuzzy requirement ("should feel professional")
2. Write the concrete, measurable rule in this document
3. Add a `test.describe` block in `ui-quality.spec.js` covering it
4. Add a row to the regression index when a real bug is caught

Keep criteria here, not in test files. Tests are implementation; this document is the contract.
