// banking_api_ui/src/__tests__/accountsHydration.test.js
import {
  ACCOUNT_FETCH_MAX_ATTEMPTS,
  fetchMyAccountsWithResilience,
  isAccountsHydrationTransientError,
} from '../services/accountsHydration';

describe('isAccountsHydrationTransientError', () => {
  it('treats network errors as transient', () => {
    expect(isAccountsHydrationTransientError({ response: undefined })).toBe(true);
  });

  it('retries 503 and 502', () => {
    expect(isAccountsHydrationTransientError({ response: { status: 503 } })).toBe(true);
    expect(isAccountsHydrationTransientError({ response: { status: 502 } })).toBe(true);
  });

  it('does not retry 429', () => {
    expect(isAccountsHydrationTransientError({ response: { status: 429 } })).toBe(false);
  });
});

describe('fetchMyAccountsWithResilience', () => {
  beforeEach(() => {
    jest.spyOn(global, 'setTimeout').mockImplementation((fn) => {
      if (typeof fn === 'function') fn();
      return 0;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns accounts on first successful non-empty response', async () => {
    const bffAxios = {
      get: jest.fn().mockResolvedValue({ data: { accounts: [{ id: 'a1' }] } }),
    };
    await expect(fetchMyAccountsWithResilience(bffAxios, { isUserLoggedOut: () => false })).resolves.toEqual([
      { id: 'a1' },
    ]);
    expect(bffAxios.get).toHaveBeenCalledTimes(1);
  });

  it('retries on 401 then succeeds', async () => {
    const bffAxios = {
      get: jest
        .fn()
        .mockRejectedValueOnce({ response: { status: 401 } })
        .mockResolvedValueOnce({ data: { accounts: [{ id: 'x' }] } }),
    };
    await expect(fetchMyAccountsWithResilience(bffAxios, { isUserLoggedOut: () => false })).resolves.toEqual([
      { id: 'x' },
    ]);
    expect(bffAxios.get).toHaveBeenCalledTimes(2);
  });

  it('throws when user logged out on 401', async () => {
    const err = { response: { status: 401 } };
    const bffAxios = { get: jest.fn().mockRejectedValue(err) };
    await expect(
      fetchMyAccountsWithResilience(bffAxios, { isUserLoggedOut: () => true })
    ).rejects.toBe(err);
  });

  it('stops after max attempts', async () => {
    const err = { response: { status: 401 } };
    const bffAxios = { get: jest.fn().mockRejectedValue(err) };
    await expect(fetchMyAccountsWithResilience(bffAxios, { isUserLoggedOut: () => false })).rejects.toBe(err);
    expect(bffAxios.get).toHaveBeenCalledTimes(ACCOUNT_FETCH_MAX_ATTEMPTS);
  });
});
