# Ping Brand Refresh 2026 adoption — status 2026-10-10

Source: Ping Brand Refresh 2026 portal (https://brand.pingidentity.com/hub/39) — brand font is **Montserrat**.
Loaded in `demo_api_ui/public/index.html` (Google Fonts, weights 300/400/500/600/700/800 + IBM Plex Mono 400/500 for code).
Removed from the font link: Inter, Fraunces, Newsreader, IBM Plex Sans.

## How the swap works

- Single source of truth: `--font-primary` in `demo_api_ui/src/index.css` → everything using `var(--font-primary)` / `var(--font-sans)` / `var(--app-font-family)` inherits automatically.
- Secondary token sets updated: `--rd2-font-*` (refinedDashboardV2.css), `--rd-font-*` (refinedSurface.css), `--lp-font` (LandingPage.css).
- Remaining hardcoded stacks had `"Montserrat"` prepended (57 declarations across 39 files, second pass).

## Files updated (54 total)

**Entry + core (3):**
- `demo_api_ui/public/index.html` (font link + inline body stack)
- `demo_api_ui/src/index.css` (`--font-primary`)
- `demo_api_ui/src/components/customerSkinPing2026.css` (also: 2026 palette swap — see below)

**Theme layer (4):** refinedDashboardV2.css, refinedSurface.css, refinedTopNav.css, refinedAgent.css

**Component CSS (33):** AIAgent, ActivityLogPanel, ActorTokenEducation.module, AgentDemoGuide, AgentFlowDiagramPanel, AgenticTrustEducation.module, ArchitectureDiagramPage, ArchitectureSimSvg, ArchitectureTabsPanel, AuthzTestPage, ErrorBoundary, LandingPage, MFALogsModal, MFATestPage, McpGatewayConfig, PingCliPage, PingOneAudit, PingOneMcpInspector, PingOneTestPage, ProductCardGrid, ResourceServerInterstitial, SetupWizard, StepDetailPanel, TokenCard, TokenChainDisplay, TokenFlowDetailModal, TokenTopologyPanel, UnifiedTokenFlowInspector, UserDashboard, shared/InspectorShell, tour/DemoTourModal, aiFootprintMocks/chrome.css, aiFootprintMocks/PrivilegeShellPanel.css

**Page CSS (14):** AgentFlowHistoryPage, AgentLifecyclePage, DelegatedCommercePage, FootprintMockGalleryPage, M2mCredentialsSamplePage, PrivilegeDocsIndexPage, PrivilegeMcpClientPage, PrivilegeMcpLearningPage, ResourceServerJourneyPage, TelemetryPage, TokenExchangeTesterPage, TracingPage, legacy/SessionExpiryTimer.css

## Deliberate exceptions (NOT Montserrat — don't "fix" these)

| File | Why |
|---|---|
| `components/DemoArchSlidesPage.css` | Narrow Helvetica stack for SVG diagram labels — documented in-file that wide display fonts overflow the boxes |
| `components/agent-clinical/clinical.css` | Crimson Pro display face — tokenized exception per THEMING.md §8.2 |
| `components/aiFootprintMocks/chrome.css` (serif rules only) | Georgia serif = deliberate Claude-desktop mimicry in product mocks (sans body follows app standard) |
| `components/AIAgent.css` serif badges, `TransactionConsentPage.css` ⓘ icon | Single-glyph serif styling, deliberate |
| All `--font-mono` / IBM Plex Mono uses | Code font, unchanged by design |

## 2026 palette swap (same session, bonus)

`customerSkinPing2026.css` no-vertical fallback tokens now match the brand portal:
`--csp-primary #051727` (Core Dark), `--csp-accent #d20e0f` (Ping Red), `--csp-bg #f7f8f8` (Gray 200), border `#e0e2e4` (Gray 400), text-secondary `#5c646b` (Gray 700).
Verticals override these with their own `cssVars` from `demo_api_server/config/verticals/*/manifest.json` — untouched, correct behavior.

## Verification (evidence)

- **Static sweep:** zero remaining non-Montserrat sans `font-family` declarations outside the deliberate-exception list (checked with multi-line-folding parser).
- **Modals:** all 20 modal CSS files use `inherit`, `var(--font-mono)`, or were swapped — no hardcoded system stacks.
- **JS inline styles:** all `fontFamily: 'inherit'` or `'monospace'` — nothing to change.
- **Live pages (real navigation, 30 elements sampled each, 0 non-Montserrat):** `/` landing, `/dashboard`, `/learning` (Learning Hub), `/oauth-academy`, `/use-cases`, `/privilege-mcp-learning`, `/privilege-mcp-client`, `/admin/agentic-access-console`, `/davinci-orchestration`, `/pingone-authorize`, `/pingcli`, `/protocol-playground`, `/configure`.
- **Unit tests:** 12 files passed on the font-only changes. Two failures (`demoReadinessContract.test.js`, `demoStepNumbers.test.js`) and the build's demo-readiness error are pre-existing, caused by other WIP in this tree (`demoUseCaseSteps.js`, `demoReadinessCatalog.js`, `useCases.js` — expected 52 demo-step entries, found 51). Verified by `git stash` → tests/build pass on clean tree.
- `document.fonts` confirms Montserrat 400/500/600/700 loaded; body + sampled elements resolve to it.

## Remaining / open items

All shipped 2026-10-10. Font + palette in **#1087**; logo, gradients, boilerplate copy, spinner dance in **#1089**; brand-hub arcs pattern + legacy hex swaps (`#b3282d → #d20e0f`, `#1a5276 → #051727`) in **#1103**; V2 hero pattern-carry fix in **#1104**; `multiply` blend in **#1105**; JPEG edge-frame crop (final seam fix, −31% asset size) in **#1106**. All merged and deployed.

Resolved along the way:

1. ~~**Commit**~~ → #1087–#1106, all merged.
2. ~~**Ping logo**~~ → official 2026 Square Primary committed as `public/branding/ping-logo.png` (PNG, not the placeholder SVG, which was deleted); favicons regenerated; used by spinner, boot screen, PiFlow modal, pingone-admin manifest.
3. ~~**Weight 800 unused**~~ → now in use (App.css, OAuthProviderToggle.css); kept in the font link.
4. ~~**Purple Accent `#680754`**~~ → deliberately unused per product decision (portal reserves it as sparse emphasis; we don't need it). 2026-10-10 follow-up: the user extended this to the whole violet/indigo family — every purple across the UI was swept to Ping Red (`#d20e0f`/`#aa0005` + red tints); only the fake-tenant presets (FunnyBank etc.) keep purple so demo tenants don't read as Ping.

No open items.
