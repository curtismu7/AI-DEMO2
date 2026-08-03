# Airlines Use-Case Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The United Airlines vertical serves the full 20-step presenter ladder in the Demo Steps dropdown, every per-vertical step live-verified against a running stack.

**Architecture:** The airlines vertical already exists as a plugin with five SQLite-backed tools; it is simply absent from the use-case catalog's `VERTICALS` list, so `/api/use-cases?vertical=airlines` 400s and the dropdown renders its empty state. This plan adds one new write tool (`pay_airline_fee`) to give the amount-gated steps something to bind to, registers `airlines` in the five per-vertical maps in `useCases.js`, and provisions an A2A specialist app so UC2 works.

**Tech Stack:** Node >= 22 · CommonJS in `demo_api_server` · TypeScript in `demo_mcp_resource_server` and `demo_mcp_gateway` · Jest everywhere · SQLite via `node:sqlite` (`DatabaseSync`)

**Spec:** `docs/superpowers/specs/2026-08-03-airlines-usecase-catalog-design.md`

## Global Constraints

- Work happens in worktree `airlines-usecase-catalog`, branch `worktree-airlines-usecase-catalog`. Every commit is staged explicitly by path. Never `git add -A` — a BFF jest run regenerates roughly 443 data files.
- A fresh worktree has no `node_modules` (every `package-lock.json` is gitignored). Run `npm install` in each service directory you touch, or symlink from the main checkout.
- BFF tests: `cd demo_api_server && CI=true npm test -- --forceExit --maxWorkers=4`. **Never pass `--testPathIgnorePatterns`** — since PR #950 `jest.config.js` self-detects worktrees, and the flag *replaces* the list, dragging `/tests/real/` live-stack suites into the run.
- `--maxWorkers=4` is required. Without it a *different disjoint set* of suites fails each run. Re-run any failure in isolation before calling it a regression.
- `pay_airline_fee` carries `requiredScopes: ['airlines:read', 'airlines:write']` — identical in the plugin, `airlinesTools.ts`, and `scope-topology.json`. Not `write`.
- Emoji allowlist: `⚠️` `✅` `❌` `🔐` `✕` `✓` `👤` `🔑` `🪟` `📚`. Nothing else, anywhere.
- Generated files are never hand-edited: `demo_mcp_server/src/tools/handlers/verticalTools.generated.ts`, `docs/scope-topology.md`, the `use-cases:gen` outputs. Regenerate them.
- Money is stored as integer cents. No floats in the database.
- Never rotate or invent a secret. Task 8 hands the user two values to paste.

---

### Task 1: `fee_payments` table and accessors

