# Token Chain — Card Redesign Handoff

**Date:** 2026-06-20
**Repo:** `/Users/curtismuir/Development/AI-Demo`
**Status:** Design approved in brainstorming (look + light/dark toggle + real tab set confirmed). NOT yet implemented. Pick up at implementation.
**Related effort:** This is the **dark inspector rail** piece of the larger customer-dashboard reskin — see `~/Desktop/customer-dashboard-redesign-HANDOFF.md` and the `customer-skin-ping2026` worktree/branch.

## Artifacts (on Desktop)
- **Interactive mock:** `~/Desktop/token-chain-card-mock.html` — open it. Click **Inspect token ▾** to expand a card. The **◐ button** in the rail header toggles light/dark. The accent swatches (top-left) prove per-vertical theming is preserved.
- **Screenshots:** `~/Desktop/token-chain-card-mock-dark.png`, `~/Desktop/token-chain-card-mock-light.png`

---

## Goal
Re-dress the existing **Token Chain** into the new PingOne SaaS "inspector" style — professional, dense-but-scannable, matching the new customer dashboard. **Zero functionality may be lost**: every RFC citation, what-changed diff, claim, raw JWT, per-step education, MCP result, TLS hop, NL intent, walk-through, and history that exists today must still be reachable. This is a **restyle**, not a feature change.

## Key approved decisions
1. **Dark inspector by default + a per-user light/dark toggle** on the Token Chain (the live chain is light today; keep that option). The toggle is **independent** of the dashboard skin flag and should persist per user (localStorage or user pref).
2. **Progressive disclosure** — each card shows a rich *summary* always; the heavy detail (full claims table, raw JWT, education box, What/Why/Value) lives behind **Inspect ▾**. Keeps long chains scannable.
3. **Per-vertical accent preserved** (`--accent` follows the active vertical — PingOne blue is just the default). **Status uses semantic colors** (green / amber / red) on the card's left border + badges, independent of the vertical accent.
4. **Code blocks stay dark in both themes** (JWT dump + MCP payloads) — deliberate "dark code on light chrome" pattern.

---

## Implementation approach — mirror the admin/customer skin precedent
Admin did this exact move: `adminSkinPing2026.css` behind flag `ff_admin_skin_ping2026`, classic skin frozen, reskin via tokens only, zero structural JS change. Do the same here:

- **Keep every existing `tcd-*` class name.** Reskin via CSS scoped under the customer skin + a theme attribute/class. Classic Token Chain stays untouched when the skin/flag is off.
- The Token Chain styles can live in a dedicated block of `demo_api_ui/src/components/customerSkinPing2026.css` (the file the dashboard reskin is already adding) **or** a sibling `tokenChainSkinPing2026.css` imported by it. Scope every rule under something like `body.customer-skin-p1 .tcd-root` (dark) and `body.customer-skin-p1 .tcd-root[data-tcd-theme="light"]` (light).
- **Light/dark toggle** = a `data-tcd-theme="light|dark"` attribute on `.tcd-root` (default `dark`), toggled by a small header button, persisted to `localStorage` (e.g. `tcd_theme`). The dark palette is the default; the light block only redefines the palette custom properties.
- **`.tcd-root` already exposes CSS vars** (`--tcd-accent`, `--tcd-accent-soft`, `--tcd-ink`, `--tcd-muted`) — extend that pattern: define the full palette as custom properties on `.tcd-root` so light mode is a ~20-line var override, not a rewrite. NOTE: most of `TokenChainDisplay.css` (~2,600 lines) currently hardcodes light colors, so expect to convert the load-bearing surfaces (backgrounds, borders, text) to vars as you go. Convert opportunistically but completely enough that both themes are clean.

### Feature flag (if you gate the dark skin) = TWO places (project convention)
The dashboard skin flag `ff_customer_skin_ping2026` already gates the surrounding rail. If you add any *new* flag, it needs entries in BOTH:
1. `demo_api_server/services/configStore.js` FIELD_DEFS (the value)
2. `demo_api_server/routes/featureFlags.js` FLAG_REGISTRY (so `/api/admin/feature-flags` serves + admin-toggles it)
The light/dark **user toggle** is NOT a feature flag — it's a per-user UI preference (localStorage). Don't put it in the flag registry.

---

## The four real tabs (verified in source)
`TokenChainDisplay.js:4144` renders `.tcd-tabs`:
1. **Current call** — the live token chain: `TokenColorLegend`, the walk-through controls (`.tcd-walk`: step-explainers switch + prev/play/next + lag), the event cards + connectors, plus the inline **Transport (TLS hops)** and **NL intent** cards.
2. **MCP Results** *(count)* — `.tcd-mcp-result-card` list (tool, duration, request/response payloads, summary, note).
3. **History** *(count)* — `.tcd-history` / `.tcd-hist-entry` (past chains: tool, step count, decision, timestamp).
4. **Trust** — DPoP sender-constraint + RAR intent posture (`.tcd-trust`, `.tcd-trust__badge`). *(Not yet mocked — style it to match the cards.)*

