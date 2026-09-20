'use strict';

const { createA2aTaskStore } = require('../services/lmdb/a2aTaskStore.lmdb');

function fakeDb() {
  const data = new Map();
  return {
    put: (key, value) => data.set(key, value),
    get: (key) => data.get(key),
    remove: (key) => data.delete(key),
    getRange: ({ start, end }) => Array.from(data.entries())
      .filter(([key]) => key >= start && key < end)
      .map(([key, value]) => ({ key, value })),
  };
}

describe('durable A2A task store', () => {
  test('partitions reads and writes by tenant and user, and redacts token-like fields', () => {
    const store = createA2aTaskStore({ db: fakeDb(), now: () => 1000 });
    const owner = { tenantId: 'tenant-a', userSub: 'user-a' };
    const task = store.createTask({ ...owner, contextId: 'ctx-1', message: { authorization: 'secret', text: 'hello' } });

    expect(task.message).toEqual({ text: 'hello' });
    expect(store.getTask(task.taskId, owner)).toMatchObject({ taskId: task.taskId });
    expect(store.getTask(task.taskId, { tenantId: 'tenant-b', userSub: 'user-a' })).toBeNull();
    expect(store.getTask(task.taskId, { tenantId: 'tenant-a', userSub: 'user-b' })).toBeNull();
  });

  test('keeps terminal tasks immutable and expires bounded records', () => {
    let now = 1000;
    const store = createA2aTaskStore({ db: fakeDb(), now: () => now, ttlMs: 10 });
    const owner = { tenantId: 'tenant-a', userSub: 'user-a' };
    const task = store.createTask({ ...owner, state: 'completed' });
    expect(store.updateTask(task.taskId, { state: 'working' }, owner).state).toBe('completed');
    now = 1011;
    expect(store.expireTasks()).toBe(1);
    expect(store.getTask(task.taskId, owner)).toBeNull();
  });

  test('lists same-context follow-ups in creation order', () => {
    let now = 1000;
    const store = createA2aTaskStore({ db: fakeDb(), now: () => now++ });
    const owner = { tenantId: 'tenant-a', userSub: 'user-a' };
    store.createTask({ ...owner, contextId: 'ctx-1', state: 'completed' });
    store.createTask({ ...owner, contextId: 'ctx-1', state: 'working' });
    expect(store.listContext('ctx-1', owner)).toHaveLength(2);
  });
});
