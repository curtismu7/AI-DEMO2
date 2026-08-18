'use strict';
/**
 * conversationStore: summary entries must not leak into message scans.
 *
 * Messages key as `${userId}:${vertical}:${15digitTs}:${seq}`; summaries as
 * `${userId}:${vertical}:_summary:${id}`. `_` (0x5F) sorts AFTER digits, so a
 * summary key falls inside the `[prefix, prefix+￿]` range every thread scan
 * uses — and in the reverse scan getHistory does, it sorts FIRST, so a summary
 * was returned as the newest "message". Summary objects also carry no
 * `.timestamp` (only `createdAt`), so prune's `value.timestamp||0`=0 deleted
 * them first. All four message scans now skip non-message values; the dedicated
 * summary reader still returns them.
 */

const path = require('path');
const os = require('os');
const fs = require('fs');

describe('conversationStore excludes summaries from message scans', () => {
  let store;
  let tmpDir;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'convsum-'));
    process.env.LMDB_PATH = tmpDir;
    store = require('../../services/lmdb/conversationStore.lmdb');
  });

  afterAll(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  it('getHistory returns the real newest message, never a summary', () => {
    const u = 'u-hist';
    store.saveMessage(u, 'retail', 'user', 'first');
    store.saveMessage(u, 'retail', 'assistant', 'second');
    store.saveMessage(u, 'retail', 'user', 'third (newest)');

    // Persist a summary AFTER the messages — its `_summary:` key sorts last, so
    // the reverse scan would otherwise hand it back as the newest message.
    store.saveSummary(u, 'retail', [{ role: 'user', content: 'first' }], 0, 1);

    const history = store.getHistory(u, 'retail', 30);
    expect(history.every((m) => typeof m.role === 'string' && typeof m.content === 'string')).toBe(true);
    expect(history.map((m) => m.content)).toEqual(['first', 'second', 'third (newest)']);
    // Newest (last, chronological order) is the real message, not the summary.
    expect(history[history.length - 1].content).toBe('third (newest)');
  });

  it('getThreadSize counts only real messages', () => {
    const u = 'u-size';
    store.saveMessage(u, 'retail', 'user', 'a');
    store.saveMessage(u, 'retail', 'assistant', 'b');
    store.saveSummary(u, 'retail', [{ role: 'user', content: 'a' }], 0, 1);

    expect(store.getThreadSize(u, 'retail')).toBe(2);
  });

  it('the dedicated summary reader still returns saved summaries', () => {
    const u = 'u-read';
    store.saveMessage(u, 'retail', 'user', 'hello');
    const { summaryId } = store.saveSummary(u, 'retail', [{ role: 'user', content: 'hello' }], 0, 1);

    const summaries = store.getSummaries(u, 'retail');
    expect(summaries).toHaveLength(1);
    expect(summaries[0].id).toBe(summaryId);
  });

  it('prune does not delete summaries (they lack .timestamp)', () => {
    const u = 'u-prune';
    // The message key embeds Date.now(); in a tight loop many writes share one
    // millisecond, so how many distinct messages actually persist depends on
    // wall-clock speed (a source of CI flakiness). Advance a mocked clock so
    // every write lands in its own millisecond → distinct key → no collision,
    // isolating this test from timing while still exercising the real prune path.
    let clock = 1_700_000_000_000;
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => (clock += 1));
    try {
      store.saveSummary(u, 'retail', [{ role: 'user', content: 'seed' }], 0, 1);
      // Cross MAX_MESSAGES_PER_THREAD so the prune branch actually runs.
      for (let i = 0; i < store.MAX_MESSAGES_PER_THREAD + 5; i += 1) {
        store.saveMessage(u, 'retail', 'assistant', `m${i}`);
      }

      // Summary survived the prune, and the thread was trimmed to exactly the cap
      // (all 500 real messages retained; the 5 oldest dropped, the summary kept).
      expect(store.getSummaries(u, 'retail')).toHaveLength(1);
      expect(store.getThreadSize(u, 'retail')).toBe(store.MAX_MESSAGES_PER_THREAD);
    } finally {
      nowSpy.mockRestore();
    }
  });
});
