# Gateway Enforcement Map Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 3-column parallel-inventory diagram with a single-flow Journey diagram + 5 per-rule "what's at stake" scenario cards, per `docs/superpowers/specs/2026-08-12-gateway-enforcement-map-redesign-design.md` (approved).

**Architecture:** `scripts/gen-gateway-enforcement-map.js` stays the single source of truth. It gains a `scenario` field per row, a `worstTier()` helper (reuses the existing `done`/`flagged`/`pending` vocabulary — no new terms), a `buildJourneyMermaid()` replacing `buildMermaid()`, and a `buildStakes()` producing per-row scenario+verdict data. Two new exports (`GATEWAY_ENFORCEMENT_JOURNEY_MERMAID`, `GATEWAY_ENFORCEMENT_STAKES`) feed both UI surfaces and the doc.

**Tech Stack:** Same as the rest of this work — plain Node script, React 19 + mermaid.js for rendering, no new dependencies.

## Global Constraints

- No enforcement-logic changes — this is presentation-layer only.
- Reuse the existing `done`/`flagged`/`pending` status vocabulary throughout — do not introduce new tier names (e.g. no "partial"/"gap" as distinct code-level terms; `worstTier()` returns one of the same three).
- Real app theme tokens (`--th-bg-card`, `--th-bg-inset`, `--th-text`, `--th-text-muted`, `--th-border` — defined in `demo_api_ui/src/index.css`) for structural colors in both React components. Status-tier colors (done/flagged/pending) stay dedicated literals, matching `STATUS_LABEL`'s existing convention.
- Verify both light and dark theme render correctly live before calling done (per this repo's documented `--th-*`/`--ba` fallback trap history).
- `PG_LOCAL_RAR_PAYEE_ENFORCE` stays off — nothing here touches that.

---

## File structure

- Modify `scripts/gen-gateway-enforcement-map.js` — add `scenario` per row, `worstTier()`, `buildJourneyMermaid()` (replaces `buildMermaid()`), `buildStakes()`, `verdictTextFor()`; update `docOut`/`uiOut` templates
- Modify `demo_api_ui/src/components/GatewayEnforcementMapPage.jsx` — Journey diagram + stakes cards + existing table
- Modify `demo_api_ui/src/components/education/GatewayPolicySplitPanel.js` — same restructure inside the "Enforcement map" tab only; other tabs untouched

---

### Task 1: Generator script — scenario data, worstTier, Journey diagram, stakes data

**Files:**
- Modify: `scripts/gen-gateway-enforcement-map.js`

**Interfaces:**
- Produces: `GATEWAY_ENFORCEMENT_JOURNEY_MERMAID` (string), `GATEWAY_ENFORCEMENT_STAKES` (`Array<{id, label, scenario, verdictTier, verdictText}>`) — new exports in the generated UI file. `GATEWAY_ENFORCEMENT_ROWS` stays unchanged (still feeds the reference table). The old `GATEWAY_ENFORCEMENT_MERMAID` export is **removed** (no longer used by either consumer after Tasks 2-3).

- [ ] **Step 1: Add `scenario` to each ROWS entry**

In `scripts/gen-gateway-enforcement-map.js`, add one field to each of the 5 objects in the `ROWS` array (insert `scenario:` alongside the existing `id`/`label`/`p1az`/`node`/`groovy` keys):

```js
  {
    id: 'temporal',
    label: 'Temporal exp/iat/nbf',
    scenario: 'A token minted hours ago, past the demo\'s replay window, gets replayed against a tool call — exp alone doesn\'t catch this, only iat max-age does.',
    p1az: p1azReasonFor(...), // unchanged
    ...
```

Full scenario text for all 5 (insert the matching one into each row, right after `label`):

- `temporal`: `'A token minted hours ago, past the demo\'s replay window, gets replayed against a tool call — exp alone doesn\'t catch this, only iat max-age does.'`
- `scope`: `'A token carries the coarse gateway:mcp:invoke scope but never earned transfer — and tries to call create_transfer anyway.'`
- `rar`: `'A transfer\'s granted intent named one payee — the actual call sends the funds somewhere else.'`
- `d05`: `'An agent presents a token whose aud already targets the banking resource server directly — skipping the gateway hop entirely.'`
- `tier`: `'A Standard-tier caller invokes a PrivateBanking-only tool, or tries to move more than their tier\'s ceiling.'`

- [ ] **Step 2: Add `worstTier()` and `verdictTextFor()`**

Insert right after the existing `status()` function (currently ends around line 129):

```js
/** The worse of the two gateways' status for a rule — reuses the existing
 * done/flagged/pending vocabulary, no new tier names. */
function worstTier(row) {
  const n = status(row.node);
  const g = status(row.groovy);
  if (n === 'pending' || g === 'pending') return 'pending';
  if (n === 'flagged' || g === 'flagged') return 'flagged';
  return 'done';
}

function verdictTextFor(row, tier) {
  if (tier === 'done') return 'Caught locally — both gateways';
  if (tier === 'pending') return 'Would slip through — see the table below';
  const nodeOk = status(row.node) === 'done';
  const groovyOk = status(row.groovy) === 'done';
  if (nodeOk && !groovyOk) return 'Node catches it — IG ships this off by default';
  if (groovyOk && !nodeOk) return 'IG catches it — Node does not yet';
  return 'Partially covered — see the table below';
}
```

- [ ] **Step 3: Replace `buildMermaid()` with `buildJourneyMermaid()`**

Delete the entire existing `buildMermaid()` function (lines 137-173) and replace it with:

```js
function buildJourneyMermaid() {
  const lines = ['flowchart LR'];
  lines.push('  REQ["Tool call arrives"] --> P1AZ["P1AZ evaluates"]');
  for (const row of ROWS) {
    lines.push(`  P1AZ -.->|can't check| b_${row.id}["${row.label}"]`);
  }
  for (const row of ROWS) {
    lines.push(`  b_${row.id} --> GW["Gateway backstops"]`);
  }
  lines.push('  GW --> DEC["Final decision"]');
  lines.push('  classDef done fill:#0a2418,color:#6ee7b7,stroke:#059669,stroke-width:1px');
  lines.push('  classDef flagged fill:#2a1a00,color:#fbbf24,stroke:#d97706,stroke-width:1px,stroke-dasharray:2 2');
  lines.push('  classDef pending fill:#2d0a0a,color:#fca5a5,stroke:#dc2626,stroke-width:1px,stroke-dasharray:4 4');
  for (const s of ['done', 'flagged', 'pending']) {
    const ids = ROWS.filter((r) => worstTier(r) === s).map((r) => `b_${r.id}`);
    if (ids.length) lines.push(`  class ${ids.join(',')} ${s}`);
  }
  return lines.join('\n');
}

