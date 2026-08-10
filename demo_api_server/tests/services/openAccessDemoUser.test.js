'use strict';

// openAccessDemoUser.resolveDemoUserId — id source + selection rules.
describe('openAccessDemoUser.resolveDemoUserId', () => {
  const origEnv = process.env.DEMO_SUBJECT_USER_ID;
  afterEach(() => {
    if (origEnv === undefined) delete process.env.DEMO_SUBJECT_USER_ID;
    else process.env.DEMO_SUBJECT_USER_ID = origEnv;
    jest.resetModules();
  });

  function load(storeStub) {
    jest.resetModules();
    jest.doMock('../../data/store', () => storeStub, { virtual: false });
    return require('../../services/openAccessDemoUser');
  }

  it('honors DEMO_SUBJECT_USER_ID override without touching the store', () => {
    process.env.DEMO_SUBJECT_USER_ID = 'explicit-id';
    const store = { getAllAccounts: jest.fn(), getTransactionsByUserId: jest.fn() };
    const mod = load(store);
    expect(mod.resolveDemoUserId()).toBe('explicit-id');
    expect(store.getAllAccounts).not.toHaveBeenCalled();
  });

  it('auto-resolves the owner with the most accounts+transactions (tx required)', () => {
    delete process.env.DEMO_SUBJECT_USER_ID;
    const tx = { rich: 50, few: 2, noTx: 0 };
    const store = {
      getAllAccounts: () => [
        { userId: 'rich' }, { userId: 'rich' },
        { userId: 'few' }, { userId: 'few' }, { userId: 'few' }, { userId: 'few' },
        { userId: 'noTx' }, { userId: 'noTx' }, { userId: 'noTx' }, { userId: 'noTx' },
        { userId: 'noTx' }, { userId: 'noTx' }, { userId: 'noTx' }, { userId: 'noTx' },
      ],
      getTransactionsByUserId: (uid) => Array.from({ length: tx[uid] || 0 }),
    };
    const mod = load(store);
    // rich: 2+50=52 beats few: 4+2=6; noTx has 8 accounts but 0 tx → excluded.
    expect(mod.resolveDemoUserId()).toBe('rich');
  });

  it('returns null when no owner has transactions', () => {
    delete process.env.DEMO_SUBJECT_USER_ID;
    const store = {
      getAllAccounts: () => [{ userId: 'a' }, { userId: 'b' }],
      getTransactionsByUserId: () => [],
    };
    const mod = load(store);
    expect(mod.resolveDemoUserId()).toBeNull();
  });

  it('resolveDemoUser enriches id with name/email from the user store', () => {
    process.env.DEMO_SUBJECT_USER_ID = 'u1';
    const store = {
      getAllAccounts: jest.fn(),
      getTransactionsByUserId: jest.fn(),
      getAllUsers: () => [{ id: 'u1', email: 'demo@example.com', firstName: 'Dana', lastName: 'Demo' }],
    };
    const mod = load(store);
    expect(mod.resolveDemoUser()).toEqual({
      id: 'u1',
      username: 'demo@example.com',
      email: 'demo@example.com',
      firstName: 'Dana',
      lastName: 'Demo',
      name: 'Dana Demo',
    });
  });

  it('resolveDemoUser returns null when no id resolves', () => {
    delete process.env.DEMO_SUBJECT_USER_ID;
    const store = { getAllAccounts: () => [], getTransactionsByUserId: () => [] };
    const mod = load(store);
    expect(mod.resolveDemoUser()).toBeNull();
  });
});
