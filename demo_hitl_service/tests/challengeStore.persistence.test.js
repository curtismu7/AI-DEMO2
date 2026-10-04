'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

// A restart is a fresh module load against the same file.
function restart() {
  jest.resetModules();
  return require('../src/store/challengeStore');
}

describe('challengeStore persistence', () => {
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hitl-store-'));
    process.env.HITL_CHALLENGE_STORE_FILE = path.join(dir, 'challenges.json');
  });

  afterEach(() => {
    delete process.env.HITL_CHALLENGE_STORE_FILE;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('a pending challenge survives a restart and can still be approved', () => {
    const ch = restart().create({ tool: 'create_transfer', userId: 'u1', agentId: 'a1', context: {} });

    const store = restart();
    expect(store.get(ch.id).status).toBe('pending');
    expect(store.resolve(ch.id, 'approved').status).toBe('approved');
  });

  test('a consumed challenge stays consumed after a restart', () => {
    let store = restart();
    const ch = store.create({ tool: 'create_transfer', userId: 'u1', agentId: 'a1', context: {} });
    store.resolve(ch.id, 'approved');
    store.consume(ch.id);

    store = restart();
    expect(store.get(ch.id).status).toBe('consumed');
    expect(() => store.consume(ch.id)).toThrow(/not approved/);
  });

  test('an unreadable file starts empty instead of crashing', () => {
    fs.writeFileSync(process.env.HITL_CHALLENGE_STORE_FILE, '{not json');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    expect(restart().list()).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test('without the env var nothing is written', () => {
    const file = process.env.HITL_CHALLENGE_STORE_FILE;
    delete process.env.HITL_CHALLENGE_STORE_FILE;

    restart().create({ tool: 'x', userId: 'u1', agentId: 'a1', context: {} });
    expect(fs.existsSync(file)).toBe(false);
  });
});
