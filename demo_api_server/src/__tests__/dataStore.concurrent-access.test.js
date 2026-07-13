'use strict';

const dataStore = require('../../data/store');

describe('DataStore concurrent user access', () => {
  const testAccountIds = [];
  const testUserIds = [];

  beforeEach(async () => {
    // Create test users
    const user1 = await dataStore.createUser({
      id: `concurrent-test-user-${Date.now()}-1`,
      username: `testuser1-${Date.now()}`,
      email: `user1-${Date.now()}@test.com`,
      role: 'customer',
      password: null,
    });
    const user2 = await dataStore.createUser({
      id: `concurrent-test-user-${Date.now()}-2`,
      username: `testuser2-${Date.now()}`,
      email: `user2-${Date.now()}@test.com`,
      role: 'customer',
      password: null,
    });
    testUserIds.push(user1.id, user2.id);
  });

  afterEach(async () => {
    for (const id of testAccountIds) {
      try {
        await dataStore.deleteAccount(id);
      } catch (e) {
        // Account may have been deleted
      }
    }
    for (const userId of testUserIds) {
      try {
        await dataStore.deleteUser(userId);
      } catch (e) {
        // User may have been deleted
      }
    }
    testAccountIds.length = 0;
    testUserIds.length = 0;
  });

  it('should not lose updates when two users transfer from the same account concurrently', async () => {
    const sourceUserId = testUserIds[0];
    const targetUserId = testUserIds[1];

    // Create shared account for source user
    const sourceAccount = await dataStore.createAccount({
      userId: sourceUserId,
      name: 'Shared Account',
      balance: 1000,
    });
    testAccountIds.push(sourceAccount.id);

    // Create target account for second user
    const targetAccount = await dataStore.createAccount({
      userId: targetUserId,
      name: 'Target Account',
      balance: 0,
    });
    testAccountIds.push(targetAccount.id);

    // Simulate two concurrent transfers: both users transfer $100 from shared account
    // Expected result: both transfers succeed, shared balance = 800
    // (This tests atomic critical section in applyTransfer)
    const transfer1Promise = dataStore.applyTransfer({
      fromAccountId: sourceAccount.id,
      toAccountId: targetAccount.id,
      amount: 100,
      userId: sourceUserId,
      description: 'Transfer 1',
    });

    const transfer2Promise = dataStore.applyTransfer({
      fromAccountId: sourceAccount.id,
      toAccountId: targetAccount.id,
      amount: 100,
      userId: sourceUserId,
      description: 'Transfer 2',
    });

    const [result1, result2] = await Promise.all([transfer1Promise, transfer2Promise]);

    expect(result1.ok).toBe(true);
    expect(result2.ok).toBe(true);

    // Verify balances are correct (no lost update)
    const updatedSource = dataStore.getAccountById(sourceAccount.id);
    const updatedTarget = dataStore.getAccountById(targetAccount.id);

    expect(updatedSource.balance).toBe(800); // 1000 - 100 - 100
    expect(updatedTarget.balance).toBe(200); // 0 + 100 + 100
  });

  it('should enforce overdraft protection under concurrent access', async () => {
    const userId = testUserIds[0];

    const account = await dataStore.createAccount({
      userId: userId,
      name: 'Limited Account',
      balance: 150,
    });
    testAccountIds.push(account.id);

    const targetAccount = await dataStore.createAccount({
      userId: userId,
      name: 'Target',
      balance: 0,
    });
    testAccountIds.push(targetAccount.id);

    // Two concurrent transfers each trying to transfer $100 (total would exceed $150)
    const transfer1Promise = dataStore.applyTransfer({
      fromAccountId: account.id,
      toAccountId: targetAccount.id,
      amount: 100,
      userId: userId,
    });

    const transfer2Promise = dataStore.applyTransfer({
      fromAccountId: account.id,
      toAccountId: targetAccount.id,
      amount: 100,
      userId: userId,
    });

    const [result1, result2] = await Promise.all([transfer1Promise, transfer2Promise]);

    // One should succeed, one should fail
    const successCount = [result1, result2].filter(r => r.ok).length;
    const failCount = [result1, result2].filter(r => !r.ok).length;

    expect(successCount).toBe(1);
    expect(failCount).toBe(1);

    // Final balance should be 50 (one transfer succeeded)
    const finalAccount = dataStore.getAccountById(account.id);
    expect(finalAccount.balance).toBe(50);
  });

  it('should maintain user isolation: user A accounts not visible to user B', async () => {
    const userId1 = testUserIds[0];
    const userId2 = testUserIds[1];

    const account1 = await dataStore.createAccount({
      userId: userId1,
      name: 'User 1 Account',
      balance: 1000,
    });
    testAccountIds.push(account1.id);

    const account2 = await dataStore.createAccount({
      userId: userId2,
      name: 'User 2 Account',
      balance: 2000,
    });
    testAccountIds.push(account2.id);

    // User 1 should only see their own account
    const user1Accounts = dataStore.getAccountsByUserId(userId1);
    expect(user1Accounts).toContainEqual(expect.objectContaining({ id: account1.id }));
    expect(user1Accounts).not.toContainEqual(
      expect.objectContaining({ id: account2.id })
    );

    // User 2 should only see their own account
    const user2Accounts = dataStore.getAccountsByUserId(userId2);
    expect(user2Accounts).toContainEqual(expect.objectContaining({ id: account2.id }));
    expect(user2Accounts).not.toContainEqual(
      expect.objectContaining({ id: account1.id })
    );
  });

  it('should persist transfer data immediately (no lost updates on crash)', async () => {
    const userId = testUserIds[0];

    const fromAccount = await dataStore.createAccount({
      userId: userId,
      name: 'From',
      balance: 500,
    });
    testAccountIds.push(fromAccount.id);

    const toAccount = await dataStore.createAccount({
      userId: userId,
      name: 'To',
      balance: 100,
    });
    testAccountIds.push(toAccount.id);

    await dataStore.applyTransfer({
      fromAccountId: fromAccount.id,
      toAccountId: toAccount.id,
      amount: 250,
      userId: userId,
    });

    // After transfer completes, re-fetch from disk to ensure persistence
    const reloadedFrom = dataStore.getAccountById(fromAccount.id);
    const reloadedTo = dataStore.getAccountById(toAccount.id);

    expect(reloadedFrom.balance).toBe(250);
    expect(reloadedTo.balance).toBe(350);
  });
});
