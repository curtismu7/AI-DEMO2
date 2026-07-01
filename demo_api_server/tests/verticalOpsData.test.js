jest.mock('../data/store', () => ({
  getAllUsers: () => [{ id: 'u1', username: 'maya', firstName: 'Maya', lastName: 'Chen', email: 'maya@x.com', role: 'user' }],
  getAllAccounts: () => [{ id: 'ac1', accountNumber: '0001', balance: 100, type: 'Checking' }],
  getTransactionsByAccountId: () => [{ id: 't1', amount: -5 }],
}));
jest.mock('../config/verticals/healthcare', () => ({
  getDataStore: () => ({ get: (id) => ({ appointments: [{ id: 'a1', status: 'Scheduled' }] }) }),
}), { virtual: true });

const { getCustomerContext } = require('../services/verticalOpsData');

describe('getCustomerContext', () => {
  test('resolves a user-centric vertical and returns plugin records', () => {
    const out = getCustomerContext('healthcare', 'maya');
    expect(out.customer.name).toBe('Maya Chen');
    expect(out.records.appointments[0].id).toBe('a1');
  });

  test('returns null customer when no match', () => {
    expect(getCustomerContext('healthcare', 'nobody').customer).toBeNull();
  });

  test('banking synthesizes a customer from accounts', () => {
    const out = getCustomerContext('banking', '0001');
    expect(out.records.accounts[0].id).toBe('ac1');
    expect(out.customer).toBeTruthy();
  });
});
