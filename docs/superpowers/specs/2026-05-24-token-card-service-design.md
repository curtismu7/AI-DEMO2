# Token Card Service — Design Spec

**Date:** 2026-05-24  
**Status:** Approved for implementation  
**Branch:** feat/login-button-consistency (will land as its own branch)

---

## Problem

The codebase has at least 8 components that each display JWT token information in slightly different ways (`DecodedTokenPanel`, `TokenDisplay`, `TokenInspector`, `OAuthTokenDisplayPage`, `TokenChainDisplay`, `TokenDiffPanel`, `TokenStateIndicator`, `UnifiedTokenFlowInspector`). Each duplicates claim labelling, timestamp formatting, and layout logic. There is no single canonical token display, so quality is inconsistent across the app.

---

## Goal

Create a **canonical `TokenCard` React component** backed by the **existing BFF decode service**, so that any place in the app that needs to show a decoded token can use one thing. All existing token display components are migrated to use `TokenCard` in this same phase, and unused ones are deleted.

---

## Architecture

### Approach: Thin BFF + canonical React component

The BFF already has `POST /api/token-display/decode` (in `demo_api_server/routes/tokenDisplay.js`, served by `tokenDisplayService.js`). This endpoint decodes a raw JWT string and returns structured JSON. No new BFF endpoint is needed.

The new `TokenCard` component accepts either:
1. **A raw JWT string** → calls `POST /api/token-display/decode`, renders the response
2. **A pre-decoded object** (matching the BFF response shape) → renders immediately, zero extra requests

This dual-input design means `TokenCard` works in contexts that already have decoded token data (e.g. `DecodedTokenPanel` receives pre-decoded claims from the BFF via WebSocket events) without forcing a redundant HTTP round-trip.

---

## BFF Decode Response Shape

The existing `tokenDisplayService.formatTokenForDisplay()` returns (no changes needed):

```json
{
  "success": true,
  "header": { "alg": "RS256", "kid": "...", "typ": "JWT" },
  "payload": {
    "sub": "...", "iss": "...", "aud": ["..."],
    "iat": 1779616846, "exp": 1779620446,
    "scope": "read write", "env": "...", "org": "...",
    "client_id": "..."
  },
  "tokenType": "worker",
  "summary": { "subject": "...", "issuer": "...", "audience": "...", "expiresAt": "..." }
}
```

`TokenCard` will type-check this shape via a `tokenShape` PropTypes definition (or a TypeScript interface if converted later).

---

## Component: `TokenCard`

**File:** `demo_api_ui/src/components/TokenCard.jsx`  
**CSS:** `demo_api_ui/src/components/TokenCard.css`

### Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `token` | `string` | — | Raw JWT string. Mutually exclusive with `decoded`. |
| `decoded` | `object` | — | Pre-decoded BFF response object. Mutually exclusive with `token`. |
| `title` | `string` | `"Token — Decoded Claims"` | Text shown in the blue header bar. |
| `tokenType` | `'subject' \| 'actor' \| 'mcp' \| null` | auto-derived | Controls header colour dot. If omitted, derived from `decoded.tokenType` or via `deriveTokenCategory(title)`. |
| `showHeader` | `bool` | `true` | Show the HEADER section (alg, kid). |
| `showIdentity` | `bool` | `true` | Show the IDENTITY section (aud, iss, sub, env, org, act, may_act). |
| `showScopes` | `bool` | `true` | Show the SCOPES section. Hidden automatically when no scopes present. |
| `showRaw` | `bool` | `true` | Show the collapsible Raw payload JSON accordion. |
| `defaultExpanded` | `bool` | `false` | Whether the card starts expanded or collapsed. |
| `className` | `string` | `""` | Additional CSS class on the root element. |

One of `token` or `decoded` is required. Passing both is an error (PropTypes warning).

### Layout (approved in brainstorm)

```
┌─────────────────────────────────────────────────────┐
│ 🔵 [title] — Decoded Claims              ▲ hide     │  ← blue header bar
├─────────────────────────────────────────────────────┤
│ Issued: 5/24/2026, 5:00:46 AM   Expires: 6:00:46 AM │  ← light-blue timing sub-bar (always shown)
├─────────────────────────────────────────────────────┤
│ HEADER                                              │
│   RS256  kid: 0313c890-…                            │
├─────────────────────────────────────────────────────┤
│ IDENTITY                                            │
│   aud:  ["https://api.pingone.com"]                 │
│   iss:  https://auth.pingone.com/…                  │
│   env:  d02d2305-…                                  │
│   org:  97ba44f2-…                                  │
├─────────────────────────────────────────────────────┤
│ SCOPES  (hidden when empty)                         │
│   [read]  [write]  [admin]                          │
├─────────────────────────────────────────────────────┤
│ ▼ Raw payload JSON                                  │
│   { "client_id": "…", … }                           │
└─────────────────────────────────────────────────────┘
```