> The mock shows MCP-result + History sections inline for illustration. In the real component they are **separate tabs** — keep them tabbed.

---

## Per-card anatomy — every zone must survive (live → new style)
Source: `TokenChainDisplay.js` ~2880–3180 (event card), 1777 (claims table), 2321 (claims strip), 338–1700 (edu boxes), 3666 (step explainer), 4395 (mcp result), 2583 (tls card).

| Live element / class | Lives in | New-style treatment |
|---|---|---|
| `tcd-path-badge` (credential path) | card top-right | small uppercase pill, top-right |
| left border by `resolveStatusVisual().bucket` | `tcd-event` | 3px semantic left border (ok/warn/err) |
| `tcd-event-label` + `TokenColorDot` | title row | token color-dot + bold bright label |
| `SpecRefPill` (`tcd-specref-pill`) | title row | **RFC spec pill** (e.g. `RFC 8693`) |
| `tcd-event-step` "Step N of M" | title row | muted mono, right side |
| `tcd-event-explain` (`i` button) | title row | round `i` → What/Why/Value popout |
| `tcd-event-diff` "What changed" | summary | boxed diff: `key from → to`, scope `− / +` |
| `tcd-event-ids-row` (User `sub` / Agent `act` / MCP `act.act.sub`) | summary | **click-to-copy** color-coded ID chips |
| `tcd-event-meta-row`: `RfcRef`, `tcd-token-type`, `StatusBadge` | summary | RFC ref link + token-type badge + status badge |
| `tcd-event-hints` (trigger/authorizeDecision/aud/constraint/may_act/act/scopeInjected/introspection/intent) | summary | colored **hint chips** (ok/warn/info) |
| `ClaimsStrip` (`tcd-claims-strip`) | summary | compact key/val preview line |
| `tcd-inspect-btn` → detail | expander | **Inspect ▾** toggle |
| `tcd-claims-table` (sub/aud/scope/act/**may_act**/iat/exp/alg, `tcd-scope-badges`) | **detail** | full claims table; highlight `act`/`may_act` rows; scope badges |
| `tcd-jwt-dump` | **detail** | dark code block, color-coded `header.payload.signature` + copy |
| `tcd-edu-box` (`--ok/--warn/--error/--neutral`: header icon+label, body, `tcd-edu-checklist`, `tcd-edu-fix`, `tcd-edu-na` + RFC tags, `tcd-edu-code`) | **detail** | semantic education box w/ checklist + RFC links |
| `tcd-step-explainer` (`__sec--what/--why/--value`) | popout / detail | What / Why / Value block |
| `tcd-connector` (line + arrow) | between cards | vertical connector, accent arrow |
| `tcd-mcp-result-card` (tool, duration, payloads, summary, note) | **MCP Results tab** | result card w/ dark payload blocks |
| `tcd-tls-card` (`__hops`, hop from/host/cert/route) | Current call | transport card, per-hop cert ✓ |
| `tcd-nl-card` (prompt, intent, source, time, saved chip) | Current call | NL intent card |
| `tcd-trust` / `tcd-trust__badge` | **Trust tab** | DPoP + RAR posture (style to match) |
| header: `tcd-header-title`, `tcd-live-dot`, `tcd-session-dot`, `tcd-last-updated`, `tcd-clear-btn`, `tcd-copy-btn` | rail header | title + live dot + meta + icon buttons + **theme toggle** |
| `tcd-empty-state` / `tcd-onboarding-guide` | empty | restyle to dark/light card |
| `tcd-walk` (`__switch`, `__btn`, `__group`, `__lag`) | Current call | playback control bar |

**Open decision (your call):** today there's both the `i` explain button AND a What/Why/Value block. Mock keeps both. Keep both, or collapse to one entry point.

---

## Palette (copy-paste) — both themes
Default = dark. Light = override the same custom properties under `[data-tcd-theme="light"]`.

