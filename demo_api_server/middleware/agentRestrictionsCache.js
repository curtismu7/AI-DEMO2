'use strict';

class AgentRestrictionsCache {
  constructor({ ttlMs = 5000 } = {}) {
    this._ttlMs = ttlMs;
    this._store = new Map(); // key: userId, value: { value, expiresAt }
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

// Singleton used by agentRestrictionsGate — 5s TTL
const cache = new AgentRestrictionsCache({ ttlMs: 5000 });

module.exports = { AgentRestrictionsCache, cache };