**Collapsed state:** only the blue header bar and the timing sub-bar are visible. The body is unmounted (not hidden) to avoid layout jank in tight spaces.

**Timing sub-bar:** always rendered when expanded. Formatted as `toLocaleString()` from Unix epoch × 1000. If `exp` is in the past, the Expires value renders in red.

**Colour dot:** `subject` → red (`🔴`), `actor` → blue (`🔵`), `mcp` → green (`🟢`), unknown → grey. Reuses the existing `TokenColorSystem.deriveTokenCategory()` utility.

**Claim tooltips:** each claim label in IDENTITY shows a `title` attribute with the description from the existing `CLAIM_GLOSSARY` (extracted from `DecodedTokenPanel.jsx` into a shared constant at `demo_api_ui/src/constants/claimGlossary.js`).

### Loading / error states

- **Loading** (when `token` prop used and fetch is in-flight): renders header bar + timing sub-bar with a subtle skeleton shimmer in place of the body.
- **Decode error** (BFF returns non-200 or `success: false`): renders a single-line error message in place of the body. Does not throw.
- **Invalid prop combination** (`token` + `decoded` both passed): PropTypes warning in dev, component renders nothing.

---

## Shared Constant: `claimGlossary.js`

**File:** `demo_api_ui/src/constants/claimGlossary.js`

Extract the `CLAIM_GLOSSARY` object that currently lives duplicated in `DecodedTokenPanel.jsx`, `OAuthTokenDisplayPage.jsx`, `UnifiedTokenFlowInspector.jsx`, and `TokenDiffPanel.js` into one shared constant. All migrated components import from here — the duplicated inline copies are removed as part of migration.

---

## BFF: no changes required

`POST /api/token-display/decode` in `demo_api_server/routes/tokenDisplay.js` already returns the correct shape. The only addition is documenting the response contract in a JSDoc comment in `tokenDisplayService.js` so future callers know exactly what shape to expect.

---

## CSS Strategy

`TokenCard.css` introduces new CSS classes with a `token-card-` prefix to avoid colliding with existing `token-display-*` classes in `TokenDisplay.css`. The existing `TokenDisplay.css` is not modified.

Key classes:
- `.token-card` — root container
- `.token-card__header` — blue header bar (colour driven by `--token-card-header-bg` CSS var, defaults to `#3b5bdb`)
- `.token-card__timing` — light-blue sub-bar
- `.token-card__body` — white body area
- `.token-card__section-title` — HEADER / IDENTITY / SCOPES labels
- `.token-card__claim-grid` — two-column key/value grid for claims
- `.token-card__scope-badge` — green pill badge for scope values
- `.token-card__raw` — raw JSON accordion area

---

## Migration Plan

All three tiers are in scope for this phase.

### Tier 1 — Direct swaps (highest visibility, easiest)

#### `DecodedTokenPanel.jsx` → `TokenCard`
- **Used in:** `PingOneTestPage.jsx` — 5 instances (Worker Token, Auth Token, Agent Token, exchange token, MCP token)
- **Token data:** pre-decoded `{ header, payload }` passed directly as props
- **Migration:** replace each `<DecodedTokenPanel decoded={...} label={...} />` with `<TokenCard decoded={...} title={...} defaultExpanded />`. Delete `DecodedTokenPanel.jsx` after.

#### `OAuthTokenDisplayPage.jsx` → multiple `TokenCard` instances
- **Used in:** `UserDashboard.js` and `Dashboard.js` — primary UI, full-page token detail visible to end users
- **Token data:** pre-decoded from `/api/auth/oauth/user/status` + `/api/tokens/session-preview`
- **Migration:** replace `OAuthTokenDisplayPage`'s internal per-section rendering with `TokenCard` instances (one per token shown). The page component itself is retained as an orchestrator; only its rendering internals change. Delete `OAuthTokenDisplayPage.jsx` if it becomes a thin wrapper with no remaining logic.