**Files:**
- Modify: `demo_mcp_resource_server/src/db/airlinesDb.ts`
- Test: `demo_mcp_resource_server/tests/airlinesDb.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks — this is the first.
- Produces: `recordFeePayment(input: FeePaymentInput): FeePayment` and `listFeePayments(confirmationNumber?: string): FeePayment[]`, both exported from `src/db/airlinesDb.ts`. Task 2 calls both.

- [ ] **Step 1: Write the failing test**

Append to `demo_mcp_resource_server/tests/airlinesDb.test.ts`:

```ts
describe('fee_payments', () => {
  it('records a payment and reads it back', () => {
    const saved = recordFeePayment({
      confirmationNumber: 'K7XR2M',
      feeType: 'change',
      amountCents: 30000,
    });
    expect(saved.id).toBeGreaterThan(0);
    expect(saved.amountCents).toBe(30000);
    expect(saved.confirmationNumber).toBe('K7XR2M');
    expect(saved.paidAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const rows = listFeePayments('K7XR2M');
    expect(rows).toHaveLength(1);
    expect(rows[0].feeType).toBe('change');
  });

  it('is append-only across calls, newest first', () => {
    recordFeePayment({ confirmationNumber: 'L9QP4T', feeType: 'bag', amountCents: 6000 });
    recordFeePayment({ confirmationNumber: 'L9QP4T', feeType: 'upgrade', amountCents: 15000 });
    const rows = listFeePayments('L9QP4T');
    expect(rows).toHaveLength(2);
    expect(rows[0].feeType).toBe('upgrade');
  });

  it('lists across all confirmations when none is named', () => {
    expect(listFeePayments().length).toBeGreaterThanOrEqual(3);
  });
});
```

Add `recordFeePayment, listFeePayments` to the existing import from `../src/db/airlinesDb` at the top of that file.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_mcp_resource_server && npx jest tests/airlinesDb.test.ts -t fee_payments`
Expected: FAIL — `recordFeePayment is not a function`.

- [ ] **Step 3: Add the table to `SCHEMA`**

In `src/db/airlinesDb.ts`, append to the `SCHEMA` template literal, after the `seats` table:

```sql
CREATE TABLE IF NOT EXISTS fee_payments (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  confirmation_number TEXT,
  fee_type            TEXT NOT NULL,
  amount_cents        INTEGER NOT NULL,
  paid_at             TEXT NOT NULL
);
```

`confirmation_number` is deliberately nullable and carries no foreign key: the amount-gated chips state a figure without naming a trip, and a `REFERENCES bookings` constraint would reject those rows. `withDb` runs `PRAGMA foreign_keys = ON`, so a constraint here would be enforced.

- [ ] **Step 4: Add the types and accessors**

Add the interfaces alongside the existing `Booking` / `Flight` / `Seat` exports:

```ts
export interface FeePaymentInput {
  confirmationNumber: string | null;
  feeType: string;
  amountCents: number;
}

export interface FeePayment extends FeePaymentInput {
  id: number;
  paidAt: string;
}
```

Add the accessors at the end of the file, following the existing `withDb` style:

```ts
/**
 * Append a fee payment. The ledger is append-only and never seeded — unlike the
 * reference tables, an empty fee_payments is the correct initial state, and
 * seedIfEmpty would otherwise refill it on every restart.
 */
export function recordFeePayment(input: FeePaymentInput): FeePayment {
  const paidAt = new Date().toISOString();
  return withDb((conn) => {
    conn.prepare(
      'INSERT INTO fee_payments (confirmation_number, fee_type, amount_cents, paid_at) VALUES (?, ?, ?, ?)',
    ).run(input.confirmationNumber, input.feeType, input.amountCents, paidAt);
    const row = conn
      .prepare('SELECT id FROM fee_payments ORDER BY id DESC LIMIT 1')
      .get() as { id: number };
    return { ...input, id: row.id, paidAt };
  });
}

export function listFeePayments(confirmationNumber?: string): FeePayment[] {
  const sql = confirmationNumber
    ? 'SELECT * FROM fee_payments WHERE confirmation_number = ? ORDER BY id DESC'
    : 'SELECT * FROM fee_payments ORDER BY id DESC';
  const rows = withDb((conn) =>
    (confirmationNumber
      ? conn.prepare(sql).all(confirmationNumber)
      : conn.prepare(sql).all()) as unknown as Array<{
      id: number;
      confirmation_number: string | null;
      fee_type: string;
      amount_cents: number;
      paid_at: string;
    }>,
  );
  return rows.map((r) => ({
    id: r.id,
    confirmationNumber: r.confirmation_number,
    feeType: r.fee_type,
    amountCents: r.amount_cents,
    paidAt: r.paid_at,
  }));
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd demo_mcp_resource_server && npx jest tests/airlinesDb.test.ts`
Expected: PASS, including the pre-existing cases.

- [ ] **Step 6: Typecheck**

Run: `cd demo_mcp_resource_server && npm run typecheck`
Expected: no output, exit 0.

- [ ] **Step 7: Commit**

```bash
git add demo_mcp_resource_server/src/db/airlinesDb.ts demo_mcp_resource_server/tests/airlinesDb.test.ts
git commit -m "feat(airlines): append-only fee_payments ledger in the airlines database"
```

---

### Task 2: `pay_airline_fee` tool, handler, and routing

**Files:**
- Modify: `demo_mcp_resource_server/src/tools/airlinesTools.ts`
- Modify: `demo_mcp_resource_server/src/tools/airlinesToolHandler.ts`
- Modify: `demo_mcp_gateway/src/router.ts:51-59`
- Test: `demo_mcp_resource_server/tests/airlinesTools.test.ts`

**Interfaces:**
- Consumes: `recordFeePayment` and `listFeePayments` from Task 1.
- Produces: an MCP tool named `pay_airline_fee` requiring `['airlines:read', 'airlines:write']`, reachable through `dispatch()`. Tasks 3, 4, and 5 all reference that exact name.

- [ ] **Step 1: Write the failing test**

Append to `demo_mcp_resource_server/tests/airlinesTools.test.ts`:

```ts
describe('pay_airline_fee', () => {
  it('is invisible to a read-only airlines token', () => {
    const readOnly = filterByScopes(ALL_TOOLS, ['airlines:read']).map((t) => t.name);
    expect(readOnly).not.toContain('pay_airline_fee');
  });

  it('appears once the token also carries airlines:write', () => {
    const writer = filterByScopes(ALL_TOOLS, ['airlines:read', 'airlines:write']).map((t) => t.name);
    expect(writer).toContain('pay_airline_fee');
    expect(writer).toContain('cancel_airline_reservation');
  });

  it('records the payment and echoes the amount back in dollars', async () => {
    const result: any = await dispatch('pay_airline_fee', { amount: 300, fee_type: 'change' }, '', 'unknown-sub');
    expect(result.source).toBe('sqlite');
    expect(result.paid).toBe(true);
    expect(result.amount).toBe(300);
    expect(result.feeType).toBe('change');
    expect(result.receiptId).toBeGreaterThan(0);
  });

  it('defaults the fee type and attaches the next trip when none is named', async () => {
    const result: any = await dispatch('pay_airline_fee', { amount: 42.5 }, '', 'unknown-sub');
    expect(result.feeType).toBe('change');
    expect(result.confirmationNumber).toBe('K7XR2M');
    expect(result.amount).toBe(42.5);
  });

  it('rejects a non-positive amount instead of writing a row', async () => {
    const result: any = await dispatch('pay_airline_fee', { amount: 0 }, '', 'unknown-sub');
    expect(result.paid).toBe(false);
    expect(result.note).toMatch(/amount/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_mcp_resource_server && npx jest tests/airlinesTools.test.ts -t pay_airline_fee`
Expected: FAIL — `Unknown airlines tool: pay_airline_fee`.

- [ ] **Step 3: Add the tool definition**

In `src/tools/airlinesTools.ts`, add as the first element of `AIRLINES_TOOLS`:

```ts
  {
    // The amount-gated write. Every other vertical binds UC6/7/8/22 to a money
    // tool (pay_bill, checkout, large_trade); airlines had none, so those steps
    // had nothing to bind to. Scopes are byte-identical to
    // cancel_airline_reservation — the amount ladder keys on the tool NAME via
    // WRITE_TOOL_TYPE_MAP, never on scope, so adding a generic `write` here
    // would buy nothing and reintroduce a scope-collision risk.
    name: 'pay_airline_fee',
    description: 'Pay a United fee — change fee, checked-bag fee, or seat-upgrade fee. The amount is evaluated against the transaction policy before the payment is taken.',
    inputSchema: {
      type: 'object',
      properties: {
        amount: { type: 'number', description: 'Fee amount in dollars' },
        fee_type: { type: 'string', description: "One of 'change', 'bag', 'upgrade' (default 'change')" },
        confirmation_number: { type: 'string', description: 'Reservation the fee applies to. Omit for the next upcoming trip.' },
      },
      required: [],
    },
    requiredScopes: ['airlines:read', 'airlines:write'],
    readOnly: false,
  },
```

- [ ] **Step 4: Add the handler**

In `src/tools/airlinesToolHandler.ts`, extend the import:

```ts
import { getFlight, listBookings, listSeats, nextFlightFor, recordFeePayment, resolvePassenger } from '../db/airlinesDb';
```

Add the handler function above `AIRLINES_TOOL_NAMES`:

```ts
const FEE_TYPES = new Set(['change', 'bag', 'upgrade']);

/**
 * The amount-gated write. Unlike cancelReservation this one really does mutate,
 * but only by APPENDING to fee_payments — nothing a replayed demo can exhaust,
 * and the row is what UC20's audit view reads back.
 *
 * Reaching this function at all is the proof: at $2500 the transaction policy
 * denies, at $600 it demands step-up, at $300 it demands consent. A row here
 * means the ladder let the call through.
 */
function payFee(args: Record<string, unknown>, subject: string): unknown {
  const amount = typeof args.amount === 'number' ? args.amount : Number(args.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { source: SOURCE, paid: false, note: 'A positive fee amount is required.' };
  }
  const rawType = typeof args.fee_type === 'string' ? args.fee_type.trim().toLowerCase() : '';
  const feeType = FEE_TYPES.has(rawType) ? rawType : 'change';

  let confirmationNumber: string | null =
    typeof args.confirmation_number === 'string' && args.confirmation_number.trim()
      ? args.confirmation_number.trim().toUpperCase()
      : null;
  if (!confirmationNumber) {
    const match = resolvePassenger(subject);
    const bookings = match ? listBookings(match.passenger.passenger_ref) : [];
    confirmationNumber = bookings.length ? bookings[0].confirmation_number : null;
  }

  const receipt = recordFeePayment({
    confirmationNumber,
    feeType,
    amountCents: Math.round(amount * 100),
  });

  return {
    source: SOURCE,
    paid: true,
    receiptId: receipt.id,
    confirmationNumber,
    feeType,
    amount,
    paidAt: receipt.paidAt,
  };
}
```

Add `'pay_airline_fee'` to the `AIRLINES_TOOL_NAMES` set and a case to `dispatchAirlinesTool`:

```ts
    case 'pay_airline_fee':
      return payFee(args, subject);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd demo_mcp_resource_server && npx jest tests/airlinesTools.test.ts`
Expected: PASS. The pre-existing `filterByScopes(ALL_TOOLS, ['airlines:read'])` equality assertion still holds — the new tool needs two scopes, so a read-only token does not see it.

- [ ] **Step 6: Route it through the gateway**

In `demo_mcp_gateway/src/router.ts`, add to the `AIRLINES_TOOLS` set:

```ts
  // Phase 2 amount-gated write. Routes to the same 'invest' target as the reads:
  // same physical backend, same audience. Omitting it here means the gate fires,
  // the policy decides, and then the call dies on 'Unknown tool'.
  'pay_airline_fee',
```

- [ ] **Step 7: Verify the gateway still builds and tests green**

Run: `cd demo_mcp_gateway && npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add demo_mcp_resource_server/src/tools/airlinesTools.ts demo_mcp_resource_server/src/tools/airlinesToolHandler.ts demo_mcp_resource_server/tests/airlinesTools.test.ts demo_mcp_gateway/src/router.ts
git commit -m "feat(airlines): pay_airline_fee write tool, routed through the gateway"
```

---

### Task 3: Scope topology entry

**Files:**
- Modify: `scope-topology.json` (the airlines tool block, near line 299)
- Test: `demo_api_server/tests/airlinesVertical.test.js`

**Interfaces:**
- Consumes: the tool name `pay_airline_fee` from Task 2.
- Produces: `scopeTopology.toolScopes('pay_airline_fee')` returns `['airlines:read', 'airlines:write']` and `toolSurface` returns `'gateway'`. Task 5's amount policy depends on the tool being gateway-surfaced.

- [ ] **Step 1: Write the failing test**

Add to `demo_api_server/tests/airlinesVertical.test.js`, inside the existing top-level `describe('airlines vertical', ...)`:

```js
  test('pay_airline_fee is gateway-surfaced and scoped like the cancel write', () => {
    expect(scopeTopology.toolScopes('pay_airline_fee')).toEqual(['airlines:read', 'airlines:write']);
    expect(scopeTopology.toolSurface('pay_airline_fee')).toBe('gateway');
  });

  // The amount ladder must decide the outcome, not a pinned challengeType.
  // large_trade pins step_up unconditionally, which would render UC6's $2500
  // DENY and UC8's $300 HITL both as step-up.
  test('pay_airline_fee pins no challengeType', () => {
    const topology = require('../../scope-topology.json');
    expect(topology.tools.pay_airline_fee.challengeType).toBeUndefined();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest tests/airlinesVertical.test.js --maxWorkers=4`
Expected: FAIL — `toolScopes('pay_airline_fee')` returns undefined or empty.

- [ ] **Step 3: Add the topology entry**

In `scope-topology.json`, in the `tools` object next to the other airlines entries:

```json
    "pay_airline_fee": {
      "requiredScopes": ["airlines:read", "airlines:write"],
      "surface": "gateway"
    },
```

No `challengeType`. The transaction policy decides DENY / step-up / consent from the amount.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && CI=true npx jest tests/airlinesVertical.test.js --maxWorkers=4`
Expected: PASS.

- [ ] **Step 5: Regenerate the derived topology docs**

Run: `npm run topology:verify`
Expected: exit 0. If it reports drift in `docs/scope-topology.md`, regenerate rather than hand-editing — that file is generated.

- [ ] **Step 6: Commit**

```bash
git add scope-topology.json docs/scope-topology.md demo_api_server/tests/airlinesVertical.test.js
git commit -m "feat(airlines): scope-topology entry for pay_airline_fee"
```

---

### Task 4: Vertical plugin declaration, heuristic, and manifest chip

**Files:**
- Modify: `demo_api_server/config/verticals/airlines/index.js`
- Modify: `demo_api_server/config/verticals/airlines/manifest.json`
- Test: `demo_api_server/tests/airlinesVertical.test.js`

**Interfaces:**
- Consumes: `pay_airline_fee` from Tasks 2 and 3.
- Produces: the plugin advertises `pay_airline_fee` and its heuristic matches fee phrases with `extractsAmount: true`. Task 6's catalog trigger text (`pay a $300 change fee`) must match this regex.

- [ ] **Step 1: Write the failing test**

In `demo_api_server/tests/airlinesVertical.test.js`, add `'pay_airline_fee'` to the `AIRLINES_TOOLS` array with a trailing comment:

```js
  'pay_airline_fee',            // Phase 2 amount-gated write — ladder decides
```

Then add:

```js
  test('the fee heuristic extracts the amount and outranks cancel', () => {
    const fee = plugin.heuristics.find((h) => h.action === 'pay_airline_fee');
    expect(fee).toBeDefined();
    expect(fee.extractsAmount).toBe(true);

    const feeIndex = plugin.heuristics.findIndex((h) => h.action === 'pay_airline_fee');
    const cancelIndex = plugin.heuristics.findIndex((h) => h.action === 'cancel_airline_reservation');
    expect(feeIndex).toBeLessThan(cancelIndex);
  });

  // The catalog's amount trigger for this vertical. If the regex stops matching
  // it, UC6/7/8/22 fall through to the LLM and the demo silently loses its
  // DENY / step-up / consent proof.
  test.each([
    'pay a $300 change fee',
    'pay a $2500 change fee',
    'pay the $60 bag fee',
  ])('%s routes to pay_airline_fee', (phrase) => {
    const hit = plugin.heuristics.find((h) => h.re.test(phrase));
    expect(hit && hit.action).toBe('pay_airline_fee');
  });

  // "refund fee" contains `refund`, which the cancel rule also matches.
  test('a refund fee is a fee payment, not a cancellation', () => {
    const hit = plugin.heuristics.find((h) => h.re.test('pay the $75 refund fee'));
    expect(hit.action).toBe('pay_airline_fee');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest tests/airlinesVertical.test.js --maxWorkers=4`
Expected: FAIL on the tool-name assertion and on the heuristic lookup.

- [ ] **Step 3: Declare the tool in the plugin**

In `demo_api_server/config/verticals/airlines/index.js`, add to `TOOLS` above `cancel_airline_reservation`:

```js
  {
    // Phase 2 amount-gated write. No challengeType in scope-topology — the
    // transaction policy decides DENY ($2500) / step-up ($600) / consent ($300)
    // from the amount, which is what UC6/7/8/22 demo.
    name: 'pay_airline_fee',
    description: 'Pay a United change, checked-bag, or seat-upgrade fee.',
    inputSchema: {
      type: 'object',
      properties: {
        amount: { type: 'number', description: 'Fee amount in dollars' },
        fee_type: { type: 'string', description: "'change', 'bag', or 'upgrade'" },
        confirmation_number: { type: 'string', description: 'Reservation the fee applies to' },
      },
      required: [],
    },
    scopes: ['airlines:read', 'airlines:write'],
    authz: {},
  },
```

- [ ] **Step 4: Add the heuristic, first in the list**

In the same file, make the fee rule the first entry of `HEURISTICS`:

```js
  // FIRST, ahead of the cancel rule: "pay the $75 refund fee" contains `refund`,
  // which the cancel rule matches, and a fee payment routed to the cancel tool
  // would demo an MFA step-up where the amount ladder is the point.
  // extractsAmount is what puts the stated figure in front of the transaction
  // policy — without it the ladder sees no amount and never fires.
  { re: /\b(pay|settle)\b.*\bfees?\b/i, action: 'pay_airline_fee', extractsAmount: true, paramHint: 'e.g. "pay a $300 change fee"' },
```

- [ ] **Step 5: Add the manifest chip**

`airlinesVertical.test.js` asserts the manifest's chip tools equal the tool list exactly, so a new tool needs a chip. In `manifest.json`, add to `chips10` after the `ua5` entry:

```json
      {
        "id": "ua6",
        "label": "Pay a change fee",
        "message": "pay a $300 change fee",
        "mode": "both",
        "tool": "pay_airline_fee",
        "useCaseId": "consent-required",
        "group": "advanced"
      },
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd demo_api_server && CI=true npx jest tests/airlinesVertical.test.js --maxWorkers=4`
Expected: PASS, including the pre-existing chip-tools equality assertion.

- [ ] **Step 7: Regenerate the MCP server's vertical tool handlers**

Run: `cd demo_api_server && npm run vertical-tools:gen`
Expected: `demo_mcp_server/src/tools/handlers/verticalTools.generated.ts` now contains `pay_airline_fee`. Do not hand-edit it.

- [ ] **Step 8: Commit**

```bash
git add demo_api_server/config/verticals/airlines/index.js demo_api_server/config/verticals/airlines/manifest.json demo_api_server/tests/airlinesVertical.test.js demo_mcp_server/src/tools/handlers/verticalTools.generated.ts
git commit -m "feat(airlines): declare pay_airline_fee on the vertical plugin with an amount-extracting heuristic"
```

---

### Task 5: Amount-policy binding

**Files:**
- Modify: `demo_api_server/services/mcpToolAuthorizationService.js:173-192`
- Test: `demo_api_server/tests/airlinesVertical.test.js`

**Interfaces:**
- Consumes: the tool name `pay_airline_fee`.
- Produces: `WRITE_TOOL_TYPE_MAP.pay_airline_fee === 'transfer'`, which is what puts the tool on the transaction-policy path.

This is the single highest-risk task in the plan. Without this one line the chip routes, the tool runs, and every amount is authorized — the demo looks correct while proving nothing. The map's own comment records the identical failure for `large_trade`.

- [ ] **Step 1: Write the failing test**

Add to `demo_api_server/tests/airlinesVertical.test.js`:

`WRITE_TOOL_TYPE_MAP` is already a named export of the service, with a comment saying it is exported precisely so tests can assert this contract. Import it directly.

```js
  // Without this entry _applyTransactionPolicy returns early on a null
  // transactionType, so $2500 PERMITs and UC6/7/8/22 all silently pass.
  test('pay_airline_fee is on the transaction-policy path', () => {
    const { WRITE_TOOL_TYPE_MAP } = require('../services/mcpToolAuthorizationService');
    expect(WRITE_TOOL_TYPE_MAP.pay_airline_fee).toBe('transfer');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest tests/airlinesVertical.test.js -t 'transaction-policy path' --maxWorkers=4`
Expected: FAIL.

- [ ] **Step 3: Add the map entry**

In `demo_api_server/services/mcpToolAuthorizationService.js`, inside `WRITE_TOOL_TYPE_MAP`, after `large_trade`:

```js
  // airlines (United) UC6/7/8/22 — "pay a $N change fee". Absent here the chip
  // routes but the amount policy never fires: no DENY, no step-up, no consent,
  // and the demo looks correct while authorizing everything.
  pay_airline_fee: 'transfer',
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd demo_api_server && CI=true npx jest tests/airlinesVertical.test.js --maxWorkers=4`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/mcpToolAuthorizationService.js demo_api_server/tests/airlinesVertical.test.js
git commit -m "fix(airlines): put pay_airline_fee on the transaction-policy path"
```

---

### Task 6: Use-case catalog wiring

**Files:**
- Modify: `demo_api_server/config/useCases.js:30-34, 38-47, 50-62, 84-105, 126-145, 666-684`
- Test: `demo_api_server/tests/useCasesAirlines.test.js` (create)

**Interfaces:**
- Consumes: `get_airline_bookings`, `pay_airline_fee`, `sensitive_airline_bookings` — all now registered.
- Produces: `listUseCases('airlines')` resolves the full catalog; `VERTICALS` includes `'airlines'`. This is what makes `GET /api/use-cases?vertical=airlines` return 200 instead of 400.

- [ ] **Step 1: Write the failing test**

Create `demo_api_server/tests/useCasesAirlines.test.js`:

```js
'use strict';

/**
 * The airlines vertical's catalog bindings. Before this, `airlines` was absent
 * from VERTICALS, so /api/use-cases 400'd with unknown_vertical and the Demo
 * Steps dropdown rendered "No demo steps for this vertical".
 */

const { VERTICALS, listUseCases, resolveUseCase } = require('../config/useCases');
const { DEMO_PRIMARY_USE_CASE_IDS } = require('../../demo_api_ui/src/config/demoUseCaseSteps');

describe('airlines use-case catalog', () => {
  test('airlines is a known vertical', () => {
    expect(VERTICALS).toContain('airlines');
  });

  test('every step in the presenter ladder resolves', () => {
    const catalog = listUseCases('airlines');
    for (const id of DEMO_PRIMARY_USE_CASE_IDS) {
      expect(catalog.find((u) => u.id === id)).toBeDefined();
    }
  });

  test('UC1 reads reservations, not balances', () => {
    const uc = resolveUseCase('UC1', 'airlines');
    expect(uc.primaryTool).toBe('get_airline_bookings');
    expect(uc.trigger.text).toBe('show my reservations');
  });

  test.each([
    ['UC6', 2500],
    ['UC7', 600],
    ['UC8', 300],
    ['UC22', 150],
  ])('%s binds the amount ladder to pay_airline_fee at $%d', (id, amount) => {
    const uc = resolveUseCase(id, 'airlines');
    expect(uc.primaryTool).toBe('pay_airline_fee');
    expect(uc.trigger.text).toBe(`pay a $${amount} change fee`);
  });

  test('UC2 routes to the sensitive tool, not the plain lookup', () => {
    const uc = resolveUseCase('UC2', 'airlines');
    expect(uc.primaryTool).toBe('sensitive_airline_bookings');
  });

  test('no airlines chip leaks a banking phrase', () => {
    const banned = /balance|account|transfer|bill|portfolio/i;
    for (const uc of listUseCases('airlines')) {
      if (uc.trigger && uc.trigger.type === 'chip') {
        expect(uc.trigger.text).not.toMatch(banned);
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest tests/useCasesAirlines.test.js --maxWorkers=4`
Expected: FAIL — `VERTICALS` does not contain `'airlines'`.

- [ ] **Step 3: Register the vertical**

In `demo_api_server/config/useCases.js`, add to `VERTICALS`:

```js
const VERTICALS = [
  'banking', 'healthcare', 'retail', 'government',
  'university', 'workforce', 'sporting-goods', 'manufacturing',
  'investment', 'airlines',
];
```

- [ ] **Step 4: Add the five per-vertical map entries**

Each map gains one `airlines` key, in the same position as `investment`:

```js
// READ_TRIGGER_BY_VERTICAL
  airlines: 'show my reservations',

// amountTriggerByVertical
    airlines: `pay a $${n} change fee`,

// READ_PRIMARY_TOOL_BY_VERTICAL
  airlines: 'get_airline_bookings',

// AMOUNT_PRIMARY_TOOL_BY_VERTICAL
  airlines: 'pay_airline_fee',

// A2A_TRIGGER_BY_VERTICAL
  airlines:          'show my sensitive reservations',

// A2A_PRIMARY_TOOL_BY_VERTICAL
  airlines:          'sensitive_airline_bookings',
```

- [ ] **Step 5: Add the UC24 entry**

In the UC24 `chipOverrides` block near line 666, add to both objects:

```js
      airlines: 'What airports are near me?',
```

```js
      airlines: 'get_branch_hours',
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd demo_api_server && CI=true npx jest tests/useCasesAirlines.test.js --maxWorkers=4`
Expected: PASS.

- [ ] **Step 7: Run the primaryTool drift gate**

Run: `cd demo_api_server && CI=true npx jest tests/useCases.primaryTool.test.js --maxWorkers=4`
Expected: PASS. This gate checks each declared `primaryTool` against what the chip actually routes to and names any mismatch. A failure here means the heuristic from Task 4 does not match the trigger text added in Step 4 — fix the regex, not the gate.

- [ ] **Step 8: Regenerate the catalog artifacts**

```bash
cd demo_api_server && npm run use-cases:gen && npm run use-cases:check
```
Expected: exit 0. `check-goldens.js` will report airlines goldens MISSING — that is warn-only by design and does not fail the run.

- [ ] **Step 9: Commit**

```bash
git add demo_api_server/config/useCases.js demo_api_server/tests/useCasesAirlines.test.js docs/ demo_api_server/data/
git commit -m "feat(airlines): wire the vertical into the 20-step use-case catalog"
```

Before staging, run `git status --short` and confirm nothing under `demo_api_server/data/` is an unrelated jest-regenerated artifact. Stage only files the generators actually rewrote for this change.

---

### Task 7: A2A specialist configuration

**Files:**
- Modify: `demo_api_server/config/a2aSpecialists.js`
- Modify: `scope-topology.json` (scopes, resources, apps, provisioning name maps, and the `sensitive_airline_bookings` tool entry)
- Test: `demo_api_server/tests/a2aSpecialistToolRegistry.test.js`

**Interfaces:**
- Consumes: `sensitive_airline_bookings`, already registered.
- Produces: `specialistForVertical('airlines')` returns a specialist with `appKey: 'reservations'`. Task 8 provisions the matching PingOne app and reads `PINGONE_A2A_RESERVATIONS_AGENT_CLIENT_ID` / `_SECRET`.

- [ ] **Step 1: Write the failing test**

Add to `demo_api_server/tests/a2aSpecialistToolRegistry.test.js`:

```js
describe('airlines specialist', () => {
  const { specialistForVertical } = require('../config/a2aSpecialists');

  test('airlines has a specialist bound to the sensitive lookup', () => {
    const spec = specialistForVertical('airlines');
    expect(spec).toBeTruthy();
    expect(spec.appKey).toBe('reservations');
    expect(spec.tools).toEqual(['sensitive_airline_bookings']);
  });

  // Without a2aDelegated the UC2 chip routes to the standard read path and the
  // token chain shows a single exchange instead of the nested-act chain.
  test('the sensitive lookup is marked a2aDelegated', () => {
    const topology = require('../../scope-topology.json');
    expect(topology.tools.sensitive_airline_bookings.a2aDelegated).toBe(true);
    expect(topology.tools.sensitive_airline_bookings.a2aDelegatedScope).toBe('airlines:read');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd demo_api_server && CI=true npx jest tests/a2aSpecialistToolRegistry.test.js --maxWorkers=4`
Expected: FAIL — `specialistForVertical('airlines')` returns null.

- [ ] **Step 3: Add the specialist**

In `demo_api_server/config/a2aSpecialists.js`, add to `A2A_SPECIALISTS` after the `investment` entry:

```js
  airlines: {
    appKey: 'reservations',
    appName: 'Super Banking Reservations Specialist Agent',
    specialistName: 'Reservations Specialist',
    tools: ['sensitive_airline_bookings'],
    subtaskHint: 'retrieve the sensitive reservation details',
  },
```

- [ ] **Step 4: Add the topology scope, resource, and provisioning names**

In `scope-topology.json`:

```json
    "agent:invoke:reservations": { "description": "Invoke the Reservations Specialist A2A intermediate (Exchange #1 actor)", "riskLevel": "medium", "resource": "Super Banking A2A Intermediate - Reservations Specialist", "category": "infra" }
```

Add `"Super Banking A2A Intermediate - Reservations Specialist"` to `resources`, following the shape of the Holdings Specialist entry directly above it. Add both display-name entries to `provisioning.resourceNames` and `provisioning.appNames`, mirroring `Super Banking Holdings Specialist Agent`.

- [ ] **Step 5: Mark the tool A2A-delegated**

Extend the existing `sensitive_airline_bookings` entry:

```json
    "sensitive_airline_bookings": {
      "requiredScopes": ["airlines:read", "sensitive:read"],
      "surface": "gateway",
      "challengeType": "consent",
      "a2aDelegated": true,
      "a2aDelegatedScope": "airlines:read",
      "requiresAgentMediation": true
    },
```

`requiredScopes` is left as it is. `sensitive_holdings` uses the generic `read` plus a narrowed `a2aDelegatedScope`, but copying that shape here would change the tool's existing consent-path behavior, which already works. Step 6 of Task 9 is the checkpoint that confirms Exchange #2 narrows correctly from this set; if it does not, that is where the shape changes.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd demo_api_server && CI=true npx jest tests/a2aSpecialistToolRegistry.test.js tests/airlinesVertical.test.js --maxWorkers=4`
Expected: PASS.

- [ ] **Step 7: Verify topology**

Run: `npm run topology:verify`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add demo_api_server/config/a2aSpecialists.js scope-topology.json docs/scope-topology.md demo_api_server/tests/a2aSpecialistToolRegistry.test.js
git commit -m "feat(airlines): Reservations Specialist A2A wiring for UC2"
```

---

### Task 8: Provision the specialist in PingOne

**Files:** none — this task mutates the live environment `01d89b06` and the untracked root `.env`.

**Interfaces:**
- Consumes: the `reservations` appKey from Task 7.
- Produces: `PINGONE_A2A_RESERVATIONS_AGENT_CLIENT_ID` and `PINGONE_A2A_RESERVATIONS_AGENT_CLIENT_SECRET` in the root `.env`, read by `a2aDelegationService` at runtime.

This task changes a live environment. Read the bootstrap script before running it, and stop for the user at Step 3 — do not create, invent, or rotate any secret.

- [ ] **Step 1: Read the script before running it**

Read `demo_api_server/scripts/` bootstrap entry point referenced by `npm run pingone:bootstrap`. Confirm it creates apps additively and does not delete or rotate existing ones. If it does anything destructive, stop and report rather than running it.

- [ ] **Step 2: Run the bootstrap**

Run: `cd demo_api_server && npm run pingone:bootstrap`
Expected: log lines creating `Demo AI App - Reservations Specialist Agent` and the matching A2A intermediate resource. Existing apps are reported as already present, not recreated.

- [ ] **Step 3: Hand the values to the user**

The bootstrap prints an env block containing:

```
PINGONE_A2A_RESERVATIONS_AGENT_CLIENT_ID=<value>
PINGONE_A2A_RESERVATIONS_AGENT_CLIENT_SECRET=<value>
```

Report both lines to the user and ask them to paste into the root `.env`. Do not write them yourself, and do not proceed until they confirm.

- [ ] **Step 4: Restart the BFF so it reads the new values**

Run: `docker restart ai-demo-api-server`
Expected: container restarts. The BFF bind-mounts the main checkout, so also run `scripts/sync-main-checkout.sh` from the repo root first if the branch has been merged.

- [ ] **Step 5: Confirm the credentials are visible to the service**

Run: `docker exec ai-demo-api-server printenv | grep PINGONE_A2A_RESERVATIONS`
Expected: both variables present and non-empty. An empty secret produces the runtime error `Reservations Specialist (Agent 2) credentials not configured`.

---

### Task 9: Full gate run and live verification

**Files:** none — this task produces evidence.

**Interfaces:**
- Consumes: everything from Tasks 1 through 8.
- Produces: a pass/fail record for all 20 steps.

- [ ] **Step 1: Run every automated gate**

```bash
cd demo_api_server && CI=true npm test -- --forceExit --maxWorkers=4
cd ../demo_api_ui  && npm run test:unit && npm run build
cd .. && npm run topology:verify
cd demo_api_server && npm run use-cases:check
cd .. && npm run hygiene:check
```

Paste the result line from each. A failure in `demo_api_server` should be re-run in isolation before being treated as a regression — this suite flakes under parallel load with a different disjoint set failing each run.

- [ ] **Step 2: Rebuild the resource server and gateway**

The resource server and gateway BAKE their code into their images; a restart serves the old build.

```bash
docker compose build mcp-resource-server mcp-gateway
docker compose up -d mcp-resource-server mcp-gateway
```

- [ ] **Step 3: Prove the container is running the new code**

Run: `docker exec <resource-server-container> grep -c pay_airline_fee /app/dist/tools/airlinesTools.js`
Expected: a non-zero count. A zero means the image is stale — rebuild, do not restart.

- [ ] **Step 4: Confirm the API surface**

Run: `curl -sk "https://api.ping.demo:3001/api/use-cases?vertical=airlines" -H "Authorization: Bearer <token>" | head -c 200`
Expected: `{"vertical":"airlines","useCases":[...` — not `unknown_vertical`.

- [ ] **Step 5: Open the stepper**

Sign in at `https://local.ping-devops.com:4000`, select United Airlines, open Demo Steps.
Expected: 20 steps listed. Not "No demo steps for this vertical."

Sign-in only works on this host — the passkey rp.id must match the serving host, and `api.ping.demo:4000` serves the app but the session cookie lives elsewhere, which presents as "Please sign in."

- [ ] **Step 6: Run UC2 and read the token chain**

This is the checkpoint deferred from Task 7. Run the UC2 step and open the Token Chain.

Expected: two exchanges, a nested `act` chain, and Exchange #2 narrowed to `airlines:read`.

If Exchange #2 fails with `invalid_scope`, the `requiredScopes` shape on `sensitive_airline_bookings` is wrong for the A2A path. Try the `sensitive_holdings` shape — `requiredScopes: ["read"]` with `a2aDelegatedScope: "airlines:read"` — and re-run. Do not collapse `a2aDelegatedScope` to `read`; that was the wrong fix before. If neither shape works, revert Task 7, remove `airlines` from `A2A_TRIGGER_BY_VERTICAL` and `A2A_PRIMARY_TOOL_BY_VERTICAL`, and report UC2 as unwired with the other 19 steps shipping.

- [ ] **Step 7: Run the amount ladder and read the ProofStrip verdict**

Pass is the ProofStrip verdict matching the catalog's `expectedOutcome`, never the chat reply. Client-dispatched chips are not API-scorable, so asserting on reply text produces false passes.

| Step | Expected verdict |
|---|---|
| UC1 | PERMIT, real reservation rows, `source: sqlite` |
| UC6 | DENY at $2500 |
| UC7 | step-up at $600 |
| UC8 | HITL consent at $300 |
| UC22 | CIBA at $150 |
| UC20 | audit shows the `fee_payments` write |

A PERMIT at $2500 means Task 5's map entry is missing or the amount never reached the policy. Check `extractsAmount` on the heuristic first, then `WRITE_TOOL_TYPE_MAP`.

- [ ] **Step 8: Run the remaining thirteen steps**

UC2.5, UC5, UC10, UC11, UC12, UC13, UC14, UC14b, UC18, UC29, UC30, UC31, UC32. These carry no per-vertical binding and should behave exactly as they do in other verticals. Record any that do not.

- [ ] **Step 9: Verify the ledger**

Run: `docker exec <resource-server-container> node -e "const {listFeePayments}=require('/app/dist/db/airlinesDb');console.log(listFeePayments())"`
Expected: rows for the amounts that were permitted, none for the amounts that were denied. A row at $2500 is proof the DENY did not hold.

- [ ] **Step 10: Report**

State ✅ or ❌ per gate with pasted evidence, and a 20-row pass/fail table for the live run. Name anything left unwired and why.

---

## Self-Review

**Spec coverage.** Every spec section maps to a task: change surface (1–7), `pay_airline_fee` definition (2), persistence (1), catalog wiring (6), A2A specialist (7 code, 8 live), verification (9). The spec's UC24 note is Task 6 Step 5. The spec's "no seed and no reset path" is honored — Task 1 Step 3 adds the table to `SCHEMA` but nothing to `seedIfEmpty`.

**Type consistency.** `recordFeePayment` / `listFeePayments` and the `FeePayment` shape are defined in Task 1 and consumed unchanged in Task 2. The tool name `pay_airline_fee` and the scope pair `['airlines:read', 'airlines:write']` are identical across Tasks 2, 3, 4, and 5. `appKey: 'reservations'` in Task 7 matches the `PINGONE_A2A_RESERVATIONS_*` variables in Task 8 — `a2aDelegationService` upper-cases the appKey to build those names.

**Known soft spot.** Task 5 Step 1 offers two test shapes because `WRITE_TOOL_TYPE_MAP` may not be exported. The implementer reads the file and picks. The source-grep fallback is weaker than a real import but still fails loudly if the entry is dropped.
