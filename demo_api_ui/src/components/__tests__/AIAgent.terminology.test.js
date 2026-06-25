// banking_api_ui/src/components/__tests__/BankingAgent.terminology.test.js
/**
 * Tests that the accounts results panel and its table use vertical terminology
 * (from the manifest) instead of hard-coded banking labels.
 *
 * Covers the regression: "List My Orders" chip (retail vertical) was showing
 * an "Accounts" panel with "Account Name" column headers instead of using the
 * vertical's terminology.account / terminology.accounts values.
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { AccountsTable, buildClarificationQuestions, buildResultsPanelTitle, formatResult, MessageContent, ResultsPanel, TransactionsTable } from "../AIAgent";

describe("buildResultsPanelTitle", () => {
  test("returns terminology.accounts for accounts type when terminology provided", () => {
    expect(
      buildResultsPanelTitle("accounts", { accounts: "My Orders" })
    ).toBe("My Orders");
  });
});

const MOCK_ACCOUNTS = [
  { id: "acc-1", account_number: "ACC0001", account_type: "checking", balance: 5000 },
];

describe("AccountsTable", () => {
  test("shows terminology.account-based column header for retail vertical", () => {
    render(
      <AccountsTable
        accounts={MOCK_ACCOUNTS}
        terminology={{ account: "Order", accounts: "Orders" }}
      />
    );
    expect(screen.getByRole("columnheader", { name: /order name/i })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /account name/i })).not.toBeInTheDocument();
  });

  test("uses terminology.account in cell content without banking-type prefix", () => {
    render(
      <AccountsTable
        accounts={MOCK_ACCOUNTS}
        terminology={{ account: "Order", accounts: "Orders" }}
      />
    );
    // New behavior: no banking substring remapping — name cell is "Order (0001)", not "Checking Order (0001)"
    expect(screen.getByText(/order \(0001\)/i)).toBeInTheDocument();
    expect(screen.queryByText(/checking order/i)).not.toBeInTheDocument();
  });
});

describe("MessageContent", () => {
  test("uses terminology.accounts as the first column header when rendering account rows", () => {
    const text = 'Checking Order (****6321) — $5,000.00 USD\n\nSavings Order (****7890) — $8,500.00 USD';
    render(<MessageContent text={text} terminology={{ account: "Order", accounts: "My Orders", balance: "Reward Points" }} />);
    expect(screen.getByRole("columnheader", { name: /my orders/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /reward points/i })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /^account$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /^balance$/i })).not.toBeInTheDocument();
  });
});

describe("buildClarificationQuestions", () => {
  test("transfer question uses terminology.highValueAction and terminology.accounts instead of banking defaults", () => {
    const t = { highValueAction: "Place Order", accounts: "Items", accountTypes: ["Wishlist", "Cart"] };
    const q = buildClarificationQuestions(t);
    expect(q.transfer).toMatch(/items/i);
    expect(q.transfer).not.toMatch(/checking/i);
  });
});

describe("formatResult", () => {
  test("uses terminology.balance instead of 'Balance:' when terminology is supplied", () => {
    const text = formatResult({ balance: 500 }, { balance: "PTO Balance" });
    expect(text).toBe("PTO Balance: $500.00");
  });
});

describe("AccountsTable — null account guard (Issue 1)", () => {
  test("does not throw when account list contains a null entry", () => {
    expect(() =>
      render(
        <AccountsTable
          accounts={[null]}
          terminology={{ account: "Order", accounts: "Orders" }}
        />
      )
    ).not.toThrow();
  });
});

describe("AccountsTable — camelCase accountNumber (Issue 2)", () => {
  test("uses accountNumber (camelCase) when account_number is absent", () => {
    const mcpAccount = { id: "acc-2", accountNumber: "MCP9999", account_type: "savings", balance: 1234 };
    render(
      <AccountsTable
        accounts={[mcpAccount]}
        terminology={{ account: "Order", accounts: "Orders" }}
      />
    );
    // Should show last 4 of "MCP9999" → "9999"
    expect(screen.getByText(/9999/)).toBeInTheDocument();
  });
});

describe("buildResultsPanelTitle — transactions type uses terminology (Issue 3)", () => {
  test("returns terminology.transactions for transactions type when terminology provided", () => {
    expect(
      buildResultsPanelTitle("transactions", { transactions: "My Purchases" })
    ).toBe("My Purchases");
  });
});

describe('formatResult accounts branch — vertical types render verbatim', () => {
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

  it('does not emit the 🏦 emoji', () => {
    const text = formatResult(retailResult, retailTerminology);
    expect(text).not.toContain('🏦');
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

describe('TransactionsTable vertical rendering', () => {
  const healthcareTerminology = {
    transaction: 'Appointment',
    transactions: 'Appointments',
    balance: 'Coverage',
  };

  const healthcareTransactions = [
    { id: 't1', type: 'Visit', amount: 50,  description: 'Annual Physical', date: '2026-04-10' },
    { id: 't2', type: 'Lab',   amount: 25,  description: 'Blood Work',      date: '2026-04-15' },
  ];

  it('uses terminology.transaction as the Type column header', () => {
    render(<TransactionsTable transactions={healthcareTransactions} terminology={healthcareTerminology} />);
    expect(screen.getByText('Appointment')).toBeInTheDocument();
    expect(screen.queryByText('Type')).not.toBeInTheDocument();
  });

  it('uses terminology.balance as the Amount column header', () => {
    render(<TransactionsTable transactions={healthcareTransactions} terminology={healthcareTerminology} />);
    expect(screen.getByText('Coverage')).toBeInTheDocument();
    expect(screen.queryByText('Amount')).not.toBeInTheDocument();
  });

  it('renders Visit and Lab transaction types verbatim', () => {
    render(<TransactionsTable transactions={healthcareTransactions} terminology={healthcareTerminology} />);
    expect(screen.getByText('Visit')).toBeInTheDocument();
    expect(screen.getByText('Lab')).toBeInTheDocument();
  });

  it('falls back to "Type" and "Amount" with no terminology (banking)', () => {
    const bankingTxns = [
      { id: 't1', type: 'deposit', amount: 1000, description: 'Payroll', date: '2026-04-01' },
    ];
    render(<TransactionsTable transactions={bankingTxns} terminology={undefined} />);
    expect(screen.getByText('Type')).toBeInTheDocument();
    expect(screen.getByText('Amount')).toBeInTheDocument();
  });
});

describe('Balance panel label uses vertical terminology', () => {
  it('buildResultsPanelTitle returns "Reward Points" for balance with sporting-goods terminology', () => {
    expect(buildResultsPanelTitle('balance', { balance: 'Reward Points' })).toBe('Reward Points');
  });

  it('buildResultsPanelTitle returns "Coverage" for balance with healthcare terminology', () => {
    expect(buildResultsPanelTitle('balance', { balance: 'Coverage' })).toBe('Coverage');
  });

  it('buildResultsPanelTitle falls back to "Balance" with no terminology', () => {
    expect(buildResultsPanelTitle('balance', undefined)).toBe('Balance');
  });

  it('ResultsPanel renders terminology.balance as the balance label instead of hardcoded "Balance"', () => {
    const panel = { type: 'balance', title: 'Points Summary', data: 1500, terminology: { balance: 'Reward Points' } };
    render(<ResultsPanel panel={panel} onClose={() => {}} />);
    expect(screen.getByText('Reward Points')).toBeInTheDocument();
    expect(screen.queryByText('Balance')).not.toBeInTheDocument();
  });
});
