# Vertical-Native Agent Responses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every vertical's agent responses — panel titles, table columns, chat text, toast messages, and clarification questions — use the vertical's own domain language (orders, purchases, coverage, gear) rather than banking translations.

**Architecture:** The data layer already stores vertical-flavored account/transaction types (e.g. `accountType: "Rewards Points"`, `type: "In-Store"`) via `SEED_PROFILES` in `store.js`. The fix is entirely in the UI formatting/rendering layer: thread `terminology` into every place that currently hardcodes "Accounts", "Balance", "checking/savings", or the 🏦 emoji pattern; then make `formatResult`, `AccountsTable`, `MessageContent`, and `ResultsPanel` render whatever the vertical's data actually says rather than mapping through banking synonyms.

**Tech Stack:** React (JSX, hooks), Jest + React Testing Library, Node.js/Express

---

## Current State — What Is Wrong And Why

The store seeds each user with vertical-appropriate account types (`"Rewards Points"`, `"Primary Care"`, `"PTO Balance"`, etc.) and transaction types (`"In-Store"`, `"Visit"`, `"Accrual"`). The MCP tool `get_my_accounts` returns these verbatim.

However, **four rendering layers** then overwrite or ignore this data with banking language:

1. **`formatResult` (BankingAgent.js:960–998)** — remaps any account type to "Checking Account / Savings Account / Loan Account" via `type.includes("check")` substring matching. A `"Rewards Points"` type doesn't match any branch → falls through to bare `termAccount` with no type label shown.

2. **`AccountsTable` (BankingAgent.js:1069–1135)** — same substring mapping. Plus, the `terminology` prop is never passed to it at render time (line 1517: `<AccountsTable accounts={panel.data} />`).

3. **`ResultsPanel` + `setResultPanel` call sites (lines 4870–4880, 6434–6444)** — hardcode titles `"Accounts"`, `"Recent Transactions"`, `"Balance"` regardless of vertical; never call `buildResultsPanelTitle` with terminology.

4. **`MessageContent` (BankingAgent.js:1292–1326)** — regex parses the 🏦 emoji prefix that `formatResult` emits — which already strips vertical context. Even if terminology is passed, the emoji-anchored regex and "Account / Balance" column headers would still be wrong for other verticals.

---

## File Map

| File | Change |
|---|---|
| `demo_api_ui/src/components/BankingAgent.js` | All four fixes below live here |
| `demo_api_ui/src/components/__tests__/BankingAgent.terminology.test.js` | Add/extend tests for vertical rendering |
| `demo_api_server/config/verticals/sporting-goods.json` | Add `mockData` with sample items (sporting-goods only) |

No new files needed. No server changes. No MCP changes. No store changes.

---

## Task 1: Fix `AccountsTable` — Pass Terminology + Render Actual Type

**Files:**
- Modify: `demo_api_ui/src/components/BankingAgent.js:1069–1135` (AccountsTable component)
- Modify: `demo_api_ui/src/components/BankingAgent.js:1517` (ResultsPanel render call)
- Test: `demo_api_ui/src/components/__tests__/BankingAgent.terminology.test.js`

### What to change

`AccountsTable` already accepts `terminology` but the prop is never passed from `ResultsPanel`. And when it IS passed, the type-name logic still maps `"Rewards Points"` → bare `termAccount` ("Account") because no substring branch matches.

The fix: **use the actual `account_type` / `type` value directly as the Type column value**, and derive the Name column from it rather than remapping through banking substrings.

- [ ] **Step 1.1: Write the failing test**

In `demo_api_ui/src/components/__tests__/BankingAgent.terminology.test.js`, add:

```javascript
import { AccountsTable } from '../../components/BankingAgent';
import { render, screen } from '@testing-library/react';

describe('AccountsTable vertical rendering', () => {
  const retailTerminology = {
    account: 'Account',
    accounts: 'Orders',
    balance: 'Balance',
    accountTypes: ['Rewards Points', 'Store Credit', 'Gift Card'],
  };

  const retailAccounts = [
    { id: 'acc1', account_type: 'Rewards Points', account_number: '****1234', balance: 4200 },
    { id: 'acc2', account_type: 'Store Credit',   account_number: '****5678', balance: 150 },
  ];

  it('renders vertical account types verbatim, not remapped to banking names', () => {
    render(<AccountsTable accounts={retailAccounts} terminology={retailTerminology} />);
    expect(screen.getByText('Rewards Points')).toBeInTheDocument();
    expect(screen.getByText('Store Credit')).toBeInTheDocument();
    expect(screen.queryByText(/checking/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/savings/i)).not.toBeInTheDocument();
  });

  it('shows $4,200.00 balance for rewards account', () => {
    render(<AccountsTable accounts={retailAccounts} terminology={retailTerminology} />);
    expect(screen.getByText('$4,200.00')).toBeInTheDocument();
  });

  it('renders without terminology for banking vertical (unchanged behavior)', () => {
    const bankingAccounts = [
      { id: 'acc1', account_type: 'checking', account_number: '****9999', balance: 2500 },
    ];
    render(<AccountsTable accounts={bankingAccounts} terminology={undefined} />);
    expect(screen.getByText('checking')).toBeInTheDocument();
  });
});
```

- [ ] **Step 1.2: Run test to confirm it fails**

