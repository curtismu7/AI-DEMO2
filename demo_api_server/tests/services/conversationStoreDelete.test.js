'use strict';

/**
 * conversationStore LMDB delete paths.
 *
 * Both call sites used db.deleteSync(), which the lmdb handle does not define —
 * every other store in services/lmdb/ calls removeSync(). The result was
 * "db.deleteSync is not a function" thrown from saveMessage's trim, surfacing as
 * a 500 on POST /:userId/:vertical/hero-shown on EVERY dashboard load. Found by
 * driving the live UI; no unit test covered either path.
 */

const path = require('path');
const os = require('os');
const fs = require('fs');

describe('conversationStore delete paths use the real lmdb API', () => {
  let store;
  let tmpDir;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'convstore-'));
    process.env.LMDB_PATH = tmpDir;
    store = require('../../services/lmdb/conversationStore.lmdb');
  });

  afterAll(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  it('the module never calls the non-existent deleteSync', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../services/lmdb/conversationStore.lmdb.js'), 'utf8',
    );
    expect(src).not.toMatch(/\bdeleteSync\s*\(/);
    expect(src).toMatch(/\bremoveSync\s*\(/);
  });

  it('saveMessage survives trimming past the per-thread cap', () => {
    // The trim branch is what threw in production. Write enough messages to
    // cross MAX_MESSAGES_PER_THREAD so the delete path actually runs.
    expect(() => {
      for (let i = 0; i < 60; i += 1) {
        store.saveMessage('u-trim', 'retail', 'assistant', `m${i}`, { timestamp: Date.now() + i });
      }
    }).not.toThrow();
  });

  it('clearing a thread removes its messages', () => {
    store.saveMessage('u-clear', 'retail', 'assistant', 'hello', { timestamp: Date.now() });
    expect(() => store.clearHistory('u-clear', 'retail')).not.toThrow();
    const after = store.getHistory('u-clear', 'retail', 10);
    expect(Array.isArray(after) ? after.length : 0).toBe(0);
  });
});
