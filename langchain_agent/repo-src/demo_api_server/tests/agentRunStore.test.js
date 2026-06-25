// agentRunStore.test.js — tests use the local EventEmitter fallback
// (Redis not required for unit tests)

// Force fallback mode (no Redis) for tests
process.env.AGUI_STORE_FALLBACK = 'true';

const { createAgentRunStore } = require('../services/agentRunStore');

describe('agentRunStore (fallback mode)', () => {
  let store;
  beforeEach(() => { store = createAgentRunStore(); });

  test('registers and retrieves run state', async () => {
    await store.setRunState('run_1', { status: 'running' });
    const state = await store.getRunState('run_1');
    expect(state).toMatchObject({ status: 'running' });
  });

  test('getRunState returns null for unknown runId', async () => {
    expect(await store.getRunState('nope')).toBeNull();
  });

  test('deleteRunState removes the entry', async () => {
    await store.setRunState('run_2', { status: 'running' });
    await store.deleteRunState('run_2');
    expect(await store.getRunState('run_2')).toBeNull();
  });

  test('publish + subscribe delivers consent signal', async () => {
    const received = [];
    await store.subscribeConsent('run_3', (msg) => received.push(msg));
    await store.publishConsent('run_3', { approved: true });
    // allow microtask queue to flush
    await new Promise((r) => setImmediate(r));
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ approved: true });
  });

  test('unsubscribe stops receiving consent signals', async () => {
    const received = [];
    const unsub = await store.subscribeConsent('run_4', (msg) => received.push(msg));
    unsub();
    await store.publishConsent('run_4', { approved: true });
    await new Promise((r) => setImmediate(r));
    expect(received).toHaveLength(0);
  });
});