```bash
cd demo_api_ui && npx react-scripts test --watchAll=false --testPathPattern='BankingAgent.terminology' 2>&1 | tail -20
```
Expected: FAIL — "Rewards Points" not found (currently remapped or not rendered).

- [ ] **Step 1.3: Fix `AccountsTable` — render actual type verbatim**

In `BankingAgent.js`, replace the `getFriendlyAccountName` function and the Type column cell inside `AccountsTable`:

Find (lines ~1076–1108):
```javascript
  const getFriendlyAccountName = (account) => {
    if (!terminology && account.name && account.name !== account.id) {
      return account.name;
    }

    const accountType = (
      account.account_type ||
      account.type ||
      ""
    ).toLowerCase();
    const accountNumber = account.account_number || account.id || "";

    // Create friendly name based on type and number
    const accountLabel = terminology?.account || "Account";
    if (accountType === "checking" || accountType.includes("chk")) {
      return accountNumber
        ? `Checking ${accountLabel} (${accountNumber.slice(-4)})`
        : `Checking ${accountLabel}`;
    } else if (accountType === "savings" || accountType.includes("sav")) {
      return accountNumber
        ? `Savings ${accountLabel} (${accountNumber.slice(-4)})`
        : `Savings ${accountLabel}`;
    } else if (accountType === "credit" || accountType.includes("crd")) {
      return accountNumber
        ? `Credit ${accountLabel} (${accountNumber.slice(-4)})`
        : `Credit ${accountLabel}`;
    } else if (accountType === "investment" || accountType.includes("inv")) {
      return accountNumber
        ? `Investment ${accountLabel} (${accountNumber.slice(-4)})`
        : `Investment ${accountLabel}`;
    } else {
      return accountNumber ? `${accountLabel} (${accountNumber.slice(-4)})` : accountLabel;
    }
  };
```

Replace with:
```javascript
  const getFriendlyAccountName = (account) => {
    // Use server-stored name for banking vertical (no terminology overlay)
    if (!terminology && account.name && account.name !== account.id) {
      return account.name;
    }
    const accountNumber = account.account_number || account.account_number || account.id || "";
    const accountLabel = terminology?.account || "Account";
    return accountNumber ? `${accountLabel} (${accountNumber.slice(-4)})` : accountLabel;
  };
```

Also find the Type column cell (line ~1123):
```javascript
            <td>{a.account_type || a.type || (terminology?.account || "Account")}</td>
```
This is already correct — it renders the actual type string verbatim. No change needed here.

- [ ] **Step 1.4: Pass `terminology` to `AccountsTable` in `ResultsPanel`**

Find (line ~1517):
```javascript
        {panel.type === "accounts" && <AccountsTable accounts={panel.data} />}
```

Replace with:
```javascript
        {panel.type === "accounts" && <AccountsTable accounts={panel.data} terminology={panel.terminology} />}
```

- [ ] **Step 1.5: Add `terminology` to every `setResultPanel` call for type `"accounts"`**

There are three `setResultPanel` calls that set `type: "accounts"`:

**Call 1 — main result handler (line ~4876):**
Find:
```javascript
        setResultPanel({
          type: resultType,
          title: titleMap[resultType],
          data: resultData,
        });
```
Replace with:
```javascript
        setResultPanel({
          type: resultType,
          title: titleMap[resultType],
          data: resultData,
          terminology,
        });
```

**Call 2 — post-transaction account refresh (line ~6434):**
Find:
```javascript
            setResultPanel({
              type: "accounts",
              title: "Accounts",
              data: fresh,
            });
```
Replace with:
```javascript
            setResultPanel({
              type: "accounts",
              title: terminology?.accounts || "Accounts",
              data: fresh,
              terminology,
            });
```

**Call 3 — post-transaction balance refresh fallback (line ~6441):**
Find:
```javascript
            setResultPanel({
              type: "accounts",
              title: "Accounts",
              data: fresh,
            });
```
Replace with:
```javascript
            setResultPanel({
              type: "accounts",
              title: terminology?.accounts || "Accounts",
              data: fresh,
              terminology,
            });
```

- [ ] **Step 1.6: Fix `titleMap` to use terminology**

Find (lines ~4870–4875) the `titleMap` object:
```javascript
        const titleMap = {
          accounts: "Accounts",
          transactions: "Recent Transactions",
          balance: "Balance",
          confirm: `${label} confirmed`,
        };
```
Replace with:
```javascript
        const titleMap = {
          accounts:      terminology?.accounts     || "Accounts",
          transactions:  terminology?.transactions || "Recent Transactions",
          balance:       terminology?.balance      || "Balance",
          confirm: `${label} confirmed`,
        };
```

- [ ] **Step 1.7: Run test to confirm it passes**

```bash
cd demo_api_ui && npx react-scripts test --watchAll=false --testPathPattern='BankingAgent.terminology' 2>&1 | tail -20
```
Expected: PASS — "Rewards Points", "Store Credit", balances render correctly.

- [ ] **Step 1.8: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add demo_api_ui/src/components/BankingAgent.js demo_api_ui/src/components/__tests__/BankingAgent.terminology.test.js
git commit -m "fix(vertical): AccountsTable renders actual account types; thread terminology through ResultsPanel

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Fix `formatResult` — Chat Bubble Text

