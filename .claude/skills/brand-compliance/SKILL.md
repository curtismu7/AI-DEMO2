---
name: brand-compliance
description: Use when creating or editing any UI, landing page, artifact, slide, or document in AI-DEMO2 that has fonts, colors, or a logo — new React pages/components, CSS changes, theming work, favicon/logo work, or copy for the landing callout. Enforces the Ping Brand Refresh 2026 standard (Montserrat, official 2026 logo, Ping Red gradients). Trigger on "new page", "style this", "theme", "gradient", "brand", "logo", "landing page", or any .css/.jsx edit that sets fonts or colors — even if the user doesn't say "brand".
---

# Ping Brand Compliance (Refresh 2026)

Source of truth: Ping's brand hub (brand.pingidentity.com/hub/39, SSO-gated). **Fonts and written style come only from the hub — never invent.** This skill encodes the decisions already shipped (PRs #1087 + #1089); deviate only when the user explicitly says so.

## Tokens

- **Font:** Montserrat (300–800) app-wide; IBM Plex Mono for code. Source: `--font-primary` in `demo_api_ui/src/index.css`; font link in `public/index.html`. Do not reintroduce Inter, Fraunces, Newsreader, or IBM Plex Sans.
- **Logo:** official 2026 Square Primary at `demo_api_ui/public/branding/ping-logo.png` (PNG, not SVG — the placeholder "P" SVG was deleted). Favicons 16/32/apple-touch are generated from it.
- **Palette:** Ping Red `#d20e0f`, Core Dark `#051727`, Gray 100 `#fcfcfc`, neutrals Gray 200–700. Purple Accent `#680754` exists but is deliberately unused — don't reach for it.
- **Gradients (90deg):** red `#d20e0f 55% → #aa0005`, dark `#051727 58% → #12538d`, gray `#fcfcfc 45% → #e0e2e4`. Landing hero CTA uses the red gradient; `--lp-destructive` is Ping Red.
- **Emphasis:** heavier weight, never italics, in display faces.

## Added 2026-10-18 (UI consistency review)

- **Reds:** one accent/danger red `#d20e0f`, hover/dark `#aa0005`. Do not reintroduce Tailwind reds (`#dc2626`, `#b91c1c`, `#ef4444`).
- **No purple or pink** in CSS, including gradients, code highlighting and avatars. Sweep them to the red family (`#fee2e2` / `#fecaca` / `#d20e0f` / `#7f1d1d` by lightness).
- **Blues:** Core Dark `#051727` for surfaces and nav, Ping blue `#12538d` for links/info. Primary actions are Ping Red, not blue. Secondary/utility buttons are outline (`app-page-toolbar-btn`).
- **Neutrals:** `#263746`, `#5c646b` (Gray 700), `#909ea4`, `#cdd1d4`, `#e0e2e4` (Gray 400), `#eff0f1`, `#f7f8f8` (Gray 200). Not Tailwind slate/gray.
- **Mono font:** `var(--font-mono)` (IBM Plex Mono first). **Sans:** `var(--font-primary)`. No hardcoded stacks.
- **Tokens, not literals:** `--radius-sm|md|lg|xl|pill`, `--font-size-*`, `--btn-radius`, `--btn-weight`. `designTokenRatchet.test.js` fails on new literals.
- **Page header:** `<PageHeader eyebrow title summary back badge actions>` and `<BackLink>` from `components/common/PageHeader`. The band keeps its own text colours.
- **Readability is enforced:** the contrast hook / `check-contrast.mjs` on CSS edits, `npm run audit:contrast` for rendered pages. Never paint `--th-bg-band` as text; never apply generated overrides unscoped.

## Hardcoded stacks that must stay in sync

Three places define their own `--font-*` variables and must match the token change:
- `LandingPage.css` (`--lp-font`)
- `refinedDashboardV2` / `refinedSurface` (`--rd*-font-*`)

If you change `--font-primary`, check all three.

## Documented exceptions — leave alone

- DemoArchSlidesPage narrow SVG-label sans
- Clinical vertical's Crimson Pro (THEMING.md §8.2)
- Vendor-mock chrome (Claude/ChatGPT mocks keep their own faces)
- Vertical brand cssVars always override Ping fallbacks

## Gotchas

- **Binary assets don't survive patch/stash transfers** between worktrees — CI caught `ping-logo.png` missing from a PR. When committing new images, `git add` them explicitly.
- When writing landing/callout copy, pull the boilerplate and written style from the brand hub, not from memory.
