# Phase 266 Path Filter Buttons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static legend cards on `/architecture/phase-266` with interactive path-selector buttons that CSS-dim non-selected path nodes in the Mermaid diagram.

**Architecture:** A `selectedPath` state (`null | 'A' | 'B' | 'C'`) drives both the active button style and a `data-selected-path` attribute on the diagram wrapper. After the single Mermaid render at mount, a `tagPathNodes()` function stamps `data-path` attributes onto SVG `<g>` elements. CSS rules on `.p266-path-active` + `[data-path]` handle all dimming — zero re-renders on path switch.

**Tech Stack:** React 18 (hooks), Mermaid 11, plain CSS (no Tailwind), CRA build (`demo_api_ui/`).

---

## Files

| File | Change |
|---|---|
| `demo_api_ui/src/components/Phase266ArchitecturePage.jsx` | Add `selectedPath` state, `PathFilterBar` component, `tagPathNodes()` helper, update render JSX |
| `demo_api_ui/src/components/Phase266ArchitecturePage.css` | Add `PathFilterBar` button styles + path dimming rules; remove old legend styles |

No new files. No other files touched.

---

## Task 1: Add CSS — PathFilterBar styles + path dimming rules

**Files:**
- Modify: `demo_api_ui/src/components/Phase266ArchitecturePage.css`

- [ ] **Step 1.1: Open the CSS file and append the new rules at the bottom**

Add the following block at the very end of `demo_api_ui/src/components/Phase266ArchitecturePage.css` (after the last rule on line 196):

```css
/* ── PathFilterBar ─────────────────────────────────────────────── */

.p266-filter-bar {
  max-width: 1280px;
  margin: 0 auto 1.5rem;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.p266-filter-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border: 2px solid #e5e7eb;
  border-radius: 5px;
  background: #ffffff;
  color: #6b7280;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
  font-family: inherit;
  line-height: 1;
}

.p266-filter-btn:hover {
  border-color: #9ca3af;
  color: #374151;
}

/* "All" button active */
.p266-filter-btn--all-active {
  background: #1f2937;
  border-color: #1f2937;
  color: #ffffff;
}

/* Path A active */
.p266-filter-btn--A-active {
  background: #fef3c7;
  border-color: #b45309;
  color: #78350f;
}

/* Path B active */
.p266-filter-btn--B-active {
  background: #ccfbf1;
  border-color: #0f766e;
  color: #134e4a;
}

/* Path C active */
.p266-filter-btn--C-active {
  background: #eff6ff;
  border-color: #1e40af;
  color: #1e3a8a;
}

.p266-filter-swatch {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

/* ── Path dimming ───────────────────────────────────────────────── */

/* When a path is selected, dim all tagged nodes that are NOT shared */
.p266-path-active [data-path]:not([data-path="shared"]) {
  opacity: 0.15;
  transition: opacity 0.2s ease;
}

/* Un-dim nodes that belong to the selected path */
.p266-path-active[data-selected-path="A"] [data-path="A"],
.p266-path-active[data-selected-path="B"] [data-path="B"],
.p266-path-active[data-selected-path="C"] [data-path="C"] {
  opacity: 1;
}
```

- [ ] **Step 1.2: Remove the old legend styles**

Delete the following block from the CSS file (lines 43–86 in the original):

```css
.p266-arch-legend-row {
  max-width: 1280px;
  margin: 0 auto 1.5rem;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}

@media (max-width: 900px) {
  .p266-arch-legend-row { grid-template-columns: 1fr; }
}

.p266-arch-legend-card {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 14px 16px;
}

.p266-arch-legend-swatch {
  display: inline-block;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  margin-top: 3px;
  flex-shrink: 0;
}

.p266-arch-legend-card strong {
  display: block;
  font-size: 14px;
  color: #111827;
  margin-bottom: 4px;
}

.p266-arch-legend-card p {
  font-size: 13px;
  color: #4b5563;
  margin: 0;
  line-height: 1.45;
}
```

- [ ] **Step 1.3: Verify the build still passes**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui && npm run build 2>&1 | tail -5
```

Expected: `Compiled successfully.` (exit 0). CSS-only change — no JS errors expected.

- [ ] **Step 1.4: Commit**

```bash
git add demo_api_ui/src/components/Phase266ArchitecturePage.css
git commit -m "style(p266): add PathFilterBar + path dimming CSS; remove old legend styles"
```

---

## Task 2: Add `tagPathNodes()` helper and wire `selectedPath` state

**Files:**
- Modify: `demo_api_ui/src/components/Phase266ArchitecturePage.jsx`

- [ ] **Step 2.1: Add `selectedPath` state and `tagPathNodes()` to the component**

Replace the existing `export default function Phase266ArchitecturePage()` block (lines 155–289) with the following. Everything from `MERMAID_SOURCE`, `PATH_LEGEND`, and `SPEC_HOPS` constants at the top of the file stays **unchanged** — only the function body changes.

```jsx
// Node identifier strings from the Mermaid source that map to each path.
// tagPathNodes() checks whether a <g>'s text content *contains* one of these
// strings. More specific strings first to avoid substring false-positives.
const PATH_NODE_MAP = {
  A: ["MortgageService", "PathInfo"],
  B: ["Identity", "InternalIdToken"],
  C: ["Accounts", "Transactions", "BankingDb"],
  shared: ["User", "SPA", "Gateway", "PingOne", "Session"],
};

