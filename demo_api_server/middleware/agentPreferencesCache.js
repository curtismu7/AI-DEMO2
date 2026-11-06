'use strict';

// In-memory preference cache — same shape/TTL as agentRestrictionsCache but
// self-contained so a test mock of either module cannot break the other.
class AgentPreferencesCache {
  constructor({ ttlMs = 5000 } = {}) {
    this._ttlMs = ttlMs;
    this._store = new Map();
  }

  get(userId) {
    const entry = this._store.get(userId);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this._store.delete(userId);
      return null;
    }
    return entry.value;
  }

  set(userId, value) {
    this._store.set(userId, { value, expiresAt: Date.now() + this._ttlMs });
  }

  invalidate(userId) {
    this._store.delete(userId);
  }
}

// Singleton used by agentPreferencesGate — 5s TTL
const cache = new AgentPreferencesCache({ ttlMs: 5000 });

module.exports = { AgentPreferencesCache, cache };