function buildStakes() {
  return ROWS.map((r) => {
    const tier = worstTier(r);
    return { id: r.id, label: r.label, scenario: r.scenario, verdictTier: tier, verdictText: verdictTextFor(r, tier) };
  });
}
```

- [ ] **Step 4: Update the computed-values block and `docOut`**

Replace:
```js
const mermaidSource = buildMermaid();
```
with:
```js
const journeyMermaid = buildJourneyMermaid();
const stakes = buildStakes();
```

In the `docOut` template literal, replace the `**Reading the diagram:**` paragraph and the mermaid fence with:

```
**Reading the diagram:** the top row (P1AZ) is the cloud PDP — it structurally
cannot check any of these 5 rules itself (DSL limits, see the table below). Each
rule branches off, then reconverges at the gateway that checks it instead.

\`\`\`mermaid
${journeyMermaid}
\`\`\`

## What's at stake

${stakes.map((s) => {
  const icon = s.verdictTier === 'done' ? '✅' : s.verdictTier === 'flagged' ? '⚠️' : '❌';
  return `**${s.label}**\n> ${s.scenario}\n\n${icon} ${s.verdictText}`;
}).join('\n\n')}
```

(This replaces the existing `**Reading the diagram:**` paragraph + `\`\`\`mermaid\n${mermaidSource}\n\`\`\`` block — keep everything else in `docOut`, including the `## Detail` section and `markdownTable`, unchanged.)

