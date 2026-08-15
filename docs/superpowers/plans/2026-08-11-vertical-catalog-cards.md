# Vertical Catalog Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace plain-text/table agent replies with shopping-style card-grid
UI for three verticals: sporting-goods (product grid + real cart write),
airlines (real seat chart, read-only), and locations/branches (fixes a
currently-broken action, lands for all 11 verticals with existing catalog
data).

**Architecture:** Two new presentational React components
(`ProductCardGrid.jsx`, `SeatMapPanel.jsx`) plug into the existing
manifest-driven render pipeline (`VerticalResult.jsx` descriptor switch) for
sporting-goods and into a legacy ad-hoc message-extra pattern (`msg.verticalResult`-style)
for locations. Airlines swaps an existing real data source onto the new
component. No new microservice work, no new chip infra.

**Tech Stack:** React 19 (JSX, no TS) + Vitest/RTL for `demo_api_ui`; Node/CommonJS + Jest for `demo_api_server`.

## Global Constraints

- `demo_api_ui`: plain JS/JSX only, no TypeScript sources. Vitest (`npm run test:unit`), not jest. Build gate: `npm run build`.
- `demo_api_server`: CommonJS + Express + jest + supertest. `CI=true npm test -- --forceExit --maxWorkers=4`.
- HTTP only via `apiClient` / existing `runAction`/`sendAgentMessage` helpers — never a raw `axios` call from a new component.
- No `window.confirm` — not needed here (no destructive actions added).
- Emoji allowlist: `⚠️ ✅ ❌ 🔐 ✕ ✓ 👤 🔑 🪟 📚` — none needed in this feature's copy; don't add any.
- Every changed line must trace to this plan — no drive-by cleanup in `AIAgent.js` or `demoAgentLangGraphService.js` beyond what each task specifies.
- Work happens in worktree `worktree-vertical-catalog-cards` (already active) — verify with `git branch --show-current` before each commit.

---

### Task 1: `ProductCardGrid` component

**Files:**
- Create: `demo_api_ui/src/components/ProductCardGrid.jsx`
- Create: `demo_api_ui/src/components/ProductCardGrid.css`
- Test: `demo_api_ui/src/components/__tests__/ProductCardGrid.test.jsx`

**Interfaces:**
- Produces: `export default function ProductCardGrid({ kind, title, items, onAction })`
  - `kind`: `"products"` | `"locations"`.
  - `items`: array. For `kind="products"`, each item is `{ id, name, icon, price, priceWas, rating, reviewCount, stock }` (icon is one of a fixed string enum handled by an internal `ICONS` map — see Step 3). For `kind="locations"`, each item is the raw branch shape from `publicBranchCatalog.js`: `{ id, name, city, state, address, hours, atm }`.
  - `onAction`: `(tool: string, params: object) => void`, called only for `kind="products"` when the card button is clicked (`onAction("add_to_cart", { productId: item.id })`). Not called for `kind="locations"` (that button is a real `<a>` link, no callback).
- Consumes: nothing external — pure presentational component, no imports from other new files in this plan.

- [ ] **Step 1: Write the failing test**

```jsx
// demo_api_ui/src/components/__tests__/ProductCardGrid.test.jsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ProductCardGrid from "../ProductCardGrid";

const PRODUCTS = [
  { id: "p1", name: "Trail Runner Hiking Boots", icon: "boots", price: 129.99, priceWas: 149.99, rating: 4.6, reviewCount: 312, stock: "In stock" },
  { id: "p2", name: "65L Trekking Backpack", icon: "backpack", price: 189, rating: 4.8, reviewCount: 94, stock: "In stock" },
];

const BRANCHES = [
  { id: "branch-austin-main", name: "Super Banking Main Branch", city: "Austin", state: "TX", address: "100 Congress Ave, Austin, TX 78701", hours: "Mon–Fri 9:00–17:00, Sat 10:00–14:00", atm: true },
];

describe("ProductCardGrid", () => {
  it("renders a product card and fires onAction with the tool + productId on click", () => {
    const onAction = vi.fn();
    render(<ProductCardGrid kind="products" title="Gear" items={PRODUCTS} onAction={onAction} />);
    expect(screen.getByText("Trail Runner Hiking Boots")).toBeInTheDocument();
    expect(screen.getByText("$129.99")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Add to Cart" })[0]);
    expect(onAction).toHaveBeenCalledWith("add_to_cart", { productId: "p1" });
  });

  it("renders a location card with a real maps link and no onAction call", () => {
    const onAction = vi.fn();
    render(<ProductCardGrid kind="locations" title="Branches" items={BRANCHES} onAction={onAction} />);
    expect(screen.getByText("Super Banking Main Branch")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Get Directions" });
    expect(link).toHaveAttribute(
      "href",
      "https://www.google.com/maps/search/?api=1&query=100%20Congress%20Ave%2C%20Austin%2C%20TX%2078701",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener");
    fireEvent.click(link);
    expect(onAction).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run ProductCardGrid`
Expected: FAIL — `Failed to resolve import "../ProductCardGrid"`

- [ ] **Step 3: Write the component**