**Files:**
- Modify: `demo_api_ui/src/components/BankingAgent.js:960–998` (formatResult accounts branch)
- Test: `demo_api_ui/src/components/__tests__/BankingAgent.terminology.test.js`

### What to change

`formatResult` produces the text that goes into the chat bubble. The accounts branch (line 960–998) currently remaps `accountType` through banking substrings ("check" → "Checking Account") and emits the 🏦 emoji. For non-banking verticals, the type is e.g. `"Rewards Points"` — it matches no substring branch and renders as bare `termAccount`.

The fix: **render the raw account type string directly**, and drop the banking-only substring remapping entirely.

- [ ] **Step 2.1: Write the failing test**

In `demo_api_ui/src/components/__tests__/BankingAgent.terminology.test.js`, add:

```javascript
import { formatResult } from '../../components/BankingAgent';

describe('formatResult vertical rendering', () => {
  const retailTerminology = {
    account: 'Account',
    accounts: 'Orders',
    balance: 'Balance',
  };

  const retailResult = {
    content: [{ text: JSON.stringify({
      accounts: [
        { id: 'acc1', accountType: 'Rewards Points', accountNumber: '****1234', balance: 4200, currency: 'USD' },
        { id: 'acc2', accountType: 'Store Credit',   accountNumber: '****5678', balance: 150,  currency: 'USD' },
      ]
    }) }]
  };

  it('renders Rewards Points type for retail without remapping to banking names', () => {
    const text = formatResult(retailResult, retailTerminology);
    expect(text).toContain('Rewards Points');
    expect(text).not.toMatch(/checking/i);
    expect(text).not.toMatch(/savings/i);
  });

  it('renders Store Credit type for retail', () => {
    const text = formatResult(retailResult, retailTerminology);
    expect(text).toContain('Store Credit');
  });

  const bankingResult = {
    content: [{ text: JSON.stringify({
      accounts: [
        { id: 'acc1', accountType: 'checking', accountNumber: '****9999', balance: 2500, currency: 'USD' },
      ]
    }) }]
  };

  it('renders checking type verbatim for banking vertical', () => {
    const text = formatResult(bankingResult, undefined);
    expect(text).toContain('checking');
  });
});
```

- [ ] **Step 2.2: Run test to confirm it fails**

```bash
cd demo_api_ui && npx react-scripts test --watchAll=false --testPathPattern='BankingAgent.terminology' 2>&1 | tail -20
```
Expected: FAIL — "Rewards Points" not found in output.

- [ ] **Step 2.3: Fix `formatResult` accounts branch**

Find (lines ~960–998):
```javascript
  // Accounts list
  if (r.accounts) {
    return r.accounts
      .map((a) => {
        // Normalise field names — MCP server uses camelCase, local tools may use snake_case
        const type = (
          a.accountType ||
          a.account_type ||
          a.type ||
          ""
        ).toLowerCase();
        const num = a.accountNumber || a.account_number || "";
        // When vertical terminology is active, derive name from type so server-stored
        // banking names ("Checking Account") don't leak through on other verticals.
        const name =
          (!terminology && a.name && a.name !== a.id)
            ? a.name
            : type.includes("check")
              ? `Checking ${termAccount}`
              : type.includes("sav")
                ? `Savings ${termAccount}`
                : type.includes("loan")
                  ? `Loan ${termAccount}`
                  : type.includes("crd") || type.includes("credit")
                    ? `Credit ${termAccount}`
                    : termAccount;

        // Show only basic account info — IBAN/SWIFT/routing are revealed only via "View Sensitive Account Details"
        return (
          "\u{1f3e6} " +
          name +
          " (" +
          (num || "—") +
          ") — " +
          formatCurrency(a.balance) +
          " " +
          (a.currency || "USD")
        );
      })
      .join("\n\n");
  }
```

Replace with:
```javascript
  // Accounts list
  if (r.accounts) {
    return r.accounts
      .map((a) => {
        // Use the actual account type from the server — vertical-seeded accounts already
        // carry the correct domain type (e.g. "Rewards Points", "Pro Member", "Primary Care").
        // For banking vertical (no terminology), fall back to the stored display name.
        const rawType = a.accountType || a.account_type || a.type || "";
        const displayType = rawType || termAccount;
        const num = a.accountNumber || a.account_number || "";
        const name = (!terminology && a.name && a.name !== a.id)
          ? a.name
          : `${displayType} (${num || "—"})`;

        return `${name} — ${formatCurrency(a.balance)} ${a.currency || "USD"}`;
      })
      .join("\n\n");
  }
```

Note: the 🏦 emoji is removed. `MessageContent` parses the 🏦-prefixed pattern to render a table — that will be fixed in Task 3.

- [ ] **Step 2.4: Run test to confirm it passes**

```bash
cd demo_api_ui && npx react-scripts test --watchAll=false --testPathPattern='BankingAgent.terminology' 2>&1 | tail -20
```
Expected: PASS.

- [ ] **Step 2.5: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add demo_api_ui/src/components/BankingAgent.js demo_api_ui/src/components/__tests__/BankingAgent.terminology.test.js
git commit -m "fix(vertical): formatResult renders actual account types instead of banking remap

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Fix `MessageContent` — Chat Bubble Table Parsing

