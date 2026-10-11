// The support console's operator lookup and the Verify-customer ceremony both
// resolve the customer by username. The demo persona the whole repo documents
// (DEMO_USER_USERNAME, PingOne provisioning, docs) is 'demoUser' — the local
// store must seed that persona as a customer, or the console's default
// customer has no PingOne account to sign on with ("john.doe has no PingOne
// account to sign on with", 2026-10-11).
const dataStore = require('../data/store');

describe('sampleData seed customer persona', () => {
  test('seeds demoUser as an active customer with the documented password', () => {
    const users = dataStore.getAllUsers();
    const demo = users.find((u) => u.username === 'demoUser');
    expect(demo).toBeTruthy();
    expect(demo.role).toBe('customer');
    expect(demo.isActive).not.toBe(false);
    // The demo password the sign-in modal and docs advertise.
    expect(demo.password).toBeTruthy();
  });

  test('lookup by "demo" resolves the demoUser customer', () => {
    const users = dataStore.getAllUsers().filter((u) => u.role !== 'admin' && u.username);
    const match = users.find((u) => {
      const name = [u.firstName, u.lastName].filter(Boolean).join(' ').toLowerCase();
      return (u.username || '').toLowerCase().includes('demo')
        || (u.email || '').toLowerCase().includes('demo')
        || name.includes('demo');
    });
    expect(match?.username).toBe('demoUser');
  });
});
