import type { Account } from '../../../interfaces/banking';
import { BankingToolRegistry } from '../../BankingToolRegistry';
import { TOOL_SCOPES } from '../../toolScopeMap';
import {
  pickAccountForNickname,
  formatAccountNickname,
  executeGetAccountNickname,
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

describe('registry and scopes', () => {
  it('exposes get_account_nickname as read-only with read scope', () => {
    const tool = BankingToolRegistry.getTool('get_account_nickname');
    expect(tool?.handler).toBe('executeGetAccountNickname');
    expect(tool?.readOnly).toBe(true);
    expect(tool?.requiredScopes).toEqual(['read']);
    expect(TOOL_SCOPES.get_account_nickname).toEqual(['read']);
  });
});