/**
 * Walk all <g> elements in the rendered Mermaid SVG and stamp data-path
 * attributes so CSS can dim/highlight nodes by path selection.
 * Called once after mermaid.render() injects the SVG.
 */
function tagPathNodes(container) {
  const groups = container.querySelectorAll("g");
  groups.forEach((g) => {
    const text = g.textContent || "";
    for (const [path, identifiers] of Object.entries(PATH_NODE_MAP)) {
      if (identifiers.some((id) => text.includes(id))) {
        g.setAttribute("data-path", path);
        break; // first match wins
      }
    }
  });
}

function PathFilterBar({ selectedPath, onSelect }) {
  const paths = [
    { key: null, label: "All", swatch: null, color: null },
    { key: "A", label: "Path A — API-key", swatch: "#b45309", color: "#b45309" },
    { key: "B", label: "Path B — Dual Token", swatch: "#0f766e", color: "#0f766e" },
    { key: "C", label: "Path C — OAuth Bearer", swatch: "#1e40af", color: "#1e40af" },
  ];

  return (
    <div className="p266-filter-bar">
      {paths.map(({ key, label, swatch }) => {
        const isActive = selectedPath === key;
        let activeClass = "";
        if (isActive) {
          activeClass = key === null ? "p266-filter-btn--all-active" : `p266-filter-btn--${key}-active`;
        }
        return (
          <button
            key={String(key)}
            className={`p266-filter-btn ${activeClass}`}
            onClick={() => onSelect(key)}
            aria-pressed={isActive}
          >
            {swatch && (
              <span
                className="p266-filter-swatch"
                style={{ background: swatch }}
              />
            )}
            {label}
          </button>
        );
      })}
    </div>
  );
}

