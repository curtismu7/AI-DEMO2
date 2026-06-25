# Super Banking — UI Design System

> **Status:** Active standard as of 2026-05-07.
> All new components must conform. Existing components are being brought into compliance per the remediation plan in §7.

---

## Table of Contents

1. [Design Tokens](#1-design-tokens)
2. [Card Hierarchy](#2-card-hierarchy)
3. [Page Layouts](#3-page-layouts)
4. [Modals](#4-modals)
5. [Form Controls](#5-form-controls)
6. [Navigation](#6-navigation)
7. [Remediation Plan](#7-remediation-plan)
8. [Compliance Checklist](#8-compliance-checklist)

---

## 1. Design Tokens

All tokens live in `banking_api_ui/src/index.css` `:root`. Reference only — never hard-code the values they replace.

### 1.1 Card & Inner-Card Tokens (Phase 5)

```css
--inner-card-radius:  8px
--inner-card-border:  1px solid #e5e7eb
--inner-card-shadow:  0 2px 6px rgba(15, 23, 42, 0.05)
--inner-card-bg:      #ffffff
--inner-card-accent:  4px          /* left-border semantic strip */
```

### 1.2 Modal Tokens (Phases 1–4)

```css
--modal-radius:        12px
--modal-shadow:        0 20px 48px rgba(0,0,0,0.22), 0 4px 12px rgba(0,0,0,0.1)
--modal-border:        1px solid rgba(0,0,0,0.08)
--modal-header-bg:     linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)
--modal-header-text:   #ffffff
--modal-header-sub:    rgba(255,255,255,0.65)
--modal-header-height: 48px
--modal-body-bg:       #ffffff
--modal-footer-bg:     #f9fafb
--modal-footer-border: #e5e7eb
--modal-btn-size:      28px
--modal-btn-bg:        rgba(255,255,255,0.12)
--modal-btn-bg-hover:  rgba(255,255,255,0.28)
--modal-btn-radius:    6px
--modal-overlay-bg:    rgba(10,15,30,0.5)
--modal-overlay-blur:  blur(2px)
```

### 1.3 Brand Tokens

```css
--brand-navy:       #1d4ed8
--brand-navy-dark:  #1e40af
--brand-navy-light: #3b82f6
--brand-blue:       #2563eb
--brand-success:    #4caf50
--brand-warning:    #ff9800
--brand-error:      #f44336
```

### 1.4 Semantic Alert Colors (not tokenized yet — use literal values)

| Variant  | Background | Border      | Left accent | Text      |
|----------|-----------|-------------|-------------|-----------|
| info     | #eff6ff   | #bfdbfe     | #3b82f6     | #1e40af   |
| warning  | #fffbeb   | #fde68a     | #f59e0b     | #78350f   |
| error    | #fef2f2   | #fecaca     | #ef4444     | #991b1b   |
| success  | #f0fdf4   | #bbf7d0     | #22c55e     | #166534   |
| purple   | #eef2ff   | #c7d2fe     | #6366f1     | #3730a3   |

---

## 2. Card Hierarchy

There are **three levels** of card in the design system. Use the correct level for the context — mixing levels is the most common source of visual inconsistency.

### Level 1 — Page Panel

The primary white card on a page. Sections of content, configuration panels, wizard steps.

```css
background:    white
border:        1px solid #e2e8f0
border-radius: 10px
box-shadow:    0 1px 3px rgba(0, 0, 0, 0.06)
padding:       24px 28px
margin-bottom: 20px
```

**Reference implementations:** `.azc-panel` (AuthorizeConfigPage), `.sp-panel` (SetupPage), `.configuration-section` (UnifiedConfigurationPage).

**Page background behind Level-1 cards:** `#f1f5f9`

---

### Level 2 — Inner Card

Sub-cards *inside* a Level-1 panel. Used for list items, event rows, tool items, claim rows.

```css
background:    var(--inner-card-bg, #ffffff)
border:        var(--inner-card-border, 1px solid #e5e7eb)
border-radius: var(--inner-card-radius, 8px)
box-shadow:    var(--inner-card-shadow, 0 2px 6px rgba(15,23,42,0.05))
```

For semantic left-accent cards (token items, status rows):
```css
border-left-width: var(--inner-card-accent, 4px)
border-left-color: <semantic color>
```

**Hover state (all inner cards):**
```css
border-color:      #bfdbfe
border-left-color: #93c5fd   /* or keep semantic color */
```

**Reference implementations:** `.tcd-event-*`, `.mcp-tool-item`, `.logs-item`, `.adp-account-card`, `.ti-claim-row`.

---

### Level 3 — Alert / Info Banner

Inline informational callouts within a panel. Single-purpose: convey status or context. Never use a Level-1 card for this purpose.

```css
padding:           14px 16px
border-radius:     var(--inner-card-radius, 8px)
border:            var(--inner-card-border)
border-left-width: var(--inner-card-accent, 4px)
border-left-color: <semantic color from §1.4>
background:        <semantic bg from §1.4>
font-size:         13px
line-height:       1.55
```

**Reference implementations:** `.azc-alert--*`, `.sp-alert--*`

---

## 3. Page Layouts

### 3.1 Standalone Admin Pages (e.g. SetupPage, /setup/*)

Dark gradient header + tab bar + body:

```
┌──────────────────────────────────────────────────┐
│  HEADER  var(--modal-header-bg) gradient         │
│  h1 (modal-header-text) + subtitle (modal-header-sub)  │
│  right: ghost nav links + solid-white CTA        │
└──────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────┐
│  TAB BAR  white bg, border-bottom: 2px #e2e8f0  │
│  Tabs: 10px 20px pad; active: brand-navy underline │
└──────────────────────────────────────────────────┘
  body: max-width 900px, centered, padding 2rem 1.25rem
  content: Level-1 cards
```

**Reference:** `SetupPage.css` (`sp-*` classes)

---

### 3.2 Embedded Admin Sub-Pages (e.g. /settings, /users)

Uses `AdminSubPageShell` + `appShellPages.css` hero.
- Hero: white card, 12px radius, light border, `app-page-shell__title` in brand color
- Body: `app-page-shell__body` centered, Level-1 cards inside

**Do not** add a second dark header inside an AdminSubPage — the `appShellPages.css` hero serves that role.

---

### 3.3 Configuration Pages (e.g. /configure, UnifiedConfigurationPage)

Split layout: sticky section-nav sidebar (left) + main content (right).

```
┌──────────────┬───────────────────────────────────┐
│ SECTIONS     │  Section Title                    │
│ nav sidebar  │  ─────────────────────────────    │
│              │  Level-1 card content             │
└──────────────┴───────────────────────────────────┘
```

- Section nav active state: `background: #eff6ff; color: var(--brand-navy); border-left: 3px solid var(--brand-navy); font-weight: 600`
- Section nav hover: `background: #f8fafc`
- Content cards: `.configuration-section` = Level-1 standard

---

## 4. Modals

### 4.1 The Rule

**All modals must use `DraggableModal` as their outer shell.** No exceptions except agent UI (AgentSidebar, AgentChat, agent-owned panels — these follow a separate agent design system).

`DraggableModal` provides for free: drag, resize, popout, backdrop blur, `dm-enter` animation, consistent header/footer chrome.

### 4.2 DraggableModal Structure

```jsx
<DraggableModal
  title="Modal Title"
  subtitle="Optional subtitle"          // renders in modal-header-sub color
  onClose={handleClose}
  footer={<>action buttons</>}          // optional; renders in modal-footer-bg
>
  <div className="dm-scroll">           // for scrollable body content
    {/* inner Level-2 cards here */}
  </div>
</DraggableModal>
```

### 4.3 Inner Modal Content

Inside a modal body:
- Use **Level-2 inner cards** for list items/rows (`.tcd-event-*` pattern)
- Use **Level-3 alert banners** for status/info (`.azc-alert--*` pattern)
- Use **sections** with `h4` headings (11px, uppercase, `#94a3b8`) to group content
- **Do not** nest a Level-1 card inside a modal body — it creates a visual double-frame

### 4.4 Modal Header Actions (right side)

```css
button {
  width:            var(--modal-btn-size, 28px)
  height:           var(--modal-btn-size, 28px)
  background:       var(--modal-btn-bg)
  border-radius:    var(--modal-btn-radius, 6px)
  color:            white
}
button:hover {
  background: var(--modal-btn-bg-hover)
}
```

---

## 5. Form Controls

### 5.1 Text / Number / URL Input

```css
padding:        8px 10px
border:         1px solid #cbd5e1
border-radius:  6px
font-size:      13px
color:          #0f172a
background:     #f8fafc

:focus {
  border-color: #1d4ed8
  box-shadow:   0 0 0 3px rgba(29,78,216,0.1)
  background:   white
}
```

Max-width on text inputs: `28rem` unless full-width is semantically correct.

### 5.2 Select / Dropdown

Same border/radius/focus as input. `background: white`.

### 5.3 Textarea

Same as input with `resize: vertical; min-height: 72px`.

### 5.4 Label + Hint

```css
.field-label { font-size: 13px; font-weight: 600; color: #1e293b; margin-bottom: 5px; }
.field-hint  { font-size: 12px; color: #94a3b8; margin-top: 5px; }
```

### 5.5 Checkbox / Radio Row

```css
label {
  display:     flex
  align-items: center
  gap:         8px
  font-size:   13px
  color:       #374151
  cursor:      pointer
}
input[type="checkbox"],
input[type="radio"] {
  flex-shrink: 0
  width:       1rem
  height:      1rem
  margin:      0        /* critical — browser default margin breaks alignment */
}
```

**Never** use `display: flex !important` overrides — set `margin: 0` on the input itself instead.

### 5.6 Toggle (pill switch)

```css
button (track) {
  width: 48px; height: 26px; border-radius: 13px; border: none
  background: value ? var(--brand-navy) : #d1d5db
}
span (thumb) {
  position: absolute; top: 3px
  left: value ? 25px : 3px
  width: 20px; height: 20px; border-radius: 50%; background: white
}
```

---

## 6. Navigation

### 6.1 Tab Bars

```css
.tab-bar {
  border-bottom: 2px solid #e2e8f0
  background:    white
}
.tab {
  padding:       10px 20px
  font-size:     13px
  font-weight:   500
  color:         #64748b
  border-bottom: 2px solid transparent
  margin-bottom: -2px        /* overlap tab-bar border */
}
.tab:hover { color: #1e293b }
.tab--active {
  color:              var(--brand-navy, #1d4ed8)
  border-bottom-color: var(--brand-navy, #1d4ed8)
  font-weight:        600
}
```

**Reference:** `.azc-tabs`/`.azc-tab`, `.sp-tabs`/`.sp-tab`

### 6.2 Buttons

| Variant   | Background              | Text    | Border                  | Hover                    |
|-----------|------------------------|---------|-------------------------|--------------------------|
| Primary   | `var(--brand-navy)`    | white   | `var(--brand-navy)`     | `var(--brand-navy-dark)` |
| Secondary | `#f8fafc`              | #1e293b | `1px solid #cbd5e1`     | `#f1f5f9` bg, `#94a3b8` border |
| Danger    | `#b45309`              | white   | `#b45309`               | `#92400e`                |
| Ghost     | `rgba(255,255,255,0.12)`| white  | `rgba(255,255,255,0.22)` | `rgba(255,255,255,0.22)` |

All buttons: `border-radius: 6px; font-weight: 600; font-size: 12.5–13px; padding: 7–9px 14–22px`

Disabled state: `opacity: 0.55; cursor: not-allowed`

### 6.3 Status Badges

```css
.badge {
  display:        inline-block
  padding:        4px 10px
  border-radius:  20px
  font-size:      11px
  font-weight:    700
  text-transform: uppercase
  letter-spacing: 0.04em
}
```

Use semantic colors from §1.4.

### 6.4 Section-Nav Sidebar (Config pages)

```css
.section-nav-item {
  border-left:   3px solid transparent
  font-size:     0.875rem
  color:         #374151
}
.section-nav-item:hover {
  background:         #f8fafc
  border-left-color:  #e2e8f0
}
.section-nav-item.active {
  background:         #eff6ff
  color:              var(--brand-navy)
  border-left-color:  var(--brand-navy)
  font-weight:        600
}
```

---

## 7. Remediation Plan

Components are grouped by effort level. Agent UI is out of scope.

### Phase A — CSS-only fixes (no JSX changes)

These need only CSS value corrections in existing files.

| File | Issue | Fix |
|------|-------|-----|
| `LlmConfigPanel.css` | `.config-section`: radius 8px, `#ddd` border, no shadow | → 10px, `#e2e8f0`, `0 1px 3px rgba(0,0,0,0.06)` |
| `McpGatewayConfig.css` | `.mgc-doc-card`, `.mgc-wizard-step`: radius 8px, `#e9ecef` border | → 10px, `#e2e8f0`, add shadow |
| `AdminErrorAuditLog.css` | `.error-audit-log`: no shadow, radius 8px | → 10px, add shadow |
| `DemoDataPage.css` | `.demo-data-type-slot`: radius 8px, `#DDDDDD` border | → 8px (inner card — ok), `#e5e7eb` |
| `AdminDelegationPage.js` | Inline card style: `borderRadius: 8` | → CSS class with 10px |
| `App.css` | `.otp-step-up-modal`: shadow too aggressive | → `var(--modal-shadow)` |

### Phase B — Modal shell migrations

Modals that bypass `DraggableModal` and need migrating (same pattern as Phase 4 previously completed for ComplianceModal, MissingCredentialsModal, KillSwitchConfirmModal).

| Component | Current shell | Priority | Notes |
|-----------|--------------|----------|-------|
| `DemoServerCheckModal` | Custom `.dsm-box` overlay | High | Shows during server startup — user-facing |
| `AgentDemoGuide` | Custom `.agent-demo-guide-modal` with own resize | High | User called this out specifically. Has 8-direction resize — evaluate whether `DraggableModal` resize handles it |
| `ErrorModal` | Custom `.error-modal` + overlay | Medium | Blocking error states |
| `MCPToolsListModal` | Custom overlay, light blue header | Medium | Admin-only; already has inner-card list items |
| `RunServersModal` | Custom dark shell `.rsm-box` | Low | Dev-only; intentionally dark-themed — consider leaving as-is |

> `RunServersModal` uses a dark terminal theme intentionally. Mark as **exempt** unless the user disagrees.

### Phase C — Inner content standardization

Pages whose section content uses Level-1 card styles where Level-2/3 is correct, or vice versa.

| Page | Issue |
|------|-------|
| `SecuritySettings.js` | Main form card uses raw inline styles → extract to CSS, align with Level-1 |
| `Config.css` (`.card`) | Custom P1 shadow `0 10px 28px rgba(39,123,165,0.07)` → standard shadow |
| `TokenChainDisplay.css` (`.tcd-root`) | `border-radius: 14px`, inset shadow → `var(--inner-card-radius)` |
| `PingOneSetupGuidePage.js` | Unknown — needs audit pass |
| `VercelConfigTab.js` | Table-only, no card wrapper → add Level-1 card container |
| `WorkerAppConfigTab.js` | Unknown — needs audit pass |
| `AdminDelegationPage.js` | Inline styles throughout → needs CSS file |

### Phase D — Token adoption

Remaining hardcoded values that should reference the design tokens.

- `#e2e8f0` used as a literal in ~12 files → should use `var(--inner-card-border)` or `var(--modal-footer-border)`
- `#1d4ed8` (brand navy) used as a literal in ~8 files → `var(--brand-navy)`
- `linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)` in some files → `var(--modal-header-bg)`

---

## 8. Compliance Checklist

Use this checklist when building or reviewing any new card, panel, or modal.

### Card checklist
- [ ] Is this a page-level panel? → Level-1: `10px radius, 1px solid #e2e8f0, shadow 0 1px 3px rgba(0,0,0,0.06)`
- [ ] Is this a sub-item inside a panel? → Level-2: inner-card tokens
- [ ] Is this a status/info callout? → Level-3: alert with left accent
- [ ] No inline `background: white; borderRadius: X` styles — use a CSS class
- [ ] Page background is `#f1f5f9`, not white

### Modal checklist
- [ ] Uses `DraggableModal` as outer shell (unless agent UI)
- [ ] Header uses `var(--modal-header-bg)` gradient
- [ ] Body content uses Level-2 cards, not Level-1
- [ ] No custom `.modal-overlay` / `.modal-backdrop` / custom drag/resize logic

### Form checklist
- [ ] Checkbox/radio: `margin: 0; flex-shrink: 0` on the `<input>` element
- [ ] Labels: `display: flex; align-items: center; gap: 8px`
- [ ] No `display: flex !important` — fix the `margin: 0` instead
- [ ] Input focus ring: `0 0 0 3px rgba(29,78,216,0.1)` not a heavy shadow

### Navigation checklist
- [ ] Tabs: `border-bottom: 2px solid; margin-bottom: -2px` underline pattern
- [ ] Active tab: `var(--brand-navy)` color — not `#007bff` or other blue
- [ ] Buttons have `border-radius: 6px`, not 4px or 8px

### Text checklist
- [ ] No emojis in UI labels, buttons, or status text
- [ ] `code` snippets: `background: #f1f5f9; border: 1px solid #e2e8f0; color: #7c3aed; border-radius: 4px`

---

*Last updated: 2026-05-07 — reflects Phases 1–5 of modal/card design system work.*