```jsx
// demo_api_ui/src/components/ProductCardGrid.jsx
import React from "react";
import "./ProductCardGrid.css";

// One hand-drawn line icon per product type this pass ships with. Unknown
// icon keys fall back to a plain box so a bad seed entry never breaks render.
const ICONS = {
  boots: (
    <svg viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M7 3v6.5l-3.6 2.7A2 2 0 0 0 2.6 14v3a2 2 0 0 0 2 2h14a2.5 2.5 0 0 0 0-5c-2.3 0-4.6-.6-6.6-1.8V3H7Z"/>
      <path d="M7 6.5h5M7 9h4.4"/>
    </svg>
  ),
  backpack: (
    <svg viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M9 8V6a3 3 0 0 1 6 0v2"/>
      <path d="M6 9a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9Z"/>
      <path d="M9 12.5h6v5.5H9z"/>
      <path d="M6 12H5M18 12h1"/>
    </svg>
  ),
  poles: (
    <svg viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M6 5 18 19"/><path d="M18 5 6 19"/><path d="M6 5H3M18 5h3"/>
      <circle cx="9.4" cy="15.4" r="1.5"/><circle cx="14.6" cy="15.4" r="1.5"/>
    </svg>
  ),
  bottle: (
    <svg viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M9.5 2.5h5v1.7"/>
      <rect x="9.5" y="1.3" width="5" height="1.8" rx="0.5"/>
      <path d="M9.8 4.2v2.2c0 .5-.2 1-.6 1.4l-.7.7c-.5.5-.8 1.2-.8 1.9V19a2 2 0 0 0 2 2h4.6a2 2 0 0 0 2-2v-8.6c0-.7-.3-1.4-.8-1.9l-.7-.7c-.4-.4-.6-.9-.6-1.4V4.2"/>
      <path d="M8 13.5h8"/>
    </svg>
  ),
  tent: (
    <svg viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 19h18"/><path d="M4 19 12 5l8 14"/>
      <path d="M9.3 19v-5.2L12 11.6l2.7 2.2V19"/>
    </svg>
  ),
  shirt: (
    <svg viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M9 3.3 6 5.6v3.1l2-.9V19a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V7.8l2 .9V5.6l-3-2.3-.9.8a3.1 3.1 0 0 1-4.2 0L9 3.3Z"/>
    </svg>
  ),
  location: (
    <svg viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 10 12 4l9 6"/><path d="M4 10h16v1.5H4z"/>
      <path d="M6 12v6M10 12v6M14 12v6M18 12v6"/><path d="M3 20h18"/>
    </svg>
  ),
};

function icon(key) {
  return ICONS[key] || <svg viewBox="0 0 24 24" fill="none" stroke-width="1.5"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>;
}

function mapUrlFor(address) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function ProductCard({ item, onAction }) {
  return (
    <div className="pcg-card">
      <div className="pcg-thumb pcg-thumb--product">{icon(item.icon)}</div>
      <div className="pcg-body">
        <div className="pcg-price-row">
          <span className="pcg-price">${item.price.toFixed(2)}</span>
          {item.priceWas != null && <span className="pcg-price-strike">${item.priceWas.toFixed(2)}</span>}
        </div>
        <p className="pcg-title">{item.name}</p>
        <div className="pcg-meta">
          {item.rating != null && <>{item.rating}★ ({item.reviewCount})<span className="pcg-dot" /></>}
          {item.stock}
        </div>
        <div className="pcg-btn">
          <button type="button" onClick={() => onAction("add_to_cart", { productId: item.id })}>
            Add to Cart
          </button>
        </div>
      </div>
    </div>
  );
}

function LocationCard({ item }) {
  return (
    <div className="pcg-card">
      <div className="pcg-thumb pcg-thumb--location">{icon("location")}</div>
      <div className="pcg-body">
        <div className="pcg-price-row">
          <span className="pcg-status">{item.hours}</span>
        </div>
        <p className="pcg-title">{item.name}</p>
        <div className="pcg-meta">{item.city}, {item.state}{item.atm ? <><span className="pcg-dot" />ATM</> : null}</div>
        <div className="pcg-btn">
          <a href={mapUrlFor(item.address)} target="_blank" rel="noopener">Get Directions</a>
        </div>
      </div>
    </div>
  );
}

export default function ProductCardGrid({ kind, title, items, onAction }) {
  return (
    <div className="pcg">
      {title && <div className="pcg-title-bar">{title}</div>}
      <div className="pcg-grid">
        {items.map((item) =>
          kind === "locations"
            ? <LocationCard key={item.id} item={item} />
            : <ProductCard key={item.id} item={item} onAction={onAction} />,
        )}
      </div>
    </div>
  );
}
```