export default function Phase266ArchitecturePage() {
  const containerRef = useRef(null);
  const [renderError, setRenderError] = useState(null);
  const [selectedPath, setSelectedPath] = useState(null);

  useEffect(() => {
    let cancelled = false;
    mermaid.initialize({
      startOnLoad: false,
      theme: "default",
      securityLevel: "loose",
      flowchart: { htmlLabels: true, useMaxWidth: true, curve: "basis" },
    });

    async function render() {
      try {
        const { svg } = await mermaid.render(
          "phase266-architecture-svg",
          MERMAID_SOURCE,
        );
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
          tagPathNodes(containerRef.current);
        }
      } catch (err) {
        if (!cancelled) {
          setRenderError(err?.message || "Mermaid render failed");
        }
      }
    }
    render();
    return () => {
      cancelled = true;
    };
  }, []);

  const wrapperClass = [
    "p266-arch-diagram-wrapper",
    selectedPath ? "p266-path-active" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="p266-arch-page">
      <header className="p266-arch-header">
        <span className="p266-arch-eyebrow">Phase 266</span>
        <h1>Three Credential Paths — Architecture</h1>
        <p className="p266-arch-subtitle">
          One Gateway, three credential mechanisms. Live Mermaid render —
          matches the diagram approved before execution.
        </p>
        <p className="p266-arch-subtitle">
          Scope: this view is intentionally limited to the Phase 266
          credential-disposition paths. The investment MCP server
          (banking_mcp_invest) and HITL consent service (banking_hitl_service)
          are out of scope here — see the Flow and Token Flow pages for those.
        </p>
      </header>

      <PathFilterBar selectedPath={selectedPath} onSelect={setSelectedPath} />

      <section
        className={wrapperClass}
        {...(selectedPath ? { "data-selected-path": selectedPath } : {})}
      >
        {renderError ? (
          <div className="p266-arch-error">
            <strong>Diagram failed to render:</strong> {renderError}
          </div>
        ) : (
          <div ref={containerRef} className="p266-arch-diagram" />
        )}
      </section>

      <section className="p266-arch-spec-section">
        <h2>Specs exercised by this flow</h2>
        <p className="p266-arch-spec-intro">
          Phase 266 is spec-compliant end-to-end. Every hop in the diagram cites
          a specific IETF / OIDC / MCP standard:
        </p>
        <dl className="p266-arch-spec-list">
          {SPEC_HOPS.map((s) => (
            <div key={s.label} className="p266-arch-spec-row">
              <dt>{s.label}</dt>
              <dd>{s.summary}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="p266-arch-notes">
        <h2>Key architectural decisions</h2>
        <ul>
          <li>
            <strong>Gateway = traffic cop.</strong> Single point that decides
            routing, performs RFC 8693 exchange, and emits{" "}
            <code>_meta.credentialPath</code> +<code>_meta.tokenEvents</code> so
            the SPA renders the right surface and the audit chain is visible.
          </li>
          <li>
            <strong>Inbound user bearer is NEVER forwarded unchanged.</strong>{" "}
            Paths B and C both go through PingOne RFC 8693 first; the new
            token's
            <code>aud=banking_resource_server</code> and{" "}
            <code>act.client_id=gateway-client</code>.
          </li>
          <li>
            <strong>id_token never reaches the browser as raw JWT.</strong>{" "}
            Decoded server-side via <code>sanitizeClaims</code>;{" "}
            <code>scrubRawJwts</code> walker on the response body as
            defense-in-depth.
          </li>
          <li>
            <strong>
              Existing <code>/summary</code> route preserved untouched.
            </strong>{" "}
            <code>ResourceServerPage.jsx</code> continues to use it; new
            LMDB-backed
            <code>/accounts</code> + <code>/transactions</code> routes are
            siblings.
          </li>
          <li>
            <strong>Audit trail per request.</strong> Every successful{" "}
            <code>/identity</code> call logs an <code>INTROSPECTION</code>
            -category event with <code>{"{ sub, aud, act, may_act }"}</code> —
            explicitly NOT PII (no name/email/picture).
          </li>
        </ul>
      </section>
    </div>
  );
}
```

> **Note:** The `PATH_LEGEND` constant is no longer used after this change — remove it from the top of the file (lines 95–117 in the original). `MERMAID_SOURCE` and `SPEC_HOPS` are unchanged.

- [ ] **Step 2.2: Remove the unused `PATH_LEGEND` constant**

Delete this block from the top of the file (keep `MERMAID_SOURCE` and `SPEC_HOPS` exactly as-is):

```js
const PATH_LEGEND = [
  {
    key: "A",
    label: "Path A — API-key (mortgage service)",
    swatch: "#b45309",
    description:
      'Gateway swaps bearer for service API key, calls banking_mortgage_service :8082 (X-API-Key). Prompt: "show mortgage data".',
  },
  {
    key: "B",
    label: "Path B — Access + ID-Token",
    swatch: "#0f766e",
    description:
      "Gateway POSTs JSON-RPC envelope to /api/resource-server/identity (bearer + id_token).",
  },
  {
    key: "C",
    label: "Path C — OAuth Bearer",
    swatch: "#1e40af",
    description:
      "Gateway GETs /api/resource-server/accounts + /transactions (LMDB-backed, exchanged bearer).",
  },
];
```

- [ ] **Step 2.3: Verify the build passes**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui && npm run build 2>&1 | tail -10
```

Expected: `Compiled successfully.` (exit 0). If there are lint warnings about unused variables, confirm `PATH_LEGEND` was removed in step 2.2.

- [ ] **Step 2.4: Commit**

```bash
git add demo_api_ui/src/components/Phase266ArchitecturePage.jsx
git commit -m "feat(p266): replace legend cards with PathFilterBar + SVG path dimming"
```

---

## Task 3: Manual smoke test

**Files:** None — verification only.

- [ ] **Step 3.1: Start the app (if not already running)**

```bash
cd /Users/curtismuir/Development/AI-Demo && ./run.sh
```

Wait for all services to be healthy (`./run.sh status`).

- [ ] **Step 3.2: Navigate to the architecture page**

Open `https://api.ping.demo:4000/architecture/phase-266` in a browser.

Verify:
- Four buttons appear where the legend cards used to be: **All**, **Path A — API-key**, **Path B — Dual Token**, **Path C — OAuth Bearer**
- "All" button has a dark filled background (active state) on initial load
- Each path button shows a colored dot to the left of its label
- The Mermaid diagram renders correctly below the buttons

- [ ] **Step 3.3: Test Path A selection**

Click **Path A — API-key**.

Verify:
- Path A button becomes amber (`#fef3c7` background, `#b45309` border/text)
- "All" button reverts to inactive (outline, muted)
- In the diagram: `MortgageService` and `PathInfo` nodes remain at full opacity
- `Identity`, `InternalIdToken`, `Accounts`, `Transactions`, `BankingDb` nodes fade to ~15% opacity
- `User`, `SPA`, `Gateway`, `PingOne`, `Session` nodes stay at full opacity (shared)
- Specs and Key Decisions sections below are unchanged

- [ ] **Step 3.4: Test Path B and Path C**

Click **Path B — Dual Token**. Verify teal active state. `Identity` and `InternalIdToken` nodes at full opacity; Path A and C nodes dimmed; shared nodes always full.

Click **Path C — OAuth Bearer**. Verify blue active state. `Accounts`, `Transactions`, `BankingDb` at full opacity; Path A and B nodes dimmed.

- [ ] **Step 3.5: Test "All" reset**

With any path active, click **All**. Verify all nodes return to full opacity and the "All" button shows the dark filled active state.

- [ ] **Step 3.6: Final build check + commit**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui && npm run build 2>&1 | tail -5
```

Expected: `Compiled successfully.`

```bash
git add -A
git commit -m "chore(p266): verify path filter smoke test passed"
```

> Only commit if there were any unstaged cleanup changes. If the build was clean and nothing changed, skip the commit.