```css
/* DARK (default) — on .tcd-root, scoped under the customer skin */
--accent:#1d6bf3;            /* per-vertical; this is the PingOne default */
--accent-soft:rgba(29,107,243,.16);
--accent-text:#9ec1ff;       /* accent-colored text on dark; = --accent in light */
--dark:#0c1326;              /* rail bg */
--card:#0f1830;              /* card surface */
--card-2:#0b1426;            /* nested/expanded surface */
--line:#26304a; --line-soft:#1b2540;
--text:#cdd7ec; --bright:#eaf0fb; --dim:#90a0c2; --faint:#6b7a9c;
--ok:#5fe39c;   --ok-bg:rgba(19,136,79,.20);    --ok-line:rgba(95,227,156,.35);
--warn:#ffce7a; --warn-bg:rgba(183,121,31,.20); --warn-line:rgba(255,206,122,.35);
--err:#ff8a80;  --err-bg:rgba(192,57,43,.22);    --err-line:rgba(255,138,128,.38);
--code-bg:#070c18;           /* JWT + payload blocks — DARK IN BOTH THEMES */

/* LIGHT — [data-tcd-theme="light"] overrides only these */
--accent-soft:#e8f0ff;
--accent-text:var(--accent);
--dark:#f7f9fc; --card:#ffffff; --card-2:#f1f5fb;
--line:#e3e8f0; --line-soft:#eef2f8;
--text:#475569; --bright:#0f1729; --dim:#5b6678; --faint:#8893a7;
--ok:#13884f;   --ok-bg:#e8f7ee; --ok-line:#bfe6cf;
--warn:#b7791f; --warn-bg:#fdf3e2; --warn-line:#f0d9a8;
--err:#c0392b;  --err-bg:#fcebe9; --err-line:#f3c9c4;
/* code blocks: --code-bg stays #070c18 (dark) */
/* in light, the ID chips that used light-on-dark literals need darker text:
   user #2952cc / agent #6b35c9 / mcp #0c8f78 over a ~10% tint */
```
Type: **Inter** everywhere (drop serif). Mono for tokens/claims/JWT (`SF Mono`, `IBM Plex Mono`, `ui-monospace`). Card radius 12px, small radius 8px.

---

## Phased work
1. **Tokenize** — add the full palette as custom properties on `.tcd-root`; add `[data-tcd-theme="light"]` override block. Scope under `body.customer-skin-p1`.
2. **Theme toggle** — header button toggling `data-tcd-theme`, persisted to `localStorage` (default dark). Independent of any feature flag.
3. **Event card** — restyle summary zones (title/RFC pill/diff/ID chips/meta/hints/claims strip) per the mapping table.
4. **Inspect detail** — claims table (+ may_act/act/scope highlighting), raw JWT block, edu boxes, What/Why/Value.
5. **Tabs + specialized cards** — restyle `.tcd-tabs` (4 tabs + counts), MCP Results, History, Trust, TLS, NL, connectors, walk-through, header, empty/onboarding.
6. **Verify** — `cd demo_api_ui && npm run build` = 0 errors; click through every tab + an expanded card in BOTH themes and BOTH a PERMIT and a DENY/step-up chain; before/after screenshots; confirm classic look is untouched with the flag off.

---

## Code map
| Artifact | Path |
|---|---|
| Token Chain component | `demo_api_ui/src/components/TokenChainDisplay.js` |
| Token Chain CSS (~2,600 lines, mostly light literals) | `demo_api_ui/src/components/TokenChainDisplay.css` (`.tcd-root` defines `--tcd-*` vars) |
| Rail container in dashboard | `demo_api_ui/src/components/UserDashboard.js` (`.ud-token-rail` / `.ud-token-rail__inner`) |
| Rail current styling | `demo_api_ui/src/theme/refinedDashboardV2.css` (`[data-rd-v2] .ud-token-rail`, ~1027) |
| Customer skin (in progress) | `demo_api_ui/src/components/customerSkinPing2026.css` + flag `ff_customer_skin_ping2026` |
| Skin precedent | `demo_api_ui/src/components/adminSkinPing2026.css` + `demo_api_ui/src/hooks/useAdminSkin.js` |
| Flag registry | `demo_api_server/routes/featureFlags.js` (FLAG_REGISTRY) + `demo_api_server/services/configStore.js` (FIELD_DEFS) |
| Per-vertical accents | `demo_api_ui/src/config/industryPresets.js` |
| Tabs render | `TokenChainDisplay.js:4144` |
| Event card render | `TokenChainDisplay.js` ~2880–3180 |

---

## Project conventions to respect (do not skip)
- **Work in a git worktree** — a global hard-block hook denies Write/Edit in the main checkout. Create/enter a worktree first. Stage explicitly (`git add <files>`), never `git add -A`. Verify `git branch --show-current` before each commit.
- **Use PRs** — branch → push → `gh pr create`; leave the merge to the user. Never push to main.
- **No emojis in shipped code** (regression-guard §0). The mock uses a few glyphs for illustration; in shipped code use text/SVG (the live component already follows this — e.g. path badge is plain text). Emojis in this doc/mock are fine.
- **UI build gate:** `cd demo_api_ui && npm run build` must be 0 errors before declaring done.
- **Minimal diff** — keep `tcd-*` class names, reskin via CSS/vars; don't refactor component logic.
- **Classic look stays intact** behind the flag (mirror the frozen-classic skin approach).
- **No functionality lost** — every row in the mapping table above must still render and work in both themes.

## First steps for the new agent
1. Open `~/Desktop/token-chain-card-mock.html` (+ the two PNGs). Toggle light/dark; expand a card.
2. Coordinate with the `customer-skin-ping2026` worktree (this is its dark-rail piece) or branch your own from it.
3. Tokenize `.tcd-root` + add the `[data-tcd-theme="light"]` override; wire the persisted toggle.
4. Work phases 3–5 against the real `tcd-*` DOM, scoped under the skin; build-gate; screenshot both themes; open a PR.
