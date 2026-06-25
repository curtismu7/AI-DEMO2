'use strict';

const fs = require('fs');

/**
 * Per-user data store seeded from a JSON file. Each userId gets its own deep
 * clone of the seed on first access (so one user's mutations never leak to
 * another) — the identical pattern every vertical's data.js was hand-writing.
 *
 * Mutators are declared as `(data, ...args) => result` and exposed on the store
 * already bound to the calling user's cloned data:
 *
 *   const store = createSeedStore(path.join(__dirname, 'seed.json'), {
 *     releaseRecord: (data, id) => { ... return record; },
 *   });
 *   store.get(userId);                 // cloned seed
 *   store.releaseRecord(userId, 'P-1'); // mutator, data bound to that user
 *
 * @param {string} seedPath  absolute path to the seed JSON
 * @param {Record<string, Function>} [mutators]
 */
function createSeedStore(seedPath, mutators = {}) {
  const SEED = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  const byUser = new Map(); // userId -> cloned seed object

  function get(userId) {
    const key = userId || 'anon';
    if (!byUser.has(key)) byUser.set(key, structuredClone(SEED));
    return byUser.get(key);
  }

  const store = { get };
  for (const [name, fn] of Object.entries(mutators)) {
    store[name] = (userId, ...args) => fn(get(userId), ...args);
  }
  return store;
}

module.exports = { createSeedStore };