**Files:**
- Modify: `demo_api_ui/src/components/BankingAgent.js:1292–1326` (MessageContent)
- Test: `demo_api_ui/src/components/__tests__/BankingAgent.terminology.test.js`

### What to change

`MessageContent` uses a regex anchored on the 🏦 emoji to detect and table-ify account output from `formatResult`. Now that Task 2 removed the emoji, this path will never trigger. The new format is `"Type (****1234) — $4,200.00 USD"`.

Update `MessageContent` to parse the new format, and update the column headers to use terminology.

- [ ] **Step 3.1: Write the failing test**

```javascript
import { MessageContent } from '../../components/BankingAgent';
import { render, screen } from '@testing-library/react';

describe('MessageContent vertical table rendering', () => {
  const retailTerminology = {
    account: 'Account',
    accounts: 'Orders',
    balance: 'Balance',
  };

  // This is now the format emitted by the fixed formatResult
  const retailText = [
    'Rewards Points (****1234) — $4,200.00 USD',
    'Store Credit (****5678) — $150.00 USD',
  ].join('\n\n');

  it('renders a table for multi-line account text', () => {
    render(<MessageContent text={retailText} terminology={retailTerminology} />);
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('shows Orders as the accounts column header for retail', () => {
    render(<MessageContent text={retailText} terminology={retailTerminology} />);
    expect(screen.getByText('Orders')).toBeInTheDocument();
  });

  it('shows Balance column header', () => {
    render(<MessageContent text={retailText} terminology={retailTerminology} />);
    expect(screen.getByText('Balance')).toBeInTheDocument();
  });

  it('shows Rewards Points as account name', () => {
    render(<MessageContent text={retailText} terminology={retailTerminology} />);
    expect(screen.getByText(/Rewards Points/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3.2: Run test to confirm it fails**

```bash
cd demo_api_ui && npx react-scripts test --watchAll=false --testPathPattern='BankingAgent.terminology' 2>&1 | tail -20
```
Expected: FAIL — table not rendered because 🏦 regex no longer matches.

- [ ] **Step 3.3: Update `MessageContent` account parsing**

Find (lines ~1292–1326):
```javascript
export function MessageContent({ text, isTokenEvent, terminology }) {
  // Detect and format account data as tables (remove emojis)
  const accountPattern = /🏦\s+([^(]+)\s*\(([^)]+)\)\s*—\s*([^\n]+)/gm;
  const accountMatches = [...text.matchAll(accountPattern)];

  if (accountMatches.length > 0) {
    const rows = accountMatches.map((match) => ({
      account: match[1].trim(),
      id: match[2].trim(),
      balance: match[3].trim(),
    }));

    return (
      <table className="ba-msg-table">
        <thead>
          <tr>
            <th>{terminology?.accounts || "Account"}</th>
            <th>ID</th>
            <th>{terminology?.balance || "Balance"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={`${row.account}-${idx}`}>
              <td>
                <strong>{row.account}</strong>
              </td>
              <td>{row.id}</td>
              <td>{row.balance}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
```

Replace with:
```javascript
export function MessageContent({ text, isTokenEvent, terminology }) {
  // Detect account list lines emitted by formatResult.
  // Format: "Type (****NNNN) — $X.XX USD" (one account per paragraph, separated by \n\n)
  const accountPattern = /^(.+?)\s*\(([^)]+)\)\s*—\s*(\$[\d,]+\.\d{2}(?:\s+\w+)?)\s*$/gm;
  const accountMatches = [...text.matchAll(accountPattern)];

  if (accountMatches.length > 0) {
    const rows = accountMatches.map((match) => ({
      account: match[1].trim(),
      id: match[2].trim(),
      balance: match[3].trim(),
    }));

    return (
      <table className="ba-msg-table">
        <thead>
          <tr>
            <th>{terminology?.accounts || "Account"}</th>
            <th>ID</th>
            <th>{terminology?.balance || "Balance"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={`${row.account}-${idx}`}>
              <td>
                <strong>{row.account}</strong>
              </td>
              <td>{row.id}</td>
              <td>{row.balance}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
```

- [ ] **Step 3.4: Run test to confirm it passes**

```bash
cd demo_api_ui && npx react-scripts test --watchAll=false --testPathPattern='BankingAgent.terminology' 2>&1 | tail -20
```
Expected: PASS.

- [ ] **Step 3.5: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add demo_api_ui/src/components/BankingAgent.js demo_api_ui/src/components/__tests__/BankingAgent.terminology.test.js
git commit -m "fix(vertical): MessageContent parses new account format; shows vertical column headers

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Fix Transactions — `formatResult` and `TransactionsTable`

**Files:**
- Modify: `demo_api_ui/src/components/BankingAgent.js:1000–1008` (formatResult transactions branch)
- Modify: `demo_api_ui/src/components/BankingAgent.js:1137–1174` (TransactionsTable)
- Modify: `demo_api_ui/src/components/BankingAgent.js:1517–1520` (ResultsPanel transactions render)
- Modify: `demo_api_ui/src/components/BankingAgent.js:5978–5985` (setResultPanel transactions call)
- Modify: `demo_api_ui/src/components/BankingAgent.js:6456–6461` (post-tx refresh setResultPanel)
- Test: `demo_api_ui/src/components/__tests__/BankingAgent.terminology.test.js`

### What to change

Transactions already store vertical-flavored `type` values (`"In-Store"`, `"Visit"`, `"Accrual"`) — `formatResult` renders them verbatim which is already correct. The main gaps are:

1. `TransactionsTable` column headers say `"Type"`, `"Amount"`, `"Description"`, `"Date"` — these should use `terminology.transaction`, `terminology.transactions`, etc.
2. `TransactionsTable` never receives `terminology` prop.
3. `setResultPanel` for transactions hardcodes title `"Recent Transactions"` / `"Spending Breakdown"`.
4. Post-tx refresh `setResultPanel` for transactions hardcodes `"Recent Transactions"`.

- [ ] **Step 4.1: Write the failing test**

```javascript
import { render, screen } from '@testing-library/react';

// TransactionsTable is not currently exported — we test via BankingAgent rendering
// through the ResultsPanel path. Instead, test formatResult transactions branch
// and the TransactionsTable column headers via a direct render test.

// We need to export TransactionsTable first (step 4.3 does this), so write the test
// in anticipation of the export:
import { formatResult } from '../../components/BankingAgent';

describe('formatResult transactions — vertical types render verbatim', () => {
  const retailResult = {
    content: [{ text: JSON.stringify({
      transactions: [
        { id: 't1', type: 'In-Store',  amount: 249,  description: 'TV Purchase',  date: '2026-04-20' },
        { id: 't2', type: 'Online',    amount: 1999, description: 'Laptop Order', date: '2026-04-22' },
      ]
    }) }]
  };

  it('shows In-Store type verbatim in transaction text', () => {
    const text = formatResult(retailResult, undefined);
    expect(text).toContain('In-Store');
  });

  it('shows Online type verbatim', () => {
    const text = formatResult(retailResult, undefined);
    expect(text).toContain('Online');
  });

  const healthcareResult = {
    content: [{ text: JSON.stringify({
      transactions: [
        { id: 't1', type: 'Visit', amount: 50, description: 'Annual Physical', date: '2026-04-10' },
      ]
    }) }]
  };

  it('shows Visit type verbatim for healthcare', () => {
    const text = formatResult(healthcareResult, undefined);
    expect(text).toContain('Visit');
  });
});
```

- [ ] **Step 4.2: Run test to confirm it passes already**

```bash
cd demo_api_ui && npx react-scripts test --watchAll=false --testPathPattern='BankingAgent.terminology' 2>&1 | tail -20
```
Expected: PASS — transaction types are already rendered verbatim by `formatResult`. This confirms the transaction text path is correct; only the table headers need fixing.

- [ ] **Step 4.3: Export `TransactionsTable` and add `terminology` prop**

Find (line ~1137):
```javascript
function TransactionsTable({ transactions }) {
```

Replace with:
```javascript
export function TransactionsTable({ transactions, terminology }) {
```

Find the `<thead>` inside `TransactionsTable` (lines ~1141–1147):
```javascript
      <thead>
        <tr>
          <th>Type</th>
          <th>Amount</th>
          <th>Description</th>
          <th>Date</th>
        </tr>
      </thead>
```

Replace with:
```javascript
      <thead>
        <tr>
          <th>{terminology?.transaction || "Type"}</th>
          <th>{terminology?.balance || "Amount"}</th>
          <th>Description</th>
          <th>Date</th>
        </tr>
      </thead>
```

- [ ] **Step 4.4: Pass `terminology` in `ResultsPanel` transactions render**

Find (lines ~1518–1520):
```javascript
        {panel.type === "transactions" && (
          <TransactionsTable transactions={panel.data} />
        )}
```

Replace with:
```javascript
        {panel.type === "transactions" && (
          <TransactionsTable transactions={panel.data} terminology={panel.terminology} />
        )}
```

- [ ] **Step 4.5: Add `terminology` to `setResultPanel` calls for transactions**

**Call at line ~5978 (spending_summary / biggest_purchase):**
Find:
```javascript
        setResultPanel({
          type: "transactions",
          title:
            action === "biggest_purchase"
              ? "Transactions"
              : "Spending Breakdown",
          data: txList,
        });
```

Replace with:
```javascript
        setResultPanel({
          type: "transactions",
          title:
            action === "biggest_purchase"
              ? (terminology?.transactions || "Transactions")
              : "Spending Breakdown",
          data: txList,
          terminology,
        });
```

**Call at line ~6456 (post-tx transactions refresh):**
Find:
```javascript
            setResultPanel({
              type: "transactions",
              title: "Recent Transactions",
              data: data.transactions,
            });
```

Replace with:
```javascript
            setResultPanel({
              type: "transactions",
              title: terminology?.transactions || "Recent Transactions",
              data: data.transactions,
              terminology,
            });
```

- [ ] **Step 4.6: Write and run the TransactionsTable column header test**

Add to `BankingAgent.terminology.test.js`:

```javascript
import { TransactionsTable } from '../../components/BankingAgent';

describe('TransactionsTable vertical rendering', () => {
  const healthcareTerminology = {
    transaction: 'Appointment',
    transactions: 'Appointments',
    balance: 'Coverage',
  };

  const healthcareTransactions = [
    { id: 't1', type: 'Visit', amount: 50, description: 'Annual Physical', date: '2026-04-10' },
    { id: 't2', type: 'Lab',   amount: 25, description: 'Blood Work',      date: '2026-04-15' },
  ];

  it('uses "Appointment" as the Type column header for healthcare', () => {
    render(<TransactionsTable transactions={healthcareTransactions} terminology={healthcareTerminology} />);
    expect(screen.getByText('Appointment')).toBeInTheDocument();
    expect(screen.queryByText('Type')).not.toBeInTheDocument();
  });

  it('renders Visit and Lab types verbatim', () => {
    render(<TransactionsTable transactions={healthcareTransactions} terminology={healthcareTerminology} />);
    expect(screen.getByText('Visit')).toBeInTheDocument();
    expect(screen.getByText('Lab')).toBeInTheDocument();
  });

  it('renders without terminology for banking vertical (Type header)', () => {
    const bankingTransactions = [
      { id: 't1', type: 'deposit', amount: 1000, description: 'Payroll', date: '2026-04-01' },
    ];
    render(<TransactionsTable transactions={bankingTransactions} terminology={undefined} />);
    expect(screen.getByText('Type')).toBeInTheDocument();
  });
});
```

```bash
cd demo_api_ui && npx react-scripts test --watchAll=false --testPathPattern='BankingAgent.terminology' 2>&1 | tail -20
```
Expected: PASS.

- [ ] **Step 4.7: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add demo_api_ui/src/components/BankingAgent.js demo_api_ui/src/components/__tests__/BankingAgent.terminology.test.js
git commit -m "fix(vertical): TransactionsTable uses vertical terminology for column headers; thread terminology through

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Fix Balance — Panel Title and `formatResult`

**Files:**
- Modify: `demo_api_ui/src/components/BankingAgent.js:1011–1013` (formatResult balance branch)
- Modify: `demo_api_ui/src/components/BankingAgent.js:1521–1527` (ResultsPanel balance render)
- Test: `demo_api_ui/src/components/__tests__/BankingAgent.terminology.test.js`

### What to change

The balance result panel shows a hardcoded label "Balance". For retail it should say "Balance" (already matches), for sporting-goods it should say "Reward Points", for healthcare it should say "Coverage". The `formatResult` balance text also hardcodes "Balance:".

- [ ] **Step 5.1: Write the failing test**

```javascript
import { formatResult } from '../../components/BankingAgent';

describe('formatResult balance — vertical terminology', () => {
  const sportingTerminology = { balance: 'Reward Points' };
  const balanceResult = {
    content: [{ text: JSON.stringify({ balance: 1200.50 }) }]
  };

  it('shows "Reward Points: $1,200.50" for sporting-goods', () => {
    const text = formatResult(balanceResult, sportingTerminology);
    expect(text).toBe('Reward Points: $1,200.50');
  });

  it('shows "Balance: $1,200.50" for banking (no terminology)', () => {
    const text = formatResult(balanceResult, undefined);
    expect(text).toBe('Balance: $1,200.50');
  });

  const healthcareTerminology = { balance: 'Coverage' };
  it('shows "Coverage: $1,200.50" for healthcare', () => {
    const text = formatResult(balanceResult, healthcareTerminology);
    expect(text).toBe('Coverage: $1,200.50');
  });
});
```

- [ ] **Step 5.2: Run test to confirm it passes already (or fails)**

```bash
cd demo_api_ui && npx react-scripts test --watchAll=false --testPathPattern='BankingAgent.terminology' 2>&1 | tail -20
```
The `formatResult` balance branch at line 1012 already uses `termBalance`:
```javascript
  if (r.balance !== undefined) {
    return `${termBalance}: ${formatCurrency(r.balance)}`;
  }
```
And `termBalance` is set from `terminology?.balance || "Balance"`. So this test should **already pass** — confirming `formatResult` balance is correct.

- [ ] **Step 5.3: Fix the balance panel label in `ResultsPanel`**

Find (lines ~1521–1527):
```javascript
        {panel.type === "balance" && (
          <div className="bar-rp-balance">
            <span className="bar-rp-balance-label">Balance</span>
            <span className="bar-rp-balance-value">
              {formatCurrency(panel.data)}
            </span>
          </div>
        )}
```

Replace with:
```javascript
        {panel.type === "balance" && (
          <div className="bar-rp-balance">
            <span className="bar-rp-balance-label">{panel.terminology?.balance || "Balance"}</span>
            <span className="bar-rp-balance-value">
              {formatCurrency(panel.data)}
            </span>
          </div>
        )}
```

- [ ] **Step 5.4: Add `terminology` to the balance `setResultPanel` call**

In the main result handler (Task 1, Step 1.5), `terminology` is already being added to the generic `setResultPanel` call. Confirm the balance case is covered by this same change — it is, because the generic `titleMap` handler fires for all result types. No extra change needed.

However, check if any standalone `setResultPanel({ type: "balance", ... })` calls exist and lack `terminology`:

```bash
grep -n 'type: "balance"' demo_api_ui/src/components/BankingAgent.js
```

If any found without `terminology`, add `terminology,` to each.

- [ ] **Step 5.5: Write balance panel label test**

```javascript
import { render, screen } from '@testing-library/react';
// We need to test ResultsPanel — it's not currently exported.
// Test via a thin integration: import BankingAgent and check rendered output.
// For now, test that panel.terminology reaches the label via a unit test of
// the balance section. Since ResultsPanel is an internal function, test via
// the exported buildResultsPanelTitle helper to confirm title is correct.

import { buildResultsPanelTitle } from '../../components/BankingAgent';

describe('buildResultsPanelTitle — vertical terminology', () => {
  it('returns "Reward Points" for balance with sporting-goods terminology', () => {
    expect(buildResultsPanelTitle('balance', { balance: 'Reward Points' })).toBe('Reward Points');
  });

  it('returns "Coverage" for balance with healthcare terminology', () => {
    expect(buildResultsPanelTitle('balance', { balance: 'Coverage' })).toBe('Coverage');
  });

  it('returns "Orders" for accounts with retail terminology', () => {
    expect(buildResultsPanelTitle('accounts', { accounts: 'Orders' })).toBe('Orders');
  });

  it('returns "Appointments" for transactions with healthcare terminology', () => {
    expect(buildResultsPanelTitle('transactions', { transactions: 'Appointments' })).toBe('Appointments');
  });

  it('falls back to banking defaults when no terminology', () => {
    expect(buildResultsPanelTitle('accounts', undefined)).toBe('Accounts');
    expect(buildResultsPanelTitle('balance', undefined)).toBe('Balance');
    expect(buildResultsPanelTitle('transactions', undefined)).toBe('Recent Transactions');
  });
});
```

```bash
cd demo_api_ui && npx react-scripts test --watchAll=false --testPathPattern='BankingAgent.terminology' 2>&1 | tail -20
```
Expected: PASS — `buildResultsPanelTitle` already uses `terminology?.accounts` etc.

- [ ] **Step 5.6: Commit**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add demo_api_ui/src/components/BankingAgent.js demo_api_ui/src/components/__tests__/BankingAgent.terminology.test.js
git commit -m "fix(vertical): balance panel label uses vertical terminology (Coverage, Reward Points, etc.)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 6: Fix Clarification Questions and Transfer Confirm Text

**Files:**
- Modify: `demo_api_ui/src/components/BankingAgent.js` — `buildClarificationQuestions` and transfer confirm text
- Test: `demo_api_ui/src/components/__tests__/BankingAgent.terminology.test.js`

### What to change

`buildClarificationQuestions` (line 1056) already uses terminology for `termAccounts` and `termHighValue`. But the clarification question strings themselves contain hardcoded "accounts":

```javascript
accounts: `Which ${termAccounts} would you like to view?`,
```

This is correct — it already uses `termAccounts`. Verify this is actually called with live terminology at every call site. Also check the transfer confirmation message text for hardcoded banking words.

- [ ] **Step 6.1: Audit clarification question call sites**

```bash
grep -n "buildClarificationQuestions" demo_api_ui/src/components/BankingAgent.js
```

Read each call site and confirm `terminology` is passed. If any call site passes `undefined` or omits the argument, fix it to pass `terminology`.

- [ ] **Step 6.2: Audit transfer confirmation text**

```bash
grep -n '"Transfer\|transfer.*confirm\|confirmed\|transfered\|transfer complete' demo_api_ui/src/components/BankingAgent.js | head -20
```

For each hardcoded "Transfer" in success messages visible to the user, replace with `terminology?.highValueAction || "Transfer"` if it appears in a result that the user sees as a chat message.

- [ ] **Step 6.3: Fix any call sites found in steps 6.1 and 6.2**

Make targeted replacements only for issues found. If nothing found, skip this task.

- [ ] **Step 6.4: Run full terminology test suite**

```bash
cd demo_api_ui && npx react-scripts test --watchAll=false --testPathPattern='BankingAgent.terminology' 2>&1 | tail -30
```
Expected: all tests PASS.

- [ ] **Step 6.5: Commit if any changes made**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add demo_api_ui/src/components/BankingAgent.js
git commit -m "fix(vertical): thread terminology into clarification questions and transfer confirm text

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 7: Regression — Run Full Test Suite

**Files:** No changes — verification only.

- [ ] **Step 7.1: Run all tests**

```bash
cd /Users/curtismuir/Development/AI-Demo
npm test 2>&1 | tail -40
```

- [ ] **Step 7.2: Fix any newly broken tests**

The most likely breakages:
- Tests that assert the 🏦 emoji in `formatResult` output → update assertions to the new format (`"Rewards Points (****1234) — $4,200.00 USD"`)
- Tests that assert `AccountsTable` renders `"Checking Account"` or `"Savings Account"` → update to match the new verbatim-type behavior
- Tests that assert panel title `"Accounts"` hardcoded → update to use `terminology?.accounts || "Accounts"`

For each failing test, read it, understand what it was testing, update the assertion to match the new correct output. Do not change the implementation to make old tests pass.

- [ ] **Step 7.3: Run `demo_api_server` tests**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_server
npm test 2>&1 | tail -20
```
Expected: no failures (server code is unchanged).

- [ ] **Step 7.4: Build the UI**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_ui
npm run build 2>&1 | tail -10
```
Expected: exit 0.

- [ ] **Step 7.5: Commit any test fixes**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add -A
git commit -m "test: update assertions for vertical-native response format changes

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 8: Add `mockData` to Sporting-Goods Vertical + Verify All Verticals End-to-End

**Files:**
- Modify: `demo_api_server/config/verticals/sporting-goods.json`
- No code changes — smoke test only

### What to change

`sporting-goods.json` has `"mockData": null`. Give it sample items parallel to retail so there's something to show in the RetailDashboard-equivalent. (The agent chip flow uses live DB data, but `mockData` is used for the product/order grid widget on the dashboard.)

- [ ] **Step 8.1: Add mockData to sporting-goods.json**

In `demo_api_server/config/verticals/sporting-goods.json`, find:
```json
    "mockData": null
```

Replace with:
```json
    "mockData": {
      "products": [
        { "id": "p1", "sku": "SS-NK-RUN", "name": "Nike Pegasus 41",      "price": 140, "stock": "In Stock",  "category": "Running" },
        { "id": "p2", "sku": "SS-UA-HVY", "name": "Under Armour Hoodie",  "price": 75,  "stock": "In Stock",  "category": "Apparel" },
        { "id": "p3", "sku": "SS-TW-GOLF","name": "Titleist Pro V1 (12)", "price": 55,  "stock": "Low Stock", "category": "Golf" },
        { "id": "p4", "sku": "SS-YNX-MAT","name": "Yonex Badminton Racket","price": 120,"stock": "In Stock",  "category": "Racket" },
        { "id": "p5", "sku": "SS-GRM-WCH","name": "Garmin Forerunner 265","price": 449, "stock": "In Stock",  "category": "Wearable" }
      ],
      "orders": [
        { "id": "o1", "product": "Nike Pegasus 41",      "sku": "SS-NK-RUN",  "amount": 140, "status": "Delivered",  "date": "2026-04-18" },
        { "id": "o2", "product": "Garmin Forerunner 265","sku": "SS-GRM-WCH", "amount": 449, "status": "Shipped",    "date": "2026-04-25" },
        { "id": "o3", "product": "Titleist Pro V1",      "sku": "SS-TW-GOLF", "amount": 55,  "status": "Processing", "date": "2026-04-27" }
      ]
    }
```

- [ ] **Step 8.2: Verify vertical config service loads the updated file**

```bash
cd /Users/curtismuir/Development/AI-Demo/demo_api_server
npm test -- --testPathPattern='verticalConfigService' 2>&1 | tail -20
```
Expected: PASS.

- [ ] **Step 8.3: Manual smoke test — all verticals**

Start the app:
```bash
cd /Users/curtismuir/Development/AI-Demo && ./run.sh
```

For each vertical (banking, retail, healthcare, sporting-goods, workforce), do:
1. Log in at `https://api.ping.demo:4000`
2. Switch to the vertical in the Admin config tab
3. Open the agent (FAB or sidebar)
4. Click the first chip (e.g. "Rewards Points", "Check Coverage", "PTO Balance")
5. Verify:
   - Chat bubble shows the vertical type verbatim (e.g. "Rewards Points (****1234) — $4,200.00 USD", not "Checking Account")
   - Results panel title uses vertical term (e.g. "Orders", "Patient Records", "Loyalty Accounts")
   - Results panel table Type column shows the actual stored type (e.g. "Rewards Points")
   - No banking language leaks into chat text or panel

6. Click the transactions chip (e.g. "Purchase History", "Appointments", "Request History")
7. Verify transaction types render verbatim (e.g. "In-Store", "Visit", "Accrual")

- [ ] **Step 8.4: Commit sporting-goods mockData**

```bash
cd /Users/curtismuir/Development/AI-Demo
git add demo_api_server/config/verticals/sporting-goods.json
git commit -m "feat(vertical): add mockData products and orders to sporting-goods manifest

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Self-Review

### Spec coverage check

| Requirement | Task |
|---|---|
| Vertical chips show vertical-domain responses (not banking translation) | Tasks 1–5 |
| Account types render verbatim ("Rewards Points", "Primary Care", etc.) | Tasks 1, 2 |
| Panel titles use vertical terminology ("Orders", "Appointments") | Tasks 1, 4, 5 |
| Chat bubble text uses vertical types | Task 2 |
| Chat bubble table columns use vertical terminology | Task 3 |
| Transaction type column header uses vertical term | Task 4 |
| Balance label uses vertical term ("Reward Points", "Coverage") | Task 5 |
| Transfer/highValue confirm text uses vertical term | Task 6 |
| No existing tests broken | Task 7 |
| UI builds clean | Task 7 |
| mockData exists for sporting-goods | Task 8 |

### Placeholder scan

No TBDs, TODOs, or "similar to Task N" references. All code blocks are complete.

### Type consistency

- `terminology` prop shape is consistent: `{ account, accounts, balance, transaction, transactions, highValueAction }` — same object throughout all tasks.
- `panel` shape: `{ type, title, data, terminology }` — `terminology` field added in Task 1, used in Tasks 3, 4, 5 consistently.
- `TransactionsTable` is exported in Task 4 and imported in tests in Task 4.

### Edge cases confirmed

- Banking vertical (`terminology = undefined`): all `terminology?.xxx || "fallback"` patterns return the banking fallback string — behavior unchanged.
- Accounts with no `account_type`: `displayType` falls back to `termAccount` ("Account" for banking, "Account" for retail) — safe.
- The regex in `MessageContent` Task 3 uses `$` anchored lines with multiline flag — correctly handles multi-account output.
