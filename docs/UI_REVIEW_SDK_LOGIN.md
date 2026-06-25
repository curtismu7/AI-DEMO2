# UI Review — SDK Login feature + UI consistency audit

**Date:** 2026-06-25
**Branch:** `fix-sdk-login-bugs`
**Scope:** Bugs in the OIDC SDK centralized-login UI (`/sdk-login`), plus a repo-wide UI consistency sweep.

---

## Part 1 — Bugs fixed on this branch

All three are fixed in `demo_api_ui/src`. The UI production build passes (`vite build`, exit 0).

### 1. `login_hint` was silently dropped (functional — feature was a no-op)

**File:** [SdkLoginPage.jsx:240](../demo_api_ui/src/pages/SdkLoginPage.jsx#L240)

The new username-prefill called the SDK with an unsupported option key:

```js
// before
const url = await client.authorize.url({ loginHint: "demouser" });
```

`@forgerock/oidc-client` v2's `authorize.url()` only forwards *extra* OAuth params via the
`query` option. The URL builder (`@forgerock/sdk-oidc` → `createAuthorizeUrl`) spreads
`...options.query` into the `URLSearchParams` and ignores unknown top-level keys. `GetAuthorizationUrlOptions`
has no `loginHint`/`login_hint` field. Result: `login_hint` never reached the authorization URL and
the PingOne login page was **not** prefilled — the feature did nothing.

```js
// after
const url = await client.authorize.url({ query: { login_hint: "demouser" } });
```

### 2. StrictMode dev: a successful sign-in hung on the spinner forever

**File:** [SdkLoginCallback.jsx:30,53-72](../demo_api_ui/src/pages/SdkLoginCallback.jsx#L30)

The original dedup combined a module-level `Set` of seen codes with a per-effect `cancelled` guard.
Under React StrictMode (dev), the effect runs setup → cleanup → setup:

1. Effect **A** adds the code and starts the exchange, then `cleanup A` sets `cancelledA = true`.
2. Effect **B** sees the code already in the set and `return`s early — never navigates.
3. A's exchange resolves successfully, but `if (!cancelled) navigate()` is skipped because `cancelledA` is true.

Net: tokens were persisted (login actually succeeded) but neither effect navigated, leaving the page
stuck on "Completing sign-in…". Production (no double-invoke) was unaffected — but the dedup traded a
harmless second `invalid_grant` for a permanent dev hang.

**Fix:** memoize the in-flight exchange *promise* per code (`Map`) instead of returning early. The code
is redeemed once, but **both** effects await the same result, so the surviving (still-mounted) effect
navigates. The cache entry is dropped on a failed exchange so a fresh callback isn't blocked.

### 3. Bare route height (cosmetic)

**File:** [SdkLoginPage.jsx:41](../demo_api_ui/src/pages/SdkLoginPage.jsx#L41)

The route was changed to render `<SdkLoginPage />` without `<AppShell>`. The page used
`minHeight: "100%"`, which resolves to `0` when the route container has no explicit height — the dark
background wouldn't reach the viewport bottom on short content (e.g. the error/loading states). Changed
to `minHeight: "100vh"`.

---

## Part 2 — UI consistency audit (repo-wide)

These are **pre-existing** inconsistencies surfaced while reviewing the SDK-login pages, not regressions
from this branch. They are documented here for follow-up; none are fixed on this branch. Findings are
evidence-cited and spot-verified. Ordered by impact.

### C1. Raw `JSON.stringify` rendered instead of the shared `JsonHighlight` component

**Convention:** display JSON via the shared `JsonHighlight` component (with the `jh-dark` wrapper class on
dark backgrounds), never a hand-rolled `<pre>{JSON.stringify(x, null, 2)}</pre>`. ~18 files already use
`JsonHighlight`; these are holdouts:

- [MockAuthzRulesPage.jsx:74,78](../demo_api_ui/src/components/MockAuthzRulesPage.jsx#L74) — request & response bodies
- [MFATestCard.jsx:119](../demo_api_ui/src/components/MFATestCard.jsx#L119) — raw result panel
- [AuditPage.js:295,300,305](../demo_api_ui/src/components/AuditPage.js#L295) — three token-display `<pre>` blocks
- [AgentGatewayTester.jsx:244,276](../demo_api_ui/src/components/AgentGatewayTester.jsx#L244) — audit trail / rules
- [AdminErrorAuditLog.js:124](../demo_api_ui/src/components/AdminErrorAuditLog.js#L124) — entry metadata

*(Note: `JSON.stringify` for fetch bodies, localStorage values, React keys, logging, and clipboard copy is
legitimate and was excluded.)*

### C2. Pictographic emoji in rendered JSX (no-emoji rule)

**Convention:** inline SVG only — no pictographic emoji in user-facing strings. ~40+ instances remain:

- [App.js:205](../demo_api_ui/src/App.js#L205) — `🔀 Agent Request Flow` heading
- [DelegatedAccessPage.js:184,212,584,650](../demo_api_ui/src/components/DelegatedAccessPage.js#L184) — `🔑 ℹ️ 🗑 🔐`
- [FidoStepUpModal.js:104](../demo_api_ui/src/components/FidoStepUpModal.js#L104) — `❌ {errorMsg}`
- [Profile.js:280,382](../demo_api_ui/src/components/Profile.js#L280) — `✅ Verified`
- [MockAuthzRulesPage.jsx:52,137,147](../demo_api_ui/src/components/MockAuthzRulesPage.jsx#L52) — `✅ ❌ ⚠️` decision icons

The new SDK-login pages are clean — they already use inline SVG icons.

### C3. Per-page theme systems duplicate global theming

**Convention:** rely on global app theming; avoid local `PALETTES` / `localStorage` theme keys /
`prefers-color-scheme`. `SdkLoginPage` ships its own complete light/dark system:

- [SdkLoginPage.jsx:14-37](../demo_api_ui/src/pages/SdkLoginPage.jsx#L14) — local `PALETTES` + `THEME_KEY = "sdkLoginTheme"`
- [SdkLoginPage.jsx:175](../demo_api_ui/src/pages/SdkLoginPage.jsx#L175) — own `matchMedia("(prefers-color-scheme: light)")`

This is arguably *intentional* for a self-contained, embeddable SDK sandbox — but it means the page won't
follow the global theme toggle. Flagged as a deliberate-divergence to confirm, not necessarily to fix.

### C4. Inline-style vs CSS-class split across sandbox pages

**Convention:** prefer CSS classes. The "test/sandbox" pages are split:

| Page | Approach |
| --- | --- |
| `pages/SdkLoginPage.jsx` | 100% inline (`makeStyles(C)` factory) |
| `pages/SdkLoginCallback.jsx` | 100% inline (`WRAP_STYLE` + per-element) |
| `components/MockAuthzRulesPage.jsx` | inline `const S = {…}` style object |
| `components/PingOneTestPage.jsx` | mostly CSS classes + ~60 inline overrides |
| `components/MFATestCard.jsx` | CSS classes only (BEM) |
| `components/SelfServicePage.js` | CSS classes only |

The inline-heavy pages are the SDK demo pages and `MockAuthzRulesPage`; the rest lean on CSS classes.

### C5. Route wrapper / prop inconsistency

**Convention:** public sandbox routes should consistently use (or not use) `<AppShell>` and not pass props
the component ignores.

- [PublicRoutes.js:158-162](../demo_api_ui/src/routes/PublicRoutes.js#L158) — `SdkLoginPageRoute()` is bare (no AppShell) and takes **no params**, yet [App.js:424](../demo_api_ui/src/App.js#L424) still passes `user={user} logout={logout}` — both silently discarded.
- [PublicRoutes.js:165-167](../demo_api_ui/src/routes/PublicRoutes.js#L165) — `SdkLoginCallbackRoute()` bare (intended).
- [PublicRoutes.js:92-95](../demo_api_ui/src/routes/PublicRoutes.js#L92) — `OnboardingRoute` also bare.

Low-risk cleanup: drop the unused props at the `App.js` call site for `SdkLoginPageRoute`.

### C6. Hardcoded brand colors instead of a shared token

**Convention:** PingOne blue should come from a shared CSS custom property, not local hex literals. The brand
blue is redefined across many files in slightly different shades (`#2f81f7`, `#2f6fe0`, `#1d4ed8`, `#2563eb`,
`#3b82f6`):

- [SdkLoginPage.jsx:20,30,76](../demo_api_ui/src/pages/SdkLoginPage.jsx#L20) / [SdkLoginCallback.jsx:96](../demo_api_ui/src/pages/SdkLoginCallback.jsx#L96)
- [MockAuthzRulesPage.jsx:33,39](../demo_api_ui/src/components/MockAuthzRulesPage.jsx#L33) — `#1d4ed8`
- Broader: `HistoryModal.js:16`, `HitlSequenceDiagram.js:7`, `styles/OidcFlowTimeline.css`, `components/MCPToolsListModal.css`, `components/LlmConfigPanel.css`

---

## Part 3 — Consistency fixes applied (this branch)

All C1/C2/C5/C6 findings are fixed. Build passes (`vite build`, exit 0).

### C1 — JsonHighlight (4 files, 8 call sites)

`MFATestCard.jsx`, `AuditPage.js`, `AgentGatewayTester.jsx`, `AdminErrorAuditLog.js`.
`jh-dark` added where the `<pre>` background was confirmed dark (AgentGatewayTester `#1e1e2e`,
MockAuthzRulesPage `#0f172a`).

### C2 — Emoji removed (~18 spots across 5 files)

`DelegatedAccessPage.js`, `FidoStepUpModal.js`, `Profile.js`, `MockAuthzRulesPage.jsx`, `App.js`.
All replaced with `react-icons/md` (existing project idiom). `✕` (U+2715, punctuation) correctly left.

### C5 — Unused route props

`App.js:424` — dropped `user={user} logout={logout}` from `<SdkLoginPageRoute />`.

### C6 — Brand color tokens (5 files, 10 literals)

`HistoryModal.js`, `HitlSequenceDiagram.js`, `styles/OidcFlowTimeline.css`,
`components/MCPToolsListModal.css`, `components/LlmConfigPanel.css`.
Mapped: `#2563eb` → `var(--brand-blue)`, `#3b82f6` → `var(--brand-navy-light)`,
`#1d4ed8` → `var(--sidebar-bg-active)`.

### C3 — SdkLoginPage theme (deferred, not fixed)

There is no global light/dark theme in this app (theming is per-vertical CSS-var swaps, single
light theme). Removing `SdkLoginPage`'s local palette would delete its light mode with nothing to
replace it — a feature regression, not a consistency improvement. Flagged for reconsideration if
a global theme toggle is ever added.

### C4 — Inline-style vs CSS-class (deferred, not fixed)

`SdkLoginPage` and `SdkLoginCallback` were introduced as self-contained inline-style sandbox pages
on this branch. Converting to CSS classes is high-churn with regression risk and no functional
benefit at this stage. Left for a dedicated styling-refactor pass.
</content>
</invoke>