```css
/* demo_api_ui/src/components/ProductCardGrid.css */
.pcg-title-bar {
  font-family: var(--v2-font-display, "Fraunces", Georgia, serif);
  font-weight: 600;
  font-size: 14px;
  margin-bottom: 8px;
}
.pcg-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(138px, 1fr));
  gap: 10px;
}
.pcg-card {
  background: var(--th-bg-card, #fff);
  border: 1px solid var(--th-border, #e0e3ee);
  border-radius: 9px;
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(23,27,46,0.04), 0 6px 16px rgba(23,27,46,0.05);
  display: flex;
  flex-direction: column;
}
.pcg-thumb {
  aspect-ratio: 1 / 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.pcg-thumb svg { width: 42%; height: 42%; }
.pcg-thumb--product { background: #ffedd5; }
.pcg-thumb--product svg { stroke: #c2410c; }
.pcg-thumb--location {
  background-color: #e6ecf5;
  background-image: linear-gradient(var(--th-border, #e0e3ee) 1px, transparent 1px),
    linear-gradient(90deg, var(--th-border, #e0e3ee) 1px, transparent 1px);
  background-size: 12px 12px;
}
.pcg-thumb--location svg { stroke: #1e3a5f; }
.pcg-body { padding: 9px 10px 10px; display: flex; flex-direction: column; gap: 5px; flex: 1; }
.pcg-price-row { display: flex; align-items: baseline; gap: 5px; flex-wrap: wrap; }
.pcg-price {
  font-family: var(--v2-font-mono, "IBM Plex Mono", ui-monospace, monospace);
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  font-weight: 600;
  background: #fde68a;
  color: #7c4a03;
  padding: 1px 5px;
  border-radius: 4px;
}
.pcg-price-strike {
  font-family: var(--v2-font-mono, "IBM Plex Mono", ui-monospace, monospace);
  font-size: 11px;
  color: #a89568;
  text-decoration: line-through;
}
.pcg-status {
  font-family: var(--v2-font-mono, "IBM Plex Mono", ui-monospace, monospace);
  font-size: 11.5px;
  font-weight: 600;
  background: var(--th-bg-inset, #eef0f8);
  color: #16a34a;
  padding: 1px 6px;
  border-radius: 4px;
}
.pcg-title { font-size: 12.5px; font-weight: 600; line-height: 1.3; margin: 0; }
.pcg-meta { font-size: 10.5px; color: var(--th-text-muted, #5b6178); display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.pcg-dot { width: 2.5px; height: 2.5px; border-radius: 50%; background: var(--th-text-muted, #5b6178); }
.pcg-btn { margin-top: auto; padding-top: 3px; }
.pcg-btn button, .pcg-btn a {
  width: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11.5px;
  font-weight: 600;
  border: 1px solid #1d4ed8;
  background: #e8edfd;
  color: #1d4ed8;
  border-radius: 6px;
  padding: 6px 8px;
  cursor: pointer;
  text-decoration: none;
}
.pcg-btn button:hover, .pcg-btn a:hover { background: #1d4ed8; color: #fff; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run ProductCardGrid`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/ProductCardGrid.jsx demo_api_ui/src/components/ProductCardGrid.css demo_api_ui/src/components/__tests__/ProductCardGrid.test.jsx
git commit -m "feat(ui): add ProductCardGrid for product and location card-grid replies"
```

---

### Task 2: `SeatMapPanel` component

**Files:**
- Create: `demo_api_ui/src/components/SeatMapPanel.jsx`
- Create: `demo_api_ui/src/components/SeatMapPanel.css`
- Test: `demo_api_ui/src/components/__tests__/SeatMapPanel.test.jsx`

**Interfaces:**
- Produces: `export default function SeatMapPanel({ flightNumber, seats })` where `seats` is an array of `{ seat: string, cabin: string, available: boolean }` — the exact shape `listSeats()` returns from `demo_mcp_resource_server/src/db/airlinesDb.ts:47-48,312-316` (fields: `seat`, `cabin`, `available`). `seat` values look like `"14A"`; row number and column letter are derived by parsing that string (`/^(\d+)([A-Z])$/`), not stored separately.
- Consumes: nothing external — pure presentational, selection is local `useState`.

- [ ] **Step 1: Write the failing test**

```jsx
// demo_api_ui/src/components/__tests__/SeatMapPanel.test.jsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import SeatMapPanel from "../SeatMapPanel";

const SEATS = [
  { seat: "1A", cabin: "business", available: true },
  { seat: "1B", cabin: "business", available: false },
  { seat: "6A", cabin: "economy", available: true },
  { seat: "6B", cabin: "economy", available: true },
];

