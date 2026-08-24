import type { Account } from '../../../interfaces/banking';
import { BankingToolRegistry } from '../../BankingToolRegistry';
import { TOOL_SCOPES } from '../../toolScopeMap';
import {
  pickAccountForNickname,
  formatAccountNickname,
  executeGetAccountNickname,
  executeGetMyAccounts,
} from '../accountHandlers';

const checking: Account = {
  id: 'acc-check-1',
  userId: 'u1',
  accountType: 'checking',
  name: 'Vacation Fund',
  accountNumber: '****1234',
  balance: 100,
  status: 'active',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

const savings: Account = {
  id: 'acc-save-1',
  userId: 'u1',
  accountType: 'savings',
  accountNumber: '****5678',
  balance: 200,
  status: 'active',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

describe('pickAccountForNickname', () => {
  it('returns account by id', () => {
    expect(pickAccountForNickname([checking, savings], 'acc-save-1')).toBe(savings);
  });

  it('returns first checking when account_id omitted', () => {
    expect(pickAccountForNickname([savings, checking])).toBe(checking);
  });

  it('returns null when no checking and no account_id', () => {
    expect(pickAccountForNickname([savings])).toBeNull();
  });
});

describe('formatAccountNickname', () => {
  it('uses account name when present', () => {
    expect(formatAccountNickname(checking)).toEqual({
      nickname: 'Vacation Fund',
      fallbackUsed: false,
    });
  });

  it('falls back to type and masked last four', () => {
    const result = formatAccountNickname(savings);
    expect(result.fallbackUsed).toBe(true);
    expect(result.nickname).toBe('Savings …5678');
  });
});

describe('executeGetAccountNickname', () => {
  const deps = {
    apiClient: {
      getMyAccounts: jest.fn(),
    },
    logger: { debug: jest.fn(), error: jest.fn() },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns nickname for default checking account', async () => {
    deps.apiClient.getMyAccounts.mockResolvedValue([checking]);
    const result = await executeGetAccountNickname(deps as any, 'token', {});
    expect(result.success).toBe(true);
    expect(result.structuredContent).toMatchObject({
      accountId: 'acc-check-1',
      nickname: 'Vacation Fund',
      fallbackUsed: false,
    });
  });
});

describe('executeGetMyAccounts', () => {
  const deps = {
    apiClient: {
      getMyAccounts: jest.fn(),
    },
    logger: { debug: jest.fn(), error: jest.fn() },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Real seeded accounts never set several optional fields — the MCP output
  // schema (GET_MY_ACCOUNTS_OUTPUT) requires accountNumber and types every
  // optional field as plain `string`, so missing/undefined must map to '',
  // never be omitted or left null.
  it('coerces missing optional fields to empty strings, never null or omitted', async () => {
    // Real seeded checking/savings accounts omit accountNumber entirely at
    // runtime (the Account TS type requires it; the actual seed data doesn't) —
    // cast to reproduce that live shape.
    const bareAccount = {
      id: 'acc-bare-1',
      userId: 'u1',
      accountType: 'CHECKING',
      balance: 50,
      status: 'active',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    } as Account;
    deps.apiClient.getMyAccounts.mockResolvedValue([bareAccount]);
    const result = await executeGetMyAccounts(deps as any, 'token', {});
    const [mapped] = (result.structuredContent as any).accounts;
    expect(mapped.accountNumber).toBe('');
    expect(mapped.swiftCode).toBe('');
    expect(mapped.iban).toBe('');
    expect(mapped.branchName).toBe('');
    expect(mapped.branchCode).toBe('');
    expect(mapped.openedDate).toBe('');
    expect(mapped.notes).toBe('');
    expect(mapped.name).toBe('');
    expect(mapped.accountHolderName).toBe('');
    expect('accountNumber' in mapped).toBe(true);
  });

  // Real accountType values are inconsistently cased/named across seed
  // paths (CHECKING/SAVINGS uppercase; loan/credit_card lowercase), while
  // the tool's own enum offers lowercase 'checking'/'savings'/'credit'.
  it('matches account_type case-insensitively against uppercase seeded data', async () => {
    const uppercaseChecking: Account = { ...checking, id: 'acc-CHECKING-upper', accountType: 'CHECKING' };
    const uppercaseSavings: Account = { ...savings, id: 'acc-SAVINGS-upper', accountType: 'SAVINGS' };
    deps.apiClient.getMyAccounts.mockResolvedValue([uppercaseChecking, uppercaseSavings]);
    const result = await executeGetMyAccounts(deps as any, 'token', { account_type: 'checking' });
    expect((result.structuredContent as any).accounts).toHaveLength(1);
    expect((result.structuredContent as any).accounts[0].id).toBe('acc-CHECKING-upper');
  });

  it("maps the 'credit' filter to the real 'credit_card' accountType", async () => {
    const creditCard: Account = {
      id: 'acc-credit-1',
      userId: 'u1',
      accountType: 'credit_card',
      accountNumber: '****9999',
      balance: -200,
      status: 'active',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    };
    deps.apiClient.getMyAccounts.mockResolvedValue([checking, creditCard]);
    const result = await executeGetMyAccounts(deps as any, 'token', { account_type: 'credit' });
    expect((result.structuredContent as any).accounts).toEqual([
      expect.objectContaining({ id: 'acc-credit-1' }),
    ]);
  });
});

describe('registry and scopes', () => {
  it('exposes get_account_nickname as read-only with read scope', () => {
    const tool = BankingToolRegistry.getTool('get_account_nickname');
    expect(tool?.handler).toBe('executeGetAccountNickname');
    expect(tool?.readOnly).toBe(true);
    expect(tool?.requiredScopes).toEqual(['read']);
    expect(TOOL_SCOPES.get_account_nickname).toEqual(['read']);
  });
});