- [ ] **Step 5: Update `uiOut`**

Replace:
```js
export const GATEWAY_ENFORCEMENT_MERMAID = \`${mermaidSource}\`;
```
with:
```js
export const GATEWAY_ENFORCEMENT_JOURNEY_MERMAID = \`${journeyMermaid}\`;

export const GATEWAY_ENFORCEMENT_STAKES = ${JSON.stringify(stakes, null, 2)};
```

Keep `GATEWAY_ENFORCEMENT_ROWS` export exactly as-is (still needed by the reference table in both consumers).

- [ ] **Step 6: Run and inspect**

Run: `node scripts/gen-gateway-enforcement-map.js`
Expected: exits 0, prints `Wrote docs/gateway-enforcement-map.md`, `Wrote demo_api_ui/.../gatewayEnforcementDiagram.generated.js`, and the done-count line.

Read the generated `demo_api_ui/src/components/education/gatewayEnforcementDiagram.generated.js` and confirm it exports `GATEWAY_ENFORCEMENT_JOURNEY_MERMAID`, `GATEWAY_ENFORCEMENT_STAKES` (5 entries, each with `scenario`/`verdictTier`/`verdictText`), and `GATEWAY_ENFORCEMENT_ROWS` (unchanged shape) — no `GATEWAY_ENFORCEMENT_MERMAID`.

Read `docs/gateway-enforcement-map.md` and confirm the Journey mermaid block and "What's at stake" section render as valid markdown.

- [ ] **Step 7: Commit**

```bash
git add scripts/gen-gateway-enforcement-map.js docs/gateway-enforcement-map.md demo_api_ui/src/components/education/gatewayEnforcementDiagram.generated.js
git commit -m "feat(diagrams): generate Journey diagram + per-rule stakes data, drop 3-column mermaid"
```

(The two consumer components still import the now-removed `GATEWAY_ENFORCEMENT_MERMAID` at this point — Tasks 2-3 fix that. A worktree build will fail between this commit and Task 2's; that's expected mid-plan, not a stopping point.)

---

### Task 2: `GatewayEnforcementMapPage.jsx` — Journey + stakes cards

**Files:**
- Modify: `demo_api_ui/src/components/GatewayEnforcementMapPage.jsx`