describe("SeatMapPanel", () => {
  it("renders one seat cell per row entry, grouped by cabin", () => {
    render(<SeatMapPanel flightNumber="UA328" seats={SEATS} />);
    expect(screen.getByText("business")).toBeInTheDocument();
    expect(screen.getByText("economy")).toBeInTheDocument();
    expect(screen.getAllByTestId("seat-cell")).toHaveLength(4);
  });

  it("clicking an available seat updates the summary bar; occupied seats are not clickable", () => {
    render(<SeatMapPanel flightNumber="UA328" seats={SEATS} />);
    expect(screen.getByText(/Pick a seat/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("seat-cell-6A"));
    expect(screen.getByText(/6A/)).toBeInTheDocument();
    const occupied = screen.getByTestId("seat-cell-1B");
    expect(occupied).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run SeatMapPanel`
Expected: FAIL — `Failed to resolve import "../SeatMapPanel"`

- [ ] **Step 3: Write the component**

```jsx
// demo_api_ui/src/components/SeatMapPanel.jsx
import React, { useMemo, useState } from "react";
import "./SeatMapPanel.css";

function parseSeat(seat) {
  const m = /^(\d+)([A-Z])$/.exec(seat);
  return m ? { row: Number(m[1]), col: m[2] } : { row: 0, col: seat };
}

export default function SeatMapPanel({ flightNumber, seats }) {
  const [selected, setSelected] = useState(null);

  const byCabin = useMemo(() => {
    const groups = new Map();
    for (const s of seats) {
      const cabin = s.cabin || "economy";
      if (!groups.has(cabin)) groups.set(cabin, []);
      groups.get(cabin).push(s);
    }
    for (const list of groups.values()) {
      list.sort((a, b) => {
        const pa = parseSeat(a.seat);
        const pb = parseSeat(b.seat);
        return pa.row - pb.row || String(pa.col).localeCompare(String(pb.col));
      });
    }
    return groups;
  }, [seats]);

  const selectedSeat = selected ? seats.find((s) => s.seat === selected) : null;

  return (
    <div className="smp-card">
      <div className="smp-nose" />
      {[...byCabin.entries()].map(([cabin, list]) => (
        <div className="smp-band" key={cabin}>
          <div className="smp-cabin-label">{cabin}</div>
          <div className="smp-row">
            {list.map((s) => {
              const isSelected = s.seat === selected;
              return (
                <button
                  key={s.seat}
                  type="button"
                  data-testid={`seat-cell${s.seat ? `-${s.seat}` : ""}`}
                  className={`smp-seat smp-seat--${cabin}${isSelected ? " smp-seat--selected" : ""}`}
                  disabled={!s.available}
                  title={s.seat}
                  onClick={() => setSelected(s.seat)}
                />
              );
            })}
          </div>
        </div>
      ))}
      <div className="smp-legend">
        <span><span className="smp-sw" style={{ background: "#1d4ed8" }} />Selected</span>
        <span><span className="smp-sw" style={{ background: "#e0e3ee", opacity: 0.6 }} />Occupied</span>
      </div>
      <div className="smp-summary">
        {selectedSeat
          ? <div className="smp-summary-info">Seat <strong>{selectedSeat.seat}</strong> — {selectedSeat.cabin}, flight {flightNumber}</div>
          : <div className="smp-summary-info">Pick a seat above to see the details here.</div>}
      </div>
    </div>
  );
}
```

```css
/* demo_api_ui/src/components/SeatMapPanel.css */
.smp-card {
  background: var(--th-bg-card, #fff);
  border: 1px solid var(--th-border, #e0e3ee);
  border-radius: 10px;
  box-shadow: 0 1px 2px rgba(23,27,46,0.04), 0 6px 16px rgba(23,27,46,0.05);
  padding: 18px 16px 16px;
  max-width: 300px;
  margin: 0 auto;
}
.smp-nose {
  width: 64px;
  height: 20px;
  margin: 0 auto 10px;
  background: var(--th-bg-inset, #eef0f8);
  border: 1px solid var(--th-border, #e0e3ee);
  border-bottom: none;
  border-radius: 40px 40px 0 0;
}
.smp-band { margin-bottom: 10px; }
.smp-band:last-of-type { margin-bottom: 0; }
.smp-cabin-label {
  font-family: var(--v2-font-mono, "IBM Plex Mono", ui-monospace, monospace);
  font-size: 9px;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--th-text-muted, #5b6178);
  text-align: center;
  margin-bottom: 5px;
}
.smp-row { display: flex; flex-wrap: wrap; gap: 3px; justify-content: center; margin-bottom: 3px; }
.smp-seat {
  width: 17px;
  height: 17px;
  border-radius: 4px 4px 2px 2px;
  padding: 0;
  cursor: pointer;
}
.smp-seat--business { background: #fde68a; border: 1px solid #7c4a03; }
.smp-seat--premium { background: #e0f2fe; border: 1px solid #0284c7; }
.smp-seat--economy { background: var(--th-bg-inset, #eef0f8); border: 1px solid var(--th-border, #e0e3ee); }
.smp-seat--selected { background: #1d4ed8 !important; border-color: #1d4ed8 !important; box-shadow: 0 0 0 2px #e8edfd; }
.smp-seat:disabled { background: var(--th-border, #e0e3ee) !important; border-color: var(--th-border, #e0e3ee) !important; opacity: 0.5; cursor: default; }
.smp-legend {
  display: flex; flex-wrap: wrap; gap: 6px 12px; justify-content: center;
  margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--th-border, #e0e3ee);
  font-size: 10px; color: var(--th-text-muted, #5b6178);
}
.smp-sw { display: inline-block; width: 9px; height: 9px; border-radius: 3px; margin-right: 4px; vertical-align: -1px; }
.smp-summary { margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--th-border, #e0e3ee); font-size: 12.5px; }
.smp-summary-info strong { font-family: var(--v2-font-mono, "IBM Plex Mono", ui-monospace, monospace); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run SeatMapPanel`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add demo_api_ui/src/components/SeatMapPanel.jsx demo_api_ui/src/components/SeatMapPanel.css demo_api_ui/src/components/__tests__/SeatMapPanel.test.jsx
git commit -m "feat(ui): add SeatMapPanel for the real airlines seat chart"
```

---

### Task 3: Sporting-goods backend — `products` + `cart` store, `browse_gear`/`add_to_cart` tools

**Files:**
- Modify: `demo_api_server/config/verticals/sporting-goods/seed.json`
- Modify: `demo_api_server/config/verticals/sporting-goods/data.js`
- Modify: `demo_api_server/config/verticals/sporting-goods/tools.js`
- Modify: `demo_api_server/config/verticals/sporting-goods/manifest.json`
- Test: `demo_api_server/tests` — follow the existing test file naming for this vertical (run `ls demo_api_server/tests/**/*sporting-goods*` first to match the convention exactly; create `browseGearAddToCart.sporting-goods.test.js` alongside whatever's found if no better match exists)

**Interfaces:**
- Produces: `store.get(userId).products` (array, seeded, same for every user), `store.get(userId).cart` (array, starts empty, per-user); `createSportingGoodsStore()`'s returned object gains `addToCart(userId, { productId })` alongside its existing `extendRental`/`cancelOrder`/etc.
- Consumes: `structuredClone(SEED)` pattern already in `data.js:12-17` (`get(userId)`).

- [ ] **Step 1: Add `products` and `cart` to the seed**

Add to `demo_api_server/config/verticals/sporting-goods/seed.json`, as new top-level keys alongside the existing `orders`/`rentals`/etc. (open the file, find the closing structure of the last existing top-level array, add these two keys before the final `}`):

```json
  "products": [
    { "id": "prod-boots", "name": "Trail Runner Hiking Boots", "icon": "boots", "price": 129.99, "priceWas": 149.99, "rating": 4.6, "reviewCount": 312, "stock": "In stock" },
    { "id": "prod-backpack", "name": "65L Trekking Backpack", "icon": "backpack", "price": 189.00, "rating": 4.8, "reviewCount": 94, "stock": "In stock" },
    { "id": "prod-poles", "name": "Carbon Trekking Poles", "icon": "poles", "price": 54.00, "rating": 4.5, "reviewCount": 208, "stock": "In stock" },
    { "id": "prod-bottle", "name": "Insulated Water Bottle, 1L", "icon": "bottle", "price": 28.00, "rating": 4.7, "reviewCount": 611, "stock": "In stock" },
    { "id": "prod-tent", "name": "3-Season Tent, 2-Person", "icon": "tent", "price": 249.00, "rating": 4.4, "reviewCount": 77, "stock": "2 left" },
    { "id": "prod-baselayer", "name": "Merino Wool Base Layer", "icon": "shirt", "price": 58.00, "rating": 4.6, "reviewCount": 145, "stock": "In stock" }
  ],
  "cart": []
```

- [ ] **Step 2: Add `addToCart` to the store**

In `demo_api_server/config/verticals/sporting-goods/data.js`, add a function inside `createSportingGoodsStore()` (near the other mutators, after `extendRental`) and export it from the returned object:

```js
  function addToCart(userId, { productId }) {
    const data = get(userId);
    const product = (data.products || []).find((p) => p.id === productId);
    if (!product) return null;
    const entry = { id: `cart-${Date.now()}-${data.cart.length}`, productId, name: product.name, price: product.price, addedAt: new Date().toISOString() };
    data.cart.push(entry);
    return entry;
  }
```

Update the final `return { get, extendRental, cancelOrder, returnRental, resolveTicket, cancelCoaching };` to also include `addToCart`.

- [ ] **Step 3: Add the tool definitions**

In `demo_api_server/config/verticals/sporting-goods/tools.js`, add to the `tools` array (after the `dual_token_demo` entry, before the closing `];`):

```js
    {
      name: 'browse_gear',
      description: 'Browse gear products available to buy.',
      inputSchema: { type: 'object', properties: {} },
      scopes: ['read'],
      authz: {},
    },
    {
      name: 'add_to_cart',
      description: 'Add a product to the shopping cart by product id.',
      inputSchema: { type: 'object', properties: { productId: { type: 'string' } }, required: ['productId'] },
      scopes: ['write'],
      authz: {},
    },
```

- [ ] **Step 4: Add the execute() cases**

In the same file's `execute(name, params, ctx)` switch, add (near `case 'list_gear':` or similar read cases):

```js
      case 'browse_gear':
        return { result: { products: store.get(userId).products }, render: 'browse_gear' };
      case 'add_to_cart': {
        const entry = store.addToCart(userId, { productId: params && params.productId });
        if (!entry) return { result: { error: 'product not found' }, render: 'text' };
        return { result: entry, render: 'add_to_cart' };
      }
```

- [ ] **Step 5: Add manifest render descriptors and a chip**

In `demo_api_server/config/verticals/sporting-goods/manifest.json`'s `"render"` block (after the `"list_rentals"` entry, line 320), add:

```json
    "browse_gear": { "type": "productGrid", "title": "Gear for Your Next Hike" },
    "add_to_cart": { "type": "card", "title": "Added to Cart", "fields": [ { "label": "Item", "path": "name" }, { "label": "Price", "path": "price", "format": "money" } ] }
```

In the same file's `"chips10"` array (after the `"sg2"` entry, line ~124), add:

```json
      { "id": "sg-gear", "label": "Shop hiking gear", "message": "I need gear for a hiking trip", "mode": "both", "tool": "browse_gear", "useCaseId": "delegated-access-with-proof" },
```

- [ ] **Step 6: Write the jest tests**

First run `ls demo_api_server/tests | grep -i sporting` and open one existing sporting-goods test file to copy its describe/setup boilerplate (store construction, ctx shape) exactly — do not invent a different setup pattern. Then add a new test file alongside it:

```js
// demo_api_server/tests/browseGearAddToCart.sporting-goods.test.js
// (adjust the require paths below to match whatever the sibling test file you copied uses)
const { createSportingGoodsStore } = require('../config/verticals/sporting-goods/data');

describe('sporting-goods browse_gear / add_to_cart', () => {
  it('browse_gear returns the seeded product list', () => {
    const store = createSportingGoodsStore();
    const data = store.get('user-1');
    expect(data.products.length).toBe(6);
    expect(data.products[0]).toHaveProperty('price');
  });

  it('add_to_cart pushes an entry into the per-user cart', () => {
    const store = createSportingGoodsStore();
    const entry = store.addToCart('user-1', { productId: 'prod-boots' });
    expect(entry).not.toBeNull();
    expect(entry.productId).toBe('prod-boots');
    expect(store.get('user-1').cart).toHaveLength(1);
  });

  it('add_to_cart returns null for an unknown productId', () => {
    const store = createSportingGoodsStore();
    const entry = store.addToCart('user-1', { productId: 'does-not-exist' });
    expect(entry).toBeNull();
  });
});
```

- [ ] **Step 7: Run the jest tests**

Run: `cd demo_api_server && CI=true npx jest browseGearAddToCart --forceExit`
Expected: PASS (3 tests)

- [ ] **Step 8: Commit**

```bash
git add demo_api_server/config/verticals/sporting-goods/seed.json demo_api_server/config/verticals/sporting-goods/data.js demo_api_server/config/verticals/sporting-goods/tools.js demo_api_server/config/verticals/sporting-goods/manifest.json demo_api_server/tests/browseGearAddToCart.sporting-goods.test.js
git commit -m "feat(sporting-goods): add browse_gear/add_to_cart tools with a real per-user cart write"
```

---

### Task 4: Wire `ProductCardGrid` into the sporting-goods render path

**Files:**
- Modify: `demo_api_ui/src/components/VerticalResult.jsx`
- Modify: `demo_api_ui/src/components/AIAgent.js` (one new prop on the existing `<VerticalResult>` render, ~line 10832)
- Test: `demo_api_ui/src/components/__tests__/VerticalResult.productGrid.test.jsx`

**Interfaces:**
- Consumes: `ProductCardGrid` from Task 1 (`onAction` prop).
- Produces: `VerticalResult` gains a new prop `onAction` (optional — only used by the `productGrid` branch), threaded through from `AIAgent.js`.

- [ ] **Step 1: Write the failing test**

```jsx
// demo_api_ui/src/components/__tests__/VerticalResult.productGrid.test.jsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import VerticalResult from "../VerticalResult";

describe("VerticalResult productGrid branch", () => {
  it("renders a ProductCardGrid and forwards the click to onAction", () => {
    const onAction = vi.fn();
    const descriptor = { type: "productGrid", title: "Gear for Your Next Hike" };
    const data = { products: [{ id: "prod-boots", name: "Trail Runner Hiking Boots", icon: "boots", price: 129.99, rating: 4.6, reviewCount: 312, stock: "In stock" }] };
    render(<VerticalResult descriptor={descriptor} data={data} onAction={onAction} />);
    expect(screen.getByText("Trail Runner Hiking Boots")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));
    expect(onAction).toHaveBeenCalledWith("add_to_cart", { productId: "prod-boots" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_ui && npx vitest run VerticalResult.productGrid`
Expected: FAIL — no `productGrid` branch, falls through to the JSON-fallback text render, `getByText("Trail Runner Hiking Boots")` not found.

- [ ] **Step 3: Add the `productGrid` branch**

In `demo_api_ui/src/components/VerticalResult.jsx`, add the `productGrid` import at the top:

```js
import ProductCardGrid from './ProductCardGrid';
```

Change the function signature to accept `onAction`:

```js
function VerticalResult({ descriptor, data, onAction }) {
```

Add a new branch before the `card`/`fieldList` check (right after the `token-pair` block, before the "Text fallback" comment):

```js
  if (descriptor && descriptor.type === 'productGrid') {
    const items = Array.isArray(data) ? data : (data && Array.isArray(data.products) ? data.products : []);
    return (
      <div className="vertical-result vertical-result-product-grid">
        <ProductCardGrid kind="products" title={descriptor.title} items={items} onAction={onAction} />
      </div>
    );
  }
```

Also update the "Text fallback" guard's type list to include `'productGrid'` so it doesn't get swallowed there:

```js
  if (!descriptor || !descriptor.type || !['card', 'fieldList', 'table', 'productGrid'].includes(descriptor.type)) {
```

- [ ] **Step 4: Thread `onAction` from `AIAgent.js`**

In `demo_api_ui/src/components/AIAgent.js`, at the existing render site (~line 10832):

```jsx
                            {msg.verticalResult && (
                              <VerticalResult
                                descriptor={msg.verticalResult.descriptor}
                                data={msg.verticalResult.data}
                                onAction={(tool, params) => runAction(tool, params, { skipUserLabel: true, vertical: effectiveVerticalId })}
                              />
                            )}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd demo_api_ui && npx vitest run VerticalResult.productGrid`
Expected: PASS (1 test)

- [ ] **Step 6: Run the full UI unit suite + build gate**

Run: `cd demo_api_ui && npm run test:unit && npm run build`
Expected: all green (this touches a shared, widely-used component — confirm nothing else broke)

- [ ] **Step 7: Commit**

```bash
git add demo_api_ui/src/components/VerticalResult.jsx demo_api_ui/src/components/AIAgent.js demo_api_ui/src/components/__tests__/VerticalResult.productGrid.test.jsx
git commit -m "feat(ui): render productGrid descriptors with ProductCardGrid, wire Add to Cart to runAction"
```

---

### Task 5: Airlines — render the real seat map

**Files:**
- Investigate first (see Step 1), then likely modify: `demo_api_server/config/verticals/airlines/manifest.json`, `demo_api_ui/src/components/VerticalResult.jsx`
- Test: `demo_api_ui/src/components/__tests__/VerticalResult.seatMap.test.jsx`

**Interfaces:**
- Consumes: `SeatMapPanel` from Task 2.
- Produces: `VerticalResult` gains a `seatMap` descriptor branch.

- [ ] **Step 1: Confirm how `check_seat_availability`'s result reaches the client today**

Run:
```bash
grep -n "function legacy\|legacy(" demo_api_server/services/verticalDispatch.js
grep -rn "check_seat_availability" demo_api_server/services demo_api_server/routes
```
Read the `legacy` implementation that gets passed into `executeToolFor` (`verticalDispatch.js:177,200`) — it's the function that actually calls the MCP tool executor for airlines' `NOT_MY_TOOL` fallthrough. Confirm what `render` key (if any) it attaches to the returned envelope for an MCP-executed tool. Two possible outcomes:
- (a) It already sets some `render` key (e.g. `'text'` or the raw MCP tool name) that flows into `pageManifest?.render?.[vr.render]` (`AIAgent.js:2903`) — in which case Step 2 just needs to add a `check_seat_availability` entry to `airlines/manifest.json`'s `render` block (which doesn't exist yet — add the whole block, following the exact syntax at `sporting-goods/manifest.json:301-324`).
- (b) It sets no usable render key / the airlines path doesn't go through `verticalResultExtra` at all (e.g. surfaces as `msg.rawMcpResult` instead, per `AIAgent.js:10837-10838` seen during planning) — in which case the fix is in `AIAgent.js` at whatever site builds `rawMcpResult`, not in `VerticalResult.jsx`'s descriptor switch. If this is the case, STOP and write down the exact file:line where that decision is made before continuing — do not guess.

Confirm which by manually running the app (`./run.sh` or reuse whatever dev stack is already running) and clicking the airlines "Available seats" chip (`ua3`, `airlines/manifest.json:117-124`) while signed in as an airlines demo user, then inspecting the network response body for `/api/agent/invoke` and the rendered DOM/React DevTools for which `msg.*` key is populated on that message.

- [ ] **Step 2a (if outcome (a)): add the manifest render entry**

Add to `demo_api_server/config/verticals/airlines/manifest.json` (new top-level `"render"` key, sibling to `"dashboard"`):

```json
  "render": {
    "check_seat_availability": { "type": "seatMap" }
  },
```

- [ ] **Step 2b (if outcome (b)): wire from the `rawMcpResult` site instead**

Locate the exact `AIAgent.js` code that sets `rawMcpResult` (or whatever key actually carries the airlines seat response) and add a parallel check there that builds `{ seatMapData: { flightNumber, seats: <parsed seat array> } }` as a new message extra, following the same `{msg.someKey && <Widget/>}` convention documented at `AIAgent.js:10831-10836`. Do not proceed with Step 3 below until this shape is pinned down concretely (exact field path the seat array lives at in the real response body).

- [ ] **Step 3: Add the `seatMap` branch to `VerticalResult.jsx`**

```js
import SeatMapPanel from './SeatMapPanel';
```

```js
  if (descriptor && descriptor.type === 'seatMap') {
    const flightNumber = (data && data.flightNumber) || '';
    const rawSeats = (data && (data.seats || data)) || [];
    const seats = Array.isArray(rawSeats) ? rawSeats : [];
    return (
      <div className="vertical-result vertical-result-seat-map">
        <SeatMapPanel flightNumber={flightNumber} seats={seats} />
      </div>
    );
  }
```

Update the fallback type-list guard to include `'seatMap'` too:

```js
  if (!descriptor || !descriptor.type || !['card', 'fieldList', 'table', 'productGrid', 'seatMap'].includes(descriptor.type)) {
```

(If Step 2b applied instead of 2a, this branch's props come from the new `msg.seatMapData` extra rendered directly in `AIAgent.js`, not through `VerticalResult` — adjust accordingly and skip re-adding it here.)

- [ ] **Step 4: Write the test** (adjust the descriptor/data shape to match whichever outcome Step 1 found)

```jsx
// demo_api_ui/src/components/__tests__/VerticalResult.seatMap.test.jsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import VerticalResult from "../VerticalResult";

describe("VerticalResult seatMap branch", () => {
  it("renders a SeatMapPanel from real seat data", () => {
    const descriptor = { type: "seatMap" };
    const data = { flightNumber: "UA328", seats: [{ seat: "1A", cabin: "business", available: true }] };
    render(<VerticalResult descriptor={descriptor} data={data} />);
    expect(screen.getByText("business")).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Run the test**

Run: `cd demo_api_ui && npx vitest run VerticalResult.seatMap`
Expected: PASS

- [ ] **Step 6: Manual verification against the real stack**

Click the airlines "Available seats" chip in the running demo. Confirm the seat chart renders with real seat data (not the mockup's invented business/premium/economy split — whatever `cabin` values the real data actually has), clicking an available seat updates the summary bar, and an occupied seat is not clickable.

- [ ] **Step 7: Commit**

```bash
git add demo_api_ui/src/components/VerticalResult.jsx demo_api_server/config/verticals/airlines/manifest.json demo_api_ui/src/components/__tests__/VerticalResult.seatMap.test.jsx
git commit -m "feat(airlines): render check_seat_availability as a real seat chart"
```

(If Step 2b applied, adjust the `git add` list to the actual files touched in `AIAgent.js` instead of `airlines/manifest.json`.)

---

### Task 6: Fix the broken `branch_hours` action and render locations as cards

**Files:**
- Modify: `demo_api_ui/src/components/AIAgent.js`
- Test: `demo_api_ui/src/components/__tests__/AIAgent.branchHours.test.jsx` (check first whether an existing `AIAgent.*.test.js` file already covers `runAction`'s `weather` case — if so, add this test to that same file instead of creating a new one, to match existing suite organization)

**Interfaces:**
- Consumes: `ProductCardGrid` from Task 1 (`kind="locations"`).
- Produces: `runAction` gains a `branch_hours` case; `addReplyRespectingGrounding` merges a new `locationCardsExtra(response)`; the message renderer gains a `{msg.locationCards && <ProductCardGrid kind="locations" .../>}` branch.

- [ ] **Step 1: Add the `branch_hours` case to `runAction`**

In `demo_api_ui/src/components/AIAgent.js`, add a new `if (action === "branch_hours") { ... }` block immediately before the existing `if (action === "weather") { ... }` block (~line 6395), mirroring it exactly:

```js
      if (action === "branch_hours") {
        // Heuristic parses "branches near me" / "clinics near me" / etc. to
        // action branch_hours (cross-vertical UC24 public catalog — see
        // nlIntentParser.js), but runAction had no case for it, so every
        // version of this prompt threw "Unknown action: branch_hours" in
        // every vertical. Same fix shape as the weather action above.
        const cityQuery = p.city || "";
        const branchPrompt = nlUserText || (cityQuery ? `branches near ${cityQuery}` : "branches near me");
        try {
          const response = await sendAgentMessage(branchPrompt, null, {
            forceHeuristic: true,
            vertical: effectiveVerticalId || "banking",
            ...(useCaseId ? { useCaseId } : {}),
          });
          if (maybeHandleCustomerLogin(response, _source)) return;
          await handleNlResumeResponse(response, branchPrompt, useCaseId);
        } catch (e) {
          addMessage(
            "assistant",
            e?.message || "Could not look up locations.",
            null,
            { source: _source },
          );
        }
        return;
      }
```

- [ ] **Step 2: Add `locationCardsExtra` and merge it in**

Add a new helper right after `verticalResultExtra` (~line 2915):

```js
  // branch_hours (UC24 public catalog, cross-vertical) rides `.branches` +
  // `.publicCatalog` on the raw response (demoAgentLangGraphService.js:298-311),
  // outside the normal verticalResult/manifest-render pipeline — this is the
  // parallel path for that one shape.
  function locationCardsExtra(response) {
    if (!response?.publicCatalog || !Array.isArray(response.branches)) return {};
    return { locationCards: response.branches };
  }
```

Change the call site at `AIAgent.js:6894` from:

```js
      addMessage("assistant", replyWithAgentBadge, null, verticalResultExtra(response));
```

to:

```js
      addMessage("assistant", replyWithAgentBadge, null, { ...verticalResultExtra(response), ...locationCardsExtra(response) });
```

- [ ] **Step 3: Render the cards**

Near the existing `{msg.verticalResult && (...)}` block (~line 10831), add a sibling block:

```jsx
                            {msg.locationCards && (
                              <ProductCardGrid kind="locations" items={msg.locationCards} />
                            )}
```

Add the import at the top of the file if `ProductCardGrid` isn't already imported by Task 4: `import ProductCardGrid from "./ProductCardGrid";`

- [ ] **Step 4: Write the test**

```jsx
// demo_api_ui/src/components/__tests__/AIAgent.branchHours.test.jsx
// Follow the mocking setup of an existing AIAgent test that exercises
// runAction/sendAgentMessage (check AIAgent.chips.test.js or similar for the
// exact render/mock boilerplate — copy it, don't reinvent it) so this test's
// harness matches the suite's conventions.
```
(Write the actual test body once the boilerplate is copied from a sibling file — it must render `AIAgent`, trigger the NL path with text like `"branches near me"`, mock `sendAgentMessage` to resolve `{ reply: "...", success: true, branches: [{ id: "b1", name: "Test Branch", city: "Austin", state: "TX", address: "1 Main St", hours: "9-5", atm: true }], publicCatalog: true }`, and assert `screen.getByText("Test Branch")` renders — mirroring whatever the sibling weather test asserts for its own action, so this doesn't diverge from established test style in the same file.)

- [ ] **Step 5: Run the test**

Run: `cd demo_api_ui && npx vitest run AIAgent.branchHours` (or the merged file name if added into an existing suite)
Expected: PASS

- [ ] **Step 6: Manual verification across verticals**

In the running demo, type "branches near me" while on banking, then switch to healthcare and type "clinics near me", then sporting-goods and type "stores near me". Confirm all three now render location cards (none throws "Unknown action: branch_hours" — the bug this task fixes).

- [ ] **Step 7: Run the full UI unit suite + build gate**

Run: `cd demo_api_ui && npm run test:unit && npm run build`
Expected: all green

- [ ] **Step 8: Commit**

```bash
git add demo_api_ui/src/components/AIAgent.js demo_api_ui/src/components/__tests__/AIAgent.branchHours.test.jsx
git commit -m "fix(ui): wire branch_hours to runAction and render locations as cards (was Unknown action in every vertical)"
```

---

### Task 7: Cross-service check + close out

**Files:** none (verification only)

- [ ] **Step 1: Run `demo_api_server`'s full suite**

Run: `cd demo_api_server && CI=true npm test -- --forceExit --maxWorkers=4`
Expected: green (per `verify-ai-demo2` skill guidance on worktree jest quirks — if `node_modules` is missing in this worktree, `npm install` in `demo_api_server` first, or symlink from the main checkout)

- [ ] **Step 2: Run `demo_api_ui`'s full suite + build**

Run: `cd demo_api_ui && npm run test:unit && npm run build`
Expected: green

- [ ] **Step 3: `npm run topology:verify` from repo root**

Expected: no drift (this plan adds tool names/scopes to sporting-goods only — confirm scope-topology's no-drift gate is satisfied)

- [ ] **Step 4: Manual pass through all three features live**

Sporting-goods: click "Shop hiking gear" chip → cards render → click "Add to Cart" on one → confirm a new assistant reply confirms the add (via `add_to_cart`'s card descriptor) and, if inspectable, the cart entry persisted.
Airlines: click "Available seats" chip → seat chart renders with real data → click a seat → summary bar updates.
Locations: type "branches near me" (banking), "clinics near me" (healthcare), "stores near me" (sporting-goods) → cards render for all three, each with a working "Get Directions" link that opens a Google Maps search in a new tab.

- [ ] **Step 5: Update the design doc's status line**

In `docs/superpowers/specs/2026-08-11-vertical-catalog-cards-design.md`, change the `Status:` line at the top to note this pass shipped and what's deferred (airlines write path, the other 14 verticals' product catalogs).

- [ ] **Step 6: Final commit**

```bash
git add docs/superpowers/specs/2026-08-11-vertical-catalog-cards-design.md
git commit -m "docs(spec): mark vertical catalog cards pass 1 shipped"
```
