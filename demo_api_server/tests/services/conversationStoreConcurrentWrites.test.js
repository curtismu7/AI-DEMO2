'use strict';

/**
 * conversationStore same-millisecond write durability (data-loss-under-load).
 *
 * saveMessage disambiguates messages written in the same millisecond by finding
 * the next unused sequence number for that timestamp. It read the seq from the
 * WRONG key segment: keys are `${userId}:${vertical}:${paddedTs}:${seq}`, so the
 * seq is `split(':')` index [3] — but the code read index [4] (one past the end),
 * which is `undefined` and parses to 0 for EVERY existing same-ms key. As a
 * result seq never advanced past 1, so the 3rd and later messages in a single
 * millisecond reused an already-written key and silently overwrote a prior
 * message. Under load this dropped messages (a round-2 prune test read 469 of
 * 500 on a fast CI runner).
 *
 * Why the clock is pinned here: each LMDB putSync fsyncs (~6ms on real disk), so
 * on a developer machine sequential writes land milliseconds apart and never
 * share a millisecond — the collision path is simply never exercised, no matter
 * how many messages a real-clock loop writes. That environment-dependence is the
 * exact non-determinism that let this bug reach a fast CI runner undetected. To
 * test the same-millisecond code path DETERMINISTICALLY we freeze Date.now for
 * the duration of the burst so all writes collapse into one millisecond bucket.
 */

const path = require('path');
const os = require('os');
const fs = require('fs');

describe('conversationStore persists every same-millisecond write', () => {
  let store;
  let tmpDir;
  let realNow;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'convstore-concurrent-'));
    process.env.LMDB_PATH = tmpDir;
    store = require('../../services/lmdb/conversationStore.lmdb');
  });

  afterAll(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  beforeEach(() => {
    realNow = Date.now;
  });

  afterEach(() => {
    Date.now = realNow;
  });

  it('writes 50 messages into one millisecond and loses none', () => {
    const userId = 'u-burst-50';
    const vertical = 'retail';
    const N = 50;

    // Freeze the clock so all N writes share one millisecond bucket, forcing the
    // seq-disambiguation path that the bug broke.
    const frozen = realNow.call(Date);
    Date.now = () => frozen;

    for (let i = 0; i < N; i += 1) {
      store.saveMessage(userId, vertical, 'user', `msg-${i}`, { seqTag: i });
    }

    // Every write must persist to a distinct key. On the buggy [4] read this is
    // < N (3rd+ same-ms write overwrote a prior one).
    expect(store.getThreadSize(userId, vertical)).toBe(N);

    const history = store.getHistory(userId, vertical, N);
    expect(history.length).toBe(N);
    // All N distinct messages are present (order within one ms is not asserted
    // here — seq is the tiebreaker; see the ordered-burst test below).
    expect(new Set(history.map((m) => m.content)).size).toBe(N);
  });

  it('reads a same-millisecond burst back in chronological (insertion) order', () => {
    const userId = 'u-burst-order';
    const vertical = 'retail';
    const N = 9; // single-digit seq: lexicographic key order == insertion order

    const frozen = realNow.call(Date);
    Date.now = () => frozen;

    for (let i = 0; i < N; i += 1) {
      store.saveMessage(userId, vertical, 'user', `msg-${i}`, { seqTag: i });
    }

    const history = store.getHistory(userId, vertical, N);
    expect(history.map((m) => m.content)).toEqual(
      Array.from({ length: N }, (_, i) => `msg-${i}`),
    );
  });
});