### Tier 2 — Surgical edits inside specialist components

#### `TokenChainDisplay.js` — `TokenInspectorPanel` (lines 1650–1777)
- **Context:** floating draggable panel that shows a single decoded token when user clicks "inspect" on a chain event
- **Token data:** pre-decoded chain event object with `{ claims, jwtFullDecode: { header, claims } }`
- **Migration:** replace the internal claim-rendering JSX inside `TokenInspectorPanel` with `<TokenCard decoded={...} title={...} defaultExpanded />`. The chain visualisation, `EventRow`, diff view, and educational boxes are not touched.

#### `UnifiedTokenFlowInspector.jsx` — right-panel claim rendering
- **Context:** the right side of the combined Agent Request Flow + OAuth Token Inspector panel
- **Token data:** pre-decoded claims from component state/props
- **Migration:** replace the right-panel's inline claim grid with `<TokenCard decoded={...} title={...} defaultExpanded />`. The left-side flow trace is not touched.

### Tier 3 — Delete unused components

- **`TokenDisplay.jsx`** — not imported anywhere. Takes raw JWT string + calls BFF. `TokenCard` covers this exactly. Delete.
- **`TokenInspector.tsx`** — not imported anywhere. Actor-focused labels are handled by `tokenType` prop on `TokenCard`. Delete.

### Not touched

| Component | Reason |
|---|---|
| `TokenChainDisplay.js` chain viz | Specialist — status flow, diff, RFC educational boxes, drag/resize |
| `TokenDiffPanel.js` | Unique diff table layout — not a token card |
| `TokenStateIndicator.js` | Compact inline chip — different purpose |
| `TokenColorSystem.js` | Shared utility — `TokenCard` imports from it |

---

## Files Created / Modified / Deleted

| File | Action |
|---|---|
| `demo_api_ui/src/components/TokenCard.jsx` | **Create** |
| `demo_api_ui/src/components/TokenCard.css` | **Create** |
| `demo_api_ui/src/constants/claimGlossary.js` | **Create** (extracted from existing components) |
| `demo_api_server/services/tokenDisplayService.js` | **Modify** — add JSDoc response shape contract |
| `demo_api_ui/src/components/PingOneTestPage.jsx` | **Modify** — swap 5× `DecodedTokenPanel` → `TokenCard` |
| `demo_api_ui/src/components/UserDashboard.js` | **Modify** — swap `OAuthTokenDisplayPage` internals → `TokenCard` |
| `demo_api_ui/src/components/Dashboard.js` | **Modify** — swap `OAuthTokenDisplayPage` internals → `TokenCard` |
| `demo_api_ui/src/components/TokenChainDisplay.js` | **Modify** — replace `TokenInspectorPanel` claim rendering → `TokenCard` |
| `demo_api_ui/src/components/UnifiedTokenFlowInspector.jsx` | **Modify** — replace right-panel claim rendering → `TokenCard` |
| `demo_api_ui/src/components/DecodedTokenPanel.jsx` | **Delete** — fully replaced by `TokenCard` |
| `demo_api_ui/src/components/TokenDisplay.jsx` | **Delete** — unused, superseded by `TokenCard` |
| `demo_api_ui/src/components/TokenInspector.tsx` | **Delete** — unused, superseded by `TokenCard` |

No routes, no new BFF endpoints, no new test files in this phase.

---

## Success Criteria

1. `TokenCard` renders correctly with a raw JWT string input (calls BFF, shows decoded claims).
2. `TokenCard` renders correctly with a pre-decoded object input (no BFF call made).
3. All section show/hide props work independently.
4. Collapsed state shows only header bar + timing sub-bar.
5. Expired token shows Expires value in red.
6. Loading state renders without layout shift.
7. `PingOneTestPage` shows all 5 token panels via `TokenCard` — visually identical to before.
8. `OAuthTokenDisplayPage` sections in `UserDashboard` and `Dashboard` render via `TokenCard`.
9. `TokenChainDisplay` floating inspector panel renders via `TokenCard`.
10. `UnifiedTokenFlowInspector` right panel renders via `TokenCard`.
11. `DecodedTokenPanel.jsx`, `TokenDisplay.jsx`, `TokenInspector.tsx` are deleted with no remaining imports.
12. `npm run build` in `demo_api_ui/` exits 0.
13. No existing tests broken.