**Interfaces:**
- Consumes: `GATEWAY_ENFORCEMENT_JOURNEY_MERMAID`, `GATEWAY_ENFORCEMENT_STAKES`, `GATEWAY_ENFORCEMENT_ROWS` from `./education/gatewayEnforcementDiagram.generated` (Task 1's output).

- [ ] **Step 1: Update imports and mermaid source**

Replace:
```jsx
import {
  GATEWAY_ENFORCEMENT_MERMAID,
  GATEWAY_ENFORCEMENT_ROWS,
} from "./education/gatewayEnforcementDiagram.generated";
```
with:
```jsx
import {
  GATEWAY_ENFORCEMENT_JOURNEY_MERMAID,
  GATEWAY_ENFORCEMENT_STAKES,
  GATEWAY_ENFORCEMENT_ROWS,
} from "./education/gatewayEnforcementDiagram.generated";
```

Replace `useState(GATEWAY_ENFORCEMENT_MERMAID)` with `useState(GATEWAY_ENFORCEMENT_JOURNEY_MERMAID)`.

- [ ] **Step 2: Add the verdict-tier → color mapping (same 3 literals used in Task 1's mermaid classDefs, for CSS parity)**

Add near `STATUS_LABEL`:
```jsx
const VERDICT_STYLE = {
  done: { bg: "#0a2418", fg: "#6ee7b7", border: "#059669", icon: "✅" },
  flagged: { bg: "#2a1a00", fg: "#fbbf24", border: "#d97706", icon: "⚠️" },
  pending: { bg: "#2d0a0a", fg: "#fca5a5", border: "#dc2626", icon: "❌" },
};
```

- [ ] **Step 3: Replace the two intro `<p>` tags and add the stakes section**

Replace the "Reading the diagram" paragraph's copy (the arrows no longer say "needs a PEP backstop" — Task 1 already changed the mermaid, this just updates the surrounding prose to match the new single-flow shape) and insert a stakes section between the diagram and the reference table:

```jsx
      <p style={{ opacity: 0.7, maxWidth: 760, fontSize: 13 }}>
        <strong>Reading the diagram:</strong> P1AZ (the cloud PDP) structurally can't check
        any of these 5 rules — each one branches off, then reconverges at the gateway that
        checks it instead. Box color shows whether that backstop is live today.
      </p>

      <DiagramExportBar
        source={source}
        sourceFilename="gateway-enforcement-map.mmd"
        onSourceChange={setSource}
      />

      {renderError ? (
        <p style={{ color: "#dc2626" }}>Diagram failed to render: {renderError}</p>
      ) : (
        <div ref={containerRef} role="img" aria-label="Gateway enforcement journey" style={{ overflow: "auto", margin: "12px 0" }} />
      )}

      <h2 style={{ fontSize: 16, marginTop: 32 }}>What's at stake</h2>
      <div style={{ display: "flex", gap: 14, overflowX: "auto", paddingBottom: 8 }}>
        {GATEWAY_ENFORCEMENT_STAKES.map((s) => {
          const style = VERDICT_STYLE[s.verdictTier];
          return (
            <div
              key={s.id}
              style={{
                background: "var(--th-bg-card)",
                border: "1px solid var(--th-border)",
                borderRadius: 10,
                padding: 18,
                minWidth: 260,
                maxWidth: 260,
                flexShrink: 0,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--th-text)" }}>{s.label}</div>
              <div style={{ fontSize: 12.5, color: "var(--th-text-muted)", lineHeight: 1.5, fontStyle: "italic" }}>
                {s.scenario}
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 12,
                  padding: "8px 10px",
                  borderRadius: 6,
                  background: style.bg,
                  color: style.fg,
                  border: `1px solid ${style.border}`,
                }}
              >
                <span>{style.icon}</span>
                <span>{s.verdictText}</span>
              </div>
            </div>
          );
        })}
      </div>
```

This replaces the file's existing `<DiagramExportBar>` + render-error/diagram-container block (moves the "Reading the diagram" paragraph's copy, keeps the export bar and diagram container structurally identical) and inserts the new stakes section immediately after. The existing reference `<table className="edu-table">` block stays exactly as-is below this.

- [ ] **Step 4: Build**

Run: `cd demo_api_ui && npm run build`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/GatewayEnforcementMapPage.jsx
git commit -m "feat(diagrams): render Journey + stakes cards on the gateway-enforcement-map page"
```

---

### Task 3: `GatewayPolicySplitPanel.js` — same restructure in the Enforcement map tab

**Files:**
- Modify: `demo_api_ui/src/components/education/GatewayPolicySplitPanel.js`

**Interfaces:**
- Consumes: same 3 exports as Task 2, imported from `./gatewayEnforcementDiagram.generated` (relative path differs — this file lives one directory closer).

- [ ] **Step 1: Update imports**

Replace:
```js
import { GATEWAY_ENFORCEMENT_MERMAID, GATEWAY_ENFORCEMENT_ROWS } from './gatewayEnforcementDiagram.generated';
```
with:
```js
import { GATEWAY_ENFORCEMENT_JOURNEY_MERMAID, GATEWAY_ENFORCEMENT_STAKES, GATEWAY_ENFORCEMENT_ROWS } from './gatewayEnforcementDiagram.generated';
```

In `EnforcementMapDiagram`, replace the `mermaid.render('gw-enforcement-map-svg', GATEWAY_ENFORCEMENT_MERMAID)` call's second argument with `GATEWAY_ENFORCEMENT_JOURNEY_MERMAID`.

- [ ] **Step 2: Add the same `VERDICT_STYLE` map used in Task 2**

Add near `STATUS_LABEL` (top of file):
```js
const VERDICT_STYLE = {
  done: { bg: '#0a2418', fg: '#6ee7b7', border: '#059669', icon: '✅' },
  flagged: { bg: '#2a1a00', fg: '#fbbf24', border: '#d97706', icon: '⚠️' },
  pending: { bg: '#2d0a0a', fg: '#fca5a5', border: '#dc2626', icon: '❌' },
};
```

- [ ] **Step 3: Replace the "Reading the diagram" paragraph and add the stakes section, in 2-up wrap (not horizontal scroll — this panel is `min(720px, 100vw)` wide, narrower than the standalone page)**

Inside the `'enforcement-map'` tab's content, replace the `<p style={{ fontSize: 13, opacity: 0.8 }}>...Reading the diagram...</p>` block with updated copy matching Task 2's, and insert the stakes grid between `<EnforcementMapDiagram />` and the reference `<table>`:

```jsx
          <p style={{ fontSize: 13, opacity: 0.8 }}>
            <strong>Reading the diagram:</strong> P1AZ structurally can't check any of these 5
            rules — each one branches off, then reconverges at the gateway that checks it
            instead. Box color shows whether that backstop is live today.
          </p>
          <EnforcementMapDiagram />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginTop: 16 }}>
            {GATEWAY_ENFORCEMENT_STAKES.map((s) => {
              const style = VERDICT_STYLE[s.verdictTier];
              return (
                <div key={s.id} style={{ border: '1px solid var(--th-border)', borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{s.label}</div>
                  <div style={{ fontSize: 11.5, opacity: 0.75, fontStyle: 'italic', lineHeight: 1.4 }}>{s.scenario}</div>
                  <div style={{ fontSize: 11, padding: '5px 8px', borderRadius: 5, background: style.bg, color: style.fg, border: `1px solid ${style.border}` }}>
                    {style.icon} {s.verdictText}
                  </div>
                </div>
              );
            })}
          </div>
```

Keep the reference `<table className="edu-table">` block and the trailing RAR-payee `<div className="edu-info-box">` exactly as they are today, immediately after this.

- [ ] **Step 4: Build**

Run: `cd demo_api_ui && npm run build`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/education/GatewayPolicySplitPanel.js
git commit -m "feat(diagrams): render Journey + stakes cards in the Learning Hub enforcement-map tab"
```

---

### Task 4: Full verification

- [ ] **Step 1: `npm run test:unit`**

Run: `cd demo_api_ui && npm run test:unit`
Expected: same pass count as before this work (no new test files added — verify no existing test asserts against the old `GATEWAY_ENFORCEMENT_MERMAID` export name or old diagram shape; if one does, update it to the new export names, same pattern as `uiRegression.test.js` earlier in this session).

- [ ] **Step 2: Live check, both themes**

With the stack running: navigate to `/gateway-enforcement-map` and the Learning Hub → Standards & Architecture → "Gateway vs P1AZ Decision Split" → Enforcement map tab, in both light and dark (toggle or `prefers-color-scheme`). Confirm: Journey diagram renders with 5 branch chips correctly colored, 5 stakes cards render with scenario + verdict text, reference table unchanged, no console errors, text legible in both themes (the `--th-*` token check this repo has been burned by before).

- [ ] **Step 3: Commit any fixes found in Step 1-2, then this is done.**

## Self-Review

**Spec coverage:** Journey diagram (Task 1 Step 3, Task 2/3 Step 1) ✓. Stakes cards, all 5 rules, live verdict (Task 1 Steps 1-2/4, Task 2/3 Step 3) ✓. Reference table kept (untouched in both consumers) ✓. Real theme tokens, not mockup palette (Task 2/3 use `var(--th-*)` for structural color, literals only for status tiers) ✓. Both themes verified live (Task 4 Step 2) ✓.

**Type/name consistency:** `worstTier()`/`verdictTextFor()` (Task 1) → `GATEWAY_ENFORCEMENT_STAKES` shape (`id`/`label`/`scenario`/`verdictTier`/`verdictText`) → `VERDICT_STYLE[s.verdictTier]` (Tasks 2-3) — same field names used consistently end to end.
