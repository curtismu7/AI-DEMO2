'use strict';

// Regression: createUser generated a uuid map key but let a spread-in
// userData.id (the PingOne sub from createUserFromOAuth) overwrite the
// record's id, so the record was unreachable via getUserById/updateUser.
// Every admin OAuth login after the first then got null from
// updateUser(user.id) and the login aborted (REGRESSION_LOG 2026-06-12).
const dataStore = require('../../data/store');

describe('dataStore.createUser id keying', () => {
  const createdIds = [];

  afterAll(async () => {
    for (const id of createdIds) await dataStore.deleteUser(id);
  });

  it('keys the record by a caller-provided id (OAuth sub) so updateUser/getUserById can find it', async () => {
    const sub = 'test-sub-1111-2222-3333-444444444444';
    const user = await dataStore.createUser({
      id: sub,
      username: 'createUserKeyTest',
      email: 'createUserKeyTest@test.com',
      role: 'admin',
      password: null,
    });
    createdIds.push(user.id);

    expect(user.id).toBe(sub);
    expect(dataStore.getUserById(sub)).toBe(user);

    const found = dataStore.getUserByUsername('createUserKeyTest');
    const updated = await dataStore.updateUser(found.id, { role: 'admin' });
    expect(updated).not.toBeNull();
    expect(updated.id).toBe(sub);
  });

  it('still generates an id when none is provided, with key matching record.id', async () => {
    const user = await dataStore.createUser({
      username: 'createUserNoIdTest',
      email: 'createUserNoIdTest@test.com',
      role: 'customer',
      password: null,
    });
    createdIds.push(user.id);

    expect(user.id).toEqual(expect.any(String));
    expect(user.id.length).toBeGreaterThan(0);
    expect(dataStore.getUserById(user.id)).toBe(user);
  });
});
